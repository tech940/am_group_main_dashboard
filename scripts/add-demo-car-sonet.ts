import 'dotenv/config'
import crypto from 'node:crypto'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { listDemoVehiclesForGatePass, lookupByVin } from '../lib/gate-pass/vehicles'

async function main() {
  const vin = 'MZBFB813LRN483436'
  const regNo = 'JK02CR0880'
  const model = 'SONET'
  const variant = 'SONET D1.5 6 MT GRAVITY'
  const dealerCode = 'JK402' // JAMMU
  const color = 'CLEAR WHITE'
  const rowHash = crypto.createHash('sha256').update(`demo-car-${vin}-${Date.now()}`).digest('hex')

  console.log(`=== Adding Demo Car: ${model} (${regNo}) VIN: ${vin} ===\n`)

  // 1. Insert / Upsert into kia_demo_car_list
  const existingInFeed = await analyticsExecute<Record<string, unknown>>(sql`
    SELECT id, vin_no FROM kia_demo_car_list WHERE UPPER(TRIM(vin_no::text)) = ${vin}
  `)

  if (existingInFeed.length > 0) {
    console.log(`VIN ${vin} already exists in kia_demo_car_list. Updating...`)
    await analyticsExecute(sql`
      UPDATE kia_demo_car_list
      SET
        model = ${model},
        variant = ${variant},
        test_drive_vin = 'YES',
        billing_dealer_code = ${dealerCode},
        main_dealer = ${dealerCode},
        dealer = ${dealerCode},
        order_dealer = ${dealerCode},
        stock_status = 'Test Drive',
        uploaded_at = NOW()
      WHERE UPPER(TRIM(vin_no::text)) = ${vin}
    `)
  } else {
    console.log(`Inserting new record into kia_demo_car_list...`)
    await analyticsExecute(sql`
      INSERT INTO kia_demo_car_list (
        row_hash,
        vin_no,
        model,
        variant,
        color,
        exterior_color_name,
        test_drive_vin,
        billing_dealer_code,
        main_dealer,
        dealer,
        order_dealer,
        stock_status,
        uploaded_at
      ) VALUES (
        ${rowHash},
        ${vin},
        ${model},
        ${variant},
        ${color},
        ${color},
        'YES',
        ${dealerCode},
        ${dealerCode},
        ${dealerCode},
        ${dealerCode},
        'Test Drive',
        NOW()
      )
    `)
  }
  console.log('✓ kia_demo_car_list updated.')

  // 2. Insert / Upsert into demo_vehicle_details
  const existingDetails = await analyticsExecute<Record<string, unknown>>(sql`
    SELECT id, vehicle_key FROM demo_vehicle_details WHERE UPPER(TRIM(vehicle_key::text)) = ${vin}
  `)

  if (existingDetails.length > 0) {
    console.log(`VIN ${vin} already exists in demo_vehicle_details. Updating...`)
    await analyticsExecute(sql`
      UPDATE demo_vehicle_details
      SET
        registration_number = ${regNo},
        vehicle_status = 'active',
        updated_at = NOW()
      WHERE UPPER(TRIM(vehicle_key::text)) = ${vin}
    `)
  } else {
    console.log(`Inserting new record into demo_vehicle_details...`)
    await analyticsExecute(sql`
      INSERT INTO demo_vehicle_details (
        vehicle_key,
        vin,
        registration_number,
        vehicle_status,
        tracker_status,
        current_reading_kms,
        created_at,
        updated_at
      ) VALUES (
        ${vin},
        ${vin},
        ${regNo},
        'active',
        'not_installed',
        '0',
        NOW(),
        NOW()
      )
    `)
  }
  console.log('✓ demo_vehicle_details updated.')

  // 3. Verification through gate-pass vehicle resolver
  console.log('\n=== Verifying through listDemoVehiclesForGatePass ===')
  const vehicle = await lookupByVin(vin)
  console.log('Resolved Vehicle for Gate Pass:')
  console.log(JSON.stringify(vehicle, null, 2))

  if (vehicle && vehicle.vin === vin && vehicle.registrationNumber === regNo) {
    console.log('\n✓ SUCCESS: Demo car successfully registered and available for Gate Passes!')
  } else {
    console.error('\n✗ Error: Vehicle was not resolved as expected.')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); })
