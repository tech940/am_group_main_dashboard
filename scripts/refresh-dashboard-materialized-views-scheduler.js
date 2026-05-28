const { spawn } = require('child_process')

const TIME_ZONE = 'Asia/Kolkata'
const RUN_MINUTES = [
  9 * 60 + 10,
  10 * 60 + 25,
  11 * 60 + 40,
  12 * 60 + 55,
  14 * 60 + 10,
  15 * 60 + 25,
  16 * 60 + 40,
  17 * 60 + 55,
]

function getIndiaNowParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0)

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function getTodayKey(parts = getIndiaNowParts()) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function getCurrentMinuteOfDay(parts = getIndiaNowParts()) {
  return parts.hour * 60 + parts.minute
}

function getDueRunKey(parts = getIndiaNowParts()) {
  const minuteOfDay = getCurrentMinuteOfDay(parts)
  const dueMinute = RUN_MINUTES.find((runMinute) => minuteOfDay >= runMinute && minuteOfDay < runMinute + 5)
  return dueMinute === undefined ? null : `${getTodayKey(parts)}:${dueMinute}`
}

function runRefresh() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/refresh-dashboard-materialized-views.js'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`refresh script exited with code ${code}`))
    })
  })
}

let lastRunKey = null
let running = false

async function tick() {
  const dueRunKey = getDueRunKey()
  if (!dueRunKey || dueRunKey === lastRunKey || running) return

  running = true
  lastRunKey = dueRunKey

  try {
    console.log(`[scheduler] running dashboard materialized-view refresh for ${dueRunKey}`)
    await runRefresh()
    console.log(`[scheduler] refresh completed for ${dueRunKey}`)
  } catch (error) {
    console.error(`[scheduler] refresh failed for ${dueRunKey}`, error)
  } finally {
    running = false
  }
}

console.log(`[scheduler] dashboard materialized-view refresh scheduler started (${TIME_ZONE})`)
console.log(`[scheduler] run windows: ${RUN_MINUTES.map((minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`).join(', ')}`)

void tick()
setInterval(() => {
  void tick()
}, 60_000)
