import { db } from './lib/db'
import { sql } from 'drizzle-orm'

async function check() {
  const result = await db.execute(sql`
    SELECT rp.role, p.name as permission, rp.allowed
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role = 'general_manager' AND p.name LIKE 'kia.proforma%'
  `)
  console.log('Role permissions for general_manager:')
  console.log(result)
}

check().catch(console.error)
