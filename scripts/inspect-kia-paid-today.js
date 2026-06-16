require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[paid-today]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const rows = await db.unsafe(`
    SELECT ro_no, bill_no, work_type, service_type, ro_date::date, bill_date::date, bill_status
    FROM ro_billing_report
    WHERE ro_date = '2026-06-15'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$')
    ORDER BY ro_no
  `)
  console.log('paid ro_date rows Jun 15:', rows.length, rows)

  const [mtdGap] = await db.unsafe(`
    SELECT
      COUNT(*) FILTER (WHERE LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%')::int AS running_raw,
      COUNT(DISTINCT COALESCE(NULLIF(ro_no, ''), id::text)) FILTER (WHERE LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%')::int AS running_distinct_ro
    FROM ro_billing_report
    WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
  `)
  console.log('running counts:', mtdGap)

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
