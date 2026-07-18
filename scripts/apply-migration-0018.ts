import 'dotenv/config'
import postgres from 'postgres'

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Ensuring columns `invoice_number` and `invoice_doc_url` in `kia_approval_requests`...')
    
    await sql.unsafe(`
      ALTER TABLE kia_approval_requests 
      ADD COLUMN IF NOT EXISTS invoice_number text,
      ADD COLUMN IF NOT EXISTS invoice_doc_url text
    `)
    
    console.log('Successfully completed migration 0018.')
    process.exit(0)
  } catch (error) {
    console.error('Migration 0018 failed:', error)
    process.exit(1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error('Migration 0018 failed:', error)
  process.exit(1)
})
