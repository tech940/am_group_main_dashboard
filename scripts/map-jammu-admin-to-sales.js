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
  
  console.log('[Map-Department] Updating allocations for Jammu ADMIN -> Sales...')
  const res1 = await sql`
    UPDATE public.petty_cash_allocations
    SET department = 'Sales'
    WHERE department ILIKE 'admin%' OR department ILIKE 'aadmin%'
  `
  console.log(`[Map-Department] Updated ${res1.count} allocation rows.`)

  console.log('[Map-Department] Updating expenses for Jammu ADMIN -> Sales...')
  const res2 = await sql`
    UPDATE public.petty_cash_expenses
    SET department = 'Sales'
    WHERE department ILIKE 'admin%' OR department ILIKE 'aadmin%'
  `
  console.log(`[Map-Department] Updated ${res2.count} expense rows.`)

  await sql.end()
}

main().catch(console.error)
