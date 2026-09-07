import 'dotenv/config'
import { brandHasFirstStage, firstStageShortLabel, firstStageLabel } from '../lib/approvals/first-stage-approver'
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'

function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) {
    console.error(`❌ FAILED: ${msg} (expected: ${expected}, got: ${actual})`)
    process.exit(1)
  } else {
    console.log(`✅ PASSED: ${msg}`)
  }
}

function runTests() {
  console.log('=== PLATINUM APPROVAL PIPELINE VERIFICATION ===\n')

  // 1. brandHasFirstStage checks
  assertEqual(brandHasFirstStage('platinum'), false, "Platinum has no first stage (bypasses GSM/VP)")
  assertEqual(brandHasFirstStage('PLATINUM'), false, "Case-insensitive Platinum has no first stage")
  assertEqual(brandHasFirstStage('kia'), true, "KIA has first stage")
  assertEqual(brandHasFirstStage('hyundai'), true, "Hyundai has first stage")
  assertEqual(brandHasFirstStage('mg'), true, "MG has first stage")

  // 2. First stage labels
  assertEqual(firstStageShortLabel('platinum'), 'EA', "Platinum first stage short label is EA")
  assertEqual(firstStageLabel('platinum'), 'EA Approval', "Platinum first stage full label is EA Approval")

  // 3. Platinum Active Stage Flow Progression
  // Stage 1: Fresh submission
  const platFresh = vendorPaymentActiveStage({
    brand: 'platinum',
    department: 'SALES',
    vpApproval: null,
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent'
  })
  assertEqual(platFresh, 'ea', "Fresh Platinum request sits at EA stage immediately upon submission")

  // Stage 2: EA Approved -> Moves to MD
  const platEaApproved = vendorPaymentActiveStage({
    brand: 'platinum',
    department: 'SERVICE',
    vpApproval: null,
    eaApproval: 'APPROVED',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent'
  })
  assertEqual(platEaApproved, 'md', "EA-approved Platinum request moves to MD stage")

  // Stage 3: MD Approved -> Moves to Accounts
  const platMdApproved = vendorPaymentActiveStage({
    brand: 'platinum',
    department: 'SALES',
    vpApproval: null,
    eaApproval: 'APPROVED',
    managementApproval: 'APPROVED',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'MDApproved'
  })
  assertEqual(platMdApproved, 'accounts', "MD-approved Platinum request moves to Accounts stage")

  // Stage 4: Accounts Approved / Paid -> Done
  const platAccountsApproved = vendorPaymentActiveStage({
    brand: 'platinum',
    department: 'SALES',
    vpApproval: null,
    eaApproval: 'APPROVED',
    managementApproval: 'APPROVED',
    accountApproval: 'APPROVED',
    paymentStatus: 'PAID',
    emailSendStatus: 'Paid'
  })
  assertEqual(platAccountsApproved, 'done', "Accounts-approved / Paid Platinum request is marked done")

  // 4. Verification that KIA still requires GSM/VP -> CEO -> EA -> MD -> Accounts
  const kiaFreshSales = vendorPaymentActiveStage({
    brand: 'kia',
    department: 'SALES',
    vpApproval: '',
    ceoApproval: '',
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent'
  })
  assertEqual(kiaFreshSales, 'sales_manager', "Fresh KIA request requires first stage (ED/GSM)")

  const kiaVpApproved = vendorPaymentActiveStage({
    brand: 'kia',
    department: 'SALES',
    vpApproval: 'APPROVED',
    ceoApproval: '',
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent'
  })
  assertEqual(kiaVpApproved, 'ceo', "KIA request with GSM approved moves to CEO")

  // 5. Verification that Hyundai requires GSM/VP -> EA -> MD -> Accounts (No CEO)
  const hyundaiVpApproved = vendorPaymentActiveStage({
    brand: 'hyundai',
    department: 'SALES',
    vpApproval: 'APPROVED',
    eaApproval: '',
    managementApproval: '',
    accountApproval: '',
    paymentStatus: null,
    emailSendStatus: 'Mail Sent'
  })
  assertEqual(hyundaiVpApproved, 'ea', "Hyundai request moves directly from GSM/VP to EA")

  console.log('\n🎉 ALL APPROVAL FLOW TESTS PASSED SUCCESSFULLY!')
}

runTests()
