import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING HYUNDAI DATA FRESHNESS IN DATABASE ===\n')

  const tables = [
    'hyundai_ro_billing_report',
    'hyundai_repair_order_list',
    'hyundai_call_center_complaints',
    'hyundai_operation_wise_analysis_report',
    'hyundai_ew_report',
    'am_hyundai_ro_billing_report',
    'am_hyundai_repair_order_list',
    'am_hyundai_call_center_complaints',
    'am_hyundai_operation_wise_analysis_report',
    'am_hyundai_ew_report',
  ]

  for (const table of tables) {
    try {
      const existsRes = await sql`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = ${table}) AS exists`
      if (!existsRes[0].exists) continue

      const countRes = await sql.unsafe(`
        SELECT 
          COUNT(*)::int AS count, 
          MAX(uploaded_at) AS max_uploaded
        FROM "${table}"
      `)
      console.log(`Table [${table}]: Total Rows=${countRes[0].count}, Max UploadedAt=${countRes[0].max_uploaded}`)

      const colsRes = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`
      const cols = colsRes.map((c: any) => c.column_name)

      // Find date columns
      const dateCols = cols.filter(c => c.includes('date') || c.includes('bill_') || c.includes('r_o_'))
      for (const dCol of dateCols) {
        try {
          const maxD = await sql.unsafe(`SELECT MAX("${dCol}")::text AS max_d FROM "${table}"`)
          console.log(`   ${dCol} Max: ${maxD[0].max_d}`)
        } catch (e: any) {}
      }

      // Check per dealer code
      const dealerCols = cols.filter(c => c.includes('dealer') || c.includes('dlr'))
      console.log(`   Dealer columns: ${dealerCols.join(', ')}`)

      if (dealerCols.length > 0) {
        const primaryDealerCol = dealerCols[0]
        const dealerMax = await sql.unsafe(`
          SELECT "${primaryDealerCol}", MAX(uploaded_at) AS max_up, COUNT(*)::int AS cnt
          FROM "${table}"
          GROUP BY "${primaryDealerCol}"
        `)
        console.log(`   Dealer breakdown:`, JSON.stringify(dealerMax))
      }

      console.log('')
    } catch (err: any) {
      console.error(`Error checking ${table}:`, err.message)
    }
  }

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
