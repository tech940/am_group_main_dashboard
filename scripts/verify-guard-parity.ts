/**
 * Guard parity — prevents the "visible in the sidebar but denied on click" class of bug, where a
 * section's link shows because the effective permission map grants `<key>.view`, but the page guards
 * on something narrower (a role allowlist) and bounces the user to /forbidden ("go home").
 *
 * Asserts:
 *   1. Every routed section (SECTION_ROUTES) has a registry group + a `<key>.view` permission.
 *   2. Every routed section's `<key>.view` key is actually enforced by some app page guard
 *      (or is a documented exception verified by its own rule).
 *   3. The two role-gated common modules (AM Finance, Petty Cash) keep a SINGLE source of truth for
 *      their role allowlist, shared between the page guard and the sidebar link, and the sidebar no
 *      longer uses the leaky `(canAccessX || permissionMap) && hasPermission(...)` idiom.
 *
 * Run:  npx tsx scripts/verify-guard-parity.ts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SECTION_ROUTES, PERMISSION_GROUPS, PERMISSIONS } from '../lib/permissions/registry'

const ROOT = process.cwd()
let failures = 0
function assert(label: string, cond: boolean, detail?: string) {
  if (!cond) failures++
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${!cond && detail ? `  — ${detail}` : ''}`)
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name === 'page.tsx') out.push(p)
  }
  return out
}

/*
 * ⚠️ COMMENTS ARE STRIPPED BEFORE SEARCHING.
 *
 * This check proves a guard by finding the permission key in page source. Without stripping, a page
 * that merely CLAIMS to be guarded passes — and one did: app/brands/kia/payment-approvals/page.tsx
 * carried the line `// Gated by 'kia.approvals.view' permission` and no guard whatsoever, and that
 * comment was the only occurrence of the key in any page file. Every authenticated user could open
 * the Approvals section and read vendor names, amounts and bill links, while this test passed green
 * on the comment describing the guard that was not there.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // The leading capture keeps `https://…` and other `://` sequences from being eaten as comments.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every route.ts under a directory, recursively. */
function walkRoutes(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkRoutes(p))
    else if (entry.name === 'route.ts') out.push(p)
  }
  return out
}

const allPages = walk(join(ROOT, 'app'))
  .map((f) => stripComments(readFileSync(f, 'utf8')))
  .join('\n')
const groupKeys = new Set(PERMISSION_GROUPS.map((g) => g.key))
const permissionKeys = new Set(PERMISSIONS.map((p) => p.key))

// Routed sections whose page deliberately does NOT gate on `<key>.view` — each verified by its own rule.
const EXCEPTIONS: Record<string, { reason: string; requireToken?: string }> = {
  // Purchase Orders is a client page gated in-app (MainLayout + the data APIs), not a server view-guard.
  purchase_orders: { reason: 'client page, gated client-side' },
  // The Admin console is gated by isSuperAdminRole (matches the sidebar's canAccessAdmin), not a `.view` key.
  user_management: { reason: 'super-admin gated', requireToken: 'isSuperAdminRole' },
  // CA is HARDCODED to CA/MD/Developer via isCaViewRole (product decision), not the `ca.view` permission.
  ca: { reason: 'hardcoded role gate (CA/MD/Developer)', requireToken: 'isCaViewRole' },
  // Scrap ERP uses custom role & permission guard (MD/EA/Developer default).
  scrap_erp: { reason: 'custom role & permission gate (MD/EA/Developer)', requireToken: 'canAccessScrapErp' },
  // Bank Sanctions uses custom role & permission guard (EA/MD/Accounts/Developer/PC default).
  bank_sanctions: { reason: 'custom role & permission gate (EA/MD/Accounts/Developer/PC default)', requireToken: 'canViewBankSanctions' },
  // Booking Payment History uses custom role & permission guard (MD/EA/Developer default).
  'kia.booking_payment_history': { reason: 'custom role & permission gate (MD/EA/Developer)', requireToken: 'canViewBookingPaymentHistory' },
  // Insurance Analysis is gated via lib/auth/restricted-analytics.ts (MD, Developer, Assistant Manager).
  insurance_analysis: { reason: 'hardcoded MD/Developer/Assistant Manager gate, not grantable', requireToken: 'canViewRestrictedAnalytics' },
  /*
   * AM Finance states its view rule ONCE, in lib/am-finance/access.ts#canViewAmFinance, and the page
   * plus all three /api/am-finance routes call it. The key therefore no longer appears literally in
   * the page — which is the point: role-only checks in those routes were serving data to users the
   * page had already DENIED. Delegation is the fix, so it is recorded here rather than failed.
   */
  am_finance: { reason: 'shared async predicate (role + Access-Map allow/deny)', requireToken: 'canViewAmFinance' },
}

console.log('\n=== Guard parity (sidebar visibility ↔ page guard) ===\n')

console.log('1) Registry completeness — every routed section has a group + a .view permission:')
for (const key of Object.keys(SECTION_ROUTES)) {
  assert(`${key}: group exists`, groupKeys.has(key))
  assert(`${key}: '${key}.view' permission exists`, permissionKeys.has(`${key}.view`))
}

console.log('\n2) Every routed section .view key is enforced by a page guard (or a documented exception):')
for (const key of Object.keys(SECTION_ROUTES)) {
  const exception = EXCEPTIONS[key]
  if (exception) {
    if (exception.requireToken) {
      assert(`${key}: exception (${exception.reason}) — page uses ${exception.requireToken}`, allPages.includes(exception.requireToken))
    } else {
      assert(`${key}: exception (${exception.reason})`, true)
    }
    continue
  }
  assert(
    `${key}: '${key}.view' guarded in an app page`,
    allPages.includes(`'${key}.view'`) || allPages.includes(`"${key}.view"`),
    'no page references this section\'s view key',
  )
}

console.log('\n3) Legacy role-gated modules keep a single source of truth (anti-drift):')
const sidebar = readFileSync(join(ROOT, 'components/layout/sidebar.tsx'), 'utf8')
const amFinanceAccess = readFileSync(join(ROOT, 'lib/am-finance/access.ts'), 'utf8')
const pettyCashAccess = readFileSync(join(ROOT, 'lib/petty-cash/access.ts'), 'utf8')
// The invariant is "the sidebar never inlines a role array for these modules", not "the sidebar
// imports both predicates unconditionally". AM Finance has no sidebar entry today (the link is
// gone, so its import was dead weight and was removed), and asserting a dead import just forces an
// unused symbol back into the file. Each predicate is therefore required only WHEN that module is
// actually linked — which still fails loudly the moment someone re-adds the link with an inline
// role list instead of the shared helper.
assert(
  'sidebar gates Petty Cash through the shared legacy-module-roles predicate',
  sidebar.includes('legacy-module-roles') && sidebar.includes('isPettyCashViewRole'),
)
assert(
  'sidebar gates AM Finance through the shared predicate (only required while it is linked)',
  !sidebar.includes("'/am-finance'") || sidebar.includes('isAmFinanceViewRole'),
)
assert('am-finance access imports the shared role list', amFinanceAccess.includes('legacy-module-roles'))
assert('petty-cash access imports the shared role predicate', pettyCashAccess.includes('legacy-module-roles'))
assert(
  'sidebar no longer uses the leaky "(canAccessX || permissionMap) && hasPermission" idiom',
  !sidebar.includes('|| permissionMap) && hasPermission'),
)

// -- 4) The check that would have caught the regression fixed on 2026-07-31 ----------------------
// Every ROLE-gated section that is ALSO grantable in the Access Map must honour an explicit grant.
// Section 2 above only asserted that a helper NAME appeared somewhere in the concatenated pages, so
// `canAccessScrapErp(role)` passed while silently dropping its permissionMap argument: the sidebar
// showed the link off the permission map and the page bounced the user to "access restricted".
//
// The rule now: a grantable, role-gated section must reference its own `.view` key in the page AND
// in any API route that applies the same role gate — a page that renders while its own API 403s is
// the same broken trip for the user.
console.log('\n4) Grantable role-gated sections honour an explicit Access-Map grant (page AND api):')

/*
 * ⚠️ `walk()` collects page.tsx. API handlers are route.ts, so this read ZERO files and `allApi`
 * was the empty string — the "AND in any API route" half of this check has been vacuous since it
 * was written. walkRoutes() is the right one.
 */
const apiFiles = walkRoutes(join(ROOT, 'app/api'))
const allApi = apiFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/*
 * Shared access modules count as code too. The preferred fix for a drifted guard is to state the
 * rule ONCE in lib and have the page and the routes both call it — which is what lib/ca/access.ts
 * and lib/vendors/access.ts now do. Reading only pages and routes would mark that refactor as a
 * regression, punishing the very pattern this script exists to encourage.
 */
const guardModules = ['lib/ca/access.ts', 'lib/vendors/access.ts', 'lib/petty-cash/access.ts', 'lib/am-finance/access.ts']
  .filter((rel) => existsSync(join(ROOT, rel)))
  .map((rel) => readFileSync(join(ROOT, rel), 'utf8'))
  .join('\n')

const allCode = allPages + '\n' + allApi + '\n' + guardModules

// section key -> the role-gate token that guards it
const ROLE_GATED_GRANTABLE: Record<string, string> = {
  scrap_erp: 'canAccessScrapErp',
  bank_sanctions: 'canViewBankSanctions',
  'kia.booking_payment_history': 'canViewBookingPaymentHistory',
  // The CA rule now lives in lib/ca/access.ts and is called by the page AND all three routes.
  ca: 'canViewCa',
  am_finance: 'canAccessAmFinance',
  petty_cash: 'canAccessPettyCash',
  delegation_tasks: 'delegation_tasks.view',
}

for (const [key, token] of Object.entries(ROLE_GATED_GRANTABLE)) {
  assert(`${key}: is grantable (a '${key}.view' permission exists)`, permissionKeys.has(`${key}.view`))
  assert(
    `${key}: the '${token}' role gate is paired with an explicit-grant escape hatch`,
    allCode.includes('isPermissionExplicitlyAllowed') && allCode.includes(`'${key}.view'`),
    `an Access-Map grant of ${key}.view would be silently ignored by the ${token} gate`,
  )
}

/*
 * ⚠️ This loop was DEAD until `apiFiles` was fixed to read route.ts instead of page.tsx. The moment
 * it ran it found a real one: all three /api/am-finance routes checked `canAccessAmFinance(role)`
 * alone while the page also honoured an Access-Map allow AND deny — so a granted user was 403'd by
 * the API that had just rendered for them, and, worse, a DENIED user was still served data.
 *
 * A route may satisfy this EITHER by doing the explicit-grant check itself, OR by delegating to a
 * shared async predicate that does. Delegation is the better fix — it is what CA and AM Finance now
 * do — so the check must not punish it.
 */
const DELEGATED_VIEW_PREDICATES = ['canViewCa', 'canViewAmFinance']

for (const file of apiFiles) {
  const body = readFileSync(file, 'utf8')
  for (const [key, token] of Object.entries(ROLE_GATED_GRANTABLE)) {
    if (!body.includes(token + '(')) continue
    const honoursGrant = body.includes('isPermissionExplicitlyAllowed')
      || DELEGATED_VIEW_PREDICATES.some((p) => body.includes(p + '('))
    assert(
      `${file.replace(ROOT, '').replace(/\\/g, '/')}: role-gates ${key} and honours the grant`,
      honoursGrant,
      'this API would 403 a user its own page just admitted — and would serve a user it just denied',
    )
  }
}

console.log('\n5) /admin is gated identically by the page, the sidebar and the search registry:')
const sectionsRegistry = readFileSync(join(ROOT, 'lib/navigation/sections.ts'), 'utf8')
assert(
  'search registry gates /admin on isSuperAdminRole (same test as app/admin/page.tsx)',
  !sectionsRegistry.includes("userRole === 'admin' || userRole === 'developer'"),
  "the registry admitted role 'admin' to /admin, which the page then forbids",
)

console.log('\n6) Sections that can NEVER be granted are not silently offered in the Access Map:')
// Not a failure — a standing reminder. These render as tickable rows that do nothing, because the
// product decision is a hardcoded role gate. Either lock the row in the Access Map UI or accept it.
for (const [key, exception] of Object.entries(EXCEPTIONS)) {
  if (!exception.reason.includes('not grantable')) continue
  console.log(`  [NOTE] ${key}: tickable in Admin -> Access but ${exception.reason} — a grant here is inert by design`)
}

console.log('\n7) EVERY page behind a section key guards ITSELF — not just one page per key:')
/*
 * ⚠️ Check 3 above searches ALL page files as ONE BLOB, so the moment any single page mentions
 * `<key>.view` the check passes for every other page sharing that key. That is not a guard test, it
 * is a "somebody, somewhere" test — and it hid a real hole:
 *
 *   `kia.approvals` covers TWO routes (href + an alias): /brands/kia/payment-approvals and
 *   /brands/kia/vendors. The approvals page had a real guard; the Vendor Registry had only the
 *   comment `// Gated by kia.approvals.view permission` and no code at all. Any authenticated user
 *   could open it and read every vendor's GST number and bank account. The blob check stayed green
 *   throughout, satisfied by the sibling page.
 *
 * So: resolve each route to its own page file and require a guard in THAT file.
 */
function pageFileFor(href: string): string | null {
  const candidate = join(ROOT, 'app', href.replace(/^\//, ''), 'page.tsx')
  return existsSync(candidate) ? candidate : null
}

for (const [key, route] of Object.entries(SECTION_ROUTES)) {
  if (EXCEPTIONS[key]) continue
  for (const href of [route.href, ...(route.aliases ?? [])]) {
    const file = pageFileFor(href)
    // A route with no page file of its own is a tab or a client-routed view, not a guarded surface.
    if (!file) continue
    const src = stripComments(readFileSync(file, 'utf8'))
    /*
     * A pure redirect stub is not an unguarded surface: it renders nothing, and the destination runs
     * the real guard. /brands/kia/allocation-history is the live example — it exists only so old
     * bookmarks keep working, and duplicating the guard there would mean two places to keep in sync.
     */
    const isRedirectStub = /\b(?:permanentRedirect|redirect)\s*\(/.test(src) && !src.includes('<')
    if (isRedirectStub) continue

    /*
     * Accept EITHER the section key or a named guard the page delegates to. `getBrandAccess` counts:
     * the three Business Excellence pages gate on `access.allowed` + forbidden(), which is a real
     * guard even though the permission key never appears in the file. Omitting it made this check
     * report four false positives on its first run — the reason to read every failure before
     * believing it.
     */
    const guarded = src.includes(`'${key}.view'`) || src.includes(`"${key}.view"`)
      || /\b(?:canUserAccessPermission|requirePermission|isPermissionExplicitlyAllowed|getBrandAccess|canView[A-Z][A-Za-z]*|canAccess[A-Z][A-Za-z]*)\s*\(/.test(src)
    assert(
      `${href} guards itself (not via a sibling page)`,
      guarded,
      `app${href}/page.tsx has no guard of its own — check 3 passes only because another page shares '${key}'`,
    )
  }
}

console.log('\n8) Vendor Registry and CA state their access rule ONCE:')
/*
 * Both modules restated the rule per file, and both had already drifted.
 *
 * Vendors: every handler under app/api/brands/[brand]/vendors/** was UNAUTHENTICATED — anonymous
 * read of bank accounts and GST numbers, anonymous create, and anonymous PATCH/DELETE of a vendor's
 * bank account, which is a payment-redirection vector.
 *
 * CA: the page honoured an Access-Map `ca.view` grant and all three APIs did not, so a granted user
 * loaded the page and every request behind it 403'd.
 */
const vendorRoutes = walkRoutes(join(ROOT, 'app/api/brands/[brand]/vendors'))
assert('the vendor API has routes to check', vendorRoutes.length > 0)
for (const file of vendorRoutes) {
  const src = stripComments(readFileSync(file, 'utf8'))
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/')
  if (!/export\s+(?:async\s+)?function\s+(?:GET|POST|PATCH|PUT|DELETE)/.test(src)) continue
  assert(`${rel} guards its handlers via the shared requireVendorAccess`,
    src.includes('requireVendorAccess'),
    'a handler here is reachable with no session at all')
}

{
  const payments = stripComments(
    readFileSync(join(ROOT, 'app/api/brands/[brand]/vendors/[id]/payments/route.ts'), 'utf8'))
  /*
   * Permission alone is not enough here. This endpoint is deliberately cross-company — one vendor
   * bills several of our entities — so without a row filter a correctly-permissioned Hyundai user
   * still receives the whole group's payment ledger.
   */
  assert('the vendor payments endpoint scopes ROWS, not just access',
    payments.includes('filterVisibleApprovals'),
    'it returns every brand\'s payments to anyone who may open the Registry')
}

for (const rel of [
  'app/ca/page.tsx',
  'app/api/ca/summary/route.ts',
  'app/api/ca/purchase-orders/route.ts',
  'app/api/ca/petty-cash/route.ts',
]) {
  const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
  assert(`${rel} uses the shared canViewCa predicate`, src.includes('canViewCa'),
    'it restates the CA rule locally, which is exactly how the page and the APIs drifted apart')
}


console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
