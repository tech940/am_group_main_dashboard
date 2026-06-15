import 'server-only'

import { createHash } from 'crypto'
import { sql, type SQL } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'

export type HyundaiBranch = 'all' | 'jammu' | 'udhampur'
export type HyundaiMetric = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'

export type HyundaiDateFilters = {
  startDate: string
  endDate: string
  compareStartDate: string
  compareEndDate: string
  branch: HyundaiBranch
  dealerCode: string
}

export const HYUNDAI_BRANCH_DEALERS = {
  jammu: ['N5216', 'N6846', 'N6847'],
  udhampur: ['N5217', 'N6848', 'N6849'],
} as const

export const HYUNDAI_REPORTS = [
  { value: 'overview', label: 'Business Excellence Overview', path: '/brands/hyundai/business-excellence/overview', supported: true },
  { value: 'executive-dashboard', label: 'Executive Dashboard', path: '/brands/hyundai/business-excellence/executive-dashboard', supported: true },
  { value: 'ro-billing-report', label: 'RO Billing Report', path: '/brands/hyundai/business-excellence/ro-billing-report', supported: true },
  { value: 'open-ro', label: 'Open RO (Repair Orders)', path: '/brands/hyundai/business-excellence/open-ro', supported: true },
  { value: 'workshop-performance', label: 'Workshop Performance', path: '/brands/hyundai/business-excellence/workshop-performance', supported: true },
  { value: 'hyundai-complaints', label: 'Hyundai Complaints', path: '/brands/hyundai/business-excellence/hyundai-complaints', supported: true },
] as const

export const HYUNDAI_METRICS: Array<{ value: HyundaiMetric; label: string }> = [
  { value: 'load', label: 'Load' },
  { value: 'labour', label: 'Labour' },
  { value: 'parts', label: 'Parts' },
  { value: 'lab_per_veh', label: 'Lab / Veh' },
  { value: 'part_per_veh', label: 'Part / Veh' },
]

type ResultRow = Record<string, unknown>

type RawBillingRow = {
  date: string
  roKey: string
  workType: string
  advisor: string
  labour: number
  parts: number
  total: number
  discount: number
  dealerCode: string
}

type RawOpenRoRow = {
  roNo: string
  roDate: string
  regNo: string
  vin: string
  model: string
  workType: string
  advisor: string
  technician: string
  status: string
  newStatus: string
  subStatus: string
  delayReason: string
  promiseDate: string
  closingDate: string
  cancelDate: string
  dealerCode: string
}

type Accumulator = {
  loadKeys: Set<string>
  labour: number
  parts: number
  total: number
  discount: number
}

type MetricWindow = {
  cy: number
  ly: number
  growth: number | null
}

type ServiceMetricRow = {
  serviceType: string
  isTotal: boolean
  td: number
  mtd: MetricWindow
  qtd: MetricWindow
  ytd: MetricWindow
}

type ServiceTypeKey = 'Paid Service' | 'Free Services' | 'Running Repairs' | 'MECH' | 'Others' | 'MECH TOTAL' | 'Accident' | 'Grand Total'

const SERVICE_TYPE_ORDER: ServiceTypeKey[] = ['Paid Service', 'Free Services', 'Running Repairs', 'MECH', 'Others', 'MECH TOTAL', 'Accident', 'Grand Total']

type BillingAnalysisPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    filters: HyundaiDateFilters
    warning?: string
  }
  summary: {
    load: number
    labour: number
    parts: number
    revenue: number
    averageBilling: number
    labourPerVehicle: number
    partsPerVehicle: number
    discount: number
  }
  comparisonSummary: {
    load: number
    labour: number
    parts: number
    revenue: number
    averageBilling: number
    labourPerVehicle: number
    partsPerVehicle: number
    discount: number
  }
  byMetric: Record<HyundaiMetric, ServiceMetricRow[]>
  trend: {
    metric: HyundaiMetric
    points: Array<{ date: string; label: string; cy: number; ly: number; target: number }>
    stats: {
      monthTarget: number
      mtdTarget: number
      mtdAchieved: number
      shortfallTd: number
      monthlyShortfall: number
      projectedClosing: number
      askingRate: number
    }
  }
  fyTrend: Array<{
    financialYear: string
    load: number
    labour: number
    parts: number
    revenue: number
    labPerVeh: number
    partPerVeh: number
  }>
  leaderboard: Array<{
    advisor: string
    load: number
    labour: number
    parts: number
    revenue: number
  }>
}

export type HyundaiOpenRoPayload = {
  meta: {
    source: string
    generatedAt: string
    sourceUpdatedAt: string | null
    filters: HyundaiDateFilters
    warning?: string
  }
  summary: {
    totalOpenRo: number
    averageAging: number
    delayedRo: number
    over15Days: number
    accidentJobs: number
    runningRepairs: number
  }
  agingRows: Array<{
    serviceType: string
    totalWip: number
    bucket0to4: number
    bucket5to7: number
    bucket8to15: number
    bucketOver15: number
    avgDays: number
    vehicles: Array<{
      roNo: string
      regNo: string
      vin: string
      model: string
      advisor: string
      technician: string
      status: string
      reason: string
      agingDays: number
      agingCategory: string
    }>
  }>
  delaySummary: Array<{
    status: string
    reason: string
    count: number
    mechCount: number
    accidentCount: number
    avgDays: number
  }>
}

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function normalizedDate(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function todayInput() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function parseYmd(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatYmd(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function addYears(value: string, years: number) {
  const date = parseYmd(value)
  const year = date.getUTCFullYear() + years
  const month = date.getUTCMonth()
  const day = Math.min(date.getUTCDate(), daysInMonth(year, month))
  return formatYmd(new Date(Date.UTC(year, month, day)))
}

function firstOfMonth(value: string) {
  const date = parseYmd(value)
  return formatYmd(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)))
}

function firstOfQuarter(value: string) {
  const date = parseYmd(value)
  const quarterStart = Math.floor(date.getUTCMonth() / 3) * 3
  return formatYmd(new Date(Date.UTC(date.getUTCFullYear(), quarterStart, 1)))
}

function firstOfYear(value: string) {
  const date = parseYmd(value)
  return `${date.getUTCFullYear()}-01-01`
}

function daysBetweenInclusive(start: string, end: string) {
  const diff = parseYmd(end).getTime() - parseYmd(start).getTime()
  return Math.max(1, Math.floor(diff / 86400000) + 1)
}

function eachDay(start: string, end: string) {
  const days: string[] = []
  const cursor = parseYmd(start)
  const stop = parseYmd(end).getTime()
  while (cursor.getTime() <= stop) {
    days.push(formatYmd(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function normalizeBranch(value: string | null | undefined): HyundaiBranch {
  const normalized = String(value || 'all').trim().toLowerCase()
  return normalized === 'jammu' || normalized === 'udhampur' ? normalized : 'all'
}

function normalizeDealerToBranch(value: string | null | undefined): HyundaiBranch {
  const normalized = String(value || '').trim().toUpperCase()
  if ((HYUNDAI_BRANCH_DEALERS.jammu as readonly string[]).includes(normalized)) return 'jammu'
  if ((HYUNDAI_BRANCH_DEALERS.udhampur as readonly string[]).includes(normalized)) return 'udhampur'
  return 'all'
}

export function getHyundaiDateFilters(searchParams: URLSearchParams): HyundaiDateFilters {
  const endDate = normalizedDate(searchParams.get('endDate')) || todayInput()
  const startDate = normalizedDate(searchParams.get('startDate')) || firstOfMonth(endDate)
  const branchFromDealer = normalizeDealerToBranch(searchParams.get('dealer_code'))
  const branch = branchFromDealer === 'all' ? normalizeBranch(searchParams.get('branch')) : branchFromDealer
  return {
    startDate,
    endDate,
    compareStartDate: normalizedDate(searchParams.get('compareStartDate') || searchParams.get('comparisonStartDate')) || addYears(startDate, -1),
    compareEndDate: normalizedDate(searchParams.get('compareEndDate') || searchParams.get('comparisonEndDate')) || addYears(endDate, -1),
    branch,
    dealerCode: String(searchParams.get('dealer_code') || '').trim().toUpperCase(),
  }
}

export function createHyundaiCacheKey(section: string, filters: HyundaiDateFilters, extras: Record<string, unknown> = {}) {
  return `hyundai:business-excellence:${section}:v2:${createHash('sha1').update(JSON.stringify({ filters, extras })).digest('hex')}`
}

function amountExpression(columnName: string) {
  return sql`
    ABS(COALESCE(
      NULLIF(regexp_replace(${sql.raw(columnName)}::text, '[^0-9.-]', '', 'g'), '')::numeric,
      0
    ))
  `
}

function dateExpression(columnName: string) {
  return sql`
    CASE
      WHEN NULLIF(TRIM(${sql.raw(columnName)}::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(TRIM(${sql.raw(columnName)}::text), 10)::date
      WHEN NULLIF(TRIM(${sql.raw(columnName)}::text), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN to_date(LEFT(TRIM(${sql.raw(columnName)}::text), 10), 'DD/MM/YYYY')
      ELSE NULL::date
    END
  `
}

function dealerPredicate(dealerExpression: SQL, filters: HyundaiDateFilters) {
  if (filters.branch === 'jammu') {
    return sql`${dealerExpression} IN ('N5216', 'N6846', 'N6847')`
  }
  if (filters.branch === 'udhampur') {
    return sql`${dealerExpression} IN ('N5217', 'N6848', 'N6849')`
  }
  return sql`TRUE`
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
}

function numeric(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown, fallback = '-') {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

function createAccumulator(): Accumulator {
  return { loadKeys: new Set<string>(), labour: 0, parts: 0, total: 0, discount: 0 }
}

function addAccumulator(acc: Accumulator, row: RawBillingRow) {
  acc.loadKeys.add(row.roKey || `${row.date}-${row.workType}-${acc.loadKeys.size}`)
  acc.labour += row.labour
  acc.parts += row.parts
  acc.total += row.labour + row.parts
  acc.discount += row.discount
}

function mergeAccumulators(...accs: Accumulator[]) {
  const merged = createAccumulator()
  for (const acc of accs) {
    for (const key of acc.loadKeys) merged.loadKeys.add(key)
    merged.labour += acc.labour
    merged.parts += acc.parts
    merged.total += acc.total
    merged.discount += acc.discount
  }
  return merged
}

function classifyWorkType(workType: string) {
  const text = workType.toLowerCase()
  if (/(accident|body|insurance|paint|panel)/.test(text)) return 'Accident'
  if (/free/.test(text)) return 'Free Services'
  if (/(running|repair)/.test(text)) return 'Running Repairs'
  if (/(paid|periodic|service)/.test(text)) return 'Paid Service'
  return 'Others'
}

function openRoCategory(workType: string) {
  return classifyWorkType(workType) === 'Accident' ? 'Accidental Repair' : classifyWorkType(workType)
}

function growth(cy: number, ly: number) {
  if (!Number.isFinite(ly) || ly === 0) return null
  return ((cy - ly) / ly) * 100
}

function metricValue(acc: Accumulator, metric: HyundaiMetric) {
  const load = acc.loadKeys.size
  if (metric === 'load') return load
  if (metric === 'labour') return acc.labour
  if (metric === 'parts') return acc.parts
  if (metric === 'lab_per_veh') return load ? acc.labour / load : 0
  return load ? acc.parts / load : 0
}

function inRange(value: string, start: string, end: string) {
  return value >= start && value <= end
}

function buildPeriodDefinitions(filters: HyundaiDateFilters) {
  const mtdStart = firstOfMonth(filters.endDate)
  const qtdStart = firstOfQuarter(filters.endDate)
  const ytdStart = firstOfYear(filters.endDate)
  return {
    td: { cyStart: filters.endDate, cyEnd: filters.endDate, lyStart: addYears(filters.endDate, -1), lyEnd: addYears(filters.endDate, -1) },
    mtd: { cyStart: mtdStart, cyEnd: filters.endDate, lyStart: addYears(mtdStart, -1), lyEnd: addYears(filters.endDate, -1) },
    qtd: { cyStart: qtdStart, cyEnd: filters.endDate, lyStart: addYears(qtdStart, -1), lyEnd: addYears(filters.endDate, -1) },
    ytd: { cyStart: ytdStart, cyEnd: filters.endDate, lyStart: addYears(ytdStart, -1), lyEnd: addYears(filters.endDate, -1) },
  }
}

function categorizedAccumulators(rows: RawBillingRow[], start: string, end: string): Record<ServiceTypeKey, Accumulator> {
  const leafs: Record<string, Accumulator> = {
    'Paid Service': createAccumulator(),
    'Free Services': createAccumulator(),
    'Running Repairs': createAccumulator(),
    Others: createAccumulator(),
    Accident: createAccumulator(),
  }
  for (const row of rows) {
    if (!inRange(row.date, start, end)) continue
    addAccumulator(leafs[classifyWorkType(row.workType)] || leafs.Others, row)
  }
  const mech = mergeAccumulators(leafs['Paid Service'], leafs['Free Services'], leafs['Running Repairs'])
  const mechTotal = mergeAccumulators(mech, leafs.Others)
  const grandTotal = mergeAccumulators(mechTotal, leafs.Accident)
  return {
    'Paid Service': leafs['Paid Service'],
    'Free Services': leafs['Free Services'],
    'Running Repairs': leafs['Running Repairs'],
    MECH: mech,
    Others: leafs.Others,
    'MECH TOTAL': mechTotal,
    Accident: leafs.Accident,
    'Grand Total': grandTotal,
  }
}

function buildMetricRows(rows: RawBillingRow[], metric: HyundaiMetric, filters: HyundaiDateFilters): ServiceMetricRow[] {
  const periods = buildPeriodDefinitions(filters)
  const mtdCy = categorizedAccumulators(rows, periods.mtd.cyStart, periods.mtd.cyEnd)
  const mtdLy = categorizedAccumulators(rows, periods.mtd.lyStart, periods.mtd.lyEnd)
  const qtdCy = categorizedAccumulators(rows, periods.qtd.cyStart, periods.qtd.cyEnd)
  const qtdLy = categorizedAccumulators(rows, periods.qtd.lyStart, periods.qtd.lyEnd)
  const ytdCy = categorizedAccumulators(rows, periods.ytd.cyStart, periods.ytd.cyEnd)
  const ytdLy = categorizedAccumulators(rows, periods.ytd.lyStart, periods.ytd.lyEnd)
  const tdCy = categorizedAccumulators(rows, periods.td.cyStart, periods.td.cyEnd)

  return SERVICE_TYPE_ORDER.map((serviceType) => {
    const mtdCurrent = metricValue(mtdCy[serviceType], metric)
    const mtdPrevious = metricValue(mtdLy[serviceType], metric)
    const qtdCurrent = metricValue(qtdCy[serviceType], metric)
    const qtdPrevious = metricValue(qtdLy[serviceType], metric)
    const ytdCurrent = metricValue(ytdCy[serviceType], metric)
    const ytdPrevious = metricValue(ytdLy[serviceType], metric)
    return {
      serviceType,
      isTotal: serviceType === 'MECH' || serviceType === 'MECH TOTAL' || serviceType === 'Grand Total',
      td: metricValue(tdCy[serviceType], metric),
      mtd: { cy: mtdCurrent, ly: mtdPrevious, growth: growth(mtdCurrent, mtdPrevious) },
      qtd: { cy: qtdCurrent, ly: qtdPrevious, growth: growth(qtdCurrent, qtdPrevious) },
      ytd: { cy: ytdCurrent, ly: ytdPrevious, growth: growth(ytdCurrent, ytdPrevious) },
    }
  })
}

function summaryFromAccumulator(acc: Accumulator) {
  const load = acc.loadKeys.size
  return {
    load,
    labour: acc.labour,
    parts: acc.parts,
    revenue: acc.labour + acc.parts,
    averageBilling: load ? (acc.labour + acc.parts) / load : 0,
    labourPerVehicle: load ? acc.labour / load : 0,
    partsPerVehicle: load ? acc.parts / load : 0,
    discount: acc.discount,
  }
}

function buildTrend(rows: RawBillingRow[], metric: HyundaiMetric, filters: HyundaiDateFilters) {
  const monthStart = firstOfMonth(filters.endDate)
  const monthEnd = formatYmd(new Date(Date.UTC(parseYmd(filters.endDate).getUTCFullYear(), parseYmd(filters.endDate).getUTCMonth() + 1, 0)))
  const days = eachDay(monthStart, monthEnd)
  const monthlyAcc = categorizedAccumulators(rows, monthStart, monthEnd)['Grand Total']
  const lyMonthStart = addYears(monthStart, -1)
  const lyMonthEnd = addYears(monthEnd, -1)
  const lyMonthlyAcc = categorizedAccumulators(rows, lyMonthStart, lyMonthEnd)['Grand Total']
  const achieved = metricValue(categorizedAccumulators(rows, monthStart, filters.endDate)['Grand Total'], metric)
  const monthTarget = Math.max(metricValue(monthlyAcc, metric), metricValue(lyMonthlyAcc, metric), days.length * (metric === 'load' ? 10 : 1))
  const dailyTarget = monthTarget / days.length
  const targetToDate = dailyTarget * daysBetweenInclusive(monthStart, filters.endDate)
  const remainingDays = Math.max(0, daysBetweenInclusive(filters.endDate, monthEnd) - 1)
  const monthlyShortfall = Math.max(0, monthTarget - achieved)
  const points = days.map((date) => {
    const dayCy = categorizedAccumulators(rows, date, date)['Grand Total']
    const lyDate = addYears(date, -1)
    const dayLy = categorizedAccumulators(rows, lyDate, lyDate)['Grand Total']
    return {
      date,
      label: `${date.slice(8, 10)} ${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}`,
      cy: metricValue(dayCy, metric),
      ly: metricValue(dayLy, metric),
      target: dailyTarget,
    }
  })

  return {
    metric,
    points,
    stats: {
      monthTarget,
      mtdTarget: targetToDate,
      mtdAchieved: achieved,
      shortfallTd: Math.max(0, targetToDate - achieved),
      monthlyShortfall,
      projectedClosing: achieved + (remainingDays ? (achieved / Math.max(1, daysBetweenInclusive(monthStart, filters.endDate))) * remainingDays : 0),
      askingRate: remainingDays ? monthlyShortfall / remainingDays : 0,
    },
  }
}

async function readBillingRows(filters: HyundaiDateFilters) {
  if (!await tableExists('hyundai_ro_billing_report')) return { rows: [] as RawBillingRow[], sourceUpdatedAt: null as string | null, warning: 'hyundai_ro_billing_report table is not available yet.' }

  const dealerExpression = sql`COALESCE(NULLIF(TRIM(dealer_code::text), ''), NULLIF(TRIM(main_dealer_code::text), ''), NULLIF(TRIM(source_dealer_code::text), ''), '-')`
  const branchFilter = dealerPredicate(dealerExpression, filters)
  const result = await db.execute(sql`
    SELECT
      LEFT(bill_date_normalized::text, 10) AS bill_date,
      COALESCE(NULLIF(TRIM(r_o_no::text), ''), NULLIF(TRIM(bill_no::text), ''), id::text) AS ro_key,
      COALESCE(NULLIF(TRIM(work_type::text), ''), 'Others') AS work_type,
      COALESCE(NULLIF(TRIM(service_advisor::text), ''), 'Unassigned') AS advisor,
      ${dealerExpression} AS dealer_code,
      ${amountExpression('labour_amt')} AS labour_amount,
      ${amountExpression('part_amt')} AS parts_amount,
      ${amountExpression('total_amt')} AS total_amount,
      ${amountExpression('dis_amt')} + ${amountExpression('total_disc')} + ${amountExpression('part_disc')} + ${amountExpression('labour_disc')} AS discount_amount,
      MAX(uploaded_at) OVER () AS source_updated_at
    FROM (
      SELECT *, ${dateExpression('bill_date')} AS bill_date_normalized
      FROM hyundai_ro_billing_report
    ) billing_base
    WHERE bill_date_normalized IS NOT NULL
      AND ${branchFilter}
  `)

  const rawRows = resultRows(result)
  return {
    rows: rawRows.map((row) => ({
      date: stringValue(row.bill_date, ''),
      roKey: stringValue(row.ro_key),
      workType: stringValue(row.work_type, 'Others'),
      advisor: stringValue(row.advisor, 'Unassigned'),
      dealerCode: stringValue(row.dealer_code),
      labour: numeric(row.labour_amount),
      parts: numeric(row.parts_amount),
      total: numeric(row.total_amount),
      discount: numeric(row.discount_amount),
    })).filter((row) => row.date),
    sourceUpdatedAt: rawRows[0]?.source_updated_at ? String(rawRows[0].source_updated_at) : null,
    warning: undefined,
  }
}

export async function buildHyundaiRoBillingAnalysis(filters: HyundaiDateFilters, metric: HyundaiMetric = 'load'): Promise<BillingAnalysisPayload> {
  const { rows, sourceUpdatedAt, warning } = await readBillingRows(filters)
  const currentSummaryAcc = categorizedAccumulators(rows, filters.startDate, filters.endDate)['Grand Total']
  const comparisonSummaryAcc = categorizedAccumulators(rows, filters.compareStartDate, filters.compareEndDate)['Grand Total']

  const byMetric = HYUNDAI_METRICS.reduce((acc, item) => {
    acc[item.value] = buildMetricRows(rows, item.value, filters)
    return acc
  }, {} as Record<HyundaiMetric, ServiceMetricRow[]>)

  const fyMap = new Map<string, Accumulator>()
  for (const row of rows) {
    const date = parseYmd(row.date)
    const year = date.getUTCFullYear()
    const fyStart = date.getUTCMonth() >= 3 ? year : year - 1
    const label = `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`
    if (!fyMap.has(label)) fyMap.set(label, createAccumulator())
    addAccumulator(fyMap.get(label)!, row)
  }

  const advisorMap = new Map<string, Accumulator>()
  for (const row of rows.filter((entry) => inRange(entry.date, filters.startDate, filters.endDate))) {
    if (!advisorMap.has(row.advisor)) advisorMap.set(row.advisor, createAccumulator())
    addAccumulator(advisorMap.get(row.advisor)!, row)
  }

  return {
    meta: {
      source: 'hyundai_ro_billing_report',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt,
      filters,
      warning,
    },
    summary: summaryFromAccumulator(currentSummaryAcc),
    comparisonSummary: summaryFromAccumulator(comparisonSummaryAcc),
    byMetric,
    trend: buildTrend(rows, metric, filters),
    fyTrend: Array.from(fyMap.entries()).map(([financialYear, acc]) => {
      const summary = summaryFromAccumulator(acc)
      return {
        financialYear,
        load: summary.load,
        labour: summary.labour,
        parts: summary.parts,
        revenue: summary.revenue,
        labPerVeh: summary.labourPerVehicle,
        partPerVeh: summary.partsPerVehicle,
      }
    }).sort((a, b) => b.financialYear.localeCompare(a.financialYear)),
    leaderboard: Array.from(advisorMap.entries()).map(([advisor, acc]) => {
      const summary = summaryFromAccumulator(acc)
      return {
        advisor,
        load: summary.load,
        labour: summary.labour,
        parts: summary.parts,
        revenue: summary.revenue,
      }
    }).sort((a, b) => b.revenue - a.revenue).slice(0, 12),
  }
}

function agingCategory(days: number) {
  if (days <= 4) return '0-4D'
  if (days <= 7) return '5-7D'
  if (days <= 15) return '8-15D'
  return '>15D'
}

function normalizeStatus(row: RawOpenRoRow) {
  return row.newStatus || row.status || 'Open'
}

function isOpenRepairOrder(row: RawOpenRoRow) {
  const status = `${row.status} ${row.newStatus} ${row.subStatus}`.toLowerCase()
  if (row.cancelDate) return false
  return !/(close|closed|delivered|cancel)/.test(status)
}

async function readOpenRoRows(filters: HyundaiDateFilters) {
  if (!await tableExists('hyundai_repair_order_list')) return { rows: [] as RawOpenRoRow[], sourceUpdatedAt: null as string | null, warning: 'hyundai_repair_order_list table is not available yet.' }
  const dealerExpression = sql`COALESCE(NULLIF(TRIM(source_dealer_code::text), ''), NULLIF(TRIM(dealer::text), ''), NULLIF(TRIM(main_dealer::text), ''), NULLIF(TRIM(dlr_no::text), ''), '-')`
  const branchFilter = dealerPredicate(dealerExpression, filters)

  const result = await db.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text) AS ro_no,
      LEFT(ro_date_normalized::text, 10) AS ro_date,
      COALESCE(NULLIF(TRIM(reg_no::text), ''), '-') AS reg_no,
      COALESCE(NULLIF(TRIM(vin::text), ''), '-') AS vin,
      COALESCE(NULLIF(TRIM(model::text), ''), '-') AS model,
      COALESCE(NULLIF(TRIM(work_type::text), ''), 'Others') AS work_type,
      COALESCE(NULLIF(TRIM(service_adv::text), ''), NULLIF(TRIM(svc_adv::text), ''), 'Unassigned') AS advisor,
      COALESCE(NULLIF(TRIM(man_tech::text), ''), NULLIF(TRIM(tech_name::text), ''), '-') AS technician,
      COALESCE(NULLIF(TRIM(r_o_status::text), ''), NULLIF(TRIM(status::text), ''), 'Open') AS status,
      COALESCE(NULLIF(TRIM(new_r_o_status::text), ''), '-') AS new_status,
      COALESCE(NULLIF(TRIM(type_of_free_service::text), ''), '-') AS sub_status,
      COALESCE(NULLIF(TRIM(delay_reason::text), ''), 'No Reason Specified') AS delay_reason,
      LEFT(${dateExpression('promise_date_time')}::text, 10) AS promise_date,
      LEFT(${dateExpression('closing_date_time')}::text, 10) AS closing_date,
      LEFT(${dateExpression('cancel_date')}::text, 10) AS cancel_date,
      ${dealerExpression} AS dealer_code,
      MAX(uploaded_at) OVER () AS source_updated_at
    FROM (
      SELECT *, ${dateExpression('r_o_date')} AS ro_date_normalized
      FROM hyundai_repair_order_list
    ) open_ro_base
    WHERE ro_date_normalized IS NOT NULL
      AND ro_date_normalized >= ${filters.startDate}::date
      AND ro_date_normalized <= ${filters.endDate}::date
      AND ${branchFilter}
  `)

  const rawRows = resultRows(result)
  return {
    rows: rawRows.map((row) => ({
      roNo: stringValue(row.ro_no),
      roDate: stringValue(row.ro_date, ''),
      regNo: stringValue(row.reg_no),
      vin: stringValue(row.vin),
      model: stringValue(row.model),
      workType: stringValue(row.work_type, 'Others'),
      advisor: stringValue(row.advisor, 'Unassigned'),
      technician: stringValue(row.technician),
      status: stringValue(row.status, 'Open'),
      newStatus: stringValue(row.new_status, ''),
      subStatus: stringValue(row.sub_status, ''),
      delayReason: stringValue(row.delay_reason, 'No Reason Specified'),
      promiseDate: stringValue(row.promise_date, ''),
      closingDate: stringValue(row.closing_date, ''),
      cancelDate: stringValue(row.cancel_date, ''),
      dealerCode: stringValue(row.dealer_code),
    })).filter((row) => row.roDate),
    sourceUpdatedAt: rawRows[0]?.source_updated_at ? String(rawRows[0].source_updated_at) : null,
    warning: undefined,
  }
}

export async function buildHyundaiOpenRo(filters: HyundaiDateFilters): Promise<HyundaiOpenRoPayload> {
  const { rows, sourceUpdatedAt, warning } = await readOpenRoRows(filters)
  const openRows = rows.filter(isOpenRepairOrder)
  const today = parseYmd(todayInput())
  const withAging = openRows.map((row) => {
    const agingDays = Math.max(0, Math.floor((today.getTime() - parseYmd(row.roDate).getTime()) / 86400000))
    return { ...row, agingDays }
  })

  const grouped = new Map<string, typeof withAging>()
  for (const row of withAging) {
    const category = openRoCategory(row.workType)
    grouped.set(category, [...(grouped.get(category) || []), row])
  }

  const agingRows = Array.from(grouped.entries()).map(([serviceType, vehicles]) => ({
    serviceType,
    totalWip: vehicles.length,
    bucket0to4: vehicles.filter((vehicle) => vehicle.agingDays <= 4).length,
    bucket5to7: vehicles.filter((vehicle) => vehicle.agingDays >= 5 && vehicle.agingDays <= 7).length,
    bucket8to15: vehicles.filter((vehicle) => vehicle.agingDays >= 8 && vehicle.agingDays <= 15).length,
    bucketOver15: vehicles.filter((vehicle) => vehicle.agingDays > 15).length,
    avgDays: vehicles.length ? vehicles.reduce((sum, vehicle) => sum + vehicle.agingDays, 0) / vehicles.length : 0,
    vehicles: vehicles.map((vehicle) => ({
      roNo: vehicle.roNo,
      regNo: vehicle.regNo,
      vin: vehicle.vin,
      model: vehicle.model,
      advisor: vehicle.advisor,
      technician: vehicle.technician,
      status: normalizeStatus(vehicle),
      reason: vehicle.delayReason,
      agingDays: vehicle.agingDays,
      agingCategory: agingCategory(vehicle.agingDays),
    })).sort((a, b) => b.agingDays - a.agingDays),
  })).sort((a, b) => b.totalWip - a.totalWip)

  const delayMap = new Map<string, typeof withAging>()
  for (const row of withAging) {
    const key = `${normalizeStatus(row)}|${row.delayReason || 'No Reason Specified'}`
    delayMap.set(key, [...(delayMap.get(key) || []), row])
  }

  return {
    meta: {
      source: 'hyundai_repair_order_list',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt,
      filters,
      warning,
    },
    summary: {
      totalOpenRo: withAging.length,
      averageAging: withAging.length ? withAging.reduce((sum, row) => sum + row.agingDays, 0) / withAging.length : 0,
      delayedRo: withAging.filter((row) => row.promiseDate && row.promiseDate < todayInput()).length,
      over15Days: withAging.filter((row) => row.agingDays > 15).length,
      accidentJobs: withAging.filter((row) => classifyWorkType(row.workType) === 'Accident').length,
      runningRepairs: withAging.filter((row) => classifyWorkType(row.workType) === 'Running Repairs').length,
    },
    agingRows,
    delaySummary: Array.from(delayMap.entries()).map(([key, items]) => {
      const [status, reason] = key.split('|')
      return {
        status,
        reason,
        count: items.length,
        mechCount: items.filter((item) => classifyWorkType(item.workType) !== 'Accident').length,
        accidentCount: items.filter((item) => classifyWorkType(item.workType) === 'Accident').length,
        avgDays: items.length ? items.reduce((sum, item) => sum + item.agingDays, 0) / items.length : 0,
      }
    }).sort((a, b) => b.count - a.count),
  }
}

export async function buildHyundaiFreshness(filters: HyundaiDateFilters) {
  const [billing, openRo] = await Promise.all([readBillingRows(filters), readOpenRoRows(filters)])
  return {
    generatedAt: new Date().toISOString(),
    filters,
    sources: [
      { source: 'hyundai_ro_billing_report', updatedAt: billing.sourceUpdatedAt, configured: !billing.warning },
      { source: 'hyundai_repair_order_list', updatedAt: openRo.sourceUpdatedAt, configured: !openRo.warning },
    ],
  }
}
