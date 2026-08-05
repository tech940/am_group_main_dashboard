import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function inspectColumns() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'call_logs'
  `
  console.log('--- call_logs columns ---')
  console.log(cols)

  const sample = await sql`SELECT * FROM call_logs LIMIT 5`
  console.log('--- call_logs sample ---')
  console.log(sample)

  await sql.end()
}

inspectColumns().catch(console.error)
