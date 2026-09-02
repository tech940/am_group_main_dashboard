/**
 * EVERY approver can see the work that is waiting on them.
 *
 * ── The outage this exists to prevent ─────────────────────────────────────────────────────────
 * On 2026-09-02 all four active `ea` logins saw 0 of 222 requests while 23 worth Rs18,43,207 sat at
 * the EA stage. EA is a MANDATORY stage for every brand, so nothing could advance past it and the
 * whole group's approval pipeline was stalled — behind a screen that just looked empty.
 *
 * Nothing failed, nothing 403'd, no log line appeared. `isApprovalVisibleTo` fails closed on an
 * empty dealer pin, the EAs carry no pin, and unlike Accounts they had no brand-wide carve-out. The
 * file's own comment had listed "all 4 ea" as affected since the day it shipped.
 *
 * This is the test that turns that silence into a red build. It asserts the property that actually
 * matters — CAN THE PERSON WHO MUST ACT SEE THE WORK — rather than any particular rule.
 *
 * Read-only. Run: npm run verify:approver-visibility
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { analyticsExecute } from '../lib/analytics/db'
import { isApprovalVisibleTo } from '../lib/kia/approval-scope'
import { vendorPaymentActiveStage } from '../lib/md-approvals/vendor-payments-stage'
import { firstStageApproverRolesForTrack, isServiceApproval } from '../lib/approvals/first-stage-approver'
import { APPROVAL_BRANCH_SYNONYMS, approvalBranchTokens } from '../lib/kia/approval-branches'
import { parseUserDealers } from '../lib/dealers/registry'
import { hasAllBranchAccess } from '../lib/branches'
import { buildTierRoleDefaults, resolveEffectiveSnapshotForMode } from '../lib/permissions/service'
import { ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { normalizeDealers } from '../lib/admin/normalize-dealers'
import type { AppUser } from '../lib/auth/app-user'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }
const warn = (m: string) => console.log(`  [WARN] ${m}`)

/** The roles that own each stage. Anything here must be able to see its own queue. */
const STAGE_ROLES: Record<string, string[]> = {
  hr: ['hr'],
  ea: ['ea', 'eba'],
  md: ['md'],
  accounts: ['accounts', 'finance_head', 'finance_team'],
}

type U = { id: string; full_name: string; email: string; role: string; brand: string | null; dealers: string | null; department: string | null }
type R = {
  request_no: string; brand: string | null; dealer_code: string | null; location: string | null
  department: string | null; approval_type: string | null; amount: string
  vp_approval: string | null; hr_approval: string | null; ea_approval: string | null
  management_approval: string | null; account_approval: string | null
}

/*
 * The STRICT brand test — `users.brand` and nothing else.
 *
 * ⚠️ Deliberately NOT canAccessBrand, which short-circuits to true for every global-access role
 * (ea, eba, hr, ceo, ed, edp, process_coordinator). Using it here would make an honda-only EA look
 * like the owner of a queue made entirely of KIA rows, and would hide a cross-brand leak rather
 * than reveal it. That mistake was caught by measurement while fixing the outage above.
 */
function holdsBrand(u: U, rowBrand: string): boolean {
  if (hasAllBranchAccess(u.brand)) return true
  const a = String(u.brand || '').trim().toLowerCase()
  return !!a && a.split(',').map((b) => b.trim()).filter(Boolean).includes(rowBrand)
}

const asUser = (u: U): AppUser => ({
  id: u.id, supabaseId: u.id, email: u.email, fullName: u.full_name,
  role: u.role as AppUser['role'], brand: u.brand, dealers: u.dealers,
  department: u.department, isActive: true,
})
const scopeOf = (r: R) => ({
  brand: r.brand, dealerCode: r.dealer_code, location: r.location,
  department: r.department, approvalType: r.approval_type,
}) as Parameters<typeof isApprovalVisibleTo>[1]

async function main() {
  const users = await analyticsExecute<U>(sql`
    SELECT id::text, full_name, email, role::text AS role, brand, dealers, department
    FROM public.users WHERE is_active = true ORDER BY role, full_name`)
  const rows = await analyticsExecute<R>(sql`
    SELECT request_no, brand, dealer_code, location, department, approval_type, amount::text,
           vp_approval, hr_approval, ea_approval, management_approval, account_approval
    FROM kia_approval_requests`)

  const stageOf = (r: R) => vendorPaymentActiveStage({
    vpApproval: r.vp_approval, hrApproval: r.hr_approval, eaApproval: r.ea_approval,
    managementApproval: r.management_approval, accountApproval: r.account_approval,
    approvalType: r.approval_type, brand: r.brand, department: r.department,
  })
  /**
   * Does `role` own the stage this row is sitting at?
   *
   * ⚠️ KIA SERVICE AT STAGE ONE BELONGS TO THE VP, NOT THE ED.
   *
   * firstStageApproverRolesForTrack returns ['ed'] for KIA on BOTH tracks — a documented
   * simplification in that module. But isApprovalVisibleTo explicitly hides Kia Jammu Service from
   * the ED (isKiaJammuServiceApproval), and the screen excludes the ED from that stage outright.
   * Taking the helper at face value made this test report 7 live KIA-JM service requests worth
   * Rs4,03,714 as stranded when VP Parveen Rajan can see and action every one of them.
   */
  const owns = (role: string, r: R) => {
    const st = stageOf(r)
    if (st === 'sales_manager') {
      const service = isServiceApproval(r.department, r.approval_type)
      const brand = String(r.brand || 'kia').trim().toLowerCase()
      if (brand.startsWith('kia')) return service ? role === 'vp' : role === 'ed'
      return firstStageApproverRolesForTrack(r.brand, service ? 'service' : 'sales').includes(role)
    }
    return (STAGE_ROLES[st] || []).includes(role)
  }

  const ROLES = [...new Set([
    ...Object.values(STAGE_ROLES).flat(),
    // 'vp' owns KIA service at stage one — see the note on owns().
    'ed', 'vp', 'general_manager', 'service_general_manager', 'group_service_manager',
  ])].sort()

  console.log('1) EVERY waiting request is visible to somebody who can action it')
  /*
   * ⚠️ The assertion is COVERAGE, not per-person completeness.
   *
   * The first draft of this test failed any holder who saw none of their queue, and that is the
   * wrong rule: a branch-scoped General Manager pinned to one showroom legitimately sees nothing
   * when that showroom has filed nothing, while a colleague covers the same stage. Failing on that
   * teaches people to ignore a red build.
   *
   * What made the EA outage an outage is that NOBODY could see those 23 requests. So: a request is
   * a failure only when no active holder of any role owning its stage can see it. A holder with a
   * partial view is a WARN — a pin narrower than the role, which an admin widens in the Access Map.
   */
  const stranded: Array<{ r: R; stage: string }> = []
  for (const r of rows) {
    const stage = stageOf(r)
    if (stage === 'done') continue
    const ownerRoles = ROLES.filter((role) => owns(role, r))
    if (!ownerRoles.length) continue
    const canSee = users.some((u) => ownerRoles.includes(u.role)
      && holdsBrand(u, String(r.brand || 'kia').toLowerCase())
      && isApprovalVisibleTo(asUser(u), scopeOf(r)))
    if (!canSee) stranded.push({ r, stage })
  }
  for (const s of stranded.slice(0, 25)) {
    console.log(`     ${s.r.request_no.padEnd(15)} ${String(s.r.brand).padEnd(9)} ${String(s.r.dealer_code ?? '-').padEnd(10)}`
      + ` stage=${s.stage.padEnd(14)} Rs${Number(s.r.amount).toLocaleString('en-IN')}`)
  }
  if (stranded.length) {
    console.log('     ^ nobody holding the owning role can see these. Fix in Admin -> Users: widen')
    console.log('       that approver\'s branch pin to cover the branch, or grant them All Branches.')
  }
  check(stranded.length === 0,
    `no request is invisible to every one of its approvers`
    + (stranded.length ? ` — ${stranded.length} STRANDED worth Rs${stranded.reduce((a, s) => a + Number(s.r.amount), 0).toLocaleString('en-IN')}` : ''))

  console.log('\n   Per-holder coverage (a partial view is a pin to widen, not a failure):')
  for (const role of ROLES) {
    const holders = users.filter((u) => u.role === role)
    const owned = rows.filter((r) => owns(role, r))
    if (!holders.length) {
      if (owned.length) warn(`${role}: NO ACTIVE HOLDER, yet ${owned.length} request(s) wait at its stage`)
      continue
    }
    for (const h of holders) {
      const mine = owned.filter((r) => holdsBrand(h, String(r.brand || 'kia').toLowerCase()))
      if (!mine.length) continue
      const seen = mine.filter((r) => isApprovalVisibleTo(asUser(h), scopeOf(r)))
      if (seen.length === mine.length) { console.log(`     ok   ${role} ${h.full_name}: ${seen.length}/${mine.length}`); continue }
      const hiddenValue = mine.filter((r) => !isApprovalVisibleTo(asUser(h), scopeOf(r)))
        .reduce((a, r) => a + Number(r.amount), 0)
      /*
       * The ONE documented exception: KIA policy is that the ED sees every branch EXCEPT Kia Jammu
       * Service. A deliberate carve-out in isKiaJammuServiceApproval, not a scoping gap.
       */
      if (role === 'ed') {
        console.log(`     note ed ${h.full_name}: ${seen.length}/${mine.length} — the ${mine.length - seen.length} hidden are the Kia Jammu Service policy exclusion`)
        continue
      }
      warn(`${role} ${h.full_name}: ${seen.length}/${mine.length} visible, Rs${hiddenValue.toLocaleString('en-IN')} hidden`
        + `  (pin=${h.dealers || 'NONE'}, brand=${h.brand}) — widen the pin or grant All Branches in Admin`)
    }
  }

  console.log('\n2) A brand-wide role does NOT become group-wide')
  /*
   * The trap hit while fixing the outage: the brand-wide carve-out was first written to lean on
   * canAccessBrand, which passes unconditionally for global-access roles — so an honda-only EA
   * could see every KIA, Hyundai and Platinum vendor name and amount. Brand-wide must mean the
   * login's OWN brands.
   */
  for (const role of ['ea', 'eba', 'accounts', 'finance_head', 'finance_team']) {
    for (const h of users.filter((u) => u.role === role)) {
      if (hasAllBranchAccess(h.brand)) continue
      const foreign = rows.filter((r) => !holdsBrand(h, String(r.brand || 'kia').toLowerCase()))
      const leaked = foreign.filter((r) => isApprovalVisibleTo(asUser(h), scopeOf(r)))
      check(leaked.length === 0,
        `${role} ${h.full_name} (brand=${h.brand}) sees no row outside their brands`
        + (leaked.length ? ` — LEAKED ${leaked.length}, e.g. ${leaked.slice(0, 3).map((r) => `${r.request_no}/${r.brand}`).join(', ')}` : ''))
    }
  }

  console.log('\n3) Every branch spelling a live row uses is reachable by SOME pin')
  /*
   * The silent one. A row whose dealer_code is a spelling absent from APPROVAL_BRANCH_SYNONYMS can
   * be reached by no pin at all — its own branch staff cannot see their own requests, and it looks
   * exactly like "no requests". KIA-BN was live in this state with 2 rows.
   */
  const tokens = await analyticsExecute<{ brand: string; token: string; n: number }>(sql`
    SELECT coalesce(brand,'kia') AS brand, upper(trim(t)) AS token, COUNT(*)::int AS n
    FROM kia_approval_requests,
         LATERAL (VALUES (dealer_code), (location)) AS v(t)
    WHERE coalesce(trim(t),'') <> ''
    GROUP BY 1, 2 ORDER BY 1, 3 DESC`)
  for (const t of tokens) {
    const groups = APPROVAL_BRANCH_SYNONYMS[t.brand] || []
    const known = groups.some((g) => g.some((m) => m.toUpperCase() === t.token))
      || approvalBranchTokens(t.brand).includes(t.token)
    check(known, `${t.brand}/${t.token} (${t.n} row${t.n === 1 ? '' : 's'}) is a branch a pin can express`)
  }

  console.log('\n4) Every stored pin resolves to something')
  /*
   * The mirror image: a pin token that matches no branch group expands to itself and matches no
   * row, so the login looks correctly configured and sees nothing. `RS_PURA` — the token actually
   * stored on three Hyundai logins — was in this state while the map knew only 'RS PURA'/'RSPURA'.
   */
  for (const u of users) {
    const pins = String(u.dealers || '').split(',').map((v) => v.trim()).filter(Boolean)
    if (!pins.length) continue
    for (const brand of String(u.brand || '').split(',').map((b) => b.trim().toLowerCase()).filter(Boolean)) {
      if (brand === 'all') continue
      const groups = APPROVAL_BRANCH_SYNONYMS[brand] || []
      for (const pin of pins) {
        const inGroup = groups.some((g) => g.some((m) => m.toUpperCase() === pin.toUpperCase()))
        const inExtras = approvalBranchTokens(brand).includes(pin.toUpperCase())
        const inRegistry = parseUserDealers(brand, pin).length > 0
        if (!inGroup && !inExtras && !inRegistry) {
          warn(`${u.role} ${u.full_name}: pin '${pin}' means nothing under brand '${brand}' — it opens no branch`)
        }
      }
    }
  }

  console.log('\n4b) The Admin dialog can actually SAVE an approvals-only branch')
  /*
   * The Edit User dialog offers a "Banihal — approvals only (JK502)" checkbox, and the save path
   * ran the pin through parseUserDealers, which filters against the DMS registry — where JK502 does
   * not exist. So the tick was discarded on every save and the box reverted to unchecked, with no
   * error shown. An admin cannot fix a scoping problem with a control that ignores them.
   *
   * Asserted against the REAL helper the route calls, not a copy of its logic.
   */
  for (const brand of Object.keys(APPROVAL_BRANCH_SYNONYMS)) {
    for (const token of approvalBranchTokens(brand)) {
      const withOthers = normalizeDealers(brand, ['JK402', 'JK501', token]) || ''
      check(withOthers.toUpperCase().split(',').includes(token),
        `${brand}: ticking '${token}' alongside other branches is stored (got '${withOthers || 'NULL'}')`)
      // Ticking it ALONE used to normalize to NULL — and an empty pin means "sees nothing".
      const alone = normalizeDealers(brand, [token]) || ''
      check(alone.toUpperCase().split(',').includes(token),
        `${brand}: ticking '${token}' on its own is stored, not blanked to NULL (got '${alone || 'NULL'}')`)
    }
  }

  console.log('\n5) Every stage-owning role can actually REACH the Approvals section')
  /*
   * The second half of the same outage. Seeing rows is useless if the section is not reachable, and
   * these are two independent gates: lib/kia/approval-scope.ts decides WHICH ROWS, while
   * `kia.approvals.view` decides whether the sidebar shows the link and whether the page guard at
   * app/brands/kia/payment-approvals/page.tsx admits you at all.
   *
   * The global-access blanket in resolveEffectiveSnapshot ASSIGNS over every key, so for a
   * restricted-default section it overwrote `true` with `false` — revoking Approvals from ea, eba,
   * ceo, hr and even ed, whose own template grants view/approve/audit on that group.
   */
  const KEY = 'kia.approvals.view'
  const STAGE_OWNING_ROLES = ['ea', 'eba', 'ed', 'vp', 'hr', 'accounts', 'finance_head', 'md', 'general_manager', 'group_service_manager']
  for (const role of STAGE_OWNING_ROLES) {
    let base: Record<string, boolean>
    try { base = buildTierRoleDefaults(role as never) } catch { continue }
    const tpl = new Set((ROLE_PERMISSION_TEMPLATES as Record<string, string[]>)[role] || [])
    for (const k of tpl) if (k in base) base[k] = true
    const eff = resolveEffectiveSnapshotForMode(base, {}, role as never, 'kia').effective
    /*
     * general_manager is deliberately excluded: outside KIA it owns the first stage, but the
     * section grant is not in its tier or template and never was. Reported, not failed.
     */
    if (role === 'general_manager') {
      if (eff[KEY] !== true) warn(`${role} does not hold ${KEY} by default — its holders need an Access-Map tick`)
      continue
    }
    check(eff[KEY] === true, `${role} resolves ${KEY} = true without needing a per-user override`)
  }

  console.log('\n6) ...and fixing that did NOT hand them anything else')
  /*
   * The blanket is load-bearing: it is the only thing keeping user_management, access_control and
   * admin_audit away from ceo/ea/eba/hr, whose TEMPLATES list those keys. Making it additive — the
   * obvious fix — would have granted access_control.edit to an EA. So the carve-out preserves an
   * already-true value for the approvals group ONLY, and this asserts that boundary holds.
   */
  const MUST_NOT_LEAK = ['user_management.create', 'user_management.edit', 'user_management.delete',
    'access_control.view', 'access_control.edit', 'admin_audit.view', 'finance.approve']
  for (const role of ['ceo', 'ea', 'eba', 'ed', 'hr', 'edp', 'process_coordinator']) {
    let base: Record<string, boolean>
    try { base = buildTierRoleDefaults(role as never) } catch { continue }
    const tpl = new Set((ROLE_PERMISSION_TEMPLATES as Record<string, string[]>)[role] || [])
    for (const k of tpl) if (k in base) base[k] = true
    const eff = resolveEffectiveSnapshotForMode(base, {}, role as never, 'kia').effective
    const leaked = MUST_NOT_LEAK.filter((k) => eff[k] === true)
    check(leaked.length === 0, `${role} gains no administrative key from the approvals carve-out`
      + (leaked.length ? ` — LEAKED ${leaked.join(', ')}` : ''))
  }

  console.log('\n7) No approvals endpoint gates on the KIA BRAND')
  /*
   * The section is multi-brand — Hyundai, Platinum and MG all submit into it — and only the
   * permission key is still spelled `kia.*`, for historical reasons that cannot be undone without
   * killing every existing grant.
   *
   * export-tally called `requireBrandApiAccess('kia')`, so every non-KIA login 403'd: Hyundai and
   * Platinum Accounts could see their MD-approved vouchers on screen and export none of them. Row
   * scoping is `filterVisibleApprovals`'s job, not the URL's brand.
   */
  const API_DIR = join(process.cwd(), 'app/api/brands/kia/approvals')
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : []))
  for (const file of walk(API_DIR)) {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, '/')
    check(!/requireBrandApiAccess\(\s*['"]kia['"]\s*\)/.test(src),
      `${rel} does not hard-gate on the KIA brand`)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
