import 'dotenv/config'
import { PERMISSIONS, PERMISSION_GROUPS, ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshot } from '../lib/permissions/service'

/**
 * What would "a granted parent implies its children" actually change?
 *
 * Access changes are the one class of edit that must be measured, not reasoned about — widening a
 * permission silently is how people end up seeing another branch's money. This computes, per role,
 * every key that would flip false -> true, BEFORE any code is changed.
 */

// The hierarchy lives on GROUPS; a permission key is `<groupKey>.<action>`. So a child group's
// `.view` should follow its parent group's `.view`.
const childToParent = new Map<string, string>()
for (const g of PERMISSION_GROUPS as Array<{ key: string; parentKey?: string | null; actions: string[] }>) {
  if (!g.parentKey) continue
  for (const action of g.actions) {
    childToParent.set(`${g.key}.${action}`, `${g.parentKey}.${action}`)
  }
}

const allKeys = (PERMISSIONS as Array<{ key: string }>).map((p) => p.key)
const roles = Object.keys(ROLE_PERMISSION_TEMPLATES)

console.log(`registry: ${allKeys.length} permissions, ${childToParent.size} with a parent, ${roles.length} roles\n`)

let totalFlips = 0
const perRole: { role: string; flips: string[] }[] = []

for (const role of roles) {
  const base = Object.fromEntries(allKeys.map((k) => [k, false])) as Record<string, boolean>
  for (const key of ROLE_PERMISSION_TEMPLATES[role as keyof typeof ROLE_PERMISSION_TEMPLATES] || []) {
    if (key in base) base[key] = true
  }
  // Current behaviour, no overrides, no branch scoping.
  const before = resolveEffectiveSnapshot(base, {}, role as never, null).effective

  // Proposed: a child defaults to its parent's value (repeat to settle multi-level chains).
  const withInheritance = { ...base }
  for (let pass = 0; pass < 3; pass++) {
    for (const [child, parent] of childToParent) {
      if (withInheritance[parent] === true && withInheritance[child] !== true) withInheritance[child] = true
    }
  }
  const after = resolveEffectiveSnapshot(withInheritance, {}, role as never, null).effective

  const flips = allKeys.filter((k) => before[k] !== true && after[k] === true)
  if (flips.length) {
    perRole.push({ role, flips })
    totalFlips += flips.length
  }
}

perRole.sort((a, b) => b.flips.length - a.flips.length)
for (const { role, flips } of perRole) {
  console.log(`${role.padEnd(26)} +${String(flips.length).padStart(3)} keys`)
  console.log(`   ${flips.slice(0, 8).join(', ')}${flips.length > 8 ? ` … +${flips.length - 8} more` : ''}`)
}

console.log(`\nroles affected: ${perRole.length}/${roles.length} · total grants added: ${totalFlips}`)
if (perRole.length === 0) console.log('=> NO-OP: every template already grants children wherever it grants the parent.')
