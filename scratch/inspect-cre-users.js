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
  
  const cres = await sql`
    SELECT id, email, full_name, role, dealers, brand, is_active
    FROM users
    WHERE role = 'cre' OR role ILIKE '%cre%'
    ORDER BY full_name
  `
  console.log('CRE users:', JSON.stringify(cres, null, 2))
  await sql.end()
}

main().catch(console.error)
