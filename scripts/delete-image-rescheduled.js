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
  const bookingNumbers = [
    'KIA_JK402_2026_120031',
    'KIA_JK402_2026_120030',
    'KIA_JK402_2026_120050',
    'KIA_JK402_2026_120055',
  ]
  
  console.log('[Delete-Rescheduled] Deleting followups for rescheduled test bookings...')
  const res = await sql`
    DELETE FROM public.kia_lead_followups
    WHERE booking_id IN (
      SELECT id FROM public.kia_bookings WHERE booking_number = ANY(${bookingNumbers})
    )
  `
  console.log(`[Delete-Rescheduled] Deleted ${res.count} follow-up records.`)
  await sql.end()
}

main().catch(console.error)
