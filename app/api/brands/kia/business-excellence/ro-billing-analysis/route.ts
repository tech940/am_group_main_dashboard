import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import {
  KIA_BUSINESS_EXCELLENCE_CACHE_VERSION,
  fetchKiaBillingSourceMetadata,
  kiaActiveBillStatusSql,
  kiaActiveServiceCategoryFilter,
} from '@/lib/kia/business-excellence-contract'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const FILTER_COLUMNS = {
  workType: 'work_type',
  serviceType: 'work_type',
  advisor: 'service_advisor',
  model: 'model',
  technician: 'technician',
  billType: 'bill_type',
  billStatus: 'bill_status',
} as const

type AnalysisType = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type AnalysisView = 'table' | 'trend' | 'fy' | 'analytics' | 'revenue' | 'leaderboard' | 'technician'
type DataRow = Record<string, unknown>
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'

const RO_ANALYSIS_TYPES: AnalysisType[] = ['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh']
const HAS_DAILY_SUMMARY_V2 = false

type PeriodMetric = {
  cy: number
  ly: number | 'N/A'
  growth: number | 'N/A'
}

type AggregatedMetrics = Record<PeriodKey, PeriodMetric>

type RawAggregate = {
  billKeys: Set<string>
  labourByBill: Map<string, number>
  partsByBill: Map<string, number>
}

type PeriodWindow = {
  cyStart: Date
  cyEnd: Date
  lyStart: Date
  lyEnd: Date
}

type ComparisonRange = {
  startDate: Date
  endDate: Date
} | null

type DealerFilter = string | null

type AnalysisRow = {
  name: string
  depth: number
  metrics: AggregatedMetrics
  children: AnalysisRow[]
}

function normalizeSheetSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()

  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
    if (year && month && day) return new Date(year, month - 1, day)
  }

  const slashParts = trimmed.split(/[/-]/).map((part) => part.trim())
  if (slashParts.length === 3) {
    let day = Number(slashParts[0])
    let month = Number(slashParts[1])
    const year = Number(slashParts[2])

    if (day > 12) {
      month -= 1
    } else if (month > 12) {
      const originalDay = day
      day = month
      month = originalDay - 1
    } else {
      month -= 1
    }

    if (year && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day)
    }
  }

  return null
}

function parseBillDate(row: DataRow) {
  const billDate = row.bill_date
  return parseDateInput(billDate === null || billDate === undefined ? null : String(billDate))
}

function numericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value === null || value === undefined) return 0
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function getTextValue(row: DataRow, column: string) {
  const value = row[column]
  if (value === null || value === undefined || String(value).trim() === '') return 'Unspecified'
  return String(value).trim()
}

function getAdvisorValue(row: DataRow) {
  const value = row.service_advisor ?? row.advisor
  if (value === null || value === undefined || String(value).trim() === '') return 'Unspecified'
  return String(value).trim()
}

function sameDateLastYear(date: Date) {
  return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds())
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function getCalendarYearStart(date: Date) {
  return new Date(date.getFullYear(), 0, 1, 0, 0, 0, 0)
}

function buildPeriodWindows(
  startDate: Date,
  endDate: Date,
  comparisonRange: ComparisonRange = null,
  tdAnchorDate: Date | null = null,
): Record<PeriodKey, PeriodWindow> {
  const cyEnd = endOfDay(endDate)
  const tdDate = startOfDay(tdAnchorDate || endDate)
  const cyTdStart = tdDate
  const currentStart = startOfDay(startDate)
  const cyMtdStart = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
  const quarterStartMonth = Math.floor(endDate.getMonth() / 3) * 3
  const cyQtdStart = new Date(endDate.getFullYear(), quarterStartMonth, 1)
  const cyYtdStart = getCalendarYearStart(endDate)
  const customPeriodWindow = comparisonRange
    ? {
        cyStart: currentStart,
        cyEnd,
        lyStart: startOfDay(comparisonRange.startDate),
        lyEnd: endOfDay(comparisonRange.endDate),
      }
    : null

  return {
    td: {
      cyStart: cyTdStart,
      cyEnd: endOfDay(tdDate),
      lyStart: comparisonRange ? startOfDay(comparisonRange.endDate) : sameDateLastYear(cyTdStart),
      lyEnd: comparisonRange ? endOfDay(comparisonRange.endDate) : sameDateLastYear(endOfDay(tdDate)),
    },
    mtd: customPeriodWindow || {
      cyStart: startOfDay(cyMtdStart),
      cyEnd,
      lyStart: sameDateLastYear(startOfDay(cyMtdStart)),
      lyEnd: sameDateLastYear(cyEnd),
    },
    qtd: {
      cyStart: startOfDay(cyQtdStart),
      cyEnd,
      lyStart: sameDateLastYear(startOfDay(cyQtdStart)),
      lyEnd: sameDateLastYear(cyEnd),
    },
    ytd: {
      cyStart: startOfDay(cyYtdStart),
      cyEnd,
      lyStart: sameDateLastYear(startOfDay(cyYtdStart)),
      lyEnd: sameDateLastYear(cyEnd),
    },
  }
}

function inWindow(date: Date, start: Date, end: Date) {
  return date >= start && date <= end
}

function createRawAggregate(): RawAggregate {
  return { billKeys: new Set<string>(), labourByBill: new Map<string, number>(), partsByBill: new Map<string, number>() }
}

function getBillKey(row: DataRow) {
  const billNo = row.bill_no
  const roNo = row.ro_no
  const primary = billNo !== null && billNo !== undefined && String(billNo).trim() !== ''
    ? String(billNo).trim()
    : roNo !== null && roNo !== undefined && String(roNo).trim() !== ''
      ? String(roNo).trim()
      : null

  if (primary) return primary

  return createHash('sha1').update(JSON.stringify(row)).digest('hex')
}

function addRowToAggregate(aggregate: RawAggregate, row: DataRow) {
  const billKey = getBillKey(row)
  aggregate.billKeys.add(billKey)

  const addBillAmount = (bucket: Map<string, number>, amount: number) => {
    const existing = bucket.get(billKey)
    if (existing === undefined || Math.abs(amount) > Math.abs(existing)) {
      bucket.set(billKey, amount)
    }
  }

  addBillAmount(aggregate.labourByBill, numericValue(row.labour_amt))
  addBillAmount(aggregate.partsByBill, numericValue(row.part_amt))
}

function sumBillAmounts(bucket: Map<string, number>) {
  return Array.from(bucket.values()).reduce((total, amount) => total + amount, 0)
}

function measureAggregate(aggregate: RawAggregate, analysisType: AnalysisType) {
  const load = aggregate.billKeys.size
  const labour = sumBillAmounts(aggregate.labourByBill)
  const parts = sumBillAmounts(aggregate.partsByBill)
  if (analysisType === 'load') return load
  if (analysisType === 'labour') return labour
  if (analysisType === 'parts') return parts
  if (analysisType === 'lab_per_veh') return load > 0 ? labour / load : 0
  return load > 0 ? parts / load : 0
}

function growth(cy: number, ly: number) {
  if (ly <= 0) return 'N/A' as const
  return ((cy - ly) / ly) * 100
}

function calculateMetrics(rows: DataRow[], analysisType: AnalysisType, windows: Record<PeriodKey, PeriodWindow>): AggregatedMetrics {
  const result = {} as AggregatedMetrics

  for (const period of Object.keys(windows) as PeriodKey[]) {
    const window = windows[period]
    const cy = createRawAggregate()
    const ly = createRawAggregate()

    for (const row of rows) {
      const date = parseBillDate(row)
      if (!date) continue

      if (inWindow(date, window.cyStart, window.cyEnd)) {
        addRowToAggregate(cy, row)
      }

      if (inWindow(date, window.lyStart, window.lyEnd)) {
        addRowToAggregate(ly, row)
      }
    }

    const cyValue = measureAggregate(cy, analysisType)
    const lyValue = measureAggregate(ly, analysisType)

    result[period] = {
      cy: cyValue,
      ly: ly.billKeys.size > 0 ? lyValue : 'N/A',
      growth: ly.billKeys.size > 0 ? growth(cyValue, lyValue) : 'N/A',
    }
  }

  return result
}

function groupRows(rows: DataRow[], analysisType: AnalysisType, windows: Record<PeriodKey, PeriodWindow>, groupColumns: string[], depth = 0): AnalysisRow[] {
  if (depth >= groupColumns.length) return []

  const column = groupColumns[depth]
  const grouped = new Map<string, DataRow[]>()

  for (const row of rows) {
    const key = column === 'service_advisor' ? getAdvisorValue(row) : getTextValue(row, column)
    const existing = grouped.get(key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(key, [row])
    }
  }

  return Array.from(grouped.entries())
    .sort(([, aRows], [, bRows]) => bRows.length - aRows.length)
    .map(([name, childRows]) => ({
      name,
      depth,
      metrics: calculateMetrics(childRows, analysisType, windows),
      children: groupRows(childRows, analysisType, windows, groupColumns, depth + 1),
    }))
}

function flattenRows(rows: AnalysisRow[]) {
  const flat: AnalysisRow[] = []

  function visit(row: AnalysisRow) {
    flat.push(row)
    row.children.forEach(visit)
  }

  rows.forEach(visit)
  return flat
}

function applyFilters(rows: DataRow[], searchParams: URLSearchParams) {
  return rows.filter((row) => {
    for (const [param, column] of Object.entries(FILTER_COLUMNS)) {
      const expected = searchParams.get(param)
      if (!expected || expected === 'all') continue

      const actual = column === 'service_advisor' ? getAdvisorValue(row) : getTextValue(row, column)
      if (actual.toLowerCase() !== expected.toLowerCase()) return false
    }

    return true
  })
}

function buildFilterOptions(rows: DataRow[]) {
  return Object.fromEntries(
    Object.entries(FILTER_COLUMNS).map(([param, column]) => {
      const values = new Set<string>()
      rows.forEach((row) => {
        const value = column === 'service_advisor' ? getAdvisorValue(row) : getTextValue(row, column)
        if (value !== 'Unspecified') values.add(value)
      })
      return [param, Array.from(values).sort((a, b) => a.localeCompare(b)).slice(0, 150)]
    })
  )
}

function aggregateForRange(rows: DataRow[], analysisType: AnalysisType, start: Date, end: Date) {
  const aggregate = createRawAggregate()
  for (const row of rows) {
    const date = parseBillDate(row)
    if (date && inWindow(date, start, end)) addRowToAggregate(aggregate, row)
  }
  return measureAggregate(aggregate, analysisType)
}

function buildTrend(rows: DataRow[], analysisType: AnalysisType, startDate: Date, endDate: Date) {
  const trend = []
  const cursor = startOfDay(startDate)

  while (cursor <= endDate) {
    const dayStart = startOfDay(cursor)
    const dayEnd = endOfDay(cursor)
    const lyStart = sameDateLastYear(dayStart)
    const lyEnd = sameDateLastYear(dayEnd)

    trend.push({
      date: toDateInputValue(dayStart),
      label: `${String(dayStart.getDate()).padStart(2, '0')} ${dayStart.toLocaleDateString('en-US', { weekday: 'short' })}`,
      cy: aggregateForRange(rows, analysisType, dayStart, dayEnd),
      ly: aggregateForRange(rows, analysisType, lyStart, lyEnd),
    })

    cursor.setDate(cursor.getDate() + 1)
  }

  return trend
}

function buildFiscalTrends(rows: DataRow[], analysisType: AnalysisType) {
  const fiscalRows = new Map<string, DataRow[]>()

  rows.forEach((row) => {
    const date = parseBillDate(row)
    if (!date) return
    const fiscalStartYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1
    const label = `FY ${fiscalStartYear}-${String(fiscalStartYear + 1).slice(-2)}`
    const existing = fiscalRows.get(label)
    if (existing) {
      existing.push(row)
    } else {
      fiscalRows.set(label, [row])
    }
  })

  return Array.from(fiscalRows.entries())
    .map(([fy, fyRows]) => ({
      fy,
      value: measureAggregate(fyRows.reduce<RawAggregate>((aggregate, row) => {
        addRowToAggregate(aggregate, row)
        return aggregate
      }, createRawAggregate()), analysisType),
    }))
    .sort((a, b) => a.fy.localeCompare(b.fy))
    .slice(-5)
}

function buildDistribution(rows: DataRow[], analysisType: AnalysisType, startDate: Date, endDate: Date, groupBy: string) {
  const grouped = new Map<string, DataRow[]>()
  const selectedRows = rows.filter((row) => {
    const date = parseBillDate(row)
    return date && inWindow(date, startDate, endDate)
  })

  selectedRows.forEach((row) => {
    const key = groupBy === 'service_advisor' ? getAdvisorValue(row) : getTextValue(row, groupBy)
    const existing = grouped.get(key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(key, [row])
    }
  })

  return Array.from(grouped.entries())
    .map(([name, groupRowsForKey]) => ({
      name,
      value: measureAggregate(groupRowsForKey.reduce<RawAggregate>((aggregate, row) => {
        addRowToAggregate(aggregate, row)
        return aggregate
      }, createRawAggregate()), analysisType),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
}

function buildRevenueSummary(rows: DataRow[], startDate: Date, endDate: Date) {
  const aggregate = createRawAggregate()
  rows.forEach((row) => {
    const date = parseBillDate(row)
    if (date && inWindow(date, startDate, endDate)) addRowToAggregate(aggregate, row)
  })

  return {
    load: aggregate.billKeys.size,
    labour: sumBillAmounts(aggregate.labourByBill),
    parts: sumBillAmounts(aggregate.partsByBill),
    total: sumBillAmounts(aggregate.labourByBill) + sumBillAmounts(aggregate.partsByBill),
    labPerVehicle: aggregate.billKeys.size > 0 ? sumBillAmounts(aggregate.labourByBill) / aggregate.billKeys.size : 0,
    partPerVehicle: aggregate.billKeys.size > 0 ? sumBillAmounts(aggregate.partsByBill) / aggregate.billKeys.size : 0,
  }
}

type WorkTypeAggregateRow = {
  aggregate_level?: string | null
  work_type: string | null
  service_type?: string | null
  technician?: string | null
  td_cy_load: number
  td_ly_load: number
  mtd_cy_load: number
  mtd_ly_load: number
  qtd_cy_load: number
  qtd_ly_load: number
  ytd_cy_load: number
  ytd_ly_load: number
  td_cy_labour: number
  td_ly_labour: number
  mtd_cy_labour: number
  mtd_ly_labour: number
  qtd_cy_labour: number
  qtd_ly_labour: number
  ytd_cy_labour: number
  ytd_ly_labour: number
  td_cy_parts: number
  td_ly_parts: number
  mtd_cy_parts: number
  mtd_ly_parts: number
  qtd_cy_parts: number
  qtd_ly_parts: number
  ytd_cy_parts: number
  ytd_ly_parts: number
}

type DailyAggregateRow = {
  bill_date: string | Date
  load: number
  labour: number
  parts: number
}

type FiscalAggregateRow = {
  fy: string
  load: number
  labour: number
  parts: number
}

type AnalyticsQualitySummary = {
  avgRating: number
  avgRatingLy: number
  pickDropRate: number
  pickDropRateLy: number
}

type AdvisorLeaderboardRow = {
  name: string
  load: number
  labour: number
  parts: number
  revenue: number
  averageBilling: number
  contribution: number
}

type TechnicianReportRow = {
  name: string
  dealer_code: string
  load: number
  labour: number
  labour_disc: number
  labour_per_ro: number
  discount_per_ro: number
  discount_pct: number
}

type CancelledBillingRow = {
  billKey: string
  billNo: string
  roNo: string
  billDate: string | null
  workType: string
  serviceType: string
  advisor: string
  billStatus: string
  labour: number
  parts: number
  total: number
}

type CancelledBillingSummary = {
  count: number
  labour: number
  parts: number
  total: number
  rows: CancelledBillingRow[]
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function activeBillStatusSql() {
  return kiaActiveBillStatusSql()
}

function activeServiceCategoryFilter() {
  return kiaActiveServiceCategoryFilter()
}

function cancelledBillStatusSql() {
  return sql`LOWER(TRIM(COALESCE(bill_status::text, ''))) IN ('cancel', 'cancelled', 'canceled')`
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${dealerCode}`
    : sql``
}

function measureWorkTypeRow(row: WorkTypeAggregateRow, period: PeriodKey, side: 'cy' | 'ly', analysisType: AnalysisType) {
  const prefix = `${period}_${side}` as const
  const load = numberValue(row[`${prefix}_load` as keyof WorkTypeAggregateRow])
  const labour = numberValue(row[`${prefix}_labour` as keyof WorkTypeAggregateRow])
  const parts = numberValue(row[`${prefix}_parts` as keyof WorkTypeAggregateRow])
  if (analysisType === 'load') return load
  if (analysisType === 'labour') return labour
  if (analysisType === 'parts') return parts
  if (analysisType === 'lab_per_veh') return load > 0 ? labour / load : 0
  return load > 0 ? parts / load : 0
}

function measureDailyRow(row: DailyAggregateRow | undefined, analysisType: AnalysisType) {
  if (!row) return 0
  const load = numberValue(row.load)
  const labour = numberValue(row.labour)
  const parts = numberValue(row.parts)
  if (analysisType === 'load') return load
  if (analysisType === 'labour') return labour
  if (analysisType === 'parts') return parts
  if (analysisType === 'lab_per_veh') return load > 0 ? labour / load : 0
  return load > 0 ? parts / load : 0
}

function measureFiscalRow(row: FiscalAggregateRow, analysisType: AnalysisType) {
  const load = numberValue(row.load)
  const labour = numberValue(row.labour)
  const parts = numberValue(row.parts)
  if (analysisType === 'load') return load
  if (analysisType === 'labour') return labour
  if (analysisType === 'parts') return parts
  if (analysisType === 'lab_per_veh') return load > 0 ? labour / load : 0
  return load > 0 ? parts / load : 0
}

function aggregateRowsToStats(rows: WorkTypeAggregateRow[], analysisType: AnalysisType) {
  const combineRows = (sourceRows: WorkTypeAggregateRow[]): WorkTypeAggregateRow => {
    const combined = {
      work_type: sourceRows[0]?.work_type || 'Unspecified',
      service_type: null,
    } as WorkTypeAggregateRow
    const metricKeys = [
      'td_cy_load', 'td_ly_load', 'mtd_cy_load', 'mtd_ly_load', 'qtd_cy_load', 'qtd_ly_load', 'ytd_cy_load', 'ytd_ly_load',
      'td_cy_labour', 'td_ly_labour', 'mtd_cy_labour', 'mtd_ly_labour', 'qtd_cy_labour', 'qtd_ly_labour', 'ytd_cy_labour', 'ytd_ly_labour',
      'td_cy_parts', 'td_ly_parts', 'mtd_cy_parts', 'mtd_ly_parts', 'qtd_cy_parts', 'qtd_ly_parts', 'ytd_cy_parts', 'ytd_ly_parts',
    ] as Array<keyof WorkTypeAggregateRow>

    metricKeys.forEach((key) => {
      combined[key] = sourceRows.reduce((total, row) => total + numberValue(row[key]), 0) as never
    })

    return combined
  }

  const toPeriod = (row: WorkTypeAggregateRow, period: PeriodKey): PeriodMetric => {
    const cy = measureWorkTypeRow(row, period, 'cy', analysisType)
    const lyRaw = measureWorkTypeRow(row, period, 'ly', analysisType)
    const lyLoad = measureWorkTypeRow(row, period, 'ly', 'load')
    const ly = lyLoad > 0 ? lyRaw : 'N/A'
    return { cy, ly, growth: ly === 'N/A' ? 'N/A' : growth(cy, ly) }
  }

  const toAnalysisRow = (name: string, row: WorkTypeAggregateRow, depth: number, children: AnalysisRow[] = []): AnalysisRow => ({
    name,
    depth,
    metrics: {
      td: toPeriod(row, 'td'),
      mtd: toPeriod(row, 'mtd'),
      qtd: toPeriod(row, 'qtd'),
      ytd: toPeriod(row, 'ytd'),
    },
    children,
  })

  const grouped = new Map<string, WorkTypeAggregateRow[]>()
  const parentRows = rows.filter((row) => !row.aggregate_level || row.aggregate_level === 'parent')
  const childRows = rows.filter((row) => row.aggregate_level && row.aggregate_level !== 'parent')

  parentRows.forEach((row) => {
    const key = row.work_type || 'Unspecified'
    const existing = grouped.get(key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(key, [row])
    }
  })

  return Array.from(grouped.entries()).map(([workType, workRows]) => {
    const parent = combineRows(workRows)
    const normalizedWorkType = workType.trim().toLowerCase()
    const children = childRows
      .filter((row) => (row.work_type || 'Unspecified').trim().toLowerCase() === normalizedWorkType)
      .filter((row) => {
        if (['free service', 'free services'].includes(normalizedWorkType)) {
          return row.aggregate_level === 'free_service_type' && Boolean(row.service_type && row.service_type !== 'Unspecified')
        }
        if (['running repair', 'running repairs'].includes(normalizedWorkType)) {
          return row.aggregate_level === 'running_technician' && Boolean(row.technician && row.technician !== 'Unspecified')
        }
        return false
      })
      .map((row) => {
        const childName = row.aggregate_level === 'running_technician'
          ? row.technician || 'Unspecified'
          : row.service_type || 'Unspecified'
        return toAnalysisRow(childName, row, 1, [])
      })
      .sort((a, b) => {
        const aValue = Number(a.metrics.mtd.cy || 0)
        const bValue = Number(b.metrics.mtd.cy || 0)
        return bValue - aValue || a.name.localeCompare(b.name)
      })
    return toAnalysisRow(workType, parent, 0, children)
  })
}

function buildDailyTrendRows(rows: DailyAggregateRow[], analysisType: AnalysisType, startDate: Date, endDate: Date, comparisonRange: ComparisonRange = null) {
  const byDate = new Map<string, DailyAggregateRow>()
  rows.forEach((row) => {
    byDate.set(toDateInputValue(new Date(row.bill_date)), row)
  })

  const trend = []
  const cursor = startOfDay(startDate)
  let offsetDays = 0
  while (cursor <= endDate) {
    const cyDate = toDateInputValue(cursor)
    const comparisonDate = comparisonRange ? addDays(comparisonRange.startDate, offsetDays) : sameDateLastYear(cursor)
    const lyDate = comparisonRange && comparisonDate > comparisonRange.endDate
      ? null
      : toDateInputValue(comparisonDate)
    trend.push({
      date: cyDate,
      label: `${String(cursor.getDate()).padStart(2, '0')} ${cursor.toLocaleDateString('en-US', { weekday: 'short' })}`,
      cy: measureDailyRow(byDate.get(cyDate), analysisType),
      ly: lyDate ? measureDailyRow(byDate.get(lyDate), analysisType) : 0,
    })
    cursor.setDate(cursor.getDate() + 1)
    offsetDays += 1
  }

  return trend
}

async function fetchDailyAggregateRows(startDate: Date, endDate: Date, comparisonRange: ComparisonRange = null, dealerCode: DealerFilter = null) {
  const relationalStart = comparisonRange && comparisonRange.startDate < startDate ? comparisonRange.startDate : (comparisonRange ? startDate : sameDateLastYear(startDate))
  const relationalEnd = comparisonRange && comparisonRange.endDate > endDate ? comparisonRange.endDate : endDate

  const result = await db.execute(sql`
    WITH dedup AS (
      SELECT
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM (
        SELECT
          COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
          bill_date::date AS bill_date,
          COALESCE(labour_amt, 0)::numeric AS labour_amt,
          COALESCE(part_amt, 0)::numeric AS part_amt
        FROM ro_billing_report
        WHERE bill_date >= ${toDateInputValue(relationalStart)}::date
          AND bill_date < (${toDateInputValue(relationalEnd)}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode)}
      ) base
      GROUP BY bill_key, bill_date
    )
    SELECT
      bill_date,
      COUNT(DISTINCT bill_key)::int AS load,
      COALESCE(SUM(labour_amt), 0)::float AS labour,
      COALESCE(SUM(part_amt), 0)::float AS parts
    FROM dedup
    GROUP BY bill_date
    ORDER BY bill_date
  `)

  return (result as unknown as DailyAggregateRow[]) || []
}

function buildFiscalTrendRows(rows: FiscalAggregateRow[], analysisType: AnalysisType) {
  return rows
    .sort((a, b) => a.fy.localeCompare(b.fy))
    .map((row) => ({
      fy: row.fy,
      value: measureFiscalRow(row, analysisType),
    }))
}

async function fetchFiscalAggregateRows(dealerCode: DealerFilter = null) {
  const useDailySummary = false
  const result = await db.execute(useDailySummary && HAS_DAILY_SUMMARY_V2 && !dealerCode ? sql`
    WITH fiscal AS (
      SELECT
        CASE
          WHEN EXTRACT(MONTH FROM bill_date) >= 4 THEN EXTRACT(YEAR FROM bill_date)::int
          ELSE EXTRACT(YEAR FROM bill_date)::int - 1
        END AS fiscal_start_year,
        COALESCE(SUM(load_count), 0)::int AS load,
        COALESCE(SUM(labour_amount), 0)::float AS labour,
        COALESCE(SUM(part_amount), 0)::float AS parts
      FROM ro_billing_daily_summary_v2
      WHERE bill_date IS NOT NULL
        AND ${activeBillStatusSql()}
      GROUP BY fiscal_start_year
    )
    SELECT
      ('FY ' || fiscal_start_year::text || '-' || RIGHT((fiscal_start_year + 1)::text, 2)) AS fy,
      load,
      labour,
      parts
    FROM fiscal
    ORDER BY fiscal_start_year DESC
    LIMIT 5
  ` : sql`
    WITH dedup AS (
      SELECT
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM (
        SELECT
          COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
          bill_date::date AS bill_date,
          COALESCE(labour_amt, 0)::numeric AS labour_amt,
          COALESCE(part_amt, 0)::numeric AS part_amt
        FROM ro_billing_report
        WHERE bill_date IS NOT NULL
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode)}
      ) base
      GROUP BY bill_key, bill_date
    ),
    fiscal AS (
      SELECT
        CASE
          WHEN EXTRACT(MONTH FROM bill_date) >= 4 THEN EXTRACT(YEAR FROM bill_date)::int
          ELSE EXTRACT(YEAR FROM bill_date)::int - 1
        END AS fiscal_start_year,
        COUNT(DISTINCT bill_key)::int AS load,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts
      FROM dedup
      GROUP BY fiscal_start_year
    )
    SELECT
      ('FY ' || fiscal_start_year::text || '-' || RIGHT((fiscal_start_year + 1)::text, 2)) AS fy,
      load,
      labour,
      parts
    FROM fiscal
    ORDER BY fiscal_start_year DESC
    LIMIT 5
  `)

  return (result as unknown as FiscalAggregateRow[]) || []
}

async function fetchAnalyticsQualitySummary(startDate: Date, endDate: Date, dealerCode: DealerFilter = null): Promise<AnalyticsQualitySummary> {
  const lyStart = sameDateLastYear(startDate)
  const lyEnd = sameDateLastYear(endDate)
  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        bill_date::date AS bill_date,
        NULLIF(regexp_replace(COALESCE(avg_rating::text, ''), '[^0-9.-]', '', 'g'), '')::numeric AS rating,
        LOWER(TRIM(COALESCE(pick_drop::text, ''))) AS pick_drop_value
      FROM ro_billing_report
      WHERE bill_date >= ${toDateInputValue(lyStart)}::date
        AND bill_date < (${toDateInputValue(endDate)}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        AND ${activeServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
    )
    SELECT
      COALESCE(AVG(rating) FILTER (
        WHERE bill_date BETWEEN ${toDateInputValue(startDate)}::date AND ${toDateInputValue(endDate)}::date
          AND rating > 0
      ), 0)::float AS avg_rating,
      COALESCE(AVG(rating) FILTER (
        WHERE bill_date BETWEEN ${toDateInputValue(lyStart)}::date AND ${toDateInputValue(lyEnd)}::date
          AND rating > 0
      ), 0)::float AS avg_rating_ly,
      COALESCE(
        (
          COUNT(*) FILTER (
            WHERE bill_date BETWEEN ${toDateInputValue(startDate)}::date AND ${toDateInputValue(endDate)}::date
              AND pick_drop_value NOT IN ('', '-', 'none', 'no', 'n/a', 'na')
          )::float
          / NULLIF(COUNT(*) FILTER (
            WHERE bill_date BETWEEN ${toDateInputValue(startDate)}::date AND ${toDateInputValue(endDate)}::date
          ), 0)
        ) * 100,
        0
      )::float AS pick_drop_rate,
      COALESCE(
        (
          COUNT(*) FILTER (
            WHERE bill_date BETWEEN ${toDateInputValue(lyStart)}::date AND ${toDateInputValue(lyEnd)}::date
              AND pick_drop_value NOT IN ('', '-', 'none', 'no', 'n/a', 'na')
          )::float
          / NULLIF(COUNT(*) FILTER (
            WHERE bill_date BETWEEN ${toDateInputValue(lyStart)}::date AND ${toDateInputValue(lyEnd)}::date
          ), 0)
        ) * 100,
        0
      )::float AS pick_drop_rate_ly
    FROM base
  `)

  const row = ((result as unknown as Array<{
    avg_rating: number
    avg_rating_ly: number
    pick_drop_rate: number
    pick_drop_rate_ly: number
  }>) || [])[0]

  return {
    avgRating: numberValue(row?.avg_rating),
    avgRatingLy: numberValue(row?.avg_rating_ly),
    pickDropRate: numberValue(row?.pick_drop_rate),
    pickDropRateLy: numberValue(row?.pick_drop_rate_ly),
  }
}

async function fetchAdvisorLeaderboardRows(startDate: Date, endDate: Date, dealerCode: DealerFilter = null): Promise<AdvisorLeaderboardRow[]> {
  const result = await db.execute(HAS_DAILY_SUMMARY_V2 && !dealerCode ? sql`
    WITH advisor_totals AS (
      SELECT
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS name,
        COALESCE(SUM(load_count), 0)::int AS load,
        COALESCE(SUM(labour_amount), 0)::float AS labour,
        COALESCE(SUM(part_amount), 0)::float AS parts,
        COALESCE(SUM(total_amount), 0)::float AS total_amount
      FROM ro_billing_daily_summary_v2
      WHERE bill_date >= ${toDateInputValue(startDate)}::date
        AND bill_date < (${toDateInputValue(endDate)}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
      GROUP BY name
    ),
    ranked AS (
      SELECT
        name,
        load,
        labour,
        parts,
        CASE WHEN total_amount > 0 THEN total_amount ELSE labour + parts END AS revenue
      FROM advisor_totals
      WHERE name <> 'Unspecified'
    ),
    totals AS (
      SELECT COALESCE(SUM(revenue), 0)::float AS total_revenue FROM ranked
    )
    SELECT
      ranked.name,
      ranked.load,
      ranked.labour,
      ranked.parts,
      ranked.revenue,
      CASE WHEN ranked.load > 0 THEN ranked.revenue / ranked.load ELSE 0 END::float AS average_billing,
      CASE WHEN totals.total_revenue > 0 THEN (ranked.revenue / totals.total_revenue) * 100 ELSE 0 END::float AS contribution
    FROM ranked
    CROSS JOIN totals
    ORDER BY ranked.revenue DESC, ranked.load DESC, ranked.name ASC
    LIMIT 100
  ` : sql`
    WITH dedup AS (
      SELECT
        service_advisor AS name,
        bill_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
      FROM (
        SELECT
          COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS service_advisor,
          COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
          COALESCE(labour_amt, 0)::numeric AS labour_amt,
          COALESCE(part_amt, 0)::numeric AS part_amt,
          COALESCE(total_amt, 0)::numeric AS total_amt
        FROM ro_billing_report
        WHERE bill_date >= ${toDateInputValue(startDate)}::date
          AND bill_date < (${toDateInputValue(endDate)}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode)}
      ) base
      GROUP BY service_advisor, bill_key
    ),
    advisor_totals AS (
      SELECT
        name,
        COUNT(DISTINCT bill_key)::int AS load,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(total_amt), 0)::float AS total_amount
      FROM dedup
      WHERE name <> 'Unspecified'
      GROUP BY name
    ),
    ranked AS (
      SELECT
        name,
        load,
        labour,
        parts,
        CASE WHEN total_amount > 0 THEN total_amount ELSE labour + parts END AS revenue
      FROM advisor_totals
    ),
    totals AS (
      SELECT COALESCE(SUM(revenue), 0)::float AS total_revenue FROM ranked
    )
    SELECT
      ranked.name,
      ranked.load,
      ranked.labour,
      ranked.parts,
      ranked.revenue,
      CASE WHEN ranked.load > 0 THEN ranked.revenue / ranked.load ELSE 0 END::float AS average_billing,
      CASE WHEN totals.total_revenue > 0 THEN (ranked.revenue / totals.total_revenue) * 100 ELSE 0 END::float AS contribution
    FROM ranked
    CROSS JOIN totals
    ORDER BY ranked.revenue DESC, ranked.load DESC, ranked.name ASC
    LIMIT 100
  `)

  return ((result as unknown as Array<{
    name: string
    load: number
    labour: number
    parts: number
    revenue: number
    average_billing: number
    contribution: number
  }>) || []).map((row) => ({
    name: row.name || 'Unspecified',
    load: numberValue(row.load),
    labour: numberValue(row.labour),
    parts: numberValue(row.parts),
    revenue: numberValue(row.revenue),
    averageBilling: numberValue(row.average_billing),
    contribution: numberValue(row.contribution),
  }))
}

async function fetchTechnicianReportRows(
  startDate: Date,
  endDate: Date,
  dealerCode: DealerFilter = null,
): Promise<TechnicianReportRow[]> {
  const result = await db.execute(sql`
    WITH dedup AS (
      SELECT
        technician AS name,
        dealer_code,
        bill_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(labour_disc ORDER BY ABS(labour_disc) DESC))[1] AS labour_disc
      FROM (
        SELECT
          COALESCE(NULLIF(technician, ''), 'Unspecified') AS technician,
          COALESCE(NULLIF(dealer_code, ''), 'Unspecified') AS dealer_code,
          COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
          COALESCE(labour_amt, 0)::numeric AS labour_amt,
          (CASE WHEN TRIM(labour_disc) ~ '^-?[0-9]+(\.[0-9]+)?$' THEN TRIM(labour_disc)::numeric ELSE 0 END) AS labour_disc
        FROM ro_billing_report
        WHERE bill_date >= ${toDateInputValue(startDate)}::date
          AND bill_date < (${toDateInputValue(endDate)}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode)}
      ) base
      GROUP BY technician, dealer_code, bill_key
    ),
    technician_totals AS (
      SELECT
        name,
        dealer_code,
        COUNT(DISTINCT bill_key)::int AS load,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(labour_disc), 0)::float AS labour_disc
      FROM dedup
      WHERE name <> 'Unspecified'
      GROUP BY name, dealer_code
    )
    SELECT
      name,
      dealer_code,
      load,
      labour,
      labour_disc,
      CASE WHEN load > 0 THEN labour / load ELSE 0 END::float AS labour_per_ro,
      CASE WHEN load > 0 THEN labour_disc / load ELSE 0 END::float AS discount_per_ro,
      CASE WHEN labour > 0 THEN (labour_disc / labour) * 100 ELSE 0 END::float AS discount_pct
    FROM technician_totals
    ORDER BY dealer_code ASC, labour DESC, load DESC, name ASC
    LIMIT 1000
  `)

  return ((result as unknown as Array<{
    name: string
    dealer_code: string
    load: number
    labour: number
    labour_disc: number
    labour_per_ro: number
    discount_per_ro: number
    discount_pct: number
  }>) || []).map((row) => ({
    name: row.name || 'Unspecified',
    dealer_code: row.dealer_code || 'Unspecified',
    load: numberValue(row.load),
    labour: numberValue(row.labour),
    labour_disc: numberValue(row.labour_disc),
    labour_per_ro: numberValue(row.labour_per_ro),
    discount_per_ro: numberValue(row.discount_per_ro),
    discount_pct: numberValue(row.discount_pct),
  }))
}

async function resolveTdAnchorDate(endDate: Date) {
  return startOfDay(endDate)
}

async function fetchRawWorkTypeAggregateRows(windows: Record<PeriodKey, PeriodWindow>, dealerCode: DealerFilter = null) {
  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
        COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
        COALESCE(NULLIF(technician, ''), 'Unspecified') AS technician,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
        bill_date::date AS bill_date,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${toDateInputValue(windows.ytd.lyStart)}::date
        AND bill_date < (${toDateInputValue(windows.ytd.cyEnd)}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        AND ${activeServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    parent_dedup AS (
      SELECT
        'parent'::text AS aggregate_level,
        work_type,
        NULL::text AS service_type,
        NULL::text AS technician,
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      GROUP BY work_type, bill_key, bill_date
    ),
    free_service_type_dedup AS (
      SELECT
        'free_service_type'::text AS aggregate_level,
        work_type,
        service_type,
        NULL::text AS technician,
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      WHERE LOWER(TRIM(work_type)) IN ('free service', 'free services')
        AND service_type <> 'Unspecified'
      GROUP BY work_type, service_type, bill_key, bill_date
    ),
    running_technician_dedup AS (
      SELECT
        'running_technician'::text AS aggregate_level,
        work_type,
        NULL::text AS service_type,
        technician,
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      WHERE LOWER(TRIM(work_type)) IN ('running repair', 'running repairs')
        AND technician <> 'Unspecified'
      GROUP BY work_type, technician, bill_key, bill_date
    ),
    aggregate_rows AS (
      SELECT * FROM parent_dedup
      UNION ALL
      SELECT * FROM free_service_type_dedup
      UNION ALL
      SELECT * FROM running_technician_dedup
    )
    SELECT
      aggregate_level,
      work_type,
      service_type,
      technician,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date)::int AS td_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.lyStart)}::date AND ${toDateInputValue(windows.td.lyEnd)}::date)::int AS td_ly_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date)::int AS mtd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date)::int AS mtd_ly_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date)::int AS qtd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date)::int AS qtd_ly_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date)::int AS ytd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date)::int AS ytd_ly_load,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.lyStart)}::date AND ${toDateInputValue(windows.td.lyEnd)}::date), 0)::float AS td_ly_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_labour,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.lyStart)}::date AND ${toDateInputValue(windows.td.lyEnd)}::date), 0)::float AS td_ly_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_parts
    FROM aggregate_rows
    GROUP BY aggregate_level, work_type, service_type, technician
  `)

  return (result as unknown as WorkTypeAggregateRow[]) || []
}

async function fetchWorkTypeAggregateRows(windows: Record<PeriodKey, PeriodWindow>, dealerCode: DealerFilter = null) {
  return fetchRawWorkTypeAggregateRows(windows, dealerCode)
}

async function fetchRows({ startDate, endDate, dealerCode }: { startDate?: Date; endDate?: Date; dealerCode?: DealerFilter }) {
  const hasDateRange = Boolean(startDate && endDate)
  const [result, freshness] = await Promise.all([
    hasDateRange
      ? db.execute(sql`
        SELECT
          bill_no,
          ro_no,
          bill_date,
          labour_amt,
          part_amt,
          total_amt,
          work_type,
          service_type,
          technician,
          service_advisor,
          model,
          bill_type,
          bill_status,
          pick_drop,
          avg_rating,
          uploaded_at,
          labour_disc,
          dealer_code
        FROM ro_billing_report
        WHERE bill_date BETWEEN ${toDateInputValue(startDate!)}::date AND ${toDateInputValue(endDate!)}::date
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode || null)}
      `)
      : db.execute(sql`
        SELECT
          bill_no,
          ro_no,
          bill_date,
          labour_amt,
          part_amt,
          total_amt,
          work_type,
          service_type,
          technician,
          service_advisor,
          model,
          bill_type,
          bill_status,
          pick_drop,
          avg_rating,
          uploaded_at,
          labour_disc,
          dealer_code
        FROM ro_billing_report
        WHERE bill_date IS NOT NULL
          AND ${activeBillStatusSql()}
          AND ${activeServiceCategoryFilter()}
          ${roBillingDealerFilter(dealerCode || null)}
      `),
    db.execute(sql`
      SELECT
        MAX(uploaded_at) AS "uploadedAt",
        COUNT(*) FILTER (WHERE ${activeBillStatusSql()} AND ${activeServiceCategoryFilter()} ${roBillingDealerFilter(dealerCode || null)})::int AS "totalRows"
      FROM ro_billing_report
    `),
  ])

  return {
    id: 'ro_billing_report',
    brand: 'kia',
    sheetName: 'RO Billing Report',
    uploadedAt: freshness[0]?.uploadedAt as string | null,
    totalRows: Number(freshness[0]?.totalRows || 0),
    rows: result as DataRow[],
  }
}

async function fetchCancelledBillingSummary(startDate: Date, endDate: Date, dealerCode: DealerFilter = null): Promise<CancelledBillingSummary> {
  const result = await db.execute(sql`
    WITH cancelled AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
        NULLIF(bill_no, '') AS bill_no,
        NULLIF(ro_no, '') AS ro_no,
        bill_date::date AS bill_date,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
        COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        COALESCE(NULLIF(bill_status, ''), 'Cancel') AS bill_status,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt
      FROM ro_billing_report
      WHERE bill_date >= ${toDateInputValue(startDate)}::date
        AND bill_date < (${toDateInputValue(endDate)}::date + INTERVAL '1 day')
        AND ${cancelledBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT
        bill_key,
        (ARRAY_AGG(bill_no ORDER BY bill_date DESC NULLS LAST))[1] AS bill_no,
        (ARRAY_AGG(ro_no ORDER BY bill_date DESC NULLS LAST))[1] AS ro_no,
        MAX(bill_date)::text AS bill_date,
        (ARRAY_AGG(work_type ORDER BY ABS(COALESCE(total_amt, labour_amt + part_amt, 0)) DESC))[1] AS work_type,
        (ARRAY_AGG(service_type ORDER BY ABS(COALESCE(total_amt, labour_amt + part_amt, 0)) DESC))[1] AS service_type,
        (ARRAY_AGG(advisor ORDER BY bill_date DESC NULLS LAST))[1] AS advisor,
        (ARRAY_AGG(bill_status ORDER BY bill_date DESC NULLS LAST))[1] AS bill_status,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
      FROM cancelled
      GROUP BY bill_key
    )
    SELECT
      bill_key,
      COALESCE(bill_no, '') AS bill_no,
      COALESCE(ro_no, '') AS ro_no,
      bill_date,
      work_type,
      service_type,
      advisor,
      bill_status,
      COALESCE(labour_amt, 0)::float AS labour,
      COALESCE(part_amt, 0)::float AS parts,
      CASE WHEN COALESCE(total_amt, 0) <> 0 THEN total_amt ELSE COALESCE(labour_amt, 0) + COALESCE(part_amt, 0) END::float AS total
    FROM dedup
    ORDER BY bill_date DESC NULLS LAST, bill_key ASC
  `)

  const rows = ((result as unknown as Array<{
    bill_key: string
    bill_no: string
    ro_no: string
    bill_date: string | null
    work_type: string
    service_type: string
    advisor: string
    bill_status: string
    labour: number
    parts: number
    total: number
  }>) || []).map((row) => ({
    billKey: row.bill_key,
    billNo: row.bill_no,
    roNo: row.ro_no,
    billDate: row.bill_date,
    workType: row.work_type,
    serviceType: row.service_type,
    advisor: row.advisor,
    billStatus: row.bill_status,
    labour: numberValue(row.labour),
    parts: numberValue(row.parts),
    total: numberValue(row.total),
  }))

  return {
    count: rows.length,
    labour: rows.reduce((sum, row) => sum + row.labour, 0),
    parts: rows.reduce((sum, row) => sum + row.parts, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
    rows,
  }
}

function createBaseRowsCacheKey(startDate?: Date, endDate?: Date, dealerCode: DealerFilter = null) {
  return `kia:business-excellence:ro-billing:base-rows:${KIA_BUSINESS_EXCELLENCE_CACHE_VERSION}:${startDate ? toDateInputValue(startDate) : 'all'}:${endDate ? toDateInputValue(endDate) : 'all'}:${dealerCode || 'all'}`
}

function createCacheKey(searchParams: URLSearchParams) {
  const stableParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `kia:business-excellence:ro-billing:${KIA_BUSINESS_EXCELLENCE_CACHE_VERSION}:${createHash('sha1').update(stableParams).digest('hex')}`
}

function normalizeGroupBy(value: string) {
  const key = normalizeSheetSlug(value)
  const aliases: Record<string, string> = {
    work_type: 'work_type',
    service_type: 'work_type',
    advisor: 'service_advisor',
    service_advisor: 'service_advisor',
    model: 'model',
    technician: 'technician',
    bill_type: 'bill_type',
    bill_status: 'bill_status',
  }
  return aliases[key] || 'work_type'
}

export async function GET(request: Request) {
  const timer = createApiTimer('ro-billing-analysis')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const brand = searchParams.get('brand') || 'kia'
    const sheet = normalizeSheetSlug(searchParams.get('sheet') || 'ro_billing_report')
    const analysisType = (searchParams.get('analysisType') || 'load') as AnalysisType
    const view = (searchParams.get('view') || 'table') as AnalysisView
    const groupBy = normalizeGroupBy(searchParams.get('groupBy') || 'work_type')
    const skipCache = searchParams.get('skipCache') === 'true'
    const batchMetrics = searchParams.get('metrics') === 'all'
    const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code')) || null

    if (!RO_ANALYSIS_TYPES.includes(analysisType)) {
      return NextResponse.json({ error: 'Invalid analysis type' }, { status: 400 })
    }

    if (!['table', 'trend', 'fy', 'analytics', 'revenue', 'leaderboard', 'technician'].includes(view)) {
      return NextResponse.json({ error: 'Invalid analysis view' }, { status: 400 })
    }

    if (brand !== 'kia' || sheet !== 'ro_billing_report') {
      return NextResponse.json({ error: 'RO Billing analysis is available for the KIA ro_billing_report table only' }, { status: 400 })
    }

    const today = new Date()
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const startDate = startOfDay(parseDateInput(searchParams.get('startDate')) || defaultStart)
    const endDate = endOfDay(parseDateInput(searchParams.get('endDate')) || today)
    const parsedComparisonStartDate = parseDateInput(searchParams.get('comparisonStartDate'))
    const parsedComparisonEndDate = parseDateInput(searchParams.get('comparisonEndDate'))
    const comparisonRange: ComparisonRange = parsedComparisonStartDate && parsedComparisonEndDate
      ? {
          startDate: startOfDay(parsedComparisonStartDate),
          endDate: endOfDay(parsedComparisonEndDate),
        }
      : null
    const cacheParams = new URLSearchParams(searchParams)
    cacheParams.set('brand', brand)
    cacheParams.set('analysisType', analysisType)
    cacheParams.set('view', view)
    cacheParams.set('groupBy', groupBy)
    cacheParams.set('startDate', toDateInputValue(startDate))
    cacheParams.set('endDate', toDateInputValue(endDate))
    if (dealerCode) cacheParams.set('dealer_code', dealerCode)
    else cacheParams.delete('dealer_code')
    if (comparisonRange) {
      cacheParams.set('comparisonMode', 'custom')
      cacheParams.set('comparisonStartDate', toDateInputValue(comparisonRange.startDate))
      cacheParams.set('comparisonEndDate', toDateInputValue(comparisonRange.endDate))
    } else {
      cacheParams.delete('comparisonMode')
      cacheParams.delete('comparisonStartDate')
      cacheParams.delete('comparisonEndDate')
    }
    if (batchMetrics) cacheParams.set('metrics', 'all')
    const cacheKey = createCacheKey(cacheParams)

    const analyze = async () => {
      const tdAnchorDate = await timer.time('td-anchor-date', () => resolveTdAnchorDate(endDate))
      const windows = buildPeriodWindows(startDate, endDate, comparisonRange, tdAnchorDate)
      const sourceMetadata = await timer.time('source-metadata', () => fetchKiaBillingSourceMetadata(
        toDateInputValue(startDate),
        toDateInputValue(endDate),
        dealerCode,
      ))
      const hasFilters = Array.from(searchParams.entries()).some(([key, value]) => {
        return key in FILTER_COLUMNS && value && value !== 'all'
      })
      const baseFastResponse = {
        sheet: {
          id: 'ro_billing_report',
          brand: 'kia',
          sheetName: 'RO Billing Report',
          uploadedAt: null,
        },
        analysisType,
        dateBasis: 'Bill Date',
        dateRange: {
          startDate: toDateInputValue(startDate),
          endDate: toDateInputValue(endDate),
          tdDate: toDateInputValue(tdAnchorDate),
          comparisonStartDate: comparisonRange ? toDateInputValue(comparisonRange.startDate) : null,
          comparisonEndDate: comparisonRange ? toDateInputValue(comparisonRange.endDate) : null,
        },
        filterOptions: {},
        sourceMetadata,
      }
      if (view === 'table' && groupBy === 'work_type' && !hasFilters) {
        const cancelledSummary = await timer.time('cancelled-billing-summary', () => fetchCancelledBillingSummary(startDate, endDate, dealerCode))
        const aggregateRows = await timer.time('work-type-sql-summary', () => fetchWorkTypeAggregateRows(windows, dealerCode))
        if (batchMetrics) {
          const byMetric = Object.fromEntries(RO_ANALYSIS_TYPES.map((type) => {
            const rows = aggregateRowsToStats(aggregateRows, type)
            return [type, {
              ...baseFastResponse,
              analysisType: type,
              rowCounts: {
                totalRows: 0,
                rowsWithBillDate: 0,
                filteredRows: rows.length,
              },
              rows,
            }]
          }))
          return {
            ...baseFastResponse,
            cancelledSummary,
            rowCounts: {
              totalRows: 0,
              rowsWithBillDate: 0,
              filteredRows: aggregateRows.length,
            },
            byMetric,
          }
        }
        const rows = aggregateRowsToStats(aggregateRows, analysisType)
        return {
          ...baseFastResponse,
          cancelledSummary,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: rows.length,
          },
          rows,
        }
      }
      if (view === 'trend' && groupBy === 'work_type' && !hasFilters) {
        const aggregateRows = await timer.time('daily-trend-sql-summary', () => fetchDailyAggregateRows(startDate, endDate, comparisonRange, dealerCode))
        if (batchMetrics) {
          const byMetric = Object.fromEntries(RO_ANALYSIS_TYPES.map((type) => {
            const trend = buildDailyTrendRows(aggregateRows, type, startDate, endDate, comparisonRange)
            return [type, {
              ...baseFastResponse,
              analysisType: type,
              rowCounts: {
                totalRows: 0,
                rowsWithBillDate: 0,
                filteredRows: trend.length,
              },
              trend,
            }]
          }))
          return {
            ...baseFastResponse,
            rowCounts: {
              totalRows: 0,
              rowsWithBillDate: 0,
              filteredRows: aggregateRows.length,
            },
            byMetric,
          }
        }
        const trend = buildDailyTrendRows(aggregateRows, analysisType, startDate, endDate, comparisonRange)
        return {
          ...baseFastResponse,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: trend.length,
          },
          trend,
        }
      }
      if (view === 'analytics' && groupBy === 'work_type' && !hasFilters) {
        const analyticsSummary = await timer.time('analytics-quality-sql-summary', () => fetchAnalyticsQualitySummary(startDate, endDate, dealerCode))
        return {
          ...baseFastResponse,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: 0,
          },
          analyticsSummary,
        }
      }
      if (view === 'leaderboard' && groupBy === 'work_type' && !hasFilters) {
        const advisorLeaderboard = await timer.time('advisor-leaderboard-sql-summary', () => fetchAdvisorLeaderboardRows(startDate, endDate, dealerCode))
        return {
          ...baseFastResponse,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: advisorLeaderboard.length,
          },
          advisorLeaderboard,
        }
      }
      if (view === 'technician' && groupBy === 'work_type' && !hasFilters) {
        const technicianReport = await timer.time('technician-report-sql-summary', () => fetchTechnicianReportRows(startDate, endDate, dealerCode))
        return {
          ...baseFastResponse,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: technicianReport.length,
          },
          technicianReport,
        }
      }
      if (view === 'fy' && groupBy === 'work_type' && !hasFilters) {
        const aggregateRows = await timer.time('fy-trend-sql-summary', () => fetchFiscalAggregateRows(dealerCode))
        if (batchMetrics) {
          const byMetric = Object.fromEntries(RO_ANALYSIS_TYPES.map((type) => {
            const fyTrends = buildFiscalTrendRows(aggregateRows, type)
            return [type, {
              ...baseFastResponse,
              analysisType: type,
              rowCounts: {
                totalRows: 0,
                rowsWithBillDate: 0,
                filteredRows: fyTrends.length,
              },
              fyTrends,
            }]
          }))
          return {
            ...baseFastResponse,
            rowCounts: {
              totalRows: 0,
              rowsWithBillDate: 0,
              filteredRows: aggregateRows.length,
            },
            byMetric,
          }
        }
        const fyTrends = buildFiscalTrendRows(aggregateRows, analysisType)
        return {
          ...baseFastResponse,
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: fyTrends.length,
          },
          fyTrends,
        }
      }
      const windowStarts = Object.values(windows).flatMap((period) => [period.cyStart, period.lyStart])
      const windowEnds = Object.values(windows).flatMap((period) => [period.cyEnd, period.lyEnd])
      const relationalStart = view === 'fy' ? undefined : new Date(Math.min(...windowStarts.map((date) => date.getTime()), startDate.getTime()))
      const relationalEnd = view === 'fy' ? undefined : new Date(Math.max(...windowEnds.map((date) => date.getTime()), endDate.getTime()))
      const baseRowsCacheKey = createBaseRowsCacheKey(relationalStart, relationalEnd, dealerCode)
      const sheetData = await timer.time('base-rows', () => getCachedData(
        baseRowsCacheKey,
        () => fetchRows({ startDate: relationalStart, endDate: relationalEnd, dealerCode }),
        CACHE_TTL_SECONDS
      ))
      const allRows = Array.isArray(sheetData.rows) ? sheetData.rows : []
      const rowsWithBillDate = allRows.filter((row) => !!parseBillDate(row))
      const filteredRows = applyFilters(rowsWithBillDate, searchParams)
      const baseResponse = {
        sheet: {
          id: sheetData.id,
          brand: sheetData.brand,
          sheetName: sheetData.sheetName,
          uploadedAt: sheetData.uploadedAt,
        },
        analysisType,
        dateBasis: 'Bill Date',
        dateRange: {
          startDate: toDateInputValue(startDate),
          endDate: toDateInputValue(endDate),
        },
        filterOptions: buildFilterOptions(rowsWithBillDate),
        rowCounts: {
          totalRows: sheetData.totalRows,
          rowsWithBillDate: rowsWithBillDate.length,
          filteredRows: filteredRows.length,
        },
      }

      if (view === 'trend') {
        return {
          ...baseResponse,
          trend: buildTrend(filteredRows, analysisType, startDate, endDate),
        }
      }

      if (view === 'fy') {
        return {
          ...baseResponse,
          fyTrends: buildFiscalTrends(filteredRows, analysisType),
        }
      }

      if (view === 'analytics') {
        return {
          ...baseResponse,
          totals: calculateMetrics(filteredRows, analysisType, windows),
          distribution: buildDistribution(filteredRows, analysisType, startDate, endDate, groupBy),
        }
      }

      if (view === 'revenue') {
        return {
          ...baseResponse,
          revenueSummary: buildRevenueSummary(filteredRows, startDate, endDate),
        }
      }

      if (view === 'leaderboard') {
        const advisorBuckets = new Map<string, RawAggregate>()
        filteredRows.forEach((row) => {
          const date = parseBillDate(row)
          if (!date || !inWindow(date, startDate, endDate)) return
          const advisor = getAdvisorValue(row)
          if (advisor === 'Unspecified') return
          if (!advisorBuckets.has(advisor)) advisorBuckets.set(advisor, createRawAggregate())
          addRowToAggregate(advisorBuckets.get(advisor)!, row)
        })

        const totalRevenue = Array.from(advisorBuckets.values()).reduce((total, aggregate) => {
          const labour = sumBillAmounts(aggregate.labourByBill)
          const parts = sumBillAmounts(aggregate.partsByBill)
          return total + labour + parts
        }, 0)

        return {
          ...baseResponse,
          advisorLeaderboard: Array.from(advisorBuckets.entries())
            .map(([name, aggregate]) => {
              const load = aggregate.billKeys.size
              const labour = sumBillAmounts(aggregate.labourByBill)
              const parts = sumBillAmounts(aggregate.partsByBill)
              const revenue = labour + parts
              return {
                name,
                load,
                labour,
                parts,
                revenue,
                averageBilling: load > 0 ? revenue / load : 0,
                contribution: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0,
              }
            })
            .sort((a, b) => b.revenue - a.revenue || b.load - a.load || a.name.localeCompare(b.name))
            .slice(0, 100),
        }
      }
      if (view === 'technician') {
        const technicianBuckets = new Map<string, { load: Set<string>; labour: number; labourDisc: number; dealerCode: string }>()
        filteredRows.forEach((row) => {
          const date = parseBillDate(row)
          if (!date || !inWindow(date, startDate, endDate)) return
          const tech = row.technician as string || 'Unspecified'
          if (tech === 'Unspecified') return
          const dealer = row.dealer_code as string || 'Unspecified'
          const billKey = String(row.bill_no || row.ro_no || row.id || '')
          if (!billKey) return

          const key = `${tech}::${dealer}`
          if (!technicianBuckets.has(key)) {
            technicianBuckets.set(key, { load: new Set<string>(), labour: 0, labourDisc: 0, dealerCode: dealer })
          }
          const bucket = technicianBuckets.get(key)!
          bucket.load.add(billKey)
          bucket.labour += Number(row.labour_amt || 0)
          bucket.labourDisc += Number(row.labour_disc || 0)
        })

        return {
          ...baseResponse,
          technicianReport: Array.from(technicianBuckets.entries())
            .map(([key, bucket]) => {
              const [name] = key.split('::')
              const load = bucket.load.size
              const labour = bucket.labour
              const labourDisc = bucket.labourDisc
              return {
                name,
                dealer_code: bucket.dealerCode,
                load,
                labour,
                labour_disc: labourDisc,
                labour_per_ro: load > 0 ? labour / load : 0,
                discount_per_ro: load > 0 ? labourDisc / load : 0,
                discount_pct: labour > 0 ? (labourDisc / labour) * 100 : 0,
              }
            })
            .sort((a, b) => a.dealer_code.localeCompare(b.dealer_code) || b.labour - a.labour || a.name.localeCompare(b.name))
        }
      }

      const groupColumns = [groupBy, 'work_type', 'technician'].filter((column, index, arr) => column && arr.indexOf(column) === index)
      const groupedRows = groupRows(filteredRows, analysisType, windows, groupColumns)

      return {
        ...baseResponse,
        ...(view === 'table' ? { cancelledSummary: await timer.time('cancelled-billing-summary', () => fetchCancelledBillingSummary(startDate, endDate, dealerCode)) } : {}),
        totals: calculateMetrics(filteredRows, analysisType, windows),
        selectedRangeValue: aggregateForRange(filteredRows, analysisType, startDate, endDate),
        rows: flattenRows(groupedRows),
      }
    }

    const result = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? analyze()
      : getCachedData(cacheKey, analyze, CACHE_TTL_SECONDS))

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json(result), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error building RO Billing analysis:', error)
    return NextResponse.json({ error: 'Failed to build RO Billing analysis' }, { status: 500 })
  }
}
