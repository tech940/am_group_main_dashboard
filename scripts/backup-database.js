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

/**
 * Find a pg_dump that actually exists on THIS machine.
 *
 * PG_DUMP_PATH is honoured first, but only if the file is really there. It was pointing at
 * `C:/Users/HP/scoop/apps/postgresql/current/bin/pg_dump.exe` — another developer's home directory,
 * committed to .env — so every backup on any other machine died with a confusing ENOENT naming a
 * path the user had never heard of. A configured path that does not resolve is now reported as
 * such and the search continues, instead of being the final answer.
 */
function resolvePgDump() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const configured = process.env.PG_DUMP_PATH
  const notes = []

  if (configured) {
    if (fs.existsSync(configured)) return { path: configured, notes }
    notes.push(`PG_DUMP_PATH is set to "${configured}" but no file exists there — ignoring it.`)
  }

  const candidates = []
  for (const base of [
    'C:/Program Files/PostgreSQL',
    'C:/Program Files (x86)/PostgreSQL',
    path.join(home, 'scoop/apps/postgresql'),
  ]) {
    try {
      for (const entry of fs.readdirSync(base)) {
        candidates.push(path.join(base, entry, 'bin', 'pg_dump.exe'))
      }
    } catch { /* base directory absent — nothing to add */ }
  }
  candidates.push('C:/Program Files/pgAdmin 4/runtime/pg_dump.exe')

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { path: candidate, notes }
  }

  // Fall back to bare `pg_dump` so a PATH install still works.
  return { path: 'pg_dump', notes }
}

function runPgDump({ databaseUrl, outputFile }) {
  const resolved = resolvePgDump()
  for (const note of resolved.notes) console.warn(`[db-backup] ${note}`)
  const pgDumpPath = resolved.path
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
        reject(new Error([
          `pg_dump was not found (tried "${pgDumpPath}").`,
          'No PostgreSQL client tools appear to be installed on this machine. Install them with:',
          '  winget install PostgreSQL.PostgreSQL.17',
          '  scoop install postgresql',
          'then add its bin folder to PATH, or set PG_DUMP_PATH in .env to the real pg_dump.exe.',
        ].join('\n')))
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
