require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[op-oil]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  for (const end of ['2026-06-15', '2026-06-14', '2026-06-30']) {
    const [row] = await db.unsafe(`
      WITH latest AS (
        SELECT report_period_start::date AS ps, report_period_end::date AS pe
        FROM operation_wise_analysis_report
        WHERE dealer_code = 'JK402'
          AND report_period_start = '2026-06-01'::date
          AND report_period_end <= '${end}'::date
        GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
      ),
      rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS code,
          COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty
        FROM operation_wise_analysis_report source
        INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT (SELECT pe::text FROM latest) AS period_end,
        COALESCE(SUM(qty) FILTER (WHERE code LIKE 'NPNENG2P2BIO%' OR code LIKE 'NPNENG3D1BIC%' OR code LIKE 'NPNENG4D2BIC%'), 0)::float AS coded_qty,
        COALESCE(SUM(qty) FILTER (WHERE code LIKE 'NPNENG%'), 0)::float AS all_npn
      FROM rows
    `)
    console.log('end', end, row)
  }

  const [vas] = await db.unsafe(`
    WITH latest AS (
      SELECT report_period_start::date AS ps, report_period_end::date AS pe
      FROM operation_wise_analysis_report
      WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
      GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
    ),
    rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
        LOWER(COALESCE(source.op_part_desc, '')) AS description
      FROM operation_wise_analysis_report source
      INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT (SELECT pe::text FROM latest) AS period_end, COALESCE(SUM(amount), 0)::float AS vas
    FROM rows WHERE description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
  `)
  console.log('vas partial period:', vas)
  console.log('implied vas for B41=3719:', 554378 - 3719 * 134)

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
