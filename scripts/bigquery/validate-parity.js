/**
 * Compare Postgres vs BigQuery row counts for analytics tables.
 *
 * Usage:
 *   node scripts/bigquery/validate-parity.js
 *   node scripts/bigquery/validate-parity.js --table am_platinum_ro_billing_report
 *
 * Requires: DATABASE_URL, GOOGLE_CLOUD_PROJECT
 */
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

const TABLE_MAP = require('./table-map.js').POSTGRES_TO_BIGQUERY_TABLE
const { pickDatabaseUrl } = require('./db-url.js')

async function countBigQuery(bq, projectId, datasetTable) {
  const [dataset, table] = datasetTable.split('.')
  const [job] = await bq.createQueryJob({
    query: `SELECT COUNT(*) AS row_count FROM \`${projectId}.${dataset}.${table}\``,
  })
  const [rows] = await job.getQueryResults()
  return Number(rows[0]?.row_count || 0)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('GOOGLE_CLOUD_PROJECT is required')

  const tableArgIdx = process.argv.indexOf('--table')
  const onlyTable = tableArgIdx >= 0 ? process.argv[tableArgIdx + 1] : null
  const targets = onlyTable
    ? { [onlyTable]: TABLE_MAP[onlyTable] }
    : TABLE_MAP

  const databaseUrl = await pickDatabaseUrl(postgres, '[parity]')
  const db = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 30,
  })

  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
  const projectId = process.env.GOOGLE_CLOUD_PROJECT

  let failures = 0

  try {
    for (const [postgresTable, bqPath] of Object.entries(targets)) {
      if (!bqPath) continue
      const [pg] = await db`SELECT COUNT(*)::int AS count FROM ${db(postgresTable)}`
      const pgCount = Number(pg?.count || 0)
      let bqCount = 0
      try {
        bqCount = await countBigQuery(bq, projectId, bqPath)
      } catch (error) {
        console.warn(`[parity] ${postgresTable}: BigQuery count failed — ${error.message}`)
        failures += 1
        continue
      }

      const delta = pgCount - bqCount
      const ok = delta === 0
      if (!ok) failures += 1
      console.log(`[parity] ${postgresTable}: postgres=${pgCount} bigquery=${bqCount} delta=${delta} ${ok ? 'PASS' : 'FAIL'}`)
    }
  } finally {
    await db.end({ timeout: 5 })
  }

  if (failures > 0) process.exit(1)
}

main().catch((error) => {
  console.error('[parity] failed', error)
  process.exit(1)
})
