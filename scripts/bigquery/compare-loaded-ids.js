require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[compare]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  const loc = process.env.BIGQUERY_LOCATION || 'asia-south1'

  const pgIds = await db.unsafe(
    'SELECT id::text FROM am_platinum_ro_billing_report ORDER BY id LIMIT 100'
  )
  const [job] = await bq.createQueryJob({
    query: `SELECT CAST(id AS STRING) AS id FROM \`${projectId}.platinum_facts.ro_billing\` ORDER BY id`,
    location: loc,
  })
  const [bqRows] = await job.getQueryResults()
  const bqIds = new Set(bqRows.map((row) => row.id))
  const missing = pgIds.map((row) => row.id).filter((id) => !bqIds.has(id))
  console.log('pg first100', pgIds.length, 'bq total', bqRows.length, 'missing from first100', missing.length)
  console.log('missing sample', missing.slice(0, 10))
  await db.end()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
