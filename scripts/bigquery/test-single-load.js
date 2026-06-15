require('dotenv').config({ quiet: true })
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[test-load]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })
  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
  const table = bq.dataset('platinum_facts').table('ro_billing')
  const load = promisify(table.load.bind(table))

  const rows = await db`
    SELECT to_jsonb(t) AS payload
    FROM am_platinum_ro_billing_report AS t
    ORDER BY id
    LIMIT 100
  `

  const tmp = path.join(os.tmpdir(), 'bq-test-load.ndjson')
  fs.writeFileSync(
    tmp,
    rows.map((row) => JSON.stringify({ ...row.payload, ingested_at: new Date().toISOString() })).join('\n') + '\n',
  )

  const metadata = await load(tmp, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition: 'WRITE_TRUNCATE',
    ignoreUnknownValues: true,
    location: process.env.BIGQUERY_LOCATION || 'asia-south1',
  })

  const stats = metadata?.statistics?.load
  console.log('load stats', {
    inputRows: stats?.inputRows,
    outputRows: stats?.outputRows,
    badRecords: stats?.badRecords,
    errors: metadata?.status?.errors,
  })

  const [job] = await bq.createQueryJob({
    query: `SELECT COUNT(*) AS c FROM \`${process.env.GOOGLE_CLOUD_PROJECT}.platinum_facts.ro_billing\``,
    location: process.env.BIGQUERY_LOCATION || 'asia-south1',
  })
  const [result] = await job.getQueryResults()
  console.log('bq count', result[0])

  fs.unlinkSync(tmp)
  await db.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
