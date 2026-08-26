import { PERMISSIONS, RESTRICTED_DEFAULT_SECTIONS } from '../lib/permissions/registry'
import { resolveEffectiveSnapshotForMode } from '../lib/permissions/service'

const ALL_FALSE = Object.fromEntries(PERMISSIONS.map(p => [p.key, false])) as Record<string, boolean>
// Stand-ins for a NEW restricted-by-default section: use two existing restricted keys,
// one COMMON (non-brand-prefixed) and one brand-prefixed.
const COMMON = 'bank_sanctions.view'      // top-level, restricted-by-default
const BRANDED = 'kia.customer_profile.view'
console.log('bank_sanctions restricted?', RESTRICTED_DEFAULT_SECTIONS.has('bank_sanctions'))
console.log('kia.customer_profile restricted?', RESTRICTED_DEFAULT_SECTIONS.has('kia.customer_profile'))
for (const role of ['admin','hr','ceo','ea','eba','manager','sales_manager','viewer','accounts'] as any[]) {
  for (const brand of [null, 'kia']) {
    const s = resolveEffectiveSnapshotForMode(ALL_FALSE, {}, role, brand)
    console.log(`${role.padEnd(15)} brand=${String(brand).padEnd(5)}  ${COMMON}=${s.effective[COMMON]}  ${BRANDED}=${s.effective[BRANDED]}`)
  }
}
