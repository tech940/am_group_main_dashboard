import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type ResultRow = Record<string, unknown>

type OverviewFilters = {
  branch: 'all' | 'jammu' | 'udhampur'
  startDate: string
  endDate: string
}

type SourceState = {
  source: string
  exists: boolean
  sourceUpdatedAt: string | null
  warning?: string
  branchFiltered: boolean
}

const EMPTY_METRIC = { count: 0, amount: 0, secondaryAmount: 0, open: 0, closed: 0, pending: 0 }

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function normalizedDate(value: string | null) {
  const normalized = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function currentMonthStart() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

function todayInput() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function normalizedBranch(value: string | null): OverviewFilters['branch'] {
  const normalized = String(value || 'all').trim().toLowerCase()
  return normalized === 'jammu' || normalized === 'udhampur' ? normalized : 'all'
}

function getFilters(searchParams: URLSearchParams): OverviewFilters {
  return {
    branch: normalizedBranch(searchParams.get('branch')),
    startDate: normalizedDate(searchParams.get('startDate')) || currentMonthStart(),
    endDate: normalizedDate(searchParams.get('endDate')) || todayInput(),
  }
}

function createCacheKey(filters: OverviewFilters) {
  return `hyundai:business-excellence:overview:v1:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
}

async function getColumns(tableName: string) {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `)
  return new Set(resultRows(result).map((row) => String(row.column_name || '').toLowerCase()))
}

function findColumn(columns: Set<string>, candidates: string[]) {
  return candidates.find((candidate) => columns.has(candidate.toLowerCase())) || ''
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

function branchColumn(columns: Set<string>) {
  return findColumn(columns, ['dealer_code', 'source_dealer_code', 'main_dealer_code', 'dealer', 'main_dealer', 'dlr_no'])
}

function branchPredicate(branch: OverviewFilters['branch'], columnName: string): SQL {
  if (!columnName || branch === 'all') return sql`TRUE`
  return sql`
    (
      (${branch} = 'jammu' AND COALESCE(NULLIF(TRIM(${sql.raw(columnName)}::text), ''), '-') IN ('N5216', 'N6846', 'N6847'))
      OR (${branch} = 'udhampur' AND COALESCE(NULLIF(TRIM(${sql.raw(columnName)}::text), ''), '-') IN ('N5217', 'N6848', 'N6849'))
    )
  `
}

async function tableState(tableName: string): Promise<{ exists: boolean; columns: Set<string> }> {
  const existsResult = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(existsResult)[0]?.exists)
  return { exists, columns: exists ? await getColumns(tableName) : new Set<string>() }
}

async function maxUploadedAt(tableName: string, columns: Set<string>) {
  if (!columns.has('uploaded_at')) return null
  const result = await db.execute(sql`SELECT MAX(uploaded_at) AS source_updated_at FROM ${sql.raw(tableName)}`)
  return resultRows(result)[0]?.source_updated_at || null
}

async function billingSummary(filters: OverviewFilters, sources: SourceState[]) {
  const tableName = 'hyundai_ro_billing_report'
  const state = await tableState(tableName)
  if (!state.exists) {
    sources.push({ source: tableName, exists: false, sourceUpdatedAt: null, warning: `${tableName} table is not available.`, branchFiltered: false })
    return {
      summary: { bills: 0, repairOrders: 0, revenue: 0, labourAmount: 0, partsAmount: 0, otherAmount: 0, discountAmount: 0, avgBilling: 0 },
      dailyTrend: [],
      fyTrend: [],
      serviceMix: [],
    }
  }

  const branchCol = branchColumn(state.columns)
  const branchFilter = branchPredicate(filters.branch, branchCol)
  const sourceUpdatedAt = await maxUploadedAt(tableName, state.columns)
  sources.push({ source: tableName, exists: true, sourceUpdatedAt: sourceUpdatedAt as string | null, branchFiltered: Boolean(branchCol) })

  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(TRIM(work_type::text), ''), 'Unmapped') AS work_type,
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), NULLIF(TRIM(bill_no::text), ''), id::text) AS ro_key,
        ${dateExpression('bill_date')} AS bill_date,
        ${amountExpression('total_amt')} AS total_amount,
        ${amountExpression('labour_amt')} AS labour_amount,
        ${amountExpression('part_amt')} AS parts_amount,
        ${amountExpression('other_amt')} AS other_amount,
        ${amountExpression('dis_amt')} + ${amountExpression('total_disc')} + ${amountExpression('part_disc')} + ${amountExpression('labour_disc')} AS discount_amount
      FROM ${sql.raw(tableName)}
      WHERE ${branchFilter}
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE bill_date >= ${filters.startDate}::date
        AND bill_date <= ${filters.endDate}::date
    )
    SELECT
      jsonb_build_object(
        'bills', COUNT(*)::integer,
        'repairOrders', COUNT(DISTINCT ro_key)::integer,
        'revenue', COALESCE(SUM(total_amount), 0),
        'labourAmount', COALESCE(SUM(labour_amount), 0),
        'partsAmount', COALESCE(SUM(parts_amount), 0),
        'otherAmount', COALESCE(SUM(other_amount), 0),
        'discountAmount', COALESCE(SUM(discount_amount), 0),
        'avgBilling', COALESCE(AVG(NULLIF(total_amount, 0)), 0)
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'date', bill_date,
          'load', load,
          'revenue', revenue,
          'labour', labour,
          'parts', parts
        ) ORDER BY bill_date)
        FROM (
          SELECT
            bill_date,
            COUNT(DISTINCT ro_key)::integer AS load,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(SUM(labour_amount), 0) AS labour,
            COALESCE(SUM(parts_amount), 0) AS parts
          FROM filtered
          WHERE bill_date IS NOT NULL
          GROUP BY bill_date
        ) daily
      ), '[]'::jsonb) AS daily_trend,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'financialYear', financial_year,
          'load', load,
          'revenue', revenue,
          'labour', labour,
          'parts', parts
        ) ORDER BY financial_year DESC)
        FROM (
          SELECT
            CASE
              WHEN EXTRACT(MONTH FROM bill_date) >= 4
                THEN 'FY ' || EXTRACT(YEAR FROM bill_date)::int || '-' || RIGHT((EXTRACT(YEAR FROM bill_date)::int + 1)::text, 2)
              ELSE 'FY ' || (EXTRACT(YEAR FROM bill_date)::int - 1) || '-' || RIGHT(EXTRACT(YEAR FROM bill_date)::int::text, 2)
            END AS financial_year,
            COUNT(DISTINCT ro_key)::integer AS load,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(SUM(labour_amount), 0) AS labour,
            COALESCE(SUM(parts_amount), 0) AS parts
          FROM base
          WHERE bill_date IS NOT NULL
          GROUP BY 1
        ) fy
      ), '[]'::jsonb) AS fy_trend,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', work_type,
          'load', load,
          'revenue', revenue,
          'labour', labour,
          'parts', parts
        ) ORDER BY revenue DESC)
        FROM (
          SELECT
            work_type,
            COUNT(DISTINCT ro_key)::integer AS load,
            COALESCE(SUM(total_amount), 0) AS revenue,
            COALESCE(SUM(labour_amount), 0) AS labour,
            COALESCE(SUM(parts_amount), 0) AS parts
          FROM filtered
          GROUP BY work_type
          ORDER BY revenue DESC
          LIMIT 8
        ) mix
      ), '[]'::jsonb) AS service_mix
    FROM filtered
  `)
  const row = resultRows(result)[0] || {}
  return {
    summary: row.summary || { bills: 0, repairOrders: 0, revenue: 0, labourAmount: 0, partsAmount: 0, otherAmount: 0, discountAmount: 0, avgBilling: 0 },
    dailyTrend: Array.isArray(row.daily_trend) ? row.daily_trend : [],
    fyTrend: Array.isArray(row.fy_trend) ? row.fy_trend : [],
    serviceMix: Array.isArray(row.service_mix) ? row.service_mix : [],
  }
}

async function repairSummary(filters: OverviewFilters, sources: SourceState[]) {
  const tableName = 'hyundai_repair_order_list'
  const state = await tableState(tableName)
  if (!state.exists) {
    sources.push({ source: tableName, exists: false, sourceUpdatedAt: null, warning: `${tableName} table is not available.`, branchFiltered: false })
    return { summary: { total: 0, delivered: 0, open: 0, cancelled: 0, labourAmount: 0, partsAmount: 0, totalAmount: 0 }, workTypes: [], advisors: [] }
  }

  const branchCol = branchColumn(state.columns)
  const branchFilter = branchPredicate(filters.branch, branchCol)
  const sourceUpdatedAt = await maxUploadedAt(tableName, state.columns)
  sources.push({ source: tableName, exists: true, sourceUpdatedAt: sourceUpdatedAt as string | null, branchFiltered: Boolean(branchCol) })

  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        ${dateExpression('r_o_date')} AS ro_date,
        COALESCE(NULLIF(TRIM(work_type::text), ''), 'Unmapped') AS work_type,
        COALESCE(NULLIF(TRIM(COALESCE(service_adv::text, svc_adv::text)), ''), '-') AS advisor,
        COALESCE(NULLIF(TRIM(COALESCE(r_o_status::text, status::text)), ''), '-') AS status,
        ${dateExpression('cancel_date')} AS cancel_date,
        ${amountExpression('labour_amt')} AS labour_amount,
        ${amountExpression('part_amt')} AS parts_amount,
        ${amountExpression('total')} AS total_amount
      FROM ${sql.raw(tableName)}
      WHERE ${branchFilter}
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE ro_date >= ${filters.startDate}::date
        AND ro_date <= ${filters.endDate}::date
    )
    SELECT
      jsonb_build_object(
        'total', COUNT(*)::integer,
        'delivered', COUNT(*) FILTER (WHERE lower(status) IN ('delivered', 'closed', 'close'))::integer,
        'open', COUNT(*) FILTER (WHERE lower(status) NOT IN ('delivered', 'closed', 'close') AND cancel_date IS NULL)::integer,
        'cancelled', COUNT(*) FILTER (WHERE cancel_date IS NOT NULL OR lower(status) LIKE '%cancel%')::integer,
        'labourAmount', COALESCE(SUM(labour_amount), 0),
        'partsAmount', COALESCE(SUM(parts_amount), 0),
        'totalAmount', COALESCE(SUM(total_amount), 0)
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', work_type, 'count', count, 'amount', amount) ORDER BY count DESC)
        FROM (
          SELECT work_type, COUNT(*)::integer AS count, COALESCE(SUM(total_amount), 0) AS amount
          FROM filtered
          GROUP BY work_type
          ORDER BY count DESC
          LIMIT 8
        ) grouped
      ), '[]'::jsonb) AS work_types,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', advisor, 'count', count, 'amount', amount) ORDER BY count DESC)
        FROM (
          SELECT advisor, COUNT(*)::integer AS count, COALESCE(SUM(total_amount), 0) AS amount
          FROM filtered
          GROUP BY advisor
          ORDER BY count DESC
          LIMIT 8
        ) grouped
      ), '[]'::jsonb) AS advisors
    FROM filtered
  `)
  const row = resultRows(result)[0] || {}
  return {
    summary: row.summary || { total: 0, delivered: 0, open: 0, cancelled: 0, labourAmount: 0, partsAmount: 0, totalAmount: 0 },
    workTypes: Array.isArray(row.work_types) ? row.work_types : [],
    advisors: Array.isArray(row.advisors) ? row.advisors : [],
  }
}

async function genericSection(
  tableName: string,
  filters: OverviewFilters,
  sources: SourceState[],
  config: {
    dateColumns: string[]
    amountColumns?: string[]
    secondaryAmountColumns?: string[]
    statusColumns?: string[]
    labelColumns?: string[]
  }
) {
  const state = await tableState(tableName)
  if (!state.exists) {
    sources.push({ source: tableName, exists: false, sourceUpdatedAt: null, warning: `${tableName} table is not available.`, branchFiltered: false })
    return { summary: EMPTY_METRIC, trend: [], breakdown: [] }
  }

  const dateCol = findColumn(state.columns, config.dateColumns)
  if (!dateCol) {
    const sourceUpdatedAt = await maxUploadedAt(tableName, state.columns)
    sources.push({ source: tableName, exists: true, sourceUpdatedAt: sourceUpdatedAt as string | null, warning: `${tableName} has no supported date column yet.`, branchFiltered: false })
    return { summary: EMPTY_METRIC, trend: [], breakdown: [] }
  }

  const amountCol = findColumn(state.columns, config.amountColumns || [])
  const secondaryAmountCol = findColumn(state.columns, config.secondaryAmountColumns || [])
  const statusCol = findColumn(state.columns, config.statusColumns || [])
  const labelCol = findColumn(state.columns, config.labelColumns || [])
  const branchCol = branchColumn(state.columns)
  const branchFilter = branchPredicate(filters.branch, branchCol)
  const sourceUpdatedAt = await maxUploadedAt(tableName, state.columns)
  sources.push({ source: tableName, exists: true, sourceUpdatedAt: sourceUpdatedAt as string | null, branchFiltered: Boolean(branchCol) })

  const amountSql = amountCol ? amountExpression(amountCol) : sql`0::numeric`
  const secondarySql = secondaryAmountCol ? amountExpression(secondaryAmountCol) : sql`0::numeric`
  const statusSql = statusCol ? sql`COALESCE(NULLIF(TRIM(${sql.raw(statusCol)}::text), ''), '-')` : sql`'-'`
  const labelSql = labelCol ? sql`COALESCE(NULLIF(TRIM(${sql.raw(labelCol)}::text), ''), 'Unmapped')` : sql`'Unmapped'`

  const result = await db.execute(sql`
    WITH base AS (
      SELECT
        ${dateExpression(dateCol)} AS report_date,
        ${amountSql} AS amount,
        ${secondarySql} AS secondary_amount,
        ${statusSql} AS status,
        ${labelSql} AS label
      FROM ${sql.raw(tableName)}
      WHERE ${branchFilter}
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE report_date >= ${filters.startDate}::date
        AND report_date <= ${filters.endDate}::date
    )
    SELECT
      jsonb_build_object(
        'count', COUNT(*)::integer,
        'amount', COALESCE(SUM(amount), 0),
        'secondaryAmount', COALESCE(SUM(secondary_amount), 0),
        'open', COUNT(*) FILTER (WHERE lower(status) LIKE '%open%' OR lower(status) LIKE '%pending%')::integer,
        'closed', COUNT(*) FILTER (WHERE lower(status) LIKE '%close%' OR lower(status) LIKE '%resolved%' OR lower(status) LIKE '%converted%' OR lower(status) LIKE '%approved%')::integer,
        'pending', COUNT(*) FILTER (WHERE lower(status) LIKE '%pending%')::integer
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('date', report_date, 'count', count, 'amount', amount) ORDER BY report_date)
        FROM (
          SELECT report_date, COUNT(*)::integer AS count, COALESCE(SUM(amount), 0) AS amount
          FROM filtered
          WHERE report_date IS NOT NULL
          GROUP BY report_date
        ) trend
      ), '[]'::jsonb) AS trend,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('name', label, 'count', count, 'amount', amount) ORDER BY count DESC)
        FROM (
          SELECT label, COUNT(*)::integer AS count, COALESCE(SUM(amount), 0) AS amount
          FROM filtered
          GROUP BY label
          ORDER BY count DESC
          LIMIT 8
        ) breakdown
      ), '[]'::jsonb) AS breakdown
    FROM filtered
  `)
  const row = resultRows(result)[0] || {}
  return {
    summary: row.summary || EMPTY_METRIC,
    trend: Array.isArray(row.trend) ? row.trend : [],
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
  }
}

async function bookingSection(filters: OverviewFilters, sources: SourceState[]) {
  const candidates = [
    'hyundai_service_booking',
    'hyundai_booking',
    'hyundai_booking_report',
    'hyundai_service_booking_report',
  ]
  for (const tableName of candidates) {
    const state = await tableState(tableName)
    if (state.exists) {
      return genericSection(tableName, filters, sources, {
        dateColumns: ['b_t_date_time', 'booking_date', 'appointment_date', 'created_at', 'uploaded_at'],
        statusColumns: ['status', 'booking_status'],
        labelColumns: ['work_type', 'service_advisor', 'status'],
      })
    }
  }
  sources.push({ source: 'hyundai_booking_table', exists: false, sourceUpdatedAt: null, warning: 'Hyundai booking table is not configured yet.', branchFiltered: false })
  return { summary: EMPTY_METRIC, trend: [], breakdown: [] }
}

async function buildPayload(filters: OverviewFilters) {
  const sources: SourceState[] = []
  const [
    billing,
    repairOrders,
    ew,
    complaints,
    psf,
    operations,
    bookings,
  ] = await Promise.all([
    billingSummary(filters, sources),
    repairSummary(filters, sources),
    genericSection('hyundai_ew_report', filters, sources, {
      dateColumns: ['ew_reg_date', 'registration_date', 'uploaded_at'],
      amountColumns: ['hmil_amt'],
      secondaryAmountColumns: ['dealer_discount'],
      labelColumns: ['model', 'insurance_company', 'customer_name'],
    }),
    genericSection('hyundai_call_center_complaints', filters, sources, {
      dateColumns: ['complaint_date', 'created_date', 'reported_date', 'uploaded_at'],
      statusColumns: ['status', 'complaint_status', 'current_status'],
      labelColumns: ['area', 'complaint_area', 'category', 'dealer_code'],
    }),
    genericSection('hyundai_psf_yearly', filters, sources, {
      dateColumns: ['psf_date', 'call_date', 'ro_close_date', 'uploaded_at'],
      statusColumns: ['status', 'psf_status'],
      labelColumns: ['service_advisor', 'model', 'rating'],
    }),
    genericSection('hyundai_operation_wise_analysis_report', filters, sources, {
      dateColumns: ['report_month', 'uploaded_at'],
      amountColumns: ['total_amt', 'labour_amt'],
      secondaryAmountColumns: ['total_count'],
      labelColumns: ['op_part_desc', 'op_part_code', 'report_type'],
    }),
    bookingSection(filters, sources),
  ])

  const sourceUpdatedAt = sources
    .map((source) => source.sourceUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null

  return {
    meta: {
      source: 'hyundai_business_excellence',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt,
      warnings: sources.filter((source) => source.warning).map((source) => source.warning),
      sources,
    },
    filters,
    executive: {
      revenue: billing.summary,
      repairOrders: repairOrders.summary,
      ew: ew.summary,
      complaints: complaints.summary,
      psf: psf.summary,
      bookings: bookings.summary,
      operations: operations.summary,
    },
    charts: {
      dailyRevenue: billing.dailyTrend,
      fyRevenue: billing.fyTrend,
      serviceMix: billing.serviceMix,
      repairWorkTypes: repairOrders.workTypes,
      repairAdvisors: repairOrders.advisors,
      ewTrend: ew.trend,
      ewBreakdown: ew.breakdown,
      complaintTrend: complaints.trend,
      complaintBreakdown: complaints.breakdown,
      psfTrend: psf.trend,
      psfBreakdown: psf.breakdown,
      operationTrend: operations.trend,
      operationBreakdown: operations.breakdown,
      bookingTrend: bookings.trend,
      bookingBreakdown: bookings.breakdown,
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-business-excellence-overview')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const filters = getFilters(searchParams)
    const payload = await timer.time('overview-cache', () => getCachedData(
      createCacheKey(filters),
      () => buildPayload(filters),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Hyundai Business Excellence overview:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Hyundai Business Excellence overview' }, { status: 500 }),
      timing.serverTiming
    )
  }
}
