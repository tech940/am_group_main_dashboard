import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 3,
  prepare: false,
})

async function main() {
  console.log('Adding missing columns...')
  
  // 1. Add colour to mg_price_details (critical - used in Drizzle select())
  await sql`ALTER TABLE mg_price_details ADD COLUMN IF NOT EXISTS colour text;`
  console.log('  mg_price_details.colour: OK')

  // 2. Add checked_by to mg_proformas
  await sql`ALTER TABLE mg_proformas ADD COLUMN IF NOT EXISTS checked_by text;`
  console.log('  mg_proformas.checked_by: OK')

  // 3. Add email_send_status to mg_proformas
  await sql`ALTER TABLE mg_proformas ADD COLUMN IF NOT EXISTS email_send_status text;`
  console.log('  mg_proformas.email_send_status: OK')

  // Verify
  const priceCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'mg_price_details' ORDER BY ordinal_position`
  console.log('\nmg_price_details columns now:', priceCols.map(c => c.column_name).join(', '))
  
  const profCols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'mg_proformas' ORDER BY ordinal_position`
  console.log('mg_proformas columns now:', profCols.map(c => c.column_name).join(', '))
  
  await sql.end()
  console.log('\nDone.')
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1) })
