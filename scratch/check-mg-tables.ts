import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false },
  connect_timeout: 15,
  max: 1,
  prepare: false,
})

async function main() {
  try {
    // 1. Check if ALL required columns exist on mg_price_details
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mg_price_details'
    `
    const colNames = cols.map(c => c.column_name)
    console.log('mg_price_details columns:', colNames.join(', '))

    // 2. Check mg_user_profiles columns
    const ucols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mg_user_profiles'
    `
    console.log('mg_user_profiles columns:', ucols.map(c => c.column_name).join(', '))

    // 3. Check mg_proformas columns
    const pcols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mg_proformas'
    `
    console.log('mg_proformas columns:', pcols.map(c => c.column_name).join(', '))

    // 4. Check all permission tables
    const permTables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'permission%' OR tablename LIKE 'role%' OR tablename LIKE 'user%' ORDER BY tablename`
    console.log('Auth/Permission tables:', permTables.map(t => t.tablename).join(', '))

    // 5. Test the exact SQL queries used in the options API
    console.log('\n--- Testing options API queries ---')
    
    try {
      const priceRows = await sql`SELECT * FROM mg_price_details WHERE LEFT(model, 2) <> '__' ORDER BY model, trim_description`
      console.log('Query 1 (prices): OK, rows:', priceRows.length)
    } catch(e: any) { console.error('Query 1 FAILED:', e.message) }

    try {
      const modelRows = await sql`SELECT DISTINCT model FROM mg_price_details WHERE NULLIF(TRIM(model), '') IS NOT NULL AND LEFT(model, 2) <> '__' ORDER BY model`
      console.log('Query 2 (models): OK, rows:', modelRows.length)
    } catch(e: any) { console.error('Query 2 FAILED:', e.message) }

    try {
      const bankRows = await sql`SELECT DISTINCT COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) AS bank_name, bank_branch FROM mg_price_details WHERE COALESCE(NULLIF(TRIM(bank_name), ''), NULLIF(TRIM(hyp), '')) IS NOT NULL ORDER BY bank_name, bank_branch`
      console.log('Query 3 (banks): OK, rows:', bankRows.length)
    } catch(e: any) { console.error('Query 3 FAILED:', e.message) }

    try {
      const fuelRows = await sql`SELECT DISTINCT fuel_type FROM mg_proformas WHERE deleted_at IS NULL AND NULLIF(TRIM(fuel_type), '') IS NOT NULL ORDER BY fuel_type`
      console.log('Query 4 (fuel): OK, rows:', fuelRows.length)
    } catch(e: any) { console.error('Query 4 FAILED:', e.message) }

    try {
      const colorRows = await sql`SELECT DISTINCT vehicle_color FROM mg_proformas WHERE deleted_at IS NULL AND NULLIF(TRIM(vehicle_color), '') IS NOT NULL ORDER BY vehicle_color`
      console.log('Query 5 (colors): OK, rows:', colorRows.length)
    } catch(e: any) { console.error('Query 5 FAILED:', e.message) }

    // 6. Try ensureMgUserProfile logic
    console.log('\n--- Testing ensureMgUserProfile ---')
    const users = await sql`SELECT id, email, role, brand FROM users LIMIT 5`
    console.log('Users found:', users.length)
    users.forEach(u => console.log(`  ${u.id} | ${u.email} | role=${u.role} | brand=${u.brand}`))

    // Check if any user's email exists in mg_user_profiles
    if (users.length > 0) {
      const email = users[0].email
      const existing = await sql`SELECT * FROM mg_user_profiles WHERE email = ${email}`
      console.log(`Profile for ${email}:`, existing.length > 0 ? 'FOUND' : 'NOT FOUND')

      if (existing.length === 0) {
        // Try to insert
        try {
          await sql`
            INSERT INTO mg_user_profiles (auth_user_id, email, consultant_name, dealer_location, employee_code, status, approver, settings, last_activity_at)
            VALUES (${users[0].id}, ${email}, ${users[0].email}, 'mg', '', 'ACTIVE', false, '{}', NOW())
            RETURNING *
          `
          console.log('INSERT into mg_user_profiles: OK')
        } catch(e: any) { console.error('INSERT FAILED:', e.message) }
      }
    }

  } catch (e: any) {
    console.error('Script error:', e.message)
  }
  await sql.end()
}

main()
