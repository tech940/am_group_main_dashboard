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
  console.log('=== INSPECTING COLUMNS FOR HYUNDAI BOOKING REPORT ===\n')
  const hyundaiCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'hyundai_booking_report'
  `
  console.log('Hyundai Columns:', hyundaiCols.map(c => `${c.column_name} (${c.data_type})`))

  console.log('\n=== INSPECTING COLUMNS FOR AM PLATINUM BOOKING REPORT ===\n')
  const platinumCols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'am_platinum_booking_report'
  `
  console.log('Platinum Columns:', platinumCols.map(c => `${c.column_name} (${c.data_type})`))

  await sql.end()
}

main().catch(console.error)
