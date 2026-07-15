// Lightweight scheduler for the automatic user-deactivation sweep: runs the one-shot script hourly.
// The threshold is measured in days, so hourly is ample — this only decides how quickly an account
// crosses from "idle 7 days" to actually deactivated.
//
// Alternatively point a real cron / n8n / Vercel Cron at POST /api/maintenance/user-deactivation.
// Guards against overlap with a `running` flag.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'user-deactivation.mjs')
const INTERVAL_MS = 60 * 60 * 1000 // hourly
let running = false

function runOnce() {
  if (running) {
    console.warn('[user-deactivation-scheduler] previous run still in flight — skipping this tick.')
    return
  }
  running = true
  const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' })
  child.on('error', (error) => {
    running = false
    console.error('[user-deactivation-scheduler] spawn failed', error)
  })
  child.on('exit', (code) => {
    running = false
    if (code) console.error(`[user-deactivation-scheduler] run exited with code ${code}`)
  })
}

console.log('[user-deactivation-scheduler] started — running hourly.')
runOnce()
setInterval(runOnce, INTERVAL_MS)
