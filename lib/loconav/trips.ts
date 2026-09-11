import 'server-only'

import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses, demoGatePassTrips, demoVehicleTrackers } from '@/lib/db/schema'
import {
  fetchAlerts,
  fetchDistanceTravelled,
  fetchTimeline,
  getLoconavRateLimitHint,
  isLoconavConfigured,
  isLoconavRateLimited,
  LoconavHttpError,
  type LoconavAlert,
  type LoconavTimelineSegment,
} from './client'
import { dedupeAlertsById, sliceCount, sliceWindow, summariseSegments } from './timeline'

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
 * The longest drive whose route is fetched, counted in one-day slices (sliceWindow in ./timeline).
 *
 * ⚠️ `/timeline` and `/alerts` refuse any window over 86,400 s, so a route costs TWO calls per day on
 * top of the distance. Three days is already 7 calls — a third of the account's 20-request window
 * spent on ONE pass. A longer drive is summarised by its distance alone, which is one call for a week.
 */
export const TRIP_MAX_SLICES = 3

/**
 * Provider calls one sweep may issue: 1 + 2 × slices per pass, or 1 when the route is not fetched.
 *
 * ⚠️ The account allows 20 requests per window (measured 2026-09-11), and the position poll in the
 * same request has already spent two of them (one vehicle page, one last_known). A sweep that still
 * overruns the window gets a 429, which DEFERS the pass rather than failing it. An untracked pass
 * makes no call, so it never counts against this and is never held back by it.
 */
export const TRIP_CALL_BUDGET = 12
/**
 * The client's `x-rate-limit-remaining` count is believed for this long. Older than that it may
 * describe a window that has already reset, and a stale "0 left" must not stall the sweep.
 */
export const TRIP_RATE_HINT_MAX_AGE_MS = 60_000
/** Requests left in reserve beyond a pass's own calls — the count is per instance, never exact. */
export const TRIP_RATE_HINT_HEADROOM = 2

/**
 * ⚠️ A TIGHTER REQUEST POLICY THAN THE POSITION POLL, AND THE WHOLE SWEEP DEPENDS ON IT.
 *
 * The client's default is 4 attempts x 20s plus backoff = ~89s for ONE call. Five passes at that
 * budget is ~445s against a route limit of 120s: Vercel kills the instance, no row is written, the
 * retry budget never advances, and the SAME oldest pass is selected again on every tick for ever
 * while newer ones are never reached. This is backfill of a drive that already finished — there is
 * nothing time-critical to protect with four attempts.
 *
 * 2 x 8s + 1.5s backoff = ~17.5s worst case for any one call.
 */
export const TRIP_REQUEST_POLICY = { attempts: 2, timeoutMs: 8_000 } as const
/**
 * Worst case for one pass: its slowest provider call, plus room for the DB writes.
 *
 * ⚠️ True ONLY because every call of a pass starts at once — up to 1 + 2 × TRIP_MAX_SLICES = 7 — so
 * the pass lasts as long as its slowest call, not the sum of them. Fetching the slices one after
 * another would make a three-day pass 7 × 17.5s and walk straight through the request deadline.
 */
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
  /**
   * Candidates left for the next run with no row written and no attempt spent: the request deadline
   * was near, the call budget was spent, or LocoNav's rate limit was reached.
   */
  deferred: number
  /** Provider calls issued — one per call, however many attempts TRIP_REQUEST_POLICY made of it. */
  callsUsed: number
  /**
   * True when provider calls stopped for LocoNav's OWN limit: a 429, or its remaining-requests count
   * said the next pass would not fit. TRIP_CALL_BUDGET running out is not this — that cap is ours.
   */
  rateLimited: boolean
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

/**
 * A provider call's rejection, held as a value.
 *
 * ⚠️ So a pass sees EVERY outcome before it decides anything. Under a plain Promise.all the first
 * rejection wins a race: a 5xx on the distance landing a few ms before a 429 on a timeline slice
 * would spend an attempt on what was really the rate limit — and which one landed first is timing,
 * not logic.
 */
class FailedCall {
  readonly error: unknown
  constructor(error: unknown) {
    this.error = error
  }
}
const failedCall = (error: unknown) => new FailedCall(error)

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
            ${row.windowStart ? row.windowStart.toISOString() : null}::timestamptz, ${row.windowEnd ? row.windowEnd.toISOString() : null}::timestamptz, '[]'::jsonb, 0, '[]'::jsonb,
            'failed', ${row.detail.slice(0, 500)}, 1, now())
    ON CONFLICT (gate_pass_id) DO UPDATE SET
      status     = 'failed',
      detail     = EXCLUDED.detail,
      attempts   = demo_gate_pass_trips.attempts + 1,
      updated_at = now()
    -- ⚠️ Only over a row that can still be retried. Two overlapping runs can both pick a pass that has no row yet,
    -- and a late failure from one must not overwrite the 'reconciled' or 'unavailable' answer the other just wrote.
    WHERE demo_gate_pass_trips.status IN ('failed', 'untracked')`)
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
  /** Stored in max_speed_kph — see the averageSpeed note where the summary is written. */
  maxSegmentAverageSpeedKph: number | null
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
            ${row.windowStart ? row.windowStart.toISOString() : null}::timestamptz, ${row.windowEnd ? row.windowEnd.toISOString() : null}::timestamptz,
            ${money2(row.providerKm)}::numeric, ${money2(row.odometerKm)}::numeric,
            ${money2(delta)}::numeric, ${money2(row.maxSegmentAverageSpeedKph)}::numeric,
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
    callsUsed: 0,
    rateLimited: false,
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
        /*
         * ⚠️ ISO STRING, NEVER A Date, in a raw sql`` template — here and in both writers above. The
         * drizzle postgres-js driver installs pass-through serializers for timestamp types, so a Date
         * reaches the wire untouched and postgres throws ERR_INVALID_ARG_TYPE ("Received an instance of
         * Date"). A column-bound helper like gte(col, date) maps it; a bare ${date} does not. This sweep
         * never ran until LOCO_AUTH_TOKEN was set on 2026-09-11, and the first live run died right here —
         * in production the route's catch would have hidden it behind "positions were still updated".
         */
        sql`${demoGatePasses.gateInAt} >= ${since.toISOString()}::timestamptz`,
        or(
          isNull(demoGatePassTrips.gatePassId),
          and(
            eq(demoGatePassTrips.status, 'failed'),
            sql`${demoGatePassTrips.attempts} < ${TRIP_MAX_ATTEMPTS}`,
            /*
             * ⚠️ Backoff. writeTrip stamps updated_at on every attempt, so an overlapping run cannot
             * re-charge a pass that ALREADY HAS the row the first run just wrote. It does not guard a
             * pass with no row yet: two runs that overlap — two presses at once, a Sync now just before
             * a cron tick (the cron is never refused), or the Vercel cron plus
             * scripts/loconav-sync-scheduler.mjs — can both pick that pass and both call the provider;
             * writeTripFailure then refuses to overwrite a row the other run finished.
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

  /*
   * Set once provider calls must stop for this run: the call budget is spent, or the rate limit is
   * reached.
   *
   * ⚠️ It stops the CALLS, not the loop. A pass with no tracker costs nothing to record, so it is
   * still written — otherwise a batch whose oldest passes keep deferring would hold back the ones
   * that never needed the provider at all.
   */
  let providerStopped = false

  for (const [index, c] of (candidates as Candidate[]).entries()) {
    /*
     * ⚠️ Stop BEFORE starting a pass we cannot finish, not after overrunning. The deadline comes from
     * the request, not from this function's own start, because runLoconavSync has already spent an
     * unknown amount of the budget by the time we get here. Deferring is free: the pass has no row,
     * so the next tick simply selects it again.
     */
    if (opts.deadlineMs !== undefined && Date.now() + WORST_CASE_PASS_MS > opts.deadlineMs) {
      // This pass and every one after it. Passes deferred earlier in the loop were counted as they went.
      result.deferred += candidates.length - index
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
        providerKm: null, odometerKm, maxSegmentAverageSpeedKph: null,
        movingSeconds: null, stoppedSeconds: null, stopCount: null,
        timeline: [], alerts: [],
        status: 'untracked',
        detail: 'No LocoNav vehicle is mapped to this VIN — the car has no tracker, or the mapping has not resolved.',
      })
      result.untracked += 1
      continue
    }

    const start = c.gateOutAt!
    const end = c.gateInAt!
    const slices = sliceCount(start, end)
    /*
     * A window that does not move forward has nothing to ask about, and no slice to ask with — its
     * route would come back [] and read as a drive with no stops. Terminal and free: no call can
     * answer it, however often it is retried.
     */
    if (slices === 0) {
      await writeTrip({
        gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: uuid,
        windowStart: start, windowEnd: end,
        providerKm: null, odometerKm, maxSegmentAverageSpeedKph: null,
        movingSeconds: null, stoppedSeconds: null, stopCount: null,
        timeline: [], alerts: [],
        status: 'unavailable',
        detail: 'The gate-in time is not after the gate-out time, so there is no drive window to check.',
      })
      result.unavailable += 1
      continue
    }

    const routeSkipped = slices > TRIP_MAX_SLICES
    const routeSlices = routeSkipped ? [] : sliceWindow(start, end)
    // Counted from the slices actually issued below, so the budget cannot drift from the calls made.
    const calls = 1 + 2 * routeSlices.length

    /*
     * ⚠️ Decided BEFORE any call of the pass goes out, so a pass is asked in full or not at all. Half
     * a pass spends the window and still leaves nothing that can be written.
     */
    if (!providerStopped) {
      const hint = getLoconavRateLimitHint()
      const hintIsFresh = hint.atMs !== null && Date.now() - hint.atMs < TRIP_RATE_HINT_MAX_AGE_MS
      if (hintIsFresh && hint.remaining !== null && hint.remaining < calls + TRIP_RATE_HINT_HEADROOM) {
        providerStopped = true
        result.rateLimited = true
      } else if (result.callsUsed + calls > TRIP_CALL_BUDGET) {
        providerStopped = true
      }
    }
    if (providerStopped) {
      // No row and no attempt spent: the next tick selects it again, ahead of anything newer.
      result.deferred += 1
      continue
    }

    try {
      result.callsUsed += calls
      /*
       * Every call of the pass at once — see WORST_CASE_PASS_MS. The distance stays ONE call over the
       * whole window: it is the figure set beside the odometer, and `/distance_travelled` takes a
       * week. The timeline and alerts go one day-slice per call, and come back in slice order.
       *
       * ⚠️ Nothing here may reject. Each call settles to its value or a FailedCall, and the pass
       * decides only once it can see all of them.
       */
      const [distance, timelineParts, alertParts] = await Promise.all([
        fetchDistanceTravelled(uuid, start, end, TRIP_REQUEST_POLICY).catch(failedCall),
        Promise.all(routeSlices.map((s) => fetchTimeline(uuid, s.start, s.end, TRIP_REQUEST_POLICY).catch(failedCall))),
        Promise.all(routeSlices.map((s) => fetchAlerts(uuid, s.start, s.end, TRIP_REQUEST_POLICY).catch(failedCall))),
      ])

      /*
       * ⚠️ A 429 on ANY call defers the whole pass: no row, no attempt, and no more calls this run.
       * Writing what did arrive is worse than writing nothing — 'reconciled' is terminal, so a route
       * lost to the rate limit would stay lost — and a failure row would spend one of the pass's
       * attempts on our own pace rather than on anything wrong with the drive.
       */
      if ([distance, ...timelineParts, ...alertParts].some((r) => r instanceof FailedCall && isLoconavRateLimited(r.error))) {
        providerStopped = true
        result.rateLimited = true
        result.deferred += 1
        continue
      }

      if (distance instanceof FailedCall) {
        const status = distance.error instanceof LoconavHttpError ? distance.error.status : null
        /*
         * ⚠️ Two refusals are ANSWERS, not faults, and are written as terminal 'unavailable' in our
         * own words, never the provider's:
         *   422 — the tracker's LocoNav subscription has expired (measured 2026-09-11). No retry can
         *         renew it.
         *   404 — LocoNav no longer has that vehicle. A link can outlive its tracker on the account
         *         (sync names it in a warning; only a person can unlink it), and retrying every
         *         quarter hour would only confirm the same absence.
         * A 400 stays a plain 'failed'. It means we built the request wrong, or met a limit nobody has
         * measured on this endpoint — neither says anything about the car, and "No GPS data" would
         * blame the drive for our bug. The retry budget bounds it instead.
         */
        const answer =
          status === 422 ? 'The LocoNav subscription for this tracker has expired, so its drive history is not available.'
          : status === 404 ? 'The tracker is no longer on the LocoNav account.'
          : null
        if (answer === null) throw distance.error
        await writeTrip({
          gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: uuid,
          windowStart: start, windowEnd: end,
          providerKm: null, odometerKm, maxSegmentAverageSpeedKph: null,
          movingSeconds: null, stoppedSeconds: null, stopCount: null,
          timeline: [], alerts: [],
          status: 'unavailable',
          detail: answer,
        })
        result.unavailable += 1
        continue
      }

      /*
       * ⚠️ The route and the alerts may each fail on their own. Before they could, a timeline error
       * threw away a DISTANCE that had already arrived — the single most valuable number here.
       *
       * ⚠️ But every slice or none. A route missing one day summarises to confident, wrong numbers:
       * moving time short by a day, and the rule that the first and last runs are the showroom applied
       * to the wrong ends. A failed route is stored as [], summarises to nulls ("not measured", never
       * zeros), and the detail names what is missing — an empty list must not read as "no stops".
       */
      const routeFailed = timelineParts.some((r) => r instanceof FailedCall)
      const alertsFailed = alertParts.some((r) => r instanceof FailedCall)
      for (const r of [...timelineParts, ...alertParts]) {
        // The raw provider text stays here, server-side, like the failure path below.
        if (r instanceof FailedCall) console.error('[loconav] trip route/alerts call failed', c.passNo, errorText(r.error))
      }
      /*
       * ⚠️ A TIMEOUT OR A 5xx IS RETRIED, NOT FINALISED. 'reconciled' is terminal, so a route or an alert list lost to
       * one slow answer stayed lost for good — the reason a 429 defers above. Until the pass's last attempt the failure
       * goes to the catch below, whose 'failed' row the sweep picks up again after 15 minutes; only the last attempt
       * keeps what did arrive. A 4xx is an answer about the request, and no retry changes it.
       */
      const transient = [...timelineParts, ...alertParts].find(
        (r): r is FailedCall => r instanceof FailedCall && !(r.error instanceof LoconavHttpError && r.error.status < 500),
      )
      if (transient && (c.attempts ?? 0) + 1 < TRIP_MAX_ATTEMPTS) throw transient.error
      const timeline = routeFailed ? [] : timelineParts.flatMap((r) => (r instanceof FailedCall ? [] : r))
      // Neighbouring slices share their boundary instant, so an alert raised on it can arrive twice.
      const alerts = alertsFailed ? [] : dedupeAlertsById(alertParts.flatMap((r) => (r instanceof FailedCall ? [] : r)))

      const summary = summariseSegments(timeline)
      const providerKm = distance.km
      const notes = [
        routeSkipped ? 'Route not fetched: drives longer than 3 days are summarised by distance only.' : null,
        routeFailed ? 'Route unavailable for this window.' : null,
        alertsFailed ? 'Alerts unavailable for this window.' : null,
        odometerDropped
          ? 'The odometer difference is out of range — the reading looks mistyped, so only the GPS distance is shown.'
          : null,
      ].filter((note): note is string => note !== null)

      await writeTrip({
        gatePassId: c.id, passNo: c.passNo, vin, providerVehicleUuid: uuid,
        windowStart: start, windowEnd: end,
        providerKm, odometerKm,
        /*
         * ⚠️ averageSpeed, not a top speed — the timeline does not report one. max_speed_kph holds the
         * highest MOVING-segment average, a floor on the real maximum and never the maximum itself,
         * which is why the read type calls it maxSegmentAverageSpeedKph. A genuine top speed would have
         * to come from overspeed alerts.
         */
        maxSegmentAverageSpeedKph: summary.maxSegmentAverageSpeed,
        movingSeconds: summary.movingSeconds,
        stoppedSeconds: summary.stoppedSeconds,
        stopCount: summary.stopCount,
        timeline, alerts,
        // A mapped vehicle that returns no distance is 'unavailable', not 'failed': nothing errored,
        // the provider simply has nothing for that window, and retrying will not change it.
        status: providerKm === null ? 'unavailable' : 'reconciled',
        detail: providerKm === null
          ? 'LocoNav returned no distance for this window — the unit was offline, or the history has been pruned.'
          : notes.join(' ') || null,
      })

      if (providerKm === null) result.unavailable += 1
      else result.reconciled += 1
    } catch (error) {
      const message = errorText(error)
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
  /**
   * Set when the tracker that measured this drive was linked to the car only after the drive began, so the numbers
   * may describe another car. No provider text and no coordinates: safe for every gate_pass.view user.
   */
  linkedAfterDrive: { linkedAt: string } | null
}

/**
 * When the link that measured a trip row was made — returned only when that was after the drive started.
 *
 * ⚠️ THE PAIR THE ROW WAS MEASURED WITH, NOT THE CAR'S LINK TODAY. Old drives keep being reconciled after a link is
 * made (owner decision, 2026-09-11), and trackers are moved off sold cars onto others, so a link made today says
 * nothing about which car the unit was fitted to on the day. Without this mark a wrong or later link would brand an
 * old drive a discrepancy with nothing on screen to say why.
 *
 * The link time is the latest 'link' event for (vin, provider_vehicle_uuid) no later than the check — a relink after
 * it cannot move the answer. A chassis link writes no event, and nothing before 0060 did, so the tracker row's
 * created_at stands in when it is also no later than the check. Every comparison is made in SQL against the row's own
 * timestamps, so no Date crosses into the query.
 *
 * Advisory: a missing 0060 table or any failed read is null, never an error on the page path.
 */
async function readLinkedAfterDrive(gatePassId: string): Promise<GatePassTrip['linkedAfterDrive']> {
  try {
    const rows = await db.execute<{ linked_at: string | null; after_drive: boolean | null }>(sql`
      SELECT to_char(l.linked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS linked_at,
             l.linked_at > tr.window_start AS after_drive
        FROM demo_gate_pass_trips tr
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            (SELECT max(e.created_at) FROM demo_vehicle_tracker_events e
              WHERE e.action = 'link'
                AND e.provider = tr.provider
                AND upper(btrim(e.vin)) = upper(btrim(tr.vin))
                AND e.provider_vehicle_uuid = tr.provider_vehicle_uuid
                AND e.created_at <= COALESCE(tr.reconciled_at, tr.updated_at)),
            (SELECT max(t.created_at) FROM demo_vehicle_trackers t
              WHERE t.provider = tr.provider
                AND upper(btrim(t.vin)) = upper(btrim(tr.vin))
                AND t.provider_vehicle_uuid = tr.provider_vehicle_uuid
                AND t.created_at <= COALESCE(tr.reconciled_at, tr.updated_at))
          ) AS linked_at
        ) l
       WHERE tr.gate_pass_id = ${gatePassId}::uuid
         AND tr.provider_vehicle_uuid IS NOT NULL
         AND tr.window_start IS NOT NULL`)
    const found = (rows as unknown as { linked_at?: string | null; after_drive?: boolean | null }[])[0]
    if (!found?.after_drive || !found.linked_at) return null
    return { linkedAt: found.linked_at }
  } catch (error) {
    console.error('[loconav] trip link-time read failed (is migration 0060 applied?):', error)
    return null
  }
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
    // In parallel: the link-time read settles to null on its own failure, so it can never reject this one.
    const [[row], linkedAfterDrive] = await Promise.all([
      db
        .select()
        .from(demoGatePassTrips)
        .where(eq(demoGatePassTrips.gatePassId, gatePassId))
        .limit(1),
      readLinkedAfterDrive(gatePassId),
    ])
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
      linkedAfterDrive: row.providerVehicleUuid ? linkedAfterDrive : null,
    }
  } catch (error) {
    console.error('[loconav] trip read failed (is migration 0058 applied?):', error)
    return null
  }
}
