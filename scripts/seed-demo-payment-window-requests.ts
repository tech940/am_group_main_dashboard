/**
 * Seeds DEMO extra-payment-time requests so the "Extra Time Requests" tab can be reviewed visually.
 *
 * ⚠️ These are real rows in kia_payment_window_requests, attached to REAL bookings and allocations —
 * the foreign keys leave no choice. Every reason is prefixed with the marker below so they are
 * unmistakable in the UI and trivially removable.
 *
 * ⚠️ APPROVING A DEMO ROW HAS REAL EFFECT. Approval writes kia_vehicle_allocations.expires_at /
 * payment_window_hours for that allocation. Only the first PENDING row below is attached to a live,
 * unpaid allocation; the other two are attached to paid/delivered ones and will refuse with a 409
 * (which is itself worth seeing). Do not approve the live one unless you actually mean to extend
 * that customer's window.
 *
 * Run:    npx tsx scripts/seed-demo-payment-window-requests.ts
 * Remove: npx tsx scripts/seed-demo-payment-window-requests.ts --clean
 */
import 'dotenv/config'
import postgres from 'postgres'

const MARKER = '[DEMO]'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  const clean = process.argv.includes('--clean')

  try {
    const removed = await sql`
      DELETE FROM kia_payment_window_requests
      WHERE reason LIKE ${MARKER + '%'} RETURNING id`
    console.log(`Removed ${removed.length} existing ${MARKER} row(s).`)
    if (clean) {
      const [{ n }] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM kia_payment_window_requests`
      console.log(`Done. ${n} request(s) remain (all real).`)
      return
    }

    // A requester with a plausible role, so the "Asked by" column reads sensibly.
    const [requester] = await sql<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM users
      WHERE is_active = true AND deleted_at IS NULL
        AND role IN ('idt', 'sales_executive', 'sales_manager')
      ORDER BY role LIMIT 1`
    if (!requester) throw new Error('No active sales user found to attribute the demo requests to.')

    // An MD to attribute the already-decided rows to.
    const [approver] = await sql<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM users
      WHERE is_active = true AND deleted_at IS NULL AND role = 'md'
      ORDER BY email LIMIT 1`

    // Candidates, best-first: a live unpaid allocation makes the most useful PENDING row because it
    // is genuinely reviewable and shows the competing-bookings panel.
    const candidates = await sql<{
      id: string; vin_number: string; booking_id: string; expires_at: Date | null
      allocation_status: string; paid: boolean; booking_status: string; customer_type: string | null
    }[]>`
      SELECT va.id, va.vin_number, va.booking_id, va.expires_at, va.allocation_status,
             (va.payment_confirmed_at IS NOT NULL) AS paid,
             kb.status AS booking_status, kb.metadata->>'customerType' AS customer_type
      FROM kia_vehicle_allocations va
      JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      WHERE va.released_at IS NULL
      ORDER BY
        (va.payment_confirmed_at IS NULL AND kb.status NOT IN ('delivered','cancelled')) DESC,
        va.allocated_at DESC
      LIMIT 5`
    if (candidates.length < 5) throw new Error(`Need 5 active allocations, found ${candidates.length}.`)

    const baseHours = (t: string | null) => (String(t ?? '').trim().toLowerCase() === 'csd' ? 120 : 72)
    const now = Date.now()
    const plan = [
      { i: 0, status: 'PENDING',  requested: 7,  approved: null, reason: 'Customer is awaiting a home-loan disbursal; bank confirmed it lands next week.', remarks: null },
      // 6d against a 3d standard. Asking for exactly the standard (3d) produced a meaningless
      // "3d → 3d" with nothing to approve — the UI now calls that out, but the demo should show a
      // real ask.
      { i: 1, status: 'PENDING',  requested: 6,  approved: null, reason: 'Customer travelling until Friday, cannot complete payment before then.', remarks: null },
      { i: 2, status: 'PENDING',  requested: 12, approved: null, reason: 'Corporate purchase — buyer\'s finance team needs two weeks for internal approval.', remarks: null },
      { i: 3, status: 'APPROVED', requested: 10, approved: 5,    reason: 'Exchange vehicle valuation pending, customer wants to settle both together.', remarks: 'Five days only — do not let this slip further.' },
      { i: 4, status: 'REJECTED', requested: 15, approved: null, reason: 'Customer asked for a fortnight to arrange funds.', remarks: 'Too long on a fast-moving variant. Standard window stands.' },
    ]

    for (const p of plan) {
      const c = candidates[p.i]
      const decidedAt = p.status === 'PENDING' ? null : new Date(now - (p.i + 1) * 36e5)
      // Mirrors the real approval rule: from decision time, floored at the existing deadline.
      const appliedExpiresAt = p.status === 'APPROVED' && p.approved
        ? new Date(Math.max(now + p.approved * 24 * 36e5, c.expires_at?.getTime() ?? 0))
        : null

      await sql`
        INSERT INTO kia_payment_window_requests (
          booking_id, allocation_id, vin_number, requested_days, base_hours, reason, status,
          approved_days, requested_by, requested_by_name, action_by, action_by_name, action_remarks,
          action_at, applied_expires_at, created_at
        ) VALUES (
          ${c.booking_id}, ${c.id}, ${c.vin_number}, ${p.requested}, ${baseHours(c.customer_type)},
          ${`${MARKER} ${p.reason}`}, ${p.status}, ${p.approved},
          ${requester.id}, ${requester.full_name},
          ${decidedAt ? approver?.id ?? null : null}, ${decidedAt ? approver?.full_name ?? 'MD' : null},
          ${p.remarks}, ${decidedAt}, ${appliedExpiresAt},
          ${new Date(now - (p.i + 1) * 72e5)}
        )`
      const note = p.status === 'PENDING'
        ? (c.paid || ['delivered', 'cancelled'].includes(c.booking_status) ? 'reviewable but will 409 (paid/closed)' : 'FULLY REVIEWABLE')
        : 'historical'
      console.log(`  ${p.status.padEnd(8)} ${p.requested}d  ${c.vin_number.slice(-8)}  ${note}`)
    }

    const [{ pending }] = await sql<{ pending: number }[]>`
      SELECT COUNT(*)::int AS pending FROM kia_payment_window_requests
      WHERE status = 'PENDING' AND action_at IS NULL`
    console.log(`\nSeeded ${plan.length} demo request(s). Tab badge should now read ${pending}.`)
    console.log(`Remove them with: npx tsx scripts/seed-demo-payment-window-requests.ts --clean`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((e) => { console.error('Seed failed:', e?.message || e); process.exit(1) })
