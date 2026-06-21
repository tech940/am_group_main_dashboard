import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import {
  HYUNDAI_BE_CALCULATION_META,
  hyundaiActiveBillSql,
  hyundaiRoBillingDealerSql,
  hyundaiRoBillingInvoiceKeySql,
} from '@/lib/hyundai/business-excellence-calculations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

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

type PerformanceFilterContext = {
  searchReg: string
  branch: string
  serviceType: string
  advisor: string
  model: string
}
type ScoredPerformanceRow = {
  id: string
  sr: number
  branch: string
  type: string
  date: string | Date | null
  billNo: string
  model: string
  regNumber: string
  advisor: string
  labourAmt: number
  partAmt: number
  discount: number
  alerts: string[]
  score: number
}
type PerformanceReportPayload = {
  rawRowCount: number
  total: number
  alertsFound: number
  scoreTotal: number
  alertCounts: Record<string, number>
  filterOptions: {
    branches: string[]
    serviceTypes: string[]
    advisors: string[]
    models: string[]
    alerts: string[]
  }
  advisorScores: Array<{
    advisor: string
    score: number
    transactions: number
    alerts: number
  }>
  rows: ScoredPerformanceRow[]
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
  return null
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function createCacheKey(searchParams: URLSearchParams) {
  const stableParams = Array.from(searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join('|')
  return `hyundai:business-excellence:performance-intelligence:v8:${createHash('sha1').update(stableParams).digest('hex')}`
}

function buildPerformanceWhere(startDate: Date, endDate: Date, filters: PerformanceFilterContext) {
  const clauses = [
    sql`bill_date BETWEEN ${toDateInputValue(startDate)}::date AND ${toDateInputValue(endDate)}::date`,
    hyundaiActiveBillSql(),
  ]

  if (filters.searchReg) {
    clauses.push(sql`vehicle_reg_no ILIKE ${`%${filters.searchReg}%`}`)
  }

  if (filters.branch !== 'all') {
    const normalizedDealer = normalizeHyundaiDealerCode(filters.branch)
    clauses.push(sql`${hyundaiRoBillingDealerSql()} = ${normalizedDealer || filters.branch}`)
  }

  if (filters.serviceType !== 'all') {
    clauses.push(sql`COALESCE(NULLIF(work_type, ''), 'Unspecified') = ${filters.serviceType}`)
  }

  if (filters.advisor !== 'all') {
    clauses.push(sql`COALESCE(NULLIF(service_advisor, ''), 'Unspecified') = ${filters.advisor}`)
  }

  if (filters.model !== 'all') {
    clauses.push(sql`COALESCE(NULLIF(model, ''), 'Unspecified') = ${filters.model}`)
  }

  return sql.join(clauses, sql` AND `)
}

function buildScoredPerformanceSql(startDate: Date, endDate: Date, filters: PerformanceFilterContext) {
  const whereClause = buildPerformanceWhere(startDate, endDate, filters)

  return sql`
    WITH base AS (
      SELECT
        id::text AS id,
        ${hyundaiRoBillingInvoiceKeySql()} AS bill_key,
        bill_date::date AS bill_date,
        COALESCE(${hyundaiRoBillingDealerSql()}, 'Unspecified') AS branch,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS type,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS work_type,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS service_type,
        COALESCE(NULLIF(model, ''), 'Unspecified') AS model,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        COALESCE(NULLIF(vehicle_reg_no, ''), '') AS reg_number,
        COALESCE(NULLIF(vin, ''), NULLIF(vehicle_reg_no, ''), '') AS vehicle_key,
        COALESCE(NULLIF(bill_no, ''), '') AS bill_no,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount
      FROM hyundai_ro_billing_report
      WHERE ${whereClause}
    ),
    dedup AS (
      SELECT DISTINCT ON (bill_key)
        *
      FROM base
      ORDER BY bill_key, ABS(labour_amt) DESC, ABS(part_amt) DESC, id DESC
    ),
    enriched AS (
      SELECT
        *,
        AVG(labour_amt) OVER (PARTITION BY model, type) AS model_labour_avg,
        AVG(part_amt) OVER (PARTITION BY model, type) AS model_parts_avg,
        AVG(labour_amt) OVER (PARTITION BY type) AS workshop_labour_avg,
        AVG(part_amt) OVER (PARTITION BY type) AS workshop_parts_avg,
        LAG(bill_date) OVER (PARTITION BY vehicle_key ORDER BY bill_date, id) AS previous_bill_date
      FROM dedup
    ),
    scored AS (
      SELECT
        *,
        ARRAY_REMOVE(ARRAY[
          CASE
            WHEN vehicle_key <> ''
              AND previous_bill_date IS NOT NULL
              AND bill_date - previous_bill_date BETWEEN 0 AND 30
            THEN '30-Day Rework'
          END,
          CASE WHEN discount > 20 THEN 'Manual Discount' END,
          CASE WHEN part_amt > 1000 AND labour_amt = 0 THEN 'Labour Leakage' END,
          CASE WHEN model_labour_avg > 0 AND labour_amt < model_labour_avg * 0.5 THEN 'Low Labour (Model)' END,
          CASE WHEN model_parts_avg > 0 AND part_amt < model_parts_avg * 0.5 THEN 'Low Parts (Model)' END,
          CASE WHEN workshop_labour_avg > 0 AND labour_amt < workshop_labour_avg * 0.5 THEN 'Low Labour (Workshop)' END,
          CASE WHEN workshop_parts_avg > 0 AND part_amt < workshop_parts_avg * 0.5 THEN 'Low Parts (Workshop)' END
        ], NULL)::text[] AS alerts
      FROM enriched
    ),
    scored_with_score AS (
      SELECT
        *,
        GREATEST(
          0,
          100
          - CASE WHEN '30-Day Rework' = ANY(alerts) THEN 25 ELSE 0 END
          - CASE WHEN 'Manual Discount' = ANY(alerts) THEN 10 ELSE 0 END
          - CASE WHEN 'Labour Leakage' = ANY(alerts) THEN 20 ELSE 0 END
          - CASE WHEN 'Low Labour (Model)' = ANY(alerts) THEN 10 ELSE 0 END
          - CASE WHEN 'Low Parts (Model)' = ANY(alerts) THEN 10 ELSE 0 END
          - CASE WHEN 'Low Labour (Workshop)' = ANY(alerts) THEN 5 ELSE 0 END
          - CASE WHEN 'Low Parts (Workshop)' = ANY(alerts) THEN 5 ELSE 0 END
        )::int AS score
      FROM scored
    )
  `
}

async function fetchPerformanceReportSql({
  startDate,
  endDate,
  filters,
  alertFilter,
  page,
  limit,
  exportAll,
}: {
  startDate: Date
  endDate: Date
  filters: PerformanceFilterContext
  alertFilter: string
  page: number
  limit: number
  exportAll: boolean
}): Promise<PerformanceReportPayload> {
  const scoredCte = buildScoredPerformanceSql(startDate, endDate, filters)
  const offset = (page - 1) * limit
  const alertWhere = alertFilter !== 'all'
    ? sql`WHERE ${alertFilter} = ANY(alerts)`
    : sql``
  const rowLimit = exportAll ? sql`` : sql`LIMIT ${limit} OFFSET ${offset}`

  const [payload] = await db.execute(sql`
    ${scoredCte},
    filtered AS (
      SELECT *
      FROM scored_with_score
      ${alertWhere}
    ),
    numbered AS (
      SELECT
        ROW_NUMBER() OVER (ORDER BY bill_date DESC, id DESC)::int AS sr,
        *
      FROM filtered
    ),
    page_rows AS (
      SELECT *
      FROM numbered
      ORDER BY sr
      ${rowLimit}
    ),
    alert_counts AS (
      SELECT alert_name, COUNT(*)::int AS count
      FROM filtered
      CROSS JOIN LATERAL unnest(alerts) AS alert_name
      GROUP BY alert_name
    ),
    advisor_scores AS (
      SELECT
        advisor,
        ROUND(AVG(score))::int AS score,
        COUNT(*)::int AS transactions,
        COALESCE(SUM(cardinality(alerts)), 0)::int AS alerts
      FROM filtered
      GROUP BY advisor
      ORDER BY score DESC, transactions DESC, advisor
    ),
    filter_source AS (
      SELECT *
      FROM scored_with_score
    )
    SELECT
      (SELECT COUNT(*)::int FROM scored_with_score) AS "rawRowCount",
      (SELECT COUNT(*)::int FROM filtered) AS total,
      (SELECT COUNT(*)::int FROM filtered WHERE cardinality(alerts) > 0) AS "alertsFound",
      (SELECT COALESCE(SUM(score), 0)::float FROM filtered) AS "scoreTotal",
      COALESCE((
        SELECT jsonb_object_agg(alert_name, count)
        FROM alert_counts
      ), '{}'::jsonb) AS "alertCounts",
      jsonb_build_object(
        'branches', COALESCE((SELECT jsonb_agg(branch ORDER BY branch) FROM (SELECT DISTINCT branch FROM filter_source WHERE branch <> '') options), '[]'::jsonb),
        'serviceTypes', COALESCE((SELECT jsonb_agg(type ORDER BY type) FROM (SELECT DISTINCT type FROM filter_source WHERE type <> '') options), '[]'::jsonb),
        'advisors', COALESCE((SELECT jsonb_agg(advisor ORDER BY advisor) FROM (SELECT DISTINCT advisor FROM filter_source WHERE advisor <> '') options), '[]'::jsonb),
        'models', COALESCE((SELECT jsonb_agg(model ORDER BY model) FROM (SELECT DISTINCT model FROM filter_source WHERE model <> '') options), '[]'::jsonb),
        'alerts', ${JSON.stringify(SCORING_RULES.map((rule) => rule.alertName))}::jsonb
      ) AS "filterOptions",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'advisor', advisor,
          'score', score,
          'transactions', transactions,
          'alerts', alerts
        ))
        FROM advisor_scores
      ), '[]'::jsonb) AS "advisorScores",
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'sr', sr,
          'branch', branch,
          'type', type,
          'date', bill_date,
          'billNo', bill_no,
          'model', model,
          'regNumber', reg_number,
          'advisor', advisor,
          'labourAmt', labour_amt,
          'partAmt', part_amt,
          'discount', discount,
          'alerts', alerts,
          'score', score
        ) ORDER BY sr)
        FROM page_rows
      ), '[]'::jsonb) AS rows
  `)

  const alertCounts = Object.fromEntries(SCORING_RULES.map((rule) => [rule.alertName, 0]))
  Object.entries((payload?.alertCounts || {}) as Record<string, number>).forEach(([key, value]) => {
    alertCounts[key] = Number(value || 0)
  })

  return {
    rawRowCount: Number(payload?.rawRowCount || 0),
    total: Number(payload?.total || 0),
    alertsFound: Number(payload?.alertsFound || 0),
    scoreTotal: numberValue(payload?.scoreTotal),
    alertCounts,
    filterOptions: (payload?.filterOptions || {
      branches: [],
      serviceTypes: [],
      advisors: [],
      models: [],
      alerts: SCORING_RULES.map((rule) => rule.alertName),
    }) as PerformanceReportPayload['filterOptions'],
    advisorScores: (payload?.advisorScores || []) as PerformanceReportPayload['advisorScores'],
    rows: (payload?.rows || []) as ScoredPerformanceRow[],
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('performance-intelligence')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const today = new Date()
    const startDate = parseDateInput(searchParams.get('startDate')) || new Date(today.getFullYear(), today.getMonth(), 1)
    const endDate = parseDateInput(searchParams.get('endDate')) || today
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.min(100, Math.max(10, Number.parseInt(searchParams.get('limit') || '50', 10) || 50))
    const exportAll = searchParams.get('export') === 'all'
    const skipCache = searchParams.get('skipCache') === 'true'
    const cacheParams = new URLSearchParams(searchParams)
    cacheParams.set('startDate', toDateInputValue(startDate))
    cacheParams.set('endDate', toDateInputValue(endDate))
    const dealerCode = normalizeHyundaiDealerCode(searchParams.get('dealer_code'))
    if (dealerCode) cacheParams.set('branch', dealerCode)
    const cacheKey = createCacheKey(cacheParams)

    const buildReport = async () => {
      const searchReg = (searchParams.get('searchReg') || '').trim().toLowerCase()
      const branch = dealerCode || searchParams.get('branch') || 'all'
      const serviceType = searchParams.get('serviceType') || 'all'
      const advisor = searchParams.get('advisor') || 'all'
      const alertFilter = searchParams.get('alert') || 'all'
      const model = searchParams.get('model') || 'all'
      const sqlFilters = { searchReg, branch, serviceType, advisor, model }
      const report = await timer.time('sql-scored-report', () => fetchPerformanceReportSql({
        startDate,
        endDate,
        filters: sqlFilters,
        alertFilter,
        page,
        limit,
        exportAll,
      }))

      const total = report.total
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const safePage = Math.min(page, totalPages)

      return {
        calculationMeta: HYUNDAI_BE_CALCULATION_META,
        dateRange: {
          startDate: toDateInputValue(startDate),
          endDate: toDateInputValue(endDate),
        },
        metrics: {
          totalRecords: report.rawRowCount,
          filteredTransactions: total,
          alertsFound: report.alertsFound,
          avgAdvisorScore: total > 0 ? Math.round(report.scoreTotal / total) : 0,
          alertCounts: report.alertCounts,
        },
        rules: SCORING_RULES,
        filterOptions: report.filterOptions,
        advisorScores: report.advisorScores,
        rows: report.rows,
        pagination: {
          page: safePage,
          limit,
          total,
          totalPages,
        },
      }
    }

    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
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
