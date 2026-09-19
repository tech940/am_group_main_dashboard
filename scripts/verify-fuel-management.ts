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
import {
  ACCOUNTABILITY_SINCE,
  buildLedger,
  eventMatches,
  ledgerTransaction,
  ledgerWindow,
  listLedgerEvents,
  summariseLedger,
  type LedgerInput,
  type LedgerPassInput,
  type LedgerRowInput,
} from '../lib/fuel-management/ledger'
import { DEFAULT_FUEL_SETTINGS } from '../lib/fuel-management/engine'
import type {
  DemoFleetCarInput,
  DrivePassInput,
  FuelFilters,
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

/**
 * Who opens each fuel section BY DEFAULT — the owner's decision of 2026-09-11, which narrowed both.
 * Before it, Fuel Management admitted 14 roles plus anyone holding gate_pass.view (nearly every role), and
 * Fuel Approvals 11. The CEO and HR keep Fuel Approvals because the CEO is its final approver and HR raises
 * the requests. Individual Access-Map ticks are kept on top of this, by the same decision.
 */
const FUEL_MANAGEMENT_AUDIENCE = ['developer', 'md', 'ea']
const FUEL_APPROVALS_AUDIENCE = ['developer', 'md', 'ea', 'ceo', 'hr']

console.log('\n1) Both fuel sections are registered in EVERY place a section has to be:')
{
  const group = PERMISSION_GROUPS.find((g) => g.key === 'fuel_management')
  assert('fuel_management exists in PERMISSION_GROUPS', Boolean(group))
  // A fractional sortOrder (153.1) failed the registry sync with 22P02 and took down the whole Access Map.
  assert('its sortOrder is an integer', Number.isInteger(group?.sortOrder), `got ${String(group?.sortOrder)}`)
  assert('fuel_management routes to /fuel-management', SECTION_ROUTES.fuel_management?.href === '/fuel-management')
  assert('fuel_approvals routes to /fuel-approvals', SECTION_ROUTES.fuel_approvals?.href === '/fuel-approvals')
  // ⚠️ Restricted-by-default since 2026-09-11. On that list every brand user and every global-access role
  // was handed both sections, which is how Fuel Management reached almost the whole company.
  assert('neither fuel section is on DEFAULT_VISIBLE_SECTIONS any more',
    !DEFAULT_VISIBLE_SECTIONS.has('fuel_management') && !DEFAULT_VISIBLE_SECTIONS.has('fuel_approvals'))

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
    // 'kia' since 2026-09-16 — the sidebar lists both under AM Kia. Access is unchanged; see section 2.
    assert(`${href} is filed under KIA, as the sidebar lists it`, entries[0]?.brand === 'kia')
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
    assert('/fuel-management is found with fuel_management.view',
      canUserAccessSection(fm, 'ea', 'all', only('fuel_management.view')))
    // ⚠️ Until 2026-09-11 both of these opened it too. gate_pass.view is held by nearly every role, so search
    // put Fuel Management in front of almost the whole company.
    for (const key of ['fuel_approvals.view', 'gate_pass.view']) {
      assert(`/fuel-management is NOT found with only ${key}`, !canUserAccessSection(fm, 'sales_manager', 'kia', only(key)))
    }
    assert('/fuel-management is NOT found while the permission map is still loading',
      !canUserAccessSection(fm, 'viewer', 'kia', null))
    // ⚠️ The case that proves the move to KIA took nothing away: a non-KIA holder still finds it.
    assert('/fuel-management is still found by a Hyundai login holding its key (filed under KIA, not scoped to it)',
      canUserAccessSection(fm, 'viewer', 'hyundai', only('fuel_management.view')))
    assert('a super admin finds /fuel-management before the map loads', canUserAccessSection(fm, 'md', null, null))
    assert('/fuel-approvals is still found by a Platinum login holding its key',
      canUserAccessSection(fa, 'viewer', 'platinum', only('fuel_approvals.view')))
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
  // The first array literal naming 'ea' is the view role set. (The edit rule's set, later in the same file,
  // never names EA — section 8d asserts that.)
  const fmRoles = roleArrayContaining(access, 'ea')
  assert("its role list is exactly the audience the owner chose on 2026-09-11 (EA, MD, Developer)",
    sameSet(fmRoles, FUEL_MANAGEMENT_AUDIENCE), `got [${fmRoles.join(', ')}]`)

  const page = stripComments(read('app/fuel-management/page.tsx'))
  // Since the redesign every /api/fuel-management route calls ONE guard (lib/fuel-management/api.ts), and the
  // period is parsed by parseFuelFilters (lib/fuel-management/ledger-reads.ts). Section 11 checks every route uses it.
  const route = stripComments(read('app/api/fuel-management/route.ts'))
  const guard = stripComments(read('lib/fuel-management/api.ts'))
  const parse = stripComments(read('lib/fuel-management/ledger-reads.ts'))
  const api = route + guard
  assert('app/fuel-management/page.tsx calls canViewFuelManagement', page.includes('canViewFuelManagement('))
  assert("the page keeps the literal 'fuel_management.view' (verify:guard-parity greps page source)",
    page.includes("'fuel_management.view'"))
  assert('GET /api/fuel-management calls canViewFuelManagement (through guardFuelManagement)',
    route.includes('guardFuelManagement(') && guard.includes('canViewFuelManagement('))
  // Either spelling counts: a literal `status: 401`, or a helper called with the code (`refuse(401, …)`).
  const answers = (code: number) => new RegExp(`(?:status:\\s*|\\w+\\(\\s*)${code}\\b`).test(api)
  assert('the API answers 401 when signed out', answers(401))
  assert('the API answers 403 when the predicate says no', answers(403))
  assert('the API answers 400 for a bad period, validated by resolveFuelManagementPeriod against the India day',
    answers(400) && parse.includes('resolveFuelManagementPeriod(') && parse.includes('getIndiaYmd(') && route.includes('parseFuelFilters('))
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
  assert('FUEL_APPROVALS_VIEW_ROLES is exactly the audience the owner chose on 2026-09-11 (EA, MD, Developer, CEO, HR)',
    sameSet([...FUEL_APPROVALS_VIEW_ROLES], FUEL_APPROVALS_AUDIENCE), `got [${FUEL_APPROVALS_VIEW_ROLES.join(', ')}]`)
}

console.log('\n4b) The permission resolver gives both fuel sections exactly that audience, for EVERY role:')
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const S = require('../lib/permissions/service') as typeof import('../lib/permissions/service')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('../lib/permissions/registry') as typeof import('../lib/permissions/registry')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const T = require('../lib/permissions/tiers') as typeof import('../lib/permissions/tiers')
  type Role = import('../lib/permissions/registry').PermissionRole
  const ALL_FALSE = Object.fromEntries(R.PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>
  const roles = Object.keys(T.ROLE_PROFILE) as Role[]
  /*
   * ⚠️ Why every role, and both resolvers. Taking fuel off DEFAULT_VISIBLE_SECTIONS was not enough by itself:
   * the global-access blanket would have taken Fuel Approvals from the CEO (its only approver), the tier bundle
   * would have handed it to VP through the CEO's template, and `admin` is family 'super', whose bundle is every
   * key. A spot check of a few roles misses exactly those.
   */
  for (const [label, resolve] of [['live tiered resolver', S.resolveEffectiveSnapshotV2], ['legacy resolver', S.resolveEffectiveSnapshot]] as const) {
    const wrongFm: string[] = []
    const wrongFa: string[] = []
    for (const role of roles) {
      const effective = resolve(ALL_FALSE, {}, role, 'all').effective
      if ((effective['fuel_management.view'] === true) !== FUEL_MANAGEMENT_AUDIENCE.includes(role)) {
        wrongFm.push(`${role}=${effective['fuel_management.view']}`)
      }
      if ((effective['fuel_approvals.view'] === true) !== FUEL_APPROVALS_AUDIENCE.includes(role)) {
        wrongFa.push(`${role}=${effective['fuel_approvals.view']}`)
      }
    }
    assert(`${label}: Fuel Management reaches EA, MD and Developer and none of the other ${roles.length - 3} roles`,
      wrongFm.length === 0, wrongFm.join(', '))
    assert(`${label}: Fuel Approvals reaches EA, MD, Developer, CEO and HR and no other role`,
      wrongFa.length === 0, wrongFa.join(', '))
  }
  const V2 = S.resolveEffectiveSnapshotV2
  assert('the CEO can still APPROVE fuel — the stage it owns',
    V2(ALL_FALSE, {}, 'ceo', 'all').effective['fuel_approvals.approve'] === true)
  const hr = V2(ALL_FALSE, {}, 'hr', 'all').effective
  assert('HR can raise a fuel request but cannot approve one',
    hr['fuel_approvals.create'] === true && hr['fuel_approvals.approve'] !== true)
  // The owner kept the four individual ticks (1 Accounts, 3 Viewers).
  assert('an individual Access-Map tick still opens Fuel Approvals for a Viewer',
    V2(ALL_FALSE, { 'fuel_approvals.view': true }, 'viewer', 'kia').effective['fuel_approvals.view'] === true)
  assert('an individual Access-Map deny still closes it for the CEO',
    V2(ALL_FALSE, { 'fuel_approvals.view': false }, 'ceo', 'all').effective['fuel_approvals.view'] === false)
  // A leftover role grant in the database is a DEFAULT, and the clamp runs on the default layer.
  assert('a leftover role-level grant in the database cannot reopen Fuel Approvals for a Manager',
    V2({ ...ALL_FALSE, 'fuel_approvals.view': true }, {}, 'manager', 'kia').effective['fuel_approvals.view'] !== true)
}

console.log('\n5) The API ships only what the screen shows, read from only the columns it needs:')
{
  const types = stripComments(read('lib/fuel-management/types.ts'))
  assert('lib/fuel-management/types.ts declares FuelManagementResponse',
    /\b(?:type|interface)\s+FuelManagementResponse\b/.test(types))
  const leak = types.match(/\b\w*(?:email|slip|remark|history|submitted|approvedBy|approverId)\w*\b/i)
  assert('no type there carries an email, slip URL, remark, history, submitter or approver field', !leak,
    leak ? `found "${leak[0]}"` : '')

  const serverFiles = [...walk('lib/fuel-management'), ...walk('app/api/fuel-management')]
  for (const rel of serverFiles) {
    const src = stripComments(read(rel))
    /*
     * ⚠️ 2026-09-16 (redesign): the control centre names the people behind a fuel record — requester, approver,
     * who recorded the bill — because accountability needs a name, and the section is open to EA, MD and
     * Developer only. What stays banned everywhere: slip URLs, free-text notes, email addresses, user ids.
     */
    const column = src.match(
      /fuelApprovals\.(?:fuelSlipUrl|remarks|\w+Remarks|submittedByEmail|submittedById|\w+ApprovedBy(?!Name)\b|rejectedBy(?!Name)\w*|sendBackReason)\b|\b(?:fuel_slip_url|submitted_by_email)\b/,
    )
    assert(`${rel} never reads a slip, note, email or user-id column`, !column, column?.[0] ?? '')
    if (/fuelApprovals\.history\b/.test(src)) {
      // The approval trail carries an email per actor. Only the ledger reads may touch it, and only to reduce it.
      assert(`${rel} reads the approval trail only to reduce it to action, name, role and time`,
        rel === 'lib/fuel-management/ledger-reads.ts' && /function toTrail\(/.test(src)
          && !/userEmail|remarks/.test(src.slice(src.indexOf('function toTrail('), src.indexOf('function toTrail(') + 700)))
    }
    assert(`${rel} never SELECT *s (a bare .select())`, !/\.select\(\s*\)/.test(src))
    // The old overview bucketed gate passes with toISOString().slice(0, 10) — a UTC day, wrong before 05:30 IST.
    assert(`${rel} never takes a calendar day from UTC`, !/toISOString\(\)\s*\.(?:slice|split|substring)\(/.test(src))
    /*
     * ⚠️ Cost and efficiency status became REAL on 2026-09-11: staff type the receipt total, and expected mileage is
     * configured by MD/GM/admin. What stays banned in EVERY file is an INVENTED one — a price literal (the screen this
     * replaced used ₹98/₹88 per litre), a threshold label nobody set ("High Burn"), or hardcoded coverage text.
     * The engine derives cost and status from its inputs, so it alone may name them; every other file must take them
     * from the engine rather than compute its own.
     */
    const fabricated = src.match(/₹\s*\d|High Burn|high_consumption|Active across/i)
    assert(`${rel} invents no price, threshold label or coverage text`, !fabricated, fabricated?.[0] ?? '')
    if (rel !== 'lib/fuel-management/engine.ts') {
      /*
       * Other files READ the engine's cost per km and efficiency status (the ledger passes them to the screen);
       * none may COMPUTE one. A cost divided by a distance, or a status decided from a percentage, outside the
       * engine is the thing this rule exists to stop.
       */
      const derived = src.match(/(?:cost|spend)\w*\s*\/\s*\(?\s*\w*(?:km|distance)\w*|efficiencyPct\s*>=|statusGoodMinPct|statusWatchMinPct/i)
      assert(`${rel} leaves cost per km and efficiency status to the engine`, !derived, derived?.[0] ?? '')
    }
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
  // The screen is split across features/fuel-management/*; every rule below holds for all of it.
  const client = walk('features/fuel-management').map((rel) => stripComments(read(rel))).join('\n')
  assert('features/fuel-management/fuel-management-client.tsx exists', read('features/fuel-management/fuel-management-client.tsx').length > 0)
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

console.log('\n8b) The calculation engine, on the owner\'s own examples:')
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const E = require('../lib/fuel-management/engine') as typeof import('../lib/fuel-management/engine')
  type Fill = import('../lib/fuel-management/engine').EngineFill
  let seq = 0
  const fill = (over: Partial<Fill> & Pick<Fill, 'date'>): Fill => ({
    id: over.id ?? `f${++seq}`, vehicleKey: 'VIN-CRETA', sequence: seq, energyType: 'petrol', unit: 'L',
    quantity: 40, totalCost: null, odometerKm: null, isFullTank: true, odometerOverride: false, ...over,
  })
  const near = (a: number | null | undefined, b: number, eps = 0.005) => typeof a === 'number' && Math.abs(a - b) <= eps

  // The owner's worked example: 20,000 km full → 20,600 km full with 42 L.
  {
    const segs = E.buildSegments([
      fill({ id: 'a', date: '2026-08-01', odometerKm: 20000, quantity: 40, totalCost: 3920 }),
      fill({ id: 'b', date: '2026-08-10', odometerKm: 20600, quantity: 42, totalCost: 4116 }),
    ])
    const full = segs.filter((s) => s.kind === 'full_tank')
    assert('full tank to full tank: 600 km on 42 L is 14.29 km/L', full.length === 1 && full[0].distanceKm === 600 &&
      full[0].quantity === 42 && near(full[0].efficiency, 14.2857, 0.0001), JSON.stringify(full[0]))
    assert('cost per km comes from the receipt total: ₹4,116 over 600 km is ₹6.86/km', near(full[0]?.costPerKm, 6.86))
    assert('the opening fill\'s fuel is NOT counted — it was burned before the stretch began', !full[0]?.countedFillIds.includes('a'))
  }
  {
    const segs = E.buildSegments([
      fill({ id: 'a', date: '2026-08-01', odometerKm: 20000 }),
      fill({ id: 'p', date: '2026-08-05', odometerKm: 20300, quantity: 10, isFullTank: false }),
      fill({ id: 'b', date: '2026-08-10', odometerKm: 20600, quantity: 32 }),
    ]).filter((s) => s.kind === 'full_tank')
    assert('a partial fill inside the stretch adds its fuel and does not break it (10 L + 32 L over 600 km)',
      segs.length === 1 && segs[0].quantity === 42 && near(segs[0].efficiency, 14.2857, 0.0001) && segs[0].countedFillIds.join() === 'p,b')
  }
  {
    const problem = (fills: Fill[]) => E.buildSegments(fills).find((s) => s.kind === 'full_tank')?.problem
    assert('a missing closing odometer gives no mileage', problem([
      fill({ date: '2026-08-01', odometerKm: 20000 }), fill({ date: '2026-08-10', odometerKm: null }),
    ]) === 'missing_odometer')
    assert('an odometer that goes backwards inside the stretch gives no mileage', problem([
      fill({ date: '2026-08-01', odometerKm: 20000 }), fill({ date: '2026-08-04', odometerKm: 19900, isFullTank: false }),
      fill({ date: '2026-08-10', odometerKm: 20600 }),
    ]) === 'odometer_decrease')
    assert('an authorised odometer correction inside the stretch gives no mileage', problem([
      fill({ date: '2026-08-01', odometerKm: 20000 }), fill({ date: '2026-08-10', odometerKm: 20600, odometerOverride: true }),
    ]) === 'override_inside')
    assert('50 km is below the minimum distance — "Mileage unavailable", not a small-sample figure', problem([
      fill({ date: '2026-08-01', odometerKm: 20000 }), fill({ date: '2026-08-02', odometerKm: 20050 }),
    ]) === 'too_short')
    const afterCorrection = E.buildSegments([
      fill({ date: '2026-08-01', odometerKm: 90000 }), fill({ id: 'fix', date: '2026-08-05', odometerKm: 100, odometerOverride: true }),
      fill({ id: 'next', date: '2026-08-12', odometerKm: 700, quantity: 40 }),
    ]).find((s) => s.closingFillId === 'next' && s.kind === 'full_tank')
    assert('the stretch AFTER a correction starts cleanly from the corrected reading', afterCorrection?.usable === true && afterCorrection.distanceKm === 600)
  }
  {
    const segs = E.buildSegments([
      fill({ id: 'x', date: '2026-08-01', odometerKm: 1000, isFullTank: null }),
      fill({ id: 'y', date: '2026-08-06', odometerKm: 1500, quantity: 30, isFullTank: null }),
    ])
    const s = E.summariseVehicleMileage(segs, 'VIN-CRETA', 'L', '2026-08-31')
    assert('with no full-tank information the figure is PROVISIONAL and labelled so (500 km ÷ 30 L)',
      segs.length === 1 && segs[0].kind === 'provisional' && s.basis === 'provisional' && near(s.current, 16.667, 0.001))
    const partial = E.buildSegments([
      fill({ date: '2026-08-01', odometerKm: 1000, isFullTank: null }),
      fill({ date: '2026-08-06', odometerKm: 1500, quantity: 5, isFullTank: false }),
    ])
    assert('a fill known to be partial never becomes a provisional figure', partial.length === 0)
    const none = E.summariseVehicleMileage([], 'VIN-CRETA', 'L', '2026-08-31')
    assert('one fill is "Needs a second fill with an odometer reading"', none.basis === 'none' && /second fill/.test(none.unavailableReason ?? ''))
  }
  {
    const segs = E.buildSegments([
      fill({ vehicleKey: 'HYB', date: '2026-08-01', odometerKm: 1000, unit: 'L', energyType: 'hybrid' }),
      fill({ vehicleKey: 'HYB', date: '2026-08-02', odometerKm: 1100, unit: 'kWh', energyType: 'hybrid', quantity: 12 }),
      fill({ vehicleKey: 'HYB', date: '2026-08-10', odometerKm: 1600, unit: 'L', energyType: 'hybrid', quantity: 30 }),
      fill({ vehicleKey: 'HYB', date: '2026-08-11', odometerKm: 1700, unit: 'kWh', energyType: 'hybrid', quantity: 20 }),
    ]).filter((s) => s.kind === 'full_tank')
    assert('a hybrid keeps km/L and km/kWh as separate streams — units are never mixed',
      segs.length === 2 && segs.some((s) => s.unit === 'L' && s.quantity === 30) && segs.some((s) => s.unit === 'kWh' && s.quantity === 20) &&
      E.efficiencyUnitLabel('kWh') === 'km/kWh' && E.ENERGY_UNIT.ev === 'kWh' && E.ENERGY_UNIT.cng === 'kg')
  }
  {
    // 16.2 → 15.8 → 15.1 → 14.3 km/L across four full-tank stretches of 600 km.
    const effs = [16.2, 15.8, 15.1, 14.3]
    let odo = 10000
    const fills: Fill[] = [fill({ date: '2026-05-01', odometerKm: odo })]
    effs.forEach((e, i) => { odo += 600; fills.push(fill({ date: `2026-0${6 + i}-01`, odometerKm: odo, quantity: 600 / e, totalCost: (600 / e) * 100 })) })
    const segs = E.buildSegments(fills)
    const s = E.summariseVehicleMileage(segs, 'VIN-CRETA', 'L', '2026-09-15')
    assert('current mileage is the latest full-tank stretch (14.3)', near(s.current, 14.3, 0.001))
    assert('the last three refuels read 15.8 → 15.1 → 14.3', s.lastRefuels.length === 3 && near(s.lastRefuels[0], 15.8, 0.001) && near(s.lastRefuels[2], 14.3, 0.001))
    assert('four consecutive falls are flagged as a declining trend', s.declining === true)
    assert('best and worst come from the stretches themselves', near(s.best, 16.2, 0.001) && near(s.worst, 14.3, 0.001))
    const expectedAvg = 2400 / effs.reduce((t, e) => t + 600 / e, 0)
    assert('the average is total distance ÷ total fuel, not the average of the four ratios',
      near(s.average, expectedAvg, 0.0001) && !near(s.average, effs.reduce((a, b) => a + b, 0) / 4, 0.0001))
    assert('last 30 days holds only the stretch that closed inside it', near(s.last30Days, 14.3, 0.001))
    assert('cost per km over the stretches uses the receipt totals (₹100/L at ~15.3 km/L is ₹6.5/km)', near(s.costPerKm, 100 / expectedAvg, 0.001))
  }
  {
    const benchmarks: import('../lib/fuel-management/engine').FuelBenchmark[] = [
      { scope: 'model', model: 'creta', energyType: 'petrol', unit: 'L', expectedEfficiency: 16, tankCapacity: 50 },
      { scope: 'model_variant', model: 'CRETA', variant: 'SX', energyType: 'petrol', unit: 'L', expectedEfficiency: 15, tankCapacity: 50 },
      { scope: 'vehicle', vin: 'VIN-CRETA', energyType: 'petrol', unit: 'L', expectedEfficiency: 14, tankCapacity: 50 },
      { scope: 'model', model: 'CRETA', energyType: 'diesel', unit: 'L', expectedEfficiency: 19, tankCapacity: 50 },
    ]
    const subject = { vin: 'VIN-CRETA', model: 'Creta', variant: 'SX', energyType: 'petrol' as const, unit: 'L' as const }
    assert('a benchmark set for this vehicle beats its model and variant', E.resolveBenchmark(subject, benchmarks)?.expectedEfficiency === 14)
    assert('model + variant beats model', E.resolveBenchmark({ ...subject, vin: 'OTHER' }, benchmarks)?.expectedEfficiency === 15)
    assert('the energy type must match — a diesel benchmark never judges a petrol car',
      E.resolveBenchmark({ ...subject, vin: 'OTHER', variant: 'EX' }, benchmarks)?.expectedEfficiency === 16)
    assert('no benchmark is null, never a guess', E.resolveBenchmark({ ...subject, vin: 'X', model: 'Venue', variant: null }, benchmarks) === null)

    const watch = E.assessEfficiency(13.8, 16)
    assert('13.8 against 16 km/L is 86.25% and −2.2 km/L: Watch', watch.status === 'watch' && near(watch.efficiencyPct, 86.25) && near(watch.variance, -2.2))
    assert('15.4 against 16 is Good; 13.1 against 18 is Poor', E.assessEfficiency(15.4, 16).status === 'good' && E.assessEfficiency(13.1, 18).status === 'poor')
    assert('the thresholds are settings, not constants', E.assessEfficiency(13.8, 16, { ...E.DEFAULT_FUEL_SETTINGS, statusWatchMinPct: 90 }).status === 'poor')
    assert('without a benchmark the status is "No benchmark"; without a figure it is "No data"',
      E.assessEfficiency(14, null).status === 'no_benchmark' && E.assessEfficiency(null, 16).status === 'no_data')
  }
  {
    const b = E.decomposeCostChange({ distanceKm: 10000, quantity: 700, cost: 70000 }, { distanceKm: 12000, quantity: 900, cost: 94500 })
    assert('the cost change splits into distance, price and efficiency parts that add up EXACTLY',
      b !== null && Math.abs(b.distance + b.price + b.efficiency - b.total) < 1e-6 && b.total === 24500, JSON.stringify(b))
    assert('more distance, a higher price and worse mileage each push the cost up', b !== null && b.distance > 0 && b.price > 0 && b.efficiency > 0)
    const flat = E.decomposeCostChange({ distanceKm: 1000, quantity: 70, cost: 7000 }, { distanceKm: 1000, quantity: 70, cost: 7000 })
    assert('an unchanged period decomposes to zero, not NaN', flat !== null && flat.total === 0 && Math.abs(flat.distance) < 1e-9)
    assert('a missing factor gives no breakdown at all', E.decomposeCostChange({ distanceKm: 0, quantity: 70, cost: 7000 }, { distanceKm: 1000, quantity: 70, cost: 7000 }) === null)
  }
  {
    const tank: import('../lib/fuel-management/engine').FuelBenchmark = { scope: 'model', model: 'X', energyType: 'petrol', unit: 'L', expectedEfficiency: 15, tankCapacity: 50 }
    const run = (fills: Fill[], withBenchmark = true, settings = E.DEFAULT_FUEL_SETTINGS) =>
      E.detectExceptions({ fills, segments: E.buildSegments(fills, settings), benchmarkFor: () => (withBenchmark ? tank : null), settings })
    const dec = run([fill({ date: '2026-08-01', odometerKm: 45200 }), fill({ date: '2026-08-05', odometerKm: 44900, isFullTank: false, quantity: 10 })])
    assert('an odometer 300 km lower than the previous reading is flagged with both readings',
      dec.some((x) => x.kind === 'odometer_decrease' && x.variance === -300 && /300 km lower/.test(x.message)))
    assert('an authorised correction is not flagged again', !run([
      fill({ date: '2026-08-01', odometerKm: 45200 }), fill({ date: '2026-08-05', odometerKm: 44900, odometerOverride: true }),
    ]).some((x) => x.kind === 'odometer_decrease'))
    assert('68 L against a configured 50 L tank is flagged; 52 L (within 5%) is not',
      run([fill({ id: 'big', date: '2026-08-01', quantity: 68 }), fill({ id: 'ok', date: '2026-08-09', quantity: 52 })])
        .filter((x) => x.kind === 'above_tank_capacity').map((x) => x.fillId).join() === 'big')
    assert('no configured capacity, no tank check', !run([fill({ date: '2026-08-01', quantity: 68 })], false).some((x) => x.kind === 'above_tank_capacity'))

    const history = (effs: number[]) => {
      let odo = 0
      const fills: Fill[] = [fill({ date: '2026-01-01', odometerKm: odo })]
      effs.forEach((e, i) => { odo += 600; fills.push(fill({ date: `2026-${String(2 + i).padStart(2, '0')}-01`, odometerKm: odo, quantity: 600 / e })) })
      return fills
    }
    const drop = run(history([15.8, 16.0, 15.6, 10.9]), false)
    assert('10.9 km/L after a usual 15.8 is a 31% mileage drop', drop.some((x) => x.kind === 'mileage_drop' && /31% below/.test(x.message)),
      drop.map((x) => x.message).join(' | '))
    assert('two earlier stretches are not enough history to call a drop', !run(history([15.8, 16.0, 10.9]), false).some((x) => x.kind === 'mileage_drop'))
    const wild = run([fill({ date: '2026-08-01', odometerKm: 1000 }), fill({ date: '2026-08-10', odometerKm: 4200, quantity: 40 })])
    assert('80 km/L against an expected 15 is a possible data-entry error — never "fraud"',
      wild.some((x) => x.kind === 'impossible_mileage' && /data-entry error/.test(x.message)) && !wild.some((x) => /fraud|fault|tamper/i.test(x.message)))
    /*
     * ⚠️ Changed 2026-09-19 (owner: "average mileage is wrong"). This used to assert that with no benchmark and no
     * history NOTHING could be called impossible — which is how 58,677 km on 20 L (2,934 km/L, a mistyped odometer)
     * reached the fleet average and made it 424.8 km/L. There is now an absolute ceiling (maxPlausibleKmPerLitre, a
     * setting) that needs no benchmark; a believable figure with no benchmark is still left alone.
     */
    const noBenchmark = [fill({ date: '2026-08-01', odometerKm: 1000 }), fill({ date: '2026-08-10', odometerKm: 4200, quantity: 40 })]
    assert('with no benchmark, 80 km/L is still flagged — the ceiling needs no expected mileage',
      run(noBenchmark, false).some((x) => x.kind === 'impossible_mileage' && /data-entry error/.test(x.message)))
    const believable = [fill({ date: '2026-08-01', odometerKm: 1000 }), fill({ date: '2026-08-10', odometerKm: 1800, quantity: 40 })]
    assert('with no benchmark, a believable 20 km/L is not called impossible', !run(believable, false).some((x) => x.kind === 'impossible_mileage'))
    {
      const segs = E.buildSegments([...noBenchmark, ...believable.map((f, i) => ({ ...f, id: `b${i}`, vehicleKey: 'V2' }))], E.DEFAULT_FUEL_SETTINGS)
      const fleet = E.fleetEfficiency(segs, 'L', '2026-08-01', '2026-08-31')
      assert('the mistyped stretch is left out of the fleet average, and counted as left out',
        segs.some((x) => x.problem === 'implausible_mileage' && !x.usable) && fleet.efficiency === 20 && fleet.implausibleSegments === 1,
        JSON.stringify({ eff: fleet.efficiency, left: fleet.implausibleSegments }))
    }
    {
      // Market-price estimates ride beside the bill; they never become one.
      const f = (over: Partial<Fill>) => fill({ date: '2026-08-01', odometerKm: 1000, quantity: 40, ...over })
      const segs = E.buildSegments([f({ id: 'e1', totalCost: 4000 }), f({ id: 'e2', date: '2026-08-10', odometerKm: 1600, totalCost: null, estimatedCost: 4165 })], E.DEFAULT_FUEL_SETTINGS)
      const s1 = segs[0]
      assert('an unbilled fill gets an estimated cost, but the billed cost stays unknown',
        Boolean(s1) && s1.cost === null && s1.costWithEstimates === 4165 && s1.estimatedFills === 1, JSON.stringify(s1))
    }
    const sameDay = run([1, 2, 3, 4].map((i) => fill({ date: '2026-08-01', quantity: 5 + i, isFullTank: false })), false)
    assert('four fills in one day is flagged once', sameDay.filter((x) => x.kind === 'refuel_frequency').length === 1)
    const priced = [98, 99, 100, 101, 100, 130].map((p, i) => fill({ vehicleKey: `V${i}`, date: '2026-08-01', quantity: 10, totalCost: p * 10 }))
    const prices = run(priced, false).filter((x) => x.kind === 'price_out_of_range')
    assert('₹130/L among ~₹100/L fills is flagged as a price outlier', prices.length === 1 && /30% above/.test(prices[0].message), prices.map((x) => x.message).join(' | '))
    assert('below the minimum sample, prices are not judged', run(priced.slice(0, 3), false).filter((x) => x.kind === 'price_out_of_range').length === 0)
    assert('the same vehicle, date and quantity twice is a possible duplicate', run([
      fill({ id: 'd1', date: '2026-08-01', quantity: 20 }), fill({ id: 'd2', date: '2026-08-01', quantity: 20 }),
    ], false).some((x) => x.kind === 'possible_duplicate' && x.fillId === 'd2'))
  }
  {
    const previous = fill({ id: 'prev', date: '2026-08-01', odometerKm: 20000 })
    const context = { previousReading: previous, openFullTank: previous, fillsSinceFullTank: [], tankCapacity: 50, expectedEfficiency: 16, baselineEfficiency: null }
    const draft = { vehicleKey: 'VIN-CRETA', isVehicle: true, energyType: 'petrol' as const, unit: 'L' as const, date: '2026-08-10', quantity: 42, totalCost: 3990, odometerKm: 20600, isFullTank: true }
    const { issues, preview } = E.previewFuelEntry(draft, context)
    assert('before saving: 600 km since the last reading, 14.29 km/L (full tank), ₹3,990, ₹6.65/km',
      issues.length === 0 && preview.distanceSincePreviousKm === 600 && preview.efficiencyBasis === 'full_tank' &&
      near(preview.efficiency, 14.29) && preview.cost === 3990 && near(preview.costPerKm, 6.65) && near(preview.unitPrice, 95),
      JSON.stringify({ issues, preview }))
    const bad = E.previewFuelEntry({ ...draft, quantity: -5, totalCost: null, isFullTank: null }, context).issues
    assert('a negative quantity, a missing receipt total and an unanswered full-tank question block the save',
      ['quantity', 'total_cost', 'full_tank_missing'].every((code) => bad.some((i) => i.code === code && i.level === 'error')))
    const lower = E.previewFuelEntry({ ...draft, odometerKm: 19700 }, context).issues
    assert('an odometer below the last reading warns and needs an authorised override — it is not silently rejected',
      lower.some((i) => i.code === 'odometer_decrease' && i.level === 'warning' && i.requiresOverride))
    const genset = E.previewFuelEntry({ ...draft, vehicleKey: 'GENSET', isVehicle: false, odometerKm: null, isFullTank: null, energyType: 'diesel' }, { ...context, previousReading: null, openFullTank: null })
    assert('a genset needs no odometer or full-tank answer, and gets no mileage', genset.issues.length === 0 && genset.preview.efficiency === null)
  }
  {
    const lines = E.describeFleetPeriod({
      streams: [{ unit: 'L', quantity: 420, distanceKm: 5240, spend: 39824 }],
      vehiclesBelowExpected: 2,
      benchmarksConfigured: true,
      spendBefore: 36536,
      spendAfter: 39824,
      breakdown: { total: 3288, distance: 2500, price: 500, efficiency: 288 },
    })
    assert('"420 L consumed across 5,240 km, averaging 12.5 km/L at ₹7.60/km."', lines[0] === '420 L consumed across 5,240 km, averaging 12.5 km/L at ₹7.60/km.', lines.join(' | '))
    assert('"2 vehicles are below their expected efficiency."', lines.includes('2 vehicles are below their expected efficiency.'))
    assert('"Fuel spend rose 9% compared with the previous period, mainly because of more distance travelled."',
      lines.includes('Fuel spend rose 9% compared with the previous period, mainly because of more distance travelled.'), lines.join(' | '))
    const honest = E.describeFleetPeriod({ streams: [{ unit: 'L', quantity: 260, distanceKm: 0, spend: null }], vehiclesBelowExpected: 0, benchmarksConfigured: false, spendBefore: null, spendAfter: null, breakdown: null })
    assert('with today\'s data it says mileage and cost are unavailable instead of inventing them',
      honest.some((l) => /mileage is unavailable/.test(l)) && honest.some((l) => /Cost is unavailable/.test(l)) && honest.some((l) => /No expected mileage is set/.test(l)))
    assert('Indian digit grouping: 1,82,400 km', E.formatNumber(182400) === '1,82,400')
  }
  {
    const engineSrc = stripComments(read('lib/fuel-management/engine.ts'))
    assert('the engine is pure — no imports, no database, no clock',
      engineSrc.length > 0 && !/^\s*import\s/m.test(engineSrc) && !/\bnew Date\(\s*\)|Date\.now\(\)/.test(engineSrc))
    assert('no expected mileage is written into the engine — benchmarks arrive as input',
      !/expectedEfficiency\s*:\s*\d/.test(engineSrc))
  }
}

console.log('\n8c) Migrations 0063/0064 and the schema say the same thing:')
{
  const m63 = read('lib/db/migrations/0063_add_fuel_entry_columns.sql')
  const r63 = read('lib/db/migrations/0063_rollback_add_fuel_entry_columns.sql')
  const m64 = read('lib/db/migrations/0064_add_fuel_benchmarks_and_settings.sql')
  const r64 = read('lib/db/migrations/0064_rollback_add_fuel_benchmarks_and_settings.sql')
  // Several checks below are about what the SQL DOES, so they must not read the commentary that explains
  // what it deliberately does NOT do (0063's header names unit_price precisely to rule it out).
  const sqlOnly = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')

  // ⚠️ Comments stripped first, so these assertions read CODE, not prose. Both halves matter: the
  // schema comment explaining there is no unitPrice contains the very string that would fail the check,
  // and a column named only in a comment must not count as mapped in Drizzle.
  const schema = stripComments(read('lib/db/schema.ts'))
  const fromTable = schema.slice(schema.indexOf('export const fuelApprovals = pgTable('))
  const fuelBlock = fromTable.slice(0, fromTable.indexOf('\n})'))

  const added = [...sqlOnly(m63).matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1])
  assert('0063 adds the columns a mileage figure needs', added.length >= 14, `added ${added.length}`)
  for (const column of added) {
    // A column that exists in Postgres but not in Drizzle is invisible to the app — the whole point of
    // this section. schema.ts names every column as a quoted string: text('total_cost') and friends.
    assert(`schema.ts maps fuel_approvals.${column}`, new RegExp(`\\('${column}'`).test(fuelBlock))
  }
  const dropped = [...sqlOnly(r63).matchAll(/DROP COLUMN IF EXISTS\s+(\w+)/g)].map((m) => m[1])
  assert('the 0063 rollback drops exactly what 0063 added', sameSet(added, dropped),
    `added [${added.join(', ')}] vs dropped [${dropped.join(', ')}]`)

  // ⚠️ The two-sources-of-truth rule. fuel_filled_ltrs already holds the quantity and total_cost already
  // determines the price; a second column for either is the defect that made status + current_stage
  // unmaintainable, and it is easiest to reintroduce by accident in a later migration.
  assert('0063 adds no rival quantity column — fuel_filled_ltrs is the quantity', !added.includes('quantity'))
  assert('0063 stores no unit price — the engine derives it from the receipt total',
    !added.some((c) => /price/.test(c)) && !/unitPrice:/.test(fuelBlock))
  assert('quantity_unit says what fuel_filled_ltrs is measured in', added.includes('quantity_unit'))
  assert('every unit and energy the engine knows is allowed, and nothing else',
    /energy_type IN \('petrol', 'diesel', 'cng', 'ev', 'hybrid'\)/.test(m63) && /unit IN \('L', 'kg', 'kWh'\)/.test(m63))
  assert('an odometer override cannot be recorded without who accepted it and when',
    /odometer_override = false OR \(odometer_override_by IS NOT NULL AND odometer_override_at IS NOT NULL\)/.test(m63))
  assert('a fill belongs to a vehicle or an asset, never both', /vehicle_vin IS NULL OR asset_code IS NULL/.test(m63))

  // House rule from 0050: statuses are free text against a UI list. ALTER TYPE cannot run in a
  // transaction, and a missing enum value has taken this app down before.
  for (const [name, sql] of [['0063', m63], ['0064', m64]] as const) {
    assert(`${name} creates no enum type`, !/ALTER TYPE|CREATE TYPE/.test(sqlOnly(sql)))
    assert(`${name} warns that DDL belongs on the direct port 5432, not the pooler`, /5432/.test(sql) && /6543/.test(sql))
    assert(`${name} revokes anon, authenticated and PUBLIC`, /FROM anon, authenticated, PUBLIC/.test(sqlOnly(sql)))
  }

  for (const [name, sql] of [['0063', r63], ['0064', r64]] as const) {
    assert(`the ${name} rollback says it destroys data and exports first`,
      /DESTROYS DATA/.test(sql) && /\\copy/.test(sql))
  }
  // ⚠️ Re-granting `authenticated` full DML on fuel records would be a new security decision, not the
  // undo of a schema change.
  assert('no rollback quietly re-grants authenticated',
    !/GRANT[^\n]*\bauthenticated\b/.test(sqlOnly(r63) + sqlOnly(r64)))

  for (const table of ['fuel_benchmarks', 'fuel_intelligence_settings', 'fuel_config_events']) {
    assert(`0064 creates ${table} with RLS enabled`,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`).test(m64) &&
      new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`).test(m64))
    assert(`the 0064 rollback drops ${table}`, new RegExp(`DROP TABLE IF EXISTS public\\.${table}`).test(m64 + r64))
  }
  assert('benchmarks resolve uniquely at each scope, case-folded',
    ['fuel_benchmarks_vehicle_key', 'fuel_benchmarks_model_variant_key', 'fuel_benchmarks_model_key']
      .every((idx) => m64.includes(idx)) && /upper\(btrim\(/.test(m64))
  assert('a benchmark must configure a mileage or a tank capacity, not nothing',
    /expected_efficiency IS NOT NULL OR tank_capacity IS NOT NULL/.test(m64))
  assert('the config audit is append-only by trigger, with search_path pinned',
    /fuel_config_events_append_only/.test(m64) && /SET search_path = ''/.test(m64) && /BEFORE TRUNCATE/.test(m64))
  // ⚠️ Seeding would put every threshold in two places. The engine's DEFAULT_FUEL_SETTINGS is the one
  // definition of what each number means; an empty table simply means nobody has overridden it.
  assert('0064 does not seed the settings table — the engine defaults are the single definition',
    !/INSERT INTO public\.fuel_intelligence_settings/.test(sqlOnly(m64)))
}

console.log('\n8d) The Fuel Approvals routes stopped leaking (2026-09-11):')
{
  const list = stripComments(read('app/api/fuel-approvals/route.ts'))
  const bulk = stripComments(read('app/api/fuel-approvals/bulk-action/route.ts'))
  const single = stripComments(read('app/api/fuel-approvals/[id]/action/route.ts'))
  const access = stripComments(read('lib/fuel-management/access.ts'))

  // ⚠️ The list response carries submitter emails, slip URLs, remarks and a history array holding an
  // email per actor. It used to check only an explicit Access-Map DENY, which almost nobody sets, so
  // every signed-in employee could read every fuel record in the company.
  assert('the list route gates on canViewFuelApprovals, not merely an explicit deny',
    list.includes('canViewFuelApprovals') && !/isPermissionDenied\(/.test(list))
  assert('the list route does not restate the view rule itself',
    !/getUserPermissionSnapshot|FUEL_APPROVALS_VIEW_ROLES/.test(list))

  for (const [name, src] of [['list', list], ['bulk-action', bulk], ['action', single]] as const) {
    assert(`the ${name} route never returns a raw driver message`, !/details:/.test(src))
  }

  assert('a malformed body answers 400, not a 500 that reads as if the database refused the record',
    /request\.json\(\)\.catch\(/.test(list))

  // ⚠️ RESET erases an approval chain. In bulk it used to skip the permission check entirely; in the
  // single route an approver reached the UPDATE and appended a RESET entry for an action that never
  // happened. The CEO can approve — the CEO must not be able to un-approve.
  assert('RESET is refused to anyone but developer/admin, in BOTH routes',
    /action === 'RESET' \? !isDeveloperOrAdmin : !canApprove/.test(bulk) &&
    /action === 'RESET' && !isDeveloperOrAdmin/.test(single))

  // An override tells the engine to stop measuring across a stretch. A submitter who could set it could
  // silence the check that protects their own numbers.
  assert('the submit form cannot set an odometer override', /odometerOverride === true/.test(list))

  for (const field of ['energyType', 'quantityUnit', 'totalCost', 'odometerKm', 'isFullTank',
    'vehicleVin', 'assetCode', 'driverUserId', 'stationName', 'stationLocation']) {
    assert(`POST stores ${field}`, new RegExp(`${field}:`).test(list))
  }
  // ⚠️ A missing receipt total or odometer must stay NULL. A 0 would enter an average and drag a
  // vehicle's cost per km toward zero while looking like a real measurement.
  assert('nothing defaults a missing receipt total or odometer to zero',
    /cost === null \? null/.test(list) && /odometer === null \? null/.test(list))
  assert('only a real boolean counts as a full-tank answer',
    /typeof isFullTank === 'boolean' \? isFullTank : null/.test(list))
  assert('energy and unit are whitelisted to exactly what 0063 allows',
    /'petrol', 'diesel', 'cng', 'ev', 'hybrid'/.test(list) && /'L', 'kg', 'kWh'/.test(list))

  assert('fuel_management.edit has one statement', /export async function canEditFuelManagement/.test(access))
  const editBody = access.slice(access.indexOf('export async function canEditFuelManagement'))
  // Editing must not inherit the view grants: canViewFuelManagement opens to anyone holding
  // fuel_approvals.view or gate_pass.view, which is most managers.
  assert('editing benchmarks does not inherit the view grants', !/GRANTING_PERMISSIONS/.test(editBody))
  const rolesFrom = access.slice(access.indexOf('FUEL_MANAGEMENT_EDIT_ROLES'))
  const editRoles = rolesFrom.slice(0, rolesFrom.indexOf('])'))
  assert('MD, GM and admin may set expected mileage',
    ["'md'", "'general_manager'", "'admin'"].every((r) => editRoles.includes(r)), editRoles.replace(/\s+/g, ' '))
  assert('editing is narrower than viewing — not accounts, EA, HR or branch managers',
    ['accounts', 'finance_team', 'finance_head', 'ea', 'eba', 'hr', 'sales_manager', 'service_manager']
      .every((r) => !editRoles.includes(`'${r}'`)), editRoles.replace(/\s+/g, ' '))
}

console.log('\n8e) The backfill can only ever do what it says:')
{
  const backfill = stripComments(read('scripts/backfill-fuel-entry-columns.ts'))

  assert('it is a dry run unless --apply is passed', /process\.argv\.includes\('--apply'\)/.test(backfill))
  // The early return must come BEFORE the only UPDATE, or a dry run would write.
  assert('the dry run returns before any write is reached',
    backfill.indexOf('if (!APPLY)') > 0 && backfill.indexOf('if (!APPLY)') < backfill.indexOf('db.update('))

  // ⚠️ The four columns it may set, and nothing else.
  const writes = [...backfill.matchAll(/payload\.(\w+)/g)].map((m) => m[1])
  assert('it writes only odometerKm, energyType, vehicleVin and assetCode',
    sameSet([...new Set(writes)], ['odometerKm', 'energyType', 'vehicleVin', 'assetCode']), writes.join(', '))

  // ⚠️ Nobody was ever asked the full-tank question and no price was ever recorded. Filling either in
  // would invent the basis every mileage and cost figure rests on, and it would look authoritative.
  assert('it never writes a full-tank answer or a receipt total',
    !/payload\.isFullTank|payload\.totalCost/.test(backfill))
  // A backfill that can re-stage a request is an approval tool wearing a data-repair disguise.
  assert('it never touches status, stage, approvers or history',
    !/fuelApprovals\.(?:status|currentStage|history|\w*ApprovedBy\w*|rejectedBy\w*)\b/.test(backfill))

  // Every write is guarded on the column currently being NULL, so a real value is never overwritten.
  for (const column of ['odometerKm', 'energyType', 'vehicleVin', 'assetCode']) {
    assert(`it only fills ${column} when it is empty`, new RegExp(`row\\.${column} === null`).test(backfill))
  }

  // ⚠️ The PURPOSE decides whether fuel went into an asset — never the free-text vehicle label. Matching
  // the label classified three 'STOCK TRANSFER' rows as the stockyard and left four others unclassified.
  assert('asset classification reads the purpose only', /function assetCodeFor\(purpose: string\)/.test(backfill))

  // A fill is tied to a car only by the shared matcher, never by a second rule written here.
  assert('it reuses matchDemoFill rather than matching vehicles its own way',
    /matchDemoFill/.test(backfill) && !/extractPlateTokens|normalisePlate/.test(backfill))
}

console.log('\n8f) A finalised order says so, and cannot be finalised twice:')
{
  const constants = stripComments(read('lib/fuel-approvals/constants.ts'))
  const client = stripComments(read('features/fuel-approvals/fuel-approvals-client.tsx'))
  const dialog = stripComments(read('features/fuel-approvals/fuel-finalize-dialog.tsx'))

  /*
   * ⚠️ WHAT "FINALISED" MEANS IS ONE STATEMENT. The buttons used to test `record.totalCost`, which is
   * wrong twice: the cost is optional on the finalise form, and BOTH the create and resubmit routes
   * write totalCost from the request form — so an order read "Finalised" before it was even approved.
   * The FINALIZE history entry is the only record of the act itself.
   */
  assert('getFuelFinalization decides it from the FINALIZE history entry',
    /export function getFuelFinalization/.test(constants) && /'FINALIZE'/.test(constants))
  assert('the most recent finalisation wins, so a correction names whoever made it',
    /for \(const entry of history\)[\s\S]{0,120}last = entry/.test(constants))

  // The whole point of the fix: no surface may go back to guessing from the cost field.
  for (const [name, src] of [['the list client', client], ['the finalise dialog', dialog]] as const) {
    assert(`${name} reads getFuelFinalization rather than guessing from totalCost`,
      /getFuelFinalization\(/.test(src))
    assert(`${name} never labels a control from record.totalCost`,
      !/\{(?:record|selectedRecord)\.totalCost \? '/.test(src))
  }

  /*
   * ⚠️ A FINALISED ORDER MUST NOT OFFER THE FINALISE BUTTON. The defect was a single button whose
   * label flipped to "Finalised" while its onClick still opened the form — the screen reported the
   * work done and then invited you to do it again.
   */
  assert('no control is labelled Finalised and wired to open the finalise form',
    !/<span>\{[^}]*\? 'Finalised' : 'Finalise'\}<\/span>/.test(client))
  /*
   * Correcting a completed order is a DIFFERENT control from finalising one, in both views. Where the
   * STATE is displayed is 8g's business — it lives in the Stage Status column now, not in the actions.
   */
  const edits = (client.match(/<span>Edit Final<\/span>/g) || []).length
  assert('both the card view and the table view offer Edit Final on a completed order',
    edits === 2, `${edits} control(s)`)

  // Editing and finalising are the same form; they must not be the same sentence.
  assert('the dialog renames itself when it is correcting an already-finalised order',
    /const isEdit = getFuelFinalization\(record\)\.finalized/.test(dialog)
    && /isEdit \? 'Edit Finalised Fuel Order'/.test(dialog)
    && /isEdit \? 'Save Changes'/.test(dialog))
  // Finalising removes the row from the queue being worked through; that must not look like a glitch.
  assert('finalising says the order has moved to Completed', /moved to the Completed section/.test(dialog))
}

console.log('\n8g) Approved is not one bucket — the pipeline has a finalisation step:')
{
  const constants = stripComments(read('lib/fuel-approvals/constants.ts'))
  const list = stripComments(read('app/api/fuel-approvals/route.ts'))
  const client = stripComments(read('features/fuel-approvals/fuel-approvals-client.tsx'))

  /*
   * ⚠️ `status='approved'` IS NOT "done", and `current_stage='completed'` is written the instant the
   * CEO approves — so every approved order claimed to be completed while its bill was outstanding.
   * The lifecycle adds the one position `status` cannot express, and adds it WITHOUT a third stored
   * copy of the fact (see the status + current_stage note in the plan).
   */
  assert('the lifecycle is derived, not a new stored column',
    /export function getFuelLifecycleState/.test(constants)
    && /getFuelFinalization\(record\)\.finalized \? 'completed' : 'to_finalise'/.test(constants))
  /*
   * ⚠️ NOTHING NEW IS STORED. `FuelApprovalStage` has had a 'completed' member all along — the action
   * route writes it the moment the CEO approves, which is exactly the claim that was untrue. The fix
   * must not answer one wrong stored value with a second stored value: no 'completed' STATUS, and no
   * finalised column on the table. The position is derived from the history entry, once.
   */
  const types = stripComments(read('lib/fuel-approvals/types.ts'))
  const statusUnion = types.slice(
    types.indexOf('export type FuelApprovalStatus'),
    types.indexOf('export type FuelApprovalStage'),
  )
  assert('no completed status was added to FuelApprovalStatus', !/'completed'/.test(statusUnion))
  assert('no finalised column was added to the table',
    !/finaliz|finalis/i.test(stripComments(read('lib/db/schema.ts'))))

  // Server-side, so the counts and the rows cannot disagree with each other.
  assert('the API filters the two new sections itself',
    /tab === 'to_finalise'/.test(list) && /tab === 'completed'/.test(list)
    && /getFuelLifecycleState\(row\)/.test(list))
  assert('the API counts them separately', /toFinalise: toFinaliseCount/.test(list) && /completed: completedCount/.test(list))
  assert('the old ?tab=approved still answers, so a stale bookmark is not a 500',
    /tab === 'approved'/.test(list))

  assert('the screen offers a To Finalise section and a Completed section',
    /key: 'to_finalise', label: 'To Finalise'/.test(client) && /key: 'completed', label: 'Completed'/.test(client))

  // ⚠️ The tile that said "Completed Orders / CEO approved" over counts.approved counted 38 orders as
  // completed whose bills nobody had recorded.
  assert('no tile calls the approved count completed',
    !/Completed Orders/.test(client) && !/\{counts\.approved\}/.test(client))

  // The Stage Status column has to state the real position, or the sections and the rows disagree.
  assert('the status column reads the lifecycle, not the raw status',
    /const getLifecycleBadge = \(record: FuelApprovalRecord\)/.test(client)
    && /getLifecycleBadge\(record\)/.test(client))
  /*
   * ⚠️ BOTH STATE CHIPS MUST BE SPANS. A chip reading "Completed" that opens the finalise form is the
   * original defect wearing a different label, so this checks the TAG, not the text.
   */
  for (const label of ['To Finalise', 'Completed']) {
    const at = client.indexOf(`/> ${label}\n`)
    assert(`the Stage Status column states "${label}"`, at > 0)
    if (at > 0) {
      const before = client.slice(0, at)
      assert(`"${label}" is a span, not a pressable control`,
        before.lastIndexOf('<span') > before.lastIndexOf('<button'))
    }
  }
  assert('an approved-but-unfinalised order reads as outstanding, not as done',
    /state === 'to_finalise'/.test(client) && client.includes('/> To Finalise'))
}

console.log('\n10) The control-centre ledger (redesign, 2026-09-16) — pure fixtures:')
{
  const period = { from: '2026-09-01', to: '2026-09-16' }
  const window = ledgerWindow(period.from, period.to, '2026-09-16')
  assert('the previous period has the same length and ends the day before', window.prevTo === '2026-08-31' && window.prevFrom === '2026-08-16')
  const vin = 'MZBEA812LTN000001'
  const row = (over: Partial<LedgerRowInput>): LedgerRowInput => ({
    id: over.id ?? `00000000-0000-0000-0000-${String(Math.random()).slice(2, 14).padStart(12, '0')}`,
    requestNumber: 'KIA-FUEL-TEST', brand: 'kia', location: 'KIA JAMMU', purpose: 'DEMO',
    vehRegNo: 'DEMO CAR', vinNo: '000001', vehicleVin: vin, assetCode: null, fuelType: 'PETROL', energyType: 'petrol',
    quantityUnit: 'L', requested: 20, approved: 20, actual: null, totalCost: null, odometerKm: 1000, kmReadingText: '1000',
    isFullTank: null, odometerOverride: false, stationName: null, department: null, gatePassId: null,
    date: '2026-09-10', createdAt: '2026-09-10T05:00:00.000Z', status: 'approved', requesterName: 'Asha',
    approverName: 'CEO', approvedAt: '2026-09-10T06:00:00.000Z',
    trail: [{ action: 'SUBMIT', actorName: 'Asha', actorRole: 'hr', at: '2026-09-10T05:00:00.000Z' }],
    ...over,
  })
  const pass = (over: Partial<LedgerPassInput>): LedgerPassInput => ({
    id: over.id ?? '11111111-1111-1111-1111-111111111111', passNo: 'GP-TEST-1', vin, registrationNumber: 'JK02AA0001',
    model: 'Sonet', dealerCode: 'JK402', branchKey: 'JAMMU', branchLabel: 'Jammu', purpose: 'Fuel filling',
    isFuelFilling: true, status: 'returned', driverKind: 'staff', staffDriverName: 'Ravi', raisedByName: 'Ravi',
    gateOutAt: '2026-09-12T04:00:00.000Z', gateOutYmd: '2026-09-12', gateInAt: '2026-09-12T05:00:00.000Z',
    gateInYmd: '2026-09-12', gateOutOdo: 1100, gateInOdo: 1104, fuelLitres: 18, fuelAmount: 1900, trip: null,
    ...over,
  })
  const base = (rows: LedgerRowInput[], passes: LedgerPassInput[] = []): LedgerInput => ({
    window, rows, passes,
    fleet: [{ vin, registrationNumber: 'JK02AA0001', model: 'Sonet', variant: null, branchLabel: 'Jammu', sharedPlate: false }],
    benchmarks: [], settings: DEFAULT_FUEL_SETTINGS, settingsConfigured: false, reviews: [],
    sync: { loconavLastRunAt: null, loconavStatus: null }, generatedAt: '2026-09-16T00:00:00.000Z',
  })
  const filters: FuelFilters = { ...period, branch: null, brand: null, purpose: null, department: null, energy: null, fleet: null, vehicle: null }

  // Requested, approved and actual are three facts; a missing one stays missing.
  const noActual = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000001', requested: 20, approved: 15 })]))
  const e0 = noActual.events[0]
  assert('an approved record without a bill keeps actual = null (never borrowed from approved)', e0.actual === null && e0.variance === null)
  assert('approved is its own figure, not the requested one', e0.requested === 20 && e0.approved === 15)
  const s0 = summariseLedger(noActual, filters)
  assert('the headline says no actual is recorded rather than showing a matched total',
    s0.headline.actualQty.recordedEvents === 0 && s0.headline.reconciled.events === 0)
  assert('the narrative says approved and actual cannot be compared yet', s0.narrative.some((t) => /cannot be compared/.test(t)))

  // Approved vs actual beyond the tolerance, and within it.
  const over = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000002', approved: 20, actual: 24 })]))
  assert('actual 20% over approved raises actual_over_approved', over.exceptions.some((x) => x.kind === 'actual_over_approved'))
  const within = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000003', approved: 20, actual: 20.5 })]))
  assert('actual 0.5 L over approved raises nothing', !within.exceptions.some((x) => x.kind.startsWith('actual_')))

  // Fuel on a gate pass that no request names — and not once a request names it.
  const orphan = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000004', date: '2026-09-12' })], [pass({})]))
  const orphanRow = orphan.exceptions.find((x) => x.kind === 'pass_without_request')
  assert('a returned fuel-filling pass with pump litres and no request is an exception', Boolean(orphanRow))
  assert('it points at the request for the same car and day', Boolean(orphanRow && /KIA-FUEL-TEST/.test(orphanRow.message)))
  const linked = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000005', gatePassId: '11111111-1111-1111-1111-111111111111', actual: 18 })], [pass({})]))
  assert('once a request names the pass, the exception is gone', !linked.exceptions.some((x) => x.kind === 'pass_without_request'))
  assert('the linked pass puts its pump litres on the record', linked.events[0].pumpLitres === 18 && linked.events[0].passNo === 'GP-TEST-1')

  // A pump reading that cannot be real (litres and rupees typed the wrong way round).
  const swapped = buildLedger(base([], [pass({ id: '22222222-2222-2222-2222-222222222222', fuelLitres: 2103, fuelAmount: 105 })]))
  const swappedRow = swapped.exceptions.find((x) => x.kind === 'implausible_pump_reading')
  assert('2,103 L for ₹105 is flagged as not possible', Boolean(swappedRow))
  assert('…and says the two may be swapped', Boolean(swappedRow && /wrong way round/.test(swappedRow.message)))
  assert('…without claiming the 2,103 L as fuel filled', Boolean(swapped.exceptions.find((x) => x.kind === 'pass_without_request' && /needs checking/.test(x.message))))

  // Data gaps count only records that could have carried the new fields.
  const legacy = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000006', createdAt: '2026-09-10T05:00:00.000Z' })]))
  assert(`a demo fill raised before ${ACCOUNTABILITY_SINCE} is not counted as missing its gate pass`, !legacy.events[0].quality.includes('pass_missing'))
  const fresh = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000007', date: '2026-09-16', createdAt: '2026-09-16T05:00:00.000Z' })]))
  assert('a demo fill raised after it is', fresh.events[0].quality.includes('pass_missing'))

  // Identity: a genset is equipment, never a car; a typed label is never a car.
  const genset = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000008', purpose: 'GENSET', vehicleVin: null, vehRegNo: 'Genset', vinNo: 'GENSET', location: 'KIA UDHAMPUR' })]))
  assert('a genset fill is equipment keyed by branch', genset.events[0].identity === 'asset' && genset.events[0].vehicleKey === 'ASSET:GENSET:UDHAMPUR')
  const label = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-000000000009', purpose: 'STOCK TRANSFER', vehicleVin: null, vehRegNo: 'Stock transfer', vinNo: '317707' })]))
  assert('a stock-transfer label is not tied to a car and gets no mileage', label.events[0].identity === 'label'
    && label.vehicles[label.events[0].vehicleKey].mileage.unavailableReason !== null)

  // Mileage comes only from two readings; one fill says why there is none.
  const one = buildLedger(base([row({ id: 'a0000000-0000-0000-0000-00000000000a' })]))
  assert('one fill gives no mileage, with the reason', one.vehicles[vin].mileage.average === null && Boolean(one.vehicles[vin].mileage.unavailableReason))
  const two = buildLedger(base([
    row({ id: 'a0000000-0000-0000-0000-00000000000b', date: '2026-09-02', createdAt: '2026-09-02T05:00:00.000Z', odometerKm: 1000, isFullTank: true, approved: 30, actual: 30 }),
    row({ id: 'a0000000-0000-0000-0000-00000000000c', date: '2026-09-12', createdAt: '2026-09-12T05:00:00.000Z', odometerKm: 1300, isFullTank: true, approved: 20, actual: 20 }),
  ]))
  assert('two full tanks 300 km and 20 L apart give 15 km/L, measured', two.vehicles[vin].mileage.average === 15 && two.vehicles[vin].mileage.basis === 'full_tank')
  const trace = ledgerTransaction(two, 'a0000000-0000-0000-0000-00000000000c', null)
  assert('the second fill traces back to the first', trace?.analysis.previousFillDate === '2026-09-02' && trace?.analysis.distanceSincePreviousKm === 300)
  assert('the trace never names a customer: the steps carry only staff names', Boolean(trace && trace.steps.every((s) => s.actor === null || ['Asha', 'CEO', 'Ravi'].includes(s.actor))))

  // Filters and pages are applied on the server.
  const many = buildLedger(base(Array.from({ length: 30 }, (_, i) => row({
    id: `b0000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    requestNumber: `KIA-FUEL-${i}`,
    location: i % 2 ? 'KIA UDHAMPUR' : 'KIA JAMMU',
    date: `2026-09-${String((i % 15) + 1).padStart(2, '0')}`,
  }))))
  const page = listLedgerEvents(many, filters, { state: null, quality: null, q: null, sort: 'date', direction: 'desc', page: 2, pageSize: 10 })
  assert('the record list is paginated on the server', page.rows.length === 10 && page.total === 30 && page.page === 2)
  const udhampur = listLedgerEvents(many, { ...filters, branch: 'UDHAMPUR' }, { state: null, quality: null, q: null, sort: 'date', direction: 'desc', page: 1, pageSize: 100 })
  assert('the branch filter keeps only that branch', udhampur.total === 15 && udhampur.rows.every((r) => r.branchKey === 'UDHAMPUR'))
  assert('eventMatches refuses a record outside the period', !eventMatches({ ...many.events[0], date: '2026-08-01' }, filters))
}

console.log('\n11) Migration 0071, the routes and the screen agree:')
{
  const m71 = read('lib/db/migrations/0071_add_fuel_accountability.sql')
  const r71 = read('lib/db/migrations/0071_rollback_add_fuel_accountability.sql')
  const sqlOnly = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
  assert('0071 and its rollback exist', m71.length > 0 && r71.length > 0)
  for (const column of ['approved_quantity', 'actual_quantity', 'gate_pass_id', 'department']) {
    assert(`0071 adds ${column}`, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`).test(sqlOnly(m71)))
    assert(`the rollback drops ${column}`, new RegExp(`DROP COLUMN IF EXISTS ${column}\\b`).test(sqlOnly(r71)))
    assert(`schema.ts maps fuel_approvals.${column}`, read('lib/db/schema.ts').includes(`('${column}'`))
  }
  assert('0071 backfills approved = requested only for approved rows, and never backfills actual',
    /SET approved_quantity = fuel_filled_ltrs[\s\S]*WHERE status = 'approved'/.test(sqlOnly(m71)) && !/SET actual_quantity/.test(sqlOnly(m71)))
  assert('one gate pass backs at most one request', /UNIQUE INDEX IF NOT EXISTS fuel_approvals_gate_pass_id_key/.test(m71))
  assert('the review log is append-only, RLS on, anon/authenticated revoked',
    /fuel_exception_reviews_append_only/.test(m71) && /BEFORE TRUNCATE/.test(m71)
    && /ENABLE ROW LEVEL SECURITY/.test(m71) && /FROM anon, authenticated, PUBLIC/.test(sqlOnly(m71)))
  assert('the review log has no foreign key to fuel_approvals (it would block deletes)', !/fuel_approval_id uuid REFERENCES/.test(sqlOnly(m71)))
  assert('0071 warns that DDL belongs on 5432, not the pooler', /5432/.test(m71) && /6543/.test(m71))
  assert('the 0071 rollback says it destroys data and exports first', /DESTROYS DATA/.test(r71) && /\\copy/.test(r71))

  const action = stripComments(read('app/api/fuel-approvals/[id]/action/route.ts'))
  assert('APPROVE writes the approved quantity, defaulting to the requested litres',
    /approvedQuantity = approved\.toFixed\(2\)/.test(action) && /approvedParsed\.value \?\? requested/.test(action))
  assert('RESET clears the approved quantity', /approvedQuantity = null/.test(action))
  const bulk = stripComments(read('app/api/fuel-approvals/bulk-action/route.ts'))
  assert('a bulk approval approves each request as asked', /approvedQuantity = Number\(record\.fuelFilledLtrs\)/.test(bulk))
  const close = stripComments(read('app/api/fuel-approvals/[id]/finalize/route.ts'))
  assert('closing an order requires the actual litres the first time', /Enter the actual litres/.test(close) && /actualQuantity: actualToStore/.test(close))
  assert('closing a car order requires odometer and full tank; a correction may omit them',
    /isVehicle && !isCorrection/.test(close) && /Say whether the tank was filled full/.test(close))
  assert('the close route no longer returns a raw driver message', !/details:/.test(close))
  const resubmit = stripComments(read('app/api/fuel-approvals/[id]/resubmit/route.ts'))
  assert('a re-submission clears the old approved quantity', /approvedQuantity: null/.test(resubmit))
  assert('the re-submit route no longer returns a raw driver message', !/details:/.test(resubmit))
  const accountability = stripComments(read('lib/fuel-approvals/accountability.ts'))
  assert('a gate pass is checked before it is linked: fuel purpose, left the gate, not claimed',
    /isFuelFillingPurpose/.test(accountability) && /never left the gate/.test(accountability) && /already linked to/.test(accountability))
  for (const rel of ['app/api/fuel-approvals/route.ts', 'app/api/fuel-approvals/[id]/resubmit/route.ts', 'app/api/fuel-approvals/[id]/finalize/route.ts']) {
    assert(`${rel} links a pass only through resolveFuelGatePass`, /resolveFuelGatePass\(/.test(stripComments(read(rel))))
  }
  for (const rel of ['app/api/fuel-approvals/route.ts', 'app/api/fuel-approvals/[id]/action/route.ts', 'app/api/fuel-approvals/bulk-action/route.ts',
    'app/api/fuel-approvals/[id]/finalize/route.ts', 'app/api/fuel-approvals/[id]/resubmit/route.ts', 'app/api/fuel-management/exceptions/review/route.ts']) {
    assert(`${rel} clears the Fuel Management cache after writing`, /invalidateFuelManagementCache\(\)/.test(stripComments(read(rel))))
  }

  const routes = walk('app/api/fuel-management').filter((rel) => rel.endsWith('route.ts'))
  assert('the control centre has its sub-routes', routes.length >= 7, routes.join(', '))
  for (const rel of routes) {
    const src = stripComments(read(rel))
    assert(`${rel} guards itself with guardFuelManagement (the page's predicate)`, /guardFuelManagement\(/.test(src))
    assert(`${rel} is force-dynamic`, /export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(src))
  }
  const settings = stripComments(read('app/api/fuel-management/settings/route.ts'))
  assert('changing benchmarks or thresholds needs the edit permission', /PUT[\s\S]*guardFuelManagement\(\{ needEdit: true \}\)/.test(settings))
  const api = stripComments(read('lib/fuel-management/api.ts'))
  assert('the guard is canViewFuelManagement, and edits need canEditFuelManagement',
    /canViewFuelManagement\(appUser\)/.test(api) && /canEditFuelManagement\(appUser\)/.test(api))

  const reads = stripComments(read('lib/fuel-management/ledger-reads.ts'))
  assert('a customer who drove a car is never named', /driverKind === 'staff' && row\.driverName/.test(reads))
  assert('the ledger is cached per period and cleared on every fuel write', /getCachedData\(/.test(reads) && /fuel-management:ledger:/.test(reads))

  const screen = walk('features/fuel-management').map((rel) => stripComments(read(rel))).join('\n')
  assert('the screen invents no price: every rupee figure comes from the API', !/₹\s*\d/.test(screen))
  assert('the old invented ₹95 per litre is gone', !/\b95\b[^\n]*(?:per|\/)\s*L/i.test(screen) && !/REFERENCE_PRICE|ESTIMATED_PRICE/.test(screen))
  assert('the screen asks the server to paginate the record list', /\/api\/fuel-management\/transactions\?/.test(screen) && /pageSize/.test(screen))
  assert('no eyebrow or section numbers above headings', !/\b0[1-9]\s*\/\s*0[1-9]\b/.test(screen))
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
  let expectedApproved = null as { litres: number; actual: number; missingApproved: number } | null
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
      const [acc] = await tx<{ litres: string; actual: string; missing: number }[]>`
        SELECT COALESCE(SUM(approved_quantity) FILTER (WHERE quantity_unit = 'L'), 0)::text AS litres,
               COALESCE(SUM(actual_quantity) FILTER (WHERE quantity_unit = 'L' AND status <> 'rejected'), 0)::text AS actual,
               COUNT(*) FILTER (WHERE status = 'approved' AND approved_quantity IS NULL)::int AS missing
        FROM fuel_approvals
        WHERE fuel_filled_date BETWEEN ${periodResult.period.from}::date AND ${periodResult.period.to}::date
          AND status <> 'rejected'`
      expectedApproved = { litres: Number(acc.litres), actual: Number(acc.actual), missingApproved: acc.missing }
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

      // The control centre's ledger, read the way the API reads it, against SQL on the new columns.
      const { loadLedgerUncached } = await import('../lib/fuel-management/ledger-reads')
      const ledger = await loadLedgerUncached(defaultPeriod.from, defaultPeriod.to)
      const summary = summariseLedger(ledger, {
        from: defaultPeriod.from, to: defaultPeriod.to, branch: null, brand: null, purpose: null,
        department: null, energy: null, fleet: null, vehicle: null,
      })
      assert(`the ledger's approved litres equal SQL on approved_quantity (${expectedApproved?.litres} L)`,
        expectedApproved !== null && Math.abs(summary.headline.approvedQty.current - expectedApproved.litres) < 0.005,
        `ledger ${summary.headline.approvedQty.current} L vs SQL ${expectedApproved?.litres} L`)
      assert(`the ledger's actual litres equal SQL on actual_quantity (${expectedApproved?.actual} L)`,
        expectedApproved !== null && Math.abs(summary.headline.actualQty.current - expectedApproved.actual) < 0.005,
        `ledger ${summary.headline.actualQty.current} L vs SQL ${expectedApproved?.actual} L`)
      assert('every approved record carries an approved quantity (0071 backfill)', expectedApproved !== null && expectedApproved.missingApproved === 0,
        `${expectedApproved?.missingApproved} approved without one`)
      console.log(`  [INFO] ledger: ${ledger.events.length} records in the read window, ${summary.exceptions.length} exception(s), `
        + `${summary.vehicles.length} vehicle row(s), ${summary.quality.filter((q) => q.count > 0).length} data gap type(s)`)
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
