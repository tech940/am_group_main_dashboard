/**
 * Proves the MD branch DEFAULT across Purchase Orders, Petty Cash and Approvals.
 *
 *   npm run verify:md-branch-default
 *
 * The rule (2026-08-24): an MD is PERMITTED to see every branch, but LANDS on the branch(es) named
 * in their admin-panel assignment and reaches the rest through an explicit control. Permission and
 * default are separate questions; this file guards the second without weakening the first.
 */
import 'dotenv/config'
import { defaultBranchScopeFor, resolveBranchScope, isAllBranchScope } from '../lib/auth/default-branch-scope'
import { applyApprovalBrandDefault } from '../lib/kia/approval-scope'
import type { AppUser } from '../lib/auth/app-user'

let fail = 0
const ok = (label: string, cond: boolean, extra = '') => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) fail++
}
const J = JSON.stringify

console.log('\n1) The shared resolver')
ok("'kia' defaults to kia", J(defaultBranchScopeFor('kia')) === '["kia"]')
ok("'kia,hyundai' defaults to BOTH (the case that used to break)",
  J(defaultBranchScopeFor('kia,hyundai')) === '["kia","hyundai"]')
ok("' KIA , Hyundai ' tolerates spacing and case", J(defaultBranchScopeFor(' KIA , Hyundai ')) === '["kia","hyundai"]')
ok("'all' means no narrowing", isAllBranchScope(defaultBranchScopeFor('all')))
ok('an empty assignment does NOT blank the page', isAllBranchScope(defaultBranchScopeFor('')))
ok('junk does NOT blank the page (default, not a boundary)', isAllBranchScope(defaultBranchScopeFor('not-a-brand')))

console.log('\n2) An explicit request always wins — this is what the switcher rides on')
ok('asking for another branch overrides the default', J(resolveBranchScope('kia', 'hyundai')) === '["hyundai"]')
ok("asking for 'all' widens", isAllBranchScope(resolveBranchScope('kia', 'all')))
ok('asking for a list works', J(resolveBranchScope('kia', 'kia,platinum')) === '["kia","platinum"]')
ok('asking for nothing falls back to the default', J(resolveBranchScope('kia,hyundai', '')) === '["kia","hyundai"]')
ok('a garbage request falls back rather than emptying the screen', J(resolveBranchScope('kia', 'garbage')) === '["kia"]')

console.log('\n3) Approvals — the default narrows, the permission does not change')
{
  const ID = '00000000-0000-0000-0000-000000000001'
  const u = (role: string, brand: string) => ({ id: ID, email: 'p@x', role, brand, dealers: null }) as AppUser
  const rows = [
    { id: '1', brand: 'kia' }, { id: '2', brand: 'hyundai' },
    { id: '3', brand: 'platinum' }, { id: '4', brand: null },
  ] as never[]
  const brands = (out: { brand?: string | null }[]) => out.map((r) => String(r.brand ?? 'kia')).sort().join(',')

  ok('MD pinned to kia lands on kia only', brands(applyApprovalBrandDefault(u('md', 'kia'), rows)) === 'kia,kia')
  ok('a NULL-brand row counts as kia (legacy rows must not vanish)',
    applyApprovalBrandDefault(u('md', 'kia'), rows).length === 2)
  ok('MD pinned to two brands lands on both',
    brands(applyApprovalBrandDefault(u('md', 'kia,platinum'), rows)) === 'kia,kia,platinum')
  ok("MD pinned to kia can still widen to 'all'",
    applyApprovalBrandDefault(u('md', 'kia'), rows, 'all').length === 4)
  ok('MD pinned to kia can look at another brand explicitly',
    brands(applyApprovalBrandDefault(u('md', 'kia'), rows, 'hyundai')) === 'hyundai')
  ok("MD assigned 'all' still lands on everything", applyApprovalBrandDefault(u('md', 'all'), rows).length === 4)
  ok('developer lands on everything', applyApprovalBrandDefault(u('developer', 'all'), rows).length === 4)

  /*
   * ⚠️ The regression that would matter most: applying the default to a SCOPED role. They are
   * already narrowed by isApprovalVisibleTo, and narrowing again could only hide rows they hold.
   */
  const scoped = applyApprovalBrandDefault(u('accounts', 'kia'), rows)
  ok('a non-all-branch role is left untouched by the default', scoped.length === rows.length)
}

console.log(fail === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${fail} FAILURE(S) ===\n`)
process.exit(fail === 0 ? 0 : 1)
