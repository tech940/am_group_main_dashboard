/**
 * The customer must never hold a KIA proforma that Finance has not approved.
 *
 * ── The bug this guards ───────────────────────────────────────────────────────────────────────
 * The chain is two sequential stages: Sales Manager / GM, then Finance Head / Finance Team. Only
 * the second finalises. That machine was always correct — but a THIRD path bypassed it entirely:
 * the General Manager's `edit` action reset approvalStatus to 'PENDING' and then mailed the revised
 * PDF to the customer on the way out of the handler.
 *
 * Measured on live data before the fix: all 7 revised proformas ever sent went out at the exact
 * second of the edit, with no approval of any kind behind them. One (KIA_JK402_2026_120203) was
 * never approved at all. One booking's customer received three different proformas in six minutes.
 *
 * ── Why a SOURCE check, not only a data check ─────────────────────────────────────────────────
 * A data check can only catch this after a real customer has been mailed an unapproved quotation —
 * the damage is the detection. So the primary assertion is static: the send helper may be CALLED
 * from exactly one place, and that place must be inside the finalised-approval branch. Re-adding a
 * second call site fails this immediately, at no cost to a customer.
 *
 * Read-only. Run: npm run verify:proforma-gate
 */
import 'dotenv/config'
import fs from 'fs'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaProformas } from '../lib/db/schema'
import { buildKiaProformaPdf } from '../lib/kia-proforma/invoice'
import {
  kiaApprovalStage, pendingStageOf, roleActsOnKiaStage, nextApprovalStatusAfterApprove,
  kiaStageActorLabel,
} from '../lib/kia-proforma/approval'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

const ROUTE = 'app/api/brands/kia/proforma/[id]/route.ts'

function sourceGate() {
  console.log('1) The send helper is called from exactly one place, behind final approval')
  const src = fs.readFileSync(ROUTE, 'utf8')

  // Calls only — not the declaration, and not mentions inside comments.
  const lines = src.split(/\r?\n/)
  const callSites: { line: number; text: string }[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line.startsWith('*') || line.startsWith('//')) return
    if (line.includes('const emailCustomerProforma')) return
    if (/emailCustomerProforma\s*\(/.test(line)) callSites.push({ line: i + 1, text: line })
  })

  console.log(`   call sites: ${callSites.length}`)
  for (const c of callSites) console.log(`      ${ROUTE}:${c.line}  ${c.text}`)
  check(callSites.length === 1, 'there is exactly ONE call site (a second one is how the bug returns)')

  if (callSites.length === 1) {
    // Walk back to the nearest enclosing `if (` and require it to be the finalised flag.
    const idx = callSites[0].line - 1
    let guard = ''
    for (let i = idx; i >= 0 && i > idx - 12; i--) {
      const m = lines[i].match(/if\s*\((.+?)\)\s*\{/)
      if (m) { guard = m[1].trim(); break }
    }
    console.log(`   nearest enclosing guard: if (${guard || '???'})`)
    check(guard === 'isApproved', 'the send is guarded by isApproved, which only stage 2 sets')
  }

  // isApproved must itself remain reachable only from the finalised branch.
  const assigns = lines.filter((l) => /(?<!let\s)\bisApproved\s*=\s*true/.test(l)).length
  console.log(`   assignments of isApproved = true: ${assigns}`)
  check(assigns === 1, 'isApproved is set in exactly one place (inside next.finalized)')

  // And the edit path must not mail anyone.
  const editBlock = src.slice(src.indexOf("approvalStageActed = 'edit'"))
  const editMails = /emailCustomerProforma\s*\(\s*'updated'\s*\)/.test(editBlock.slice(0, 400))
  check(!editMails, 'the GM edit path does not mail the customer')
}

async function dataGate() {
  console.log('\n2) No customer has been mailed a proforma ahead of its finance approval')

  /*
   * Finance approval is recorded as a 'Proforma Approved' activity on the linked booking. Any
   * customer mail carrying a proforma must not predate it. Rows with no linked booking are legacy
   * imports with no activity trail at all and are reported separately rather than silently passed.
   */
  /*
   * ⚠️ Compare against the finance approval IMMEDIATELY PRECEDING the send, never against MAX().
   * A proforma can legitimately be approved, then revised by the GM, then approved again — using
   * the latest approval flags that first, entirely correct, mail as premature. That false positive
   * reported 9 where the truth is 7.
   *
   * The two-second grace absorbs the ordering inside a single request: the mail is dispatched a
   * beat after the approval activity is written, and on three live rows the send timestamp actually
   * precedes the activity row by one second.
   */
  const rows = await analyticsExecute<{
    booking_number: string; email_type: string; sent: string; approved_before: string | null
  }>(sql`
    SELECT b.booking_number,
           el.email_type,
           el.created_at::timestamp(0)::text AS sent,
           (SELECT MAX(a.created_at) FROM kia_booking_activity a
              WHERE a.booking_id = el.booking_id
                AND a.activity_type = 'proforma'
                AND a.title ILIKE '%Proforma Approved%'
                AND a.created_at <= el.created_at + INTERVAL '2 seconds')::timestamp(0)::text AS approved_before
    FROM kia_email_logs el
    JOIN kia_bookings b ON b.id = el.booking_id
    WHERE el.email_type IN ('approved_proforma', 'updated_proforma')
      AND el.status = 'sent'
    ORDER BY el.created_at DESC`)

  const early = rows.filter((r) => !r.approved_before)
    .map((r) => ({ ...r, finance_approved: r.approved_before }))
  console.log(`   proforma mails with a linked booking: ${rows.length}, sent with NO prior finance approval: ${early.length}`)
  for (const e of early.slice(0, 10)) {
    console.log(`      ${e.booking_number}  ${e.email_type}  sent ${e.sent}  (no approval at or before this)`)
  }

  /*
   * ⚠️ HISTORICAL count, not a live signal. The pre-fix sends stay in kia_email_logs forever, so the
   * assertion is that the number does not GROW. Three revisions were mailed with no approval of any
   * kind ever preceding them; the other four pre-fix sends had an earlier approval on the same
   * proforma, so they do not count here even though they too were premature at the time.
   *
   * Raise this only after accounting for every new row — a bump is how the bug comes back quietly.
   */
  const BASELINE = 3
  check(early.length <= BASELINE,
    `no NEW premature send (${early.length} historical, baseline ${BASELINE} — a rise means the gate broke)`)

  // Never approved at ANY point — the customer is holding a document nobody signed off.
  const everApproved = new Set(rows.filter((r) => r.approved_before).map((r) => r.booking_number))
  const stillPending = early.filter((e) => !everApproved.has(e.booking_number))
  if (stillPending.length) {
    console.log(`   ⚠️ ${stillPending.length} customer(s) hold a proforma that was never approved:`)
    for (const p of stillPending) console.log(`      ${p.booking_number} — needs to be put through the chain or re-issued`)
  }
}

/**
 * A GM edit must RE-ENTER the chain and terminate at Finance.
 *
 * The edit rewrites every money field — ex-showroom, cash / additional / govt discount, exchange
 * value, grand total — so it is not a cosmetic change: a GM could raise a discount after the
 * proforma was signed off. That is why the reset goes back to stage 1 (whose whole job is the
 * discount checklist) and not straight to Finance. Finance is still the terminal gate, so the
 * customer is mailed exactly once, by Finance, whatever route the proforma took to get there.
 */
function chainRouting() {
  console.log('\n3) A GM edit re-enters the chain and can only finish at Finance')

  // What the edit path writes.
  const AFTER_EDIT = 'PENDING'
  const s1 = pendingStageOf(AFTER_EDIT)
  console.log(`   after edit -> "${AFTER_EDIT}", awaiting: ${s1}`)
  check(s1 === 'approval', 'an edited proforma goes back to stage 1, not straight to approved')

  const afterStage1 = nextApprovalStatusAfterApprove(s1)
  console.log(`   stage 1 approve -> "${afterStage1.status}", finalized=${afterStage1.finalized}`)
  check(afterStage1.finalized === false, 'stage 1 does NOT finalise, so it cannot mail the customer')

  const s2 = pendingStageOf(afterStage1.status)
  const afterStage2 = nextApprovalStatusAfterApprove(s2)
  console.log(`   stage 2 (${s2}) approve -> "${afterStage2.status}", finalized=${afterStage2.finalized}`)
  check(s2 === 'finance', 'the next gate after stage 1 is Finance')
  check(afterStage2.finalized === true, 'only Finance finalises')

  // Nobody outside Finance may reach the finalising stage.
  const SALES_ROLES = ['sales_executive', 'sales_manager', 'general_manager']
  for (const r of SALES_ROLES) {
    check(!roleActsOnKiaStage(r, 'finance'), `${r} cannot act at the Finance stage (so cannot mail the customer)`)
  }
  for (const r of ['finance_head', 'finance_team']) {
    check(roleActsOnKiaStage(r, 'finance'), `${r} can act at the Finance stage`)
  }
  // …and Finance must not be able to wave it through stage 1 on its own either.
  for (const r of ['finance_head', 'finance_team']) {
    check(!roleActsOnKiaStage(r, 'approval'), `${r} cannot act at stage 1 (the two gates stay distinct)`)
  }
}

/**
 * An unapproved proforma must LOOK unapproved.
 *
 * The email gate is not the only way a proforma reaches a customer — a staff member can forward one.
 * /api/brands/kia/proforma/[id]/preview rendered the identical document at every stage: a PENDING
 * proforma came out byte-for-byte the same as the Finance-signed copy, and the Bookings screen links
 * to it from a control commented "Direct Download Button (Always Visible)".
 *
 * ⚠️ The route is deliberately NOT gated on approval — the approvers must read the document in order
 * to approve it. The document tells the truth about itself instead. This mirrors the route's render
 * expression; if the two drift, the marking silently stops and this check is what notices.
 */
async function draftsAreMarked() {
  console.log('\n4) An unapproved proforma renders visibly marked')

  const render = (row: typeof kiaProformas.$inferSelect) => {
    const stage = kiaApprovalStage(row.approvalStatus)
    if (stage === 'approved') return Buffer.from(buildKiaProformaPdf(row))
    const awaiting = kiaStageActorLabel(pendingStageOf(row.approvalStatus))
    return Buffer.from(buildKiaProformaPdf({
      ...row,
      documentTitle: stage === 'declined'
        ? 'PROFORMA INVOICE — NOT APPROVED'
        : 'PROFORMA INVOICE — DRAFT, NOT APPROVED',
      disclaimerLines: [
        'NOT APPROVED. Internal review copy — not valid for the customer or for bank purposes.',
        awaiting ? `Awaiting ${awaiting} approval.` : 'This proforma was declined and must be revised.',
        'The approved copy is emailed to the customer by Finance once the chain completes.',
      ],
    }))
  }
  const has = (b: Buffer, needle: string) => b.toString('latin1').includes(needle)

  for (const status of ['PENDING', 'MANAGER_APPROVED', 'APPROVED']) {
    const [row] = await db.select().from(kiaProformas)
      .where(and(eq(kiaProformas.approvalStatus, status), isNull(kiaProformas.deletedAt))).limit(1)
    if (!row) { console.log(`   ${status}: no row available to test`); continue }
    const marked = has(render(row), 'NOT APPROVED')
    console.log(`   ${status.padEnd(17)} -> marked NOT APPROVED: ${marked}`)
    if (status === 'APPROVED') check(!marked, 'the Finance-approved copy carries NO draft marking')
    else check(marked, `a ${status} proforma renders marked NOT APPROVED`)
  }

  // The route must still be building the marked version — catch a silent revert.
  const src = fs.readFileSync('app/api/brands/kia/proforma/[id]/preview/route.ts', 'utf8')
  check(src.includes('documentTitle'), 'the preview route still supplies documentTitle')
  check(src.includes('disclaimerLines'), 'the preview route still supplies disclaimerLines')
  check(/kiaApprovalStage\s*\(\s*row\.approvalStatus\s*\)/.test(src),
    'the preview route branches on the row approval status')
}

/**
 * The Bookings list must not offer the PDF until Finance approves.
 *
 * Both download controls rendered on `row.proformaNumber` alone — one of them literally commented
 * "Direct Download Button (Always Visible)" — so the moment a proforma existed anyone on that screen
 * could pull a complete PROFORMA INVOICE and forward it. Measured: shown on all 103 bookings with a
 * proforma; only 96 of those are approved.
 *
 * ⚠️ Hiding it does NOT stall the chain: the approvers review the record in ProformaPreviewDrawer on
 * the Proforma page, which never touches this route.
 */
function bookingsDownloadGate() {
  console.log('\n5) The Bookings list hides the proforma download until Finance approves')
  const src = fs.readFileSync('app/brands/kia/bookings/kia-bookings-client.tsx', 'utf8')
  const lines = src.split(/\r?\n/)

  const hrefLines = lines
    .map((l, i) => ({ i, l }))
    .filter(({ l }) => /\/api\/brands\/kia\/proforma\/.+\/preview/.test(l))
  console.log(`   links to the proforma PDF route: ${hrefLines.length}`)
  check(hrefLines.length > 0, 'the download links are still present for approved proformas')

  for (const { i } of hrefLines) {
    // The guard must sit within the few lines that open this element.
    const ctx = lines.slice(Math.max(0, i - 12), i).join('\n')
    const gated = /proformaApprovalStatus[^\n]*APPROVED/.test(ctx)
    console.log(`      line ${i + 1}: gated on APPROVED = ${gated}`)
    check(gated, `the download link at line ${i + 1} is gated on the proforma being APPROVED`)
  }

  check(!/Always Visible/.test(src), 'no download control is still marked "Always Visible"')
}

async function main() {
  sourceGate()
  chainRouting()
  await draftsAreMarked()
  bookingsDownloadGate()
  previewRouteGate()
  await dataGate()
  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}


const PREVIEW_ROUTE = 'app/api/brands/kia/proforma/[id]/preview/route.ts'

/**
 * THE PDF ROUTE MUST REFUSE, not merely watermark.
 *
 * Reported from the office: consultants were still downloading unapproved proformas even though the
 * Bookings screen hides the button. Hiding a button does not close a URL — this route served the
 * document to anyone who could reach it, and a watermarked draft is still a complete PROFORMA
 * INVOICE carrying the customer's name and every figure. It forwards to a customer exactly as well
 * as the approved one.
 *
 * ⚠️ A SOURCE check on purpose. A data check could only notice after a customer already held an
 * unapproved invoice — the detection IS the damage. Re-opening the route fails this instantly and
 * costs nobody anything.
 */
function previewRouteGate() {
  console.log('\n3b) The PDF route itself refuses an unapproved proforma')
  const route = fs.readFileSync(PREVIEW_ROUTE, 'utf8')

  const gateRe = /if\s*\(\s*!isFullyApproved\s*&&\s*!isApprover\s*\)/
  check(gateRe.test(route), 'the route 403s when not fully approved and the caller cannot approve it')

  /*
   * The refusal must come BEFORE the render. A check placed after buildKiaProformaPdf would still
   * do the work, and one careless edit later would still return it.
   */
  const gateAt = route.search(gateRe)
  const buildAt = route.indexOf('buildKiaProformaPdf(')
  check(gateAt > -1 && buildAt > -1 && gateAt < buildAt, 'the refusal happens BEFORE the PDF is rendered')

  // The approvers keep access, or the gate stalls the very chain it protects.
  check(/!isApprover/.test(route), 'an approver can still fetch it, so review is not blocked')

  // Defence in depth: a draft an approver does fetch still announces itself.
  check(/DRAFT, NOT APPROVED/.test(route), 'a draft an approver fetches is still marked NOT APPROVED')
}

main().catch((e) => { console.error(e); process.exit(1) })
