/**
 * Reverse petty cash expenses and return the money to the holder's float.
 *
 * Takes expense numbers on the command line. First used for PCE-20260901-7820 + PCE-20260905-1203 on ARIF's
 * allocation PCA-20260827-9506 (hyundai) — ₹2,360.00 back to his float.
 *
 * ── WHY THIS IS NOT "DELETE FROM petty_cash_expenses" ─────────────────────────────────────────
 * Three facts, each measured against the live database before writing a line:
 *
 * 1. `petty_cash_allocations.spent_amount` is a STORED column, not a view over the expenses.
 *    Every money figure the app shows comes from it — `getRemainingBalance` (server.ts:134) is
 *    `allocatedAmount - spentAmount`, and the summary tiles sum the same column (server.ts:673,678).
 *    Deleting an expense therefore does NOT give the money back on its own.
 *
 * 2. ⚠️ But the two are kept in lockstep, and that invariant HOLDS on all 30 live allocations:
 *        spent_amount == SUM(amount) WHERE status='approved' AND deleted_at IS NULL
 *    So the reversal must do BOTH — remove the expense AND decrement spent_amount. Doing only one
 *    leaves the app disagreeing with itself. Doing both is not double-counting: the derived sum
 *    drops because the row leaves the filter, and the stored column drops because we write it.
 *
 * 3. `petty_cash_ledger_entries.balance_after` is a RUNNING SNAPSHOT, and for every one of the 10
 *    active allocations the last entry's balance_after equals `allocated_amount - spent_amount`
 *    exactly. Twenty entries were written after the first target expense, so their snapshots would
 *    all be stale. This script does not rewrite them — it appends reversing `adjustment` entries,
 *    which is how a cash book corrects itself: the money left, then it came back. Rewriting twenty
 *    historical balances to hide that would be falsifying a ledger.
 *
 * ── SOFT DELETE, NOT HARD ────────────────────────────────────────────────────────────────────
 * `petty_cash_expenses.deleted_at` exists and every listing filters on it
 * (lib/petty-cash/access.ts:230, server.ts:807/1390/1559/1799), and the per-allocation spend window
 * and count subqueries filter it too (server.ts:725-733). Setting it removes the expenses from the
 * app completely. A hard DELETE would additionally cascade away the uploaded bill files' attachment
 * rows, NULL out the ledger's expense_id (leaving orphan money lines), and destroy the approval
 * trail for two expenses that were signed off by Accounts. Nothing is gained by it.
 *
 * ⚠️ Nothing in this table has ever been soft-deleted (0 of 321 rows) and no `adjustment` ledger
 * entry has ever been written, so there is no precedent to copy — both mechanisms are used here for
 * the first time, exactly as the schema designed them.
 *
 * ── THE APP REFUSES TO DO THIS, ON PURPOSE ───────────────────────────────────────────────────
 * `deletePettyCashExpense` (server.ts:1709) throws on any approved expense:
 *     "An approved expense cannot be deleted — it has already been posted to the ledger."
 * Its comment gives the reason: removing one "would silently rewrite a reconciled cash position".
 * Running this script is a deliberate override of that guard, so it must leave the position
 * reconciled rather than silently rewritten — which is the whole point of steps 2 and 3 below.
 *
 * ⚠️ AND DO NOT COPY THAT PATH'S BODY. It deletes the ledger row and the expense and never touches
 * spent_amount — sound only because the guard means it never runs on a row that incremented it.
 * Pointed at an approved expense it would delete the row and leave the ₹2,360 permanently spent:
 * the exact opposite of giving the money back.
 *
 * Dry-run by default. --apply writes inside ONE transaction, with compare-and-swap guards so a
 * concurrent edit cannot be clobbered, and re-checks every invariant afterwards.
 *
 *   npx tsx scripts/reverse-petty-cash-expenses.ts
 *   npx tsx scripts/reverse-petty-cash-expenses.ts --apply
 */
import 'dotenv/config'
import postgres from 'postgres'

const APPLY = process.argv.includes('--apply')

/**
 * The expenses to reverse, named on the command line.
 *
 * ⚠️ Explicit expense numbers ONLY — never a filter, a date range or a wildcard. Two ₹297.00
 * expenses were posted to the same float three minutes apart (PCE-20260902-0142 and
 * PCE-20260902-5647); anything that selects by amount would take the wrong one, or both.
 */
const TARGETS = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 })
const inr = (n: unknown) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })
const money = (n: number) => n.toFixed(2)

type Expense = {
  id: string
  expense_number: string
  allocation_id: string
  branch_id: string
  amount: string
  status: string
  current_stage: string
  particulars: string
  created_by: string
  deleted_at: string | null
}

async function main() {
  if (!TARGETS.length) {
    console.error('Usage: npx tsx scripts/reverse-petty-cash-expenses.ts <PCE-NUMBER> [more...] [--apply]')
    await sql.end()
    process.exit(1)
  }

  const expenses = await sql<Expense[]>`
    SELECT id::text, expense_number, allocation_id::text, branch_id, amount::text, status,
           current_stage, particulars, created_by::text, deleted_at
    FROM petty_cash_expenses
    WHERE expense_number = ANY(${TARGETS})
    ORDER BY expense_number`

  const missing = TARGETS.filter((t) => !expenses.some((e) => e.expense_number === t))
  if (missing.length) {
    console.error(`NOT FOUND: ${missing.join(', ')} — aborting, nothing written.`)
    await sql.end()
    process.exit(1)
  }

  const already = expenses.filter((e) => e.deleted_at)
  if (already.length) {
    console.log(`Already reversed, will be skipped: ${already.map((e) => e.expense_number).join(', ')}`)
  }
  const todo = expenses.filter((e) => !e.deleted_at)
  if (!todo.length) {
    console.log('Nothing to do — every target is already reversed.')
    await sql.end()
    return
  }

  // One allocation, or the balance arithmetic below would need to be per-allocation.
  const allocationIds = [...new Set(todo.map((e) => e.allocation_id))]
  if (allocationIds.length !== 1) {
    console.error(`Targets span ${allocationIds.length} allocations — this script handles one. Aborting.`)
    await sql.end()
    process.exit(1)
  }
  const allocationId = allocationIds[0]

  const [alloc] = await sql<any[]>`
    SELECT a.id::text, a.allocation_number, a.status, a.branch_id,
           a.allocated_amount::text, a.spent_amount::text,
           u.full_name AS holder, u.email AS holder_email
    FROM petty_cash_allocations a LEFT JOIN users u ON u.id = a.allocated_to
    WHERE a.id = ${allocationId}::uuid`

  const reversal = todo.reduce((sum, e) => sum + Number(e.amount), 0)
  const spentBefore = Number(alloc.spent_amount)
  const allocated = Number(alloc.allocated_amount)
  const spentAfter = spentBefore - reversal
  const remainingBefore = allocated - spentBefore
  const remainingAfter = allocated - spentAfter

  console.log(`Allocation ${alloc.allocation_number} — ${alloc.holder} (${alloc.holder_email}), ${alloc.branch_id}, ${alloc.status}`)
  console.log(`\nReversing ${todo.length} expense(s):`)
  for (const e of todo) {
    console.log(`  ${e.expense_number}  ${inr(e.amount).padStart(13)}  status=${e.status}/${e.current_stage}`)
    console.log(`     ${e.particulars}`)
  }
  console.log(`\n  total reversed   ${inr(reversal).padStart(13)}`)
  console.log(`  allocated        ${inr(allocated).padStart(13)}  (unchanged)`)
  console.log(`  spent   ${inr(spentBefore).padStart(13)} -> ${inr(spentAfter)}`)
  console.log(`  BALANCE ${inr(remainingBefore).padStart(13)} -> ${inr(remainingAfter)}   <-- back to ${alloc.holder}`)

  if (spentAfter < -0.005) {
    console.error('\nABORT: reversal would drive spent_amount negative.')
    await sql.end()
    process.exit(1)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await sql.end()
    return
  }

  await sql.begin(async (tx) => {
    // 1. Soft-delete the expenses. Compare-and-swap on deleted_at IS NULL so a concurrent reversal
    //    cannot double-apply, and on the amount so the row cannot have been edited under us.
    for (const e of todo) {
      const [hit] = await tx<any[]>`
        UPDATE petty_cash_expenses
        SET deleted_at = now(), updated_at = now()
        WHERE id = ${e.id}::uuid AND deleted_at IS NULL AND amount = ${e.amount}::numeric
        RETURNING expense_number`
      if (!hit) throw new Error(`${e.expense_number} changed underneath the read — transaction rolled back, nothing written.`)
    }

    /*
     * 2. Give the money back.
     *
     * ⚠️ RELATIVE, not `SET spent_amount = <computed>`. The app increments relatively at both of its
     * write sites (server.ts:1008 create-and-post, server.ts:1451 accounts approval), and an
     * absolute SET would clobber any expense posted between the read and this write. The
     * compare-and-swap on the value we read makes that case abort loudly instead.
     *
     * Both live CHECK constraints stay satisfied — `spent_amount >= 0` and
     * `petty_cash_allocations_not_overspent (spent_amount <= allocated_amount)`
     * (scripts/create-petty-cash.sql:114,121) — since this only ever decreases spent.
     */
    const [moved] = await tx<any[]>`
      UPDATE petty_cash_allocations
      SET spent_amount = spent_amount - ${money(reversal)}::numeric, updated_at = now()
      WHERE id = ${allocationId}::uuid AND spent_amount = ${alloc.spent_amount}::numeric
      RETURNING allocation_number, spent_amount::text`
    if (!moved) throw new Error('allocation.spent_amount changed underneath the read — rolled back, nothing written.')

    /*
     * 3. Reversing ledger entries, so the cash book still explains the balance it shows.
     *
     * ⚠️ APPEND, never rewrite. The original expense lines stay exactly as posted — the money did
     * leave the tin, and a ledger that erases that is a falsified ledger. The 20 historical
     * balance_after snapshots downstream are therefore left ALONE and stay correct as of their own
     * moment; only these new tail entries carry the corrected balance. Deleting the expense rows AND
     * appending these would move the ledger by ₹4,720 against a ₹2,360 change in spent_amount.
     *
     * ⚠️ expense_id is NULL on purpose: a UNIQUE partial index covers expense_id WHERE NOT NULL
     * (schema.ts:740), so a second row pointing at the same expense is rejected outright. The link
     * lives in metadata.
     *
     * ⚠️ created_at is staggered by a millisecond per row. `now()` is FIXED for the whole
     * transaction — verified against this database — so both rows would otherwise share a timestamp,
     * and getPettyCashLedger orders by created_at alone with no tiebreak (server.ts:1648). The
     * ledger would then be free to render the running balance out of order.
     */
    let running = remainingBefore
    for (const [i, e] of todo.entries()) {
      running += Number(e.amount)
      await tx`
        INSERT INTO petty_cash_ledger_entries
          (allocation_id, request_id, expense_id, branch_id, entry_type, amount, balance_after,
           description, created_by, metadata, created_at)
        SELECT ${allocationId}::uuid, a.request_id, NULL, ${e.branch_id}, 'adjustment',
               ${money(Number(e.amount))}::numeric, ${money(running)}::numeric,
               ${`Reversal of ${e.expense_number} — expense removed, amount returned to float`}::text,
               ${e.created_by}::uuid,
               jsonb_build_object(
                 'reversalOf', ${e.expense_number}::text,
                 'reversedExpenseId', ${e.id}::text,
                 'reason', 'Expense deleted at user request; balance returned to holder'::text
               ),
               now() + (${i} * interval '1 millisecond')
        FROM petty_cash_allocations a WHERE a.id = ${allocationId}::uuid`
    }
  })

  console.log('\nApplied. Re-checking every invariant:\n')

  const [after] = await sql<any[]>`
    SELECT a.allocation_number, u.full_name AS holder,
           a.allocated_amount::numeric AS allocated, a.spent_amount::numeric AS spent,
           (a.allocated_amount - a.spent_amount)::numeric AS remaining,
           COALESCE((SELECT SUM(e.amount) FROM petty_cash_expenses e
                     WHERE e.allocation_id = a.id AND e.status = 'approved' AND e.deleted_at IS NULL), 0)::numeric AS approved_sum,
           (SELECT l.balance_after::numeric FROM petty_cash_ledger_entries l
             WHERE l.allocation_id = a.id ORDER BY l.created_at DESC LIMIT 1) AS ledger_tail,
           (SELECT COUNT(*)::int FROM petty_cash_expenses e
             WHERE e.allocation_id = a.id AND e.status = 'approved' AND e.deleted_at IS NULL) AS live_expenses
    FROM petty_cash_allocations a LEFT JOIN users u ON u.id = a.allocated_to
    WHERE a.id = ${allocationId}::uuid`

  const checks: [string, boolean, string][] = [
    ['spent_amount is the expected value', Math.abs(Number(after.spent) - spentAfter) < 0.005, `${inr(after.spent)} (expected ${inr(spentAfter)})`],
    ['balance returned to holder', Math.abs(Number(after.remaining) - remainingAfter) < 0.005, `${inr(after.remaining)} (expected ${inr(remainingAfter)})`],
    ['spent_amount == SUM(approved, not-deleted expenses)', Math.abs(Number(after.spent) - Number(after.approved_sum)) < 0.005, `${inr(after.spent)} vs ${inr(after.approved_sum)}`],
    ['ledger tail == allocated - spent', Math.abs(Number(after.ledger_tail) - Number(after.remaining)) < 0.005, `${inr(after.ledger_tail)} vs ${inr(after.remaining)}`],
    ['reversed expenses are gone from the app', true, `${after.live_expenses} live expenses remain on this allocation`],
  ]
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
  }

  // The ledger must still be internally consistent: every balance_after is the running total.
  const walk = await sql<any[]>`
    SELECT l.balance_after::numeric AS stored,
           SUM(l.amount::numeric) OVER (ORDER BY l.created_at, l.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
    FROM petty_cash_ledger_entries l WHERE l.allocation_id = ${allocationId}::uuid ORDER BY l.created_at, l.id`
  const bad = walk.filter((r) => Math.abs(Number(r.stored) - Number(r.running)) > 0.005)
  console.log(`  ${bad.length === 0 ? 'PASS' : 'FAIL'}  every ledger balance_after equals the running total — ${walk.length} entries, ${bad.length} bad`)

  // And nothing else moved: the invariant must still hold for every OTHER allocation too.
  const others = await sql<any[]>`
    SELECT COUNT(*)::int AS drift FROM petty_cash_allocations a
    WHERE a.id <> ${allocationId}::uuid
      AND ABS(a.spent_amount::numeric - COALESCE((SELECT SUM(e.amount) FROM petty_cash_expenses e
            WHERE e.allocation_id = a.id AND e.status='approved' AND e.deleted_at IS NULL), 0)::numeric) > 0.005`
  console.log(`  ${others[0].drift === 0 ? 'PASS' : 'FAIL'}  no other allocation was disturbed — ${others[0].drift} drifting`)

  const failed = checks.some(([, p]) => !p) || bad.length > 0 || others[0].drift !== 0
  console.log(failed ? '\n⚠️ SOMETHING IS WRONG — investigate before telling anyone the balance is correct.' : '\nAll invariants hold.')
  await sql.end()
  if (failed) process.exit(1)
}

main().catch(async (e) => {
  console.error('FAILED:', e.message)
  await sql.end()
  process.exit(1)
})
