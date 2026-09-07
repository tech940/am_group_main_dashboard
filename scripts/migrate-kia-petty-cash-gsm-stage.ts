import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Migrating database for KIA Petty Cash GSM -> CEO -> EA -> MD -> Accounts flow...')

    // 1. Add GSM and CEO status values to petty_cash_request_status enum
    const newRequestStatuses = [
      'gsm_pending',
      'gsm_approved',
      'gsm_on_hold',
      'gsm_rejected',
      'ceo_pending',
      'ceo_approved',
      'ceo_on_hold',
      'ceo_rejected',
    ]
    for (const s of newRequestStatuses) {
      try {
        await sql.unsafe(`ALTER TYPE petty_cash_request_status ADD VALUE IF NOT EXISTS '${s}'`)
        console.log(`Added '${s}' to petty_cash_request_status`)
      } catch (e) {
        console.log(`Note for '${s}':`, e)
      }
    }

    // 2. Add GSM and CEO status values to petty_cash_expense_status enum
    const newExpenseStatuses = [
      'gsm_pending',
      'gsm_approved',
      'gsm_rejected',
      'ceo_pending',
      'ceo_approved',
      'ceo_rejected',
    ]
    for (const s of newExpenseStatuses) {
      try {
        await sql.unsafe(`ALTER TYPE petty_cash_expense_status ADD VALUE IF NOT EXISTS '${s}'`)
        console.log(`Added '${s}' to petty_cash_expense_status`)
      } catch (e) {
        console.log(`Note for '${s}':`, e)
      }
    }

    // 3. Add GSM and CEO approval tracking columns to petty_cash_requests
    await sql.unsafe(`
      ALTER TABLE petty_cash_requests
      ADD COLUMN IF NOT EXISTS gsm_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS gsm_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS gsm_remarks TEXT,
      ADD COLUMN IF NOT EXISTS ceo_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS ceo_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ceo_remarks TEXT;
    `)
    console.log('Added GSM and CEO approval columns to petty_cash_requests')

    // 4. Add GSM and CEO approval tracking columns to petty_cash_expenses
    await sql.unsafe(`
      ALTER TABLE petty_cash_expenses
      ADD COLUMN IF NOT EXISTS gsm_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS gsm_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS gsm_remarks TEXT,
      ADD COLUMN IF NOT EXISTS ceo_approved_by UUID REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS ceo_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ceo_remarks TEXT;
    `)
    console.log('Added GSM and CEO approval columns to petty_cash_expenses')

    // 5. Backfill historical records: if ed_approved_by is present, also copy to ceo_approved_by
    await sql.unsafe(`
      UPDATE petty_cash_requests
      SET ceo_approved_by = ed_approved_by,
          ceo_approved_at = ed_approved_at,
          ceo_remarks = ed_remarks
      WHERE ed_approved_by IS NOT NULL AND ceo_approved_by IS NULL;
    `)
    await sql.unsafe(`
      UPDATE petty_cash_expenses
      SET ceo_approved_by = ed_approved_by,
          ceo_approved_at = ed_approved_at,
          ceo_remarks = ed_remarks
      WHERE ed_approved_by IS NOT NULL AND ceo_approved_by IS NULL;
    `)
    console.log('Backfilled historical CEO approvals')

    console.log('Migration completed successfully!')
  } finally {
    await sql.end({ timeout: 2 })
    process.exit(0)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
