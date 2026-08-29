/**
 * Every approval stage must be able to SEE the requests waiting on it.
 *
 * ── The bug this guards ───────────────────────────────────────────────────────────────────────
 * A branch is written three different ways and the pin only matched one. KIA Accounts, correctly
 * pinned to JK402,JK501, could not see the 15 requests filed as KIA-JM / KIA-UD — including a
 * Rs2,47,605 accessories bill fully approved by VP, EA and MD and waiting on Accounts alone. No
 * permission was wrong and no row was lost; the spelling simply did not match.
 *
 * That failure is SILENT. An Accounts user cannot tell "there is nothing to approve" from "I cannot
 * see what is waiting for me", which is why this is asserted rather than left to be noticed.
 *
 * Read-only. Run: npm run verify:approvals-visibility
 */
import 'dotenv/config'
import { isApprovalVisibleTo } from '../lib/kia/approval-scope'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import type { AppUser } from '../lib/auth/app-user'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

type UserRow = { id: string; full_name: string; role: string; brand: string | null; dealers: string | null }
type ReqRow = {
  request_no: string; brand: string | null; dealer_code: string | null; location: string | null
  amount: string; account_approval: string | null; ea_approval: string | null; management_approval: string | null
}

const asAppUser = (u: UserRow): AppUser => ({
  id: u.id, supabaseId: u.id, email: '', fullName: u.full_name,
  role: u.role as AppUser['role'], brand: u.brand, dealers: u.dealers,
  department: null, isActive: true,
})

async function main() {
  const users = await analyticsExecute<UserRow>(sql`
    SELECT id::text, full_name, role, brand, dealers FROM public.users
    WHERE role = 'accounts' AND is_active = true ORDER BY full_name`)

  const waiting = await analyticsExecute<ReqRow>(sql`
    SELECT request_no, brand, dealer_code, location, amount::text,
           account_approval, ea_approval, management_approval
    FROM kia_approval_requests
    WHERE COALESCE(account_approval, '') = ''
      AND UPPER(COALESCE(ea_approval, '')) = 'APPROVED'
      AND UPPER(COALESCE(management_approval, '')) = 'APPROVED'`)

  console.log(`1) ${waiting.length} requests are fully approved and waiting on Accounts\n`)

  /*
   * Every waiting request must be visible to at least one Accounts user who can act on it, and a
   * request nobody can see is money that silently stops moving.
   */
  const orphans: ReqRow[] = []
  for (const r of waiting) {
    const seers = users.filter((u) => isApprovalVisibleTo(asAppUser(u), {
      brand: r.brand, dealerCode: r.dealer_code, location: r.location,
      department: null, approvalType: null,
    } as Parameters<typeof isApprovalVisibleTo>[1]))
    if (!seers.length) orphans.push(r)
  }
  console.log(`   requests NO accounts user can see: ${orphans.length}`)
  for (const o of orphans) {
    console.log(`      ${o.request_no}  ${o.brand}  code=${o.dealer_code}  loc=${o.location}  Rs${Number(o.amount).toLocaleString('en-IN')}`)
  }
  check(orphans.length === 0, 'every request waiting on Accounts is visible to some Accounts user')

  console.log('\n2) The spelling of a branch does not change who can see it')
  /*
   * The heart of it: the same branch under each of its names must resolve identically. If KIA-JM
   * is visible to someone that JK402 is not, the synonym map has drifted from the data.
   */
  const kiaAccounts = users.filter((u) => String(u.brand || '').toLowerCase() === 'kia' && u.dealers)
  for (const u of kiaAccounts) {
    const row = (code: string, loc: string) => ({
      brand: 'kia', dealerCode: code, location: loc, department: null, approvalType: null,
    } as Parameters<typeof isApprovalVisibleTo>[1])
    const jammuForms = [['JK402', 'JAMMU'], ['KIA-JM', 'JAMMU'], ['KIA-JM', '']]
    const seen = jammuForms.map(([c, l]) => isApprovalVisibleTo(asAppUser(u), row(c, l)))
    console.log(`   ${u.full_name} (${u.dealers}): JK402=${seen[0]} KIA-JM=${seen[1]} KIA-JM/no-loc=${seen[2]}`)
    check(seen.every((v) => v === seen[0]), `${u.full_name} sees every spelling of KIA Jammu alike`)
  }

  console.log('\n3) What each Accounts user can actually SEE of the waiting queue')
  /*
   * Reported against the REAL queue rather than by inspecting pins, because a pin is not the whole
   * story: a login whose brand is 'all' has all-branch access and sees everything with no pin at
   * all, while a brand-scoped login with no pin sees nothing. Only the count is the truth.
   */
  let blind = 0
  for (const u of users) {
    const visible = waiting.filter((r) => isApprovalVisibleTo(asAppUser(u), {
      brand: r.brand, dealerCode: r.dealer_code, location: r.location,
      department: null, approvalType: null,
    } as Parameters<typeof isApprovalVisibleTo>[1]))
    const value = visible.reduce((a, r) => a + Number(r.amount), 0)
    const pin = String(u.dealers || '').trim() || 'no pin'
    if (visible.length === 0) blind++
    console.log(`   ${String(u.full_name).padEnd(22)} brand=${String(u.brand || '-').padEnd(9)} ${pin.padEnd(13)} sees ${String(visible.length).padStart(2)}/${waiting.length}  Rs${value.toLocaleString('en-IN')}${visible.length === 0 ? '  <- SEES NOTHING' : ''}`)
  }
  console.log(`\n   ${blind} of ${users.length} Accounts users see nothing — but check WHY before acting:`)
  console.log('   a brand with no waiting requests is not the same as a user who cannot see them.')

  console.log('\n4) Accounts sees its WHOLE brand — every branch, pin or no pin')
  /*
   * The rule: a brand's Accounts user sees every request of that brand regardless of branch, and
   * regardless of whether anyone remembered to pin them. Asserted against the real queue AND
   * against branch spellings nobody has invented yet, because the entire point is that a new
   * spelling can never hide an invoice from the payer again.
   */
  const byBrand = new Map<string, ReqRow[]>()
  const everything = await analyticsExecute<ReqRow>(sql`
    SELECT request_no, brand, dealer_code, location, amount::text,
           account_approval, ea_approval, management_approval
    FROM kia_approval_requests`)
  for (const r of everything) {
    const b = String(r.brand || 'kia').toLowerCase()
    byBrand.set(b, [...(byBrand.get(b) || []), r])
  }

  for (const u of users) {
    const brand = String(u.brand || '').toLowerCase()
    const own = byBrand.get(brand)
    if (!own?.length) continue // nothing filed for that brand — nothing to assert
    const seen = own.filter((r) => isApprovalVisibleTo(asAppUser(u), {
      brand: r.brand, dealerCode: r.dealer_code, location: r.location,
      department: null, approvalType: null,
    } as Parameters<typeof isApprovalVisibleTo>[1]))
    console.log(`   ${String(u.full_name).padEnd(22)} pin=${String(u.dealers || 'none').padEnd(13)} sees ${seen.length}/${own.length} of ${brand}`)
    check(seen.length === own.length, `${u.full_name} sees EVERY ${brand} request`)
  }

  // A branch spelling that does not exist yet must not hide anything.
  const kiaPayers = users.filter((u) => String(u.brand || '').toLowerCase() === 'kia')
  for (const u of kiaPayers) {
    for (const code of ['JK402', 'KIA-JM', 'BANIHAL', 'JK999', 'SOME-NEW-BRANCH', '']) {
      const ok = isApprovalVisibleTo(asAppUser(u), {
        brand: 'kia', dealerCode: code, location: '', department: null, approvalType: null,
      } as Parameters<typeof isApprovalVisibleTo>[1])
      check(ok, `${u.full_name} sees a KIA row coded "${code || '(blank)'}"`)
    }
  }

  // …and the brand boundary still holds. This is the line that must NOT move.
  for (const u of kiaPayers) {
    for (const other of ['hyundai', 'platinum', 'tata']) {
      const leak = isApprovalVisibleTo(asAppUser(u), {
        brand: other, dealerCode: 'JAMMU', location: 'JAMMU', department: null, approvalType: null,
      } as Parameters<typeof isApprovalVisibleTo>[1])
      check(!leak, `${u.full_name} still cannot see ${other} — the brand boundary holds`)
    }
  }
  /*
   * NOT a failure: fail-closed-when-unpinned is deliberate (approvals carry vendor names and
   * amounts). It is reported because an admin has to act on it in the Access Map, and because an
   * empty Approvals screen looks identical to a broken one.
   */

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
