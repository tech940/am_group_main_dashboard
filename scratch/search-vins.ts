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
  const hCount = await sql`SELECT COUNT(*)::int as count FROM hyundai_booking_report`
  console.log(`Hyundai total rows: ${hCount[0].count}`)

  const pCount = await sql`SELECT COUNT(*)::int as count FROM am_platinum_booking_report`
  console.log(`Platinum total rows: ${pCount[0].count}`)

  // Search for any alphanumeric string of length 17 in any row of the tables
  const hVinSearch = await sql`
    SELECT id, order_ref_no, name_of_the_customer
    FROM hyundai_booking_report
    WHERE order_ref_no IS NOT NULL
    LIMIT 10
  `
  console.log('\nHyundai order_ref_no examples:')
  console.table(hVinSearch)

  const pVinSearch = await sql`
    SELECT id, order_ref_no, name_of_the_customer
    FROM am_platinum_booking_report
    WHERE order_ref_no IS NOT NULL
    LIMIT 10
  `
  console.log('\nPlatinum order_ref_no examples:')
  console.table(pVinSearch)

  // Print all columns where the value contains a string of length 17 in the whole table
  const hAnyVin = await sql`
    SELECT id, name_of_the_customer, order_ref_no, customer_id
    FROM hyundai_booking_report
    LIMIT 10
  `
  console.log('\nHyundai sample IDs & order_ref_nos:')
  console.table(hAnyVin)

  const pAnyVin = await sql`
    SELECT id, name_of_the_customer, order_ref_no, customer_id
    FROM am_platinum_booking_report
    LIMIT 10
  `
  console.log('\nPlatinum sample IDs & order_ref_nos:')
  console.table(pAnyVin)

  await sql.end()
}

main().catch(console.error)
