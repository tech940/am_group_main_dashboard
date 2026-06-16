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

async function main() {
  const url = await pickDatabaseUrl(postgres, '[vas2]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const periods = await db.unsafe(`
    SELECT report_period_start::text AS ps, report_period_end::text AS pe, COUNT(*)::int AS rows
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402' AND report_period_start >= '2026-06-01'
    GROUP BY 1,2 ORDER BY 1,2
  `)
  console.log('periods:', periods)

  for (const p of periods) {
    const [row] = await db.unsafe(`
      WITH rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
          LOWER(COALESCE(op_part_desc, '')) AS description
        FROM operation_wise_analysis_report
        WHERE dealer_code = 'JK402'
          AND report_period_start = '${p.ps}'::date AND report_period_end = '${p.pe}'::date
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas,
        COALESCE(SUM(amount), 0)::float AS total
      FROM rows
    `)
    console.log(p.ps, p.pe, row)
  }

  const [advVas] = await db.unsafe(`
    WITH rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(taxable_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
        LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= '2026-06-01' AND gst_invoice_date < '2026-06-16'
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), retail_dealer_code, ''))) = 'JK402'
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas FROM rows
  `)
  console.log('adv june vas:', advVas)

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
