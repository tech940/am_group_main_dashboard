/**
 * Applies migration 0015 — demo_vehicle_details columns + registration index.
 *
 * These three columns (registration_number, sold_amount, remarks) and the registration index were
 * previously created by ensureDemoVehicleDetailsSchema() INSIDE the /api/brands/kia/demo-cars-list
 * request path (ALTER TABLE ... ADD COLUMN IF NOT EXISTS on every POST, and once-per-10min-per-process
 * on GET). That runtime DDL is being removed; this migration is its permanent home.
 *
 * Idempotent (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS). In an environment where the
 * runtime DDL already created these (i.e. current prod), applying this is a no-op.
 *
 * Run:  npx tsx scripts/apply-migration-0015.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })
  try {
    // Only touch the table if it exists (it is created by scripts/create-demo-vehicle-details.sql).
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.demo_vehicle_details') IS NOT NULL AS exists`
    if (!exists) {
      console.log('demo_vehicle_details does not exist yet — run scripts/create-demo-vehicle-details.sql first. Nothing to do.')
      process.exit(0)
    }

    await sql.unsafe(`ALTER TABLE public.demo_vehicle_details ADD COLUMN IF NOT EXISTS registration_number text`)
    await sql.unsafe(`ALTER TABLE public.demo_vehicle_details ADD COLUMN IF NOT EXISTS sold_amount numeric`)
    await sql.unsafe(`ALTER TABLE public.demo_vehicle_details ADD COLUMN IF NOT EXISTS remarks text`)
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS demo_vehicle_details_registration_number_idx ON public.demo_vehicle_details (registration_number)`)

    const cols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'demo_vehicle_details'
        AND column_name IN ('registration_number', 'sold_amount', 'remarks')
      ORDER BY column_name`
    console.log('Migration 0015 applied. Present columns:', cols.map((c) => c.column_name).join(', '))
    process.exit(cols.length === 3 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
main().catch((error) => { console.error('Migration 0015 failed:', error); process.exit(1) })
