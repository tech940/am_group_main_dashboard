// Lightweight scheduler for the KIA follow-up reminders: triggers the one-shot sweep every 15 min.
// Each run is idempotent (reminder_sent_at), so a follow-up only pings once
// when it first becomes due. For production, prefer a real cron / n8n hitting the run-reminders
// endpoint. Env same as the one-shot script.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'kia-followup-reminders.mjs')
const INTERVAL_MS = 15 * 60 * 1000 // every 15 minutes

function runOnce() {
  const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' })
  child.on('exit', (code) => {
    if (code) console.error(`[followup-reminders-scheduler] run exited with code ${code}`)
  })
}

console.log('[followup-reminders-scheduler] started — running every 15 minutes.')
runOnce()
setInterval(runOnce, INTERVAL_MS)
