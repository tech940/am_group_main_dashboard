import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { listDemoVehiclesForGatePass } from '@/lib/gate-pass/vehicles'
import { fetchLastKnown, isLoconavConfigured, listAllVehicles, type LoconavVehicle } from './client'

/**
 * The LocoNav sync. THE ONLY code path that talks to the provider.
 *
 * Two steps, deliberately in this order:
 *   1. MAP  — page the provider's fleet and match its `chassisNumber` to our demo VINs.
 *   2. POLL — fetch last-known positions for the vehicles that mapped.
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
 */

export type LoconavSyncResult = {
  configured: boolean
  demoVins: number
  providerVehicles: number
  mapped: number
  /** Provider vehicles whose chassisNumber matched no demo VIN — usually other fleet, not an error. */
  unmatchedProvider: number
  /** Demo VINs with no provider vehicle — the cars that simply are not tracked. */
  untrackedDemo: number
  /** Demo VINs the provider knows but under a DIFFERENT plate than ours. Reported, never resolved. */
  plateMismatches: { vin: string; ours: string | null; theirs: string | null }[]
  positionsUpdated: number
  positionsMissing: number
  errors: string[]
}

const key = (v: unknown) => String(v ?? '').trim().toUpperCase()

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
      detail: 'LOCONAV_API_TOKEN is not configured — nothing was fetched.',
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
    const ready = await db.execute<{ ready: boolean }>(sql`
      SELECT (to_regclass('public.demo_vehicle_trackers') IS NOT NULL
          AND to_regclass('public.demo_vehicle_positions') IS NOT NULL
          AND to_regclass('public.loconav_sync_state')    IS NOT NULL) AS ready`)
    if (!Boolean((ready as unknown as { ready?: boolean }[])[0]?.ready)) {
      throw new Error(
        'Migration 0057 has not been applied — demo_vehicle_trackers / demo_vehicle_positions / ' +
          'loconav_sync_state are missing. Apply it on the direct/session port 5432, not the pooler.',
      )
    }

    // ── 1. Our side. The demo fleet, already filtered to selectable cars. ──────────────────────
    const demo = await listDemoVehiclesForGatePass()
    const demoByVin = new Map(demo.map((v) => [key(v.vin), v]))
    result.demoVins = demoByVin.size

    // ── 2. Their side. ────────────────────────────────────────────────────────────────────────
    const providerVehicles = await listAllVehicles()
    result.providerVehicles = providerVehicles.length

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

    result.mapped = matches.length
    result.untrackedDemo = demoByVin.size - matches.length
    result.unmatchedProvider = providerVehicles.length - matches.length

    // ── 3. Persist the mapping. ───────────────────────────────────────────────────────────────
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
                  ${vehicle.subscriptionExpiresAt ? sql`${vehicle.subscriptionExpiresAt}::timestamptz` : sql`NULL`},
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
           * repointed on the next tick — and step 4 then wrote another car's position against this
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
         * survive. Skip this one car, name it, and let the other twelve map.
         */
        const code = (error as { code?: string })?.code
        const detail = error instanceof Error ? error.message : String(error)
        if (code === '23505') {
          result.errors.push(
            `VIN ${vin}: LocoNav vehicle ${vehicle.vehicleUuid} is already mapped to a different VIN. ` +
              'Resolve demo_vehicle_trackers by hand — a tracker has probably moved between cars.',
          )
          continue
        }
        result.errors.push(`VIN ${vin}: tracker upsert failed — ${detail.slice(0, 200)}`)
        throw error
      }
    }

    // ── 4. Positions. ─────────────────────────────────────────────────────────────────────────
    const uuidToVin = new Map(matches.map((m) => [m.vehicle.vehicleUuid, m.vin]))
    if (uuidToVin.size) {
      const positions = await fetchLastKnown([...uuidToVin.keys()])
      const seen = new Set<string>()

      for (const p of positions) {
        const vin = uuidToVin.get(p.vehicleUuid)
        if (!vin) continue

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

        if (!usable) {
          /*
           * Record that we asked and got nothing usable — fetched_at moves, the coordinates do not.
           * latitude/longitude/speed_kph/ignition/address/position_at are deliberately absent from
           * the SET list so the last good fix survives.
           */
          await db.execute(sql`
            INSERT INTO demo_vehicle_positions (vin, provider, fetched_at, raw, updated_at)
            VALUES (${vin}, 'loconav', now(), ${JSON.stringify(p.raw)}::jsonb, now())
            ON CONFLICT (vin) DO UPDATE SET
              fetched_at = now(), raw = EXCLUDED.raw, updated_at = now()`)
          continue
        }

        seen.add(vin)
        await db.execute(sql`
          INSERT INTO demo_vehicle_positions
            (vin, provider, latitude, longitude, speed_kph, ignition, address, position_at, fetched_at, raw, updated_at)
          VALUES (${vin}, 'loconav', ${p.latitude}, ${p.longitude}, ${p.speedKph}, ${p.ignition}, ${p.address},
                  ${p.positionAtMs === null ? sql`NULL` : sql`to_timestamp(${p.positionAtMs / 1000})`},
                  now(), ${JSON.stringify(p.raw)}::jsonb, now())
          ON CONFLICT (vin) DO UPDATE SET
            latitude    = EXCLUDED.latitude,
            longitude   = EXCLUDED.longitude,
            speed_kph   = EXCLUDED.speed_kph,
            ignition    = EXCLUDED.ignition,
            address     = EXCLUDED.address,
            position_at = EXCLUDED.position_at,
            fetched_at  = now(),
            raw         = EXCLUDED.raw,
            updated_at  = now()`)
        result.positionsUpdated += 1
      }
      result.positionsMissing = uuidToVin.size - seen.size
    }

    const detail =
      `mapped ${result.mapped}/${result.demoVins} demo VINs to ${result.providerVehicles} LocoNav vehicles; ` +
      `${result.positionsUpdated} positions updated, ${result.untrackedDemo} demo cars untracked` +
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
      success: true,
      vehiclesMapped: result.mapped,
      positionsUpdated: result.positionsUpdated,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(message)
    // Record the failure, then rethrow — a silent failure is what makes stale data look live.
    await writeSyncState({ status: 'failed', detail: message, success: false }).catch(() => {})
    throw error
  }
}

/** The sync-state row, so any surface can say how fresh the tracking data is. */
export async function getLoconavSyncState() {
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
  const row = (rows as unknown as any[])[0]
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
