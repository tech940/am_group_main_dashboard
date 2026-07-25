import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function revertGmApproval() {
  const requestId = 'ff7ef4f9-7a7d-4581-9668-8720c49b957e'
  const historyId = '646e02b3-7fc8-4dac-b393-91f2bcc8214e'

  console.log('--- REVERTING ACCIDENTAL GM APPROVAL FOR REQUEST PCR-20260724-1613 ---')

  await db.transaction(async (tx) => {
    // 1. Delete ledger entries for allocation linked to this request
    const allocs = await tx.execute(sql`
      SELECT id FROM petty_cash_allocations WHERE request_id = ${requestId}::uuid
    `)
    const allocIds = (allocs as any[]).map((a) => a.id)

    if (allocIds.length > 0) {
      console.log('Deleting ledger entries for allocations:', allocIds)
      await tx.execute(sql`
        DELETE FROM petty_cash_ledger_entries WHERE allocation_id IN (${sql.join(allocIds.map(id => sql`${id}::uuid`), sql`, `)})
      `)
      console.log('Deleting allocations for request:', requestId)
      await tx.execute(sql`
        DELETE FROM petty_cash_allocations WHERE request_id = ${requestId}::uuid
      `)
    }

    // 2. Delete history entry from GM approval
    console.log('Deleting approval history entry:', historyId)
    await tx.execute(sql`
      DELETE FROM petty_cash_approval_history WHERE id = ${historyId}::uuid
    `)

    // 3. Reset request status back to accounts_pending / accounts stage
    console.log('Resetting request status to accounts_pending for request:', requestId)
    await tx.execute(sql`
      UPDATE petty_cash_requests
      SET status = 'accounts_pending',
          current_stage = 'accounts',
          allocated_amount = NULL,
          accounts_approved_by = NULL,
          accounts_approved_at = NULL,
          updated_at = NOW()
      WHERE id = ${requestId}::uuid
    `)
  })

  console.log('--- SUCCESSFULLY REVERTED ORDER PCR-20260724-1613 BACK TO ACCOUNTS PENDING ---')

  const [check] = await db.execute(sql`
    SELECT id, request_number, status, current_stage, requested_by_name, requested_amount, purpose
    FROM petty_cash_requests
    WHERE id = ${requestId}::uuid
  `)
  console.log('Current Request State:', check)

  process.exit(0)
}

revertGmApproval().catch((err) => {
  console.error(err)
  process.exit(1)
})
