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
  const dbUrl = getDbUrl()
  console.log('[Rescheduled-Migrate] Connecting to database...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
  })

  try {
    console.log('[Rescheduled-Migrate] Updating existing rescheduled followups...')
    
    // Method 1: If booking has a done followup with outcome = 'rescheduled'
    const res1 = await sql.unsafe(`
      UPDATE public.kia_lead_followups kf
      SET source = 'rescheduled'
      WHERE kf.status = 'pending'
        AND kf.source != 'rescheduled'
        AND EXISTS (
          SELECT 1 FROM public.kia_lead_followups prev
          WHERE prev.booking_id = kf.booking_id
            AND prev.status = 'done'
            AND prev.outcome = 'rescheduled'
        );
    `)
    console.log(`[Rescheduled-Migrate] Updated ${res1.count} rows via done siblings outcome check`)

    // Method 2: If booking has activity logs indicating a followup_updated activity
    const res2 = await sql.unsafe(`
      UPDATE public.kia_lead_followups kf
      SET source = 'rescheduled'
      WHERE kf.status = 'pending'
        AND kf.source != 'rescheduled'
        AND EXISTS (
          SELECT 1 FROM public.kia_booking_activity act
          WHERE act.booking_id = kf.booking_id
            AND act.activity_type = 'followup_updated'
        );
    `)
    console.log(`[Rescheduled-Migrate] Updated ${res2.count} rows via activity log check`)

    console.log('[Rescheduled-Migrate] Migration complete!')
  } catch (err) {
    console.error('[Rescheduled-Migrate] Error migrating rescheduled followups:', err)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
