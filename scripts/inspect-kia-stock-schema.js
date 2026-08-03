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
  console.log('[Schema-Check] Connecting...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
  })

  try {
    const indexes = await sql`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'kia_stock_local_statuses'
    `
    console.log('[Schema-Check] Indexes:', indexes)

    const constraints = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) 
      FROM pg_constraint 
      WHERE conrelid = 'public.kia_stock_local_statuses'::regclass
    `
    console.log('[Schema-Check] Constraints:', constraints)

    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'kia_stock_local_statuses'
    `
    console.log('[Schema-Check] Columns:', columns.map(c => c.column_name))
  } catch (err) {
    console.error('[Schema-Check] Error:', err)
  } finally {
    await sql.end()
  }
}

main()
