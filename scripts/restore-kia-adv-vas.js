/**
 * Restore KIA adv_wise_lubricants_vas from local JSON backup.
 * Keeps an immutable full-archive copy, restores filtered rows (2025-01-01 .. today).
 *
 * Usage:
 *   node scripts/restore-kia-adv-vas.js --dry-run
 *   node scripts/restore-kia-adv-vas.js
 */
require('dotenv').config({ quiet: true })

const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const { databaseUrlCandidates } = require('./bigquery/db-url')

const TABLE_NAME = 'adv_wise_lubricants_vas'
const RECENT_START = '2025-01-01'
const SOURCE_BACKUP = path.join(
  process.cwd(),
  'backups/analytics-tables/2026-06-15/adv_wise_lubricants_vas.json',
)
const ARCHIVE_DIR = path.join(process.cwd(), 'backups/analytics-tables/full-archive')
const BATCH_SIZE = 250

function parseArgs() {
  return {
    dryRun: process.argv.includes('--dry-run'),
    finalize: process.argv.includes('--finalize'),
  }
}

function assertSafeTableName(tableName) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) throw new Error(`Unsafe table: ${tableName}`)
}

async function connectPg() {
  const dns = require('node:dns/promises')
  let lastError

  for (const url of databaseUrlCandidates()) {
    const endpoint = new URL(url)
    const hosts = [endpoint.hostname]
    try {
      const { address } = await dns.lookup(endpoint.hostname, { family: 6 })
      if (address) hosts.push(address)
    } catch {
      // IPv4-only host
    }

    for (const host of hosts) {
      const candidate = new URL(url)
      candidate.hostname = host.includes(':') ? `[${host}]` : host
      const client = new Client({
        connectionString: candidate.toString(),
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 90_000,
        query_timeout: 1_800_000,
      })
      try {
        await client.connect()
        await client.query('SELECT 1')
        console.log(`[restore-adv-vas] connected via ${candidate.hostname}:${candidate.port}`)
        return client
      } catch (error) {
        lastError = error
        await client.end().catch(() => {})
      }
    }
  }

  throw lastError || new Error('Could not connect to Supabase')
}

function effectiveDate(row) {
  return row.gst_invoice_date || null
}

function rowInRetentionWindow(row, today = new Date().toISOString().slice(0, 10)) {
  const date = effectiveDate(row)
  if (!date) return false
  return date >= RECENT_START && date <= today
}

function collectColumns(rows) {
  const columns = new Set()
  for (const row of rows) {
    for (const key of Object.keys(row)) columns.add(key)
  }
  const ordered = [...columns]
  ordered.sort((a, b) => {
    if (a === 'id') return -1
    if (b === 'id') return 1
    if (a === 'row_hash') return -1
    if (b === 'row_hash') return 1
    return a.localeCompare(b)
  })
  return ordered
}

function inferPgType(column, rows) {
  if (column === 'id') return 'BIGINT'
  if (column === 'uploaded_at') return 'TIMESTAMPTZ'
  if (column.endsWith('_date')) return 'DATE'

  const samples = rows
    .map((row) => row[column])
    .filter((value) => value !== null && value !== undefined)
    .slice(0, 1000)

  if (samples.length === 0) return 'TEXT'
  if (samples.every((value) => typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(String(value)))) {
    return 'NUMERIC'
  }
  return 'TEXT'
}

function buildCreateTableSql(columns, rows) {
  const defs = columns.map((column) => {
    const type = inferPgType(column, rows)
    if (column === 'id') return '"id" BIGINT PRIMARY KEY'
    if (column === 'row_hash') return '"row_hash" TEXT NOT NULL'
    return `"${column}" ${type}`
  })
  return `CREATE TABLE IF NOT EXISTS public."${TABLE_NAME}" (\n  ${defs.join(',\n  ')}\n)`
}

function archiveFullBackup(payload) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  const archivePath = path.join(
    ARCHIVE_DIR,
    `kia-${TABLE_NAME}-full-${payload.rowCount}rows-${payload.exportedAt.slice(0, 10)}.json`,
  )
  if (!fs.existsSync(archivePath)) {
    fs.copyFileSync(SOURCE_BACKUP, archivePath)
    console.log(`[restore-adv-vas] archived full backup: ${archivePath}`)
  } else {
    console.log(`[restore-adv-vas] full archive already present: ${archivePath}`)
  }
  return archivePath
}

async function tableExists(client) {
  const result = await client.query(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${TABLE_NAME}`],
  )
  return Boolean(result.rows[0]?.exists)
}

async function insertBatch(client, columns, rows) {
  const colList = columns.map((column) => `"${column}"`).join(', ')
  const values = []
  const params = []
  let paramIndex = 1

  for (const row of rows) {
    const tuple = columns.map((column) => {
      params.push(row[column] ?? null)
      return `$${paramIndex++}`
    })
    values.push(`(${tuple.join(', ')})`)
  }

  await client.query(
    `INSERT INTO public."${TABLE_NAME}" (${colList}) VALUES ${values.join(', ')}`,
    params,
  )
}

async function createIndexes(client) {
  await client.query(`
    CREATE INDEX IF NOT EXISTS adv_wise_lubricants_vas_uploaded_at_idx
      ON public."${TABLE_NAME}" (uploaded_at)
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS adv_wise_lubricants_vas_gst_invoice_date_idx
      ON public."${TABLE_NAME}" (gst_invoice_date)
  `)
  await client.query(`
    CREATE INDEX IF NOT EXISTS adv_wise_lubricants_vas_ro_close_date_idx
      ON public."${TABLE_NAME}" (ro_close_date)
  `)
}

async function applyRetentionDelete(client) {
  const result = await client.query(`
    DELETE FROM public."${TABLE_NAME}"
    WHERE gst_invoice_date IS NULL
       OR gst_invoice_date::date < DATE '${RECENT_START}'
       OR gst_invoice_date::date > CURRENT_DATE
  `)
  return result.rowCount || 0
}

async function logTableSummary(client) {
  const [countResult, rangeResult] = await Promise.all([
    client.query(`SELECT COUNT(*)::bigint AS count FROM public."${TABLE_NAME}"`),
    client.query(`
      SELECT
        MIN(gst_invoice_date)::text AS min_gst,
        MAX(gst_invoice_date)::text AS max_gst,
        MIN((uploaded_at AT TIME ZONE 'UTC')::date)::text AS min_uploaded,
        MAX((uploaded_at AT TIME ZONE 'UTC')::date)::text AS max_uploaded
      FROM public."${TABLE_NAME}"
    `),
  ])

  const sizeResult = await client.query(`
    SELECT pg_total_relation_size('public."${TABLE_NAME}"'::regclass)::bigint AS bytes
  `)

  console.log('[restore-adv-vas] complete', {
    restoredRows: Number(countResult.rows[0]?.count || 0),
    gstRange: `${rangeResult.rows[0]?.min_gst ?? '—'} .. ${rangeResult.rows[0]?.max_gst ?? '—'}`,
    uploadedRange: `${rangeResult.rows[0]?.min_uploaded ?? '—'} .. ${rangeResult.rows[0]?.max_uploaded ?? '—'}`,
    tableSizeMb: (Number(sizeResult.rows[0]?.bytes || 0) / (1024 * 1024)).toFixed(2),
  })
}

async function main() {
  const { dryRun, finalize } = parseArgs()
  assertSafeTableName(TABLE_NAME)

  if (finalize) {
    const client = await connectPg()
    try {
      const exists = await tableExists(client)
      if (!exists) throw new Error(`${TABLE_NAME} does not exist`)
      const deleted = await applyRetentionDelete(client)
      console.log(`[restore-adv-vas] post-restore retention delete: ${deleted}`)
      await createIndexes(client)
      await logTableSummary(client)
    } finally {
      await client.end().catch(() => {})
    }
    return
  }

  if (!fs.existsSync(SOURCE_BACKUP)) {
    throw new Error(`Backup not found: ${SOURCE_BACKUP}`)
  }

  const payload = JSON.parse(fs.readFileSync(SOURCE_BACKUP, 'utf8'))
  const allRows = payload.rows || []
  const keepRows = allRows.filter((row) => rowInRetentionWindow(row))
  const dropRows = allRows.length - keepRows.length
  const archivePath = archiveFullBackup(payload)

  console.log(`[restore-adv-vas] source backup: ${SOURCE_BACKUP}`)
  console.log(`[restore-adv-vas] full rows: ${allRows.length}`)
  console.log(`[restore-adv-vas] rows to restore (>= ${RECENT_START}): ${keepRows.length}`)
  console.log(`[restore-adv-vas] rows excluded before restore: ${dropRows}`)

  if (dryRun) {
    console.log('[restore-adv-vas] dry-run complete')
    return
  }

  const columns = collectColumns(allRows)
  const createSql = buildCreateTableSql(columns, allRows)
  const client = await connectPg()

  try {
    const exists = await tableExists(client)
    if (exists) {
      console.log(`[restore-adv-vas] dropping existing ${TABLE_NAME}`)
      await client.query(`DROP TABLE public."${TABLE_NAME}" CASCADE`)
    }

    console.log(`[restore-adv-vas] creating table (${columns.length} columns)`)
    await client.query(createSql)

    let inserted = 0
    for (let offset = 0; offset < keepRows.length; offset += BATCH_SIZE) {
      const batch = keepRows.slice(offset, offset + BATCH_SIZE)
      await insertBatch(client, columns, batch)
      inserted += batch.length
      console.log(`[restore-adv-vas] inserted ${inserted}/${keepRows.length}`)
    }

    const deleted = await applyRetentionDelete(client)
    console.log(`[restore-adv-vas] post-restore retention delete: ${deleted}`)

    await createIndexes(client)
    await logTableSummary(client)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error('[restore-adv-vas] failed:', error.message)
  process.exit(1)
})
