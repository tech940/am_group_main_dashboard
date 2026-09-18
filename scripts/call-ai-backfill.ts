/**
 * AI Call Review — BACKFILL: queue past in-scope (AM Hyundai) recordings at low priority, then optionally work
 * through them. Live calls (priority 0) always go first; the backlog uses whatever the daily audio cap leaves.
 *
 *   npm run call-ai:backfill -- --from=2026-08-18 [--to=2026-09-18]              DRY RUN: counts and cost only
 *   npm run call-ai:backfill -- --from=2026-08-18 --apply                         queue them (no Groq calls)
 *   npm run call-ai:backfill -- --from=2026-08-18 --apply --process[=200]        queue, then review up to N now
 *
 * Without --process the 10-minute cron works the backlog down. Re-running is safe: a recording already queued
 * or reviewed is never queued twice (ON CONFLICT DO NOTHING).
 */
import 'dotenv/config'
import { callAiConfig, llmCostUsd, sttCostUsd } from '../lib/call-ai/config'
import { supabaseCreSource, type CreRecording } from '../lib/call-ai/cre-source'
import { buildQueueRows } from '../lib/call-ai/discovery'
import { insertDiscovered } from '../lib/call-ai/queue'
import { runCallAi } from '../lib/call-ai/worker'

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=')
  return [k, v.length ? v.join('=') : 'true']
}))

const YMD = /^\d{4}-\d{2}-\d{2}$/

async function main() {
  const from = String(args.from || '')
  const to = String(args.to || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()))
  if (!YMD.test(from) || !YMD.test(to) || from > to) throw new Error('Give --from=YYYY-MM-DD (and optionally --to=YYYY-MM-DD)')
  const cfg = callAiConfig()
  const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString()
  const toIso = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400_000).toISOString()

  const source = supabaseCreSource()
  const dir = await source.loadDirectory()
  let recs: CreRecording[] = []
  let afterId: string | null = null
  for (let page = 0; page < 100; page += 1) {
    const batch = await source.listRecorded(fromIso, toIso, afterId, 1000)
    recs = recs.concat(batch)
    if (batch.length < 1000) break
    afterId = batch[batch.length - 1].id
  }
  const rows = await buildQueueRows(recs, dir, cfg.scope, 1)
  const toReview = rows.filter((r) => r.status === 'queued')
  const audioSeconds = toReview.reduce((sum, r) => sum + (Number(r.duration_seconds) || 0), 0)
  const estimate = toReview.reduce((sum, r) => sum + sttCostUsd(cfg.sttModel, Number(r.duration_seconds) || 0), 0)
    + toReview.length * llmCostUsd(cfg.llmModel, 2500, 1500)
  const skipped = rows.filter((r) => r.status === 'skipped').reduce<Record<string, number>>((acc, r) => { acc[r.skip_reason!] = (acc[r.skip_reason!] ?? 0) + 1; return acc }, {})

  console.log(`Backfill ${from} → ${to}, scope ${cfg.scope.join(',')}`)
  console.log(`  ${recs.length} uploaded recordings scanned; ${rows.length} in scope`)
  console.log(`  ${toReview.length} to review (${(audioSeconds / 3600).toFixed(1)} h of audio), ${rows.length - toReview.length} skipped before any spend: ${JSON.stringify(skipped)}`)
  console.log(`  estimated Groq cost ≈ $${estimate.toFixed(2)} (Whisper ${cfg.sttModel} + ${cfg.llmModel})`)
  console.log(`  at the daily cap of ${(cfg.dailyAudioCapSeconds / 3600).toFixed(1)} h, the cron clears it in ≈ ${Math.ceil(audioSeconds / Math.max(1, cfg.dailyAudioCapSeconds - 2 * 3600))} day(s) after live calls`)

  if (args.apply !== 'true') {
    console.log('\nDRY RUN — nothing queued. Add --apply to queue them.')
    return
  }
  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) inserted += await insertDiscovered(rows.slice(i, i + 500))
  console.log(`\nQueued ${inserted} new row(s) at backfill priority (already-known recordings left untouched).`)

  if (args.process) {
    const maxJobs = Math.max(1, Math.min(5000, Number(args.process) || 200))
    console.log(`Reviewing up to ${maxJobs} now…`)
    const stats = await runCallAi({ deadlineMs: Date.now() + 6 * 60 * 60 * 1000, skipDiscovery: true, maxJobs })
    console.log(JSON.stringify({ done: stats.done, skipped: stats.skipped, failed: stats.failed, requeued: stats.requeued, stoppedBecause: stats.stoppedBecause, costUsd: stats.costUsd }, null, 2))
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
