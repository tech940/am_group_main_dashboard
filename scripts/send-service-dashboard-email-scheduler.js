require('dotenv/config')

const { spawn } = require('child_process')
const path = require('path')
const postgres = require('postgres')

const SETTINGS_KEY = 'serviceDashboardEmailSettings'
const DEFAULT_TIME_ZONE = 'Asia/Kolkata'
const DEFAULT_SEND_TIME = '19:00'
const SEND_SCRIPT = path.join(__dirname, 'send-service-dashboard-email.ts')

function normalizeSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    enabled: Boolean(source.enabled),
    sendTime: typeof source.sendTime === 'string' && /^\d{2}:\d{2}$/.test(source.sendTime) ? source.sendTime : DEFAULT_SEND_TIME,
    timezone: source.timezone || DEFAULT_TIME_ZONE,
  }
}

async function loadSettings() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.')
  }

  const sql = postgres(databaseUrl, {
    prepare: false,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    const rows = await sql`
      SELECT value
      FROM dashboard_settings
      WHERE key = ${SETTINGS_KEY}
      LIMIT 1
    `
    return normalizeSettings(rows[0]?.value)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

function getNowParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
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

function getNextRunDelayMs(settings) {
  const [hourText, minuteText] = settings.sendTime.split(':')
  const targetHour = Number(hourText)
  const targetMinute = Number(minuteText)
  const now = getNowParts(settings.timezone)
  const nowSeconds = (now.hour * 60 * 60) + (now.minute * 60) + now.second
  const targetSeconds = (targetHour * 60 * 60) + (targetMinute * 60)
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

function runEmail(settings) {
  console.log(`[service-dashboard-email-scheduler] running email at ${new Date().toISOString()} (${settings.timezone})`)
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', SEND_SCRIPT], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  })

  child.on('close', (code) => {
    if (code === 0) {
      console.log('[service-dashboard-email-scheduler] email job finished successfully')
    } else {
      console.error(`[service-dashboard-email-scheduler] email job failed with exit code ${code}`)
    }
    void scheduleNextRun()
  })

  child.on('error', (error) => {
    console.error('[service-dashboard-email-scheduler] failed to start email job:', error)
    void scheduleNextRun()
  })
}

async function scheduleNextRun() {
  try {
    const settings = await loadSettings()
    if (!settings.enabled) {
      console.log('[service-dashboard-email-scheduler] disabled in Admin Settings; checking again in 15 minutes')
      setTimeout(() => {
        void scheduleNextRun()
      }, 15 * 60 * 1000)
      return
    }

    const delayMs = getNextRunDelayMs(settings)
    console.log(`[service-dashboard-email-scheduler] next email at ${settings.sendTime} ${settings.timezone}, in ${formatDelay(delayMs)}`)
    setTimeout(() => runEmail(settings), delayMs)
  } catch (error) {
    console.error('[service-dashboard-email-scheduler] failed to schedule next run:', error)
    setTimeout(() => {
      void scheduleNextRun()
    }, 15 * 60 * 1000)
  }
}

void scheduleNextRun()
