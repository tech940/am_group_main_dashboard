require('dotenv/config')

const { spawn } = require('child_process')
const path = require('path')

const BACKUP_HOUR = Number(process.env.DATABASE_BACKUP_HOUR || 18)
const BACKUP_MINUTE = Number(process.env.DATABASE_BACKUP_MINUTE || 0)
const BACKUP_SCRIPT = path.join(__dirname, 'backup-database.js')

function getIndiaNowParts(date = new Date()) {
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

  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0)
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  }
}

function getNextRunDelayMs() {
  const now = new Date()
  const india = getIndiaNowParts(now)
  const nowSeconds = (india.hour * 60 * 60) + (india.minute * 60) + india.second
  const targetSeconds = (BACKUP_HOUR * 60 * 60) + (BACKUP_MINUTE * 60)
  const secondsUntilRun = targetSeconds > nowSeconds
    ? targetSeconds - nowSeconds
    : (24 * 60 * 60) - nowSeconds + targetSeconds

  return secondsUntilRun * 1000
}

function formatDelay(delayMs) {
  const totalMinutes = Math.round(delayMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

function runBackup() {
  console.log(`[db-backup-scheduler] running backup at ${new Date().toISOString()}`)
  const child = spawn(process.execPath, [BACKUP_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    windowsHide: true,
  })

  child.on('close', (code) => {
    if (code === 0) {
      console.log('[db-backup-scheduler] backup finished successfully')
    } else {
      console.error(`[db-backup-scheduler] backup failed with exit code ${code}`)
    }
    scheduleNextRun()
  })

  child.on('error', (error) => {
    console.error('[db-backup-scheduler] failed to start backup:', error)
    scheduleNextRun()
  })
}

function scheduleNextRun() {
  const delayMs = getNextRunDelayMs()
  console.log(`[db-backup-scheduler] next backup at ${String(BACKUP_HOUR).padStart(2, '0')}:${String(BACKUP_MINUTE).padStart(2, '0')} Asia/Kolkata, in ${formatDelay(delayMs)}`)
  setTimeout(runBackup, delayMs)
}

if (process.env.RUN_BACKUP_ON_START === 'true') {
  runBackup()
} else {
  scheduleNextRun()
}
