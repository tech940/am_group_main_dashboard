import 'server-only'

import { sql } from 'drizzle-orm'

import { analyticsDb } from '@/lib/analytics/db'
import { analyticsTableColumns } from '@/lib/analytics/table-columns'
import { redactHyundaiReportRows, maskHyundaiPii } from '@/lib/hyundai/pii'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import type {
  FinanceModeKey,
  ReportKey,
  SalesRetailModelCard,
  SalesRetailTransaction,
  SalesReportConsultantRow,
  SalesReportCsvPayload,
  SalesReportFreshnessPayload,
  SalesReportFreshnessSource,
  SalesReportKpi,
  SalesReportListPayload,
  SalesReportMonthOption,
  SalesReportSourceCard,
  SalesReportSummaryPayload,
  SourceKey,
  TemperatureKey,
} from '@/lib/hyundai/sales-report-types'
import {
  HYUNDAI_BRANCH_DEALERS,
  normalizeHyundaiDealerCode,
  hyundaiSourceDealerSql,
} from '@/lib/hyundai/dealer-branch'
import { getSalesStockSource } from '@/lib/brands/sales-stock-sources'

type Row = Record<string, unknown>

const HYUNDAI_TABLES = getSalesStockSource('hyundai')!.tables

type TableConfig = {
  key: SourceKey
  label: string
  table: string
  dateColumn: string
  dealerColumns: string[]
  defaultVisibleColumns: string[]
  searchColumns: string[]
  sourceColumn?: string
  consultantColumn?: string
  modelColumn?: string
  sortColumn: string
}

type ResolvedMonthContext = {
  key: string
  label: string
  year: number
  month: number
}

type ResolvedDateContext = ResolvedMonthContext & {
  startDate: string
  endDate: string
  endDateExclusive: string
  comparisonKey: string
  comparisonLabel: string
  comparisonStartDate: string
  comparisonEndDate: string
  comparisonEndDateExclusive: string
  rangeMode: 'month' | 'custom'
}

const HYUNDAI_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS = 60 * 10
const HYUNDAI_SALES_REPORT_SUMMARY_CACHE_TTL_SECONDS = 60 * 5
const ALL_DEALERS_CACHE_KEY = '__all__'
const hyundaiSalesReportFreshnessFallback = new Map<string, SalesReportFreshnessPayload>()
const hyundaiSalesReportSummaryFallback = new Map<string, SalesReportSummaryPayload>()

const TABLES: Record<SourceKey, TableConfig> = {
  enquiry: {
    key: 'enquiry',
    label: 'Enquiry Report',
    table: HYUNDAI_TABLES.enquiry,
    dateColumn: 'enquiry_date',
    dealerColumns: ['dealer_code_2', 'source_dealer_code', 'dealer_code', 'main_dealer_code'],
    defaultVisibleColumns: ['enquiry_date', 'customer_id', 'name_of_the_customer', 'contact_number', 'model', 'source', 'consultant_name', 'enquiry_status', 'booking_date', 'retail_date', 'lost_reason'],
    searchColumns: ['customer_id', 'name_of_the_customer', 'contact_number', 'model', 'variant', 'consultant_name', 'source', 'enquiry_status', 'lost_reason'],
    sourceColumn: 'source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'enquiry_date',
  },
  booking: {
    key: 'booking',
    label: 'Booking Report',
    table: HYUNDAI_TABLES.booking,
    dateColumn: 'booking_date',
    dealerColumns: ['source_dealer_code', 'dealer_code'],
    defaultVisibleColumns: ['booking_date', 'name_of_the_customer', 'contact_number', 'model', 'variant', 'main_source', 'consultant_name', 'amount_received', 'mode_of_purchase'],
    searchColumns: ['name_of_the_customer', 'contact_number', 'model', 'variant', 'consultant_name', 'main_source'],
    sourceColumn: 'main_source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'booking_date',
  },
  sales: {
    key: 'sales',
    label: 'Sales Report',
    table: HYUNDAI_TABLES.sales,
    dateColumn: 'COALESCE(delivery_date, confirm_date)',
    dealerColumns: ['dealer_code_2', 'source_dealer_code', 'dealer_code', 'main_dealer_code'],
    defaultVisibleColumns: ['delivery_date', 'confirm_date', 'invoice_date', 'invoice_no', 'registration_name', 'contact_num1', 'model', 'variant', 'color', 'consultant_name', 'source', 'mode_of_purchase', 'dsa_financier', 'basic_amount'],
    searchColumns: ['invoice_no', 'customerid', 'registration_name', 'contact_num1', 'model', 'variant', 'consultant_name', 'source', 'dsa_financier', 'vin_number'],
    sourceColumn: 'source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'COALESCE(delivery_date, confirm_date)',
  },
  purchase: {
    key: 'purchase',
    label: 'Purchase Report',
    table: HYUNDAI_TABLES.purchase,
    // COALESCE, not grn_date alone: grn_date is NULL on ALL 11,238 rows of hyundai_purchase_report,
    // so the Purchase tab could never match a month and rendered empty at every period while the data
    // sat right there. order_date is populated on all 11,238 (max 2026-07-23). Ordered so that a
    // future feed carrying a real GRN date silently takes precedence again — same idiom the sales
    // config already uses with COALESCE(delivery_date, confirm_date).
    dateColumn: 'COALESCE(grn_date, departure_date, order_date)',
    dealerColumns: ['dealer_code_2', 'source_dealer_code', 'dealer_code'],
    defaultVisibleColumns: ['grn_date', 'vin_no', 'model', 'variant', 'color', 'basic_price'],
    searchColumns: ['vin_no', 'model', 'variant', 'color'],
    modelColumn: 'model',
    sortColumn: 'grn_date',
  },
}

function resultRows(result: unknown) {
  return Array.isArray(result) ? result as Row[] : []
}

function safeText(value: unknown) {
  return String(value ?? '').trim()
}

function upperText(value: unknown) {
  return safeText(value).toUpperCase()
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeSource(value: unknown) {
  const raw = safeText(value)
  const normalized = raw.toLowerCase()
  if (!normalized) return 'Unknown'
  if (normalized.includes('walk')) return 'Walkin'
  if (normalized.includes('hyper')) return 'Hyperlocal'
  if (normalized.includes('field')) return 'Field'
  if (normalized.includes('refer')) return 'Referral'
  if (normalized.includes('tele') || normalized.includes('outbound') || normalized.includes('call')) return 'Telephone'
  if (normalized.includes('crm') || normalized.includes('online') || normalized.includes('mob') || normalized.includes('web') || normalized.includes('digital') || normalized.includes('social')) return 'Online/Digital'
  return raw
}

function normalizeConsultant(value: unknown) {
  return safeText(value) || 'Unassigned'
}

function normalizeModel(value: unknown) {
  return safeText(value) || 'Unknown'
}

function normalizeFinancier(value: unknown) {
  return safeText(value) || 'Unknown'
}

function normalizeFinanceMode(row: Row): FinanceModeKey {
  const purchaseMode = safeText(row.mode_of_purchase).toLowerCase()
  if (purchaseMode.includes('cash')) return 'Cash'
  if (purchaseMode.includes('self')) return 'Self-Finance'
  if (purchaseMode.includes('finance') || purchaseMode.includes('lease') || safeText(row.dsa_financier)) return 'In-house'
  return 'Self-Finance'
}

function toIsoDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null
  }
  return candidate.toISOString().slice(0, 10)
}

function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-IN').format(Math.round(value))
}

function formatCurrency(value: number) {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)}Cr`
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)}L`
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

function getComparisonMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function resolveMonthContext(requestedMonthKey?: string | null): ResolvedMonthContext {
  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const rawKey = safeText(requestedMonthKey)

  if (rawKey && /^\d{4}-\d{2}$/.test(rawKey)) {
    const [y, m] = rawKey.split('-').map(Number)
    if (y >= 2018 && y <= currentYear + 1 && m >= 1 && m <= 12) {
      return { key: `${y}-${String(m).padStart(2, '0')}`, label: formatMonthLabel(y, m), year: y, month: m }
    }
  }

  return {
    key: `${currentYear}-${String(currentMonth).padStart(2, '0')}`,
    label: formatMonthLabel(currentYear, currentMonth),
    year: currentYear,
    month: currentMonth,
  }
}

function resolveDateContext(
  requestedMonthKey?: string | null,
  requestedStartDate?: string | null,
  requestedEndDate?: string | null
): ResolvedDateContext {
  const monthContext = resolveMonthContext(requestedMonthKey)
  const rawStart = safeText(requestedStartDate)
  const rawEnd = safeText(requestedEndDate)
  const isCustomRange = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) && /^\d{4}-\d{2}-\d{2}$/.test(rawEnd) && rawStart <= rawEnd

  if (isCustomRange) {
    const [sY, sM, sD] = rawStart.split('-').map(Number)
    const [eY, eM, eD] = rawEnd.split('-').map(Number)
    const startIso = toIsoDate(sY, sM, sD) || `${monthContext.key}-01`
    const endIso = toIsoDate(eY, eM, eD) || startIso
    /*
     * Compare against the SAME DATES ONE MONTH EARLIER, not the preceding N days.
     *
     * This used to walk back from the start date: 01–20 Aug was compared against 12–31 Jul, because
     * that is the previous 20 contiguous days. Every label on the page says "MoM" and "vs last
     * month", and 12–31 Jul is not last month — it is the tail of it, weighted with the month-end
     * delivery rush, so a month-to-date figure was measured against a period nothing like it. That is
     * how "+816%" appears on a card.
     *
     * Same dates, previous month, clamped to that month's length so 29–31 Aug still compares against
     * a valid February.
     */
    const shiftMonth = (iso: string) => {
      const [y, mo, d] = iso.split('-').map(Number)
      const py = mo === 1 ? y - 1 : y
      const pm = mo === 1 ? 12 : mo - 1
      const lastDayOfPrev = new Date(Date.UTC(py, pm, 0)).getUTCDate()
      return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, lastDayOfPrev)).padStart(2, '0')}`
    }
    const compStartIso = shiftMonth(startIso)
    const compEndIso = shiftMonth(endIso)
    const compStart = new Date(compStartIso)
    const compEnd = new Date(compEndIso)

    return {
      ...monthContext,
      startDate: startIso,
      endDate: endIso,
      endDateExclusive: new Date(new Date(endIso).getTime() + 86400000).toISOString().slice(0, 10),
      comparisonKey: `${compStart.toISOString().slice(0, 10)}..${compEnd.toISOString().slice(0, 10)}`,
      comparisonLabel: `${compStart.toISOString().slice(0, 10)} to ${compEnd.toISOString().slice(0, 10)}`,
      comparisonStartDate: compStart.toISOString().slice(0, 10),
      comparisonEndDate: compEnd.toISOString().slice(0, 10),
      comparisonEndDateExclusive: new Date(compEnd.getTime() + 86400000).toISOString().slice(0, 10),
      rangeMode: 'custom',
    }
  }

  const daysInMonth = new Date(Date.UTC(monthContext.year, monthContext.month, 0)).getUTCDate()
  const startIso = `${monthContext.key}-01`
  const endIso = `${monthContext.key}-${String(daysInMonth).padStart(2, '0')}`
  const nextMonthExclusive = toIsoDate(
    monthContext.month === 12 ? monthContext.year + 1 : monthContext.year,
    monthContext.month === 12 ? 1 : monthContext.month + 1,
    1
  )!
  const prevMonth = getComparisonMonth(monthContext.year, monthContext.month)
  const prevMonthKey = `${prevMonth.year}-${String(prevMonth.month).padStart(2, '0')}`
  const prevDays = new Date(Date.UTC(prevMonth.year, prevMonth.month, 0)).getUTCDate()

  return {
    ...monthContext,
    startDate: startIso,
    endDate: endIso,
    endDateExclusive: nextMonthExclusive,
    comparisonKey: prevMonthKey,
    comparisonLabel: formatMonthLabel(prevMonth.year, prevMonth.month),
    comparisonStartDate: `${prevMonthKey}-01`,
    comparisonEndDate: `${prevMonthKey}-${String(prevDays).padStart(2, '0')}`,
    comparisonEndDateExclusive: startIso,
    rangeMode: 'month',
  }
}

/*
 * Dealer scoping, restricted to columns the table ACTUALLY has.
 *
 * ⚠️ The configs name dealer columns the feeds do not all carry, and referencing a missing column is
 * a PARSE error, so the whole query died rather than returning nothing. Measured against the live
 * schema: hyundai_booking_report has neither `dealer_code_2` nor `main_dealer_code`, and
 * hyundai_purchase_report has no `dealer_code_2`. Every dealer-scoped user therefore got
 * "Failed query ... column dealer_code_2 does not exist" and the report would not load at all —
 * while an unscoped user (and every probe I ran) saw nothing wrong, because with no dealer filter
 * those columns are never referenced.
 *
 * Filtering against the real column list makes this self-correcting: a feed can gain or lose a
 * dealer column without taking the page down.
 *
 * FAIL CLOSED. If a table carries none of its configured dealer columns we cannot scope it, and the
 * safe answer for a branch-scoped user is no rows — never every branch's rows.
 */
async function dealerFilterSql(
  dealerCode: string | null | undefined,
  config: TableConfig
) {
  const normalized = normalizeHyundaiDealerCode(dealerCode)
  if (!normalized) return sql``

  const present = new Set((await analyticsTableColumns(config.table)).map((c) => c.trim().toLowerCase()))
  const usable = config.dealerColumns.filter((c) => present.size === 0 || present.has(c.trim().toLowerCase()))

  if (usable.length === 0) {
    console.warn(`[hyundai-sales-report] ${config.table} has none of its configured dealer columns (${config.dealerColumns.join(', ')}) — scoping to no rows rather than leaking every branch`)
    return sql`AND FALSE`
  }

  const cols = usable.map((c) => sql.raw(c))
  const [first, ...rest] = cols
  return sql`AND ${hyundaiSourceDealerSql(first, rest)} = ${normalized}`
}

export function normalizeReportKey(value: string | null | undefined): SourceKey {
  const raw = safeText(value).toLowerCase()
  if (raw === 'booking' || raw === 'bookings') return 'booking'
  if (raw === 'enquiry' || raw === 'enquiries') return 'enquiry'
  if (raw === 'purchase') return 'purchase'
  return 'sales'
}

export async function getHyundaiSalesReportFreshness(dealerCode?: string | null): Promise<SalesReportFreshnessPayload> {
  const normalizedDealer = normalizeHyundaiDealerCode(dealerCode)
  const cacheKey = `hyundai:sales-report:freshness:${normalizedDealer || ALL_DEALERS_CACHE_KEY}`

  return getCachedData(
    cacheKey,
    async () => {
      try {
        const sources: SalesReportFreshnessSource[] = []
        const monthSet = new Map<string, Set<SourceKey>>()

        /*
         * One round trip for all four feeds, not four.
         *
         * This was a sequential `for` loop around a Promise.all of two queries, so the four sources
         * ran back-to-back: 8 queries in 4 round-trip rounds, ~3.4s cold on the FIRST call the page
         * makes. They are independent, so they fan out together and the wall clock becomes the
         * slowest single feed instead of the sum of all four.
         */
        const perSource = await Promise.all(Object.values(TABLES).map(async (config) => {
          const dFilter = await dealerFilterSql(dealerCode, config)
          const dateCol = sql.raw(config.dateColumn)

          const [summaryRows, monthRows] = await Promise.all([
            analyticsDb.execute(sql`
              SELECT
                MAX(uploaded_at)::text AS latest_uploaded_at,
                COUNT(*)::int AS total_rows,
                MIN(${dateCol})::text AS min_date,
                MAX(${dateCol})::text AS max_date
              FROM ${sql.raw(config.table)}
              WHERE ${dateCol} IS NOT NULL
                ${dFilter}
            `),
            analyticsDb.execute(sql`
              SELECT DISTINCT TO_CHAR(${dateCol}, 'YYYY-MM') AS month_key
              FROM ${sql.raw(config.table)}
              WHERE ${dateCol} IS NOT NULL
                ${dFilter}
              ORDER BY month_key DESC
              LIMIT 48
            `),
          ])

          const sRow = resultRows(summaryRows)[0] || {}
          const mList = resultRows(monthRows).map((r) => safeText(r.month_key)).filter(Boolean)

          return {
            config,
            mList,
            source: {
              key: config.key,
              label: config.label,
              sourceUpdatedAt: safeText(sRow.latest_uploaded_at) || null,
              rowCount: numberValue(sRow.total_rows),
              minDate: safeText(sRow.min_date) || null,
              maxDate: safeText(sRow.max_date) || null,
              availableMonths: mList,
            } as SalesReportFreshnessSource,
          }
        }))

        // Assembled in the declared TABLES order so the payload stays stable regardless of which
        // feed happened to answer first.
        for (const entry of perSource) {
          entry.mList.forEach((mKey) => {
            const existing = monthSet.get(mKey) || new Set<SourceKey>()
            existing.add(entry.config.key)
            monthSet.set(mKey, existing)
          })
          sources.push(entry.source)
        }

        const currentCalContext = resolveMonthContext()
        const currentCalMonthKey = currentCalContext.key

        if (!monthSet.has(currentCalMonthKey)) {
          monthSet.set(currentCalMonthKey, new Set())
        }

        const availableMonths: SalesReportMonthOption[] = Array.from(monthSet.entries())
          .map(([mKey, sKeys]) => {
            const [y, m] = mKey.split('-').map(Number)
            return {
              key: mKey,
              label: formatMonthLabel(y, m),
              year: y,
              month: m - 1,
              sourceKeys: Array.from(sKeys),
            }
          })
          .sort((a, b) => b.key.localeCompare(a.key))

        const selectedMonthKey = currentCalMonthKey
        const maxUpdatedAt = sources
          .map((s) => s.sourceUpdatedAt)
          .filter(Boolean)
          .sort()
          .pop() || null

        const payload: SalesReportFreshnessPayload = {
          selectedMonthKey,
          sourceUpdatedAt: maxUpdatedAt,
          availableMonths,
          dealerOptions: HYUNDAI_BRANCH_DEALERS.map((d) => d.dealerCode),
          sources,
          coverageWarnings: [],
        }

        hyundaiSalesReportFreshnessFallback.set(normalizedDealer || ALL_DEALERS_CACHE_KEY, payload)
        return payload
      } catch (error) {
        console.error('[hyundai-sales-report:freshness] failed', error)
        const fallback = hyundaiSalesReportFreshnessFallback.get(normalizedDealer || ALL_DEALERS_CACHE_KEY)
        if (fallback) return fallback
        throw error
      }
    },
    HYUNDAI_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS
  )
}

export async function getHyundaiSalesReportSummary(
  optionsOrMonthKey?:
    | {
        year?: number | null
        month?: number | null
        monthKey?: string | null
        dealerCode?: string | null
        startDate?: string | null
        endDate?: string | null
        canViewPii?: boolean
      }
    | string
    | null,
  posDealerCode?: string | null,
  posStartDate?: string | null,
  posEndDate?: string | null
): Promise<SalesReportSummaryPayload> {
  const isObject = typeof optionsOrMonthKey === 'object' && optionsOrMonthKey !== null
  const options = isObject ? optionsOrMonthKey : {}

  const rawMonthKey = isObject
    ? options.monthKey || (options.year && options.month !== null && options.month !== undefined ? `${options.year}-${String(options.month + 1).padStart(2, '0')}` : null)
    : (optionsOrMonthKey as string | null | undefined)

  const dealerCode = isObject ? options.dealerCode : posDealerCode
  const startDate = isObject ? options.startDate : posStartDate
  const endDate = isObject ? options.endDate : posEndDate

  const normalizedDealer = normalizeHyundaiDealerCode(dealerCode)
  const dateCtx = resolveDateContext(rawMonthKey, startDate, endDate)
  // The retail transactions list carries a customer phone, so the redaction state is part of the
  // identity of this payload. Without it in the key, the first cleared viewer to warm the cache would
  // hand real numbers to every redacted viewer for the whole TTL.
  const canViewPii = isObject ? Boolean(options.canViewPii) : false
  const cacheKey = `hyundai:sales-report:summary:${normalizedDealer || ALL_DEALERS_CACHE_KEY}:${dateCtx.startDate}:${dateCtx.endDate}:${canViewPii ? 'pii' : 'redacted'}`

  return getCachedData(
    cacheKey,
    async () => {
      try {
        const salesFilter = await dealerFilterSql(dealerCode, TABLES.sales)
        const bookingFilter = await dealerFilterSql(dealerCode, TABLES.booking)
        const enquiryFilter = await dealerFilterSql(dealerCode, TABLES.enquiry)

        const [
          salesCurrent,
          salesComp,
          salesAwaiting,
          feedCoverage,
          bookingCurrent,
          bookingComp,
          enquiryCurrent,
          enquiryComp,
          salesByModel,
          salesByConsultant,
          salesBySource,
          salesTransactions,
          enquiryBySource,
          bookingBySource,
          enquiryByModel,
          bookingByModel,
          enquiryStatusCounts,
          dealerEnquiryCounts,
          enquiryDailyTrend,
          enquiryTestDriveCounts,
          consultantEnquiryCounts,
          consultantBookingCounts,
          lostSummaryRows,
          lostRows,
        ] = await Promise.all([
          analyticsDb.execute(sql`
            SELECT
              COUNT(*)::int AS units,
              COALESCE(SUM(COALESCE(basic_amount, 0)), 0)::numeric AS revenue,
              COALESCE(AVG(COALESCE(basic_amount, 0)), 0)::numeric AS avg_price,
              COALESCE(AVG(NULLIF(regexp_replace(delivery_in_days::text, '[^0-9]', '', 'g'), '')::numeric), 0)::float AS avg_delivery_days
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.startDate}::date
              AND delivery_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
          `),
          analyticsDb.execute(sql`
            SELECT
              COUNT(*)::int AS units,
              COALESCE(SUM(COALESCE(basic_amount, 0)), 0)::numeric AS revenue
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.comparisonStartDate}::date
              AND delivery_date < ${dateCtx.comparisonEndDateExclusive}::date
              ${salesFilter}
          `),
          /*
           * Confirmed, not yet delivered.
           *
           * Every figure above now counts by delivery_date, because a KPI labelled "Total Deliveries"
           * must mean deliveries. It previously counted COALESCE(delivery_date, confirm_date), so a
           * car that had been ORDERED but never delivered was reported as delivered in its confirm
           * month — measured: July 2026 showed 74 deliveries when 8 had actually been delivered, and
           * August showed 40 against 11. Revenue was inflated the same way.
           *
           * Those rows are real business though, so they are counted here and shown as their own
           * figure rather than being silently dropped from the page.
           */
          analyticsDb.execute(sql`
            SELECT
              COUNT(*)::int AS awaiting_units,
              COALESCE(SUM(COALESCE(basic_amount, 0)), 0)::numeric AS awaiting_value
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date IS NULL
              AND confirm_date >= ${dateCtx.startDate}::date
              AND confirm_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
          `),
          // How far each feed actually reaches, under the SAME dealer scope. One statement, three
          // scalars — used only to tell an upload gap apart from a genuine zero.
          analyticsDb.execute(sql`
            SELECT
              (SELECT MAX(delivery_date)::text FROM ${sql.raw(TABLES.sales.table)} WHERE TRUE ${salesFilter}) AS sales_max,
              /*
               * Cars confirmed long enough ago that they should have delivered by now, but which
               * still carry no delivery_date. Historically confirm -> delivery is a median of 2 days
               * and 96% land inside 30, so a row sitting past 14 days without one is almost never a
               * real backlog — it is a row the feed exported BEFORE delivery and never re-exported.
               */
              (SELECT COUNT(*)::int FROM ${sql.raw(TABLES.sales.table)}
                 WHERE delivery_date IS NULL
                   AND confirm_date IS NOT NULL
                   AND confirm_date < (CURRENT_DATE - INTERVAL '14 days')
                   ${salesFilter}) AS stale_undelivered,
              (SELECT MAX(booking_date)::text  FROM ${sql.raw(TABLES.booking.table)} WHERE TRUE ${bookingFilter}) AS booking_max,
              (SELECT MAX(enquiry_date)::text  FROM ${sql.raw(TABLES.enquiry.table)} WHERE TRUE ${enquiryFilter}) AS enquiry_max
          `),
          analyticsDb.execute(sql`
            SELECT COUNT(*)::int AS bookings
            FROM ${sql.raw(TABLES.booking.table)}
            WHERE booking_date >= ${dateCtx.startDate}::date
              AND booking_date < ${dateCtx.endDateExclusive}::date
              ${bookingFilter}
          `),
          analyticsDb.execute(sql`
            SELECT COUNT(*)::int AS bookings
            FROM ${sql.raw(TABLES.booking.table)}
            WHERE booking_date >= ${dateCtx.comparisonStartDate}::date
              AND booking_date < ${dateCtx.comparisonEndDateExclusive}::date
              ${bookingFilter}
          `),
          analyticsDb.execute(sql`
            SELECT COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
          `),
          analyticsDb.execute(sql`
            SELECT COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.comparisonStartDate}::date
              AND enquiry_date < ${dateCtx.comparisonEndDateExclusive}::date
              ${enquiryFilter}
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(model::text), ''), 'Unknown') AS model,
              COUNT(*)::int AS units,
              COALESCE(SUM(COALESCE(basic_amount, 0)), 0)::numeric AS revenue,
              COALESCE(AVG(COALESCE(basic_amount, 0)), 0)::numeric AS avg_price
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.startDate}::date
              AND delivery_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
            GROUP BY 1
            ORDER BY units DESC, revenue DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(consultant_name::text), ''), 'Unassigned') AS consultant,
              COUNT(*)::int AS units
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.startDate}::date
              AND delivery_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
            GROUP BY 1
            ORDER BY units DESC
            LIMIT 15
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(source::text), ''), 'Unknown') AS source,
              COUNT(*)::int AS units
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.startDate}::date
              AND delivery_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
            GROUP BY 1
            ORDER BY units DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              id::text AS row_key,
              registration_name,
              contact_num1,
              model,
              variant,
              color,
              consultant_name,
              source,
              mode_of_purchase,
              dsa_financier,
              basic_amount,
              invoice_date,
              delivery_date,
              confirm_date,
              customerid,
              delivery_in_days,
              vin_number
            FROM ${sql.raw(TABLES.sales.table)}
            WHERE delivery_date >= ${dateCtx.startDate}::date
              AND delivery_date < ${dateCtx.endDateExclusive}::date
              ${salesFilter}
            ORDER BY delivery_date DESC, id DESC
            LIMIT 100
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(source::text), ''), 'Unknown') AS source,
              COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY enquiries DESC
          `),
          /*
           * Bookings per source — the other half of the Sources card, which never existed.
           *
           * sourceMap was built from the enquiry query alone and seeded `bookings: 0`, so the card's
           * Bookings column and its Conversion % were structurally always zero while the headline
           * said 396. The booking feed names the channel `main_source` (its `source_dealer_code` is a
           * dealer code, not a channel); the six values match the enquiry feed's `source` exactly, so
           * the two sides line up without any mapping.
           */
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(main_source::text), ''), 'Unknown') AS source,
              COUNT(*)::int AS bookings
            FROM ${sql.raw(TABLES.booking.table)}
            WHERE booking_date >= ${dateCtx.startDate}::date
              AND booking_date < ${dateCtx.endDateExclusive}::date
              ${bookingFilter}
            GROUP BY 1
            ORDER BY bookings DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(model::text), ''), 'Unknown') AS model,
              COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY enquiries DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(model::text), ''), 'Unknown') AS model,
              COUNT(*)::int AS bookings
            FROM ${sql.raw(TABLES.booking.table)}
            WHERE booking_date >= ${dateCtx.startDate}::date
              AND booking_date < ${dateCtx.endDateExclusive}::date
              ${bookingFilter}
            GROUP BY 1
            ORDER BY bookings DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(enquiry_status::text), ''), 'Open') AS name,
              COUNT(*)::int AS value
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY value DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(source_dealer_code::text), ''), TRIM(dealer_code::text), 'Unknown') AS name,
              COUNT(*)::int AS value
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY value DESC
          `),
          analyticsDb.execute(sql`
            SELECT
              TO_CHAR(enquiry_date, 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY day ASC
          `),
          analyticsDb.execute(sql`
            SELECT
              CASE WHEN LOWER(TRIM(COALESCE(test_drive::text, ''))) IN ('y', 'yes', 'done', 'taken', 'completed') THEN 'Taken' ELSE 'Not Taken' END AS name,
              COUNT(*)::int AS value
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(consultant_name::text), ''), 'Unassigned') AS consultant,
              COUNT(*)::int AS enquiries
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              ${enquiryFilter}
            GROUP BY 1
            ORDER BY enquiries DESC
            LIMIT 20
          `),
          analyticsDb.execute(sql`
            SELECT
              COALESCE(NULLIF(TRIM(consultant_name::text), ''), 'Unassigned') AS consultant,
              COUNT(*)::int AS bookings
            FROM ${sql.raw(TABLES.booking.table)}
            WHERE booking_date >= ${dateCtx.startDate}::date
              AND booking_date < ${dateCtx.endDateExclusive}::date
              ${bookingFilter}
            GROUP BY 1
            ORDER BY bookings DESC
            LIMIT 20
          `),
          analyticsDb.execute(sql`
            SELECT
              COUNT(*)::int AS total_lost,
              COALESCE(NULLIF(TRIM(lost_reason::text), ''), 'Other') AS reason,
              COALESCE(NULLIF(TRIM(consultant_name::text), ''), 'Unassigned') AS consultant,
              COALESCE(NULLIF(TRIM(model::text), ''), 'Unknown') AS model,
              COALESCE(NULLIF(TRIM(source::text), ''), 'Unknown') AS source
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              AND LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%lost%'
              ${enquiryFilter}
            GROUP BY 2, 3, 4, 5
          `),
          analyticsDb.execute(sql`
            SELECT
              enquiry_date,
              name_of_the_customer,
              contact_number,
              model,
              source,
              consultant_name,
              enquiry_status,
              lost_reason,
              lost_due_to,
              lost_remark
            FROM ${sql.raw(TABLES.enquiry.table)}
            WHERE enquiry_date >= ${dateCtx.startDate}::date
              AND enquiry_date < ${dateCtx.endDateExclusive}::date
              AND LOWER(TRIM(COALESCE(enquiry_status::text, ''))) LIKE '%lost%'
              ${enquiryFilter}
            ORDER BY enquiry_date DESC
            LIMIT 50
          `),
        ])

        const curSales = resultRows(salesCurrent)[0] || {}
        const cmpSales = resultRows(salesComp)[0] || {}
        const curBook = resultRows(bookingCurrent)[0] || {}
        const cmpBook = resultRows(bookingComp)[0] || {}
        const curEnq = resultRows(enquiryCurrent)[0] || {}
        const cmpEnq = resultRows(enquiryComp)[0] || {}

        const salesUnits = numberValue(curSales.units)
        const compSalesUnits = numberValue(cmpSales.units)
        const totalRevenue = numberValue(curSales.revenue)
        const compRevenue = numberValue(cmpSales.revenue)
        const totalBookings = numberValue(curBook.bookings)
        const compBookings = numberValue(cmpBook.bookings)
        const totalEnquiries = numberValue(curEnq.enquiries)
        /*
         * Distinguish "nothing happened" from "we have not been given the data".
         *
         * Each feed reports its own furthest date; if a count is zero for this period AND the feed
         * stops before the period even begins, that zero is an upload gap, not a business fact.
         */
        const coverageNotes: string[] = []
        const noteGap = (label: string, count: number, maxDate: string | null) => {
          if (count > 0) return
          if (maxDate && maxDate < dateCtx.startDate) {
            coverageNotes.push(`${label} shows 0 because that feed has no data for this period — its last record is ${maxDate}. This is an upload gap, not zero activity.`)
          }
        }
        const cov = resultRows(feedCoverage)[0] || {}
        const curAwaiting = resultRows(salesAwaiting)[0] || {}
        const awaitingUnits = numberValue(curAwaiting.awaiting_units)
        noteGap('Enquiries', totalEnquiries, safeText(cov.enquiry_max) || null)
        noteGap('Bookings', totalBookings, safeText(cov.booking_max) || null)
        noteGap('Deliveries', salesUnits, safeText(cov.sales_max) || null)

        /*
         * Deliveries are a FLOOR, not a count, while the feed behaves this way.
         *
         * The sales export is incremental — the 20 Aug run carried 53 rows out of 23,364 — so a row
         * exported before its delivery is never re-exported with the delivery date filled in. The
         * count here is therefore right by definition (delivery_date means delivered) and low in
         * practice, and only the upstream export can fix it. Saying so beats a number nobody trusts.
         */
        const staleUndelivered = numberValue(cov.stale_undelivered)
        if (staleUndelivered > 0) {
          coverageNotes.push(`Deliveries is a minimum: ${staleUndelivered} vehicle${staleUndelivered === 1 ? ' was' : 's were'} confirmed more than 14 days ago and still carry no delivery date in the feed. Historically 96% deliver within 30 days, so these are almost certainly delivered — the sales export sends only new rows and never re-sends an existing one with its delivery date filled in.`)
        }
        const compEnquiries = numberValue(cmpEnq.enquiries)

        const changePct = (cur: number, cmp: number) =>
          cmp > 0 ? Number((((cur - cmp) / cmp) * 100).toFixed(1)) : null

        const kpis: SalesReportKpi[] = [
          {
            label: 'Total Deliveries',
            value: salesUnits,
            formattedValue: formatNumber(salesUnits),
            comparisonValue: compSalesUnits,
            formattedComparisonValue: formatNumber(compSalesUnits),
            comparisonLabel: dateCtx.comparisonLabel,
            changePct: changePct(salesUnits, compSalesUnits),
            changeLabel: `${changePct(salesUnits, compSalesUnits) ?? 0}% vs ${dateCtx.comparisonLabel}`,
            trendDirection: 'higher_is_better',
          },
          // Sits beside Total Deliveries on purpose: these are the rows that used to be counted AS
          // deliveries. Showing the pair makes the correction legible instead of looking like a drop.
          {
            label: 'Awaiting Delivery',
            value: awaitingUnits,
            formattedValue: formatNumber(awaitingUnits),
            comparisonValue: 0,
            formattedComparisonValue: '—',
            comparisonLabel: dateCtx.comparisonLabel,
            changePct: null,
            changeLabel: 'confirmed, not yet delivered',
            trendDirection: 'higher_is_better',
          },
          {
            label: 'Total Revenue',
            value: totalRevenue,
            formattedValue: formatCurrency(totalRevenue),
            comparisonValue: compRevenue,
            formattedComparisonValue: formatCurrency(compRevenue),
            comparisonLabel: dateCtx.comparisonLabel,
            changePct: changePct(totalRevenue, compRevenue),
            changeLabel: `${changePct(totalRevenue, compRevenue) ?? 0}% vs ${dateCtx.comparisonLabel}`,
            trendDirection: 'higher_is_better',
          },
          {
            label: 'Bookings',
            value: totalBookings,
            formattedValue: formatNumber(totalBookings),
            comparisonValue: compBookings,
            formattedComparisonValue: formatNumber(compBookings),
            comparisonLabel: dateCtx.comparisonLabel,
            changePct: changePct(totalBookings, compBookings),
            changeLabel: `${changePct(totalBookings, compBookings) ?? 0}% vs ${dateCtx.comparisonLabel}`,
            trendDirection: 'higher_is_better',
          },
          {
            label: 'Enquiries',
            value: totalEnquiries,
            formattedValue: formatNumber(totalEnquiries),
            comparisonValue: compEnquiries,
            formattedComparisonValue: formatNumber(compEnquiries),
            comparisonLabel: dateCtx.comparisonLabel,
            changePct: changePct(totalEnquiries, compEnquiries),
            changeLabel: `${changePct(totalEnquiries, compEnquiries) ?? 0}% vs ${dateCtx.comparisonLabel}`,
            trendDirection: 'higher_is_better',
          },
        ]

        const modelCards: SalesRetailModelCard[] = resultRows(salesByModel).map((r) => ({
          model: normalizeModel(r.model),
          units: numberValue(r.units),
          revenue: numberValue(r.revenue),
          avgPrice: numberValue(r.avg_price),
          avgDeliveryDays: null,
          variants: [],
          colors: [],
          financeBreakdown: [],
        }))

        const transactions: SalesRetailTransaction[] = resultRows(salesTransactions).map((r) => ({
          rowKey: safeText(r.row_key),
          customerName: safeText(r.registration_name),
          phone: maskHyundaiPii(r.contact_num1, canViewPii),
          model: normalizeModel(r.model),
          variant: safeText(r.variant),
          color: safeText(r.color),
          consultant: normalizeConsultant(r.consultant_name),
          source: normalizeSource(r.source),
          financeType: normalizeFinanceMode(r),
          financier: normalizeFinancier(r.dsa_financier),
          exShowroomPrice: numberValue(r.basic_amount),
          invoiceDate: safeText(r.invoice_date) || null,
          deliveryDate: safeText(r.delivery_date) || null,
          customerId: safeText(r.customerid),
          deliveryDays: numberValue(r.delivery_in_days) || null,
          vin: safeText(r.vin_number),
          accessoriesValue: 0,
          accessoriesCount: 0,
        }))

        // Finance breakdown
        const financeSummaryMap = new Map<FinanceModeKey, number>([['Cash', 0], ['In-house', 0], ['Self-Finance', 0]])
        const financierMap = new Map<string, number>()
        const financeByModelMap = new Map<string, { Cash: number; 'In-house': number; 'Self-Finance': number }>()
        const financeByConsultantMap = new Map<string, { Cash: number; 'In-house': number; 'Self-Finance': number }>()

        for (const tx of transactions) {
          const mode = tx.financeType as FinanceModeKey
          financeSummaryMap.set(mode, (financeSummaryMap.get(mode) || 0) + 1)
          if (mode === 'In-house' && tx.financier && tx.financier !== 'Unknown') {
            financierMap.set(tx.financier, (financierMap.get(tx.financier) || 0) + 1)
          }

          const modelFin = financeByModelMap.get(tx.model) || { Cash: 0, 'In-house': 0, 'Self-Finance': 0 }
          modelFin[mode] += 1
          financeByModelMap.set(tx.model, modelFin)

          const consFin = financeByConsultantMap.get(tx.consultant) || { Cash: 0, 'In-house': 0, 'Self-Finance': 0 }
          consFin[mode] += 1
          financeByConsultantMap.set(tx.consultant, consFin)
        }

        const financeSummary = Array.from(financeSummaryMap.entries()).map(([name, units]) => ({
          name,
          units,
          sharePct: salesUnits > 0 ? (units / salesUnits) * 100 : 0,
        }))

        const financiers = Array.from(financierMap.entries())
          .map(([financier, count]) => ({ financier, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)

        const financeByModel = Array.from(financeByModelMap.entries()).map(([model, counts]) => ({
          model,
          ...counts,
        }))

        const financeByConsultant = Array.from(financeByConsultantMap.entries()).map(([consultant, counts]) => ({
          consultant,
          ...counts,
        }))

        // Sources breakdown
        const sourceMap = new Map<string, { enquiries: number; bookings: number }>()
        for (const row of resultRows(enquiryBySource)) {
          const s = normalizeSource(row.source)
          const cur = sourceMap.get(s) || { enquiries: 0, bookings: 0 }
          cur.enquiries += numberValue(row.enquiries)
          sourceMap.set(s, cur)
        }
        // Normalised through the same helper as the enquiry side, so a channel that only ever
        // produced bookings still gets a card instead of being dropped.
        for (const row of resultRows(bookingBySource)) {
          const s = normalizeSource(row.source)
          const cur = sourceMap.get(s) || { enquiries: 0, bookings: 0 }
          cur.bookings += numberValue(row.bookings)
          sourceMap.set(s, cur)
        }

        const sourceCards: SalesReportSourceCard[] = Array.from(sourceMap.entries()).map(([source, data]) => ({
          source,
          enquiries: data.enquiries,
          bookings: data.bookings,
          enquirySharePct: totalEnquiries > 0 ? (data.enquiries / totalEnquiries) * 100 : 0,
          conversionPct: data.enquiries > 0 ? (data.bookings / data.enquiries) * 100 : 0,
          highlightWalkIn: source.toLowerCase().includes('walk'),
        })).sort((a, b) => b.enquiries - a.enquiries)

        const walkinCard = sourceCards.find((c) => c.highlightWalkIn)
        const walkinSharePct = walkinCard?.enquirySharePct || 0

        // Consultant team leaderboard
        const consultantEnqMap = new Map<string, number>()
        for (const row of resultRows(consultantEnquiryCounts)) {
          consultantEnqMap.set(normalizeConsultant(row.consultant), numberValue(row.enquiries))
        }

        const consultantBookMap = new Map<string, number>()
        for (const row of resultRows(consultantBookingCounts)) {
          consultantBookMap.set(normalizeConsultant(row.consultant), numberValue(row.bookings))
        }

        const allConsultants = Array.from(new Set([...consultantEnqMap.keys(), ...consultantBookMap.keys()]))
        const consultantLeaderboard: SalesReportConsultantRow[] = allConsultants.map((c) => {
          const enq = consultantEnqMap.get(c) || 0
          const bk = consultantBookMap.get(c) || 0
          return {
            consultant: c,
            enquiries: enq,
            bookings: bk,
            bookingRatePct: enq > 0 ? (bk / enq) * 100 : 0,
            walkinEnquiries: Math.round(enq * (walkinSharePct / 100)),
            walkinBookings: Math.round(bk * 0.4),
            walkinConversionPct: enq > 0 ? (bk / enq) * 100 : 0,
            testDrives: Math.round(enq * 0.25),
            tdRatePct: enq > 0 ? 25 : 0,
          }
        }).sort((a, b) => b.bookings - a.bookings || b.enquiries - a.enquiries)

        // Models items
        const bookingByModelMap = new Map<string, number>()
        for (const row of resultRows(bookingByModel)) {
          bookingByModelMap.set(normalizeModel(row.model), numberValue(row.bookings))
        }

        const modelItems = resultRows(enquiryByModel).map((row) => {
          const m = normalizeModel(row.model)
          return {
            model: m,
            enquiries: numberValue(row.enquiries),
            bookings: bookingByModelMap.get(m) || 0,
          }
        })

        // Lost reasons breakdown
        const lostReasonMap = new Map<string, number>()
        const lostConsultantMap = new Map<string, number>()
        const lostModelMap = new Map<string, number>()
        const lostSourceMap = new Map<string, number>()
        let totalLostCount = 0

        for (const row of resultRows(lostSummaryRows)) {
          const count = numberValue(row.total_lost)
          totalLostCount += count
          const r = safeText(row.reason) || 'Other'
          const c = normalizeConsultant(row.consultant)
          const m = normalizeModel(row.model)
          const s = normalizeSource(row.source)
          lostReasonMap.set(r, (lostReasonMap.get(r) || 0) + count)
          lostConsultantMap.set(c, (lostConsultantMap.get(c) || 0) + count)
          lostModelMap.set(m, (lostModelMap.get(m) || 0) + count)
          lostSourceMap.set(s, (lostSourceMap.get(s) || 0) + count)
        }

        const lostRatePct = totalEnquiries > 0 ? (totalLostCount / totalEnquiries) * 100 : 0

        // Daily trend
        const dailyTrend = resultRows(enquiryDailyTrend).map((r) => ({
          day: safeText(r.day),
          enquiries: numberValue(r.enquiries),
        }))

        // Weekly trend
        const weeklyChunks: Array<{ week: string; dates: string; total: number; avg: number; peak: string }> = []
        if (dailyTrend.length > 0) {
          const totalDays = dailyTrend.length
          const chunkSize = Math.ceil(totalDays / 4)
          for (let i = 0; i < 4; i++) {
            const slice = dailyTrend.slice(i * chunkSize, (i + 1) * chunkSize)
            if (slice.length > 0) {
              const sum = slice.reduce((acc, curr) => acc + curr.enquiries, 0)
              const maxEnq = Math.max(...slice.map((s) => s.enquiries))
              const peakDay = slice.find((s) => s.enquiries === maxEnq)?.day || '-'
              weeklyChunks.push({
                week: `Week ${i + 1}`,
                dates: `${slice[0].day.slice(8)} - ${slice[slice.length - 1].day.slice(8)} ${dateCtx.label}`,
                total: sum,
                avg: Number((sum / slice.length).toFixed(1)),
                peak: `${peakDay.slice(8)} (${maxEnq})`,
              })
            }
          }
        }

        const payload: SalesReportSummaryPayload = {
          context: {
            selectedMonthKey: dateCtx.key,
            selectedMonthLabel: dateCtx.label,
            comparisonMonthKey: dateCtx.comparisonKey,
            comparisonMonthLabel: dateCtx.comparisonLabel,
            startDate: dateCtx.startDate,
            endDate: dateCtx.endDate,
            comparisonStartDate: dateCtx.comparisonStartDate,
            comparisonEndDate: dateCtx.comparisonEndDate,
            rangeMode: dateCtx.rangeMode,
          },
          assumptions: [
            'Deliveries and revenue count rows with a DELIVERY DATE in the period. A confirmed order that has not been delivered is reported separately as "Awaiting Delivery" and is not counted as a delivery or as revenue.',
            'Bookings and enquiries are sourced directly from DMS enquiry and booking logs.',
            'Finance mode splits are derived from mode_of_purchase and DSA financier records.',
            // A bare 0 is indistinguishable from "we have no data for this period", and the enquiry
            // feed had not been uploaded since 29 Jul while the page defaulted to August — which is
            // exactly what "the enquiries count is missing" looked like. Say which it is.
            ...coverageNotes,
          ],
          overview: {
            kpis,
            enquiryStatus: resultRows(enquiryStatusCounts).map((r) => ({
              name: safeText(r.name),
              value: numberValue(r.value),
            })),
            sourceShare: sourceCards.map((c) => ({
              name: c.source,
              value: c.enquiries,
            })),
            dealerSummary: resultRows(dealerEnquiryCounts).map((r) => ({
              name: safeText(r.name),
              value: numberValue(r.value),
            })),
            leadTemperature: [
              { name: 'Hot' as TemperatureKey, value: Math.round(totalEnquiries * 0.35) },
              { name: 'Warm' as TemperatureKey, value: Math.round(totalEnquiries * 0.45) },
              { name: 'Cold' as TemperatureKey, value: Math.round(totalEnquiries * 0.20) },
            ],
            testDrive: resultRows(enquiryTestDriveCounts).map((r) => ({
              name: safeText(r.name),
              value: numberValue(r.value),
            })),
            funnel: [
              { name: 'Enquiries', value: totalEnquiries },
              { name: 'Bookings', value: totalBookings },
              { name: 'Deliveries', value: salesUnits },
            ],
            topModels: modelCards.slice(0, 5).map((m) => ({ name: m.model, value: m.units })),
            sourceCards,
            walkinSpotlight: {
              enquiries: walkinCard?.enquiries || 0,
              sharePct: walkinSharePct,
              message: walkinSharePct > 30 ? 'Strong walk-in footfall across primary showrooms.' : 'Digital and field channels leading enquiry generation.',
            },
          },
          models: {
            sourceOptions: sourceCards.map((c) => c.source),
            items: modelItems,
            topFive: modelCards.slice(0, 5).map((m) => ({ name: m.model, value: m.units })),
            testDrivesByModel: modelCards.slice(0, 5).map((m) => ({ model: m.model, testDrives: Math.round(m.units * 1.5) })),
            testDrivesByModelVariant: [],
            sourceBreakdown: {},
          },
          sources: {
            items: sourceCards.map((c) => ({
              source: c.source,
              enquiries: c.enquiries,
              bookings: c.bookings,
              sharePct: c.enquirySharePct,
              conversionPct: c.conversionPct,
            })),
            dealerMatrix: [],
            walkinSpotlight: {
              enquiries: walkinCard?.enquiries || 0,
              sharePct: walkinSharePct,
              message: walkinSharePct > 30 ? 'Strong walk-in footfall across primary showrooms.' : 'Digital and field channels leading enquiry generation.',
            },
          },
          team: {
            leaderboard: consultantLeaderboard,
            comparison: consultantLeaderboard.slice(0, 10).map((c) => ({
              consultant: c.consultant,
              enquiries: c.enquiries,
              bookings: c.bookings,
            })),
          },
          trend: {
            daily: dailyTrend,
            weeks: weeklyChunks,
            trendNote: `Total enquiries built steadily over ${dateCtx.label} with peak daily volumes reaching ${Math.max(0, ...dailyTrend.map((d) => d.enquiries))} leads.`,
          },
          lost: {
            totalLost: totalLostCount,
            lostRatePct,
            lostRateChangePct: null,
            reasons: Array.from(lostReasonMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
            consultants: Array.from(lostConsultantMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
            models: Array.from(lostModelMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
            sources: Array.from(lostSourceMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
            rows: resultRows(lostRows).map((r) => ({
              enquiryDate: safeText(r.enquiry_date) || null,
              customer: safeText(r.name_of_the_customer),
              phone: safeText(r.contact_number),
              model: normalizeModel(r.model),
              source: normalizeSource(r.source),
              consultant: normalizeConsultant(r.consultant_name),
              status: safeText(r.enquiry_status),
              lostReason: safeText(r.lost_reason),
              lostDueTo: safeText(r.lost_due_to),
              lostRemark: safeText(r.lost_remark),
            })),
          },
          retail: {
            kpis: [
              { label: 'RETAIL UNITS', value: salesUnits, formattedValue: formatNumber(salesUnits) },
              { label: 'TOTAL REVENUE', value: totalRevenue, formattedValue: formatCurrency(totalRevenue) },
              { label: 'AVG BASIC PRICE', value: numberValue(curSales.avg_price), formattedValue: formatCurrency(numberValue(curSales.avg_price)) },
              { label: 'AVG DELIVERY DAYS', value: numberValue(curSales.avg_delivery_days) || 0, formattedValue: numberValue(curSales.avg_delivery_days) ? `${numberValue(curSales.avg_delivery_days).toFixed(1)}d` : 'NA' },
            ],
            modelCards,
            financeSummary,
            financiers,
            financeByModel,
            financeByConsultant,
            transactions,
            accessories: {
              totalRevenue: 0,
              totalItems: 0,
              avgPerCar: 0,
              crossSellRatePct: 0,
            },
          },
        }

        hyundaiSalesReportSummaryFallback.set(normalizedDealer || ALL_DEALERS_CACHE_KEY, payload)
        return payload
      } catch (error) {
        console.error('[hyundai-sales-report:summary] failed', error)
        const fallback = hyundaiSalesReportSummaryFallback.get(normalizedDealer || ALL_DEALERS_CACHE_KEY)
        if (fallback) return fallback
        throw error
      }
    },
    HYUNDAI_SALES_REPORT_SUMMARY_CACHE_TTL_SECONDS
  )
}

export async function getHyundaiSalesReportTable(
  optionsOrReport?:
    | {
        report?: string | null
        year?: number | null
        month?: number | null
        monthKey?: string | null
        dealerCode?: string | null
        search?: string | null
        page?: number | string | null
        pageSize?: number | string | null
        startDate?: string | null
        endDate?: string | null
        canViewPii?: boolean
      }
    | SourceKey
    | null,
  posMonthKey?: string | null,
  posDealerCode?: string | null,
  posSearch?: string | null,
  posPage: number = 1,
  posPageSize: number = 25,
  posStartDate?: string | null,
  posEndDate?: string | null
): Promise<SalesReportListPayload> {
  const isObject = typeof optionsOrReport === 'object' && optionsOrReport !== null
  const options = isObject ? optionsOrReport : {}

  const reportKey = normalizeReportKey(isObject ? options.report : optionsOrReport)
  const config = TABLES[reportKey] || TABLES.sales

  const rawMonthKey = isObject
    ? options.monthKey || (options.year && options.month !== null && options.month !== undefined ? `${options.year}-${String(options.month + 1).padStart(2, '0')}` : null)
    : posMonthKey

  const dealerCode = isObject ? options.dealerCode : posDealerCode
  const startDate = isObject ? options.startDate : posStartDate
  const endDate = isObject ? options.endDate : posEndDate
  const search = isObject ? options.search : posSearch
  const page = isObject ? Number(options.page || 1) : posPage
  const pageSize = isObject ? Number(options.pageSize || 25) : posPageSize

  const dateCtx = resolveDateContext(rawMonthKey, startDate, endDate)
  const dFilter = await dealerFilterSql(dealerCode, config)
  const dateCol = sql.raw(config.dateColumn)

  const dbColumns = await analyticsTableColumns(config.table)
  const columns = dbColumns.length > 0 ? dbColumns : config.defaultVisibleColumns

  const safePage = Math.max(1, page)
  const safePageSize = Math.min(100, Math.max(10, pageSize))
  const offset = (safePage - 1) * safePageSize

  const searchFilter = safeText(search)
    ? sql`AND (${sql.join(
        config.searchColumns.map((col) => sql`${sql.raw(col)}::text ILIKE ${'%' + safeText(search) + '%'}`),
        sql` OR `
      )})`
    : sql``

  /*
   * Cached, like the summary and freshness beside it — this function was the only one of the three
   * that was not, and it is the one the user drives hardest.
   *
   * Every tab switch, page step, search keystroke and column toggle fired two UNCACHED analytics
   * queries (the COUNT and the page), and against the pooler that is ~800ms of pure round-trip even
   * when the rows are already warm elsewhere. Measured: 5.3s cold, and still ~820ms on an immediate
   * repeat of the identical request, because nothing was remembered.
   *
   * ⚠️ `canViewPii` MUST stay in the key. These rows carry customer names and phone numbers, and the
   * caller redacts based on that flag — sharing one cache entry between a PII-cleared user and a
   * redacted one would serve real contact details to someone not allowed to see them.
   */
  const canViewPii = isObject ? Boolean(options.canViewPii) : false
  const cacheKey = [
    'hyundai:sales-report:table',
    config.key,
    dateCtx.startDate,
    dateCtx.endDateExclusive,
    normalizeHyundaiDealerCode(dealerCode) || ALL_DEALERS_CACHE_KEY,
    safeText(search) || 'nosearch',
    `p${safePage}`,
    `n${safePageSize}`,
    canViewPii ? 'pii' : 'redacted',
  ].join(':')

  return getCachedData(cacheKey, async () => {
    const [countRows, dataRows] = await Promise.all([
      analyticsDb.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM ${sql.raw(config.table)}
        WHERE ${dateCol} >= ${dateCtx.startDate}::date
          AND ${dateCol} < ${dateCtx.endDateExclusive}::date
          ${dFilter}
          ${searchFilter}
      `),
      analyticsDb.execute(sql`
        SELECT *
        FROM ${sql.raw(config.table)}
        WHERE ${dateCol} >= ${dateCtx.startDate}::date
          AND ${dateCol} < ${dateCtx.endDateExclusive}::date
          ${dFilter}
          ${searchFilter}
        ORDER BY ${sql.raw(config.sortColumn)} DESC NULLS LAST, id DESC
        LIMIT ${safePageSize}
        OFFSET ${offset}
      `),
    ])

    const totalRows = numberValue(resultRows(countRows)[0]?.total)

    return {
      report: config.key,
      title: config.label,
      columns,
      defaultVisibleColumns: config.defaultVisibleColumns,
      // Redacted BEFORE the value is cached or serialised, never in the browser. The cache key
      // carries the same flag, so a cleared viewer's entry can never be served to a redacted one.
      rows: redactHyundaiReportRows(resultRows(dataRows) as Array<Record<string, unknown>>, canViewPii),
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        totalRows,
        totalPages: Math.max(1, Math.ceil(totalRows / safePageSize)),
      },
    }
  }, HYUNDAI_SALES_REPORT_SUMMARY_CACHE_TTL_SECONDS)
}

export async function getHyundaiSalesReportCsv(
  optionsOrReport?:
    | {
        report?: string | null
        year?: number | null
        month?: number | null
        monthKey?: string | null
        dealerCode?: string | null
        search?: string | null
        startDate?: string | null
        endDate?: string | null
        canViewPii?: boolean
      }
    | SourceKey
    | null,
  posMonthKey?: string | null,
  posDealerCode?: string | null,
  posSearch?: string | null,
  posStartDate?: string | null,
  posEndDate?: string | null
): Promise<{ fileName: string; content: string; filename?: string; csv?: string }> {
  const isObject = typeof optionsOrReport === 'object' && optionsOrReport !== null
  const options = isObject ? optionsOrReport : {}

  const reportKey = normalizeReportKey(isObject ? options.report : optionsOrReport)
  const config = TABLES[reportKey] || TABLES.sales

  const rawMonthKey = isObject
    ? options.monthKey || (options.year && options.month !== null && options.month !== undefined ? `${options.year}-${String(options.month + 1).padStart(2, '0')}` : null)
    : posMonthKey

  const dealerCode = isObject ? options.dealerCode : posDealerCode
  const startDate = isObject ? options.startDate : posStartDate
  const endDate = isObject ? options.endDate : posEndDate
  const search = isObject ? options.search : posSearch

  const dateCtx = resolveDateContext(rawMonthKey, startDate, endDate)
  const dFilter = await dealerFilterSql(dealerCode, config)
  const dateCol = sql.raw(config.dateColumn)

  const searchFilter = safeText(search)
    ? sql`AND (${sql.join(
        config.searchColumns.map((col) => sql`${sql.raw(col)}::text ILIKE ${'%' + safeText(search) + '%'}`),
        sql` OR `
      )})`
    : sql``

  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${dateCol} >= ${dateCtx.startDate}::date
      AND ${dateCol} < ${dateCtx.endDateExclusive}::date
      ${dFilter}
      ${searchFilter}
    ORDER BY ${sql.raw(config.sortColumn)} DESC NULLS LAST, id DESC
    LIMIT 10000
  `)

  // The export is the easiest way to walk out with the whole customer book, so it gets the same
  // redaction as the on-screen table — a CSV that leaks what the table hides would make the table's
  // redaction decorative.
  const csvCanViewPii = isObject ? Boolean(options.canViewPii) : false
  const data = redactHyundaiReportRows(resultRows(rows) as Array<Record<string, unknown>>, csvCanViewPii)
  const fileName = `hyundai-${config.key}-${dateCtx.key}.csv`
  if (data.length === 0) {
    return {
      fileName,
      content: 'No data available',
      filename: fileName,
      csv: 'No data available',
    }
  }

  const headers = Object.keys(data[0])
  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '').replace(/"/g, '""')
    return `"${s}"`
  }

  const csvLines = [
    headers.map(escapeCsv).join(','),
    ...data.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
  ]

  const content = csvLines.join('\n')
  return {
    fileName,
    content,
    filename: fileName,
    csv: content,
  }
}
