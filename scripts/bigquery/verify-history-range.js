require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./db-url')

async function queryPostgres() {
  const url = await pickDatabaseUrl(postgres, '[verify]')
  const db = postgres(url, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 60,
  })
  try {
    const [row] = await db`
      SELECT
        MIN(bill_date)::text AS min_bill_date,
        MAX(bill_date)::text AS max_bill_date,
        COUNT(*)::int AS row_count
      FROM am_platinum_ro_billing_report
    `
    return row
  } finally {
    await db.end({ timeout: 5 })
  }
}

async function queryBigQuery() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required')
  const location = process.env.BIGQUERY_LOCATION || 'asia-south1'
  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId })
  const [job] = await bq.createQueryJob({
    query: `
      SELECT
        CAST(MIN(bill_date) AS STRING) AS min_bill_date,
        CAST(MAX(bill_date) AS STRING) AS max_bill_date,
        COUNT(*) AS row_count
      FROM \`${projectId}.platinum_facts.ro_billing\`
    `,
    location,
  })
  const [rows] = await job.getQueryResults()
  return {
    min_bill_date: rows[0]?.min_bill_date ?? null,
    max_bill_date: rows[0]?.max_bill_date ?? null,
    row_count: Number(rows[0]?.row_count ?? 0),
  }
}

async function main() {
  const [pg, bq] = await Promise.all([queryPostgres(), queryBigQuery()])

  console.log('[verify] Supabase am_platinum_ro_billing_report')
  console.log(pg)
  console.log('[verify] BigQuery platinum_facts.ro_billing')
  console.log(bq)

  const sameCount = pg.row_count === bq.row_count
  const sameMin = pg.min_bill_date === bq.min_bill_date
  const sameMax = pg.max_bill_date === bq.max_bill_date

  console.log('[verify] comparison')
  console.log({
    count_match: sameCount,
    min_date_match: sameMin,
    max_date_match: sameMax,
    count_delta: pg.row_count - bq.row_count,
  })

  if (!sameCount || !sameMin || !sameMax) {
    console.log('[verify] RESULT: mismatch — BigQuery sandbox/history retention is likely limiting older partitions')
    process.exit(1)
  }

  console.log('[verify] RESULT: full parity on count and bill_date range')
}

main().catch((error) => {
  console.error('[verify] failed', error.message)
  process.exit(1)
})
