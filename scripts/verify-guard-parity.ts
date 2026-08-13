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
import { readFileSync, readdirSync } from 'node:fs'
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

const allPages = walk(join(ROOT, 'app')).map((f) => readFileSync(f, 'utf8')).join('\n')
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
  // Booking Payment History uses custom role & permission guard (MD/EA/Developer default).
  'kia.booking_payment_history': { reason: 'custom role & permission gate (MD/EA/Developer)', requireToken: 'canViewBookingPaymentHistory' },
  // Insurance Analysis is gated via lib/auth/restricted-analytics.ts (MD, Developer, Assistant Manager).
  insurance_analysis: { reason: 'hardcoded MD/Developer/Assistant Manager gate, not grantable', requireToken: 'canViewRestrictedAnalytics' },
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

const apiFiles = walk(join(ROOT, 'app/api'))
const allApi = apiFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
const allCode = allPages + '\n' + allApi

// section key -> the role-gate token that guards it
const ROLE_GATED_GRANTABLE: Record<string, string> = {
  scrap_erp: 'canAccessScrapErp',
  'kia.booking_payment_history': 'canViewBookingPaymentHistory',
  ca: 'isCaViewRole',
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

for (const file of apiFiles) {
  const body = readFileSync(file, 'utf8')
  for (const [key, token] of Object.entries(ROLE_GATED_GRANTABLE)) {
    if (!body.includes(token + '(')) continue
    assert(
      `${file.replace(ROOT, '').replace(/\\/g, '/')}: role-gates ${key} and honours the grant`,
      body.includes('isPermissionExplicitlyAllowed'),
      'this API would 403 a user its own page just admitted',
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

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
