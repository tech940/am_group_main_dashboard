import 'server-only'

/**
 * LocoNav Integration API access.
 *
 * ── The split this file enforces ──────────────────────────────────────────────────────────────
 * Everything here talks to LocoNav and is used ONLY by lib/loconav/sync.ts. Nothing that renders a
 * page may import it. Reads for the UI come out of Postgres via lib/loconav/positions.ts.
 *
 * That is the house doctrine, and it was paid for: lib/callyzer/client.ts:6-16 records that calling
 * a provider live from a page render hung the call-analysis page, because paging ~1.9k rows at
 * ~2.7s/page is ~54s. A fleet poll has the same shape.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────────────────────
 * ⚠️ LocoNav keys vehicles on registration number, device serial, or its own uuid. Our fleet keys
 * on VIN, because a registration number DOES NOT identify a demo car — 29 VINs, 25 plates, and
 * `JK02C0059TC` is a trade-certificate plate on five different vehicles (lib/gate-pass/vehicles.ts).
 * `List Vehicles` returns `chassisNumber`, which IS the VIN, so the mapping is built from that and
 * the plate is never used as a key. `vehicleNumber` is deliberately not exposed as a filter here.
 * ⚠️ On this account that field holds a plate or free text for 17 of 18 vehicles (measured
 * 2026-09-11), so most links are confirmed by a person on the Trackers screen instead.
 *
 * ── Configuration ────────────────────────────────────────────────────────────────────────────
 * LOCO_AUTH_TOKEN — the `User-Authentication` header value. Optional: when it is absent the whole
 * integration reports itself unconfigured and the fleet renders exactly as it did before. It is NOT
 * read at module load, because that would make importing this file fail at build time.
 * LOCONAV_API_BASE — override for the host, for staging or if the vendor moves it.
 *
 * ── Limits measured on the live account (2026-09-11) ─────────────────────────────────────────
 * - 20 requests per window (`x-rate-limit-limit: 20`, `x-rate-limit-remaining`); about twenty quick
 *   calls earn HTTP 429 "TOO MANY REQUESTS", cleared within ~2 minutes.
 * - `/timeline` and `/alerts` refuse windows over 86,400 s (see lib/loconav/timeline.ts).
 * - `/distance_travelled` answers 422 once the vehicle's LocoNav subscription has expired.
 */

/**
 * ⚠️ NOT the host in the public documentation. This account lives on Sensorise's LocoNav deployment
 * (the address the vendor emailed on 2026-09-11); the public `api.a.loconav.com` does not serve it,
 * and the token must never be sent there to find out.
 */
const DEFAULT_BASE = 'https://app.loconav.sensorise.net/integration/api/v1'

export type LoconavVehicle = {
  vehicleUuid: string
  /** The provider's plate. Diagnostics only — never a join key. */
  number: string | null
  displayNumber: string | null
  /** The VIN. This is the only field we are allowed to match on. */
  chassisNumber: string | null
  make: string | null
  model: string | null
  vehicleType: string | null
  deviceSerialNumber: string | null
  deviceType: string | null
  subscriptionExpiresAt: string | null
}

export type LoconavPosition = {
  vehicleUuid: string
  vehicleNumber: string | null
  latitude: number | null
  longitude: number | null
  speedKph: number | null
  ignition: string | null
  address: string | null
  /** Device time, in ms. Null when the provider returned no timestamped fix. */
  positionAtMs: number | null
  raw: Record<string, unknown>
}

export function loconavBase(): string {
  return (process.env.LOCONAV_API_BASE || DEFAULT_BASE).replace(/\/+$/, '')
}

/** True when a token is present. Every caller must branch on this rather than catching a throw. */
export function isLoconavConfigured(): boolean {
  return Boolean(String(process.env.LOCO_AUTH_TOKEN || '').trim())
}

/**
 * Read lazily and THROW when unset — never a module-level const, which would make merely importing
 * this file fail during the build. Mirrors lib/callyzer/client.ts:79-83.
 */
function apiToken(): string {
  const token = String(process.env.LOCO_AUTH_TOKEN || '').trim()
  if (!token) throw new Error('LOCO_AUTH_TOKEN is not configured')
  return token
}

const str = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A response the provider refused. `status` lets a caller decide what the refusal MEANS — a 422 on a
 * history call is an expired subscription, a 429 is "come back later" — without parsing message text.
 * The message keeps the shape `LocoNav <path> failed: HTTP <status> <detail>` that classifyProviderFailure
 * in trips.ts already reads.
 */
export class LoconavHttpError extends Error {
  readonly status: number
  readonly path: string
  constructor(status: number, path: string, message: string) {
    super(message)
    this.name = 'LoconavHttpError'
    this.status = status
    this.path = path
  }
}

/** HTTP 429. Never retried inside a request — see request(). */
export class LoconavRateLimitError extends LoconavHttpError {
  constructor(path: string, message: string) {
    super(429, path, message)
    this.name = 'LoconavRateLimitError'
  }
}

export function isLoconavRateLimited(error: unknown): error is LoconavRateLimitError {
  return error instanceof LoconavRateLimitError || (error instanceof LoconavHttpError && error.status === 429)
}

/**
 * Refusals that another attempt cannot change. 401/403 are credentials; 400 is a request we built wrong
 * (a history window over one day); 404 is a vehicle that is not on the account; 422 is an expired
 * subscription. Retrying any of them only spends the rate limit.
 */
const NON_RETRYABLE_STATUSES = new Set([400, 401, 403, 404, 422])

/**
 * The provider's own count of requests left, as of the latest response this instance saw.
 *
 * Module state, so it is a HINT: per serverless instance, and stale the moment another instance or a
 * manual sync spends a request. A sweep uses it to stop early; it must never be the only guard.
 */
let rateLimitHint: { limit: number | null; remaining: number | null; atMs: number | null } = {
  limit: null,
  remaining: null,
  atMs: null,
}

function recordRateLimit(headers: Headers, status: number) {
  const limit = numOrNull(headers.get('x-rate-limit-limit'))
  const remaining = status === 429 ? 0 : numOrNull(headers.get('x-rate-limit-remaining'))
  if (limit === null && remaining === null) return
  rateLimitHint = { limit, remaining, atMs: Date.now() }
}

export function getLoconavRateLimitHint(): { limit: number | null; remaining: number | null; atMs: number | null } {
  return { ...rateLimitHint }
}

/**
 * One authenticated request, with the house retry policy.
 *
 * 401/403 throw immediately: they are configuration faults and retrying cannot help — copied
 * deliberately from the Callyzer client, which learned it the hard way. 400/404/422 throw immediately
 * for the same reason. Everything else gets four attempts with linear backoff. Upstream detail is
 * truncated to 200 chars into the error message so a provider stack trace never lands whole in a log line.
 *
 * ⚠️ 429 THROWS IMMEDIATELY TOO. The account allows 20 requests per window; a 1.5 s backoff retry lands
 * inside the same exhausted window and spends the next one as well. The caller decides whether to defer.
 */
export type RequestPolicy = {
  /** Total tries, including the first. */
  attempts?: number
  /** Per-attempt abort, in ms. */
  timeoutMs?: number
}

/**
 * ⚠️ THE DEFAULT POLICY IS FOR THE LIVE POSITION POLL, NOT FOR BACKFILL.
 * 4 attempts x 20s + 1.5/3/4.5s backoff = ~89s worst case for ONE call. That is deliberate for a
 * position nobody can re-derive, but five backfilled trips at that budget is ~445s against a route
 * limit of 120s — the instance is killed, the work is lost, and the run repeats for ever. Historical
 * reads therefore pass a tighter policy; see TRIP_REQUEST_POLICY in lib/loconav/trips.ts.
 */
const DEFAULT_POLICY: Required<RequestPolicy> = { attempts: 4, timeoutMs: 20_000 }

async function request<T>(
  path: string,
  init: {
    method?: string
    body?: unknown
    searchParams?: Record<string, string | number | undefined>
    policy?: RequestPolicy
  } = {},
): Promise<T> {
  const attempts = init.policy?.attempts ?? DEFAULT_POLICY.attempts
  const timeoutMs = init.policy?.timeoutMs ?? DEFAULT_POLICY.timeoutMs
  const url = new URL(`${loconavBase()}${path}`)
  for (const [k, v] of Object.entries(init.searchParams ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }

  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: init.method ?? 'GET',
        headers: {
          'User-Authentication': apiToken(),
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: 'no-store',
        /*
         * ⚠️ WITHOUT THIS THE RETRY POLICY IS A LIE. undici's default headers/body timeout is ~300s,
         * so a single hung attempt already outlives the route's maxDuration of 120s — the function
         * is killed mid-flight and none of the four attempts, nor the failure record in
         * loconav_sync_state, ever happens. 20s x 4 attempts + backoff stays inside the budget.
         */
        signal: AbortSignal.timeout(timeoutMs),
      })

      recordRateLimit(res.headers, res.status)
      if (res.ok) return (await res.json()) as T

      const detail = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        throw new LoconavHttpError(res.status, path, `LocoNav auth failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      }
      if (res.status === 429) {
        throw new LoconavRateLimitError(path, `LocoNav ${path} failed: HTTP 429 ${detail.slice(0, 200)}`)
      }
      const error = new LoconavHttpError(res.status, path, `LocoNav ${path} failed: HTTP ${res.status} ${detail.slice(0, 200)}`)
      if (NON_RETRYABLE_STATUSES.has(res.status)) throw error
      lastError = error
    } catch (error) {
      // Every LoconavHttpError that reaches here was THROWN, i.e. is non-retryable by construction.
      if (error instanceof LoconavHttpError) throw error
      if (error instanceof Error && /not configured/.test(error.message)) throw error
      lastError = error
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 1500))
  }
  throw lastError instanceof Error ? lastError : new Error(`LocoNav ${path} failed`)
}

/**
 * Every vehicle on the account, paged.
 *
 * Paged rather than filtered on purpose: we need the whole fleet's `chassisNumber` values to build
 * the VIN map, and the endpoint offers no chassis filter. `perPage` is capped and the loop has a
 * hard page ceiling so a provider that always reports `more: true` cannot spin forever.
 */
export async function listAllVehicles(perPage = 100, maxPages = 50): Promise<LoconavVehicle[]> {
  const out: LoconavVehicle[] = []
  for (let page = 1; page <= maxPages; page++) {
    const json = await request<{ success?: boolean; data?: { vehicles?: unknown[] } }>(
      '/vehicles',
      { searchParams: { page, perPage } },
    )
    const rows = Array.isArray(json?.data?.vehicles) ? json.data!.vehicles! : []
    for (const r of rows as Record<string, unknown>[]) {
      const device = (r.currentDevice ?? {}) as Record<string, unknown>
      const subscription = (r.subscription ?? {}) as Record<string, unknown>
      const uuid = str(r.vehicleUuid)
      if (!uuid) continue
      out.push({
        vehicleUuid: uuid,
        number: str(r.number),
        displayNumber: str(r.displayNumber),
        chassisNumber: str(r.chassisNumber),
        make: str(r.make),
        model: str(r.model),
        vehicleType: str(r.vehicleType),
        deviceSerialNumber: str(device.serialNumber),
        deviceType: str(device.deviceType),
        subscriptionExpiresAt: str(subscription.expiresAt),
      })
    }
    // A short page is the last page. The endpoint's pagination block is not consistently present.
    if (rows.length < perPage) break
  }
  return out
}

/**
 * Last known position for a batch of provider vehicle uuids.
 *
 * ⚠️ This is the ONE endpoint that answers "where are my cars right now" without N requests —
 * it takes `vehicleIds` as an array. Chunked because an unbounded body against a fleet endpoint is
 * how you earn a 413 or a timeout.
 */
export async function fetchLastKnown(vehicleUuids: string[], chunkSize = 25): Promise<LoconavPosition[]> {
  const out: LoconavPosition[] = []
  for (let i = 0; i < vehicleUuids.length; i += chunkSize) {
    const chunk = vehicleUuids.slice(i, i + chunkSize)
    if (!chunk.length) continue
    /*
     * ⚠️ page/perPage ARE sent. The documented URL carries them (`?page=1&perPage=10`), and the
     * vendor's default perPage is 10 — so a chunk of 25 uuids would have come back silently
     * truncated to the first 10, leaving 15 cars looking untracked with no error anywhere.
     */
    const json = await request<{ success?: boolean; data?: { values?: unknown[] } }>(
      '/vehicles/telematics/last_known',
      {
        method: 'POST',
        body: { vehicleIds: chunk, sensors: ['gps'] },
        searchParams: { page: 1, perPage: chunk.length },
      },
    )
    for (const v of (Array.isArray(json?.data?.values) ? json.data!.values! : []) as Record<string, unknown>[]) {
      const uuid = str(v.vehicleId)
      if (!uuid) continue
      const gps = (v.gps ?? {}) as Record<string, unknown>
      const coords = (gps.currentLocationCoordinates ?? {}) as Record<string, unknown>
      const lat = (coords.lat ?? {}) as Record<string, unknown>
      const lng = (coords.long ?? coords.lng ?? {}) as Record<string, unknown>
      const speed = (gps.speed ?? {}) as Record<string, unknown>
      const ignition = (gps.ignition ?? {}) as Record<string, unknown>

      /*
       * ⚠️ Timestamps come back as UNIX SECONDS on the individual sensor readings, and the position
       * fix carries its own — which is older than the speed reading in the vendor's own sample.
       * Take the coordinate's timestamp, because that is what dates the LOCATION; using the newest
       * sensor time would make a stale fix look fresh.
       */
      const tsSeconds = numOrNull(lat.timestamp) ?? numOrNull(speed.timestamp) ?? null

      out.push({
        vehicleUuid: uuid,
        vehicleNumber: str(v.vehicleNumber),
        latitude: numOrNull(lat.value),
        longitude: numOrNull(lng.value),
        speedKph: numOrNull(speed.value),
        ignition: str(ignition.value),
        address: str(coords.address) ?? str(gps.address),
        positionAtMs: tsSeconds === null ? null : tsSeconds * 1000,
        raw: v,
      })
    }
  }
  return out
}

/**
 * Distance actually travelled between two instants — the number that can be checked against the
 * odometer readings a guard types at the barrier.
 *
 * Times are UNIX SECONDS, per the vendor's sample (`startTime: 1712572426`). Passing milliseconds
 * silently returns a window ~55,000 years wide, which the API answers with a plausible-looking zero.
 */
export async function fetchDistanceTravelled(
  vehicleUuid: string,
  startTime: Date,
  endTime: Date,
  policy?: RequestPolicy,
): Promise<{ km: number | null; unit: string | null }> {
  const json = await request<{ data?: { distance?: { value?: unknown; unit?: unknown } } }>(
    `/vehicles/${encodeURIComponent(vehicleUuid)}/distance_travelled`,
    {
      searchParams: {
        startTime: Math.floor(startTime.getTime() / 1000),
        endTime: Math.floor(endTime.getTime() / 1000),
      },
      policy,
    },
  )
  return { km: numOrNull(json?.data?.distance?.value), unit: str(json?.data?.distance?.unit) }
}

export type LoconavTimelineSegment = {
  movementStatus: string | null
  distanceKm: number | null
  averageSpeedKph: number | null
  path: string | null
  startTsMs: number | null
  endTsMs: number | null
  startAddress: string | null
  endAddress: string | null
  startCoordinates: string | null
  endCoordinates: string | null
}

/**
 * The drive itself, segment by segment — moving stretches and stops, with an encoded polyline per
 * moving segment.
 *
 * ⚠️ UNIX SECONDS, like distance_travelled. The segment timestamps come back in seconds too and are
 * converted to ms here so nothing downstream has to remember which unit it is holding.
 *
 * ⚠️ A "Stopped" segment can carry null coordinates in the vendor's own sample (the first stop has
 * `coordinates: null` at its start). Every field is therefore nullable — do not assume a segment is
 * plottable.
 *
 * ⚠️ ONE DAY AT MOST per call — a longer window is refused with HTTP 400. Callers slice with
 * sliceWindow() from lib/loconav/timeline.ts.
 */
export async function fetchTimeline(
  vehicleUuid: string,
  startTime: Date,
  endTime: Date,
  policy?: RequestPolicy,
): Promise<LoconavTimelineSegment[]> {
  const json = await request<{ data?: { timeline?: unknown[] } }>(
    `/vehicles/${encodeURIComponent(vehicleUuid)}/timeline`,
    {
      searchParams: {
        startTime: Math.floor(startTime.getTime() / 1000),
        endTime: Math.floor(endTime.getTime() / 1000),
      },
      policy,
    },
  )
  const rows = Array.isArray(json?.data?.timeline) ? json.data!.timeline! : []
  return (rows as Record<string, unknown>[]).map((seg) => {
    const distance = (seg.distance ?? {}) as Record<string, unknown>
    const avg = (seg.averageSpeed ?? {}) as Record<string, unknown>
    const start = (seg.startLocation ?? {}) as Record<string, unknown>
    const end = (seg.endLocation ?? {}) as Record<string, unknown>
    const secToMs = (v: unknown) => {
      const n = numOrNull(v)
      return n === null ? null : n * 1000
    }
    return {
      movementStatus: str(seg.movementStatus),
      distanceKm: numOrNull(distance.value),
      averageSpeedKph: numOrNull(avg.value),
      path: str(seg.path),
      startTsMs: secToMs(start.timestamp),
      endTsMs: secToMs(end.timestamp),
      startAddress: str(start.address),
      endAddress: str(end.address),
      startCoordinates: str(start.coordinates),
      endCoordinates: str(end.coordinates),
    }
  })
}

export type LoconavAlert = {
  id: string | null
  eventType: string | null
  label: string | null
  eventTimeMs: number | null
  latitude: number | null
  longitude: number | null
  address: string | null
  value: number | null
  unit: string | null
}

/**
 * Alerts raised against one vehicle in a window — overspeed, harsh braking, route deviation,
 * ignition, crash. This is what turns "the car came back" into "the car came back, and here is how
 * it was driven".
 *
 * ⚠️ The PER-VEHICLE endpoint, deliberately: keyed on the provider uuid rather than on a plate.
 * ⚠️ ONE DAY AT MOST per call, like the timeline.
 */
export async function fetchAlerts(
  vehicleUuid: string,
  startTime: Date,
  endTime: Date,
  policy?: RequestPolicy,
): Promise<LoconavAlert[]> {
  const json = await request<{ data?: { alerts?: unknown[] } }>(
    `/vehicles/${encodeURIComponent(vehicleUuid)}/alerts`,
    {
      searchParams: {
        startTime: Math.floor(startTime.getTime() / 1000),
        endTime: Math.floor(endTime.getTime() / 1000),
      },
      policy,
    },
  )
  const rows = Array.isArray(json?.data?.alerts) ? json.data!.alerts! : []
  return (rows as Record<string, unknown>[]).map((a) => {
    const loc = (a.startLocation ?? {}) as Record<string, unknown>
    const valueWithUnit = (a.valueWithUnit ?? {}) as Record<string, unknown>
    const eventTime = numOrNull(a.eventTime)
    return {
      id: str(a.id),
      eventType: str(a.eventType),
      label: str(a.localizeEventType) ?? str(a.eventType),
      eventTimeMs: eventTime === null ? null : eventTime * 1000,
      latitude: numOrNull(loc.lat),
      longitude: numOrNull(loc.long),
      address: str(loc.address),
      value: numOrNull(valueWithUnit.value),
      unit: str(valueWithUnit.unit),
    }
  })
}

/** A shareable live-tracking URL for one vehicle — the no-login surface, like the gate QR links. */
export async function fetchLiveShareLink(vehicleUuid: string): Promise<string | null> {
  const json = await request<{ data?: { shareLink?: unknown } }>(
    `/vehicles/${encodeURIComponent(vehicleUuid)}/live_share_link`,
  )
  return str(json?.data?.shareLink)
}
