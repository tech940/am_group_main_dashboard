import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getCachedData, invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEMO_WORK_TYPE = 'Test Drive/CC Maintenance'
const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 500

type DemoFilters = {
  page: number
  pageSize: number
  search: string
  dueStatus: string
  dealerCode: string | null
}

type NumericRow = Record<string, unknown>

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function positiveInteger(value: string | null, fallback: number, max = MAX_PAGE_SIZE) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

async function tableExists(tableName: string) {
  return await analyticsTableExists(tableName)
}

function getFilters(searchParams: URLSearchParams): DemoFilters {
  return {
    page: positiveInteger(searchParams.get('page'), 1, 100000),
    pageSize: positiveInteger(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE),
    search: String(searchParams.get('search') || '').trim(),
    dueStatus: String(searchParams.get('dueStatus') || 'all').trim() || 'all',
    dealerCode: normalizeKiaDealerCode(searchParams.get('dealer_code')) || null,
  }
}

function createCacheKey(filters: DemoFilters, hasRemarksTable: boolean) {
  return `kia:demo-job-cards:v6:${createHash('sha1')
    .update(JSON.stringify({ filters, hasRemarksTable }))
    .digest('hex')}`
}

function demoDealerFilter(filters: DemoFilters) {
  if (!filters.dealerCode) return sql``

  return sql`
    AND EXISTS (
      SELECT 1
      FROM ro_billing_report rb
      WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = ${filters.dealerCode}
        AND (
          (
            NULLIF(TRIM(demo_job_cards.vin), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(demo_job_cards.vin))
          )
          OR (
            NULLIF(TRIM(demo_job_cards.reg_no), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(demo_job_cards.reg_no))
          )
        )
    )
  `
}

function buildFilteredWhere(filters: DemoFilters) {
  const clauses = [sql`1 = 1`]

  if (filters.search) {
    const search = `%${filters.search}%`
    clauses.push(sql`(
      registration_number ILIKE ${search}
      OR vin ILIKE ${search}
      OR customer_name ILIKE ${search}
      OR model ILIKE ${search}
      OR last_ro_number ILIKE ${search}
      OR latest_remark ILIKE ${search}
    )`)
  }

  if (filters.dueStatus !== 'all') {
    clauses.push(sql`due_status = ${filters.dueStatus}`)
  }

  return sql.join(clauses, sql` AND `)
}

function latestRemarksCte(hasRemarksTable: boolean) {
  if (!hasRemarksTable) {
    return sql`
      SELECT
        NULL::uuid AS id,
        NULL::text AS vin,
        NULL::text AS remark,
        NULL::uuid AS created_by,
        NULL::text AS created_by_name,
        NULL::timestamptz AS created_at,
        NULL::timestamptz AS updated_at
      WHERE false
    `
  }

  return sql`
    SELECT DISTINCT ON (vin)
      id,
      vin,
      remark,
      created_by,
      created_by_name,
      created_at,
      updated_at
    FROM demo_vehicle_remarks
    WHERE deleted_at IS NULL
    ORDER BY vin, updated_at DESC NULLS LAST, created_at DESC
  `
}

function remarkCountsCte(hasRemarksTable: boolean) {
  if (!hasRemarksTable) {
    return sql`
      SELECT
        NULL::text AS vin,
        0::int AS remark_count
      WHERE false
    `
  }

  return sql`
    SELECT
      vin,
      COUNT(*)::int AS remark_count
    FROM demo_vehicle_remarks
    WHERE deleted_at IS NULL
    GROUP BY vin
  `
}

function buildVehicleTrackerSql(filters: DemoFilters, hasRemarksTable: boolean) {
  const filteredWhere = buildFilteredWhere(filters)
  const offset = (filters.page - 1) * filters.pageSize

  return sql`
    WITH raw AS (
      SELECT
        id::text AS id,
        UPPER(TRIM(COALESCE(NULLIF(vin, ''), NULLIF(reg_no, ''), id::text))) AS vehicle_key,
        COALESCE(NULLIF(TRIM(reg_no), ''), '-') AS registration_number,
        COALESCE(NULLIF(TRIM(vin), ''), '-') AS vin,
        COALESCE(NULLIF(TRIM(model), ''), '-') AS model,
        mileage,
        COALESCE(NULLIF(TRIM(customer_name), ''), '-') AS customer_name,
        COALESCE(NULLIF(TRIM(r_o_no), ''), '-') AS last_ro_number,
        ro_date::date AS last_bill_date,
        COALESCE(NULLIF(TRIM(service_adv), ''), 'Unassigned') AS service_advisor,
        COALESCE(NULLIF(TRIM(status), ''), '-') AS status
      FROM demo_job_cards
      WHERE work_type = ${DEMO_WORK_TYPE}
        AND COALESCE(NULLIF(TRIM(vin), ''), NULLIF(TRIM(reg_no), '')) IS NOT NULL
        AND ro_date IS NOT NULL
        ${demoDealerFilter(filters)}
    ),
    latest_vehicle AS (
      SELECT DISTINCT ON (vehicle_key)
        *
      FROM raw
      ORDER BY vehicle_key, last_bill_date DESC NULLS LAST, id DESC
    ),
    latest_remarks AS (${latestRemarksCte(hasRemarksTable)}),
    remark_counts AS (${remarkCountsCte(hasRemarksTable)}),
    enriched AS (
      SELECT
        latest_vehicle.*,
        (latest_vehicle.last_bill_date + INTERVAL '15 days')::date AS next_demo_due_date,
        ((latest_vehicle.last_bill_date + INTERVAL '15 days')::date - CURRENT_DATE)::int AS days_remaining,
        CASE
          WHEN ((latest_vehicle.last_bill_date + INTERVAL '15 days')::date - CURRENT_DATE)::int < 0 THEN 'Overdue'
          WHEN ((latest_vehicle.last_bill_date + INTERVAL '15 days')::date - CURRENT_DATE)::int <= 5 THEN 'Due Soon'
          ELSE 'Scheduled'
        END AS due_status,
        latest_remarks.id AS latest_remark_id,
        latest_remarks.remark AS latest_remark,
        latest_remarks.created_by_name AS latest_remark_by,
        latest_remarks.created_at AS latest_remark_at,
        latest_remarks.updated_at AS latest_remark_updated_at,
        COALESCE(remark_counts.remark_count, 0)::int AS remark_count
      FROM latest_vehicle
      LEFT JOIN latest_remarks ON latest_remarks.vin = latest_vehicle.vehicle_key
      LEFT JOIN remark_counts ON remark_counts.vin = latest_vehicle.vehicle_key
    ),
    filtered AS (
      SELECT *
      FROM enriched
      WHERE ${filteredWhere}
    ),
    row_count AS (
      SELECT COUNT(*)::int AS total_rows
      FROM filtered
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY days_remaining ASC, next_demo_due_date ASC, registration_number ASC
      LIMIT ${filters.pageSize}
      OFFSET ${offset}
    ),
    alerts AS (
      SELECT *
      FROM enriched
      WHERE days_remaining <= 5
      ORDER BY days_remaining ASC, next_demo_due_date ASC, registration_number ASC
      LIMIT 12
    ),
    options AS (
      SELECT
        COUNT(*)::int AS total_vehicles,
        COUNT(*) FILTER (WHERE days_remaining <= 5)::int AS due_within_5_days,
        COUNT(*) FILTER (WHERE days_remaining < 0)::int AS overdue,
        COUNT(*) FILTER (WHERE latest_remark IS NOT NULL)::int AS vehicles_with_remarks
      FROM enriched
    ),
    source_freshness AS (
      SELECT MAX(last_bill_date)::timestamptz AS source_updated_at
      FROM raw
    )
    SELECT
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'vehicleKey', vehicle_key,
        'registrationNumber', registration_number,
        'vin', vin,
        'model', model,
        'mileage', mileage,
        'customerName', customer_name,
        'lastRoNumber', last_ro_number,
        'lastBillDate', last_bill_date,
        'nextDemoDueDate', next_demo_due_date,
        'daysRemaining', days_remaining,
        'dueStatus', due_status,
        'serviceAdvisor', service_advisor,
        'status', status,
        'latestRemarkId', latest_remark_id,
        'latestRemark', latest_remark,
        'latestRemarkBy', latest_remark_by,
        'latestRemarkAt', latest_remark_at,
        'latestRemarkUpdatedAt', latest_remark_updated_at,
        'remarkCount', remark_count
      ) ORDER BY days_remaining ASC, next_demo_due_date ASC, registration_number ASC) FROM paged), '[]'::jsonb) AS rows,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'vehicleKey', vehicle_key,
        'registrationNumber', registration_number,
        'vin', vin,
        'model', model,
        'mileage', mileage,
        'customerName', customer_name,
        'lastBillDate', last_bill_date,
        'nextDemoDueDate', next_demo_due_date,
        'daysRemaining', days_remaining,
        'dueStatus', due_status,
        'latestRemark', latest_remark,
        'latestRemarkBy', latest_remark_by
      ) ORDER BY days_remaining ASC, next_demo_due_date ASC, registration_number ASC) FROM alerts), '[]'::jsonb) AS alerts,
      (SELECT total_rows FROM row_count) AS total_rows,
      (SELECT source_updated_at FROM source_freshness) AS source_updated_at,
      (SELECT jsonb_build_object(
        'totalVehicles', total_vehicles,
        'dueWithin5Days', due_within_5_days,
        'overdue', overdue,
        'vehiclesWithRemarks', vehicles_with_remarks
      ) FROM options) AS summary
  `
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

async function buildPayload(filters: DemoFilters, hasRemarksTable: boolean) {
  const result = await db.execute(buildVehicleTrackerSql(filters, hasRemarksTable))
  const row = resultRows(result)[0] || {}
  const totalRows = numberValue(row.total_rows)

  return {
    meta: {
      workType: DEMO_WORK_TYPE,
      source: 'demo_job_cards',
      remarksSource: 'demo_vehicle_remarks',
      vehicleUniqueness: '1 vehicle = 1 row, keyed by VIN with registration fallback',
      nextDemoDueRule: 'latest ro_date + 15 days',
      alertRule: 'next_demo_due_date - current_date <= 5 days',
      remarksTableReady: hasRemarksTable,
      sourceUpdatedAt: row.source_updated_at || null,
      generatedAt: new Date().toISOString(),
    },
    summary: row.summary || {
      totalVehicles: 0,
      dueWithin5Days: 0,
      overdue: 0,
      vehiclesWithRemarks: 0,
    },
    alerts: asArray(row.alerts),
    rows: asArray(row.rows),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / filters.pageSize)),
    },
    options: {
      dueStatuses: ['Scheduled', 'Due Soon', 'Overdue'],
    },
  }
}

async function getRemarkHistory(vin: string) {
  if (!(await tableExists('demo_vehicle_remarks'))) {
    return NextResponse.json(
      { error: 'demo_vehicle_remarks table is not created yet. Run scripts/create-demo-vehicle-remarks.sql first.' },
      { status: 424 }
    )
  }

  const result = await db.execute(sql`
    SELECT
      id,
      vin,
      remark,
      created_by_name AS "createdByName",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM demo_vehicle_remarks
    WHERE vin = ${vin}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
  `)

  return NextResponse.json({ remarks: resultRows(result) })
}

export async function GET(request: Request) {
  const timer = createApiTimer('demo-job-cards')

  try {
    const access = await timer.time('auth', () => requireBrandSectionApiAccess('kia', 'kia.demo_job_cards.view'))
    if (access) return access

    const { searchParams } = new URL(request.url)
    const remarksVin = searchParams.get('remarksVin')?.trim()
    if (remarksVin) return await getRemarkHistory(remarksVin)

    const filters = getFilters(searchParams)
    const hasRemarksTable = await timer.time('remarks-table-check', () => tableExists('demo_vehicle_remarks'))
    const payload = await timer.time('vehicle-cache', () => getCachedData(
      createCacheKey(filters, hasRemarksTable),
      () => buildPayload(filters, hasRemarksTable),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Demo Job Cards tracker:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Demo Job Cards tracker' }, { status: 500 }),
      timing.serverTiming
    )
  }
}

export async function POST(request: Request) {
  const access = await requireBrandSectionApiAccess('kia', 'kia.demo_job_cards.view')
  if (access) return access

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await tableExists('demo_vehicle_remarks'))) {
    return NextResponse.json(
      { error: 'demo_vehicle_remarks table is not created yet. Run scripts/create-demo-vehicle-remarks.sql first.' },
      { status: 424 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const vin = String(body?.vin || '').trim().toUpperCase()
  const remark = String(body?.remark || '').trim()

  if (!vin) return NextResponse.json({ error: 'VIN / vehicle key is required' }, { status: 400 })
  if (!remark || remark.length < 2) return NextResponse.json({ error: 'Remark is required' }, { status: 400 })

  const result = await db.execute(sql`
    INSERT INTO demo_vehicle_remarks (vin, remark, created_by, created_by_name)
    VALUES (${vin}, ${remark}, ${appUser.id}, ${appUser.fullName})
    RETURNING
      id,
      vin,
      remark,
      created_by_name AS "createdByName",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `)

  await invalidateCachePattern('kia:demo-job-cards:*')

  return NextResponse.json({ remark: resultRows(result)[0] }, { status: 201 })
}

export async function PATCH(request: Request) {
  const access = await requireBrandSectionApiAccess('kia', 'kia.demo_job_cards.view')
  if (access) return access

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await tableExists('demo_vehicle_remarks'))) {
    return NextResponse.json(
      { error: 'demo_vehicle_remarks table is not created yet. Run scripts/create-demo-vehicle-remarks.sql first.' },
      { status: 424 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const id = String(body?.id || '').trim()
  const remark = String(body?.remark || '').trim()

  if (!id) return NextResponse.json({ error: 'Remark id is required' }, { status: 400 })
  if (!remark || remark.length < 2) return NextResponse.json({ error: 'Remark is required' }, { status: 400 })

  const result = await db.execute(sql`
    UPDATE demo_vehicle_remarks
    SET
      remark = ${remark},
      updated_at = now()
    WHERE id = ${id}::uuid
      AND deleted_at IS NULL
    RETURNING
      id,
      vin,
      remark,
      created_by_name AS "createdByName",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
  `)

  const updated = resultRows(result)[0]
  if (!updated) return NextResponse.json({ error: 'Remark not found' }, { status: 404 })

  await invalidateCachePattern('kia:demo-job-cards:*')

  return NextResponse.json({ remark: updated })
}
