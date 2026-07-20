const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function getDbUrl() {
  const raw = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL
  if (!raw) throw new Error('DATABASE_URL is not configured')
  const url = new URL(raw)
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    url.port = '5432'
    url.searchParams.delete('pgbouncer')
  }
  return url.toString()
}

async function main() {
  const sql = postgres(getDbUrl(), { ssl: { rejectUnauthorized: false }, prepare: false })
  
  console.log('[Map-Admin] Updating petty_cash_requests department to Sales...')
  const r1 = await sql`
    UPDATE petty_cash_requests
    SET department = 'Sales',
        request_form = jsonb_set(COALESCE(request_form, '{}'::jsonb), '{department}', '"Sales"')
    WHERE department ILIKE '%admin%' OR department ILIKE '%aadmin%'
  `
  console.log(`[Map-Admin] Updated ${r1.count} requests.`)

  console.log('[Map-Admin] Updating petty_cash_expenses department to Sales...')
  const r2 = await sql`
    UPDATE petty_cash_expenses
    SET department = 'Sales',
        expense_form = jsonb_set(COALESCE(expense_form, '{}'::jsonb), '{department}', '"Sales"')
    WHERE department ILIKE '%admin%' OR department ILIKE '%aadmin%'
  `
  console.log(`[Map-Admin] Updated ${r2.count} expenses.`)

  console.log('[Map-Admin] Done!')
  await sql.end()
}

main().catch(console.error)
