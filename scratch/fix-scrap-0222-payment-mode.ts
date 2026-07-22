import 'dotenv/config'
import postgres from 'postgres'
import fs from 'fs'
import path from 'path'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  console.log('Updating SCRAP-2026-0222 payment_mode_name to ONLINE...')

  // 1. Update DB
  await sql`
    UPDATE public.scrap_transactions
    SET payment_mode_name = 'ONLINE'
    WHERE transaction_number = 'SCRAP-2026-0222';
  `

  console.log('✓ Database table public.scrap_transactions updated!')

  // 2. Update lib/scrap-erp/mock-data.ts
  const mockFilePath = path.join(process.cwd(), 'lib', 'scrap-erp', 'mock-data.ts')
  let content = fs.readFileSync(mockFilePath, 'utf8')

  // Find SCRAP-2026-0222 and change paymentModeName to ONLINE
  const targetRegex = /("transactionNumber":\s*"SCRAP-2026-0222"[\s\S]*?"paymentModeName":\s*")CASH(")/
  if (targetRegex.test(content)) {
    content = content.replace(targetRegex, '$1ONLINE$2')
    fs.writeFileSync(mockFilePath, content, 'utf8')
    console.log('✓ lib/scrap-erp/mock-data.ts updated!')
  } else {
    console.log('Regex match failed in mock-data.ts')
  }

  // Reload schema cache
  try {
    await sql`NOTIFY pgrst, 'reload schema';`
  } catch (e) {}

  // Recalculate totals to confirm exact totals
  const cashRows = await sql`
    SELECT SUM(amount_received) as cash_total
    FROM public.scrap_transactions
    WHERE UPPER(payment_mode_name) = 'CASH';
  `
  const onlineRows = await sql`
    SELECT SUM(amount_received) as online_total
    FROM public.scrap_transactions
    WHERE UPPER(payment_mode_name) = 'ONLINE';
  `

  console.log(`\n--- NEW VERIFIED TOTALS ---`)
  console.log(`Cash Collections Total: ₹${Number(cashRows[0].cash_total).toLocaleString('en-IN')}`)
  console.log(`Online Transfers Total: ₹${Number(onlineRows[0].online_total).toLocaleString('en-IN')}`)

  await sql.end()
}

main().catch(console.error)
