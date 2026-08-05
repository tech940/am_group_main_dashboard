import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL!

async function ensureVehicleNumberColumn() {
  const sql = postgres(DATABASE_URL, { max: 1 })

  const cols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'kia_approval_requests' AND column_name = 'vehicle_number'
  `

  if (cols.length === 0) {
    console.log('Adding vehicle_number column to kia_approval_requests table...')
    await sql`ALTER TABLE kia_approval_requests ADD COLUMN IF NOT EXISTS vehicle_number text`
    console.log('vehicle_number column added successfully.')
  } else {
    console.log('vehicle_number column already exists on kia_approval_requests table.')
  }

  // Also check if Driver Expenses is in approvals_common_data
  const driverExp = await sql`
    SELECT id FROM approvals_common_data 
    WHERE category = 'approval_type' AND LOWER(value) = 'driver expenses'
  `
  if (driverExp.length === 0) {
    console.log('Adding Driver Expenses to approvals_common_data...')
    await sql`
      INSERT INTO approvals_common_data (category, value, brand)
      VALUES ('approval_type', 'Driver Expenses', 'all')
    `
    console.log('Driver Expenses added to approvals_common_data.')
  } else {
    console.log('Driver Expenses already exists in approvals_common_data.')
  }

  await sql.end()
}

ensureVehicleNumberColumn().catch(console.error)
