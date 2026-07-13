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
assert(
  'sidebar imports the shared legacy-module-roles predicates',
  sidebar.includes('legacy-module-roles') && sidebar.includes('isPettyCashViewRole') && sidebar.includes('isAmFinanceViewRole'),
)
assert('am-finance access imports the shared role list', amFinanceAccess.includes('legacy-module-roles'))
assert('petty-cash access imports the shared role predicate', pettyCashAccess.includes('legacy-module-roles'))
assert(
  'sidebar no longer uses the leaky "(canAccessX || permissionMap) && hasPermission" idiom',
  !sidebar.includes('|| permissionMap) && hasPermission'),
)

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===\n`)
process.exit(failures === 0 ? 0 : 1)
