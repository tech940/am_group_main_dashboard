import 'dotenv/config'
import Module from 'module'
const originalRequire = Module.prototype.require
Module.prototype.require = function (id: string) {
  if (id === 'server-only') return {}
  return originalRequire.apply(this, arguments as any)
}

import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'

async function inspectApprovals() {
  const rows = await db.select().from(kiaApprovalRequests)
  console.log(`Total vendor payment requests in DB: ${rows.length}`)

  console.dir(rows.map(r => ({
    id: r.id,
    vendorName: r.vendorName,
    amount: r.amount,
    dealerCode: r.dealerCode,
    dealerName: r.dealerName,
    location: r.location,
    brand: r.brand,
    vpApproval: r.vpApproval,
    eaApproval: r.eaApproval,
    managementApproval: r.managementApproval,
    accountApproval: r.accountApproval,
    paymentStatus: r.paymentStatus,
    createdAt: r.createdAt
  })), { depth: 3 })

  process.exit(0)
}

inspectApprovals().catch(console.error)
