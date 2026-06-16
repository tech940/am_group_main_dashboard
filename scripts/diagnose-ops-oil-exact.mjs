import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[exact]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

async function counts(pe, opts = { waOp: false, wbOp: true }) {
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS operation_count,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT *,
        (operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))') AS is_wa,
        (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))') AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa ${opts.waOp ? "AND report_type = 'operation'" : ''}), 0)::float AS wa,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb ${opts.wbOp ? "AND report_type = 'operation'" : ''}), 0)::float AS wb
    FROM classified`)
  return r
}

async function oilQty(pe) {
  const prefixes = ['NPNENG2P2BIO', 'NPNENG3D1BIC', 'NPNENG4D2BIC']
  const prefixMatch = prefixes.map((p) => `(UPPER(TRIM(COALESCE(op_part_code, ''))) LIKE '${p}%' OR UPPER(TRIM(COALESCE(op_part_code, ''))) LIKE 'NPNENG%')`).join(' OR ')
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS op_part_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
        AND LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT COALESCE(SUM(quantity) FILTER (WHERE (${prefixMatch})), 0)::float AS engine_mtd FROM operation_rows`)
  return r.engine_mtd
}

for (const pe of ['2026-06-13', '2026-06-16']) {
  console.log(pe, 'all WA/WB op-filter WB:', await counts(pe))
  console.log(pe, 'WA op-only WB op:', await counts(pe, { waOp: true, wbOp: true }))
  console.log(pe, 'oil:', await oilQty(pe))
}

await db.end()
