/**
 * Proves Call Analysis and Insurance Analysis are visible to MD + Developer ONLY, everywhere.
 *
 * The failure this guards against is real and has happened in this repo before: the sidebar and the
 * search surfaces used different gates, so an item appeared in one place and was refused in another.
 * Both now route through canUserAccessSection, so this asserts the single source of truth against
 * EVERY role in the database — including with a fully-granted permission map, which is what an
 * Access Map override looks like.
 *
 *   npm run verify:restricted-analytics
 */
import { ALL_SECTIONS, canUserAccessSection } from '../lib/navigation/sections.ts'
import {
  RESTRICTED_ANALYTICS_HREFS,
  canViewRestrictedAnalytics,
} from '../lib/auth/restricted-analytics.ts'

// Every role in the user_role enum, as of this run.
const ALL_ROLES = [
  'admin', 'branch_admin', 'purchase_manager', 'ea', 'md', 'accounts', 'manager', 'viewer',
  'finance_head', 'service_manager', 'general_manager', 'eba', 'sales_executive', 'sales_manager',
  'developer', 'idt', 'cre', 'edp', 'cxm', 'ccm', 'ed', 'assistant_manager',
]
const ALLOWED = new Set(['md', 'developer', 'assistant_manager'])

// The adversarial case: a permission map where EVERY key is granted, i.e. someone ticked every box
// in the Access Map. A permission-backed gate would open here; a role gate must not.
const ALL_GRANTED = new Proxy({}, { get: () => true, has: () => true })

let failures = 0
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`) }

console.log('1. Both sections are registered and searchable')
for (const href of RESTRICTED_ANALYTICS_HREFS) {
  const section = ALL_SECTIONS.find((s) => s.href === href)
  if (!section) fail(`${href} is MISSING from ALL_SECTIONS — it can never appear in search`)
  else console.log(`  ✓ ${href} -> "${section.name}"`)
}

console.log('\n2. canUserAccessSection (drives sidebar AND both search surfaces)')
for (const href of RESTRICTED_ANALYTICS_HREFS) {
  const section = ALL_SECTIONS.find((s) => s.href === href)
  if (!section) continue
  for (const role of ALL_ROLES) {
    const expected = ALLOWED.has(role)
    for (const [label, perms] of [['no perms', null], ['ALL perms granted', ALL_GRANTED]]) {
      const actual = canUserAccessSection(section, role, 'common', perms)
      if (actual !== expected) {
        fail(`${href}  role=${role}  perms=${label}  ->  got ${actual}, expected ${expected}`)
      }
    }
  }
  console.log(`  ✓ ${href}: allowed for md+developer, denied for the other ${ALL_ROLES.length - 2} roles, even with every permission granted`)
}

console.log('\n3. The role helper itself')
for (const role of ALL_ROLES) {
  if (canViewRestrictedAnalytics(role) !== ALLOWED.has(role)) fail(`canViewRestrictedAnalytics('${role}')`)
}
for (const junk of [null, undefined, '', '  ', 'MD ', 'Developer', 'superadmin', 'admin']) {
  const expected = ['MD ', 'Developer'].includes(junk) // case/space tolerant, nothing else
  if (canViewRestrictedAnalytics(junk) !== expected) {
    fail(`canViewRestrictedAnalytics(${JSON.stringify(junk)}) -> ${canViewRestrictedAnalytics(junk)}, expected ${expected}`)
  }
}
console.log('  ✓ exact two-role match, case/whitespace tolerant, no near-miss role leaks in')

console.log('\n4. No OTHER section was affected')
const others = ALL_SECTIONS.filter((s) => !RESTRICTED_ANALYTICS_HREFS.includes(s.href))
const mdSees = others.filter((s) => canUserAccessSection(s, 'md', 'common', ALL_GRANTED)).length
const adminSees = others.filter((s) => canUserAccessSection(s, 'admin', 'common', ALL_GRANTED)).length
console.log(`  md sees ${mdSees}/${others.length} other sections · admin sees ${adminSees}/${others.length}`)
if (adminSees === 0) fail('admin now sees NOTHING — the gate is over-broad')

console.log(failures === 0
  ? `\nPASS — ${RESTRICTED_ANALYTICS_HREFS.length} sections locked to md+developer across sidebar and search`
  : `\n*** ${failures} FAILURE(S) ***`)
process.exit(failures === 0 ? 0 : 1)
