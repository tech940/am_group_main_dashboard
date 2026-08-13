import 'dotenv/config'
import { PERMISSIONS, ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot } from '../lib/permissions/service'

/**
 * If the 14 BE routes started enforcing their sub-permission instead of only the parent
 * `kia.business_excellence.view`, WHO would lose access to WHAT?
 *
 * This is the question that decides whether wiring them up is a fix or a mass lockout.
 */

const SUBS = [
  'kia.business_excellence.ro_billing.view',
  'kia.business_excellence.workshop_performance.view',
  'kia.business_excellence.open_ro.view',
  'kia.business_excellence.complaints.view',
  'kia.business_excellence.rsa.view',
  'kia.business_excellence.ew.view',
  'kia.business_excellence.mcp.view',
]
const PARENT = 'kia.business_excellence.view'

const allKeys = (PERMISSIONS as Array<{ key: string }>).map((p) => p.key)
const roles = Object.keys(ROLE_PERMISSION_TEMPLATES)

const missing = SUBS.filter((s) => !allKeys.includes(s))
if (missing.length) console.log('⚠ keys absent from the registry:', missing.join(', '), '\n')

const snapshotFor = (role: string, branchAccess: string | null) => {
  const base = Object.fromEntries(allKeys.map((k) => [k, false])) as Record<string, boolean>
  for (const key of ROLE_PERMISSION_TEMPLATES[role as keyof typeof ROLE_PERMISSION_TEMPLATES] || []) {
    if (key in base) base[key] = true
  }
  return resolveEffectiveSnapshot(base, {}, role as never, branchAccess).effective
}

console.log('role                        parent  children-held   → effect of enforcing')
console.log('-'.repeat(88))
let losers = 0
for (const role of roles) {
  const eff = snapshotFor(role, null)
  if (eff[PARENT] !== true) continue // can't see the section at all today; unaffected
  const held = SUBS.filter((s) => eff[s] === true)
  const lost = SUBS.filter((s) => eff[s] !== true)
  const verdict = lost.length === 0
    ? 'no change'
    : `LOSES ${lost.length}: ${lost.map((s) => s.split('.').slice(2, -1).join('.')).join(', ')}`
  if (lost.length) losers++
  console.log(`${role.padEnd(26)}  yes     ${String(held.length).padStart(2)}/7           → ${verdict}`)
}
console.log('-'.repeat(88))
console.log(`roles that can see BE today: counted above · roles that would LOSE something: ${losers}`)
console.log('\n(Branch-scoped presets in lib/branch-module-access.ts narrow this further and are the')
console.log(' whole point of the feature — a branch_customer_ops user SHOULD lose everything but complaints.)')
