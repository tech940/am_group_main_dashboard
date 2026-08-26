/**
 * An explicit Access-Map grant must NEVER be silently discarded — for any role, any brand, any key.
 *
 *   npm run verify:grant-honoured
 *
 * ── The defect this locks down ────────────────────────────────────────────────────────────────
 * A Service GM at Hyundai was granted `kia.view`, `kia.sales.view` and
 * `kia.payment_window_requests.view`. All three were stored as `allowed = true`. All three resolved
 * to FALSE, because `constrainSnapshotToBranch` ran on `effective` AFTER the overrides merge and
 * zeroed every brand-prefixed key outside the user's own brand. The admin ticked the box, the
 * database agreed, and the resolver deleted the decision — with nothing surfaced anywhere.
 *
 * It was never specific to that role or brand: it voided EVERY cross-brand grant for EVERY user.
 * So this does not test one case; it sweeps the whole matrix — every role × every brand assignment ×
 * every permission key in the registry.
 *
 * Pure: no database, no network.
 */
import {
  PERMISSIONS,
  ROLE_PERMISSION_TEMPLATES,
  type PermissionRole,
} from '../lib/permissions/registry'
import { buildTierRoleDefaults, resolveEffectiveSnapshotForMode } from '../lib/permissions/service'
import { BRANCH_OPTIONS } from '../lib/branches'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures += 1; console.log(`  [FAIL] ${m}`) }
const check = (cond: boolean, m: string) => (cond ? ok(m) : fail(m))

const ROLES = Object.keys(ROLE_PERMISSION_TEMPLATES) as PermissionRole[]
const ALL_KEYS = PERMISSIONS.map((p) => p.key)
/** Single brand, multi-brand, all-brands and unassigned — every shape `users.brand` really takes. */
const BRANDS: (string | null)[] = [
  ...BRANCH_OPTIONS.map((b) => b.value),
  'hyundai,platinum',
  'kia,tata',
  'all',
  null,
  '',
]

const resolve = (role: PermissionRole, brand: string | null, overrides: Record<string, boolean>) =>
  resolveEffectiveSnapshotForMode(buildTierRoleDefaults(role), overrides, role, brand)

console.log(`\n1) Every explicit ALLOW survives — ${ROLES.length} roles × ${BRANDS.length} brand shapes × ${ALL_KEYS.length} keys`)
{
  const broken: string[] = []
  let checked = 0
  for (const role of ROLES) {
    for (const brand of BRANDS) {
      // Grant everything at once: if any layer can delete a grant, it shows up here.
      const overrides = Object.fromEntries(ALL_KEYS.map((k) => [k, true]))
      const snap = resolve(role, brand, overrides)
      for (const key of ALL_KEYS) {
        checked += 1
        if (snap.effective[key] !== true) broken.push(`${role} / ${JSON.stringify(brand)} / ${key}`)
      }
    }
  }
  check(broken.length === 0, `${checked.toLocaleString()} role×brand×key grants all honoured`)
  if (broken.length) {
    console.log(`         ${broken.length} discarded, first 10:`)
    for (const b of broken.slice(0, 10)) console.log(`           - ${b}`)
  }
}

console.log('\n2) The cross-brand case that was actually broken')
{
  /* The live user: service_general_manager, brand 'hyundai', granted KIA-prefixed keys. */
  const snap = resolve('service_general_manager', 'hyundai', {
    'kia.view': true,
    'kia.sales.view': true,
    'kia.approvals.view': true,
    'petty_cash.view': true,
  })
  check(snap.effective['kia.approvals.view'] === true,
    "a Hyundai Service GM granted 'kia.approvals.view' actually gets it")
  check(snap.effective['kia.view'] === true, "…and 'kia.view'")
  check(snap.effective['kia.sales.view'] === true, "…and 'kia.sales.view'")
  check(snap.effective['petty_cash.view'] === true, "…and the non-brand key still works")
}

console.log('\n3) An explicit DENY still wins over everything')
{
  /*
   * The property the old merge order was protecting. Re-applying allows must not resurrect a key an
   * admin deliberately switched off — deny is the whole reason overrides merge last.
   */
  for (const role of ROLES) {
    const snap = resolve(role, 'all', Object.fromEntries(ALL_KEYS.map((k) => [k, false])))
    // md/developer are deliberately unrestrictable — the console lock-out guardrail.
    const expected = role === 'md' || role === 'developer'
    const wrong = ALL_KEYS.filter((k) => snap.effective[k] !== expected)
    if (wrong.length) fail(`${role}: ${wrong.length} key(s) ignored an explicit Deny (e.g. ${wrong[0]})`)
  }
  if (failures === 0) ok(`an explicit Deny is honoured for all ${ROLES.length} roles`)
}

console.log('\n4) Granting nothing still grants nothing (no blanket widening)')
{
  /*
   * The fix must not have turned "constrain" into "grant". With NO overrides, a brand-scoped role
   * must still see none of another brand's keys.
   */
  const snap = resolve('service_general_manager', 'hyundai', {})
  const kiaKeys = ALL_KEYS.filter((k) => k.startsWith('kia.'))
  const leaked = kiaKeys.filter((k) => snap.effective[k] === true)
  check(leaked.length === 0,
    `an ungranted Hyundai Service GM still sees none of the ${kiaKeys.length} kia.* keys`)
  if (leaked.length) console.log(`         leaked: ${leaked.slice(0, 8).join(', ')}`)
}

console.log('\n5) A role list gating a section BESIDE its permission must agree with the templates')
{
  /*
   * The second half of the same symptom: the permission resolves true and a hardcoded ROLE list
   * hides the module anyway — or the reverse. The sidebar needs role AND permission; the page needs
   * role OR an explicit grant. So every role in the list must ALSO carry the key in its template,
   * or the page admits someone the sidebar shows no link to.
   *
   * ⚠️ This is why `service_general_manager` is NOT in PETTY_CASH_VIEW_ROLES. Adding it without the
   * template key creates exactly that desync; adding the template key would hand Petty Cash to every
   * Service GM by default, which is a product decision rather than a bug fix. A Service GM reaches
   * Petty Cash through an explicit Access-Map grant — honoured by the page all along, and now by the
   * sidebar too (hasExplicitGrant).
   */
  const { PETTY_CASH_VIEW_ROLES } = require('../lib/permissions/legacy-module-roles')
  const list: readonly string[] = PETTY_CASH_VIEW_ROLES
  // These resolve through the super-admin / global-access paths, not their own template.
  const RESOLVES_ELSEWHERE = ['developer', 'admin', 'md', 'ea', 'eba']
  const inconsistent = list.filter((role) => {
    if (RESOLVES_ELSEWHERE.includes(role)) return false
    const keys: string[] = (ROLE_PERMISSION_TEMPLATES as Record<string, string[]>)[role] || []
    return !keys.includes('petty_cash.view')
  })
  check(inconsistent.length === 0,
    `every role gated into Petty Cash also carries petty_cash.view (${list.length} roles)`)
  if (inconsistent.length) console.log(`         inconsistent: ${inconsistent.join(', ')}`)
}

console.log('\n6) Approvals is a COMMON section — every brand reaches it BY ROLE, no tick needed')
{
  /*
   * ⚠️ Vendor Payment Approvals is no longer KIA's: every brand files through it and the first
   * stage routes per brand. Its permission group is still `kia.approvals` only because renaming the
   * key would strand 22 live grants (syncPermissionRegistry upserts on `permissions.name`, so a new
   * key = a new row id, while user_permissions.permission_id still points at the old one).
   *
   * Brand constraining used to read that `kia.` prefix and strip the key from every non-KIA user, so
   * a Hyundai accounts/ea whose ROLE TEMPLATE grants it silently got nothing. These assert the
   * DEFAULT path — no overrides at all — because an explicit tick per user is a workaround, not the
   * fix for a section that is supposed to be common.
   */
  const TEMPLATE_HOLDERS = (['ea', 'accounts', 'process_coordinator'] as PermissionRole[])
    .filter((r) => (ROLE_PERMISSION_TEMPLATES[r] || []).includes('kia.approvals.view'))
  check(TEMPLATE_HOLDERS.length > 0, 'some role templates grant kia.approvals.view')
  for (const role of TEMPLATE_HOLDERS) {
    for (const brand of ['hyundai', 'platinum', 'tata', 'kia', 'hyundai,platinum']) {
      const snap = resolve(role, brand, {})
      check(snap.effective['kia.approvals.view'] === true,
        `${role} @ ${brand} reaches Approvals with NO explicit grant`)
    }
  }
  /*
   * Brand-neutral must not leak sideways: a genuinely KIA-only section stays KIA-only.
   */
  const kiaOnly = resolve('accounts', 'hyundai', {})
  check(kiaOnly.effective['kia.sales_report.view'] !== true,
    'a truly KIA-only section is still brand-gated for a Hyundai user')
}

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
