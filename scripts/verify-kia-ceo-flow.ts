/**
 * Comprehensive verification suite for the new KIA approval flow:
 *   Stage 1: GSM (Sales) / VP (Service)
 *   Stage 2: CEO (for BOTH Sales and Service)
 *   Stage 3: EA (and HR if applicable)
 *   Stage 4: MD
 *   Stage 5: Accounts
 *
 * Asserts:
 * - Active stage resolution (vendorPaymentActiveStage)
 * - First stage approvers and labels (lib/approvals/first-stage-approver)
 * - Stage labels and UI workflow stepper logic
 * - Non-KIA brands (Hyundai, Platinum) maintain their 4-stage flow without CEO
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-kia-ceo-flow.ts
 */
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'
import {
  firstStageApproverRoles,
  firstStageLabel,
  firstStageShortLabel,
  canApproveFirstStage,
} from '../lib/approvals/first-stage-approver'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

console.log('--- 1) KIA STAGE 1: GSM FOR SALES, VP FOR SERVICE ---')
// Sales
check(JSON.stringify(firstStageApproverRoles('kia', 'Sales')) === JSON.stringify(['general_manager']),
  'KIA Sales Stage 1 approver is general_manager (GSM)')
check(firstStageLabel('kia', 'Sales') === 'GSM Approval (Sales)',
  'KIA Sales Stage 1 label is "GSM Approval (Sales)"')
check(firstStageShortLabel('kia', 'Sales') === 'GSM',
  'KIA Sales Stage 1 short label is "GSM"')
check(canApproveFirstStage('general_manager', 'kia', 'Sales'),
  'GSM can approve KIA Sales Stage 1')
check(!canApproveFirstStage('vp', 'kia', 'Sales'),
  'VP cannot approve KIA Sales Stage 1')
check(!canApproveFirstStage('ceo', 'kia', 'Sales'),
  'CEO cannot approve KIA Sales Stage 1')

// Service
check(JSON.stringify(firstStageApproverRoles('kia', 'Service')) === JSON.stringify(['vp']),
  'KIA Service Stage 1 approver is vp')
check(firstStageLabel('kia', 'Service') === 'VP Approval',
  'KIA Service Stage 1 label is "VP Approval"')
check(firstStageShortLabel('kia', 'Service') === 'VP',
  'KIA Service Stage 1 short label is "VP"')
check(canApproveFirstStage('vp', 'kia', 'Service'),
  'VP can approve KIA Service Stage 1')
check(!canApproveFirstStage('general_manager', 'kia', 'Service'),
  'GSM cannot approve KIA Service Stage 1')
check(!canApproveFirstStage('ceo', 'kia', 'Service'),
  'CEO cannot approve KIA Service Stage 1')

console.log('\n--- 2) KIA STAGE RESOLUTION PROGRESSION (vendorPaymentActiveStage) ---')

// 1. Fresh request -> Stage 1 ('sales_manager')
const freshKiaSales = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: '',
  ceoApproval: '',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(freshKiaSales === 'sales_manager', 'Fresh KIA Sales request sits at sales_manager (Stage 1 GSM)')

const freshKiaService = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Service',
  approvalType: 'Parts Purchase',
  vpApproval: '',
  ceoApproval: '',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(freshKiaService === 'sales_manager', 'Fresh KIA Service request sits at sales_manager (Stage 1 VP)')

// 2. Stage 1 Approved -> Stage 2 ('ceo') for BOTH Sales and Service
const stage1ApprovedSales = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: '',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(stage1ApprovedSales === 'ceo', 'KIA Sales with vp_approval=APPROVED sits at ceo (Stage 2)')

const stage1ApprovedService = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Service',
  approvalType: 'Parts Purchase',
  vpApproval: 'APPROVED',
  ceoApproval: '',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(stage1ApprovedService === 'ceo', 'KIA Service with vp_approval=APPROVED sits at ceo (Stage 2)')

// 3. Stage 2 CEO Approved -> Stage 3 ('ea')
const stage2Approved = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'APPROVED',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(stage2Approved === 'ea', 'KIA with ceo_approval=APPROVED sits at ea (Stage 3)')

// 4. Stage 3 EA Approved -> Stage 4 ('md')
const stage3Approved = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'APPROVED',
  eaApproval: 'APPROVED',
  managementApproval: '',
  accountApproval: '',
})
check(stage3Approved === 'md', 'KIA with ea_approval=APPROVED sits at md (Stage 4)')

// 5. Stage 4 MD Approved -> Stage 5 ('accounts')
const stage4Approved = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'APPROVED',
  eaApproval: 'APPROVED',
  managementApproval: 'APPROVED',
  accountApproval: '',
})
check(stage4Approved === 'accounts', 'KIA with management_approval=APPROVED sits at accounts (Stage 5)')

// 6. Stage 5 Accounts Approved -> 'done'
const stage5Approved = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'APPROVED',
  eaApproval: 'APPROVED',
  managementApproval: 'APPROVED',
  accountApproval: 'APPROVED',
})
check(stage5Approved === 'done', 'KIA with account_approval=APPROVED is done')

console.log('\n--- 3) KIA HELD / NOT APPROVED AT CEO STAGE ---')
const heldByCeo = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'HELD',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(heldByCeo === 'ceo', 'KIA with ceo_approval=HELD sits at ceo')

const notApprovedByCeo = vendorPaymentActiveStage({
  brand: 'kia',
  department: 'Sales',
  approvalType: 'Cash',
  vpApproval: 'APPROVED',
  ceoApproval: 'NOT APPROVED',
  eaApproval: '',
  managementApproval: '',
  accountApproval: '',
})
check(notApprovedByCeo === 'ceo', 'KIA with ceo_approval=NOT APPROVED sits at ceo')

console.log('\n--- 4) NON-KIA BRANDS MUST NOT HAVE CEO STAGE ---')
for (const otherBrand of ['hyundai', 'platinum', 'mg', 'tata']) {
  const otherFresh = vendorPaymentActiveStage({
    brand: otherBrand,
    department: 'Sales',
    approvalType: 'Cash',
    vpApproval: 'APPROVED',
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
  })
  check(otherFresh === 'ea', `${otherBrand} moves directly from Stage 1 (vp_approval=APPROVED) to Stage 2 (EA), skipping CEO`)
}

console.log(failures === 0 ? '\n=== ALL KIA CEO FLOW CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
