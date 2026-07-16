/**
 * Applies migration 0022 — widen kia_finance_payouts.dealer_payout_percent to numeric(8,4).
 *
 * WHY: the real source workbook stores the payout percentage as an Excel FRACTION (0.005 = 0.5%),
 * and the tail of the distribution goes to 0.000065 (= 0.0065%). At numeric(6,2) every sub-0.01%
 * value silently rounds to 0.01 or 0.00. Cheap to widen now; a rounding error discovered later in a
 * payout ledger is expensive. 4dp holds every value present in the sheet exactly.
 *
 * Idempotent — ALTER TYPE to the same type is a no-op re-run. Widening a numeric never loses data.
 *
 * Run:  npx tsx scripts/apply-migration-0022.ts
 */
import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    const started = Date.now()
    await sql.unsafe(`
      ALTER TABLE kia_finance_payouts
      ALTER COLUMN dealer_payout_percent TYPE numeric(8,4)`)
    console.log(`[0022] dealer_payout_percent -> numeric(8,4) in ${Date.now() - started}ms`)

    const [col] = await sql<{ numeric_precision: number; numeric_scale: number }[]>`
      SELECT numeric_precision, numeric_scale FROM information_schema.columns
      WHERE table_name = 'kia_finance_payouts' AND column_name = 'dealer_payout_percent'`

    console.log('')
    console.log(`Migration 0022 applied. dealer_payout_percent = numeric(${col.numeric_precision},${col.numeric_scale})`)
    process.exit(col.numeric_scale === 4 ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => { console.error('Migration 0022 failed:', error); process.exit(1) })
