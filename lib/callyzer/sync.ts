import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { fetchCallPage, fetchHandsets, fetchSummary, type CallyzerCall } from '@/lib/callyzer/client'
import {
  closedMonthWindow,
  compareCompleteness,
  mapHandsets,
  type Completeness,
  type HandsetHealth,
} from '@/lib/callyzer/health'
import { maybeSendFeedHealthAlert } from '@/lib/callyzer/alerts'

/**
 * Callyzer -> Postgres sync.
 *
 * Measured behaviour that shapes this (see also migration 0025):
 *   - /call-log/history costs ~2.7s per 100-row page
 *   - requests must be SEQUENTIAL: a parallel burst of 8 produced seven 429s, while five
 *     back-to-back sequential requests with ZERO delay all succeeded. So the limit is concurrency,
 *     not spacing — we page one at a time and add no artificial gap.
 *
 * Two modes:
 *   backfill — walk the call_date window (used once, and to repair gaps)
 *   delta    — walk synced_from/synced_to since the last run. This is the correct incremental key:
 *              a handset can upload a call hours or days after it happened, and a call_date window
 *              would silently miss those late arrivals forever.
 */

const PAGE_SIZE = 100
const MAX_PAGES_PER_RUN = 200 // 20k calls — a safety stop, never reached in normal operation
const WINDOW_DAYS = 180 // Callyzer's hard limit per query

export type SyncResult = {
  mode: 'backfill' | 'delta'
  fetched: number
  upserted: number
  pages: number
  elapsedMs: number
  windowFrom: string
  windowTo: string
}

async function upsertCalls(calls: CallyzerCall[]): Promise<number> {
  if (!calls.length) return 0

  // One statement for the whole batch rather than N inserts: on the pooler each statement costs ~2
  // round trips, so per-row inserts would dominate the sync.
  //
  // The rows travel as ONE jsonb parameter, not as parallel arrays. Two reasons:
  //  1. Drizzle does not serialise a JS array into a Postgres array — it expands it into a
  //     parameter tuple, so `unnest(${ids}::text[])` is sent as `unnest(($1,$2,$3)::text[])` and
  //     fails at runtime. See lib/db/pg-array.ts.
  //  2. emp_tags is text[], i.e. an array PER ROW. There is no correct way to feed that through
  //     unnest of parallel arrays — the previous attempt cast a flat list to text[][] and would
  //     have mangled tags even if the binding had worked.
  const payload = calls.map((c) => ({
    id: c.id,
    client_name: c.clientName,
    client_number: c.clientNumber,
    duration: c.duration,
    call_type: c.callType,
    call_date: c.callDate || null,
    call_time: c.callTime,
    note: c.note,
    recording_url: c.recordingUrl,
    emp_name: c.empName,
    emp_number: c.empNumber,
    emp_tags: c.empTags,
    crm_status: c.crmStatus,
    synced_at: c.syncedAt,
  }))

  await db.execute(sql`
    INSERT INTO callyzer_calls (
      id, client_name, client_number, duration, call_type, call_date, call_time,
      note, recording_url, emp_name, emp_number, emp_tags, crm_status, synced_at
    )
    SELECT
      x.id, x.client_name, x.client_number, x.duration, x.call_type, x.call_date, x.call_time,
      x.note, x.recording_url, x.emp_name, x.emp_number,
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(x.emp_tags, '[]'::jsonb))),
      x.crm_status, x.synced_at
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(
      id text, client_name text, client_number text, duration integer, call_type text,
      call_date date, call_time text, note text, recording_url text, emp_name text,
      emp_number text, emp_tags jsonb, crm_status text, synced_at timestamptz
    )
    ON CONFLICT (id) DO UPDATE SET
      client_name   = EXCLUDED.client_name,
      duration      = EXCLUDED.duration,
      call_type     = EXCLUDED.call_type,
      note          = EXCLUDED.note,
      -- Never blank an existing recording: Callyzer attaches audio a little after the call row
      -- appears, so a later delta pass can legitimately carry an empty string for a call we already
      -- have audio for.
      recording_url = COALESCE(NULLIF(EXCLUDED.recording_url, ''), callyzer_calls.recording_url),
      crm_status    = EXCLUDED.crm_status,
      synced_at     = EXCLUDED.synced_at,
      updated_at    = now()
  `)
  return calls.length
}

/** Page one window until exhausted, upserting as we go so a timeout still leaves progress behind. */
async function pump(
  body: Record<string, unknown>,
  onPage: (rows: CallyzerCall[]) => Promise<number>,
): Promise<{ fetched: number; upserted: number; pages: number }> {
  let fetched = 0
  let upserted = 0
  let pages = 0
  for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
    const rows = await fetchCallPage({ ...body, page_no: page, page_size: PAGE_SIZE })
    pages++
    fetched += rows.length
    upserted += await onPage(rows)
    if (rows.length < PAGE_SIZE) break
  }
  return { fetched, upserted, pages }
}

/**
 * The two checks that tell a broken feed from a quiet week. Neither is derivable from our own rows.
 *
 * Completeness is measured over the last CLOSED month on purpose. Callyzer takes an epoch range and
 * we hold a date column, so a rolling window compares a timestamp boundary against a date boundary
 * and produces deltas in both directions that look like data loss and are not — measured −8 outgoing
 * alongside +6 missed on a rolling 30 days. On closed months the two agree exactly (Jun 398/398,
 * May 216/216), which is precisely what makes a non-zero delta worth alarming on.
 */
async function captureFeedHealth(): Promise<{ handsets: HandsetHealth[] | null; completeness: Completeness | null }> {
  const handsetsRaw = await fetchHandsets()
  const handsets = handsetsRaw ? mapHandsets(handsetsRaw) : null

  const { from, to } = closedMonthWindow()
  const fromEpoch = Math.floor(new Date(`${from}T00:00:00+05:30`).getTime() / 1000)
  const toEpoch = Math.floor(new Date(`${to}T23:59:59+05:30`).getTime() / 1000)

  const [theirs, oursRows] = await Promise.all([
    fetchSummary(fromEpoch, toEpoch),
    db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE call_type = 'Incoming')::int AS incoming,
        count(*) FILTER (WHERE call_type = 'Outgoing')::int AS outgoing,
        count(*) FILTER (WHERE call_type = 'Missed')::int AS missed,
        count(*) FILTER (WHERE call_type = 'Rejected')::int AS rejected
      FROM callyzer_calls
      WHERE call_date BETWEEN ${from}::date AND ${to}::date
    `),
  ])

  const o = ((Array.isArray(oursRows) ? oursRows[0] : {}) || {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v) || 0
  const completeness = compareCompleteness(from, to, {
    total: n(o.total), incoming: n(o.incoming), outgoing: n(o.outgoing),
    missed: n(o.missed), rejected: n(o.rejected),
  }, theirs)

  return { handsets, completeness }
}

export async function runCallyzerSync(mode: 'backfill' | 'delta' = 'delta'): Promise<SyncResult> {
  const started = Date.now()
  const now = Math.floor(Date.now() / 1000)

  let from: number
  if (mode === 'backfill') {
    from = now - WINDOW_DAYS * 86400
  } else {
    // Resume from the newest call we hold, minus a 2h safety lap for clock skew and late uploads.
    const state = await db.execute(sql`SELECT MAX(synced_at) AS last FROM callyzer_calls`)
    const row = (Array.isArray(state) ? state[0] : null) as { last?: string | Date } | null
    const last = row?.last ? new Date(row.last).getTime() : 0
    from = last ? Math.floor(last / 1000) - 2 * 3600 : now - 7 * 86400
    // Never exceed the API's 180-day ceiling.
    from = Math.max(from, now - WINDOW_DAYS * 86400)
  }

  const body = mode === 'backfill'
    ? { call_from: from, call_to: now, call_method: 'PhoneCall', call_mode: 'Voice' }
    : { synced_from: from, synced_to: now, call_method: 'PhoneCall', call_mode: 'Voice' }

  let result
  try {
    result = await pump(body, upsertCalls)
  } catch (error) {
    await db.execute(sql`
      UPDATE callyzer_sync_state
      SET last_run_at = now(), last_run_status = 'failed',
          last_run_detail = ${String(error instanceof Error ? error.message : error).slice(0, 500)}
      WHERE id = 1
    `).catch(() => {})
    throw error
  }

  const totalRow = await db.execute(sql`SELECT count(*)::int AS n FROM callyzer_calls`)
  const total = Number((Array.isArray(totalRow) ? (totalRow[0] as { n?: number })?.n : 0) || 0)

  // Feed health, captured on the same run. Wrapped so it can NEVER fail a sync whose call data
  // landed correctly — a health probe that takes the sync down with it is worse than no probe.
  const health = await captureFeedHealth().catch((error) => {
    console.error('Callyzer feed-health probe failed (sync itself was fine):', error)
    return null
  })

  await db.execute(sql`
    UPDATE callyzer_sync_state
    SET last_synced_at = now(), last_run_at = now(), last_run_status = 'ok',
        last_run_detail = ${`${mode}: ${result.upserted} rows over ${result.pages} pages`},
        total_calls = ${total},
        handsets = COALESCE(${health?.handsets ? JSON.stringify(health.handsets) : null}::jsonb, callyzer_sync_state.handsets),
        handsets_checked_at = ${health?.handsets ? sql`now()` : sql`callyzer_sync_state.handsets_checked_at`},
        completeness = COALESCE(${health?.completeness ? JSON.stringify(health.completeness) : null}::jsonb, callyzer_sync_state.completeness),
        completeness_checked_at = ${health?.completeness ? sql`now()` : sql`callyzer_sync_state.completeness_checked_at`}
    WHERE id = 1
  `)

  // Mail the technical owners, but ONLY when the problem set changes — this runs every 3 hours, and
  // an alert that repeats itself 8 times a day gets filtered to trash, taking the next real one with
  // it. Already swallows its own errors; alerting must never fail a sync whose call data landed.
  if (health) {
    const alert = await maybeSendFeedHealthAlert(health.handsets, health.completeness)
    if (alert.sent) console.log(`[callyzer] feed-health ${alert.kind} email sent — ${alert.reason}`)
  }

  return {
    mode,
    ...result,
    elapsedMs: Date.now() - started,
    windowFrom: new Date(from * 1000).toISOString(),
    windowTo: new Date(now * 1000).toISOString(),
  }
}
