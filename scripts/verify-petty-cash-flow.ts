/**
 * The petty cash approval chain, per brand.
 *
 *     KIA          submitted -> ED  -> EA -> MD -> Accounts
 *     every other  submitted ->        EA -> MD -> Accounts
 *
 * Removing the first stage outside KIA is only half the job: any request ALREADY sitting at that
 * stage would be stranded, because the roles that could clear it are no longer allowed to. This
 * asserts both halves — new requests open at the right stage, and none is stuck at a stage its
 * brand no longer has.
 *
 * Read-only. Run: npm run verify:petty-cash-flow
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import {
  pettyCashHasFirstStage, pettyCashInitialStatus, pettyCashInitialStage,
} from '../lib/petty-cash/constants'
import { canApprovePettyCashStage, canCreatePettyCashRequest } from '../lib/petty-cash/access'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

const BRANDS = ['kia', 'hyundai', 'platinum']
const FIRST_STAGE_ROLES = ['ed', 'general_manager', 'service_general_manager']

async function main() {
  console.log('1) A new request opens at the right stage for its brand')
  for (const b of BRANDS) {
    const has = pettyCashHasFirstStage(b)
    console.log(`   ${b.padEnd(9)} first stage: ${has ? 'ED' : 'none'} -> opens at ${pettyCashInitialStatus(b)} / ${pettyCashInitialStage(b)}`)
    if (b === 'kia') {
      check(has && pettyCashInitialStage(b) === 'ed_approval', 'KIA keeps its ED stage')
    } else {
      check(!has && pettyCashInitialStage(b) === 'ea_approval', `${b} opens directly at EA`)
    }
  }

  console.log('\n2) Nobody can approve a first stage their brand does not have')
  for (const b of BRANDS) {
    for (const role of FIRST_STAGE_ROLES) {
      for (const dept of ['Sales', 'Service']) {
        const allowed = canApprovePettyCashStage(role, 'ed_approval', { branchId: b, department: dept })
        if (b === 'kia') {
          // Only the ED fills KIA's first stage.
          check(allowed === (role === 'ed'), `kia/${dept}: ${role} ${role === 'ed' ? 'CAN' : 'cannot'} act on the first stage`)
        } else {
          check(!allowed, `${b}/${dept}: ${role} cannot act on a first stage that does not exist`)
        }
      }
    }
  }

  console.log('\n3) Both GSMs may still RAISE a petty cash request')
  for (const role of ['general_manager', 'service_general_manager']) {
    check(canCreatePettyCashRequest(role), `${role} can create a request`)
  }
  // …and the stages they SHOULD still be able to act on are untouched.
  check(!canApprovePettyCashStage('general_manager', 'ea_approval', { branchId: 'hyundai', department: 'Sales' }),
    'a GSM is still not an EA')

  console.log('\n4) Nothing is stranded at a stage its brand no longer has')
  const stranded = await analyticsExecute<{ branch_id: string; status: string; n: number }>(sql`
    SELECT branch_id, status, COUNT(*)::int AS n
    FROM petty_cash_requests
    WHERE deleted_at IS NULL
      AND branch_id <> 'kia'
      AND status IN ('submitted', 'ed_pending', 'ed_on_hold')
    GROUP BY 1, 2`)
  for (const r of stranded) console.log(`   ⚠️ ${r.branch_id} has ${r.n} request(s) at ${r.status}`)
  check(stranded.length === 0, 'no non-KIA request is waiting at the removed first stage')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
