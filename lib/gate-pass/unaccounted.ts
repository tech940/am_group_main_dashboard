import 'server-only'

import { getFleetStatus } from './fleet'
import { judgePosition, type BranchFence, BRANCH_FENCES } from './geofence'

/**
 * Demo cars that are off the premises with NO gate pass authorising it.
 *
 * ── What this screen can and cannot prove ────────────────────────────────────────────────────────
 * It compares two things: the branch geofence (lib/gate-pass/geofence.ts) and whether the car has an
 * open pass. Both halves have limits that MUST reach the screen rather than be smoothed over:
 *
 * ⚠️ A POSITION IS A LAST REPORT, NOT A LOCATION. Measured 2026-09-15: of ~29 demo cars only 10 have
 * ever reported, and only 2 of those fixes were under an hour old. A car parked at a customer's house
 * five months ago is indistinguishable, in this table, from one parked there now — unless you read
 * the age. So every row carries `ageMs` and the caller is expected to show it, and `confidence` says
 * outright how much the row is worth.
 *
 * ⚠️ NO TRACKER MEANS NO ANSWER, NOT "FINE". About two thirds of the fleet has no position at all.
 * Those cars are returned in `unknowable` rather than dropped: a screen that silently omits them
 * reads as "everything else is accounted for", which is the opposite of the truth.
 *
 * ⚠️ NO FENCE MEANS NO ANSWER EITHER. JK501 has no geofence, so its cars land in `unknowable` too,
 * with a reason naming the missing configuration.
 */

export type UnaccountedConfidence = 'live' | 'recent' | 'stale'

export type UnaccountedVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  branchLabel: string
  dealerCode: string | null
  /** How far outside its fence the car last reported. */
  distanceKm: number
  /** Where it last reported, in words, when the provider gave one. */
  address: string | null
  positionAt: string | null
  ageMs: number | null
  speedKph: number | null
  ignition: string | null
  /**
   * How much the row is worth.
   *  - 'live'   the fix is inside the tracker's live window — act on this
   *  - 'recent' within the day — worth a phone call
   *  - 'stale'  older than a day — a historical note, NOT evidence the car is out now
   */
  confidence: UnaccountedConfidence
  /** True when the engine was on at the last report — the strongest signal available. */
  engineOn: boolean
}

export type UnknowableVehicle = {
  vin: string
  registrationNumber: string | null
  model: string | null
  branchLabel: string
  dealerCode: string | null
  /** Why this car cannot be judged, in the words the screen should use. */
  reason: string
}

export type UnaccountedReport = {
  /** Off-site, no open pass. Ordered by how much the evidence is worth, then by distance. */
  offSite: UnaccountedVehicle[]
  /** Cannot be judged: no tracker, or no fence for the branch. */
  unknowable: UnknowableVehicle[]
  /** On-site or legitimately out on a pass — the count only, so the screen can say "N accounted for". */
  accountedFor: number
  /** Which branches are actually being checked, so the screen can name the gaps. */
  fences: readonly BranchFence[]
  /** Branch codes present in the fleet that have NO fence. */
  unfencedBranches: string[]
}

const LIVE_MS = 10 * 60 * 1000
const RECENT_MS = 24 * 60 * 60 * 1000

function confidenceOf(ageMs: number | null): UnaccountedConfidence {
  if (ageMs === null) return 'stale'
  if (ageMs <= LIVE_MS) return 'live'
  if (ageMs <= RECENT_MS) return 'recent'
  return 'stale'
}

const CONFIDENCE_RANK: Record<UnaccountedConfidence, number> = { live: 0, recent: 1, stale: 2 }

/**
 * @param dealerCodes the caller's branch scope, exactly as the fleet board uses it
 */
export async function getUnaccountedVehicles(dealerCodes: string[]): Promise<UnaccountedReport> {
  const fleet = await getFleetStatus(dealerCodes)

  const offSite: UnaccountedVehicle[] = []
  const unknowable: UnknowableVehicle[] = []
  let accountedFor = 0
  const unfenced = new Set<string>()

  for (const vehicle of fleet.vehicles) {
    /*
     * ⚠️ `state` already encodes the pass: 'out' is gated out, 'reserved' is approved and waiting.
     * Both are authorised, so neither can be unaccounted for however far away it is — that is the
     * whole point of the comparison. Only 'available' cars can be a surprise.
     */
    if (vehicle.state !== 'available') {
      accountedFor += 1
      continue
    }

    const verdict = judgePosition({
      dealerCode: vehicle.dealerCode,
      latitude: vehicle.tracking.latitude,
      longitude: vehicle.tracking.longitude,
    })

    if (verdict.state === 'unknown') {
      if (!verdict.fence && vehicle.dealerCode) unfenced.add(vehicle.dealerCode)
      unknowable.push({
        vin: vehicle.vin,
        registrationNumber: vehicle.registrationNumber,
        model: vehicle.model,
        branchLabel: vehicle.branchLabel,
        dealerCode: vehicle.dealerCode ?? null,
        reason: verdict.reason,
      })
      continue
    }

    if (verdict.state === 'on_site') {
      accountedFor += 1
      continue
    }

    const ageMs = vehicle.tracking.ageMs
    const ignition = vehicle.tracking.ignition ?? null
    offSite.push({
      vin: vehicle.vin,
      registrationNumber: vehicle.registrationNumber,
      model: vehicle.model,
      variant: vehicle.variant ?? null,
      color: vehicle.color,
      branchLabel: vehicle.branchLabel,
      dealerCode: vehicle.dealerCode ?? null,
      distanceKm: Number(verdict.distanceKm.toFixed(2)),
      address: vehicle.tracking.address,
      positionAt: vehicle.tracking.positionAt
        ? new Date(vehicle.tracking.positionAt).toISOString()
        : null,
      ageMs,
      speedKph: vehicle.tracking.speedKph,
      ignition,
      confidence: confidenceOf(ageMs),
      engineOn: String(ignition || '').trim().toUpperCase() === 'ON',
    })
  }

  /*
   * Worth-acting-on first: a live fix outranks a five-month-old one however far away that one is,
   * because distance on a stale fix is not evidence that the car is anywhere in particular now.
   * Within the same confidence, engine on beats engine off, then the furthest car.
   */
  offSite.sort((a, b) =>
    CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
    || Number(b.engineOn) - Number(a.engineOn)
    || b.distanceKm - a.distanceKm)

  return {
    offSite,
    unknowable,
    accountedFor,
    fences: BRANCH_FENCES,
    unfencedBranches: [...unfenced].sort(),
  }
}
