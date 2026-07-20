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
  
  console.log('[Test-Query] Testing not_connected query...')
  const rows = await sql`
    SELECT "kia_lead_followups"."id"
    FROM "kia_lead_followups"
    INNER JOIN "kia_bookings" ON "kia_bookings"."id" = "kia_lead_followups"."booking_id"
    WHERE ("kia_bookings"."deleted_at" IS NULL 
      AND "kia_bookings"."status" <> 'delivered' 
      AND "kia_bookings"."status" <> 'cancelled' 
      AND "kia_lead_followups"."status" = 'done' 
      AND "kia_lead_followups"."outcome" = 'no_answer' 
      AND NOT EXISTS (
        SELECT 1 FROM kia_lead_followups nxt
        WHERE nxt.booking_id = kia_lead_followups.booking_id AND nxt.status = 'pending'
      )
      AND kia_lead_followups.completed_at = (
        SELECT max(latest.completed_at) FROM kia_lead_followups latest
        WHERE latest.booking_id = kia_lead_followups.booking_id AND latest.status = 'done'
      )
    )
    ORDER BY "kia_lead_followups"."completed_at" DESC
    LIMIT 300
  `
  console.log(`[Test-Query] Success! Returned ${rows.length} rows.`)
  await sql.end()
}

main().catch(console.error)
