import 'server-only'

import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses, demoGatePassTrips, demoVehicleTrackers } from '@/lib/db/schema'
import {
  fetchAlerts,
  fetchDistanceTravelled,
  fetchTimeline,
  isLoconavConfigured,
  type LoconavAlert,
  type LoconavTimelineSegment,
} from './client'

/**
 * Reconcile a finished demo drive against the provider's own record of it.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────
 * Everything the gate pass module measured came from four facts: two timestamps stamped at a
 * barrier, and two odometer readings A GUARD TYPED. Nothing checked them, and the drive between the
 * two gates was invisible. This fetches the provider's account of the same window — distance, moving
 * vs stopped time, top speed, the route, and any harsh-driving alert — and sets it beside theirs.
 *
 * ── Where it runs ────────────────────────────────────────────────────────────────────────────
 * ⚠️ NOT at the barrier. Gate-in happens on a public token route with a guard and a queue of cars
 * waiting; a synchronous provider call there would make a slow API into a slow gate, and a provider
 * outage into a vehicle that cannot be booked back in. This is a background sweep over passes that
 * have ALREADY returned.
 */

/**
 * ── The discrepancy rule. ONE definition. ────────────────────────────────────────────────────
 *
 * ⚠️ BOTH conditions, never either. The two numbers disagree for honest reasons all the time:
 *   - GPS undercounts in tunnels and multi-storey car parks and where the unit loses fix;
 *   - the odometer is a whole number a person reads off a dial and types on a phone, at night,
 *     at a barrier — transposed digits are the single most common error in this data;
 *   - a short trip has a large PERCENTAGE error from a rounding of ±1 km that means nothing.
 *
 * So a flag needs the gap to be both materially large in absolute terms AND large relative to the
 * trip. 5 km alone would flag every motorway run; 25% alone would flag a 4 km trip that read 5.
 * Neither is evidence on its own — this is a prompt to LOOK, never an accusation.
 */
export const TRIP_DISCREPANCY_ABS_KM = 5
export const TRIP_DISCREPANCY_RATIO = 0.25

export function isTripDiscrepancy(
  providerKm: number | null | undefined,
  odometerKm: number | null | undefined,
): boolean {
  if (providerKm === null || providerKm === undefined) return false
  if (odometerKm === null || odometerKm === undefined) return false
  const delta = Math.abs(providerKm - odometerKm)
  if (delta < TRIP_DISCREPANCY_ABS_KM) return false
  // Guard the divide: a zero-distance trip with a >=5 km provider reading is itself a discrepancy.
  const basis = Math.max(providerKm, odometerKm)
  if (basis <= 0) return true
  return delta / basis >= TRIP_DISCREPANCY_RATIO
}

/**
 * How far back a first run will reach.
 *
 * ⚠️ Bounded because the first sweep after switching this on would otherwise walk every returned
 * pass ever recorded and make two provider calls for each. Providers also prune history, so the old
 * end of that walk is calls that can only fail.
 */
export const TRIP_BACKFILL_DAYS = 30
/** Per run. The sweep shares a request with the position poll; it must not eat the whole budget. */
export const TRIP_BATCH_SIZE = 5
/** After this many failures a pass is left alone rather than retried on every tick for ever. */
export const TRIP_MAX_ATTEMPTS = 3

/**
 * ⚠️ A TIGHTER REQUEST POLICY THAN THE POSITION POLL, AND THE WHOLE SWEEP DEPENDS ON IT.
 *
 * The client's default is 4 attempts x 20s plus backoff = ~89s for ONE call. Five passes at that
 * budget is ~445s against a route limit of 120s: Vercel kills the instance, no row is written, the
 * retry budget never advances, and the SAME oldest pass is selected again on every tick for ever
 * while newer ones are never reached. This is backfill of a drive that already finished — there is
 * nothing time-critical to protect with four attempts.
 *
 * 2 x 8s + 1.5s backoff = ~17.5s worst case per pass (the three calls run in parallel).
 */
export const TRIP_REQUEST_POLICY = { attempts: 2, timeoutMs: 8_000 } as const
/** Worst case for one pass: the parallel provider calls, plus room for the DB writes. */
export const WORST_CASE_PASS_MS = 17_500 + 4_000

/**
 * Largest odometer difference the numeric(10,2) columns can hold.
 *
 * ⚠️ Not cosmetic. A guard mistyping a closing reading passes both existing checks (it is >= 0 and
 * > the opening reading), and the resulting difference overflows the column with 22003 — which,
 * before this clamp, killed the write, then killed the FAILURE write too, so no row existed, so the
 * pass was re-selected on every sweep for the next 30 days.
 */
export const TRIP_KM_MAX = 99_999_999.99

/**
 * ⚠️ The provider's own error text NEVER reaches the database or the client.
 *
 * client.ts builds its message as `LocoNav /vehicles/<uuid>/timeline failed: HTTP <status> <200
 * chars of the upstream body>` — it carries our provider vehicle uuid and whatever the vendor chose
 * to say. `detail` is returned to every caller with gate_pass.view, i.e. everyone. The sync route
 * already states this policy in so many words; this is what makes it true here too. The raw message
 * is logged server-side, where an operator can still read it.
 */
export function classifyProviderFailure(message: string): string {
  if (/auth failed|not configured/i.test(message)) return 'The tracking provider rejected our credentials.'
  if (/abort|timeout|timed out/i.test(message)) return 'The tracking provider did not answer in time.'
  return 'The tracking provider returned an error.'
}

export type TripReconcileResult = {
  configured: boolean
  considered: number
  reconciled: number
  untracked: number
  unavailable: number
  failed: number
  /** Candidates left for the next run because the request deadline was near. */
  deferred: number
  /** Pass numbers only — never provider text. See classifyProviderFailure. */
  failedPassNos: string[]
  errors: string[]
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const money2 = (n: number | null): string | null => (n === null ? null : n.toFixed(2))

/** Moving/stopped seconds, stop count and top speed, from the segment list. */
function summariseTimeline(segments: LoconavTimelineSegment[]) {
  let movingSeconds = 0
  let stoppedSeconds = 0
  let stopCount = 0
  let maxSpeed: number | null = null

  for (const s of segments) {
    const from = s.startTsMs
    const to = s.endTsMs
    const seconds = from !== null && to !== null && to > from ? Math.round((to - from) / 1000) : 0
    const moving = String(s.movementStatus || '').toLowerCase() === 'moving'
    if (moving) {
      movingSeconds += seconds
      /*
       * ⚠️ averageSpeed, not a top speed — the timeline does not report one. Recorded as the highest
       * SEGMENT AVERAGE, which is a floor on the real maximum, never the maximum itself. A genuine
       * top speed has to come from the overspeed alerts, which is why those are fetched too.
       */
      if (s.averageSpeedKph !== null) maxSpeed = maxSpeed === null ? s.averageSpeedKph : Math.max(maxSpeed, s.averageSpeedKph)
    } else {
      stoppedSeconds += seconds
      stopCount += 1
    }
  }
  /*
   * ⚠️ null, not 0, for an EMPTY timeline. Zero means "measured, and the car never moved"; null means
   * "the provider told us nothing". Writing 0/0/0 for a drive the provider had no segments for makes
   * a hole in the data look like a finding.
   */
  if (!segments.length) {
    return { movingSeconds: null, stoppedSeconds: null, stopCount: null, maxSpeed: null }
  }
  return { movingSeconds, stoppedSeconds, stopCount, maxSpeed }
}

/**
 * The minimal failure row.
 *
 * ⚠️ A SEPARATE WRITER, not writeTrip with nulls. The bug it fixes: when writeTrip failed because a
 * NUMERIC value overflowed, the catch called writeTrip again with the SAME numeric and it failed
 * again — so no row was ever written, `attempts` never advanced, and the pass was re-selected on
 * every sweep for the next 30 days. This carries no numeric that can fail for a data reason.
 */
async function writeTripFailure(row: {
  gatePassId: string
  passNo: string
  vin: string
  providerVehicleUuid: string | null
  windowStart: Date | null
  windowEnd: Date | null
  detail: string
}) {
  await db.execute(sql`
    INSERT INTO demo_gate_pass_trips
      (gate_pass_id, pass_no, vin, provider, provider_vehicle_uuid, window_start, window_end,
       timeline, alert_count, alerts, status, detail, attempts, updated_at)
    VALUES (${row.gatePassId}::uuid, ${row.passNo}, ${row.vin}, 'loconav', ${row.providerVehicleUuid},
            ${row.windowStart}, ${row.windowEnd}, '[]'::jsonb, 0, '[]'::jsonb,
            'failed', ${row.detail.slice(0, 500)}, 1, now())
    ON CONFLICT (gate_pass_id) DO UPDATE SET
      status     = 'failed',
      detail     = EXCLUDED.detail,
      attempts   = demo_gate_pass_trips.attempts + 1,
      updated_at = now()`)
}

type Candidate = {
  id: string
  passNo: string
  vin: string
  gateOutAt: Date | null
  gateInAt: Date | null
  gateOutOdo: string | null
  gateInOdo: string | null
  attempts: number | null
}

async function writeTrip(row: {
  gatePassId: string
  passNo: string
  vin: string
  providerVehicleUuid: string | null
  windowStart: Date | null
  windowEnd: Date | null
  providerKm: number | null
  odometerKm: number | null
  maxSpeed: number | null
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  timeline: unknown[]
  alerts: LoconavAlert[]
  status: 'reconciled' | 'untracked' | 'unavailable' | 'failed'
  detail: string | null
}) {
  const delta =
    row.providerKm !== null && row.odometerKm !== null ? row.providerKm - row.odometerKm : null

  await db.execute(sql`
    INSERT INTO demo_gate_pass_trips
      (gate_pass_id, pass_no, vin, provider, provider_vehicle_uuid, window_start, window_end,
       provider_distance_km, odometer_distance_km, delta_km, max_speed_kph,
       moving_seconds, stopped_seconds, stop_count, timeline, alert_count, alerts,
       status, detail, attempts, reconciled_at, updated_at)
    VALUES (${row.gatePassId}::uuid, ${row.passNo}, ${row.vin}, 'loconav', ${row.providerVehicleUuid},
            ${row.windowStart}, ${row.windowEnd},
            ${money2(row.providerKm)}::numeric, ${money2(row.odometerKm)}::numeric,
            ${money2(delta)}::numeric, ${money2(row.maxSpeed)}::numeric,
            ${row.movingSeconds}, ${row.stoppedSeconds}, ${row.stopCount},
            ${JSON.stringify(row.timeline)}::jsonb, ${row.alerts.length},
            ${JSON.stringify(row.alerts)}::jsonb,
            ${row.status}, ${row.detail},
            1, ${row.status === 'reconciled' ? sql`now()` : sql`NULL`}, now())
    ON CONFLICT (gate_pass_id) DO UPDATE SET
      provider_vehicle_uuid = EXCLUDED.provider_vehicle_uuid,
      window_start          = EXCLUDED.window_start,
      window_end            = EXCLUDED.window_end,
      provider_distance_km  = EXCLUDED.provider_distance_km,
      odometer_distance_km  = EXCLUDED.odometer_distance_km,
      delta_km              = EXCLUDED.delta_km,
      max_speed_kph         = EXCLUDED.max_speed_kph,
      moving_seconds        = EXCLUDED.moving_seconds,
      stopped_seconds       = EXCLUDED.stopped_seconds,
      stop_count            = EXCLUDED.stop_count,
      timeline              = EXCLUDED.timeline,
      alert_count           = EXCLUDED.alert_count,
      alerts                = EXCLUDED.alerts,
      status                = EXCLUDED.status,
      detail                = EXCLUDED.detail,
      -- ⚠️ Accumulate, never reset. attempts is the retry budget; taking EXCLUDED.attempts (always 1)
      -- would make a permanently failing pass retry for ever on every tick.
      attempts              = demo_gate_pass_trips.attempts + 1,
      reconciled_at         = COALESCE(EXCLUDED.reconciled_at, demo_gate_pass_trips.reconciled_at),
      updated_at            = now()`)
}

export async function runTripReconciliation(
  now: Date = new Date(),
  opts: { deadlineMs?: number } = {},
): Promise<TripReconcileResult> {
  const result: TripReconcileResult = {
    configured: isLoconavConfigured(),
    considered: 0,
    reconciled: 0,
    untracked: 0,
    unavailable: 0,
    failed: 0,
    deferred: 0,
    failedPassNos: [],
    errors: [],
  }
  if (!result.configured) return result

  const since = new Date(now.getTime() - TRIP_BACKFILL_DAYS * 24 * 60 * 60 * 1000)

  /*
   * Passes to attempt: returned, both gate events recorded, and either never reconciled or a
   * 'failed' row still inside its retry budget.
   *
   * ⚠️ 'untracked' and 'unavailable' are deliberately NOT re-selected. Both are terminal answers,
   * and re-asking them would spend the whole batch every tick re-confirming that a car without a
   * tracker still has no tracker.
   */
  const candidates = await db
    .select({
      id: demoGatePasses.id,
      passNo: demoGatePasses.passNo,
      vin: demoGatePasses.vin,
      gateOutAt: demoGatePasses.gateOutAt,
      gateInAt: demoGatePasses.gateInAt,
      gateOutOdo: demoGatePasses.gateOutOdo,
      gateInOdo: demoGatePasses.gateInOdo,
      attempts: demoGatePassTrips.attempts,
    })
    .from(demoGatePasses)
    .leftJoin(demoGatePassTrips, eq(demoGatePassTrips.gatePassId, demoGatePasses.id))
    .where(
      and(
        eq(demoGatePasses.status, 'returned'),
        sql`${demoGatePasses.gateOutAt} IS NOT NULL`,
        sql`${demoGatePasses.gateInAt} IS NOT NULL`,
        sql`${demoGatePasses.gateInAt} >= ${since}`,
        or(
          isNull(demoGatePassTrips.gatePassId),
          and(
            eq(demoGatePassTrips.status, 'failed'),
            sql`${demoGatePassTrips.attempts} < ${TRIP_MAX_ATTEMPTS}`,
            /*
             * ⚠️ Backoff, and the only concurrency guard this sweep needs. writeTrip stamps
             * updated_at on every attempt, so an overlapping run — an operator pressing "Sync now"
             * while the cron is mid-batch — cannot re-charge a pass the first run just charged.
             * Without it a two-minute provider blip could burn all three attempts in one minute and
             * mark five passes terminally failed. It also makes the 3-attempt budget span >= 45
             * minutes of real downtime, which is what it was obviously meant to buy.
             *
             * This is what the (status, updated_at) index in 0058 is for — its second column was
             * dead until now.
             */
            sql`${demoGatePassTrips.updatedAt} < now() - interval '15 minutes'`,
          ),
          /*
           * ⚠️ RE-ARM. 'untracked' is terminal, which is right while the car has no device — but a
           * tracker fitted next week would otherwise never rescue the drives already stamped, and
           * there is no other code path that clears them. Gated on a mapping now EXISTING, so a car
           * that is still untracked never enters the batch and cannot starve a real candidate.
           */
          and(
            eq(demoGatePassTrips.status, 'untracked'),
            sql`EXISTS (SELECT 1 FROM demo_vehicle_trackers t
                         WHERE t.vin = upper(btrim(${demoGatePasses.vin})))`,
          ),
        ),
      ),
    )
    .orderBy(asc(demoGatePasses.gateInAt))
    .limit(TRIP_BATCH_SIZE)

  result.considered = candidates.length
  if (!candidates.length) return result

  const trackers = await db
    .select({ vin: demoVehicleTrackers.vin, uuid: demoVehicleTrackers.providerVehicleUuid })
    .from(demoVehicleTrackers)
  const uuidByVin = new Map(trackers.map((t) => [t.vin, t.uuid]))

  for (const c of candidates as Candidate[]) {
    /*
     * ⚠️ Stop BEFORE starting a pass we cannot finish, not after overrunning. The deadline comes from
     * the request, not from this function's own start, because runLoconavSync has already spent an
     * unknown amount of the budget by the time we get here. Deferring is free: the pass has no row,
     * so the next tick simply selects it again.
     */
    if (opts.deadlineMs !== undefined && Date.now() + WORST_CASE_PASS_MS > opts.deadlineMs) {
      result.deferred = candidates.length - (result.reconciled + result.untracked + result.unavailable + result.failed)
      break
    }

    const vin = c.vin.trim().toUpperCase()
    const outOdo = num(c.gateOutOdo)
    const inOdo = num(c.gateInOdo)
    /*
     * ⚠️ A NEGATIVE odometer difference is discarded, not stored. gate_in < gate_out means the
     * number was mistyped (or the cluster was swapped); carrying it forward would produce a
     * nonsense delta that reads as a huge discrepancy and buries the real ones.
     */
    const rawOdometerKm = outOdo !== null && inOdo !== null && inOdo >= outOdo ? inOdo - outOdo : null
    /*
     * ⚠️ Clamped, or a mistyped closing reading overflows numeric(10,2) with 22003 — which used to
     * abort the write, and the failure write after it, leaving no row at all.
     */
    const odometerKm = rawOdometerKm !== null && rawOdometerKm <= TRIP_KM_MAX ? rawOdometerKm : null
    const odometerDropped = rawOdometerKm !== null && odometerKm === null

    const uuid = uuidByVin.get(vin) ?? null
    if (!uuid) {
      await writeTrip({
        gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: null,
        windowStart: c.gateOutAt, windowEnd: c.gateInAt,
        providerKm: null, odometerKm, maxSpeed: null,
        movingSeconds: null, stoppedSeconds: null, stopCount: null,
        timeline: [], alerts: [],
        status: 'untracked',
        detail: 'No LocoNav vehicle is mapped to this VIN — the car has no tracker, or the mapping has not resolved.',
      })
      result.untracked += 1
      continue
    }

    try {
      const start = c.gateOutAt!
      const end = c.gateInAt!

      /*
       * Three calls per pass, in parallel — they are independent reads against one vehicle, and the
       * batch is capped at TRIP_BATCH_SIZE so this cannot fan out unboundedly. Alerts are allowed to
       * fail on their own: a missing harsh-braking list must not throw away a distance that arrived.
       */
      const [distance, timeline, alerts] = await Promise.all([
        fetchDistanceTravelled(uuid, start, end, TRIP_REQUEST_POLICY),
        /*
         * ⚠️ The timeline is allowed to fail on its own, like the alerts. Without this catch a
         * timeline error threw away a DISTANCE that had already arrived — the single most valuable
         * number here — and recorded the pass as a plain failure.
         */
        fetchTimeline(uuid, start, end, TRIP_REQUEST_POLICY).catch(() => [] as LoconavTimelineSegment[]),
        fetchAlerts(uuid, start, end, TRIP_REQUEST_POLICY).catch(() => [] as LoconavAlert[]),
      ])

      const summary = summariseTimeline(timeline)
      const providerKm = distance.km

      await writeTrip({
        gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: uuid,
        windowStart: start, windowEnd: end,
        providerKm, odometerKm, maxSpeed: summary.maxSpeed,
        movingSeconds: summary.movingSeconds,
        stoppedSeconds: summary.stoppedSeconds,
        stopCount: summary.stopCount,
        timeline, alerts,
        // A mapped vehicle that returns no distance is 'unavailable', not 'failed': nothing errored,
        // the provider simply has nothing for that window, and retrying will not change it.
        status: providerKm === null ? 'unavailable' : 'reconciled',
        detail: providerKm === null
          ? 'LocoNav returned no distance for this window — the unit was offline, or the history has been pruned.'
          : odometerDropped
            ? 'The odometer difference is out of range — the reading looks mistyped, so only the GPS distance is shown.'
            : null,
      })

      if (providerKm === null) result.unavailable += 1
      else result.reconciled += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.failed += 1
      result.failedPassNos.push(c.passNo)
      // The raw provider text stays here, server-side, and goes no further.
      console.error('[loconav] trip reconcile failed', c.passNo, message)
      result.errors.push(`${c.passNo}: ${classifyProviderFailure(message)}`)
      /*
       * Record the failure so `attempts` advances — otherwise a pass the provider can never answer
       * would be picked up by every single sweep for ever. Never let the bookkeeping write itself
       * throw and abandon the rest of the batch.
       */
      await writeTripFailure({
        gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: uuid,
        windowStart: c.gateOutAt, windowEnd: c.gateInAt,
        detail: classifyProviderFailure(message),
      }).catch((e) => {
        // Swallowed so one bad row cannot abandon the batch — but never silently.
        console.error('[loconav] could not record the trip failure for', c.passNo, e)
        result.errors.push(`${c.passNo}: the failure could not be recorded.`)
      })
    }
  }

  return result
}

export type GatePassTrip = {
  passNo: string
  status: 'reconciled' | 'untracked' | 'unavailable' | 'failed'
  detail: string | null
  providerDistanceKm: number | null
  odometerDistanceKm: number | null
  deltaKm: number | null
  discrepancy: boolean
  maxSegmentAverageSpeedKph: number | null
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  alertCount: number
  alerts: LoconavAlert[]
  timeline: LoconavTimelineSegment[]
  windowStart: Date | null
  windowEnd: Date | null
  reconciledAt: Date | null
}

/**
 * The reconciliation for one pass, for the detail screen. Postgres only — never calls the provider.
 *
 * ⚠️ Returns null when 0058 has not been applied rather than throwing, for the same reason
 * lib/loconav/positions.ts probes: this is read on a page path, and a missing table must not take
 * the pass detail down with it.
 */
export async function getTripForPass(gatePassId: string): Promise<GatePassTrip | null> {
  try {
    const [row] = await db
      .select()
      .from(demoGatePassTrips)
      .where(eq(demoGatePassTrips.gatePassId, gatePassId))
      .limit(1)
    if (!row) return null

    const providerKm = num(row.providerDistanceKm)
    const odometerKm = num(row.odometerDistanceKm)
    return {
      passNo: row.passNo,
      status: row.status as GatePassTrip['status'],
      detail: row.detail,
      providerDistanceKm: providerKm,
      odometerDistanceKm: odometerKm,
      deltaKm: num(row.deltaKm),
      discrepancy: isTripDiscrepancy(providerKm, odometerKm),
      maxSegmentAverageSpeedKph: num(row.maxSpeedKph),
      movingSeconds: row.movingSeconds,
      stoppedSeconds: row.stoppedSeconds,
      stopCount: row.stopCount,
      alertCount: row.alertCount,
      alerts: (row.alerts ?? []) as LoconavAlert[],
      timeline: (row.timeline ?? []) as LoconavTimelineSegment[],
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      reconciledAt: row.reconciledAt,
    }
  } catch (error) {
    console.error('[loconav] trip read failed (is migration 0058 applied?):', error)
    return null
  }
}
