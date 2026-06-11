export type BusinessDatePreset =
  | 'today'
  | 'yesterday'
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | 'last_7_days'
  | 'last_30_days'
  | 'current_month'
  | 'previous_month'
  | 'current_quarter'
  | 'current_fy'
  | 'custom'

export type BusinessDateRange = {
  startDate: string
  endDate: string
}

export type BusinessComparisonSelection = {
  previousStartDate?: string
  previousEndDate?: string
}

export type BusinessDateFilterValue = BusinessDateRange & {
  mode: 'preset' | 'custom' | 'month' | 'range' | 'year'
  preset: BusinessDatePreset
  month: number
  year: number
  comparison: BusinessComparisonSelection
}

export type BusinessDatasetKey =
  | 'ro_billing_report'
  | 'rsa_report'
  | 'adv_wise_lubricants_vas'
  | 'kia_call_center_complaints'
  | 'operation_wise_analysis_report'
  | 'operation_wise_analysis_advisor_report'
  | 'open_ro_yearly'
  | 'ew_report'
  | 'mcp_report'
  | 'psf_yearly'

export const BUSINESS_DATE_PRESETS: Array<{ value: BusinessDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'mtd', label: 'MTD' },
  { value: 'qtd', label: 'QTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'current_month', label: 'Current Month' },
  { value: 'previous_month', label: 'Previous Month' },
  { value: 'current_quarter', label: 'Current Quarter' },
  { value: 'current_fy', label: 'Current FY' },
  { value: 'custom', label: 'Custom Range' },
]

export const BUSINESS_DATASET_COVERAGE: Record<BusinessDatasetKey, { dateColumn: string; minDate: string; maxDate: string; historical: boolean; reason?: string }> = {
  ro_billing_report: { dateColumn: 'bill_date', minDate: '2025-03-03', maxDate: '2026-05-29', historical: true },
  rsa_report: { dateColumn: 'invoice_date', minDate: '2025-04-24', maxDate: '2026-05-25', historical: true },
  adv_wise_lubricants_vas: { dateColumn: 'gst_invoice_date / ro_close_date', minDate: '2025-03-06', maxDate: '2026-04-30', historical: true },
  kia_call_center_complaints: { dateColumn: 'complaint_date', minDate: '2025-04-17', maxDate: '2026-05-27', historical: true },
  operation_wise_analysis_report: { dateColumn: 'report_month', minDate: '2025-03-01', maxDate: '2026-05-01', historical: true },
  operation_wise_analysis_advisor_report: { dateColumn: 'report_month', minDate: '2025-03-01', maxDate: '2026-05-01', historical: true },
  open_ro_yearly: { dateColumn: 'ro_date', minDate: '2026-04-01', maxDate: '2026-05-29', historical: false, reason: 'Open RO has only current-year operational WIP history.' },
  ew_report: { dateColumn: 'invoice_date', minDate: '2026-05-01', maxDate: '2026-05-31', historical: false, reason: 'EW has only May 2026 data.' },
  mcp_report: { dateColumn: 'invoice_date', minDate: '2025-07-01', maxDate: '2026-05-25', historical: false, reason: 'MCP is close to one year but not enough for full LY comparisons yet.' },
  psf_yearly: { dateColumn: 'complaint_date', minDate: '2026-03-01', maxDate: '2026-05-31', historical: false, reason: 'PSF starts from March 2026.' },
}

export function toBusinessDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseBusinessDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function getBusinessMonthToDateRange(today = new Date()): BusinessDateRange {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return {
    startDate: toBusinessDate(new Date(current.getFullYear(), current.getMonth(), 1)),
    endDate: toBusinessDate(current),
  }
}

export function getBusinessYearRange(year: number, today = new Date()): BusinessDateRange {
  const currentYear = today.getFullYear()
  const endDate = year === currentYear
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
    : new Date(year, 11, 31)

  return {
    startDate: toBusinessDate(new Date(year, 0, 1)),
    endDate: toBusinessDate(endDate),
  }
}

export function normalizeBusinessYear(value: string | number | null | undefined, minYear: number, today = new Date()) {
  const year = typeof value === 'number' ? value : Number(value)
  const currentYear = today.getFullYear()
  if (!Number.isInteger(year) || year < minYear || year > currentYear) return null
  return year
}

export function getBusinessAvailableYears(minYear: number, today = new Date()) {
  const currentYear = today.getFullYear()
  return Array.from({ length: Math.max(currentYear - minYear + 1, 1) }, (_, index) => minYear + index)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfQuarter(date: Date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
}

function endOfQuarter(date: Date) {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0)
}

function startOfFinancialYear(date: Date) {
  return new Date(date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1, 3, 1)
}

export function getBusinessPresetRange(preset: BusinessDatePreset, today = new Date()): BusinessDateRange {
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  switch (preset) {
    case 'today':
      return { startDate: toBusinessDate(current), endDate: toBusinessDate(current) }
    case 'yesterday': {
      const yesterday = addDays(current, -1)
      return { startDate: toBusinessDate(yesterday), endDate: toBusinessDate(yesterday) }
    }
    case 'last_7_days':
      return { startDate: toBusinessDate(addDays(current, -6)), endDate: toBusinessDate(current) }
    case 'last_30_days':
      return { startDate: toBusinessDate(addDays(current, -29)), endDate: toBusinessDate(current) }
    case 'previous_month': {
      const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1)
      return { startDate: toBusinessDate(previous), endDate: toBusinessDate(new Date(previous.getFullYear(), previous.getMonth() + 1, 0)) }
    }
    case 'current_quarter':
      return { startDate: toBusinessDate(startOfQuarter(current)), endDate: toBusinessDate(endOfQuarter(current)) }
    case 'current_fy':
      return { startDate: toBusinessDate(startOfFinancialYear(current)), endDate: toBusinessDate(current) }
    case 'qtd':
      return { startDate: toBusinessDate(startOfQuarter(current)), endDate: toBusinessDate(current) }
    case 'ytd':
      return { startDate: toBusinessDate(new Date(current.getFullYear(), 0, 1)), endDate: toBusinessDate(current) }
    case 'mtd':
    case 'current_month':
    case 'custom':
    default:
      return getBusinessMonthToDateRange(current)
  }
}

export function businessComparisonSelection(customComparison?: Partial<BusinessDateRange>): BusinessComparisonSelection {
  return customComparison?.startDate && customComparison?.endDate
    ? { previousStartDate: customComparison.startDate, previousEndDate: customComparison.endDate }
    : {}
}

export function buildBusinessDateFilter(preset: BusinessDatePreset, customRange?: Partial<BusinessDateRange>, customComparison?: Partial<BusinessDateRange>): BusinessDateFilterValue {
  const baseRange = preset === 'custom' && customRange?.startDate && customRange?.endDate
    ? { startDate: customRange.startDate, endDate: customRange.endDate }
    : getBusinessPresetRange(preset)
  const currentStart = parseBusinessDate(baseRange.startDate) || new Date()

  return {
    mode: preset === 'custom' ? 'custom' : 'preset',
    preset,
    month: currentStart.getMonth(),
    year: currentStart.getFullYear(),
    startDate: baseRange.startDate,
    endDate: baseRange.endDate,
    comparison: businessComparisonSelection(customComparison),
  }
}

export function buildBusinessYearDateFilter(year: number, customComparison?: Partial<BusinessDateRange>, today = new Date()): BusinessDateFilterValue {
  const range = getBusinessYearRange(year, today)

  return {
    mode: 'year',
    preset: 'custom',
    month: 0,
    year,
    startDate: range.startDate,
    endDate: range.endDate,
    comparison: businessComparisonSelection(customComparison),
  }
}

export function getEffectiveBusinessDateFilter(dateFilter?: BusinessDateFilterValue | null) {
  return dateFilter || buildBusinessDateFilter('mtd')
}

export function appendBusinessComparisonParams(params: URLSearchParams, dateFilter?: { preset?: string; comparison?: BusinessComparisonSelection } | null) {
  if (!dateFilter) return params
  if (dateFilter.preset) params.set('periodPreset', dateFilter.preset)
  if (dateFilter.comparison?.previousStartDate && dateFilter.comparison?.previousEndDate) {
    params.set('comparisonMode', 'custom')
    params.set('compareStartDate', dateFilter.comparison.previousStartDate)
    params.set('compareEndDate', dateFilter.comparison.previousEndDate)
    params.set('comparisonStartDate', dateFilter.comparison.previousStartDate)
    params.set('comparisonEndDate', dateFilter.comparison.previousEndDate)
  } else {
    params.delete('comparisonMode')
    params.delete('compareStartDate')
    params.delete('compareEndDate')
    params.delete('comparisonStartDate')
    params.delete('comparisonEndDate')
  }
  return params
}

export function calculateGrowthPercent(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / previous) * 100
}
