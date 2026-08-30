/**
 * The HR approval stage exists at KIA and nowhere else.
 *
 *   KIA          first stage → HR (payroll types only) → EA → MD → Accounts
 *   every other  first stage →                           EA → MD → Accounts
 *
 * ── The bug this guards ───────────────────────────────────────────────────────────────────────
 * `isHrApprovalRequired` matched on the approval TYPE alone and was blind to the brand, so a Hyundai
 * or Platinum "Incentive Disbursement" was routed to an HR desk those brands do not staff. Measured
 * before the change: PLATINUM_0004, Rs2,54,397, had cleared its first stage and was parked on an HR
 * stage nobody was ever going to clear.
 *
 * Removing a stage is only half the job. The other half is that nothing may be STRANDED at the stage
 * that no longer exists — neither by the server's stage inference nor by the screen reading a stale
 * `hr_approval` column directly. Both halves are asserted.
 *
 * Read-only. Run: npm run verify:hr-stage
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { brandHasHrStage, isHrApprovalRequired, HR_APPROVAL_KEYWORDS } from '../lib/kia/approval-hr-routing'
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

type Row = {
  request_no: string | null; brand: string; approval_type: string | null; amount: string
  vp: string | null; hr: string | null; ea: string | null; md: string | null; acc: string | null
}

const stageOf = (r: Row) => vendorPaymentActiveStage({
  vpApproval: r.vp, hrApproval: r.hr, eaApproval: r.ea,
  managementApproval: r.md, accountApproval: r.acc,
  approvalType: r.approval_type, brand: r.brand,
})

async function main() {
  console.log('1) The rule: HR is KIA-only')
  check(brandHasHrStage('kia'), 'kia has an HR stage')
  check(brandHasHrStage('KIA'), 'casing does not matter')
  /*
   * A blank brand is KIA. 122 rows pre-date the `brand` column and default to it everywhere else
   * against this table; treating blank as "no HR" would silently drop KIA's oldest payroll rows out
   * of the HR chain.
   */
  check(brandHasHrStage(''), 'a blank brand counts as KIA, matching the rest of this table')
  check(brandHasHrStage(null), 'null likewise')
  for (const b of ['hyundai', 'platinum', 'tata', 'honda', 'mg']) {
    check(!brandHasHrStage(b), `${b} has NO HR stage`)
  }

  console.log('\n2) Every payroll keyword still routes through HR at KIA — and at no other brand')
  for (const kw of HR_APPROVAL_KEYWORDS) {
    const type = `${kw} disbursement`
    const kia = isHrApprovalRequired(type, 'kia')
    const other = ['hyundai', 'platinum'].some((b) => isHrApprovalRequired(type, b))
    check(kia, `kia: "${type}" needs HR`)
    check(!other, `hyundai/platinum: "${type}" does NOT`)
  }
  // ...and a non-payroll type is still exempt at KIA, so the brand gate did not swallow the type rule.
  for (const type of ['Vendor Payment', 'Local Vendor', 'Stock Transfer', 'RTO']) {
    check(!isHrApprovalRequired(type, 'kia'), `kia: "${type}" does not need HR`)
  }

  const all = await analyticsExecute<Row>(sql`
    SELECT request_no, LOWER(COALESCE(brand,'kia')) AS brand, approval_type, amount::text,
           vp_approval AS vp, hr_approval AS hr, ea_approval AS ea,
           management_approval AS md, account_approval AS acc
    FROM kia_approval_requests`)
  const nonKia = all.filter((r) => r.brand !== 'kia')
  const kia = all.filter((r) => r.brand === 'kia')

  console.log(`\n3) Nothing outside KIA is parked at HR (${nonKia.length} non-KIA requests)`)
  const stuck = nonKia.filter((r) => stageOf(r) === 'hr')
  for (const r of stuck) {
    console.log(`      ${r.request_no} ${r.brand} ${r.approval_type} Rs${Number(r.amount).toLocaleString('en-IN')}`)
  }
  check(stuck.length === 0, 'no non-KIA request resolves to the HR stage')

  /*
   * The positive half. Asserting only "nothing is at HR" would pass if the stage resolver were
   * broken in some other way, so the rows that USED to be parked at HR must now be at EA
   * specifically — not at 'done', not back at the first stage.
   */
  console.log('\n4) The ones that were parked at HR are now at EA')
  const wasHrTyped = nonKia.filter((r) => {
    const t = String(r.approval_type || '').trim().toLowerCase().replace(/_/g, ' ')
    return HR_APPROVAL_KEYWORDS.some((k) => new RegExp(`(?:^|[^a-z0-9])${k}(?:[^a-z0-9]|$)`, 'i').test(t))
  })
  console.log(`   ${wasHrTyped.length} non-KIA requests carry a payroll approval type:`)
  for (const r of wasHrTyped) {
    console.log(`      ${String(r.request_no || '-').padEnd(14)} ${r.brand.padEnd(9)} ${String(r.approval_type || '-').padEnd(24)} Rs${Number(r.amount).toLocaleString('en-IN').padStart(11)}  now at: ${stageOf(r)}`)
  }
  const firstStageCleared = wasHrTyped.filter((r) => r.vp === 'APPROVED')
  for (const r of firstStageCleared) {
    const stage = stageOf(r)
    // A row whose EA has already signed legitimately sits further down the chain.
    const expected = r.ea === 'APPROVED' ? ['md', 'accounts', 'done'] : ['ea']
    check(expected.includes(stage), `${r.request_no} is at "${stage}" (expected ${expected.join('/')})`)
  }

  console.log('\n5) A stale hr_approval cannot strand a non-KIA row')
  /*
   * The screen reads `hr_approval` directly for its 'Held by HR' / 'Rejected by HR' labels, so a row
   * held before the stage was removed would otherwise display a blockage nobody can clear. Simulated
   * rather than waited for, because there are no such rows today and the risk window is the gap
   * between this deploy and the next HR action.
   */
  for (const held of ['HELD', 'NOT APPROVED']) {
    const simulated = { request_no: 'SIM', brand: 'platinum', approval_type: 'Incentive Disbursement',
      amount: '100', vp: 'APPROVED', hr: held, ea: '', md: '', acc: '' } as Row
    check(stageOf(simulated) === 'ea', `a platinum row with hr="${held}" resolves to EA, not HR`)
  }
  // The same simulation at KIA must still stop at HR, or the guard has swallowed the real rule.
  const kiaHeld = { request_no: 'SIM', brand: 'kia', approval_type: 'Incentive Disbursement',
    amount: '100', vp: 'APPROVED', hr: 'HELD', ea: '', md: '', acc: '' } as Row
  check(stageOf(kiaHeld) === 'hr', 'the same row at KIA still stops at HR — the stage is not dead')

  console.log('\n6) KIA is untouched')
  const kiaHr = kia.filter((r) => isHrApprovalRequired(r.approval_type, 'kia'))
  const kiaAtHr = kia.filter((r) => stageOf(r) === 'hr')
  console.log(`   ${kiaHr.length} of ${kia.length} KIA requests route through HR; ${kiaAtHr.length} are waiting on HR now`)
  check(kiaHr.length > 0, 'the HR stage still applies to real KIA requests')
  for (const r of kiaAtHr) {
    console.log(`      still on HR: ${r.request_no} ${r.approval_type} Rs${Number(r.amount).toLocaleString('en-IN')}`)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
