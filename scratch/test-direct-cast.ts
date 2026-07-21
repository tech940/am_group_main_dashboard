import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  try {
    const res = await sql`
      SELECT invoice_no, invoice_date, invoice_date::date AS direct_cast
      FROM rsa_report
      WHERE invoice_date = '7/17/2026'
    `
    console.log('Direct cast result:', JSON.stringify(res))
  } catch (e: any) {
    console.error('Direct cast ERROR:', e.message)
  }
  await sql.end()
}
main()
