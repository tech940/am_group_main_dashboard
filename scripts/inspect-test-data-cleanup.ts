import 'dotenv/config'
import postgres from 'postgres'

async function inspect() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('=== 1. DELEGATION TASKS ===')
    const tasks = await sql`SELECT id, title, created_at FROM delegation_tasks ORDER BY created_at DESC LIMIT 50`
    console.log(`Found ${tasks.length} delegation tasks:`)
    console.dir(tasks, { depth: null })

    console.log('\n=== 2. VENDOR PAYMENTS (kia_approval_requests) ===')
    const payments = await sql`SELECT id, name, vendor_name, amount, created_at FROM kia_approval_requests ORDER BY created_at DESC LIMIT 50`
    console.log(`Found ${payments.length} vendor payments:`)
    console.dir(payments, { depth: null })

    console.log('\n=== 3. TARGET VENDORS (vendors) ===')
    const targetVendors = await sql`
      SELECT id, vendor_code, name, email, phone, gst_number, created_at, deleted_at 
      FROM vendors 
      WHERE vendor_code IN ('V-001', 'V-002', 'V-003') 
         OR name ILIKE '%sahil%' 
         OR name ILIKE '%sahi%'
    `
    console.log(`Found ${targetVendors.length} target vendors:`)
    console.dir(targetVendors, { depth: null })

  } finally {
    await sql.end({ timeout: 5 })
  }
}

inspect().catch(console.error)
