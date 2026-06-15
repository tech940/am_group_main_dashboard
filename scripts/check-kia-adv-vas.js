require('dotenv').config({ quiet: true })
const { pickDatabaseUrl } = require('./bigquery/db-url')
const postgres = require('postgres')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[check]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const [meta] = await db.unsafe(`
    SELECT
      to_regclass('public.adv_wise_lubricants_vas') IS NOT NULL AS adv_exists,
      to_regclass('public.operation_wise_analysis_report') IS NOT NULL AS op_exists
  `)
  let advRows = 0
  if (meta.adv_exists) {
    const [row] = await db.unsafe('SELECT COUNT(*)::int AS c FROM adv_wise_lubricants_vas')
    advRows = row.c
  }
  const [op] = await db.unsafe('SELECT COUNT(*)::int AS c FROM operation_wise_analysis_report')
  console.log({ adv_exists: meta.adv_exists, op_exists: meta.op_exists, adv_rows: advRows, op_rows: op.c })
  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
