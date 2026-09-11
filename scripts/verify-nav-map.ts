/**
 * Every section in the sidebar can be FOUND in section search and is ACCOUNTED FOR in Admin → Access Map.
 *
 * The owner's requirement of 2026-09-11. This replaces the original check, which compared the generated
 * href→permission map with a hand-kept snapshot — a migration finished long ago — and had been failing for
 * months on a stale baseline, as its own header admitted. A check everyone has learned to ignore protects nothing.
 *
 * It proves:
 *  1. every sidebar link has exactly one ALL_SECTIONS entry, and its href is in ALLOWED_SIDEBAR_HREFS
 *     (canUserAccessSection hard-returns false for anything absent — how Fuel Approvals went unfindable);
 *  2. every sidebar link is in the Access Map exactly once: tickable (SECTION_ROUTES) OR read-only and
 *     role-locked (LOCKED_SIDEBAR_SECTIONS), never both and never neither;
 *  3. no search entry falls through to canUserAccessSection's final `return true` for a user holding nothing —
 *     an unkeyed href with no explicit gate is visible to EVERY role (Data Health was one line from that);
 *  4. each locked section's rule is the sidebar's own predicate, for every role.
 *
 * Run:  npm run verify:nav-map
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canViewMdTargets } from '../lib/auth/md-targets-access'
import { canViewRestrictedAnalytics } from '../lib/auth/restricted-analytics'
import { isSuperAdminRole } from '../lib/auth/roles'
import { canViewVehicleTracker } from '../lib/kia/vehicle-tracker-access'
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS, canUserAccessSection } from '../lib/navigation/sections'
import {
  GROUPS_REPLACED_BY_LOCKED_SECTIONS,
  LOCKED_SIDEBAR_SECTIONS,
  SOCIAL_MEDIA_LEADS_ROLES,
} from '../lib/permissions/locked-sections'
import { ROLE_PERMISSION_TEMPLATES, SECTION_ROUTES } from '../lib/permissions/registry'

let failures = 0
function assert(label: string, condition: boolean, detail = '') {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${label}${detail ? `  — ${detail}` : ''}`)
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')
const withoutLineComments = (src: string) =>
  src.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n')

const sidebar = withoutLineComments(read('components/layout/sidebar.tsx'))
const searchSource = withoutLineComments(read('lib/navigation/sections.ts'))

// Brand roots ('/brands/kia') are the brand headers, not sections. Commented-out links (Renewal Pipeline, MD
// Approvals, Effective Access) are not in the sidebar and are dropped with the comments above.
const sidebarHrefs = [...new Set([...sidebar.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]))]
  .filter((href) => !/^\/brands\/[a-z]+$/.test(href))

console.log(`\n0) The sidebar links ${sidebarHrefs.length} sections.`)
assert('the sidebar parse found a plausible number of links', sidebarHrefs.length >= 40, sidebarHrefs.join(', '))

console.log('\n1) Every sidebar section can be found by search:')
for (const href of sidebarHrefs) {
  const entries = ALL_SECTIONS.filter((section) => section.href === href)
  assert(`${href} has exactly one search entry`, entries.length === 1, `found ${entries.length}`)
  assert(`${href} is in ALLOWED_SIDEBAR_HREFS`, ALLOWED_SIDEBAR_HREFS.has(href))
}

console.log('\n2) Every sidebar section is in the Access Map exactly once — tickable, or read-only because fixed by role:')
const tickableByHref = new Map<string, string>()
for (const [groupKey, route] of Object.entries(SECTION_ROUTES)) {
  if (GROUPS_REPLACED_BY_LOCKED_SECTIONS.has(groupKey)) continue
  tickableByHref.set(route.href, groupKey)
  for (const alias of route.aliases ?? []) tickableByHref.set(alias, groupKey)
}
/*
 * The sidebar links Scrap at /scrap while its registry route is /scrap-erp. Both reach the same gate
 * (canAccessScrapErp) and the Access Map lists it once, as Scrap ERP. Recorded here rather than papered over.
 */
const KNOWN_HREF_DIFFERENCES: Record<string, string> = { '/scrap': 'scrap_erp' }
const lockedByHref = new Map(LOCKED_SIDEBAR_SECTIONS.map((section) => [section.href, section]))
for (const href of sidebarHrefs) {
  const tickable = tickableByHref.get(href) ?? KNOWN_HREF_DIFFERENCES[href]
  const locked = lockedByHref.get(href)
  assert(`${href} → ${tickable ? `tickable (${tickable})` : locked ? `read-only (${locked.rule})` : 'MISSING'}`,
    Boolean(tickable) !== Boolean(locked), tickable && locked ? 'listed as BOTH tickable and locked' : '')
}
for (const locked of LOCKED_SIDEBAR_SECTIONS) {
  assert(`locked section ${locked.name} is a real sidebar link`, sidebarHrefs.includes(locked.href))
}
const matrixRoute = read('app/api/admin/access-matrix/route.ts')
assert('the Access Map route appends the locked sections and drops the groups they replace',
  matrixRoute.includes('LOCKED_SIDEBAR_SECTIONS') && matrixRoute.includes('GROUPS_REPLACED_BY_LOCKED_SECTIONS'))
const accessMap = read('features/admin/access-map.tsx')
assert('the Access Map refuses to toggle a locked section', /if \(columnKey\.startsWith\('locked\.'\)\) return/.test(accessMap))

console.log('\n3) No search entry is shown to someone who holds nothing:')
for (const section of ALL_SECTIONS) {
  if (!ALLOWED_SIDEBAR_HREFS.has(section.href)) continue
  const brand = section.brand === 'common' ? 'kia' : section.brand
  assert(`${section.href} is hidden from a Viewer with no permissions`,
    !canUserAccessSection(section, 'viewer', brand, {}))
}

console.log('\n4) Each locked section uses the sidebar\'s own rule, for every role:')
const roles = Object.keys(ROLE_PERMISSION_TEMPLATES)
const expected: Record<string, (role: string) => boolean> = {
  '/targets': (role) => canViewMdTargets(role),
  '/data-health': (role) => isSuperAdminRole(role),
  '/admin': (role) => isSuperAdminRole(role),
  '/call-analysis': (role) => canViewRestrictedAnalytics(role),
  '/insurance': (role) => canViewRestrictedAnalytics(role),
  '/social-media-leads': (role) => (SOCIAL_MEDIA_LEADS_ROLES as readonly string[]).includes(role),
  '/brands/kia/vehicle-tracker': (role) => canViewVehicleTracker(role),
}
for (const locked of LOCKED_SIDEBAR_SECTIONS) {
  const rule = expected[locked.href]
  if (!rule) {
    assert(`${locked.name} has an expected rule in this script`, false)
    continue
  }
  const wrong = roles.filter((role) => locked.canView(role, 'kia') !== rule(role))
  assert(`${locked.name}: the Access Map and the sidebar agree for all ${roles.length} roles`, wrong.length === 0, wrong.join(', '))
}

// Two surfaces state the Social Media Leads rule inline; both must still be the list the Access Map reports.
const inlineRoles = (src: string) => {
  const match = src.match(/'\/social-media-leads'\)\s*\{\s*return\s*\[([^\]]*)\]/)
  return match ? [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort() : []
}
const lockedList = [...SOCIAL_MEDIA_LEADS_ROLES].sort()
assert('the sidebar\'s Social Media Leads roles match the Access Map', inlineRoles(sidebar).join() === lockedList.join(),
  inlineRoles(sidebar).join(', '))
assert('search\'s Social Media Leads roles match the Access Map', inlineRoles(searchSource).join() === lockedList.join(),
  inlineRoles(searchSource).join(', '))

// The Admin Panel link used canAccessAdmin (admin + hr as well), while the page admits only MD and Developer.
const adminLabel = sidebar.indexOf("label: 'Admin Panel'")
const beforeAdmin = adminLabel > 0 ? sidebar.slice(Math.max(0, adminLabel - 500), adminLabel) : ''
assert('the Admin Panel link uses the page\'s own test (isSuperAdminRole)',
  beforeAdmin.includes('isSuperAdminRole(userRole)') && !/if \(canAccessAdmin\)/.test(beforeAdmin))
assert('app/admin/page.tsx still admits isSuperAdminRole only', /if \(!isSuperAdminRole\(appUser\.role\)\) forbidden\(\)/.test(read('app/admin/page.tsx')))

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
process.exit(failures === 0 ? 0 : 1)
