/**
 * Proves the Demo Car GatePass section is wired correctly and stays wired.
 *
 * Every assertion here exists because the thing it checks has actually broken in this codebase
 * before. Run:  npm run verify:gate-pass
 *
 * Static checks run with no database. The live checks are read-only and are skipped with a clear
 * message when DATABASE_URL is absent, so the script is useful in CI and on a laptop alike.
 */
import 'dotenv/config'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import {
  PERMISSION_GROUPS,
  SECTION_ROUTES,
  DEFAULT_VISIBLE_SECTIONS,
  RESTRICTED_DEFAULT_SECTIONS,
} from '../lib/permissions/registry'
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS } from '../lib/navigation/sections'
import { SECTION_MIN_TIER } from '../lib/permissions/tiers'
import {
  GATE_PASS_STATUSES,
  GATE_PASS_ACTIONS,
  GATE_PASS_TRANSITIONS,
  getGatePassStatusInfo,
  canTransition,
} from '../lib/gate-pass/status'
import { gatePassMetrics, summariseGatePasses, formatDuration } from '../lib/gate-pass/metrics'
import {
  createGateToken,
  verifyGateToken,
  GATE_VISIBLE_FIELDS,
  GATE_HIDDEN_FIELDS,
} from '../lib/gate-pass/token'

const ROOT = join(__dirname, '..')
let failures = 0
let passes = 0

function assert(label: string, condition: boolean, detail = '') {
  if (condition) {
    passes += 1
    console.log(`  [PASS] ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function read(rel: string): string {
  const path = join(ROOT, rel)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/** Strips comments so a rule mentioned in prose does not count as a rule enforced in code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const HTTP_METHODS = 'GET|POST|PATCH|PUT|DELETE'

/**
 * Does this file export a route handler?
 *
 * ⚠️ BOTH forms, deliberately. Matching only `export async function GET` silently skipped
 * app/api/gate-pass/run-overdue/route.ts, which exports `export const GET = run` — a cron endpoint
 * that performs database WRITES. A guard check that quietly does not run is worse than no check,
 * because the green line reads as coverage.
 */
function exportsAHandler(src: string): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+(?:${HTTP_METHODS})\\b`).test(src)
    || new RegExp(`export\\s+(?:const|let|var)\\s+(?:${HTTP_METHODS})\\b\\s*=`).test(src)
    || new RegExp(`export\\s*\\{[^}]*\\b(?:${HTTP_METHODS})\\b`).test(src)
}

function walk(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    if (statSync(full).isDirectory()) out.push(...walk(join(dir, entry)))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(join(dir, entry))
  }
  return out
}

console.log('\n1) The section is registered in EVERY place a section has to be registered:')
{
  const group = PERMISSION_GROUPS.find((g) => g.key === 'gate_pass')
  assert('gate_pass exists in PERMISSION_GROUPS', Boolean(group))
  /*
   * A fractional sortOrder (153.1) failed the registry sync with Postgres 22P02 and took down the
   * ENTIRE Access Map along with the section that introduced it.
   */
  assert('sortOrder is an integer', Number.isInteger(group?.sortOrder),
    `got ${String(group?.sortOrder)}`)
  assert('the group declares an approve action', Boolean(group?.actions.includes('approve')))

  assert('gate_pass exists in SECTION_ROUTES', Boolean(SECTION_ROUTES.gate_pass))
  assert('gate_pass appears in ALL_SECTIONS', ALL_SECTIONS.some((s) => s.href === '/gate-pass'))
  /*
   * ⚠️ The step that gets forgotten. canUserAccessSection() hard-returns false for any href absent
   * from ALLOWED_SIDEBAR_HREFS, so a section registered everywhere else is still invisible to
   * global search. fuel_approvals was never added and cannot be found by searching for it today.
   */
  assert('/gate-pass is in ALLOWED_SIDEBAR_HREFS', ALLOWED_SIDEBAR_HREFS.has('/gate-pass'),
    'registered everywhere else but unreachable from search — the fuel_approvals bug')
  /*
   * Unlisted sections default to SUPER_ADMIN once the tiered resolver adopts this map, which would
   * silently lock out the sales executive who is the only role that raises a pass.
   */
  assert('gate_pass has an explicit SECTION_MIN_TIER', 'gate_pass' in SECTION_MIN_TIER)

  // Deny-by-default is the intended posture: a pass carries driver names, licence validity and
  // photographs of people.
  assert('gate_pass is restricted-by-default (NOT on the broad allowlist)',
    !DEFAULT_VISIBLE_SECTIONS.has('gate_pass') && RESTRICTED_DEFAULT_SECTIONS.has('gate_pass'))
}

console.log('\n2) The permission cache version was bumped:')
{
  const service = read('lib/permissions/service.ts')
  const match = service.match(/const PERMISSION_CACHE_VERSION = '(v\d+)'/)
  /*
   * 75-minute TTL. Every logged-in user holds a snapshot computed under the OLD registry, in which
   * gate_pass does not exist — so without the bump the Sales Manager who IS the approver sees no
   * sidebar link and a forbidden() page for over an hour, and it reads as "the feature is broken".
   */
  assert('PERMISSION_CACHE_VERSION is past v34', Boolean(match) && match![1] !== 'v34',
    `still ${match?.[1] ?? 'unreadable'}`)
  assert('the bump is documented in the running comment log', service.includes('// v35:'))
}

console.log('\n3) The approver can actually OPEN the section they approve in:')
{
  const registry = read('lib/permissions/registry.ts')
  /*
   * An action-owning role with no view key is an INERT approver. This is exactly how the general
   * sales manager was locked out of Approvals: they owned the first stage and had no key for it.
   */
  for (const role of ['sales_manager', 'general_manager']) {
    const block = registry.split(new RegExp(`\\n  ${role}: \\[`))[1]?.split('\n  ],')[0] ?? ''
    assert(`${role} template grants gate_pass approve`,
      /keysForGroups\(\['gate_pass'\][^)]*'approve'/.test(block),
      'the approver cannot open their own queue')
  }
  for (const role of ['sales_executive', 'manager']) {
    const block = registry.split(new RegExp(`\\n  ${role}: \\[`))[1]?.split('\n  ],')[0] ?? ''
    assert(`${role} template grants gate_pass create`,
      /keysForGroups\(\['gate_pass'\][^)]*'create'/.test(block))
  }
}

console.log('\n4) The page and every route share ONE access predicate:')
{
  const page = stripComments(read('app/gate-pass/page.tsx'))
  assert('the page guards on the literal gate_pass.view', page.includes("'gate_pass.view'"))
  assert('the page delegates to the shared canViewGatePass', page.includes('canViewGatePass'))
  assert('the page honours an explicit Access-Map Deny', page.includes('isPermissionDenied'))

  /*
   * Guard/API desync has caused four separate outages here, every one the same shape: a page and
   * its routes each restated the rule and drifted. The Vendor Registry had a COMMENT claiming it
   * was gated, no code, and shipped anonymous read of bank account numbers.
   */
  const routes = walk('app/api/gate-pass').filter((f) => f.endsWith('route.ts'))
  assert('there are gate-pass API routes to check', routes.length > 0)
  for (const rel of routes) {
    const src = stripComments(read(rel))
    if (!exportsAHandler(src)) continue
    const guarded = src.includes('requireGatePassAccess') || src.includes('authorizeCronRequest')
    assert(`${rel.replace(/\\/g, '/')} guards via the shared predicate`, guarded,
      'a handler here states its own rule, or has none at all')
  }
  const publicRoutes = walk('app/api/gate').filter((f) => f.endsWith('route.ts'))
  for (const rel of publicRoutes) {
    const src = stripComments(read(rel))
    if (!exportsAHandler(src)) continue
    // These are unauthenticated BY DESIGN — guards have no accounts. The token is the credential,
    // so the one thing that must never be missing is the signature check.
    assert(`${rel.replace(/\\/g, '/')} verifies the HMAC token`, src.includes('verifyGateToken'),
      'an unauthenticated gate route with no token verification is an open write endpoint')
  }
}

console.log('\n5) The status vocabulary and its label map cannot drift apart:')
{
  for (const status of GATE_PASS_STATUSES) {
    const info = getGatePassStatusInfo(status)
    assert(`"${status}" has a real label`, info.pillLabel !== 'Unknown' && info.label.length > 0)
  }
  // An unknown value must render as itself rather than blanking a table cell or throwing.
  assert('an unrecognised status degrades instead of crashing',
    getGatePassStatusInfo('something_new').pillLabel === 'something_new')

  for (const action of GATE_PASS_ACTIONS) {
    const t = GATE_PASS_TRANSITIONS[action]
    assert(`transition "${action}" declares a target status`,
      (GATE_PASS_STATUSES as readonly string[]).includes(t.to))
  }
  // The one-way property the replay defence rests on: nothing re-opens a finished pass.
  assert('no transition re-opens a returned pass', !canTransition('returned', 'gate_out'))
  assert('no transition re-opens a cancelled pass', !canTransition('cancelled', 'approved'))
  assert('a pass cannot go out twice', !canTransition('out', 'gate_out'))
  assert('a pass cannot come in without going out', !canTransition('approved', 'gate_in'))
}

console.log('\n6) The coexistence promise with the other application, enforced by grep:')
{
  /*
   * A DIFFERENT app writes kia_trips / kia_vehicle / kia_employees against this same database — 91
   * live KIA trips as of 2026-09-04. The decision was to leave it entirely alone. This is that
   * decision as a test, because "we agreed not to" is not a control.
   */
  const forbidden = [
    'kia_trips', 'kia_vehicle', 'kia_employees', 'am_hyundai_trips', 'mg_trips',
    'TATA_trips', 'platinum_test_drive_vehicle', 'test_drive_employees',
  ]
  const ours = [...walk('lib/gate-pass'), ...walk('app/api/gate-pass'), ...walk('app/api/gate'), ...walk('features/gate-pass')]
  for (const table of forbidden) {
    const hit = ours.find((rel) => stripComments(read(rel)).includes(table))
    assert(`nothing in this module touches ${table}`, !hit, hit ? `found in ${hit}` : '')
  }

  /*
   * lib/supabase/storage.ts targets the PUBLIC purchase-orders bucket and returns getPublicUrl.
   * Gate photos are pictures of vehicles, drivers and licences.
   */
  const usingPublicBucket = ours.find((rel) => stripComments(read(rel)).includes('@/lib/supabase/storage'))
  assert('no gate evidence goes to the public storage bucket', !usingPublicBucket,
    usingPublicBucket ? `${usingPublicBucket} imports the public-bucket helper` : '')

  // The read-modify-write jsonb chain this module deliberately does not have.
  const schema = read('lib/db/schema.ts')
  const passesBlock = schema.split('export const demoGatePasses')[1]?.split('export const demoGatePassEvents')[0] ?? ''
  assert('demoGatePasses has NO history jsonb column', !/history:\s*jsonb/.test(passesBlock),
    'a jsonb chain appended outside a transaction loses concurrent entries')
}

console.log('\n7) Register maths, checked against a trip that actually happened:')
{
  /*
   * GP-JK402-000001, 2026-09-04 — the first real round trip through this module. Pinning the
   * numbers to a real pass means a change to any definition ("late", "distance", "duration") fails
   * here instead of quietly reporting a different figure on a screen somebody trusts.
   */
  const real = {
    status: 'returned',
    createdAt: '2026-09-04T15:56:45+05:30',
    approvedAt: '2026-09-04T15:58:54+05:30',
    expectedReturnAt: '2026-09-04T15:58:00+05:30',
    gateOutAt: '2026-09-04T18:02:54+05:30',
    gateInAt: '2026-09-04T18:11:56+05:30',
    gateOutOdo: '125',
    gateInOdo: '129',
    gateOutPhotoPaths: { odometer: 'a.webp', vehicle_front: 'b.webp' },
    gateInPhotoPaths: { odometer: 'c.webp', vehicle_front: 'd.webp' },
    gateOutSignaturePath: null,
    gateInSignaturePath: null,
  }
  const m = gatePassMetrics(real)
  assert('approval lag is 2 min', m.approvalMinutes === 2, String(m.approvalMinutes))
  assert('dispatch lag is 124 min (the car sat approved for 2h)', m.dispatchMinutes === 124, String(m.dispatchMinutes))
  assert('trip is 9 min', m.tripMinutes === 9, String(m.tripMinutes))
  assert('distance is 4 km', m.distanceKm === 4, String(m.distanceKm))
  assert('late by 134 min, measured at return', m.lateMinutes === 134 && m.lateBasis === 'returned')
  assert('the skipped signatures are counted as missing', m.evidence.captured === 4 && m.evidence.expected === 6)

  // A missing reading is "not recorded", which is a different fact from zero.
  assert('a missing odometer yields null, never 0',
    gatePassMetrics({ ...real, gateInOdo: null }).distanceKm === null)
  // A pass that has not left cannot be non-compliant for evidence it could not yet have.
  assert('an unstarted pass expects no evidence',
    gatePassMetrics({ ...real, status: 'approved', gateOutAt: null, gateInAt: null,
      gateOutPhotoPaths: null, gateInPhotoPaths: null }).evidence.expected === 0)
  // Lateness for a car still out is measured against now, not against a return that never happened.
  const stillOut = gatePassMetrics({ ...real, status: 'out', gateInAt: null, gateInOdo: null },
    new Date('2026-09-04T20:00:00+05:30'))
  assert('a car still out is late against NOW', stillOut.lateBasis === 'still_out' && stillOut.lateMinutes === 242)
  // A backwards reading is a typo or the wrong car — surfaced, never silently corrected.
  assert('a backwards odometer is flagged and kept negative', (() => {
    const b = gatePassMetrics({ ...real, gateInOdo: '120' })
    return b.odometerWentBackwards === true && b.distanceKm === -5
  })())
  assert('an empty set reports no on-time rate rather than 0%',
    summariseGatePasses([]).onTimeRate === null)
  assert('formatDuration renders 124 as "2h 4m"', formatDuration(124) === '2h 4m', formatDuration(124))
}

console.log('\n8) Every gate link is built against the host the user is actually on:')
{
  /*
   * getAppBaseUrl() with no request skips the host headers and falls through to
   * NEXT_PUBLIC_APP_URL / VERCEL_PROJECT_PRODUCTION_URL — on Vercel that is the *.vercel.app name,
   * never a custom domain. A QR built that way points at a host the business does not use, and the
   * guard who scans it lands nowhere. Every call site in this module must pass the request.
   */
  const callers = [...walk('lib/gate-pass'), ...walk('app/api/gate-pass'), ...walk('app/api/gate')]
  for (const rel of callers) {
    const src = stripComments(read(rel))
    if (!src.includes('getAppBaseUrl')) continue
    assert(`${rel.replace(/\\/g, '/')} passes the request to getAppBaseUrl`,
      !/getAppBaseUrl\(\s*\)/.test(src),
      'a request-less call bakes the *.vercel.app host into the QR')
  }
}

console.log('\n8) Gate tokens cannot be forged, re-purposed, extended or replayed across passes:')
{
  /*
   * The guard has no login, so this token IS the credential. Everything below is an attack somebody
   * holding a screenshot of a QR could try, and every one must fail closed.
   */
  const previousSecret = process.env.GATE_PASS_TOKEN_SECRET
  process.env.GATE_PASS_TOKEN_SECRET = 'verifier-only-secret'

  const passId = '11111111-2222-3333-4444-555555555555'
  const now = new Date('2026-09-04T10:00:00Z')
  const due = new Date('2026-09-04T18:00:00Z')

  const out = createGateToken({ passId, purpose: 'out', expectedReturnAt: due, issuedAt: now })
  const good = verifyGateToken(out, now)
  assert('a valid OUT token verifies to its own pass', good.ok === true && good.passId === passId)

  const p = out.split('.')
  const reason = (token: string, when: Date = now) => {
    const r = verifyGateToken(token, when)
    return r.ok ? 'accepted' : r.reason
  }

  const sig = p[5]
  assert('a tampered signature is refused',
    reason([...p.slice(0, 5), (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)].join('.')) === 'bad_signature')
  /*
   * The attack that matters most: recording a return for a vehicle that never came back. A token is
   * only issued when its own transition becomes possible, and `purpose` is inside the signature.
   */
  assert('an OUT token cannot be re-purposed to sign a vehicle back IN',
    reason([p[0], p[1], 'in', p[3], p[4], p[5]].join('.')) === 'bad_signature')
  assert('a token cannot be pointed at a different pass',
    reason([p[0], '99999999-2222-3333-4444-555555555555', p[2], p[3], p[4], p[5]].join('.')) === 'bad_signature')
  assert('the expiry cannot be extended by editing the token',
    reason([p[0], p[1], p[2], p[3], String(Number(p[4]) + 999_999_999), p[5]].join('.')) === 'bad_signature')
  assert('a token past its window is refused',
    reason(out, new Date(due.getTime() + 8 * 24 * 60 * 60 * 1000)) === 'expired')
  assert('a late return inside the grace window still works',
    reason(out, new Date(due.getTime() + 60_000)) === 'accepted')
  for (const junk of ['nonsense', '', 'g1.a.b.c', null as unknown as string]) {
    assert(`junk input ${JSON.stringify(junk)} is refused`, reason(junk as string) === 'malformed')
  }

  process.env.GATE_PASS_TOKEN_SECRET = 'a-completely-different-secret'
  assert('a token signed with another secret is refused', reason(out) === 'bad_signature')
  process.env.GATE_PASS_TOKEN_SECRET = previousSecret

  // A leaked link must not become a data dump. These two lists are what keeps it a gate check.
  assert('the guard view never exposes a full licence number',
    !(GATE_VISIBLE_FIELDS as readonly string[]).includes('driverLicenceNo')
    && (GATE_HIDDEN_FIELDS as readonly string[]).includes('driverLicenceNo'))
  assert('the guard view never exposes the driver phone or internal remarks',
    ['driverPhone', 'remarks', 'approvalRemarks'].every(
      (f) => !(GATE_VISIBLE_FIELDS as readonly string[]).includes(f)))
  assert('no field is both visible and hidden',
    !(GATE_VISIBLE_FIELDS as readonly string[]).some(
      (f) => (GATE_HIDDEN_FIELDS as readonly string[]).includes(f)))
}

console.log('\n8) Live database (read-only):')
async function liveChecks() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('  [SKIP] DATABASE_URL not set — static checks only.')
    return
  }
  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    const tables = ['demo_gate_passes', 'demo_gate_pass_events', 'demo_gate_pass_drivers']
    const present = await sql<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${tables})`
    const found = new Set(present.map((r) => r.t))
    const allPresent = tables.every((t) => found.has(t))

    if (!allPresent) {
      console.log(`  [SKIP] migration 0051 is not applied yet (found ${found.size} of 3 tables).`)
      console.log('         Apply lib/db/migrations/0051_add_demo_gate_passes.sql on the DIRECT')
      console.log('         session port 5432 — never the pgbouncer pooler on 6543.')
      await sql.end()
      return
    }

    for (const t of tables) assert(`${t} exists`, found.has(t))

    /*
     * ⚠️ Every column the code SELECTs must exist, checked explicitly.
     *
     * A Drizzle select naming a column the database does not have fails the whole query with
     * Postgres 42703 — it does not degrade, it 500s the endpoint. That is exactly how the approvals
     * list went down when request_no was read before 0039 had been applied. A missing migration
     * must fail here, loudly, rather than at a user's first click.
     */
    const driverCols = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'demo_gate_pass_drivers'`
    const haveCols = new Set(driverCols.map((c) => c.column_name))
    for (const col of ['licence_no', 'licence_expiry', 'licence_name', 'licence_doc_path']) {
      assert(`demo_gate_pass_drivers.${col} exists`, haveCols.has(col),
        'apply lib/db/migrations/0052_add_gate_pass_licence_doc.sql on the DIRECT port 5432')
    }

    // The public anon key holds write access across much of this database. These tables carry
    // licence numbers, driver phones and photo paths.
    const anonGrants = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = 'anon' AND table_name = ANY(${tables})`
    assert('anon holds ZERO grants on the gate pass tables', anonGrants[0].n === 0,
      `found ${anonGrants[0].n}`)

    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(${tables})`
    for (const row of rls) assert(`RLS enabled on ${row.relname}`, row.relrowsecurity === true)

    /*
     * ⚠️ EVERY BRANCH MUST HAVE A REAL, ACTIVE APPROVER.
     *
     * A role list says who MAY approve; it does not say who, today, actually will. The gap between
     * those two is how a queue ends up owned by nobody: `finance_team` has requests parked at its
     * stage with no active holder, and nothing surfaces it because the role exists in the enum and
     * the code is satisfied. If this fails, gate passes at that branch can be raised and never
     * actioned — the section is dead there and no one will be told.
     *
     * `developer` is excluded: it holds approve rights for support and must never be the reason a
     * branch looks staffed.
     */
    for (const dealer of ['JK402', 'JK501']) {
      const approvers = await sql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM users
        WHERE is_active = true
          AND role IN ('sales_manager', 'general_manager', 'md')
          AND (
            COALESCE(NULLIF(BTRIM(dealers), ''), '') = ''
            OR UPPER(dealers) LIKE ${'%' + dealer + '%'}
          )`
      assert(`${dealer} has at least one active gate pass approver`, approvers[0].n > 0,
        'passes raised at this branch would be approvable by nobody')
    }

    /*
     * A car out twice is a state the physical world cannot be in — the second person walks to an
     * empty bay. The application refuses at create time (findHoldingPass) and 0053 makes it
     * unbypassable under concurrency. Both are checked: the data, and the index behind it.
     */
    const doubleOut = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT vin FROM demo_gate_passes WHERE status = 'out' GROUP BY vin HAVING COUNT(*) > 1
      ) t`
    assert('no vehicle is "out" on two passes at once', doubleOut[0].n === 0)

    const idx = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM pg_indexes
      WHERE tablename = 'demo_gate_passes'
        AND indexname = 'demo_gate_passes_one_out_per_vehicle_idx'`
    assert('the one-out-per-vehicle index exists', idx[0].n === 1,
      'apply lib/db/migrations/0053_one_live_gate_pass_per_vehicle.sql on the DIRECT port 5432')

    const createSrc = stripComments(read('lib/gate-pass/server.ts'))
    assert('createGatePass refuses a car that is already booked or out',
      createSrc.includes('findHoldingPass'),
      'two people could raise passes for the same vehicle')

    // Every gate transition must have left an immutable event behind.
    const gatedNoEvent = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM demo_gate_passes p
      WHERE p.status IN ('out', 'returned')
        AND NOT EXISTS (
          SELECT 1 FROM demo_gate_pass_events e
          WHERE e.gate_pass_id = p.id AND e.action IN ('gate_out', 'gate_in'))`
    assert('every gated pass has an audit event', gatedNoEvent[0].n === 0,
      `${gatedNoEvent[0].n} pass(es) moved with no event row`)

    // Licence numbers must never reach the audit snapshot — it is read by a wider set of people.
    const leaked = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM demo_gate_pass_events
      WHERE snapshot ? 'driverLicenceNo' OR snapshot ? 'driver_licence_no'`
    assert('no licence number leaked into an audit snapshot', leaked[0].n === 0)

    /*
     * Informational ONLY, deliberately not an assertion. kia_trips belongs to a live application
     * that inserts and evidently prunes on its own — it read 91 on 2026-09-04 and 83 minutes later
     * — so its count moving proves nothing in either direction and pinning it would produce a
     * verifier that fails for reasons outside this module.
     *
     * The real coexistence guarantee is the static grep in section 6: no file in this module may
     * so much as name that table. That one cannot drift.
     */
    const trips = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM kia_trips`
    console.log(`  [INFO] kia_trips has ${trips[0].n} rows (the other app's table — we never write it).`)
  } finally {
    await sql.end()
  }
}

liveChecks()
  .catch((error) => {
    failures += 1
    console.log(`  [FAIL] live checks errored — ${error instanceof Error ? error.message : String(error)}`)
  })
  .then(() => {
    console.log(
      failures === 0
        ? `\n=== ALL CHECKS PASSED (${passes}) ===\n`
        : `\n=== ${failures} FAILURE(S), ${passes} passed ===\n`,
    )
    process.exit(failures === 0 ? 0 : 1)
  })
