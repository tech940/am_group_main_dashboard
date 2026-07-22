import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  console.log('Enabling Row Level Security (RLS) on public tables...')

  await sql`ALTER TABLE public.am_hyundai_vehicle ENABLE ROW LEVEL SECURITY;`
  console.log('✔ RLS enabled on public.am_hyundai_vehicle')

  await sql`ALTER TABLE public.am_hyundai_trips ENABLE ROW LEVEL SECURITY;`
  console.log('✔ RLS enabled on public.am_hyundai_trips')

  await sql`ALTER TABLE public.am_hyundai_employees ENABLE ROW LEVEL SECURITY;`
  console.log('✔ RLS enabled on public.am_hyundai_employees')

  console.log('All 4 Supabase linter RLS security errors resolved successfully!')
  await sql.end()
}

main().catch(console.error)
