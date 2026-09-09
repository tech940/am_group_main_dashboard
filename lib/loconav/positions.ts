import 'server-only'

import { inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoVehiclePositions, demoVehicleTrackers } from '@/lib/db/schema'
import { isLoconavConfigured } from './client'

/**
 * What the UI reads. Postgres only — this file never touches LocoNav.
 *
 * ⚠️ The whole point of the split: a page render must not depend on a third-party fleet API being
 * up or fast. lib/loconav/client.ts is for the sync job; this is for everything else.
 */

/**
 * How old a fix may be before it stops counting as "live".
 *
 * ⚠️ A stationary vehicle's unit sleeps, so a parked car legitimately reports a fix from hours ago.
 * Rendering that as a current position is the single most misleading thing a tracking UI can do —
 * it shows a car sitting at a customer's house when it may have left long since. Ten minutes is
 * deliberately tight: better to say "last seen 40 minutes ago" than to imply live.
 */
export const POSITION_LIVE_WINDOW_MS = 10 * 60 * 1000

/** Why a vehicle has no live position. Each value means something different to the person looking. */
export type TrackingState =
  /** A fix we are willing to call current. */
  | 'live'
  /** We have a fix, but it is older than the live window. `ageMs` says how old. */
  | 'stale'
  /** Mapped to a provider vehicle, but no position has ever been stored. */
  | 'no_fix'
  /** No provider vehicle is mapped to this VIN — no device, or the mapping has not resolved. */
  | 'untracked'
  /** LOCONAV_API_TOKEN is not set. Nothing is tracked, and that is a configuration fact, not a fault. */
  | 'not_configured'

export type VehiclePosition = {
  vin: string
  state: TrackingState
  latitude: number | null
  longitude: number | null
  speedKph: number | null
  ignition: string | null
  address: string | null
  positionAt: Date | null
  /** Age of the FIX at read time, in ms. Null when there is no fix. Render this, always. */
  ageMs: number | null
  providerVehicleUuid: string | null
  subscriptionExpiresAt: Date | null
  /** True when the provider says the subscription for this vehicle has lapsed — it will go dark. */
  subscriptionExpired: boolean
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * ⚠️ THE ORDERING HAZARD THIS EXISTS FOR. Migration 0057 is applied BY HAND on the direct port. If
 * anyone sets LOCONAV_API_TOKEN in Vercel before running it — the natural order, since the env var
 * is the visible step — then every SELECT below hits a table that does not exist, Postgres raises
 * 42P01, and the failure is not scoped to tracking: it takes down the ENTIRE fleet board, because
 * getFleetStatus awaits this. That exact class of bug (naming a column added by an unapplied
 * migration) has already taken the approvals list down in this repo; see
 * lib/approvals/request-number.ts, which probes for the same reason.
 *
 * Cached once true — a table is not dropped in normal operation — so the steady-state cost is zero.
 * While false it re-probes, so applying the migration takes effect without a redeploy.
 */
let trackingTablesReady = false
async function tablesReady(): Promise<boolean> {
  if (trackingTablesReady) return true
  try {
    const rows = await db.execute<{ ready: boolean }>(sql`
      SELECT (to_regclass('public.demo_vehicle_trackers') IS NOT NULL
          AND to_regclass('public.demo_vehicle_positions') IS NOT NULL) AS ready`)
    const ready = Boolean((rows as unknown as { ready?: boolean }[])[0]?.ready)
    if (ready) trackingTablesReady = true
    return ready
  } catch {
    // A probe that cannot run must not be the thing that breaks the page.
    return false
  }
}

/**
 * Positions for a set of VINs, keyed by upper-trimmed VIN.
 *
 * Every requested VIN gets an entry — a caller must never have to distinguish "absent from the map"
 * from "untracked", because that distinction is exactly where a UI starts rendering a blank space
 * that reads as "not moving".
 */
export async function getPositionsForVins(
  vins: string[],
  now: Date = new Date(),
): Promise<Map<string, VehiclePosition>> {
  const keys = [...new Set(vins.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean))]
  const out = new Map<string, VehiclePosition>()

  const blank = (vin: string, state: TrackingState): VehiclePosition => ({
    vin,
    state,
    latitude: null,
    longitude: null,
    speedKph: null,
    ignition: null,
    address: null,
    positionAt: null,
    ageMs: null,
    providerVehicleUuid: null,
    subscriptionExpiresAt: null,
    subscriptionExpired: false,
  })

  if (!keys.length) return out

  // Unconfigured is reported once, uniformly, rather than looking like 29 untracked cars.
  if (!isLoconavConfigured()) {
    for (const vin of keys) out.set(vin, blank(vin, 'not_configured'))
    return out
  }

  /*
   * Token set but 0057 not applied. Same outward answer as unconfigured — tracking is not
   * operational either way, and the label reads correctly — but say so loudly in the server log,
   * because this one is a half-finished deploy that somebody needs to finish.
   */
  if (!(await tablesReady())) {
    console.warn(
      '[loconav] LOCONAV_API_TOKEN is set but migration 0057 has not been applied — ' +
        'demo_vehicle_trackers / demo_vehicle_positions are missing. Tracking is reporting as not configured.',
    )
    for (const vin of keys) out.set(vin, blank(vin, 'not_configured'))
    return out
  }

  for (const vin of keys) out.set(vin, blank(vin, 'untracked'))

  /*
   * ⚠️ Wrapped. The readiness latch above only ever flips false -> true, so it cannot help if the
   * tables are dropped, renamed, or a rollback is run while the process is warm — and this function
   * is awaited by getFleetStatus, so ANY throw here takes the whole fleet board down, not just the
   * tracking column. Tracking is an enhancement; it must never be the thing that breaks the page.
   */
  let trackers: { vin: string; providerVehicleUuid: string; subscriptionExpiresAt: Date | null }[]
  let positions: {
    vin: string
    latitude: string | null
    longitude: string | null
    speedKph: string | null
    ignition: string | null
    address: string | null
    positionAt: Date | null
  }[]
  try {
    ;[trackers, positions] = await Promise.all([
      db
        .select({
          vin: demoVehicleTrackers.vin,
          providerVehicleUuid: demoVehicleTrackers.providerVehicleUuid,
          subscriptionExpiresAt: demoVehicleTrackers.subscriptionExpiresAt,
        })
        .from(demoVehicleTrackers)
        .where(inArray(demoVehicleTrackers.vin, keys)),
      db
        .select({
          vin: demoVehiclePositions.vin,
          latitude: demoVehiclePositions.latitude,
          longitude: demoVehiclePositions.longitude,
          speedKph: demoVehiclePositions.speedKph,
          ignition: demoVehiclePositions.ignition,
          address: demoVehiclePositions.address,
          positionAt: demoVehiclePositions.positionAt,
        })
        .from(demoVehiclePositions)
        .where(inArray(demoVehiclePositions.vin, keys)),
    ])
  } catch (error) {
    // Re-arm the probe so a transient fault does not pin the latch true against missing tables.
    trackingTablesReady = false
    console.error('[loconav] position read failed; fleet will render untracked:', error)
    return out
  }

  const positionByVin = new Map(positions.map((p) => [p.vin, p]))

  for (const t of trackers) {
    const entry = out.get(t.vin)
    if (!entry) continue
    entry.providerVehicleUuid = t.providerVehicleUuid
    entry.subscriptionExpiresAt = t.subscriptionExpiresAt
    entry.subscriptionExpired = Boolean(
      t.subscriptionExpiresAt && t.subscriptionExpiresAt.getTime() < now.getTime(),
    )

    const p = positionByVin.get(t.vin)
    /*
     * ⚠️ Coordinates required, not just a timestamp. A row can legitimately carry fetched_at with
     * NULL coordinates — the sync writes exactly that when the provider answers with no usable fix —
     * and a half-populated position renders as a pin at longitude 0, in the Gulf of Guinea. Last
     * line of defence for any future writer, too.
     */
    if (!p || !p.positionAt || p.latitude === null || p.longitude === null) {
      entry.state = 'no_fix'
      continue
    }
    const ageMs = now.getTime() - p.positionAt.getTime()
    entry.latitude = numOrNull(p.latitude)
    entry.longitude = numOrNull(p.longitude)
    entry.speedKph = numOrNull(p.speedKph)
    entry.ignition = p.ignition
    entry.address = p.address
    entry.positionAt = p.positionAt
    entry.ageMs = ageMs
    entry.state = ageMs <= POSITION_LIVE_WINDOW_MS ? 'live' : 'stale'
  }

  return out
}

/** Human label for a tracking state — one definition, so the UI and any export cannot disagree. */
export function trackingStateLabel(state: TrackingState): string {
  switch (state) {
    case 'live': return 'Live'
    case 'stale': return 'Last seen'
    case 'no_fix': return 'No fix yet'
    case 'untracked': return 'No tracker'
    case 'not_configured': return 'Tracking not set up'
  }
}
