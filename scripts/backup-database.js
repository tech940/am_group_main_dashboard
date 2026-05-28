require('dotenv/config')

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const DEFAULT_RETENTION_DAYS = 30
const BACKUP_PREFIX = 'main_dashboard'

function pad(value) {
  return String(value).padStart(2, '0')
}

function timestampForFile(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const value = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${value('year')}${value('month')}${value('day')}_${value('hour')}${value('minute')}${value('second')}`
}

function defaultBackupDir() {
  const explicit = process.env.DATABASE_BACKUP_DIR
  if (explicit) return path.resolve(explicit)

  const oneDrive = process.env.OneDrive || path.join(process.env.USERPROFILE || '', 'OneDrive')
  if (oneDrive && fs.existsSync(oneDrive)) {
    return path.join(oneDrive, 'Main_Dashboard_Database_Backups')
  }

  return path.join(process.cwd(), 'backups', 'database')
}

function parseRetentionDays() {
  const parsed = Number(process.env.DATABASE_BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
}

function removeOldBackups(backupDir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const files = fs.readdirSync(backupDir, { withFileTypes: true })

  for (const file of files) {
    if (!file.isFile()) continue
    if (!file.name.startsWith(`${BACKUP_PREFIX}_`) || !file.name.endsWith('.dump')) continue

    const filePath = path.join(backupDir, file.name)
    const stat = fs.statSync(filePath)
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(filePath)
      console.log(`[db-backup] removed old backup ${filePath}`)
    }
  }
}

function databaseUrlForPgDump(databaseUrl) {
  const parsed = new URL(databaseUrl)
  parsed.searchParams.delete('pgbouncer')
  return parsed.toString()
}

function runPgDump({ databaseUrl, outputFile }) {
  const pgDumpPath = process.env.PG_DUMP_PATH || 'pg_dump'
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    outputFile,
    databaseUrl,
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(pgDumpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`pg_dump was not found. Install PostgreSQL client tools or set PG_DUMP_PATH to pg_dump.exe. Tried: ${pgDumpPath}`))
        return
      }
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error(`pg_dump exited with code ${code}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

async function main() {
  const databaseUrl = process.env.DATABASE_BACKUP_URL || process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is missing. Add DATABASE_URL or DATABASE_BACKUP_URL to .env before running database backups.')
  }
  const pgDumpDatabaseUrl = databaseUrlForPgDump(databaseUrl)

  const backupDir = defaultBackupDir()
  const retentionDays = parseRetentionDays()
  fs.mkdirSync(backupDir, { recursive: true })

  const outputFile = path.join(backupDir, `${BACKUP_PREFIX}_${timestampForFile()}.dump`)
  console.log(`[db-backup] starting backup to ${outputFile}`)

  await runPgDump({ databaseUrl: pgDumpDatabaseUrl, outputFile })

  const sizeMb = fs.statSync(outputFile).size / (1024 * 1024)
  console.log(`[db-backup] backup complete: ${outputFile} (${sizeMb.toFixed(2)} MB)`)

  removeOldBackups(backupDir, retentionDays)
  console.log(`[db-backup] retention complete: keeping ${retentionDays} days`)
}

main().catch((error) => {
  console.error('[db-backup] failed:', error.message)
  process.exitCode = 1
})
