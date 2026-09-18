import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import type { Segment } from './types'

/**
 * The call_ai_reviews work queue. Every write that finishes a job is a compare-and-swap on `lock_token`, so a
 * worker whose lease ran out (and whose job another run has since claimed) can never overwrite the newer
 * result. No statement here is held open across a Groq call.
 */

export function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])) as T[]
}

/** jsonb can arrive as a string through db.execute (verified in this repo) — normalise both shapes. */
export function jsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return null }
  }
  return value as T
}

// ── Discovery ────────────────────────────────────────────────────────────────────────────────────

export type DiscoveredRow = {
  cre_recording_id: string
  cre_call_id: string | null
  cre_id: string | null
  cre_name: string | null
  branch_id: string | null
  team_label: string | null
  scope: string
  call_type: string | null
  recorded_at: string | null
  uploaded_at: string | null
  duration_seconds: number | null
  format: string | null
  size_bytes: number | null
  phone_key: string | null
  priority: 0 | 1
  status: 'queued' | 'skipped'
  skip_reason: string | null
}

/** One statement for the whole batch; a recording already on the queue is left exactly as it is. */
export async function insertDiscovered(batch: DiscoveredRow[]): Promise<number> {
  if (batch.length === 0) return 0
  const inserted = rows<{ id: string }>(await db.execute(sql`
    INSERT INTO call_ai_reviews (
      cre_recording_id, cre_call_id, cre_id, cre_name, branch_id, team_label, scope, call_type, recorded_at,
      uploaded_at, duration_seconds, format, size_bytes, phone_key, priority, status, skip_reason
    )
    SELECT x.cre_recording_id, x.cre_call_id, x.cre_id, x.cre_name, x.branch_id, x.team_label, x.scope, x.call_type,
           x.recorded_at, x.uploaded_at, x.duration_seconds, x.format, x.size_bytes, x.phone_key, x.priority, x.status,
           x.skip_reason
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
      cre_recording_id uuid, cre_call_id text, cre_id uuid, cre_name text, branch_id uuid, team_label text, scope text,
      call_type text, recorded_at timestamptz, uploaded_at timestamptz, duration_seconds integer, format text,
      size_bytes bigint, phone_key text, priority smallint, status text, skip_reason text
    )
    ON CONFLICT (cre_recording_id) DO NOTHING
    RETURNING id`))
  return inserted.length
}

/** The recording was deleted on the handset side: its transcript and verdict go too (feedback cascades). */
export async function purgeRecordings(recordingIds: string[]): Promise<number> {
  if (recordingIds.length === 0) return 0
  const removed = rows<{ id: string }>(await db.execute(sql`
    DELETE FROM call_ai_reviews
    WHERE cre_recording_id IN (${sql.join(recordingIds.map((id) => sql`${id}::uuid`), sql`, `)})
    RETURNING id`))
  return removed.length
}

// ── Claiming ─────────────────────────────────────────────────────────────────────────────────────

export type ClaimedJob = {
  id: string
  creRecordingId: string
  lockToken: string
  attempts: number
  priority: number
  recordedAt: string | null
  callType: string | null
  durationSeconds: number | null
  team: string | null
  format: string | null
  segments: Segment[] | null
  sttLanguage: string | null
  sttModel: string | null
}

/**
 * Lease up to `limit` jobs: queued work whose backoff has passed, plus processing work whose lease ran out
 * (a run that died mid-job). FOR UPDATE SKIP LOCKED makes two overlapping cron runs take disjoint sets.
 * Live calls (priority 0) go first, newest first, so this morning's calls are ready before the backlog.
 */
export async function claimJobs(limit: number, leaseMinutes: number): Promise<ClaimedJob[]> {
  const claimed = rows<Record<string, unknown>>(await db.execute(sql`
    WITH picked AS (
      SELECT id FROM call_ai_reviews
      WHERE (status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= clock_timestamp()))
         OR (status = 'processing' AND locked_until < clock_timestamp())
      ORDER BY priority ASC, recorded_at DESC NULLS LAST
      LIMIT ${limit}::int
      FOR UPDATE SKIP LOCKED
    )
    UPDATE call_ai_reviews r
    SET status = 'processing',
        lock_token = gen_random_uuid(),
        locked_until = clock_timestamp() + make_interval(mins => ${leaseMinutes}::int),
        attempts = r.attempts + 1,
        updated_at = clock_timestamp()
    FROM picked
    WHERE r.id = picked.id
    RETURNING r.id, r.cre_recording_id, r.lock_token, r.attempts, r.priority, r.recorded_at, r.call_type,
              r.duration_seconds, r.team_label, r.format, r.segments, r.stt_language, r.stt_model`))
  return claimed.map((row) => ({
    id: String(row.id),
    creRecordingId: String(row.cre_recording_id),
    lockToken: String(row.lock_token),
    attempts: Number(row.attempts),
    priority: Number(row.priority),
    recordedAt: row.recorded_at ? new Date(row.recorded_at as string).toISOString() : null,
    callType: (row.call_type as string) ?? null,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    team: (row.team_label as string) ?? null,
    format: (row.format as string) ?? null,
    segments: jsonColumn<Segment[]>(row.segments),
    sttLanguage: (row.stt_language as string) ?? null,
    sttModel: (row.stt_model as string) ?? null,
  }))
}

// ── Finishing (all compare-and-swap on the lease) ────────────────────────────────────────────────

async function cas(id: string, token: string, set: SQL): Promise<boolean> {
  const updated = rows<{ id: string }>(await db.execute(sql`
    UPDATE call_ai_reviews SET ${set}, updated_at = clock_timestamp()
    WHERE id = ${id} AND lock_token = ${token}::uuid AND status = 'processing'
    RETURNING id`))
  return updated.length === 1
}

/** Phase 1 done: the transcript is safe even if the verdict call fails, so a retry never pays for Whisper twice. */
export function saveTranscript(id: string, token: string, t: {
  sttModel: string; language: string | null; segments: Segment[]; quality: unknown; speechSeconds: number; billedSeconds: number; costUsd: number
}): Promise<boolean> {
  return cas(id, token, sql`
    stt_model = ${t.sttModel}, stt_language = ${t.language}, segments = ${JSON.stringify(t.segments)}::jsonb,
    stt_quality = ${JSON.stringify(t.quality)}::jsonb, speech_seconds = ${t.speechSeconds}::numeric,
    billed_audio_seconds = ${t.billedSeconds}::numeric, transcribed_at = clock_timestamp(), cost_usd = cost_usd + ${t.costUsd}::numeric`)
}

export type DoneFields = {
  llmModel: string
  promptVersion: string
  analysis: unknown
  conversation: string
  intent: string
  mood: string
  verdict: string
  satisfaction: number | null
  leadTemperature: string
  isComplaint: boolean
  needsAttention: boolean
  followUpDue: string | null
  headline: string
  summary: string
  customerWanted: string
  tokensIn: number
  tokensOut: number
  costUsd: number
  /** Personal / internal calls: the transcript is wiped once the class is known. */
  wipeTranscript: boolean
}

export function completeDone(id: string, token: string, d: DoneFields): Promise<boolean> {
  return cas(id, token, sql`
    status = 'done', lock_token = NULL, locked_until = NULL, next_attempt_at = NULL, last_error = NULL, skip_reason = NULL,
    llm_model = ${d.llmModel}, prompt_version = ${d.promptVersion}, analysis = ${JSON.stringify(d.analysis)}::jsonb,
    analysed_at = clock_timestamp(), conversation = ${d.conversation}, intent = ${d.intent}, mood_end = ${d.mood},
    verdict = ${d.verdict}, satisfaction = ${d.satisfaction}::smallint, lead_temperature = ${d.leadTemperature},
    is_complaint = ${d.isComplaint}::boolean, needs_attention = ${d.needsAttention}::boolean, follow_up_due = ${d.followUpDue}::date,
    headline_en = ${d.headline}, summary_en = ${d.summary}, customer_wanted = ${d.customerWanted},
    tokens_in = tokens_in + ${d.tokensIn}::int, tokens_out = tokens_out + ${d.tokensOut}::int, cost_usd = cost_usd + ${d.costUsd}::numeric,
    segments = CASE WHEN ${d.wipeTranscript}::boolean THEN NULL ELSE segments END`)
}

export function completeSkipped(id: string, token: string, reason: string, costUsd = 0): Promise<boolean> {
  return cas(id, token, sql`
    status = 'skipped', skip_reason = ${reason}, lock_token = NULL, locked_until = NULL, next_attempt_at = NULL,
    last_error = NULL, cost_usd = cost_usd + ${costUsd}::numeric`)
}

/** Back on the queue. `refundAttempt` for a rate limit — being told to wait is not a failed try. */
export function requeue(id: string, token: string, o: { delaySeconds: number; error: string; refundAttempt: boolean }): Promise<boolean> {
  return cas(id, token, sql`
    status = 'queued', lock_token = NULL, locked_until = NULL,
    next_attempt_at = clock_timestamp() + make_interval(secs => ${Math.max(1, Math.round(o.delaySeconds))}::double precision),
    last_error = ${o.error.slice(0, 1000)},
    attempts = CASE WHEN ${o.refundAttempt}::boolean THEN GREATEST(attempts - 1, 0) ELSE attempts END`)
}

export function markFailed(id: string, token: string, error: string): Promise<boolean> {
  return cas(id, token, sql`
    status = 'failed', lock_token = NULL, locked_until = NULL, next_attempt_at = NULL, last_error = ${error.slice(0, 1000)}`)
}

// ── State row ────────────────────────────────────────────────────────────────────────────────────

export type PipelineState = {
  enabled: boolean
  liveSince: string | null
  discoverCursorAt: string | null
  discoverCursorId: string | null
  deleteCursorAt: string | null
  sweptOn: string | null
  rateLimitedUntil: string | null
  audioDay: string | null
  audioSecondsDay: number
  lastRunAt: string | null
  lastRun: Record<string, unknown> | null
}

export async function readState(): Promise<PipelineState> {
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT enabled, live_since, discover_cursor_at, discover_cursor_id, delete_cursor_at, swept_on::text AS swept_on,
           rate_limited_until, audio_day::text AS audio_day, audio_seconds_day, last_run_at, last_run
    FROM call_ai_state WHERE id = 1`))
  if (!row) throw new Error('call_ai_state has no row — apply lib/db/migrations/call-ai/0001 (scripts/apply-call-ai-migration.ts)')
  const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)
  return {
    enabled: Boolean(row.enabled),
    liveSince: iso(row.live_since),
    discoverCursorAt: (row.discover_cursor_at as string) ?? null,
    discoverCursorId: (row.discover_cursor_id as string) ?? null,
    deleteCursorAt: (row.delete_cursor_at as string) ?? null,
    sweptOn: (row.swept_on as string) ?? null,
    rateLimitedUntil: iso(row.rate_limited_until),
    audioDay: (row.audio_day as string) ?? null,
    audioSecondsDay: Number(row.audio_seconds_day) || 0,
    lastRunAt: iso(row.last_run_at),
    lastRun: jsonColumn<Record<string, unknown>>(row.last_run),
  }
}

export async function writeState(patch: Partial<{
  enabled: boolean
  liveSince: string
  discoverCursor: { at: string; id: string }
  deleteCursorAt: string
  sweptOn: string
  rateLimitedUntil: string | null
  lastRun: Record<string, unknown>
}>): Promise<void> {
  const sets = [sql`updated_at = clock_timestamp()`]
  if (patch.enabled !== undefined) sets.push(sql`enabled = ${patch.enabled}::boolean`)
  if (patch.liveSince) sets.push(sql`live_since = COALESCE(live_since, ${patch.liveSince}::timestamptz)`)
  if (patch.discoverCursor) sets.push(sql`discover_cursor_at = ${patch.discoverCursor.at}, discover_cursor_id = ${patch.discoverCursor.id}::uuid`)
  if (patch.deleteCursorAt) sets.push(sql`delete_cursor_at = ${patch.deleteCursorAt}`)
  if (patch.sweptOn) sets.push(sql`swept_on = ${patch.sweptOn}::date`)
  if (patch.rateLimitedUntil !== undefined) sets.push(sql`rate_limited_until = ${patch.rateLimitedUntil}::timestamptz`)
  if (patch.lastRun) sets.push(sql`last_run = ${JSON.stringify(patch.lastRun)}::jsonb, last_run_at = clock_timestamp()`)
  await db.execute(sql`UPDATE call_ai_state SET ${sql.join(sets, sql`, `)} WHERE id = 1`)
}

/** Atomic per-IST-day Whisper counter; returns today's running total. */
export async function addAudioSeconds(day: string, seconds: number): Promise<number> {
  const [row] = rows<{ total: string }>(await db.execute(sql`
    UPDATE call_ai_state
    SET audio_seconds_day = CASE WHEN audio_day = ${day}::date THEN audio_seconds_day + ${seconds}::numeric ELSE ${seconds}::numeric END,
        audio_day = ${day}::date
    WHERE id = 1
    RETURNING audio_seconds_day AS total`))
  return Number(row?.total) || 0
}
