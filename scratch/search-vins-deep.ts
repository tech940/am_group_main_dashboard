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
  console.log('=== SEARCHING ALL COLUMNS IN HYUNDAI BOOKINGS FOR VINs ===\n')

  const rows = await sql`
    SELECT * 
    FROM hyundai_booking_report
  `

  const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/i
  let foundCount = 0

  for (const row of rows) {
    for (const [col, val] of Object.entries(row)) {
      if (typeof val === 'string' && val.length === 17 && vinRegex.test(val)) {
        console.log(`Found potential VIN in row ID ${row.id}, column [${col}]: ${val}`)
        foundCount++
        if (foundCount >= 10) break
      }
    }
    if (foundCount >= 10) break
  }

  console.log(`\n=== SEARCHING ALL COLUMNS IN PLATINUM BOOKINGS FOR VINs ===\n`)
  const rowsPlat = await sql`
    SELECT * 
    FROM am_platinum_booking_report
  `
  let foundCountPlat = 0
  for (const row of rowsPlat) {
    for (const [col, val] of Object.entries(row)) {
      if (typeof val === 'string' && val.length === 17 && vinRegex.test(val)) {
        console.log(`Found potential VIN in row ID ${row.id}, column [${col}]: ${val}`)
        foundCountPlat++
        if (foundCountPlat >= 10) break
      }
    }
    if (foundCountPlat >= 10) break
  }

  // Let's print unique prefix and format of order_ref_no in hyundai_booking_report
  const formats = await sql`
    SELECT LEFT(order_ref_no, 4) as prefix, COUNT(*)::int as count
    FROM hyundai_booking_report
    WHERE order_ref_no IS NOT NULL
    GROUP BY LEFT(order_ref_no, 4)
  `
  console.log('\nHyundai order_ref_no prefixes:')
  console.table(formats)

  // Let's print unique prefix and format of customer_id in hyundai_booking_report
  const custFormats = await sql`
    SELECT LEFT(customer_id, 4) as prefix, COUNT(*)::int as count
    FROM hyundai_booking_report
    WHERE customer_id IS NOT NULL
    GROUP BY LEFT(customer_id, 4)
  `
  console.log('\nHyundai customer_id prefixes:')
  console.table(custFormats)

  await sql.end()
}

main().catch(console.error)
