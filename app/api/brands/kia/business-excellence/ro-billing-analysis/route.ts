import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const FILTER_COLUMNS = {
  workType: 'work_type',
  serviceType: 'service_type',
  advisor: 'service_advisor',
  model: 'model',
  technician: 'technician',
  billType: 'bill_type',
  billStatus: 'bill_status',
} as const

type AnalysisType = 'load' | 'labour' | 'parts' | 'lab_per_veh' | 'part_per_veh'
type AnalysisView = 'table' | 'trend' | 'fy' | 'analytics' | 'revenue' | 'leaderboard'
type DataRow = Record<string, unknown>
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'

const RO_ANALYSIS_TYPES: AnalysisType[] = ['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh']

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

function getFiscalYearStart(date: Date) {
  const fiscalYear = date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear()
  return new Date(fiscalYear, 3, 1, 0, 0, 0, 0)
}

function buildPeriodWindows(endDate: Date): Record<PeriodKey, PeriodWindow> {
  const cyEnd = endOfDay(endDate)
  const cyTdStart = startOfDay(endDate)
  const cyMtdStart = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
  const quarterStartMonth = Math.floor(endDate.getMonth() / 3) * 3
  const cyQtdStart = new Date(endDate.getFullYear(), quarterStartMonth, 1)
  const cyYtdStart = getFiscalYearStart(endDate)

  return {
    td: {
      cyStart: cyTdStart,
      cyEnd,
      lyStart: sameDateLastYear(cyTdStart),
      lyEnd: sameDateLastYear(cyEnd),
    },
    mtd: {
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
  work_type: string | null
  service_type?: string | null
  td_cy_load: number
  mtd_cy_load: number
  mtd_ly_load: number
  qtd_cy_load: number
  qtd_ly_load: number
  ytd_cy_load: number
  ytd_ly_load: number
  td_cy_labour: number
  mtd_cy_labour: number
  mtd_ly_labour: number
  qtd_cy_labour: number
  qtd_ly_labour: number
  ytd_cy_labour: number
  ytd_ly_labour: number
  td_cy_parts: number
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

let hasRoBillingDailySummaryV2: boolean | null = null

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
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

async function hasDailySummaryV2() {
  if (hasRoBillingDailySummaryV2 !== null) return hasRoBillingDailySummaryV2

  const result = await db.execute(sql`
    SELECT to_regclass('public.ro_billing_daily_summary_v2') IS NOT NULL AS exists
  `)
  hasRoBillingDailySummaryV2 = Boolean(result[0]?.exists)
  return hasRoBillingDailySummaryV2
}

function aggregateRowsToStats(rows: WorkTypeAggregateRow[], analysisType: AnalysisType) {
  const combineRows = (sourceRows: WorkTypeAggregateRow[]): WorkTypeAggregateRow => {
    const combined = {
      work_type: sourceRows[0]?.work_type || 'Unspecified',
      service_type: null,
    } as WorkTypeAggregateRow
    const metricKeys = [
      'td_cy_load', 'mtd_cy_load', 'mtd_ly_load', 'qtd_cy_load', 'qtd_ly_load', 'ytd_cy_load', 'ytd_ly_load',
      'td_cy_labour', 'mtd_cy_labour', 'mtd_ly_labour', 'qtd_cy_labour', 'qtd_ly_labour', 'ytd_cy_labour', 'ytd_ly_labour',
      'td_cy_parts', 'mtd_cy_parts', 'mtd_ly_parts', 'qtd_cy_parts', 'qtd_ly_parts', 'ytd_cy_parts', 'ytd_ly_parts',
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
  rows.forEach((row) => {
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
    const children = workRows
      .map((row) => toAnalysisRow(row.service_type || 'Unspecified', row, 1))
      .sort((a, b) => a.name.localeCompare(b.name))

    return toAnalysisRow(workType, parent, 0, children)
  })
}

function buildDailyTrendRows(rows: DailyAggregateRow[], analysisType: AnalysisType, startDate: Date, endDate: Date) {
  const byDate = new Map<string, DailyAggregateRow>()
  rows.forEach((row) => {
    byDate.set(toDateInputValue(new Date(row.bill_date)), row)
  })

  const trend = []
  const cursor = startOfDay(startDate)
  while (cursor <= endDate) {
    const cyDate = toDateInputValue(cursor)
    const lyDate = toDateInputValue(sameDateLastYear(cursor))
    trend.push({
      date: cyDate,
      label: `${String(cursor.getDate()).padStart(2, '0')} ${cursor.toLocaleDateString('en-US', { weekday: 'short' })}`,
      cy: measureDailyRow(byDate.get(cyDate), analysisType),
      ly: measureDailyRow(byDate.get(lyDate), analysisType),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return trend
}

async function fetchDailyAggregateRows(startDate: Date, endDate: Date) {
  const relationalStart = sameDateLastYear(startDate)
  const relationalEnd = endDate

  const result = await db.execute(await hasDailySummaryV2() ? sql`
    SELECT
      bill_date,
      COALESCE(SUM(load_count), 0)::int AS load,
      COALESCE(SUM(labour_amount), 0)::float AS labour,
      COALESCE(SUM(part_amount), 0)::float AS parts
    FROM ro_billing_daily_summary_v2
    WHERE bill_date >= ${toDateInputValue(relationalStart)}::date
      AND bill_date < (${toDateInputValue(relationalEnd)}::date + INTERVAL '1 day')
    GROUP BY bill_date
    ORDER BY bill_date
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
        WHERE bill_date >= ${toDateInputValue(relationalStart)}::date
          AND bill_date < (${toDateInputValue(relationalEnd)}::date + INTERVAL '1 day')
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

async function fetchFiscalAggregateRows() {
  const result = await db.execute(await hasDailySummaryV2() ? sql`
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

async function fetchAnalyticsQualitySummary(startDate: Date, endDate: Date): Promise<AnalyticsQualitySummary> {
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

async function fetchAdvisorLeaderboardRows(startDate: Date, endDate: Date): Promise<AdvisorLeaderboardRow[]> {
  const result = await db.execute(await hasDailySummaryV2() ? sql`
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

async function fetchWorkTypeAggregateRows(windows: Record<PeriodKey, PeriodWindow>) {
  const result = await db.execute(await hasDailySummaryV2() ? sql`
    SELECT
      work_type,
      service_type,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::int AS td_cy_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::int AS mtd_cy_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::int AS mtd_ly_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::int AS qtd_cy_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::int AS qtd_ly_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::int AS ytd_cy_load,
      COALESCE(SUM(load_count) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::int AS ytd_ly_load,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_labour,
      COALESCE(SUM(labour_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_labour,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_parts,
      COALESCE(SUM(part_amount) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_parts
    FROM ro_billing_daily_summary_v2
    WHERE bill_date >= ${toDateInputValue(windows.ytd.lyStart)}::date
      AND bill_date < (${toDateInputValue(windows.ytd.cyEnd)}::date + INTERVAL '1 day')
    GROUP BY work_type, service_type
  ` : sql`
    WITH dedup AS (
      SELECT
        work_type,
        service_type,
        bill_key,
        bill_date,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM (
        SELECT
          COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
          COALESCE(NULLIF(service_type, ''), 'Unspecified') AS service_type,
          COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
          bill_date::date AS bill_date,
          COALESCE(labour_amt, 0)::numeric AS labour_amt,
          COALESCE(part_amt, 0)::numeric AS part_amt
        FROM ro_billing_report
        WHERE bill_date >= ${toDateInputValue(windows.ytd.lyStart)}::date
          AND bill_date < (${toDateInputValue(windows.ytd.cyEnd)}::date + INTERVAL '1 day')
      ) base
      GROUP BY work_type, service_type, bill_key, bill_date
    )
    SELECT
      work_type,
      service_type,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date)::int AS td_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date)::int AS mtd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date)::int AS mtd_ly_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date)::int AS qtd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date)::int AS qtd_ly_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date)::int AS ytd_cy_load,
      COUNT(DISTINCT bill_key) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date)::int AS ytd_ly_load,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_labour,
      COALESCE(SUM(labour_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_labour,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.td.cyStart)}::date AND ${toDateInputValue(windows.td.cyEnd)}::date), 0)::float AS td_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.cyStart)}::date AND ${toDateInputValue(windows.mtd.cyEnd)}::date), 0)::float AS mtd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.mtd.lyStart)}::date AND ${toDateInputValue(windows.mtd.lyEnd)}::date), 0)::float AS mtd_ly_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.cyStart)}::date AND ${toDateInputValue(windows.qtd.cyEnd)}::date), 0)::float AS qtd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.qtd.lyStart)}::date AND ${toDateInputValue(windows.qtd.lyEnd)}::date), 0)::float AS qtd_ly_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.cyStart)}::date AND ${toDateInputValue(windows.ytd.cyEnd)}::date), 0)::float AS ytd_cy_parts,
      COALESCE(SUM(part_amt) FILTER (WHERE bill_date BETWEEN ${toDateInputValue(windows.ytd.lyStart)}::date AND ${toDateInputValue(windows.ytd.lyEnd)}::date), 0)::float AS ytd_ly_parts
    FROM dedup
    GROUP BY work_type, service_type
  `)

  return (result as unknown as WorkTypeAggregateRow[]) || []
}

async function fetchRows({ startDate, endDate }: { startDate?: Date; endDate?: Date }) {
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
          uploaded_at
        FROM ro_billing_report
        WHERE bill_date BETWEEN ${toDateInputValue(startDate!)}::date AND ${toDateInputValue(endDate!)}::date
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
          uploaded_at
        FROM ro_billing_report
        WHERE bill_date IS NOT NULL
      `),
    db.execute(sql`SELECT MAX(uploaded_at) AS "uploadedAt", COUNT(*)::int AS "totalRows" FROM ro_billing_report`),
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

function createBaseRowsCacheKey(startDate?: Date, endDate?: Date) {
  return `ro_billing:base-rows:v2:${startDate ? toDateInputValue(startDate) : 'all'}:${endDate ? toDateInputValue(endDate) : 'all'}`
}

function createCacheKey(searchParams: URLSearchParams) {
  const stableParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `ro_billing:v11:${createHash('sha1').update(stableParams).digest('hex')}`
}

function normalizeGroupBy(value: string) {
  const key = normalizeSheetSlug(value)
  const aliases: Record<string, string> = {
    work_type: 'work_type',
    service_type: 'service_type',
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

    if (!RO_ANALYSIS_TYPES.includes(analysisType)) {
      return NextResponse.json({ error: 'Invalid analysis type' }, { status: 400 })
    }

    if (!['table', 'trend', 'fy', 'analytics', 'revenue', 'leaderboard'].includes(view)) {
      return NextResponse.json({ error: 'Invalid analysis view' }, { status: 400 })
    }

    if (brand !== 'kia' || sheet !== 'ro_billing_report') {
      return NextResponse.json({ error: 'RO Billing analysis is available for the KIA ro_billing_report table only' }, { status: 400 })
    }

    const today = new Date()
    const defaultStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const startDate = startOfDay(parseDateInput(searchParams.get('startDate')) || defaultStart)
    const endDate = endOfDay(parseDateInput(searchParams.get('endDate')) || today)
    const cacheParams = new URLSearchParams(searchParams)
    cacheParams.set('brand', brand)
    cacheParams.set('analysisType', analysisType)
    cacheParams.set('view', view)
    cacheParams.set('groupBy', groupBy)
    cacheParams.set('startDate', toDateInputValue(startDate))
    cacheParams.set('endDate', toDateInputValue(endDate))
    if (batchMetrics) cacheParams.set('metrics', 'all')
    const cacheKey = createCacheKey(cacheParams)

    const analyze = async () => {
      const windows = buildPeriodWindows(endDate)
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
        },
        filterOptions: {},
      }
      if (view === 'table' && groupBy === 'work_type' && !hasFilters) {
        const aggregateRows = await timer.time('work-type-sql-summary', () => fetchWorkTypeAggregateRows(windows))
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
          rowCounts: {
            totalRows: 0,
            rowsWithBillDate: 0,
            filteredRows: rows.length,
          },
          rows,
        }
      }
      if (view === 'trend' && groupBy === 'work_type' && !hasFilters) {
        const aggregateRows = await timer.time('daily-trend-sql-summary', () => fetchDailyAggregateRows(startDate, endDate))
        if (batchMetrics) {
          const byMetric = Object.fromEntries(RO_ANALYSIS_TYPES.map((type) => {
            const trend = buildDailyTrendRows(aggregateRows, type, startDate, endDate)
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
        const trend = buildDailyTrendRows(aggregateRows, analysisType, startDate, endDate)
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
        const analyticsSummary = await timer.time('analytics-quality-sql-summary', () => fetchAnalyticsQualitySummary(startDate, endDate))
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
        const advisorLeaderboard = await timer.time('advisor-leaderboard-sql-summary', () => fetchAdvisorLeaderboardRows(startDate, endDate))
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
      if (view === 'fy' && groupBy === 'work_type' && !hasFilters) {
        const aggregateRows = await timer.time('fy-trend-sql-summary', () => fetchFiscalAggregateRows())
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
      const baseRowsCacheKey = createBaseRowsCacheKey(relationalStart, relationalEnd)
      const sheetData = await timer.time('base-rows', () => getCachedData(
        baseRowsCacheKey,
        () => fetchRows({ startDate: relationalStart, endDate: relationalEnd }),
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

      const groupColumns = [groupBy, 'work_type', 'technician'].filter((column, index, arr) => column && arr.indexOf(column) === index)
      const groupedRows = groupRows(filteredRows, analysisType, windows, groupColumns)

      return {
        ...baseResponse,
        totals: calculateMetrics(filteredRows, analysisType, windows),
        selectedRangeValue: aggregateForRange(filteredRows, analysisType, startDate, endDate),
        rows: flattenRows(groupedRows),
      }
    }

    const result = await timer.time(skipCache ? 'analyze' : 'response-cache', () => skipCache
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
