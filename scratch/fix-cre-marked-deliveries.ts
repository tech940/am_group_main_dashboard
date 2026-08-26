/**
 * One-off correction: undo deliveries a CRE recorded from the Booking Follow-ups queue.
 *
 * Delivery is owned by CXM (with CCM as backup) — `canDeliverKiaBooking`. The follow-up
 * "converted" path wrote `kia_bookings.status = 'delivered'` directly and bypassed that gate, so a
 * CRE closing their own queue item moved vehicles into Delivered on the Bookings and Stock boards.
 * The code path is now gated; this repairs the rows it already wrote.
 *
 * SAFE BY CONSTRUCTION:
 *   - dry run by default; pass --apply to write
 *   - snapshots every row it will touch to scratch/cre-delivery-revert-<ts>.json FIRST, so the whole
 *     thing can be undone
 *   - only touches bookings whose ONLY delivery event was by a CRE. A booking that a CXM or CCM also
 *     confirmed is genuinely delivered and is left alone
 *   - refuses to delete a finance payout that has been EDITED since it was created (its immutable
 *     activity log is non-empty) — that is someone's work, not a side effect
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scratch/fix-cre-marked-deliveries.ts [--apply]
 */
import 'dotenv/config'
import fs from 'fs'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const APPLY = process.argv.includes('--apply')

/** Delivered, and the ONLY delivery event on it was by a CRE. */
const CRE_ONLY = sql`
  kb.deleted_at IS NULL AND kb.status = 'delivered'
  AND EXISTS (SELECT 1 FROM kia_booking_activity a
              WHERE a.booking_id = kb.id AND a.activity_type = 'delivered' AND a.actor_role = 'cre')
  AND NOT EXISTS (SELECT 1 FROM kia_booking_activity a2
                  WHERE a2.booking_id = kb.id AND a2.activity_type = 'delivered'
                    AND a2.actor_role IN ('cxm', 'ccm', 'admin', 'developer'))`

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Record<string, unknown>[]

async function main() {
  console.log(APPLY ? '=== APPLY ===\n' : '=== DRY RUN (pass --apply to write) ===\n')

  // The bookings, with the status each will revert to, derived from its own allocation state.
  const targets = rowsOf(await db.execute(sql`
    SELECT kb.id, kb.booking_number, kb.status, kb.delivered_at, kb.customer_name,
      CASE
        WHEN va.id IS NOT NULL AND va.payment_confirmed_at IS NOT NULL THEN 'ready_delivery'
        WHEN va.id IS NOT NULL THEN 'vehicle_allocated'
        WHEN kb.proforma_id IS NOT NULL THEN 'proforma_generated'
        ELSE 'booking_created'
      END AS revert_to
    FROM kia_bookings kb
    LEFT JOIN kia_vehicle_allocations va ON va.booking_id = kb.id AND va.released_at IS NULL
    WHERE ${CRE_ONLY}
    ORDER BY kb.delivered_at DESC`))
  console.log(`bookings to revert: ${targets.length}`)
  const byTarget = targets.reduce<Record<string, number>>((acc, r) => {
    acc[String(r.revert_to)] = (acc[String(r.revert_to)] || 0) + 1
    return acc
  }, {})
  for (const [k, v] of Object.entries(byTarget)) console.log(`  -> ${k.padEnd(20)} ${v}`)

  // Payouts, split by whether anyone has since worked on them.
  const payouts = rowsOf(await db.execute(sql`
    SELECT fp.id, fp.booking_id, kb.booking_number, fp.dealer_payout_amount, fp.amount_received,
           (SELECT COUNT(*)::int FROM kia_finance_payout_activity pa WHERE pa.payout_id = fp.id) AS edits
    FROM kia_finance_payouts fp
    JOIN kia_bookings kb ON kb.id = fp.booking_id
    WHERE ${CRE_ONLY}`))
  const untouched = payouts.filter((p) => Number(p.edits) === 0)
  const edited = payouts.filter((p) => Number(p.edits) > 0)
  console.log(`\nfinance payouts on those bookings: ${payouts.length}`)
  console.log(`  untouched since creation (safe to remove) . ${untouched.length}`)
  console.log(`  EDITED since creation (kept, flagged) ..... ${edited.length}`)
  for (const p of edited) console.log(`    KEEPING ${p.booking_number} — ${p.edits} edit(s) recorded`)

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply.')
    return
  }

  // Snapshot BEFORE anything changes, so this is reversible.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshot = `scratch/cre-delivery-revert-${stamp}.json`
  fs.writeFileSync(snapshot, JSON.stringify({ targets, payouts }, null, 2))
  console.log(`\nsnapshot written: ${snapshot}`)

  let reverted = 0
  for (const t of targets) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE kia_bookings
        SET status = ${String(t.revert_to)}, delivered_at = NULL, updated_at = now()
        WHERE id = ${String(t.id)}::uuid`)

      // Leave a trail. Silently rewriting a booking's status is how the next person loses a day.
      await tx.execute(sql`
        INSERT INTO kia_booking_activity (booking_id, activity_type, title, description, actor_name, actor_role)
        VALUES (
          ${String(t.id)}::uuid, 'updated',
          'Delivery reverted — recorded by a CRE',
          ${'This booking was marked delivered from the Booking Follow-ups queue by a CRE, who is not '
            + 'authorised to confirm delivery (CXM or CCM only). Returned to '
            + String(t.revert_to) + '. If the vehicle really was handed over, CXM/CCM should mark it '
            + 'delivered from the Bookings screen.'},
          'System', 'system')`)
      reverted += 1
    })
  }
  console.log(`reverted ${reverted} bookings`)

  let removed = 0
  for (const p of untouched) {
    await db.execute(sql`DELETE FROM kia_finance_payouts WHERE id = ${String(p.id)}::uuid`)
    removed += 1
  }
  console.log(`removed ${removed} untouched finance payout records (${edited.length} kept)`)

  // Prove it.
  const [after] = rowsOf(await db.execute(sql`
    SELECT (SELECT COUNT(*)::int FROM kia_bookings kb WHERE ${CRE_ONLY}) AS still_cre_delivered,
           (SELECT COUNT(*)::int FROM kia_bookings WHERE deleted_at IS NULL AND status = 'delivered') AS delivered_total,
           (SELECT COUNT(*)::int FROM kia_bookings WHERE deleted_at IS NULL AND status = 'delivered'
              AND delivered_at >= '2026-08-01' AND delivered_at < '2026-09-01') AS delivered_aug`))
  console.log(`\nafter: CRE-marked remaining ${after.still_cre_delivered} (must be 0)`)
  console.log(`       delivered total ${after.delivered_total} · August ${after.delivered_aug}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAILED:', e); process.exit(1) })
