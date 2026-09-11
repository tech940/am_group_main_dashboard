/**
 * Proves Fuel Management and Fuel Approvals stay wired the way the 2026-09-11 spec binds them.
 *
 * Every check below exists because the thing it checks went wrong in the code this replaced:
 *   - GET /api/fuel-management checked only a login and shipped submitter emails, slip URLs, remarks
 *     and history the screen never showed;
 *   - vehicles were keyed by plate with "contains" matching, so a trade plate merged five cars;
 *   - km/L divided demo-drive km by ALL litres and labelled the result with thresholds nobody set;
 *   - a hardcoded price per litre, and hardcoded "Active across" coverage text;
 *   - both fuel sections were missing from search, and the permission cache was never bumped;
 *   - the last-fuel route checked only an explicit deny while its page checked a real rule.
 *
 * Run:  npm run verify:fuel-management
 *
 * Sections 1-8 read source and registries and exercise pure functions — no database. Section 9 is
 * READ-ONLY: its direct SQL runs inside a READ ONLY transaction, and it calls the section's own read
 * path exactly as the API does (which only reads). It is skipped with a clear message when
 * DATABASE_URL is absent.
 */
import 'dotenv/config'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { PERMISSION_GROUPS, SECTION_ROUTES, DEFAULT_VISIBLE_SECTIONS } from '../lib/permissions/registry'
import { SIDEBAR_PERMISSION_BY_HREF } from '../lib/permissions/navigation'
import {
  ALL_SECTIONS,
  ALLOWED_SIDEBAR_HREFS,
  FUEL_MANAGEMENT_VIEW_KEYS,
  canUserAccessSection,
} from '../lib/navigation/sections'
import { FUEL_APPROVALS_VIEW_ROLES } from '../lib/fuel-approvals/view-access'
import { extractPlateTokens } from '../lib/loconav/matching'
import { getIndiaYmd, indiaDayBounds } from '../lib/date-time'
import {
  KM_PER_LITRE_NOTE,
  buildFuelManagementResponse,
  fillToFillKmPerLitre,
  fuelBranchOfLocation,
  fuelStageLabel,
  indexDemoFleet,
  isAwaitingStatus,
  matchDemoFill,
  parseOdometerKm,
  resolveFuelManagementPeriod,
} from '../lib/fuel-management/metrics'
import type {
  DemoFleetCarInput,
  DrivePassInput,
  FuelManagementPeriod,
  FuelRowInput,
  GateReadingInput,
  PriorDemoFillInput,
} from '../lib/fuel-management/types'

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

/**
 * Strips comments so a rule described in prose does not count as a rule enforced in code. Keeps
 * `https://` intact (the leading capture), which a naive `//` strip would eat.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir: string): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    if (statSync(full).isDirectory()) out.push(...walk(join(dir, entry)))
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(join(dir, entry).replace(/\\/g, '/'))
  }
  return out
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** The quoted strings of the first array literal in `source` that contains `'${marker}'`. */
function roleArrayContaining(source: string, marker: string): string[] {
  for (const match of source.matchAll(/\[([^\[\]]*)\]/g)) {
    if (!match[1].includes(`'${marker}'`)) continue
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  }
  return []
}

/** The role list app/fuel-management/page.tsx used on 2026-09-11, before the rule moved to access.ts. */
const ORIGINAL_FUEL_MANAGEMENT_ROLES = [
  'developer', 'admin', 'ceo', 'accounts', 'finance_head', 'finance_team', 'md', 'ed', 'ea', 'eba', 'hr',
  'general_manager', 'service_manager', 'sales_manager',
]
/** The role list app/fuel-approvals/page.tsx used on 2026-09-11, before the rule moved to view-access.ts. */
const ORIGINAL_FUEL_APPROVALS_ROLES = [
  'developer', 'admin', 'ceo', 'accounts', 'finance_head', 'finance_team', 'md', 'ed', 'ea', 'eba', 'hr',
]

console.log('\n1) Both fuel sections are registered in EVERY place a section has to be:')
{
  const group = PERMISSION_GROUPS.find((g) => g.key === 'fuel_management')
  assert('fuel_management exists in PERMISSION_GROUPS', Boolean(group))
  // A fractional sortOrder (153.1) failed the registry sync with 22P02 and took down the whole Access Map.
  assert('its sortOrder is an integer', Number.isInteger(group?.sortOrder), `got ${String(group?.sortOrder)}`)
  assert('fuel_management routes to /fuel-management', SECTION_ROUTES.fuel_management?.href === '/fuel-management')
  assert('fuel_approvals routes to /fuel-approvals', SECTION_ROUTES.fuel_approvals?.href === '/fuel-approvals')
  assert('fuel_management is on DEFAULT_VISIBLE_SECTIONS, as the v40 cache note records',
    DEFAULT_VISIBLE_SECTIONS.has('fuel_management'))

  for (const href of ['/fuel-management', '/fuel-approvals']) {
    const entries = ALL_SECTIONS.filter((s) => s.href === href)
    assert(`${href} appears exactly once in ALL_SECTIONS`, entries.length === 1, `found ${entries.length}`)
    /*
     * ⚠️ The step that gets forgotten. canUserAccessSection() hard-returns false for any href absent
     * from ALLOWED_SIDEBAR_HREFS — Fuel Approvals was registered everywhere else and unfindable by
     * search from its first release until this check was written.
     */
    assert(`${href} is in ALLOWED_SIDEBAR_HREFS`, ALLOWED_SIDEBAR_HREFS.has(href),
      'registered everywhere else but unreachable from search')
    assert(`${href} is brand 'common' (the sidebar lists it with no brand test)`, entries[0]?.brand === 'common')
  }
  const ids = ALL_SECTIONS.map((s) => s.id)
  assert('ALL_SECTIONS ids are still unique', new Set(ids).size === ids.length)
  assert("/fuel-approvals resolves to 'fuel_approvals.view', the key its page uses",
    SIDEBAR_PERMISSION_BY_HREF['/fuel-approvals'] === 'fuel_approvals.view')
}

console.log('\n2) Search admits a user through the same keys the pages use:')
{
  const fm = ALL_SECTIONS.find((s) => s.href === '/fuel-management')
  const fa = ALL_SECTIONS.find((s) => s.href === '/fuel-approvals')
  const only = (key: string): Record<string, boolean> => ({ [key]: true })
  if (!fm || !fa) {
    assert('both fuel sections exist to test', false)
  } else {
    for (const key of ['fuel_management.view', 'fuel_approvals.view', 'gate_pass.view']) {
      assert(`/fuel-management is found with only ${key}`, canUserAccessSection(fm, 'sales_manager', 'kia', only(key)))
    }
    assert('/fuel-management is NOT found without any of the three keys',
      !canUserAccessSection(fm, 'viewer', 'kia', { 'petty_cash.view': true }))
    assert('/fuel-management is NOT found while the permission map is still loading',
      !canUserAccessSection(fm, 'viewer', 'kia', null))
    assert('/fuel-management is found by a Hyundai login holding a key (the section is common)',
      canUserAccessSection(fm, 'viewer', 'hyundai', only('fuel_approvals.view')))
    assert('a super admin finds /fuel-management before the map loads', canUserAccessSection(fm, 'md', null, null))
    assert('/fuel-approvals is found with fuel_approvals.view',
      canUserAccessSection(fa, 'viewer', 'kia', only('fuel_approvals.view')))
    assert('/fuel-approvals is NOT found with only gate_pass.view (its page does not accept that key)',
      !canUserAccessSection(fa, 'viewer', 'kia', only('gate_pass.view')))
  }

  const access = stripComments(read('lib/fuel-management/access.ts'))
  const keysInAccess = new Set([...access.matchAll(/'([a-z_.]+\.view)'/g)].map((m) => m[1]))
  assert('FUEL_MANAGEMENT_VIEW_KEYS in sections.ts equals the keys canViewFuelManagement accepts',
    access.includes('FUEL_MANAGEMENT_VIEW_KEYS') || sameSet([...keysInAccess], FUEL_MANAGEMENT_VIEW_KEYS),
    `access.ts names ${[...keysInAccess].join(', ') || 'no view keys (is the file there?)'}`)
}

console.log('\n3) The permission cache version was bumped for fuel_management:')
{
  const service = read('lib/permissions/service.ts')
  const match = service.match(/const PERMISSION_CACHE_VERSION = 'v(\d+)'/)
  const version = match ? Number(match[1]) : 0
  /*
   * 75-minute TTL. Every signed-in user holds a snapshot computed under a registry in which
   * fuel_management does not exist, so without the bump the sidebar link and the page disagree for
   * over an hour and it reads as "the feature is broken".
   */
  assert('PERMISSION_CACHE_VERSION is v40 or later', version >= 40, `still v${match?.[1] ?? 'unreadable'}`)
  const note = service.split(/\r?\n/).find((line) => line.startsWith('// v40:')) ?? ''
  assert('the // v40: note says it registers fuel_management', note.includes('fuel_management'), note || 'no // v40: line')
}

console.log('\n4) Each section has ONE access predicate, called by its page AND its data routes:')
{
  const access = stripComments(read('lib/fuel-management/access.ts'))
  assert('lib/fuel-management/access.ts is server-only', /import\s+'server-only'/.test(access))
  assert('it exports canViewFuelManagement', /export\s+(?:async\s+)?function\s+canViewFuelManagement\b/.test(access))
  assert("it honours an explicit deny on 'fuel_management.view' first",
    access.includes('isPermissionDenied') && access.includes("'fuel_management.view'"))
  assert('it honours an explicit Access-Map allow', access.includes('isPermissionExplicitlyAllowed'))
  const fmRoles = roleArrayContaining(access, 'sales_manager')
  assert('its role list is exactly the one the page used (audience neither widened nor narrowed)',
    sameSet(fmRoles, ORIGINAL_FUEL_MANAGEMENT_ROLES), `got [${fmRoles.join(', ')}]`)

  const page = stripComments(read('app/fuel-management/page.tsx'))
  const api = stripComments(read('app/api/fuel-management/route.ts'))
  assert('app/fuel-management/page.tsx calls canViewFuelManagement', page.includes('canViewFuelManagement('))
  assert("the page keeps the literal 'fuel_management.view' (verify:guard-parity greps page source)",
    page.includes("'fuel_management.view'"))
  assert('GET /api/fuel-management calls canViewFuelManagement', api.includes('canViewFuelManagement('))
  // Either spelling counts: a literal `status: 401`, or a helper called with the code (`refuse(401, …)`).
  const answers = (code: number) => new RegExp(`(?:status:\\s*|\\w+\\(\\s*)${code}\\b`).test(api)
  assert('the API answers 401 when signed out', answers(401))
  assert('the API answers 403 when the predicate says no', answers(403))
  assert('the API answers 400 for a bad period, validated by resolveFuelManagementPeriod against the India day',
    answers(400) && api.includes('resolveFuelManagementPeriod(') && api.includes('getIndiaYmd('))
  for (const [label, src] of [['page', page], ['API', api]] as const) {
    assert(`the Fuel Management ${label} does not restate the rule (no snapshot read, no role list)`,
      !src.includes('getUserPermissionSnapshot') && !/\[\s*'developer'/.test(src))
  }

  const faPage = stripComments(read('app/fuel-approvals/page.tsx'))
  const lastFuel = stripComments(read('app/api/fuel-approvals/last-fuel/route.ts'))
  const viewAccess = stripComments(read('lib/fuel-approvals/view-access.ts'))
  assert('app/fuel-approvals/page.tsx calls canViewFuelApprovals', faPage.includes('canViewFuelApprovals('))
  assert("the page keeps the literal 'fuel_approvals.view' (verify:guard-parity greps page source)",
    faPage.includes("'fuel_approvals.view'"))
  assert('GET /api/fuel-approvals/last-fuel calls canViewFuelApprovals', lastFuel.includes('canViewFuelApprovals('))
  // What it used to do: refuse only an explicit deny, so anyone the page turned away could still query.
  assert('last-fuel no longer settles for an explicit-deny-only check', !lastFuel.includes('isPermissionDenied'))
  assert('neither the page nor last-fuel restates the Fuel Approvals rule',
    ![faPage, lastFuel].some((src) => /\[\s*'developer'/.test(src) || src.includes('getUserPermissionSnapshot')))
  assert('view-access.ts is server-only', /import\s+'server-only'/.test(viewAccess))
  assert('view-access checks deny, then the snapshot, then an explicit allow, on fuel_approvals.view',
    ['isPermissionDenied', 'getUserPermissionSnapshot', 'isPermissionExplicitlyAllowed', "'fuel_approvals.view'"]
      .every((token) => viewAccess.includes(token)))
  assert('FUEL_APPROVALS_VIEW_ROLES is exactly the list the page used',
    sameSet([...FUEL_APPROVALS_VIEW_ROLES], ORIGINAL_FUEL_APPROVALS_ROLES), `got [${FUEL_APPROVALS_VIEW_ROLES.join(', ')}]`)
}

console.log('\n5) The API ships only what the screen shows, read from only the columns it needs:')
{
  const types = stripComments(read('lib/fuel-management/types.ts'))
  assert('lib/fuel-management/types.ts declares FuelManagementResponse',
    /\b(?:type|interface)\s+FuelManagementResponse\b/.test(types))
  const leak = types.match(/\b\w*(?:email|slip|remark|history|submitted|approvedBy|approverId)\w*\b/i)
  assert('no type there carries an email, slip URL, remark, history, submitter or approver field', !leak,
    leak ? `found "${leak[0]}"` : '')

  const serverFiles = [...walk('lib/fuel-management'), 'app/api/fuel-management/route.ts']
  for (const rel of serverFiles) {
    const src = stripComments(read(rel))
    const column = src.match(
      /fuelApprovals\.(?:fuelSlipUrl|remarks|history|submittedByName|submittedByEmail|submittedById|\w+ApprovedBy\w*|rejectedBy\w*|rejectRemarks|sendBackReason)\b|\b(?:fuel_slip_url|submitted_by_email|submitted_by_name)\b/,
    )
    assert(`${rel} never reads a slip, remark, history, submitter or approver column`, !column, column?.[0] ?? '')
    assert(`${rel} never SELECT *s (a bare .select())`, !/\.select\(\s*\)/.test(src))
    // The old overview bucketed gate passes with toISOString().slice(0, 10) — a UTC day, wrong before 05:30 IST.
    assert(`${rel} never takes a calendar day from UTC`, !/toISOString\(\)\s*\.(?:slice|split|substring)\(/.test(src))
    const fabricated = src.match(/costPer|fuelCost|pricePerL|₹|High Burn|high_consumption|efficiencyStatus|Active across/i)
    assert(`${rel} has no cost, efficiency label or hardcoded coverage text`, !fabricated, fabricated?.[0] ?? '')
  }

  const route = stripComments(read('app/api/fuel-management/route.ts'))
  assert("the route is export const dynamic = 'force-dynamic'", /export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(route))
  assert('the route never forwards a raw driver/DB message to the client',
    !/details:|instanceof Error \? \w+\.message/.test(route))

  const reads = stripComments(read('lib/fuel-management/reconciliation.ts'))
  // The old screen labelled the same status two different ways in two tables.
  assert("status labels come from Fuel Approvals' own STATUS_LABELS, so the two sections never word a status differently",
    reads.includes('STATUS_LABELS'))
  // postgres-js passes timestamp parameters through untouched: a JS Date inside a raw sql`` template crashes the query.
  const dateInRawSql = [...reads.matchAll(/sql(?:<[^>]*>)?`([^`]*)`/g)].find((m) => /\$\{\s*(?:start|end)\s*\}/.test(m[1]))
  assert('no India-day bound (a JS Date) is interpolated into a raw sql`` template', !dateInRawSql, dateInRawSql?.[0] ?? '')
  assert('gate passes are filtered by the India-day bounds of the period', reads.includes('indiaDayBounds('))
  assert('the demo fleet is read once per request', (reads.match(/listDemoVehiclesForGatePass\(/g) ?? []).length === 1)

  const metrics = read('lib/fuel-management/metrics.ts')
  assert('lib/fuel-management/metrics.ts exists', metrics.length > 0)
  const imports = [...stripComments(metrics).matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  const impure = imports.filter((path) => !/(?:^|\/)loconav\/matching$|^\.\/types$|(?:^|\/)fuel-management\/types$/.test(path))
  // Requires the file: an absent metrics.ts has no impure imports, and a green line for it would read as coverage.
  assert('metrics.ts is pure: it imports only lib/loconav/matching and ./types',
    metrics.length > 0 && impure.length === 0, metrics.length === 0 ? 'file missing' : impure.join(', '))
}

console.log('\n6) The screen asks for fresh data and stays inside the locked palette:')
{
  const client = stripComments(read('features/fuel-management/fuel-management-client.tsx'))
  assert('features/fuel-management/fuel-management-client.tsx exists', client.length > 0)
  const fetchCalls = [...client.matchAll(/\bfetch\(/g)].map((m) => client.slice(m.index ?? 0, (m.index ?? 0) + 400))
  // A patched window.fetch caches GET /api/* for 30 minutes unless the call opts out.
  assert("every fetch passes cache: 'no-store'",
    fetchCalls.length > 0 && fetchCalls.every((call) => /cache:\s*'no-store'/.test(call)),
    `${fetchCalls.filter((call) => !/cache:\s*'no-store'/.test(call)).length} of ${fetchCalls.length} do not`)
  assert('the query key carries from, to and branch',
    /queryKey:\s*\[[^\]]*\bfrom\b[^\]]*\bto\b[^\]]*\bbranch\b/.test(client))
  const buttons = (client.match(/<button\b/g) ?? []).length
  const typed = (client.match(/\btype=["'](?:button|submit)["']/g) ?? []).length
  assert('every <button> declares its type', typed >= buttons, `${buttons} buttons, ${typed} type attributes`)
  assert('expandable rows expose aria-expanded and aria-controls', client.includes('aria-expanded') && client.includes('aria-controls'))
  assert('table headers declare scope', /scope=["']col["']/.test(client))
  assert('numbers are tabular-nums', client.includes('tabular-nums'))
  const accent = client.match(/\b(?:bg|text|border|ring|fill|stroke|from|to)-(?:teal|purple|violet|fuchsia|cyan)-\d{2,3}\b/)
  assert('no teal/purple accents (the palette is slate/indigo/white)', !accent, accent?.[0] ?? '')
  // app/globals.css repaints these with !important, so a status tone written this way is not the tone you see.
  const repainted = client.match(/\b(?:bg|text)-(?:emerald|amber|rose|green|red|yellow|orange)-\d{2,3}\b/)
  assert('no status tone relies on a utility globals.css repaints (use the inline-hex map)', !repainted, repainted?.[0] ?? '')
}

console.log('\n7) The Accounts approval columns have a migration record:')
{
  const up = read('lib/db/migrations/0061_record_fuel_approvals_accounts_columns.sql')
  const down = read('lib/db/migrations/0061_rollback_record_fuel_approvals_accounts_columns.sql')
  const upSql = up.replace(/^\s*--.*$/gm, '')
  const downSql = down.replace(/^\s*--.*$/gm, '')
  assert('0061 and its rollback exist', up.length > 0 && down.length > 0)
  const columns = ['accounts_approved_by', 'accounts_approved_by_name', 'accounts_approved_at', 'accounts_remarks']
  for (const column of columns) {
    assert(`0061 adds ${column} with IF NOT EXISTS`, new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\s`).test(upSql))
    assert(`the rollback drops ${column} with IF EXISTS`, new RegExp(`DROP COLUMN IF EXISTS\\s+${column}\\b`).test(downSql))
    assert(`lib/db/schema.ts declares ${column}`, read('lib/db/schema.ts').includes(`'${column}'`))
  }
  // Re-running must never add a second, identical foreign key.
  assert('0061 adds the users FK only when no FK on accounts_approved_by exists',
    /IF NOT EXISTS\s*\([\s\S]*pg_constraint[\s\S]*accounts_approved_by[\s\S]*FOREIGN KEY \(accounts_approved_by\) REFERENCES public\.users\(id\)/.test(upSql))
  assert('0061 runs in one transaction', /^BEGIN;/m.test(upSql) && /^COMMIT;/m.test(upSql))
  assert('0061 records the pooler script and says to apply by hand on 5432',
    up.includes('scripts/setup-fuel-accounts-columns.js') && up.includes('5432'))
}

console.log('\n8) Pure maths, with the labels measured on 2026-09-11:')
{
  const tokens = (...labels: unknown[]) => [...extractPlateTokens(...labels)].sort().join(',')
  assert("'DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070' + 'jk02du7070' yield JK02DU7070",
    tokens('DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070', 'jk02du7070') === 'JK02DU7070')
  assert("'Stock transfer' + '686082' yield no plate — a VIN tail is not a plate", tokens('Stock transfer', '686082') === '')
  assert("'DISPLAY VEHICLE' + 'Stock yad' yield no plate", tokens('DISPLAY VEHICLE', 'Stock yad') === '')
  assert("'DEMO NEW SYROS SILVER - JK02C0059TC' yields the trade plate", tokens('DEMO NEW SYROS SILVER - JK02C0059TC') === 'JK02C0059TC')
  assert('a 17-character VIN is not read as a plate', tokens('MZBEF813LTN013434', 'MZBFB812LRN486922') === '')

  // IST period bounds. The old code bucketed gate-outs by UTC day, so anything before 05:30 IST landed on the previous day.
  const sep1 = indiaDayBounds('2026-09-01')
  const sep11 = indiaDayBounds('2026-09-11')
  assert('1 Sep 2026 IST starts at 2026-08-31T18:30:00.000Z', sep1.start?.toISOString() === '2026-08-31T18:30:00.000Z',
    sep1.start?.toISOString() ?? 'null')
  assert('11 Sep 2026 IST ends at 2026-09-11T18:29:59.999Z', sep11.end?.toISOString() === '2026-09-11T18:29:59.999Z',
    sep11.end?.toISOString() ?? 'null')
  const earlyGateOut = new Date('2026-08-31T18:40:00Z') // 00:10 IST on 1 Sep
  assert('a gate-out at 00:10 IST on 1 Sep is inside September although its UTC day is 31 Aug',
    Boolean(sep1.start && earlyGateOut >= sep1.start) && getIndiaYmd(earlyGateOut) === '2026-09-01'
      && earlyGateOut.toISOString().slice(0, 10) === '2026-08-31')

  // ── Period and field readers ──
  const period = resolveFuelManagementPeriod
  const def = period({}, '2026-09-11')
  assert('no dates → the India month to date (2026-09-01 … 2026-09-11), all branches',
    def.ok && def.period.from === '2026-09-01' && def.period.to === '2026-09-11' && def.period.branch === 'ALL', JSON.stringify(def))
  const boundary = period({}, getIndiaYmd(new Date('2026-08-31T19:00:00Z')))
  assert('at 00:30 IST on 1 Sep the default period is already September (UTC still says 31 Aug)',
    boundary.ok && boundary.period.from === '2026-09-01' && boundary.period.to === '2026-09-01', JSON.stringify(boundary))
  const refused: ReadonlyArray<[string, { from?: string; to?: string; branch?: string }]> = [
    ['month 13', { from: '2026-13-01', to: '2026-09-11' }],
    ['30 February', { from: '2026-02-30', to: '2026-03-01' }],
    ['from after to', { from: '2026-09-11', to: '2026-09-01' }],
    ['367 days', { from: '2025-09-09', to: '2026-09-10' }],
    ['only a start date', { from: '2026-09-01' }],
    ['a date not written YYYY-MM-DD', { from: '01/09/2026', to: '2026-09-11' }],
    ['a branch that does not exist', { from: '2026-09-01', to: '2026-09-11', branch: 'JK999' }],
  ]
  for (const [label, params] of refused) {
    assert(`bad input is refused (the API answers 400): ${label}`, !period(params, '2026-09-11').ok)
  }
  assert('366 days with both ends counted is allowed', period({ from: '2025-09-10', to: '2026-09-10' }, '2026-09-11').ok)
  const udhampur = period({ from: '2026-09-01', to: '2026-09-11', branch: 'jk501' }, '2026-09-11')
  assert("branch 'jk501' is read as JK501", udhampur.ok && udhampur.period.branch === 'JK501')

  assert("current_km_reading '10207' reads 10207 and '8368.5' reads 8368.5",
    parseOdometerKm('10207') === 10207 && parseOdometerKm('8368.5') === 8368.5)
  assert("an empty, missing, 'NA' or '1.2.3' reading is null — missing, never 0",
    [null, undefined, '', '   ', 'NA', '1.2.3'].every((value) => parseOdometerKm(value) === null))
  assert("'KIA UDHAMPUR' → JK501, 'KIA JAMMU' → JK402, 'KIA BANIHAL' → neither",
    fuelBranchOfLocation('KIA UDHAMPUR') === 'JK501' && fuelBranchOfLocation('KIA JAMMU') === 'JK402'
      && fuelBranchOfLocation('KIA BANIHAL') === null)
  // The old overview counted only 'ceo_pending' as pending.
  assert('held and Accounts requests are awaiting; approved, rejected and sent back are not',
    isAwaitingStatus('ceo_on_hold') && isAwaitingStatus('accounts_pending') && isAwaitingStatus('md_pending')
      && !isAwaitingStatus('approved') && !isAwaitingStatus('rejected') && !isAwaitingStatus('sent_back'))
  assert('stages read CEO, Accounts and legacy MD', fuelStageLabel('ceo') === 'CEO' && fuelStageLabel('accounts') === 'Accounts'
    && fuelStageLabel('md') === 'MD')

  // ── Matching a DEMO fill to a demo car ──
  const SELTOS = 'MZBEF813LTN013434' // JK02DU0770 on the live demo list
  const SONET = 'MZBFB812LRN486922' // JK02CP0880 on the live demo list
  const TAIL_CAR = 'MZBSY812LSN686082' // fixture: the one VIN a '686082' tail names
  const TRADE_1 = 'MZBSY812LSN100001' // fixture: two cars on trade plate JK02C0059TC
  const TRADE_2 = 'MZBSY812LSN100002'
  const TWIN_1 = 'MZBCR812LSN555555' // fixture: two VINs ending in the same six digits
  const TWIN_2 = 'MZBCL812LSN555555'
  const SOLD = 'MZBXX812LSN999999' // fixture: a car that has left the demo list
  const fleetCars: DemoFleetCarInput[] = [
    { vin: SELTOS, registrationNumber: 'JK02DU0770', model: 'SELTOS', branchLabel: 'Jammu', sharedPlate: false },
    { vin: SONET, registrationNumber: 'JK02CP0880', model: 'SONET', branchLabel: 'Jammu', sharedPlate: false },
    { vin: TAIL_CAR, registrationNumber: null, model: 'SYROS', branchLabel: 'Jammu', sharedPlate: false },
    { vin: TRADE_1, registrationNumber: 'JK02C0059TC', model: 'SYROS', branchLabel: 'Jammu', sharedPlate: true },
    { vin: TRADE_2, registrationNumber: 'JK02C0059TC', model: 'CARENS', branchLabel: 'Udhampur', sharedPlate: true },
    { vin: TWIN_1, registrationNumber: null, model: 'CARENS', branchLabel: 'Jammu', sharedPlate: false },
    { vin: TWIN_2, registrationNumber: null, model: 'CLAVIS', branchLabel: 'Udhampur', sharedPlate: false },
  ]
  const fleet = indexDemoFleet(fleetCars)
  const match = (vehRegNo: string, vinNo: string) => matchDemoFill({ vehRegNo, vinNo }, fleet)
  const matchedTo = (result: ReturnType<typeof match>, vin: string) => result.matched && result.vin === vin
  const reasonOf = (result: ReturnType<typeof match>) => (result.matched ? `matched ${result.vin}` : result.reason)
  const SELTOS_LABEL = 'DEMO IVORY SILVER SELTOS -DEMO IVORY-DIESEL-JK02DU0770'
  const SONET_LABEL = 'Sonet G1.2 5MT Gravity-GREEN-PETROL-JK02CP0880'

  assert(`'${SELTOS_LABEL}' is the Seltos, by its plate`, matchedTo(match(SELTOS_LABEL, 'JK02DU0770'), SELTOS),
    reasonOf(match(SELTOS_LABEL, 'JK02DU0770')))
  assert("vin_no '686082' names the one demo VIN ending in it", matchedTo(match('686082', '686082'), TAIL_CAR),
    reasonOf(match('686082', '686082')))
  assert('a full VIN in vin_no, typed in lower case, names its car', matchedTo(match('Sonet', 'mzbfb812lrn486922'), SONET))
  assert('a plate and a VIN tail that agree name that car', matchedTo(match(SONET_LABEL, '486922'), SONET))
  assert("trade plate JK02C0059TC alone is refused as 'shared_plate' — it is on several cars",
    reasonOf(match('DEMO NEW SYROS SILVER - JK02C0059TC', 'JK02C0059TC')) === 'shared_plate',
    reasonOf(match('DEMO NEW SYROS SILVER - JK02C0059TC', 'JK02C0059TC')))
  assert('…but a VIN tail on the same fill says which trade-plate car it is',
    matchedTo(match('DEMO NEW SYROS SILVER - JK02C0059TC', '100001'), TRADE_1))
  assert("JK02DU7070 is 'plate_not_in_demo_fleet' — unmatched is a legitimate outcome",
    reasonOf(match('DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070', 'jk02du7070')) === 'plate_not_in_demo_fleet')
  assert("'Stock yad' is 'no_plate_in_label'", reasonOf(match('Stock yad', 'Stock yad')) === 'no_plate_in_label')
  assert("a plate naming one car and a VIN tail naming another is 'ambiguous'",
    reasonOf(match(SELTOS_LABEL, '486922')) === 'ambiguous', reasonOf(match(SELTOS_LABEL, '486922')))
  assert("a tail two demo VINs end with is 'ambiguous', never whichever was found first",
    reasonOf(match('CARENS', '555555')) === 'ambiguous', reasonOf(match('CARENS', '555555')))

  // ── Fill-to-fill km per litre ──
  const single = fillToFillKmPerLitre([{ odometerKm: 10207, litres: 30 }])
  assert('one fill → no km per litre, and the note says what is missing',
    single.kmPerLitre === null && single.note === KM_PER_LITRE_NOTE.needsSecondFill
      && single.note === 'Needs a second fill with an odometer reading.', JSON.stringify(single))
  const two = fillToFillKmPerLitre([{ odometerKm: 10000, litres: 40 }, { odometerKm: 10450, litres: 30 }])
  assert("two fills → (10450 − 10000) ÷ 30 L = 15.0; the first fill's own litres are not counted",
    two.kmPerLitre?.value === 15 && two.kmPerLitre.fillsUsed === 2 && two.note === null, JSON.stringify(two))
  const three = fillToFillKmPerLitre([
    { odometerKm: 10000, litres: 40 }, { odometerKm: 10450, litres: 30 }, { odometerKm: 10900, litres: 25 },
  ])
  assert('three fills → 900 km ÷ 55 L = 16.4 (1 dp) over 3 fills',
    three.kmPerLitre?.value === 16.4 && three.kmPerLitre.fillsUsed === 3, JSON.stringify(three))
  const gap = fillToFillKmPerLitre([
    { odometerKm: 10000, litres: 40 }, { odometerKm: null, litres: 20 }, { odometerKm: 10450, litres: 30 },
  ])
  assert('a fill without a reading is left out, never read as 0 km', gap.kmPerLitre?.value === 15 && gap.kmPerLitre.fillsUsed === 2,
    JSON.stringify(gap))
  const backwards = fillToFillKmPerLitre([{ odometerKm: 13766, litres: 35 }, { odometerKm: 13700, litres: 20 }])
  assert('a backwards odometer → no km per litre, pointing at Needs a look',
    backwards.kmPerLitre === null && backwards.note === 'Odometer readings go backwards — see Needs a look.',
    JSON.stringify(backwards))

  // ── One whole response, every expected number worked out by hand ──
  const fill = (requestNumber: string, over: Partial<FuelRowInput>): FuelRowInput => ({
    requestNumber,
    location: 'KIA JAMMU',
    purpose: 'DEMO',
    vehRegNo: '',
    vinNo: '',
    kmReadingText: null,
    date: '2026-09-07',
    litres: 10,
    status: 'approved',
    statusLabel: 'Approved',
    currentStage: 'completed',
    branchLabel: 'Jammu',
    createdAt: `${over.date ?? '2026-09-07'}T05:00:00.000Z`,
    ...over,
  })
  const awaitingCeo = { status: 'ceo_pending', statusLabel: 'Awaiting CEO Approval', currentStage: 'ceo' }
  const fuelRows: FuelRowInput[] = [
    fill('T-00', { vehRegNo: SELTOS_LABEL, vinNo: 'JK02DU0770', kmReadingText: '8000', date: '2026-08-28', litres: 40 }),
    fill('T-01', { vehRegNo: SELTOS_LABEL, vinNo: 'JK02DU0770', kmReadingText: '8368', date: '2026-09-02', litres: 30 }),
    fill('T-02', { vehRegNo: SELTOS_LABEL, vinNo: 'JK02DU0770', kmReadingText: '8818', date: '2026-09-08', litres: 30 }),
    fill('T-03', { vehRegNo: SELTOS_LABEL, vinNo: 'JK02DU0770', kmReadingText: '9000', date: '2026-09-10', litres: 25, ...awaitingCeo }),
    fill('T-04', { vehRegNo: SONET_LABEL, vinNo: 'JK02CP0880', kmReadingText: '13766', date: '2026-09-05', litres: 35 }),
    fill('T-05', { vehRegNo: SONET_LABEL, vinNo: 'JK02CP0880', kmReadingText: '13700', date: '2026-09-09', litres: 20 }),
    // Not a demo fill, and its vin_no happens to be the tail of a demo VIN: it must stay off that car.
    fill('T-06', { purpose: 'STOCK TRANSFER', vehRegNo: 'Stock transfer', vinNo: '686082', date: '2026-09-08', createdAt: '2026-09-08T05:00:00.000Z' }),
    fill('T-07', { purpose: 'STOCK TRANSFER', vehRegNo: 'Stock transfer', vinNo: '686082', date: '2026-09-08', createdAt: '2026-09-08T06:00:00.000Z' }),
    fill('T-08', { purpose: 'STOCK TRANSFER', vehRegNo: 'Stock transfer', vinNo: '686082', date: '2026-09-08', litres: 12, createdAt: '2026-09-08T07:00:00.000Z' }),
    fill('T-09', { purpose: 'STOCK TRANSFER', vehRegNo: 'Stock transfer', vinNo: '686082', date: '2026-09-08', createdAt: '2026-09-08T08:00:00.000Z', status: 'rejected', statusLabel: 'Rejected', currentStage: 'rejected' }),
    fill('T-10', { vehRegNo: 'DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070', vinNo: 'jk02du7070', kmReadingText: '10207', date: '2026-09-10', litres: 15, ...awaitingCeo }),
    fill('T-11', { vehRegNo: 'DEMO NEW SYROS SILVER - JK02C0059TC', vinNo: 'JK02C0059TC', kmReadingText: '', date: '2026-09-06' }),
    fill('T-12', { vehRegNo: '686082', vinNo: '686082', kmReadingText: '5120', date: '2026-09-04', litres: 18 }),
    fill('T-13', { purpose: 'GENSET', location: 'KIA UDHAMPUR', branchLabel: 'Udhampur', vehRegNo: 'Genset', vinNo: 'GENSET', date: '2026-09-09', litres: 40 }),
    fill('T-14', { purpose: 'DISPLAY VEH', vehRegNo: 'DISPLAY VEHICLE', vinNo: 'DISPLAY VEHICLE', date: '2026-09-10', litres: 8, status: 'accounts_on_hold', statusLabel: 'Held by Accounts', currentStage: 'accounts' }),
    fill('T-15', { purpose: 'STOCK YARD', vehRegNo: 'Stockyard', vinNo: 'Stock yad', date: '2026-09-10', litres: 6, status: 'sent_back', statusLabel: 'Sent Back', currentStage: 'ceo' }),
    fill('T-16', { purpose: 'NEW DELIVERY', vehRegNo: 'SELTOS- 015610', vinNo: '015610', date: '2026-09-11', litres: 5, status: 'md_pending', statusLabel: 'Awaiting MD Approval', currentStage: 'md' }),
  ]
  const priorDemoFills: PriorDemoFillInput[] = [
    { requestNumber: 'T-P1', vehRegNo: SONET_LABEL, vinNo: 'JK02CP0880', kmReadingText: '13900', date: '2026-08-30', createdAt: '2026-08-30T05:00:00.000Z' },
  ]
  const pass = (passNo: string, over: Partial<DrivePassInput>): DrivePassInput => ({
    passNo,
    vin: SELTOS,
    registrationNumber: null,
    model: null,
    branchLabel: 'Jammu',
    status: 'returned',
    gateOutAt: '2026-09-03T05:00:00.000Z',
    gateOutOdo: null,
    gateInOdo: null,
    gpsKm: null,
    ...over,
  })
  const drives: DrivePassInput[] = [
    // Wears the SONET's plate but carries the SELTOS's VIN. It is the Seltos's drive: passes attach by VIN only.
    pass('GP-T-01', { registrationNumber: 'JK02CP0880', gateOutOdo: 8400, gateInOdo: 8450, gpsKm: 48.6 }),
    pass('GP-T-02', { gateOutAt: '2026-09-09T04:00:00.000Z', gateOutOdo: 8860, gateInOdo: 8900 }),
    pass('GP-T-03', { vin: TRADE_1, registrationNumber: 'JK02C0059TC', status: 'out', gateOutAt: '2026-09-10T04:00:00.000Z', gateOutOdo: 500 }),
    pass('GP-T-04', { vin: SOLD, registrationNumber: 'JK02C0059TC', model: 'SYROS', gateOutAt: '2026-09-06T04:00:00.000Z', gateOutOdo: 100, gateInOdo: 130 }),
  ]
  const reading = (passNo: string, vin: string, gateInAt: string, gateInOdo: number): GateReadingInput =>
    ({ passNo, vin, gateInAt, gateInYmd: getIndiaYmd(gateInAt), gateInOdo })
  const response = buildFuelManagementResponse({
    period: { from: '2026-09-01', to: '2026-09-11', branch: 'ALL' },
    fuelRows,
    otherBranchFuelRows: [],
    priorDemoFills,
    demoFleet: fleetCars,
    drives,
    returnedInPeriod: [
      reading('GP-T-01', SELTOS, '2026-09-03T07:00:00.000Z', 8450),
      reading('GP-T-02', SELTOS, '2026-09-09T06:00:00.000Z', 8900),
      reading('GP-T-04', SOLD, '2026-09-06T06:00:00.000Z', 130),
    ],
    // 17:30 IST on 31 Aug — before the period, and before the Seltos's 2 Sep fill that reads LOWER.
    highestReturnedBeforePeriod: [reading('GP-T-00', SELTOS, '2026-08-31T12:00:00.000Z', 8390)],
    generatedAt: '2026-09-11T12:00:00.000Z',
  })

  const kpis = response.kpis
  assert('approved litres count every purpose in the period and nothing before it: 215 L on 10 requests',
    kpis.approvedLitres === 215 && kpis.approvedRequests === 10, `${kpis.approvedLitres} L on ${kpis.approvedRequests}`)
  const stages = kpis.awaiting.byStage.map((stage) => `${stage.label}:${stage.count}`).join(',')
  assert('awaiting covers every stage — CEO 2, Accounts 1 (held), legacy MD 1 — and not sent back',
    kpis.awaiting.total === 4 && stages === 'CEO:2,Accounts:1,MD:1', `${kpis.awaiting.total} — ${stages}`)
  assert('demo drive distance sums returned passes with both readings: 3 drives, 120 km',
    kpis.demoDrives === 3 && kpis.demoDriveKm === 120, `${kpis.demoDrives} drives, ${kpis.demoDriveKm} km`)
  assert('GPS-verified distance counts only reconciled drives: 1 drive, 48.6 km',
    kpis.gpsVerifiedDrives === 1 && kpis.gpsVerifiedKm === 48.6, `${kpis.gpsVerifiedDrives}, ${kpis.gpsVerifiedKm}`)
  assert('Needs a look counts warnings only: 4', kpis.checksNeedingAttention === 4, String(kpis.checksNeedingAttention))

  const purposes = response.byPurpose
    .map((p) => `${p.label}:${p.approvedLitres}/${p.approvedRequests}/${p.awaitingRequests}`).join(', ')
  assert('fuel by purpose: title case, approved litres descending, awaiting counted, a sent-back-only purpose dropped',
    purposes === 'Demo:143/6/2, Genset:40/1/0, Stock Transfer:32/3/0, Display Veh:0/0/1, New Delivery:0/0/1', purposes)

  const car = (vin: string) => response.demoCars.find((c) => c.vin === vin)
  const seltos = car(SELTOS)
  assert('Seltos km per litre is fill-to-fill on APPROVED fills: (8818 − 8368) ÷ 30 = 15.0 over 2',
    seltos?.kmPerLitre?.value === 15 && seltos.kmPerLitre.fillsUsed === 2 && seltos.kmPerLitreNote === null,
    JSON.stringify(seltos?.kmPerLitre))
  assert('Seltos lists its approved AND awaiting fills in the period, oldest first, and not the one before it',
    seltos?.fills.map((f) => f.requestNumber).join(',') === 'T-01,T-02,T-03', seltos?.fills.map((f) => f.requestNumber).join(','))
  assert('Seltos: 60 approved litres, last approved fill 2026-09-08 at 8818 km',
    seltos?.approvedLitres === 60 && seltos.lastFillDate === '2026-09-08' && seltos.lastFillOdometerKm === 8818)
  assert('km since last fill = highest gate-in on or after that day (8900) − 8818 = 82',
    seltos?.kmSinceLastFill === 82, String(seltos?.kmSinceLastFill))
  assert("the pass wearing the Sonet's plate with the Seltos's VIN is the Seltos's drive, not the Sonet's",
    seltos?.drives.map((d) => d.passNo).join(',') === 'GP-T-01,GP-T-02' && car(SONET)?.drives.length === 0)
  assert('Seltos drove 90 km by odometer, 48.6 km of it GPS-verified', seltos?.driveKm === 90 && seltos.gpsKm === 48.6)
  assert('Sonet: backwards odometer → no km per litre, with the note saying why',
    car(SONET)?.kmPerLitre === null && car(SONET)?.kmPerLitreNote === KM_PER_LITRE_NOTE.goesBackwards)
  const tailCar = car(TAIL_CAR)
  assert("the car named by tail '686082': one fill of 18 L, and a stock-transfer fill with the same vin_no is not on it",
    tailCar?.approvedLitres === 18 && tailCar.fills.length === 1 && tailCar.kmPerLitreNote === KM_PER_LITRE_NOTE.needsSecondFill)
  assert('a car with a drive and no fill is listed', car(TRADE_1)?.fills.length === 0 && car(TRADE_1)?.drives.length === 1)
  assert('a car no longer on the demo list is listed for its drive, described from the pass', car(SOLD)?.registrationNumber === 'JK02C0059TC')
  assert('the fill on trade plate JK02C0059TC is on no car', !response.demoCars.some((c) => c.fills.some((f) => f.requestNumber === 'T-11')))
  assert('nothing in the response is a cost or an efficiency label',
    !/\bcost|efficien|high burn|rupee|₹/i.test(JSON.stringify(response)))

  const checks = response.checks.map((c) => `${c.severity}:${c.kind}:${c.requestNumber}`)
  const flagged = (key: string) => checks.includes(key)
  assert('odometer_backwards against an approved fill from BEFORE the period (T-04 13766 < 13900)', flagged('warning:odometer_backwards:T-04'))
  assert('odometer_backwards between two fills in the period (T-05 13700 < 13766)', flagged('warning:odometer_backwards:T-05'))
  assert('gate_odometer_mismatch: a pass back on 31 Aug at 8390 km, before a 2 Sep fill reading 8368 km',
    flagged('warning:gate_odometer_mismatch:T-01'))
  assert('possible_duplicate flags the LATER of two same-day, same-litre fills and not the original',
    flagged('warning:possible_duplicate:T-07') && !flagged('warning:possible_duplicate:T-06'))
  assert('a different quantity, or a rejected row, is not a duplicate',
    !flagged('warning:possible_duplicate:T-08') && !flagged('warning:possible_duplicate:T-09'))
  const t10 = response.checks.find((c) => c.kind === 'unmatched_demo_fill' && c.requestNumber === 'T-10')
  const t11 = response.checks.find((c) => c.kind === 'unmatched_demo_fill' && c.requestNumber === 'T-11')
  assert('unmatched_demo_fill (info) for JK02DU7070 says it is not on the demo car list',
    t10?.severity === 'info' && t10.message.includes('JK02DU7070') && /not on the demo car list/i.test(t10.message), t10?.message ?? 'missing')
  assert('unmatched_demo_fill (info) for JK02C0059TC says it is a shared plate',
    t11?.severity === 'info' && t11.message.includes('JK02C0059TC') && /shared plate/i.test(t11.message), t11?.message ?? 'missing')
  assert('missing_odometer (info) for the demo fill with no reading', flagged('info:missing_odometer:T-11'))
  assert('nothing dated before the period is reported', !checks.some((key) => key.endsWith(':T-00')))
  assert('exactly those 7 checks and no others', checks.length === 7, checks.join(' | '))
  const firstInfo = response.checks.findIndex((c) => c.severity === 'info')
  assert('warnings come before info', firstInfo === -1 || response.checks.slice(firstInfo).every((c) => c.severity === 'info'))

  const otherFuel = response.otherFuel.map((row) => row.requestNumber).sort().join(',')
  assert('other fuel lists approved and awaiting non-demo fills, not rejected or sent back',
    otherFuel === 'T-06,T-07,T-08,T-13,T-14,T-16', otherFuel)
  assert("other fuel labels the purpose in title case ('GENSET' → 'Genset')",
    response.otherFuel.find((row) => row.requestNumber === 'T-13')?.purposeLabel === 'Genset')
}

console.log('\n9) Live database (read-only):')
async function liveChecks() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('  [SKIP] DATABASE_URL not set — static and pure checks only.')
    return
  }
  const local = url.includes('localhost') || url.includes('127.0.0.1')
  const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : { rejectUnauthorized: false } })
  // Written inside the transaction callback. The `as` keeps TypeScript from narrowing them to null at declaration,
  // since it does not see assignments made in a callback.
  let defaultPeriod = null as FuelManagementPeriod | null
  let expected = null as { litres: number; requests: number } | null
  try {
    await sql.begin('read only', async (tx) => {
      /*
       * These four were added on 2026-09-11 by scripts/setup-fuel-accounts-columns.js through the pooler,
       * with no migration. The action routes write them and a bare select() names them, so a database
       * without them 500s every Fuel Approvals request with 42703 — this fails loudly instead.
       */
      const columns = await tx<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'fuel_approvals' AND column_name LIKE 'accounts%'`
      const have = new Set(columns.map((c) => c.column_name))
      for (const column of ['accounts_approved_by', 'accounts_approved_by_name', 'accounts_approved_at', 'accounts_remarks']) {
        assert(`fuel_approvals.${column} exists`, have.has(column),
          'apply lib/db/migrations/0061_record_fuel_approvals_accounts_columns.sql on the DIRECT port 5432')
      }
      const fks = await tx<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM pg_constraint
        WHERE conrelid = 'public.fuel_approvals'::regclass AND contype = 'f'
          AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (accounts_approved_by)%'`
      assert('exactly one foreign key guards accounts_approved_by', fks[0].n === 1, `found ${fks[0].n}`)

      const grants = await tx<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM information_schema.role_table_grants
        WHERE table_schema = 'public' AND table_name = 'fuel_approvals' AND grantee = 'anon'`
      assert('anon holds ZERO grants on fuel_approvals', grants[0].n === 0, `found ${grants[0].n}`)

      const periodResult = resolveFuelManagementPeriod({}, getIndiaYmd())
      if (!periodResult.ok) throw new Error(`the default period was refused: ${periodResult.error}`)
      defaultPeriod = periodResult.period
      const [sum] = await tx<{ litres: string; n: number }[]>`
        SELECT COALESCE(SUM(fuel_filled_ltrs), 0)::text AS litres, COUNT(*)::int AS n
        FROM fuel_approvals
        WHERE status = 'approved'
          AND fuel_filled_date BETWEEN ${periodResult.period.from}::date AND ${periodResult.period.to}::date`
      expected = { litres: Number(sum.litres), requests: sum.n }
    })

    if (defaultPeriod && expected) {
      /*
       * The section's own read path, called exactly as GET /api/fuel-management calls it for the default period
       * (the current India month to date, all branches). It only reads. A failure here is a FAIL, not a skip: it
       * is the data the screen shows.
       */
      const { getFuelManagementOverview } = await import('../lib/fuel-management/reconciliation')
      const overview = await getFuelManagementOverview(defaultPeriod)
      assert(`approved litres ${defaultPeriod.from}..${defaultPeriod.to} equal a direct SQL sum (${expected.litres} L)`,
        Math.abs(overview.kpis.approvedLitres - expected.litres) < 0.005,
        `API ${overview.kpis.approvedLitres} L vs SQL ${expected.litres} L`)
      assert(`approved requests in the same period equal the SQL count (${expected.requests})`,
        overview.kpis.approvedRequests === expected.requests,
        `API ${overview.kpis.approvedRequests} vs SQL ${expected.requests}`)
      console.log(`  [INFO] ${defaultPeriod.from}..${defaultPeriod.to}: ${overview.demoCars.length} demo car(s), `
        + `${overview.kpis.awaiting.total} awaiting, ${overview.checks.length} check(s) (${overview.kpis.checksNeedingAttention} warning(s))`)
    }
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
