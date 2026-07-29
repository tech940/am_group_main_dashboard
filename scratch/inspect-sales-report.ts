import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  console.log('=== HYUNDAI SALES REPORT COLUMNS ===\n')
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'hyundai_sales_report'
    ORDER BY column_name
  `
  console.table(cols)

  const sample = await sql`
    SELECT * 
    FROM hyundai_sales_report
    LIMIT 1
  `
  console.log('Hyundai Sales sample row:', JSON.stringify(sample[0] || {}, null, 2))

  await sql.end()
}

main().catch(console.error)
