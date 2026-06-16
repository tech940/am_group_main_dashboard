require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function countsFor(dealer) {
  const url = await pickDatabaseUrl(postgres, '[dealer-intake]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const rows = await db.unsafe(`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
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
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${dealer}'
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ro_date DESC) rk FROM raw),
    dedup AS (SELECT * FROM ranked WHERE rk = 1)
    SELECT cat, COUNT(*)::int AS n FROM dedup
    WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY cat
  `)
  await db.end()
  return rows
}

;(async () => {
  console.log('JK402', await countsFor('JK402'))
  console.log('JK501', await countsFor('JK501'))
})().catch((e) => { console.error(e); process.exit(1) })
