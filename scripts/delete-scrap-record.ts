import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd())
import postgres from 'postgres'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('DATABASE_URL is not set in environment!')
  process.exit(1)
}

const sql = postgres(dbUrl, { prepare: false })

async function deleteRecord() {
  console.log('Searching for scrap transaction #SCRAP-2026-0287...')
  
  const deleted = await sql`
    DELETE FROM scrap_transactions 
    WHERE transaction_number ILIKE '%SCRAP-2026-0287%' 
       OR transaction_number ILIKE '%2026-0287%'
       OR transaction_number ILIKE '%0287%'
    RETURNING id, transaction_number, description, amount_received
  `
  
  if (deleted.length > 0) {
    console.log(`Successfully deleted ${deleted.length} record(s):`, deleted)
  } else {
    console.log('No matching record found with transaction_number SCRAP-2026-0273.')
    const recent = await sql`SELECT id, transaction_number FROM scrap_transactions ORDER BY created_at DESC LIMIT 10`
    console.log('Recent 10 records:', recent)
  }
  
  await sql.end()
  process.exit(0)
}

deleteRecord().catch((err) => {
  console.error('Error deleting scrap record:', err)
  process.exit(1)
})
