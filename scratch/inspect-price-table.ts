import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const summary = rows(await db.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE bank_name IS NOT NULL AND bank_name <> '') AS bank_rows,
      COUNT(*) FILTER (WHERE ex_showroom_price > 0) AS price_rows
    FROM kia_price_details`))
  console.log('summary:', JSON.stringify(summary[0]))

  const models = rows(await db.execute(sql`
    SELECT model, COUNT(*) AS n, MAX(updated_at)::text AS updated
    FROM kia_price_details GROUP BY 1 ORDER BY 1`))
  console.log('\ndistinct model values:')
  for (const r of models) console.log(`  ${JSON.stringify(r.model)}: ${r.n} rows (updated ${String(r.updated).slice(0, 10)})`)

  const sample = rows(await db.execute(sql`
    SELECT model, trim_description, hyp, ex_showroom_price, tcs, registration_charges,
           statutory_charges, insurance, fastag, accessories_kit, extended_warranty_4th_year,
           insurance_company, metadata
    FROM kia_price_details
    WHERE ex_showroom_price > 0
    ORDER BY model, trim_description LIMIT 4`))
  console.log('\nsample price rows:')
  for (const r of sample) console.log(' ', JSON.stringify(r))

  const bankSample = rows(await db.execute(sql`
    SELECT model, trim_description, bank_name, bank_branch, ex_showroom_price, metadata
    FROM kia_price_details
    WHERE bank_name IS NOT NULL AND bank_name <> '' LIMIT 3`))
  console.log('\nsample bank rows:')
  for (const r of bankSample) console.log(' ', JSON.stringify(r))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
