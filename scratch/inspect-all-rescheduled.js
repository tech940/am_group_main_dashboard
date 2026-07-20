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
  
  const rows = await sql`
    SELECT f.id, f.booking_id, b.booking_number, b.customer_name, f.status, f.source, f.due_at, f.created_at, f.updated_at
    FROM kia_lead_followups f
    JOIN kia_bookings b ON b.id = f.booking_id
    WHERE f.source = 'rescheduled'
  `
  console.log('All rescheduled source followups:', JSON.stringify(rows, null, 2))
  await sql.end()
}

main().catch(console.error)
