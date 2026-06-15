require('dotenv').config({ quiet: true })
const { pickDatabaseUrl } = require('./db-url')
const postgres = require('postgres')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[check]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const tables = [
    ['am_platinum_ro_billing_report', 'bill_date'],
    ['am_platinum_repair_order_list', 'r_o_date'],
    ['hyundai_warranty_claim_list', 'claim_date'],
  ]
  for (const [table, col] of tables) {
    const [row] = await db.unsafe(
      `SELECT COUNT(*)::int AS total, COUNT(${col})::int AS with_col FROM public."${table}"`
    )
    console.log(table, row)
    const [sample] = await db.unsafe(
      `SELECT to_jsonb(t) AS payload FROM public."${table}" AS t LIMIT 1`
    )
    console.log(table, 'keys', Object.keys(sample.payload).sort().join(', '))
    console.log(table, 'bill_date sample', sample.payload.bill_date, typeof sample.payload.bill_date)
  }
  const years = await db.unsafe(
    `SELECT EXTRACT(YEAR FROM bill_date)::int AS y, COUNT(*)::int AS c
     FROM am_platinum_ro_billing_report GROUP BY 1 ORDER BY 1`
  )
  console.log('bill_date years', years)
  await db.end()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
