/**
 * The post-delivery discount chain: Sales Manager → MD → Accounts.
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
  isValidDiscountType, DISCOUNT_TYPES, DISCOUNT_STAGE_LABEL,
} from '../lib/kia/discount-chain'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

async function main() {
  console.log('1) The chain advances one desk at a time')
  check(discountStage({}) === 'sales_manager', 'a new request waits on the Sales Manager')
  check(discountStage({ smStatus: 'APPROVED' }) === 'md', 'once SM approves it goes to the MD')
  check(discountStage({ smStatus: 'APPROVED', mdStatus: 'APPROVED' }) === 'accounts', 'once MD approves it goes to Accounts')
  check(discountStage({ smStatus: 'APPROVED', mdStatus: 'APPROVED', payoutStatus: 'PAID' }) === 'done', 'PAID finishes it')
  /*
   * NOT_PAID also finishes the chain. Accounts are recording a fact, so "we did not pay" is an
   * answer — leaving it at the Accounts desk for ever would hide it in a queue nobody clears.
   */
  check(discountStage({ smStatus: 'APPROVED', mdStatus: 'APPROVED', payoutStatus: 'NOT_PAID' }) === 'done',
    'NOT_PAID also finishes it — Accounts recorded an answer')

  console.log('\n2) A rejection stops the chain dead')
  check(discountStage({ smStatus: 'REJECTED' }) === 'rejected', 'the Sales Manager can end it')
  check(discountStage({ smStatus: 'APPROVED', mdStatus: 'REJECTED' }) === 'rejected', 'so can the MD')
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
  check(discountOverallStatus({ smStatus: 'APPROVED' }) === 'PENDING', 'one approval is not approval')
  check(discountOverallStatus({ smStatus: 'APPROVED', mdStatus: 'APPROVED' }) === 'APPROVED', 'MD approval is approval')
  /*
   * The distinction the business cares about: APPROVED means the MD said yes, NOT that the customer
   * has the money. Collapsing the two would make "approved but unpaid" invisible.
   */
  check(discountOverallStatus({ smStatus: 'APPROVED', mdStatus: 'APPROVED', payoutStatus: 'NOT_PAID' }) === 'APPROVED',
    'approved-but-unpaid still reads APPROVED — the payout is reported separately')
  check(discountOverallStatus({ smStatus: 'REJECTED' }) === 'REJECTED', 'a rejection is a rejection')

  console.log('\n5) Only a DELIVERED booking can be discounted')
  check(canRequestDiscount({ status: 'delivered' }), 'delivered qualifies')
  for (const st of ['ready_delivery', 'vehicle_allocated', 'proforma_generated', 'cancelled', 'draft']) {
    check(!canRequestDiscount({ status: st }), `${st} does not`)
  }
  check(!canRequestDiscount({ status: 'delivered', deletedAt: new Date() }), 'a deleted booking never qualifies')

  console.log('\n6) The discount type is checked, not trusted')
  check(isValidDiscountType('Cash discount'), 'a listed type passes')
  check(!isValidDiscountType('anything at all'), 'an unlisted one is refused')
  check(!isValidDiscountType(''), 'blank is refused')
  check(DISCOUNT_TYPES.length >= 5, `the list is real (${DISCOUNT_TYPES.length} types)`)

  console.log('\n7) Against the LIVE table')
  const rows = await analyticsExecute<{
    id: string; booking_number: string | null; customer_name: string | null; booking_status: string | null
    requested_amount: string; sm_status: string | null; md_status: string | null; payout_status: string | null
  }>(sql`
    SELECT d.id::text, d.requested_amount::text, d.sm_status, d.md_status, d.payout_status,
           b.booking_number, b.customer_name, b.status AS booking_status
    FROM kia_booking_discounts d LEFT JOIN kia_bookings b ON b.id = d.booking_id
    ORDER BY d.created_at`)
  console.log(`   ${rows.length} discount request(s) on file:`)
  for (const r of rows) {
    const stage = discountStage({ smStatus: r.sm_status, mdStatus: r.md_status, payoutStatus: r.payout_status })
    console.log(`     ${String(r.booking_number ?? '-').padEnd(24)} ${String(r.customer_name ?? '-').slice(0, 18).padEnd(18)}`
      + ` Rs${Number(r.requested_amount).toLocaleString('en-IN').padStart(12)}  ${DISCOUNT_STAGE_LABEL[stage]}`)
  }
  /*
   * The migration must not have advanced anybody. Both pre-existing requests were awaiting their
   * first approval and must still be — a default on a new stage column would have silently pushed
   * them past a desk no human touched.
   */
  check(rows.every((r) => !r.sm_status && !r.md_status && !r.payout_status),
    'migration 0050 left every existing request at stage one')
  check(rows.every((r) => String(r.booking_status).toLowerCase() === 'delivered'),
    'every request on file is against a delivered booking')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
