import 'server-only'

import crypto from 'node:crypto'
import { getExcludedNumbers } from '@/lib/customer-identity/exclusions'
import { lookupKey } from '@/lib/customer-identity/phone-match'
import type { CreDirectory } from '@/lib/cre-calls/directory'
import { callAiConfig } from './config'
import type { CreRecording, CreSource } from './cre-source'
import { insertDiscovered, purgeRecordings, writeState, type DiscoveredRow, type PipelineState } from './queue'
import { classifyScope } from './scope'
import { audioExtension } from './stt-filter'

/**
 * Finding work. The CRE project is read-only to us and cannot notify us, so every run asks it "what changed
 * since last time?" and queues the in-scope recordings.
 *
 * Why the cursor is `updated_at` and not `uploaded_at` or `recorded_at` (measured 2026-09-18):
 *   - uploads arrive late — p90 79 min after the call, p99 29 h, worst 8 days — so a window on `recorded_at`
 *     would miss them for good;
 *   - `uploaded_at` is written by the handset, up to ~3 min off the server clock;
 *   - `updated_at` is the server's own clock and moves when the upload completes.
 * Each run re-reads from the cursor minus 2 h (a safety lap) and inserts with ON CONFLICT DO NOTHING, so a
 * recording seen twice is harmless. Once a day a sweep over the last week's `recorded_at` catches anything
 * the cursor could still have missed, and recordings deleted on the CRE side are purged here.
 */

const OVERLAP_MS = 2 * 60 * 60 * 1000
const PAGE = 1000
const MAX_PAGES = 5
const NOT_CONNECTED = new Set(['missed', 'no_answer', 'rejected', 'not_answered'])

function phoneKeySecret(): string | null {
  return process.env.CALL_AI_PHONE_KEY_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || null
}

/**
 * HMAC of the customer's last ten digits: equal for the same caller, useless for recovering the number. Lets the
 * review list say "called 3 times this week" without this database ever holding a phone number.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const key = lookupKey(phone)
  const secret = phoneKeySecret()
  if (!key || !secret) return null
  return crypto.createHmac('sha256', secret).update(`call-ai|${key}`).digest('hex').slice(0, 32)
}

export function istToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Why a recording is not worth transcribing, decided before any money is spent. Null = transcribe it. */
export function preSkipReason(rec: CreRecording, cfg = callAiConfig()): string | null {
  if (NOT_CONNECTED.has(String(rec.call_type || '').toLowerCase())) return 'not_connected'
  if (rec.duration_seconds !== null && rec.duration_seconds !== undefined && Number(rec.duration_seconds) < cfg.minSeconds) return 'too_short'
  if (!audioExtension(rec.mime_type, rec.format)) return 'unsupported_format'
  if (rec.size_bytes && Number(rec.size_bytes) > cfg.maxAudioBytes) return 'too_large'
  return null
}

/** In-scope recordings → queue rows. Out-of-scope recordings are dropped here and never cost anything. */
export async function buildQueueRows(recordings: CreRecording[], dir: CreDirectory, scopes: string[], priority: 0 | 1): Promise<DiscoveredRow[]> {
  const cfg = callAiConfig()
  const inScope: Array<{ rec: CreRecording; scope: string; branchId: string | null; team: string; creName: string | null }> = []
  for (const rec of recordings) {
    const verdict = classifyScope(rec, dir, scopes)
    if (verdict.inScope) inScope.push({ rec, scope: verdict.scope, branchId: verdict.branchId, team: verdict.team, creName: verdict.creName })
  }
  if (inScope.length === 0) return []

  // Staff and dealership numbers (not lead-routing trunks — those ARE customers calling in) are not reviewed.
  const numbers = [...new Set(inScope.map((item) => lookupKey(item.rec.phone)).filter(Boolean))] as string[]
  const excluded = numbers.length ? await getExcludedNumbers(numbers).catch(() => new Map()) : new Map()

  return inScope.map(({ rec, scope, branchId, team, creName }) => {
    const key = lookupKey(rec.phone)
    const internal = key ? excluded.get(key)?.reason === 'internal' : false
    const skip = internal ? 'internal_number' : preSkipReason(rec, cfg)
    return {
      cre_recording_id: rec.id,
      cre_call_id: rec.call_id ?? null,
      cre_id: rec.cre_id ?? null,
      cre_name: creName,
      branch_id: branchId,
      team_label: team,
      scope,
      call_type: rec.call_type ?? null,
      recorded_at: rec.recorded_at ?? null,
      uploaded_at: rec.uploaded_at ?? null,
      duration_seconds: rec.duration_seconds === null || rec.duration_seconds === undefined ? null : Math.round(Number(rec.duration_seconds)),
      format: audioExtension(rec.mime_type, rec.format),
      size_bytes: rec.size_bytes === null || rec.size_bytes === undefined ? null : Number(rec.size_bytes),
      phone_key: phoneKey(rec.phone),
      priority,
      status: skip ? 'skipped' : 'queued',
      skip_reason: skip,
    }
  })
}

export type DiscoveryStats = { scanned: number; queued: number; swept: number; purged: number }

export async function discover(source: CreSource, state: PipelineState, now: Date = new Date()): Promise<DiscoveryStats> {
  const cfg = callAiConfig()
  const stats: DiscoveryStats = { scanned: 0, queued: 0, swept: 0, purged: 0 }
  const dir = await source.loadDirectory()

  const liveSince = state.liveSince ?? now.toISOString()
  if (!state.liveSince) await writeState({ liveSince })

  const cursorMs = state.discoverCursorAt ? new Date(state.discoverCursorAt).getTime() : now.getTime()
  const sinceIso = new Date((Number.isFinite(cursorMs) ? cursorMs : now.getTime()) - OVERLAP_MS).toISOString()

  let after: { at: string; id: string } | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const recs = await source.listChanged(sinceIso, after, PAGE)
    stats.scanned += recs.length
    if (recs.length === 0) break
    stats.queued += await insertDiscovered(await buildQueueRows(recs, dir, cfg.scope, 0))
    const last = recs[recs.length - 1]
    after = { at: last.updated_at, id: last.id }
    // Move the cursor only once the page is safely queued, so a crash re-reads it rather than skipping it.
    await writeState({ discoverCursor: after })
    if (recs.length < PAGE) break
  }

  // Once per IST day: the safety sweep and the deletion purge.
  const today = istToday(now)
  if (state.sweptOn !== today) {
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
    const fromMs = Math.max(weekAgo, new Date(liveSince).getTime() - OVERLAP_MS)
    let afterId: string | null = null
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const recs = await source.listRecorded(new Date(fromMs).toISOString(), now.toISOString(), afterId, PAGE)
      if (recs.length === 0) break
      stats.swept += await insertDiscovered(await buildQueueRows(recs, dir, cfg.scope, 0))
      afterId = recs[recs.length - 1].id
      if (recs.length < PAGE) break
    }

    let deleteCursor = state.deleteCursorAt ?? '2000-01-01T00:00:00Z'
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const gone = await source.listDeleted(deleteCursor, PAGE)
      if (gone.length === 0) break
      stats.purged += await purgeRecordings(gone.map((g) => g.id))
      deleteCursor = gone[gone.length - 1].deleted_at
      if (gone.length < PAGE) break
    }
    await writeState({ sweptOn: today, deleteCursorAt: deleteCursor })
  }
  return stats
}
