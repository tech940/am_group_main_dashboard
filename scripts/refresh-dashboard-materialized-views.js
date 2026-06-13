const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

const views = [
  'workshop_performance_jc_summary_v1',
  'workshop_operation_addon_summary_v1',
  'am_platinum_workshop_performance_jc_summary_v2',
  'am_platinum_ro_billing_daily_summary_v2',
  'am_platinum_vas_period_summary_v1',
  'am_platinum_ro_billing_daily_summary_v1',
  'am_platinum_open_ro_daily_summary_v1',
  'am_platinum_complaints_daily_summary_v1',
]

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    for (const view of views) {
      const startedAt = Date.now()
      console.log(`[refresh] ${view} started`)
      await sql.unsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`)
      console.log(`[refresh] ${view} completed in ${Date.now() - startedAt}ms`)
    }

    const coverage = await sql`
      SELECT 'workshop_performance_jc_summary_v1' AS view_name,
             MIN(report_date)::text AS min_date,
             MAX(report_date)::text AS max_date,
             COUNT(*)::int AS rows
      FROM workshop_performance_jc_summary_v1
      UNION ALL
      SELECT 'workshop_operation_addon_summary_v1' AS view_name,
             MIN(report_month)::text AS min_date,
             MAX(report_month)::text AS max_date,
             COUNT(*)::int AS rows
      FROM workshop_operation_addon_summary_v1
      UNION ALL
      SELECT 'am_platinum_workshop_performance_jc_summary_v2' AS view_name,
             MIN(report_date)::text AS min_date,
             MAX(report_date)::text AS max_date,
             COUNT(*)::int AS rows
      FROM am_platinum_workshop_performance_jc_summary_v2
      UNION ALL
      SELECT 'am_platinum_ro_billing_daily_summary_v2' AS view_name,
             MIN(bill_date)::text AS min_date,
             MAX(bill_date)::text AS max_date,
             COUNT(*)::int AS rows
      FROM am_platinum_ro_billing_daily_summary_v2
      UNION ALL
      SELECT 'am_platinum_vas_period_summary_v1' AS view_name,
             MIN(period_start)::text AS min_date,
             MAX(period_end)::text AS max_date,
             COUNT(*)::int AS rows
      FROM am_platinum_vas_period_summary_v1
      ORDER BY view_name
    `

    console.table(coverage)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[refresh] failed', error)
  process.exit(1)
})
