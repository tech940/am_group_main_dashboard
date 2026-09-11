/**
 * Pure helpers for LocoNav drive history — no 'server-only', no database, no provider calls.
 *
 * They live apart from lib/loconav/client.ts and trips.ts for one reason: scripts/verify-loconav.ts must be
 * able to import and exercise them directly, and anything that imports 'server-only' cannot be loaded there.
 *
 * ── Measured on the live account, 2026-09-11 ─────────────────────────────────────────────────────
 * - `/timeline` and `/alerts` refuse a window longer than ONE DAY: exactly 86,400 s answers 200, 86,401 s
 *   answers 400 "Start time End time difference should be less than 1 days". `/distance_travelled` accepts a
 *   week. A demo that runs overnight therefore has to be asked for in slices.
 * - `movementStatus` is one of `Moving`, `Stopped`, `Idling`, `Offline`. Only Moving segments carry
 *   distance, averageSpeed and a path.
 * - A real 7.8 h drive (GP-JK402-000010) came back as I M I M I M S O S I M I M O I M S M S I.
 */

/** The provider's hard limit for one timeline or alerts request, inclusive. */
export const LOCONAV_HISTORY_WINDOW_SECONDS = 86_400

export type TimeSlice = { start: Date; end: Date }

/** How many slices a window needs, without allocating them — so a caller can refuse a huge window first. */
export function sliceCount(start: Date, end: Date, maxSeconds: number = LOCONAV_HISTORY_WINDOW_SECONDS): number {
  const s = start.getTime()
  const e = end.getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || !(maxSeconds > 0)) return 0
  return Math.ceil((e - s) / (maxSeconds * 1000))
}

/**
 * Contiguous slices covering [start, end], each at most `maxSeconds` long. Neighbouring slices share their
 * boundary instant; nothing is skipped.
 *
 * ⚠️ Every slice is a WHOLE number of seconds long except possibly the last, and the client floors both ends
 * to seconds — so a full slice always reaches the provider as exactly 86,400 s, never 86,401.
 */
export function sliceWindow(start: Date, end: Date, maxSeconds: number = LOCONAV_HISTORY_WINDOW_SECONDS): TimeSlice[] {
  const count = sliceCount(start, end, maxSeconds)
  const out: TimeSlice[] = []
  const s = start.getTime()
  const e = end.getTime()
  const stepMs = maxSeconds * 1000
  for (let i = 0; i < count; i++) {
    const from = s + i * stepMs
    out.push({ start: new Date(from), end: new Date(Math.min(from + stepMs, e)) })
  }
  return out
}

export type MovementClass = 'moving' | 'stationary' | 'offline' | 'unknown'

/**
 * ⚠️ Offline is its own class. The unit lost signal or power; the car may have been driving. Counting it as
 * "stopped" — which the first version did, because anything not 'moving' was a stop — inflated both stop
 * time and stop count on every drive that went through a dead zone.
 */
export function classifyMovement(status: unknown): MovementClass {
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'moving') return 'moving'
  if (s === 'stopped' || s === 'idling') return 'stationary'
  if (s === 'offline') return 'offline'
  return 'unknown'
}

/** The fields a summary needs. Structural, so client segments and stored jsonb rows both fit. */
export type SegmentLike = {
  movementStatus: string | null
  startTsMs: number | null
  endTsMs: number | null
  averageSpeedKph: number | null
}

export type SegmentSummary = {
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  /** The highest MOVING-segment average — a floor on the real top speed, never the top speed itself. */
  maxSegmentAverageSpeed: number | null
}

function segmentSeconds(seg: SegmentLike): number {
  return seg.startTsMs !== null && seg.endTsMs !== null && seg.endTsMs > seg.startTsMs
    ? Math.round((seg.endTsMs - seg.startTsMs) / 1000)
    : 0
}

/**
 * Moving time, stopped time, stops, and the fastest segment average for one drive.
 *
 * A STOP is a maximal run of consecutive non-moving segments that contains at least one Stopped or Idling
 * segment — so `S O S` (stopped, signal lost, stopped) is one stop, and a run made only of Offline is none.
 *
 * ⚠️ The run at the very START of the window and the run at the very END are not stops. A pass window opens
 * at gate-out and closes at gate-in: the car idling at the showroom barrier before it leaves, and sitting
 * there after it returns, is not somewhere the customer stopped.
 *
 * ⚠️ Empty input returns nulls, not zeros. Zero means "measured, and the car never moved"; null means the
 * provider told us nothing, and writing 0/0/0 would make a hole in the data read as a finding.
 */
export function summariseSegments(segments: readonly SegmentLike[]): SegmentSummary {
  if (!segments.length) {
    return { movingSeconds: null, stoppedSeconds: null, stopCount: null, maxSegmentAverageSpeed: null }
  }

  const classes = segments.map((seg) => classifyMovement(seg.movementStatus))
  let movingSeconds = 0
  let stoppedSeconds = 0
  let maxSegmentAverageSpeed: number | null = null

  segments.forEach((seg, i) => {
    const seconds = segmentSeconds(seg)
    if (classes[i] === 'moving') {
      movingSeconds += seconds
      const avg = seg.averageSpeedKph
      if (avg !== null && Number.isFinite(avg)) {
        maxSegmentAverageSpeed = maxSegmentAverageSpeed === null ? avg : Math.max(maxSegmentAverageSpeed, avg)
      }
    } else if (classes[i] === 'stationary') {
      stoppedSeconds += seconds
    }
  })

  let stopCount = 0
  let i = 0
  while (i < classes.length) {
    if (classes[i] === 'moving') {
      i++
      continue
    }
    const runStart = i
    let hasStationary = false
    while (i < classes.length && classes[i] !== 'moving') {
      if (classes[i] === 'stationary') hasStationary = true
      i++
    }
    const runEnd = i - 1
    if (hasStationary && runStart !== 0 && runEnd !== classes.length - 1) stopCount++
  }

  return { movingSeconds, stoppedSeconds, stopCount, maxSegmentAverageSpeed }
}

export type AlertLike = { id?: string | null; label: string | null; eventType: string | null }

/** Alerts from overlapping slices can repeat; the provider's id is the identity. Alerts without one are kept. */
export function dedupeAlertsById<T extends { id?: string | null }>(alerts: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const a of alerts) {
    const id = a.id ? String(a.id) : ''
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }
    out.push(a)
  }
  return out
}

/**
 * Alerts grouped by what they are, most frequent first.
 *
 * ⚠️ For the UI. Every alert on the first two real drives was a `Geofence` event — the car leaving and
 * re-entering the showroom fence. "5 alerts" on its own reads as bad driving; "Geofence ×5" does not.
 */
export function groupAlerts(alerts: readonly AlertLike[]): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const a of alerts) {
    const label = String(a.label ?? a.eventType ?? '').trim() || 'Alert'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
}
