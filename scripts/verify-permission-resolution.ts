/**
 * Unit-verifies the Phase 1 "Deny wins" resolution rules against the REAL, exported
 * `resolveEffectiveSnapshot` — no database required. Proves:
 *   1. A brand user gets their brand's sections by default (brand default preserved).
 *   2. An explicit Deny override now wins over that brand default (the whole point).
 *   3. Reset-to-inherit (no override) returns to the brand default.
 *   4. A Super Admin (developer) ignores a Deny (absolute access).
 *   5. A user is still constrained out of other brands' sections.
 *
 * Run:  npm run verify:permissions
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { PERMISSIONS, PERMISSION_GROUPS, SECTION_ROUTES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot } from '../lib/permissions/service'
import { ALL_SECTIONS, canUserAccessSection } from '../lib/navigation/sections'

let failures = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? `  — ${detail}` : ''}`)
}

const ALL_FALSE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>

// Non-sensitive brand sections (sales_report/stock_report are role-gated, so not usable here).
const BRAND_KEY = 'kia.business_excellence.view'
const SIBLING_KEY = 'kia.service_appointment.view'
const OTHER_BRAND_KEY = 'hyundai.service_appointment.view'

for (const k of [BRAND_KEY, SIBLING_KEY, OTHER_BRAND_KEY]) {
  if (!(k in ALL_FALSE)) throw new Error(`Test key "${k}" is not a real permission; update the test.`)
}

console.log('\n=== Phase 1 resolution: "Deny wins" (pure, no DB) ===\n')

// A brand-scoped, non-global, non-super role whose access comes purely from the brand default.
const ROLE = 'service_manager' as const
const BRAND = 'kia'

console.log('Scenario 1 — Kia user, no overrides:')
const s1 = resolveEffectiveSnapshot(ALL_FALSE, {}, ROLE, BRAND)
assert(`"${BRAND_KEY}" visible by brand default`, s1.effective[BRAND_KEY] === true, `effective=${s1.effective[BRAND_KEY]}`)
assert(`"${SIBLING_KEY}" visible by brand default`, s1.effective[SIBLING_KEY] === true)

console.log('\nScenario 2 — Kia user with an explicit Deny on one section:')
const s2 = resolveEffectiveSnapshot(ALL_FALSE, { [BRAND_KEY]: false }, ROLE, BRAND)
assert(`"${BRAND_KEY}" Deny WINS over brand default`, s2.effective[BRAND_KEY] === false, `effective=${s2.effective[BRAND_KEY]}`)
assert(`sibling "${SIBLING_KEY}" unaffected (still visible)`, s2.effective[SIBLING_KEY] === true)

console.log('\nScenario 3 — reset to inherit (override removed):')
const s3 = resolveEffectiveSnapshot(ALL_FALSE, {}, ROLE, BRAND)
assert(`"${BRAND_KEY}" back to visible (brand default)`, s3.effective[BRAND_KEY] === true)

console.log('\nScenario 4 — Super Admin (developer) with a Deny:')
const s4 = resolveEffectiveSnapshot(ALL_FALSE, { [BRAND_KEY]: false }, 'developer', BRAND)
assert(`Super Admin ignores Deny (absolute access)`, s4.effective[BRAND_KEY] === true, `effective=${s4.effective[BRAND_KEY]}`)

console.log('\nScenario 5 — another brand is out of reach BY DEFAULT:')
const s5a = resolveEffectiveSnapshot(ALL_FALSE, {}, ROLE, BRAND)
assert(`"${OTHER_BRAND_KEY}" denied with no override (branch-scoped out)`, s5a.effective[OTHER_BRAND_KEY] === false, `effective=${s5a.effective[OTHER_BRAND_KEY]}`)

console.log('\nScenario 5b — …but an EXPLICIT grant crosses it, on purpose:')
/*
 * ⚠️ THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, and the change is deliberate.
 *
 * It previously demanded that an explicit `allowed = true` on another brand's key still resolve to
 * FALSE. That is not a safety property, it is the bug: an admin ticked a box, `user_permissions`
 * recorded the decision, and the resolver deleted it with no feedback anywhere. Measured live — a
 * Service GM at Hyundai granted three kia.* keys received none of them, and it silently voided
 * EVERY cross-brand grant for EVERY user.
 *
 * Brand scoping is a DEFAULT (it shapes roleDefaults — still asserted in 5a above). An override is
 * a DECISION about one user and one key, and a default must not overrule a decision. Same principle
 * as isPermissionExplicitlyAllowed in lib/permissions/deny.ts.
 *
 * The DATA stays scoped regardless: sections carry their own row-level branch filters
 * (lib/kia/approval-scope.ts, lib/petty-cash/access.ts, bankSanctionVisibility), so this opens the
 * SECTION for one named user — it does not hand them another dealership's rows.
 */
const s5 = resolveEffectiveSnapshot(ALL_FALSE, { [OTHER_BRAND_KEY]: true }, ROLE, BRAND)
assert(`"${OTHER_BRAND_KEY}" explicitly granted is HONOURED, not silently dropped`, s5.effective[OTHER_BRAND_KEY] === true, `effective=${s5.effective[OTHER_BRAND_KEY]}`)
const s5c = resolveEffectiveSnapshot(ALL_FALSE, { [OTHER_BRAND_KEY]: false }, ROLE, BRAND)
assert(`an explicit Deny on another brand’s key still denies`, s5c.effective[OTHER_BRAND_KEY] === false, `effective=${s5c.effective[OTHER_BRAND_KEY]}`)

async function liveDatabaseCheck() {
  if (!process.env.DATABASE_URL) {
    console.log('\n[SKIP] DATABASE_URL not set — live sync test skipped.')
    return
  }

  console.log('\nScenario 6 — Live database permission sync:')
  try {
    const { ensurePermissionRegistrySynced } = await import('../lib/permissions/service')
    await ensurePermissionRegistrySynced()
    assert('ensurePermissionRegistrySynced completes without error', true)
  } catch (err: any) {
    assert('ensurePermissionRegistrySynced completes without error', false, err?.message || String(err))
  }
}

/**
 * Scenario 7 — An Access-Map grant reaches the SCREEN and the DOOR, not just the snapshot.
 *
 * ⚠️ THE DEFECT THIS GUARDS. `resolveEffectiveSnapshot` has honoured explicit grants for a while, but
 * two layers OUTSIDE it did not, and either one alone made a grant look like it had never been made:
 *
 *   · `canUserAccessSection` refused any cross-brand section before it ever looked at the permission
 *     key, so the link appeared in neither the sidebar nor search;
 *   · the sidebar dropped the entire brand accordion, so even a visible row had no container;
 *   · `getBrandAccess` — a pure string compare against the user's `brand` column — threw the user out
 *     of the page with `forbidden()` after `requirePermission` had already said yes.
 *
 * A DEFAULT (which brand you belong to) must not overrule a DECISION (this person may see this).
 */
function grantReachTests() {
  console.log('\nScenario 7 — an Access-Map grant survives the brand gates:')

  const HYUNDAI_USER = { role: 'accounts' as const, brand: 'hyundai' }
  const KIA_SECTION = ALL_SECTIONS.find((section) => section.href === '/brands/kia/sales-report')
  const OTHER_KIA_SECTION = ALL_SECTIONS.find((section) => section.href === '/brands/kia/stock-report')

  assert('the fixture sections exist', Boolean(KIA_SECTION && OTHER_KIA_SECTION))
  if (!KIA_SECTION || !OTHER_KIA_SECTION) return

  /*
   * The map a granted user actually carries: the resolver zeroes every cross-brand default, so the
   * ONLY key that can read true here is the one an admin ticked.
   */
  const granted: Record<string, boolean> = { 'kia.sales_report.view': true }
  const nothingGranted: Record<string, boolean> = {}

  assert('without a grant, a cross-brand section stays hidden',
    !canUserAccessSection(KIA_SECTION, HYUNDAI_USER.role, HYUNDAI_USER.brand, nothingGranted))

  assert('WITH a grant, the cross-brand section becomes visible',
    canUserAccessSection(KIA_SECTION, HYUNDAI_USER.role, HYUNDAI_USER.brand, granted))

  /*
   * ⚠️ THE SAFETY PROPERTY. Opening the brand door must not open the brand. A user granted one KIA
   * section must still be refused every KIA section nobody ticked — otherwise one tick silently hands
   * over a whole brand.
   */
  assert('a grant on ONE section does not reveal the rest of that brand',
    !canUserAccessSection(OTHER_KIA_SECTION, HYUNDAI_USER.role, HYUNDAI_USER.brand, granted))

  // A null map means the permission snapshot is still loading; it must fail closed, not open.
  assert('a still-loading permission map never counts as a grant',
    !canUserAccessSection(KIA_SECTION, HYUNDAI_USER.role, HYUNDAI_USER.brand, null))

  // ⚠️ An explicit Deny must still beat everything — the property the merge order exists to protect.
  assert('an explicit deny on the granted key hides it again',
    !canUserAccessSection(KIA_SECTION, HYUNDAI_USER.role, HYUNDAI_USER.brand, { 'kia.sales_report.view': false }))

  /*
   * The server-side door. `hasExplicitBrandGrant` reads `overrides` and not `effective` — keying off
   * `effective` would turn "belongs to brand X" into "any role whose template mentions brand X",
   * which is most of them.
   */
  const denySource = readFileSync('lib/permissions/deny.ts', 'utf8')
  assert('hasExplicitBrandGrant exists and reads overrides, never effective',
    /export async function hasExplicitBrandGrant/.test(denySource)
    && /snapshot\.overrides/.test(denySource.slice(denySource.indexOf('hasExplicitBrandGrant')))
    && !/snapshot\.effective/.test(denySource.slice(denySource.indexOf('hasExplicitBrandGrant'))))

  const brandSource = readFileSync('lib/auth/brand-access.ts', 'utf8')
  assert('getBrandAccess consults the grant when the brand check fails',
    /hasExplicitBrandGrant\(appUser, normalizedBrand\)/.test(brandSource))
  // ⚠️ Only AFTER the plain check fails, so a same-brand page costs no extra query.
  assert('and only after it fails, so the common path is unchanged',
    brandSource.indexOf('if (canAccessBrand(appUser, normalizedBrand))') <
      brandSource.indexOf('hasExplicitBrandGrant(appUser, normalizedBrand)'))

  const sidebarSource = readFileSync('components/layout/sidebar.tsx', 'utf8')
  assert('the sidebar keeps a brand card when something inside it is visible',
    /brand\.sections\.some\(\(section\) => \(/.test(sidebarSource))
}

/**
 * Scenario 8 — the Access Map and the sidebar call every section the SAME thing.
 *
 * ⚠️ WHY THIS IS A REAL BUG AND NOT PEDANTRY. An admin ticking a box and a user hunting for the link
 * have to be talking about one thing. When `kia.sales_performance` was relabelled "Sales Target Plan"
 * in the sidebar and left as "Sales Performance" in the permission registry, the reported symptom was
 * "sales target is not added in KIA" — the column was right there, under a name nobody was looking
 * for. Three more had drifted the same way: Kia Proforma / Bookings, Follow-ups / Booking Follow-ups,
 * Call & Follow-up Analytics / Call Analytics.
 *
 * ⚠️ Compares NAMES ONLY. A permission KEY must never be renamed to match a label — that orphans
 * every grant already stored against it.
 */
function labelParityTests() {
  console.log('\nScenario 8 — Access Map column names match the sidebar:')

  /*
   * Every { name, href } the sidebar renders. Walk each `href:` and take the NEAREST PRECEDING
   * `name:` — the object shapes vary (one-line submenus, multi-line brand objects with logo/colour
   * fields in between), so a single shape-matching regex misses about a third of them.
   */
  const src = readFileSync('components/layout/sidebar.tsx', 'utf8')
  const lines = src.split('\n')
  const sidebar = new Map<string, string>()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('//')) continue
    const href = /href:\s*'([^']+)'/.exec(lines[i])
    if (!href || !href[1].startsWith('/')) continue
    let name: string | null = null
    const same = /name:\s*'([^']+)'/.exec(lines[i])
    if (same) name = same[1]
    else {
      for (let j = i; j >= 0 && j > i - 12; j--) {
        if (lines[j].trim().startsWith('//')) continue
        const m = /name:\s*'([^']+)'/.exec(lines[j])
        if (m) { name = m[1]; break }
      }
    }
    if (name && !sidebar.has(href[1])) sidebar.set(href[1], name)
  }
  assert('the sidebar tree could be read', sidebar.size > 20, `${sidebar.size} labels`)

  const routes = SECTION_ROUTES as Record<string, { href: string; aliases?: string[] }>
  const mismatched: string[] = []
  let compared = 0
  for (const group of PERMISSION_GROUPS as { key: string; name: string }[]) {
    const route = routes[group.key]
    if (!route) continue
    const label = sidebar.get(route.href)
      ?? (route.aliases || []).map((alias) => sidebar.get(alias)).find(Boolean)
    if (!label) continue   // no sidebar link: nothing to be inconsistent with
    compared += 1
    if (label.trim() !== String(group.name).trim()) {
      mismatched.push(`${group.key}: map "${group.name}" vs sidebar "${label}"`)
    }
  }
  assert('something was actually compared', compared > 10, `${compared} linked sections`)
  assert('every linked section has ONE name in both places',
    mismatched.length === 0, mismatched.join(' | '))
  console.log(`  [INFO] ${compared} section(s) carry both a sidebar link and a permission group`)
}

async function run() {
  labelParityTests()
  grantReachTests()
  await liveDatabaseCheck()
  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}

run()

