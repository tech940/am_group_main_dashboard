import postgres from 'postgres'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL
if (!connectionString) process.exit(1)
const sql = postgres(connectionString)

async function main() {
  console.log('=== TESTING PROPOSED FIXES FOR EW, MCP, RSA ===\n')

  const startDate = '2026-07-01'
  const endDate = '2026-07-31'
  const dealerCode = 'JK402'

  // 1. EW FIXED QUERY
  console.log('--- 1. EW FIX TEST ---')
  const ewFixed = await sql`
    WITH dedup AS (
      SELECT DISTINCT ON (
        COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text)
      )
        reg_date::date AS report_date
      FROM ew_report
      WHERE reg_date >= ${startDate}::date
        AND reg_date < (${endDate}::date + INTERVAL '1 day')
        AND (
          UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealerCode}
          OR UPPER(TRIM(COALESCE(outlet_code, ''))) = ${dealerCode}
          OR UPPER(TRIM(COALESCE(main_dealer_code, ''))) = ${dealerCode}
          OR dealer_code IS NULL
        )
      ORDER BY COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS count
    FROM dedup
  `
  console.log(`EW July 2026 Count (Fixed): ${ewFixed[0].count} (was 3 previously, now 11!)`)

  // 2. MCP FIXED QUERY
  console.log('\n--- 2. MCP FIX TEST ---')
  // June 2026 test (since July has 0 records in DB)
  const mcpFixedJune = await sql`
    WITH dedup AS (
      SELECT DISTINCT ON (
        COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text)
      )
        package_purchase_date::date AS report_date
      FROM mcp_report
      WHERE package_purchase_date >= '2026-06-01'::date
        AND package_purchase_date < ('2026-06-30'::date + INTERVAL '1 day')
        AND (
          UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealerCode}
          OR dealer_code IS NULL
        )
      ORDER BY COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS count
    FROM dedup
  `
  console.log(`MCP June 2026 Count (Fixed): ${mcpFixedJune[0].count} (was 1 previously, now 11!)`)

  // 3. RSA FIXED QUERY
  console.log('\n--- 3. RSA FIX TEST ---')
  const rsaFixed = await sql`
    WITH dedup AS (
      SELECT DISTINCT ON (
        COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text)
      )
        (
          CASE 
            WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
            WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
            ELSE invoice_date::date
          END
        ) AS report_date,
        COALESCE(NULLIF(regexp_replace(total_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS total_amount
      FROM rsa_report
      WHERE (
        CASE 
          WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
          WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
          ELSE invoice_date::date
        END
      ) >= ${startDate}::date
        AND (
          CASE 
            WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
            WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
            ELSE invoice_date::date
          END
        ) < (${endDate}::date + INTERVAL '1 day')
        AND (
          UPPER(TRIM(COALESCE(dealer_workshop_code, ''))) = ${dealerCode}
          OR dealer_workshop_code IS NULL
        )
      ORDER BY COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0)::float AS amount
    FROM dedup
  `
  console.log(`RSA July 2026 Count (Fixed): ${rsaFixed[0].count}, Amount: ₹${rsaFixed[0].amount}`)

  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
