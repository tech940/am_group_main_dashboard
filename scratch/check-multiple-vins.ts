import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== AUDITING MULTIPLE VEHICLES OF SAME MODEL IN STOCK ===\n')

  const groups = await sql`
    SELECT model, variant, order_dealer, COUNT(*)::int AS count
    FROM kia_stock_management
    GROUP BY model, variant, order_dealer
    HAVING COUNT(*) > 1
    ORDER BY count DESC
  `
  console.log('Multiple Vehicles of Same Model/Variant in Stock:', JSON.stringify(groups, null, 2))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
