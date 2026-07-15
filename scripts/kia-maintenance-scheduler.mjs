// Lightweight scheduler for the KIA booking maintenance sweeps: runs the one-shot script every 5 min.
// Allocation reservations (72h/CSD-120h) and unpaid dealer holds (48h) only lapse when this runs, so
// this needs to stay up (or point a real cron / n8n at POST /api/brands/kia/maintenance instead).
//
// Guards against overlap with a `running` flag (a slow DB must not stack concurrent sweeps).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'kia-maintenance.mjs')
const INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes
let running = false

function runOnce() {
  if (running) {
    console.warn('[kia-maintenance-scheduler] previous run still in flight — skipping this tick.')
    return
  }
  running = true
  const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' })
  child.on('error', (error) => {
    running = false
    console.error('[kia-maintenance-scheduler] spawn failed', error)
  })
  child.on('exit', (code) => {
    running = false
    if (code) console.error(`[kia-maintenance-scheduler] run exited with code ${code}`)
  })
}

console.log('[kia-maintenance-scheduler] started — running every 5 minutes.')
runOnce()
setInterval(runOnce, INTERVAL_MS)
