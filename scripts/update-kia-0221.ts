import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq, ilike } from 'drizzle-orm'

async function run() {
  const reqNo = 'KIA_0221'
  console.log(`Searching for request: ${reqNo}...`)

  const rows = await db
    .select()
    .from(kiaApprovalRequests)
    .where(ilike(kiaApprovalRequests.requestNo, reqNo))

  if (rows.length === 0) {
    console.log('No exact match for', reqNo)
    const near = await db
      .select({ id: kiaApprovalRequests.id, requestNo: kiaApprovalRequests.requestNo, amount: kiaApprovalRequests.amount, name: kiaApprovalRequests.name })
      .from(kiaApprovalRequests)
      .where(ilike(kiaApprovalRequests.requestNo, 'KIA_022%'))
    console.log('Near matches:', near)
    process.exit(1)
  }

  const row = rows[0]
  console.log('Current row found:', {
    id: row.id,
    requestNo: row.requestNo,
    name: row.name,
    amount: row.amount,
    dealerName: row.dealerName,
    department: row.department,
    createdAt: row.createdAt,
  })

  console.log('Updating amount from', row.amount, 'to 390000.00...')
  const updated = await db
    .update(kiaApprovalRequests)
    .set({
      amount: '390000.00',
      updatedAt: new Date(),
    })
    .where(eq(kiaApprovalRequests.id, row.id))
    .returning()

  console.log('Update successful! New values:', {
    id: updated[0].id,
    requestNo: updated[0].requestNo,
    name: updated[0].name,
    amount: updated[0].amount,
    updatedAt: updated[0].updatedAt,
  })
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
