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
import { BANK_SANCTIONS_HREFS, BANK_SANCTIONS_ROLES, BANK_SANCTION_BRANDS, bankSanctionBrandsFor, canSeeBankSanctionRow, canViewAllBankSanctionBranches, canViewBankSanctions } from '../lib/auth/bank-sanctions-access'
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


console.log(`
6. Brand scoping — who may see WHICH facility (migration 0046)`)
{
  /*
   * Section access says whether you may open /bank-sanctions. This is the separate question of
   * which rows you get once inside. Regressions here leak one dealership's bank position to another.
   */
  const see = canSeeBankSanctionRow
  assert('MD sees a KIA facility', see('md', 'platinum', 'kia'))
  assert('MD sees a GROUP-LEVEL facility', see('md', 'platinum', null))
  assert('Developer sees a group-level facility', see('developer', 'kia', null))
  assert("MD's own brand assignment is irrelevant", see('md', 'honda', 'tata') && see('md', null, 'mg'))

  assert('KIA accounts sees kia', see('accounts', 'kia', 'kia'))
  assert('KIA accounts does NOT see honda', !see('accounts', 'kia', 'honda'))
  assert('KIA accounts does NOT see platinum', !see('accounts', 'kia', 'platinum'))
  assert('KIA EA does NOT see group-level', !see('ea', 'kia', null))
  assert('a two-brand login sees both of its brands',
    see('accounts', 'kia,platinum', 'kia') && see('accounts', 'kia,platinum', 'platinum'))
  assert('a two-brand login still sees nothing else', !see('accounts', 'kia,platinum', 'tata'))

  // The 'all' rule is the subtle one and the whole reason the NULL case is handled separately.
  assert("assignment 'all' sees every BRAND", see('ea', 'all', 'kia') && see('ea', 'all', 'honda'))
  assert("assignment 'all' does NOT see group-level (MD/Developer only)", !see('ea', 'all', null))
  assert("'all' is not a role escalation", !canViewAllBankSanctionBranches('ea'))

  assert('an unassigned login sees nothing', !see('accounts', '', 'kia') && !see('accounts', null, 'kia'))
  assert('junk in users.brand fails CLOSED', !see('accounts', 'not-a-brand', 'kia'))
  assert('brand list resolution', JSON.stringify(bankSanctionBrandsFor('kia,honda')) === '["kia","honda"]')
  assert("'all' resolves to the sentinel, not a brand list", bankSanctionBrandsFor('all') === 'all-brands')
  assert('every seeded branch code is a known brand',
    ['kia', 'honda', 'tata', 'bajaj', 'mg', 'ktm', 'triumph', 'platinum']
      .every((b) => (BANK_SANCTION_BRANDS as readonly string[]).includes(b)))
}


console.log(`
7. Process Coordinator (PC) — opens the section, sees only its own branches`)
{
  const see = canSeeBankSanctionRow
  assert('PC may open the section', canViewBankSanctions('process_coordinator'))
  assert('PC is NOT an all-branch role', !canViewAllBankSanctionBranches('process_coordinator'))
  assert('a KIA PC sees kia', see('process_coordinator', 'kia', 'kia'))
  assert('a KIA PC does NOT see honda', !see('process_coordinator', 'kia', 'honda'))
  assert('a KIA PC does NOT see group-level', !see('process_coordinator', 'kia', null))
  // The user's explicit requirement: a PC holding several branches sees all of them.
  assert('a multi-branch PC sees every branch it holds',
    see('process_coordinator', 'kia,platinum,honda', 'kia')
    && see('process_coordinator', 'kia,platinum,honda', 'platinum')
    && see('process_coordinator', 'kia,platinum,honda', 'honda'))
  assert('a multi-branch PC still sees nothing beyond them',
    !see('process_coordinator', 'kia,platinum', 'tata') && !see('process_coordinator', 'kia,platinum', null))
  assert('an unassigned PC sees nothing', !see('process_coordinator', '', 'kia'))

  /*
   * ⚠️ The regression this guards: process_coordinator IS in GLOBAL_ACCESS_ROLE_VALUES, so wiring
   * hasGlobalAccessRole into this section would silently hand PC (and ea/eba/ed/edp/hr/ceo) the
   * whole register including group-level borrowing.
   */
  for (const role of ['ea', 'eba', 'ed', 'edp', 'hr', 'ceo', 'process_coordinator']) {
    assert(`global-access role '${role}' still cannot see group-level rows`, !see(role, 'all', null))
  }
}

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
