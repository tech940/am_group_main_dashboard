/* TEMP probe — JS cost of the statements ensurePermissionRegistrySynced() builds.
   It is throttled to once per 10-min PROCESS window, so on Vercel (instances rarely live that
   long) it effectively runs ONCE PER COLD START — i.e. on the exact invocation already paying
   ~450ms of module eval. Measures drizzle QUERY BUILDING only (no DB round trip). */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { permissionGroups, permissions, rolePermissions } from '@/lib/db/schema'
import { PERMISSION_GROUPS, PERMISSIONS, ROLE_PERMISSION_TEMPLATES, type PermissionRole } from '@/lib/permissions/registry'
import { config } from 'dotenv'
config({ quiet: true })

function bench(label: string, iters: number, fn: () => unknown) {
  for (let i = 0; i < Math.min(iters, 20); i++) fn()
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  console.log('  ' + label.padEnd(48) + (ms / iters).toFixed(3).padStart(9) + ' ms/op')
  return ms / iters
}

const now = new Date()

// Mirror syncPermissionRegistry() exactly.
const groupValues = PERMISSION_GROUPS.map((g) => ({
  key: g.key, name: g.name, parentKey: g.parentKey, description: g.description,
  sortOrder: g.sortOrder, isActive: true, updatedAt: now,
}))
const permValues = PERMISSIONS.map((p) => ({
  name: p.key, groupKey: p.groupKey, label: p.label, description: p.description,
  resource: p.resource, action: p.action, sortOrder: p.sortOrder, isActive: true, updatedAt: now,
}))

// The role_permissions seed: one row per (role, permission) in every role template.
const fakeId = '00000000-0000-0000-0000-000000000000'
const rolePermValues = Object.entries(ROLE_PERMISSION_TEMPLATES)
  .flatMap(([role, keys]) => keys.map(() => ({
    role: role as PermissionRole, permissionId: fakeId, allowed: true, updatedAt: now,
  })))

console.log('=== rows built per registry sync ===')
console.log('  permission_groups rows :', groupValues.length)
console.log('  permissions rows       :', permValues.length)
console.log('  role_permissions rows  :', rolePermValues.length, ' (params ~' + rolePermValues.length * 4 + ')')
console.log('  total INSERT params    : ~' + (groupValues.length * 7 + permValues.length * 9 + rolePermValues.length * 4))
console.log()

console.log('=== drizzle query BUILD cost (pure JS, no DB) ===')
bench('build groups upsert (87 rows)', 200, () =>
  db.insert(permissionGroups).values(groupValues).onConflictDoUpdate({
    target: permissionGroups.key,
    set: { name: sql`excluded.name`, parentKey: sql`excluded.parent_key`, description: sql`excluded.description`, sortOrder: sql`excluded.sort_order`, isActive: true, updatedAt: now },
  }).toSQL()
)
bench('build permissions upsert (143 rows)', 200, () =>
  db.insert(permissions).values(permValues).onConflictDoUpdate({
    target: permissions.name,
    set: { groupKey: sql`excluded.group_key`, label: sql`excluded.label`, description: sql`excluded.description`, resource: sql`excluded.resource`, action: sql`excluded.action`, sortOrder: sql`excluded.sort_order`, isActive: true, updatedAt: now },
  }).toSQL()
)
bench('build role_permissions seed insert', 200, () =>
  db.insert(rolePermissions).values(rolePermValues).onConflictDoNothing({
    target: [rolePermissions.role, rolePermissions.permissionId],
  }).toSQL()
)
bench('build rolePermValues array (flatMap)', 500, () =>
  Object.entries(ROLE_PERMISSION_TEMPLATES).flatMap(([role, keys]) => keys.map(() => ({
    role: role as PermissionRole, permissionId: fakeId, allowed: true, updatedAt: now,
  })))
)

const q = db.insert(rolePermissions).values(rolePermValues).onConflictDoNothing({
  target: [rolePermissions.role, rolePermissions.permissionId],
}).toSQL()
console.log()
console.log('  role_permissions SQL text length:', q.sql.length, 'chars; params:', q.params.length)
process.exit(0)
