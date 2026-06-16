require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[intake]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const [openAcc] = await db.unsafe(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND EXISTS (
        SELECT 1 FROM ro_billing_report rb
        WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
          AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
            OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no))))
      )
  `)
  console.log('all open accidental (WIP):', openAcc)

  const [openAccMtd] = await db.unsafe(`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) ro_date::date AS report_date
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
        AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
          AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
            OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no)))))
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS mtd, COUNT(*) FILTER (WHERE report_date = '2026-06-15')::int AS today FROM active
  `)
  console.log('open accidental ro_date in MTD:', openAccMtd)

  const [roAcc] = await db.unsafe(`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key, ro_date::date AS report_date, uploaded_at, id
      FROM ro_billing_report
      WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank FROM raw),
    dedup AS (SELECT * FROM ranked WHERE row_rank = 1)
    SELECT COUNT(*)::int AS mtd, COUNT(*) FILTER (WHERE report_date = '2026-06-15')::int AS today FROM dedup
  `)
  console.log('ro_date accidental intake dedup:', roAcc)
  console.log('sum ro+pending mtd', roAcc.mtd + openAccMtd.mtd)

  const [paidRo] = await db.unsafe(`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key, ro_date::date AS report_date,
        CASE WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 1 ELSE 0 END AS is_paid,
        uploaded_at, id
      FROM ro_billing_report
      WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank FROM raw),
    dedup AS (SELECT * FROM ranked WHERE row_rank = 1)
    SELECT COUNT(*) FILTER (WHERE is_paid = 1)::int AS mtd FROM dedup
  `)
  console.log('paid ro_date dedup:', paidRo)

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
