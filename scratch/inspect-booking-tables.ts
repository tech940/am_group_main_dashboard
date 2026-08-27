import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  const eaUsers = await sql`
    SELECT id, email, full_name, role::text, brand, is_active
    FROM users 
    WHERE role::text = 'ea' OR role::text = 'eba' OR email ILIKE '%ea%'
  `
  console.log('EA Users:\n', eaUsers)

  for (const u of eaUsers) {
    const overrides = await sql`
      SELECT * FROM user_permission_overrides WHERE user_id = ${u.id}
    `
    console.log(`Overrides for ${u.email} (${u.role}):\n`, overrides)
  }

  await sql.end()
}

main().catch(console.error)
