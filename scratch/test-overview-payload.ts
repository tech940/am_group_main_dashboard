import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'

// Mock the imports or replicate overview build
const startDate = '2026-06-01'
const endDate = '2026-06-24'

// Let's write a simple script that queries the database directly with the exact same queries used in overview route for dealerCode = null
async function main() {
  console.log('Testing overview queries for ALL LOCATIONS...')
  
  // 1. EW count query
  const ewStart = Date.now()
  try {
    const res = await db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(
            NULLIF(TRIM(certi_no), ''),
            NULLIF(CONCAT_WS(
              '|',
              NULLIF(TRIM(vin), ''),
              NULLIF(TRIM(scheme_desc), ''),
              reg_date::text,
              COALESCE(hml_amt, 0)::text
            ), ''),
            id::text
          )
        )
          id
        FROM hyundai_ew_report
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
        ORDER BY
          COALESCE(
            NULLIF(TRIM(certi_no), ''),
            NULLIF(CONCAT_WS(
              '|',
              NULLIF(TRIM(vin), ''),
              NULLIF(TRIM(scheme_desc), ''),
              reg_date::text,
              COALESCE(hml_amt, 0)::text
            ), ''),
            id::text
          ),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT COUNT(*)::int AS count
      FROM dedup
    `)
    console.log(`EW query success: ${res[0]?.count} (took ${Date.now() - ewStart}ms)`)
  } catch (err) {
    console.error('EW query failed:', err)
  }

  // 2. RSA count query
  const rsaStart = Date.now()
  try {
    const res = await db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(
            NULLIF(TRIM(invoice_no), ''),
            CONCAT_WS(
              '|',
              NULLIF(TRIM(vin_chasis_no), ''),
              NULLIF(TRIM(policy_name), ''),
              invoice_date::text,
              COALESCE(total_amount, 0)::text
            ),
            id::text
          )
        )
          invoice_date,
          COALESCE(NULLIF(regexp_replace(total_amount::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS total_amount
        FROM am_hyundai_rsa_report
        WHERE invoice_date >= ${startDate}::date
          AND invoice_date < (${endDate}::date + INTERVAL '1 day')
        ORDER BY
          COALESCE(
            NULLIF(TRIM(invoice_no), ''),
            CONCAT_WS(
              '|',
              NULLIF(TRIM(vin_chasis_no), ''),
              NULLIF(TRIM(policy_name), ''),
              invoice_date::text,
              COALESCE(total_amount, 0)::text
            ),
            id::text
          ),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_amount), 0)::float AS amount
      FROM dedup
    `)
    console.log(`RSA query success: count=${res[0]?.count}, amount=${res[0]?.amount} (took ${Date.now() - rsaStart}ms)`)
  } catch (err) {
    console.error('RSA query failed:', err)
  }

  // 3. MCP query
  const mcpStart = Date.now()
  try {
    const res = await db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(
            NULLIF(TRIM(package_purchase_no), ''),
            CONCAT_WS(
              '|',
              NULLIF(TRIM(vin), ''),
              NULLIF(TRIM(package_name), ''),
              package_purchase_date::text,
              COALESCE(package_amount, 0)::text
            ),
            id::text
          )
        )
          id
        FROM am_hyundai_mcp_report
        WHERE package_purchase_date >= ${startDate}::date
          AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
        ORDER BY
          COALESCE(
            NULLIF(TRIM(package_purchase_no), ''),
            CONCAT_WS(
              '|',
              NULLIF(TRIM(vin), ''),
              NULLIF(TRIM(package_name), ''),
              package_purchase_date::text,
              COALESCE(package_amount, 0)::text
            ),
            id::text
          ),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT COUNT(*)::int AS count
      FROM dedup
    `)
    console.log(`MCP query success: ${res[0]?.count} (took ${Date.now() - mcpStart}ms)`)
  } catch (err) {
    console.error('MCP query failed:', err)
  }
}

main().catch(console.error).finally(() => db.end({ timeout: 5 }))
