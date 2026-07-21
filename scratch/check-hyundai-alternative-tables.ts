import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== SEARCHING FOR HYUNDAI N5216 DATA IN ALL TABLES ===\n')

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `

  for (const row of tables) {
    const table = row.table_name
    if (table.startsWith('pg_') || table.startsWith('_')) continue

    const colsRes = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${table}`
    const cols = colsRes.map((c: any) => c.column_name)

    const dealerCols = cols.filter(c => c.includes('dealer') || c.includes('dlr') || c.includes('code'))
    if (dealerCols.length === 0) continue

    const uploadedAtCol = cols.includes('uploaded_at') ? 'uploaded_at' : null
    if (!uploadedAtCol) continue

    const whereClauses = dealerCols.map(c => `UPPER(TRIM(COALESCE("${c}"::text, ''))) IN ('N5216', 'N6844', 'N6845', 'N6846', 'N6847', 'N6848')`)
    const whereSql = whereClauses.join(' OR ')

    try {
      const result = await sql.unsafe(`
        SELECT COUNT(*)::int AS cnt, MAX(uploaded_at) AS max_up
        FROM "${table}"
        WHERE ${whereSql}
      `)
      if (result[0].cnt > 0) {
        console.log(`Table [${table}]: N5216 count = ${result[0].cnt}, Max UploadedAt = ${result[0].max_up}`)
      }
    } catch (e: any) {
      // ignore
    }
  }

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
