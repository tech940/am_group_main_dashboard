/**
 * The Platinum approval chain, pinned.
 *
 * ── The rule, since the DGM stage was added ───────────────────────────────────────────────────
 *     Platinum SERVICE:  submitted → DGM → EA → MD → Accounts
 *     Platinum SALES:    submitted → EA → MD → Accounts        (no first stage)
 *
 * Platinum is the ONLY brand whose first stage depends on the track, so brandHasFirstStage() takes
 * the department. Every other brand answers on the brand alone, and those answers are asserted here
 * too — a change to the shared helper must not quietly re-route KIA or Hyundai.
 *
 * The DGM stage reuses `vp_approval`, the generic first-stage column that already holds an ED's,
 * GSM's or VP's sign-off depending on brand. That is why there is no dgm_approval field below.
 *
 * Run:  npx tsx scripts/verify-platinum-approval-flow.ts
 */
import 'dotenv/config'
import {
  brandHasFirstStage,
  firstStageShortLabel,
  firstStageLabel,
  firstStageApproverRoles,
  firstStageApproverRolesForTrack,
  canApproveFirstStage,
} from '../lib/approvals/first-stage-approver'
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'

let failures = 0

function assertEqual(actual: unknown, expected: unknown, msg: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    console.log(`  [PASS] ${msg}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const SERVICE = 'SERVICE'
const SALES = 'SALES'

function runTests() {
  console.log('\n=== PLATINUM APPROVAL CHAIN ===')

  console.log('\n1) Platinum SERVICE has a first stage; Platinum SALES does not:')
  assertEqual(brandHasFirstStage('platinum', SERVICE), true, 'Platinum service HAS a first stage')
  assertEqual(brandHasFirstStage('platinum', SALES), false, 'Platinum sales has NO first stage')
  assertEqual(brandHasFirstStage('PLATINUM', SERVICE), true, 'brand match is case-insensitive')
  /*
   * The fail-safe direction. A caller that cannot supply the department must not invent a stage —
   * it would park a Platinum SALES request on a desk with no business approving it.
   */
  assertEqual(brandHasFirstStage('platinum'), false, 'no department given → no first stage (fail-safe)')

  console.log('\n2) Every other brand is untouched by the change:')
  for (const brand of ['kia', 'hyundai', 'mg', 'tata']) {
    assertEqual(brandHasFirstStage(brand, SALES), true, `${brand} sales still has a first stage`)
    assertEqual(brandHasFirstStage(brand, SERVICE), true, `${brand} service still has a first stage`)
  }
  assertEqual(firstStageApproverRolesForTrack('kia', 'sales'), ['general_manager'], 'KIA sales → GM')
  assertEqual(firstStageApproverRolesForTrack('kia', 'service'), ['vp'], 'KIA service → VP')
  assertEqual(firstStageApproverRolesForTrack('hyundai', 'service'), ['vp'], 'Hyundai service → VP')

  console.log('\n3) The first stage at Platinum belongs to the DGM, and to nobody else:')
  assertEqual(firstStageApproverRoles('platinum', SERVICE), ['dgm'], 'Platinum service → dgm')
  assertEqual(firstStageApproverRoles('platinum', SALES), [], 'Platinum sales → no first-stage role')
  assertEqual(firstStageApproverRolesForTrack('platinum', 'service'), ['dgm'], 'by track: service → dgm')
  assertEqual(firstStageApproverRolesForTrack('platinum', 'sales'), [], 'by track: sales → none')
  assertEqual(firstStageApproverRolesForTrack('platinum', 'unknown'), [], 'by track: unknown → none')

  assertEqual(canApproveFirstStage('dgm', 'platinum', SERVICE), true, 'a DGM may approve Platinum service')
  assertEqual(canApproveFirstStage('dgm', 'platinum', SALES), false, 'a DGM may NOT approve Platinum sales')
  // The DGM is Platinum-only. Nothing about this change may give them a KIA or Hyundai desk.
  assertEqual(canApproveFirstStage('dgm', 'kia', SERVICE), false, 'a DGM may NOT approve KIA service')
  assertEqual(canApproveFirstStage('dgm', 'hyundai', SERVICE), false, 'a DGM may NOT approve Hyundai service')
  // And the old Platinum approvers must not have gained one.
  assertEqual(canApproveFirstStage('general_manager', 'platinum', SERVICE), false, 'a GM does not own Platinum service')
  assertEqual(canApproveFirstStage('vp', 'platinum', SERVICE), false, 'a VP does not own Platinum service')

  console.log('\n4) Labels — what the screen, the email and the printed voucher say:')
  assertEqual(firstStageShortLabel('platinum', SERVICE), 'DGM', 'Platinum service short label is DGM')
  assertEqual(firstStageLabel('platinum', SERVICE), 'DGM Approval', 'Platinum service full label is DGM Approval')
  assertEqual(firstStageShortLabel('platinum', SALES), 'EA', 'Platinum sales still reads EA')
  assertEqual(firstStageLabel('platinum', SALES), 'EA Approval', 'Platinum sales still reads EA Approval')

  console.log('\n5) The active stage resolves in the right order:')
  const base = {
    brand: 'platinum',
    vpApproval: null as string | null,
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent',
  }

  assertEqual(vendorPaymentActiveStage({ ...base, department: SERVICE }), 'sales_manager',
    'a fresh Platinum SERVICE request sits at the first stage (the DGM desk)')
  assertEqual(vendorPaymentActiveStage({ ...base, department: SALES }), 'ea',
    'a fresh Platinum SALES request still goes straight to EA')
  assertEqual(
    vendorPaymentActiveStage({ ...base, department: SERVICE, vpApproval: 'APPROVED' }), 'ea',
    'once the DGM approves, a SERVICE request moves to EA')
  assertEqual(
    vendorPaymentActiveStage({ ...base, department: SERVICE, vpApproval: 'APPROVED', eaApproval: 'APPROVED' }), 'md',
    'after EA it moves to MD')
  assertEqual(
    vendorPaymentActiveStage({
      ...base, department: SERVICE, vpApproval: 'APPROVED', eaApproval: 'APPROVED', managementApproval: 'APPROVED',
    }), 'accounts',
    'after MD it reaches Accounts')

  console.log(failures === 0
    ? `\n=== PLATINUM CHAIN OK ===\n`
    : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

runTests()
