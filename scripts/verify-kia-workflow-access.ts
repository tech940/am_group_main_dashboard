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
  canViewAllKiaBookings,
} from '../lib/kia/workflow-access'
import { canRevealKiaFollowupPhone, canViewKiaCustomerPii } from '../lib/kia/pii'
import { roleEnum } from '../lib/db/schema'

type Check = { label: string; got: boolean; want: boolean }

const CHECKS: Check[] = [
  // Delivery — CXM owns it, CCM backs it up (+ super admins). Took over from the retired CRM.
  { label: 'CXM CAN deliver', got: canDeliverKiaBooking('cxm'), want: true },
  { label: 'CCM CAN deliver (backup when CXM is absent)', got: canDeliverKiaBooking('ccm'), want: true },
  { label: 'CRM CANNOT deliver (retired — handed over to CXM)', got: canDeliverKiaBooking('crm'), want: false },
  { label: 'developer CAN deliver (super-admin override)', got: canDeliverKiaBooking('developer'), want: true },
  { label: 'admin CAN deliver (super-admin override)', got: canDeliverKiaBooking('admin'), want: true },
  { label: 'sales_executive CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('sales_executive'), want: false },
  { label: 'sales_manager CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('sales_manager'), want: false },
  { label: 'general_manager CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('general_manager'), want: false },
  { label: 'md CANNOT deliver (was allowed before)', got: canDeliverKiaBooking('md'), want: false },
  { label: 'idt CANNOT deliver', got: canDeliverKiaBooking('idt'), want: false },
  { label: 'accounts CANNOT deliver', got: canDeliverKiaBooking('accounts'), want: false },

  // The new roles must not have quietly acquired anything BUT delivery.
  { label: 'CXM CANNOT allot to a booking', got: canAllotKiaVehicleToBooking('cxm'), want: false },
  { label: 'CCM CANNOT allot to a booking', got: canAllotKiaVehicleToBooking('ccm'), want: false },
  { label: 'CXM CANNOT verify Accounts payment', got: canVerifyKiaAccounts('cxm'), want: false },
  { label: 'CCM CANNOT verify Accounts payment', got: canVerifyKiaAccounts('ccm'), want: false },
  { label: 'CXM CANNOT see customer PII', got: canViewKiaCustomerPii('cxm'), want: false },
  { label: 'CCM CANNOT see customer PII', got: canViewKiaCustomerPii('ccm'), want: false },

  // Visibility — an action-owning role that cannot SEE the bookings is inert. This is the exact trap
  // `crm` fell into: it held delivery exclusively while seeing 0 of 55 bookings.
  { label: 'CXM CAN see all bookings (else delivery is unreachable)', got: canViewAllKiaBookings('cxm'), want: true },
  { label: 'CCM CAN see all bookings (else delivery is unreachable)', got: canViewAllKiaBookings('ccm'), want: true },
  { label: 'EDP CAN see all bookings (unrestricted all branches)', got: canViewAllKiaBookings('edp'), want: true },
  { label: 'CRM CANNOT see all bookings (retired)', got: canViewAllKiaBookings('crm'), want: false },
  { label: 'sales_executive CANNOT see all bookings (own only)', got: canViewAllKiaBookings('sales_executive'), want: false },

  // Allotment to a booking — IDT exclusive (+ super admins).
  { label: 'IDT CAN allot to a booking', got: canAllotKiaVehicleToBooking('idt'), want: true },
  { label: 'developer CAN allot (super-admin override)', got: canAllotKiaVehicleToBooking('developer'), want: true },
  { label: 'sales_manager CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('sales_manager'), want: false },
  { label: 'general_manager CAN allot to a booking', got: canAllotKiaVehicleToBooking('general_manager'), want: true },
  { label: 'accounts CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('accounts'), want: false },
  { label: 'md CANNOT allot (was allowed before)', got: canAllotKiaVehicleToBooking('md'), want: false },
  { label: 'crm CANNOT allot', got: canAllotKiaVehicleToBooking('crm'), want: false },
  { label: 'sales_executive CANNOT allot', got: canAllotKiaVehicleToBooking('sales_executive'), want: false },

  // Stock holds / BBND / transfers — deliberately UNCHANGED ("anyone except sales_executive").
  { label: 'sales_manager still CAN hold/transfer stock', got: canAllotKiaVehicle('sales_manager'), want: true },
  { label: 'accounts still CAN hold/transfer stock', got: canAllotKiaVehicle('accounts'), want: true },
  { label: 'sales_executive still CANNOT hold/transfer stock', got: canAllotKiaVehicle('sales_executive'), want: false },
  { label: 'idt CAN hold/transfer stock', got: canAllotKiaVehicle('idt'), want: true },

  // Payment confirmation — Accounts only, unchanged.
  { label: 'accounts CAN confirm payment', got: canVerifyKiaAccounts('accounts'), want: true },
  { label: 'sales_manager CANNOT confirm payment', got: canVerifyKiaAccounts('sales_manager'), want: false },
  { label: 'idt CANNOT confirm payment', got: canVerifyKiaAccounts('idt'), want: false },
  { label: 'crm CANNOT confirm payment', got: canVerifyKiaAccounts('crm'), want: false },

  // Customer PII — who may REVEAL a mobile number from Booking Follow-ups. This is the narrow
  // exception to "telecallers never see the number"; everyone else keeps the masked lock.
  { label: 'CRE CAN reveal a customer number', got: canRevealKiaFollowupPhone('cre'), want: true },
  { label: 'MD CAN reveal (already has PII everywhere)', got: canRevealKiaFollowupPhone('md'), want: true },
  { label: 'developer CAN reveal', got: canRevealKiaFollowupPhone('developer'), want: true },
  { label: 'finance_head CAN reveal', got: canRevealKiaFollowupPhone('finance_head'), want: true },
  { label: 'sales_executive CANNOT reveal', got: canRevealKiaFollowupPhone('sales_executive'), want: false },
  { label: 'sales_manager CANNOT reveal', got: canRevealKiaFollowupPhone('sales_manager'), want: false },
  { label: 'manager CANNOT reveal', got: canRevealKiaFollowupPhone('manager'), want: false },
  { label: 'call_agent CANNOT reveal (masked Call Center is its own flow)', got: canRevealKiaFollowupPhone('call_agent'), want: false },
  { label: 'crm CANNOT reveal (delivery role, not a caller)', got: canRevealKiaFollowupPhone('crm'), want: false },
  { label: 'empty role CANNOT reveal', got: canRevealKiaFollowupPhone(''), want: false },
  { label: 'reveal gate is case-insensitive', got: canRevealKiaFollowupPhone(' CRE '), want: true },
  // The wider PII rule must NOT have drifted: CRE gets the follow-up reveal only, not blanket PII
  // across the Proforma/Bookings/Stock surfaces.
  { label: 'CRE did NOT gain blanket KIA PII access', got: canViewKiaCustomerPii('cre'), want: false },

  // Case/whitespace robustness — role strings arrive from the DB and the client.
  { label: 'CXM gate is case-insensitive', got: canDeliverKiaBooking('  CXM '), want: true },
  { label: 'CCM gate is case-insensitive', got: canDeliverKiaBooking(' Ccm '), want: true },
  { label: 'IDT gate is case-insensitive', got: canAllotKiaVehicleToBooking('IDT'), want: true },
  { label: 'empty role is denied', got: canAllotKiaVehicleToBooking(''), want: false },
  { label: 'null role is denied', got: canDeliverKiaBooking(null), want: false },
]

// Enum-driven coherence invariant — the guard the hand-written rows above could not give us.
//
// Every role in the enum is checked, so a role added LATER is covered without anyone remembering to
// add a case here. The rule: if a role may ACT on a booking, it must be able to SEE bookings. `crm`
// violated this for its entire existence — exclusive delivery rights, zero visible bookings — and no
// test noticed, because every check was a hand-written row about a role someone thought about.
for (const role of roleEnum.enumValues) {
  const acts = canDeliverKiaBooking(role) || canAllotKiaVehicleToBooking(role)
  if (!acts) continue
  CHECKS.push({
    label: `[invariant] '${role}' can act on a booking, so it must see bookings`,
    got: canViewAllKiaBookings(role),
    want: true,
  })
}

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
