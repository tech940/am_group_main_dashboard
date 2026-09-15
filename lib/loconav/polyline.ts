/**
 * Turning a stored LocoNav timeline segment into points on a map.
 *
 * Pure — no 'server-only', no database, no provider calls — so scripts/verify-loconav.ts can exercise
 * it directly and the browser can import it, exactly like lib/loconav/timeline.ts.
 *
 * ── Measured on the live stored data, 2026-09-15 (116 segments across 8 reconciled drives) ───────
 * Which fields a segment actually carries depends entirely on its movementStatus:
 *
 *     status    n   path  startCoordinates  endCoordinates  startAddress
 *     Moving   40    40         40                40             40
 *     Stopped  43     0          0                43              0
 *     Idling   14     0          0                14              0
 *     Offline  19     0         19                19             19
 *
 * ⚠️ A STOP HAS NO START COORDINATE AND NO ADDRESS — only `endCoordinates`. Reading a stop's place
 * from `startCoordinates` finds nothing and drops every stop off the map. Its location is where it
 * ENDED, which is the same spot: the car did not move.
 *
 * ⚠️ AN OFFLINE STRETCH HAS NO PATH but does have both endpoints. The unit lost signal or power; the
 * car may well have been driving. The two points are known and the road between them is NOT, so it
 * must never be drawn as though it were a route — see `segmentPoints`, which returns the endpoints
 * and leaves it to the caller to draw them as the guess they are.
 *
 * ⚠️ `coordinates` is a "lat,lng" decimal string, and the literal string "NA" occurs in live rows.
 * Every parse is therefore fallible and returns null rather than NaN.
 *
 * Consecutive segments are contiguous in practice: across 108 consecutive pairs the gap between one
 * segment ending and the next beginning was 1-2 s (timestamps arrive in whole seconds), with a single
 * 61 s outlier. So the list reads as one continuous drive without needing to apologise for holes.
 */

export type LatLng = [number, number]

/** J&K plus a wide margin. A decoded point outside this is a decoding error, not a road trip. */
const PLAUSIBLE_LAT = [6, 38] as const
const PLAUSIBLE_LNG = [68, 98] as const

function isPlausible(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= PLAUSIBLE_LAT[0] && lat <= PLAUSIBLE_LAT[1]
    && lng >= PLAUSIBLE_LNG[0] && lng <= PLAUSIBLE_LNG[1]
}

/**
 * Google's encoded-polyline format, which is what `path` holds.
 *
 * ⚠️ Every loop is bounded by the string length. A corrupt path whose last character has the
 * continuation bit set would otherwise read past the end for ever; here it simply ends.
 *
 * ⚠️ Returns [] rather than throwing. This runs on data a third party produced, inside a render —
 * a malformed path must cost the route, never the page.
 */
export function decodePolyline(encoded: string | null | undefined, precision = 5): LatLng[] {
  const src = typeof encoded === 'string' ? encoded : ''
  if (src.length === 0) return []

  const factor = 10 ** precision
  const points: LatLng[] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < src.length) {
    let shift = 0
    let result = 0
    let byte = 0
    do {
      if (index >= src.length) return points
      byte = src.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) return points
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && shift < 32)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0
    result = 0
    do {
      if (index >= src.length) return points
      byte = src.charCodeAt(index++) - 63
      if (byte < 0 || byte > 63) return points
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20 && shift < 32)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    const point: LatLng = [lat / factor, lng / factor]
    if (!isPlausible(point[0], point[1])) return points
    points.push(point)
  }

  return points
}

/**
 * The "lat,lng" string a segment carries, or null.
 *
 * ⚠️ "NA" is a real stored value, not a theoretical one. So is an empty string, and so is a pair
 * whose halves do not parse. All three answer null.
 */
export function parseCoordinatePair(value: string | null | undefined): LatLng | null {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toUpperCase() === 'NA') return null
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lng = Number(parts[1])
  if (!isPlausible(lat, lng)) return null
  return [lat, lng]
}

/** The shape this module needs from a segment — structural, so a stored jsonb row fits as-is. */
export type JourneySegmentLike = {
  movementStatus?: string | null
  path?: string | null
  startCoordinates?: string | null
  endCoordinates?: string | null
}

export type SegmentGeometry = {
  /** Every point of the drawn line, in order. Empty when the segment cannot be placed at all. */
  points: LatLng[]
  /**
   * What the points MEAN.
   *  - 'route'    the provider's own trace of where the vehicle went
   *  - 'straight' two known endpoints with an unknown road between them — draw it as a guess
   *  - 'point'    one known place: a stop, or a stretch with a single usable coordinate
   *  - 'none'     nothing plottable
   */
  kind: 'route' | 'straight' | 'point' | 'none'
}

/**
 * Where a segment goes on a map, and how honestly it may be drawn.
 *
 * ⚠️ The distinction between 'route' and 'straight' is the whole point of this function. A route is
 * measured; a straight line between an offline stretch's endpoints is an assumption about a road
 * nobody recorded. Rendering both as the same solid line invents a journey.
 */
export function segmentPoints(segment: JourneySegmentLike): SegmentGeometry {
  const route = decodePolyline(segment.path)
  if (route.length >= 2) return { points: route, kind: 'route' }

  const start = parseCoordinatePair(segment.startCoordinates)
  const end = parseCoordinatePair(segment.endCoordinates)

  if (start && end) {
    // Identical endpoints are a place, not a line — a stop that happened to report both.
    if (start[0] === end[0] && start[1] === end[1]) return { points: [start], kind: 'point' }
    return { points: [start, end], kind: 'straight' }
  }
  // A stop carries only its END coordinate, which is the one that matters: it did not move.
  if (end) return { points: [end], kind: 'point' }
  if (start) return { points: [start], kind: 'point' }
  if (route.length === 1) return { points: route, kind: 'point' }
  return { points: [], kind: 'none' }
}

/** Every plottable point of a whole drive, for fitting the map to it. */
export function journeyBounds(segments: JourneySegmentLike[]): LatLng[] {
  const out: LatLng[] = []
  for (const segment of segments) out.push(...segmentPoints(segment).points)
  return out
}
