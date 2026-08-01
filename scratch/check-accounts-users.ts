import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { or, ilike, eq } from 'drizzle-orm'

async function checkAccountsUsers() {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      brand: users.brand,
      dealers: users.dealers,
    })
    .from(users)
    .where(
      or(
        eq(users.role, 'accounts'),
        eq(users.role, 'finance_head'),
        eq(users.role, 'finance_team')
      )
    )

  console.log('Accounts/Finance users in DB:', rows)
  process.exit(0)
}

checkAccountsUsers().catch(console.error)
