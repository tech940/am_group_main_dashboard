import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString, {
  connect_timeout: 30,
  idle_timeout: 20,
  max: 1,
})

async function main() {
  console.log('Testing Fuel Approvals workflow...')

  // Find a test user (e.g. developer or admin)
  const [testUser] = await sql`SELECT id, full_name, email, role FROM users LIMIT 1`
  if (!testUser) {
    throw new Error('No user found in database to test with')
  }
  console.log('Using test user:', testUser.full_name, '(', testUser.email, ')')

  const testRequestNumber = `KIA-FUEL-TEST-${Date.now().toString().slice(-6)}`

  // 1. Insert initial fuel approval request
  console.log('\n--- 1. Testing Submission (Location: KIA BANIHAL) ---')
  const [inserted] = await sql`
    INSERT INTO fuel_approvals (
      request_number,
      brand,
      location,
      fuel_required_for,
      veh_reg_no,
      vin_no,
      fuel_type,
      current_km_reading,
      fuel_filled_date,
      fuel_filled_ltrs,
      fuel_slip_url,
      remarks,
      status,
      current_stage,
      submitted_by_id,
      submitted_by_name,
      submitted_by_email,
      history
    ) VALUES (
      ${testRequestNumber},
      'kia',
      'KIA BANIHAL',
      'DEMO',
      'Sonet G1.2 5MT Gravity-WHITE-PETROL-JK02DN0880',
      '672868',
      'PETROL',
      '212',
      CURRENT_DATE,
      7.00,
      'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/purchase-orders/fuel-slips/test.png',
      'Test fuel requisition for Banihal branch demo car',
      'ed_pending',
      'ed',
      ${testUser.id},
      ${testUser.full_name},
      ${testUser.email},
      '[{"action":"SUBMIT","stage":"submitter","remarks":"Initial test submission"}]'::jsonb
    )
    RETURNING id, request_number, status, current_stage, location;
  `
  console.log('Created record:', inserted)
  if (inserted.status !== 'ed_pending' || inserted.current_stage !== 'ed') {
    throw new Error('Initial status should be ed_pending')
  }

  // 2. ED Approval -> advance to hr_pending
  console.log('\n--- 2. Testing ED Approval Stage ---')
  const [edApproved] = await sql`
    UPDATE fuel_approvals
    SET
      status = 'hr_pending',
      current_stage = 'hr',
      ed_approved_by = ${testUser.id},
      ed_approved_by_name = ${testUser.full_name},
      ed_approved_at = NOW(),
      ed_remarks = 'ED Approved - verified demo car allocation'
    WHERE id = ${inserted.id}
    RETURNING id, status, current_stage, ed_approved_by_name, ed_remarks;
  `
  console.log('After ED Approval:', edApproved)
  if (edApproved.status !== 'hr_pending' || edApproved.current_stage !== 'hr') {
    throw new Error('Expected status hr_pending after ED approval')
  }

  // 3. HR Approval -> advance to md_pending
  console.log('\n--- 3. Testing HR Approval Stage ---')
  const [hrApproved] = await sql`
    UPDATE fuel_approvals
    SET
      status = 'md_pending',
      current_stage = 'md',
      hr_approved_by = ${testUser.id},
      hr_approved_by_name = ${testUser.full_name},
      hr_approved_at = NOW(),
      hr_remarks = 'HR Approved - verified driver & vehicle policy'
    WHERE id = ${inserted.id}
    RETURNING id, status, current_stage, hr_approved_by_name, hr_remarks;
  `
  console.log('After HR Approval:', hrApproved)
  if (hrApproved.status !== 'md_pending' || hrApproved.current_stage !== 'md') {
    throw new Error('Expected status md_pending after HR approval')
  }

  // 4. MD Approval -> advance to approved (completed)
  console.log('\n--- 4. Testing MD Approval Stage (Final) ---')
  const [mdApproved] = await sql`
    UPDATE fuel_approvals
    SET
      status = 'approved',
      current_stage = 'completed',
      md_approved_by = ${testUser.id},
      md_approved_by_name = ${testUser.full_name},
      md_approved_at = NOW(),
      md_remarks = 'MD Approved'
    WHERE id = ${inserted.id}
    RETURNING id, status, current_stage, md_approved_by_name, md_remarks;
  `
  console.log('After MD Final Approval:', mdApproved)
  if (mdApproved.status !== 'approved' || mdApproved.current_stage !== 'completed') {
    throw new Error('Expected status approved after MD approval')
  }

  // 5. Clean up test record
  await sql`DELETE FROM fuel_approvals WHERE id = ${inserted.id}`
  console.log('\nTest record cleaned up successfully.')

  console.log('\n===========================================')
  console.log('ALL FUEL APPROVAL WORKFLOW TESTS PASSED!')
  console.log('===========================================')

  await sql.end()
}

main().catch((err) => {
  console.error('Workflow test failed:', err)
  process.exit(1)
})
