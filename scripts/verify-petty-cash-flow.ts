/**
 * The petty cash approval chain, per brand.
 *
 *     KIA          submitted -> CEO -> EA -> MD -> Accounts
 *     every other  submitted ->        EA -> MD -> Accounts
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

async function main() {
  console.log('1) A new request opens at the right stage for its brand')
  for (const b of BRANDS) {
    const has = pettyCashHasFirstStage(b)
    console.log(`   ${b.padEnd(9)} first stage: ${has ? 'CEO' : 'none'} -> opens at ${pettyCashInitialStatus(b)} / ${pettyCashInitialStage(b)}`)
    if (b === 'kia') {
      check(has && (pettyCashInitialStage(b) === 'ceo_approval' || pettyCashInitialStage(b) === 'ed_approval') && (pettyCashInitialStatus(b) === 'ceo_pending' || pettyCashInitialStatus(b) === 'ed_pending'), 'KIA opens at CEO stage')
    } else {
      check(!has && pettyCashInitialStage(b) === 'ea_approval' && pettyCashInitialStatus(b) === 'ea_pending', `${b} opens directly at EA`)
    }
  }

  console.log('\n2) CEO Approval stage permissions (KIA only)')
  for (const b of BRANDS) {
    for (const role of ['ceo', 'ed', 'general_manager', 'service_general_manager', 'ea', 'md']) {
      const allowed = canApprovePettyCashStage(role, 'ceo_approval', { branchId: b })
      if (b === 'kia') {
        const isCeo = role === 'ceo' || role === 'ed'
        check(allowed === isCeo, `kia: ${role} ${isCeo ? 'CAN' : 'cannot'} approve CEO stage`)
      } else {
        check(!allowed, `${b}: ${role} cannot approve CEO stage`)
      }
    }
  }

  console.log('\n3) GSMs cannot approve petty cash stage')
  for (const b of BRANDS) {
    for (const role of ['general_manager', 'service_general_manager']) {
      const allowedGsm = canApprovePettyCashStage(role, 'gsm_approval', { branchId: b })
      const allowedCeo = canApprovePettyCashStage(role, 'ceo_approval', { branchId: b })
      check(!allowedGsm && !allowedCeo, `${b}: ${role} cannot approve petty cash stages`)
    }
  }

  console.log('\n4) Both GSMs may still RAISE a petty cash request')
  for (const role of ['general_manager', 'service_general_manager']) {
    check(canCreatePettyCashRequest(role), `${role} can create a request`)
  }

  console.log('\n5) Nothing is stranded at a stage its brand no longer has')
  const stranded = await analyticsExecute<{ branch_id: string; status: string; n: number }>(sql`
    SELECT branch_id, status, COUNT(*)::int AS n
    FROM petty_cash_requests
    WHERE deleted_at IS NULL
      AND (
        (branch_id <> 'kia' AND status IN ('submitted', 'gsm_pending', 'gsm_on_hold', 'ceo_pending', 'ceo_on_hold', 'ed_pending', 'ed_on_hold'))
        OR status IN ('gsm_pending', 'gsm_on_hold')
      )
    GROUP BY 1, 2`)
  for (const r of stranded) console.log(`   ⚠️ ${r.branch_id} has ${r.n} request(s) at ${r.status}`)
  check(stranded.length === 0, 'no request is waiting at invalid or removed stages')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
