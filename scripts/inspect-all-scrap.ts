import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function inspectAllScrap() {
  console.log('=== Inspecting All Scrap Transactions in Database ===')

  const total = await db.execute(sql.raw(`SELECT count(*)::int as count FROM scrap_transactions`))
  console.log('Total scrap transactions in DB:', total[0]?.count)

  const latest20 = await db.execute(sql.raw(`
    SELECT transaction_number, sold_by_name, payment_handover_to_name, sold_to, amount_received, sold_date, created_at
    FROM scrap_transactions
    ORDER BY created_at DESC, transaction_number DESC
    LIMIT 20
  `))

  console.log('Latest 20 scrap transactions in DB:', latest20)

  const todayCount = await db.execute(sql.raw(`
    SELECT count(*)::int as count FROM scrap_transactions WHERE created_at >= '2026-07-25 00:00:00'
  `))
  console.log('Transactions created today (2026-07-25):', todayCount[0]?.count)
}

inspectAllScrap().catch(console.error).finally(() => process.exit(0))
