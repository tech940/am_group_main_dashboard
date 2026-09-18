import 'server-only'

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getExcludedNumbers } from '@/lib/customer-identity/exclusions'
import { lookupKey, matchCustomers, MATCH_SOURCE_LABEL } from '@/lib/customer-identity/phone-match'
import { callAiConfig } from './config'
import type { CreSource } from './cre-source'
import { istToday } from './discovery'
import { jsonColumn, rows } from './queue'
import {
  INTENTS,
  MOODS,
  REVIEW_QUEUES,
  VERDICTS,
  type Analysis,
  type PipelineStatus,
  type ReviewCustomer,
  type ReviewDetail,
  type ReviewDigest,
  type ReviewFeedback,
  type ReviewListResponse,
  type ReviewQueue,
  type ReviewRow,
  type Segment,
  type Verdict,
  type VerdictLookup,
} from './types'

/**
 * Reads for the AI Call Review tab. The database is ~250 ms away per statement, so each read is ONE statement
 * (CTEs + json_agg), whatever it returns. The only other round trip is naming the customers on the visible
 * page, which needs the CRE project (phone numbers are never stored here).
 */

const EFFECTIVE = sql.raw(`COALESCE(override_verdict, verdict)`)
/** Promises are "overdue" for a week, then drop off — there is no "done" button for a promise, by design. */
const OVERDUE_WINDOW_DAYS = 7

export type ReviewFilters = {
  from: string
  to: string
  queue: ReviewQueue
  verdict: Verdict | null
  intent: string | null
  mood: string | null
  team: string | null
  agent: string | null
  q: string
  page: number
  pageSize: number
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function parseReviewFilters(params: URLSearchParams): ReviewFilters {
  const today = istToday()
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null
  let from = YMD.test(params.get('from') || '') ? String(params.get('from')) : addDays(today, -6)
  let to = YMD.test(params.get('to') || '') ? String(params.get('to')) : today
  if (from > to) [from, to] = [to, from]
  if (from < addDays(to, -366)) from = addDays(to, -366)
  const uuid = /^[0-9a-f-]{36}$/i
  return {
    from,
    to,
    queue: pick(params.get('queue'), REVIEW_QUEUES) ?? 'attention',
    verdict: pick(params.get('verdict'), VERDICTS),
    intent: pick(params.get('intent'), INTENTS),
    mood: pick(params.get('mood'), MOODS),
    team: (params.get('team') || '').trim().slice(0, 120) || null,
    agent: uuid.test(params.get('agent') || '') ? String(params.get('agent')) : null,
    q: (params.get('q') || '').trim().slice(0, 100),
    page: Math.max(1, Math.min(500, Number(params.get('page')) || 1)),
    pageSize: Math.max(10, Math.min(100, Number(params.get('pageSize')) || 25)),
  }
}

function scopeClause(): SQL {
  const scopes = callAiConfig().scope
  return scopes.length ? sql`scope IN (${sql.join(scopes.map((s) => sql`${s}`), sql`, `)})` : sql`false`
}

function queueClause(queue: ReviewQueue, today: string): SQL {
  const overdueFrom = addDays(today, -OVERDUE_WINDOW_DAYS)
  switch (queue) {
    case 'attention':
      return sql`status = 'done' AND ${EFFECTIVE} <> 'not_customer' AND (
        ${EFFECTIVE} IN ('complaint', 'unhappy')
        OR (override_verdict IS NULL AND needs_attention)
        OR (follow_up_due BETWEEN ${overdueFrom}::date AND ${today}::date))`
    case 'hot':
      return sql`status = 'done' AND (${EFFECTIVE} = 'hot_lead' OR (override_verdict IS NULL AND lead_temperature = 'hot'))`
    case 'followups':
      return sql`status = 'done' AND follow_up_due IS NOT NULL AND ${EFFECTIVE} <> 'not_customer'`
    case 'not_customer':
      return sql`(status = 'skipped' OR ${EFFECTIVE} = 'not_customer')`
    default:
      return sql`NOT (status = 'skipped' OR (status = 'done' AND ${EFFECTIVE} = 'not_customer'))`
  }
}

function orderClause(queue: ReviewQueue): SQL {
  if (queue === 'followups') return sql`follow_up_due ASC, recorded_at DESC`
  return sql`recorded_at DESC NULLS LAST, id`
}

type RawRow = Record<string, unknown>

function toRow(r: RawRow): ReviewRow {
  return {
    id: String(r.id),
    recordingId: String(r.cre_recording_id),
    recordedAt: r.recorded_at ? new Date(r.recorded_at as string).toISOString() : null,
    creId: (r.cre_id as string) ?? null,
    creName: (r.cre_name as string) ?? null,
    team: (r.team_label as string) ?? null,
    callType: (r.call_type as string) ?? null,
    durationSeconds: r.duration_seconds === null || r.duration_seconds === undefined ? null : Number(r.duration_seconds),
    status: r.status as ReviewRow['status'],
    skipReason: (r.skip_reason as string) ?? null,
    verdict: (r.verdict as Verdict) ?? null,
    overrideVerdict: (r.override_verdict as Verdict) ?? null,
    intent: (r.intent as ReviewRow['intent']) ?? null,
    mood: (r.mood_end as ReviewRow['mood']) ?? null,
    satisfaction: r.satisfaction === null || r.satisfaction === undefined ? null : Number(r.satisfaction),
    leadTemperature: (r.lead_temperature as string) ?? null,
    headline: (r.headline_en as string) ?? null,
    customerWanted: (r.customer_wanted as string) ?? null,
    followUpDue: (r.follow_up_due as string) ?? null,
    needsAttention: Boolean(r.needs_attention),
    customer: null,
  }
}

const ROW_JSON = sql.raw(`json_build_object(
  'id', id, 'cre_recording_id', cre_recording_id, 'recorded_at', recorded_at, 'cre_id', cre_id, 'cre_name', cre_name,
  'team_label', team_label, 'call_type', call_type, 'duration_seconds', duration_seconds, 'status', status,
  'skip_reason', skip_reason, 'verdict', verdict, 'override_verdict', override_verdict, 'intent', intent,
  'mood_end', mood_end, 'satisfaction', satisfaction, 'lead_temperature', lead_temperature, 'headline_en', headline_en,
  'customer_wanted', customer_wanted, 'follow_up_due', follow_up_due::text, 'needs_attention', needs_attention)`)

export async function listReviews(f: ReviewFilters): Promise<Omit<ReviewListResponse, 'rows'> & { rows: ReviewRow[] }> {
  const today = istToday()
  const overdueFrom = addDays(today, -OVERDUE_WINDOW_DAYS)
  const baseParts: SQL[] = [
    scopeClause(),
    sql`recorded_at >= (${f.from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`,
    sql`recorded_at < ((${f.to}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata'`,
  ]
  if (f.team) baseParts.push(sql`team_label = ${f.team}`)
  if (f.agent) baseParts.push(sql`cre_id = ${f.agent}::uuid`)
  const filterParts: SQL[] = [queueClause(f.queue, today)]
  if (f.verdict) filterParts.push(sql`${EFFECTIVE} = ${f.verdict}`)
  if (f.intent) filterParts.push(sql`intent = ${f.intent}`)
  if (f.mood) filterParts.push(sql`mood_end = ${f.mood}`)
  if (f.q) filterParts.push(sql`search_en @@ websearch_to_tsquery('english', ${f.q})`)

  const [result] = rows<RawRow>(await db.execute(sql`
    WITH base AS (
      SELECT * FROM call_ai_reviews WHERE ${sql.join(baseParts, sql` AND `)}
    ),
    filtered AS (
      SELECT * FROM base WHERE ${sql.join(filterParts, sql` AND `)}
    ),
    page AS (
      SELECT * FROM filtered ORDER BY ${orderClause(f.queue)} LIMIT ${f.pageSize}::int OFFSET ${(f.page - 1) * f.pageSize}::int
    )
    SELECT
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT coalesce(json_agg(${ROW_JSON} ORDER BY ${orderClause(f.queue)}), '[]'::json) FROM page) AS rows,
      (SELECT json_build_object(
        'inScope', count(*),
        'reviewed', count(*) FILTER (WHERE status = 'done'),
        'pending', count(*) FILTER (WHERE status IN ('queued', 'processing')),
        'skipped', count(*) FILTER (WHERE status = 'skipped'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'noConversation', count(*) FILTER (WHERE skip_reason = 'no_conversation' OR (status = 'done' AND ${EFFECTIVE} = 'not_customer')),
        'complaints', count(*) FILTER (WHERE status = 'done' AND ${EFFECTIVE} = 'complaint'),
        'unhappy', count(*) FILTER (WHERE status = 'done' AND ${EFFECTIVE} = 'unhappy'),
        'hotLeads', count(*) FILTER (WHERE status = 'done' AND ${EFFECTIVE} = 'hot_lead'),
        'followUpsDueToday', count(*) FILTER (WHERE status = 'done' AND follow_up_due = ${today}::date AND ${EFFECTIVE} <> 'not_customer'),
        'followUpsOverdue', count(*) FILTER (WHERE status = 'done' AND follow_up_due >= ${overdueFrom}::date AND follow_up_due < ${today}::date AND ${EFFECTIVE} <> 'not_customer'),
        'needsAttention', count(*) FILTER (WHERE ${queueClause('attention', today)})
      ) FROM base) AS digest,
      (SELECT coalesce(json_agg(json_build_object('verdict', v, 'count', n) ORDER BY n DESC), '[]'::json)
         FROM (SELECT ${EFFECTIVE} AS v, count(*)::int AS n FROM base WHERE status = 'done' GROUP BY 1) t) AS by_verdict,
      (SELECT coalesce(json_agg(json_build_object('intent', i, 'count', n) ORDER BY n DESC), '[]'::json)
         FROM (SELECT intent AS i, count(*)::int AS n FROM base WHERE status = 'done' AND ${EFFECTIVE} <> 'not_customer' AND intent IS NOT NULL GROUP BY 1) t) AS by_intent,
      (SELECT coalesce(json_agg(json_build_object('label', team_label, 'count', n) ORDER BY n DESC), '[]'::json)
         FROM (SELECT team_label, count(*)::int AS n FROM call_ai_reviews
               WHERE ${scopeClause()} AND recorded_at >= (${f.from}::date)::timestamp AT TIME ZONE 'Asia/Kolkata'
                 AND recorded_at < ((${f.to}::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata' AND team_label IS NOT NULL
               GROUP BY 1) t) AS teams,
      (SELECT coalesce(json_agg(json_build_object('id', cre_id, 'name', cre_name, 'count', n) ORDER BY n DESC), '[]'::json)
         FROM (SELECT cre_id, max(cre_name) AS cre_name, count(*)::int AS n FROM base WHERE cre_id IS NOT NULL GROUP BY 1) t) AS agents
  `))

  const digestRaw = jsonColumn<Record<string, number>>(result?.digest) ?? {}
  const digest: ReviewDigest = {
    inScope: Number(digestRaw.inScope) || 0,
    reviewed: Number(digestRaw.reviewed) || 0,
    pending: Number(digestRaw.pending) || 0,
    skipped: Number(digestRaw.skipped) || 0,
    failed: Number(digestRaw.failed) || 0,
    noConversation: Number(digestRaw.noConversation) || 0,
    complaints: Number(digestRaw.complaints) || 0,
    unhappy: Number(digestRaw.unhappy) || 0,
    hotLeads: Number(digestRaw.hotLeads) || 0,
    followUpsDueToday: Number(digestRaw.followUpsDueToday) || 0,
    followUpsOverdue: Number(digestRaw.followUpsOverdue) || 0,
    needsAttention: Number(digestRaw.needsAttention) || 0,
    byVerdict: jsonColumn<ReviewDigest['byVerdict']>(result?.by_verdict) ?? [],
    byIntent: jsonColumn<ReviewDigest['byIntent']>(result?.by_intent) ?? [],
  }
  return {
    rows: (jsonColumn<RawRow[]>(result?.rows) ?? []).map(toRow),
    total: Number(result?.total) || 0,
    page: f.page,
    pageSize: f.pageSize,
    digest,
    teams: jsonColumn<ReviewListResponse['teams']>(result?.teams) ?? [],
    agents: jsonColumn<ReviewListResponse['agents']>(result?.agents) ?? [],
    today,
  }
}

/**
 * Names the customers on one page of rows: the CRE project gives the number (never stored here), our own
 * booking/enquiry feeds give the name — the same rules the Recordings tab uses, preferring Hyundai records.
 */
export async function attachCustomers<T extends { recordingId: string; customer: ReviewCustomer | null }>(items: T[], source: CreSource): Promise<T[]> {
  if (items.length === 0) return items
  const recs = await source.getByIds(items.map((item) => item.recordingId)).catch(() => [])
  const byId = new Map(recs.map((r) => [r.id, r]))
  const keys = [...new Set(recs.map((r) => lookupKey(r.phone)).filter(Boolean))] as string[]
  const [matches, excluded] = await Promise.all([
    keys.length ? matchCustomers(keys.map((number) => ({ number, preferBrand: 'hyundai' as const }))).catch(() => new Map()) : Promise.resolve(new Map()),
    keys.length ? getExcludedNumbers(keys).catch(() => new Map()) : Promise.resolve(new Map()),
  ])
  return items.map((item) => {
    const rec = byId.get(item.recordingId)
    if (!rec) return item
    const key = lookupKey(rec.phone)
    const match = key ? matches.get(key) : undefined
    const exclusion = key ? excluded.get(key) : undefined
    return {
      ...item,
      customer: {
        name: match?.customerName || rec.contact_name || null,
        phone: rec.phone || null,
        sourceLabel: match?.source ? MATCH_SOURCE_LABEL[match.source as keyof typeof MATCH_SOURCE_LABEL] ?? null : null,
        notACustomer: exclusion?.label ?? null,
      },
    }
  })
}

export async function getReview(id: string): Promise<ReviewDetail | null> {
  const [r] = rows<RawRow>(await db.execute(sql`
    SELECT r.*, r.follow_up_due::text AS follow_up_due_text,
      (SELECT coalesce(json_agg(json_build_object(
          'id', f.id, 'userName', f.user_name, 'verdictOk', f.verdict_ok, 'correctedVerdict', f.corrected_verdict,
          'note', f.note, 'createdAt', f.created_at) ORDER BY f.created_at DESC), '[]'::json)
       FROM call_ai_feedback f WHERE f.review_id = r.id) AS feedback
    FROM call_ai_reviews r
    WHERE r.id = ${id}::uuid AND ${scopeClause()}`))
  if (!r) return null
  const base = toRow({ ...r, follow_up_due: r.follow_up_due_text })
  return {
    ...base,
    analysis: jsonColumn<Analysis>(r.analysis),
    segments: jsonColumn<Segment[]>(r.segments),
    sttLanguage: (r.stt_language as string) ?? null,
    speechSeconds: r.speech_seconds === null || r.speech_seconds === undefined ? null : Number(r.speech_seconds),
    analysedAt: r.analysed_at ? new Date(r.analysed_at as string).toISOString() : null,
    llmModel: (r.llm_model as string) ?? null,
    sttModel: (r.stt_model as string) ?? null,
    lastError: (r.last_error as string) ?? null,
    feedback: (jsonColumn<ReviewFeedback[]>(r.feedback) ?? []).map((f) => ({ ...f, createdAt: new Date(f.createdAt).toISOString() })),
  }
}

export async function lookupVerdicts(recordingIds: string[]): Promise<VerdictLookup> {
  const ids = recordingIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100)
  if (ids.length === 0) return {}
  const found = rows<RawRow>(await db.execute(sql`
    SELECT id, cre_recording_id, status, ${EFFECTIVE} AS verdict, headline_en, skip_reason
    FROM call_ai_reviews
    WHERE ${scopeClause()} AND cre_recording_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`))
  const out: VerdictLookup = {}
  for (const r of found) {
    out[String(r.cre_recording_id)] = {
      id: String(r.id),
      status: r.status as ReviewRow['status'],
      verdict: (r.verdict as Verdict) ?? null,
      headline: (r.headline_en as string) ?? null,
      skipReason: (r.skip_reason as string) ?? null,
    }
  }
  return out
}

/** The MD's correction: kept forever in call_ai_feedback, and (when a new verdict is given) shown instead. */
export async function saveFeedback(input: {
  reviewId: string
  userId: string | null
  userName: string | null
  verdictOk: boolean
  correctedVerdict: Verdict | null
  note: string | null
}): Promise<boolean> {
  const done = rows<{ id: string }>(await db.execute(sql`
    WITH target AS (
      SELECT id FROM call_ai_reviews WHERE id = ${input.reviewId}::uuid AND status = 'done' AND ${scopeClause()}
    ),
    inserted AS (
      INSERT INTO call_ai_feedback (review_id, user_id, user_name, verdict_ok, corrected_verdict, note)
      SELECT id, ${input.userId}::uuid, ${input.userName}, ${input.verdictOk}::boolean, ${input.correctedVerdict}, ${input.note}
      FROM target
      RETURNING review_id
    )
    UPDATE call_ai_reviews r
    SET override_verdict = CASE WHEN ${input.verdictOk}::boolean THEN NULL ELSE coalesce(${input.correctedVerdict}, r.override_verdict) END,
        override_by = ${input.userId}::uuid, override_by_name = ${input.userName}, override_at = clock_timestamp(),
        updated_at = clock_timestamp()
    FROM inserted
    WHERE r.id = inserted.review_id
    RETURNING r.id`))
  return done.length === 1
}

/** Put a review back on the queue. A retranscribe also throws away the saved transcript (Whisper is paid again). */
export async function requeueReview(id: string, retranscribe: boolean): Promise<boolean> {
  const updated = rows<{ id: string }>(await db.execute(sql`
    UPDATE call_ai_reviews
    SET status = 'queued', priority = 0, attempts = 0, next_attempt_at = NULL, last_error = NULL, skip_reason = NULL,
        segments = CASE WHEN ${retranscribe}::boolean THEN NULL ELSE segments END,
        stt_model = CASE WHEN ${retranscribe}::boolean THEN NULL ELSE stt_model END,
        transcribed_at = CASE WHEN ${retranscribe}::boolean THEN NULL ELSE transcribed_at END,
        updated_at = clock_timestamp()
    WHERE id = ${id}::uuid AND status <> 'processing' AND ${scopeClause()}
    RETURNING id`))
  return updated.length === 1
}

export async function pipelineStatus(): Promise<PipelineStatus> {
  const cfg = callAiConfig()
  const today = istToday()
  const monthStart = `${today.slice(0, 7)}-01`
  const [r] = rows<RawRow>(await db.execute(sql`
    SELECT
      (SELECT row_to_json(s) FROM (SELECT enabled, rate_limited_until, last_run_at, last_run, audio_day::text AS audio_day, audio_seconds_day FROM call_ai_state WHERE id = 1) s) AS state,
      (SELECT json_object_agg(status, n) FROM (SELECT status, count(*)::int AS n FROM call_ai_reviews WHERE ${scopeClause()} GROUP BY status) c) AS counts,
      (SELECT coalesce(sum(cost_usd), 0) FROM call_ai_reviews
        WHERE greatest(transcribed_at, analysed_at) >= (${today}::date)::timestamp AT TIME ZONE 'Asia/Kolkata') AS cost_today,
      (SELECT coalesce(sum(cost_usd), 0) FROM call_ai_reviews
        WHERE greatest(transcribed_at, analysed_at) >= (${monthStart}::date)::timestamp AT TIME ZONE 'Asia/Kolkata') AS cost_month,
      (SELECT json_build_object('rated', count(DISTINCT review_id), 'correct', count(DISTINCT review_id) FILTER (WHERE verdict_ok))
         FROM (SELECT DISTINCT ON (review_id) review_id, verdict_ok FROM call_ai_feedback ORDER BY review_id, created_at DESC) latest) AS accuracy,
      (SELECT coalesce(json_agg(json_build_object('recordingId', cre_recording_id, 'error', last_error, 'at', updated_at) ORDER BY updated_at DESC), '[]'::json)
         FROM (SELECT cre_recording_id, last_error, updated_at FROM call_ai_reviews
               WHERE last_error IS NOT NULL AND ${scopeClause()} ORDER BY updated_at DESC LIMIT 5) e) AS errors`))
  const state = jsonColumn<Record<string, unknown>>(r?.state) ?? {}
  const counts = jsonColumn<Record<string, number>>(r?.counts) ?? {}
  const accuracy = jsonColumn<{ rated: number; correct: number }>(r?.accuracy) ?? { rated: 0, correct: 0 }
  return {
    enabled: Boolean(state.enabled),
    envEnabled: cfg.enabled,
    scope: cfg.scope,
    rateLimitedUntil: state.rate_limited_until ? new Date(state.rate_limited_until as string).toISOString() : null,
    lastRunAt: state.last_run_at ? new Date(state.last_run_at as string).toISOString() : null,
    lastRun: jsonColumn<Record<string, unknown>>(state.last_run),
    counts: {
      queued: Number(counts.queued) || 0,
      processing: Number(counts.processing) || 0,
      done: Number(counts.done) || 0,
      skipped: Number(counts.skipped) || 0,
      failed: Number(counts.failed) || 0,
    },
    audioSecondsToday: state.audio_day === today ? Number(state.audio_seconds_day) || 0 : 0,
    dailyAudioCapSeconds: cfg.dailyAudioCapSeconds,
    costTodayUsd: Math.round(Number(r?.cost_today || 0) * 10000) / 10000,
    costMonthUsd: Math.round(Number(r?.cost_month || 0) * 10000) / 10000,
    accuracy: { rated: Number(accuracy.rated) || 0, correct: Number(accuracy.correct) || 0 },
    recentErrors: (jsonColumn<Array<{ recordingId: string; error: string; at: string }>>(r?.errors) ?? []).map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
  }
}
