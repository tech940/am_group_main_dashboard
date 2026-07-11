/**
 * Verifies the deny-by-default rule for restricted sidebar sections against the REAL, exported
 * `resolveEffectiveSnapshot` (no DB). Proves:
 *   1. The two new sections (Sales Performance, Call Center) are in the restricted set.
 *   2. A brand user (relies on brand default) is DENIED them, but keeps existing sections.
 *   3. A global-access non-super role (ceo) is DENIED them, but keeps existing sections.
 *   4. Super Admins (md, developer) ALWAYS see them.
 *   5. They remain grantable — an explicit Allow override (Access Map) wins.
 *   6. A role template grant (call_agent → Call Center) still resolves true.
 *
 * Run:  npx tsx scripts/verify-restricted-default-sections.ts
 */
import 'dotenv/config'
import { PERMISSIONS, RESTRICTED_DEFAULT_SECTIONS, ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot, resolveEffectiveSnapshotV2 } from '../lib/permissions/service'

let failures = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? `  — ${detail}` : ''}`)
}

const ALL_FALSE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>

const CALL = 'kia.call_center.view'
const PERF = 'kia.sales_performance.view'
const EXISTING = 'kia.bookings.view' // an ordinary brand section that must stay visible

console.log('\n=== Deny-by-default for restricted sidebar sections (pure, no DB) ===\n')

console.log('Scenario 0 — the two new sections are registered as restricted:')
assert('kia.sales_performance is restricted', RESTRICTED_DEFAULT_SECTIONS.has('kia.sales_performance'))
assert('kia.call_center is restricted', RESTRICTED_DEFAULT_SECTIONS.has('kia.call_center'))
assert('kia.bookings is NOT restricted (stays visible)', !RESTRICTED_DEFAULT_SECTIONS.has('kia.bookings'))

console.log('\nScenario 1 — Kia brand user (service_manager), no overrides:')
const s1 = resolveEffectiveSnapshot(ALL_FALSE, {}, 'service_manager', 'kia')
assert('Call Center DENIED by default', s1.effective[CALL] === false, `effective=${s1.effective[CALL]}`)
assert('Sales Performance DENIED by default', s1.effective[PERF] === false, `effective=${s1.effective[PERF]}`)
assert('existing Bookings STILL visible (no regression)', s1.effective[EXISTING] === true, `effective=${s1.effective[EXISTING]}`)

console.log('\nScenario 2 — Global-access non-super role (ceo):')
const s2 = resolveEffectiveSnapshot(ALL_FALSE, {}, 'ceo', 'kia')
assert('Call Center DENIED for ceo', s2.effective[CALL] === false, `effective=${s2.effective[CALL]}`)
assert('Sales Performance DENIED for ceo', s2.effective[PERF] === false, `effective=${s2.effective[PERF]}`)

console.log('\nScenario 3 — Super Admins always see them:')
const md = resolveEffectiveSnapshot(ALL_FALSE, {}, 'md', 'kia')
const dev = resolveEffectiveSnapshot(ALL_FALSE, {}, 'developer', 'kia')
assert('MD sees Call Center', md.effective[CALL] === true, `effective=${md.effective[CALL]}`)
assert('MD sees Sales Performance', md.effective[PERF] === true, `effective=${md.effective[PERF]}`)
assert('Developer sees Call Center', dev.effective[CALL] === true)
assert('Developer sees Sales Performance', dev.effective[PERF] === true)

console.log('\nScenario 4 — still grantable via an explicit Allow override (Access Map):')
const s4 = resolveEffectiveSnapshot(ALL_FALSE, { [CALL]: true }, 'service_manager', 'kia')
assert('explicit Allow grants Call Center', s4.effective[CALL] === true, `effective=${s4.effective[CALL]}`)

console.log('\nScenario 5 — role-template grant survives (call_agent → Call Center):')
const s5 = resolveEffectiveSnapshot({ ...ALL_FALSE, [CALL]: true }, {}, 'call_agent', 'kia')
assert('call_agent keeps Call Center from its template', s5.effective[CALL] === true, `effective=${s5.effective[CALL]}`)

console.log('\nScenario 6 — the new independent CA section (ca role + super admins only):')
const CA = 'ca.view'
assert('ca is restricted-by-default', RESTRICTED_DEFAULT_SECTIONS.has('ca'))
assert('CA denied for a brand user (service_manager)', resolveEffectiveSnapshot(ALL_FALSE, {}, 'service_manager', 'kia').effective[CA] === false)
assert('CA denied for ceo (global non-super)', resolveEffectiveSnapshot(ALL_FALSE, {}, 'ceo', 'all').effective[CA] === false)
assert('MD sees CA', resolveEffectiveSnapshot(ALL_FALSE, {}, 'md', 'all').effective[CA] === true)
assert('Developer sees CA', resolveEffectiveSnapshot(ALL_FALSE, {}, 'developer', 'all').effective[CA] === true)
assert('CA grantable via explicit Allow override', resolveEffectiveSnapshot(ALL_FALSE, { [CA]: true }, 'accounts', 'kia').effective[CA] === true)
assert('ca role keeps CA from its template', resolveEffectiveSnapshot({ ...ALL_FALSE, [CA]: true }, {}, 'ca', 'all').effective[CA] === true)

console.log('\nScenario 7 — the new independent Group Cockpit section (super admins by default; other leadership per-user):')
const COCKPIT = 'cockpit.view'
assert('cockpit is restricted-by-default', RESTRICTED_DEFAULT_SECTIONS.has('cockpit'))
assert('Cockpit denied for a brand user (service_manager)', resolveEffectiveSnapshot(ALL_FALSE, {}, 'service_manager', 'kia').effective[COCKPIT] === false)
// CEO/EA/EBA are global-access roles: the resolver FORCES restricted-default sections to false for
// them (lib/permissions/service.ts) so a new sidebar section is deny-by-default — matching the
// user's directive that new sections reach no one but Developer/MD until granted. A role-template
// grant would be clobbered here; access for other leadership must come from a per-user Allow.
assert('Cockpit denied by default for ceo (global non-super, restricted-forced-false)', resolveEffectiveSnapshot(ALL_FALSE, {}, 'ceo', 'all').effective[COCKPIT] === false)
assert('Cockpit denied by default for eba (global non-super)', resolveEffectiveSnapshot(ALL_FALSE, {}, 'eba', 'all').effective[COCKPIT] === false)
assert('MD sees Cockpit', resolveEffectiveSnapshot(ALL_FALSE, {}, 'md', 'all').effective[COCKPIT] === true)
assert('Developer sees Cockpit', resolveEffectiveSnapshot(ALL_FALSE, {}, 'developer', 'all').effective[COCKPIT] === true)
assert('Cockpit grantable via explicit Allow override (Access Map)', resolveEffectiveSnapshot(ALL_FALSE, { [COCKPIT]: true }, 'ceo', 'all').effective[COCKPIT] === true)

console.log('\nScenario 8 — deny-by-default holds under the LIVE tiered (V2) resolver — any NEW section reaches only Developer/MD:')
// A "new" sidebar section is one added to SECTION_ROUTES, kept OFF the frozen DEFAULT_VISIBLE_SECTIONS
// allowlist (so it auto-lands in RESTRICTED_DEFAULT), and not yet placed in any role template (so it is
// in no tier bundle). Every such section must reach ONLY super admins. Since V2 is now the live
// resolver, we assert this against resolveEffectiveSnapshotV2 for every currently-ungranted restricted
// section — locking in the "hidden for all but Developer/MD by default" guarantee.
// Super-admin templates (admin/developer/md) grant everything, so exclude them: a section is
// "new-like" only if NO ordinary role's template places it (→ it is in no tier bundle for anyone
// but super admins).
const SUPER_ROLES = new Set(['admin', 'developer', 'md'])
const grantedByOrdinaryTemplate = new Set(
  Object.entries(ROLE_PERMISSION_TEMPLATES).filter(([role]) => !SUPER_ROLES.has(role)).flatMap(([, keys]) => keys),
)
const newLike = [...RESTRICTED_DEFAULT_SECTIONS].filter((section) => !grantedByOrdinaryTemplate.has(`${section}.view`))
for (const section of newLike) {
  const vk = `${section}.view`
  assert(`V2: '${section}' hidden from a brand user (service_manager)`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'service_manager', 'kia').effective[vk] !== true)
  assert(`V2: '${section}' hidden from ceo (global non-super)`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'ceo', 'all').effective[vk] !== true)
  assert(`V2: '${section}' hidden from eba`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'eba', 'all').effective[vk] !== true)
  assert(`V2: MD sees '${section}'`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'md', 'all').effective[vk] === true)
  assert(`V2: Developer sees '${section}'`, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'developer', 'all').effective[vk] === true)
}
console.log(`        (checked ${newLike.length} ungranted restricted section(s): ${newLike.join(', ') || 'none'})`)

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
