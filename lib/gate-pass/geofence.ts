/**
 * Where each branch's premises are, so "this car is off-site" can be a fact rather than a guess.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * Nothing in this codebase knew where a dealership physically is. Without that, "out without a gate
 * pass" cannot be answered: a car 8 km away and a car on the forecourt are the same row of numbers.
 *
 * ── Where these coordinates came from (2026-09-15) ───────────────────────────────────────────────
 * Measured, not guessed. Taking every demo car whose LATEST gate pass was `returned` and whose
 * tracker reported AFTER its gate-in — a car that came back is, by definition, parked at its branch —
 * the JK402 cars sat at 32.74114, 74.83259 with a spread of 0.00048° latitude (~53 m) and 0.00043°
 * longitude (~40 m). A cluster that tight is a forecourt.
 *
 * ⚠️ JK501 (Udhampur) IS DELIBERATELY ABSENT. No returned Udhampur car has reported a position since
 * its gate-in, so there is nothing to infer from. An unfenced branch must never be treated as a fence
 * at the origin, or every Udhampur car reads as 3,600 km from home — so `fenceFor` returns null and
 * the caller is required to say "cannot be judged" rather than accuse. Add the coordinates when
 * somebody can supply them and the branch starts being checked automatically.
 *
 * ⚠️ These are DEALERSHIP PREMISES, not customer locations. Safe to display and to log.
 */

export type BranchFence = {
  dealerCode: string
  label: string
  latitude: number
  longitude: number
  /**
   * How far from the centre still counts as "on site".
   *
   * 500 m, not 50. The cluster itself is ~50 m across, but a consumer GPS unit parked between
   * buildings drifts further than its own accuracy figure suggests, and a stockyard is not the
   * showroom forecourt. A tight fence turns ordinary drift into a false accusation that somebody has
   * to go and disprove; a loose one misses a car that went to the next street. 500 m errs toward not
   * accusing, which is the right way round for a screen whose output is "this looks unauthorised".
   */
  radiusKm: number
  /** Where the coordinate came from, so a future reader can judge whether to trust it. */
  provenance: string
}

export const BRANCH_FENCES: readonly BranchFence[] = [
  {
    dealerCode: 'JK402',
    label: 'AM Kia Jammu',
    latitude: 32.74114,
    longitude: 74.83259,
    radiusKm: 0.5,
    provenance: 'Median of returned demo cars reporting after gate-in, 2026-09-15 (2 cars, ~50 m spread)',
  },
]

const FENCE_BY_CODE = new Map(BRANCH_FENCES.map((fence) => [fence.dealerCode.toUpperCase(), fence]))

/** The fence for a branch, or null when that branch has none — which is NOT "outside the fence". */
export function fenceFor(dealerCode: string | null | undefined): BranchFence | null {
  const code = String(dealerCode ?? '').trim().toUpperCase()
  if (!code) return null
  return FENCE_BY_CODE.get(code) ?? null
}

/** Great-circle kilometres. Good to a few metres at these distances, which is far below the fence. */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export type FenceVerdict =
  /** Reported inside its branch fence. */
  | { state: 'on_site'; distanceKm: number; fence: BranchFence }
  /** Reported outside it. The distance is how far. */
  | { state: 'off_site'; distanceKm: number; fence: BranchFence }
  /** No fence for this branch, or no position — the question cannot be answered. */
  | { state: 'unknown'; distanceKm: null; fence: BranchFence | null; reason: string }

/**
 * Is this car on its branch's premises?
 *
 * ⚠️ Returns 'unknown' rather than guessing, in all three cases that deserve it: the branch has no
 * fence, the car has no tracker, or the tracker has never reported. Each is a different sentence on
 * screen, and none of them is 'off_site'.
 */
export function judgePosition(params: {
  dealerCode: string | null | undefined
  latitude: number | null | undefined
  longitude: number | null | undefined
}): FenceVerdict {
  const fence = fenceFor(params.dealerCode)
  if (!fence) {
    return {
      state: 'unknown',
      distanceKm: null,
      fence: null,
      reason: `No geofence is configured for ${String(params.dealerCode || 'this branch')}, so its cars cannot be judged.`,
    }
  }
  if (typeof params.latitude !== 'number' || typeof params.longitude !== 'number') {
    return { state: 'unknown', distanceKm: null, fence, reason: 'This car has never reported a position.' }
  }
  const km = distanceKm(fence, { latitude: params.latitude, longitude: params.longitude })
  return km <= fence.radiusKm
    ? { state: 'on_site', distanceKm: km, fence }
    : { state: 'off_site', distanceKm: km, fence }
}
