import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const rows = await sql`SELECT id, full_name, email, phone_number FROM users WHERE is_active = true AND deleted_at IS NULL LIMIT 10`
  console.log('Users:', JSON.stringify(rows, null, 2))

  const tasks = await sql`SELECT id, title, assigned_name, assigned_email, assigned_to, external_contact_id FROM delegation_tasks LIMIT 5`
  console.log('Tasks:', JSON.stringify(tasks, null, 2))

  await sql.end()
}

main().catch(console.error)
