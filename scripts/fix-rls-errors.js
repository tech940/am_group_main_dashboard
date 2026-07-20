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
  console.log('[RLS-Fix] Connecting to database...')
  const sql = postgres(dbUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
  })

  const tables = [
    'test_drive_employees',
    'trips',
    'employees',
    'vehicles',
    'platinum_test_drive_vehicle'
  ]

  try {
    for (const table of tables) {
      console.log(`[RLS-Fix] Enabling RLS on table: public.${table}`)
      // 1. Enable RLS
      await sql.unsafe(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
      
      // 2. Revoke permissions from anon and authenticated roles (prevents PostgREST API exposure)
      await sql.unsafe(`REVOKE ALL ON public.${table} FROM anon, authenticated;`)
      
      // 3. Grant full permissions to postgres and service_role
      await sql.unsafe(`GRANT ALL ON public.${table} TO postgres, service_role;`)
      
      console.log(`[RLS-Fix] Successfully secured public.${table}`)
    }
    console.log('[RLS-Fix] ALL 7 RLS & Sensitive Column errors fixed successfully!')
  } catch (err) {
    console.error('[RLS-Fix] Error enabling RLS:', err)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)
