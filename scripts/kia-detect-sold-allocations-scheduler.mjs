// Lightweight scheduler for the KIA sold-vehicle detector: runs the one-shot script every 30 min.
// For tighter coupling, trigger scripts/kia-detect-sold-allocations.mjs directly from the DMS ingest.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'kia-detect-sold-allocations.mjs')
const INTERVAL_MS = 30 * 60 * 1000 // every 30 minutes

function runOnce() {
  const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' })
  child.on('exit', (code) => {
    if (code) console.error(`[sold-detect-scheduler] run exited with code ${code}`)
  })
}

console.log('[sold-detect-scheduler] started — running every 30 minutes.')
runOnce()
setInterval(runOnce, INTERVAL_MS)
