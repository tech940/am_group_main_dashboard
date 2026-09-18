import 'server-only'

/**
 * Loads the engine's inputs: our bookings, and the DMS bookings folded from the three DMS feeds.
 * Read-only; four statements run in parallel. The DMS feeds are external imports — never written here.
 *
 * All three DMS tables are append-with-dedupe snapshots (a row per upload that changed): the LATEST
 * row per key is the current state, and the history is what dates a status change.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { DMS_PAID_THRESHOLD } from './types'
import type { DmsBookingInput, OurBookingInput } from './engine'
import { isoDate, panKey, phone10, vinKey } from './normalize'

type Row = Record<string, unknown>
const rows = (result: unknown): Row[] => (Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] })?.rows ?? []))
const str = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null)
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const maxDate = (...values: Array<string | null | undefined>) => values.filter(Boolean).sort().at(-1) ?? null

export async function loadReconInputs(): Promise<{ ours: OurBookingInput[]; dms: DmsBookingInput[] }> {
  const [bookingRows, salesRows, receiptRows, ourRows] = await Promise.all([
    db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (booking_no, customer_id)
          booking_no, customer_id, status, name_of_the_customer, model, variant, booking_date
        FROM kia_booking_report
        WHERE COALESCE(BTRIM(booking_no), '') <> '' AND COALESCE(BTRIM(customer_id), '') <> ''
        ORDER BY booking_no, customer_id, uploaded_at DESC
      ),
      /*
       * When a status was FIRST seen dates the change — except on the feed's opening day: the whole
       * DMS history was bulk-loaded then (2026-06-30), so "first seen as Retail" on that day means
       * nothing. Those dates are dropped; the callers fall back to real business dates.
       */
      feed AS (SELECT (min(uploaded_at) AT TIME ZONE 'Asia/Kolkata')::date AS opened FROM kia_booking_report),
      hist AS (
        SELECT booking_no, customer_id,
          (array_agg(dealer_code ORDER BY uploaded_at ASC))[1] AS first_dealer,
          array_agg(DISTINCT RIGHT(regexp_replace(COALESCE(contact_number, ''), '[^0-9]', '', 'g'), 10)) AS phones,
          NULLIF((min(uploaded_at) FILTER (WHERE status = 'Retail') AT TIME ZONE 'Asia/Kolkata')::date, (SELECT opened FROM feed))::text AS first_retail,
          NULLIF((min(uploaded_at) FILTER (WHERE status = 'Invoice') AT TIME ZONE 'Asia/Kolkata')::date, (SELECT opened FROM feed))::text AS first_invoice,
          NULLIF((min(uploaded_at) FILTER (WHERE status IN ('Booking Cancel', 'Invoice Cancel')) AT TIME ZONE 'Asia/Kolkata')::date, (SELECT opened FROM feed))::text AS first_cancel
        FROM kia_booking_report
        WHERE COALESCE(BTRIM(booking_no), '') <> '' AND COALESCE(BTRIM(customer_id), '') <> ''
        GROUP BY booking_no, customer_id
      )
      SELECT l.booking_no, l.customer_id, l.status, l.name_of_the_customer AS name, l.model, l.variant,
             l.booking_date::text AS booking_date, h.first_dealer, h.phones, h.first_retail, h.first_invoice, h.first_cancel
      FROM latest l JOIN hist h USING (booking_no, customer_id)`),
    db.execute(sql`
      SELECT DISTINCT ON (UPPER(BTRIM(vin_number)))
        booking_no, customerid AS customer_id, UPPER(BTRIM(vin_number)) AS vin, invoice_no, invoice_date,
        delivery_date::text AS delivery_date, pan_no, contact_num1, contact_num2, contact_num3, registration_name,
        model, variant, dealer_code, dealer_code_2, booking_date::text AS booking_date
      FROM kia_sales_report
      WHERE COALESCE(BTRIM(vin_number), '') <> ''
      ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC`),
    db.execute(sql`
      SELECT appointment_no AS booking_no, customer_id, receipt_date::text AS receipt_date, receipt_amount
      FROM (
        SELECT DISTINCT ON (dealer_code, receipt_no) *
        FROM kia_receipt_report
        ORDER BY dealer_code, receipt_no, uploaded_at DESC
      ) r
      WHERE COALESCE(BTRIM(appointment_no), '') <> ''
      ORDER BY receipt_date, receipt_no`),
    db.execute(sql`
      SELECT kb.id::text AS id, kb.booking_number, kb.status, kb.dealer_code, kb.customer_name, kb.customer_phone,
             kb.metadata->>'panNumber' AS pan, kb.allocated_vin, NULLIF(BTRIM(kb.metadata->>'dmsBookingNo'), '') AS dms_no,
             kb.metadata->>'heldFromStatus' AS held_from, kb.model, kb.variant,
             CASE WHEN COALESCE(kb.metadata->>'bookingDate', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  THEN left(kb.metadata->>'bookingDate', 10)
                  ELSE (kb.created_at AT TIME ZONE 'Asia/Kolkata')::date::text END AS booking_date,
             (kb.delivered_at AT TIME ZONE 'Asia/Kolkata')::date::text AS delivered_on,
             COALESCE(kb.amount_received, 0)::float8 AS amount_received,
             EXISTS (
               SELECT 1 FROM kia_vehicle_allocations va
               WHERE va.booking_id = kb.id AND va.released_at IS NULL
                 AND (va.payment_confirmed_at IS NOT NULL OR va.payment_secured_at IS NOT NULL)
             ) AS allocation_paid
      FROM kia_bookings kb
      WHERE kb.deleted_at IS NULL`),
  ])

  // ── DMS bookings ────────────────────────────────────────────────────────────────────────────
  const dms = new Map<string, DmsBookingInput>()
  const blank = (bookingNo: string, customerId: string): DmsBookingInput => ({
    key: `${bookingNo}|${customerId}`, bookingNo, customerId, status: null, outletDealer: null, customerName: null,
    registrationName: null, phones: [], pans: [], vins: [], model: null, variant: null, bookingDate: null,
    deliveryDate: null, invoiceNo: null, invoiceDate: null, firstRetailSeen: null, firstInvoiceSeen: null,
    firstCancelSeen: null, received: 0, receiptCount: 0, lastReceiptDate: null, paidCrossedOn: null, latestActivity: null,
  })
  const entity = (bookingNo: string, customerId: string) => {
    const key = `${bookingNo}|${customerId}`
    let d = dms.get(key)
    if (!d) { d = blank(bookingNo, customerId); dms.set(key, d) }
    return d
  }
  const addUnique = (list: string[], value: string) => { if (value && !list.includes(value)) list.push(value) }

  for (const r of rows(bookingRows)) {
    const d = entity(String(r.booking_no).trim(), String(r.customer_id).trim())
    d.status = str(r.status)
    d.outletDealer = str(r.first_dealer)
    d.customerName = str(r.name)
    d.model = str(r.model)
    d.variant = str(r.variant)
    d.bookingDate = isoDate(r.booking_date)
    ;(Array.isArray(r.phones) ? r.phones as string[] : []).forEach((p) => addUnique(d.phones, phone10(p)))
    d.firstRetailSeen = isoDate(r.first_retail)
    d.firstInvoiceSeen = isoDate(r.first_invoice)
    d.firstCancelSeen = isoDate(r.first_cancel)
  }

  for (const r of rows(salesRows)) {
    const bookingNo = str(r.booking_no)
    const customerId = str(r.customer_id)
    if (!bookingNo || !customerId) continue
    const d = entity(bookingNo, customerId)
    addUnique(d.vins, vinKey(r.vin))
    addUnique(d.pans, panKey(r.pan_no))
    for (const p of [r.contact_num1, r.contact_num2, r.contact_num3]) addUnique(d.phones, phone10(p))
    d.registrationName = str(r.registration_name) ?? d.registrationName
    const delivered = isoDate(r.delivery_date)
    if (delivered && (!d.deliveryDate || delivered > d.deliveryDate)) {
      d.deliveryDate = delivered
      d.invoiceNo = str(r.invoice_no)
      d.invoiceDate = isoDate(r.invoice_date)
    } else if (!d.invoiceNo) {
      d.invoiceNo = str(r.invoice_no)
      d.invoiceDate = isoDate(r.invoice_date)
    }
    // The sales row's outlet (dealer_code_2) is the showroom that sold it — better than a listing.
    d.outletDealer = str(r.dealer_code_2) ?? d.outletDealer ?? str(r.dealer_code)
    d.model = d.model ?? str(r.model)
    d.variant = d.variant ?? str(r.variant)
    d.bookingDate = d.bookingDate ?? isoDate(r.booking_date)
  }

  // Receipts arrive date-ordered, so the running total tells us the day payment crossed the line.
  for (const r of rows(receiptRows)) {
    const bookingNo = str(r.booking_no)
    const customerId = str(r.customer_id)
    if (!bookingNo || !customerId) continue
    const d = dms.get(`${bookingNo}|${customerId}`)
    if (!d) continue
    const before = d.received
    d.received += num(r.receipt_amount)
    d.receiptCount += 1
    const date = isoDate(r.receipt_date)
    d.lastReceiptDate = maxDate(d.lastReceiptDate, date)
    if (!d.paidCrossedOn && before <= DMS_PAID_THRESHOLD && d.received > DMS_PAID_THRESHOLD) d.paidCrossedOn = date
    // A reversal can drop it back under the line; the crossing date then belongs to the next crossing.
    if (d.paidCrossedOn && d.received <= DMS_PAID_THRESHOLD) d.paidCrossedOn = null
  }

  for (const d of dms.values()) {
    d.latestActivity = maxDate(d.bookingDate, d.deliveryDate, d.invoiceDate, d.lastReceiptDate, d.firstRetailSeen, d.firstInvoiceSeen, d.firstCancelSeen)
  }


  // ── Our bookings ────────────────────────────────────────────────────────────────────────────
  const ours: OurBookingInput[] = rows(ourRows).map((r) => {
    const status = String(r.status || '')
    return {
      id: String(r.id),
      bookingNumber: String(r.booking_number),
      status,
      heldFromStatus: str(r.held_from),
      dealerCode: str(r.dealer_code),
      customerName: String(r.customer_name || ''),
      phone: phone10(r.customer_phone),
      pan: panKey(r.pan),
      vin: vinKey(r.allocated_vin),
      dmsBookingNo: str(r.dms_no),
      model: str(r.model),
      variant: str(r.variant),
      bookingDate: isoDate(r.booking_date) ?? '1970-01-01',
      deliveredOn: isoDate(r.delivered_on),
      paymentProgressed: ['payment_confirmed', 'ready_delivery', 'delivered'].includes(status)
        || r.allocation_paid === true
        || num(r.amount_received) > DMS_PAID_THRESHOLD,
    }
  })

  return { ours, dms: [...dms.values()] }
}

/** Cheap fingerprint of every input: if it has not moved, the stored result is current. */
export async function readReconWatermark(): Promise<{ watermark: string; feeds: { dmsBookings: string | null; dmsSales: string | null; dmsReceipts: string | null } }> {
  const [r] = rows(await db.execute(sql`
    SELECT (SELECT max(uploaded_at) FROM kia_booking_report)::text AS b,
           (SELECT max(uploaded_at) FROM kia_sales_report)::text AS s,
           (SELECT max(uploaded_at) FROM kia_receipt_report)::text AS r,
           (SELECT max(updated_at) FROM kia_bookings)::text AS k,
           (SELECT max(updated_at) FROM kia_vehicle_allocations)::text AS a,
           (SELECT count(*) FROM kia_bookings)::text AS n`))
  return {
    watermark: [r?.b, r?.s, r?.r, r?.k, r?.a, r?.n].map((v) => v ?? '-').join('|'),
    feeds: { dmsBookings: str(r?.b), dmsSales: str(r?.s), dmsReceipts: str(r?.r) },
  }
}
