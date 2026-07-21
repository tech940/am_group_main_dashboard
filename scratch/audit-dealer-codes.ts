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
  console.log('=== AUDITING DEALER CODES IN EW, MCP, RSA ===\n')

  console.log('--- EW REPORT ---')
  const ewDealers = await sql`SELECT dealer_code, outlet_code, main_dealer_code, COUNT(*)::int AS cnt FROM ew_report GROUP BY dealer_code, outlet_code, main_dealer_code`
  console.log('EW Dealer breakdown:', JSON.stringify(ewDealers))

  console.log('\n--- MCP REPORT ---')
  const mcpDealers = await sql`SELECT dealer_code, COUNT(*)::int AS cnt FROM mcp_report GROUP BY dealer_code`
  console.log('MCP Dealer breakdown:', JSON.stringify(mcpDealers))

  console.log('\n--- RSA REPORT ---')
  const rsaDealers = await sql`SELECT dealer_workshop_code, dealer_workshop_name, COUNT(*)::int AS cnt FROM rsa_report GROUP BY dealer_workshop_code, dealer_workshop_name`
  console.log('RSA Dealer breakdown:', JSON.stringify(rsaDealers))

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
