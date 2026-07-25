import { db } from '../lib/db'
import { INITIAL_SCRAP_TRANSACTIONS } from '../lib/scrap-erp/mock-data'
import { sql } from 'drizzle-orm'

async function seedScrapDatabase() {
  console.log('=== Checking & Seeding Scrap Database ===')

  const existingRes = await db.execute(sql.raw(`SELECT count(*)::int as count FROM scrap_transactions`))
  const existingCount = Number(existingRes[0]?.count || 0)
  console.log(`Current scrap_transactions in DB: ${existingCount}`)

  let insertedCount = 0

  for (const t of INITIAL_SCRAP_TRANSACTIONS) {
    const existing = await db.execute(sql.raw(`
      SELECT id FROM scrap_transactions WHERE transaction_number = '${t.transactionNumber}'
    `))

    if (existing.length === 0) {
      await db.execute(sql.raw(`
        INSERT INTO scrap_transactions (
          transaction_number, timestamp, group_name, location_name, department_name,
          scrap_type_name, unit, description, weight_qty, rate_per_unit,
          calculated_total, amount_received, outstanding_amount, sold_by_name,
          sold_to, sold_date, payment_mode_name, payment_handover_to_name,
          remarks, status, is_distributed, sent_to_accounts, created_at, updated_at
        ) VALUES (
          ${sql.raw(`'${t.transactionNumber}'`)},
          ${sql.raw(`'${t.timestamp || new Date().toISOString()}'`)},
          ${sql.raw(`'${(t.groupName || 'JAM').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.locationName || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.departmentName || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.scrapTypeName || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.unit || 'Kg').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.description || '').replace(/'/g, "''")}'`)},
          ${t.weightQty || 0},
          ${t.ratePerUnit || 0},
          ${t.calculatedTotal || 0},
          ${t.amountReceived || 0},
          ${t.outstandingAmount || 0},
          ${sql.raw(`'${(t.soldByName || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.soldTo || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${t.soldDate || '2026-07-01'}'`)},
          ${sql.raw(`'${(t.paymentModeName || 'CASH').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.paymentHandoverToName || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${(t.remarks || '').replace(/'/g, "''")}'`)},
          ${sql.raw(`'${t.status || 'COMPLETED'}'`)},
          ${t.isDistributed ? 'TRUE' : 'FALSE'},
          ${t.sentToAccounts ? 'TRUE' : 'FALSE'},
          NOW(),
          NOW()
        )
      `))
      insertedCount++
    }
  }

  console.log(`Seeded ${insertedCount} transactions into database scrap_transactions table.`)
}

seedScrapDatabase().catch(console.error).finally(() => process.exit(0))
