/**
 * Diagnose KIA VAS LY availability for common date ranges.
 */
require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

const vasFilter = `
  (
    description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
    OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
    OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
    OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
  )
  AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
`

async function checkOperationWise(db, startDate, endDate) {
  const [exact] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
        report_period_start::date AS report_period_start,
        report_period_end::date AS report_period_end,
        LOWER(COALESCE(op_part_desc, '')) AS description,
        COALESCE(NULLIF(total_amt::text, '')::numeric, 0) AS amount
      FROM operation_wise_analysis_report
      WHERE report_period_start = '${startDate}'::date
        AND report_period_end = '${endDate}'::date
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount),0)::float AS vas
    FROM operation_rows WHERE ${vasFilter}
  `)

  const [covered] = await db.unsafe(`
    WITH latest_period AS (
      SELECT report_period_start::date AS report_period_start, report_period_end::date AS report_period_end
      FROM operation_wise_analysis_report
      WHERE report_period_start = '${startDate}'::date
        AND report_period_end <= '${endDate}'::date
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      GROUP BY 1,2 ORDER BY report_period_end DESC LIMIT 1
    ),
    operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        LOWER(COALESCE(source.op_part_desc, '')) AS description,
        COALESCE(NULLIF(source.total_amt::text, '')::numeric, 0) AS amount
      FROM operation_wise_analysis_report source
      INNER JOIN latest_period lp
        ON source.report_period_start::date = lp.report_period_start
       AND source.report_period_end::date = lp.report_period_end
      WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount),0)::float AS vas
    FROM operation_rows WHERE ${vasFilter}
  `)

  return { exact, covered }
}

async function checkAdvWise(db, startDate, endDate) {
  const [row] = await db.unsafe(`
    WITH invoice_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description,
        COALESCE(NULLIF(taxable_amount::text, '')::numeric, 0) AS amount
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= '${startDate}'::date
        AND gst_invoice_date < ('${endDate}'::date + INTERVAL '1 day')
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS rows, COALESCE(SUM(amount),0)::float AS vas
    FROM invoice_rows WHERE ${vasFilter}
  `)
  return row
}

async function main() {
  const url = await pickDatabaseUrl(postgres, '[vas-ly]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const [opMeta] = await db.unsafe(`
    SELECT COUNT(*)::int AS rows,
      MIN(report_period_start)::text AS min_start,
      MAX(report_period_end)::text AS max_end,
      COUNT(DISTINCT (report_period_start, report_period_end))::int AS periods
    FROM operation_wise_analysis_report
    WHERE LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
  `)
  const [advMeta] = await db.unsafe(`
    SELECT COUNT(*)::int AS rows,
      MIN(gst_invoice_date)::text AS min_gst,
      MAX(gst_invoice_date)::text AS max_gst
    FROM adv_wise_lubricants_vas
  `)

  console.log('operation_wise:', opMeta)
  console.log('adv_wise:', advMeta)

  const ranges = [
    { label: 'CY MTD', cy: ['2026-06-01', '2026-06-14'], ly: ['2025-06-01', '2025-06-14'] },
    { label: 'CY MTD (today=14)', cy: ['2026-06-01', '2026-06-14'], ly: ['2025-06-01', '2025-06-14'] },
    { label: 'CY full Jun partial', cy: ['2026-06-01', '2026-06-04'], ly: ['2025-06-01', '2025-06-04'] },
    { label: 'CY Mar MTD', cy: ['2026-03-01', '2026-03-14'], ly: ['2025-03-01', '2025-03-14'] },
  ]

  for (const r of ranges) {
    console.log(`\n=== ${r.label} ===`)
    for (const [tag, start, end] of [['CY', ...r.cy], ['LY', ...r.ly]]) {
      const op = await checkOperationWise(db, start, end)
      const adv = await checkAdvWise(db, start, end)
      console.log(`${tag} ${start}..${end}`)
      console.log('  op exact:', op.exact)
      console.log('  op covered:', op.covered)
      console.log('  adv:', adv)
    }
  }

  const [periods] = await db.unsafe(`
    SELECT report_period_start::text AS ps, report_period_end::text AS pe, COUNT(*)::int AS rows
    FROM operation_wise_analysis_report
    WHERE LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      AND report_period_start >= '2025-03-01'
    GROUP BY 1,2 ORDER BY ps, pe LIMIT 30
  `)
  console.log('\noperation_wise periods sample:', periods)

  await db.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
