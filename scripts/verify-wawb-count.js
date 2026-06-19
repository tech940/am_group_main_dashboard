const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

async function main() {
  const raw = process.env.DATABASE_URL || ''
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }

  const sql = postgres(url.toString(), {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
  })

  try {
    // Check total_count for WA/WB and VAS codes for N6250 in June
    console.log('\n=== WA/WB raw rows with total_count for N6250 June 2026 ===')
    const rows = await sql`
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        op_part_desc,
        report_type,
        total_count,
        total_amt,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        row_hash,
        uploaded_at::date AS uploaded
      FROM am_platinum_operation_wise_analysis_report
      WHERE UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
        'A10AAGM06WHAL','A10AAGM06WHALAA',
        'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW'
      )
        AND (
          CASE
            WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED') = 'N6824'
            THEN 'N6250'
            ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED')
          END
        ) = 'N6250'
        AND report_period_start >= '2026-06-01'
      ORDER BY op_part_code, uploaded_at DESC
    `
    console.table(rows)

    // Now simulate what fetchOperations does — check the DISTINCT ON dedup
    console.log('\n=== Simulated fetchOperations output for N6250 June 2026 (WA/WB only) ===')
    const sim = await sql`
      WITH candidate_period AS (
        SELECT report_period_start::date AS period_start, report_period_end::date AS period_end
        FROM am_platinum_operation_wise_analysis_report
        WHERE report_period_start <= CURRENT_DATE
          AND report_period_end >= '2026-06-01'
          AND (
            CASE WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED') = 'N6824'
            THEN 'N6250'
            ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED')
            END
          ) = 'N6250'
        GROUP BY report_period_start::date, report_period_end::date
        ORDER BY
          CASE WHEN report_period_start::date = '2026-06-01' AND report_period_end::date = CURRENT_DATE THEN 0
               WHEN report_period_start::date >= '2026-06-01' AND report_period_end::date <= CURRENT_DATE THEN 1
               ELSE 2
          END,
          report_period_end::date DESC
        LIMIT 1
      ),
      latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          source.op_part_code,
          source.report_type,
          COALESCE(source.total_count, 0)::numeric AS operation_count,
          COALESCE(source.total_amt, 0)::numeric AS amount
        FROM am_platinum_operation_wise_analysis_report source
        JOIN candidate_period period
          ON source.report_period_start::date = period.period_start
         AND source.report_period_end::date = period.period_end
        WHERE (
            CASE WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source.source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED') = 'N6824'
            THEN 'N6250'
            ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source.source_dealer_code,''))), ''), 'ACTIVE'), 'UNMAPPED')
            END
          ) = 'N6250'
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        report_type,
        SUM(operation_count) AS wa_wb_count,
        SUM(amount) AS total_amount
      FROM latest
      WHERE UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
        'A10AAGM06WHAL','A10AAGM06WHALAA',
        'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW'
      )
      GROUP BY op_part_code, report_type
    `
    console.table(sim.length ? sim : [{ result: 'No WA/WB rows after dedup' }])

    // Check what total_count column exists
    console.log('\n=== Column names in am_platinum_operation_wise_analysis_report ===')
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'am_platinum_operation_wise_analysis_report'
        AND column_name ILIKE '%count%'
      ORDER BY column_name
    `
    console.table(cols)

  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
