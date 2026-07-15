/**
 * Asserts the KIA workflow role gates.
 *
 * These predicates are the ONLY thing restricting delivery and allotment. A `kia.*` permission
 * cannot do it — applyBrandDefault() grants every non-restricted kia.* key to every KIA user whose
 * role isn't template-only, so requirePermission('kia.bookings.edit') excludes nobody. That makes
 * lib/kia/workflow-access.ts the whole security boundary, and it had no test coverage.
 *
 * Run:  npm run verify:kia-workflow-access
 */
import {
  canAllotKiaVehicle,
  canAllotKiaVehicleToBooking,
  canDeliverKiaBooking,
  canVerifyKiaAccounts,
} from '../lib/kia/workflow-access'

type Check = { label: string; got: boolean; want: boolean }

const CHECKS: Check[] = [
  // Delivery — CRM exclusive (+ super admins).
  { label: 'CRM CAN deliver', got: canDeliverKiaBooking('crm'), want: true },
  { label: 'developer CAN deliver (super-admin override)', got: canDeliverKiaBooking('developer'), want: true },
  { label: 'admin CAN deliver (super-admin override)', got: canDeliverKiaBooking('admin'), want: true },
  { label: 'sales_executive CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('sales_executive'), want: false },
  { label: 'sales_manager CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('sales_manager'), want: false },
  { label: 'general_manager CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('general_manager'), want: false },
  { label: 'md CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('md'), want: false },
  { label: 'idt CANNOT deliver', got: canDeliverKiaBooking('idt'), want: false },
  { label: 'accounts CANNOT deliver', got: canDeliverKiaBooking('accounts'), want: false },

  // Allotment to a booking — IDT exclusive (+ super admins).
  { label: 'IDT CAN allot to a booking', got: canAllotKiaVehicleToBooking('idt'), want: true },
  { label: 'developer CAN allot (super-admin override)', got: canAllotKiaVehicleToBooking('developer'), want: true },
  { label: 'sales_manager CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('sales_manager'), want: false },
  { label: 'general_manager CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('general_manager'), want: false },
  { label: 'accounts CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('accounts'), want: false },
  { label: 'md CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('md'), want: false },
  { label: 'crm CANNOT allot', got: canAllotKiaVehicleToBooking('crm'), want: false },
  { label: 'sales_executive CANNOT allot', got: canAllotKiaVehicleToBooking('sales_executive'), want: false },

  // Stock holds / BBND / transfers — deliberately UNCHANGED ("anyone except sales_executive").
  { label: 'sales_manager still CAN hold/transfer stock', got: canAllotKiaVehicle('sales_manager'), want: true },
  { label: 'accounts still CAN hold/transfer stock', got: canAllotKiaVehicle('accounts'), want: true },
  { label: 'sales_executive still CANNOT hold/transfer stock', got: canAllotKiaVehicle('sales_executive'), want: false },
  { label: 'idt is NOT granted stock holds/transfers by the allot change', got: canAllotKiaVehicle('idt'), want: false },

  // Payment confirmation — Accounts only, unchanged.
  { label: 'accounts CAN confirm payment', got: canVerifyKiaAccounts('accounts'), want: true },
  { label: 'sales_manager CANNOT confirm payment', got: canVerifyKiaAccounts('sales_manager'), want: false },
  { label: 'idt CANNOT confirm payment', got: canVerifyKiaAccounts('idt'), want: false },
  { label: 'crm CANNOT confirm payment', got: canVerifyKiaAccounts('crm'), want: false },

  // Case/whitespace robustness — role strings arrive from the DB and the client.
  { label: 'CRM gate is case-insensitive', got: canDeliverKiaBooking('  CRM '), want: true },
  { label: 'IDT gate is case-insensitive', got: canAllotKiaVehicleToBooking('IDT'), want: true },
  { label: 'empty role is denied', got: canAllotKiaVehicleToBooking(''), want: false },
  { label: 'null role is denied', got: canDeliverKiaBooking(null), want: false },
]

console.log('\n=== KIA workflow access gates ===\n')
let failures = 0
for (const check of CHECKS) {
  const ok = check.got === check.want
  if (!ok) failures += 1
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${check.label} — got ${check.got}, want ${check.want}`)
}

console.log('')
if (failures) {
  console.error(`=== ${failures} CHECK(S) FAILED ===\n`)
  process.exit(1)
}
console.log('=== ALL CHECKS PASSED ===\n')
