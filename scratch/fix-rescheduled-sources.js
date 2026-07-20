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
  
  console.log('[Fix-Rescheduled-Source] Updating followups where updated_at > created_at + 1 min...')
  const res = await sql`
    UPDATE public.kia_lead_followups
    SET source = 'rescheduled'
    WHERE status = 'pending'
      AND source != 'rescheduled'
      AND updated_at > created_at + interval '1 minute'
  `
  console.log(`[Fix-Rescheduled-Source] Updated ${res.count} rows to source = 'rescheduled'.`)
  await sql.end()
}

main().catch(console.error)
