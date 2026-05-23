import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = 60 * 60
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
type AnalysisView = 'table' | 'trend' | 'fy' | 'analytics' | 'revenue'
type DataRow = Record<string, unknown>
type PeriodKey = 'td' | 'mtd' | 'qtd' | 'ytd'

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
  return `ro_billing:base-rows:v1:${startDate ? toDateInputValue(startDate) : 'all'}:${endDate ? toDateInputValue(endDate) : 'all'}`
}

function createCacheKey(searchParams: URLSearchParams) {
  const stableParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `ro_billing:v3:${createHash('sha1').update(stableParams).digest('hex')}`
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

    if (!['load', 'labour', 'parts', 'lab_per_veh', 'part_per_veh'].includes(analysisType)) {
      return NextResponse.json({ error: 'Invalid analysis type' }, { status: 400 })
    }

    if (!['table', 'trend', 'fy', 'analytics', 'revenue'].includes(view)) {
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
    const cacheKey = createCacheKey(cacheParams)

    const analyze = async () => {
      const windows = buildPeriodWindows(endDate)
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
