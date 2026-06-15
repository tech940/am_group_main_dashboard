/**
 * Backup analytics tables to local JSON. Supabase DROP is blocked until BigQuery
 * backfill + parity validation are complete (see docs/bigquery-migration-deploy.md).
 *
 * Usage:
 *   node scripts/backup-and-drop-analytics-tables.js --dry-run
 *   node scripts/backup-and-drop-analytics-tables.js --backup-only
 *   # DROP disabled by default — requires env BQ_MIGRATION_ALLOW_SUPABASE_DROPS=true AND --allow-delete
 *
 * If local Postgres connections time out (storage maxed), export tables in Supabase
 * Table Editor. Do not run DROP SQL until BigQuery parity passes.
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

dotenv.config({ quiet: true })

const { databaseUrlCandidates } = require('./bigquery/db-url')

/** ~132 MB combined; low row counts; all marked for BigQuery migration. */
const DEFAULT_DROP_TABLES = [
  'adv_wise_lubricants_vas',
  'hyundai_psf_yearly',
  'hyundai_operation_wise_analysis_report',
]

const BATCH_SIZE = 2000

function assertSafeTableName(tableName) {
  if (!/^[a-z][a-z0-9_]*$/.test(tableName)) {
    throw new Error(`Unsafe table name: ${tableName}`)
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  const tablesIdx = args.indexOf('--tables')
  return {
    dryRun: args.includes('--dry-run'),
    backupOnly: args.includes('--backup-only'),
    allowDelete: args.includes('--allow-delete'),
    tables: tablesIdx >= 0
      ? args[tablesIdx + 1].split(',').map((name) => name.trim()).filter(Boolean)
      : DEFAULT_DROP_TABLES,
  }
}

function assertDeleteAllowed(allowDelete) {
  if (allowDelete && process.env.BQ_MIGRATION_ALLOW_SUPABASE_DROPS === 'true') return
  throw new Error(
    'Supabase analytics DROP is disabled until BigQuery backfill + parity pass. '
      + 'Use --backup-only or --dry-run. To drop (not recommended yet), set '
      + 'BQ_MIGRATION_ALLOW_SUPABASE_DROPS=true and pass --allow-delete.',
  )
}

function validateTables(tables) {
  for (const tableName of tables) assertSafeTableName(tableName)
}

function backupDirForRun() {
  const date = new Date().toISOString().slice(0, 10)
  const dir = path.join(process.cwd(), 'backups', 'analytics-tables', date)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function timestampForFile(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

async function connectPg() {
  const dns = require('node:dns/promises')
  const { Client } = require('pg')
  let lastError

  for (const url of databaseUrlCandidates()) {
    const endpoint = new URL(url)
    const hosts = [endpoint.hostname]

    try {
      const { address } = await dns.lookup(endpoint.hostname, { family: 6 })
      if (address) hosts.push(address)
    } catch {
      // host may be IPv4-only
    }

    for (const host of hosts) {
      const candidate = new URL(url)
      candidate.hostname = host.includes(':') ? `[${host}]` : host
      const client = new Client({
        connectionString: candidate.toString(),
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 90_000,
        query_timeout: 600_000,
      })

      try {
        await client.connect()
        await client.query('SELECT 1')
        console.log(`[backup-drop] connected via ${candidate.hostname}:${candidate.port}`)
        return client
      } catch (error) {
        lastError = error
        await client.end().catch(() => {})
      }
    }
  }

  throw lastError || new Error('Could not connect to Supabase')
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`public.${tableName}`]
  )
  return Boolean(result.rows[0]?.exists)
}

async function tableStats(client, tableName) {
  const result = await client.query(
    `
      SELECT
        c.reltuples::bigint AS row_estimate,
        pg_total_relation_size(c.oid)::bigint AS total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1
    `,
    [tableName]
  )
  const row = result.rows[0] || {}
  return {
    rowEstimate: Number(row.row_estimate || 0),
    totalBytes: Number(row.total_bytes || 0),
  }
}

async function exportTable(client, tableName, outDir) {
  assertSafeTableName(tableName)
  const quoted = `"${tableName}"`
  const countResult = await client.query(`SELECT COUNT(*)::bigint AS count FROM public.${quoted}`)
  const total = Number(countResult.rows[0]?.count || 0)
  const rows = []

  if (total === 0) {
    console.log(`[backup-drop] ${tableName}: empty table, writing empty backup`)
  } else {
    const batch = await client.query(`SELECT to_jsonb(t) AS payload FROM public.${quoted} AS t`)
    for (const row of batch.rows) rows.push(row.payload)
    console.log(`[backup-drop] ${tableName}: exported ${rows.length}/${total}`)
  }

  const payload = {
    table: tableName,
    exportedAt: new Date().toISOString(),
    rowCount: total,
    rows,
  }

  const filePath = path.join(outDir, `${tableName}.json`)
  fs.writeFileSync(filePath, JSON.stringify(payload))
  const sizeMb = fs.statSync(filePath).size / (1024 * 1024)
  console.log(`[backup-drop] wrote ${filePath} (${sizeMb.toFixed(2)} MB, ${total} rows)`)
  return { tableName, filePath, rowCount: total, sizeMb }
}

async function dropTable(client, tableName) {
  assertSafeTableName(tableName)
  await client.query(`DROP TABLE IF EXISTS public."${tableName}" CASCADE`)
  console.log(`[backup-drop] dropped public.${tableName}`)
}

async function vacuumDatabase(client) {
  await client.query('VACUUM FULL')
  console.log('[backup-drop] VACUUM FULL completed')
}

async function main() {
  const { dryRun, backupOnly, allowDelete, tables } = parseArgs()
  validateTables(tables)
  const willDrop = !dryRun && !backupOnly
  if (willDrop) assertDeleteAllowed(allowDelete)
  const outDir = backupDirForRun()
  const manifest = {
    createdAt: new Date().toISOString(),
    dryRun,
    tables: [],
    databaseSizeBefore: null,
    databaseSizeAfter: null,
  }

  const client = await connectPg()

  try {
    const sizeBefore = await client.query('SELECT pg_database_size(current_database())::bigint AS bytes')
    manifest.databaseSizeBefore = Number(sizeBefore.rows[0]?.bytes || 0)
    console.log(`[backup-drop] database size before: ${(manifest.databaseSizeBefore / (1024 * 1024)).toFixed(2)} MB`)

    for (const tableName of tables) {
      if (!(await tableExists(client, tableName))) {
        console.warn(`[backup-drop] skipping missing table ${tableName}`)
        continue
      }

      const stats = await tableStats(client, tableName)
      console.log(
        `[backup-drop] ${tableName}: ~${stats.rowEstimate} rows, ${(stats.totalBytes / (1024 * 1024)).toFixed(2)} MB on disk`
      )

      if (dryRun) {
        manifest.tables.push({ tableName, ...stats, action: 'dry-run' })
        continue
      }

      const backup = await exportTable(client, tableName, outDir)
      if (!backupOnly && !dryRun) {
        await dropTable(client, tableName)
      }
      manifest.tables.push({
        tableName,
        ...stats,
        backupFile: backup.filePath,
        backupRows: backup.rowCount,
        backupSizeMb: backup.sizeMb,
        action: backupOnly ? 'backed-up-only' : 'backed-up-and-dropped',
      })
    }

    if (!dryRun && !backupOnly && manifest.tables.some((entry) => entry.action === 'backed-up-and-dropped')) {
      await vacuumDatabase(client)
      const sizeAfter = await client.query('SELECT pg_database_size(current_database())::bigint AS bytes')
      manifest.databaseSizeAfter = Number(sizeAfter.rows[0]?.bytes || 0)
      console.log(`[backup-drop] database size after: ${(manifest.databaseSizeAfter / (1024 * 1024)).toFixed(2)} MB`)
    }

    const manifestPath = path.join(outDir, `manifest_${timestampForFile()}.json`)
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`[backup-drop] manifest: ${manifestPath}`)
    console.log(dryRun ? '[backup-drop] dry-run complete' : '[backup-drop] complete')
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error('[backup-drop] failed:', error.message)
  process.exit(1)
})
