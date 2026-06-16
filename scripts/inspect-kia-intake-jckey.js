require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const sql = (jcKey) => `
  WITH raw AS (
    SELECT ${jcKey} AS jc_key, ro_date::date AS report_date, uploaded_at, id,
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others'
      END AS cat
    FROM ro_billing_report
    WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
  ),
  ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) rk FROM raw),
  dedup AS (SELECT * FROM ranked WHERE rk = 1)
  SELECT cat,
    COUNT(*) FILTER (WHERE report_date = '2026-06-15')::int AS today,
    COUNT(*)::int AS mtd
  FROM dedup WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`

async function main() {
  const url = await pickDatabaseUrl(postgres, '[jckey]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  console.log('bill_no jc_key:')
  console.log(await db.unsafe(sql(`COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text)`)))
  console.log('ro_no jc_key:')
  console.log(await db.unsafe(sql(`COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text)`)))
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
