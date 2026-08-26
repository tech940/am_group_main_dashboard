/**
 * The first approval stage belongs to a different role depending on the brand:
 *
 *   KIA         submitted → ED  → EA → MD → Accounts
 *   all others  submitted → GSM → EA → MD → Accounts   (Sales or Service GSM, per department)
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
  trackForDepartment,
} from '../lib/approvals/first-stage-approver'

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

console.log('\n3) KIA always routes to the ED, whatever the department')
for (const dept of ['Sales', 'SERVICE', '', null, 'Marketing']) {
  const roles = firstStageApproverRoles('kia', dept)
  check(roles.length === 1 && roles[0] === 'ed', `kia + ${JSON.stringify(dept)} -> ed`)
}

console.log('\n4) Every other brand routes to the right GSM')
for (const brand of ['hyundai', 'platinum']) {
  check(JSON.stringify(firstStageApproverRoles(brand, 'Sales')) === JSON.stringify(['general_manager']),
    `${brand} + Sales -> general_manager`)
  check(JSON.stringify(firstStageApproverRoles(brand, 'Service')) === JSON.stringify(['service_general_manager']),
    `${brand} + Service -> service_general_manager`)
  // A data-entry gap must not strand a request: either GSM may clear it.
  const both = firstStageApproverRoles(brand, '')
  check(both.length === 2 && both.includes('general_manager') && both.includes('service_general_manager'),
    `${brand} + blank department -> either GSM`)
}

console.log('\n5) The ED can never approve at a brand that has no ED')
for (const brand of ['hyundai', 'platinum', 'mg']) {
  for (const dept of ['Sales', 'Service', '', 'Marketing']) {
    check(!canApproveFirstStage('ed', brand, dept), `ed cannot approve ${brand} + ${JSON.stringify(dept)}`)
  }
}

console.log('\n6) ...and a GSM can never approve at KIA (that stage is the ED’s)')
for (const role of ['general_manager', 'service_general_manager']) {
  check(!canApproveFirstStage(role, 'kia', 'Sales'), `${role} cannot approve the KIA first stage`)
}

console.log('\n7) A Sales GSM cannot clear a Service request, and vice versa')
check(!canApproveFirstStage('general_manager', 'hyundai', 'Service'), 'sales GSM blocked on a service request')
check(!canApproveFirstStage('service_general_manager', 'hyundai', 'Sales'), 'service GSM blocked on a sales request')
check(canApproveFirstStage('general_manager', 'hyundai', 'Sales'), 'sales GSM clears a sales request')
check(canApproveFirstStage('service_general_manager', 'hyundai', 'Service'), 'service GSM clears a service request')

console.log('\n8) The track-aware form agrees with the department-aware one')
for (const brand of ['kia', 'hyundai', 'platinum']) {
  for (const [dept, track] of [['Sales', 'sales'], ['Service', 'service'], ['', 'unknown']] as const) {
    check(JSON.stringify(firstStageApproverRoles(brand, dept))
      === JSON.stringify(firstStageApproverRolesForTrack(brand, track)),
      `${brand} + ${track}: both forms agree`)
  }
}

console.log('\n9) The label never says ED at a brand without one')
check(firstStageLabel('kia', 'Sales') === 'ED Approval', 'kia reads "ED Approval"')
check(firstStageLabel('hyundai', 'Sales') === 'GSM Approval (Sales)', 'hyundai sales reads "GSM Approval (Sales)"')
check(firstStageLabel('hyundai', 'Service') === 'GSM Approval (Service)', 'hyundai service reads "GSM Approval (Service)"')
check(!firstStageLabel('platinum', '').includes('ED'), 'platinum never reads "ED"')

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
