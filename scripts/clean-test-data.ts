import 'dotenv/config'
import postgres from 'postgres'

async function cleanTestData() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const sql = postgres(url, { max: 1, prepare: false })

  try {
    console.log('Starting test data cleanup...')

    // 1. Clean Delegation Tasks with USER trigger bypass
    console.log('Clearing delegation tasks & activity log...')
    await sql.unsafe(`
      ALTER TABLE delegation_task_activity DISABLE TRIGGER USER;
      DELETE FROM delegation_task_activity;
      DELETE FROM delegation_tasks;
      ALTER TABLE delegation_task_activity ENABLE TRIGGER USER;
    `)
    console.log('Successfully cleared delegation tasks & activity log.')

    // 2. Clean Vendor Payments (kia_approval_requests)
    console.log('Deleting vendor payments (kia_approval_requests)...')
    const deletedPayments = await sql`DELETE FROM kia_approval_requests`
    console.log(`Deleted ${deletedPayments.count} vendor payment requests`)

    // 3. Remove the 3 target vendors from vendors table
    console.log('Removing 3 target vendors (V-001, V-002, V-003)...')
    const deletedVendors = await sql`
      DELETE FROM vendors 
      WHERE vendor_code IN ('V-001', 'V-002', 'V-003') 
         OR name ILIKE '%sahil%' 
         OR name ILIKE '%sahi%'
    `
    console.log(`Deleted ${deletedVendors.count} target vendors`)

    console.log('Test data cleanup completed successfully!')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

cleanTestData().catch((err) => {
  console.error('Cleanup failed:', err)
  process.exit(1)
})
