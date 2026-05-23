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

const SCORING_RULES = [
  {
    key: 'rework_30_day',
    alertName: '30-Day Rework',
    formula: 'Checks if the same vehicle returned to the workshop within 30 days of its previous visit.',
    impact: -25,
  },
  {
    key: 'manual_discount',
    alertName: 'Manual Discount',
    formula: 'Flagged if any manual discount greater than 20 is applied to the bill.',
    impact: -10,
  },
  {
    key: 'labour_leakage',
    alertName: 'Labour Leakage',
    formula: 'Flagged if parts sale is greater than Rs. 1,000 but labour amount is Rs. 0.',
    impact: -20,
  },
  {
    key: 'low_labour_model',
    alertName: 'Low Labour (Model)',
    formula: 'Compares labour against monthly average for that model and service type. Flagged if below 50%.',
    impact: -10,
  },
  {
    key: 'low_parts_model',
    alertName: 'Low Parts (Model)',
    formula: 'Compares parts against monthly average for that model and service type. Flagged if below 50%.',
    impact: -10,
  },
  {
    key: 'low_labour_workshop',
    alertName: 'Low Labour (Workshop)',
    formula: "Compares labour against the entire workshop's monthly average for that service type. Flagged if below 50%.",
    impact: -5,
  },
  {
    key: 'low_parts_workshop',
    alertName: 'Low Parts (Workshop)',
    formula: "Compares parts against the entire workshop's monthly average for that service type. Flagged if below 50%.",
    impact: -5,
  },
] as const

type DataRow = Record<string, unknown>
type ScoringRule = typeof SCORING_RULES[number]

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
  return null
}

function parseDate(value: unknown) {
  if (!value) return null
  const date = parseDateInput(String(value))
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function textValue(row: DataRow, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = row[key]
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return String(value).trim()
    }
  }
  return fallback
}

function numericValue(row: DataRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value === null || value === undefined || String(value).trim() === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (filtered.length === 0) return 0
  return filtered.reduce((total, value) => total + value, 0) / filtered.length
}

function groupAverage(rows: DataRow[], keyFactory: (row: DataRow) => string, valueFactory: (row: DataRow) => number) {
  const buckets = new Map<string, number[]>()
  for (const row of rows) {
    const key = keyFactory(row)
    const values = buckets.get(key) || []
    values.push(valueFactory(row))
    buckets.set(key, values)
  }

  const result = new Map<string, number>()
  for (const [key, values] of buckets.entries()) {
    result.set(key, average(values))
  }
  return result
}

function vehicleKey(row: DataRow) {
  return textValue(row, ['chassis_no', 'vin', 'vehicle_reg_no', 'reg_number'])
}

function modelServiceKey(row: DataRow) {
  return `${textValue(row, ['model'], 'Unspecified')}||${textValue(row, ['service_type', 'work_type'], 'Unspecified')}`
}

function serviceKey(row: DataRow) {
  return textValue(row, ['service_type', 'work_type'], 'Unspecified')
}

function buildReworkSet(rows: DataRow[]) {
  const byVehicle = new Map<string, DataRow[]>()

  for (const row of rows) {
    const key = vehicleKey(row)
    if (!key) continue
    const bucket = byVehicle.get(key) || []
    bucket.push(row)
    byVehicle.set(key, bucket)
  }

  const reworked = new Set<DataRow>()
  for (const bucket of byVehicle.values()) {
    bucket.sort((a, b) => {
      const left = parseDate(a.bill_date)?.getTime() || 0
      const right = parseDate(b.bill_date)?.getTime() || 0
      return left - right
    })

    for (let index = 1; index < bucket.length; index += 1) {
      const currentDate = parseDate(bucket[index].bill_date)
      const previousDate = parseDate(bucket[index - 1].bill_date)
      if (!currentDate || !previousDate) continue
      const diffDays = (currentDate.getTime() - previousDate.getTime()) / (24 * 60 * 60 * 1000)
      if (diffDays >= 0 && diffDays <= 30) {
        reworked.add(bucket[index])
      }
    }
  }

  return reworked
}

function getAlertMeta(key: ScoringRule['key']) {
  return SCORING_RULES.find((rule) => rule.key === key)!
}

function scoreRows(rows: DataRow[]) {
  const reworkedRows = buildReworkSet(rows)
  const labourByModelService = groupAverage(rows, modelServiceKey, (row) => numericValue(row, ['labour_amt']))
  const partsByModelService = groupAverage(rows, modelServiceKey, (row) => numericValue(row, ['part_amt']))
  const labourByService = groupAverage(rows, serviceKey, (row) => numericValue(row, ['labour_amt']))
  const partsByService = groupAverage(rows, serviceKey, (row) => numericValue(row, ['part_amt']))

  return rows.map((row, index) => {
    const labour = numericValue(row, ['labour_amt'])
    const parts = numericValue(row, ['part_amt'])
    const discount = numericValue(row, ['job_discount', 'discount', 'dis_amt', 'total_disc', 'labour_disc', 'part_disc'])
    const alerts: ScoringRule[] = []
    const modelKey = modelServiceKey(row)
    const workshopKey = serviceKey(row)
    const modelLabourAvg = labourByModelService.get(modelKey) || 0
    const modelPartsAvg = partsByModelService.get(modelKey) || 0
    const workshopLabourAvg = labourByService.get(workshopKey) || 0
    const workshopPartsAvg = partsByService.get(workshopKey) || 0

    if (reworkedRows.has(row)) alerts.push(getAlertMeta('rework_30_day'))
    if (discount > 20) alerts.push(getAlertMeta('manual_discount'))
    if (parts > 1000 && labour === 0) alerts.push(getAlertMeta('labour_leakage'))
    if (modelLabourAvg > 0 && labour < modelLabourAvg * 0.5) alerts.push(getAlertMeta('low_labour_model'))
    if (modelPartsAvg > 0 && parts < modelPartsAvg * 0.5) alerts.push(getAlertMeta('low_parts_model'))
    if (workshopLabourAvg > 0 && labour < workshopLabourAvg * 0.5) alerts.push(getAlertMeta('low_labour_workshop'))
    if (workshopPartsAvg > 0 && parts < workshopPartsAvg * 0.5) alerts.push(getAlertMeta('low_parts_workshop'))

    const score = Math.max(0, 100 + alerts.reduce((total, alert) => total + alert.impact, 0))
    return {
      id: row.id || `${textValue(row, ['bill_no', 'ro_no'], 'row')}-${index}`,
      sr: index + 1,
      branch: textValue(row, ['branch', 'location', 'dealer_code', 'main_dealer_code'], 'Unspecified'),
      type: textValue(row, ['service_type', 'work_type'], 'Unspecified'),
      date: row.bill_date,
      billNo: textValue(row, ['bill_no']),
      model: textValue(row, ['model'], 'Unspecified'),
      regNumber: textValue(row, ['vehicle_reg_no', 'reg_number']),
      advisor: textValue(row, ['service_advisor', 'advisor'], 'Unspecified'),
      labourAmt: labour,
      partAmt: parts,
      discount,
      vas: textValue(row, ['vas_wa_wb', 'vas', 'wa_wb'], '-'),
      alerts: alerts.map((alert) => alert.alertName),
      score,
    }
  })
}

function uniqueOptions(rows: Array<Record<string, unknown>>, key: string) {
  return Array.from(new Set(rows.map((row) => String(row[key] || '').trim()).filter(Boolean))).sort()
}

function createCacheKey(searchParams: URLSearchParams) {
  const stableParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `ro_billing:performance-intelligence:v2:${createHash('sha1').update(stableParams).digest('hex')}`
}

function createBaseReportCacheKey(startDate: Date, endDate: Date) {
  return `ro_billing:performance-intelligence:base:v1:${toDateInputValue(startDate)}:${toDateInputValue(endDate)}`
}

async function fetchPerformanceRows(startDate: Date, endDate: Date) {
  const result = await db.execute(sql`
    SELECT
      id,
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
      vehicle_reg_no,
      dealer_code,
      main_dealer_code,
      dis_amt,
      total_disc,
      labour_disc,
      part_disc,
      vin,
      uploaded_at
    FROM ro_billing_report
    WHERE bill_date BETWEEN ${toDateInputValue(startDate)}::date AND ${toDateInputValue(endDate)}::date
    ORDER BY bill_date DESC, id DESC
    LIMIT 50000
  `)
  const rawRows = result as DataRow[]
  const scoredRows = scoreRows(rawRows)

  return {
    rawRows,
    scoredRows,
    alertCounts: Object.fromEntries(SCORING_RULES.map((rule) => [
      rule.alertName,
      scoredRows.filter((row) => row.alerts.includes(rule.alertName)).length,
    ])),
    filterOptions: {
      branches: uniqueOptions(scoredRows, 'branch'),
      serviceTypes: uniqueOptions(scoredRows, 'type'),
      advisors: uniqueOptions(scoredRows, 'advisor'),
      models: uniqueOptions(scoredRows, 'model'),
      alerts: SCORING_RULES.map((rule) => rule.alertName),
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('performance-intelligence')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const today = new Date()
    const startDate = parseDateInput(searchParams.get('startDate')) || new Date(today.getFullYear(), today.getMonth(), 1)
    const endDate = parseDateInput(searchParams.get('endDate')) || today
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(10, Number.parseInt(searchParams.get('limit') || '50', 10) || 50))
    const skipCache = searchParams.get('skipCache') === 'true'
    const cacheParams = new URLSearchParams(searchParams)
    cacheParams.set('startDate', toDateInputValue(startDate))
    cacheParams.set('endDate', toDateInputValue(endDate))
    const cacheKey = createCacheKey(cacheParams)

    const buildReport = async () => {
      const baseReport = await timer.time('base-report', () => getCachedData(
        createBaseReportCacheKey(startDate, endDate),
        () => fetchPerformanceRows(startDate, endDate),
        CACHE_TTL_SECONDS
      ))
      const { rawRows, scoredRows, alertCounts, filterOptions } = baseReport
      const searchReg = (searchParams.get('searchReg') || '').trim().toLowerCase()
      const branch = searchParams.get('branch') || 'all'
      const serviceType = searchParams.get('serviceType') || 'all'
      const advisor = searchParams.get('advisor') || 'all'
      const alertFilter = searchParams.get('alert') || 'all'
      const model = searchParams.get('model') || 'all'

      const filtered = scoredRows.filter((row) => {
        if (searchReg && !String(row.regNumber || '').toLowerCase().includes(searchReg)) return false
        if (branch !== 'all' && row.branch !== branch) return false
        if (serviceType !== 'all' && row.type !== serviceType) return false
        if (advisor !== 'all' && row.advisor !== advisor) return false
        if (model !== 'all' && row.model !== model) return false
        if (alertFilter !== 'all' && !row.alerts.some((alert) => alert === alertFilter)) return false
        return true
      })

      const total = filtered.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const safePage = Math.min(page, totalPages)
      const offset = (safePage - 1) * limit

      return {
        dateRange: {
          startDate: toDateInputValue(startDate),
          endDate: toDateInputValue(endDate),
        },
        metrics: {
          totalRecords: rawRows.length,
          filteredTransactions: filtered.length,
          alertsFound: filtered.filter((row) => row.alerts.length > 0).length,
          avgAdvisorScore: Math.round(average(filtered.map((row) => row.score))),
          alertCounts,
        },
        rules: SCORING_RULES,
        filterOptions,
        rows: filtered.slice(offset, offset + limit),
        pagination: {
          page: safePage,
          limit,
          total,
          totalPages,
        },
      }
    }

    const data = await timer.time(skipCache ? 'report' : 'response-cache', () => skipCache
      ? buildReport()
      : getCachedData(cacheKey, buildReport, CACHE_TTL_SECONDS))

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json(data), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error building performance intelligence report:', error)
    return NextResponse.json({ error: 'Failed to build Performance Intelligence Report' }, { status: 500 })
  }
}
