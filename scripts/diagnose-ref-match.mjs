import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[ref-match]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

// Incremental WA/WB between consecutive operation periods
const periods = await db.unsafe(`
  SELECT report_period_end::date AS pe,
    COALESCE(SUM(COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)) FILTER (
      WHERE LOWER(COALESCE(op_part_code, '')) ~ '(^|[^a-z])wa([^a-z]|$)'
        OR LOWER(COALESCE(op_part_desc, '')) ~ 'alignment|align'
    ), 0)::float AS wa,
    COALESCE(SUM(COALESCE(NULLIF(regexp_replace(total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)) FILTER (
      WHERE LOWER(COALESCE(op_part_code, '')) ~ '(^|[^a-z])wb([^a-z]|$)'
        OR LOWER(COALESCE(op_part_desc, '')) ~ 'balanc'
    ), 0)::float AS wb
  FROM (
    SELECT DISTINCT ON (report_period_end, COALESCE(NULLIF(row_hash, ''), id::text))
      report_period_end, total_count, op_part_code, op_part_desc
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01'
      AND report_period_end BETWEEN '2026-06-10' AND '2026-06-16'
    ORDER BY report_period_end, COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  ) x
  GROUP BY 1 ORDER BY 1`)
console.log('WA/WB by period end:', periods)

// adv_wise VAS with ro_close_date
const vasFilter = `(
  description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
  OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
  OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
) AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'`

const [advGst] = await db.unsafe(`
  WITH rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(taxable_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
      LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
    FROM adv_wise_lubricants_vas
    WHERE gst_invoice_date >= '2026-06-01' AND gst_invoice_date < '2026-06-16'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = 'JK402'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas FROM rows`)

const [advClose] = await db.unsafe(`
  WITH rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(taxable_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
      LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
    FROM adv_wise_lubricants_vas
    WHERE ro_close_date >= '2026-06-01' AND ro_close_date < '2026-06-16'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = 'JK402'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas,
    COUNT(*)::int AS rows FROM rows`)

const [advCoalesce] = await db.unsafe(`
  WITH rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(taxable_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
      LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
    FROM adv_wise_lubricants_vas
    WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '2026-06-01'
      AND COALESCE(gst_invoice_date, ro_close_date::date) < '2026-06-16'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = 'JK402'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas FROM rows`)

console.log('adv VAS gst:', advGst, 'ro_close:', advClose, 'coalesce:', advCoalesce)
console.log('implied VAS target:', 554378 - 3719 * 134)

// Oil from adv_wise with various filters
const [oilAdv] = await db.unsafe(`
  WITH rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
      UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
      UPPER(TRIM(COALESCE(op_part_code, ''))) AS op_code
    FROM adv_wise_lubricants_vas
    WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '2026-06-01'
      AND COALESCE(gst_invoice_date, ro_close_date::date) < '2026-06-16'
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = 'JK402'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT
    COALESCE(SUM(qty) FILTER (WHERE part_no LIKE 'NPNENG%' OR op_code LIKE 'NPNENG%'), 0)::float AS npn,
    COALESCE(SUM(qty) FILTER (WHERE part_no LIKE 'NPNENG2P2BIO%' OR part_no LIKE 'NPNENG3D1BIC%' OR part_no LIKE 'NPNENG4D2BIC%' OR op_code LIKE 'NPNENG2P2BIO%' OR op_code LIKE 'NPNENG3D1BIC%' OR op_code LIKE 'NPNENG4D2BIC%'), 0)::float AS coded,
    COUNT(*)::int AS rows
  FROM rows`)

console.log('adv oil:', oilAdv)

// Try operation period with report_type filter only operation/part
const [opFiltered] = await db.unsafe(`
  WITH latest AS (
    SELECT report_period_start::date AS ps, report_period_end::date AS pe
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
      AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
    GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
  ),
  rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
      COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
      LOWER(COALESCE(source.op_part_code, '')) AS code,
      LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
    FROM operation_wise_analysis_report source
    INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
    WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
    ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
  )
  SELECT (SELECT pe::text FROM latest) AS pe,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align'), 0)::float AS wa,
    COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc'), 0)::float AS wb,
    COALESCE(SUM(qty) FILTER (WHERE code LIKE 'npneng%'), 0)::float AS oil
  FROM rows`)
console.log('op filtered operation/part:', opFiltered)

await db.end()
