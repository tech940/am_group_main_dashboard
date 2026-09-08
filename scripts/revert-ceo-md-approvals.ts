/**
 * Return to the MD's pending queue every request whose MD stage was approved by a CEO account.
 *
 * ⚠️ WHY. `isSuperUser = ['ceo','md']` authorised the **md** stage in both approval routes, so the
 * CEO could sign the MD's stage. On KIA_0203 and KIA_0201 he did: approved at the CEO stage, then
 * clicked approve again at the MD stage ~20 seconds after the EA cleared it. The chain shows two
 * consecutive stamps by one person, and the MD never saw the request.
 *
 * WHAT THIS CHANGES, per row:
 *   management_approval  'APPROVED' -> ''            (back to "nobody has acted")
 *   management_remarks   the CEO's remark -> ''      (it was the MD stage's remark)
 *   email_send_status    'MDApproved' -> 'Mail Sent' (what every other MD-pending row carries; the
 *                                                     bulk route REFUSES rows reading 'SentBack',
 *                                                     so this field is not inert for filtering)
 *   history              APPENDED with a reversal entry
 *
 * WHAT IT DOES NOT CHANGE — deliberately:
 *   - vp_approval / ceo_approval / ea_approval. On both rows those were signed by three DIFFERENT
 *     real people before the MD stage (GSM Ramanpreet Singh, CEO Mohan Sharma, EA Shikha Gupta /
 *     Lalita). Only the MD stage was self-served, so only the MD stage is undone.
 *   - The CEO's original md history entry. Audit history is APPEND-ONLY. Deleting the entry would
 *     erase the evidence of what happened; the reversal entry sits after it and explains it.
 *   - Any row where the MD stage was approved by an actual MD account, or where Accounts has since
 *     acted, or where payment has been made. Those are guarded against below and skipped loudly.
 *
 * SAFETY: dry-run by default; --apply writes inside ONE transaction; the UPDATE is a compare-and-swap
 * on management_approval so a concurrent real MD approval between the read and the write is not
 * clobbered. jsonb is appended with `||` and jsonb_build_object — never `JSON.stringify(x)::jsonb`,
 * which double-encodes and has corrupted this column before.
 *
 *   npx tsx scripts/revert-ceo-md-approvals.ts           # dry run
 *   npx tsx scripts/revert-ceo-md-approvals.ts --apply
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 })

const inr = (n: unknown) => '₹' + Number(n).toLocaleString('en-IN')

type Row = {
  id: string
  request_no: string | null
  brand: string | null
  location: string | null
  amount: string
  account_approval: string | null
  payment_status: string | null
  email_send_status: string | null
  history: any[]
}

async function main() {
  // Who is actually a CEO. Matched on full_name because that is the ONLY link from a history entry
  // to a person — history stores `user` = appUser.fullName, never an id.
  const ceoNames = await sql<{ full_name: string }[]>`
    SELECT full_name FROM users WHERE role::text = 'ceo'`
  const ceoSet = new Set(ceoNames.map((c) => String(c.full_name).trim().toLowerCase()))
  console.log(`CEO accounts: ${ceoNames.map((c) => c.full_name).join(', ') || '(none)'}\n`)

  const candidates = await sql<Row[]>`
    SELECT id::text, request_no, brand, location, amount::text,
           account_approval, payment_status, email_send_status, history
    FROM kia_approval_requests
    WHERE management_approval = 'APPROVED' AND jsonb_typeof(history) = 'array'
    ORDER BY request_no`

  const targets: { row: Row; actor: string; ts: string }[] = []
  const skipped: string[] = []

  for (const row of candidates) {
    const mdEntry = (row.history || []).find(
      (h: any) => h?.roleKey === 'md' && ['APPROVED', 'APPROVE'].includes(String(h?.action)),
    )
    if (!mdEntry) continue
    if (!ceoSet.has(String(mdEntry.user || '').trim().toLowerCase())) continue

    // Guards. A reversal must never disturb money that has already moved on.
    const acct = String(row.account_approval || '').trim()
    const pay = String(row.payment_status || '').trim().toUpperCase()
    if (acct) {
      skipped.push(`${row.request_no}: Accounts has already acted (account_approval="${acct}") — left alone`)
      continue
    }
    if (pay && pay !== 'PENDING') {
      skipped.push(`${row.request_no}: payment_status="${pay}" — money has moved, left alone`)
      continue
    }
    targets.push({ row, actor: String(mdEntry.user), ts: String(mdEntry.timestamp) })
  }

  console.log(`Scanned ${candidates.length} MD-approved requests.`)
  console.log(`\n${targets.length} to return to the MD queue:`)
  for (const t of targets) {
    console.log(
      `  ${String(t.row.request_no).padEnd(10)} ${String(t.row.brand).padEnd(8)} ${String(t.row.location || '-').padEnd(10)} ` +
        `${inr(t.row.amount).padEnd(13)} MD stage signed by ${t.actor} (CEO) @ ${t.ts}`,
    )
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} skipped:`)
    for (const s of skipped) console.log(`  ${s}`)
  }

  if (!targets.length) {
    console.log('\nNothing to do.')
    await sql.end()
    return
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await sql.end()
    return
  }

  const done: string[] = []
  const lost: string[] = []
  await sql.begin(async (tx) => {
    for (const t of targets) {
      const [updated] = await tx<{ request_no: string }[]>`
        UPDATE kia_approval_requests
        SET management_approval = '',
            management_remarks  = '',
            email_send_status   = 'Mail Sent',
            history = history || jsonb_build_array(jsonb_build_object(
              'id',        substr(md5(${t.row.id} || 'md-revert'), 1, 6),
              'role',      'System',
              'roleKey',   'system_correction',
              'user',      'System (MD stage returned to queue)',
              'action',    'REVERTED',
              -- ::text is REQUIRED. jsonb_build_object gives Postgres no type context for a bound
              -- parameter, so an uncast placeholder fails with "could not determine data type".
              'remarks',   ${'MD stage approval by ' + t.actor + ' (role: CEO, not MD) was reverted. ' +
                             'The CEO stage and the MD stage are separate desks; this request is back with the MD.'}::text,
              'timestamp', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )),
            updated_at = now()
        WHERE id = ${t.row.id}::uuid
          AND management_approval = 'APPROVED'
          AND (account_approval IS NULL OR account_approval = '')
        RETURNING request_no`
      if (updated) done.push(updated.request_no)
      else lost.push(String(t.row.request_no))
    }
  })

  console.log(`\nReverted ${done.length}: ${done.join(', ')}`)
  if (lost.length) {
    console.log(`⚠️ ${lost.length} changed underneath the read and were NOT touched: ${lost.join(', ')}`)
  }

  const after = await sql<any[]>`
    SELECT request_no, management_approval, management_remarks, email_send_status,
           jsonb_array_length(history) AS entries
    FROM kia_approval_requests WHERE request_no = ANY(${done})
    ORDER BY request_no`
  console.log('\nAfter:')
  for (const a of after) {
    console.log(
      `  ${String(a.request_no).padEnd(10)} md=${JSON.stringify(a.management_approval)} ` +
        `remarks=${JSON.stringify(a.management_remarks)} email=${JSON.stringify(a.email_send_status)} history=${a.entries} entries`,
    )
  }

  const [{ bad }] = await sql<any[]>`
    SELECT COUNT(*)::int AS bad
    FROM kia_approval_requests r, jsonb_array_elements(r.history) h
    WHERE jsonb_typeof(r.history) = 'array' AND h->>'role' LIKE '"%"'`
  console.log(`\nDouble-encoded history values: ${bad} (must be 0)`)
  await sql.end()
}

main().catch(async (e) => {
  console.error('FAILED:', e.message)
  await sql.end()
  process.exit(1)
})
