import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const cashRows = await sql`
    SELECT transaction_number, location_name, department_name, scrap_type_name, weight_qty, rate_per_unit, calculated_total, amount_received, payment_mode_name, sold_to
    FROM public.scrap_transactions
    WHERE UPPER(payment_mode_name) = 'CASH'
    ORDER BY timestamp DESC;
  `

  console.log('--- ALL CASH TRANSACTIONS IN DATABASE ---')
  console.table(cashRows)

  const cashReceivedSum = cashRows.reduce((acc, r) => acc + Number(r.amount_received || 0), 0)
  const cashValuationSum = cashRows.reduce((acc, r) => acc + Number(r.calculated_total || 0), 0)

  console.log(`\nCASH Total Amount Received: ₹${cashReceivedSum.toLocaleString('en-IN')}`)
  console.log(`CASH Total Calculated Valuation: ₹${cashValuationSum.toLocaleString('en-IN')}`)

  // Also check if any transactions have payment_mode_name like 'CASH ' or lowercase or if any CHEQUE/ONLINE were misclassified
  const allRows = await sql`
    SELECT transaction_number, location_name, scrap_type_name, calculated_total, amount_received, payment_mode_name, sold_to
    FROM public.scrap_transactions;
  `

  console.log(`\nTotal DB Rows: ${allRows.length}`)

  await sql.end()
}

main().catch(console.error)
