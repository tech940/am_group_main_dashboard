import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString, {
  connect_timeout: 30,
  idle_timeout: 20,
  max: 1,
})

function generateNumber(prefix: string) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.floor(1000 + Math.random() * 9000)
  return `${prefix}-${dateStr}-${rand}`
}

async function main() {
  const result = await sql`
    SELECT a.id, a.allocation_number, a.branch_id, a.allocated_amount, a.spent_amount, a.status, a.notes,
           u.full_name, u.email, u.role::text, u.dealers, u.department
    FROM petty_cash_allocations a
    JOIN users u ON a.allocated_to = u.id
    WHERE a.allocated_to = '39744825-3f88-4f4e-a3c8-6eccfce57571'
  `
  console.log('Verified Allocation for Malik Sharma:\n', result)

  await sql.end()
}

main().catch(console.error)
