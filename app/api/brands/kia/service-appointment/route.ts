import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { CACHE_TTL } from '@/lib/redis/client'
import { getCachedData } from '@/lib/redis/cache-utils'
import { DEFAULT_KIA_DEALER_CODE, getKiaBranchLabel, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGE_SIZE = 10
const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type AppointmentStatusFilter = 'all' | 'open' | 'closed' | 'cancelled'

type AppointmentFilters = {
  dealerCode: string
  month: string
  page: number
  pageSize: number
  search: string
  status: AppointmentStatusFilter
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

function normalizeStatusFilter(value: string | null): AppointmentStatusFilter {
  const normalized = String(value || 'all').trim().toLowerCase()
  if (normalized === 'open' || normalized === 'closed' || normalized === 'cancelled') return normalized
  return 'all'
}

function normalizeMonth(value: string | null) {
  const fallback = new Date().toISOString().slice(0, 7)
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback
  return value
}

function getFilters(searchParams: URLSearchParams): AppointmentFilters {
  const pageSize = Math.min(50, positiveInteger(searchParams.get('pageSize'), PAGE_SIZE))

  return {
    dealerCode: normalizeKiaDealerCode(searchParams.get('dealer_code')) || DEFAULT_KIA_DEALER_CODE,
    month: normalizeMonth(searchParams.get('month')),
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize,
    search: String(searchParams.get('search') || '').trim(),
    status: normalizeStatusFilter(searchParams.get('status')),
  }
}

function monthBounds(month: string) {
  const [yearPart, monthPart] = month.split('-').map((part) => Number(part))
  const start = new Date(Date.UTC(yearPart, monthPart - 1, 1))
  const end = new Date(Date.UTC(yearPart, monthPart, 1))
  const label = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    label,
  }
}

function createCacheKey(filters: AppointmentFilters) {
  const serialized = JSON.stringify(filters)
  return `kia:service-appointment:v1:${createHash('sha1').update(serialized).digest('hex')}`
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
}

function appointmentDateExpression() {
  return sql`
    COALESCE(
      CASE
        WHEN NULLIF(TRIM(a_t_date_time::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(TRIM(a_t_date_time::text), 10)::date
        WHEN NULLIF(TRIM(a_t_date_time::text), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN to_date(LEFT(TRIM(a_t_date_time::text), 10), 'DD/MM/YYYY')
      END,
      CASE
        WHEN NULLIF(TRIM(web_appointment_date::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(TRIM(web_appointment_date::text), 10)::date
        WHEN NULLIF(TRIM(web_appointment_date::text), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN to_date(LEFT(TRIM(web_appointment_date::text), 10), 'DD/MM/YYYY')
      END,
      CASE
        WHEN NULLIF(TRIM(appointment_done_on::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(TRIM(appointment_done_on::text), 10)::date
        WHEN NULLIF(TRIM(appointment_done_on::text), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN to_date(LEFT(TRIM(appointment_done_on::text), 10), 'DD/MM/YYYY')
      END
    )
  `
}

function statusGroupExpression() {
  return sql`
    CASE
      WHEN lower(trim(coalesce(status::text, ''))) IN ('close', 'closed', 'completed', 'complete') THEN 'closed'
      WHEN lower(trim(coalesce(status::text, ''))) LIKE '%cancel%' THEN 'cancelled'
      WHEN lower(trim(coalesce(status::text, ''))) IN ('open', 'pending', 'booked', 'new', 'in progress', 'in-progress') THEN 'open'
      WHEN nullif(trim(coalesce(status::text, '')), '') IS NULL THEN 'open'
      ELSE 'open'
    END
  `
}

function baseSql(filters: AppointmentFilters) {
  return sql`
    WITH base AS (
      SELECT
        id::text AS id,
        COALESCE(NULLIF(TRIM(a_t_no::text), ''), '-') AS appointment_no,
        ${appointmentDateExpression()} AS appointment_date,
        NULLIF(TRIM(appointment_done_on::text), '') AS appointment_done_on,
        COALESCE(NULLIF(TRIM(status::text), ''), 'Open') AS status,
        ${statusGroupExpression()} AS status_group,
        COALESCE(NULLIF(TRIM(customer::text), ''), '-') AS customer,
        COALESCE(NULLIF(TRIM(COALESCE(mobile::text, appointment_contact_no::text)), ''), '-') AS mobile,
        COALESCE(NULLIF(TRIM(model::text), ''), '-') AS model,
        COALESCE(NULLIF(TRIM(reg_no::text), ''), '-') AS reg_no,
        COALESCE(NULLIF(TRIM(vin::text), ''), '-') AS vin,
        COALESCE(NULLIF(TRIM(work_type::text), ''), '-') AS work_type,
        COALESCE(NULLIF(TRIM(service_advisor::text), ''), '-') AS service_advisor,
        COALESCE(NULLIF(TRIM(cce::text), ''), '-') AS cce,
        COALESCE(NULLIF(TRIM(pick_up::text), ''), '-') AS pick_up,
        COALESCE(NULLIF(TRIM(source::text), ''), '-') AS source,
        COALESCE(NULLIF(TRIM(customer_demand::text), ''), '-') AS customer_demand,
        UPPER(TRIM(COALESCE(dealer_code::text, ''))) AS dealer_code,
        uploaded_at
      FROM service_appointment
      WHERE UPPER(TRIM(COALESCE(dealer_code::text, ''))) = ${filters.dealerCode}
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE (${filters.status} = 'all' OR status_group = ${filters.status})
        AND (
          ${filters.search} = ''
          OR customer ILIKE ${`%${filters.search}%`}
          OR mobile ILIKE ${`%${filters.search}%`}
          OR model ILIKE ${`%${filters.search}%`}
          OR reg_no ILIKE ${`%${filters.search}%`}
          OR vin ILIKE ${`%${filters.search}%`}
          OR work_type ILIKE ${`%${filters.search}%`}
          OR service_advisor ILIKE ${`%${filters.search}%`}
          OR appointment_no ILIKE ${`%${filters.search}%`}
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY appointment_date DESC NULLS LAST, id DESC
      LIMIT ${filters.pageSize}
      OFFSET ${(filters.page - 1) * filters.pageSize}
    )
    SELECT
      (SELECT COUNT(*)::integer FROM filtered) AS total_rows,
      (SELECT MAX(uploaded_at) FROM base) AS source_updated_at,
      (
        SELECT jsonb_build_object(
          'total', COUNT(*)::integer,
          'open', COUNT(*) FILTER (WHERE status_group = 'open')::integer,
          'closed', COUNT(*) FILTER (WHERE status_group = 'closed')::integer,
          'cancelled', COUNT(*) FILTER (WHERE status_group = 'cancelled')::integer,
          'advisors', COUNT(DISTINCT NULLIF(service_advisor, '-'))::integer
        )
        FROM base
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'appointmentNo', appointment_no,
          'appointmentDate', appointment_date,
          'appointmentDoneOn', appointment_done_on,
          'status', status,
          'statusGroup', status_group,
          'customer', customer,
          'mobile', mobile,
          'model', model,
          'regNo', reg_no,
          'vin', vin,
          'workType', work_type,
          'serviceAdvisor', service_advisor,
          'cce', cce,
          'pickUp', pick_up,
          'source', source,
          'customerDemand', customer_demand,
          'dealerCode', dealer_code,
          'uploadedAt', uploaded_at
        ))
        FROM paged
      ), '[]'::jsonb) AS rows,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'date', appointment_date,
          'total', total,
          'open', open,
          'closed', closed,
          'cancelled', cancelled
        ) ORDER BY appointment_date)
        FROM (
          SELECT
            appointment_date,
            COUNT(*)::integer AS total,
            COUNT(*) FILTER (WHERE status_group = 'open')::integer AS open,
            COUNT(*) FILTER (WHERE status_group = 'closed')::integer AS closed,
            COUNT(*) FILTER (WHERE status_group = 'cancelled')::integer AS cancelled
          FROM base
          WHERE appointment_date >= ${monthBounds(filters.month).startDate}::date
            AND appointment_date < ${monthBounds(filters.month).endDate}::date
          GROUP BY appointment_date
        ) calendar_rows
      ), '[]'::jsonb) AS calendar_counts
  `
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function buildCalendar(filters: AppointmentFilters, calendarCounts: unknown) {
  const bounds = monthBounds(filters.month)
  const [year, month] = filters.month.split('-').map((part) => Number(part))
  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const gridStart = new Date(firstDay)
  gridStart.setUTCDate(firstDay.getUTCDate() - firstDay.getUTCDay())
  const countMap = new Map<string, { total: number; open: number; closed: number; cancelled: number }>()

  asArray(calendarCounts).forEach((item) => {
    if (!item || typeof item !== 'object') return
    const row = item as Record<string, unknown>
    const dateKey = String(row.date || '').slice(0, 10)
    if (!dateKey) return
    countMap.set(dateKey, {
      total: Number(row.total || 0),
      open: Number(row.open || 0),
      closed: Number(row.closed || 0),
      cancelled: Number(row.cancelled || 0),
    })
  })

  const days = Array.from({ length: 42 }).map((_, index) => {
    const date = new Date(gridStart)
    date.setUTCDate(gridStart.getUTCDate() + index)
    const dateKey = date.toISOString().slice(0, 10)
    const counts = countMap.get(dateKey) || { total: 0, open: 0, closed: 0, cancelled: 0 }
    const other = Math.max(0, counts.total - counts.open - counts.closed - counts.cancelled)

    return {
      date: dateKey,
      day: date.getUTCDate(),
      inCurrentMonth: date.getUTCMonth() === month - 1,
      total: counts.total,
      open: counts.open,
      closed: counts.closed,
      cancelled: counts.cancelled,
      other,
    }
  })

  return {
    month: filters.month,
    monthLabel: bounds.label,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    days,
  }
}

async function buildPayload(filters: AppointmentFilters) {
  const hasTable = await tableExists('service_appointment')

  if (!hasTable) {
    return {
      meta: {
        source: 'service_appointment',
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: null,
        dealerCode: filters.dealerCode,
        branchLabel: getKiaBranchLabel(filters.dealerCode),
        warning: 'service_appointment table is not available yet.',
      },
      summary: { total: 0, open: 0, closed: 0, cancelled: 0, advisors: 0 },
      rows: [],
      calendar: buildCalendar(filters, []),
      pagination: { page: filters.page, pageSize: filters.pageSize, totalRows: 0, totalPages: 1 },
      options: { statuses: ['all', 'open', 'closed', 'cancelled'] },
    }
  }

  const result = await db.execute(baseSql(filters))
  const row = resultRows(result)[0] || {}
  const totalRows = Number(row.total_rows || 0)

  return {
    meta: {
      source: 'service_appointment',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: row.source_updated_at || null,
      dealerCode: filters.dealerCode,
      branchLabel: getKiaBranchLabel(filters.dealerCode),
    },
    summary: row.summary || { total: 0, open: 0, closed: 0, cancelled: 0, advisors: 0 },
    rows: asArray(row.rows),
    calendar: buildCalendar(filters, row.calendar_counts),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / filters.pageSize)),
    },
    options: {
      statuses: ['all', 'open', 'closed', 'cancelled'],
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('service-appointment')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'kia')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.service_appointment.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const filters = getFilters(searchParams)
    const payload = await timer.time('appointment-cache', () => getCachedData(
      createCacheKey(filters),
      () => buildPayload(filters),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Service Appointment:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Service Appointment' }, { status: 500 }),
      timing.serverTiming
    )
  }
}
