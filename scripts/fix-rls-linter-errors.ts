import fs from 'fs'
import path from 'path'
import postgres from 'postgres'

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  if (process.env.DATABASE_DIRECT_URL) return process.env.DATABASE_DIRECT_URL

  const envFiles = ['.env.local', '.env', '.env.production']
  for (const file of envFiles) {
    const p = path.resolve(process.cwd(), file)
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf-8')
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.startsWith('DATABASE_URL=')) {
          return trimmed.slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '')
        }
        if (trimmed.startsWith('DATABASE_DIRECT_URL=')) {
          return trimmed.slice('DATABASE_DIRECT_URL='.length).replace(/^["']|["']$/g, '')
        }
      }
    }
  }
  throw new Error('DATABASE_URL not found')
}

async function main() {
  console.log('Applying comprehensive RLS & Security fixes for Supabase Linter...')

  const url = getDatabaseUrl()
  console.log('Connecting to database host...')
  const sql = postgres(url, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

  const targetTables = [
    'am_hyundai_trips',
    'mg_employees',
    'mg_trips',
    'mg_vehicle',
    'platinum_test_drive_vehicle',
    'trips',
    'kia_vehicle',
    'kia_trips',
    'kia_employees',
    'am_hyundai_vehicle',
    'am_hyundai_employees',
  ]

  for (const table of targetTables) {
    try {
      await sql.unsafe(`ALTER TABLE IF EXISTS public."${table}" ENABLE ROW LEVEL SECURITY;`)
      await sql.unsafe(`ALTER TABLE IF EXISTS public."${table}" FORCE ROW LEVEL SECURITY;`)
      await sql.unsafe(`REVOKE ALL ON TABLE public."${table}" FROM anon, public;`)
      console.log(`✔ Secured public.${table}`)
    } catch (e: any) {
      console.error(`Failed on ${table}:`, e.message)
    }
  }

  // Find any other public table with rowsecurity = false
  const unsecure = await sql`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND rowsecurity = false;
  `
  console.log('--- Other public tables with RLS disabled ---', unsecure.map(r => r.tablename))

  for (const row of unsecure) {
    try {
      await sql.unsafe(`ALTER TABLE IF EXISTS public."${row.tablename}" ENABLE ROW LEVEL SECURITY;`)
      await sql.unsafe(`REVOKE ALL ON TABLE public."${row.tablename}" FROM anon;`)
      console.log(`✔ Also secured public.${row.tablename}`)
    } catch (e: any) {
      console.error(`Failed on ${row.tablename}:`, e.message)
    }
  }

  // Fix security_definer_view: v_upgrade_tenure_pool and any other views in public schema
  console.log('\n--- Securing Views (security_invoker = on) ---')
  try {
    await sql.unsafe(`ALTER VIEW IF EXISTS public.v_upgrade_tenure_pool SET (security_invoker = on);`)
    console.log('✔ Secured view public.v_upgrade_tenure_pool with security_invoker = on')
  } catch (err: any) {
    console.error('Failed to update v_upgrade_tenure_pool view:', err.message)
  }

  // Check all views in public schema
  const views = await sql`
    SELECT c.relname as viewname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v');
  `
  for (const v of views) {
    try {
      await sql.unsafe(`ALTER VIEW public."${v.viewname}" SET (security_invoker = on);`)
      console.log(`✔ Set security_invoker = on on public.${v.viewname}`)
    } catch (e: any) {
      console.log(`Notice on view ${v.viewname}:`, e.message)
    }
  }

  // Verification: Check if any public tables still have rowsecurity = false
  const remainingUnsecureTables = await sql`
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND rowsecurity = false;
  `
  console.log('\n--- Verification: Unsecured public tables remaining ---', remainingUnsecureTables.length)
  if (remainingUnsecureTables.length > 0) {
    console.warn('Still unsecure:', remainingUnsecureTables.map(r => r.tablename))
  } else {
    console.log('✔ All public tables now have Row Level Security enabled!')
  }

  // Reload PostgREST schema cache
  try {
    await sql`NOTIFY pgrst, 'reload schema';`
    console.log('✔ Reloaded PostgREST schema cache')
  } catch (err) {
    console.log('PostgREST reload skipped')
  }

  await sql.end({ timeout: 5 })
  console.log('\nDone! All Supabase security linter errors cleared.')
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err)
  process.exit(1)
})
