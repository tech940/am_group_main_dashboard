import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[oil2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const [inv] = await db.unsafe(`
  WITH invoice_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
      UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
      UPPER(TRIM(COALESCE(op_part_code, ''))) AS op_part_code
    FROM adv_wise_lubricants_vas
    WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '${MONTH}'
      AND COALESCE(gst_invoice_date, ro_close_date::date) < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = '${DEALER}'
      AND (part_no LIKE 'NPNENG%' OR op_part_code LIKE 'NPNENG%'
        OR part_no LIKE 'NPNENG2P2BIO%' OR part_no LIKE 'NPNENG3D1BIC%' OR part_no LIKE 'NPNENG4D2BIC%'
        OR op_part_code LIKE 'NPNENG2P2BIO%' OR op_part_code LIKE 'NPNENG3D1BIC%' OR op_part_code LIKE 'NPNENG4D2BIC%')
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT COALESCE(SUM(quantity),0)::float AS total,
    COALESCE(SUM(quantity) FILTER (WHERE part_no LIKE 'NPNENG4%' OR op_part_code LIKE 'NPNENG4%'),0)::float AS npn4
  FROM invoice_rows`)
console.log('invoice oil', inv)

// row-level npneng4 in forward period
const rows = await db.unsafe(`
  SELECT op_part_code, SUM(q)::float q FROM (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      UPPER(TRIM(op_part_code)) op_part_code,
      COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) q
    FROM operation_wise_analysis_report
    WHERE dealer_code='${DEALER}' AND report_period_start='${MONTH}' AND report_period_end='2026-06-16'
      AND LOWER(COALESCE(report_type,'')) IN ('operation','part')
      AND (UPPER(op_part_code) LIKE 'NPNENG%')
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ) x GROUP BY 1 ORDER BY q DESC`)
console.log('j16 npneng rows', rows, 'sum', rows.reduce((s,r)=>s+Number(r.q),0))

const j16 = 287.1
for (const sub of [25.1, 25, 24.1, 35.15, 30.9, 4.25, 20.9]) {
  console.log(`j16-${sub}`, j16 - sub)
}

for (const pe of ['2026-06-13', '2026-06-16']) {
  const rows = await db.unsafe(`
    SELECT op_part_code, SUM(q)::float q FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        UPPER(TRIM(op_part_code)) op_part_code,
        COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) q
      FROM operation_wise_analysis_report
      WHERE dealer_code='${DEALER}' AND report_period_start='${MONTH}' AND report_period_end='${pe}'
        AND LOWER(COALESCE(report_type,'')) IN ('operation','part')
        AND UPPER(op_part_code) LIKE 'NPNENG%'
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) x GROUP BY 1 ORDER BY 1`)
  console.log('by code', pe, rows)
  const total = rows.reduce((s, r) => s + Number(r.q), 0)
  console.log('  total', total, 'minus npn4', total - Number(rows.find((r) => r.op_part_code.startsWith('NPNENG4'))?.q || 0))
}

await db.end()
