/**
 * A sent-back request can be RE-SUBMITTED — on every brand, not just KIA.
 *
 * ── The bug this guards ───────────────────────────────────────────────────────────────────────
 * The send-back email links back to the submit form, and the form posts to
 * `/api/brands/{brand}/approvals`. KIA has a static route that handled the signed token; every
 * other brand falls through to the dynamic `[brand]` route, which had no token branch at all. So a
 * Hyundai or Platinum re-submission silently became a SECOND request:
 *
 *   HYUNDAI_0019  Rs1,41,507  sent back 31 Aug 07:49  — still parked at SentBack
 *   HYUNDAI_0022  Rs1,41,507  created  31 Aug 10:35  — same submitter, same vendor, went to the EA
 *
 * Nothing failed. Both rows look correct in isolation, and the duplicate is only visible if you
 * compare submitter + amount across rows. That is why this test asserts ROUTE PARITY structurally:
 * the defect was a missing branch in one of two parallel routes, and no behavioural test of the
 * KIA route could ever have seen it.
 *
 * ⚠️ READ-ONLY. The refusal paths are exercised against live rows because none of them reach the
 * UPDATE; the happy path is deliberately NOT exercised, since doing so would reset a real
 * approval chain.
 *
 * Run: npm run verify:approval-resubmit
 */
import 'dotenv/config'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { analyticsExecute } from '../lib/analytics/db'
import { createResubmitToken, verifyResubmitToken } from '../lib/kia/approval-resubmit'
import { handleApprovalResubmit } from '../lib/approvals/resubmit'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

const BASE = join(process.cwd(), 'app/api/brands')

async function main() {
  console.log('1) EVERY brand-facing approvals route handles the re-submit token')
  /*
   * The assertion that would have caught the original bug. Both the static `kia` route and the
   * dynamic `[brand]` route accept the public form's POST; whichever one a submitter lands on must
   * update the original request rather than create a new one.
   */
  const routes = readdirSync(BASE, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ seg: d.name, file: join(BASE, d.name, 'approvals/route.ts') }))
    .filter((r) => existsSync(r.file))

  check(routes.length >= 2, `found ${routes.length} approvals intake route(s): ${routes.map((r) => r.seg).join(', ')}`)
  for (const r of routes) {
    const src = readFileSync(r.file, 'utf8')
    const hasPost = /export\s+async\s+function\s+POST/.test(src)
    if (!hasPost) { console.log(`   ${r.seg}: no POST handler, skipped`); continue }
    check(src.includes('handleApprovalResubmit'),
      `app/api/brands/${r.seg}/approvals/route.ts calls the shared re-submit handler`)
    // A second inline copy is how the two drifted apart in the first place.
    check(!src.includes('verifyResubmitToken'),
      `app/api/brands/${r.seg}/approvals/route.ts has no second, inline copy of the token check`)
  }

  console.log('\n2) The token is the credential, and it holds')
  const id = '11111111-2222-3333-4444-555555555555'
  const good = createResubmitToken(id)
  const v = verifyResubmitToken(good)
  check(v.ok && v.requestId === id, 'a freshly issued token verifies and carries its request id')
  check(verifyResubmitToken(`${good}x`).ok === false, 'a tampered signature is refused')
  check(verifyResubmitToken('not-a-token').ok === false, 'garbage is refused')
  const stale = createResubmitToken(id, Date.now() - 31 * 24 * 60 * 60 * 1000)
  const sv = verifyResubmitToken(stale)
  check(!sv.ok && sv.reason === 'expired', 'a 31-day-old link is expired, so a forwarded email cannot be replayed')

  console.log('\n3) The handler refuses everything it should — against LIVE rows')
  check(await handleApprovalResubmit({
    body: {}, routeBrand: 'hyundai', normalizedBillUrls: [], mirrorBill1: null, mirrorBill2: null, finalGlAccountId: null,
  }) === null, 'no token means "ordinary new submission" — the caller carries on to its INSERT')

  const bad = await handleApprovalResubmit({
    body: { resubmitToken: 'v1.x.y.z' }, routeBrand: 'hyundai',
    normalizedBillUrls: [], mirrorBill1: null, mirrorBill2: null, finalGlAccountId: null,
  })
  check(bad?.status === 400, 'a malformed token is refused with 400')

  const [sentBack] = await analyticsExecute<{ id: string; request_no: string; brand: string }>(sql`
    SELECT id::text, request_no, brand FROM kia_approval_requests
    WHERE email_send_status = 'SentBack' AND lower(coalesce(brand,'')) NOT LIKE 'kia%'
    ORDER BY created_at LIMIT 1`)
  const [live] = await analyticsExecute<{ id: string; request_no: string; brand: string }>(sql`
    SELECT id::text, request_no, brand FROM kia_approval_requests
    WHERE email_send_status <> 'SentBack' AND lower(coalesce(brand,'')) NOT LIKE 'kia%'
    ORDER BY created_at DESC LIMIT 1`)

  if (sentBack) {
    /*
     * Brand mismatch is checked BEFORE the SentBack check and long before the UPDATE, so pointing a
     * real Hyundai token at the KIA route is safe to run and proves the guard is reachable.
     */
    const crossed = await handleApprovalResubmit({
      body: { resubmitToken: createResubmitToken(sentBack.id) }, routeBrand: 'kia',
      normalizedBillUrls: [], mirrorBill1: null, mirrorBill2: null, finalGlAccountId: null,
    })
    check(crossed?.status === 400, `a ${sentBack.brand} token offered to the KIA route is refused (${sentBack.request_no})`)
  } else {
    console.log('   (no non-KIA row is currently SentBack — the cross-brand guard was not exercised)')
  }

  if (live) {
    // A row nobody sent back must not be resettable — this is the guard that stops a stale link
    // wiping an approval chain that has since moved on.
    const notSentBack = await handleApprovalResubmit({
      body: { resubmitToken: createResubmitToken(live.id) }, routeBrand: live.brand,
      normalizedBillUrls: [], mirrorBill1: null, mirrorBill2: null, finalGlAccountId: null,
    })
    check(notSentBack?.status === 409, `a link for a request that is NOT sent back is refused (${live.request_no})`)
  }

  console.log('\n4) The damage signature: a sent-back request with a later twin')
  /*
   * What the missing branch actually produced. A re-submission that lands as a new row leaves the
   * original at SentBack for ever AND creates a second claim on the same money. Reported rather
   * than failed for rows that predate the fix — they are history, and clearing them is the
   * business's call, not this script's.
   *
   * ⚠️ Tightened deliberately. A bare (email, amount) match is far too loose: one KIA submitter
   * files Rs640 repeatedly, and a naive query paired every one of those with every other and called
   * them duplicates. So a twin must ALSO name the same vendor, or land within 24h of the send-back,
   * and the original must carry no RESUBMITTED entry — because a row that WAS re-submitted in place
   * proves the twin is unrelated work.
   */
  const dupes = await analyticsExecute<{
    orig: string; dupe: string; brand: string; amount: string; email: string
    vendor: string | null; orig_at: string; dupe_at: string; reason: string | null
  }>(sql`
    SELECT a.request_no AS orig, b.request_no AS dupe, a.brand, a.amount::text, a.email,
           a.vendor_name AS vendor, a.created_at::text AS orig_at, b.created_at::text AS dupe_at,
           a.send_back_reason AS reason
    FROM kia_approval_requests a
    JOIN kia_approval_requests b
      ON b.id <> a.id
     AND lower(b.email) = lower(a.email)
     AND b.amount = a.amount
     AND coalesce(b.brand,'') = coalesce(a.brand,'')
     AND b.created_at > a.created_at
     AND (
           (coalesce(a.vendor_name,'') <> '' AND lower(b.vendor_name) = lower(a.vendor_name))
        OR b.created_at < a.created_at + interval '24 hours'
     )
    WHERE a.email_send_status = 'SentBack'
      AND NOT (a.history @> '[{"action":"RESUBMITTED"}]'::jsonb)
    ORDER BY a.created_at`)
  if (!dupes.length) console.log('   none')
  for (const d of dupes) {
    console.log(`   ${d.brand}  Rs${Number(d.amount).toLocaleString('en-IN')}  ${d.vendor ?? '-'}  ${d.email}`)
    console.log(`      ${d.orig} sent back ${d.orig_at.slice(0, 16)} — ${JSON.stringify(d.reason)}`)
    console.log(`      ${d.dupe} created   ${d.dupe_at.slice(0, 16)}  <-- the re-submission that should have UPDATED ${d.orig}`)
  }
  const covered = dupes.filter((d) => !String(d.brand).toLowerCase().startsWith('kia')).length
  console.log(`   ${dupes.length} likely duplicate(s); ${covered} on the brands this fix covers, ${dupes.length - covered} on KIA.`)
  /*
   * KIA appearing here is NOT the same defect — its route always had the handler, and three KIA rows
   * carry a RESUBMITTED entry proving that path works. A KIA twin means the submitter ignored the
   * emailed link and filed a fresh request from the form instead. Worth knowing, because the fix
   * only helps people who actually click the link.
   */
  const viaLink = await analyticsExecute<{ brand: string; n: number }>(sql`
    SELECT coalesce(brand,'(blank)') AS brand, COUNT(*)::int AS n FROM kia_approval_requests
    WHERE history @> '[{"action":"RESUBMITTED"}]'::jsonb GROUP BY 1 ORDER BY 2 DESC`)
  console.log(`   Re-submitted IN PLACE (the link was used): ${viaLink.map((v) => `${v.brand}=${v.n}`).join(', ') || 'none'}`)

  console.log('\n5) Non-KIA rows stranded at SentBack')
  const stranded = await analyticsExecute<{ request_no: string; brand: string; amount: string; days: number; reason: string | null }>(sql`
    SELECT request_no, brand, amount::text,
           EXTRACT(day FROM now() - created_at)::int AS days, send_back_reason AS reason
    FROM kia_approval_requests
    WHERE email_send_status = 'SentBack' AND lower(coalesce(brand,'')) NOT LIKE 'kia%'
    ORDER BY created_at`)
  for (const s of stranded) {
    // The signed link lives 30 days. Past that the submitter cannot re-submit even with the fix in
    // place, and an approver has to send the request back again to issue a fresh link.
    const linkAlive = s.days < 30
    console.log(`   ${s.request_no.padEnd(15)} ${s.brand.padEnd(9)} Rs${Number(s.amount).toLocaleString('en-IN').padStart(11)}  ${s.days}d old  link ${linkAlive ? 'still valid' : 'EXPIRED — send it back again to issue a new one'}`)
    if (s.reason) console.log(`      ${JSON.stringify(s.reason)}`)
  }
  if (!stranded.length) console.log('   none')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
