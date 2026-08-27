/**
 * Verifies the petty-cash multi-brand + permission fixes. Read-only; delete after use.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-petty-cash-multibrand.ts
 */
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { getPettyCashBrandStatus, getPettyCashConfiguredBranches, getPettyCashLocationOptions, getPettyCashTopUpThreshold, getPettyCashUserBrands, isPettyCashAllBranchRole, isPettyCashConfiguredForBranch, isPettyCashOwnSubmissionsOnlyRole } from '../lib/petty-cash/constants'
import { canCreatePettyCashRequest, canReadPettyCashExpense, canViewPettyCashBranch, hasPettyCashAllBranchAccess, pettyCashBranchScope } from '../lib/petty-cash/access'
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

console.log(`
5) Branch isolation (2026-08-24 product rule: assignment decides, not role)`)
{
  /*
   * Unconditional all-branch supervision is MD + Developer ONLY. Every other role — EA, EBA and ED
   * included — sees exactly what their admin-panel assignment grants. Regressing this silently
   * re-opens every branch's cash to every approver, which is precisely what this rule closed.
   */
  const u = (role: string, brand: string) => ({ id: 'probe', email: 'probe@x', role, brand }) as never
  ok('md is all-branch whatever the assignment says', hasPettyCashAllBranchAccess(u('md', 'kia')))
  ok('developer is all-branch whatever the assignment says', hasPettyCashAllBranchAccess(u('developer', 'kia')))
  ok('EA pinned to one brand is NOT all-branch', !hasPettyCashAllBranchAccess(u('ea', 'kia')))
  ok('EBA pinned to one brand is NOT all-branch', !hasPettyCashAllBranchAccess(u('eba', 'kia')))
  ok('ED pinned to one brand is NOT all-branch', !hasPettyCashAllBranchAccess(u('ed', 'kia')))
  ok("EA assigned 'all' still sees every branch", hasPettyCashAllBranchAccess(u('ea', 'all')))
  ok('EA assigned two brands is scoped, not all-branch', !hasPettyCashAllBranchAccess(u('ea', 'kia,hyundai')))
  ok('a KIA-pinned EA cannot view hyundai', !canViewPettyCashBranch(u('ea', 'kia'), 'hyundai'))
  ok('a multi-brand EA can view both of theirs',
    canViewPettyCashBranch(u('ea', 'kia,hyundai'), 'kia') && canViewPettyCashBranch(u('ea', 'kia,hyundai'), 'hyundai'))
  ok('MD can view any brand (the switcher depends on it)', canViewPettyCashBranch(u('md', 'kia'), 'hyundai'))
  ok('client and server share ONE role list',
    isPettyCashAllBranchRole('md') && isPettyCashAllBranchRole('developer')
    && !isPettyCashAllBranchRole('ea') && !isPettyCashAllBranchRole('eba') && !isPettyCashAllBranchRole('ed'))
}

console.log(`
6) "Why is this empty?" — the brand-status predicate behind the on-screen explanation`)
{
  /*
   * Regressions here are SILENT: the page still renders, it just stops explaining itself (or
   * explains something false). Each case below was a real wrong answer before 2026-08-24.
   */
  const st = getPettyCashBrandStatus
  ok("'honda' (a real group brand petty cash does not run) -> unconfigured", st('honda', false) === 'unconfigured')
  ok("'tata' -> unconfigured", st('tata', false) === 'unconfigured')
  ok("'kia' -> configured", st('kia', false) === 'configured')
  ok("'kia,hyundai' -> configured (was WRONGLY unconfigured: disabled a multi-brand creator)",
    st('kia,hyundai', false) === 'configured')
  ok("'hyundai,honda' -> configured (one real brand is enough)", st('hyundai,honda', false) === 'configured')
  ok("empty assignment -> unassigned (a different admin fix)", st('', false) === 'unassigned')
  ok('null assignment -> unassigned', st(null, false) === 'unassigned')
  ok("all-branch viewer is never unconfigured, whatever the assignment says (was WRONGLY telling MDs and developers assigned 'all' that petty cash was not set up for \"Unassigned Branch\")",
    st('all', true) === 'configured' && st('honda', true) === 'configured' && st('', true) === 'configured')
}

console.log(`
7) Dealership topology is SCOPED to the viewer (the "why am I seeing Hyundai" leak)`)
{
  /*
   * The Balances-by-Branch panel used to render a hardcoded CANONICAL_TOPOLOGY of all three
   * dealerships to EVERY viewer, defaulting to the Hyundai tab. A KIA branch_admin therefore saw
   * all 12 Hyundai outlets, their Sales/Service split and a Request Float button per row. No money
   * leaked (placeholder rows are zero and the server rejects a cross-brand create with 'Forbidden
   * branch'), but the group's outlet topology did. This mirrors the component's derivation.
   */
  const topology = (role: string, brand: string, brandView = '') => {
    const isAllBranchViewer = isPettyCashAllBranchRole(role) || brand === 'all'
    const allowed = isAllBranchViewer
      ? (brandView && brandView !== 'all' ? [brandView] : getPettyCashConfiguredBranches())
      : getPettyCashUserBrands(brand).filter((b) => isPettyCashConfiguredForBranch(b))
    return allowed
  }
  const kiaAdmin = topology('branch_admin', 'kia')
  ok('a KIA branch_admin sees ONLY kia', JSON.stringify(kiaAdmin) === '["kia"]', 'was: kia+hyundai+platinum')
  ok('a KIA branch_admin sees NO hyundai outlets', !kiaAdmin.includes('hyundai'))
  ok('a Hyundai branch_admin sees only hyundai', JSON.stringify(topology('branch_admin', 'hyundai')) === '["hyundai"]')
  ok('a KIA EA sees only kia', JSON.stringify(topology('ea', 'kia')) === '["kia"]')
  ok('a shared kia+hyundai login sees exactly those two',
    JSON.stringify(topology('ea', 'kia,hyundai')) === '["kia","hyundai"]')
  ok('an unconfigured-brand login sees no dealership at all', topology('ea', 'honda').length === 0)
  ok('MD defaults to their own branch', JSON.stringify(topology('md', 'kia', 'kia')) === '["kia"]')
  ok('MD on All Branches sees every configured brand',
    topology('md', 'kia', 'all').length === getPettyCashConfiguredBranches().length)

  // The registry must keep producing the outlets the removed hardcoded list did, or real users
  // silently lose locations.
  const expected: Record<string, string[]> = {
    hyundai: ['Jammu', 'Akhnoor', 'Kathua', 'RS Pura', 'Vijaypur', 'Billawar'],
    platinum: ['Jammu', 'Rajouri', 'Poonch'],
    kia: ['Jammu', 'Udhampur', 'Banihal'],
  }
  for (const [brand, want] of Object.entries(expected)) {
    const got = getPettyCashLocationOptions(brand)
    ok(`registry still yields all ${want.length} ${brand} outlets`,
      JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()), got.join(', '))
  }
}

console.log(`
8) Submitters see ONLY their own submissions (2026-08-24)`)
{
  /*
   * Three KIA branch admins each submitted 55/55/75 expenses and every one of them could see all
   * 185, purely because they shared a brand. A branch admin is a custodian of their own float, not
   * a supervisor of the branch. Approvers must still see branch-wide or their queue is empty.
   */
  ok('branch_admin sees only their own', isPettyCashOwnSubmissionsOnlyRole('branch_admin'))
  ok('sales_manager sees only their own', isPettyCashOwnSubmissionsOnlyRole('sales_manager'))
  ok('general_manager sees only their own (GSM Sales)', isPettyCashOwnSubmissionsOnlyRole('general_manager'))
  ok('service_general_manager sees only their own (GSM Service)', isPettyCashOwnSubmissionsOnlyRole('service_general_manager'))
  for (const role of ['ea', 'ed', 'md', 'eba', 'accounts', 'developer', 'admin', 'manager']) {
    ok(`${role} is NOT restricted to own submissions (approver/supervisor)`, !isPettyCashOwnSubmissionsOnlyRole(role))
  }
  /*
   * ⚠️ NOT asserted: that this set equals the creator set. canCreatePettyCashRequest was widened to
   * every role, so an EA/MD may raise a request AND still see the whole branch — correct for a
   * supervisor. Only that the submitter roles can both create and are restricted to their own.
   */
  ok('all submitter roles can create AND are restricted to their own',
    ['branch_admin', 'sales_manager', 'general_manager', 'service_general_manager'].every((r) => canCreatePettyCashRequest(r) && isPettyCashOwnSubmissionsOnlyRole(r)))

  // The by-id read must agree with the list filter, or a submitter could open a row they cannot see.
  const mine = { id: 'me', email: 'me@x', role: 'branch_admin', brand: 'kia' } as never
  ok("a branch_admin CANNOT open another custodian's expense by id",
    !canReadPettyCashExpense(mine, { branchId: 'kia', createdBy: 'someone-else' } as never))
  ok('a branch_admin CAN open their own', canReadPettyCashExpense(mine, { branchId: 'kia', createdBy: 'me' } as never))
  const approver = { id: 'ea1', email: 'ea@x', role: 'ea', brand: 'kia' } as never
  ok("an EA CAN still open any expense in their branch (review depends on it)",
    canReadPettyCashExpense(approver, { branchId: 'kia', createdBy: 'someone-else' } as never))
  ok('an EA still cannot open another BRANCH', !canReadPettyCashExpense(approver, { branchId: 'hyundai', createdBy: 'x' } as never))
}

console.log(`
9) Branch-specific top-up thresholds (KIA: ₹1,000; Others: ₹10,000)`)
{
  ok('KIA threshold is exactly 1,000', getPettyCashTopUpThreshold('kia') === 1000)
  ok('KIA threshold case-insensitive', getPettyCashTopUpThreshold('KIA') === 1000)
  ok('Hyundai threshold is exactly 10,000', getPettyCashTopUpThreshold('hyundai') === 10000)
  ok('Platinum threshold is exactly 10,000', getPettyCashTopUpThreshold('platinum') === 10000)
  ok('MG threshold is exactly 10,000', getPettyCashTopUpThreshold('mg') === 10000)
  ok('Null/undefined branch defaults to 10,000', getPettyCashTopUpThreshold(null) === 10000)
}

console.log(fail === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${fail} FAILURE(S) ===\n`)
process.exit(fail === 0 ? 0 : 1)
