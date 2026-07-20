import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Migrating database for ED Approval in Petty Cash...')

    // 1. Update petty_cash_request_status enum values
    const requestStatuses = ['ed_pending', 'ed_approved', 'ed_on_hold', 'ed_rejected']
    for (const statusVal of requestStatuses) {
      try {
        await sql.unsafe(`ALTER TYPE petty_cash_request_status ADD VALUE IF NOT EXISTS '${statusVal}'`)
        console.log(`Added '${statusVal}' to petty_cash_request_status enum`)
      } catch (e) {
        console.log(`Enum value '${statusVal}' issue:`, e)
      }
    }

    // 2. Update petty_cash_expense_status enum values
    const expenseStatuses = ['ed_pending', 'ed_approved', 'ed_rejected']
    for (const statusVal of expenseStatuses) {
      try {
        await sql.unsafe(`ALTER TYPE petty_cash_expense_status ADD VALUE IF NOT EXISTS '${statusVal}'`)
        console.log(`Added '${statusVal}' to petty_cash_expense_status enum`)
      } catch (e) {
        console.log(`Enum value '${statusVal}' issue:`, e)
      }
    }

    // 3. Add columns to petty_cash_requests table
    await sql.unsafe(`
      ALTER TABLE petty_cash_requests 
      ADD COLUMN IF NOT EXISTS ed_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS ed_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ed_remarks TEXT;
    `)
    console.log('Added ED approval columns to petty_cash_requests')

    // 4. Add columns to petty_cash_expenses table
    await sql.unsafe(`
      ALTER TABLE petty_cash_expenses 
      ADD COLUMN IF NOT EXISTS ed_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS ed_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ed_remarks TEXT;
    `)
    console.log('Added ED approval columns to petty_cash_expenses')

    console.log('Migration completed successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
