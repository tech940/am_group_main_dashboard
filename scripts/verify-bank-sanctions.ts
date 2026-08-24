/**
 * Proves /bank-sanctions is reachable by EA + MD + Accounts + Developer ONLY, and that the
 * loan-type duplicate rule matches the sheet's semantics.
 *
 *   npm run verify:bank-sanctions
 *
 * Same adversarial shape as verify-md-targets: every role in the enum is probed against an
 * ALL-TRUE Proxy permission map (what "someone ticked every box in the Access Map" looks like).
 * A permission-backed gate opens under that map; this role gate must not — especially for `admin`
 * and `hr`, which are family:'super' in the tier model and would receive any permission key.
 */
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS, canUserAccessSection } from '../lib/navigation/sections'
import { BANK_SANCTIONS_HREFS, BANK_SANCTIONS_ROLES, canViewBankSanctions } from '../lib/auth/bank-sanctions-access'
import { loanTypeKey } from '../lib/bank-sanctions/store'

const ALL_ROLES = [
  'admin', 'developer', 'branch_admin', 'ceo', 'purchase_manager', 'finance_head', 'ea', 'md',
  'eba', 'accounts', 'manager', 'technician', 'viewer', 'service_manager', 'general_manager',
  'sales_head', 'sales_executive', 'sales_manager', 'finance_team', 'service_general_manager',
  'call_agent', 'ca', 'crm', 'idt', 'cre', 'edp', 'cxm', 'ccm', 'ed', 'vp', 'assistant_manager',
  'process_coordinator', 'hr',
]

const ALLOWED = new Set<string>(BANK_SANCTIONS_ROLES)
const ALL_GRANTED = new Proxy({}, { get: () => true, has: () => true }) as Record<string, boolean>

let failures = 0
const ok = (msg: string) => console.log(`  [PASS] ${msg}`)
const fail = (msg: string) => { failures += 1; console.log(`  [FAIL] ${msg}`) }
const assert = (msg: string, cond: boolean) => (cond ? ok(msg) : fail(msg))

console.log('\n1. The section is registered and searchable')
for (const href of BANK_SANCTIONS_HREFS) {
  assert(`${href} is in ALL_SECTIONS`, ALL_SECTIONS.some((s) => s.href === href))
  assert(`${href} is in ALLOWED_SIDEBAR_HREFS`, ALLOWED_SIDEBAR_HREFS.has(href))
}

console.log('\n2. canUserAccessSection — adversarial pass (every permission granted)')
const section = ALL_SECTIONS.find((s) => s.href === '/bank-sanctions')!
for (const role of ALL_ROLES) {
  const expected = ALLOWED.has(role)
  for (const brand of ['all', 'kia', null] as const) {
    const actual = canUserAccessSection(section, role, brand, ALL_GRANTED)
    if (actual !== expected) {
      fail(`role='${role}' brand='${brand}' -> ${actual}, expected ${expected} (WITH ALL PERMISSIONS GRANTED)`)
    }
  }
}
if (failures === 0) ok(`all ${ALL_ROLES.length} roles behave correctly under a fully-granted Access Map`)

console.log('\n3. The dangerous pair a permission key would have leaked to')
for (const role of ['admin', 'hr']) {
  assert(`'${role}' is denied even with every permission granted`,
    canUserAccessSection(section, role, 'all', ALL_GRANTED) === false)
}

console.log('\n4. canViewBankSanctions — the four roles, and near misses')
for (const role of BANK_SANCTIONS_ROLES) assert(`'${role}' allowed`, canViewBankSanctions(role))
assert("'EA ' allowed (case + whitespace tolerated)", canViewBankSanctions('EA '))
for (const role of ['', 'admin', 'hr', 'eba', 'ed', 'manager', 'accounts_head']) {
  assert(`'${role || '(empty)'}' denied`, !canViewBankSanctions(role))
}

console.log('\n5. The loan-type duplicate rule matches the sheet exactly')
assert("'CC A/c 4501' ≡ 'OD 4501' (last number is the identity)", loanTypeKey('CC A/c 4501') === loanTypeKey('OD 4501'))
assert("'Loan 12 of 4501' keys on 4501, not 12", loanTypeKey('Loan 12 of 4501') === '4501')
assert("numberless names key on lower-cased text", loanTypeKey('  Gold Loan ') === 'gold loan')
assert("different numbers stay distinct", loanTypeKey('CC 4501') !== loanTypeKey('CC 4502'))

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
