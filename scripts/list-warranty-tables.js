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
  console.log('[Table-Check] Connecting...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
  })

  try {
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND (table_name LIKE '%warranty%' OR table_name LIKE '%ew%' OR table_name LIKE '%hyundai%' OR table_name LIKE '%platinum%')
    `
    console.log('[Table-Check] Tables found:', tables.map(t => t.table_name))

    for (const t of tables) {
      const name = t.table_name
      try {
        const count = await sql.unsafe(`SELECT count(*) FROM public."${name}"`)
        console.log(`[Table-Check] Table ${name} count:`, count[0].count)
      } catch (e) {
        console.log(`[Table-Check] Could not count ${name}:`, e.message)
      }
    }
  } catch (err) {
    console.error('[Table-Check] Error:', err)
  } finally {
    await sql.end()
  }
}

main()
