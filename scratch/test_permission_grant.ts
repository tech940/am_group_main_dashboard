import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq, isNull } from 'drizzle-orm'
import { getUserPermissionSnapshot } from '@/lib/permissions/service'
import { canUserAccessSection, ALL_SECTIONS } from '@/lib/navigation/sections'

async function run() {
  // Find a non-superadmin user (e.g. role manager or assistant_manager)
  const testUsers = await db.select({
    id: users.id,
    email: users.email,
    role: users.role,
    brand: users.brand,
  }).from(users).where(isNull(users.deletedAt)).limit(10)

  console.log('--- Test Users ---')
  console.table(testUsers)

  for (const u of testUsers) {
    if (u.role === 'developer' || u.role === 'md') continue
    console.log(`\nTesting user: ${u.email} (Role: ${u.role}, Brand: ${u.brand})`)
    const snapshot = await getUserPermissionSnapshot(u.id)

    // Check which sections canUserAccessSection returns true for
    const accessible = ALL_SECTIONS.filter((sec) =>
      canUserAccessSection(sec, u.role, u.brand, snapshot.effective)
    )
    console.log(`User can access ${accessible.length} / ${ALL_SECTIONS.length} sections:`)
    console.log(accessible.map((s) => `${s.name} (${s.href})`).join(', '))
  }

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
