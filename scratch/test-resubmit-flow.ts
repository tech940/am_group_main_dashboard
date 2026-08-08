import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaApprovalRequests } from '../lib/db/schema'
import { createResubmitToken } from '../lib/kia/approval-resubmit'

/**
 * Harness for exercising the re-submit flow end-to-end against a running dev server.
 * Seeds a clearly-marked TEST row in the SentBack state, prints a signed token for it,
 * verifies the row after the HTTP round-trip, and cleans up.
 *
 *   tsx --tsconfig ./tsconfig.verify.json scratch/test-resubmit-flow.ts seed
 *   tsx --tsconfig ./tsconfig.verify.json scratch/test-resubmit-flow.ts check <id>
 *   tsx --tsconfig ./tsconfig.verify.json scratch/test-resubmit-flow.ts cleanup <id>
 */

const TEST_MARKER = 'RESUBMIT-FLOW-TEST (safe to delete)'

async function main() {
  const [mode, id] = process.argv.slice(2)

  if (mode === 'seed') {
    const [row] = await db.insert(kiaApprovalRequests).values({
      email: 'resubmit-flow-test@example.invalid',
      name: TEST_MARKER,
      amount: '111',
      department: 'Sales',
      approvalType: 'Other',
      vendorName: 'Test Vendor Before',
      remarks: 'original remarks',
      vpApproval: null,
      hrApproval: null,
      accountApproval: null,
      eaApproval: null,
      managementApproval: null,
      managementRemarks: 'old md remark',
      emailSendStatus: 'SentBack',
      sendBackReason: 'TEST: amount was wrong, please correct',
      history: [{
        id: 'seed1', role: 'ED', roleKey: 'sales_manager', user: 'Seed User',
        action: 'SENT BACK', remarks: 'seeded', timestamp: new Date().toISOString(),
      }],
    }).returning()
    console.log('ID=' + row.id)
    console.log('TOKEN=' + createResubmitToken(row.id))
    return
  }

  if (mode === 'check') {
    const [row] = await db.select().from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, id)).limit(1)
    if (!row) throw new Error('row missing')
    const fail: string[] = []
    const expect = (label: string, cond: boolean) => {
      console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`)
      if (!cond) fail.push(label)
    }
    expect('amount updated to 222', row.amount === '222.00' || row.amount === '222')
    expect('vendor updated', row.vendorName === 'Test Vendor After')
    expect('status back to Mail Sent', row.emailSendStatus === 'Mail Sent')
    expect('sendBackReason cleared', row.sendBackReason == null)
    expect('chain reset to fresh state', row.vpApproval === '' && row.eaApproval === '' && row.managementApproval === '')
    expect('managementRemarks cleared', row.managementRemarks === '')
    const hist = Array.isArray(row.history) ? row.history as Array<Record<string, unknown>> : []
    const resub = hist.find(h => h.action === 'RESUBMITTED')
    expect('history has RESUBMITTED entry', Boolean(resub))
    expect('RESUBMITTED entry preserves send-back reason',
      typeof resub?.remarks === 'string' && (resub.remarks as string).includes('amount was wrong'))
    expect('seed history entry retained', hist.some(h => h.id === 'seed1'))
    // duplicate check: no OTHER row carries the test marker
    const dupes = await db.select({ id: kiaApprovalRequests.id }).from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.name, TEST_MARKER))
    expect('no duplicate row created', dupes.length === 1)
    if (fail.length) { console.error('FAILURES: ' + fail.join('; ')); process.exit(1) }
    console.log('ALL CHECKS PASSED')
    return
  }

  if (mode === 'cleanup') {
    const deleted = await db.delete(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, id)).returning({ id: kiaApprovalRequests.id, name: kiaApprovalRequests.name })
    console.log('deleted:', JSON.stringify(deleted))
    return
  }

  throw new Error('usage: seed | check <id> | cleanup <id>')
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1) })
