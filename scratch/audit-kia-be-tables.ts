import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No POSTGRES_URL or DATABASE_URL found in environment')
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING KIA BUSINESS EXCELLENCE TABLES ===\n')

  const tables = [
    'ew_report',
    'mcp_report',
    'rsa_report',
    'ro_billing_report',
    'open_ro_yearly',
    'kia_call_center_complaints',
    'operation_wise_analysis_report',
    'operation_wise_analysis_advisor_report',
    'adv_wise_lubricants_vas',
    'psf_yearly',
  ]

  for (const table of tables) {
    try {
      const existsRes = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = ${table}
        ) AS exists
      `
      const exists = existsRes[0]?.exists

      if (!exists) {
        console.log(`❌ Table [${table}]: DOES NOT EXIST in database\n`)
        continue
      }

      const countRes = await sql.unsafe(`SELECT COUNT(*)::int AS count, MAX(uploaded_at) AS max_uploaded FROM "${table}"`)
      const count = countRes[0]?.count
      const maxUploaded = countRes[0]?.max_uploaded

      console.log(`✅ Table [${table}]:`)
      console.log(`   Total Rows: ${count}`)
      console.log(`   Latest Uploaded At: ${maxUploaded}`)

      const colsRes = await sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ${table}
      `
      const cols = colsRes.map((c: any) => c.column_name)
      console.log(`   Columns (${cols.length}): ${cols.join(', ')}`)

      if (cols.includes('department')) {
        const deptRes = await sql.unsafe(`
          SELECT department, COUNT(*)::int AS cnt 
          FROM "${table}" 
          GROUP BY department 
          ORDER BY cnt DESC 
          LIMIT 10
        `)
        console.log(`   Department Breakdown:`, JSON.stringify(deptRes))
      }

      const dateCols = cols.filter((c: string) => c.includes('date') || c.includes('time') || c.includes('month') || c.includes('at'))
      for (const dCol of dateCols) {
        if (dCol === 'uploaded_at') continue
        try {
          const rangeRes = await sql.unsafe(`
            SELECT MIN("${dCol}")::text AS min_d, MAX("${dCol}")::text AS max_d 
            FROM "${table}" 
            WHERE "${dCol}" IS NOT NULL
          `)
          console.log(`   Date Range [${dCol}]: ${JSON.stringify(rangeRes[0])}`)
        } catch (e: any) {
          // ignore
        }
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
