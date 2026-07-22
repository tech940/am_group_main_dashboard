import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const rows = await sql`
    SELECT payment_mode_name, COUNT(*) as txn_count, SUM(amount_received) as total_received, SUM(calculated_total) as total_valuation
    FROM public.scrap_transactions
    GROUP BY payment_mode_name
    ORDER BY total_received DESC;
  `

  console.log('--- EXACT PAYMENT MODE BREAKDOWN IN DATABASE ---')
  console.table(rows)

  // Also check if any payment_mode_name values have unusual strings
  const distinctModes = await sql`SELECT DISTINCT payment_mode_name FROM public.scrap_transactions;`
  console.log('Distinct Payment Modes:', distinctModes.map(r => r.payment_mode_name))

  await sql.end()
}

main().catch(console.error)
