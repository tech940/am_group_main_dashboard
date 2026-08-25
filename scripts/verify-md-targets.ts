/**
 * Proves the MD Targets section (/targets) is reachable by MD + Developer ONLY, and that the
 * `__brand__` sentinel cannot collide with a real dealer code.
 *
 *   npm run verify:md-targets
 *
 * ── Why the adversarial permission map matters ────────────────────────────────────────────────
 * The dangerous roles here are `admin` and `hr`. Neither is in isSuperAdminRole, so neither
 * bypasses gate FUNCTIONS — but both are `family: 'super'` in lib/permissions/tiers.ts, and
 * buildTierRoleDefaults sets EVERY permission key true for a super family without consulting
 * RESTRICTED_DEFAULT_PERMISSION_KEYS. So a deny-by-default permission key would silently reach
 * them. That is the whole reason this section uses a hardcoded role constant, and this script is
 * what proves the constant actually holds.
 *
 * ── Why the `return true` tail matters ────────────────────────────────────────────────────────
 * canUserAccessSection ends in `return true` for any allowlisted href with no permission key. We
 * deliberately register NO SECTION_ROUTES entry for /targets, so without the explicit guard the
 * section would be visible to EVERY role. Section 2 below is what catches that regression.
 */
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS, canUserAccessSection } from '../lib/navigation/sections'
import { MD_TARGETS_HREFS, MD_TARGETS_ROLES, canViewMdTargets } from '../lib/auth/md-targets-access'
import { isSuperAdminRole } from '../lib/auth/roles'
import { BRAND_DEALERS } from '../lib/dealers/registry'
import {
  BRAND_TARGET_SENTINEL, CONTEXT_FOR_METRIC, CURRENCY_METRICS, LABOUR_METRICS, METRIC_SPEC,
  TARGET_BRANDS, TARGET_METRICS, salesIsBrandLevel,
} from '../lib/targets/constants'

/** Every value of the user_role enum (lib/db/schema.ts). Kept explicit so a NEW role fails loudly. */
const ALL_ROLES = [
  'admin', 'developer', 'branch_admin', 'ceo', 'purchase_manager', 'finance_head', 'ea', 'md',
  'eba', 'accounts', 'manager', 'technician', 'viewer', 'service_manager', 'general_manager',
  'sales_head', 'sales_executive', 'sales_manager', 'finance_team', 'service_general_manager',
  'call_agent', 'ca', 'crm', 'idt', 'cre', 'edp', 'cxm', 'ccm', 'ed', 'vp', 'assistant_manager',
  'process_coordinator', 'hr',
]

const ALLOWED = new Set<string>(MD_TARGETS_ROLES)

/** Someone ticked EVERY box in the Access Map. A permission gate opens here; a role gate must not. */
const ALL_GRANTED = new Proxy({}, { get: () => true, has: () => true }) as Record<string, boolean>

let failures = 0
const ok = (msg: string) => console.log(`  [PASS] ${msg}`)
const fail = (msg: string) => { failures += 1; console.log(`  [FAIL] ${msg}`) }
const assert = (msg: string, cond: boolean) => (cond ? ok(msg) : fail(msg))

console.log('\n1. The section is registered and searchable')
for (const href of MD_TARGETS_HREFS) {
  const section = ALL_SECTIONS.find((s) => s.href === href)
  assert(`${href} is in ALL_SECTIONS`, Boolean(section))
  assert(`${href} is in ALLOWED_SIDEBAR_HREFS`, ALLOWED_SIDEBAR_HREFS.has(href))
}

console.log('\n2. canUserAccessSection — the ADVERSARIAL pass (every permission granted)')
console.log('   This is the one that catches the `return true` tail if the guard is ever removed.')
for (const href of MD_TARGETS_HREFS) {
  const section = ALL_SECTIONS.find((s) => s.href === href)
  if (!section) continue
  for (const role of ALL_ROLES) {
    const expected = ALLOWED.has(role)
    // Vary the brand pin too: 'all' and a brand must not open it via any brand/global path.
    for (const brand of ['all', 'kia', null] as const) {
      const actual = canUserAccessSection(section, role, brand, ALL_GRANTED)
      if (actual !== expected) {
        fail(`${href}: role='${role}' brand='${brand}' -> ${actual}, expected ${expected} (WITH ALL PERMISSIONS GRANTED)`)
      }
    }
  }
}
if (failures === 0) ok(`all ${ALL_ROLES.length} roles behave correctly under a fully-granted Access Map`)

console.log('\n3. The two roles that a permission key WOULD have leaked to')
console.log("   admin and hr are family:'super' in lib/permissions/tiers.ts — the reason for the hardcoded gate.")
for (const role of ['admin', 'hr']) {
  const section = ALL_SECTIONS.find((s) => s.href === '/targets')!
  assert(`'${role}' is denied even with every permission granted`,
    canUserAccessSection(section, role, 'all', ALL_GRANTED) === false)
}

console.log('\n4. canViewMdTargets — normalisation and near misses')
assert("'md' allowed", canViewMdTargets('md'))
assert("'MD ' allowed (case + whitespace tolerated)", canViewMdTargets('MD '))
assert("'developer' allowed", canViewMdTargets('developer'))
assert("'' denied", !canViewMdTargets(''))
assert('null denied', !canViewMdTargets(null))
assert('undefined denied', !canViewMdTargets(undefined))
assert("'admin' denied", !canViewMdTargets('admin'))
assert("'hr' denied", !canViewMdTargets('hr'))
assert("'md_' denied (no prefix matching)", !canViewMdTargets('md_'))
assert("'superadmin' denied", !canViewMdTargets('superadmin'))

console.log('\n5. The gate can never become WIDER than super-admin by a careless edit')
for (const role of MD_TARGETS_ROLES) {
  assert(`'${role}' is also a super-admin role`, isSuperAdminRole(role))
}

console.log('\n6. The brand-level sentinel cannot collide with a real dealer code')
let collision = false
for (const [brand, dealers] of Object.entries(BRAND_DEALERS)) {
  for (const dealer of dealers) {
    if (dealer.code === BRAND_TARGET_SENTINEL) {
      fail(`sentinel '${BRAND_TARGET_SENTINEL}' collides with a real ${brand} code`)
      collision = true
    }
  }
}
if (!collision) {
  const total = Object.values(BRAND_DEALERS).reduce((n, d) => n + d.length, 0)
  ok(`'${BRAND_TARGET_SENTINEL}' collides with none of the ${total} registered dealer codes`)
}

console.log('\n7. Brand capability matches what each feed can actually support')
assert('kia sales is per-branch', !salesIsBrandLevel('kia'))
console.log('   All three feeds carry a per-branch dealer_code that survives VIN dedup. The')
console.log('   "no outlet split" note in retail-review describes main_dealer_code, another column.')
assert('hyundai sales is per-branch', !salesIsBrandLevel('hyundai'))
assert('platinum sales is per-branch', !salesIsBrandLevel('platinum'))
for (const brand of TARGET_BRANDS) {
  assert(`${brand} has registered branches for its per-branch service targets`,
    (BRAND_DEALERS[brand]?.length ?? 0) > 0)
}

console.log('')
console.log('8. Every metric is fully specified (the Records below are types only at runtime)')
// WARNING: CONTEXT_FOR_METRIC and METRIC_SPEC are declared as Record<TargetMetric, ...>, which is a
// COMPILE-time guarantee only. tsx/esbuild strips types without checking them, so a metric added to
// TARGET_METRICS but forgotten in either table would ship and silently route through `undefined`.
// These assertions are the runtime half of that contract.
const ACTUAL_FIELDS = ['salesUnits', 'serviceRoCount', 'mechLabour', 'bodyshopLabour', 'labourTotal']
for (const metric of TARGET_METRICS) {
  const spec = METRIC_SPEC[metric]
  assert(`${metric}: has a METRIC_SPEC entry`, Boolean(spec))
  if (!spec) continue
  // targetField must equal the metric key -- the store's column names are derived from it.
  assert(`${metric}: targetField matches its own key`, spec.targetField === metric)
  assert(`${metric}: actualField is a real ActualCell key`, ACTUAL_FIELDS.includes(spec.actualField))
  assert(`${metric}: has a context metric`, Boolean(CONTEXT_FOR_METRIC[metric]))
  // kind and CURRENCY_METRICS must agree, or the grid formats rupees as a bare count -- or worse,
  // masks a rupee target to 7 digits and silently caps every labour target under Rs1 Cr.
  assert(`${metric}: kind agrees with CURRENCY_METRICS`,
    (spec.kind === 'money') === CURRENCY_METRICS.has(metric))
}
for (const metric of LABOUR_METRICS) {
  assert(`${metric}: is a service-family money metric`,
    METRIC_SPEC[metric].family === 'service' && METRIC_SPEC[metric].kind === 'money')
}
assert('every ActualCell metric field is claimed by exactly one metric',
  new Set(TARGET_METRICS.map((m) => METRIC_SPEC[m].actualField)).size === TARGET_METRICS.length)

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
