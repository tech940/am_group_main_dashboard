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
  console.log('=== HYUNDAI SAMPLE ROW ===\n')
  const hyundaiRow = await sql`
    SELECT * 
    FROM hyundai_booking_report
    LIMIT 1
  `
  console.log(JSON.stringify(hyundaiRow[0] || {}, null, 2))

  console.log('\n=== AM PLATINUM SAMPLE ROW ===\n')
  const platinumRow = await sql`
    SELECT * 
    FROM am_platinum_booking_report
    LIMIT 1
  `
  console.log(JSON.stringify(platinumRow[0] || {}, null, 2))

  // Let's also check if there are columns that look like VINs in other rows
  const hyundaiVins = await sql`
    SELECT order_ref_no, name_of_the_customer, model, variant, color
    FROM hyundai_booking_report
    WHERE order_ref_no IS NOT NULL AND LENGTH(order_ref_no) >= 10
    LIMIT 5
  `
  console.log('\nHyundai VIN samples:')
  console.table(hyundaiVins)

  const platinumVins = await sql`
    SELECT order_ref_no, name_of_the_customer, model, variant, color
    FROM am_platinum_booking_report
    WHERE order_ref_no IS NOT NULL AND LENGTH(order_ref_no) >= 10
    LIMIT 5
  `
  console.log('\nPlatinum VIN samples:')
  console.table(platinumVins)

  await sql.end()
}

main().catch(console.error)
