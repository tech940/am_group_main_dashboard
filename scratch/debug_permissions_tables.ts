import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import {
  ensurePermissionRegistrySynced,
  getPermissionCatalog,
  getUserPermissionSnapshot,
} from '@/lib/permissions/service'

async function debugPermissions() {
  console.log('--- 1. Checking table existence in PostgreSQL ---')
  const tablesResult: any = await db.execute(sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name IN (
      'permissions', 
      'user_permission_overrides', 
      'permission_audit_logs', 
      'permission_groups', 
      'permission_roles'
    )
  `)
  const tables = Array.isArray(tablesResult) ? tablesResult : (tablesResult.rows || [])
  console.log('Found permission tables:', tables.map((t: any) => t.table_name))

  console.log('\n--- 2. Checking row counts in permission tables ---')
  for (const t of ['permissions', 'user_permission_overrides', 'permission_audit_logs']) {
    try {
      const countResult: any = await db.execute(sql.raw(`SELECT COUNT(*) FROM ${t}`))
      const c = (Array.isArray(countResult) ? countResult : countResult.rows)[0].count
      console.log(`Table ${t}: ${c} rows`)
    } catch (err: any) {
      console.error(`Table ${t} check failed:`, err.message)
    }
  }

  console.log('\n--- 3. Running ensurePermissionRegistrySynced() ---')
  try {
    await ensurePermissionRegistrySynced()
    console.log('✓ ensurePermissionRegistrySynced() completed successfully')
  } catch (err: any) {
    console.error('ensurePermissionRegistrySynced() failed:', err)
  }

  console.log('\n--- 4. Checking permission catalog ---')
  try {
    const catalog = await getPermissionCatalog()
    console.log(`Catalog contains ${catalog.permissions.length} permissions across ${catalog.groups.length} groups`)
  } catch (err: any) {
    console.error('getPermissionCatalog() failed:', err)
  }

  process.exit(0)
}

debugPermissions()
