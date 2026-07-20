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
  
  console.log('--- Checking Requests ---')
  const reqs = await sql`SELECT id, request_number, department, requested_by_name, request_form FROM petty_cash_requests`
  console.log('Requests:', JSON.stringify(reqs, null, 2))

  console.log('--- Checking Expenses ---')
  const exps = await sql`SELECT id, expense_number, department, particulars FROM petty_cash_expenses`
  console.log('Expenses:', JSON.stringify(exps, null, 2))

  await sql.end()
}

main().catch(console.error)
