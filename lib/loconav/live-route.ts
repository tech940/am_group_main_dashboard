import 'server-only'

import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses, demoVehicleTrackers } from '@/lib/db/schema'
import { getCachedData } from '@/lib/redis/cache-utils'
import {
  fetchTimeline,
  isLoconavConfigured,
  isLoconavRateLimited,
  type LoconavTimelineSegment,
} from './client'
import { sliceCount, sliceWindow, summariseSegments } from './timeline'

/**
 * The route so far for a car that is STILL OUT — gate-out to this moment.
 *
 * ── Why this exists separately from trips.ts ─────────────────────────────────────────────────────
 * The reconciliation sweep deliberately runs only on passes that have RETURNED: it compares the
 * provider's distance against the odometer a guard typed at gate-in, and there is no gate-in yet. So
 * an active trip showed "GPS distance: not checked" and no route at all, which is precisely when
 * somebody wants to know where the car is.
 *
 * This answers the other question — not "was the odometer honest" but "where has it been since it
 * left, and where is it now".
 *
 * ── The rules this has to live inside ────────────────────────────────────────────────────────────
 * ⚠️ NEVER ON A RENDER PATH. The one mature third-party precedent in this repo (lib/callyzer) exists
 * because calling a provider live from a render hung the page. This is reached only from its own
 * route, which the client calls after the page is up.
 *
 * ⚠️ THE ACCOUNT ALLOWS 20 REQUESTS PER WINDOW, shared with the position poll and the trip sweep. A
 * route costs one call per day of the drive, so the answer is cached for two minutes: opening the
 * same pass repeatedly, or two people watching the same car, costs one call rather than dozens.
 *
 * ⚠️ ALERTS ARE NOT FETCHED. The sweep asks for them because a finished drive is reviewed once; here
 * they would double the call cost of a screen somebody may leave open. The route is the point.
 */

/** Matches TRIP_MAX_SLICES in trips.ts: beyond three days a route is not worth 3+ calls. */
const MAX_SLICES = 3
const CACHE_TTL_SECONDS = 120

export type LiveRouteStatus =
  | 'ok'
  | 'not_out'        // the pass is not currently gated out
  | 'untracked'      // no LocoNav vehicle is linked to this car
  | 'not_configured' // LOCO_AUTH_TOKEN is not set on the server
  | 'too_long'       // out for longer than the route window
  | 'rate_limited'   // the provider's budget is spent; try again shortly
  | 'unavailable'    // the provider had nothing, or refused

export type LiveRoute = {
  status: LiveRouteStatus
  /** Said in our own words, never the provider's. Null when there is nothing to explain. */
  detail: string | null
  segments: LoconavTimelineSegment[]
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  windowStart: string | null
  /** When this answer was built — the screen must show it, since it is already seconds old. */
  asOf: string
}

const empty = (status: LiveRouteStatus, detail: string | null, windowStart: Date | null = null): LiveRoute => ({
  status,
  detail,
  segments: [],
  movingSeconds: null,
  stoppedSeconds: null,
  stopCount: null,
  windowStart: windowStart ? windowStart.toISOString() : null,
  asOf: new Date().toISOString(),
})

export async function getLiveRoute(gatePassId: string): Promise<LiveRoute> {
  const [pass] = await db
    .select({
      status: demoGatePasses.status,
      vin: demoGatePasses.vin,
      gateOutAt: demoGatePasses.gateOutAt,
    })
    .from(demoGatePasses)
    .where(eq(demoGatePasses.id, gatePassId))
    .limit(1)

  if (!pass) return empty('not_out', 'This gate pass no longer exists.')
  if (pass.status !== 'out' || !pass.gateOutAt) {
    return empty('not_out', 'This car is not out on the road, so there is no live route to follow.')
  }
  if (!isLoconavConfigured()) {
    return empty('not_configured', 'Live tracking is not connected on the server.', pass.gateOutAt)
  }

  const [tracker] = await db
    .select({ uuid: demoVehicleTrackers.providerVehicleUuid })
    .from(demoVehicleTrackers)
    .where(and(
      eq(demoVehicleTrackers.vin, pass.vin.trim().toUpperCase()),
    ))
    .limit(1)

  if (!tracker?.uuid) {
    return empty('untracked', 'No tracker is linked to this car, so its route cannot be followed.', pass.gateOutAt)
  }

  const start = pass.gateOutAt
  const end = new Date()
  const slices = sliceCount(start, end)
  if (slices === 0) {
    return empty('unavailable', 'The car left moments ago — there is no route yet.', start)
  }
  if (slices > MAX_SLICES) {
    return empty(
      'too_long',
      `This car has been out for more than ${MAX_SLICES} days. A route that long is not fetched — `
      + 'the live position on the fleet map is the better answer for it.',
      start,
    )
  }

  /*
   * ⚠️ Keyed on the pass AND the minute. The window ends at "now", so a key without time would serve
   * a two-minute-old route for ever; including the minute lets the cache absorb a burst of viewers
   * while still moving forward.
   */
  const cacheKey = `gate-pass:live-route:v1:${gatePassId}:${Math.floor(end.getTime() / 60_000)}`

  return getCachedData<LiveRoute>(cacheKey, async () => {
    try {
      const parts = await Promise.all(
        sliceWindow(start, end).map((slice) => fetchTimeline(tracker.uuid as string, slice.start, slice.end)),
      )
      /* Slices come back in order and are contiguous, so concatenating rebuilds the drive. */
      const segments = parts.flat()
      if (segments.length === 0) {
        return empty('unavailable', 'The tracker has reported nothing since the car left.', start)
      }

      const summary = summariseSegments(segments)
      return {
        status: 'ok' as const,
        detail: null,
        segments,
        movingSeconds: summary.movingSeconds,
        stoppedSeconds: summary.stoppedSeconds,
        stopCount: summary.stopCount,
        windowStart: start.toISOString(),
        asOf: new Date().toISOString(),
      }
    } catch (error) {
      /*
       * ⚠️ A rate limit is a "come back shortly", not a failure of the drive — and it must be said as
       * such, or somebody reads an empty map as "the car has not moved".
       */
      if (isLoconavRateLimited(error)) {
        return empty('rate_limited', 'The tracking provider is busy. Try again in a minute.', start)
      }
      console.error('[loconav] live route failed:', error)
      return empty('unavailable', 'The route could not be fetched just now.', start)
    }
  }, CACHE_TTL_SECONDS)
}
