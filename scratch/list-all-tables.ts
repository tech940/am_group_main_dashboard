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
  console.log('=== ALL TABLES IN DB ===\n')

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND (table_name LIKE '%hyundai%' OR table_name LIKE '%platinum%')
    ORDER BY table_name
  `
  console.table(tables)

  await sql.end()
}

main().catch(console.error)
