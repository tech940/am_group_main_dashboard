import 'dotenv/config'
import postgres from 'postgres'
import fs from 'fs'
import path from 'path'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  console.log('Fixing floating point rounding on outstanding balances in PostgreSQL database...')

  // If amount_received is within 1 Rupee of calculated_total, set outstanding_amount = 0
  await sql`
    UPDATE public.scrap_transactions
    SET outstanding_amount = 0
    WHERE ABS(calculated_total - amount_received) < 1.0 OR outstanding_amount < 1.0;
  `

  console.log('✓ Database outstanding amounts updated and clean!')

  // Also clean lib/scrap-erp/mock-data.ts
  const mockFilePath = path.join(process.cwd(), 'lib', 'scrap-erp', 'mock-data.ts')
  let content = fs.readFileSync(mockFilePath, 'utf8')

  // Find all instances where outstandingAmount is < 1.0 and set them to 0
  content = content.replace(/"outstandingAmount":\s*0\.\d+/g, '"outstandingAmount": 0')

  fs.writeFileSync(mockFilePath, content, 'utf8')
  console.log('✓ lib/scrap-erp/mock-data.ts updated!')

  await sql.end()
}

main().catch(console.error)
