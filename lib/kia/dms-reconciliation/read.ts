import 'server-only'

/**
 * Reads for the DMS Exceptions tab. The list and its summary are ONE statement over the derived
 * table; nothing here touches the DMS feeds except the detail view of a single record.
 *
 * Month rule (owner, 2026-09-18): an exception is filed under the month the BOOKING was made — "it
 * should only show strictly of the selected month booking" — and nowhere else. An August booking that
 * DMS delivered in September is an August exception. (Two earlier rules were built and rejected: a
 * carry-over of older open items into the current month, then filing by the DMS event month.) For a
 * DMS record with no booking here, the DMS booking date. The current month lists what is still open;
 * a past month shows its bookings' exceptions, fixed or not.
 *
 * PII: phones are masked HERE, before serialising, for anyone outside canViewKiaCustomerPii. PAN and
 * Aadhaar are never selected.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getIndiaYmd } from '@/lib/date-time'
import { maskKiaPii } from '@/lib/kia/pii'
import { readReconWatermark } from './load'
import {
  DMS_PAID_THRESHOLD,
  RECON_EXCEPTION_TYPES,
  type OurStage,
  type ReconExceptionType,
  type ReconFreshness,
  type ReconListResponse,
  type ReconListRow,
} from './types'

type Row = Record<string, unknown>
const rows = (result: unknown): Row[] => (Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] })?.rows ?? []))
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))
/** postgres-js hands DATE / TIMESTAMPTZ back as a JS Date; everything served is an ISO string. */
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))
const ymd = (v: unknown) => iso(v)?.slice(0, 10) ?? null

export type ReconViewer = {
  /** Dealer codes the viewer is pinned to; null = all branches. */
  dealerScope: string[] | null
  canViewPii: boolean
}

export type ReconListFilters = {
  month: string
  type: ReconExceptionType | 'review' | 'all'
  q: string
  page: number
  pageSize: number
}

export function currentReconMonth(): string {
  return getIndiaYmd().slice(0, 7)
}

export function parseReconFilters(params: URLSearchParams): ReconListFilters {
  const current = currentReconMonth()
  const month = /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')! : current
  const rawType = params.get('type') || 'all'
  const type = rawType === 'review' || (RECON_EXCEPTION_TYPES as readonly string[]).includes(rawType) ? rawType as ReconListFilters['type'] : 'all'
  return {
    month: month > current ? current : month,
    type,
    q: (params.get('q') || '').trim().slice(0, 80),
    page: Math.max(1, Math.floor(Number(params.get('page')) || 1)),
    pageSize: Math.min(100, Math.max(10, Math.floor(Number(params.get('pageSize')) || 25))),
  }
}

export async function readReconFreshness(): Promise<{ freshness: ReconFreshness; stale: boolean }> {
  const [[state], mark] = await Promise.all([
    db.execute(sql`
      SELECT watermark, last_run_at::text AS last_run_at, last_run_ms, stats, last_error,
             (running_since IS NOT NULL AND running_since > now() - interval '5 minutes') AS running
      FROM kia_dms_recon_state WHERE id = 1`).then(rows),
    readReconWatermark(),
  ])
  const stats = (state?.stats ?? {}) as Record<string, number>
  const freshness: ReconFreshness = {
    lastRunAt: str(state?.last_run_at),
    lastRunMs: numOrNull(state?.last_run_ms),
    refreshing: state?.running === true,
    feeds: mark.feeds,
    coverage: state?.last_run_at
      ? { ourBookings: Number(stats.ourBookings ?? 0), matched: Number(stats.matched ?? 0), review: Number(stats.review ?? 0), unmatched: Number(stats.unmatchedOurs ?? 0) }
      : null,
    lastError: str(state?.last_error),
  }
  return { freshness, stale: state?.watermark !== mark.watermark }
}

export async function listReconItems(filters: ReconListFilters, viewer: ReconViewer): Promise<Omit<ReconListResponse, 'freshness'>> {
  const current = currentReconMonth()
  const isCurrent = filters.month === current
  const monthStart = `${filters.month}-01`
  const scopeJson = viewer.dealerScope ? JSON.stringify(viewer.dealerScope.map((d) => d.toUpperCase())) : null
  const like = `%${filters.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
  const offset = (filters.page - 1) * filters.pageSize

  const [result] = rows(await db.execute(sql`
    WITH base AS (
      SELECT i.*,
             (CASE WHEN i.state = 'open' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                   ELSE (i.resolved_at AT TIME ZONE 'Asia/Kolkata')::date END - i.event_date) AS age_days
      FROM kia_dms_recon_items i
      WHERE i.booking_month = ${monthStart}::date
        AND (i.state = 'open' OR NOT ${isCurrent}::boolean)
        AND (${scopeJson}::jsonb IS NULL
             OR UPPER(COALESCE(i.dealer_code, i.dms_dealer, '')) IN (SELECT jsonb_array_elements_text(${scopeJson}::jsonb)))
        AND (${filters.q}::text = ''
             OR i.customer_name ILIKE ${like} OR i.booking_number ILIKE ${like}
             OR i.dms_booking_no ILIKE ${like} OR i.vin ILIKE ${like})
    ),
    filtered AS (
      SELECT * FROM base
      WHERE (${filters.type}::text = 'all'
             OR (${filters.type}::text = 'review' AND kind = 'review')
             OR (${filters.type}::text = 'unmatched_dms' AND kind = 'unmatched_dms')
             OR (kind = 'exception' AND exception_type = ${filters.type}::text))
    ),
    page AS (
      SELECT f.*, kb.customer_phone AS our_phone,
             (SELECT br.contact_number FROM kia_booking_report br
              WHERE f.booking_id IS NULL AND br.booking_no = f.dms_booking_no AND br.customer_id = f.dms_customer_id
              ORDER BY br.uploaded_at DESC LIMIT 1) AS dms_phone,
             CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END AS sev_rank,
             CASE f.kind WHEN 'exception' THEN 0 WHEN 'review' THEN 1 ELSE 2 END AS kind_rank
      FROM filtered f
      LEFT JOIN kia_bookings kb ON kb.id = f.booking_id
      -- Worst first; within a severity the oldest (longest stuck) first.
      ORDER BY sev_rank, kind_rank, f.event_date, f.id
      LIMIT ${filters.pageSize}::int OFFSET ${offset}::int
    )
    SELECT
      (SELECT COALESCE(json_agg(json_build_object(
          'id', p.id, 'kind', p.kind, 'type', p.exception_type, 'severity', p.severity, 'state', p.state,
          'eventDate', p.event_date, 'eventMonth', p.event_month, 'bookingDate', p.booking_date, 'bookingMonth', p.booking_month,
          'firstSeenAt', p.first_seen_at, 'resolvedAt', p.resolved_at,
          'ageDays', p.age_days, 'headline', p.headline, 'bookingId', p.booking_id, 'bookingNumber', p.booking_number,
          'customerName', p.customer_name, 'phone', COALESCE(p.our_phone, p.dms_phone), 'dealerCode', COALESCE(p.dealer_code, p.dms_dealer),
          'model', p.model, 'variant', p.variant, 'ourStatus', p.our_status, 'ourStage', p.our_stage,
          'dmsBookingNo', p.dms_booking_no, 'dmsStatus', p.dms_status, 'vin', p.vin, 'invoiceNo', p.invoice_no,
          'deliveryDate', p.delivery_date, 'dmsReceived', p.dms_received, 'matchTier', p.match_tier, 'matchLabel', p.match_label
        ) ORDER BY p.sev_rank, p.kind_rank, p.event_date, p.id), '[]'::json) FROM page p) AS rows,
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT json_build_object(
          'total', count(*) FILTER (WHERE kind <> 'unmatched_dms'),
          'review', count(*) FILTER (WHERE kind = 'review'),
          'dms_delivered', count(*) FILTER (WHERE kind = 'exception' AND exception_type = 'dms_delivered'),
          'dms_invoiced', count(*) FILTER (WHERE kind = 'exception' AND exception_type = 'dms_invoiced'),
          'dms_paid', count(*) FILTER (WHERE kind = 'exception' AND exception_type = 'dms_paid'),
          'dms_cancelled', count(*) FILTER (WHERE kind = 'exception' AND exception_type = 'dms_cancelled'),
          'internal_ahead', count(*) FILTER (WHERE kind = 'exception' AND exception_type = 'internal_ahead'),
          'unmatched_dms', count(*) FILTER (WHERE kind = 'unmatched_dms')
        ) FROM base) AS summary`))

  const summaryRaw = (result?.summary ?? {}) as Record<string, number>
  const listRows = ((result?.rows ?? []) as Row[]).map((r): ReconListRow => ({
    id: String(r.id),
    kind: r.kind as ReconListRow['kind'],
    type: r.type as ReconExceptionType,
    severity: r.severity as ReconListRow['severity'],
    state: r.state as ReconListRow['state'],
    eventDate: String(r.eventDate),
    eventMonth: String(r.eventMonth),
    bookingDate: str(r.bookingDate),
    bookingMonth: str(r.bookingMonth),
    firstSeenAt: String(r.firstSeenAt),
    resolvedAt: str(r.resolvedAt),
    ageDays: Math.max(0, Number(r.ageDays) || 0),
    headline: String(r.headline),
    bookingId: str(r.bookingId),
    bookingNumber: str(r.bookingNumber),
    customerName: str(r.customerName),
    mobile: r.phone ? maskKiaPii(String(r.phone), viewer.canViewPii) : null,
    dealerCode: str(r.dealerCode),
    model: str(r.model),
    variant: str(r.variant),
    ourStatus: str(r.ourStatus),
    ourStage: str(r.ourStage) as OurStage | null,
    dmsBookingNo: str(r.dmsBookingNo),
    dmsStatus: str(r.dmsStatus),
    vin: str(r.vin),
    invoiceNo: str(r.invoiceNo),
    deliveryDate: str(r.deliveryDate),
    dmsReceived: numOrNull(r.dmsReceived),
    paymentReceived: Number(r.dmsReceived ?? 0) > DMS_PAID_THRESHOLD,
    matchTier: numOrNull(r.matchTier),
    matchLabel: str(r.matchLabel),
  }))

  return {
    month: filters.month,
    currentMonth: current,
    isCurrentMonth: isCurrent,
    rows: listRows,
    total: Number(result?.total ?? 0),
    page: filters.page,
    pageSize: filters.pageSize,
    summary: {
      total: Number(summaryRaw.total ?? 0),
      review: Number(summaryRaw.review ?? 0),
      byType: Object.fromEntries(RECON_EXCEPTION_TYPES.map((t) => [t, Number(summaryRaw[t] ?? 0)])) as Record<ReconExceptionType, number>,
    },
    canViewPii: viewer.canViewPii,
  }
}

/** Open exceptions + reviews of the current month (what the tab opens on) — the tab badge. */
export async function countOpenRecon(viewer: ReconViewer): Promise<number> {
  const monthStart = `${currentReconMonth()}-01`
  const scopeJson = viewer.dealerScope ? JSON.stringify(viewer.dealerScope.map((d) => d.toUpperCase())) : null
  const [r] = rows(await db.execute(sql`
    SELECT count(*)::int AS n FROM kia_dms_recon_items
    WHERE state = 'open' AND kind <> 'unmatched_dms' AND booking_month = ${monthStart}::date
      AND (${scopeJson}::jsonb IS NULL
           OR UPPER(COALESCE(dealer_code, dms_dealer, '')) IN (SELECT jsonb_array_elements_text(${scopeJson}::jsonb)))`))
  return Number(r?.n ?? 0)
}

export type ReconDetail = {
  item: ReconListRow & { matchNote: string | null; candidates: unknown[]; paidCrossedOn: string | null; lastReceiptDate: string | null; receiptCount: number | null; invoiceDate: string | null; dmsCustomerId: string | null; dmsDealer: string | null }
  booking: Row | null
  dms: {
    booking: Row | null
    history: Array<{ at: string; dealer: string | null; status: string | null }>
    sales: Row[]
    receipts: Row[]
  }
}

/** One record in full: the item, our booking, and the DMS rows behind it. Null if out of scope. */
export async function getReconDetail(id: string, viewer: ReconViewer): Promise<ReconDetail | null> {
  return (await getReconDetails([id], viewer))[0] ?? null
}

/**
 * Many records in full, in SIX statements whatever the count — the list prefetches its whole page
 * with this so opening a record is instant (owner: "I don't want to wait on this popup"). Records
 * outside the viewer's branches are silently left out.
 */
export async function getReconDetails(ids: string[], viewer: ReconViewer): Promise<ReconDetail[]> {
  const wanted = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 100)
  if (!wanted.length) return []
  const scope = viewer.dealerScope?.map((d) => d.toUpperCase()) ?? null
  const items = rows(await db.execute(sql`
    SELECT i.*, (CASE WHEN i.state = 'open' THEN (now() AT TIME ZONE 'Asia/Kolkata')::date
                      ELSE (i.resolved_at AT TIME ZONE 'Asia/Kolkata')::date END - i.event_date) AS age_days
    FROM kia_dms_recon_items i
    WHERE i.id IN (SELECT (jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb))::uuid)`))
    .filter((item) => !scope || scope.includes(String(item.dealer_code ?? item.dms_dealer ?? '').toUpperCase()))
  if (!items.length) return []

  const bookingIds = [...new Set(items.map((i) => str(i.booking_id)).filter(Boolean))] as string[]
  const keys = [...new Map(items
    .filter((i) => str(i.dms_booking_no) && str(i.dms_customer_id))
    .map((i) => [`${i.dms_booking_no}|${i.dms_customer_id}`, [String(i.dms_booking_no), String(i.dms_customer_id)]])).values()]
  const keysJson = JSON.stringify(keys)
  const none = Promise.resolve([] as Row[])

  const [bookingRows, dmsRows, historyRows, salesRows, receiptRows] = await Promise.all([
    bookingIds.length
      ? db.execute(sql`
          SELECT kb.id::text AS id, kb.booking_number, kb.status, kb.customer_name, kb.customer_phone, kb.dealer_code, kb.model, kb.variant,
                 kb.color, kb.consultant_name, kb.bank_name, kb.allocated_vin, kb.amount_received,
                 kb.created_at::text AS created_at, kb.delivered_at::text AS delivered_at,
                 kb.metadata->>'bookingDate' AS booking_date,
                 p.id AS proforma_id, p.approval_status, p.proforma_date::text AS proforma_date,
                 p.ex_showroom, p.grand_total_cost, p.booking_amount,
                 va.vin_number AS live_vin, va.allocation_status, va.payment_confirmed_at::text AS payment_confirmed_at
          FROM kia_bookings kb
          LEFT JOIN kia_proformas p ON p.id = kb.proforma_id AND p.deleted_at IS NULL
          LEFT JOIN LATERAL (
            SELECT * FROM kia_vehicle_allocations v WHERE v.booking_id = kb.id AND v.released_at IS NULL
            ORDER BY v.created_at DESC LIMIT 1
          ) va ON TRUE
          WHERE kb.id IN (SELECT (jsonb_array_elements_text(${JSON.stringify(bookingIds)}::jsonb))::uuid)`).then(rows)
      : none,
    keys.length
      ? db.execute(sql`
          WITH k AS (SELECT x->>0 AS no, x->>1 AS cid FROM jsonb_array_elements(${keysJson}::jsonb) x)
          SELECT DISTINCT ON (br.booking_no, br.customer_id)
                 br.booking_no, br.customer_id, br.dealer_code, br.status, br.name_of_the_customer, br.contact_number,
                 br.model, br.variant, br.color, br.booking_date::text AS booking_date, br.consultant_name, br.team_leader,
                 br.mode_of_purchase, br.dsa_financier, br.amount_received,
                 br.committed_delivery_date::text AS committed_delivery_date, br.uploaded_at::text AS uploaded_at
          FROM kia_booking_report br JOIN k ON k.no = br.booking_no AND k.cid = br.customer_id
          ORDER BY br.booking_no, br.customer_id, br.uploaded_at DESC`).then(rows)
      : none,
    keys.length
      ? db.execute(sql`
          WITH k AS (SELECT x->>0 AS no, x->>1 AS cid FROM jsonb_array_elements(${keysJson}::jsonb) x)
          SELECT br.booking_no, br.customer_id, br.uploaded_at::text AS at, br.dealer_code AS dealer, br.status
          FROM kia_booking_report br JOIN k ON k.no = br.booking_no AND k.cid = br.customer_id
          ORDER BY br.booking_no, br.customer_id, br.uploaded_at, br.dealer_code, br.status`).then(rows)
      : none,
    keys.length
      ? db.execute(sql`
          WITH k AS (SELECT x->>0 AS no, x->>1 AS cid FROM jsonb_array_elements(${keysJson}::jsonb) x)
          SELECT DISTINCT ON (s.booking_no, s.customerid, UPPER(BTRIM(s.vin_number)))
                 s.booking_no, s.customerid AS customer_id, UPPER(BTRIM(s.vin_number)) AS vin, s.invoice_no, s.invoice_date,
                 s.delivery_date::text AS delivery_date, s.confirm_date::text AS confirm_date, s.registration_name,
                 s.model, s.variant, s.color, COALESCE(s.dealer_code_2, s.dealer_code) AS dealer_code, s.consultant_name,
                 s.dsa_financier, s.mode_of_purchase, s.ex_showroom_price
          FROM kia_sales_report s JOIN k ON k.no = s.booking_no AND k.cid = s.customerid
          ORDER BY s.booking_no, s.customerid, UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC`).then(rows)
      : none,
    keys.length
      ? db.execute(sql`
          WITH k AS (SELECT x->>0 AS no, x->>1 AS cid FROM jsonb_array_elements(${keysJson}::jsonb) x)
          SELECT r.appointment_no AS booking_no, r.customer_id, r.receipt_no, r.receipt_date::text AS receipt_date,
                 r.receipt_amount, r.type_of_payment, r.remarks, r.dealer_code
          FROM (SELECT DISTINCT ON (rr.dealer_code, rr.receipt_no) rr.*
                FROM kia_receipt_report rr JOIN k ON k.no = rr.appointment_no AND k.cid = rr.customer_id
                ORDER BY rr.dealer_code, rr.receipt_no, rr.uploaded_at DESC) r
          -- dealer_code breaks ties: both listings can carry the same receipt number on the same day.
          ORDER BY r.receipt_date, r.receipt_no, r.dealer_code`).then(rows)
      : none,
  ])

  const byKey = <T extends Row>(list: T[], no = 'booking_no', cid = 'customer_id') => {
    const map = new Map<string, T[]>()
    for (const row of list) {
      const key = `${row[no]}|${row[cid]}`
      const bucket = map.get(key)
      if (bucket) bucket.push(row); else map.set(key, [row])
    }
    return map
  }
  const bookingsById = new Map(bookingRows.map((b) => [String(b.id), b]))
  const dmsByKey = byKey(dmsRows)
  const historyByKey = byKey(historyRows)
  const salesByKey = byKey(salesRows)
  const receiptsByKey = byKey(receiptRows)

  const order = new Map(wanted.map((id, i) => [id, i]))
  return items
    .sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0))
    .map((item) => {
      const bookingNo = str(item.dms_booking_no)
      const customerId = str(item.dms_customer_id)
      const key = `${bookingNo}|${customerId}`

      // Collapse the upload history to its status CHANGES, per listing.
      const history: ReconDetail['dms']['history'] = []
      const lastByDealer = new Map<string, string>()
      for (const h of historyByKey.get(key) ?? []) {
        const dealerKey = String(h.dealer ?? '')
        if (lastByDealer.get(dealerKey) === h.status) continue
        lastByDealer.set(dealerKey, String(h.status ?? ''))
        history.push({ at: String(h.at), dealer: str(h.dealer), status: str(h.status) })
      }

      const source = item.booking_id ? bookingsById.get(String(item.booking_id)) : undefined
      const booking = source ? { ...source, customer_phone: maskKiaPii(str(source.customer_phone), viewer.canViewPii) } : null
      const dmsSource = dmsByKey.get(key)?.[0]
      const dmsBooking = dmsSource ? { ...dmsSource, contact_number: maskKiaPii(str(dmsSource.contact_number), viewer.canViewPii) } : null

      return {
        item: {
          id: String(item.id),
          kind: item.kind as ReconListRow['kind'],
          type: item.exception_type as ReconExceptionType,
          severity: item.severity as ReconListRow['severity'],
          state: item.state as ReconListRow['state'],
          eventDate: ymd(item.event_date)!,
          eventMonth: ymd(item.event_month)!,
          bookingDate: ymd(item.booking_date),
          bookingMonth: ymd(item.booking_month),
          firstSeenAt: iso(item.first_seen_at)!,
          resolvedAt: iso(item.resolved_at),
          ageDays: Math.max(0, Number(item.age_days) || 0),
          headline: String(item.headline),
          bookingId: str(item.booking_id),
          bookingNumber: str(item.booking_number),
          customerName: str(item.customer_name),
          mobile: booking ? str(booking.customer_phone) : dmsBooking ? str(dmsBooking.contact_number) : null,
          dealerCode: str(item.dealer_code ?? item.dms_dealer),
          model: str(item.model),
          variant: str(item.variant),
          ourStatus: str(item.our_status),
          ourStage: str(item.our_stage) as OurStage | null,
          dmsBookingNo: bookingNo,
          dmsStatus: str(item.dms_status),
          vin: str(item.vin),
          invoiceNo: str(item.invoice_no),
          deliveryDate: ymd(item.delivery_date),
          dmsReceived: numOrNull(item.dms_received),
          paymentReceived: Number(item.dms_received ?? 0) > DMS_PAID_THRESHOLD,
          matchTier: numOrNull(item.match_tier),
          matchLabel: str(item.match_label),
          matchNote: str(item.match_note),
          candidates: Array.isArray(item.candidates) ? item.candidates : [],
          paidCrossedOn: ymd(item.paid_crossed_on),
          lastReceiptDate: ymd(item.last_receipt_date),
          receiptCount: numOrNull(item.dms_receipt_count),
          invoiceDate: ymd(item.invoice_date),
          dmsCustomerId: customerId,
          dmsDealer: str(item.dms_dealer),
        },
        booking,
        dms: {
          booking: dmsBooking,
          history,
          sales: salesByKey.get(key) ?? [],
          receipts: receiptsByKey.get(key) ?? [],
        },
      }
    })
}
