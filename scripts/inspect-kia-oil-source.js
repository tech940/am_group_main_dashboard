require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[oil-src]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const [adv] = await db.unsafe(`
    WITH invoice_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
        UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS op_part_code
      FROM adv_wise_lubricants_vas
      WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '2026-06-01'
        AND COALESCE(gst_invoice_date, ro_close_date::date) < '2026-06-16'
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = 'JK402'
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(quantity) FILTER (WHERE part_no LIKE 'NPNENG%' OR op_part_code LIKE 'NPNENG%'), 0)::float AS npn,
      COALESCE(SUM(quantity), 0)::float AS total,
      COUNT(*)::int AS rows
    FROM invoice_rows
  `)

  const [op] = await db.unsafe(`
    WITH latest AS (
      SELECT report_period_start::date AS ps, report_period_end::date AS pe
      FROM operation_wise_analysis_report
      WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
      GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
    ), rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code
      FROM operation_wise_analysis_report source
      INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
      WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT (SELECT pe::text FROM latest) AS period_end,
      COALESCE(SUM(qty) FILTER (WHERE code LIKE 'NPNENG%'), 0)::float AS npn
    FROM rows
  `)

  console.log('adv_wise june oil:', adv)
  console.log('operation oil:', op)
  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
