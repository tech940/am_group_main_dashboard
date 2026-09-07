/**
 * The first approval stage belongs to a different role depending on the brand:
 *
 *   KIA                  submitted → ED → EA → MD → Accounts
 *   Hyundai / Platinum   submitted → sales GSM, or the GROUP SERVICE MANAGER on service → EA → …
 *   every other brand    submitted → GSM → EA → MD → Accounts   (Sales or Service GSM, per department)
 *
 * ⚠️ Hyundai and Platinum service is the exception, and it is deliberate: those two are one service
 * operation under a single `group_service_manager`, so their OWN service GSMs no longer hold that
 * stage. Every other brand is untouched — asserted below, because a rule written for two brands that
 * quietly captures all of them is the easy mistake here.
 *
 * Pure — no database, no network. Run it in CI alongside the other verify:* scripts.
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-first-stage-approver.ts
 */
import {
  brandHasEd,
  canApproveFirstStage,
  firstStageApproverRoles,
  firstStageApproverRolesForTrack,
  firstStageLabel,
  firstStageShortLabel,
  isServiceApproval,
  trackForDepartment,
  usesGroupServiceManager,
} from '../lib/approvals/first-stage-approver'

/** Every role that may ever hold a first stage. Used to assert no VP or stray role sneaks in. */
const GSM_ROLES = ['general_manager', 'service_general_manager', 'group_service_manager']

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

console.log('1) Only KIA has an ED')
check(brandHasEd('kia'), 'kia has an ED')
check(brandHasEd('KIA'), 'casing does not matter')
for (const brand of ['hyundai', 'platinum', 'mg', 'tata', 'honda', '', null, undefined]) {
  check(!brandHasEd(brand), `${JSON.stringify(brand)} has no ED`)
}

console.log('\n2) Department maps to a track, whatever the casing')
check(trackForDepartment('Sales') === 'sales', "'Sales' -> sales")
check(trackForDepartment('SALES') === 'sales', "'SALES' -> sales")
check(trackForDepartment('Service') === 'service', "'Service' -> service")
check(trackForDepartment('SERVICE') === 'service', "'SERVICE' -> service")
check(trackForDepartment('') === 'unknown', 'blank -> unknown')
check(trackForDepartment(null) === 'unknown', 'null -> unknown')
check(trackForDepartment('Marketing') === 'unknown', 'an unrecognised department -> unknown')

console.log('\n3) KIA always routes to the CEO, whatever the department')
for (const dept of ['Sales', 'SERVICE', '', null, 'Marketing']) {
  const roles = firstStageApproverRoles('kia', dept)
  check(roles.length === 1 && roles[0] === 'ceo', `kia + ${JSON.stringify(dept)} -> ceo`)
}

console.log('\n4) Hyundai and Platinum: sales to the sales GSM, service to the VICE PRESIDENT')
for (const brand of ['hyundai', 'platinum']) {
  check(usesGroupServiceManager(brand), `${brand} service belongs to the group role`)
  check(JSON.stringify(firstStageApproverRoles(brand, 'Sales')) === JSON.stringify(['general_manager']),
    `${brand} + Sales -> general_manager`)
  check(JSON.stringify(firstStageApproverRoles(brand, 'Service')) === JSON.stringify(['vp']),
    `${brand} + Service -> vp`)
  // A data-entry gap must not strand a request: either side may clear it.
  const both = firstStageApproverRoles(brand, '')
  check(both.length === 2 && both.includes('general_manager') && both.includes('vp'),
    `${brand} + blank department -> sales GSM or VP`)
}

console.log('\n4b) ...and NO other brand is captured by the group role')
/*
 * The rule names two brands. A brand added later must keep its own service GSM until somebody
 * decides otherwise — this is the assertion that stops the exception from quietly becoming the rule.
 */
for (const brand of ['mg', 'tata', 'honda', 'bajaj', 'ktm', 'triumph']) {
  check(!usesGroupServiceManager(brand), `${brand} does NOT use the group service manager`)
  check(JSON.stringify(firstStageApproverRoles(brand, 'Service')) === JSON.stringify(['service_general_manager']),
    `${brand} + Service -> its own service_general_manager`)
}

console.log('\n5) The CEO can never approve at a brand that has no CEO')
for (const brand of ['hyundai', 'platinum', 'mg']) {
  for (const dept of ['Sales', 'Service', '', 'Marketing']) {
    check(!canApproveFirstStage('ceo', brand, dept), `ceo cannot approve ${brand} + ${JSON.stringify(dept)}`)
  }
}

console.log('\n6) ...and a GSM can never approve at KIA (that stage is the CEO’s)')
for (const role of GSM_ROLES) {
  for (const dept of ['Sales', 'Service', '']) {
    check(!canApproveFirstStage(role, 'kia', dept),
      `${role} cannot approve the KIA first stage (${JSON.stringify(dept)})`)
  }
}

console.log('\n7) A Sales GSM cannot clear a Service request, and vice versa')
check(!canApproveFirstStage('general_manager', 'hyundai', 'Service'), 'sales GSM blocked on a service request')
check(!canApproveFirstStage('vp', 'hyundai', 'Sales'), 'VP blocked on a sales request')
check(canApproveFirstStage('general_manager', 'hyundai', 'Sales'), 'sales GSM clears a sales request')
check(canApproveFirstStage('vp', 'hyundai', 'Service'), 'VP clears a service request')
/*
 * The handover, asserted from BOTH ends. Hyundai has two live service_general_manager users (pinned
 * to Kathua and Billawar) who held this stage until VP took it; asserting only that the
 * NEW role works would leave it ambiguous whether the old one still does too, and two people each
 * believing the other owns an approval is how a stage sits untouched for a fortnight.
 */
check(!canApproveFirstStage('service_general_manager', 'hyundai', 'Service'),
  'the hyundai service GSM no longer holds that stage — it moved to VP')
check(!canApproveFirstStage('service_general_manager', 'platinum', 'Service'),
  'the platinum service GSM no longer holds that stage either')
check(canApproveFirstStage('service_general_manager', 'tata', 'Service'),
  'a brand outside the group keeps its own service GSM')

console.log('\n8) The track-aware form agrees with the department-aware one')
for (const brand of ['kia', 'hyundai', 'platinum']) {
  for (const [dept, track] of [['Sales', 'sales'], ['Service', 'service'], ['', 'unknown']] as const) {
    check(JSON.stringify(firstStageApproverRoles(brand, dept))
      === JSON.stringify(firstStageApproverRolesForTrack(brand, track)),
      `${brand} + ${track}: both forms agree`)
  }
}

console.log('\n9) The label never says CEO at a brand without one')
check(firstStageLabel('kia', 'Sales') === 'CEO Approval', 'kia reads "CEO Approval"')
check(firstStageLabel('hyundai', 'Sales') === 'GSM Approval (Sales)', 'hyundai sales reads "GSM Approval (Sales)"')
check(firstStageLabel('hyundai', 'Service') === 'VP Approval',
  'hyundai service names the VP Approval')
check(firstStageLabel('platinum', 'Service') === 'VP Approval',
  'platinum service names the VP Approval')
check(firstStageLabel('tata', 'Service') === 'GSM Approval (Service)',
  'a brand outside the group still reads "GSM Approval (Service)"')
check(!firstStageLabel('platinum', '').includes('CEO'), 'platinum never reads "CEO"')

console.log('\n10) VP is not a first-stage approver for non-VP brands')
for (const brand of ['mg', 'tata', 'honda', 'bajaj', 'ktm', 'triumph']) {
  for (const role of ['vp', 'vice_president']) {
    for (const dept of ['Sales', 'Service', 'SERVICE', '']) {
      check(!canApproveFirstStage(role, brand, dept),
        `${role} cannot approve ${brand} / ${JSON.stringify(dept)}`)
    }
  }
}
for (const brand of ['hyundai', 'platinum']) {
  for (const dept of ['Sales']) {
    const roles = firstStageApproverRoles(brand, dept)
    check(roles.every((r) => !r.includes('vp')), `${brand} / ${JSON.stringify(dept)} approver list holds no VP: [${roles}]`)
  }
}

console.log('\n11) A blank or odd department still reaches BOTH sides')
for (const dept of ['', null, 'Marketing', 'Admin']) {
  const roles = firstStageApproverRoles('platinum', dept)
  check(roles.includes('general_manager') && roles.includes('vp'),
    `${JSON.stringify(dept)} -> both sides, so a data-entry gap cannot strand the request`)
}

/*
 * ── 12) THE SERVICE PREDICATE ───────────────────────────────────────────────────────
 *
 * It decides both who may approve and — for the VP/group service manager — what he can even SEE. It
 * previously existed in four copies and they had already drifted: the screen tested the department
 * for 'SPARE' where the two API routes tested for 'PARTS'. Asserted here so the merged version keeps
 * every classification all four used to make.
 */
console.log('\n12) The service predicate covers what every old copy of it covered')
for (const dept of ['SERVICE', 'Service', 'service', 'Spare Parts', 'SPARE', 'PARTS', 'Body Shop', 'LABOUR']) {
  check(isServiceApproval(dept, ''), `department ${JSON.stringify(dept)} is service`)
}
for (const type of ['Parts Purchase', 'WORKSHOP', 'Labour Charges', 'Annual Maintenance', 'Service Contract']) {
  check(isServiceApproval('', type), `approval type ${JSON.stringify(type)} is service`)
}
for (const dept of ['SALES', 'Sales', 'Marketing', 'Admin', '']) {
  check(!isServiceApproval(dept, 'Cash'), `department ${JSON.stringify(dept)} with a sales type is NOT service`)
}
// Sales departments must NEVER be classified as service, regardless of approval type
for (const salesDept of ['SALES', 'Sales', 'Sales Department', 'Sales Jammu', 'Sales Banihal']) {
  for (const type of ['Maintenance & Repair', 'Annual Maintenance', 'Parts Purchase', 'Workshop / Job Work', 'Diesel / Fuel', 'Stationery', 'Labour Charges']) {
    check(!isServiceApproval(salesDept, type), `sales dept ${JSON.stringify(salesDept)} + type ${JSON.stringify(type)} is NEVER service`)
  }
}
/*
 * Blank stays SALES, not 'unknown'. The callers treat this predicate as BINARY, and a blank
 * department has always routed to the sales GSM; returning 'unknown' here would quietly hand every
 * data-entry gap to two approvers instead of one.
 */
check(!isServiceApproval(null, null), 'a wholly blank request is not service')

/*
 * ── 13) THE SHORT LABEL IS AN AUDIT RECORD ────────────────────────────────────────────────────
 *
 * Not decoration: both action routes write it into the `history` jsonb as `role`, and the decision
 * email and the printed voucher both render it. It used to ignore its `department` argument
 * entirely — every caller passed null — so a Hyundai or Platinum SERVICE approval was recorded as a
 * bare 'GSM', which at those brands names the SALES GSM: a different person who cannot act on that
 * stage at all. The permanent record named the wrong desk.
 */
console.log('\n13) The short label names the desk that actually signed')
check(firstStageShortLabel('kia', 'SERVICE') === 'CEO', 'kia still records CEO')
check(firstStageShortLabel('hyundai', 'SALES') === 'GSM', 'hyundai sales records GSM')
check(firstStageShortLabel('hyundai', 'SERVICE') === 'VP',
  'hyundai service records VP')
check(firstStageShortLabel('platinum', 'SERVICE') === 'VP',
  'platinum service records VP')
check(firstStageShortLabel('tata', 'SERVICE') === 'GSM', 'a brand outside the group still records GSM')
// The approval TYPE alone can make a request service work, so the label must read it too.
check(firstStageShortLabel('platinum', '', 'Workshop Consumables') === 'VP',
  'a service approval TYPE is enough to name VP')
// A caller that supplies no department must degrade to the old wording, never to something wrong.
check(firstStageShortLabel('hyundai', null) === 'GSM', 'with no department it falls back to GSM')

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
