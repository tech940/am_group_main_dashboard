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
  
  const expenses = await sql`
    SELECT e.id, e.expense_number, e.branch_id, e.department, e.amount, e.status, e.particulars, e.created_at, b.name as branch_name, b.code as branch_code
    FROM petty_cash_expenses e
    LEFT JOIN branches b ON b.id = e.branch_id
    ORDER BY e.created_at DESC
    LIMIT 20
  `
  console.log('Expenses:', JSON.stringify(expenses, null, 2))

  const branches = await sql`SELECT * FROM branches`
  console.log('Branches:', JSON.stringify(branches, null, 2))

  await sql.end()
}

main().catch(console.error)
