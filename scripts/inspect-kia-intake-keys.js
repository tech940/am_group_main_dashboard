require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const D = 'JK402'
const EXP = '2026-06-15'
const MON = '2026-06-01'

async function intakeCounts(db, jcKeySql) {
  const rows = await db.unsafe(`
    WITH raw AS (
      SELECT ${jcKeySql} AS jc_key, ro_date::date AS report_date,
        CASE
          WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
          WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
          WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
          WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
          ELSE 'Others'
        END AS cat,
        uploaded_at, id
      FROM ro_billing_report
      WHERE ro_date >= '${MON}' AND ro_date < '${EXP}'::date + INTERVAL '1 day'
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${D}'
    ),
    ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) rk FROM raw),
    dedup AS (SELECT * FROM ranked WHERE rk = 1)
    SELECT cat,
      COUNT(*) FILTER (WHERE report_date = '${EXP}')::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY cat
  `)
  return rows
}

async function main() {
  const url = await pickDatabaseUrl(postgres, '[intake-keys]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  console.log('bill_no key:', await intakeCounts(db, "COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text)"))
  console.log('ro_no key:', await intakeCounts(db, "COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text)"))

  const [accExtra] = await db.unsafe(`
    WITH ro_keys AS (
      SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
      FROM ro_billing_report
      WHERE ro_date >= '${MON}' AND ro_date < '${EXP}'::date + INTERVAL '1 day'
        AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${D}'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    ), pending AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key,
        ro_date::date AS report_date
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '${MON}' AND ro_date < '${EXP}'::date + INTERVAL '1 day'
        AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
        AND EXISTS (
          SELECT 1 FROM ro_billing_report rb
          WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${D}'
            AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
              OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no))))
        )
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys))::int AS pending_not_in_ro,
      COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys) AND report_date = '${EXP}')::int AS pending_not_in_ro_today,
      COUNT(*)::int AS pending_all,
      COUNT(*) FILTER (WHERE report_date = '${EXP}')::int AS pending_today
    FROM pending
  `)
  console.log('pending accidental extra:', accExtra)
  console.log('17 + pending_not_in_ro =', 17 + accExtra.pending_not_in_ro)

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
