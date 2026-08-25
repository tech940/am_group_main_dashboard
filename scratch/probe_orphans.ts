import 'dotenv/config'
import { db } from '../lib/db'
import { permissionGroups, permissions } from '../lib/db/schema'
import { eq } from 'drizzle-orm'
import { PERMISSION_GROUPS, PERMISSIONS, SECTION_ROUTES } from '../lib/permissions/registry'

async function main() {
  const groupRows = await db.select({ key: permissionGroups.key }).from(permissionGroups).where(eq(permissionGroups.isActive, true))
  const permRows = await db.select({ name: permissions.name }).from(permissions).where(eq(permissions.isActive, true))

  const codeGroups = new Set(PERMISSION_GROUPS.map((g) => g.key))
  const codePerms = new Set(PERMISSIONS.map((p) => p.key))
  const dbGroups = new Set(groupRows.map((r) => r.key))
  const dbPerms = new Set(permRows.map((r) => r.name))

  const orphanGroups = [...dbGroups].filter((k) => !codeGroups.has(k)).sort()
  const orphanPerms = [...dbPerms].filter((k) => !codePerms.has(k)).sort()
  const missingGroups = [...codeGroups].filter((k) => !dbGroups.has(k)).sort()

  console.log(`code groups ${codeGroups.size} | db active groups ${dbGroups.size}`)
  console.log(`\nORPHANS (active in DB, GONE from code) - ${orphanGroups.length}: ${orphanGroups.join(', ') || 'none'}`)
  console.log(`orphan permission rows - ${orphanPerms.length}: ${orphanPerms.join(', ') || 'none'}`)
  console.log(`\nMISSING (in code, NOT active in DB) - ${missingGroups.length}: ${missingGroups.join(', ') || 'none'}`)

  // Which SECTION_ROUTES keys have no catalog group at all -> silently no column
  const routeNoGroup = Object.keys(SECTION_ROUTES).filter((k) => !dbGroups.has(k)).sort()
  console.log(`\nSECTION_ROUTES keys with NO active DB group (would silently lose their column) - ${routeNoGroup.length}: ${routeNoGroup.join(', ') || 'none'}`)

  // Actual Access Map columns = intersection
  const routeKeys = new Set(Object.keys(SECTION_ROUTES))
  const FANOUT = new Set(['access_control', 'admin_audit', 'dashboard_settings'])
  const columns = [...dbGroups].filter((k) => routeKeys.has(k) || FANOUT.has(k))
  const HIDDEN = new Set(['access_control', 'admin_audit', 'dashboard_settings', 'kia.bookings'])
  const rendered = columns.filter((k) => !HIDDEN.has(k))
  console.log(`\nserver sends ${columns.length} sections -> UI renders ${rendered.length} columns`)
  console.log(`admin columns rendered: ${rendered.filter((k) => ['user_management','access_control','admin_audit','dashboard_settings'].includes(k)).join(', ') || 'NONE'}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
