import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== COMPARING HYUNDAI OPEN RO TABLES ===\n')

  const t1Cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'hyundai_repair_order_list'`
  const t2Cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'hyundai_open_ro_yearly'`

  console.log('hyundai_repair_order_list columns:', t1Cols.map((c: any) => c.column_name).join(', '))
  console.log('\nhyundai_open_ro_yearly columns:', t2Cols.map((c: any) => c.column_name).join(', '))

  const sampleT2 = await sql`SELECT * FROM hyundai_open_ro_yearly ORDER BY uploaded_at DESC LIMIT 3`
  console.log('\nhyundai_open_ro_yearly sample rows:', JSON.stringify(sampleT2))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
