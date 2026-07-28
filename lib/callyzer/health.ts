/**
 * Feed health for Call Analysis.
 *
 * Deliberately NOT `server-only`: this file is pure transformation — no db, no env, no fetch — so
 * the client imports its TYPES rather than redeclaring them, and the mapping stays unit-testable
 * outside Next. The functions that actually talk to Callyzer live in client.ts, which is server-only.
 *
 * The section reads a synced table, so a dead feed and a quiet week look identical on screen. These
 * two checks are the only way to tell them apart, and neither is derivable from the call rows:
 *
 *   HANDSETS      Callyzer's /employee/get reports when each phone last checked in, whether the app
 *                 has been uninstalled and whether call recording is still switched on. 71% of the
 *                 log comes from one handset — if it stops uploading, the page just stops growing.
 *
 *   COMPLETENESS  Callyzer's own total for a window vs our COUNT(*) for the same window. Verified to
 *                 reconcile exactly on closed months, so a non-zero delta is a real signal. This is
 *                 what catches a PARTIALLY failed sync; `last_run_status = 'ok'` cannot, because the
 *                 run genuinely did succeed — it was simply short.
 */

/** Callyzer renders timestamps as "28 Jul 2026, 05:11 PM", with no zone. The account runs in IST. */
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export function parseCallyzerDate(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  const [, d, mon, y, hh, mm, ap] = m
  const month = MONTHS[mon.toLowerCase()]
  if (!month) return null
  let hour = Number(hh) % 12
  if (ap.toUpperCase() === 'PM') hour += 12
  // Explicit +05:30 — the same trap as `synced_at`: a bare local time would be read as UTC and every
  // "last seen" would be 5.5 hours stale.
  return `${y}-${month}-${d.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${mm}:00+05:30`
}

export type HandsetHealth = {
  empName: string
  empNumber: string
  tags: string[]
  appVersion: string
  deviceModel: string
  androidVersion: string
  registeredAt: string | null
  lastSyncReqAt: string | null
  lastCallAt: string | null
  appUninstalled: boolean
  recordingActive: boolean
  /** Hours since the handset last checked in — null when it has never reported. */
  hoursSinceSync: number | null
  status: 'ok' | 'stale' | 'offline' | 'uninstalled' | 'recording_off'
}

/** A handset silent this long is treated as offline rather than merely quiet. */
const STALE_HOURS = 6
const OFFLINE_HOURS = 24

export function mapHandsets(raw: unknown, now = Date.now()): HandsetHealth[] {
  const rows = Array.isArray(raw) ? raw : []
  return rows.map((r) => {
    const row = (r || {}) as Record<string, unknown>
    const device = (row.device_details || {}) as Record<string, unknown>
    const pref = (row.device_preference || {}) as Record<string, unknown>
    const lastSyncReqAt = parseCallyzerDate(row.last_sync_req_at)
    const hoursSinceSync = lastSyncReqAt
      ? Math.max(0, Math.round(((now - new Date(lastSyncReqAt).getTime()) / 3_600_000) * 10) / 10)
      : null

    const appUninstalled = pref.is_app_uninstalled === true
    const recordingActive = row.is_call_recording_active !== false

    // Ordered by how much data each state is costing right now: an uninstalled app loses everything,
    // recording-off silently loses only the audio, a silent handset may just be idle.
    let status: HandsetHealth['status'] = 'ok'
    if (appUninstalled) status = 'uninstalled'
    else if (!recordingActive) status = 'recording_off'
    else if (hoursSinceSync === null || hoursSinceSync >= OFFLINE_HOURS) status = 'offline'
    else if (hoursSinceSync >= STALE_HOURS) status = 'stale'

    return {
      empName: String(row.emp_name || 'Unknown'),
      empNumber: String(row.emp_number || ''),
      tags: Array.isArray(row.emp_tags) ? (row.emp_tags as unknown[]).map(String) : [],
      appVersion: String(row.app_version || ''),
      deviceModel: String(device.device_model || ''),
      androidVersion: String(device.android_version || ''),
      registeredAt: parseCallyzerDate(row.registered_at),
      lastSyncReqAt,
      lastCallAt: parseCallyzerDate(row.last_call_at),
      appUninstalled,
      recordingActive,
      hoursSinceSync,
      status,
    }
  })
}

export type Completeness = {
  windowFrom: string
  windowTo: string
  ours: number
  theirs: number
  delta: number
  /** True when our row count matches Callyzer's for the same window. */
  inSync: boolean
  byType: { type: string; ours: number; theirs: number }[]
}

/**
 * @param window whole days, so both sides are asked the same question. Callyzer takes an epoch range
 *   and we hold a date column; comparing a timestamp window to a date window produces bidirectional
 *   deltas that look like data loss and are not (measured: −8 outgoing but +6 missed on a rolling
 *   30-day window, purely from the boundary).
 */
export function compareCompleteness(
  windowFrom: string,
  windowTo: string,
  ours: { total: number; incoming: number; outgoing: number; missed: number; rejected: number },
  theirs: Record<string, unknown> | null,
): Completeness | null {
  if (!theirs) return null
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  const total = n(theirs.total_calls)
  return {
    windowFrom,
    windowTo,
    ours: ours.total,
    theirs: total,
    delta: ours.total - total,
    inSync: ours.total === total,
    byType: [
      { type: 'Incoming', ours: ours.incoming, theirs: n(theirs.total_incoming_calls) },
      { type: 'Outgoing', ours: ours.outgoing, theirs: n(theirs.total_outgoing_calls) },
      { type: 'Missed', ours: ours.missed, theirs: n(theirs.total_missed_calls) },
      { type: 'Rejected', ours: ours.rejected, theirs: n(theirs.total_rejected_calls) },
    ],
  }
}

/** The last fully-closed month — the only window where a delta is unambiguous. */
export function closedMonthWindow(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based; using the previous month
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(start), to: iso(end) }
}

/* ── Alerting: which health states are worth waking someone for ────────────── */

export type Problem = { key: string; headline: string; detail: string }

/**
 * What is wrong right now, in a stable order so the same situation always yields the same signature.
 *
 * `stale` is deliberately NOT a problem: a handset silent for 6 hours is usually just an idle phone
 * overnight, and alerting on it would train the recipients to ignore the mail. Only offline (24h),
 * uninstalled, recording-off and a genuine completeness drift are worth waking someone for.
 */
export function detectProblems(
  handsets: HandsetHealth[] | null,
  completeness: Completeness | null,
): Problem[] {
  const problems: Problem[] = []

  for (const h of [...(handsets || [])].sort((a, b) => a.empName.localeCompare(b.empName))) {
    if (h.status === 'uninstalled') {
      problems.push({
        key: `${h.empNumber}:uninstalled`,
        headline: `${h.empName} — Callyzer app uninstalled`,
        detail: `The app is gone from ${h.deviceModel || 'the handset'} (${h.empNumber}). No calls from this phone are being recorded or uploaded at all.`,
      })
    } else if (!h.recordingActive) {
      problems.push({
        key: `${h.empNumber}:recording_off`,
        headline: `${h.empName} — call recording switched off`,
        detail: `Calls are still being logged, but no audio is being captured on ${h.deviceModel || 'this handset'} (${h.empNumber}). Recordings for this period will not exist later.`,
      })
    } else if (h.status === 'offline') {
      problems.push({
        key: `${h.empNumber}:offline`,
        headline: `${h.empName} — handset has not checked in`,
        detail: h.lastSyncReqAt
          ? `Last contact with Callyzer was ${h.hoursSinceSync} hours ago (${new Date(h.lastSyncReqAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}). Calls made since then are not reaching the dashboard.`
          : `This handset has never checked in. It may not be set up.`,
      })
    }
  }

  if (completeness && !completeness.inSync) {
    const missing = completeness.delta < 0
    problems.push({
      key: `completeness:${completeness.windowFrom}:${completeness.delta}`,
      headline: `Call records ${missing ? 'missing' : 'exceed Callyzer'} for ${completeness.windowFrom} to ${completeness.windowTo}`,
      detail: `Callyzer reports ${completeness.theirs} calls for that month; the dashboard holds ${completeness.ours}. A re-run of the backfill will repair a shortfall.`,
    })
  }

  return problems
}

/** Order-independent fingerprint. Empty string means healthy. */
export function alertSignature(problems: Problem[]): string {
  return problems.map((p) => p.key).sort().join('|')
}
