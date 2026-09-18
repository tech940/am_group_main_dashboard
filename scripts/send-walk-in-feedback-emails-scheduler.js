require('dotenv/config')

const { spawn } = require('child_process')
const path = require('path')

const INTERVAL_MS = 15 * 60 * 1000 // Run every 15 minutes
const SCRIPT_PATH = path.join(__dirname, 'send-walk-in-feedback-emails.ts')
const TSCONFIG_PATH = path.join(__dirname, '..', 'tsconfig.verify.json')

let isRunning = false

function runDispatch() {
  if (isRunning) {
    console.log('[walk-in-feedback-scheduler] Previous run still active, skipping tick.')
    return
  }

  isRunning = true
  console.log(`\n[walk-in-feedback-scheduler] Starting 1-hour walk-in feedback email sweep at ${new Date().toISOString()}`)

  const child = spawn('npx', ['tsx', '--tsconfig', TSCONFIG_PATH, SCRIPT_PATH], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  })

  child.on('close', (code) => {
    isRunning = false
    console.log(`[walk-in-feedback-scheduler] Sweep completed with exit code ${code}. Next run in 15 minutes.`)
  })

  child.on('error', (err) => {
    isRunning = false
    console.error('[walk-in-feedback-scheduler] Execution error:', err)
  })
}

console.log('[walk-in-feedback-scheduler] Scheduler started. Checking for eligible leads every 15 minutes.')
runDispatch()
setInterval(runDispatch, INTERVAL_MS)
