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
  console.log('[Fix-Constraint] Connecting to DB...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
  })

  try {
    console.log('[Fix-Constraint] Dropping old constraint kia_stock_local_statuses_local_status_check...')
    await sql`
      ALTER TABLE public.kia_stock_local_statuses 
      DROP CONSTRAINT IF EXISTS kia_stock_local_statuses_local_status_check
    `

    console.log('[Fix-Constraint] Adding updated constraint with bbnd_marked...')
    await sql`
      ALTER TABLE public.kia_stock_local_statuses 
      ADD CONSTRAINT kia_stock_local_statuses_local_status_check 
      CHECK (local_status IN ('bbnd', 'bbnd_marked', 'retail', 'hold_customer', 'hold_dealer'))
    `

    console.log('[Fix-Constraint] Success! Check constraint updated.')

    // Verify updated constraint
    const constraints = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'public.kia_stock_local_statuses'::regclass
    `
    console.log('[Fix-Constraint] Updated Constraints:', constraints)
  } catch (err) {
    console.error('[Fix-Constraint] Error:', err)
  } finally {
    await sql.end()
  }
}

main()
