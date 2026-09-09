/**
 * Local/server scheduler for the LocoNav sync — the alternative to the vercel.json cron, following
 * the same shape as scripts/callyzer-sync-scheduler.mjs.
 *
 * Use this when you want a tighter poll than a Vercel cron gives you (a demo drive is often under
 * an hour, so a 15-minute fix can be the difference between "where is it" and "where was it").
 *
 *   npm run loconav:sync
 *
 * Env: LOCONAV_SYNC_URL (default localhost), LOCONAV_SYNC_SECRET or CRON_SECRET, LOCONAV_SYNC_MINUTES.
 */
import 'dotenv/config'

const URL_BASE = process.env.LOCONAV_SYNC_URL || 'http://localhost:3000/api/gate-pass/tracking/sync'
const MINUTES = Number(process.env.LOCONAV_SYNC_MINUTES || 15)

/*
 * ⚠️ THE TWO CREDENTIALS ARE NOT INTERCHANGEABLE, and sending the wrong one the wrong way 403s every
 * tick. lib/maintenance/cron-auth.ts accepts:
 *   - CRON_SECRET            ONLY as `Authorization: Bearer <secret>`   (line 34)
 *   - the per-job secret     ONLY as `?secret=<secret>`                 (line 37)
 * The first version of this file fell back to CRON_SECRET and then sent it as ?secret= — which the
 * route rejects, so the scheduler would have looked alive while achieving nothing.
 */
const JOB_SECRET = process.env.LOCONAV_SYNC_SECRET || ''
const CRON_SECRET = process.env.CRON_SECRET || ''

if (!JOB_SECRET && !CRON_SECRET) {
  // authorizeCronRequest fails CLOSED — without a secret the route returns 503 and every tick would
  // be a no-op that looks like a working scheduler. Refuse to start instead.
  console.error('Neither LOCONAV_SYNC_SECRET nor CRON_SECRET is set — the route would reject every call. Aborting.')
  process.exit(1)
}

async function runOnce() {
  const startedAt = new Date().toISOString()
  try {
    // Job secret in the query string, CRON_SECRET in the header — each is only accepted its own way.
    const url = JOB_SECRET ? `${URL_BASE}?secret=${encodeURIComponent(JOB_SECRET)}` : URL_BASE
    const res = await fetch(url, {
      method: 'POST',
      headers: !JOB_SECRET && CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : undefined,
    })
    const body = await res.json().catch(() => ({}))
    if (body?.skipped) {
      console.log(`[${startedAt}] skipped — ${body.reason}`)
    } else if (res.ok) {
      console.log(
        `[${startedAt}] ok — mapped ${body.mapped ?? 0}/${body.demoVins ?? 0}, ` +
          `${body.positionsUpdated ?? 0} positions, ${body.untrackedDemo ?? 0} untracked` +
          (body.plateMismatches?.length ? `, ${body.plateMismatches.length} plate mismatch(es)` : ''),
      )
    } else {
      console.error(`[${startedAt}] HTTP ${res.status} — ${JSON.stringify(body).slice(0, 200)}`)
    }
  } catch (error) {
    console.error(`[${startedAt}] failed — ${error instanceof Error ? error.message : error}`)
  }
}

console.log(`LocoNav sync scheduler: every ${MINUTES} min against ${URL_BASE}`)
await runOnce()
setInterval(runOnce, MINUTES * 60 * 1000)
