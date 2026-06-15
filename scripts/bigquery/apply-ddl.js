/**
 * Apply BigQuery DDL files via the Node client (no bq CLI required).
 *
 * Usage:
 *   node scripts/bigquery/apply-ddl.js
 *
 * Requires: GOOGLE_CLOUD_PROJECT, GOOGLE_APPLICATION_CREDENTIALS
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

dotenv.config({ quiet: true })

const DDL_FILES = [
  '000_datasets.sql',
  '001_platinum_facts.sql',
  '002_kia_facts.sql',
  '003_hyundai_facts.sql',
  '010_aggregates.sql',
]

function splitStatements(sql) {
  const withoutComments = sql.replace(/--[^\n]*/g, '')
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

async function runStatement(bq, statement, location, label) {
  const [job] = await bq.createQueryJob({
    query: statement,
    location,
  })
  await job.getQueryResults()
  console.log(`[ddl] OK ${label}`)
}

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required')

  const location = process.env.BIGQUERY_LOCATION || 'asia-south1'
  const { BigQuery } = await import('@google-cloud/bigquery')
  const bq = new BigQuery({ projectId })

  for (const file of DDL_FILES) {
    const filePath = path.join(__dirname, 'ddl', file)
    const raw = fs.readFileSync(filePath, 'utf8')
    const sql = raw.replace(/\$\{PROJECT_ID\}/g, projectId)
    const statements = splitStatements(sql)
    console.log(`[ddl] ${file}: ${statements.length} statement(s)`)

    for (let index = 0; index < statements.length; index += 1) {
      const label = `${file} #${index + 1}`
      console.log(`[ddl] running ${label}...`)
      await runStatement(bq, statements[index], location, label)
    }
  }

  console.log('[ddl] completed')
}

main().catch((error) => {
  console.error('[ddl] failed', error)
  process.exit(1)
})
