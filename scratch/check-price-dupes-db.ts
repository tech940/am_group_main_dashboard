import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const dupes = rows(await db.execute(sql`
    SELECT model, trim_description, COUNT(*) AS n,
           string_agg(DISTINCT COALESCE(metadata->>'colour', '?'), ' | ') AS colours,
           string_agg(DISTINCT ex_showroom_price::text, ' | ') AS prices
    FROM kia_price_details
    WHERE model NOT LIKE '\\_\\_%'
    GROUP BY 1, 2 HAVING COUNT(*) > 1 ORDER BY 1, 2`))
  console.log('current DB duplicate (model, trim) price rows:', dupes.length)
  for (const r of dupes) console.log(`  ${r.model} | ${r.trim_description} x${r.n} colours=[${r.colours}] prices=[${r.prices}]`)

  const gtx = rows(await db.execute(sql`
    SELECT trim_description, ex_showroom_price, metadata->>'colour' AS colour
    FROM kia_price_details
    WHERE model = 'New Seltos Petrol' AND trim_description ILIKE '%GTX%'
    ORDER BY trim_description, ex_showroom_price`))
  console.log('\ncurrent Seltos Petrol GTX rows:')
  for (const r of gtx) console.log(`  ${r.trim_description} | ${r.ex_showroom_price} | ${r.colour}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
