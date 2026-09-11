import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listDemoVehiclesForGatePass } from '@/lib/gate-pass/vehicles'
import {
  fetchLastKnown,
  isLoconavConfigured,
  isLoconavRateLimited,
  listAllVehicles,
  type LoconavVehicle,
} from './client'

/**
 * The LocoNav sync. THE ONLY code path that talks to the provider.
 *
 * Three steps, deliberately in this order:
 *   1. LIST — page the provider's fleet into loconav_provider_vehicles, so the Trackers screen has
 *             something to link to without ever calling LocoNav itself.
 *   2. MAP  — match its `chassisNumber` to our demo VINs: the only link made automatically.
 *   3. POLL — fetch last-known positions for every PERSISTED link whose car is still a demo car.
 *
 * ── ⚠️ THE MATCH IS ON VIN AND NOTHING ELSE ───────────────────────────────────────────────────
 * A registration number does not identify a demo car: 29 VINs, 25 plates, and `JK02C0059TC` is a
 * trade-certificate plate worn by FIVE cars (lib/gate-pass/vehicles.ts). Matching on the plate would
 * attach one car's position to five vehicles — and since a gate pass claims a car by VIN, the fleet
 * board would show a car sitting in the showroom while a different one wearing the same plate drove
 * away. So the only automatic match allowed is `chassisNumber` -> VIN, exact after TRIM/UPPER.
 *
 * Where the provider's plate disagrees with ours it is RECORDED, not acted on, so the discrepancy
 * is visible to a human instead of silently deciding anything.
 *
 * ⚠️ On this account `chassisNumber` holds a plate or free text for 17 of 18 vehicles (measured
 * 2026-09-11), so nearly every link is one a person confirmed on the Trackers screen
 * (matched_by = 'manual'). That is why step 3 polls what demo_vehicle_trackers holds and not what
 * step 2 matched: polling the matches tracked one car, and never gave a confirmed link a position.
 */

export type LoconavSyncResult = {
  configured: boolean
  demoVins: number
  providerVehicles: number
  /** The poll set: persisted links whose tracker is on the account and whose car is in the demo fleet. */
  mapped: number
  /** Of `mapped`, links a person confirmed on the Trackers screen. */
  manualLinks: number
  /** Of `mapped`, links made automatically because LocoNav's chassisNumber is the VIN. */
  chassisLinks: number
  /** Provider vehicles outside the poll set — not linked yet, or not demo cars at all. Not an error. */
  unmatchedProvider: number
  /** Demo VINs with no polled tracker — the cars that simply are not tracked. */
  untrackedDemo: number
  /** Demo VINs the provider knows but under a DIFFERENT plate than ours. Reported, never resolved. */
  plateMismatches: { vin: string; ours: string | null; theirs: string | null }[]
  positionsUpdated: number
  positionsMissing: number
  errors: string[]
}

const key = (v: unknown) => String(v ?? '').trim().toUpperCase()

/**
 * A provider timestamp as ISO text, or null. Parsed here instead of cast in SQL, so no row can fail on its own data:
 * a value Postgres would refuse is a NULL, never a 22007 that aborts the whole run.
 */
function isoOrNull(value: string | null): string | null {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * The SQLSTATE of a database error, or ''.
 *
 * ⚠️ Drizzle 0.45 rethrows every driver error as a DrizzleQueryError whose own `code` is undefined — the Postgres code
 * is on `cause`. Reading `error.code` made the per-row 23505 skip below dead code, so one tracker collision aborted
 * every sync run. Walks the cause chain, and uses nothing else from this module: verify:loconav runs it on its own.
 */
export function pgErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
    current = (current as { cause?: unknown }).cause
  }
  return ''
}

async function writeSyncState(patch: {
  status: string
  detail: string
  success: boolean
  vehiclesMapped?: number
  positionsUpdated?: number
}) {
  /*
   * Written on failure as well as success — the Callyzer lesson: a UI that cannot tell stale from
   * live will present three-day-old positions as current.
   *
   * ⚠️ The counters are COALESCEd, not overwritten. A skipped or failed run passes neither, and
   * writing 0 for them would erase the record of the last good run — so a single failure would make
   * the dashboard read "0 vehicles mapped" for a fleet that is in fact mapped and merely stale.
   * NULL means "this run has nothing to say about that number", which is not the same as zero.
   */
  const mapped = patch.vehiclesMapped ?? null
  const positions = patch.positionsUpdated ?? null
  await db.execute(sql`
    INSERT INTO loconav_sync_state (id, last_run_at, last_success_at, last_run_status, last_run_detail,
                                    vehicles_mapped, positions_updated, updated_at)
    VALUES (1, now(), ${patch.success ? sql`now()` : sql`NULL`}, ${patch.status}, ${patch.detail.slice(0, 500)},
            ${mapped ?? 0}, ${positions ?? 0}, now())
    ON CONFLICT (id) DO UPDATE SET
      last_run_at       = now(),
      last_success_at   = ${patch.success ? sql`now()` : sql`loconav_sync_state.last_success_at`},
      last_run_status   = EXCLUDED.last_run_status,
      last_run_detail   = EXCLUDED.last_run_detail,
      vehicles_mapped   = ${mapped === null ? sql`loconav_sync_state.vehicles_mapped` : sql`${mapped}`},
      positions_updated = ${positions === null ? sql`loconav_sync_state.positions_updated` : sql`${positions}`},
      updated_at        = now()`)
}

export async function runLoconavSync(): Promise<LoconavSyncResult> {
  const result: LoconavSyncResult = {
    configured: isLoconavConfigured(),
    demoVins: 0,
    providerVehicles: 0,
    mapped: 0,
    manualLinks: 0,
    chassisLinks: 0,
    unmatchedProvider: 0,
    untrackedDemo: 0,
    plateMismatches: [],
    positionsUpdated: 0,
    positionsMissing: 0,
    errors: [],
  }

  if (!result.configured) {
    await writeSyncState({
      status: 'skipped',
      detail: 'LOCO_AUTH_TOKEN is not configured — nothing was fetched.',
      success: false,
    }).catch(() => {}) // the state table may not exist yet either; skipping is still the right answer
    return result
  }

  try {
    /*
     * ⚠️ Check the tables BEFORE calling the provider. Without this the sync pages LocoNav's entire
     * fleet, then dies on the first INSERT with 42P01 — burning the provider call and reporting a
     * raw Postgres error instead of the one thing the operator needs to be told.
     *
     * ⚠️ INSIDE the try. When this throw sat above it, the catch below never ran, so the failure was
     * never recorded and `last_run_status` still read 'ok' from the previous run — a sync that had
     * stopped working looked healthy. (writeSyncState will itself fail here, since loconav_sync_state
     * is one of the missing tables; the catch swallows that and the error still reaches the caller.)
     */
    const ready = await db.execute<{ ready: boolean; mapping_ready: boolean }>(sql`
      SELECT (to_regclass('public.demo_vehicle_trackers') IS NOT NULL
          AND to_regclass('public.demo_vehicle_positions') IS NOT NULL
          AND to_regclass('public.loconav_sync_state')    IS NOT NULL) AS ready,
             to_regclass('public.loconav_provider_vehicles') IS NOT NULL AS mapping_ready`)
    const probe = (ready as unknown as { ready?: boolean; mapping_ready?: boolean }[])[0]
    if (!Boolean(probe?.ready)) {
      throw new Error(
        'Migration 0057 has not been applied — demo_vehicle_trackers / demo_vehicle_positions / ' +
          'loconav_sync_state are missing. Apply it on the direct/session port 5432, not the pooler.',
      )
    }
    /*
     * Same round trip. Without loconav_provider_vehicles the listing has nowhere to land, and the
     * Trackers screen — where nearly every link on this account is made — has nothing to link to.
     */
    if (!Boolean(probe?.mapping_ready)) {
      throw new Error(
        'Migration 0060 has not been applied — loconav_provider_vehicles is missing. ' +
          'Apply it on the direct/session port 5432, not the pooler.',
      )
    }

    // ── 1. Our side. The demo fleet, already filtered to selectable cars. ──────────────────────
    const demo = await listDemoVehiclesForGatePass()
    const demoByVin = new Map(demo.map((v) => [key(v.vin), v]))
    result.demoVins = demoByVin.size

    // ── 2. Their side. ────────────────────────────────────────────────────────────────────────
    const providerVehicles = await listAllVehicles()
    result.providerVehicles = providerVehicles.length
    const providerByUuid = new Map(providerVehicles.map((v) => [v.vehicleUuid, v]))

    // ── 3. The snapshot the Trackers screen links from. ───────────────────────────────────────
    /*
     * ⚠️ Labels, device serial/type and subscription ONLY — never coordinates, never the device phone
     * number (client.ts does not even read it). Not every unit on the account is a demo car, and this
     * table is shown to every person who can link a tracker.
     *
     * ⚠️ ONE batched statement, deliberately unlike the per-row tracker upsert below. That one is
     * per-row because a second unique index can refuse a single car; here the only unique key is the
     * primary key ON CONFLICT arbitrates, a duplicated uuid is collapsed by the Map above, and the
     * timestamp is parsed here instead of cast in SQL — no single row can fail on its own data. And a
     * PARTIAL write would be wrong, not merely incomplete: the Trackers screen reads a tracker whose
     * last_seen_at lags the latest listing as gone from the account, so rows left unwritten would show
     * as removed. One round trip instead of 18 at ~175 ms each on the pooler is the smaller reason.
     */
    if (providerByUuid.size) {
      await db.execute(sql`
        INSERT INTO loconav_provider_vehicles
          (provider, provider_vehicle_uuid, vehicle_number, display_number, chassis_number,
           device_serial_number, device_type, subscription_expires_at, last_seen_at, updated_at)
        VALUES ${sql.join(
          [...providerByUuid.values()].map((v) => sql`
            ('loconav', ${v.vehicleUuid}, ${v.number}, ${v.displayNumber}, ${v.chassisNumber},
             ${v.deviceSerialNumber}, ${v.deviceType}, ${isoOrNull(v.subscriptionExpiresAt)}::timestamptz,
             now(), now())`),
          sql`,`,
        )}
        ON CONFLICT (provider, provider_vehicle_uuid) DO UPDATE SET
          vehicle_number          = EXCLUDED.vehicle_number,
          display_number          = EXCLUDED.display_number,
          chassis_number          = EXCLUDED.chassis_number,
          device_serial_number    = EXCLUDED.device_serial_number,
          device_type             = EXCLUDED.device_type,
          subscription_expires_at = EXCLUDED.subscription_expires_at,
          last_seen_at            = now(),
          updated_at              = now()`)
    }

    /*
     * ⚠️ Build the chassis index defensively: if the provider has TWO vehicles carrying the same
     * chassisNumber, neither may be mapped. Picking one would be a coin flip that silently attaches
     * a position to a car, and the unique index on (provider, provider_vehicle_uuid) would not
     * catch it because both rows are legitimately distinct provider vehicles.
     */
    const byChassis = new Map<string, LoconavVehicle[]>()
    for (const v of providerVehicles) {
      const c = key(v.chassisNumber)
      if (!c) continue
      const list = byChassis.get(c)
      if (list) list.push(v)
      else byChassis.set(c, [v])
    }

    const matches: { vin: string; vehicle: LoconavVehicle }[] = []
    for (const [vin, ours] of demoByVin) {
      const candidates = byChassis.get(vin)
      if (!candidates || candidates.length === 0) continue
      if (candidates.length > 1) {
        result.errors.push(
          `VIN ${vin} matches ${candidates.length} LocoNav vehicles by chassis number — skipped, needs a manual mapping.`,
        )
        continue
      }
      const vehicle = candidates[0]
      matches.push({ vin, vehicle })

      const ourPlate = key(ours.registrationNumber)
      const theirPlate = key(vehicle.number) || key(vehicle.displayNumber)
      if (ourPlate && theirPlate && ourPlate.replace(/\s+/g, '') !== theirPlate.replace(/\s+/g, '')) {
        result.plateMismatches.push({
          vin,
          ours: ours.registrationNumber ?? null,
          theirs: vehicle.number ?? vehicle.displayNumber ?? null,
        })
      }
    }

    // ── 4. Persist the mapping. ───────────────────────────────────────────────────────────────
    /*
     * ⚠️ `matched_by` is NOT overwritten on conflict. A row a human pinned ('manual') must survive
     * every resync — it exists precisely because the automatic match could not be trusted for that
     * car, and letting the sync stamp it back to 'chassis' would quietly undo the correction.
     */
    /*
     * ⚠️ Per-row on purpose, NOT one batched statement. A batch turns one bad mapping into an
     * all-or-nothing failure; with 29 cars the round-trip saving is not worth losing 28 good
     * mappings to one conflict.
     */
    for (const { vin, vehicle } of matches) {
      try {
        await db.execute(sql`
          INSERT INTO demo_vehicle_trackers
            (vin, provider, provider_vehicle_uuid, provider_vehicle_number, device_serial_number,
             device_type, subscription_expires_at, matched_by, last_seen_at, updated_at)
          VALUES (${vin}, 'loconav', ${vehicle.vehicleUuid}, ${vehicle.number ?? vehicle.displayNumber},
                  ${vehicle.deviceSerialNumber}, ${vehicle.deviceType},
                  ${isoOrNull(vehicle.subscriptionExpiresAt)}::timestamptz,
                  'chassis', now(), now())
          ON CONFLICT (vin) DO UPDATE SET
            provider_vehicle_uuid   = EXCLUDED.provider_vehicle_uuid,
            provider_vehicle_number = EXCLUDED.provider_vehicle_number,
            device_serial_number    = EXCLUDED.device_serial_number,
            device_type             = EXCLUDED.device_type,
            subscription_expires_at = EXCLUDED.subscription_expires_at,
            last_seen_at            = now(),
            updated_at              = now()
          /*
           * ⚠️ A HUMAN PIN IS NOT OVERWRITTEN. Leaving matched_by out of the SET list preserved the
           * LABEL but not the MAPPING: DO UPDATE still replaced provider_vehicle_uuid, so a row
           * pinned by hand precisely because the provider's chassis number was wrong got silently
           * repointed on the next tick — and step 6 then wrote another car's position against this
           * VIN. The whole point of a manual pin is that the automatic match is not trusted here.
           */
          WHERE demo_vehicle_trackers.matched_by <> 'manual'`)
      } catch (error) {
        /*
         * ⚠️ The table has a SECOND unique index, (provider, provider_vehicle_uuid), which
         * `ON CONFLICT (vin)` does not arbitrate. Move a tracker between cars — or let the provider
         * correct a chassis typo — and the new VIN's INSERT finds no vin conflict but collides with
         * the old row's uuid. Unhandled, that 23505 aborted the whole run, so positions were never
         * fetched and EVERY subsequent 15-minute cron failed identically until someone deleted the
         * stale row by hand.
         *
         * Deleting the other row automatically is not the answer: it may be a manual pin, which must
         * survive. Skip this one car and let the other twelve map; step 5 names it, once the row in its
         * way has been read back.
         */
        if (pgErrorCode(error) === '23505') continue
        // The driver's own message: Drizzle's wrapper carries the whole statement and its parameters.
        const cause = (error as { cause?: unknown })?.cause ?? error
        result.errors.push(
          `VIN ${vin}: tracker upsert failed — ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 200)}`,
        )
        throw error
      }
    }

    // ── 5. The poll set. ──────────────────────────────────────────────────────────────────────
    /*
     * ⚠️ Every PERSISTED link, read back after the upserts above — manual AND chassis — never this
     * run's `matches`. Polling the matches meant a link a person confirmed on the Trackers screen never
     * received a single position, and on this account that is nearly every link.
     */
    const links = (await db.execute(sql`
      SELECT vin, provider_vehicle_uuid, provider_vehicle_number, matched_by
        FROM demo_vehicle_trackers
       WHERE provider = 'loconav'
       ORDER BY vin`)) as unknown as {
      vin: string
      provider_vehicle_uuid: string
      provider_vehicle_number: string | null
      matched_by: string
    }[]

    /*
     * ⚠️ A CHASSIS MATCH THAT CONTRADICTS A STORED LINK IS SAID OUT LOUD. Step 4 leaves a car linked by hand alone, and
     * a tracker already linked to another car refuses the upsert with 23505 — both right, and both silent without
     * this. Judged against the rows just read back, so it names the link actually in the way and who can undo it: a
     * person's link on the Trackers screen, an automatic one only by the developer.
     */
    const storedByVin = new Map(links.map((l) => [key(l.vin), l]))
    const storedByUuid = new Map(links.map((l) => [l.provider_vehicle_uuid, l]))
    for (const { vin, vehicle } of matches) {
      const label = vehicle.displayNumber || vehicle.number || vehicle.vehicleUuid
      const carLink = storedByVin.get(vin)
      const trackerLink = storedByUuid.get(vehicle.vehicleUuid)
      if (carLink && carLink.provider_vehicle_uuid !== vehicle.vehicleUuid && carLink.matched_by === 'manual') {
        result.errors.push(
          `LocoNav's chassis number puts tracker ${label} on VIN ${vin}, but that car is linked by hand to ` +
            `${carLink.provider_vehicle_number || carLink.provider_vehicle_uuid} — check it on the Trackers screen.`,
        )
      } else if (trackerLink && key(trackerLink.vin) !== vin) {
        result.errors.push(
          trackerLink.matched_by === 'manual'
            ? `LocoNav's chassis number puts tracker ${label} on VIN ${vin}, but it is linked by hand to VIN ` +
                `${key(trackerLink.vin)} — unlink it on the Trackers screen if LocoNav is right.`
            : `LocoNav's chassis number puts tracker ${label} on VIN ${vin}, but an older chassis match links it to ` +
                `VIN ${key(trackerLink.vin)} — ask the developer to remove that link; the tracker has probably moved cars.`,
        )
      }
    }

    const uuidToVin = new Map<string, string>()
    const bothFleetsListed = demoByVin.size > 0 && providerByUuid.size > 0
    if (!bothFleetsListed) {
      /*
       * ⚠️ AN EMPTY LIST IS NOT "NO LINKS". listDemoVehiclesForGatePass answers [] when the demo feed
       * is missing or has lost a column, and listAllVehicles answers [] when the response loses its
       * shape. Taking either at its word would report every linked car as sold, or every tracker as
       * gone, and tell someone to unlink the lot. Poll nothing, say which list was empty, judge no link.
       */
      result.errors.push(
        demoByVin.size
          ? 'LocoNav listed no vehicles on the account — no positions were polled and no link was judged.'
          : 'The demo fleet list came back empty — no positions were polled and no link was judged. ' +
              'Check the demo car feed.',
      )
    } else {
      for (const link of links) {
        const vin = key(link.vin)
        const uuid = link.provider_vehicle_uuid
        const label = link.provider_vehicle_number || uuid
        // Only a person's link can be undone on the Trackers screen; a chassis link is LocoNav's own claim.
        const remedy =
          link.matched_by === 'manual'
            ? 'unlink it on the Trackers screen'
            : 'ask the developer to remove this chassis link'

        if (!demoByVin.has(vin)) {
          /*
           * ⚠️ NEVER POLL A CAR THAT HAS LEFT THE DEMO FLEET. A sold car keeps its tracker and its link,
           * but it now belongs to a customer — its position is where a private person is, not where a
           * demo car is.
           */
          result.errors.push(
            `VIN ${vin} is linked to LocoNav vehicle ${label} but is no longer in the demo fleet ` +
              `(it may have been sold) — not polled; ${remedy}.`,
          )
          continue
        }
        if (!providerByUuid.has(uuid)) {
          result.errors.push(
            `VIN ${vin} is linked to LocoNav vehicle ${label}, which is no longer on the LocoNav account ` +
              `— not polled; ${remedy}.`,
          )
          continue
        }

        uuidToVin.set(uuid, vin)
        if (link.matched_by === 'manual') result.manualLinks += 1
        else result.chassisLinks += 1
      }
    }

    result.mapped = uuidToVin.size
    result.untrackedDemo = demoByVin.size - uuidToVin.size
    result.unmatchedProvider = result.providerVehicles - uuidToVin.size

    // ── 6. Positions. ─────────────────────────────────────────────────────────────────────────
    /*
     * ⚠️ ONE last_known request for the whole account (fetchLastKnown sends 25 uuids per request; 18
     * are listed), not one for the poll set plus another for the snapshot: the account allows 20
     * requests per window, and the trip sweep after this spends from the same allowance. Every unit's
     * fix TIME goes to loconav_provider_vehicles — how the person linking one sees it has gone silent —
     * but a position is written ONLY for the poll set, and nothing else of any other vehicle is kept.
     */
    if (providerByUuid.size) {
      const positions = await fetchLastKnown([...providerByUuid.keys()])
      const seen = new Set<string>()
      const fixSecondsByUuid = new Map<string, number>()

      for (const p of positions) {
        /*
         * ⚠️ VALIDATE BEFORE WRITING, AND DO NOT WRITE NULLS OVER A GOOD FIX.
         *
         * Two separate failures this prevents:
         *
         * 1. A parked car whose unit is asleep returns an empty or partial gps block. Writing that
         *    replaced yesterday's valid coordinates with NULL, flipped the board from "last seen 2h
         *    ago at <address>" to "No fix yet", and destroyed the last known location of a vehicle
         *    that is out on a demo — the exact moment you most want it.
         *
         * 2. latitude/longitude are numeric(10,7) — THREE integer digits. Any |value| >= 1000 raises
         *    22003, and because this is a sequential await loop inside the try, one bad coordinate
         *    abandoned every vehicle after it in the batch, not just its own.
         *
         * `seen` is added to only AFTER the guard, so a skipped vehicle is counted in
         * positionsMissing rather than vanishing from both counters.
         */
        const usable =
          p.positionAtMs !== null &&
          p.latitude !== null && p.longitude !== null &&
          Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
          Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180

        // Every unit's fix TIME is kept for the snapshot; a vehicle outside the poll set stops here.
        if (usable && p.positionAtMs !== null) fixSecondsByUuid.set(p.vehicleUuid, p.positionAtMs / 1000)
        const vin = uuidToVin.get(p.vehicleUuid)
        if (!vin) continue

        /*
         * ⚠️ WRITTEN ONLY WHILE THIS LINK STILL STANDS, checked by the write itself. uuidToVin was read before
         * last_known, which takes up to a minute and a half when LocoNav is slow. A person who unlinks this tracker
         * and links another to the car meanwhile has had the car's position deleted (lib/loconav/mappings.ts), and an
         * unconditional upsert wrote the OLD tracker's fix back under the new link — for good, if the new unit never
         * reports. The link row is locked FOR SHARE by the same statement: an unlink that commits first leaves
         * nothing to write, and one that comes after waits for this write, then deletes it.
         */
        const stillLinked = sql`
          WITH still_linked AS (
            SELECT 1 FROM demo_vehicle_trackers
             WHERE provider = 'loconav' AND upper(btrim(vin)) = ${vin} AND provider_vehicle_uuid = ${p.vehicleUuid}
               FOR SHARE)`

        if (!usable) {
          /*
           * Record that we asked and got nothing usable — fetched_at moves, the coordinates do not.
           * latitude/longitude/speed_kph/ignition/address/position_at are deliberately absent from
           * the SET list so the last good fix survives.
           */
          await db.execute(sql`
            ${stillLinked}
            INSERT INTO demo_vehicle_positions (vin, provider, fetched_at, raw, updated_at)
            SELECT ${vin}::text, 'loconav', now(), ${JSON.stringify(p.raw)}::jsonb, now() FROM still_linked
            ON CONFLICT (vin) DO UPDATE SET
              fetched_at = now(), raw = EXCLUDED.raw, updated_at = now()`)
          continue
        }

        /*
         * The casts are explicit because a parameter in a SELECT list has no column to take its type from. RETURNING
         * says whether the link still stood; a write it refused is counted in positionsMissing, not as updated.
         */
        const written = (await db.execute(sql`
          ${stillLinked}
          INSERT INTO demo_vehicle_positions
            (vin, provider, latitude, longitude, speed_kph, ignition, address, position_at, fetched_at, raw, updated_at)
          SELECT ${vin}::text, 'loconav', ${p.latitude}::numeric, ${p.longitude}::numeric, ${p.speedKph}::numeric,
                 ${p.ignition}::text, ${p.address}::text,
                 ${p.positionAtMs === null ? sql`NULL::timestamptz` : sql`to_timestamp(${p.positionAtMs / 1000}::double precision)`},
                 now(), ${JSON.stringify(p.raw)}::jsonb, now()
            FROM still_linked
          ON CONFLICT (vin) DO UPDATE SET
            latitude    = EXCLUDED.latitude,
            longitude   = EXCLUDED.longitude,
            speed_kph   = EXCLUDED.speed_kph,
            ignition    = EXCLUDED.ignition,
            address     = EXCLUDED.address,
            position_at = EXCLUDED.position_at,
            fetched_at  = now(),
            raw         = EXCLUDED.raw,
            updated_at  = now()
          RETURNING vin`)) as unknown as { vin: string }[]
        if (!written.length) continue
        seen.add(vin)
        result.positionsUpdated += 1
      }
      result.positionsMissing = uuidToVin.size - seen.size

      if (fixSecondsByUuid.size) {
        /*
         * One statement, for the reason the snapshot upsert is one. A unit with no usable fix is simply
         * absent from the list, so a sleeping device never overwrites a good last_fix_at with NULL.
         * The casts are explicit because a parameter inside a bare VALUES list has no column to take
         * its type from.
         */
        await db.execute(sql`
          UPDATE loconav_provider_vehicles AS pv
             SET last_fix_at = to_timestamp(f.fix_seconds), updated_at = now()
            FROM (VALUES ${sql.join(
              [...fixSecondsByUuid].map(([uuid, seconds]) => sql`(${uuid}::text, ${seconds}::double precision)`),
              sql`, `,
            )}) AS f (provider_vehicle_uuid, fix_seconds)
           WHERE pv.provider = 'loconav' AND pv.provider_vehicle_uuid = f.provider_vehicle_uuid`)
      }
    }

    const detail =
      `mapped ${result.mapped}/${result.demoVins} demo VINs to ${result.providerVehicles} LocoNav vehicles ` +
      `(${result.manualLinks} linked on the Trackers screen, ${result.chassisLinks} by chassis VIN); ` +
      `${result.positionsUpdated} positions updated, ${result.untrackedDemo} demo cars untracked, ` +
      `${result.unmatchedProvider} LocoNav vehicles not polled` +
      (result.plateMismatches.length ? `; ${result.plateMismatches.length} plate mismatch(es)` : '') +
      (result.errors.length ? `; ${result.errors.length} warning(s)` : '')

    /*
     * ⚠️ 'ok' only when there is nothing to look at. Warnings — a VIN matching two provider vehicles,
     * a tracker already mapped elsewhere — were previously visible ONLY in the HTTP response body,
     * and both runners discard that: the Vercel cron never reads it and the npm scheduler logs a
     * summary line. So a fleet that had silently stopped mapping a car reported a clean 'ok' for ever.
     */
    await writeSyncState({
      status: result.errors.length ? 'ok_with_warnings' : 'ok',
      detail: result.errors.length ? `${detail} :: ${result.errors.join(' | ')}` : detail,
      /*
       * ⚠️ NOT A SUCCESS WHEN EITHER LIST CAME BACK EMPTY. That run polled no car, and recording it as one kept
       * last_success_at fresh and the last good count on screen: the Trackers panel read "Synced 3 min ago · 11 cars
       * getting positions" for as long as the feed stayed broken, and its "may be failing" warning could never fire.
       * The count is written as 0, which the panel does not show; the next run that sees both lists writes the real one.
       */
      success: bothFleetsListed,
      vehiclesMapped: bothFleetsListed ? result.mapped : 0,
      positionsUpdated: result.positionsUpdated,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(message)
    /*
     * ⚠️ A 429 is recorded in words, not as "HTTP 429 TOO MANY REQUESTS". It is not a fault — the
     * account allows 20 requests per window and the limit clears within about two minutes — and the
     * raw text reads like an outage to whoever opens the Trackers screen. Still a failed run, and still
     * rethrown: no positions landed.
     */
    const detail = isLoconavRateLimited(error) ? 'LocoNav rate limit reached — the next run will retry.' : message
    // Record the failure, then rethrow — a silent failure is what makes stale data look live.
    await writeSyncState({ status: 'failed', detail, success: false }).catch(() => {})
    throw error
  }
}

/**
 * Marks the run that just finished 'ok_with_warnings', because the trip sweep after it threw.
 *
 * ⚠️ runLoconavSync has recorded 'ok' by the time the sweep starts, and the route answers the failure only in its body,
 * which neither runner reads — so a sweep that threw on every run was recorded nowhere, and every returned pass read
 * "Not checked" for good. A fixed sentence, never the error. The run's times and counters stay as it left them, and a
 * 'failed' written by an overlapping run is not turned back into a warning.
 */
export async function recordTripSweepFailure(): Promise<void> {
  const suffix = ' :: Trip reconciliation failed — drive checks did not run this time.'
  await db.execute(sql`
    UPDATE loconav_sync_state
       SET last_run_status = 'ok_with_warnings',
           last_run_detail = left(coalesce(last_run_detail, ''), ${500 - suffix.length}) || ${suffix},
           updated_at      = now()
     WHERE id = 1 AND last_run_status IN ('ok', 'ok_with_warnings')`)
}

/**
 * Cached once true, like `tablesReady` in positions.ts — a table is not dropped in normal operation.
 * While false it re-probes, so applying 0057 takes effect without a redeploy.
 */
let syncStateTableReady = false

/** The sync-state row, so any surface can say how fresh the tracking data is. */
export async function getLoconavSyncState() {
  /*
   * ⚠️ PROBED. The Trackers board reads this on a page path and 0057 is applied by hand: a bare SELECT
   * against a missing loconav_sync_state raises 42P01, which would take the whole board down just to
   * say "never synced". A missing table IS never synced — every field null, `configured` still
   * reported. A to_regclass probe rather than a caught 42P01, so a caller inside a transaction is never
   * left holding an aborted one.
   */
  if (!syncStateTableReady) {
    const probe = await db.execute<{ ready: boolean }>(sql`
      SELECT to_regclass('public.loconav_sync_state') IS NOT NULL AS ready`)
    syncStateTableReady = Boolean((probe as unknown as { ready?: boolean }[])[0]?.ready)
  }

  let row: any
  if (syncStateTableReady) {
    try {
      const rows = await db.execute<{
        last_run_at: Date | null
        last_success_at: Date | null
        last_run_status: string | null
        last_run_detail: string | null
        vehicles_mapped: number
        positions_updated: number
      }>(sql`SELECT last_run_at, last_success_at, last_run_status, last_run_detail,
                    vehicles_mapped, positions_updated
               FROM loconav_sync_state WHERE id = 1`)
      row = (rows as unknown as any[])[0]
    } catch (error) {
      // Re-arm the probe, so a table dropped under a warm instance degrades on the next read.
      syncStateTableReady = false
      throw error
    }
  }
  return {
    configured: isLoconavConfigured(),
    lastRunAt: row?.last_run_at ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
    lastRunStatus: row?.last_run_status ?? null,
    lastRunDetail: row?.last_run_detail ?? null,
    vehiclesMapped: Number(row?.vehicles_mapped ?? 0),
    positionsUpdated: Number(row?.positions_updated ?? 0),
  }
}
