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
 * ⚠️ AND THE ONE AFTER IT. On the live account LocoNav's chassisNumber holds a plate or free text for
 * 17 of 18 vehicles (2026-09-11), so the VIN rule linked one car. Links are now confirmed by a person
 * on the Trackers screen (matched_by = 'manual'). A plate may SUGGEST a car there and nothing more; a
 * link is audited in the same transaction that writes it; and a car that has left the demo fleet is
 * never polled, because its position is now where a customer is.
 *
 * Read-only. Never calls LocoNav: it asserts on source, runs the pure helpers in lib/loconav/timeline.ts
 * and matching.ts, drives lib/loconav/client.ts against a STUBBED fetch, and SELECTs from our database.
 *
 *   npm run verify:loconav
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import postgres from 'postgres'
import ts from 'typescript'
import {
  classifyMovement,
  dedupeAlertsById,
  groupAlerts,
  sliceCount,
  sliceWindow,
  summariseSegments,
} from '../lib/loconav/timeline'
import { extractPlateTokens, modelWordIn, suggestTrackerLinks } from '../lib/loconav/matching'
/*
 * client.ts imports only 'server-only', which tsconfig.verify.json maps to scripts/_shims/empty.ts — so
 * the real request code can be exercised here. Nothing else server-only is imported: mappings.ts, sync.ts
 * and trips.ts open the database on import, and are checked on their source instead.
 */
import {
  fetchAlerts,
  fetchDistanceTravelled,
  fetchLastKnown,
  fetchTimeline,
  getLoconavRateLimitHint,
  isLoconavConfigured,
  isLoconavRateLimited,
  listAllVehicles,
  loconavBase,
  LoconavHttpError,
  LoconavRateLimitError,
} from '../lib/loconav/client'

const ROOT = join(__dirname, '..')
let pass = 0
let fail = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** Strips comments so a rule described in prose does not count as a rule enforced in code. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The bracketed text starting at `open` — a `(` or a `{` — with nesting counted, so a nested sql`` template
 * or block stays inside. Empty when `open` is not found.
 */
function enclosed(src: string, open: number): string {
  if (open < 0) return ''
  const [o, c] = src[open] === '{' ? ['{', '}'] : ['(', ')']
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++
    else if (src[i] === c && --depth === 0) return src.slice(open, i + 1)
  }
  return ''
}

/** One exported function, from its signature to the next top-level export. */
function exportedFunction(src: string, name: string): string {
  const at = src.search(new RegExp(`export\\s+async\\s+function\\s+${name}\\b`))
  if (at < 0) return ''
  const next = src.slice(at + 1).search(/\nexport\s/)
  return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next)
}

/**
 * A self-contained function lifted out of a module this script cannot import — sync.ts and mappings.ts open the
 * database on import — compiled on its own and returned callable, so its BEHAVIOUR is tested rather than its spelling.
 * It may use nothing from its module's scope. Null when it is missing or does not compile.
 */
function pureFunctionFrom(src: string, name: string): ((...args: unknown[]) => unknown) | null {
  const at = src.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`))
  if (at < 0) return null
  const paramsAt = src.indexOf('(', at)
  const bodyAt = src.indexOf('{', paramsAt + enclosed(src, paramsAt).length)
  const body = enclosed(src, bodyAt)
  if (!body) return null
  const js = ts.transpileModule(src.slice(at, bodyAt) + body, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  try {
    return new Function(`${js}\nreturn ${name}`)() as (...args: unknown[]) => unknown
  } catch {
    return null
  }
}

/** Every code file under a directory, as repo-relative paths. */
const codeFiles = (dir: string) =>
  (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
    .filter((f) => /\.(?:ts|tsx|js|mjs)$/.test(f))
    .map((f) => join(dir, f))

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
const mappings = read('lib/loconav/mappings.ts')
const mappingsRoute = read('app/api/gate-pass/tracking/mappings/route.ts')

ok('positions.ts does not import the client\'s fetching functions',
  !/import\s*\{[^}]*(fetchLastKnown|listAllVehicles|fetchDistanceTravelled)[^}]*\}\s*from\s*'\.\/client'/.test(positions))
ok('positions.ts reads from Drizzle tables', /demoVehiclePositions/.test(positions) && /demoVehicleTrackers/.test(positions))
ok('fleet.ts imports positions, not the LocoNav client',
  /from '@\/lib\/loconav\/positions'/.test(fleet) && !/from '@\/lib\/loconav\/client'/.test(fleet))
ok('fleet.ts fetches positions ONCE, outside the per-vehicle map',
  /const positions = await getPositionsForVins\(/.test(fleet) &&
  !/\.map\((?:[^)]*)=>\s*\{[\s\S]{0,400}await getPositionsForVins/.test(fleet))

// The Trackers screen is a page path too: it links from the snapshot the sync keeps, never from LocoNav.
ok('mappings.ts and its route never import the LocoNav client',
  [mappings, mappingsRoute].every((src) =>
    !/(?:from|import|require)\s*\(?\s*['"](?:\.\/client|@\/lib\/loconav\/client)['"]/.test(src)))
ok('the Trackers screen calls no provider-fetching function, server or route',
  [mappings, mappingsRoute].every((src) =>
    !/\b(?:runLoconavSync|runTripReconciliation|listAllVehicles|fetchLastKnown|fetchDistanceTravelled|fetchTimeline|fetchAlerts|fetchLiveShareLink)\s*\(/
      .test(stripComments(src))))
{
  // A value import of a server-only module from a client component is how provider code reaches a browser bundle.
  const panelImports = [...read('features/gate-pass/trackers-panel.tsx')
    .matchAll(/import\s+(type\s+)?[^'"]*?\s+from\s+'@\/lib\/loconav\/(\w+)'/g)]
  ok('the Trackers panel imports only the pure helpers by value — server modules as types only',
    panelImports.every((m) => ['timeline', 'matching'].includes(m[2]) || Boolean(m[1])),
    panelImports.map((m) => `${m[1] ? 'type ' : ''}${m[2]}`).join(', '))
}

// server-only is what stops any of this reaching a client bundle.
for (const f of ['lib/loconav/client.ts', 'lib/loconav/positions.ts', 'lib/loconav/sync.ts', 'lib/loconav/trips.ts', 'lib/loconav/mappings.ts']) {
  ok(`${f} is server-only`, read(f).startsWith("import 'server-only'"))
}
// And the opposite: the pure helpers import nothing, which is what lets section 3f run them here.
for (const f of ['lib/loconav/timeline.ts', 'lib/loconav/matching.ts']) {
  ok(`${f} imports nothing — no database, no provider, no server-only`, !/^\s*import\s/m.test(stripComments(read(f))))
}

/* ------------------------------------------------------------------ 3. configuration + safety */

console.log('\n3. Unconfigured must mean "off", not "broken"')

{
  /*
   * ⚠️ The old name was read in production while .env set LOCO_AUTH_TOKEN, so every 15-minute run logged
   * "not configured" and nothing was ever tracked. Section 4b proves client.ts reads LOCO_AUTH_TOKEN
   * lazily and ignores the old name; this proves nothing else still reads the old one.
   */
  const stale = [...codeFiles('lib'), ...codeFiles('app'), ...codeFiles('features'), 'scripts/loconav-sync-scheduler.mjs']
    .filter((f) => stripComments(read(f)).includes('LOCONAV_API_TOKEN'))
  ok('nothing in lib/, app/, features/ or the scheduler reads the old LOCONAV_API_TOKEN', stale.length === 0, stale.join(', '))
}
ok('isLoconavConfigured exists and is used by the sync', /export function isLoconavConfigured/.test(client) && /isLoconavConfigured\(\)/.test(sync))
ok('an unconfigured sync returns without calling the provider', /if \(!result\.configured\)/.test(sync))
ok('every VIN gets a tracking entry, so "no data" is never ambiguous', /not_configured/.test(positions) && /untracked/.test(positions))
ok('a stale fix is distinguished from a live one', /POSITION_LIVE_WINDOW_MS/.test(positions) && /'stale'/.test(positions))
ok('the paging loop has a hard ceiling', /maxPages/.test(client))
ok('positions.ts probes for the tables before selecting from them',
  /to_regclass\('public\.demo_vehicle_trackers'\)/.test(positions) && /trackingTablesReady/.test(positions))
ok('the sync refuses to call the provider before migrations 0057 and 0060 are applied',
  /to_regclass/.test(sync) && /Migration 0057 has not been applied/.test(sync) &&
  /to_regclass\('public\.loconav_provider_vehicles'\)/.test(sync) &&
  sync.indexOf('Migration 0060 has not been applied') > 0 &&
  sync.indexOf('Migration 0060 has not been applied') < sync.indexOf('await listAllVehicles('))

const route = read('app/api/gate-pass/tracking/sync/route.ts')
ok('the sync route uses the fail-closed cron guard', /authorizeCronRequest/.test(route))
ok('the manual fallback requires approve, not view', /requireGatePassAccess\('gate_pass\.approve'\)/.test(route))
ok('the route exports GET and POST', /export const GET/.test(route) && /export const POST/.test(route))
{
  /*
   * ⚠️ An allowlist, not a search for one sentence — which passed while any detail sat beside it. Every response the
   * route's failure path builds may hold only fixed literals, the rate-limit test, and its `error:`/`status:` keys, so
   * `detail: error.message` or a template interpolating the error fails.
   */
  const src = stripComments(route)
  const outerCatch = enclosed(src, src.indexOf('{', src.lastIndexOf('catch (error)')))
  const responses = [...outerCatch.matchAll(/NextResponse\.json\(/g)]
    .map((m) => enclosed(outerCatch, m.index! + 'NextResponse.json'.length))
  const leftovers = responses.map((r) => r
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`$]*`/g, '')
    .replace(/\bisLoconavRateLimited\(error\)/g, '')
    .replace(/\b(?:error|status)\s*:/g, '')
    .replace(/\b\d+\b/g, '')
    .replace(/[\s{}(),?:]/g, ''))
  ok('provider error detail is not returned to the caller — the failure response is fixed text only',
    responses.length > 0 && leftovers.every((l) => l === ''), leftovers.filter(Boolean).join(' | '))
}
{
  // The account allows 20 requests per window: a double-clicked Sync now must not spend the cron's share.
  const src = stripComments(route)
  const manualAt = src.indexOf('{', src.indexOf('if (!cron.ok)'))
  const manualBlock = enclosed(src, manualAt)
  const refusals = [...src.matchAll(/status: 429/g)]
  ok('a manual Sync now inside the cooldown gets 429, and a cron call never reaches that check',
    manualAt > 0 && refusals.length > 0 &&
    refusals.every((m) => m.index! > manualAt && m.index! < manualAt + manualBlock.length))
}

/* ------------------------------------------------------------------ 3b. review fixes */

console.log('\n3b. Defects found by adversarial review — each locked in')

const route2 = read('app/api/gate-pass/fleet/route.ts')
const scheduler = read('scripts/loconav-sync-scheduler.mjs')
const panel = read('features/gate-pass/fleet-panel.tsx')

// A human pin must keep its MAPPING, not just its label.
ok('a manual tracker pin is not repointed by the sync',
  /WHERE demo_vehicle_trackers\.matched_by <> 'manual'/.test(sync))

// The table has a SECOND unique index that ON CONFLICT (vin) does not arbitrate.
{
  /*
   * ⚠️ Run, not read. Drizzle 0.45 rethrows every driver error as a DrizzleQueryError whose own `code` is undefined, so
   * a catch testing `error.code === '23505'` passed a text check while never once firing, and one tracker collision
   * aborted every sync. The helper is lifted out of sync.ts and called on a real DrizzleQueryError.
   */
  const syncCode = stripComments(sync)
  const pgErrorCode = pureFunctionFrom(syncCode, 'pgErrorCode')
  const wrapped = new DrizzleQueryError('INSERT INTO demo_vehicle_trackers …', [], Object.assign(new Error('duplicate key'), { code: '23505' }))
  const catchAt = syncCode.indexOf('catch (error)', syncCode.indexOf('INSERT INTO demo_vehicle_trackers'))
  const upsertCatch = catchAt < 0 ? '' : enclosed(syncCode, syncCode.indexOf('{', catchAt))
  ok("a 23505 on the provider-uuid index skips one car instead of killing the run — read through Drizzle's wrapper",
    pgErrorCode !== null && pgErrorCode(wrapped) === '23505' && pgErrorCode({ code: '23505' }) === '23505' &&
    pgErrorCode(new Error('no code')) === '' &&
    /if \(pgErrorCode\(error\) === '23505'\)\s*continue\b/.test(upsertCatch) && !/\berror\??\.code\b|as \{ code\?/.test(upsertCatch),
    pgErrorCode ? `DrizzleQueryError → '${String(pgErrorCode(wrapped))}'` : 'pgErrorCode not found in sync.ts')
  ok('the Trackers screen reads the SQLSTATE through the same helper — not a second copy',
    /import\s*\{[^}]*\bpgErrorCode\b[^}]*\}\s*from\s*'\.\/sync'/.test(mappings) && !/function\s+pgCode\b/.test(mappings) &&
    /pgErrorCode\(error\) === '23505'/.test(stripComments(mappings)))
}

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
// (last_known's page size is proven against a stubbed fetch in section 4b.)

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
const tripsCode = stripComments(trips)
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

const tripCalls = [...tripsCode.matchAll(/\b(?:fetchDistanceTravelled|fetchTimeline|fetchAlerts)\(/g)]
const tripCallArgs = (m: RegExpMatchArray) => enclosed(tripsCode, m.index! + m[0].length - 1)
{
  /*
   * ⚠️ WORST_CASE_PASS_MS is one call's worst case, and that is only true while every call of a pass starts
   * at once: fetched one after another, a three-day pass is 7 × that and walks through the request deadline.
   * Read from the constants, so the policy can be tuned without editing this — but not outgrown.
   */
  const policy = /TRIP_REQUEST_POLICY = \{ attempts: (\d+), timeoutMs: ([\d_]+) \}/.exec(tripsCode)
  const worst = /WORST_CASE_PASS_MS = ([\d_]+)(?: \+ ([\d_]+))?/.exec(tripsCode)
  const n = (s: string | undefined) => Number(String(s ?? '0').replace(/_/g, ''))
  const attempts = n(policy?.[1])
  // client.ts backs off attempt × 1500 ms between tries.
  const worstCallMs = attempts * n(policy?.[2]) + Array.from({ length: Math.max(attempts - 1, 0) }, (_, i) => (i + 1) * 1500)
    .reduce((a, b) => a + b, 0)
  const passCalls = enclosed(tripsCode, tripsCode.indexOf('(', tripsCode.indexOf('await Promise.all(')))
  ok('every trip call runs on the tight policy, all at once, so WORST_CASE_PASS_MS covers a whole pass',
    Boolean(policy) && Boolean(worst) && tripCalls.length >= 3 &&
    tripCalls.every((m) => tripCallArgs(m).includes('TRIP_REQUEST_POLICY') && passCalls.includes(m[0] + tripCallArgs(m).slice(1))) &&
    n(worst?.[1]) + n(worst?.[2]) > worstCallMs,
    `worst call ${worstCallMs} ms, WORST_CASE_PASS_MS ${n(worst?.[1]) + n(worst?.[2])} ms`)
}
{
  /*
   * The property, not a spelling: the deadline the route hands the sweep must be later than one whole pass, and must
   * leave the response room inside maxDuration. A named constant or a different number is judged on those terms — and
   * so is a shorter maxDuration, which the old literal match never looked at.
   */
  const syncRouteCode = stripComments(read('app/api/gate-pass/tracking/sync/route.ts'))
  const n = (s: string | undefined) => (s === undefined ? NaN : Number(s.replace(/_/g, '')))
  const maxDurationS = n(/export const maxDuration = ([\d_]+)/.exec(syncRouteCode)?.[1])
  const offsetToken = /deadlineMs:\s*startedAt\s*\+\s*(\w+)\s*\}/.exec(syncRouteCode)?.[1]
  const offsetMs = offsetToken === undefined ? NaN
    : /^[\d_]+$/.test(offsetToken) ? n(offsetToken)
    : n(new RegExp(`const ${offsetToken} = ([\\d_]+)`).exec(syncRouteCode)?.[1])
  const worstPass = /WORST_CASE_PASS_MS = ([\d_]+)(?: \+ ([\d_]+))?/.exec(tripsCode)
  const worstPassMs = n(worstPass?.[1]) + (worstPass?.[2] ? n(worstPass[2]) : 0)
  ok("the sweep stops before starting a pass it cannot finish, inside the route's own time limit",
    /Date\.now\(\) \+ WORST_CASE_PASS_MS > opts\.deadlineMs/.test(trips) &&
    offsetMs > worstPassMs && offsetMs + 5_000 <= maxDurationS * 1000,
    `deadline +${offsetMs} ms, maxDuration ${maxDurationS} s, worst pass ${worstPassMs} ms`)
}
ok('the odometer difference is clamped to what the column can hold', /TRIP_KM_MAX/.test(trips))
{
  /*
   * ⚠️ 'reconciled' is terminal. A timeout on one alerts slice finalised a pass as "Alerts unavailable" for good, though
   * the next tick would have answered. Until the last attempt, a timeout or 5xx on a route or alerts slice must go to
   * the failure writer; a 4xx is an answer and may be kept.
   */
  const routeAt = tripsCode.indexOf('const routeFailed')
  const keptAt = tripsCode.indexOf('const timeline = ', routeAt)
  const between = routeAt < 0 || keptAt < 0 ? '' : tripsCode.slice(routeAt, keptAt)
  ok('a timeout or 5xx on a route or alerts slice spends an attempt and is retried — only the last attempt keeps what arrived',
    /\bthrow\s+\w+\.error\b/.test(between) && /attempts[^\n]*<\s*TRIP_MAX_ATTEMPTS/.test(between) &&
    /LoconavHttpError[^\n]*status\s*(?:<|>=)\s*500/.test(between))
  const failureWriterAt = tripsCode.search(/async function writeTripFailure\b/)
  const failureWriter = failureWriterAt < 0 ? '' : tripsCode.slice(failureWriterAt, tripsCode.indexOf('type Candidate', failureWriterAt))
  ok('a late failure from an overlapping run cannot overwrite a trip row another run finished',
    /ON CONFLICT \(gate_pass_id\) DO UPDATE SET[\s\S]*WHERE demo_gate_pass_trips\.status IN \('failed', 'untracked'\)/.test(failureWriter))
}
{
  /*
   * ⚠️ A JS Date inside a raw sql`` template reaches postgres-js untouched — the drizzle driver makes the timestamp
   * serializers pass-through — and throws ERR_INVALID_ARG_TYPE. tsc accepts it (sql takes any[]), and the sweep's first
   * live run died on exactly that. Checked by TYPE, not by variable name, on every sql`` template in these files.
   */
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, ROOT)
  const files = ['trips', 'sync', 'mappings', 'positions'].map((f) => join(ROOT, 'lib', 'loconav', `${f}.ts`).replace(/\\/g, '/'))
  const program = ts.createProgram(files, { ...config.options, noEmit: true })
  const checker = program.getTypeChecker()
  const isDate = (type: ts.Type): boolean => (type.isUnion() ? type.types.some(isDate) : type.getSymbol()?.getName() === 'Date')
  const offenders: string[] = []
  let spans = 0
  for (const file of files) {
    const source = program.getSourceFile(file)
    if (!source) { offenders.push(`${file} was not loaded`); continue }
    const visit = (node: ts.Node) => {
      if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'sql' && ts.isTemplateExpression(node.template)) {
        for (const span of node.template.templateSpans) {
          spans++
          if (isDate(checker.getTypeAtLocation(span.expression))) {
            const line = source.getLineAndCharacterOfPosition(span.expression.getStart(source)).line + 1
            offenders.push(`${file.split('/').slice(-1)[0]}:${line} \${${span.expression.getText(source)}}`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  ok('no raw sql`` template in the LocoNav server code interpolates a JS Date', spans > 50 && offenders.length === 0,
    offenders.length ? offenders.join(', ') : `${spans} interpolations checked by type`)
}
ok('a timeline failure does not throw away a distance that arrived',
  /fetchTimeline\([^)]*\)\.catch\(/.test(trips))
{
  /*
   * ⚠️ `/timeline` and `/alerts` refuse a window over 86,400 s (measured 2026-09-11), so a drive that crosses
   * midnight must be asked for in day-slices — with each slice's OWN bounds, not the pass window. Distance
   * stays one call: `/distance_travelled` takes a week, and it is the figure set beside the odometer.
   */
  const slices = /const (\w+) = [^\n]*\bsliceWindow\(/.exec(tripsCode)?.[1]
  const perSlice = (fn: string) => {
    const calls = [...tripsCode.matchAll(new RegExp(`\\b${fn}\\(`, 'g'))].length
    const sliced = slices === undefined ? 0 : [...tripsCode.matchAll(new RegExp(
      `\\b${slices}\\.map\\(\\(?(\\w+)\\)?\\s*=>\\s*${fn}\\([^)]*\\b\\1\\.start\\b[^)]*\\b\\1\\.end\\b`, 'g'))].length
    return calls > 0 && calls === sliced
  }
  ok('timeline and alerts are fetched one day-slice at a time, each with its own bounds',
    /import\s*\{[^}]*\bsliceWindow\b[^}]*\}\s*from\s*'\.\/timeline'/.test(tripsCode) &&
    perSlice('fetchTimeline') && perSlice('fetchAlerts') && !/86_?400/.test(tripsCode))
  ok('distance stays ONE call over the whole window',
    [...tripsCode.matchAll(/\bfetchDistanceTravelled\(/g)].length === 1 &&
    !/\.map\([^)]*\)?\s*=>\s*fetchDistanceTravelled\(/.test(tripsCode))
}
{
  /*
   * Replaces `if (!segments.length)` in trips.ts. The empty-is-null rule — and the stop rule — moved to
   * summariseSegments in lib/loconav/timeline.ts, which section 3f runs on real sequences. What must hold
   * here is that trips.ts summarises through it and keeps no second definition of a stop.
   */
  const summary = /const (\w+) = summariseSegments\(/.exec(tripsCode)?.[1]
  ok('the drive is summarised by summariseSegments alone — one definition of a stop, and of "not measured"',
    /import\s*\{[^}]*\bsummariseSegments\b[^}]*\}\s*from\s*'\.\/timeline'/.test(tripsCode) && summary !== undefined &&
    new RegExp(`movingSeconds: ${summary}\\.movingSeconds`).test(tripsCode) &&
    new RegExp(`stopCount: ${summary}\\.stopCount`).test(tripsCode) &&
    !/function\s+summari[sz]e\w*\(/.test(tripsCode) && !/movementStatus/.test(tripsCode))
}
{
  /*
   * ⚠️ A 429 is the account's pace, not a fault in the drive. A failure row would spend one of the pass's
   * three attempts on it, and a 'reconciled' row written from half the calls is terminal — the lost route
   * would stay lost. So: every call settles to a value (nothing can reject into the failure writer), the
   * rate-limit test runs on ALL of them before anything throws, and its branch writes nothing.
   */
  const settledAt = tripsCode.indexOf('await Promise.all(')
  const limitAt = tripsCode.indexOf('isLoconavRateLimited(', settledAt)
  const limitBlock = limitAt < 0 ? '' : enclosed(tripsCode, tripsCode.indexOf('{', limitAt))
  const throwAt = tripsCode.indexOf('throw ', settledAt)
  ok('a rate-limit error writes no failure row and spends no attempt — the pass defers and the sweep stops',
    settledAt > 0 && tripCalls.length >= 3 &&
    tripCalls.every((m) => tripsCode.startsWith('.catch(', m.index! + m[0].length - 1 + tripCallArgs(m).length)) &&
    limitAt > settledAt && (throwAt < 0 || limitAt < throwAt) &&
    /\bcontinue\b|\bbreak\b/.test(limitBlock) && !/writeTrip/.test(limitBlock) && /rateLimited = true/.test(limitBlock))
}
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

// (Timeline and alerts asking in UNIX SECONDS is proven against a stubbed fetch in section 4b.)

/* ------------------------------------------------------------------ 3d. the poll set */

console.log('\n3d. The poll set — every persisted link, and only cars still in the demo fleet')
{
  const src = stripComments(sync)
  const readAt = src.indexOf('FROM demo_vehicle_trackers')
  const pollRead = readAt < 0 ? '' : src.slice(src.lastIndexOf('SELECT', readAt), src.indexOf('`', readAt))
  const pollAt = src.indexOf('await fetchLastKnown(')
  /*
   * ⚠️ Polling this run's chassis matches tracked one car, and never gave a link a person confirmed a single
   * position — on this account, nearly every link. The poll set is what demo_vehicle_trackers holds.
   */
  ok('positions are polled for links read back from demo_vehicle_trackers — manual and chassis alike',
    readAt > 0 && pollAt > readAt && !/matched_by\s*(?:=|<>|!=|\bIN\b)/i.test(pollRead))
  const loopAt = src.search(/for \(const \w+ of links\)/)
  const loop = loopAt < 0 ? '' : enclosed(src, src.indexOf('{', loopAt))
  const addAt = loop.indexOf('uuidToVin.set(')
  /*
   * The poll set may never come from the matches. The matches may still be READ after the links — to name a chassis
   * match a stored link contradicts — so what is held to this is the loop that builds the poll set, and the polling.
   */
  ok("the poll set and the position writes never consult this run's chassis matches",
    readAt > 0 && loopAt > readAt && pollAt > loopAt && !/\bmatches\b/.test(loop) && !/\bmatches\b/.test(src.slice(pollAt)))
  /*
   * Any membership test that skips before uuidToVin.set counts: `if (!map.has(id)) { … continue }`, or
   * `const v = map.get(id)` followed by `if (!v) continue`. A spelling is not the guarantee.
   */
  const skippedUnless = (map: string) => {
    const tests = [new RegExp(`if \\(!${map}\\.has\\(\\w+\\)\\)`)]
    const got = new RegExp(`const (\\w+) = ${map}\\.get\\(\\w+\\)`).exec(loop)
    if (got) tests.push(new RegExp(`if \\(!${got[1]}\\)`))
    return tests.some((test) => {
      const m = test.exec(loop)
      if (m === null || m.index > addAt) return false
      const rest = loop.slice(m.index + m[0].length)
      return /^\s*continue\b/.test(rest) || (/^\s*\{/.test(rest) && /\bcontinue\b/.test(enclosed(rest, rest.indexOf('{'))))
    })
  }
  ok("a linked car that has left the demo fleet is never polled — its position is a customer's now",
    addAt > 0 && (src.match(/uuidToVin\.set\(/g) || []).length === 1 && skippedUnless('demoByVin'))
  ok('a link whose tracker is no longer on the account is not polled', addAt > 0 && skippedUnless('providerByUuid'))
  {
    /*
     * listDemoVehiclesForGatePass answers [] when its feed is missing, and listAllVehicles when the response loses its
     * shape. Neither means every link is gone. The condition the links loop runs under — an `if`, or the `else` of a
     * negated one, inline or through a named const — must be a conjunction of both lists being non-empty.
     */
    let gate: { cond: string; inElse: boolean } | null = null
    for (const m of src.matchAll(/\bif \(/g)) {
      const cond = enclosed(src, m.index! + 3)
      const thenAt = src.indexOf('{', m.index! + 3 + cond.length)
      if (!cond || thenAt < 0 || !/^\s*$/.test(src.slice(m.index! + 3 + cond.length, thenAt))) continue
      const thenEnd = thenAt + enclosed(src, thenAt).length
      const elseAt = /^\s*else\s*\{/.test(src.slice(thenEnd)) ? src.indexOf('{', thenEnd) : -1
      const elseEnd = elseAt < 0 ? -1 : elseAt + enclosed(src, elseAt).length
      if (loopAt > thenAt && loopAt < thenEnd) gate = { cond: cond.slice(1, -1).trim(), inElse: false }
      else if (elseAt > 0 && loopAt > elseAt && loopAt < elseEnd) gate = { cond: cond.slice(1, -1).trim(), inElse: true }
    }
    // A named const is judged by its definition; `!name` and a fully bracketed `!( … )` flip the branch.
    const resolve = (expr: string) => (/^\w+$/.test(expr) ? new RegExp(`const ${expr} = ([^\\n]+)`).exec(src)?.[1]?.trim() ?? '' : expr)
    const bothListed = (expr: string) => /\bdemoByVin\.size\b/.test(expr) && /\bproviderByUuid\.size\b/.test(expr) &&
      /&&/.test(expr) && !/\|\||!(?!=)/.test(expr)
    let runsWhen = gate?.cond ?? ''
    let negated = gate?.inElse ?? true
    const bang = /^!\s*/.exec(runsWhen)
    if (bang) {
      const rest = runsWhen.slice(bang[0].length)
      if (/^\w+$/.test(rest)) { runsWhen = rest; negated = !negated }
      else if (rest.startsWith('(') && enclosed(rest, 0) === rest) { runsWhen = rest.slice(1, -1).trim(); negated = !negated }
    }
    runsWhen = resolve(runsWhen)
    ok('an empty demo fleet list, or an empty LocoNav list, polls nothing and judges no link',
      gate !== null && !negated && bothListed(runsWhen) && /demo fleet list came back empty/.test(sync),
      gate ? `${gate.inElse ? 'else of ' : ''}if (${gate.cond}) → ${runsWhen}` : 'no if around the links loop')

    // ⚠️ A run that polled nothing is not a success: it kept last_success_at fresh and "11 cars getting positions" on screen.
    const finalWriteAt = src.indexOf("status: result.errors.length ? 'ok_with_warnings' : 'ok'")
    const finalWrite = finalWriteAt < 0 ? '' : enclosed(src, src.lastIndexOf('writeSyncState(', finalWriteAt) + 'writeSyncState'.length)
    const success = resolve(/\bsuccess:\s*([^,\n]+)/.exec(finalWrite)?.[1]?.trim() ?? '')
    ok('a run that could not see both lists is not recorded as a success, and does not keep the last count on screen',
      bothListed(success) && /\bvehiclesMapped:/.test(finalWrite) && !/vehiclesMapped:[^,\n]*undefined/.test(finalWrite),
      `success: ${success || '(not found)'}`)
  }
  {
    const calls = [...src.matchAll(/\bfetchLastKnown\(/g)]
    const arg = calls.length === 1 ? enclosed(src, calls[0].index! + 'fetchLastKnown'.length) : ''
    ok('ONE last_known call covers the whole account, never one per link (20 requests per window)',
      calls.length === 1 && !loop.includes('fetchLastKnown(') && /providerByUuid/.test(arg) && !/uuidToVin/.test(arg))
  }
  {
    const after = pollAt < 0 ? '' : src.slice(pollAt)
    const lookupAt = after.search(/const vin = uuidToVin\.get\(/)
    const writeAt = after.indexOf('INSERT INTO demo_vehicle_positions')
    ok('a position row is written only for a VIN in the poll set',
      lookupAt >= 0 && writeAt > lookupAt && /if \(!vin\) continue/.test(after.slice(lookupAt, writeAt)) &&
      src.indexOf('INSERT INTO demo_vehicle_positions') > pollAt)
  }
  {
    /*
     * ⚠️ uuidToVin is read before last_known, which can take a minute and a half. An unlink and a relink in that time
     * deleted the car's position, and an unconditional upsert then wrote the OLD tracker's fix back under the new link.
     * Every position write must select FROM a CTE that re-reads this very link — its VIN and its tracker — FOR SHARE.
     */
    const cte = /WITH (\w+) AS \(/.exec(src)
    const cteBody = cte ? enclosed(src, cte.index + cte[0].length - 1) : ''
    const writes = [...src.matchAll(/INSERT INTO demo_vehicle_positions\b/g)]
      .map((m) => enclosed(src, src.lastIndexOf('db.execute(', m.index!) + 'db.execute'.length))
    ok('a position is written only while its link still stands — re-read and locked by the write itself',
      cte !== null && /\bFROM demo_vehicle_trackers\b/.test(cteBody) &&
      /provider_vehicle_uuid = \$\{p\.vehicleUuid\}/.test(cteBody) && /upper\(btrim\(vin\)\) = \$\{vin\}/.test(cteBody) &&
      /\bFOR SHARE\b/.test(cteBody) &&
      writes.length >= 2 && writes.every((w) => w.includes(`FROM ${cte![1]}`) && !/\bVALUES\b/.test(w)),
      `${writes.length} position write(s)`)
  }
  {
    // A chassis match contradicting a stored link was silent: step 4 leaves a manual link alone, and a 23505 was skipped.
    const judged = readAt > 0 && loopAt > readAt ? src.slice(readAt, loopAt) : ''
    ok('a chassis match that contradicts a stored link is named in a warning, once the links are read back',
      /for \(const \{ vin, vehicle \} of matches\)/.test(judged) && /matched_by === 'manual'/.test(judged) &&
      /Trackers screen/.test(judged) && /result\.errors\.push\(/.test(judged))
  }
  {
    /*
     * ⚠️ Two units on the account are not demo cars, and the snapshot is shown to everyone who can link one.
     * Checked on every write of the table — its column list AND whatever an ON CONFLICT sets — and on the
     * migration and the Drizzle definition, so a column cannot quietly appear in any one of the three.
     */
    const LEAK = /latitude|longitude|coordinates|phone|\braw\b|address|speed|ignition/i
    const writes = [...src.matchAll(/(?:INSERT\s+INTO|UPDATE)\s+loconav_provider_vehicles\b/g)]
      .map((m) => enclosed(src, src.lastIndexOf('db.execute(', m.index!) + 'db.execute'.length))
    const ddl = /CREATE TABLE IF NOT EXISTS public\.loconav_provider_vehicles \(([\s\S]*?)\n\);/
      .exec(read('lib/db/migrations/0060_add_loconav_tracker_mapping.sql'))?.[1].replace(/--.*$/gm, '') ?? ''
    const schema = read('lib/db/schema.ts')
    const table = stripComments(schema.slice(
      schema.indexOf('export const loconavProviderVehicles'), schema.indexOf('export const demoVehicleTrackerEvents')))
    ok('the provider snapshot stores no coordinates, raw payload or device phone number',
      writes.length >= 2 && writes.every((w) => w.length > 0 && !LEAK.test(w)) &&
      ddl.length > 0 && !LEAK.test(ddl) && table.includes("pgTable('loconav_provider_vehicles'") && !LEAK.test(table),
      `${writes.length} write(s), the 0060 DDL and the Drizzle table checked`)
  }
}

/* ------------------------------------------------------------------ 3e. the Trackers screen */

console.log('\n3e. The Trackers screen — links a person confirms, audited in the same transaction')
{
  const routeCode = stripComments(mappingsRoute)
  for (const method of ['GET', 'POST']) {
    const handler = new RegExp(`export\\s+async\\s+function\\s+${method}\\b[\\s\\S]*?(?=\\nexport\\s|\\n(?:async\\s+)?function\\s|$)`)
      .exec(routeCode)?.[0] ?? ''
    const guardAt = handler.search(/requireGatePassAccess\(\s*'gate_pass\.approve'\s*\)/)
    const deniedAt = handler.search(/if \(access\.denied\) return access\.denied/)
    const workAt = handler.search(/\b(?:getTrackerBoard|linkTracker|unlinkTracker)\(/)
    ok(`the mappings route's ${method} requires gate_pass.approve before it reads or writes anything`,
      guardAt >= 0 && deniedAt > guardAt && workAt > deniedAt)
  }
  // ⚠️ view and create admit EVERY signed-in employee, and this board lists provider uuids, plates and links.
  ok('the mappings route never settles for gate_pass.view or gate_pass.create', !/'gate_pass\.(?:view|create)'/.test(routeCode))
  // An actor id of null is the system actor, and it skips the branch-scope check.
  ok("the route's actor is always the signed-in user",
    /trackerActorFor\(access\.appUser\)/.test(routeCode) && !/\bid:\s*null/.test(routeCode))

  const code = stripComments(mappings)
  const board = exportedFunction(code, 'getTrackerBoard')
  const link = exportedFunction(code, 'linkTracker')
  const unlink = exportedFunction(code, 'unlinkTracker')

  // 0060 lands by hand, often after the deploy: a missing table must answer 503 naming it, not 500 on 42P01.
  ok('the board and both writes probe for migration 0060 before touching a table',
    /to_regclass\('public\.loconav_provider_vehicles'\)/.test(code) &&
    /to_regclass\('public\.demo_vehicle_tracker_events'\)/.test(code) &&
    /Migration 0060 has not been applied[^)]*,\s*503\)/.test(code) &&
    [board, link, unlink].every((fn) => {
      const probeAt = fn.indexOf('assertMappingTablesReady()')
      const firstRead = fn.search(/\bdb\s*\.|listDemoVehiclesForGatePass\(/)
      return probeAt > 0 && (firstRead < 0 || probeAt < firstRead)
    }))

  const transactionOf = (fn: string) => {
    const m = /db\.transaction\(\s*async\s*\(\s*(\w+)\s*\)/.exec(fn)
    return m ? { handle: m[1], body: fn.slice(m.index) } : null
  }
  const onTx = (tx: { handle: string; body: string } | null, call: RegExp) =>
    tx !== null && new RegExp(`\\b${tx.handle}\\s*\\.${call.source}`).test(tx.body)
  const writesOutsideTx = (fn: string) =>
    /\bdb\s*\.\s*(?:insert|update|delete)\(|\bdb\s*\.\s*execute\(\s*sql`\s*(?:INSERT|UPDATE|DELETE)/i.test(fn)
  const linkTx = transactionOf(link)
  const unlinkTx = transactionOf(unlink)

  ok('link writes the link and its audit row on ONE transaction — both commit or neither does',
    onTx(linkTx, /insert\(\s*demoVehicleTrackers\s*\)/) && onTx(linkTx, /insert\(\s*demoVehicleTrackerEvents\s*\)/) &&
    !writesOutsideTx(link))
  ok('unlink removes the link and writes its audit row on ONE transaction',
    onTx(unlinkTx, /delete\(\s*demoVehicleTrackers\s*\)/) && onTx(unlinkTx, /insert\(\s*demoVehicleTrackerEvents\s*\)/) &&
    !writesOutsideTx(unlink))
  const move = exportedFunction(code, 'moveTracker')
  {
    /*
     * ⚠️ The filter is IN the DELETE, so a row that became a chassis link after the read is still not removed. Unlink and
     * Move are the only code that removes a link, and neither may take away a chassis link — that is LocoNav's claim.
     * (This used to also require every delete to sit inside unlinkTracker, which Move's own guarded delete broke.)
     */
    const deletes = [...code.matchAll(/\.delete\(\s*demoVehicleTrackers\s*\)([\s\S]*?)(?=\n\s*(?:await|return|if|const|let|throw)\b|$)/g)]
    ok("a link is only ever removed with matched_by = 'manual' in the DELETE itself, and only by unlink or move",
      deletes.length >= 2 && deletes.every((m) => /matchedBy\s*,\s*'manual'\s*\)/.test(m[1]) &&
        (unlink.includes(m[0]) || move.includes(m[0]))) &&
      !/DELETE\s+FROM\s+(?:public\.)?demo_vehicle_trackers\b/i.test(code))
  }
  {
    /*
     * Owner decision 2026-09-11: trackers are physically moved from a sold car to another demo car. The move must be all
     * or nothing — a half-done move leaves a tracker on no car, or on two — and each car's history must say what happened.
     */
    const moveTx = transactionOf(move)
    const body = moveTx?.body ?? ''
    ok('moving a tracker is ONE transaction: old link out, both cars cleared, a new manual link in, unlink AND link audit rows',
      move.length > 0 && onTx(moveTx, /delete\(\s*demoVehicleTrackers\s*\)/) &&
      onTx(moveTx, /delete\(\s*demoVehiclePositions\s*\)\s*\.where\(\s*or\(\s*positionVinIs\(\s*fromVin\s*\)\s*,\s*positionVinIs\(\s*toVin\s*\)\s*\)/) &&
      onTx(moveTx, /insert\(\s*demoVehicleTrackers\s*\)\s*\.values\(\{[^}]*matchedBy:\s*'manual'/) &&
      onTx(moveTx, /insert\(\s*demoVehicleTrackerEvents\s*\)/) &&
      /action:\s*'unlink'\s*,\s*vin:\s*fromVin/.test(body) && /action:\s*'link'\s*,\s*vin:\s*toVin/.test(body) &&
      !writesOutsideTx(move))
    const guardAt = code.search(/function\s+assertMovableFrom\b/)
    const guard = guardAt < 0 ? '' : enclosed(code, code.indexOf('{', code.indexOf(')', guardAt)))
    ok('a move starts only from a manual link to the car the person saw, and refuses a chassis link (409)',
      /matchedBy/.test(guard) && /TrackerMappingError\([\s\S]*?,\s*409\s*\)/.test(guard) &&
      body.indexOf('assertMovableFrom(') >= 0 && body.indexOf('assertMovableFrom(') < body.search(/\.delete\(\s*demoVehicleTrackers\s*\)/))
    const txAt = move.indexOf('db.transaction(')
    const scopeChecks = (move.slice(0, txAt < 0 ? 0 : txAt).match(/if\s*\(\s*!carInScope\(\s*input\.actor\s*,/g) || []).length
    ok("a move checks the actor's branch for BOTH cars before its transaction", txAt > 0 && scopeChecks >= 2)
    ok("unlink and move find a sold car's branch from the demo feed, ignoring the sold flag",
      /lookupDemoCarBranchesByVin\(/.test(code) && [unlink, move].every((fn) => /outOfFleetBranches\(/.test(fn)))
    ok("the route's POST reaches moveTracker only after the approve guard",
      (() => {
        const post = /export\s+async\s+function\s+POST\b[\s\S]*$/.exec(routeCode)?.[0] ?? ''
        const g = post.search(/if \(access\.denied\) return access\.denied/)
        return g >= 0 && post.search(/\bmoveTracker\(/) > g
      })())
  }
  {
    /*
     * Owner decision 2026-09-11: a drive from before its tracker was linked is still checked, but MARKED — a later or
     * wrong link must never silently brand an old drive as a mismatch.
     */
    const readerAt = tripsCode.search(/async\s+function\s+readLinkedAfterDrive\b/)
    const reader = readerAt < 0 ? '' : enclosed(tripsCode, tripsCode.indexOf('{', tripsCode.indexOf(')', tripsCode.indexOf('(', readerAt))))
    ok('a drive checked with a tracker linked after it is marked, from the link time, never failing the read',
      /linkedAfterDrive:\s*\{\s*linkedAt:\s*string\s*\}\s*\|\s*null/.test(tripsCode) &&
      /linkedAfterDrive:\s*row\.providerVehicleUuid\s*\?\s*linkedAfterDrive\s*:\s*null/.test(tripsCode) &&
      /action\s*=\s*'link'/.test(reader) && /COALESCE\(\s*\w+\.reconciled_at\s*,\s*\w+\.updated_at\s*\)/.test(reader) &&
      /demo_vehicle_trackers/.test(reader) && /window_start/.test(reader) && /\bcatch\b[\s\S]*return null/.test(reader))
    ok('the pass detail says the drive was checked with a later link, and never calls the gap a proven mismatch',
      /linkedAfterDrive/.test(detailPanel) && /after this drive/.test(detailPanel) &&
      /may be because the tracker was not on this car at the time/.test(detailPanel))
  }
  {
    // ⚠️ A silent move takes a position away from a car somebody may be looking for right now.
    const insertAt = linkTx ? linkTx.body.search(/\.insert\(\s*demoVehicleTrackers\s*\)/) : -1
    const refusals = insertAt < 0 ? 0
      : (linkTx!.body.slice(0, insertAt).match(/new TrackerMappingError\([\s\S]*?,\s*409\s*,?\s*\)/g) || []).length
    ok('link refuses a car or a tracker that is already linked (409), and never moves a link',
      refusals >= 2 && /'23505'[\s\S]{0,200}409/.test(link) &&
      !/\.(?:update|delete)\(\s*demoVehicleTrackers\s*\)|onConflictDo(?:Update|Nothing)|ON CONFLICT/i.test(link))
  }
  ok("link and unlink both clear the car's position in their transaction — a new link inherits none",
    [linkTx, unlinkTx].every((tx) => onTx(tx, /delete\(\s*demoVehiclePositions\s*\)\s*\.where\([^\n]*\bvin\b/)))
  ok("every link the screen writes is matched_by 'manual'",
    /\.insert\(\s*demoVehicleTrackers\s*\)\s*\.values\(\{[^}]*matchedBy:\s*'manual'/.test(link))
  // ⚠️ A plate is not an identity. A suggestion is a prompt to look; nothing may turn one into a link.
  ok('a suggestion is never applied — link and unlink never consult it, and the sync does not import matching.ts',
    /suggestTrackerLinks\(/.test(board) && !/suggestTrackerLinks/.test(link + unlink) &&
    !/['"](?:\.\/matching|@\/lib\/loconav\/matching)['"]/.test(sync))
  {
    /*
     * demo_vehicle_tracker_events is the only record of why a car shows the location it shows. 0060's trigger
     * refuses UPDATE and DELETE (checked live below); this keeps any code path from even trying.
     */
    const MUTATES_AUDIT = [
      /\.(?:update|delete)\(\s*demoVehicleTrackerEvents\s*\)/,
      /\.insert\(\s*demoVehicleTrackerEvents\s*\)\s*\.values\(\{[^}]*\}\)\s*\.onConflictDoUpdate\(/,
      /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?(?:public\.)?"?demo_vehicle_tracker_events\b/i,
      /INSERT\s+INTO\s+(?:public\.)?demo_vehicle_tracker_events\b[^`]*\bDO\s+UPDATE\b/i,
      /from\(\s*['"]demo_vehicle_tracker_events['"]\s*\)\s*\.\s*(?:update|delete|upsert)\(/,
    ]
    const offenders = [...codeFiles('lib'), ...codeFiles('app')]
      .filter((f) => { const src = stripComments(read(f)); return MUTATES_AUDIT.some((re) => re.test(src)) })
    ok('no code in lib/ or app/ issues UPDATE or DELETE against demo_vehicle_tracker_events',
      offenders.length === 0, offenders.join(', '))
  }

  // ⚠️ gate_pass.approve applies no dealer scope: carInScope is the only branch pin on link and unlink.
  for (const [name, fn] of [['linkTracker', link], ['unlinkTracker', unlink]] as const) {
    // car.dealerCode (link) and car?.dealerCode ?? null (unlink): the branch comes from the fleet row, never the body.
    const ifAt = fn.search(/if\s*\(\s*!carInScope\(\s*input\.actor\s*,\s*car\??\.dealerCode/)
    const block = ifAt < 0 ? '' : enclosed(fn, fn.indexOf('{', ifAt))
    const txAt = fn.indexOf('db.transaction(')
    ok(`${name} refuses a car outside the actor's branches (403) before its transaction`,
      ifAt >= 0 && txAt > ifAt && /\bthrow\b/.test(block) && /TrackerMappingError\([^)]*,\s*403\s*\)/.test(block))
  }
  {
    const scopeAt = code.search(/function\s+carInScope\b/)
    const scope = scopeAt < 0 ? '' : enclosed(code, code.indexOf('{', scopeAt))
    ok('carInScope is the gate-pass dealer-scope rule, and only the system actor bypasses it',
      /import\s*\{[^}]*\bisDealerInScope\b[^}]*\}\s*from\s*'@\/lib\/gate-pass\/access'/.test(code) &&
      /isDealerInScope\(\s*actor\.appUser\s*,\s*dealerCode\s*\)/.test(scope) &&
      /canSeeAllGatePassDealers\(\s*actor\.appUser\s*\)/.test(scope) &&
      /actor\.id\s*===\s*null\s*\)\s*return\s+true/.test(scope) && (scope.match(/return\s+true\b/g) || []).length === 1)
  }
  {
    /*
     * Two approvers confirming the same link at once: the loser's INSERT hits the unique index after the winner commits.
     * The link it asked for exists — alreadyDone, not "Not linked" — and only a re-read OUTSIDE the rolled-back
     * transaction can tell.
     */
    const linkCatch = enclosed(link, link.indexOf('{', link.lastIndexOf('catch (error)')))
    const restand = /'23505'[^\n]*await\s+(\w+)\([^\n]*alreadyDone:\s*true/.exec(linkCatch)
    const helperAt = restand ? code.search(new RegExp(`function\\s+${restand[1]}\\b`)) : -1
    const helper = helperAt < 0 ? '' : enclosed(code, code.indexOf('{', code.indexOf(')', helperAt)))
    ok('an identical link confirmed twice at once answers alreadyDone, re-read outside the rolled-back transaction',
      restand !== null && restand.index < linkCatch.search(/,\s*409\s*\)/) &&
      /\bdb\s*\.\s*select\(/.test(helper) && !/\btx\b/.test(helper) && /\bcatch\b/.test(helper))
  }
  {
    /*
     * ⚠️ loconav_sync_state keeps a failed run's raw error — LocoNav's response body, or Drizzle's "Failed query: <SQL>
     * params: …" — and the board goes to every approver. Run on the texts the sync really stores.
     */
    const boardSyncDetail = pureFunctionFrom(code, 'boardSyncDetail')
    type Shown = { detail: string | null; warnings: string[] } | undefined
    const shown = (status: string, detail: string) => boardSyncDetail?.(status, detail) as Shown
    const vendor = shown('failed', 'LocoNav /vehicles/telematics/last_known failed: HTTP 503 <html>upstream body 8612345678901234</html>')
    const query = shown('failed', 'Failed query: INSERT INTO demo_vehicle_positions (vin) VALUES ($1)\nparams: MZBGB814LRN218184')
    const auth = shown('failed', 'LocoNav auth failed: HTTP 401 {"errors":["token abc123 revoked"]}')
    const limit = shown('failed', 'LocoNav rate limit reached — the next run will retry.')
    const warned = shown('ok_with_warnings',
      'mapped 11/29 demo VINs to 18 LocoNav vehicles; 11 positions updated; 2 warning(s) :: VIN A is no longer in the demo fleet — not polled | ' +
      'VIN B matches 2 LocoNav vehicles by chassis number — skipped :: Trip reconciliation failed — drive checks did not run this time.')
    const raw = [vendor, query, auth]
    ok("the Trackers board never shows a failed run's raw provider or database text",
      boardSyncDetail !== null &&
      raw.every((r) => typeof r?.detail === 'string' && !/upstream|INSERT|params|MZBGB|8612|abc123|html/i.test(r.detail)) &&
      /HTTP 503/.test(vendor?.detail ?? '') && limit?.detail === 'LocoNav rate limit reached — the next run will retry.' &&
      /boardSyncDetail\(\s*state\.lastRunStatus\s*,\s*state\.lastRunDetail\s*\)/.test(code) && !/lastRunDetail:\s*state\.lastRunDetail/.test(code),
      JSON.stringify(raw.map((r) => r?.detail)))
    ok("a run's warnings reach the board one by one, without the counters in front of them",
      warned?.detail === null && warned.warnings.length === 3 && warned.warnings.every((w) => !/mapped \d+\/\d+/.test(w)),
      JSON.stringify(warned?.warnings))
  }
  {
    /*
     * ⚠️ The page shows the Trackers panel by the resolution the route enforces. Swapped for the client's role list
     * (isGatePassApproverRole), a ceo sees a panel that answers 403 and an Access-Map grantee never sees it at all.
     */
    const pageCode = stripComments(read('app/gate-pass/page.tsx'))
    const accessCode = stripComments(read('lib/gate-pass/access.ts'))
    const clientCode = stripComments(read('features/gate-pass/gate-pass-client.tsx'))
    const guardAt = accessCode.search(/export\s+async\s+function\s+requireGatePassAccess\b/)
    const guard = guardAt < 0 ? '' : enclosed(accessCode, accessCode.indexOf('{', accessCode.indexOf(')', guardAt)))
    ok('the page decides the Trackers panel with checkGatePassPermission on gate_pass.approve, and passes that down',
      /const canManageTrackers\s*=\s*await\s+checkGatePassPermission\(\s*appUser\s*,\s*'gate_pass\.approve'\s*\)/.test(pageCode) &&
      /canManageTrackers=\{canManageTrackers\}/.test(pageCode))
    ok('requireGatePassAccess answers with that same resolution, and no rule of its own',
      /checkGatePassPermission\(\s*appUser\s*,\s*permissionKey\s*\)/.test(guard) &&
      !/\b(?:requirePermission|isPermissionExplicitlyAllowed)\(/.test(guard))
    ok('the client mounts the Trackers panel, and its toggle, only on that server-computed flag',
      (clientCode.match(/<TrackersPanel\b/g) || []).length === 1 &&
      /\{canManageTrackers && showTrackers && <TrackersPanel\b/.test(clientCode) && /\{canManageTrackers \?/.test(clientCode) &&
      (clientCode.match(/\bcanManageTrackers\s*=[^=]/g) || []).length === 1)
  }
  {
    // ⚠️ The panel unmounts on "Hide GPS Trackers" and a sync runs up to two minutes: local pending state re-offered Sync now mid-run.
    const panelCode = stripComments(read('features/gate-pass/trackers-panel.tsx'))
    const shared = /const syncing = useIsMutating\(\{\s*mutationKey:\s*(\w+)\s*\}\)\s*>\s*0/.exec(panelCode)
    ok("Sync now's pending state outlives the panel — kept in the QueryClient, with its toasts in the mutation's own options",
      shared !== null && new RegExp(`useMutation\\(\\{\\s*mutationKey:\\s*${shared[1]}\\b`).test(panelCode) &&
      !/\[syncing,\s*setSyncing\]/.test(panelCode) && /\.mutate\(\)/.test(panelCode) && !/\.mutate\(\s*[^)\s]/.test(panelCode))
  }
  {
    /*
     * ⚠️ runLoconavSync has recorded 'ok' before the trip sweep starts, and neither runner reads the route's body: a sweep
     * that threw on every run was recorded nowhere. Its catch must mark the sync state — in fixed words, leaving the times
     * the cooldown and the freshness line read alone, and never over a failed run.
     */
    const syncRouteCode = stripComments(read('app/api/gate-pass/tracking/sync/route.ts'))
    const sweepCatchAt = syncRouteCode.indexOf('catch (error)', syncRouteCode.indexOf('runTripReconciliation('))
    const sweepCatch = sweepCatchAt < 0 ? '' : enclosed(syncRouteCode, syncRouteCode.indexOf('{', sweepCatchAt))
    const recorder = exportedFunction(stripComments(sync), 'recordTripSweepFailure')
    ok('a trip sweep that throws is recorded in the sync state, in fixed words, and never over a failed run',
      /await recordTripSweepFailure\(\)/.test(sweepCatch) && /UPDATE loconav_sync_state\b/.test(recorder) &&
      /last_run_status IN \('ok', 'ok_with_warnings'\)/.test(recorder) && !/last_run_at|last_success_at/.test(recorder) &&
      !/\b(?:error|message)\b/.test(recorder))
  }
}

/* ------------------------------------------------------------------ 3f. the pure helpers */

console.log('\n3f. Pure helpers, on the real sequences and labels of 2026-09-11')
{
  // I=Idling M=Moving S=Stopped O=Offline, one minute a segment. The order is what the provider returned.
  const STATUS: Record<string, string> = { I: 'Idling', M: 'Moving', S: 'Stopped', O: 'Offline' }
  const segs = (code: string) => [...code].map((c, i) => ({
    movementStatus: STATUS[c], startTsMs: i * 60_000, endTsMs: (i + 1) * 60_000, averageSpeedKph: c === 'M' ? 20 + i : null,
  }))

  const g10 = summariseSegments(segs('IMIMIMSOSIMIMOIMSMSI'))
  ok('GP-JK402-000010: 6 stops — the idling at gate-out and at gate-in is not a stop', g10.stopCount === 6, JSON.stringify(g10))
  ok('GP-JK402-000010: moving time is the 7 Moving segments', g10.movingSeconds === 7 * 60)
  ok('GP-JK402-000010: stopped time is Stopped + Idling only (11 segments) — Offline counts toward neither',
    g10.stoppedSeconds === 11 * 60)
  const g09 = summariseSegments(segs('SMSMIMSMSMSOSMSOSMSOSMO'))
  ok('GP-JK402-000009: 7 stops — the trailing Offline run is not a stop', g09.stopCount === 7, JSON.stringify(g09))
  {
    // Replaces trips.ts `if (!segments.length)`: the rule now lives here, and trips.ts delegates to it (3c).
    const empty = summariseSegments([])
    ok('an empty timeline reports null, not a measured zero',
      empty.movingSeconds === null && empty.stoppedSeconds === null && empty.stopCount === null &&
      empty.maxSegmentAverageSpeed === null, JSON.stringify(empty))
  }
  ok('a car that never moved made 0 stops', summariseSegments(segs('SIS')).stopCount === 0)
  ok('an Offline gap mid-drive is not a stop', summariseSegments(segs('MOM')).stopCount === 0)
  ok('one real stop mid-drive is one stop', summariseSegments(segs('MSM')).stopCount === 1)
  ok('classifyMovement: Moving / Stopped+Idling / Offline / anything else, trimmed and case-blind',
    classifyMovement(' moving ') === 'moving' && classifyMovement('Idling') === 'stationary' &&
    classifyMovement('Stopped') === 'stationary' && classifyMovement('Offline') === 'offline' &&
    classifyMovement('Running') === 'unknown')

  // The measured limit: 86,400 s answers 200, 86,401 s answers 400.
  const t0 = new Date('2026-09-10T03:12:25.047Z')
  const plus = (s: number) => new Date(t0.getTime() + s * 1000)
  ok('an 86,400 s window is ONE slice (the limit is inclusive)',
    sliceCount(t0, plus(86_400)) === 1 && sliceWindow(t0, plus(86_400)).length === 1)
  ok('an 86,401 s window is TWO slices', sliceCount(t0, plus(86_401)) === 2)
  const multi = sliceWindow(t0, plus(3 * 86_400 + 5))
  ok('3 days + 5 s is 4 contiguous slices, from gate-out to gate-in with no gap',
    multi.length === 4 && multi[0].start.getTime() === t0.getTime() &&
    multi[multi.length - 1].end.getTime() === plus(3 * 86_400 + 5).getTime() &&
    multi.every((s, i) => i === 0 || s.start.getTime() === multi[i - 1].end.getTime()))
  ok('every full slice reaches the provider as exactly 86,400 s once floored to seconds',
    multi.slice(0, -1).every((s) => Math.floor(s.end.getTime() / 1000) - Math.floor(s.start.getTime() / 1000) === 86_400))
  ok('an inverted window has no slices', sliceWindow(plus(10), t0).length === 0)

  ok('alerts repeated across slices are de-duplicated by id; alerts without one are kept',
    dedupeAlertsById([{ id: '1' }, { id: '1' }, { id: null }, { id: null }]).length === 3)
  ok('alerts group by label, most frequent first — "Geofence ×2", not "3 alerts"',
    JSON.stringify(groupAlerts([
      { label: 'Geofence', eventType: 'Geofence' }, { label: 'Geofence', eventType: 'x' }, { label: null, eventType: 'Overspeed' },
    ])) === JSON.stringify([{ label: 'Geofence', count: 2 }, { label: 'Overspeed', count: 1 }]))

  ok('a plate is found inside a model label', [...extractPlateTokens('CARENSJK02CQ6060')].join() === 'JK02CQ6060')
  ok('free text carries no plate', extractPlateTokens('SYROS UDHAMPUR').size === 0)
  ok('a trade plate is kept whole, TC and all', [...extractPlateTokens('JK02C0059TC')].join() === 'JK02C0059TC')
  ok('a VIN is not a plate', extractPlateTokens('MZBGB814LRN218184').size === 0)
  ok('the model word is found in a label', modelWordIn('CARENSJK02CQ6060') === 'CARENS' &&
    modelWordIn('NEW SELTOS IVORY SILVER GLOSS') === 'SELTOS')
  ok('a plate in an EV series is not an EV6', modelWordIn('JK02EV6123') === null)

  // The 18 vehicles on the account: uuid prefix, then number, displayNumber, chassisNumber as LocoNav lists them.
  const T = (uuid: string, ...labels: (string | null)[]) => ({ providerVehicleUuid: uuid, labels })
  const trackers = [
    T('2d427d5c', 'JK02DU0770', 'JK02DU0770', null), T('b26a8d23', 'NEW SELTOS IVORY', 'NEW SELTOS IVORY SILVER GLOSS', null),
    T('73f263e4', 'CARENSJK02CQ6060', 'JK02CQ6060', 'JK02CQ6060'), T('0827d893', 'CARENSJK02DQ0770', 'JK02DQ0770', 'JK02DQ0770'),
    T('387f2ad6', 'CARENSJK02DQ8080', 'JK02DQ8080', 'JK02DQ8080'), T('5ff1647a', 'JK02C0059TC', 'SYROS JK02DP0770', 'JK02DP0770'),
    T('e9b49124', 'JK02DP1010', 'CARENS JK02DP1010', 'JK02DP1010'), T('8c62da1d', 'SYROS UDHAMPUR', 'SYROS UDHAMPUR', 'SYROS UDHAMPUR'),
    T('7a1639eb', 'SELTOS UDHMPUR', 'SELTOS UDHAMPUR', 'SELTOS UDHAMPUR'), T('4f2b707f', 'SONET UDHAMPUR', 'SONET UDHAMPUR', 'SONET UDHAMPUR'),
    T('f469434e', 'JK02DN6314', 'KIA BAJAJ JK02DN6314', 'JK02DN6314'), T('78189732', 'JK02DN2869', 'KIA BAJAJ JK02DN2869', 'JK02DN2869'),
    T('85f9f7ee', 'JK02CH0880', 'SYROS JK02CH0880', 'JK02CH0880'), T('7761a628', 'JK02CN0880', 'SYROS JK02CN0880', 'JK02CN0880'),
    T('54011b9a', 'JK02CJ0880', 'SELTOS JK02CJ0880', 'JK02CJ0880'), T('95ac92f3', 'JK02DN0880', 'SONET JK02DN0880', 'JK02DN0880'),
    T('7115d352', 'JK02CP0880', 'SONET JK02CP0880', 'JK02CP0880'), T('5dda0545', 'JK02CL0880', 'CARENS JK02CL0880', 'MZBGB814LRN218184'),
  ]
  const C = (vin: string, registrationNumber: string, model: string) => ({ vin, registrationNumber, model })
  const demoCars = [
    C('MZBEF813LTN013434', 'JK02DU0770', 'SELTOS'), C('MZBGD813MSN251133', 'JK02CQ6060', 'CARENS'), C('MZBGC814LSN246790', 'JK02DQ0770', 'CARENS'),
    C('MZBGC815VSN248550', 'JK02DQ8080', 'CARENS'), C('MZBGC815VRN191492', 'JK02DP1010', 'CARENS'), C('MZBB6811LSN000224', 'JK02CH0880', 'SYROS'),
    C('MZBB2814LSN003117', 'JK02CN0880', 'SYROS'), C('MZBEU812LRN673823', 'JK02CJ0880', 'SELTOS'), C('MZBFE811VRN469149', 'JK02DN0880', 'SONET'),
    C('MZBFB812LRN486922', 'JK02CP0880', 'SONET'), C('MZBGB814LRN218184', 'JK02CL0880', 'CARENS'), C('MZBB6811VSN001403', 'JK02DP0770', 'SYROS'),
    C('MZBB6811VTN028205', 'JK02C0059TC', 'SYROS'), C('MZBB6814MTN028089', 'JK02C0059TC', 'SYROS'), C('MZBB681BUTN000242', 'JK02C0059TC', 'SYROS'),
    C('MZBB681BUTN000451', 'JK02C0059TC', 'SYROS'), C('MZBGC81BUSN004233', 'JK02C0059TC', 'CARENS'), C('MZBFB812LSN488168', 'JK14G0880', 'SONET'),
    C('MZBB6811LTN027568', 'JK14C0008TC', 'SYROS'), C('MZBEC813MTN014458', 'JK02DU0020', 'SELTOS'),
  ]
  // The links the owner confirmed in chat on 2026-09-11.
  const confirmed: Record<string, [string, string]> = {
    '5dda0545': ['MZBGB814LRN218184', 'plate_and_model'], '0827d893': ['MZBGC814LSN246790', 'plate_and_model'],
    '2d427d5c': ['MZBEF813LTN013434', 'plate_only'], '7115d352': ['MZBFB812LRN486922', 'plate_and_model'],
    '387f2ad6': ['MZBGC815VSN248550', 'plate_and_model'], '95ac92f3': ['MZBFE811VRN469149', 'plate_and_model'],
    '85f9f7ee': ['MZBB6811LSN000224', 'plate_and_model'], 'e9b49124': ['MZBGC815VRN191492', 'plate_and_model'],
    '54011b9a': ['MZBEU812LRN673823', 'plate_and_model'], '7761a628': ['MZBB2814LSN003117', 'plate_and_model'],
    '73f263e4': ['MZBGD813MSN251133', 'plate_and_model'],
  }
  const none = new Set<string>()
  const got = suggestTrackerLinks({ trackers, demoCars, linkedVins: none, linkedTrackerUuids: none })
  ok('the 18 real labels yield exactly the 11 links the owner confirmed',
    got.size === 11 && Object.entries(confirmed).every(([u, [vin, reason]]) => got.get(u)?.vin === vin && got.get(u)?.reason === reason),
    [...got.values()].map((s) => `${s.providerVehicleUuid}->${s.vin}:${s.reason}`).join(' '))
  ok('the Syros whose labels carry the five-car trade plate gets no suggestion', !got.has('5ff1647a'))
  const afterLink = suggestTrackerLinks({
    trackers, demoCars, linkedVins: new Set(['MZBGC814LSN246790']), linkedTrackerUuids: new Set(['5dda0545']),
  })
  ok('a linked tracker and a linked car are never suggested',
    !afterLink.has('5dda0545') && !afterLink.has('0827d893') && afterLink.size === 9)
  ok('a plate carried by two trackers is suggested to neither',
    suggestTrackerLinks({
      trackers: [T('a', 'JK02DQ0770'), T('b', 'CARENS JK02DQ0770')], demoCars, linkedVins: none, linkedTrackerUuids: none,
    }).size === 0)
  ok('a model word that contradicts the car blocks the suggestion',
    suggestTrackerLinks({ trackers: [T('x', 'SONET JK02DQ0770')], demoCars, linkedVins: none, linkedTrackerUuids: none }).size === 0)
}

/* ------------------------------------------------------------------ 4. the module tripwire */

console.log('\n4. The gate pass module boundary still holds')

const FORBIDDEN = ['kia_trips', 'kia_vehicle', 'kia_employees', 'am_hyundai_trips', 'mg_trips', 'TATA_trips']
for (const f of [
  'lib/loconav/client.ts', 'lib/loconav/positions.ts', 'lib/loconav/sync.ts', 'lib/loconav/trips.ts',
  'lib/loconav/mappings.ts', 'lib/loconav/timeline.ts', 'lib/loconav/matching.ts',
  'app/api/gate-pass/tracking/sync/route.ts', 'app/api/gate-pass/tracking/mappings/route.ts',
]) {
  const src = read(f)
  const hit = FORBIDDEN.filter((t) => src.includes(t))
  ok(`${f} names no separate-application table`, hit.length === 0, hit.join(', '))
}

/* ------------------------------------------------------------------ 4b. the provider client */

/*
 * ⚠️ NEVER THE REAL PROVIDER. fetch is replaced before a single client function runs, the host is a loopback
 * address and the token a dummy, so even a stub that failed to install could not put the real token on the
 * wire. What this proves is BEHAVIOUR, which no regex over client.ts can: that a refusal is not retried, that
 * a 429 has its own type, that times go out in seconds and come back in ms, and when the token is read.
 */
const STUB_BASE = 'http://127.0.0.1:9/verify-loconav-stub'
const STUB_TOKEN = 'verify-loconav-stub-token'

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function providerClient() {
  console.log('\n4b. The provider client, against a stubbed fetch')

  const realFetch = globalThis.fetch
  const savedEnv = {
    LOCO_AUTH_TOKEN: process.env.LOCO_AUTH_TOKEN,
    LOCONAV_API_TOKEN: process.env.LOCONAV_API_TOKEN,
    LOCONAV_API_BASE: process.env.LOCONAV_API_BASE,
  }
  let calls: { url: URL; init: RequestInit }[] = []
  let reply = () => new Response('{}', { status: 200 })
  const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => {
    calls = []
    reply = () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  const settle = <T>(promise: Promise<T>) => promise.then(
    (value) => ({ value: value as T | null, error: null as unknown }),
    (error: unknown) => ({ value: null as T | null, error }),
  )
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), init })
    return reply()
  }) as typeof fetch
  setEnv('LOCONAV_API_TOKEN', undefined)

  try {
    setEnv('LOCONAV_API_BASE', undefined)
    const defaultBase = loconavBase()
    setEnv('LOCONAV_API_BASE', `${STUB_BASE}/`)
    ok("the default host is Sensorise's LocoNav deployment, not the public api.a.loconav.com",
      defaultBase === 'https://app.loconav.sensorise.net/integration/api/v1', defaultBase)

    // Set only now, after client.ts loaded with whatever .env held — a module-level read would never see it.
    setEnv('LOCO_AUTH_TOKEN', STUB_TOKEN)
    const start = new Date('2026-09-10T03:12:25.047Z')
    const end = new Date('2026-09-10T11:02:40.900Z')
    const seconds = (d: Date) => String(Math.floor(d.getTime() / 1000))
    const inSeconds = (call: { url: URL } | undefined, from: Date, to: Date) =>
      call?.url.searchParams.get('startTime') === seconds(from) && call?.url.searchParams.get('endTime') === seconds(to)

    answer(200, { success: true, data: { distance: { value: 55.59, unit: 'km' } } })
    const distance = await settle(fetchDistanceTravelled('uuid-10', start, end))
    const sentHeaders = calls[0]?.init.headers as Record<string, string> | undefined
    ok('LOCO_AUTH_TOKEN is read when a request is made, not when the module loads',
      sentHeaders?.['User-Authentication'] === STUB_TOKEN)
    ok('LOCONAV_API_BASE overrides the host for every request, trailing slash trimmed',
      loconavBase() === STUB_BASE && calls.length === 1 && calls[0].url.href.startsWith(`${STUB_BASE}/vehicles/`),
      calls[0]?.url.href)
    ok('distance asks in UNIX SECONDS, and the km come back',
      inSeconds(calls[0], start, end) && distance.value?.km === 55.59, calls[0]?.url.search)

    setEnv('LOCO_AUTH_TOKEN', undefined)
    setEnv('LOCONAV_API_TOKEN', STUB_TOKEN)
    answer(200, { success: true, data: { distance: { value: 1, unit: 'km' } } })
    const legacy = await settle(fetchDistanceTravelled('uuid-10', start, end))
    ok('the old LOCONAV_API_TOKEN configures nothing, and with no token no request is sent',
      !isLoconavConfigured() && calls.length === 0 && /LOCO_AUTH_TOKEN is not configured/.test(errorText(legacy.error)),
      errorText(legacy.error))
    setEnv('LOCONAV_API_TOKEN', undefined)
    setEnv('LOCO_AUTH_TOKEN', STUB_TOKEN)

    // The shapes measured on 2026-09-11: segment and alert timestamps are seconds; only Moving carries distance.
    const slice = sliceWindow(start, end)[0]
    answer(200, { success: true, data: { timeline: [
      { movementStatus: 'Idling',
        startLocation: { timestamp: 1757474000, coordinates: null, address: null },
        endLocation: { timestamp: 1757474300, coordinates: '32.7266,74.8570', address: 'Showroom' } },
      { movementStatus: 'Moving', distance: { value: 4.2, unit: 'km' }, averageSpeed: { value: 31, unit: 'km/h' }, path: 'a~l~Fjk~uO',
        startLocation: { timestamp: 1757474300, coordinates: '32.7266,74.8570', address: 'Showroom' },
        endLocation: { timestamp: 1757474800, coordinates: '32.7400,74.8700', address: null } },
    ] } })
    const timeline = (await settle(fetchTimeline('uuid-10', slice.start, slice.end))).value ?? []
    const measured = summariseSegments(timeline)
    ok('the timeline asks in UNIX SECONDS; segment times come back in ms and summarise as measured',
      inSeconds(calls[0], slice.start, slice.end) && timeline.length === 2 &&
      timeline[0].startTsMs === 1757474000 * 1000 && timeline[0].startCoordinates === null &&
      timeline[1].distanceKm === 4.2 && timeline[1].averageSpeedKph === 31 &&
      measured.movingSeconds === 500 && measured.stoppedSeconds === 300 && measured.stopCount === 0,
      JSON.stringify(measured))

    answer(200, { success: true, data: { alerts: [
      { id: 'a1', eventTime: 1757474500, eventType: 'Geofence', localizeEventType: 'Geofence',
        startLocation: { lat: 32.7266, long: 74.857, address: 'Showroom' } },
    ] } })
    const alerts = (await settle(fetchAlerts('uuid-10', slice.start, slice.end))).value ?? []
    ok('alerts ask in UNIX SECONDS, and event times come back in ms',
      inSeconds(calls[0], slice.start, slice.end) && alerts[0]?.eventTimeMs === 1757474500 * 1000 && alerts[0]?.label === 'Geofence')

    const uuids = Array.from({ length: 18 }, (_, i) => `uuid-${i + 1}`)
    answer(200, { success: true, data: { values: [{
      vehicleNumber: 'CARENSJK02CQ6060', vehicleId: 'uuid-1',
      gps: {
        speed: { value: 0, timestamp: 1757480000 }, ignition: { value: 'off' },
        currentLocationCoordinates: { lat: { value: 32.7266, timestamp: 1757479000 }, long: { value: 74.857, timestamp: 1757479000 } },
      },
    }] } }, { 'x-rate-limit-limit': '20', 'x-rate-limit-remaining': '17' })
    const lastKnown = (await settle(fetchLastKnown(uuids))).value ?? []
    const sentBody = JSON.parse(String(calls[0]?.init.body ?? '{}')) as { vehicleIds?: string[] }
    // The vendor's default perPage is 10: a batch asked for without one comes back silently truncated.
    ok("the whole account's last-known positions cost ONE request, with a page as large as the batch",
      calls.length === 1 && sentBody.vehicleIds?.length === 18 && Number(calls[0].url.searchParams.get('perPage')) >= 18,
      calls[0]?.url.search)
    ok("a fix is dated by its coordinates' own timestamp, not by the newer speed reading",
      lastKnown[0]?.positionAtMs === 1757479000 * 1000 && lastKnown[0]?.latitude === 32.7266)
    const hint = getLoconavRateLimitHint()
    ok("the provider's x-rate-limit-remaining is recorded for the trip sweep to read",
      hint.limit === 20 && hint.remaining === 17 && hint.atMs !== null, JSON.stringify(hint))

    answer(200, { success: true, data: { vehicles: [{
      id: 1, number: 'CARENSJK02CQ6060', displayNumber: 'JK02CQ6060', vehicleUuid: '73f263e4', chassisNumber: 'JK02CQ6060',
      subscription: { expiresAt: '2027-01-01T00:00:00Z' },
      currentDevice: { serialNumber: '8612345678901234', countryCode: '+91', phoneNumber: '5750000001', deviceType: 'GT06' },
    }], pagination: { perPage: '100', totalCount: '1', currentPage: '1' } } })
    const listed = (await settle(listAllVehicles())).value ?? []
    ok('a listed vehicle keeps its chassis number and labels, and never the device phone number',
      listed.length === 1 && listed[0].chassisNumber === 'JK02CQ6060' && listed[0].deviceSerialNumber === '8612345678901234' &&
      !JSON.stringify(listed).includes('5750000001'))

    /*
     * ⚠️ Asked with FOUR attempts, so a refusal that were retried would show as more than one request. 401/403
     * are credentials, 400 a request we built wrong, 404 a vehicle gone from the account, 422 an expired
     * subscription — and a 429 retried 1.5 s later lands in the same exhausted window and spends the next one.
     */
    for (const status of [400, 401, 403, 404, 422, 429]) {
      answer(status, { success: false, data: { errors: ['refused by the stub'] } })
      const refused = await settle(fetchDistanceTravelled('uuid-10', start, end, { attempts: 4, timeoutMs: 5_000 }))
      const typed = refused.error instanceof LoconavHttpError && refused.error.status === status
      const limited = isLoconavRateLimited(refused.error)
      ok(status === 429
        ? 'HTTP 429 is not retried, throws LoconavRateLimitError, and records that no requests are left'
        : `HTTP ${status} is not retried and throws LoconavHttpError(${status})`,
      calls.length === 1 && typed && (status === 429
        ? limited && refused.error instanceof LoconavRateLimitError && getLoconavRateLimitHint().remaining === 0
        : !limited),
      `${calls.length} request(s) — ${errorText(refused.error)}`)
    }
    answer(503, {})
    const flaky = await settle(fetchDistanceTravelled('uuid-10', start, end, { attempts: 2, timeoutMs: 5_000 }))
    ok('a 5xx IS retried per the policy — the refusals above are not passing by never retrying anything',
      calls.length === 2 && flaky.error !== null, `${calls.length} request(s)`)
  } finally {
    globalThis.fetch = realFetch
    for (const [name, value] of Object.entries(savedEnv)) setEnv(name, value)
  }
}

/* ------------------------------------------------------------------ 5. live data */

async function live() {
  const url = process.env.DATABASE_URL
  if (!url) { console.log('\n5. Live data — SKIPPED (no DATABASE_URL)'); return }
  console.log('\n5. Live data')
  const sqlc = postgres(url, { prepare: false, max: 2 })
  // The app connects as postgres, which bypasses RLS; for every other role RLS with no policy is the control.
  const rlsOn = async (table: string) => (await sqlc<{ rls: boolean }[]>`
    SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ${table} AND c.relkind = 'r'`)[0]?.rls === true
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
      ok(`${t} has RLS ON`, await rlsOn(t))
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
      // ⚠️ Found OFF on 2026-09-11 while every sibling table was ON — a whole drive's route, readable by any session.
      const tripsRls = await rlsOn('demo_gate_pass_trips')
      ok('demo_gate_pass_trips has RLS ON', tripsRls, tripsRls ? '' : 're-apply 0058 on port 5432')
      const st = await sqlc<any[]>`
        SELECT status, COUNT(*)::int AS n FROM demo_gate_pass_trips GROUP BY 1 ORDER BY 2 DESC`
      console.log(`  NOTE  reconciled trips: ${st.map((r) => `${r.status}=${r.n}`).join(', ') || 'none yet'}`)
    } else {
      console.log('  NOTE  migration 0058 (demo_gate_pass_trips) is NOT applied — trip reconciliation is inert.')
    }

    // 0060 revokes `authenticated` as well; 0057 and 0058 did not. Reported, not failed — RLS still holds there.
    const authed = await sqlc<{ table_name: string }[]>`
      SELECT DISTINCT table_name FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = 'authenticated'
        AND table_name IN ('demo_vehicle_trackers','demo_vehicle_positions','loconav_sync_state','demo_gate_pass_trips')`
    if (authed.length) {
      console.log(`  NOTE  authenticated still holds grants on ${authed.map((r) => r.table_name).join(', ')} — RLS is the only control there.`)
    }

    // 0060 is the Trackers screen and is applied by hand — reported, not failed, until it is.
    const t60 = await sqlc<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('loconav_provider_vehicles', 'demo_vehicle_tracker_events')`
    if (t60.length === 2) {
      ok('migration 0060 is applied', true, 'loconav_provider_vehicles and demo_vehicle_tracker_events exist')
      for (const t of ['loconav_provider_vehicles', 'demo_vehicle_tracker_events']) {
        ok(`${t} has RLS ON`, await rlsOn(t))
        const g = await sqlc<{ grantee: string }[]>`
          SELECT DISTINCT grantee FROM information_schema.role_table_grants
          WHERE table_schema = 'public' AND table_name = ${t} AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
        ok(`${t} grants nothing to anon/authenticated/PUBLIC`, g.length === 0, g.map((r) => r.grantee).join(', ') || '0 grant(s)')
      }
      /*
       * An audit row that can be edited is not an audit row. The trigger must fire on UPDATE and DELETE, be
       * enabled, and actually refuse — a trigger whose function returns quietly would pass on its name alone.
       */
      const [appendOnly] = await sqlc<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM pg_trigger t
        WHERE t.tgrelid = to_regclass('public.demo_vehicle_tracker_events')
          AND NOT t.tgisinternal AND t.tgenabled <> 'D'
          AND (t.tgtype::int & 8) <> 0 AND (t.tgtype::int & 16) <> 0
          AND pg_get_functiondef(t.tgfoid) ILIKE '%raise exception%'`
      ok('demo_vehicle_tracker_events refuses UPDATE and DELETE — the append-only trigger is present and enabled',
        appendOnly.n >= 1, `${appendOnly.n} trigger(s)`)
      const [m] = await sqlc<{ listed: number; manual_links: number; events: number; unaudited: number }[]>`
        SELECT (SELECT COUNT(*)::int FROM loconav_provider_vehicles) AS listed,
               (SELECT COUNT(*)::int FROM demo_vehicle_trackers WHERE matched_by = 'manual') AS manual_links,
               (SELECT COUNT(*)::int FROM demo_vehicle_tracker_events) AS events,
               (SELECT COUNT(*)::int FROM demo_vehicle_trackers t
                 WHERE t.matched_by = 'manual'
                   AND NOT EXISTS (SELECT 1 FROM demo_vehicle_tracker_events e
                                    WHERE e.action = 'link' AND e.vin = t.vin
                                      AND e.provider_vehicle_uuid = t.provider_vehicle_uuid)) AS unaudited`
      console.log(`  NOTE  LocoNav vehicles in the snapshot ${m.listed} · manual links ${m.manual_links} · audit events ${m.events}`)
      if (m.unaudited > 0) {
        console.log(`        ⚠️ ${m.unaudited} manual link(s) have no 'link' audit row — written outside the Trackers screen.`)
      }
    } else {
      console.log(`  NOTE  migration 0060 is NOT applied${t60.length ? ` (found only ${t60.map((r) => r.table_name).join(', ')})` : ''}` +
        ' — the Trackers screen answers 503 and the sync refuses to run.')
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
    console.log(`  NOTE  demo VINs ${c.demo_vins} · flagged tracker_status='installed' ${c.flagged_installed} · linked to LocoNav ${c.mapped_to_loconav}`)
    if (c.mapped_to_loconav === 0) {
      console.log('        Nothing linked yet — set LOCO_AUTH_TOKEN, run the sync, then link trackers on the Trackers screen.')
    }
    if (c.flagged_installed > 0 && c.mapped_to_loconav > 0 && c.mapped_to_loconav < c.flagged_installed) {
      console.log(`        ⚠️ ${c.flagged_installed - c.mapped_to_loconav} car(s) are flagged as having a tracker but are not linked — a different vendor, or not yet linked on the Trackers screen.`)
    }
  } finally {
    await sqlc.end()
  }
}

providerClient()
  .then(live)
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((e) => { console.error('verifier crashed:', e); process.exit(1) })
