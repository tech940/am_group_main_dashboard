// Local/manual scheduler for the KIA booking maintenance sweeps.
//
// PRODUCTION DOES NOT USE THIS — the real schedule is a Supabase pg_cron job (`kia-maintenance`,
// see scripts/apply-migration-0018.ts). This is only for running the sweeps against a local dev
// server. Keep the interval in step with that job.
//
// Hourly, not every 5 minutes: the sweeps enforce 48h holds and 72h/120h reservations, so hourly is
// at most ~1h late on a 3-day deadline, while every 5 min is 288 runs/day for the same outcome as
// 24 — 12x the CPU and write transactions for nothing.
//
// Guards against overlap with a `running` flag (a slow DB must not stack concurrent sweeps).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'kia-maintenance.mjs')
const INTERVAL_MS = 60 * 60 * 1000 // hourly — matches the pg_cron `kia-maintenance` job
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

console.log('[kia-maintenance-scheduler] started — running hourly.')
runOnce()
setInterval(runOnce, INTERVAL_MS)
