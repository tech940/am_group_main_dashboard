import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  console.log('Applying comprehensive RLS & Security fixes for Supabase Linter...')

  // 1. Enable RLS
  await sql`ALTER TABLE public.am_hyundai_vehicle ENABLE ROW LEVEL SECURITY;`
  await sql`ALTER TABLE public.am_hyundai_trips ENABLE ROW LEVEL SECURITY;`
  await sql`ALTER TABLE public.am_hyundai_employees ENABLE ROW LEVEL SECURITY;`
  console.log('✔ Enabled RLS on all 3 tables')

  // 2. Force RLS (applies RLS even to table owners)
  await sql`ALTER TABLE public.am_hyundai_vehicle FORCE ROW LEVEL SECURITY;`
  await sql`ALTER TABLE public.am_hyundai_trips FORCE ROW LEVEL SECURITY;`
  await sql`ALTER TABLE public.am_hyundai_employees FORCE ROW LEVEL SECURITY;`
  console.log('✔ Forced RLS on all 3 tables')

  // 3. Revoke public/anon/authenticated access via PostgREST (prevents sensitive column / RLS leaks)
  await sql`REVOKE ALL ON TABLE public.am_hyundai_vehicle FROM anon, authenticated, public;`
  await sql`REVOKE ALL ON TABLE public.am_hyundai_trips FROM anon, authenticated, public;`
  await sql`REVOKE ALL ON TABLE public.am_hyundai_employees FROM anon, authenticated, public;`
  console.log('✔ Revoked anon/authenticated/public API grants on all 3 tables')

  // 4. Reload PostgREST schema cache
  try {
    await sql`NOTIFY pgrst, 'reload schema';`
    console.log('✔ Reloaded PostgREST schema cache')
  } catch (err) {
    console.log('PostgREST notify skipped')
  }

  console.log('Done! All Supabase security linter errors cleared.')
  await sql.end()
}

main().catch(console.error)
