import 'server-only'

import { sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { analyticsDb } from '@/lib/analytics/db'
import { analyticsTableColumns } from '@/lib/analytics/table-columns'
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

type Row = Record<string, unknown>

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

const KIA_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS = 60 * 10
const ALL_DEALERS_CACHE_KEY = '__all__'
const kiaSalesReportFreshnessFallback = new Map<string, SalesReportFreshnessPayload>()

const TABLES: Record<SourceKey, TableConfig> = {
  enquiry: {
    key: 'enquiry',
    label: 'Enquiry Report',
    table: 'kia_enquiry_report',
    dateColumn: 'enquiry_date',
    dealerColumns: ['dealer_code', 'main_dealer_code', 'dealer_code_2'],
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
    table: 'kia_booking_report',
    dateColumn: 'booking_date',
    dealerColumns: ['dealer_code', 'main_dealer', 'dealer_code_2'],
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
    table: 'kia_sales_report',
    dateColumn: 'delivery_date',
    dealerColumns: ['dealer_code', 'main_dealer_code', 'dealer_code_2'],
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
    table: 'kia_accessories_counter_sales_report',
    dateColumn: 'csr_bill_date',
    dealerColumns: ['dealer_code', 'dealer_code_2'],
    defaultVisibleColumns: ['csr_bill_date', 'csr_bill_no', 'accessories_invoice_no', 'customer_name', 'customer_mobile', 'model', 'variant', 'vin', 'accessories_description', 'accessories_qty', 'accessory_taxable_amount', 'tax_amount', 'bill_status'],
    searchColumns: ['csr_bill_no', 'accessories_invoice_no', 'customer_name', 'customer_mobile', 'model', 'variant', 'vin', 'reg_no', 'accessories_description'],
    modelColumn: 'model',
    sortColumn: 'csr_bill_date',
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

function displayDate(value: unknown) {
  const text = safeText(value)
  if (!text) return null
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return text
  return date.toISOString().slice(0, 10)
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
  const status = safeText(row.enquiry_status).toLowerCase()
  return Boolean(
    displayDate(row.lost_date)
    || safeText(row.lost_reason)
    || safeText(row.lost_due_to)
    || safeText(row.lost_remark)
    || status.includes('cancel')
    || status.includes('lost')
  )
}

function isTestDriveDone(row: Row) {
  return Boolean(
    displayDate(row.test_drive_date)
    || displayDate(row.td_appointment_date_and_time)
    || numberValue(row.no_of_test_drive_given) > 0
    || safeText(row.td_status).toLowerCase().includes('done')
  )
}

function getLeadTemperature(row: Row): TemperatureKey {
  if (displayDate(row.booking_date) || displayDate(row.retail_date) || displayDate(row.delivery_date)) return 'Hot'
  if (isTestDriveDone(row) || numberValue(row.followup_count) >= 2) return 'Warm'
  return 'Cold'
}

function getAccessoriesRevenue(row: Row) {
  return numberValue(row.accessory_taxable_amount) + numberValue(row.tax_amount)
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

function buildDealerClause(columns: string[], dealerCode: string | null) {
  if (!dealerCode) return sql``
  const expression = `UPPER(TRIM(COALESCE(${columns.map((column) => `NULLIF(${column}, '')`).join(', ')}, '')))`
  return sql.raw(`AND ${expression} = '${dealerCode}'`)
}

async function queryCurrentAndPreviousMonthRows(config: TableConfig, year: number, month: number, dealerCode: string | null) {
  const currentWindow = buildMonthWindow(year, month)
  const previous = previousMonth(year, month)
  const previousWindow = buildMonthWindow(previous.year, previous.month)
  const currentKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const previousKey = `${previous.year}-${String(previous.month + 1).padStart(2, '0')}`
  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${sql.raw(config.dateColumn)} >= ${previousWindow.startDate}
      AND ${sql.raw(config.dateColumn)} < ${currentWindow.endDateExclusive}
      ${buildDealerClause(config.dealerColumns, dealerCode)}
  `)

  const currentRows: Row[] = []
  const previousRows: Row[] = []
  for (const row of resultRows(rows)) {
    const date = displayDate(row[config.dateColumn])
    if (!date) continue
    const rowMonthKey = date.slice(0, 7)
    if (rowMonthKey === currentKey) {
      currentRows.push(row)
      continue
    }
    if (rowMonthKey === previousKey) {
      previousRows.push(row)
    }
  }

  return { currentRows, previousRows }
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
      ${buildDealerClause(config.dealerColumns, dealerCode)}
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

async function buildKiaSalesReportFreshness(normalizedDealerCode: string | null) {
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

const readCachedKiaSalesReportFreshness = unstable_cache(
  async (dealerCodeKey: string) => {
    const normalizedDealerCode = dealerCodeKey === ALL_DEALERS_CACHE_KEY ? null : dealerCodeKey
    return await buildKiaSalesReportFreshness(normalizedDealerCode)
  },
  ['kia-sales-report-freshness-v3'],
  { revalidate: KIA_SALES_REPORT_FRESHNESS_CACHE_TTL_SECONDS }
)

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

export async function getKiaSalesReportFreshness(dealerCode?: string | null) {
  const normalizedDealerCode = normalizeKiaDealerCode(dealerCode) || null
  const cacheKey = normalizedDealerCode || ALL_DEALERS_CACHE_KEY

  try {
    const payload = await readCachedKiaSalesReportFreshness(cacheKey)
    kiaSalesReportFreshnessFallback.set(cacheKey, payload)
    return payload
  } catch (error) {
    const fallback = kiaSalesReportFreshnessFallback.get(cacheKey)
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

function buildKpi(
  label: string,
  value: number,
  previousValue: number,
  formattedValue = value.toLocaleString('en-IN'),
  formattedComparisonValue = previousValue.toLocaleString('en-IN'),
  comparisonLabel = 'Previous month'
) {
  const pct = changePct(value, previousValue)
  return {
    label,
    value,
    formattedValue,
    comparisonValue: previousValue,
    formattedComparisonValue,
    comparisonLabel,
    changePct: pct,
    changeLabel: formatPercent(pct),
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

export async function getKiaSalesReportSummary(input: {
  year?: number | null
  month?: number | null
  dealerCode?: string | null
}) {
  const normalizedDealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const resolvedMonth = await resolveMonthContext(input.year, input.month, normalizedDealerCode)

  const previous = previousMonth(resolvedMonth.year, resolvedMonth.month)
  const previousLabel = monthLabel(previous.year, previous.month)
  const [
    enquiryBundle,
    bookingBundle,
    salesBundle,
    accessoryBundle,
  ] = await Promise.all([
    queryCurrentAndPreviousMonthRows(TABLES.enquiry, resolvedMonth.year, resolvedMonth.month, normalizedDealerCode),
    queryCurrentAndPreviousMonthRows(TABLES.booking, resolvedMonth.year, resolvedMonth.month, normalizedDealerCode),
    queryCurrentAndPreviousMonthRows(TABLES.sales, resolvedMonth.year, resolvedMonth.month, normalizedDealerCode),
    queryCurrentAndPreviousMonthRows(TABLES.accessories, resolvedMonth.year, resolvedMonth.month, normalizedDealerCode),
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

      const enquiryStatusMap = new Map<string, number>()
      const sourceMap = new Map<string, number>()
      const dealerMap = new Map<string, number>()
      const temperatureMap = new Map<TemperatureKey, number>([['Hot', 0], ['Warm', 0], ['Cold', 0]])
      const modelMap = new Map<string, number>()
      const modelBySourceMap = new Map<string, Map<string, number>>()
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
        const dealer = upperText(getFirstText(row, ['dealer_code', 'main_dealer_code', 'dealer_code_2'])) || 'Unknown'
        const model = normalizeModel(row.model)
        const consultant = normalizeConsultant(row.consultant_name)
        const date = displayDate(row.enquiry_date)
        increment(sourceMap, source)
        increment(dealerMap, dealer)
        increment(modelMap, model)
        if (!modelBySourceMap.has(source)) modelBySourceMap.set(source, new Map())
        increment(modelBySourceMap.get(source) as Map<string, number>, model)
        increment(temperatureMap as Map<string, number>, getLeadTemperature(row))
        if (date) increment(dailyMap, date)

        const current = teamBase.get(consultant) || {
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
        teamBase.set(consultant, current)
      }

      for (const row of bookingRows) {
        const source = normalizeSource(getFirstText(row, ['main_source', 'source']))
        const consultant = normalizeConsultant(row.consultant_name)
        const model = normalizeModel(row.model)
        increment(bookingsBySource, source)
        increment(bookingsByConsultant, consultant)
        increment(bookingsByModel, model)
        if (!bookingsBySourceModel.has(source)) bookingsBySourceModel.set(source, new Map())
        increment(bookingsBySourceModel.get(source) as Map<string, number>, model)
        const current = teamBase.get(consultant) || {
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
        teamBase.set(consultant, current)
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
        .sort((left, right) => right.enquiries - left.enquiries)

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
        { label: 'Total Revenue', value: salesRows.reduce((sum, row) => sum + numberValue(row.ex_showroom_price), 0), formattedValue: formatLakhs(salesRows.reduce((sum, row) => sum + numberValue(row.ex_showroom_price), 0)) },
        { label: 'Avg Price / Car', value: retails > 0 ? salesRows.reduce((sum, row) => sum + numberValue(row.ex_showroom_price), 0) / retails : 0, formattedValue: formatLakhs(retails > 0 ? salesRows.reduce((sum, row) => sum + numberValue(row.ex_showroom_price), 0) / retails : 0) },
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

      return {
        context: {
          selectedMonthKey: resolvedMonth.key,
          selectedMonthLabel: resolvedMonth.label,
          comparisonMonthKey: `${previous.year}-${String(previous.month + 1).padStart(2, '0')}`,
          comparisonMonthLabel: previousLabel,
        },
        assumptions: [
          'Lead temperature is derived from booking, retail, test drive, and follow-up signals.',
          'Average delivery days uses booking-to-delivery gap from sales rows when both dates are present.',
          'Accessories per car and cross-sell match accessory rows to retail transactions by VIN.',
        ],
        overview: {
          kpis: [
            buildKpi('Total Enquiries', totalEnquiries, previousEnquiryRows.length, totalEnquiries.toLocaleString('en-IN'), previousEnquiryRows.length.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Bookings', totalBookings, previousBookingRows.length, totalBookings.toLocaleString('en-IN'), previousBookingRows.length.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Retails', retails, previousRetails, retails.toLocaleString('en-IN'), previousRetails.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Test Drives', totalTestDrives, previousTdRows.length, totalTestDrives.toLocaleString('en-IN'), previousTdRows.length.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Lost', totalLost, previousLostRows.length, totalLost.toLocaleString('en-IN'), previousLostRows.length.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Exchange Opted', exchangeCount, previousExchangeCount, exchangeCount.toLocaleString('en-IN'), previousExchangeCount.toLocaleString('en-IN'), `Vs ${previousLabel}`),
            buildKpi('Acc Revenue', accessoriesRevenue, previousAccessoriesRevenue, formatCurrency(accessoriesRevenue), formatCurrency(previousAccessoriesRevenue), `Vs ${previousLabel}`),
            buildKpi('Acc / Car', totalAccPerCar, previousAccPerCar, formatCurrency(totalAccPerCar), formatCurrency(previousAccPerCar), `Vs ${previousLabel}`),
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
            values: sourceCards.map((item) => ({ source: item.source, enquiries: item.enquiries })),
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
          trendNote: `${monthLabel(resolvedMonth.year, resolvedMonth.month)} · Peak: ${trendPeak.day ? `${trendPeak.day} (${trendPeak.enquiries})` : 'N/A'} · Avg: ${trendAverage.toFixed(1)}/day`,
        },
        lost: {
          totalLost,
          lostRatePct: percent(totalLost, totalEnquiries),
          lostRateChangePct: changePct(percent(totalLost, totalEnquiries), percent(previousLostRows.length, previousEnquiryRows.length)),
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
      } satisfies SalesReportSummaryPayload
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

function buildDateClause(config: TableConfig, year: number, month: number) {
  const { startDate, endDateExclusive } = buildMonthWindow(year, month)
  return sql`${sql.raw(config.dateColumn)} >= ${startDate} AND ${sql.raw(config.dateColumn)} < ${endDateExclusive}`
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
  dealerCode?: string | null
  source?: string | null
  model?: string | null
  consultant?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
  page?: string | null
  pageSize?: string | null
}) {
  const report = normalizeReportKey(input.report)
  const config = TABLES[report]
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const resolvedMonth = await resolveMonthContext(input.year, input.month, dealerCode)

  const columns = await analyticsTableColumns(config.table)
  const sortColumn = normalizeSortColumn(config, input.sort || null, columns)
  const direction = normalizeSortDirection(input.direction || null)
  const page = normalizePage(input.page || null, 1)
  const pageSize = Math.min(100, normalizePage(input.pageSize || null, 25))
  const offset = (page - 1) * pageSize

  const whereParts = [
    buildDateClause(config, resolvedMonth.year, resolvedMonth.month),
    buildDealerClause(config.dealerColumns, dealerCode),
    buildSearchClause(config, safeText(input.search)),
    buildOptionalFilter(config.sourceColumn, input.source),
    buildOptionalFilter(config.modelColumn, input.model),
    buildOptionalFilter(config.consultantColumn, input.consultant),
  ]

  const whereSql = sql.join(whereParts.filter(Boolean), sql` `)
  const totalRowsResult = await analyticsDb.execute(sql`
    SELECT COUNT(*)::int AS total_rows
    FROM ${sql.raw(config.table)}
    WHERE ${whereSql}
  `)
  const totalRows = numberValue(resultRows(totalRowsResult)[0]?.total_rows)
  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${whereSql}
    ORDER BY ${sql.raw(sortColumn)} ${sql.raw(direction)}
    LIMIT ${pageSize}
    OFFSET ${offset}
  `)

  return {
    report,
    title: config.label,
    columns,
    defaultVisibleColumns: config.defaultVisibleColumns.filter((column) => columns.includes(column)),
    rows: resultRows(rows),
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    },
  } satisfies SalesReportListPayload
}

export async function getKiaSalesReportCsv(input: {
  report?: string | null
  year?: number | null
  month?: number | null
  dealerCode?: string | null
  source?: string | null
  model?: string | null
  consultant?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
}) {
  const report = normalizeReportKey(input.report)
  const config = TABLES[report]
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const resolvedMonth = await resolveMonthContext(input.year, input.month, dealerCode)

  const columns = await analyticsTableColumns(config.table)
  const sortColumn = normalizeSortColumn(config, input.sort || null, columns)
  const direction = normalizeSortDirection(input.direction || null)
  const whereParts = [
    buildDateClause(config, resolvedMonth.year, resolvedMonth.month),
    buildDealerClause(config.dealerColumns, dealerCode),
    buildSearchClause(config, safeText(input.search)),
    buildOptionalFilter(config.sourceColumn, input.source),
    buildOptionalFilter(config.modelColumn, input.model),
    buildOptionalFilter(config.consultantColumn, input.consultant),
  ]
  const whereSql = sql.join(whereParts.filter(Boolean), sql` `)
  const rows = await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(config.table)}
    WHERE ${whereSql}
    ORDER BY ${sql.raw(sortColumn)} ${sql.raw(direction)}
    LIMIT 20000
  `)
  const normalizedRows = resultRows(rows)
  const csvLines = [
    columns.map(escapeCsvCell).join(','),
    ...normalizedRows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(',')),
  ]
  return {
    fileName: `kia-${report}-${resolvedMonth.key}.csv`,
    content: csvLines.join('\n'),
  } satisfies SalesReportCsvPayload
}

export function getKiaSalesReportColumnLabels(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [column, toColumnLabel(column)]))
}
