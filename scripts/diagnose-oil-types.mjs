import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[oil2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

for (const types of [["operation","part"], ["operation"], ["part"]]) {
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS op_part_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '2026-06-16'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
        AND LOWER(COALESCE(source.report_type, '')) IN (${types.map(t=>`'${t}'`).join(',')})
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT COALESCE(SUM(quantity) FILTER (WHERE op_part_code LIKE 'NPNENG%'),0)::float q FROM operation_rows`)
  console.log(types.join('+'), r.q)
}

// adv_wise oil
const adv = await db.unsafe(`
  SELECT COALESCE(SUM(COALESCE(NULLIF(regexp_replace(qty_hrs::text,'[^0-9.-]','','g'),'')::numeric,0)),0)::float q
  FROM adv_wise_lubricants_vas
  WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '${MONTH}' AND COALESCE(gst_invoice_date, ro_close_date::date) < '2026-06-16'
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''), retail_dealer_code,'')))='${DEALER}'
    AND (UPPER(TRIM(part_no)) LIKE 'NPNENG%' OR UPPER(TRIM(op_part_code)) LIKE 'NPNENG%')`)
console.log('adv_wise', adv[0].q)

console.log('periods', await db.unsafe(`
  SELECT DISTINCT report_period_end::date pe FROM operation_wise_analysis_report
  WHERE report_period_start='2026-06-01' AND UPPER(TRIM(dealer_code))='JK402' ORDER BY 1`))

await db.end()
