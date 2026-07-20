const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function getDbUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const sql = postgres(getDbUrl(), { ssl: { rejectUnauthorized: false }, prepare: false })
  
  console.log('[Clear-Delegation] Deleting delegation_task_activity...')
  const act = await sql`TRUNCATE TABLE public.delegation_task_activity CASCADE`
  console.log('[Clear-Delegation] Truncated delegation_task_activity.')

  console.log('[Clear-Delegation] Deleting delegation_tasks...')
  const tasks = await sql`TRUNCATE TABLE public.delegation_tasks CASCADE`
  console.log('[Clear-Delegation] Truncated delegation_tasks.')

  console.log('[Clear-Delegation] Deleting delegation_contacts...')
  const contacts = await sql`TRUNCATE TABLE public.delegation_contacts CASCADE`
  console.log('[Clear-Delegation] Truncated delegation_contacts.')

  console.log('[Clear-Delegation] All delegation tasks data cleared successfully!')
  await sql.end()
}

main().catch(console.error)
