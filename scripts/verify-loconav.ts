/**
 * verify:loconav — the LocoNav integration is keyed on VIN, never calls the provider from a render
 * path, and degrades to exactly the previous behaviour when it is not configured.
 *
 * ⚠️ THE DEFECT THIS EXISTS FOR. LocoNav identifies a vehicle by registration number, device serial
 * or its own uuid. Our demo fleet CANNOT be keyed on a registration number: measured live, 29 demo
 * VINs share 25 plates, and `JK02C0059TC` is a trade-certificate plate worn by FIVE different cars.
 * A plate-keyed match would attach one car's position to five vehicles — and because a gate pass
 * claims a car by VIN, the fleet board would show a car parked in the showroom while a different
 * car wearing the same plate was driven away. Every assertion here defends that one rule.
 *
 * Read-only. Never calls LocoNav — it asserts on source and on our own database.
 *
 *   npm run verify:loconav
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const ROOT = join(__dirname, '..')
let pass = 0
let fail = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/* ------------------------------------------------------------------ 1. identity */

console.log('\n1. Identity — VIN only, never the plate')

const client = read('lib/loconav/client.ts')
const sync = read('lib/loconav/sync.ts')

ok('the matcher reads chassisNumber (the VIN) from the provider', client.includes('chassisNumber'))
ok('sync matches on chassis, not on a plate',
  /byChassis/.test(sync) && !/byPlate|byRegistration|registrationNumber\s*\)\s*\)?\s*\.get\(/.test(sync))

/*
 * The provider's plate may be STORED (for diagnostics) but must never be used to look a vehicle up.
 * Catch the shapes that would do it: a map keyed on the provider number, or a filter comparing it.
 */
const plateAsKey = /\.get\(\s*key\((?:v|vehicle)\.(?:number|displayNumber)\)/.test(sync) ||
  /new Map\([^)]*\.(?:number|displayNumber)\s*,/.test(sync)
ok('the provider plate is never used as a lookup key', !plateAsKey)

ok('a chassis number matching TWO provider vehicles is skipped, not guessed',
  /candidates\.length > 1/.test(sync) && /skipped/.test(sync))

ok('plate mismatches are recorded for a human, not acted on',
  /plateMismatches/.test(sync))

ok('vehicleNumber is not offered as a client filter', !/vehicleNumber=|searchParams:\s*\{[^}]*vehicleNumber/.test(client))

/* ------------------------------------------------------------------ 2. render path */

console.log('\n2. No provider call on a render path')

const positions = read('lib/loconav/positions.ts')
const fleet = read('lib/gate-pass/fleet.ts')

ok('positions.ts does not import the client\'s fetching functions',
  !/import\s*\{[^}]*(fetchLastKnown|listAllVehicles|fetchDistanceTravelled)[^}]*\}\s*from\s*'\.\/client'/.test(positions))
ok('positions.ts reads from Drizzle tables', /demoVehiclePositions/.test(positions) && /demoVehicleTrackers/.test(positions))
ok('fleet.ts imports positions, not the LocoNav client',
  /from '@\/lib\/loconav\/positions'/.test(fleet) && !/from '@\/lib\/loconav\/client'/.test(fleet))
ok('fleet.ts fetches positions ONCE, outside the per-vehicle map',
  /const positions = await getPositionsForVins\(/.test(fleet) &&
  !/\.map\((?:[^)]*)=>\s*\{[\s\S]{0,400}await getPositionsForVins/.test(fleet))

// server-only is what stops any of this reaching a client bundle.
for (const f of ['lib/loconav/client.ts', 'lib/loconav/positions.ts', 'lib/loconav/sync.ts']) {
  ok(`${f} is server-only`, read(f).startsWith("import 'server-only'"))
}

/* ------------------------------------------------------------------ 3. configuration + safety */

console.log('\n3. Unconfigured must mean "off", not "broken"')

ok('the token is read lazily, never at module load',
  !/^const\s+\w+\s*=\s*process\.env\.LOCONAV_API_TOKEN/m.test(client) && /function apiToken\(\)/.test(client))
ok('isLoconavConfigured exists and is used by the sync', /export function isLoconavConfigured/.test(client) && /isLoconavConfigured\(\)/.test(sync))
ok('an unconfigured sync returns without calling the provider', /if \(!result\.configured\)/.test(sync))
ok('every VIN gets a tracking entry, so "no data" is never ambiguous', /not_configured/.test(positions) && /untracked/.test(positions))
ok('a stale fix is distinguished from a live one', /POSITION_LIVE_WINDOW_MS/.test(positions) && /'stale'/.test(positions))
ok('401/403 are not retried', /res\.status === 401 \|\| res\.status === 403/.test(client))
ok('the paging loop has a hard ceiling', /maxPages/.test(client))
ok('positions.ts probes for the tables before selecting from them',
  /to_regclass\('public\.demo_vehicle_trackers'\)/.test(positions) && /trackingTablesReady/.test(positions))
ok('the sync refuses to call the provider before the migration is applied',
  /to_regclass/.test(sync) && /Migration 0057 has not been applied/.test(sync))
ok('distance uses UNIX SECONDS, not milliseconds', /getTime\(\) \/ 1000/.test(client))

const route = read('app/api/gate-pass/tracking/sync/route.ts')
ok('the sync route uses the fail-closed cron guard', /authorizeCronRequest/.test(route))
ok('the manual fallback requires approve, not view', /requireGatePassAccess\('gate_pass\.approve'\)/.test(route))
ok('the route exports GET and POST', /export const GET/.test(route) && /export const POST/.test(route))
ok('provider error detail is not returned to the caller', /LocoNav sync failed\.'/.test(route))

/* ------------------------------------------------------------------ 3b. review fixes */

console.log('\n3b. Defects found by adversarial review — each locked in')

const route2 = read('app/api/gate-pass/fleet/route.ts')
const scheduler = read('scripts/loconav-sync-scheduler.mjs')
const panel = read('features/gate-pass/fleet-panel.tsx')

// A human pin must keep its MAPPING, not just its label.
ok('a manual tracker pin is not repointed by the sync',
  /WHERE demo_vehicle_trackers\.matched_by <> 'manual'/.test(sync))

// The table has a SECOND unique index that ON CONFLICT (vin) does not arbitrate.
ok('a 23505 on the provider-uuid index skips one car instead of killing the run',
  /'23505'/.test(sync) && /continue/.test(sync))

// Nulls must never overwrite a good fix, and out-of-range coords must not abort the batch.
ok('positions are validated before they are written', /const usable =/.test(sync) && /Math\.abs\(p\.latitude\) <= 90/.test(sync))
ok('an unusable fix moves fetched_at only, never the coordinates',
  /INSERT INTO demo_vehicle_positions \(vin, provider, fetched_at, raw, updated_at\)/.test(sync))
ok('seen.add happens after the usability guard, so skips are counted',
  sync.indexOf('const usable =') < sync.indexOf('seen.add(vin)'))
ok('the read side also requires coordinates, not just a timestamp',
  /p\.latitude === null \|\| p\.longitude === null/.test(positions))

// Failures and warnings must be visible.
ok('the migration check is INSIDE the try, so a failure is recorded',
  sync.indexOf('try {') < sync.indexOf('Migration 0057 has not been applied'))
ok('warnings surface in the sync status, not only in the HTTP body', /ok_with_warnings/.test(sync))
ok('sync-state counters are preserved, not zeroed, on a skipped or failed run',
  /loconav_sync_state\.vehicles_mapped/.test(sync))

// A retry policy without a timeout is not a retry policy.
ok('every provider request has an abort timeout', /AbortSignal\.timeout/.test(client))
ok('last_known sends page/perPage so a chunk is not truncated to the default 10',
  /searchParams: \{ page: 1, perPage: chunk\.length \}/.test(client))

// Tracking must never be the thing that breaks the fleet board.
ok('the position read is wrapped so it cannot take the fleet board down',
  /catch \(error\) \{[\s\S]{0,300}trackingTablesReady = false/.test(positions))

// Privacy + the two credential forms.
ok('coordinates are redacted for anyone without gate_pass.approve',
  /canSeeCoordinates/.test(route2) && /latitude: null, longitude: null, address: null/.test(route2))
ok('the scheduler sends CRON_SECRET as a Bearer header, not ?secret=',
  /Authorization: `Bearer \$\{CRON_SECRET\}`/.test(scheduler))

// And the whole point: somebody can actually SEE it.
ok('the fleet panel renders the tracking state', /trackingLabel/.test(panel) && /tracking:/.test(panel))

/* ------------------------------------------------------------------ 3c. phase 2: trips */

console.log('\n3c. Trip reconciliation')

const trips = read('lib/loconav/trips.ts')
const detailRoute = read('app/api/gate-pass/[id]/route.ts')
const detailPanel = read('features/gate-pass/gate-pass-detail.tsx')

// The discrepancy rule must need BOTH thresholds — either alone flags honest trips.
ok('a discrepancy needs an absolute AND a relative gap',
  /TRIP_DISCREPANCY_ABS_KM/.test(trips) && /TRIP_DISCREPANCY_RATIO/.test(trips) &&
  /delta < TRIP_DISCREPANCY_ABS_KM/.test(trips) && /delta \/ basis >= TRIP_DISCREPANCY_RATIO/.test(trips))
ok('the discrepancy rule guards the divide-by-zero', /basis <= 0/.test(trips))

// Terminal answers must not be re-asked every tick.
ok("'untracked' and 'unavailable' are terminal, not retried",
  /eq\(demoGatePassTrips\.status, 'failed'\)/.test(trips) && !/'untracked',\s*'unavailable'.*retry/i.test(trips))
ok('the retry budget accumulates instead of resetting',
  /attempts\s*=\s*demo_gate_pass_trips\.attempts \+ 1/.test(trips))
ok('the backfill and the batch are both bounded',
  /TRIP_BACKFILL_DAYS/.test(trips) && /TRIP_BATCH_SIZE/.test(trips) && /TRIP_MAX_ATTEMPTS/.test(trips))

// A mistyped odometer must not masquerade as a discrepancy.
ok('a backwards odometer reading is discarded, not stored', /inOdo >= outOdo \? inOdo - outOdo : null/.test(trips))

// A failure must advance attempts, not abandon the batch.
ok('a failed pass still records its attempt through a writer that cannot itself fail on data',
  /async function writeTripFailure/.test(trips) && /await writeTripFailure\(/.test(trips))
ok('the second-chance failure write is logged, not silently swallowed',
  /could not record the trip failure for/.test(trips))
ok('the sweep uses a tighter request policy than the live position poll',
  /TRIP_REQUEST_POLICY = \{ attempts: 2, timeoutMs: 8_000 \}/.test(trips) &&
  /fetchDistanceTravelled\(uuid, start, end, TRIP_REQUEST_POLICY\)/.test(trips))
ok('the sweep stops before starting a pass it cannot finish',
  /Date\.now\(\) \+ WORST_CASE_PASS_MS > opts\.deadlineMs/.test(trips) &&
  /deadlineMs: startedAt \+ 100_000/.test(read('app/api/gate-pass/tracking/sync/route.ts')))
ok('the odometer difference is clamped to what the column can hold', /TRIP_KM_MAX/.test(trips))
ok('a timeline failure does not throw away a distance that arrived',
  /fetchTimeline\([^)]*\)\.catch\(/.test(trips))
ok('an empty timeline reports null, not a measured zero',
  /if \(!segments\.length\)/.test(trips) && /movingSeconds: null/.test(trips))
ok("provider error text never reaches the database or the client",
  /export function classifyProviderFailure/.test(trips) &&
  /detail: classifyProviderFailure\(message\)/.test(trips))
ok("'untracked' is re-armed once a tracker actually exists",
  /eq\(demoGatePassTrips\.status, 'untracked'\)/.test(trips) && /EXISTS \(SELECT 1 FROM demo_vehicle_trackers/.test(trips))
ok('a cooldown stops overlapping runs burning the retry budget',
  /updatedAt\} < now\(\) - interval '15 minutes'/.test(trips))
ok('the route and alert locations are redacted for non-approvers',
  /canSeeRoute/.test(detailRoute) && /timeline: \[\], alerts: \[\]/.test(detailRoute))
ok('alerts may fail without discarding a distance that arrived',
  /fetchAlerts\([^)]*\)\.catch\(/.test(trips))

// Reconciliation must never delay or break the live half.
/*
 * ⚠️ Matched on the call NAME, not on its argument list. The first version of this assertion looked
 * for the literal `runTripReconciliation()` and broke the moment a deadline argument was added —
 * failing correct code, which is exactly the trap this suite caught in verify-group-service-approvals.
 */
{
  const syncRoute = read('app/api/gate-pass/tracking/sync/route.ts')
  ok('reconciliation runs AFTER positions and cannot fail the sync',
    syncRoute.indexOf('runLoconavSync(') < syncRoute.indexOf('runTripReconciliation(') &&
    /trips = \{ error:/.test(syncRoute))
}

// Page paths must survive an unapplied 0058.
ok('the trip read returns null rather than throwing', /catch \(error\)[\s\S]{0,200}return null/.test(trips))
ok('the pass detail asks for the trip through the safe reader', /getTripForPass/.test(detailRoute))

// And the honest-null rule: no row is not the same as no problem.
ok('the detail distinguishes "not checked" from "no discrepancy"',
  /Not checked/.test(detailPanel) && /No tracker/.test(detailPanel) && /No GPS data/.test(detailPanel))

// Timeline averages are not a top speed.
ok('the speed figure is documented as a segment average, not a maximum',
  /averageSpeed, not a top speed/.test(trips) && /maxSegmentAverageSpeedKph/.test(trips))

// Phase 2 client calls use seconds, like phase 1.
ok('timeline and alerts use UNIX SECONDS',
  (client.match(/Math\.floor\(startTime\.getTime\(\) \/ 1000\)/g) || []).length >= 3)

/* ------------------------------------------------------------------ 4. the module tripwire */

console.log('\n4. The gate pass module boundary still holds')

const FORBIDDEN = ['kia_trips', 'kia_vehicle', 'kia_employees', 'am_hyundai_trips', 'mg_trips', 'TATA_trips']
for (const f of ['lib/loconav/client.ts', 'lib/loconav/positions.ts', 'lib/loconav/sync.ts', 'app/api/gate-pass/tracking/sync/route.ts']) {
  const src = read(f)
  const hit = FORBIDDEN.filter((t) => src.includes(t))
  ok(`${f} names no separate-application table`, hit.length === 0, hit.join(', '))
}

/* ------------------------------------------------------------------ 5. live data */

async function live() {
  const url = process.env.DATABASE_URL
  if (!url) { console.log('\n5. Live data — SKIPPED (no DATABASE_URL)'); return }
  console.log('\n5. Live data')
  const sqlc = postgres(url, { prepare: false, max: 2 })
  try {
    const tables = await sqlc<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('demo_vehicle_trackers','demo_vehicle_positions','loconav_sync_state')`
    const names = tables.map((t) => t.table_name)
    const applied = names.length === 3
    ok('migration 0057 is applied', applied, applied ? 'all three tables exist' : `found: ${names.join(', ') || 'none'} — apply on port 5432, not the pooler`)

    if (!applied) {
      console.log('        Everything below needs 0057. Skipping the rest of the live checks.')
      return
    }

    for (const t of ['demo_vehicle_trackers', 'demo_vehicle_positions', 'loconav_sync_state']) {
      const grants = await sqlc<any[]>`
        SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_name = ${t} AND grantee IN ('anon','PUBLIC')`
      ok(`${t} grants nothing to anon/PUBLIC`, grants.length === 0, `${grants.length} grant(s)`)
    }

    // 0058 is phase 2 and ships separately — reported, not failed, so phase 1 stays green without it.
    const trips58 = await sqlc<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name='demo_gate_pass_trips'`
    if (trips58[0].n === 1) {
      const g = await sqlc<any[]>`
        SELECT grantee FROM information_schema.role_table_grants
        WHERE table_name='demo_gate_pass_trips' AND grantee IN ('anon','PUBLIC')`
      ok('migration 0058 is applied', true, 'demo_gate_pass_trips exists')
      ok('demo_gate_pass_trips grants nothing to anon/PUBLIC', g.length === 0, `${g.length} grant(s)`)
      const st = await sqlc<any[]>`
        SELECT status, COUNT(*)::int AS n FROM demo_gate_pass_trips GROUP BY 1 ORDER BY 2 DESC`
      console.log(`  NOTE  reconciled trips: ${st.map((r) => `${r.status}=${r.n}`).join(', ') || 'none yet'}`)
    } else {
      console.log('  NOTE  migration 0058 (demo_gate_pass_trips) is NOT applied — trip reconciliation is inert.')
    }

    // A tracker row per VIN and a VIN per tracker row — the two collisions that would put one car's
    // position on another car.
    const [dupes] = await sqlc<any[]>`
      SELECT
        (SELECT COUNT(*)::int FROM (SELECT vin FROM demo_vehicle_trackers GROUP BY vin HAVING COUNT(*) > 1) a) AS dup_vin,
        (SELECT COUNT(*)::int FROM (SELECT provider, provider_vehicle_uuid FROM demo_vehicle_trackers
          GROUP BY 1,2 HAVING COUNT(*) > 1) b) AS dup_uuid`
    ok('no VIN is mapped twice', dupes.dup_vin === 0, `${dupes.dup_vin}`)
    ok('no provider vehicle is claimed by two VINs', dupes.dup_uuid === 0, `${dupes.dup_uuid}`)

    // Coverage, reported rather than asserted — it is a hardware fact, not a code fault.
    const cover = await sqlc<any[]>`
      WITH demo AS (
        SELECT DISTINCT ON (UPPER(TRIM(vin_no))) UPPER(TRIM(vin_no)) AS vin
        FROM kia_demo_car_list WHERE UPPER(TRIM(test_drive_vin))='YES' AND COALESCE(vin_no,'') <> ''
        ORDER BY UPPER(TRIM(vin_no)), uploaded_at DESC)
      SELECT COUNT(*)::int AS demo_vins,
             COUNT(*) FILTER (WHERE d.tracker_status = 'installed')::int AS flagged_installed,
             COUNT(*) FILTER (WHERE t.vin IS NOT NULL)::int AS mapped_to_loconav
      FROM demo d2 JOIN demo ON TRUE AND demo.vin = d2.vin
      LEFT JOIN demo_vehicle_details d ON UPPER(TRIM(d.vehicle_key)) = demo.vin
      LEFT JOIN demo_vehicle_trackers t ON t.vin = demo.vin`
    const c = cover[0]
    console.log(`  NOTE  demo VINs ${c.demo_vins} · flagged tracker_status='installed' ${c.flagged_installed} · mapped to LocoNav ${c.mapped_to_loconav}`)
    if (c.mapped_to_loconav === 0) {
      console.log("        Nothing mapped yet — run the sync once LOCONAV_API_TOKEN is set.")
    }
    if (c.flagged_installed > 0 && c.mapped_to_loconav > 0 && c.mapped_to_loconav < c.flagged_installed) {
      console.log(`        ⚠️ ${c.flagged_installed - c.mapped_to_loconav} car(s) are flagged as having a tracker but did not map — either a different vendor, or the chassis number differs.`)
    }
  } finally {
    await sqlc.end()
  }
}

live()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((e) => { console.error('verifier crashed:', e); process.exit(1) })
