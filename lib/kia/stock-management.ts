import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

export type KiaStockLocalStatus = 'bbnd' | 'retail'

export type KiaStockManagementRow = {
  vinNumber: string
  dealerCode: string
  model: string
  variant: string
  color: string
  engineNo: string
  stockStatus: string
  localStatus: 'dms' | KiaStockLocalStatus
  stockLocation: string
  kinInvoiceNo: string
  kinInvoiceDate: string
  orderNo: string
  bookingNo: string
  customerName: string
  basicPrice: number
  stockAge: number
  sourceUploadedAt: string | null
  markedAt: string | null
  markedByName: string | null
  notes: string | null
  fromSavedSnapshot: boolean
}

export type KiaStockManagementPayload = {
  kpis: {
    dmsStock: number
    bbnd: number
    retail: number
    disappearedBbnd: number
  }
  dealerSplit: Array<{ dealer: string; total: number; bbnd: number }>
  rows: KiaStockManagementRow[]
  filters: {
    dealerOptions: string[]
    statusOptions: string[]
    modelOptions: string[]
  }
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
}

export type KiaStockManagementHistoryPayload = {
  rows: KiaStockManagementRow[]
  pagination: {
    page: number
    pageSize: number
    totalRows: number
    totalPages: number
  }
}

type DbRow = Record<string, unknown>

const STOCK_MANAGEMENT_PAGE_SIZE = 10

function rows(result: unknown) {
  return Array.isArray(result) ? result as DbRow[] : []
}

function safeText(value: unknown) {
  return String(value ?? '').trim()
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function isoDateTime(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizePage(value: string | number | null | undefined) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1
}

function normalizeStatus(value: string | null | undefined): KiaStockLocalStatus {
  const status = safeText(value).toLowerCase()
  if (status === 'retail') return 'retail'
  return 'bbnd'
}

function dealerClause(dealerCode: string | null) {
  const normalized = normalizeKiaDealerCode(dealerCode) || null
  return normalized ? sql`AND dealer_code = ${normalized}` : sql``
}

function activeStatusClause(status: string | null | undefined) {
  const normalized = safeText(status).toLowerCase()
  if (!normalized || normalized === 'all') return sql``
  if (normalized === 'bbnd') return sql`AND local_status = 'bbnd'`
  if (normalized === 'dms') return sql`AND local_status = 'dms'`
  return sql`AND LOWER(stock_status) = ${normalized}`
}

function modelClause(model: string | null | undefined) {
  const normalized = safeText(model)
  return normalized && normalized !== 'all' ? sql`AND UPPER(model) = ${normalized.toUpperCase()}` : sql``
}

function searchClause(search: string | null | undefined) {
  const text = safeText(search)
  if (!text) return sql``
  const pattern = `%${text}%`
  return sql`AND (
    vin_number ILIKE ${pattern}
    OR engine_no ILIKE ${pattern}
    OR model ILIKE ${pattern}
    OR variant ILIKE ${pattern}
    OR color ILIKE ${pattern}
    OR customer_name ILIKE ${pattern}
    OR booking_no ILIKE ${pattern}
    OR order_no ILIKE ${pattern}
  )`
}

function mapManagementRow(row: DbRow): KiaStockManagementRow {
  return {
    vinNumber: safeText(row.vin_number),
    dealerCode: safeText(row.dealer_code) || 'Unknown',
    model: safeText(row.model) || 'Unknown',
    variant: safeText(row.variant) || 'Unknown',
    color: safeText(row.color) || 'Unknown',
    engineNo: safeText(row.engine_no),
    stockStatus: safeText(row.stock_status) || 'Unknown',
    localStatus: (safeText(row.local_status) || 'dms') as KiaStockManagementRow['localStatus'],
    stockLocation: safeText(row.stock_location) || '-',
    kinInvoiceNo: safeText(row.kin_invoice_no),
    kinInvoiceDate: safeText(row.kin_invoice_date),
    orderNo: safeText(row.order_no),
    bookingNo: safeText(row.booking_no),
    customerName: safeText(row.customer_name),
    basicPrice: numberValue(row.basic_price),
    stockAge: Math.max(0, Math.round(numberValue(row.stock_age))),
    sourceUploadedAt: isoDateTime(row.source_uploaded_at),
    markedAt: isoDateTime(row.marked_at),
    markedByName: row.marked_by_name ? safeText(row.marked_by_name) : null,
    notes: row.notes ? safeText(row.notes) : null,
    fromSavedSnapshot: Boolean(row.from_saved_snapshot),
  }
}

const ACTIVE_ROWS_CTE = sql`
  WITH latest_dms AS (
    SELECT DISTINCT ON (NULLIF(TRIM(sr.vin_number), ''))
      NULLIF(TRIM(sr.vin_number), '') AS vin_number,
      UPPER(TRIM(COALESCE(NULLIF(TRIM(sr.order_dealer), ''), 'Unknown'))) AS dealer_code,
      COALESCE(NULLIF(TRIM(sr.model), ''), 'Unknown') AS model,
      COALESCE(NULLIF(TRIM(sr.variant), ''), 'Unknown') AS variant,
      COALESCE(NULLIF(TRIM(sr.exterior_color_name), ''), 'Unknown') AS color,
      COALESCE(NULLIF(TRIM(sr.engine_no), ''), '') AS engine_no,
      COALESCE(NULLIF(TRIM(sr.stock_status), ''), 'Unknown') AS stock_status,
      COALESCE(NULLIF(TRIM(sr.stock_location), ''), '-') AS stock_location,
      COALESCE(NULLIF(TRIM(sr.kin_invoice_no), ''), '') AS kin_invoice_no,
      COALESCE(NULLIF(TRIM(sr.kin_invoice_date), ''), '') AS kin_invoice_date,
      COALESCE(NULLIF(TRIM(sr.order_no), ''), '') AS order_no,
      COALESCE(NULLIF(TRIM(sr.booking_no), ''), '') AS booking_no,
      COALESCE(NULLIF(TRIM(sr.cust_name), ''), '') AS customer_name,
      sr.basic_price AS basic_price,
      COALESCE(NULLIF(regexp_replace(sr.stock_age::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS stock_age,
      sr.uploaded_at AS source_uploaded_at,
      to_jsonb(sr) AS vehicle_snapshot
    FROM kia_stock_report sr
    WHERE NULLIF(TRIM(sr.vin_number), '') IS NOT NULL
    ORDER BY NULLIF(TRIM(sr.vin_number), ''), sr.uploaded_at DESC NULLS LAST, sr.id DESC
  ),
  active_rows AS (
    SELECT
      d.vin_number,
      d.dealer_code,
      d.model,
      d.variant,
      d.color,
      d.engine_no,
      d.stock_status,
      COALESCE(ls.local_status, 'dms') AS local_status,
      d.stock_location,
      d.kin_invoice_no,
      d.kin_invoice_date,
      d.order_no,
      d.booking_no,
      d.customer_name,
      d.basic_price,
      d.stock_age,
      d.source_uploaded_at,
      ls.marked_at,
      ls.marked_by_name,
      ls.notes,
      false AS from_saved_snapshot
    FROM latest_dms d
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = d.vin_number
    WHERE COALESCE(ls.local_status, '') <> 'retail'

    UNION ALL

    SELECT
      ls.vin_number,
      COALESCE(NULLIF(TRIM(ls.dealer_code), ''), 'Unknown') AS dealer_code,
      COALESCE(NULLIF(TRIM(ls.model), ''), 'Unknown') AS model,
      COALESCE(NULLIF(TRIM(ls.variant), ''), 'Unknown') AS variant,
      COALESCE(NULLIF(TRIM(ls.color), ''), 'Unknown') AS color,
      COALESCE(NULLIF(TRIM(ls.engine_no), ''), '') AS engine_no,
      COALESCE(NULLIF(TRIM(ls.stock_status_at_mark), ''), 'Sold in DMS') AS stock_status,
      ls.local_status,
      COALESCE(NULLIF(TRIM(ls.stock_location), ''), '-') AS stock_location,
      COALESCE(NULLIF(TRIM(ls.kin_invoice_no), ''), '') AS kin_invoice_no,
      COALESCE(NULLIF(TRIM(ls.kin_invoice_date), ''), '') AS kin_invoice_date,
      COALESCE(NULLIF(TRIM(ls.order_no), ''), '') AS order_no,
      COALESCE(NULLIF(TRIM(ls.booking_no), ''), '') AS booking_no,
      COALESCE(NULLIF(TRIM(ls.customer_name), ''), '') AS customer_name,
      ls.basic_price,
      COALESCE(NULLIF(regexp_replace((ls.vehicle_snapshot->>'stock_age')::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS stock_age,
      ls.source_uploaded_at,
      ls.marked_at,
      ls.marked_by_name,
      ls.notes,
      true AS from_saved_snapshot
    FROM kia_stock_local_statuses ls
    WHERE ls.local_status = 'bbnd'
      AND NOT EXISTS (
        SELECT 1
        FROM latest_dms d
        WHERE d.vin_number = ls.vin_number
      )
  )
`

export async function getKiaStockManagementList(input: {
  dealerCode?: string | null
  status?: string | null
  model?: string | null
  search?: string | null
  page?: string | number | null
}): Promise<KiaStockManagementPayload> {
  const page = normalizePage(input.page)
  const pageSize = STOCK_MANAGEMENT_PAGE_SIZE
  const offset = (page - 1) * pageSize
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null

  const [listResult, kpiResult, filterResult, dealerSplitResult] = await Promise.all([
    db.execute(sql`
      ${ACTIVE_ROWS_CTE}
      SELECT *
      FROM active_rows
      WHERE TRUE
        ${dealerClause(dealerCode)}
        ${activeStatusClause(input.status)}
        ${modelClause(input.model)}
        ${searchClause(input.search)}
      ORDER BY local_status = 'bbnd' DESC, source_uploaded_at DESC NULLS LAST, dealer_code, model, vin_number
      LIMIT ${pageSize}
      OFFSET ${offset}
    `),
    db.execute(sql`
      ${ACTIVE_ROWS_CTE}
      SELECT
        COUNT(*) FILTER (WHERE local_status = 'dms')::int AS dms_stock,
        COUNT(*) FILTER (WHERE local_status = 'bbnd')::int AS bbnd,
        COUNT(*) FILTER (WHERE local_status = 'bbnd' AND from_saved_snapshot)::int AS disappeared_bbnd,
        (SELECT COUNT(*)::int FROM kia_stock_local_statuses WHERE local_status = 'retail') AS retail,
        COUNT(*)::int AS total_rows
      FROM active_rows
      WHERE TRUE
        ${dealerClause(dealerCode)}
        ${activeStatusClause(input.status)}
        ${modelClause(input.model)}
        ${searchClause(input.search)}
    `),
    db.execute(sql`
      ${ACTIVE_ROWS_CTE}
      SELECT
        ARRAY_AGG(DISTINCT dealer_code ORDER BY dealer_code) AS dealers,
        ARRAY_AGG(DISTINCT local_status ORDER BY local_status) AS statuses,
        ARRAY_AGG(DISTINCT model ORDER BY model) AS models
      FROM active_rows
    `),
    db.execute(sql`
      ${ACTIVE_ROWS_CTE}
      SELECT dealer_code AS dealer,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE local_status = 'bbnd')::int AS bbnd
      FROM active_rows
      GROUP BY dealer_code
      ORDER BY total DESC, dealer_code
    `),
  ])

  const kpiRow = rows(kpiResult)[0] || {}
  const totalRows = numberValue(kpiRow.total_rows)
  const filters = rows(filterResult)[0] || {}

  return {
    kpis: {
      dmsStock: numberValue(kpiRow.dms_stock),
      bbnd: numberValue(kpiRow.bbnd),
      retail: numberValue(kpiRow.retail),
      disappearedBbnd: numberValue(kpiRow.disappeared_bbnd),
    },
    dealerSplit: rows(dealerSplitResult).map((row) => ({
      dealer: safeText(row.dealer),
      total: numberValue(row.total),
      bbnd: numberValue(row.bbnd),
    })),
    rows: rows(listResult).map(mapManagementRow),
    filters: {
      dealerOptions: Array.isArray(filters.dealers) ? Array.from(new Set(filters.dealers.map(safeText).filter(Boolean))) : [],
      statusOptions: Array.isArray(filters.statuses) ? Array.from(new Set(filters.statuses.map(safeText).filter(Boolean))) : [],
      modelOptions: Array.isArray(filters.models) ? Array.from(new Set(filters.models.map(safeText).filter(Boolean))) : [],
    },
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    },
  }
}

export async function getKiaStockManagementHistory(input: {
  dealerCode?: string | null
  status?: string | null
  search?: string | null
  page?: string | number | null
}): Promise<KiaStockManagementHistoryPayload> {
  const page = normalizePage(input.page)
  const pageSize = STOCK_MANAGEMENT_PAGE_SIZE
  const offset = (page - 1) * pageSize
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const status = normalizeStatus(input.status || 'bbnd')
  const search = searchClause(input.search)
  const dealer = dealerCode ? sql`AND dealer_code = ${dealerCode}` : sql``

  const [listResult, countResult] = await Promise.all([
    db.execute(sql`
      SELECT
        vin_number,
        dealer_code,
        model,
        variant,
        color,
        engine_no,
        stock_status_at_mark AS stock_status,
        local_status,
        stock_location,
        kin_invoice_no,
        kin_invoice_date,
        order_no,
        booking_no,
        customer_name,
        basic_price,
        COALESCE(NULLIF(regexp_replace((vehicle_snapshot->>'stock_age')::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS stock_age,
        source_uploaded_at,
        marked_at,
        marked_by_name,
        notes,
        true AS from_saved_snapshot
      FROM kia_stock_local_statuses
      WHERE local_status = ${status}
        ${dealer}
        ${search}
      ORDER BY marked_at DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM kia_stock_local_statuses
      WHERE local_status = ${status}
        ${dealer}
        ${search}
    `),
  ])

  const totalRows = numberValue(rows(countResult)[0]?.count)
  return {
    rows: rows(listResult).map(mapManagementRow),
    pagination: {
      page,
      pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
    },
  }
}

async function readCurrentVehicleSnapshot(vinNumber: string) {
  const currentRows = rows(await db.execute(sql`
    SELECT *
    FROM kia_stock_report
    WHERE NULLIF(TRIM(vin_number), '') = ${vinNumber}
    ORDER BY uploaded_at DESC NULLS LAST, id DESC
    LIMIT 1
  `))
  if (currentRows[0]) return currentRows[0]

  const localRows = rows(await db.execute(sql`
    SELECT vehicle_snapshot
    FROM kia_stock_local_statuses
    WHERE vin_number = ${vinNumber}
    LIMIT 1
  `))
  const snapshot = localRows[0]?.vehicle_snapshot
  return snapshot && typeof snapshot === 'object' ? snapshot as DbRow : null
}

export async function markKiaStockLocalStatus(input: {
  vinNumber: string
  localStatus: KiaStockLocalStatus
  notes?: string | null
  appUser: AppUser
}) {
  const vinNumber = safeText(input.vinNumber)
  if (!vinNumber) throw new Error('VIN is required')

  const snapshot = await readCurrentVehicleSnapshot(vinNumber)
  if (!snapshot) throw new Error('Vehicle was not found in current stock or local stock history')

  const dealerCode = normalizeKiaDealerCode(safeText(snapshot.order_dealer)) || safeText(snapshot.order_dealer) || 'Unknown'
  const sourceUploadedAt = snapshot.uploaded_at ? new Date(String(snapshot.uploaded_at)).toISOString() : null
  const snapshotJson = JSON.stringify(snapshot)
  const localStatus = normalizeStatus(input.localStatus)

  await db.execute(sql`
    INSERT INTO kia_stock_local_statuses (
      vin_number,
      local_status,
      dealer_code,
      model,
      variant,
      color,
      engine_no,
      kin_invoice_no,
      kin_invoice_date,
      order_no,
      stock_status_at_mark,
      stock_location,
      booking_no,
      customer_id,
      customer_name,
      basic_price,
      vehicle_snapshot,
      source_uploaded_at,
      notes,
      marked_by,
      marked_by_name,
      marked_by_role,
      marked_at,
      updated_at
    ) VALUES (
      ${vinNumber},
      ${localStatus},
      ${dealerCode},
      ${safeText(snapshot.model) || null},
      ${safeText(snapshot.variant) || null},
      ${safeText(snapshot.exterior_color_name) || null},
      ${safeText(snapshot.engine_no) || null},
      ${safeText(snapshot.kin_invoice_no) || null},
      ${safeText(snapshot.kin_invoice_date) || null},
      ${safeText(snapshot.order_no) || null},
      ${safeText(snapshot.stock_status) || null},
      ${safeText(snapshot.stock_location) || null},
      ${safeText(snapshot.booking_no) || null},
      ${safeText(snapshot.cust_id) || null},
      ${safeText(snapshot.cust_name) || null},
      ${numberValue(snapshot.basic_price) || null},
      ${snapshotJson}::jsonb,
      ${sourceUploadedAt}::timestamptz,
      ${safeText(input.notes) || null},
      ${input.appUser.id}::uuid,
      ${input.appUser.fullName},
      ${input.appUser.role},
      now(),
      now()
    )
    ON CONFLICT (vin_number) DO UPDATE SET
      local_status = EXCLUDED.local_status,
      dealer_code = EXCLUDED.dealer_code,
      model = EXCLUDED.model,
      variant = EXCLUDED.variant,
      color = EXCLUDED.color,
      engine_no = EXCLUDED.engine_no,
      kin_invoice_no = EXCLUDED.kin_invoice_no,
      kin_invoice_date = EXCLUDED.kin_invoice_date,
      order_no = EXCLUDED.order_no,
      stock_status_at_mark = EXCLUDED.stock_status_at_mark,
      stock_location = EXCLUDED.stock_location,
      booking_no = EXCLUDED.booking_no,
      customer_id = EXCLUDED.customer_id,
      customer_name = EXCLUDED.customer_name,
      basic_price = EXCLUDED.basic_price,
      vehicle_snapshot = EXCLUDED.vehicle_snapshot,
      source_uploaded_at = EXCLUDED.source_uploaded_at,
      notes = EXCLUDED.notes,
      marked_by = EXCLUDED.marked_by,
      marked_by_name = EXCLUDED.marked_by_name,
      marked_by_role = EXCLUDED.marked_by_role,
      marked_at = now(),
      updated_at = now()
  `)

  await invalidateCachePattern('kia:stock-report:*')

  return {
    vinNumber,
    localStatus,
  }
}
