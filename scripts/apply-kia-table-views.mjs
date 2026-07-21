// One-time runner for scripts/rename-kia-tables-step1-views.sql — creates kia_-prefixed
// compatibility VIEWS over the generic KIA analytics tables (Category A). Idempotent, additive,
// reversible (DROP VIEW). See docs/kia-generic-table-rename-candidates.md.
import 'dotenv/config'
import postgres from 'postgres'

function getDbUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('No database URL configured (DATABASE_DIRECT_URL / DATABASE_URL / POSTGRES_URL)')
  const url = new URL(raw)
  // DDL must run on the session-mode connection (5432), not the transaction pooler (6543/pgbouncer).
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url
}

const VIEWS = [
  ['ro_billing_report', 'kia_ro_billing_report'],
  ['open_ro_yearly', 'kia_open_ro_yearly'],
  ['operation_wise_analysis_report', 'kia_operation_wise_analysis_report'],
  ['operation_wise_analysis_advisor_report', 'kia_operation_wise_analysis_advisor_report'],
  ['ew_report', 'kia_ew_report'],
  ['rsa_report', 'kia_rsa_report'],
  ['mcp_report', 'kia_mcp_report'],
  ['adv_wise_lubricants_vas', 'kia_adv_wise_lubricants_vas'],
  ['service_appointment', 'kia_service_appointment'],
  ['demo_job_cards', 'kia_demo_job_cards'],
  ['demo_car_list', 'kia_demo_car_list'],
  ['psf_yearly', 'kia_psf_yearly'],
]

async function main() {
  const url = getDbUrl()
  console.log(`[views] target: ${url.host} (db=${url.pathname.replace('/', '')}, port=${url.port || 'default'})`)
  const sql = postgres(url.toString(), { ssl: { rejectUnauthorized: false }, prepare: false, max: 1, idle_timeout: 5, connect_timeout: 30, onnotice: () => {} })

  const created = [], skipped = [], failed = []
  try {
    for (const [base, view] of VIEWS) {
      const [{ regclass }] = await sql`SELECT to_regclass(${'public.' + base})::text AS regclass`
      if (!regclass) { skipped.push(base); console.log(`  skip    ${base} (base table not found)`); continue }
      try {
        try {
          await sql.unsafe(`CREATE OR REPLACE VIEW public.${view} WITH (security_invoker = on) AS SELECT * FROM public.${base}`)
        } catch {
          // Fallback for Postgres < 15 (no security_invoker). The REVOKE/GRANT below still block anon.
          await sql.unsafe(`CREATE OR REPLACE VIEW public.${view} AS SELECT * FROM public.${base}`)
        }
        await sql.unsafe(`REVOKE ALL ON public.${view} FROM anon, authenticated`)
        await sql.unsafe(`GRANT SELECT ON public.${view} TO postgres, service_role`)
        created.push(view)
        console.log(`  create  ${view}  ->  ${base}`)
      } catch (e) {
        failed.push([view, e.message])
        console.error(`  FAIL    ${view}: ${e.message}`)
      }
    }

    const present = await sql`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname LIKE 'kia_%'
      ORDER BY c.relname`
    console.log('\n[views] kia_ views now present in public:')
    for (const r of present) console.log('  -', r.relname)

    // Row-count parity smoke-test on the one the app now reads.
    if (created.includes('kia_service_appointment')) {
      const [{ v }] = await sql`SELECT count(*)::int AS v FROM public.kia_service_appointment`
      const [{ b }] = await sql`SELECT count(*)::int AS b FROM public.service_appointment`
      console.log(`\n[views] parity kia_service_appointment=${v} vs service_appointment=${b} -> ${v === b ? 'OK' : 'MISMATCH'}`)
    }

    console.log(`\n[views] summary: created=${created.length} skipped=${skipped.length} failed=${failed.length}`)
    if (failed.length) process.exitCode = 1
  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error('[views] fatal:', e); process.exit(1) })
