/**
 * AI Call Review — run the pipeline from this machine, exactly as the 10-minute Vercel cron does
 * (/api/call-analysis/ai/run): find new AM Hyundai recordings, transcribe them, write the verdicts to the
 * database the dashboard reads.
 *
 *   npm run call-ai:run                one run (≈4 minutes at most)
 *   npm run call-ai:run -- --loop      keep running until the queue is empty or Groq pauses it for long
 *   npm run call-ai:run -- --max=30    review at most 30 calls (newest first), then stop
 *
 * Needs CALL_GROQ_API_KEY and the CRE Supabase variables in .env. Safe to run while the cron also runs:
 * jobs are leased with FOR UPDATE SKIP LOCKED, so two runners never take the same call.
 */
import 'dotenv/config'
import { pipelineStatus } from '../lib/call-ai/read'
import { readState } from '../lib/call-ai/queue'
import { runCallAi } from '../lib/call-ai/worker'

const loop = process.argv.includes('--loop')
const maxArg = process.argv.find((a) => a.startsWith('--max='))
const maxJobs = maxArg ? Math.max(1, Number(maxArg.split('=')[1]) || 30) : undefined
let finished = 0
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function once(): Promise<{ stoppedBecause: string; done: number }> {
  const remaining = maxJobs === undefined ? undefined : Math.max(1, maxJobs - finished)
  const stats = await runCallAi({ deadlineMs: Date.now() + 240_000, maxJobs: remaining })
  // A rate-limited call goes back on the queue and is claimed again — count calls FINISHED, not claims.
  finished += stats.done + stats.skipped + stats.failed
  const d = stats.discovery
  console.log(`${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}  found ${d ? d.queued + d.swept : 0} new · reviewed ${stats.done} · skipped ${stats.skipped} · failed ${stats.failed} · retry later ${stats.requeued} · $${stats.costUsd.toFixed(4)} · ${stats.stoppedBecause}`)
  if (stats.discoveryError) console.log(`   discovery error: ${stats.discoveryError}`)
  for (const error of stats.errors.slice(0, 3)) console.log(`   ${error}`)
  return { stoppedBecause: stats.stoppedBecause, done: stats.done }
}

async function main() {
  const started = Date.now()
  for (;;) {
    const { stoppedBecause } = await once()
    if (maxJobs !== undefined && finished >= maxJobs) { console.log(`Reached --max=${maxJobs}.`); break }
    if (stoppedBecause === 'drained') { console.log('Nothing left that can be reviewed right now.'); break }
    if (!loop && maxJobs === undefined) break
    const status = await pipelineStatus()
    const waiting = status.counts.queued + status.counts.processing
    if (stoppedBecause === 'disabled' || stoppedBecause === 'config_error') break
    if (waiting === 0 && stoppedBecause === 'drained') { console.log('Queue empty — everything reviewed.'); break }
    const state = await readState()
    const pausedMs = state.rateLimitedUntil ? new Date(state.rateLimitedUntil).getTime() - Date.now() : 0
    if (pausedMs > 15 * 60_000) {
      console.log(`Groq limit reached — paused until ${new Date(state.rateLimitedUntil!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. ${waiting} call(s) still waiting; run again after that (or let the cron do it).`)
      break
    }
    if (Date.now() - started > 3 * 60 * 60_000) { console.log(`Stopping after 3 hours; ${waiting} call(s) still waiting.`); break }
    await sleep(Math.max(30_000, Math.min(pausedMs + 2_000, 5 * 60_000)))
  }
  const final = await pipelineStatus()
  console.log(`\nDatabase now: ${final.counts.done} reviewed · ${final.counts.queued + final.counts.processing} waiting · ${final.counts.skipped} skipped · ${final.counts.failed} failed · today $${final.costTodayUsd.toFixed(3)}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
