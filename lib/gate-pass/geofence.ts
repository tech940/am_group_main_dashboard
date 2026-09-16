/**
 * Where each branch's premises are, so "this car is off-site" can be a fact rather than a guess.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * Nothing in this codebase knew where a dealership physically is. Without that, "out without a gate
 * pass" cannot be answered: a car 8 km away and a car on the forecourt are the same row of numbers.
 *
 * ── Where these coordinates came from (2026-09-16) ───────────────────────────────────────────────
 * Measured, not guessed. Clustering every stored fix at the fence radius produces two tight groups
 * for JK402 — 3 cars within 111 m at the showroom, and 4 cars within 96 m eight kilometres away —
 * and a handful of singletons. Cars do not share 100 m of ground for 500 days by accident.
 *
 * ⚠️ AN EARLIER READ OF THIS DATA WAS WRONG and is worth recording. Five cars reported 8.11-8.51 km
 * from the showroom, which looked like a 400 m cluster — but those are distances along DIFFERENT
 * BEARINGS, so the cars were up to 2.6 km apart. Distance-from-a-point is not proximity-to-each-other.
 * Clustering on the actual pairwise distance is what found the real 96 m group.
 *
 * ⚠️ JK501 (Udhampur) IS DELIBERATELY ABSENT. No returned Udhampur car has reported a position since
 * its gate-in, so there is nothing to infer from. An unfenced branch must never be treated as a fence
 * at the origin, or every Udhampur car reads as 3,600 km from home — so `fencesFor` returns [] and
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

/**
 * ⚠️ A BRANCH CAN HAVE SEVERAL SITES, and this list is keyed by site, not by branch. A dealership is
 * a showroom AND a stockyard AND sometimes a workshop; a car parked at the stockyard is at work, not
 * missing. Modelling one fence per dealer code reported five cars as off-site every day, all of them
 * sitting in the same yard 8 km from the showroom.
 */
export const BRANCH_FENCES: readonly BranchFence[] = [
  {
    dealerCode: 'JK402',
    label: 'AM Kia Jammu — showroom',
    latitude: 32.74153,
    longitude: 74.83159,
    radiusKm: 0.5,
    provenance: 'Cluster of 3 demo cars within 111 m, incl. a fix 7 hours old (2026-09-16)',
  },
  {
    /*
     * The second Jammu site. Inferred, not supplied: clustering every stored fix at the fence radius
     * puts FOUR cars inside a 96 m circle here, two of them fixed within the last 15 hours and the
     * spread of ages running to 501 days. Cars do not park in the same 96 m of road for 500 days by
     * accident — this is premises. It is 8.1 km from the showroom, which matches the stockyard the
     * gate register's `parked_location` field keeps naming.
     *
     * ⚠️ STILL AN INFERENCE. If it is wrong, cars that ARE missing will read as parked — the failure
     * direction that hides a problem rather than inventing one. Worth confirming with somebody who
     * knows the site, and correcting here if the coordinates are off.
     */
    dealerCode: 'JK402',
    label: 'AM Kia Jammu — stockyard (inferred)',
    latitude: 32.67441,
    longitude: 74.86888,
    radiusKm: 0.5,
    provenance: 'Cluster of 4 demo cars within 96 m across 501 days of fixes (2026-09-16) — INFERRED, unconfirmed',
  },
]

const FENCES_BY_CODE = new Map<string, BranchFence[]>()
for (const fence of BRANCH_FENCES) {
  const code = fence.dealerCode.toUpperCase()
  FENCES_BY_CODE.set(code, [...(FENCES_BY_CODE.get(code) ?? []), fence])
}

/** Every site belonging to a branch. Empty means the branch has none — which is NOT "outside". */
export function fencesFor(dealerCode: string | null | undefined): BranchFence[] {
  const code = String(dealerCode ?? '').trim().toUpperCase()
  if (!code) return []
  return FENCES_BY_CODE.get(code) ?? []
}

/** The branch's primary site, for messages that need to name one place. */
export function fenceFor(dealerCode: string | null | undefined): BranchFence | null {
  return fencesFor(dealerCode)[0] ?? null
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
  const fences = fencesFor(params.dealerCode)
  if (fences.length === 0) {
    return {
      state: 'unknown',
      distanceKm: null,
      fence: null,
      reason: `No geofence is configured for ${String(params.dealerCode || 'this branch')}, so its cars cannot be judged.`,
    }
  }
  if (typeof params.latitude !== 'number' || typeof params.longitude !== 'number') {
    return { state: 'unknown', distanceKm: null, fence: fences[0], reason: 'This car has never reported a position.' }
  }

  /*
   * ⚠️ NEAREST site wins, and being inside ANY of them is on-site. A car at the stockyard is at work;
   * measuring it against the showroom alone would report it 8 km adrift every single day.
   */
  const position = { latitude: params.latitude, longitude: params.longitude }
  let nearest = fences[0]
  let nearestKm = distanceKm(nearest, position)
  for (const fence of fences.slice(1)) {
    const km = distanceKm(fence, position)
    if (km < nearestKm) { nearest = fence; nearestKm = km }
  }

  return nearestKm <= nearest.radiusKm
    ? { state: 'on_site', distanceKm: nearestKm, fence: nearest }
    : { state: 'off_site', distanceKm: nearestKm, fence: nearest }
}
