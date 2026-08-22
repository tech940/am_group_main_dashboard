/**
 * Verifies the petty-cash multi-brand + permission fixes. Read-only; delete after use.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-petty-cash-multibrand.ts
 */
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { getPettyCashUserBrands } from '../lib/petty-cash/constants'
import { pettyCashBranchScope } from '../lib/petty-cash/access'
import { pettyCashRequests } from '../lib/db/schema'
import { ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { PETTY_CASH_VIEW_ROLES } from '../lib/permissions/legacy-module-roles'

let fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}

console.log('\n1) Brand splitting (the defect: exact-match rejected comma pins)')
ok("'kia' -> ['kia']", JSON.stringify(getPettyCashUserBrands('kia')) === '["kia"]')
ok("'hyundai,platinum' -> both", JSON.stringify(getPettyCashUserBrands('hyundai,platinum')) === '["hyundai","platinum"]')
ok("'platinum,kia' -> both", JSON.stringify(getPettyCashUserBrands('platinum,kia')) === '["platinum","kia"]')
ok("'all' -> [] (fails closed; hasPettyCashAllBranchAccess answers that case)", getPettyCashUserBrands('all').length === 0)
ok('null -> [] (fails closed)', getPettyCashUserBrands(null).length === 0)
ok("junk 'nope' -> []", getPettyCashUserBrands('nope').length === 0)
ok("'KIA' NOT silently widened (case deliberately not normalised)", getPettyCashUserBrands('KIA').length === 0)

console.log('\n2) SQL predicate shape — one brand must stay byte-identical to the old eq()')
const sqlOf = (brands: string[]) =>
  db.select({ id: pettyCashRequests.id }).from(pettyCashRequests)
    .where(pettyCashBranchScope(pettyCashRequests.branchId, brands)).toSQL()

const one = sqlOf(['kia'])
const two = sqlOf(['hyundai', 'platinum'])
const none = sqlOf([])
const baseline = db.select({ id: pettyCashRequests.id }).from(pettyCashRequests)
  .where(eq(pettyCashRequests.branchId, 'kia')).toSQL()

console.log('    1 brand : ' + one.sql + '   params=' + JSON.stringify(one.params))
console.log('    baseline: ' + baseline.sql + '   params=' + JSON.stringify(baseline.params))
console.log('    2 brands: ' + two.sql + '   params=' + JSON.stringify(two.params))
console.log('    0 brands: ' + none.sql + '   params=' + JSON.stringify(none.params))

ok('1 brand is IDENTICAL to the old eq() predicate (SQL text + params)',
  one.sql === baseline.sql && JSON.stringify(one.params) === JSON.stringify(baseline.params))
ok('2 brands emit an IN list carrying both params',
  /\bin\b/i.test(two.sql) && JSON.stringify(two.params) === JSON.stringify(['hyundai', 'platinum']))
ok('0 brands matches nothing (equality against empty string, not a bare TRUE)',
  !/\bin\b/i.test(none.sql) && JSON.stringify(none.params) === JSON.stringify(['']))

console.log('\n3) Role allowlist vs permission templates (the sidebar-hides / page-admits desync)')
console.log('    The sidebar needs role AND permission; the page needs role OR an explicit grant.')
console.log('    So every role the page admits must also carry the permission, or its link stays hidden.')
for (const role of PETTY_CASH_VIEW_ROLES) {
  const keys = ROLE_PERMISSION_TEMPLATES[role as keyof typeof ROLE_PERMISSION_TEMPLATES] || []
  const hasView = keys.includes('petty_cash.view')
  // developer/admin/md/ea/eba resolve through the super-admin / global-access paths in
  // buildRoleTemplateSnapshot rather than through their own template entry.
  const resolvesElsewhere = ['developer', 'admin', 'md', 'ea', 'eba'].includes(role)
  ok(`${role}`, hasView || resolvesElsewhere, hasView ? 'template grant' : 'super-admin / global-access path')
}

console.log(fail === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${fail} FAILURE(S) ===\n`)
process.exit(fail === 0 ? 0 : 1)
