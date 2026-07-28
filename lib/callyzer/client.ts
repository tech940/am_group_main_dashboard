import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * Callyzer v2.2 access, split in two:
 *
 *   fetchCallPage()  — talks to Callyzer. Used ONLY by the sync job (lib/callyzer/sync.ts).
 *   getAllCalls()    — what the UI uses. Reads the synced rows out of Postgres.
 *
 * Why the UI never touches Callyzer directly: measured, /call-log/history costs ~2.7s per 100-row
 * page and rejects concurrency (a burst of 8 returned seven 429s; five sequential requests with no
 * delay all passed). Paging ~1.9k calls therefore takes ~54s — which is exactly why the first
 * version of this page hung. Reading from Postgres is a single indexed query in milliseconds.
 */

const BASE = 'https://api1.callyzer.co/api/v2.2'

export type CallyzerCall = {
  id: string
  clientName: string
  clientNumber: string
  duration: number
  callType: string
  callDate: string // yyyy-mm-dd
  callTime: string // HH:mm:ss
  note: string
  recordingUrl: string
  empName: string
  empNumber: string
  empTags: string[]
  crmStatus: string
  syncedAt: string | null
}

type RawRow = Record<string, unknown>

const text = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Callyzer's `synced_at` looks like "2026-07-28 10:44:41 IST". Postgres cannot parse the bare "IST"
 * abbreviation (it is ambiguous — India vs Israel vs Irish), so convert to an explicit offset.
 */
function normaliseSyncedAt(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([A-Z]{2,4})?$/)
  if (!m) return raw
  const [, date, time, zone] = m
  const offset = zone === 'IST' ? '+05:30' : zone === 'UTC' || zone === 'GMT' ? '+00:00' : '+05:30'
  return `${date}T${time}${offset}`
}

function mapRow(row: RawRow): CallyzerCall {
  return {
    id: text(row.id),
    clientName: text(row.client_name),
    clientNumber: text(row.client_number),
    duration: num(row.duration),
    callType: text(row.call_type),
    callDate: text(row.call_date),
    callTime: text(row.call_time),
    note: text(row.note),
    // The live field is `call_recording_url`. Published docs say `recording_url` — they are wrong.
    recordingUrl: text(row.call_recording_url),
    empName: text(row.emp_name) || 'Unassigned',
    empNumber: text(row.emp_number),
    empTags: Array.isArray(row.emp_tags) ? (row.emp_tags as unknown[]).map(text).filter(Boolean) : [],
    crmStatus: text(row.crm_status),
    syncedAt: normaliseSyncedAt(row.synced_at),
  }
}

function apiKey() {
  const key = process.env.CALLYZER_API_KEY
  if (!key) throw new Error('CALLYZER_API_KEY is not configured')
  return key
}

/**
 * One page from /call-log/history. Callers MUST invoke this sequentially — concurrency draws 429s
 * (a burst of 8 produced seven), while back-to-back sequential calls are accepted.
 *
 * Retries with backoff: Callyzer intermittently returns a 400 whose body is a raw JDBC exception
 * from their own database (observed mid-backfill on page 9; the identical request succeeded on the
 * next attempt). Treating that as fatal aborted an otherwise healthy sync, so transient upstream
 * faults and 429s are retried before giving up.
 */
export async function fetchCallPage(
  body: Record<string, unknown>,
  attempts = 4,
): Promise<CallyzerCall[]> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}/call-log/history`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (res.ok) {
        const json = (await res.json()) as { result?: RawRow[] }
        return Array.isArray(json.result) ? json.result.map(mapRow) : []
      }
      const detail = await res.text().catch(() => '')
      // 401/403 are configuration problems — retrying cannot help.
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Callyzer auth failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      }
      lastError = new Error(`Callyzer history failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
    } catch (error) {
      if (error instanceof Error && error.message.includes('auth failed')) throw error
      lastError = error
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 1500))
  }
  throw lastError instanceof Error ? lastError : new Error('Callyzer history failed')
}

/**
 * Generic POST for the non-history endpoints, with the same retry policy as fetchCallPage.
 * Returns null rather than throwing: a health probe must never be able to fail a sync whose call
 * data landed correctly.
 */
async function fetchEndpoint(path: string, body: Record<string, unknown>, attempts = 3): Promise<unknown> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      })
      if (res.ok) {
        const json = (await res.json()) as { result?: unknown }
        return json.result ?? null
      }
      if (res.status === 401 || res.status === 403) return null
    } catch {
      // fall through to the retry
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 2000))
  }
  return null
}

/**
 * Per-handset device health. The ONLY thing in Callyzer's API that is not derivable from the call
 * rows: when each phone last checked in, whether the app was uninstalled, and whether call recording
 * is still on.
 */
export async function fetchHandsets(): Promise<unknown> {
  return fetchEndpoint('/employee/get', {})
}

/** Callyzer's own totals for a window — the other side of the completeness check. */
export async function fetchSummary(fromEpoch: number, toEpoch: number): Promise<Record<string, unknown> | null> {
  const result = await fetchEndpoint('/call-log/summary', {
    call_from: fromEpoch,
    call_to: toEpoch,
    call_method: 'PhoneCall',
    call_mode: 'Voice',
  })
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : null
}

type DbRow = Record<string, unknown>

function fromDb(row: DbRow): CallyzerCall {
  return {
    id: text(row.id),
    clientName: text(row.client_name),
    clientNumber: text(row.client_number),
    duration: num(row.duration),
    callType: text(row.call_type),
    callDate: row.call_date ? String(row.call_date).slice(0, 10) : '',
    callTime: text(row.call_time),
    note: text(row.note),
    recordingUrl: text(row.recording_url),
    empName: text(row.emp_name) || 'Unassigned',
    empNumber: text(row.emp_number),
    empTags: Array.isArray(row.emp_tags) ? (row.emp_tags as unknown[]).map(text).filter(Boolean) : [],
    crmStatus: text(row.crm_status),
    syncedAt: row.synced_at ? String(row.synced_at) : null,
  }
}

/**
 * Synced calls, newest first. Date bounds are pushed into SQL so a narrow filter reads only the
 * rows it needs (call_date is indexed); the remaining filters are applied in memory by the caller.
 */
export async function getAllCalls(range?: { startDate?: string | null; endDate?: string | null }): Promise<CallyzerCall[]> {
  const conditions = [sql`TRUE`]
  if (range?.startDate) conditions.push(sql`call_date >= ${range.startDate}::date`)
  if (range?.endDate) conditions.push(sql`call_date <= ${range.endDate}::date`)

  const result = await db.execute(sql`
    SELECT id, client_name, client_number, duration, call_type, call_date, call_time,
           note, recording_url, emp_name, emp_number, emp_tags, crm_status, synced_at
    FROM callyzer_calls
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY call_date DESC, call_time DESC
    LIMIT 100000
  `)
  return (Array.isArray(result) ? (result as DbRow[]) : []).map(fromDb)
}

/** Single call, for the authenticated recording proxy. */
export async function getCallById(id: string): Promise<CallyzerCall | null> {
  const result = await db.execute(sql`
    SELECT id, client_name, client_number, duration, call_type, call_date, call_time,
           note, recording_url, emp_name, emp_number, emp_tags, crm_status, synced_at
    FROM callyzer_calls WHERE id = ${id} LIMIT 1
  `)
  const rows = Array.isArray(result) ? (result as DbRow[]) : []
  return rows.length ? fromDb(rows[0]) : null
}

/**
 * Read a jsonb column that may arrive either already-parsed or as raw text, depending on the driver
 * path. Returns null unless the parsed value passes `guard`, so a malformed column degrades to
 * "unknown" rather than throwing inside a page render.
 */
function parseJsonColumn<T>(value: unknown, guard: (v: unknown) => boolean): T | null {
  if (value === null || value === undefined) return null
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }
  return guard(parsed) ? (parsed as T) : null
}

/** Sync freshness, surfaced in the UI so nobody mistakes stale data for live data. */
export async function getSyncState() {
  const result = await db.execute(sql`
    SELECT last_synced_at, last_run_at, last_run_status, last_run_detail, total_calls,
           handsets, handsets_checked_at, completeness, completeness_checked_at
    FROM callyzer_sync_state WHERE id = 1
  `)
  const row = (Array.isArray(result) ? result[0] : null) as DbRow | null
  return {
    lastSyncedAt: row?.last_synced_at ? String(row.last_synced_at) : null,
    lastRunAt: row?.last_run_at ? String(row.last_run_at) : null,
    lastRunStatus: row?.last_run_status ? String(row.last_run_status) : null,
    lastRunDetail: row?.last_run_detail ? String(row.last_run_detail) : null,
    totalCalls: num(row?.total_calls),
    // Feed health. Null until the first sync run captures it — the UI shows "not checked yet"
    // rather than a reassuring green.
    //
    // ⚠️ jsonb arrives as a STRING through db.execute on this driver, not as a parsed object
    // (verified: typeof handsets === 'string' via both raw postgres-js and drizzle). A plain
    // Array.isArray / typeof === 'object' check silently yields null forever, so the strip would
    // read "not checked yet" no matter how many syncs ran — a health monitor that is itself
    // invisibly broken. Parse explicitly.
    handsets: parseJsonColumn<unknown[]>(row?.handsets, Array.isArray),
    handsetsCheckedAt: row?.handsets_checked_at ? String(row.handsets_checked_at) : null,
    completeness: parseJsonColumn<Record<string, unknown>>(
      row?.completeness,
      (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v),
    ),
    completenessCheckedAt: row?.completeness_checked_at ? String(row.completeness_checked_at) : null,
  }
}
