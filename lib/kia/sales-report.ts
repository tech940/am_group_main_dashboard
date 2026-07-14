import 'server-only'

import { sql } from 'drizzle-orm'

import { analyticsDb } from '@/lib/analytics/db'
import { analyticsTableColumns } from '@/lib/analytics/table-columns'
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
} from '@/lib/kia/sales-report-types'
import { KIA_BRANCH_DEALERS, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { getSalesStockSource } from '@/lib/brands/sales-stock-sources'

type Row = Record<string, unknown>

// Table names come from the brand sales/stock registry (single source of truth) so going multi-brand
// is a config change. KIA is guaranteed present.
const KIA_TABLES = getSalesStockSource('kia')!.tables

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

const KIA_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS = 60 * 10
const KIA_SALES_REPORT_SUMMARY_CACHE_TTL_SECONDS = 60 * 5
const ALL_DEALERS_CACHE_KEY = '__all__'
const kiaSalesReportFreshnessFallback = new Map<string, SalesReportFreshnessPayload>()
const kiaSalesReportSummaryFallback = new Map<string, SalesReportSummaryPayload>()

const TABLES: Record<SourceKey, TableConfig> = {
  enquiry: {
    key: 'enquiry',
    label: 'Enquiry Report',
    table: KIA_TABLES.enquiry,
    dateColumn: 'enquiry_date',
    dealerColumns: ['dealer_code', 'dealer_code_2', 'main_dealer_code'],
    defaultVisibleColumns: ['enquiry_date', 'enquiry_no', 'name_of_the_customer', 'contact_number', 'model', 'source', 'consultant_name', 'enquiry_status', 'booking_date', 'retail_date', 'lost_reason'],
    searchColumns: ['enquiry_no', 'customer_id', 'name_of_the_customer', 'contact_number', 'model', 'variant', 'consultant_name', 'source', 'enquiry_status', 'lost_reason'],
    sourceColumn: 'source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'enquiry_date',
  },
  booking: {
    key: 'booking',
    label: 'Booking Report',
    table: KIA_TABLES.booking,
    dateColumn: 'booking_date',
    dealerColumns: ['dealer_code', 'dealer_code_2', 'main_dealer'],
    defaultVisibleColumns: ['booking_date', 'booking_no', 'name_of_the_customer', 'contact_number', 'model', 'main_source', 'consultant_name', 'status', 'amount_received', 'mode_of_purchase'],
    searchColumns: ['booking_no', 'customer_id', 'name_of_the_customer', 'contact_number', 'model', 'variant', 'consultant_name', 'main_source', 'status'],
    sourceColumn: 'main_source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'booking_date',
  },
  sales: {
    key: 'sales',
    label: 'Sales Report',
    table: KIA_TABLES.sales,
    dateColumn: 'delivery_date',
    dealerColumns: ['dealer_code', 'dealer_code_2', 'main_dealer_code'],
    defaultVisibleColumns: ['delivery_date', 'invoice_date', 'invoice_no', 'registration_name', 'contact_num1', 'model', 'variant', 'color', 'consultant_name', 'source', 'mode_of_purchase', 'dsa_financier', 'ex_showroom_price'],
    searchColumns: ['invoice_no', 'booking_no', 'customerid', 'registration_name', 'contact_num1', 'model', 'variant', 'consultant_name', 'source', 'dsa_financier', 'vin_number', 'vin_no'],
    sourceColumn: 'source',
    consultantColumn: 'consultant_name',
    modelColumn: 'model',
    sortColumn: 'delivery_date',
  },
  accessories: {
    key: 'accessories',
    label: 'Accessories Counter Sales Report',
    table: KIA_TABLES.accessories,
    dateColumn: 'csr_date',
    dealerColumns: ['dealer_code', 'dealer_code_2'],
    defaultVisibleColumns: ['csr_date', 'csr_bill_no', 'accessories_invoice_no', 'customer_name', 'customer_mobile', 'model', 'variant', 'vin', 'accessories_description', 'accessories_qty', 'accessory_taxable_amount', 'tax_amount', 'bill_status'],
    searchColumns: ['csr_bill_no', 'accessories_invoice_no', 'customer_name', 'customer_mobile', 'model', 'variant', 'vin', 'reg_no', 'accessories_description'],
    modelColumn: 'model',
    sortColumn: 'csr_date',
  },
}

// "Test Drives" is a VIEW of the enquiry table: the same rows, filtered to those whose td_status is
// "Done" (see isTestDriveDone). It is NOT a separate data source, so it is intentionally kept OUT of
// TABLES (freshness/month-availability iterate TABLES and must stay the 4 real sources). It reuses the
// enquiry table config but surfaces consultant + model + variant + the test-drive fields by default.
const TEST_DRIVES_CONFIG: TableConfig = {
  key: 'enquiry',
  label: 'Test Drives',
  table: TABLES.enquiry.table,
  dateColumn: 'enquiry_date',
  dealerColumns: TABLES.enquiry.dealerColumns,
  defaultVisibleColumns: ['enquiry_date', 'name_of_the_customer', 'contact_number', 'model', 'variant', 'consultant_name', 'source', 'td_date', 'td_status'],
  searchColumns: TABLES.enquiry.searchColumns,
  sourceColumn: 'source',
  consultantColumn: 'consultant_name',
  modelColumn: 'model',
  sortColumn: 'enquiry_date',
}

type TableReportKey = SourceKey | 'test_drives'

function resolveReportKey(value: string | null | undefined): TableReportKey {
  return value === 'test_drives' ? 'test_drives' : normalizeReportKey(value)
}

function getReportConfig(report: TableReportKey): TableConfig {
  return report === 'test_drives' ? TEST_DRIVES_CONFIG : TABLES[report]
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

function yesNoValue(value: unknown) {
  const normalized = upperText(value)
  return normalized === 'Y' || normalized === 'YES' || normalized === 'TRUE'
}

function getFirstText(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = safeText(row[key])
    if (value) return value
  }
  return ''
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
  if (normalized.includes('crm') || normalized.includes('online') || normalized.includes('mob') || normalized.includes('web') || normalized.includes('digital')) return 'Online/CRM'
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
  if (purchaseMode.includes('finance') || safeText(row.dsa_financier)) return 'In-house'
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

function normalizeDateText(value: unknown) {
  const text = safeText(value)
  if (!text) return null

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    return toIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const numericMatch = text.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (numericMatch) {
    const left = Number(numericMatch[1])
    const middle = Number(numericMatch[2])
    const right = Number(numericMatch[3])

    if (numericMatch[1].length === 4) {
      return toIsoDate(left, middle, right)
    }

    const year = numericMatch[3].length === 2 ? 2000 + right : right
    return toIsoDate(year, middle, left)
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function displayDate(value: unknown) {
  return normalizeDateText(value)
}

function toMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function buildMonthWindow(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1))
  const next = new Date(Date.UTC(year, month + 1, 1))
  return {
    startDate: start.toISOString().slice(0, 10),
    endDateExclusive: next.toISOString().slice(0, 10),
  }
}

function normalizeInputDate(value: string | null | undefined) {
  const normalized = normalizeDateText(value)
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function addDaysToIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetweenInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime()
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1)
}

function formatRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return new Date(`${startDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const start = new Date(`${startDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' })
  const end = new Date(`${endDate}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${start} - ${end}`
}

function previousMonth(year: number, month: number) {
  if (month === 0) return { year: year - 1, month: 11 }
  return { year, month: month - 1 }
}

function formatCurrency(value: number, digits = 0) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0)
}

function formatLakhs(value: number) {
  return `${(value / 100000).toFixed(2)} L`
}

function formatPercent(value: number | null) {
  return value === null ? 'No previous month data' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function percent(part: number, total: number) {
  if (!total) return 0
  return (part / total) * 100
}

function changePct(current: number, previous: number) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

function isActiveBooking(row: Row) {
  return !safeText(row.status).toLowerCase().includes('cancel')
}

function isLostEnquiry(row: Row) {
  // Lost = the enquiry has a lost reason recorded. Nothing else counts.
  return Boolean(safeText(row.lost_reason))
}

function isOpenEnquiry(row: Row) {
  const status = safeText(row.enquiry_status).toLowerCase()
  return (
    !isLostEnquiry(row) &&
    !row.retail_date &&
    !status.includes('retail')
  )
}

function isMissedFollowupEnquiry(row: Row, todayStr: string) {
  if (!isOpenEnquiry(row)) return false

  const nextDateVal = row.next_followup_date
  if (!nextDateVal) return true

  const nextDateStr = nextDateVal instanceof Date
    ? nextDateVal.toISOString().slice(0, 10)
    : String(nextDateVal).slice(0, 10)

  if (nextDateStr.toLowerCase() === 'na' || nextDateStr.toLowerCase() === 'null' || !nextDateStr.trim()) {
    return true
  }

  return nextDateStr < todayStr
}

function isTestDriveDone(row: Row) {
  // A test drive counts only when its status is explicitly "Done" — an appointment,
  // a cancelled slot, or a mere appointment date does NOT count.
  return safeText(row.td_status).toLowerCase() === 'done'
}

function getLeadTemperature(row: Row): TemperatureKey {
  if (displayDate(row.booking_date) || displayDate(row.retail_date) || displayDate(row.delivery_date)) return 'Hot'
  if (isTestDriveDone(row) || numberValue(row.followup_count) >= 2) return 'Warm'
  return 'Cold'
}

function getAccessoriesRevenue(row: Row) {
  // Accessory revenue is the taxable amount only (tax is excluded).
  return numberValue(row.accessory_taxable_amount)
}

function getDeliveryDays(row: Row) {
  const deliveryDate = displayDate(row.delivery_date)
  const bookingDate = displayDate(row.booking_date)
  if (!deliveryDate || !bookingDate) return null
  const start = new Date(`${bookingDate}T00:00:00Z`)
  const end = new Date(`${deliveryDate}T00:00:00Z`)
  const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  return diff >= 0 && diff <= 180 ? diff : null
}

function buildDirectDealerExpression(columns: string[]) {
  return `UPPER(TRIM(COALESCE(${columns.map((column) => `NULLIF(${column}::text, '')`).join(', ')}, '')))`
}

function buildDealerExpression(config: TableConfig) {
  return buildDirectDealerExpression(config.dealerColumns)
}

function buildDealerClause(config: TableConfig, dealerCode: string | null) {
  if (!dealerCode) return sql``
  const expression = buildDealerExpression(config)
  return sql.raw(`AND ${expression} = '${dealerCode}'`)
}

async function queryCurrentAndPreviousRangeRows(config: TableConfig, context: ResolvedDateContext, dealerCode: string | null) {
  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${sql.raw(config.dateColumn)} >= ${context.comparisonStartDate}
      AND ${sql.raw(config.dateColumn)} < ${context.endDateExclusive}
      ${buildDealerClause(config, dealerCode)}
  `)

  const currentRows: Row[] = []
  const previousRows: Row[] = []
  for (const row of resultRows(rows)) {
    const date = displayDate(row[config.dateColumn])
    if (!date) continue
    if (date >= context.startDate && date < context.endDateExclusive) {
      currentRows.push(row)
      continue
    }
    if (date >= context.comparisonStartDate && date < context.comparisonEndDateExclusive) {
      previousRows.push(row)
    }
  }

  return {
    currentRows: dedupeRows(config, currentRows),
    previousRows: dedupeRows(config, previousRows),
  }
}

async function querySourceFreshness(config: TableConfig, dealerCode: string | null) {
  const rows = await analyticsDb.execute(sql`
    SELECT
      MAX(uploaded_at)::text AS source_updated_at,
      COUNT(*)::int AS row_count,
      MIN(${sql.raw(config.dateColumn)})::text AS min_date,
      MAX(${sql.raw(config.dateColumn)})::text AS max_date,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT TO_CHAR(DATE_TRUNC('month', ${sql.raw(config.dateColumn)}), 'YYYY-MM')), NULL) AS available_months
    FROM ${sql.raw(config.table)}
    WHERE ${sql.raw(config.dateColumn)} IS NOT NULL
      ${buildDealerClause(config, dealerCode)}
  `)
  const row = resultRows(rows)[0] || {}
  const availableMonths = Array.isArray(row.available_months)
    ? row.available_months.map((item) => safeText(item)).filter(Boolean).sort((left, right) => right.localeCompare(left))
    : []

  return {
    key: config.key,
    label: config.label,
    sourceUpdatedAt: safeText(row.source_updated_at) || null,
    rowCount: numberValue(row.row_count),
    minDate: safeText(row.min_date) || null,
    maxDate: safeText(row.max_date) || null,
    availableMonths,
  } satisfies SalesReportFreshnessSource
}

async function getDealerOptions() {
  return KIA_BRANCH_DEALERS.map((dealer) => dealer.dealerCode)
}

export async function buildKiaSalesReportFreshness(normalizedDealerCode: string | null) {
  const [sources, dealerOptions] = await Promise.all([
    Promise.all(Object.values(TABLES).map((config) => querySourceFreshness(config, normalizedDealerCode))),
    getDealerOptions(),
  ])

  const availableMonthMap = new Map<string, Set<SourceKey>>()
  for (const source of sources) {
    for (const monthKey of source.availableMonths) {
      if (!availableMonthMap.has(monthKey)) availableMonthMap.set(monthKey, new Set())
      availableMonthMap.get(monthKey)?.add(source.key)
    }
  }

  const today = new Date()
  const todayKey = toMonthKey(today)
  if (!availableMonthMap.has(todayKey)) {
    availableMonthMap.set(todayKey, new Set())
  }

  const availableMonths = Array.from(availableMonthMap.entries())
    .map(([key, sourceKeys]) => {
      const [yearText, monthText] = key.split('-')
      const year = Number(yearText)
      const month = Number(monthText) - 1
      return {
        key,
        label: monthLabel(year, month),
        year,
        month,
        sourceKeys: Array.from(sourceKeys.values()),
      } satisfies SalesReportMonthOption
    })
    .sort((left, right) => right.key.localeCompare(left.key))

  const selectedMonthKey = availableMonths[0]?.key || toMonthKey(new Date())
  const coverageWarnings = sources
    .filter((source) => !source.availableMonths.includes(selectedMonthKey))
    .map((source) => `${source.label} has no data for ${selectedMonthKey}.`)

  return {
    selectedMonthKey,
    sourceUpdatedAt: sources.map((source) => source.sourceUpdatedAt).filter(Boolean).sort().at(-1) || null,
    availableMonths,
    dealerOptions,
    sources,
    coverageWarnings,
  } satisfies SalesReportFreshnessPayload
}



async function resolveMonthContext(year: number | null | undefined, month: number | null | undefined, dealerCode: string | null) {
  if (year !== null && year !== undefined && month !== null && month !== undefined) {
    return {
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: monthLabel(year, month),
      year,
      month,
    } satisfies ResolvedMonthContext
  }

  const freshness = await getKiaSalesReportFreshness(dealerCode)
  const latestMonth = freshness.availableMonths[0]
  if (!latestMonth) {
    throw new Error('No KIA sales report data is available yet')
  }

  return {
    key: latestMonth.key,
    label: latestMonth.label,
    year: latestMonth.year,
    month: latestMonth.month,
  } satisfies ResolvedMonthContext
}

async function resolveDateContext(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
}): Promise<ResolvedDateContext> {
  const normalizedStartDate = normalizeInputDate(input.startDate)
  const normalizedEndDate = normalizeInputDate(input.endDate)

  if (normalizedStartDate && normalizedEndDate) {
    const startDate = normalizedStartDate <= normalizedEndDate ? normalizedStartDate : normalizedEndDate
    const endDate = normalizedStartDate <= normalizedEndDate ? normalizedEndDate : normalizedStartDate
    const selectedDate = new Date(`${endDate}T00:00:00Z`)
    const spanDays = daysBetweenInclusive(startDate, endDate)
    const comparisonEndDate = addDaysToIsoDate(startDate, -1)
    const comparisonStartDate = addDaysToIsoDate(comparisonEndDate, -(spanDays - 1))

    return {
      key: `${startDate}:${endDate}`,
      label: formatRangeLabel(startDate, endDate),
      year: selectedDate.getUTCFullYear(),
      month: selectedDate.getUTCMonth(),
      startDate,
      endDate,
      endDateExclusive: addDaysToIsoDate(endDate, 1),
      comparisonKey: `${comparisonStartDate}:${comparisonEndDate}`,
      comparisonLabel: formatRangeLabel(comparisonStartDate, comparisonEndDate),
      comparisonStartDate,
      comparisonEndDate,
      comparisonEndDateExclusive: addDaysToIsoDate(comparisonEndDate, 1),
      rangeMode: 'custom',
    }
  }

  const resolvedMonth = await resolveMonthContext(input.year, input.month, input.dealerCode || null)
  const previous = previousMonth(resolvedMonth.year, resolvedMonth.month)
  const currentWindow = buildMonthWindow(resolvedMonth.year, resolvedMonth.month)
  const previousWindow = buildMonthWindow(previous.year, previous.month)
  const currentEndDate = addDaysToIsoDate(currentWindow.endDateExclusive, -1)
  const previousEndDate = addDaysToIsoDate(previousWindow.endDateExclusive, -1)

  return {
    ...resolvedMonth,
    startDate: currentWindow.startDate,
    endDate: currentEndDate,
    endDateExclusive: currentWindow.endDateExclusive,
    comparisonKey: `${previous.year}-${String(previous.month + 1).padStart(2, '0')}`,
    comparisonLabel: monthLabel(previous.year, previous.month),
    comparisonStartDate: previousWindow.startDate,
    comparisonEndDate: previousEndDate,
    comparisonEndDateExclusive: previousWindow.endDateExclusive,
    rangeMode: 'month',
  }
}

export async function getKiaSalesReportFreshness(dealerCode?: string | null) {
  const normalizedDealerCode = normalizeKiaDealerCode(dealerCode) || null
  const dealerCacheKey = normalizedDealerCode || ALL_DEALERS_CACHE_KEY
  const cacheKey = `kia:sales-report:freshness:${dealerCacheKey}`

  try {
    const payload = await getCachedData(
      cacheKey,
      () => buildKiaSalesReportFreshness(normalizedDealerCode),
      KIA_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS
    )
    kiaSalesReportFreshnessFallback.set(dealerCacheKey, payload)
    return payload
  } catch (error) {
    const fallback = kiaSalesReportFreshnessFallback.get(dealerCacheKey)
    if (fallback) {
      console.warn('[kia-sales-report:freshness] serving last known good snapshot after live read failure', {
        dealerCode: normalizedDealerCode || 'all',
        message: error instanceof Error ? error.message : String(error),
      })
      return fallback
    }
    throw error
  }
}

function buildSummaryCacheKey(context: ResolvedDateContext, dealerCode: string | null) {
  return [context.startDate, context.endDate, dealerCode || ALL_DEALERS_CACHE_KEY].join(':')
}

function buildKpi(
  label: string,
  value: number,
  previousValue: number,
  formattedValue = value.toLocaleString('en-IN'),
  formattedComparisonValue = previousValue.toLocaleString('en-IN'),
  comparisonLabel = 'Previous month',
  options: {
    comparisonContext?: string | null
    trendDirection?: 'higher_is_better' | 'lower_is_better'
    changeBase?: { current: number; previous: number }
  } = {}
) {
  const changeCurrent = options.changeBase?.current ?? value
  const changePrevious = options.changeBase?.previous ?? previousValue
  const rawPct = changePct(changeCurrent, changePrevious)
  const pct = rawPct === null
    ? null
    : options.trendDirection === 'lower_is_better'
      ? rawPct * -1
      : rawPct
  return {
    label,
    value,
    formattedValue,
    comparisonValue: previousValue,
    formattedComparisonValue,
    comparisonLabel,
    comparisonContext: options.comparisonContext ?? null,
    changePct: pct,
    changeLabel: formatPercent(pct),
    trendDirection: options.trendDirection ?? 'higher_is_better',
  } satisfies SalesReportKpi
}

function buildCounts(points: Map<string, number>) {
  return Array.from(points.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value)
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount)
}

function rowCompletenessScore(row: Row) {
  let score = 0
  for (const value of Object.values(row)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      score += 1
      continue
    }
    if (safeText(value)) score += 1
  }
  return score
}

function rowTimestampScore(row: Row) {
  for (const key of ['uploaded_at', 'updated_at', 'created_at']) {
    const text = safeText(row[key])
    if (!text) continue
    const timestamp = new Date(text).getTime()
    if (!Number.isNaN(timestamp)) return timestamp
  }
  return 0
}

function rowNumericIdScore(row: Row) {
  for (const key of ['id', 'row_id']) {
    const value = numberValue(row[key])
    if (value) return value
  }
  return 0
}

function buildDeduplicationKey(config: TableConfig, row: Row) {
  if (config.key === 'enquiry') {
    const enquiryNo = upperText(row.enquiry_no)
    if (enquiryNo) return `enquiry:${enquiryNo}`
    return [
      'enquiry',
      displayDate(row.enquiry_date) || safeText(row.enquiry_date),
      upperText(row.customer_id),
      upperText(row.name_of_the_customer),
      upperText(row.contact_number),
      upperText(row.model),
      upperText(row.consultant_name),
    ].join('|')
  }

  if (config.key === 'booking') {
    const bookingNo = upperText(row.booking_no)
    if (bookingNo) return `booking:${bookingNo}`
    return [
      'booking',
      displayDate(row.booking_date) || safeText(row.booking_date),
      upperText(row.customer_id),
      upperText(row.name_of_the_customer),
      upperText(row.contact_number),
      upperText(row.model),
      upperText(row.consultant_name),
    ].join('|')
  }

  if (config.key === 'sales') {
    const invoiceNo = upperText(row.invoice_no)
    if (invoiceNo) return `sales:${invoiceNo}`
    return [
      'sales',
      upperText(getFirstText(row, ['vin_number', 'vin_no'])),
      displayDate(row.delivery_date) || displayDate(row.invoice_date) || safeText(row.delivery_date) || safeText(row.invoice_date),
      upperText(row.customerid),
      upperText(row.registration_name),
      upperText(row.model),
    ].join('|')
  }

  return [
    'accessories',
    upperText(getFirstText(row, ['csr_bill_no', 'accessories_invoice_no'])),
    displayDate(row.csr_date) || safeText(row.csr_date),
    upperText(getFirstText(row, ['vin', 'reg_no'])),
    upperText(row.accessories_description),
    numberValue(row.accessories_qty) || numberValue(row.total_accessories_qty) || 1,
    numberValue(row.accessory_taxable_amount),
    numberValue(row.tax_amount),
  ].join('|')
}

function choosePreferredRow(current: Row, candidate: Row) {
  const currentTimestamp = rowTimestampScore(current)
  const candidateTimestamp = rowTimestampScore(candidate)
  if (candidateTimestamp !== currentTimestamp) return candidateTimestamp > currentTimestamp ? candidate : current

  const currentId = rowNumericIdScore(current)
  const candidateId = rowNumericIdScore(candidate)
  if (candidateId !== currentId) return candidateId > currentId ? candidate : current

  const currentCompleteness = rowCompletenessScore(current)
  const candidateCompleteness = rowCompletenessScore(candidate)
  return candidateCompleteness > currentCompleteness ? candidate : current
}

function dedupeRows(config: TableConfig, rows: Row[]) {
  const unique = new Map<string, Row>()
  for (const row of rows) {
    const key = buildDeduplicationKey(config, row)
    const existing = unique.get(key)
    unique.set(key, existing ? choosePreferredRow(existing, row) : row)
  }
  return Array.from(unique.values())
}

function normalizeRowForOutput(row: Row, columns: string[]) {
  const normalized = { ...row }
  for (const column of columns) {
    if (!column.includes('date') || column.endsWith('_at')) continue
    const formatted = displayDate(row[column])
    if (formatted) normalized[column] = formatted
  }
  return normalized
}

function compareSortValues(left: unknown, right: unknown, column: string) {
  if (column.includes('date') && !column.endsWith('_at')) {
    const leftDate = displayDate(left) || ''
    const rightDate = displayDate(right) || ''
    return leftDate.localeCompare(rightDate)
  }

  const leftText = safeText(left)
  const rightText = safeText(right)
  const leftNumber = numberValue(left)
  const rightNumber = numberValue(right)
  const numericPattern = /^-?[0-9,.\s₹]+$/
  const leftLooksNumeric = leftText !== '' && numericPattern.test(leftText)
  const rightLooksNumeric = rightText !== '' && numericPattern.test(rightText)

  if (leftLooksNumeric && rightLooksNumeric) {
    if (leftNumber === rightNumber) return 0
    return leftNumber > rightNumber ? 1 : -1
  }

  return upperText(leftText).localeCompare(upperText(rightText))
}

function sortRows(rows: Row[], column: string, direction: 'asc' | 'desc') {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => {
    const comparison = compareSortValues(left[column], right[column], column)
    if (comparison !== 0) return comparison * multiplier

    const leftDate = displayDate(left.delivery_date) || displayDate(left.booking_date) || displayDate(left.enquiry_date) || ''
    const rightDate = displayDate(right.delivery_date) || displayDate(right.booking_date) || displayDate(right.enquiry_date) || ''
    return rightDate.localeCompare(leftDate)
  })
}

function aggregateAccessoryByVin(rows: Row[]) {
  const map = new Map<string, { value: number; count: number }>()
  for (const row of rows) {
    const vin = upperText(row.vin)
    if (!vin) continue
    const current = map.get(vin) || { value: 0, count: 0 }
    current.value += getAccessoriesRevenue(row)
    current.count += numberValue(row.total_accessories_qty) || numberValue(row.accessories_qty) || 1
    map.set(vin, current)
  }
  return map
}

async function buildKiaSalesReportSummary(context: ResolvedDateContext, normalizedDealerCode: string | null) {
  const [
    enquiryBundle,
    bookingBundle,
    salesBundle,
    accessoryBundle,
  ] = await Promise.all([
    queryCurrentAndPreviousRangeRows(TABLES.enquiry, context, normalizedDealerCode),
    queryCurrentAndPreviousRangeRows(TABLES.booking, context, normalizedDealerCode),
    queryCurrentAndPreviousRangeRows(TABLES.sales, context, normalizedDealerCode),
    queryCurrentAndPreviousRangeRows(TABLES.accessories, context, normalizedDealerCode),
  ])

      const enquiryRows = enquiryBundle.currentRows
      const bookingRowsRaw = bookingBundle.currentRows
      const salesRows = salesBundle.currentRows
      const accessoryRows = accessoryBundle.currentRows
      const previousEnquiryRows = enquiryBundle.previousRows
      const previousBookingRowsRaw = bookingBundle.previousRows
      const previousSalesRows = salesBundle.previousRows
      const previousAccessoryRows = accessoryBundle.previousRows

      const bookingRows = bookingRowsRaw.filter(isActiveBooking)
      const previousBookingRows = previousBookingRowsRaw.filter(isActiveBooking)
      const lostRows = enquiryRows.filter(isLostEnquiry)
      const previousLostRows = previousEnquiryRows.filter(isLostEnquiry)
      const tdRows = enquiryRows.filter(isTestDriveDone)
      const previousTdRows = previousEnquiryRows.filter(isTestDriveDone)
      const exchangeCount = enquiryRows.filter((row) => yesNoValue(row.interested_in_exchange_y_n)).length
      const previousExchangeCount = previousEnquiryRows.filter((row) => yesNoValue(row.interested_in_exchange_y_n)).length
      const accessoriesRevenue = accessoryRows.reduce((total, row) => total + getAccessoriesRevenue(row), 0)
      const previousAccessoriesRevenue = previousAccessoryRows.reduce((total, row) => total + getAccessoriesRevenue(row), 0)
      const accessoryItemCount = accessoryRows.reduce((total, row) => total + (numberValue(row.total_accessories_qty) || numberValue(row.accessories_qty) || 1), 0)
      const retails = salesRows.length
      const previousRetails = previousSalesRows.length
      const totalRevenue = salesRows.reduce((sum, row) => sum + numberValue(row.ex_showroom_price), 0)
      const avgPricePerCar = retails > 0 ? totalRevenue / retails : 0
      const avgPricePerCarWithAccessories = retails > 0 ? (totalRevenue + accessoriesRevenue) / retails : 0

      const enquiryStatusMap = new Map<string, number>()
      const sourceMap = new Map<string, number>()
      const dealerMap = new Map<string, number>()
      const dealerSourceMap = new Map<string, Map<string, number>>()
      const temperatureMap = new Map<TemperatureKey, number>([['Hot', 0], ['Warm', 0], ['Cold', 0]])
      const modelMap = new Map<string, number>()
      const modelBySourceMap = new Map<string, Map<string, number>>()
      // Model-wise test drives: count enquiry rows whose td_status is "Done", grouped by model.
      const testDrivesByModelMap = new Map<string, number>()
      // Model+Variant breakdown for test drives (composite key "MODEL||VARIANT").
      const testDrivesByModelVariantMap = new Map<string, number>()
      const dailyMap = new Map<string, number>()
      const lostReasonMap = new Map<string, number>()
      const lostConsultantMap = new Map<string, number>()
      const lostModelMap = new Map<string, number>()
      const lostSourceMap = new Map<string, number>()
      const teamBase = new Map<string, SalesReportConsultantRow>()
      const bookingsBySource = new Map<string, number>()
      const bookingsByConsultant = new Map<string, number>()
      const bookingsByModel = new Map<string, number>()
      const bookingsBySourceModel = new Map<string, Map<string, number>>()

      for (const row of enquiryRows) {
        increment(enquiryStatusMap, safeText(row.enquiry_status) || 'Unknown')
        const source = normalizeSource(getFirstText(row, ['source', 'enquiry_source']))
        const dealer = upperText(getFirstText(row, TABLES.enquiry.dealerColumns)) || 'Unknown'
        const model = normalizeModel(row.model)
        const consultant = normalizeConsultant(row.consultant_name)
        // Group consultants case-insensitively (UPPER+TRIM) so name-casing variants
        // of the same person — e.g. "Abi Dogra" vs "ABI DOGRA" — collapse into a
        // single row. This matches how the Booking Report matches a consultant
        // (buildOptionalFilter uses UPPER(TRIM(consultant_name))). Without it the
        // same consultant was split across buckets, undercounting both walk-ins and
        // bookings versus the Booking Report source of truth.
        const consultantKey = upperText(row.consultant_name) || 'UNASSIGNED'
        const date = displayDate(row.enquiry_date)
        increment(sourceMap, source)
        increment(dealerMap, dealer)
        if (!dealerSourceMap.has(dealer)) dealerSourceMap.set(dealer, new Map())
        increment(dealerSourceMap.get(dealer) as Map<string, number>, source)
        increment(modelMap, model)
        if (!modelBySourceMap.has(source)) modelBySourceMap.set(source, new Map())
        increment(modelBySourceMap.get(source) as Map<string, number>, model)
        if (isTestDriveDone(row)) {
          increment(testDrivesByModelMap, model)
          const variant = safeText(row.variant) || '-'
          increment(testDrivesByModelVariantMap, `${model}||${variant}`)
        }
        increment(temperatureMap as Map<string, number>, getLeadTemperature(row))
        if (date) increment(dailyMap, date)

        const current = teamBase.get(consultantKey) || {
          consultant,
          enquiries: 0,
          bookings: 0,
          bookingRatePct: 0,
          walkinEnquiries: 0,
          walkinBookings: 0,
          walkinConversionPct: 0,
          testDrives: 0,
          tdRatePct: 0,
        }
        current.enquiries += 1
        if (source === 'Walkin') current.walkinEnquiries += 1
        if (isTestDriveDone(row)) current.testDrives += 1
        teamBase.set(consultantKey, current)
      }

      for (const row of bookingRowsRaw) {
        const source = normalizeSource(getFirstText(row, ['main_source', 'source']))
        const consultant = normalizeConsultant(row.consultant_name)
        // Same case-insensitive grouping key as the enquiry loop above so a
        // consultant's enquiries and bookings land in the same leaderboard row.
        const consultantKey = upperText(row.consultant_name) || 'UNASSIGNED'
        const model = normalizeModel(row.model)
        increment(bookingsBySource, source)
        increment(bookingsByConsultant, consultant)
        increment(bookingsByModel, model)
        if (!bookingsBySourceModel.has(source)) bookingsBySourceModel.set(source, new Map())
        increment(bookingsBySourceModel.get(source) as Map<string, number>, model)
        const current = teamBase.get(consultantKey) || {
          consultant,
          enquiries: 0,
          bookings: 0,
          bookingRatePct: 0,
          walkinEnquiries: 0,
          walkinBookings: 0,
          walkinConversionPct: 0,
          testDrives: 0,
          tdRatePct: 0,
        }
        current.bookings += 1
        if (source === 'Walkin') current.walkinBookings += 1
        teamBase.set(consultantKey, current)
      }

      for (const row of lostRows) {
        increment(lostReasonMap, safeText(row.lost_reason) || safeText(row.lost_due_to) || 'Unknown')
        increment(lostConsultantMap, normalizeConsultant(row.consultant_name))
        increment(lostModelMap, normalizeModel(row.model))
        increment(lostSourceMap, normalizeSource(getFirstText(row, ['source', 'enquiry_source'])))
      }

      const totalEnquiries = enquiryRows.length
      const totalBookings = bookingRows.length
      const totalLost = lostRows.length
      const totalTestDrives = tdRows.length
      const totalAccPerCar = retails > 0 ? accessoriesRevenue / retails : 0
      const previousAccPerCar = previousRetails > 0 ? previousAccessoriesRevenue / previousRetails : 0
      const lostRatePct = percent(totalLost, totalEnquiries)
      const previousLostRatePct = percent(previousLostRows.length, previousEnquiryRows.length)
      const bookingConversionPct = percent(totalBookings, totalEnquiries)
      const retailOfEnquiriesPct = percent(retails, totalEnquiries)
      const testDriveEngagementPct = percent(totalTestDrives, totalEnquiries)
      const exchangeCustomerPct = percent(exchangeCount, totalEnquiries)

      const sourceCards = buildCounts(sourceMap).map((item) => {
        const bookings = bookingsBySource.get(item.name) || 0
        return {
          source: item.name,
          enquiries: item.value,
          bookings,
          enquirySharePct: percent(item.value, totalEnquiries),
          conversionPct: percent(bookings, item.value),
          highlightWalkIn: item.name === 'Walkin',
        } satisfies SalesReportSourceCard
      })

      const walkinCard = sourceCards.find((item) => item.source === 'Walkin')
      const walkinSharePct = walkinCard?.enquirySharePct || 0
      const walkinMessage = walkinSharePct > 20
        ? 'Strong floor traffic - focus on converting these high-intent visitors.'
        : 'Consider drive-to-showroom campaigns to improve floor traffic.'

      const teamLeaderboard = Array.from(teamBase.values())
        .map((item) => ({
          ...item,
          bookingRatePct: percent(item.bookings, item.enquiries),
          walkinConversionPct: percent(item.walkinBookings, item.walkinEnquiries),
          tdRatePct: percent(item.testDrives, item.enquiries),
        }))
        // "Booking Leaders ranked by output": bookings are the primary ranking
        // signal (output = cars booked), with total enquiries as the tie-breaker
        // so bookings — not enquiry volume alone — drive the ordering.
        .sort((left, right) => right.bookings - left.bookings || right.enquiries - left.enquiries)

      const daily = Array.from(dailyMap.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([day, enquiries]) => ({ day, enquiries }))

      const trendPeak = daily.reduce((current, item) => item.enquiries > current.enquiries ? item : current, { day: '', enquiries: 0 })
      const trendAverage = daily.length > 0 ? totalEnquiries / daily.length : 0
      const weeks = Array.from({ length: Math.ceil(daily.length / 7) }, (_, index) => {
        const slice = daily.slice(index * 7, index * 7 + 7)
        const total = slice.reduce((sum, item) => sum + item.enquiries, 0)
        const peak = slice.reduce((current, item) => item.enquiries > current.enquiries ? item : current, { day: '', enquiries: 0 })
        return {
          week: `Week ${index + 1}`,
          dates: slice.length > 0 ? `${slice[0]?.day.slice(8)}-${slice.at(-1)?.day.slice(8)}` : '-',
          total,
          avg: slice.length > 0 ? Number((total / slice.length).toFixed(1)) : 0,
          peak: peak.day ? `${peak.day.slice(8)} (${peak.enquiries})` : '-',
        }
      })

      const accessoryByVin = aggregateAccessoryByVin(accessoryRows)
      const transactions = salesRows.map((row, index) => {
        const vin = upperText(getFirstText(row, ['vin_number', 'vin_no']))
        const accessory = accessoryByVin.get(vin) || { value: 0, count: 0 }
        const invoiceDate = displayDate(row.invoice_date)
        const deliveryDate = displayDate(row.delivery_date)
        const invoiceNo = safeText(row.invoice_no)
        const customerId = safeText(row.customerid)
        return {
          rowKey: [vin || 'NO-VIN', invoiceDate || deliveryDate || 'NO-DATE', invoiceNo || customerId || String(index), String(index)].join('::'),
          customerName: safeText(row.registration_name) || 'Unknown',
          phone: getFirstText(row, ['contact_num1', 'contact_num2', 'contact_num3']),
          model: normalizeModel(row.model),
          variant: safeText(row.variant) || '-',
          color: safeText(row.color) || '-',
          consultant: normalizeConsultant(row.consultant_name),
          source: normalizeSource(row.source),
          financeType: normalizeFinanceMode(row),
          financier: normalizeFinancier(row.dsa_financier),
          exShowroomPrice: numberValue(row.ex_showroom_price),
          invoiceDate,
          deliveryDate,
          customerId,
          deliveryDays: getDeliveryDays(row),
          vin,
          accessoriesValue: accessory.value,
          accessoriesCount: accessory.count,
        } satisfies SalesRetailTransaction
      }).sort((left, right) => (right.deliveryDate || '').localeCompare(left.deliveryDate || ''))

      const retailKpis = [
        { label: 'Units Retailed', value: retails, formattedValue: retails.toLocaleString('en-IN') },
        { label: 'Total Revenue', value: totalRevenue, formattedValue: formatLakhs(totalRevenue) },
        { label: 'Avg Price / Car', value: avgPricePerCar, formattedValue: formatLakhs(avgPricePerCar) },
        { label: 'Accessories Revenue', value: accessoriesRevenue, formattedValue: formatLakhs(accessoriesRevenue) },
        { label: 'Avg / Car (with acc)', value: avgPricePerCarWithAccessories, formattedValue: formatLakhs(avgPricePerCarWithAccessories) },
        { label: 'Avg Delivery Days', value: transactions.filter((item) => item.deliveryDays !== null).reduce((sum, item) => sum + (item.deliveryDays || 0), 0) / Math.max(1, transactions.filter((item) => item.deliveryDays !== null).length), formattedValue: `${Math.round(transactions.filter((item) => item.deliveryDays !== null).reduce((sum, item) => sum + (item.deliveryDays || 0), 0) / Math.max(1, transactions.filter((item) => item.deliveryDays !== null).length))} days` },
        { label: 'Exchange Opted', value: salesRows.filter((row) => yesNoValue(row.interested_in_exchange_y_n)).length, formattedValue: salesRows.filter((row) => yesNoValue(row.interested_in_exchange_y_n)).length.toLocaleString('en-IN') },
      ]

      const retailModelMap = new Map<string, SalesRetailModelCard>()
      const financeSummaryMap = new Map<FinanceModeKey, number>([['Cash', 0], ['In-house', 0], ['Self-Finance', 0]])
      const financierMap = new Map<string, number>()
      const financeByModelMap = new Map<string, { Cash: number; 'In-house': number; 'Self-Finance': number }>()
      const financeByConsultantMap = new Map<string, { Cash: number; 'In-house': number; 'Self-Finance': number }>()

      for (const transaction of transactions) {
        const financeMode = transaction.financeType as FinanceModeKey
        financeSummaryMap.set(financeMode, (financeSummaryMap.get(financeMode) || 0) + 1)
        if (financeMode === 'In-house') increment(financierMap, transaction.financier)

        const currentModel = retailModelMap.get(transaction.model) || {
          model: transaction.model,
          units: 0,
          revenue: 0,
          avgPrice: 0,
          avgDeliveryDays: null,
          variants: [],
          colors: [],
          financeBreakdown: [],
        }
        currentModel.units += 1
        currentModel.revenue += transaction.exShowroomPrice
        retailModelMap.set(transaction.model, currentModel)

        const financeModel = financeByModelMap.get(transaction.model) || { Cash: 0, 'In-house': 0, 'Self-Finance': 0 }
        financeModel[financeMode] += 1
        financeByModelMap.set(transaction.model, financeModel)

        const financeConsultant = financeByConsultantMap.get(transaction.consultant) || { Cash: 0, 'In-house': 0, 'Self-Finance': 0 }
        financeConsultant[financeMode] += 1
        financeByConsultantMap.set(transaction.consultant, financeConsultant)
      }

      for (const [model, card] of retailModelMap.entries()) {
        const modelTransactions = transactions.filter((item) => item.model === model)
        const variantMap = new Map<string, number>()
        const colorMap = new Map<string, number>()
        const financeMap = new Map<FinanceModeKey, number>([['Cash', 0], ['In-house', 0], ['Self-Finance', 0]])
        let deliveryDaysTotal = 0
        let deliveryDaysCount = 0
        for (const transaction of modelTransactions) {
          increment(variantMap, transaction.variant || '-')
          increment(colorMap, transaction.color || '-')
          financeMap.set(transaction.financeType as FinanceModeKey, (financeMap.get(transaction.financeType as FinanceModeKey) || 0) + 1)
          if (transaction.deliveryDays !== null) {
            deliveryDaysTotal += transaction.deliveryDays
            deliveryDaysCount += 1
          }
        }
        card.avgPrice = card.units > 0 ? card.revenue / card.units : 0
        card.avgDeliveryDays = deliveryDaysCount > 0 ? deliveryDaysTotal / deliveryDaysCount : null
        card.variants = buildCounts(variantMap).slice(0, 5).map((item) => ({ name: item.name, count: item.value }))
        card.colors = buildCounts(colorMap).slice(0, 5).map((item) => ({ name: item.name, count: item.value }))
        card.financeBreakdown = Array.from(financeMap.entries()).map(([name, count]) => ({ name, count }))
      }

      const matchedRetailUnits = transactions.filter((item) => item.accessoriesValue > 0).length
      const sourceAssumptions = [
        'Lead temperature is derived from booking, retail, test drive, and follow-up signals.',
        'Average delivery days uses booking-to-delivery gap from sales rows when both dates are present.',
        'Accessories per car and cross-sell use accessory rows tagged to the selected dealer in the Accessories Counter Sales Report.',
      ]
      if (normalizedDealerCode && accessoryRows.length === 0) {
        sourceAssumptions.push(`Accessories Counter Sales Report has no ${normalizedDealerCode}-tagged rows for ${context.label}; accessory revenue is shown as 0 instead of inferred from weak VIN/customer matches.`)
      }

      return {
        context: {
          selectedMonthKey: context.key,
          selectedMonthLabel: context.label,
          comparisonMonthKey: context.comparisonKey,
          comparisonMonthLabel: context.comparisonLabel,
          startDate: context.startDate,
          endDate: context.endDate,
          comparisonStartDate: context.comparisonStartDate,
          comparisonEndDate: context.comparisonEndDate,
          rangeMode: context.rangeMode,
        },
        assumptions: sourceAssumptions,
        overview: {
          kpis: [
            buildKpi('Total Enquiries', totalEnquiries, previousEnquiryRows.length, totalEnquiries.toLocaleString('en-IN'), previousEnquiryRows.length.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`),
            buildKpi('Bookings', totalBookings, previousBookingRows.length, totalBookings.toLocaleString('en-IN'), previousBookingRows.length.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`, {
              comparisonContext: `${bookingConversionPct.toFixed(1)}% conversion`,
            }),
            buildKpi('Retails', retails, previousRetails, retails.toLocaleString('en-IN'), previousRetails.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`, {
              comparisonContext: `${retailOfEnquiriesPct.toFixed(1)}% of enquiries`,
            }),
            buildKpi('Test Drives', totalTestDrives, previousTdRows.length, totalTestDrives.toLocaleString('en-IN'), previousTdRows.length.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`, {
              comparisonContext: `${testDriveEngagementPct.toFixed(1)}% engagement`,
            }),
            buildKpi('Lost', totalLost, previousLostRows.length, totalLost.toLocaleString('en-IN'), previousLostRows.length.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`, {
              trendDirection: 'lower_is_better',
              changeBase: { current: lostRatePct, previous: previousLostRatePct },
              comparisonContext: `${lostRatePct.toFixed(1)}% lost rate`,
            }),
            buildKpi('Exchange Opted', exchangeCount, previousExchangeCount, exchangeCount.toLocaleString('en-IN'), previousExchangeCount.toLocaleString('en-IN'), `Vs ${context.comparisonLabel}`, {
              comparisonContext: `${exchangeCustomerPct.toFixed(1)}% of customers`,
            }),
            buildKpi('Acc Revenue', accessoriesRevenue, previousAccessoriesRevenue, formatCurrency(accessoriesRevenue), formatCurrency(previousAccessoriesRevenue), `Vs ${context.comparisonLabel}`, {
              comparisonContext: 'total accessories sold',
            }),
            buildKpi('Acc / Car', totalAccPerCar, previousAccPerCar, formatCurrency(totalAccPerCar), formatCurrency(previousAccPerCar), `Vs ${context.comparisonLabel}`, {
              comparisonContext: 'per car retailed',
            }),
          ],
          enquiryStatus: buildCounts(enquiryStatusMap),
          sourceShare: buildCounts(sourceMap),
          dealerSummary: buildCounts(dealerMap),
          leadTemperature: Array.from(temperatureMap.entries()).map(([name, value]) => ({ name, value })),
          testDrive: [
            { name: 'Taken', value: totalTestDrives },
            { name: 'Not Taken', value: Math.max(0, totalEnquiries - totalTestDrives) },
          ],
          funnel: [
            { name: 'Enquiries', value: totalEnquiries },
            { name: 'Bookings', value: totalBookings },
            { name: 'Retails', value: retails },
          ],
          topModels: buildCounts(modelMap).slice(0, 5),
          sourceCards,
          walkinSpotlight: {
            enquiries: walkinCard?.enquiries || 0,
            sharePct: walkinSharePct,
            message: walkinMessage,
          },
        },
        models: {
          sourceOptions: Array.from(new Set(sourceCards.map((item) => item.source))).sort(),
          items: buildCounts(modelMap).map((item) => ({
            model: item.name,
            enquiries: item.value,
            bookings: bookingsByModel.get(item.name) || 0,
          })),
          topFive: buildCounts(modelMap).slice(0, 5),
          testDrivesByModel: buildCounts(testDrivesByModelMap).map((item) => ({ model: item.name, testDrives: item.value })),
          testDrivesByModelVariant: buildCounts(testDrivesByModelVariantMap).map((item) => {
            const [model, variant] = item.name.split('||')
            return { model: model || '', variant: variant || '-', testDrives: item.value }
          }),
          sourceBreakdown: Object.fromEntries(Array.from(modelBySourceMap.entries()).map(([source, counts]) => ([
            source,
            buildCounts(counts).map((item) => ({
              model: item.name,
              enquiries: item.value,
              bookings: bookingsBySourceModel.get(source)?.get(item.name) || 0,
            })),
          ]))),
        },
        sources: {
          items: sourceCards.map((item) => ({
            source: item.source,
            enquiries: item.enquiries,
            bookings: item.bookings,
            sharePct: item.enquirySharePct,
            conversionPct: item.conversionPct,
          })),
          dealerMatrix: buildCounts(dealerMap).map((dealer) => ({
            dealer: dealer.name,
            values: sourceCards.map((item) => ({
              source: item.source,
              enquiries: dealerSourceMap.get(dealer.name)?.get(item.source) || 0,
            })),
          })),
          walkinSpotlight: {
            enquiries: walkinCard?.enquiries || 0,
            sharePct: walkinSharePct,
            message: walkinMessage,
          },
        },
        team: {
          leaderboard: teamLeaderboard,
          comparison: teamLeaderboard.slice(0, 12).map((item) => ({ consultant: item.consultant, enquiries: item.enquiries, bookings: item.bookings })),
        },
        trend: {
          daily,
          weeks,
          trendNote: `${context.label} · Peak: ${trendPeak.day ? `${trendPeak.day} (${trendPeak.enquiries})` : 'N/A'} · Avg: ${trendAverage.toFixed(1)}/day`,
        },
        lost: {
          totalLost,
          lostRatePct,
          lostRateChangePct: changePct(lostRatePct, previousLostRatePct),
          reasons: buildCounts(lostReasonMap),
          consultants: buildCounts(lostConsultantMap),
          models: buildCounts(lostModelMap),
          sources: buildCounts(lostSourceMap),
          rows: lostRows.map((row) => ({
            enquiryDate: displayDate(row.enquiry_date),
            customer: safeText(row.name_of_the_customer) || 'Unknown',
            phone: safeText(row.contact_number),
            model: normalizeModel(row.model),
            source: normalizeSource(getFirstText(row, ['source', 'enquiry_source'])),
            consultant: normalizeConsultant(row.consultant_name),
            status: safeText(row.enquiry_status) || 'Unknown',
            lostReason: safeText(row.lost_reason),
            lostDueTo: safeText(row.lost_due_to),
            lostRemark: safeText(row.lost_remark),
          })),
        },
        retail: {
          kpis: retailKpis,
          modelCards: Array.from(retailModelMap.values()).sort((left, right) => right.units - left.units),
          financeSummary: Array.from(financeSummaryMap.entries()).map(([name, units]) => ({ name, units, sharePct: percent(units, retails) })),
          financiers: buildCounts(financierMap).map((item) => ({ financier: item.name, count: item.value })),
          financeByModel: Array.from(financeByModelMap.entries()).map(([model, values]) => ({ model, ...values })).sort((left, right) => (right.Cash + right['In-house'] + right['Self-Finance']) - (left.Cash + left['In-house'] + left['Self-Finance'])),
          financeByConsultant: Array.from(financeByConsultantMap.entries()).map(([consultant, values]) => ({ consultant, ...values })).sort((left, right) => (right.Cash + right['In-house'] + right['Self-Finance']) - (left.Cash + left['In-house'] + left['Self-Finance'])),
          transactions,
          accessories: {
            totalRevenue: accessoriesRevenue,
            totalItems: accessoryItemCount,
            avgPerCar: totalAccPerCar,
            crossSellRatePct: percent(matchedRetailUnits, retails),
            matchedRetailUnits,
          },
        },
        missedFollowups: (() => {
          const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
          const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`

          const missedEnquiries = enquiryRows.filter((row) => isMissedFollowupEnquiry(row, todayStr))
          const missedCount = missedEnquiries.length

          const missedByModelMap = new Map<string, number>()
          const missedByConsultantMap = new Map<string, number>()
          const missedBySourceMap = new Map<string, number>()

          for (const row of missedEnquiries) {
            increment(missedByModelMap, normalizeModel(row.model))
            increment(missedByConsultantMap, normalizeConsultant(row.consultant_name))
            increment(missedBySourceMap, normalizeSource(getFirstText(row, ['source', 'enquiry_source'])))
          }

          return {
            count: missedCount,
            byModel: buildCounts(missedByModelMap).slice(0, 5),
            byConsultant: buildCounts(missedByConsultantMap).slice(0, 5),
            bySource: buildCounts(missedBySourceMap).slice(0, 5),
          }
        })(),
      } satisfies SalesReportSummaryPayload
}

export async function getKiaSalesReportSummary(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
}) {
  const normalizedDealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const context = await resolveDateContext({
    year: input.year,
    month: input.month,
    startDate: input.startDate,
    endDate: input.endDate,
    dealerCode: normalizedDealerCode,
  })
  const dealerCacheKey = normalizedDealerCode || ALL_DEALERS_CACHE_KEY
  // Bump the version segment whenever the summary SHAPE changes so stale-shaped cached entries are not
  // served (v2 added models.testDrivesByModel, v3 added models.testDrivesByModelVariant).
  const summaryCacheKey = `kia:sales-report:summary:v3:${context.key}:${dealerCacheKey}`

  try {
    const payload = await getCachedData(
      summaryCacheKey,
      () => buildKiaSalesReportSummary(context, normalizedDealerCode),
      KIA_SALES_REPORT_SUMMARY_CACHE_TTL_SECONDS
    )
    kiaSalesReportSummaryFallback.set(summaryCacheKey, payload)
    return payload
  } catch (error) {
    const fallback = kiaSalesReportSummaryFallback.get(summaryCacheKey)
    if (fallback) {
      console.warn('[kia-sales-report:summary] serving last known good snapshot after live read failure', {
        dealerCode: normalizedDealerCode || 'all',
        rangeKey: context.key,
        message: error instanceof Error ? error.message : String(error),
      })
      return fallback
    }
    throw error
  }
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? '')
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function normalizePage(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeReportKey(value: string | null | undefined): ReportKey {
  return value === 'booking' || value === 'sales' || value === 'accessories' ? value : 'enquiry'
}

function normalizeSortColumn(config: TableConfig, requested: string | null, knownColumns: string[]) {
  const normalized = safeText(requested)
  return knownColumns.includes(normalized) ? normalized : config.sortColumn
}

function normalizeSortDirection(value: string | null) {
  return safeText(value).toLowerCase() === 'asc' ? 'asc' : 'desc'
}

function buildSearchClause(config: TableConfig, search: string) {
  const trimmed = safeText(search)
  if (!trimmed) return sql``
  const pattern = `%${trimmed}%`
  const expressions = config.searchColumns.map((column) => sql`${sql.raw(column)}::text ILIKE ${pattern}`)
  return sql`AND (${sql.join(expressions, sql` OR `)})`
}

function buildOptionalFilter(column: string | undefined, value: string | null | undefined) {
  const trimmed = safeText(value)
  if (!column || !trimmed || trimmed === 'all') return sql``
  return sql`AND UPPER(TRIM(COALESCE(${sql.raw(column)}::text, ''))) = ${upperText(trimmed)}`
}

function buildDateClause(config: TableConfig, context: ResolvedDateContext) {
  return sql`${sql.raw(config.dateColumn)} >= ${context.startDate} AND ${sql.raw(config.dateColumn)} < ${context.endDateExclusive}`
}

function toColumnLabel(column: string) {
  return column
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export async function getKiaSalesReportTable(input: {
  report?: string | null
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  source?: string | null
  model?: string | null
  consultant?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
  page?: string | null
  pageSize?: string | null
  filters?: Record<string, string[]> | null
  missedFollowups?: boolean | null
  canViewPii?: boolean
}) {
  const report = resolveReportKey(input.report)
  const config = getReportConfig(report)
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const context = await resolveDateContext({
    year: input.year,
    month: input.month,
    startDate: input.startDate,
    endDate: input.endDate,
    dealerCode,
  })

  const columns = await analyticsTableColumns(config.table)
  const sortColumn = normalizeSortColumn(config, input.sort || null, columns)
  const direction = normalizeSortDirection(input.direction || null)
  const page = normalizePage(input.page || null, 1)
  const pageSize = Math.min(100, normalizePage(input.pageSize || null, 25))

  const filterKey = Object.entries(input.filters || {})
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([col, vals]) => `${col}:${(vals || []).join(',')}`)
    .join('|')

  const cacheKey = `kia:sales-report:table:${report}:${context.key}:${dealerCode || 'all'}:${input.source || 'all'}:${input.model || 'all'}:${input.consultant || 'all'}:${input.search || ''}:${sortColumn}:${direction}:${page}:${pageSize}:${filterKey}:${input.missedFollowups ? 'true' : 'false'}`

  return getCachedData(
    cacheKey,
    async () => {
      const offset = (page - 1) * pageSize

      const whereParts = [
        buildDateClause(config, context),
        buildDealerClause(config, dealerCode),
        buildSearchClause(config, safeText(input.search)),
      ]

      const whereSql = sql.join(whereParts.filter(Boolean), sql` `)
      const rows = await analyticsDb.execute(sql`
        SELECT *
        FROM ${sql.raw(config.table)}
        WHERE ${whereSql}
      `)
      let dedupedRows = dedupeRows(config, resultRows(rows))

      // Test Drives report: keep only enquiry rows whose td_status is "Done".
      if (report === 'test_drives') dedupedRows = dedupedRows.filter(isTestDriveDone)

      if (input.source && config.sourceColumn) {
        dedupedRows = dedupedRows.filter((row) => {
          return upperText(row[config.sourceColumn!]) === upperText(input.source)
        })
      }
      if (input.model && config.modelColumn) {
        dedupedRows = dedupedRows.filter((row) => {
          return upperText(row[config.modelColumn!]) === upperText(input.model)
        })
      }
      if (input.consultant && config.consultantColumn) {
        dedupedRows = dedupedRows.filter((row) => {
          return upperText(row[config.consultantColumn!]) === upperText(input.consultant)
        })
      }

      // Extract unique values from dedupedRows for each column before filters/missedFollowups are applied
      const uniqueValues: Record<string, string[]> = {}
      for (const col of columns) {
        const valuesSet = new Set<string>()
        for (const row of dedupedRows) {
          const rawVal = row[col]
          let val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
          if (input.canViewPii === false && (col === 'phone' || col === 'customerPhone' || col === 'customerEmail' || col === 'email')) {
            val = val ? '••••••' : ''
          }
          valuesSet.add(val)
        }
        uniqueValues[col] = Array.from(valuesSet).sort((a, b) => a.localeCompare(b))
      }

      // Filter for missed follow ups
      let filteredRows = dedupedRows
      if (input.missedFollowups && report === 'enquiry') {
        const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`
        filteredRows = dedupedRows.filter((row) => isMissedFollowupEnquiry(row, todayStr))
      }

      // Apply column-level filters
      if (input.filters && Object.keys(input.filters).length > 0) {
        filteredRows = filteredRows.filter((row) => {
          return Object.entries(input.filters!).every(([col, selectedVals]) => {
            if (!selectedVals || selectedVals.length === 0) return true
            const rawVal = row[col]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
            return selectedVals.includes(val)
          })
        })
      }

      const sortedRows = sortRows(filteredRows, sortColumn, direction)
      const totalRows = sortedRows.length
      const pagedRows = sortedRows
        .slice(offset, offset + pageSize)
        .map((row) => {
          const norm = normalizeRowForOutput(row, columns)
          if (input.canViewPii === false) {
            if (norm.phone) norm.phone = '••••••'
            if (norm.customerPhone) norm.customerPhone = '••••••'
            if (norm.customerEmail) norm.customerEmail = '••••••'
            if (norm.email) norm.email = '••••••'
          }
          return norm
        })

      return {
        report,
        title: config.label,
        columns,
        defaultVisibleColumns: config.defaultVisibleColumns.filter((column) => columns.includes(column)),
        rows: pagedRows,
        uniqueValues,
        pagination: {
          page,
          pageSize,
          totalRows,
          totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
        },
      } satisfies SalesReportListPayload
    },
    CACHE_TTL.SHORT
  )
}

export async function getKiaSalesReportCsv(input: {
  report?: string | null
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  source?: string | null
  model?: string | null
  consultant?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
  filters?: Record<string, string[]> | null
  missedFollowups?: boolean | null
  canViewPii?: boolean
}) {
  const report = resolveReportKey(input.report)
  const config = getReportConfig(report)
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const context = await resolveDateContext({
    year: input.year,
    month: input.month,
    startDate: input.startDate,
    endDate: input.endDate,
    dealerCode,
  })

  const columns = await analyticsTableColumns(config.table)
  const sortColumn = normalizeSortColumn(config, input.sort || null, columns)
  const direction = normalizeSortDirection(input.direction || null)
  const whereParts = [
    buildDateClause(config, context),
    buildDealerClause(config, dealerCode),
    buildSearchClause(config, safeText(input.search)),
  ]
  const whereSql = sql.join(whereParts.filter(Boolean), sql` `)
  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${whereSql}
    LIMIT 20000
  `)
  let dedupedRows = dedupeRows(config, resultRows(rows))

  // Test Drives report: keep only enquiry rows whose td_status is "Done".
  if (report === 'test_drives') dedupedRows = dedupedRows.filter(isTestDriveDone)

  if (input.source && config.sourceColumn) {
    dedupedRows = dedupedRows.filter((row) => {
      return upperText(row[config.sourceColumn!]) === upperText(input.source)
    })
  }
  if (input.model && config.modelColumn) {
    dedupedRows = dedupedRows.filter((row) => {
      return upperText(row[config.modelColumn!]) === upperText(input.model)
    })
  }
  if (input.consultant && config.consultantColumn) {
    dedupedRows = dedupedRows.filter((row) => {
      return upperText(row[config.consultantColumn!]) === upperText(input.consultant)
    })
  }

  // Filter for missed follow ups
  let filteredRows = dedupedRows
  if (input.missedFollowups && report === 'enquiry') {
    const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`
    filteredRows = dedupedRows.filter((row) => isMissedFollowupEnquiry(row, todayStr))
  }

  // Apply column-level filters
  if (input.filters && Object.keys(input.filters).length > 0) {
    filteredRows = filteredRows.filter((row) => {
      return Object.entries(input.filters!).every(([col, selectedVals]) => {
        if (!selectedVals || selectedVals.length === 0) return true
        const rawVal = row[col]
        const val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
        return selectedVals.includes(val)
      })
    })
  }

  const normalizedRows = sortRows(filteredRows, sortColumn, direction)
    .map((row) => {
      const norm = normalizeRowForOutput(row, columns)
      if (input.canViewPii === false) {
        if (norm.phone) norm.phone = '••••••'
        if (norm.customerPhone) norm.customerPhone = '••••••'
        if (norm.customerEmail) norm.customerEmail = '••••••'
        if (norm.email) norm.email = '••••••'
      }
      return norm
    })
  const csvLines = [
    columns.map(escapeCsvCell).join(','),
    ...normalizedRows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(',')),
  ]
  return {
    fileName: `kia-${report}-${context.key.replace(/:/g, '_')}.csv`,
    content: csvLines.join('\n'),
  } satisfies SalesReportCsvPayload
}

export function getKiaSalesReportColumnLabels(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [column, toColumnLabel(column)]))
}
