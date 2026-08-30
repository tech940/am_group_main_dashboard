/**
 * The Group Service Manager can SEE and APPROVE the Hyundai + Platinum service requests he owns.
 *
 * ── The bug this guards ───────────────────────────────────────────────────────────────────────
 * Routing a stage to a new role only moves the AUTHORITY. Visibility is a separate gate, and
 * approvals fails closed on an empty branch pin: the holder was created with brand='platinum,hyundai'
 * and no `dealers` value, so `allowed.size === 0` and he could see 0 of the 11 service requests
 * waiting on him — while the API would happily have accepted his approval on every one. An approver
 * who cannot see his own queue reads as "there is nothing to approve", which is silent.
 *
 * So this asserts the two halves TOGETHER, and asserts they describe the same set: everything he can
 * see he can act on, and everything he can act on he can see.
 *
 * Read-only. Run: npm run verify:group-service-approvals
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { isApprovalVisibleTo } from '../lib/kia/approval-scope'
import {
  firstStageApproverRolesForTrack, isServiceApproval, usesGroupServiceManager,
} from '../lib/approvals/first-stage-approver'
import type { AppUser } from '../lib/auth/app-user'

const ROLE = 'group_service_manager'
let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

type UserRow = { id: string; full_name: string; role: string; brand: string | null; dealers: string | null }
type ReqRow = {
  request_no: string | null; brand: string | null; dealer_code: string | null; location: string | null
  department: string | null; approval_type: string | null; amount: string; vp_approval: string | null
}

const asAppUser = (u: UserRow): AppUser => ({
  id: u.id, supabaseId: u.id, email: '', fullName: u.full_name,
  role: u.role as AppUser['role'], brand: u.brand, dealers: u.dealers,
  department: null, isActive: true,
})

const scopeRow = (r: Partial<ReqRow>) => ({
  brand: r.brand ?? null, dealerCode: r.dealer_code ?? null, location: r.location ?? null,
  department: r.department ?? null, approvalType: r.approval_type ?? null,
}) as Parameters<typeof isApprovalVisibleTo>[1]

/** Exactly the server's rule for the first stage, minus the admin/MD overrides. */
const mayApproveFirstStage = (role: string, r: Partial<ReqRow>) =>
  firstStageApproverRolesForTrack(r.brand, isServiceApproval(r.department, r.approval_type) ? 'service' : 'sales')
    .includes(role)

async function main() {
  const holders = await analyticsExecute<UserRow>(sql`
    SELECT id::text, full_name, role::text AS role, brand, dealers
    FROM public.users WHERE role::text = ${ROLE} AND is_active = true ORDER BY full_name`)

  console.log(`1) Who holds ${ROLE}`)
  for (const h of holders) {
    console.log(`   ${h.full_name}  brand=${h.brand || '-'}  pin=${h.dealers || 'NONE'}`)
  }
  if (!holders.length) {
    /*
     * Name the likely cause instead of just failing. This has already happened once: the holder's
     * role was edited to 'vp' in Admin while his `department` still read "Group Service manager".
     * VP has NO standing outside KIA — a deliberate rule, asserted in verify-first-stage — so that
     * single edit silently took away both his visibility and his authority over every Hyundai and
     * Platinum service request. Nothing in the UI says so; his queue simply empties.
     */
    const nearby = await analyticsExecute<UserRow & { department: string | null; is_active: boolean }>(sql`
      SELECT id::text, full_name, role::text AS role, brand, dealers, department, is_active
      FROM public.users
      WHERE department ILIKE '%group service%' OR full_name ILIKE '%group service%'`)
    console.log('   NOBODY holds it. Candidates whose department says otherwise:')
    for (const n of nearby) {
      console.log(`      ${n.full_name} — role is "${n.role}", department "${n.department}", active=${n.is_active}`)
    }
    console.log('   FIX: in Admin, set that user\'s ROLE to "Group Service Manager".')
    console.log('   Until then Hyundai and Platinum SERVICE approvals have no approver at all.')
  }
  check(holders.length > 0, 'somebody active holds the role')
  /*
   * Asserted because an unpinned holder is the NORMAL case for this role and must keep working. If
   * somebody "fixes" a future gap by pinning branches, the pin must not become load-bearing again.
   */
  check(holders.some((h) => !String(h.dealers || '').trim()),
    'at least one holder has NO branch pin — the rule must not depend on one')

  /*
   * The CODE rules below must be asserted whether or not anybody holds the role right now.
   *
   * Driving them from live `holders` alone means a staffing lapse silently switches the whole test
   * off — the run goes green with sections 3-6 EMPTY, which is exactly backwards: that is the moment
   * you most want to know the rules still hold. So when nobody holds it they run against a synthetic
   * holder carrying the shape the role is created with: both brands, NO pin.
   */
  const SYNTHETIC: UserRow = {
    id: '00000000-0000-0000-0000-000000000000',
    full_name: '(synthetic holder — nobody holds the role right now)',
    role: ROLE, brand: 'platinum,hyundai', dealers: null,
  }
  const subjects = holders.length ? holders : [SYNTHETIC]
  if (!holders.length) console.log('   ...asserting the RULES against a synthetic holder so they stay covered.')

  const all = await analyticsExecute<ReqRow>(sql`
    SELECT request_no, brand, dealer_code, location, department, approval_type,
           amount::text, vp_approval
    FROM kia_approval_requests`)

  const groupBrandRows = all.filter((r) => usesGroupServiceManager(r.brand))
  const service = groupBrandRows.filter((r) => isServiceApproval(r.department, r.approval_type))
  const sales = groupBrandRows.filter((r) => !isServiceApproval(r.department, r.approval_type))
  const waiting = service.filter((r) => !String(r.vp_approval || '').trim())

  console.log(`\n2) The queue: ${groupBrandRows.length} Hyundai+Platinum requests — ${service.length} service, ${sales.length} sales`)
  console.log(`   ${waiting.length} SERVICE requests are unactioned at the first stage:`)
  for (const r of waiting) {
    console.log(`      ${String(r.request_no || '-').padEnd(14)} ${String(r.brand).padEnd(9)} ${String(r.location || r.dealer_code || '-').padEnd(10)} ${String(r.approval_type || '-').slice(0, 24).padEnd(24)} Rs${Number(r.amount).toLocaleString('en-IN')}`)
  }

  console.log('\n3) He sees every service request of his brands — and no sales request')
  for (const h of subjects) {
    const u = asAppUser(h)
    const seenService = service.filter((r) => isApprovalVisibleTo(u, scopeRow(r)))
    const seenSales = sales.filter((r) => isApprovalVisibleTo(u, scopeRow(r)))
    const seenWaiting = waiting.filter((r) => isApprovalVisibleTo(u, scopeRow(r)))
    const value = seenWaiting.reduce((a, r) => a + Number(r.amount), 0)
    console.log(`   ${h.full_name}: service ${seenService.length}/${service.length}, sales ${seenSales.length}/${sales.length}, waiting ${seenWaiting.length}/${waiting.length}  Rs${value.toLocaleString('en-IN')}`)
    check(seenService.length === service.length, `${h.full_name} sees EVERY service request of his brands`)
    check(seenWaiting.length === waiting.length, `${h.full_name} sees all ${waiting.length} waiting on him`)
    // Not an oversight: the sales side of this stage belongs to the brands' own sales GSMs, and he
    // cannot act on it — so showing him those vendor names and amounts would be exposure for nothing.
    check(seenSales.length === 0, `${h.full_name} sees NO sales request — that stage is not his`)
  }

  console.log('\n4) Seeing and approving describe the SAME set')
  /*
   * The failure this catches is subtler than "cannot see": a row he can see but not action is a
   * dead button, and a row he can action but not see is money moving off-screen. Asserted over
   * every request in the table, not just his brands.
   */
  for (const h of subjects) {
    const u = asAppUser(h)
    const mismatched = all.filter((r) => isApprovalVisibleTo(u, scopeRow(r)) !== mayApproveFirstStage(ROLE, r))
    for (const r of mismatched.slice(0, 10)) {
      const canSee = isApprovalVisibleTo(u, scopeRow(r))
      console.log(`      ${String(r.request_no || '-').padEnd(14)} ${String(r.brand).padEnd(9)} dept=${String(r.department || '-').padEnd(9)} see=${canSee} act=${!canSee}`)
    }
    check(mismatched.length === 0, `${h.full_name}: every visible row is actionable and vice versa (${mismatched.length} mismatches)`)
  }

  console.log('\n5) A branch spelling nobody has invented yet cannot hide a service request')
  /*
   * The whole reason this is a role rule and not a branch pin. Most of these codes are not on any
   * pin; if any of them hides a row, somebody has reintroduced the branch gate for this role.
   */
  for (const h of subjects) {
    const u = asAppUser(h)
    for (const brand of ['hyundai', 'platinum']) {
      for (const code of ['N5216', 'KATHUA', 'N6250', 'SOME-NEW-BRANCH', '']) {
        const ok = isApprovalVisibleTo(u, scopeRow({
          brand, dealer_code: code, location: '', department: 'SERVICE', approval_type: 'Vendor Payment',
        }))
        check(ok, `${h.full_name} sees a ${brand} SERVICE row coded "${code || '(blank)'}"`)
      }
    }
  }

  console.log('\n6) The boundary holds — KIA is not his, and neither is anyone else')
  for (const h of subjects) {
    const u = asAppUser(h)
    for (const brand of ['kia', 'tata', 'honda']) {
      const leak = isApprovalVisibleTo(u, scopeRow({
        brand, dealer_code: 'JK402', location: 'JAMMU', department: 'SERVICE', approval_type: 'Vendor Payment',
      }))
      check(!leak, `${h.full_name} cannot see a ${brand} service request`)
    }
  }
  check(!mayApproveFirstStage(ROLE, { brand: 'kia', department: 'SERVICE', approval_type: 'Vendor Payment' }),
    'KIA service still routes to its own approver, not the group role')

  console.log('\n7) New requests route to him before EA')
  for (const brand of ['hyundai', 'platinum']) {
    const roles = firstStageApproverRolesForTrack(brand, 'service')
    const salesRoles = firstStageApproverRolesForTrack(brand, 'sales')
    console.log(`   ${brand.padEnd(9)} service -> ${roles.join(', ').padEnd(24)} sales -> ${salesRoles.join(', ')}`)
    check(roles.length === 1 && roles[0] === ROLE, `${brand} service first stage is the Group Service Manager alone`)
    check(!salesRoles.includes(ROLE), `${brand} sales still belongs to the sales GSM`)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
