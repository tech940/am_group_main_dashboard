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
  console.log('=== COLUMN LENGTH ANALYSIS (HYUNDAI BOOKINGS) ===\n')

  const rows = await sql`
    SELECT * 
    FROM hyundai_booking_report
    LIMIT 500
  `
  if (rows.length === 0) {
    console.log('No rows found')
    await sql.end()
    return
  }

  const colLengths: Record<string, { maxLength: number, sampleVal: string }> = {}
  for (const col of Object.keys(rows[0])) {
    colLengths[col] = { maxLength: 0, sampleVal: '' }
  }

  for (const row of rows) {
    for (const [col, val] of Object.entries(row)) {
      if (val !== null && val !== undefined) {
        const str = String(val)
        if (str.length > colLengths[col].maxLength) {
          colLengths[col].maxLength = str.length
          colLengths[col].sampleVal = str.slice(0, 50)
        }
      }
    }
  }

  console.table(colLengths)

  console.log('\n=== COLUMN LENGTH ANALYSIS (AM PLATINUM BOOKINGS) ===\n')

  const rowsPlat = await sql`
    SELECT * 
    FROM am_platinum_booking_report
    LIMIT 500
  `
  const colLengthsPlat: Record<string, { maxLength: number, sampleVal: string }> = {}
  if (rowsPlat.length > 0) {
    for (const col of Object.keys(rowsPlat[0])) {
      colLengthsPlat[col] = { maxLength: 0, sampleVal: '' }
    }
    for (const row of rowsPlat) {
      for (const [col, val] of Object.entries(row)) {
        if (val !== null && val !== undefined) {
          const str = String(val)
          if (str.length > colLengthsPlat[col].maxLength) {
            colLengthsPlat[col].maxLength = str.length
            colLengthsPlat[col].sampleVal = str.slice(0, 50)
          }
        }
      }
    }
    console.table(colLengthsPlat)
  }

  await sql.end()
}

main().catch(console.error)
