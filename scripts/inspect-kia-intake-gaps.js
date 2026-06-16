require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'

async function main() {
  const url = await pickDatabaseUrl(postgres, '[intake-deep]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const [paidToday] = await db.unsafe(`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        ro_date::date AS report_date, work_type, service_type, bill_no, ro_no
      FROM ro_billing_report
      WHERE ro_date = '${EXPORT}'::date
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
    )
    SELECT jc_key, work_type, service_type,
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others'
      END AS cat
    FROM raw ORDER BY cat, jc_key
  `)
  console.log('Paid today rows on ro_date:', paidToday.filter((r) => r.cat === 'Paid Service'))

  const [accTodayRo] = await db.unsafe(`
    SELECT COUNT(*)::int AS n FROM ro_billing_report
    WHERE ro_date = '${EXPORT}'::date
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  `)
  console.log('Accidental ro_date today raw count:', accTodayRo)

  const [pendingAccToday] = await db.unsafe(`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        ro_date::date AS report_date,
        CASE
          WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
          ELSE 'Other'
        END AS cat
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND EXISTS (
          SELECT 1 FROM ro_billing_report rb
          WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
            AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
              OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no))))
        )
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*) FILTER (WHERE cat = 'Accidental Repair' AND report_date = '${EXPORT}'::date)::int AS today,
      COUNT(*) FILTER (WHERE cat = 'Accidental Repair')::int AS mtd
    FROM active
  `)
  console.log('Pending accidental open_ro:', pendingAccToday)

  const [accBillToday] = await db.unsafe(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS n
    FROM ro_billing_report
    WHERE bill_date = '${EXPORT}'::date AND ro_date <> '${EXPORT}'::date
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  `)
  console.log('Accidental bill_date today but ro_date not today:', accBillToday)

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
