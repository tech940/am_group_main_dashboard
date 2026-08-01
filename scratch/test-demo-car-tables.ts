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

async function test() {
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE '%demo_car%';
  `
  console.log('Tables matching %demo_car%:', tables)

  for (const t of tables) {
    const tableName = t.table_name
    const cols = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = ${tableName};
    `
    console.log(`Columns for table '${tableName}':`, cols.map(c => c.column_name))
  }

  await sql.end()
}

test()
