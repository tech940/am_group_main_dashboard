import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { and, eq, isNull, or } from 'drizzle-orm'

async function fixExistingApprovals() {
  console.log('Fixing any existing kia_approval_requests rows where managementApproval = APPROVED...')
  
  const result = await db
    .update(kiaApprovalRequests)
    .set({ vpApproval: 'APPROVED' })
    .where(
      and(
        eq(kiaApprovalRequests.managementApproval, 'APPROVED'),
        or(
          isNull(kiaApprovalRequests.vpApproval),
          eq(kiaApprovalRequests.vpApproval, '')
        )
      )
    )
    .returning()

  console.log(`Updated ${result.length} existing approval request(s) to have vpApproval = APPROVED.`)
  if (result.length > 0) {
    console.dir(result.map(r => ({ id: r.id, vendorName: r.vendorName, amount: r.amount })), { depth: 2 })
  }

  process.exit(0)
}

fixExistingApprovals().catch(console.error)
