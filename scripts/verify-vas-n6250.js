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
    // Show last 5 periods for N6250 with VAS amounts
    const rows = await sql`
      SELECT
        dealer_code,
        period_start,
        period_end,
        period_rows,
        source_rows,
        ROUND(vas_amount::numeric, 2) AS vas_amount,
        uploaded_at::date AS uploaded_date
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N6250'
      ORDER BY period_end DESC
      LIMIT 10
    `
    console.log('\n=== VAS Period Summary for N6250 (latest 10 periods) ===')
    console.table(rows)

    // Also check the current MTD period (June 2026)
    const mtd = await sql`
      SELECT
        dealer_code,
        period_start,
        period_end,
        period_rows,
        source_rows,
        ROUND(vas_amount::numeric, 2) AS vas_amount
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N6250'
        AND period_start <= CURRENT_DATE
        AND period_end >= CURRENT_DATE
    `
    console.log('\n=== Current-period VAS for N6250 ===')
    console.table(mtd.length ? mtd : [{ result: 'No exact period covering today' }])

  } finally {
    await sql.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
