import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  process.exit(1)
}

const sql = postgres(connectionString)

async function main() {
  console.log('=== CHECKING RSA INVOICE DATE PATTERNS ===\n')

  const patterns = await sql`
    SELECT invoice_date 
    FROM rsa_report 
    ORDER BY uploaded_at DESC 
    LIMIT 30
  `
  console.log('Latest 30 invoice_date values in rsa_report:')
  patterns.forEach(p => console.log(`  "${p.invoice_date}"`))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
