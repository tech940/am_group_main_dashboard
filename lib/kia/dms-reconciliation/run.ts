import 'server-only'

/**
 * Rebuilds kia_dms_recon_items from the live feeds. Called three ways, all through this function:
 *   - the KIA maintenance cron (only when an input moved — see readReconWatermark)
 *   - a page read that finds the stored result stale (in after(), never blocking the response)
 *   - the Re-check button (synchronous)
 *
 * Never changes a booking. The owner's rule: detect and flag; people decide.
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { reconcile, type ReconItem } from './engine'
import { loadReconInputs, readReconWatermark } from './load'

type Row = Record<string, unknown>
const rows = (result: unknown): Row[] => (Array.isArray(result) ? result as Row[] : ((result as { rows?: Row[] })?.rows ?? []))

export type ReconRunResult =
  | { ran: true; ms: number; items: number; opened: number; resolved: number; stats: ReturnType<typeof reconcile>['stats'] }
  | { ran: false; reason: 'fresh' | 'running' }

/** A run left half-way by a killed lambda must not block the next one forever. */
const STALE_LOCK_MINUTES = 5

export async function runKiaDmsReconciliation(options: { onlyIfStale?: boolean } = {}): Promise<ReconRunResult> {
  const { watermark } = await readReconWatermark()
  if (options.onlyIfStale) {
    const [state] = rows(await db.execute(sql`SELECT watermark FROM kia_dms_recon_state WHERE id = 1`))
    if (state?.watermark === watermark) return { ran: false, reason: 'fresh' }
  }

  // Claim the run. One UPDATE is the lock: it succeeds for exactly one caller at a time.
  const claimed = rows(await db.execute(sql`
    UPDATE kia_dms_recon_state SET running_since = now()
    WHERE id = 1 AND (running_since IS NULL OR running_since < now() - make_interval(mins => ${STALE_LOCK_MINUTES}::int))
    RETURNING id`))
  if (!claimed.length) return { ran: false, reason: 'running' }

  const started = Date.now()
  try {
    const { ours, dms } = await loadReconInputs()
    const { items, stats } = reconcile(ours, dms)
    const payload = items.map(toRecord)
    const keys = items.map((i) => i.itemKey)

    const outcome = await db.transaction(async (tx) => {
      const upserted = rows(await tx.execute(sql`
        INSERT INTO kia_dms_recon_items (
          item_key, kind, exception_type, severity, state, booking_id, booking_number, our_status, our_stage,
          dms_booking_no, dms_customer_id, dms_dealer, dms_status, vin, invoice_no, invoice_date, delivery_date,
          dms_received, dms_receipt_count, last_receipt_date, paid_crossed_on, match_tier, match_label, match_note,
          candidates, event_date, booking_date, headline, customer_name, dealer_code, model, variant, first_seen_at, last_seen_at, resolved_at
        )
        SELECT x.item_key, x.kind, x.exception_type, x.severity, 'open', x.booking_id, x.booking_number, x.our_status, x.our_stage,
               x.dms_booking_no, x.dms_customer_id, x.dms_dealer, x.dms_status, x.vin, x.invoice_no, x.invoice_date, x.delivery_date,
               x.dms_received, x.dms_receipt_count, x.last_receipt_date, x.paid_crossed_on, x.match_tier, x.match_label, x.match_note,
               COALESCE(x.candidates, '[]'::jsonb), x.event_date, x.booking_date, x.headline, x.customer_name, x.dealer_code, x.model, x.variant, now(), now(), NULL
        FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(
          item_key text, kind text, exception_type text, severity text, booking_id uuid, booking_number text, our_status text, our_stage text,
          dms_booking_no text, dms_customer_id text, dms_dealer text, dms_status text, vin text, invoice_no text, invoice_date date,
          delivery_date date, dms_received numeric, dms_receipt_count integer, last_receipt_date date, paid_crossed_on date,
          match_tier smallint, match_label text, match_note text, candidates jsonb, event_date date, booking_date date, headline text,
          customer_name text, dealer_code text, model text, variant text
        )
        ON CONFLICT (item_key) DO UPDATE SET
          kind = EXCLUDED.kind, exception_type = EXCLUDED.exception_type, severity = EXCLUDED.severity,
          booking_id = EXCLUDED.booking_id, booking_number = EXCLUDED.booking_number, our_status = EXCLUDED.our_status,
          our_stage = EXCLUDED.our_stage, dms_booking_no = EXCLUDED.dms_booking_no, dms_customer_id = EXCLUDED.dms_customer_id,
          dms_dealer = EXCLUDED.dms_dealer, dms_status = EXCLUDED.dms_status, vin = EXCLUDED.vin, invoice_no = EXCLUDED.invoice_no,
          invoice_date = EXCLUDED.invoice_date, delivery_date = EXCLUDED.delivery_date, dms_received = EXCLUDED.dms_received,
          dms_receipt_count = EXCLUDED.dms_receipt_count, last_receipt_date = EXCLUDED.last_receipt_date,
          paid_crossed_on = EXCLUDED.paid_crossed_on, match_tier = EXCLUDED.match_tier, match_label = EXCLUDED.match_label,
          match_note = EXCLUDED.match_note, candidates = EXCLUDED.candidates, event_date = EXCLUDED.event_date,
          booking_date = EXCLUDED.booking_date,
          headline = EXCLUDED.headline, customer_name = EXCLUDED.customer_name, dealer_code = EXCLUDED.dealer_code,
          model = EXCLUDED.model, variant = EXCLUDED.variant, last_seen_at = now(),
          -- A recurrence after it was fixed is a new occurrence: its age starts again.
          first_seen_at = CASE WHEN kia_dms_recon_items.state = 'resolved' THEN now() ELSE kia_dms_recon_items.first_seen_at END,
          state = 'open', resolved_at = NULL
        RETURNING (xmax = 0) AS inserted`))
      const resolved = rows(await tx.execute(sql`
        UPDATE kia_dms_recon_items SET state = 'resolved', resolved_at = now()
        WHERE state = 'open'
          AND item_key NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
        RETURNING id`)).length
      await tx.execute(sql`
        UPDATE kia_dms_recon_state
        SET watermark = ${watermark}, last_run_at = now(), last_run_ms = ${Date.now() - started}::int,
            stats = ${JSON.stringify(stats)}::jsonb, last_error = NULL, running_since = NULL
        WHERE id = 1`)
      return { opened: upserted.filter((r) => r.inserted === true).length, resolved }
    })
    return { ran: true, ms: Date.now() - started, items: items.length, ...outcome, stats }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.execute(sql`UPDATE kia_dms_recon_state SET running_since = NULL, last_error = ${message.slice(0, 500)} WHERE id = 1`).catch(() => {})
    throw error
  }
}

function toRecord(i: ReconItem) {
  const d = i.dms
  return {
    item_key: i.itemKey,
    kind: i.kind,
    exception_type: i.type,
    severity: i.severity,
    booking_id: i.bookingId,
    booking_number: i.bookingNumber,
    our_status: i.ourStatus,
    our_stage: i.ourStage,
    dms_booking_no: d?.bookingNo ?? null,
    dms_customer_id: d?.customerId ?? null,
    dms_dealer: d?.outletDealer ?? null,
    dms_status: d?.status ?? null,
    vin: d?.vins[0] ?? null,
    invoice_no: d?.invoiceNo ?? null,
    invoice_date: d?.invoiceDate ?? null,
    delivery_date: d?.deliveryDate ?? null,
    dms_received: d ? Math.round(d.received * 100) / 100 : null,
    dms_receipt_count: d?.receiptCount ?? null,
    last_receipt_date: d?.lastReceiptDate ?? null,
    paid_crossed_on: d?.paidCrossedOn ?? null,
    match_tier: i.matchTier,
    match_label: i.matchLabel,
    match_note: i.matchNote,
    candidates: i.candidates,
    event_date: i.eventDate,
    booking_date: i.bookingDate,
    headline: i.headline,
    customer_name: i.customerName,
    dealer_code: i.dealerCode,
    model: i.model,
    variant: i.variant,
  }
}
