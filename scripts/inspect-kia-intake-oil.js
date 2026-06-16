require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[parts]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  console.log('part_no samples with ENG or OIL:')
  console.log(await db.unsafe(`
    SELECT UPPER(TRIM(part_no)) AS part_no, UPPER(TRIM(op_part_code)) AS op_part_code,
      COUNT(*)::int AS n, COALESCE(SUM(COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0)::float AS qty
    FROM adv_wise_lubricants_vas
    WHERE UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), retail_dealer_code, ''))) = 'JK402'
      AND (UPPER(COALESCE(part_no, '')) LIKE '%NPNENG%' OR UPPER(COALESCE(op_part_code, '')) LIKE '%NPNENG%'
        OR LOWER(CONCAT_WS(' ', op_part_desc, part_desc)) LIKE '%engine%oil%')
    GROUP BY 1, 2 ORDER BY qty DESC LIMIT 20
  `))

  console.log('\nApr 2026 engine oil by regex (last data month):')
  const [apr] = await db.unsafe(`
    WITH invoice_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
        UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
        LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc, part_no, op_part_code)) AS description
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= '2026-04-01' AND gst_invoice_date < '2026-05-01'
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), retail_dealer_code, ''))) = 'JK402'
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(quantity) FILTER (WHERE
      part_no IN ('NPNENG2P2BIO', 'NPNENG3D1BIC', 'NPNENG4D2BIC')
      OR description ~ '(engine[[:space:]-]*oil|(^|[^0-9])5w[[:space:]-]*30)'
    ), 0)::float AS qty, COUNT(*) FILTER (WHERE part_no LIKE 'NPN%')::int AS npn_rows
    FROM invoice_rows
  `)
  console.log(apr)

  console.log('\nIntake accidental variants:')
  const variants = [
    ['ro_date dedup', `ro_date`],
    ['bill_date dedup', `bill_date`],
  ]
  for (const [label, col] of variants) {
    const rows = await db.unsafe(`
      WITH raw AS (
        SELECT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
          ${col}::date AS report_date,
          CASE
            WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
            WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
            WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
            WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
            ELSE 'Others'
          END AS service_category,
          uploaded_at, id
        FROM ro_billing_report
        WHERE ${col} >= '2026-06-01' AND ${col} < '2026-06-16'
          AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
          AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
      ),
      ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank FROM raw),
      dedup AS (SELECT * FROM ranked WHERE row_rank = 1)
      SELECT service_category, COUNT(*)::int AS mtd FROM dedup
      WHERE service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
      GROUP BY service_category
    `)
    const sum = rows.reduce((s, r) => s + r.mtd, 0)
    console.log(label, rows, 'total', sum)
  }

  console.log('\nIntake without dedup (raw ro_date counts):')
  console.log(await db.unsafe(`
    SELECT
      CASE
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
        WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
        ELSE 'Others'
      END AS service_category,
      COUNT(*)::int AS mtd
    FROM ro_billing_report
    WHERE ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = 'JK402'
    GROUP BY 1 ORDER BY 1
  `))

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
