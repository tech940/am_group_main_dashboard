import 'server-only'

import { and, desc, eq, getTableColumns, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  tataHPromiseEvents,
  tataHPromiseExchangeBonuses,
  tataHPromiseFiles,
  tataHPromiseVehicles,
} from '@/lib/db/schema'
import { getIndiaYmd } from '@/lib/date-time'
import { HPromiseError } from './access'
import type { HPromiseCapabilities } from './access-shared'
import { ECONOMICS_FORMULA_VERSION } from './economics'
import { groupOptions, loadMetaLists, loadRateRows, periodsFromRateRows } from './options'
import { looksLikeIndianReg, normalizeRegNo } from './registration'
import {
  buildExchangeBonus,
  buildVehicleDetail,
  buildVehicleRow,
  previewablePaths,
  ROW_FIELDS,
  ymd,
  type DetailBooking,
  type DetailEvent,
  type DetailFile,
  type RowField,
  type VehicleListRecord,
  type VehicleRowRecord,
} from './serialize'
import { deriveStage } from './stage'
import { signHPromisePaths } from './storage'
import type { HpExchangeBonus, HpListResponse, HpMeta, HpRegCheck, HpVehicleDetail } from './types'

/**
 * H Promise reads.
 *
 * ⚠️ The register is small (tens of cars a month), so a list read returns every live vehicle in ONE
 * statement — bookings, file kinds and "edited after approval" are derived beside each row by subqueries — and
 * the tabs filter on the client. Every read is ONE statement: the database is ~250 ms away per round trip. There is no pagination to get wrong. LIST_LIMIT is a guard, reported as
 * `truncated` if it is ever reached.
 *
 * ⚠️ No db.query: the client is constructed without a schema.
 */

const LIST_LIMIT = 5000
const V = tataHPromiseVehicles

/*
 * ⚠️ Qualified on purpose. In a single-table select Drizzle renders `${V.id}` inside a sql`` field as a bare
 * "id" — and inside a correlated subquery Postgres binds a bare "id" to the SUBQUERY's table. The first
 * version of these subqueries compared b.vehicle_id with b.id and silently found nothing
 * (scripts/verify-h-promise-flow.ts caught it). Always name the outer table.
 */
const OUTER = {
  id: sql.raw('"tata_h_promise_vehicles"."id"'),
  purchaseStatus: sql.raw('"tata_h_promise_vehicles"."purchase_status"'),
  purchaseDecidedAt: sql.raw('"tata_h_promise_vehicles"."purchase_decided_at"'),
  saleStatus: sql.raw('"tata_h_promise_vehicles"."sale_status"'),
  saleDecidedAt: sql.raw('"tata_h_promise_vehicles"."sale_decided_at"'),
}

const derivedColumns = {
  activeBooking: sql<VehicleListRecord['activeBooking']>`(
    SELECT json_build_object('id', b.id, 'bookingDate', b.booking_date, 'amount', b.amount)
    FROM public.tata_h_promise_bookings b
    WHERE b.vehicle_id = ${OUTER.id} AND b.status = 'active'
    LIMIT 1
  )`,
  presentFiles: sql<string[] | null>`(
    SELECT array_agg(DISTINCT f.kind)
    FROM public.tata_h_promise_files f
    WHERE f.vehicle_id = ${OUTER.id} AND f.attached_at IS NOT NULL AND f.superseded_at IS NULL AND f.booking_id IS NULL
  )`,
  purchaseEditedAfterApproval: sql<boolean>`(
    ${OUTER.purchaseStatus} = 'approved' AND ${OUTER.purchaseDecidedAt} IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tata_h_promise_events e
      WHERE e.vehicle_id = ${OUTER.id} AND e.action = 'purchase_updated' AND e.created_at > ${OUTER.purchaseDecidedAt}
    )
  )`,
  saleEditedAfterApproval: sql<boolean>`(
    ${OUTER.saleStatus} = 'approved' AND ${OUTER.saleDecidedAt} IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tata_h_promise_events e
      WHERE e.vehicle_id = ${OUTER.id} AND e.action = 'sale_updated' AND e.created_at > ${OUTER.saleDecidedAt}
    )
  )`,
}

const tableColumns = getTableColumns(V)
/** A register row: the ROW_FIELDS subset plus the derived columns. */
const rowColumns = {
  ...(Object.fromEntries(ROW_FIELDS.map((field) => [field, tableColumns[field]])) as { [K in RowField]: (typeof tableColumns)[K] }),
  ...derivedColumns,
}
/** The drawer: every column plus the derived ones. */
const fullColumns = { ...tableColumns, ...derivedColumns }

/** Every booking of a vehicle, refunded ones included — the MIS counts bookings and refunds by month. */
const bookingHistory = sql<Array<{ id: string; status: string; bookingDate: string; amount: number | string; refundDate: string | null }> | null>`(
  SELECT json_agg(json_build_object(
    'id', b.id, 'status', b.status, 'bookingDate', b.booking_date, 'amount', b.amount, 'refundDate', b.refund_date
  ) ORDER BY b.booking_date)
  FROM public.tata_h_promise_bookings b
  WHERE b.vehicle_id = ${OUTER.id}
)`

/*
 * The drawer's whole payload beside the vehicle, in the SAME statement: at ~250 ms a round trip, five
 * parallel reads cost more than one wide one (measured 2026-09-17: 1.3 s → one round trip).
 */
const detailBookings = sql<DetailBooking[]>`(
  SELECT coalesce(json_agg(json_build_object(
    'id', b.id, 'status', b.status, 'bookingDate', b.booking_date, 'amount', b.amount, 'remarks', b.remarks,
    'refundDate', b.refund_date, 'refundRemarks', b.refund_remarks, 'refundedByName', b.refunded_by_name,
    'refundedAt', b.refunded_at, 'createdByName', b.created_by_name, 'createdAt', b.created_at
  ) ORDER BY b.booking_date DESC, b.created_at DESC), '[]'::json)
  FROM public.tata_h_promise_bookings b
  WHERE b.vehicle_id = ${OUTER.id}
)`
const detailFiles = sql<DetailFile[]>`(
  SELECT coalesce(json_agg(json_build_object(
    'id', f.id, 'vehicleId', f.vehicle_id, 'bookingId', f.booking_id, 'kind', f.kind, 'storagePath', f.storage_path,
    'contentType', f.content_type, 'sizeBytes', f.size_bytes, 'source', f.source, 'uploadedByName', f.uploaded_by_name,
    'uploadedAt', f.uploaded_at, 'attachedAt', f.attached_at, 'supersededAt', f.superseded_at
  ) ORDER BY f.uploaded_at DESC), '[]'::json)
  FROM public.tata_h_promise_files f
  WHERE f.vehicle_id = ${OUTER.id} AND f.attached_at IS NOT NULL
)`
const detailEvents = sql<DetailEvent[]>`(
  SELECT coalesce(json_agg(recent.item ORDER BY recent.created_at DESC), '[]'::json)
  FROM (
    SELECT e.created_at, json_build_object(
      'id', e.id, 'subject', e.subject, 'action', e.action, 'fromStatus', e.from_status, 'toStatus', e.to_status,
      'actorName', e.actor_name, 'actorRole', e.actor_role, 'remarks', e.remarks, 'changes', e.changes,
      'createdAt', e.created_at
    ) AS item
    FROM public.tata_h_promise_events e
    WHERE e.vehicle_id = ${OUTER.id}
    ORDER BY e.created_at DESC
    LIMIT 300
  ) recent
)`

/** ONE statement: the vehicles, and (live view) every booking beside each. Rates come from the cache. */
export async function listVehicles(view: 'live' | 'deleted'): Promise<HpListResponse> {
  const today = getIndiaYmd()
  const [raw, rateRows] = await Promise.all([
    db
      .select({ ...rowColumns, bookingHistory })
      .from(V)
      .where(view === 'deleted' ? isNotNull(V.deletedAt) : isNull(V.deletedAt))
      .orderBy(desc(V.stockNo))
      .limit(LIST_LIMIT + 1),
    loadRateRows(),
  ])
  const rates = periodsFromRateRows(rateRows)
  const records = raw.slice(0, LIST_LIMIT)
  const bookings = view === 'live'
    ? records.flatMap((record) => (record.bookingHistory ?? []).map((booking) => ({
      id: booking.id,
      vehicleId: record.id,
      status: booking.status,
      bookingDate: String(booking.bookingDate).slice(0, 10),
      amount: Number(booking.amount),
      refundDate: booking.refundDate ? String(booking.refundDate).slice(0, 10) : null,
    })))
    : []
  return {
    rows: records.map((record) => buildVehicleRow(record as VehicleRowRecord, { today, rates })),
    bookings,
    today,
    truncated: raw.length > LIST_LIMIT,
  }
}

const idSchema = z.string().uuid()

export function assertVehicleId(id: string): string {
  if (!idSchema.safeParse(id).success) throw new HPromiseError('That vehicle was not found.', 404)
  return id
}

/**
 * One vehicle in full, in ONE statement. Preview images are NOT signed here: signing is a separate trip to
 * storage (~350 ms), so the drawer asks for them in parallel (getVehiclePreviews) and fills them in.
 */
export async function getVehicleDetail(caps: HPromiseCapabilities, id: string): Promise<HpVehicleDetail> {
  assertVehicleId(id)
  const today = getIndiaYmd()
  const [rows, rateRows] = await Promise.all([
    db
      .select({ ...fullColumns, detailBookings, detailFiles, detailEvents })
      .from(V)
      .where(eq(V.id, id))
      .limit(1),
    loadRateRows(),
  ])
  const record = rows[0]
  if (!record) throw new HPromiseError('That vehicle was not found.', 404)
  if (record.deletedAt && !caps.register.view) throw new HPromiseError('That vehicle was not found.', 404)

  const row = buildVehicleRow(record as VehicleListRecord, { today, rates: periodsFromRateRows(rateRows) })
  return buildVehicleDetail(row, record as VehicleListRecord, caps, {
    bookings: record.detailBookings ?? [],
    files: record.detailFiles ?? [],
    events: record.detailEvents ?? [],
    signed: {},
  })
}

/**
 * Short-lived signed URLs for a vehicle's image previews, keyed by file id — only the kinds this person may
 * open that are not personal documents (those open one at a time, and each opening is recorded).
 */
export async function getVehiclePreviews(caps: HPromiseCapabilities, id: string): Promise<Record<string, string>> {
  assertVehicleId(id)
  const files = await db
    .select({
      id: tataHPromiseFiles.id,
      vehicleId: tataHPromiseFiles.vehicleId,
      bookingId: tataHPromiseFiles.bookingId,
      kind: tataHPromiseFiles.kind,
      storagePath: tataHPromiseFiles.storagePath,
      contentType: tataHPromiseFiles.contentType,
      sizeBytes: tataHPromiseFiles.sizeBytes,
      source: tataHPromiseFiles.source,
      uploadedByName: tataHPromiseFiles.uploadedByName,
      uploadedAt: tataHPromiseFiles.uploadedAt,
      attachedAt: tataHPromiseFiles.attachedAt,
      supersededAt: tataHPromiseFiles.supersededAt,
    })
    .from(tataHPromiseFiles)
    .where(and(eq(tataHPromiseFiles.vehicleId, id), isNotNull(tataHPromiseFiles.attachedAt), isNull(tataHPromiseFiles.supersededAt)))
  const paths = previewablePaths(files, caps)
  if (paths.length === 0) return {}
  const signed = await signHPromisePaths(paths)
  const out: Record<string, string> = {}
  for (const file of files) {
    const url = signed[file.storagePath]
    if (url) out[file.id] = url
  }
  return out
}

/** The name lists, rates and typing suggestions: one statement plus the cached rates. */
export async function getMeta(): Promise<HpMeta> {
  const [lists, rateRows] = await Promise.all([loadMetaLists(), loadRateRows()])
  return {
    today: getIndiaYmd(),
    formulaVersion: ECONOMICS_FORMULA_VERSION,
    options: groupOptions(lists.options),
    rates: periodsFromRateRows(rateRows),
    rateRows,
    suggestions: lists.suggestions,
  }
}

/**
 * Is this registration already on the register? `excludeId` is the vehicle being edited.
 * Earlier lifecycles (cars sold and since bought back) are listed for context, never as a conflict.
 */
export async function checkRegistration(regNo: string, excludeId?: string | null): Promise<HpRegCheck> {
  const key = normalizeRegNo(regNo)
  if (key.length < 4) return { key, looksValid: false, live: null, previous: [] }
  const rows = await db
    .select({
      id: V.id,
      stockNo: V.stockNo,
      saleStatus: V.saleStatus,
      saleDate: V.saleDate,
      deletedAt: V.deletedAt,
      hasActiveBooking: sql<boolean>`EXISTS (SELECT 1 FROM public.tata_h_promise_bookings b WHERE b.vehicle_id = ${OUTER.id} AND b.status = 'active')`,
    })
    .from(V)
    .where(and(
      eq(V.regNoKey, key),
      isNull(V.deletedAt),
      excludeId && idSchema.safeParse(excludeId).success ? ne(V.id, excludeId) : undefined,
    ))
    .orderBy(desc(V.stockNo))
    .limit(20)
  const liveRow = rows.find((row) => row.saleStatus !== 'approved')
  return {
    key,
    looksValid: looksLikeIndianReg(key),
    live: liveRow
      ? { id: liveRow.id, stockNo: liveRow.stockNo, stage: deriveStage({ deletedAt: null, saleStatus: liveRow.saleStatus, hasActiveBooking: liveRow.hasActiveBooking }) }
      : null,
    previous: rows
      .filter((row) => row.saleStatus === 'approved')
      .map((row) => ({ id: row.id, stockNo: row.stockNo, saleDate: ymd(row.saleDate) })),
  }
}

export async function listExchangeBonuses(caps: HPromiseCapabilities): Promise<HpExchangeBonus[]> {
  const rows = await db
    .select()
    .from(tataHPromiseExchangeBonuses)
    .where(isNull(tataHPromiseExchangeBonuses.deletedAt))
    .orderBy(sql`${tataHPromiseExchangeBonuses.entryDate} DESC NULLS LAST`, desc(tataHPromiseExchangeBonuses.createdAt))
    .limit(LIST_LIMIT)
  return rows.map((row) => buildExchangeBonus(row, caps))
}

/** The organisation-wide H Promise history (name lists, rates, exchange bonuses) for the Settings tab. */
export async function listSettingsHistory() {
  const rows = await db
    .select()
    .from(tataHPromiseEvents)
    .where(or(eq(tataHPromiseEvents.subject, 'option'), eq(tataHPromiseEvents.subject, 'setting')))
    .orderBy(desc(tataHPromiseEvents.createdAt))
    .limit(100)
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorName: row.actorName,
    remarks: row.remarks,
    changes: row.changes,
    createdAt: row.createdAt.toISOString(),
  }))
}

