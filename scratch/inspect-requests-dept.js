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
  
  console.log('--- All Petty Cash Requests ---')
  const reqs = await sql`SELECT id, request_number, branch_id, department, requested_by_name, request_form FROM petty_cash_requests`
  for (const r of reqs) {
    console.log(r.id, r.request_number, r.branch_id, 'dept:', r.department, 'name:', r.requested_by_name)
  }

  await sql.end()
}

main().catch(console.error)
