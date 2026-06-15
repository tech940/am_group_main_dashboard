/**
 * Incremental Supabase → BigQuery sync for analytics fact tables.
 *
 * Usage:
 *   node scripts/bigquery/sync-incremental.js --table am_platinum_ro_billing_report
 *   node scripts/bigquery/sync-incremental.js --full
 *   node scripts/bigquery/sync-incremental.js --dry-run --table ro_billing_report
 *
 * Requires: DATABASE_URL, GOOGLE_CLOUD_PROJECT
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

const TABLE_MAP = require('./table-map.js').POSTGRES_TO_BIGQUERY_TABLE
const { pickDatabaseUrl } = require('./db-url.js')

const BATCH_SIZE = Number(process.env.BQ_SYNC_BATCH_SIZE || 5000)

function parseArgs() {
  const args = process.argv.slice(2)
  const tableIdx = args.indexOf('--table')
  return {
    table: tableIdx >= 0 ? args[tableIdx + 1] : null,
    full: args.includes('--full'),
    dryRun: args.includes('--dry-run'),
  }
}

async function getBigQuery() {
  const { BigQuery } = await import('@google-cloud/bigquery')
  return new BigQuery({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
}

async function loadNdjsonBatch(bqTable, filePath, writeDisposition) {
  const location = process.env.BIGQUERY_LOCATION || 'asia-south1'
  const load = promisify(bqTable.load.bind(bqTable))
  await load(filePath, {
    sourceFormat: 'NEWLINE_DELIMITED_JSON',
    writeDisposition,
    ignoreUnknownValues: true,
    location,
  })
}

async function syncTable(db, bq, postgresTable, bqPath, dryRun) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is required')

  const [dataset, table] = bqPath.split('.')
  const countRows = await db`SELECT COUNT(*)::int AS count FROM ${db(postgresTable)}`
  const total = Number(countRows[0]?.count || 0)
  console.log(`[sync] ${postgresTable} → ${projectId}.${bqPath} (${total} rows)`)

  if (dryRun) return { table: postgresTable, total, synced: 0, dryRun: true }
  if (total === 0) return { table: postgresTable, total, synced: 0, batchId: crypto.randomUUID() }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-sync-'))
  let offset = 0
  let synced = 0
  let batchIndex = 0

  try {
    while (offset < total) {
      const rows = await db`
        SELECT to_jsonb(t) AS payload
        FROM ${db(postgresTable)} AS t
        ORDER BY id
        LIMIT ${BATCH_SIZE}
        OFFSET ${offset}
      `
      if (!rows.length) break

      const tmpFile = path.join(tmpDir, `batch-${batchIndex}.ndjson`)
      const lines = rows.map((row) => JSON.stringify({
        ...row.payload,
        ingested_at: new Date().toISOString(),
      }))
      fs.writeFileSync(tmpFile, `${lines.join('\n')}\n`)

      const bqTable = bq.dataset(dataset).table(table)
      await loadNdjsonBatch(
        bqTable,
        tmpFile,
        batchIndex === 0 ? 'WRITE_TRUNCATE' : 'WRITE_APPEND',
      )

      synced += rows.length
      offset += BATCH_SIZE
      batchIndex += 1
      console.log(`[sync] ${postgresTable}: ${synced}/${total}`)
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }

  return { table: postgresTable, total, synced, batchId: crypto.randomUUID() }
}

async function main() {
  const { table, full, dryRun } = parseArgs()
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

  const targets = table
    ? { [table]: TABLE_MAP[table] }
    : full
      ? TABLE_MAP
      : null

  if (!targets) {
    throw new Error('Pass --table <name> or --full')
  }

  const databaseUrl = await pickDatabaseUrl(postgres, '[sync]')
  const db = postgres(databaseUrl, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    connect_timeout: 30,
    connection: {
      application_name: 'bq_sync_incremental',
      statement_timeout: 600_000,
    },
  })

  const bq = await getBigQuery()
  const results = []

  try {
    for (const [postgresTable, bqPath] of Object.entries(targets)) {
      if (!bqPath) {
        console.warn(`[sync] skipping unmapped table ${postgresTable}`)
        continue
      }
      results.push(await syncTable(db, bq, postgresTable, bqPath, dryRun))
    }
    console.log('[sync] completed', results)
  } finally {
    await db.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('[sync] failed', error)
  process.exit(1)
})
