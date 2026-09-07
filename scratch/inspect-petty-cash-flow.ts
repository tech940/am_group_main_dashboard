import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  try {
    const enumVals = await sql`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'petty_cash_request_status'
      ORDER BY enumsortorder
    `
    console.log('Request Status Enum:', enumVals.map(r => r.enumlabel))

    const expEnumVals = await sql`
      SELECT enumlabel 
      FROM pg_enum 
      JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
      WHERE pg_type.typname = 'petty_cash_expense_status'
      ORDER BY enumsortorder
    `
    console.log('Expense Status Enum:', expEnumVals.map(r => r.enumlabel))
  } finally {
    await sql.end({ timeout: 2 })
    process.exit(0)
  }
}
main().catch(console.error)
