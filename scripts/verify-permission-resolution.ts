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
import { PERMISSIONS } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot } from '../lib/permissions/service'

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

console.log('\nScenario 5 — Kia user cannot reach another brand:')
const s5 = resolveEffectiveSnapshot(ALL_FALSE, { [OTHER_BRAND_KEY]: true }, ROLE, BRAND)
assert(`"${OTHER_BRAND_KEY}" stays denied (branch-scoped out)`, s5.effective[OTHER_BRAND_KEY] === false, `effective=${s5.effective[OTHER_BRAND_KEY]}`)

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
