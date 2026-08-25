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
  
  const requests = await sql`
    SELECT id, request_number, branch_id, status, current_stage, requested_amount,
           ed_approved_by, ea_approved_by, md_approved_by, accounts_approved_by, created_at, updated_at
    FROM petty_cash_requests
    WHERE request_number IN ('PCR-20260825-2399', 'PCR-20260825-8054', 'PCR-20260822-0819', 'PCR-20260713-0336')
    ORDER BY created_at DESC
  `
  console.log('Final Status of 4 Requests:', JSON.stringify(requests, null, 2))

  await sql.end()
}

main().catch(console.error)
