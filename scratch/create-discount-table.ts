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
  console.log('=== RE-CREATING DISCOUNT APPROVALS TABLE WITH CUSTOMER ID ===\n')

  await sql`DROP TABLE IF EXISTS discount_approvals`

  await sql`
    CREATE TABLE IF NOT EXISTS discount_approvals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT,
      model TEXT,
      variant TEXT,
      color TEXT,
      discount_amount NUMERIC(14, 2) NOT NULL,
      accessories_amount NUMERIC(14, 2),
      tl_manager TEXT,
      delivery_date DATE,
      reference TEXT,
      status TEXT DEFAULT 'PENDING' NOT NULL,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `

  console.log('Table "discount_approvals" re-created successfully!')
  await sql.end()
}

main().catch(console.error)
