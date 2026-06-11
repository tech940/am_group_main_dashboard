import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData, invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGE_SIZE = 10
const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type DemoCarsFilters = {
  page: number
  location: 'all' | 'jammu' | 'udhampur'
  search: string
}

type DisplayColumn = {
  key: string
  label: string
  kind?: 'text' | 'date' | 'amount' | 'age'
}

type ResultRow = Record<string, unknown>

const REGISTRATION_COLUMN_CANDIDATES = [
  'registration_number',
  'registration_no',
  'reg_number',
  'reg_no',
  'vehicle_registration_number',
]

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function normalizeLocation(value: string | null): DemoCarsFilters['location'] {
  const normalized = String(value || 'all').trim().toLowerCase()
  if (normalized === 'jammu' || normalized === 'udhampur') return normalized
  return 'all'
}

function getFilters(searchParams: URLSearchParams): DemoCarsFilters {
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    location: normalizeLocation(searchParams.get('location')),
    search: String(searchParams.get('search') || '').trim(),
  }
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
}

async function getTableColumns(tableName: string) {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `)

  return new Set(resultRows(result).map((row) => String(row.column_name || '').trim()).filter(Boolean))
}

async function ensureDemoVehicleDetailsSchema() {
  await db.execute(sql`
    ALTER TABLE public.demo_vehicle_details
      ADD COLUMN IF NOT EXISTS registration_number text
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS demo_vehicle_details_registration_number_idx
      ON public.demo_vehicle_details (registration_number)
  `)
}

function hasColumn(columns: Set<string>, columnName: string) {
  return columns.has(columnName)
}

function textExpression(columns: Set<string>, columnName: string, fallback = '-') {
  if (!hasColumn(columns, columnName)) return sql`${fallback}::text`
  return sql`COALESCE(NULLIF(TRIM(${sql.raw(columnName)}::text), ''), ${fallback})`
}

function nullableTextExpression(columns: Set<string>, columnName: string) {
  if (!hasColumn(columns, columnName)) return sql`NULL::text`
  return sql`NULLIF(TRIM(${sql.raw(columnName)}::text), '')`
}

function dateExpression(columns: Set<string>, columnName: string) {
  if (!hasColumn(columns, columnName)) return sql`NULL::date`
  return sql`NULLIF(TRIM(${sql.raw(columnName)}::text), '')::date`
}

function firstExistingColumn(columns: Set<string>, candidates: string[]) {
  return candidates.find((candidate) => hasColumn(columns, candidate)) || null
}

function buildDisplayColumns(columns: Set<string>): DisplayColumn[] {
  const displayColumns: DisplayColumn[] = []

  if (hasColumn(columns, 'model')) displayColumns.push({ key: 'model', label: 'Model' })
  if (hasColumn(columns, 'variant')) displayColumns.push({ key: 'variant', label: 'Variant' })
  if (hasColumn(columns, 'color') || hasColumn(columns, 'exterior_color_name')) displayColumns.push({ key: 'color', label: 'Color' })
  if (hasColumn(columns, 'cust_name')) displayColumns.push({ key: 'name', label: 'Name' })
  if (hasColumn(columns, 'main_dealer')) displayColumns.push({ key: 'mainDealer', label: 'Main Dealer' })
  if (hasColumn(columns, 'kin_invoice_date')) displayColumns.push({ key: 'invoiceDate', label: 'Invoice Date', kind: 'date' })
  if (hasColumn(columns, 'kin_invoice_amount') || hasColumn(columns, 'total_invoice_value')) displayColumns.push({ key: 'amount', label: 'Amount', kind: 'amount' })
  if (hasColumn(columns, 'vin_no')) displayColumns.push({ key: 'vin', label: 'VIN No' })
  if (hasColumn(columns, 'retail_date')) {
    displayColumns.push({ key: 'retailDate', label: 'Retail Date', kind: 'date' })
    displayColumns.push({ key: 'age', label: 'Age', kind: 'age' })
  }
  displayColumns.push({ key: 'registrationNumber', label: 'Registration Number' })

  return displayColumns
}

function createCacheKey(filters: DemoCarsFilters, hasDetailsTable: boolean, columns: Set<string>) {
  return `kia:demo-cars-list:v5:${createHash('sha1')
    .update(JSON.stringify({ filters, hasDetailsTable, columns: Array.from(columns).sort() }))
    .digest('hex')}`
}

function vehicleDetailsCte(hasDetailsTable: boolean) {
  if (!hasDetailsTable) {
    return sql`
      SELECT
        NULL::text AS vehicle_key,
        NULL::text AS registration_number,
        NULL::text AS tracker_status,
        NULL::date AS service_date,
        NULL::numeric AS current_reading_kms,
        NULL::numeric AS on_road_price,
        NULL::text AS vehicle_status,
        NULL::text AS updated_by_name,
        NULL::timestamptz AS updated_at
      WHERE false
    `
  }

  return sql`
    SELECT
      vehicle_key,
      registration_number,
      tracker_status,
      service_date,
      current_reading_kms,
      on_road_price,
      vehicle_status,
      updated_by_name,
      updated_at
    FROM demo_vehicle_details
  `
}

function filteredWhere(filters: DemoCarsFilters, columns: Set<string>) {
  const clauses = [sql`1 = 1`]

  if (hasColumn(columns, 'billing_dealer_code')) {
    if (filters.location === 'jammu') {
      clauses.push(sql`billing_dealer_code = 'JK402'`)
    } else if (filters.location === 'udhampur') {
      clauses.push(sql`billing_dealer_code = 'JK501'`)
    }
  }

  if (filters.search) {
    const search = `%${filters.search}%`
    clauses.push(sql`(
      COALESCE(vin_no, '') ILIKE ${search}
      OR COALESCE(model, '') ILIKE ${search}
      OR COALESCE(variant, '') ILIKE ${search}
      OR COALESCE(color, '') ILIKE ${search}
      OR COALESCE(name, '') ILIKE ${search}
      OR COALESCE(main_dealer, '') ILIKE ${search}
      OR COALESCE(transporter_name, '') ILIKE ${search}
      OR COALESCE(amount, '') ILIKE ${search}
      OR COALESCE(display_registration_number, registration_number, '') ILIKE ${search}
      OR COALESCE(billing_dealer_code, '') ILIKE ${search}
      OR COALESCE(tracker_status, '') ILIKE ${search}
      OR COALESCE(vehicle_status, '') ILIKE ${search}
    )`)
  }

  return sql.join(clauses, sql` AND `)
}

function buildDemoCarsSql(filters: DemoCarsFilters, hasDetailsTable: boolean, columns: Set<string>) {
  const whereSql = filteredWhere(filters, columns)
  const offset = (filters.page - 1) * PAGE_SIZE
  const amountColumn = firstExistingColumn(columns, ['kin_invoice_amount', 'total_invoice_value'])
  const registrationColumn = firstExistingColumn(columns, REGISTRATION_COLUMN_CANDIDATES)
  const colorSql = hasColumn(columns, 'color') || hasColumn(columns, 'exterior_color_name')
    ? sql`COALESCE(${nullableTextExpression(columns, 'color')}, ${nullableTextExpression(columns, 'exterior_color_name')}, '-')`
    : sql`'-'::text`

  return sql`
    WITH raw AS (
      SELECT
        ${textExpression(columns, 'id')} AS id,
        UPPER(TRIM(vin_no::text)) AS vehicle_key,
        ${textExpression(columns, 'vin_no')} AS vin_no,
        ${textExpression(columns, 'model')} AS model,
        ${textExpression(columns, 'variant')} AS variant,
        ${colorSql} AS color,
        ${textExpression(columns, 'cust_name')} AS name,
        ${textExpression(columns, 'main_dealer')} AS main_dealer,
        ${textExpression(columns, 'transporter_name')} AS transporter_name,
        ${dateExpression(columns, 'kin_invoice_date')} AS kin_invoice_date,
        ${amountColumn ? textExpression(columns, amountColumn) : sql`'-'::text`} AS amount,
        ${dateExpression(columns, 'retail_date')} AS retail_date,
        CASE
          WHEN ${dateExpression(columns, 'retail_date')} IS NULL THEN NULL::int
          ELSE GREATEST((CURRENT_DATE - ${dateExpression(columns, 'retail_date')}), 0)::int
        END AS age,
        ${registrationColumn ? textExpression(columns, registrationColumn) : sql`NULL::text`} AS registration_number,
        ${textExpression(columns, 'billing_dealer_code')} AS billing_dealer_code,
        CASE
          WHEN ${textExpression(columns, 'billing_dealer_code')} = 'JK402' THEN 'Jammu'
          WHEN ${textExpression(columns, 'billing_dealer_code')} = 'JK501' THEN 'Udhampur'
          ELSE COALESCE(NULLIF(${textExpression(columns, 'billing_dealer_code')}, '-'), 'Other')
        END AS location,
        ${hasColumn(columns, 'uploaded_at') ? sql`uploaded_at` : sql`NULL::timestamptz`} AS uploaded_at
      FROM demo_car_list
      WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
        AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL
    ),
    latest_vehicle AS (
      SELECT DISTINCT ON (vehicle_key)
        *
      FROM raw
      ORDER BY vehicle_key, uploaded_at DESC NULLS LAST, id DESC
    ),
    vehicle_details AS (${vehicleDetailsCte(hasDetailsTable)}),
    enriched AS (
      SELECT
        latest_vehicle.*,
        COALESCE(NULLIF(vehicle_details.registration_number, ''), latest_vehicle.registration_number) AS display_registration_number,
        vehicle_details.tracker_status,
        vehicle_details.service_date,
        vehicle_details.current_reading_kms,
        vehicle_details.on_road_price,
        vehicle_details.vehicle_status,
        vehicle_details.updated_by_name AS details_updated_by,
        vehicle_details.updated_at AS details_updated_at
      FROM latest_vehicle
      LEFT JOIN vehicle_details ON vehicle_details.vehicle_key = latest_vehicle.vehicle_key
    ),
    filtered AS (
      SELECT *
      FROM enriched
      WHERE ${whereSql}
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY age DESC NULLS LAST, location ASC, model ASC, variant ASC, vin_no ASC
      LIMIT ${PAGE_SIZE}
      OFFSET ${offset}
    ),
    counts AS (
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE billing_dealer_code = 'JK402')::int AS jammu,
        COUNT(*) FILTER (WHERE billing_dealer_code = 'JK501')::int AS udhampur,
        COUNT(*) FILTER (WHERE details_updated_at IS NOT NULL)::int AS with_details
      FROM enriched
    ),
    filtered_count AS (
      SELECT COUNT(*)::int AS total_rows
      FROM filtered
    ),
    source_freshness AS (
      SELECT MAX(uploaded_at) AS source_updated_at
      FROM raw
    )
    SELECT
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id,
        'vehicleKey', vehicle_key,
        'vin', vin_no,
        'model', model,
        'variant', variant,
        'color', color,
        'name', name,
        'mainDealer', main_dealer,
        'transporterName', transporter_name,
        'invoiceDate', kin_invoice_date,
        'amount', amount,
        'retailDate', retail_date,
        'age', age,
        'registrationNumber', display_registration_number,
        'billingDealerCode', billing_dealer_code,
        'location', location,
        'trackerStatus', tracker_status,
        'serviceDate', service_date,
        'currentReadingKms', current_reading_kms,
        'onRoadPrice', on_road_price,
        'vehicleStatus', vehicle_status,
        'detailsUpdatedBy', details_updated_by,
        'detailsUpdatedAt', details_updated_at
      ) ORDER BY age DESC NULLS LAST, location ASC, model ASC, variant ASC, vin_no ASC) FROM paged), '[]'::jsonb) AS rows,
      (SELECT total_rows FROM filtered_count) AS total_rows,
      (SELECT source_updated_at FROM source_freshness) AS source_updated_at,
      (SELECT jsonb_build_object(
        'total', total,
        'jammu', jammu,
        'udhampur', udhampur,
        'withDetails', with_details
      ) FROM counts) AS summary
  `
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function emptyPayload(filters: DemoCarsFilters, hasDetailsTable: boolean, columns: DisplayColumn[], warning?: string) {
  return {
    meta: {
      source: 'demo_car_list',
      filterRule: "test_drive_vin = 'YES'",
      detailsSource: 'demo_vehicle_details',
      detailsTableReady: hasDetailsTable,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      warning,
    },
    columns,
    summary: {
      total: 0,
      jammu: 0,
      udhampur: 0,
      withDetails: 0,
    },
    rows: [],
    pagination: {
      page: filters.page,
      pageSize: PAGE_SIZE,
      totalRows: 0,
      totalPages: 1,
    },
    options: {
      locations: ['all', 'jammu', 'udhampur'],
    },
  }
}

async function buildPayload(filters: DemoCarsFilters, hasDetailsTable: boolean, columns: Set<string>) {
  const displayColumns = buildDisplayColumns(columns)

  if (!hasColumn(columns, 'test_drive_vin') || !hasColumn(columns, 'vin_no')) {
    return emptyPayload(
      filters,
      hasDetailsTable,
      displayColumns,
      'demo_car_list is missing test_drive_vin or vin_no, so vehicle rows were skipped.'
    )
  }

  const result = await db.execute(buildDemoCarsSql(filters, hasDetailsTable, columns))
  const row = resultRows(result)[0] || {}
  const totalRows = Number(row.total_rows || 0)

  return {
    meta: {
      source: 'demo_car_list',
      filterRule: "test_drive_vin = 'YES'",
      detailsSource: 'demo_vehicle_details',
      detailsTableReady: hasDetailsTable,
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: row.source_updated_at || null,
    },
    columns: displayColumns,
    summary: row.summary || {
      total: 0,
      jammu: 0,
      udhampur: 0,
      withDetails: 0,
    },
    rows: asArray(row.rows),
    pagination: {
      page: filters.page,
      pageSize: PAGE_SIZE,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / PAGE_SIZE)),
    },
    options: {
      locations: ['all', 'jammu', 'udhampur'],
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('demo-cars-list')

  try {
    const access = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (access) return access

    const { searchParams } = new URL(request.url)
    const filters = getFilters(searchParams)
    const hasDetailsTable = await timer.time('details-table-check', () => tableExists('demo_vehicle_details'))
    if (hasDetailsTable) {
      await timer.time('details-schema-sync', ensureDemoVehicleDetailsSchema)
    }
    const columns = await timer.time('columns', () => getTableColumns('demo_car_list'))
    const payload = await timer.time('vehicle-cache', () => getCachedData(
      createCacheKey(filters, hasDetailsTable, columns),
      () => buildPayload(filters, hasDetailsTable, columns),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Demo Cars List:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Demo Cars List' }, { status: 500 }),
      timing.serverTiming
    )
  }
}

export async function POST(request: Request) {
  const access = await requireBrandApiAccess('kia')
  if (access) return access

  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await tableExists('demo_vehicle_details'))) {
    return NextResponse.json(
      { error: 'demo_vehicle_details table is not created yet. Run scripts/create-demo-vehicle-details.sql first.' },
      { status: 424 }
    )
  }
  await ensureDemoVehicleDetailsSchema()

  const body = await request.json().catch(() => ({}))
  const vehicleKey = String(body?.vehicleKey || '').trim().toUpperCase()
  const vin = String(body?.vin || '').trim().toUpperCase()
  const trackerStatus = String(body?.trackerStatus || '').trim()
  const serviceDate = String(body?.serviceDate || '').trim() || null
  const currentReadingKms = body?.currentReadingKms === '' || body?.currentReadingKms === null || body?.currentReadingKms === undefined ? null : Number(body.currentReadingKms)
  const onRoadPrice = body?.onRoadPrice === '' || body?.onRoadPrice === null || body?.onRoadPrice === undefined ? null : Number(body.onRoadPrice)
  const vehicleStatus = String(body?.vehicleStatus || '').trim()
  const registrationNumber = String(body?.registrationNumber || '').trim().toUpperCase() || null

  if (!vehicleKey) return NextResponse.json({ error: 'Vehicle key is required' }, { status: 400 })
  if (trackerStatus && !['installed', 'not_installed'].includes(trackerStatus)) {
    return NextResponse.json({ error: 'Tracker status must be installed or not installed' }, { status: 400 })
  }
  if (vehicleStatus && !['active', 'sold'].includes(vehicleStatus)) {
    return NextResponse.json({ error: 'Status must be active or sold' }, { status: 400 })
  }
  if (currentReadingKms !== null && (!Number.isFinite(currentReadingKms) || currentReadingKms < 0)) {
    return NextResponse.json({ error: 'Current reading must be a valid KM value' }, { status: 400 })
  }
  if (onRoadPrice !== null && (!Number.isFinite(onRoadPrice) || onRoadPrice < 0)) {
    return NextResponse.json({ error: 'On road price must be a valid amount' }, { status: 400 })
  }

  const result = await db.execute(sql`
    INSERT INTO demo_vehicle_details (
      vehicle_key,
      vin,
      registration_number,
      tracker_status,
      service_date,
      current_reading_kms,
      on_road_price,
      vehicle_status,
      updated_by,
      updated_by_name,
      updated_at
    )
    VALUES (
      ${vehicleKey},
      ${vin || vehicleKey},
      ${registrationNumber},
      ${trackerStatus || null},
      ${serviceDate}::date,
      ${currentReadingKms},
      ${onRoadPrice},
      ${vehicleStatus || null},
      ${appUser.id},
      ${appUser.fullName},
      now()
    )
    ON CONFLICT (vehicle_key) DO UPDATE SET
      vin = excluded.vin,
      registration_number = excluded.registration_number,
      tracker_status = excluded.tracker_status,
      service_date = excluded.service_date,
      current_reading_kms = excluded.current_reading_kms,
      on_road_price = excluded.on_road_price,
      vehicle_status = excluded.vehicle_status,
      updated_by = excluded.updated_by,
      updated_by_name = excluded.updated_by_name,
      updated_at = now()
    RETURNING
      vehicle_key AS "vehicleKey",
      vin,
      registration_number AS "registrationNumber",
      tracker_status AS "trackerStatus",
      service_date AS "serviceDate",
      current_reading_kms AS "currentReadingKms",
      on_road_price AS "onRoadPrice",
      vehicle_status AS "vehicleStatus",
      updated_by_name AS "detailsUpdatedBy",
      updated_at AS "detailsUpdatedAt"
  `)

  await invalidateCachePattern('kia:demo-cars-list:*')

  return NextResponse.json({ details: resultRows(result)[0] })
}
