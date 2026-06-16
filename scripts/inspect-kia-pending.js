require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[pend]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const queries = {
    current: `
      WITH active AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) ro_date::date AS report_date,
          CASE WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair' ELSE 'Mechanical' END AS cat
        FROM open_ro_yearly
        WHERE LOWER(COALESCE(status, '')) = 'open'
          AND ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
          AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
            AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
              OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no)))))
        ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT cat, COUNT(*)::int AS n FROM active GROUP BY cat`,
    allOpenAcc: `
      SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
        AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
          AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
            OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no)))))`,
    openAccNoBillJun: `
      SELECT COUNT(DISTINCT COALESCE(NULLIF(r_o_no, ''), id::text))::int AS n
      FROM open_ro_yearly o
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
        AND ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
        AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
          AND ((NULLIF(TRIM(o.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(o.vin)))
            OR (NULLIF(TRIM(o.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(o.reg_no)))))
        AND NOT EXISTS (
          SELECT 1 FROM ro_billing_report rb2
          WHERE UPPER(TRIM(COALESCE(NULLIF(rb2.dealer_code, ''), NULLIF(rb2.main_dealer_code, '')))) = 'JK402'
            AND rb2.bill_date >= '2026-06-01' AND rb2.bill_date < '2026-06-16'
            AND LOWER(TRIM(COALESCE(rb2.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
            AND (LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%')
            AND ((NULLIF(TRIM(o.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vin, ''))) = UPPER(TRIM(o.vin)))
              OR (NULLIF(TRIM(o.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vehicle_reg_no, ''))) = UPPER(TRIM(o.reg_no))))
        )`,
  }

  for (const [name, q] of Object.entries(queries)) {
    console.log(name, await db.unsafe(q))
  }

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
