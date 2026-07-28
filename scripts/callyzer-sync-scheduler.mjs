// Keeps callyzer_calls fresh by hitting the secret-gated sync route on an interval.
// Mirrors scripts/kia-detect-sold-allocations-scheduler.mjs.
//
//   npm run callyzer:sync:scheduler
//
// Env:
//   CALLYZER_SYNC_URL       full URL of /api/call-analysis/sync (default: localhost:3000)
//   CALLYZER_SYNC_SECRET    must match the server's env var
//   CALLYZER_SYNC_INTERVAL_MINUTES  default 180 (matches the Vercel cron in vercel.json)
import 'dotenv/config'

const URL_BASE = process.env.CALLYZER_SYNC_URL || 'http://localhost:3000/api/call-analysis/sync'
const SECRET = process.env.CALLYZER_SYNC_SECRET
const MINUTES = Math.max(5, Number(process.env.CALLYZER_SYNC_INTERVAL_MINUTES) || 180)

if (!SECRET) {
  console.error('CALLYZER_SYNC_SECRET is not set — the route would reject every call. Aborting.')
  process.exit(1)
}

async function runOnce() {
  const stamp = new Date().toISOString()
  try {
    const res = await fetch(`${URL_BASE}?secret=${encodeURIComponent(SECRET)}`, { method: 'POST' })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      console.error(`[${stamp}] sync failed: HTTP ${res.status} ${json?.error || ''}`)
      return
    }
    console.log(`[${stamp}] sync ok — ${json.upserted} rows over ${json.pages} page(s) in ${json.elapsedMs}ms`)
  } catch (error) {
    console.error(`[${stamp}] sync error:`, error instanceof Error ? error.message : error)
  }
}

console.log(`Callyzer sync scheduler started — every ${MINUTES} min against ${URL_BASE}`)
await runOnce()
setInterval(runOnce, MINUTES * 60 * 1000)
