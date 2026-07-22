import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_SESSION_URL || process.env.DATABASE_DIRECT_URL || ''
  if (!url) throw new Error('DATABASE_URL not set')
  const sql = postgres(url, { ssl: 'require' })

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name LIKE '%scrap%';
  `

  console.log('Tables matching "scrap":', tables.map((t) => t.table_name))
  await sql.end()
}

main().catch(console.error)
