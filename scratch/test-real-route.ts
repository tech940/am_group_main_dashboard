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

async function testSafeDateRoute() {
  console.log('--- Testing Safe Date Casting Query for demo-cars-list ---')

  try {
    const safeDate = (col: string) => `
      CASE
        WHEN NULLIF(TRIM(${col}::text), '') IS NULL THEN NULL::date
        WHEN TRIM(${col}::text) ~ '^\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}' THEN TO_DATE(TRIM(${col}::text), 'DD/MM/YYYY')
        WHEN TRIM(${col}::text) ~ '^\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}' THEN TO_DATE(TRIM(${col}::text), 'YYYY-MM-DD')
        ELSE NULL::date
      END
    `

    const rawSql = `
      WITH raw AS (
        SELECT
          COALESCE(NULLIF(TRIM(id::text), ''), '-') AS id,
          UPPER(TRIM(vin_no::text)) AS vehicle_key,
          COALESCE(NULLIF(TRIM(vin_no::text), ''), '-') AS vin_no,
          COALESCE(NULLIF(TRIM(model::text), ''), '-') AS model,
          COALESCE(NULLIF(TRIM(variant::text), ''), '-') AS variant,
          COALESCE(NULLIF(TRIM(color::text), ''), '-') AS color,
          COALESCE(NULLIF(TRIM(cust_name::text), ''), '-') AS name,
          COALESCE(NULLIF(TRIM(main_dealer::text), ''), '-') AS main_dealer,
          COALESCE(NULLIF(TRIM(transporter_name::text), ''), '-') AS transporter_name,
          ${safeDate('kin_invoice_date')} AS kin_invoice_date,
          COALESCE(NULLIF(TRIM(kin_invoice_amount::text), ''), '-') AS amount,
          ${safeDate('retail_date')} AS retail_date,
          CASE
            WHEN ${safeDate('retail_date')} IS NULL THEN NULL::int
            ELSE GREATEST((CURRENT_DATE - ${safeDate('retail_date')}), 0)::int
          END AS age,
          NULL::text AS registration_number,
          COALESCE(NULLIF(TRIM(billing_dealer_code::text), ''), '-') AS billing_dealer_code,
          CASE
            WHEN COALESCE(NULLIF(TRIM(billing_dealer_code::text), ''), '-') = 'JK402' THEN 'Jammu'
            WHEN COALESCE(NULLIF(TRIM(billing_dealer_code::text), ''), '-') = 'JK501' THEN 'Udhampur'
            ELSE COALESCE(NULLIF(COALESCE(NULLIF(TRIM(billing_dealer_code::text), ''), '-'), '-'), 'Other')
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
      ),
      vehicle_details AS (
        SELECT
          vehicle_key,
          registration_number,
          tracker_status,
          service_date,
          current_reading_kms,
          on_road_price,
          vehicle_status,
          sold_amount,
          remarks,
          updated_by_name,
          updated_at
        FROM demo_vehicle_details
      ),
      enriched AS (
        SELECT
          latest_vehicle.*,
          COALESCE(NULLIF(vehicle_details.registration_number, ''), latest_vehicle.registration_number) AS display_registration_number,
          vehicle_details.tracker_status,
          vehicle_details.service_date,
          vehicle_details.current_reading_kms,
          vehicle_details.on_road_price,
          vehicle_details.vehicle_status,
          vehicle_details.sold_amount,
          vehicle_details.remarks,
          vehicle_details.updated_by_name AS details_updated_by,
          vehicle_details.updated_at AS details_updated_at
        FROM latest_vehicle
        LEFT JOIN vehicle_details ON vehicle_details.vehicle_key = latest_vehicle.vehicle_key
      ),
      filtered AS (
        SELECT *
        FROM enriched
        WHERE 1 = 1
      ),
      paged AS (
        SELECT *
        FROM filtered
        ORDER BY age DESC NULLS LAST, location ASC, model ASC, variant ASC, vin_no ASC
        LIMIT 10 OFFSET 0
      ),
      counts AS (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE billing_dealer_code = 'JK402')::int AS jammu,
          COUNT(*) FILTER (WHERE billing_dealer_code = 'JK501')::int AS udhampur,
          COUNT(*) FILTER (WHERE details_updated_at IS NOT NULL)::int AS with_details
        FROM enriched
      ),
      filtered_count AS (
        SELECT COUNT(*)::int AS total_rows
        FROM filtered
      ),
      source_freshness AS (
        SELECT MAX(uploaded_at) AS source_updated_at
        FROM raw
      )
      SELECT
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'vehicleKey', vehicle_key,
          'vin', vin_no,
          'model', model,
          'variant', variant,
          'color', color,
          'name', name,
          'mainDealer', main_dealer,
          'transporterName', transporter_name,
          'invoiceDate', kin_invoice_date,
          'amount', amount,
          'retailDate', retail_date,
          'age', age,
          'registrationNumber', display_registration_number,
          'billingDealerCode', billing_dealer_code,
          'location', location,
          'trackerStatus', tracker_status,
          'serviceDate', service_date,
          'currentReadingKms', current_reading_kms,
          'onRoadPrice', on_road_price,
          'vehicleStatus', vehicle_status,
          'soldAmount', sold_amount,
          'remarks', remarks,
          'detailsUpdatedBy', details_updated_by,
          'detailsUpdatedAt', details_updated_at
        ) ORDER BY age DESC NULLS LAST, location ASC, model ASC, variant ASC, vin_no ASC) FROM paged), '[]'::jsonb) AS rows,
        (SELECT total_rows FROM filtered_count) AS total_rows,
        (SELECT source_updated_at FROM source_freshness) AS source_updated_at,
        (SELECT jsonb_build_object(
          'total', total,
          'jammu', jammu,
          'udhampur', udhampur,
          'withDetails', with_details
        ) FROM counts) AS summary
    `

    const res = await sql.unsafe(rawSql)
    console.log('QUERY SUCCEEDED PERFECTLY!')
    console.log('Total rows returned:', res[0].total_rows)
    console.log('Summary:', res[0].summary)
    console.log('Rows count:', res[0].rows ? res[0].rows.length : 0)
    console.log('Sample Vehicle 0:', res[0].rows ? res[0].rows[0] : null)

  } catch (err) {
    console.error('QUERY FAILED WITH ERROR:', err)
  } finally {
    await sql.end()
  }
}

testSafeDateRoute()
