import 'dotenv/config'
import { db } from '../lib/db'
import {
  users,
  pettyCashRequests,
  pettyCashAllocations,
  pettyCashExpenses,
  pettyCashExpenseAttachments,
  pettyCashLedgerEntries,
  pettyCashApprovalHistory,
} from '../lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'

const OLD_MITHUN_ID = 'ecfe99c6-7126-4b5e-a3b4-ba71e0989e3b'
const NEW_MITHUN_ID = '60ac0c80-1188-48d1-a8b7-9c5805fa9e94'

async function main() {
  console.log('=== MIGRATING MITHUN PETTY CASH TO MITHUN VERMA 2 ===\n')

  const [oldUser] = await db.select().from(users).where(eq(users.id, OLD_MITHUN_ID))
  const [newUser] = await db.select().from(users).where(eq(users.id, NEW_MITHUN_ID))

  if (!oldUser) {
    throw new Error(`Old user with ID ${OLD_MITHUN_ID} not found!`)
  }
  if (!newUser) {
    throw new Error(`New user with ID ${NEW_MITHUN_ID} not found!`)
  }

  console.log(`SOURCE USER: ${oldUser.fullName} (${oldUser.email}) [Role: ${oldUser.role}, Dept: ${oldUser.department}]`)
  console.log(`TARGET USER: ${newUser.fullName} (${newUser.email}) [Role: ${newUser.role}, Dept: ${newUser.department}]\n`)

  const dryRun = process.argv.includes('--dry-run')
  if (dryRun) {
    console.log('*** DRY RUN MODE - NO CHANGES WILL BE WRITTEN ***\n')
  }

  // Identify records to migrate
  const requestsToMigrate = await db.select().from(pettyCashRequests).where(eq(pettyCashRequests.createdBy, OLD_MITHUN_ID))
  const requestIds = requestsToMigrate.map(r => r.id)

  const allocationsToMigrate = await db.select().from(pettyCashAllocations).where(eq(pettyCashAllocations.allocatedTo, OLD_MITHUN_ID))
  const allocationIds = allocationsToMigrate.map(a => a.id)

  const expensesToMigrate = await db.select().from(pettyCashExpenses).where(eq(pettyCashExpenses.createdBy, OLD_MITHUN_ID))
  const expenseIds = expensesToMigrate.map(e => e.id)

  const ledgersToMigrate = allocationIds.length > 0
    ? await db.select().from(pettyCashLedgerEntries).where(and(
        inArray(pettyCashLedgerEntries.allocationId, allocationIds),
        eq(pettyCashLedgerEntries.createdBy, OLD_MITHUN_ID)
      ))
    : []

  const reqHistoryToMigrate = requestIds.length > 0
    ? await db.select().from(pettyCashApprovalHistory).where(and(
        inArray(pettyCashApprovalHistory.requestId, requestIds),
        eq(pettyCashApprovalHistory.performedBy, OLD_MITHUN_ID)
      ))
    : []

  const expHistoryToMigrate = expenseIds.length > 0
    ? await db.select().from(pettyCashApprovalHistory).where(and(
        inArray(pettyCashApprovalHistory.expenseId, expenseIds),
        eq(pettyCashApprovalHistory.performedBy, OLD_MITHUN_ID)
      ))
    : []

  console.log('Summary of records to migrate:')
  console.log(`  - Requests: ${requestsToMigrate.length}`)
  console.log(`  - Allocations: ${allocationsToMigrate.length}`)
  console.log(`  - Expenses: ${expensesToMigrate.length}`)
  console.log(`  - Ledger entries: ${ledgersToMigrate.length}`)
  console.log(`  - Request approval history entries: ${reqHistoryToMigrate.length}`)
  console.log(`  - Expense approval history entries: ${expHistoryToMigrate.length}`)

  if (dryRun) {
    console.log('\nDry run complete. Exiting without changes.')
    return
  }

  console.log('\nExecuting migration in transaction...')

  await db.transaction(async (tx) => {
    // 1. Update Requests
    if (requestsToMigrate.length > 0) {
      for (const req of requestsToMigrate) {
        await tx.update(pettyCashRequests).set({
          createdBy: newUser.id,
          requestedByName: newUser.fullName,
          requestedByEmail: newUser.email,
          updatedAt: new Date(),
        }).where(eq(pettyCashRequests.id, req.id))
      }
      console.log(`  ✓ Updated ${requestsToMigrate.length} request(s)`)
    }

    // 2. Update Allocations
    if (allocationsToMigrate.length > 0) {
      for (const alloc of allocationsToMigrate) {
        await tx.update(pettyCashAllocations).set({
          allocatedTo: newUser.id,
          updatedAt: new Date(),
        }).where(eq(pettyCashAllocations.id, alloc.id))
      }
      console.log(`  ✓ Updated ${allocationsToMigrate.length} allocation(s)`)
    }

    // 3. Update Expenses
    if (expensesToMigrate.length > 0) {
      for (const exp of expensesToMigrate) {
        await tx.update(pettyCashExpenses).set({
          createdBy: newUser.id,
          updatedAt: new Date(),
        }).where(eq(pettyCashExpenses.id, exp.id))
      }
      console.log(`  ✓ Updated ${expensesToMigrate.length} expense(s)`)
    }

    // 4. Update Ledger entries
    if (ledgersToMigrate.length > 0) {
      for (const ledger of ledgersToMigrate) {
        await tx.update(pettyCashLedgerEntries).set({
          createdBy: newUser.id,
        }).where(eq(pettyCashLedgerEntries.id, ledger.id))
      }
      console.log(`  ✓ Updated ${ledgersToMigrate.length} ledger entry/entries`)
    }

    // 5. Update Approval history for requests
    if (reqHistoryToMigrate.length > 0) {
      for (const hist of reqHistoryToMigrate) {
        await tx.update(pettyCashApprovalHistory).set({
          performedBy: newUser.id,
          userRole: newUser.role,
        }).where(eq(pettyCashApprovalHistory.id, hist.id))
      }
      console.log(`  ✓ Updated ${reqHistoryToMigrate.length} request approval history entry/entries`)
    }

    // 6. Update Approval history for expenses
    if (expHistoryToMigrate.length > 0) {
      for (const hist of expHistoryToMigrate) {
        await tx.update(pettyCashApprovalHistory).set({
          performedBy: newUser.id,
          userRole: newUser.role,
        }).where(eq(pettyCashApprovalHistory.id, hist.id))
      }
      console.log(`  ✓ Updated ${expHistoryToMigrate.length} expense approval history entry/entries`)
    }
  })

  console.log('\n=== MIGRATION COMPLETED SUCCESSFULLY ===\n')

  // Verification
  console.log('--- POST-MIGRATION VERIFICATION ---')
  const newReqs = await db.select().from(pettyCashRequests).where(eq(pettyCashRequests.createdBy, NEW_MITHUN_ID))
  const newAllocs = await db.select().from(pettyCashAllocations).where(eq(pettyCashAllocations.allocatedTo, NEW_MITHUN_ID))
  const newExps = await db.select().from(pettyCashExpenses).where(eq(pettyCashExpenses.createdBy, NEW_MITHUN_ID))
  const newLedgers = await db.select().from(pettyCashLedgerEntries).where(eq(pettyCashLedgerEntries.createdBy, NEW_MITHUN_ID))

  console.log(`Target User (Mithun Verma 2):`)
  console.log(`  - Requests: ${newReqs.length}`)
  console.log(`  - Allocations: ${newAllocs.length}`)
  for (const a of newAllocs) {
    const allocated = Number(a.allocatedAmount)
    const spent = Number(a.spentAmount)
    const remaining = allocated - spent
    console.log(`    Allocation ${a.allocationNumber}: Allocated = ₹${allocated.toLocaleString('en-IN')}, Spent = ₹${spent.toLocaleString('en-IN')}, Remaining = ₹${remaining.toLocaleString('en-IN')} (Status: ${a.status})`)
  }
  console.log(`  - Expenses: ${newExps.length}`)
  console.log(`  - Ledger entries: ${newLedgers.length}`)

  const oldRemainingReqs = await db.select().from(pettyCashRequests).where(eq(pettyCashRequests.createdBy, OLD_MITHUN_ID))
  const oldRemainingAllocs = await db.select().from(pettyCashAllocations).where(eq(pettyCashAllocations.allocatedTo, OLD_MITHUN_ID))
  const oldRemainingExps = await db.select().from(pettyCashExpenses).where(eq(pettyCashExpenses.createdBy, OLD_MITHUN_ID))

  console.log(`\nSource User (Old Mithun in Accounts):`)
  console.log(`  - Owned Requests: ${oldRemainingReqs.length}`)
  console.log(`  - Owned Allocations: ${oldRemainingAllocs.length}`)
  console.log(`  - Owned Expenses: ${oldRemainingExps.length}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })
