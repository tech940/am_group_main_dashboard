import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('No connection string found')
  process.exit(1)
}

const sql = postgres(connectionString)

async function test() {
  console.log('--- Testing kia_demo_car_list queries ---')

  // 1. Check all rows where test_drive_vin = 'YES'
  const yesRows = await sql`
    SELECT 
      id,
      vin_no,
      model,
      variant,
      billing_dealer_code,
      test_drive_vin
    FROM kia_demo_car_list
    WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
      AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL;
  `
  console.log('test_drive_vin = YES count:', yesRows.length)
  console.log('test_drive_vin = YES sample:', yesRows)

  // 2. Check billing_dealer_code for test_drive_vin = 'YES'
  const dealerCodes = await sql`
    SELECT 
      billing_dealer_code, 
      COUNT(*) 
    FROM kia_demo_car_list 
    WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
      AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL
    GROUP BY billing_dealer_code;
  `
  console.log('Dealer codes breakdown for test_drive_vin = YES:', dealerCodes)

  // 3. Test running the exact route SQL for demo-cars-list
  const routeSql = await sql`
    WITH raw AS (
      SELECT
        id::text AS id,
        UPPER(TRIM(vin_no::text)) AS vehicle_key,
        vin_no::text AS vin_no,
        model::text AS model,
        variant::text AS variant,
        color::text AS color,
        cust_name::text AS name,
        main_dealer::text AS main_dealer,
        kin_invoice_date::text AS kin_invoice_date,
        kin_invoice_amount::text AS amount,
        retail_date::date AS retail_date,
        CASE
          WHEN retail_date IS NULL THEN NULL::int
          ELSE GREATEST((CURRENT_DATE - retail_date), 0)::int
        END AS age,
        billing_dealer_code::text AS billing_dealer_code,
        CASE
          WHEN billing_dealer_code = 'JK402' THEN 'Jammu'
          WHEN billing_dealer_code = 'JK501' THEN 'Udhampur'
          ELSE COALESCE(NULLIF(billing_dealer_code, '-'), 'Other')
        END AS location,
        uploaded_at
      FROM kia_demo_car_list
      WHERE UPPER(TRIM(test_drive_vin::text)) = 'YES'
        AND NULLIF(TRIM(vin_no::text), '') IS NOT NULL
    ),
    latest_vehicle AS (
      SELECT DISTINCT ON (vehicle_key)
        *
      FROM raw
      ORDER BY vehicle_key, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*) FROM latest_vehicle;
  `
  console.log('Latest unique vehicle count for demo cars list:', routeSql[0])

  await sql.end()
}

test()
