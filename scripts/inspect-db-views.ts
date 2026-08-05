import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectDbViews() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  // List all schemas and views in postgres
  const views = await sql`
    SELECT table_schema, table_name 
    FROM information_schema.views 
    WHERE table_name LIKE '%cre%' OR table_name LIKE '%call%'
  `
  console.log('--- Views in DB ---')
  console.log(views)

  // List all tables in postgres
  const tables = await sql`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (table_name LIKE '%cre%' OR table_name LIKE '%call%')
  `
  console.log('--- Tables in DB ---')
  console.log(tables)

  await sql.end()
}

inspectDbViews().catch(console.error)
