require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[ops]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  for (const end of ['2026-06-13', '2026-06-15', '2026-06-16']) {
    const [row] = await db.unsafe(`
      WITH latest AS (
        SELECT report_period_start::date AS ps, report_period_end::date AS pe
        FROM operation_wise_analysis_report
        WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '${end}'::date
        GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
      ), rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
          COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amt,
          LOWER(COALESCE(source.op_part_code, '')) AS code,
          LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
        FROM operation_wise_analysis_report source
        INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT (SELECT pe::text FROM latest) AS pe,
        COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'), 0)::float AS wa,
        COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'), 0)::float AS wb,
        COALESCE(SUM(qty) FILTER (WHERE UPPER(TRIM(COALESCE(code, ''))) LIKE 'NPNENG%'), 0)::float AS oil
      FROM rows
      WHERE LOWER(COALESCE(description, '')) NOT IN ('', 'null') OR qty <> 0
    `)
    console.log('end', end, row)
  }

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
