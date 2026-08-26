/**
 * ONE-OFF: resend the MD's remark on a single approval request to its submitter.
 *
 *   npx tsx --tsconfig ./tsconfig.verify.json scratch/resend-md-remark.ts KIA_0123           (dry run)
 *   npx tsx --tsconfig ./tsconfig.verify.json scratch/resend-md-remark.ts KIA_0123 --send    (SENDS)
 *
 * ⚠️ DRY RUN BY DEFAULT. sendEmail is real SMTP — a "mock" script in this repo has already mailed
 * three real people. Nothing leaves without --send, and even then it refuses unless it matches
 * exactly ONE request and finds exactly ONE MD remark on it.
 */
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaApprovalRequests } from '../lib/db/schema'

type HistoryEntry = { role?: string; roleKey?: string; user?: string; action?: string; remarks?: string; timestamp?: string }

async function main() {
  const [requestNo, flag] = process.argv.slice(2)
  const send = flag === '--send'
  if (!requestNo) { console.error('Usage: resend-md-remark.ts <REQUEST_NO> [--send]'); process.exit(1) }

  const rows = await db.select().from(kiaApprovalRequests).where(eq(kiaApprovalRequests.requestNo, requestNo))
  if (rows.length !== 1) { console.error(`Expected exactly 1 request for ${requestNo}, found ${rows.length}. Refusing.`); process.exit(1) }
  const row = rows[0]

  const history = (Array.isArray(row.history) ? row.history : []) as HistoryEntry[]
  const mdRemarks = history.filter((h) =>
    String(h.roleKey || '').toLowerCase() === 'md' &&
    String(h.remarks || '').trim().length > 0)
  const columnRemark = String(row.managementRemarks || '').trim()

  console.log(`request      ${row.requestNo}  (${row.brand} / ${row.dealerName})`)
  console.log(`submitter    ${row.name} <${row.email}>`)
  console.log(`amount       INR ${row.amount}`)
  console.log(`workflow     vp=${row.vpApproval || '-'} ea=${row.eaApproval || '-'} md=${row.managementApproval || '-'} accounts=${row.accountApproval || '-'}`)
  console.log(`md remarks   ${mdRemarks.length} in history${columnRemark ? ` + 1 in management_remarks` : ''}`)
  for (const h of mdRemarks) console.log(`   - "${h.remarks}"  by ${h.user} at ${h.timestamp}`)

  if (mdRemarks.length !== 1) { console.error(`\nExpected exactly 1 MD remark, found ${mdRemarks.length}. Refusing.`); process.exit(1) }
  if (!row.email) { console.error('\nNo submitter email on this request. Refusing.'); process.exit(1) }
  const remark = mdRemarks[0]

  console.log(`\nWOULD SEND -> ${row.email}`)
  console.log(`   subject: "MD Remark on your Payment Request ${row.requestNo}"`)
  console.log(`   remark:  "${remark.remarks}"  (from ${remark.user})`)

  if (!send) { console.log('\nDRY RUN — nothing sent. Re-run with --send.'); return }

  // Imported lazily so a dry run never even loads the SMTP transport.
  const { sendMdRemarkEmail } = await import('../lib/approvals/decision-emails')
  sendMdRemarkEmail({
    id: row.id, name: row.name, email: row.email, amount: row.amount,
    vendorName: row.vendorName, requestNo: row.requestNo, brand: row.brand,
  }, { senderName: remark.user || 'The MD', remarks: String(remark.remarks) })

  // sendMdRemarkEmail is fire-and-forget; hold the process open long enough for the send to finish.
  await new Promise((r) => setTimeout(r, 15000))
  console.log(`\nSENT to ${row.email} (1 email). Check the console above for any [approvals] error line.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
