import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
import {
  pettyCashRequests,
  pettyCashAllocations,
  pettyCashLedgerEntries,
  pettyCashApprovalHistory,
} from '../lib/db/schema'

async function main() {
  const email = 'arifparay425@gmail.com'

  await db
    .update(pettyCashLedgerEntries)
    .set({
      balanceAfter: '64270.00',
    })
    .where(sql`id = 'df15b124-0168-45b0-abd7-afbe539209d1'`)

  console.log('Updated expense ledger entry balanceAfter to 64270.00 (64370.00 allocated - 100.00 spent)')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })


