import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGE_SIZE = 10
const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type RepairOrderFilters = {
  page: number
  pageSize: number
  search: string
  branch: string
  status: string
  workType: string
  advisor: string
  startDate: string
  endDate: string
}

type ResultRow = Record<string, unknown>

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function normalizedFilter(value: string | null) {
  const normalized = String(value || 'all').trim()
  return normalized || 'all'
}

function normalizedBranch(value: string | null) {
  const normalized = String(value || 'all').trim().toLowerCase()
  return ['all', 'jammu', 'udhampur'].includes(normalized) ? normalized : 'all'
}

function normalizedDate(value: string | null) {
  const normalized = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function getFilters(searchParams: URLSearchParams): RepairOrderFilters {
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: Math.min(50, positiveInteger(searchParams.get('pageSize'), PAGE_SIZE)),
    search: String(searchParams.get('search') || '').trim(),
    branch: normalizedBranch(searchParams.get('branch')),
    status: normalizedFilter(searchParams.get('status')),
    workType: normalizedFilter(searchParams.get('workType')),
    advisor: normalizedFilter(searchParams.get('advisor')),
    startDate: normalizedDate(searchParams.get('startDate')),
    endDate: normalizedDate(searchParams.get('endDate')),
  }
}

function createCacheKey(filters: RepairOrderFilters) {
  return `hyundai:repair-orders:v1:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
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

function baseQuery(filters: RepairOrderFilters) {
  return sql`
    WITH base AS (
      SELECT
        id::text AS id,
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), '-') AS ro_no,
        ${dateExpression('r_o_date')} AS ro_date,
        COALESCE(NULLIF(TRIM(reg_no::text), ''), '-') AS reg_no,
        COALESCE(NULLIF(TRIM(vin::text), ''), '-') AS vin,
        COALESCE(NULLIF(TRIM(model::text), ''), '-') AS model,
        COALESCE(NULLIF(TRIM(work_type::text), ''), '-') AS work_type,
        COALESCE(NULLIF(TRIM(COALESCE(service_adv::text, svc_adv::text)), ''), '-') AS service_advisor,
        COALESCE(NULLIF(TRIM(COALESCE(man_tech::text, tech_name::text)), ''), '-') AS technician,
        COALESCE(NULLIF(TRIM(COALESCE(r_o_status::text, status::text)), ''), '-') AS status,
        COALESCE(NULLIF(TRIM(new_r_o_status::text), ''), '-') AS new_ro_status,
        NULLIF(TRIM(delay_reason::text), '') AS delay_reason,
        COALESCE(NULLIF(TRIM(vehicle_type::text), ''), '-') AS vehicle_type,
        COALESCE(NULLIF(TRIM(uc_category::text), ''), '-') AS uc_category,
        COALESCE(NULLIF(TRIM(mileage::text), ''), '-') AS mileage,
        COALESCE(NULLIF(TRIM(source_dealer_code::text), ''), NULLIF(TRIM(dealer::text), ''), NULLIF(TRIM(main_dealer::text), ''), '-') AS dealer_code,
        ${dateExpression('promise_date_time')} AS promise_date,
        ${dateExpression('closing_date_time')} AS closing_date,
        ${dateExpression('cancel_date')} AS cancel_date,
        ${amountExpression('labour_amt')} AS labour_amount,
        ${amountExpression('part_amt')} AS parts_amount,
        ${amountExpression('other_amt')} AS other_amount,
        ${amountExpression('total')} AS total_amount,
        uploaded_at
      FROM hyundai_repair_order_list
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE (${filters.status} = 'all' OR lower(status) = lower(${filters.status}))
        AND (
          ${filters.branch} = 'all'
          OR (${filters.branch} = 'jammu' AND dealer_code IN ('N5216', 'N6846', 'N6847'))
          OR (${filters.branch} = 'udhampur' AND dealer_code IN ('N5217', 'N6848', 'N6849'))
        )
        AND (${filters.workType} = 'all' OR lower(work_type) = lower(${filters.workType}))
        AND (${filters.advisor} = 'all' OR lower(service_advisor) = lower(${filters.advisor}))
        AND (${filters.startDate} = '' OR ro_date >= NULLIF(${filters.startDate}, '')::date)
        AND (${filters.endDate} = '' OR ro_date <= NULLIF(${filters.endDate}, '')::date)
        AND (
          ${filters.search} = ''
          OR ro_no ILIKE ${`%${filters.search}%`}
          OR reg_no ILIKE ${`%${filters.search}%`}
          OR vin ILIKE ${`%${filters.search}%`}
          OR model ILIKE ${`%${filters.search}%`}
          OR work_type ILIKE ${`%${filters.search}%`}
          OR service_advisor ILIKE ${`%${filters.search}%`}
          OR technician ILIKE ${`%${filters.search}%`}
          OR status ILIKE ${`%${filters.search}%`}
          OR new_ro_status ILIKE ${`%${filters.search}%`}
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY ro_date DESC NULLS LAST, id DESC
      LIMIT ${filters.pageSize}
      OFFSET ${(filters.page - 1) * filters.pageSize}
    )
    SELECT
      (SELECT COUNT(*)::integer FROM filtered) AS total_rows,
      (SELECT MAX(uploaded_at) FROM base) AS source_updated_at,
      (
        SELECT jsonb_build_object(
          'total', COUNT(*)::integer,
          'delivered', COUNT(*) FILTER (WHERE lower(status) IN ('delivered', 'closed', 'close'))::integer,
          'open', COUNT(*) FILTER (WHERE lower(status) NOT IN ('delivered', 'closed', 'close') AND cancel_date IS NULL)::integer,
          'cancelled', COUNT(*) FILTER (WHERE cancel_date IS NOT NULL OR lower(status) LIKE '%cancel%')::integer,
          'labourAmount', COALESCE(SUM(labour_amount), 0),
          'partsAmount', COALESCE(SUM(parts_amount), 0),
          'totalAmount', COALESCE(SUM(total_amount), 0),
          'avgBilling', COALESCE(AVG(NULLIF(total_amount, 0)), 0)
        )
        FROM filtered
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'roNo', ro_no,
          'roDate', ro_date,
          'regNo', reg_no,
          'vin', vin,
          'model', model,
          'workType', work_type,
          'serviceAdvisor', service_advisor,
          'technician', technician,
          'status', status,
          'newRoStatus', new_ro_status,
          'delayReason', delay_reason,
          'vehicleType', vehicle_type,
          'ucCategory', uc_category,
          'mileage', mileage,
          'dealerCode', dealer_code,
          'promiseDate', promise_date,
          'closingDate', closing_date,
          'cancelDate', cancel_date,
          'labourAmount', labour_amount,
          'partsAmount', parts_amount,
          'otherAmount', other_amount,
          'totalAmount', total_amount,
          'uploadedAt', uploaded_at
        ))
        FROM paged
      ), '[]'::jsonb) AS rows,
      jsonb_build_object(
        'statuses', COALESCE((SELECT jsonb_agg(DISTINCT status ORDER BY status) FROM base WHERE status <> '-'), '[]'::jsonb),
        'workTypes', COALESCE((SELECT jsonb_agg(DISTINCT work_type ORDER BY work_type) FROM base WHERE work_type <> '-'), '[]'::jsonb),
        'advisors', COALESCE((SELECT jsonb_agg(DISTINCT service_advisor ORDER BY service_advisor) FROM base WHERE service_advisor <> '-'), '[]'::jsonb)
      ) AS options
  `
}

async function buildPayload(filters: RepairOrderFilters) {
  const hasTable = await tableExists('hyundai_repair_order_list')

  if (!hasTable) {
    return {
      meta: {
        source: 'hyundai_repair_order_list',
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: null,
        warning: 'hyundai_repair_order_list table is not available yet.',
      },
      summary: {
        total: 0,
        delivered: 0,
        open: 0,
        cancelled: 0,
        labourAmount: 0,
        partsAmount: 0,
        totalAmount: 0,
        avgBilling: 0,
      },
      rows: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalRows: 0, totalPages: 1 },
      options: { statuses: [], workTypes: [], advisors: [] },
    }
  }

  const result = await db.execute(baseQuery(filters))
  const row = resultRows(result)[0] || {}
  const totalRows = Number(row.total_rows || 0)

  return {
    meta: {
      source: 'hyundai_repair_order_list',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: row.source_updated_at || null,
    },
    summary: row.summary || {
      total: 0,
      delivered: 0,
      open: 0,
      cancelled: 0,
      labourAmount: 0,
      partsAmount: 0,
      totalAmount: 0,
      avgBilling: 0,
    },
    rows: Array.isArray(row.rows) ? row.rows : [],
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / filters.pageSize)),
    },
    options: row.options || { statuses: [], workTypes: [], advisors: [] },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-repair-orders')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', async () => {
      const businessExcellence = await requirePermission(appUser, 'hyundai.business_excellence.view')
      if (businessExcellence.allowed) return businessExcellence
      return requirePermission(appUser, 'hyundai.repair_orders.view')
    })
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const filters = getFilters(searchParams)
    const payload = await timer.time('repair-orders-cache', () => getCachedData(
      createCacheKey(filters),
      () => buildPayload(filters),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Hyundai Repair Orders:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Hyundai Repair Orders' }, { status: 500 }),
      timing.serverTiming
    )
  }
}
