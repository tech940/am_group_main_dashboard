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
    // Check if WA/WB codes appear in the operation report for N6250
    console.log('\n=== WA/WB codes in am_platinum_operation_wise_analysis_report for N6250 ===')
    const wawb = await sql`
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        LOWER(COALESCE(report_type, '')) AS report_type,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        COUNT(*) AS row_count,
        ROUND(SUM(COALESCE(total_amt, 0)::numeric), 2) AS total_amount
      FROM am_platinum_operation_wise_analysis_report
      WHERE UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
        'A10AAGM06WHAL','A10AAGM06WHALAA',
        'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW'
      )
        AND (
          CASE
            WHEN COALESCE(
              NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
              'UNMAPPED'
            ) = 'N6824' THEN 'N6250'
            ELSE COALESCE(
              NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
              'UNMAPPED'
            )
          END
        ) = 'N6250'
        AND report_period_start >= '2026-06-01'
      GROUP BY code, report_type, period_start, period_end
      ORDER BY period_end DESC, code
    `
    if (wawb.length === 0) {
      console.log('❌ No WA/WB codes found for N6250 in June 2026.')
      console.log('   This means the operation report for N6250 does not contain WA/WB codes at all.')
      console.log('   WA/WB counts will be 0 until these codes appear in the source data.')
    } else {
      console.table(wawb)
    }

    // Check what report_types are present for WA/WB across ALL dealers
    console.log('\n=== All report_type values for WA/WB codes (any dealer, any period) ===')
    const allTypes = await sql`
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        LOWER(COALESCE(report_type, '')) AS report_type,
        COUNT(*) AS row_count
      FROM am_platinum_operation_wise_analysis_report
      WHERE UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
        'A10AAGM06WHAL','A10AAGM06WHALAA',
        'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW'
      )
      GROUP BY code, report_type
      ORDER BY code, row_count DESC
    `
    if (allTypes.length === 0) {
      console.log('❌ WA/WB codes do not appear in am_platinum_operation_wise_analysis_report at all.')
    } else {
      console.table(allTypes)
    }

    // Check the advisor table for WA/WB in June 2026
    console.log('\n=== WA/WB in am_platinum_operation_wise_analysis_advisor_report (June 2026, N6250) ===')
    const advisorWawb = await sql`
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        LOWER(COALESCE(report_type, '')) AS report_type,
        COUNT(*) AS row_count,
        ROUND(SUM(COALESCE(total_amt, 0)::numeric), 2) AS total_amount
      FROM am_platinum_operation_wise_analysis_advisor_report
      WHERE UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
        'A10AAGM06WHAL','A10AAGM06WHALAA',
        'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW'
      )
        AND source_dealer_code = 'N6250'
        AND report_month >= '2026-06-01'
      GROUP BY code, report_type
      ORDER BY code
    `
    if (advisorWawb.length === 0) {
      console.log('❌ WA/WB codes not found in advisor report for N6250 June 2026 either.')
    } else {
      console.table(advisorWawb)
    }

    // Check what total_count values look like for VAS codes in the advisor report
    console.log('\n=== Sample VAS rows from advisor report for N6250 (to confirm count column) ===')
    const sample = await sql`
      SELECT
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        report_type,
        total_count,
        total_amt,
        report_month::date
      FROM am_platinum_operation_wise_analysis_advisor_report
      WHERE source_dealer_code = 'N6250'
        AND report_month >= '2026-06-01'
        AND UPPER(TRIM(COALESCE(op_part_code, ''))) IN (
          'A10AAGM06WHAL','A10AAGM06WHALAA',
          'A10AAGM07WHBL','A10AAGM07WHBLAA','A10AAGM07WHBLHW',
          'A10AAACDVASHR','A10AAECMVASHR','A10AASPMVASHR'
        )
      LIMIT 20
    `
    console.table(sample.length ? sample : [{ result: 'No matching rows' }])

  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
