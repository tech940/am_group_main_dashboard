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
  
  const activities = await sql`
    SELECT act.*
    FROM kia_booking_activity act
    JOIN kia_bookings b ON b.id = act.booking_id
    WHERE b.booking_number = 'KIA_JK402_2026_120039'
    ORDER BY act.created_at DESC
  `
  console.log('Activity for Karmanya pathania:', JSON.stringify(activities, null, 2))
  
  const followups = await sql`
    SELECT f.*
    FROM kia_lead_followups f
    JOIN kia_bookings b ON b.id = f.booking_id
    WHERE b.booking_number = 'KIA_JK402_2026_120039'
    ORDER BY f.created_at DESC
  `
  console.log('Followups for Karmanya pathania:', JSON.stringify(followups, null, 2))
  await sql.end()
}

main().catch(console.error)
