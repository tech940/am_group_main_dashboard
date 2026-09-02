/**
 * Proves a submitter is told when a decision lands on their payment request.
 *
 *   npm run verify:approval-emails
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * REJECT and HOLD set `emailSendStatus = 'Rejected' | 'Held'` — a column whose name promises a
 * message — and for a long time sent nothing at all. The fix was then applied to `bulk-action`
 * ONLY, so rejecting fifty requests from the toolbar notified fifty people while rejecting ONE from
 * its row button stayed silent. Separately, the MD approval email had no remarks field, so 69 live
 * orders carry an MD note the requester never received.
 *
 * Both defects are "one of the two routes was updated". A unit test of the email body would not
 * have caught either, so this asserts the WIRING across both routes as well as the pure logic.
 *
 * ⚠️ It never calls a send function. `sendEmail` is real SMTP and a "mock" script in this repo has
 * already mailed three real people — see the email-verification-hazard note. Only the pure label
 * resolver is executed; everything else is checked against the route SOURCE.
 */
import fs from 'fs'
import path from 'path'
import { stageLabelFor } from '../lib/approvals/decision-emails'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures += 1; console.log(`  [FAIL] ${m}`) }
const check = (cond: boolean, m: string) => (cond ? ok(m) : fail(m))

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')
const SINGLE = 'app/api/brands/kia/approvals/[id]/action/route.ts'
const BULK = 'app/api/brands/kia/approvals/bulk-action/route.ts'
const MD_EMAIL = 'lib/email/md-approval-email.ts'
const REMARK = 'app/api/brands/kia/approvals/[id]/remark/route.ts'

console.log('\n1) The stage label names the desk that actually acted')
{
  const at = (brand: string | null, stage: string) =>
    stageLabelFor({ id: 'x', name: null, email: null, amount: null, vendorName: null, brand }, stage)

  check(at('kia', 'sales_manager') === 'ED', "KIA's first stage reads 'ED'")
  /*
   * ⚠️ This was hardcoded to 'VP'. A Hyundai submitter would have been told a VP decided their
   * request — a role their brand has nobody in, and the same KIA-only assumption already removed
   * from the routes and the approvals screen.
   */
  for (const brand of ['hyundai', 'platinum', 'tata', 'mg', 'honda']) {
    check(at(brand, 'sales_manager') === 'GSM', `${brand}'s first stage reads 'GSM', not 'VP'`)
  }
  check(at(null, 'sales_manager') === 'GSM', 'a missing brand still does not claim ED or VP')
  check(at('kia', 'md') === 'MD', "'md' reads 'MD'")
  check(at('kia', 'accounts') === 'Accounts', "'accounts' reads 'Accounts'")
  check(at('kia', 'ea') === 'EA', "'ea' reads 'EA'")
  check(at('kia', 'payment_done') === 'Payment', "'payment_done' reads 'Payment'")
  check(at('kia', 'made_up_stage') === 'MADE_UP_STAGE', 'an unknown stage falls back rather than throwing')
}

console.log('\n2) BOTH routes email the submitter on REJECT and HOLD')
{
  for (const [label, file] of [['single-action', SINGLE], ['bulk-action', BULK]] as const) {
    const src = read(file)
    check(src.includes("from '@/lib/approvals/decision-emails'"),
      `${label} imports the shared decision emails`)
    check(src.includes('sendApprovalDecisionEmail('),
      `${label} actually calls sendApprovalDecisionEmail`)
    /*
     * The exact shape of the old bug: the status column set, no send. If a route ever writes
     * 'Rejected' again without a decision email anywhere in it, that is the regression.
     */
    const setsRejected = src.includes("'Rejected'")
    check(!setsRejected || src.includes('sendApprovalDecisionEmail('),
      `${label} never marks a request Rejected without a message leaving`)

    /*
     * ⚠️ THE CHECKS ABOVE ARE WHOLE-FILE SUBSTRING TESTS, AND THAT IS NOT ENOUGH.
     *
     * bulk-action passed all of them while covering only 3 of its 5 stages: the call was wired into
     * the `md` and `accounts` branches and nowhere else, so REJECT and HOLD at the FIRST stage and
     * at `ea` set the column and sent nothing. It also passed the "never marks Rejected without a
     * message" guard, because the first-stage branch does not set emailSendStatus either — silent
     * in both dimensions reads as clean to a heuristic.
     *
     * That mattered most to the Group Service Manager: the first stage is the ONLY stage he can act
     * on, so bulk-rejecting Hyundai/Platinum service requests notified nobody, while rejecting the
     * same rows one at a time from their row buttons emailed every submitter.
     *
     * So assert the SHAPE that makes per-stage coverage impossible to get wrong: the send must sit
     * in its own `action === 'REJECT' || action === 'HOLD'` block, OUTSIDE any stage branch, the way
     * the single-row route has always done it.
     */
    const lines = src.split('\n')
    /*
     * There is more than one `action === 'REJECT' || action === 'HOLD'` guard: the md and accounts
     * branches still use one to set `emailSendStatus`. So find the guard that actually SENDS rather
     * than the first one, or this check reports on the wrong block.
     *
     * Indentation differs between the two routes (bulk's sits inside its per-row `for`), so the
     * send is located within the guard rather than by pinning a column.
     */
    const guardAt = lines.reduce((found, l, i) => {
      if (found >= 0) return found
      if (!/if \(action === 'REJECT' \|\| action === 'HOLD'\)/.test(l)) return found
      return lines.slice(i, i + 12).some((n) => n.includes('sendApprovalDecisionEmail(')) ? i : found
    }, -1)
    check(guardAt >= 0,
      `${label} sends the decision email from ONE hoisted block, not per-stage`)

    /*
     * And that block must be at the OUTER level, not tucked inside a stage branch — which is
     * precisely where bulk's copies lived. The stage branches all test `activeStageKey`, so the
     * guard sitting at a shallower indent than the nearest preceding stage test proves it is not
     * inside one.
     */
    if (guardAt >= 0) {
      const indentOf = (l: string) => l.length - l.trimStart().length
      const lastStageTest = lines.slice(0, guardAt).map((l, i) => ({ l, i }))
        .filter(({ l }) => /activeStageKey === '/.test(l)).pop()
      check(!lastStageTest || indentOf(lines[guardAt]) <= indentOf(lastStageTest.l),
        `${label}'s decision email is outside every stage branch`)
    }

    // Belt and braces: no stage branch may keep a private copy, or the hoisted block is dead weight
    // and the two can drift apart again.
    const sendCount = (src.match(/sendApprovalDecisionEmail\(/g) || []).length
    check(sendCount <= 2,
      `${label} has at most two send sites — the hoisted REJECT/HOLD one and SEND_BACK (found ${sendCount})`)
  }
}

console.log('\n3) The MD approval email carries the MD’s own remark')
{
  const md = read(MD_EMAIL)
  check(/remarks\?: string \| null/.test(md), 'the params accept `remarks`')
  check(md.includes('Remarks from the MD:'), 'the body renders a remarks block')
  check(md.includes('escapeHtml(remarks)'), 'the remark is HTML-escaped, not interpolated raw')
  /*
   * `purpose` is the REQUEST's text and `remarks` is the MD's note. They are different fields and
   * both must reach the template — passing only `purpose` is precisely how the note went missing.
   */
  for (const [label, file] of [['single-action', SINGLE], ['bulk-action', BULK]] as const) {
    const src = read(file)
    const call = src.slice(src.indexOf('sendMdApprovalNotificationEmail({'))
    const block = call.slice(0, call.indexOf('})') + 2)
    check(/remarks:\s*remarks/.test(block), `${label} passes the MD's remarks into the approval email`)
    check(/purpose:\s*(requestRow|row)\.remarks/.test(block), `${label} still passes the request's own purpose`)
  }
}

console.log('\n4) A remark with NO decision still reaches the submitter')
{
  /*
   * ⚠️ The MD can leave a remark WITHOUT approving, rejecting or holding — a separate endpoint that
   * writes history action 'REMARK_ADD'. That is the case behind "3 Quotes?" on KIA_0123: the request
   * sits at Pending MD and the only thing that moved was a question the submitter must answer. None
   * of the three decision emails describes that state, so it has its own template.
   */
  const src = read(REMARK)
  const emails = read('lib/approvals/decision-emails.ts')
  check(emails.includes('export function sendMdRemarkEmail('),
    'the remark email is a SHARED template, not inline in the route')
  check(src.includes("from '@/lib/approvals/decision-emails'") && src.includes('sendMdRemarkEmail('),
    'the remark route uses that shared template')
  check(!src.includes('sendEmail('),
    'the remark route no longer builds its own message inline')
  check(src.includes("['md', 'ceo'].includes(appUser.role)"),
    'only MD/CEO remarks notify the submitter — other stages are internal notes')
  const block = emails.slice(emails.indexOf('export function sendMdRemarkEmail('))
  check(block.includes('escapeHtml(ctx.remarks)'), 'the remark is HTML-escaped')
  check(block.includes('has not been rejected'),
    'the email says the request is still in the flow, so a question does not read as a refusal')
}

console.log('\n5) Send-back keeps its own path (it needs the signed re-submit link)')
{
  const src = read(SINGLE)
  check(src.includes('createResubmitToken('), 'the send-back email still mints a re-submit token')
  check(/action === 'REJECT' \|\| action === 'HOLD'/.test(src),
    'the decision email fires on REJECT/HOLD only, leaving SEND_BACK to its own branch')
}

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
process.exit(failures === 0 ? 0 : 1)
