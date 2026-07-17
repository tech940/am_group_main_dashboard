/* TEMP perf probe — measures PURE-JS cost of permission resolution. No DB. */
import { PERMISSIONS, PERMISSION_GROUPS, ROLE_PERMISSION_TEMPLATES, RESTRICTED_DEFAULT_PERMISSION_KEYS } from '@/lib/permissions/registry'
import { resolveEffectiveSnapshot, resolveEffectiveSnapshotV2, buildTierRoleDefaults } from '@/lib/permissions/service'

function bench(label: string, iters: number, fn: () => unknown) {
  // warm
  for (let i = 0; i < Math.min(iters, 200); i++) fn()
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  const t1 = process.hrtime.bigint()
  const totalMs = Number(t1 - t0) / 1e6
  console.log(`${label.padEnd(52)} ${(totalMs / iters).toFixed(4)} ms/op   (${iters} iters, ${totalMs.toFixed(1)} ms total)`)
  return totalMs / iters
}

console.log('=== REGISTRY SIZE ===')
console.log('PERMISSION_GROUPS      :', PERMISSION_GROUPS.length)
console.log('PERMISSIONS (keys)     :', PERMISSIONS.length)
console.log('RESTRICTED_DEFAULT_KEYS:', RESTRICTED_DEFAULT_PERMISSION_KEYS.size)
console.log('ROLES                  :', Object.keys(ROLE_PERMISSION_TEMPLATES).length)
console.log()

// Build a realistic base: DB role defaults for a typical brand role.
const baseFor = (role: string) => {
  const base: Record<string, boolean> = {}
  for (const p of PERMISSIONS) base[p.key] = false
  for (const k of (ROLE_PERMISSION_TEMPLATES as Record<string, string[]>)[role] || []) if (k in base) base[k] = true
  return base
}

const cases: Array<[string, string, string | null]> = [
  ['sales_manager / kia', 'sales_manager', 'kia'],
  ['sales_executive / kia', 'sales_executive', 'kia'],
  ['general_manager / kia', 'general_manager', 'kia'],
  ['md / all', 'md', 'all'],
  ['ceo (global) / all', 'ceo', 'all'],
  ['viewer / kia', 'viewer', 'kia'],
]

console.log('=== resolveEffectiveSnapshotV2 (live resolver, PERMISSIONS_RESOLVER unset) ===')
for (const [label, role, brand] of cases) {
  const base = baseFor(role)
  bench(`V2 ${label}`, 2000, () => resolveEffectiveSnapshotV2(base, {}, role as never, brand))
}
console.log()
console.log('=== component breakdown (sales_manager / kia) ===')
{
  const base = baseFor('sales_manager')
  bench('buildTierRoleDefaults', 5000, () => buildTierRoleDefaults('sales_manager' as never))
  bench('resolveEffectiveSnapshot (V1 only)', 5000, () => resolveEffectiveSnapshot(base, {}, 'sales_manager' as never, 'kia'))
}
console.log()
console.log('=== ceo/global path (hits isAdminOnlyPermission per key => O(n^2)) ===')
{
  const base = baseFor('ceo')
  bench('V2 ceo / all', 2000, () => resolveEffectiveSnapshotV2(base, {}, 'ceo' as never, 'all'))
}
console.log()

const snap = resolveEffectiveSnapshotV2(baseFor('sales_manager'), {}, 'sales_manager' as never, 'kia')
const json = JSON.stringify(snap)
console.log('=== snapshot payload ===')
console.log('effective keys   :', Object.keys(snap.effective).length)
console.log('roleDefaults keys:', Object.keys(snap.roleDefaults).length)
console.log('JSON bytes       :', Buffer.byteLength(json))
bench('JSON.stringify(snapshot)', 5000, () => JSON.stringify(snap))
bench('JSON.parse(snapshotJson)', 5000, () => JSON.parse(json))
