/**
 * The booking discount chain: GSM/SM → CEO → MD (over ₹5,000) → Accounts.
 *
 * ⚠️ SECTIONS 1 AND 4 WERE STALE until 2026-09-16 and had been failing. They were written for an
 * earlier SM → MD → Accounts chain; a CEO desk was inserted between the two and these assertions
 * were never updated, so six of them asserted a flow the code had stopped running. A verifier that
 * is permanently red teaches people to ignore it.
 *
 * ── What this guards ──────────────────────────────────────────────────────────────────────────
 * Every failure here is silent. A request that skips a stage still renders as a tidy row; a rejected
 * request that leaks into the MD's queue looks exactly like a live one. And the rule is shared by
 * the screen and the API, so if the two ever disagree a user gets a button that 403s — which has
 * already happened twice in this codebase's approval flows.
 *
 * Read-only. Run: npm run verify:discount-chain
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import {
  discountStage, canActOnDiscountStage, discountOverallStatus, canRequestDiscount,
  canRequestDiscountRole, canActOnDiscountRequest, isOwnDiscountRequest,
  isValidDiscountType, DISCOUNT_TYPES, DISCOUNT_STAGE_LABEL,
} from '../lib/kia/discount-chain'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

async function main() {
  console.log('1) The chain advances one desk at a time')
  /* Small: GSM/SM → CEO → Accounts.   Over ₹5,000: GSM/SM → CEO → MD → Accounts. */
  const small = 4000
  const large = 50000
  check(discountStage({}) === 'sales_manager', 'a new request waits on the GSM/SM')
  check(discountStage({ requestedAmount: small, smStatus: 'APPROVED' }) === 'ceo',
    'once the GSM/SM approves it goes to the CEO')
  check(discountStage({ requestedAmount: small, smStatus: 'APPROVED', ceoStatus: 'APPROVED' }) === 'accounts',
    'a small discount goes straight from the CEO to Accounts')
  // ⚠️ Over ₹5,000 the MD is inserted — the threshold is the whole reason that desk exists.
  check(discountStage({ requestedAmount: large, smStatus: 'APPROVED', ceoStatus: 'APPROVED' }) === 'md',
    'over ₹5,000 the CEO hands it to the MD')
  check(discountStage({ requestedAmount: large, smStatus: 'APPROVED', ceoStatus: 'APPROVED', mdStatus: 'APPROVED' }) === 'accounts',
    'once the MD approves it goes to Accounts')
  check(discountStage({ requestedAmount: small, smStatus: 'APPROVED', ceoStatus: 'APPROVED', payoutStatus: 'PAID' }) === 'done',
    'PAID finishes it')
  /*
   * NOT_PAID also finishes the chain. Accounts are recording a fact, so "we did not pay" is an
   * answer — leaving it at the Accounts desk for ever would hide it in a queue nobody clears.
   */
  check(discountStage({ requestedAmount: small, smStatus: 'APPROVED', ceoStatus: 'APPROVED', payoutStatus: 'NOT_PAID' }) === 'done',
    'NOT_PAID also finishes it — Accounts recorded an answer')

  console.log('\n2) A rejection stops the chain dead')
  check(discountStage({ smStatus: 'REJECTED' }) === 'rejected', 'the Sales Manager can end it')
  check(discountStage({ smStatus: 'APPROVED', ceoStatus: 'REJECTED' }) === 'rejected', 'so can the CEO')
  check(discountStage({ smStatus: 'APPROVED', ceoStatus: 'APPROVED', mdStatus: 'REJECTED' }) === 'rejected', 'so can the MD')
  // The one that matters: a refused request must never surface in the next desk's queue.
  check(discountStage({ smStatus: 'REJECTED', mdStatus: 'APPROVED' }) === 'rejected',
    'an SM rejection wins even if an MD approval was somehow written after it')

  console.log('\n3) Only the right desk can act')
  check(canActOnDiscountStage('sales_manager', 'sales_manager'), 'sales_manager clears stage 1')
  // Both roles staff this desk across branches — gating on one would strand the other's queue.
  check(canActOnDiscountStage('general_manager', 'sales_manager'), 'so does general_manager')
  check(!canActOnDiscountStage('sales_manager', 'md'), 'a sales manager is NOT the MD')
  check(canActOnDiscountStage('md', 'md'), 'md clears stage 2')
  check(!canActOnDiscountStage('md', 'accounts'), 'the MD does not confirm the payment — separation of duties')
  check(canActOnDiscountStage('accounts', 'accounts'), 'accounts confirm the payout')
  check(!canActOnDiscountStage('accounts', 'md'), 'accounts are not an approver')
  check(!canActOnDiscountStage('cre', 'sales_manager'), 'an unrelated role can act on nothing')
  for (const stage of ['done', 'rejected'] as const) {
    check(!canActOnDiscountStage('md', stage), `nobody acts on a ${stage} request`)
    check(!canActOnDiscountStage('developer', stage), `not even support on a ${stage} one`)
  }
  // Support access exists, and is deliberately not business authority.
  check(canActOnDiscountStage('developer', 'md'), 'developer can unblock a stuck request')

  console.log('\n4) The overall status never overstates')
  check(discountOverallStatus({}) === 'PENDING', 'a new request is PENDING')
  check(discountOverallStatus({ requestedAmount: small, smStatus: 'APPROVED' }) === 'PENDING',
    'one approval is not approval')
  check(discountOverallStatus({ requestedAmount: large, smStatus: 'APPROVED', ceoStatus: 'APPROVED' }) === 'PENDING',
    'a large discount is not approved until the MD has seen it')
  check(discountOverallStatus({ requestedAmount: small, smStatus: 'APPROVED', ceoStatus: 'APPROVED' }) === 'APPROVED',
    'a small discount is approved once the CEO says yes')
  /*
   * The distinction the business cares about: APPROVED means the last approver said yes, NOT that the
   * customer has the money. Collapsing the two would make "approved but unpaid" invisible.
   */
  check(discountOverallStatus({ requestedAmount: small, smStatus: 'APPROVED', ceoStatus: 'APPROVED', payoutStatus: 'NOT_PAID' }) === 'APPROVED',
    'approved-but-unpaid still reads APPROVED — the payout is reported separately')
  check(discountOverallStatus({ smStatus: 'REJECTED' }) === 'REJECTED', 'a rejection is a rejection')

  console.log('\n5) Any LIVE booking can be discounted — cancelled cannot')
  /*
   * ⚠️ THIS RULE CHANGED ON 2026-09-16 (owner decision). It used to be delivered-only, on the
   * original brief's reading that a discount before handover belongs in the proforma price. In
   * practice the negotiation that needs approval happens while the customer is still deciding, and
   * measured at the time: 69 of 223 bookings were delivered, so five in six could not ask.
   */
  for (const st of ['delivered', 'vehicle_allocated', 'proforma_generated', 'booking_created', 'repeated_booking']) {
    check(canRequestDiscount({ status: st }), `${st} qualifies`)
  }
  // ⚠️ There is no money to return on a sale that is not happening, and an approval chain running
  // against a dead booking wastes the CEO's time.
  check(!canRequestDiscount({ status: 'cancelled' }), 'cancelled does NOT')
  check(!canRequestDiscount({ status: 'delivered', deletedAt: new Date() }), 'a deleted booking never qualifies')
  check(!canRequestDiscount({ status: '' }), 'a booking with no status at all does not qualify')

  console.log('\n5b) Who may RAISE one — a control that did not exist before')
  /*
   * ⚠️ Until 2026-09-16 the POST route checked only that somebody was logged in, so ANY authenticated
   * employee could raise a discount against ANY booking in the company. The hidden button was the
   * only thing in the way, and a hidden button is not a control.
   */
  for (const role of ['sales_executive', 'sales_manager', 'general_manager', 'sales_head', 'md', 'admin', 'developer']) {
    check(canRequestDiscountRole(role), `${role} may raise one`)
  }
  for (const role of ['accounts', 'cre', 'hr', 'service_advisor', 'idt', 'ceo', '']) {
    check(!canRequestDiscountRole(role), `${role || '(blank)'} may not`)
  }

  console.log('\n5c) Nobody approves their own request')
  /*
   * ⚠️ LOAD-BEARING SINCE SM/GSM MAY RAISE ONE. They are also the FIRST approval stage, so without
   * this a Sales Manager could raise a discount and clear stage one of it in the same breath —
   * defeating a chain that exists to put a second pair of eyes on the money.
   */
  const raisedBySm = { requestedBy: 'user-sm', requestedAmount: 4000 }
  check(!canActOnDiscountRequest({ role: 'sales_manager', actorUserId: 'user-sm', row: raisedBySm }).allowed,
    'the SM who raised it cannot approve it')
  check(canActOnDiscountRequest({ role: 'sales_manager', actorUserId: 'user-other', row: raisedBySm }).allowed,
    'a different SM can')
  // Support roles are not exempt — they are the likeliest to try.
  check(!canActOnDiscountRequest({ role: 'developer', actorUserId: 'user-dev', row: { requestedBy: 'user-dev' } }).allowed,
    'not even support approves its own request')
  check(canActOnDiscountRequest({ role: 'developer', actorUserId: 'user-dev', row: raisedBySm }).allowed,
    'support can still unblock a request somebody ELSE raised')
  check(isOwnDiscountRequest({ requestedBy: 'u1' }, 'u1'), 'the same person is recognised')
  check(!isOwnDiscountRequest({ requestedBy: 'u1' }, 'u2'), 'a different person is not')
  // ⚠️ Two blanks must NOT count as a match, or every legacy row with no requester blocks everyone.
  check(!isOwnDiscountRequest({ requestedBy: null }, null), 'two blanks are not the same person')
  check(!isOwnDiscountRequest({ requestedBy: '' }, 'u1'), 'a blank requester blocks nobody')

  console.log('\n6) The discount type is checked, not trusted')
  check(isValidDiscountType('Cash discount'), 'a listed type passes')
  check(!isValidDiscountType('anything at all'), 'an unlisted one is refused')
  check(!isValidDiscountType(''), 'blank is refused')
  check(DISCOUNT_TYPES.length >= 5, `the list is real (${DISCOUNT_TYPES.length} types)`)

  console.log('\n7) Against the LIVE table')
  const rows = await analyticsExecute<{
    id: string; booking_number: string | null; customer_name: string | null; booking_status: string | null
    booking_id: string | null; dms_customer_id: string | null
    requested_amount: string; sm_status: string | null; md_status: string | null; payout_status: string | null
  }>(sql`
    SELECT d.id::text, d.requested_amount::text, d.sm_status, d.md_status, d.payout_status,
           b.booking_number, b.customer_name, b.status AS booking_status, d.booking_id::text, d.dms_customer_id
    FROM kia_booking_discounts d LEFT JOIN kia_bookings b ON b.id = d.booking_id
    ORDER BY d.created_at`)
  console.log(`   ${rows.length} discount request(s) on file:`)
  for (const r of rows) {
    const stage = discountStage({ smStatus: r.sm_status, mdStatus: r.md_status, payoutStatus: r.payout_status })
    console.log(`     ${String(r.booking_number ?? '-').padEnd(24)} ${String(r.customer_name ?? '-').slice(0, 18).padEnd(18)}`
      + ` Rs${Number(r.requested_amount).toLocaleString('en-IN').padStart(12)}  ${DISCOUNT_STAGE_LABEL[stage]}`)
  }
  /*
   * ⚠️ BOTH ASSERTIONS HERE WERE REPLACED ON 2026-09-16, because each had outlived what it was
   * checking and had started failing on correct data:
   *
   *   · "migration 0050 left every existing request at stage one" was a ONE-TIME post-migration
   *     check. Three of the four requests have since been approved by a real GSM and a real CEO, so
   *     it had quietly become an assertion that nobody ever uses the feature.
   *
   *   · "every request on file is against a delivered booking" asserted the delivered-only rule,
   *     which the owner dropped. It was ALREADY false when it was replaced: two of the four live
   *     requests sit on `proforma_generated` and `booking_created` bookings — evidence that the rule
   *     was out of step with how the desk actually works, not just inconvenient.
   *
   * What replaces them is what stays true: the chain cannot skip a desk, and no request may hang off
   * a booking that is cancelled or deleted.
   */
  const n = (v: unknown) => String(v ?? '').trim().toUpperCase()
  check(rows.every((r) => !n(r.md_status) || n(r.sm_status) === 'APPROVED'),
    'no request reached the MD without the GSM/SM approving it first')
  check(rows.every((r) => !n(r.payout_status) || n(r.sm_status) === 'APPROVED'),
    'nothing was paid out that the GSM/SM never approved')
  check(rows.every((r) => n(r.booking_status) !== 'CANCELLED'),
    'no request is attached to a cancelled booking')
  // A request may stand on a DMS customer with no booking here (migration kia-discounts/0001). What must
  // hold: one that names a booking finds it, and one without a booking names its DMS customer.
  check(rows.every((r) => (r.booking_id ? r.booking_status !== null : Boolean(r.dms_customer_id))),
    'every request points at a booking that exists, or at its DMS customer')

  const preDelivery = rows.filter((r) => r.booking_id && n(r.booking_status) !== 'DELIVERED').length
  console.log(`   ${preDelivery} of ${rows.length} request(s) are against a booking that is not yet delivered`
    + ' — allowed since 2026-09-16.')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
