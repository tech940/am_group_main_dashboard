/**
 * Diagnostic script to find the actual Postgres error in the Business Excellence overview query.
 * Run with: npx tsx scripts/diagnose-be-overview.ts
 */
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const connectionString = process.env.ANALYTICS_DATABASE_URL || process.env.DATABASE_URL || ''
if (!connectionString) {
  console.error('❌ No DATABASE_URL or ANALYTICS_DATABASE_URL found in env')
  process.exit(1)
}

const client = postgres(connectionString, { max: 1 })
const db = drizzle(client)

const startDate = '2026-07-01'
const endDate = '2026-07-30'

async function run() {
  console.log('=== Step 1: Check kia_open_ro_yearly table/view exists ===')
  try {
    const check = await db.execute(sql`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_name = 'kia_open_ro_yearly'
        AND table_schema = 'public'
    `)
    console.log('Table/view check:', JSON.stringify(check.rows))
  } catch (err) {
    console.error('Error checking table:', err)
  }

  console.log('\n=== Step 2: Check columns in kia_open_ro_yearly ===')
  try {
    const cols = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'kia_open_ro_yearly'
        AND table_schema = 'public'
      ORDER BY ordinal_position
    `)
    const rows = cols.rows as Record<string, string>[]
    if (rows.length === 0) {
      console.log('WARNING: No columns found — view may not exist in public schema, checking kia_facts...')
      const cols2 = await db.execute(sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'open_ro_yearly'
          AND table_schema = 'kia_facts'
        ORDER BY ordinal_position
      `)
      const cols2Rows = cols2.rows as Record<string, string>[]
      console.log('kia_facts.open_ro_yearly columns:', cols2Rows.map(r => `${r.column_name} (${r.data_type})`).join(', '))
    } else {
      console.log('Columns:', rows.map(r => `${r.column_name} (${r.data_type})`).join(', '))
      // Check for specific columns needed by the query
      const colNames = rows.map(r => r.column_name)
      const needed = ['r_o_no', 'ro_date', 'service_adv', 'work_type', 'service_type', 'status',
        'revised_promise_date_time', 'promise_date_time', 'uploaded_at', 'dealer_code', 'id']
      const missing = needed.filter(c => !colNames.includes(c))
      if (missing.length > 0) {
        console.log('MISSING COLUMNS:', missing.join(', '))
      } else {
        console.log('All required columns present')
      }
    }
  } catch (err) {
    console.error('Error checking columns:', err)
  }

  console.log('\n=== Step 3: Try simplified open RO query ===')
  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt, MIN(ro_date)::text AS min_date, MAX(ro_date)::text AS max_date
      FROM kia_open_ro_yearly
      WHERE LOWER(TRIM(COALESCE(status::text, ''))) IN ('open', 'close', 'closed')
        AND ro_date >= ${startDate}::date
        AND ro_date < (${endDate}::date + INTERVAL '1 day')
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), ''))) IN ('JK402')
    `)
    console.log('Simplified query OK:', JSON.stringify(result.rows[0]))
  } catch (err) {
    console.error('Simplified query FAILED:', err)
  }

  console.log('\n=== Step 4: Try active CTE without NOT EXISTS ===')
  try {
    const result = await db.execute(sql`
      WITH active AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
          COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
          ro_date,
          service_adv,
          work_type,
          service_type,
          status,
          COALESCE(revised_promise_date_time, promise_date_time) AS promise_date,
          uploaded_at
        FROM kia_open_ro_yearly
        WHERE LOWER(TRIM(COALESCE(status::text, ''))) IN ('open', 'close', 'closed')
          AND ro_date >= ${startDate}::date
          AND ro_date < (${endDate}::date + INTERVAL '1 day')
          AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), ''))) IN ('JK402')
        ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COUNT(*)::int AS cnt FROM active
    `)
    console.log('active CTE (no NOT EXISTS) OK:', JSON.stringify(result.rows[0]))
  } catch (err) {
    console.error('active CTE FAILED:', err)
  }

  console.log('\n=== Step 5: Try with NOT EXISTS subquery ===')
  try {
    const result = await db.execute(sql`
      WITH active AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
          COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
          ro_date,
          service_adv,
          work_type,
          service_type,
          status,
          COALESCE(revised_promise_date_time, promise_date_time) AS promise_date,
          uploaded_at
        FROM kia_open_ro_yearly
        WHERE LOWER(TRIM(COALESCE(status::text, ''))) IN ('open', 'close', 'closed')
          AND ro_date >= ${startDate}::date
          AND ro_date < (${endDate}::date + INTERVAL '1 day')
          AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), ''))) IN ('JK402')
          AND NOT EXISTS (
            SELECT 1
            FROM kia_ro_billing_report rb
            WHERE rb.bill_date < (${endDate}::date + INTERVAL '1 day')
              AND LOWER(TRIM(COALESCE(rb.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
              AND UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, ''), ''))) IN ('JK402')
              AND COALESCE(NULLIF(rb.ro_no, ''), NULLIF(rb.bill_no, ''), rb.id::text)
                = COALESCE(NULLIF(kia_open_ro_yearly.r_o_no, ''), kia_open_ro_yearly.id::text)
          )
        ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COUNT(*)::int AS cnt FROM active
    `)
    console.log('Full active CTE OK:', JSON.stringify(result.rows[0]))
  } catch (err) {
    console.error('Full active CTE FAILED:', err)
  }

  console.log('\n=== Step 6: Try enriched CTE (full overview query) ===')
  try {
    const result = await db.execute(sql`
      WITH active AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
          COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
          ro_date,
          service_adv,
          work_type,
          service_type,
          status,
          COALESCE(NULLIF(revised_promise_date_time, ''), NULLIF(promise_date_time, ''))::timestamp AS promise_date,
          uploaded_at
        FROM kia_open_ro_yearly
        WHERE LOWER(TRIM(COALESCE(status::text, ''))) IN ('open', 'close', 'closed')
          AND ro_date >= ${startDate}::date
          AND ro_date < (${endDate}::date + INTERVAL '1 day')
          AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), ''))) IN ('JK402')
          AND NOT EXISTS (
            SELECT 1
            FROM kia_ro_billing_report rb
            WHERE rb.bill_date < (${endDate}::date + INTERVAL '1 day')
              AND LOWER(TRIM(COALESCE(rb.bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
              AND UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, ''), ''))) IN ('JK402')
              AND COALESCE(NULLIF(rb.ro_no, ''), NULLIF(rb.bill_no, ''), rb.id::text)
                = COALESCE(NULLIF(kia_open_ro_yearly.r_o_no, ''), kia_open_ro_yearly.id::text)
          )
        ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      enriched AS (
        SELECT
          *,
          GREATEST((${endDate}::date - ro_date)::int, 0) AS aging_days,
          CASE
            WHEN (${endDate}::date - ro_date)::int <= 4 THEN '0-4D'
            WHEN (${endDate}::date - ro_date)::int <= 7 THEN '5-7D'
            WHEN (${endDate}::date - ro_date)::int <= 15 THEN '8-15D'
            ELSE '>15D'
          END AS aging_bucket,
          CASE
            WHEN LOWER(TRIM(COALESCE(work_type::text, ''))) LIKE '%accident%'
              OR LOWER(TRIM(COALESCE(work_type::text, ''))) LIKE '%bodyshop%' THEN 'Accidental Repair'
            WHEN LOWER(TRIM(COALESCE(work_type::text, ''))) LIKE '%running%' THEN 'Running Repair'
            WHEN LOWER(TRIM(COALESCE(work_type::text, ''))) LIKE '%free%' THEN 'Free Service'
            WHEN LOWER(TRIM(COALESCE(work_type::text, ''))) LIKE '%paid%' THEN 'Paid Service'
            ELSE 'Others'
          END AS service_category,
          CASE
            WHEN promise_date IS NOT NULL AND ${endDate}::date > promise_date THEN 'Delayed'
            ELSE 'On Track'
          END AS delay_status
        FROM active
      )
      SELECT
        COUNT(*)::int AS total_open_ro,
        COALESCE(AVG(aging_days), 0)::float AS avg_aging,
        COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15,
        COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed
      FROM enriched
    `)
    console.log('Full enriched CTE OK:', JSON.stringify(result.rows[0]))
  } catch (err) {
    console.error('Enriched CTE FAILED:', err)
  }

  await client.end()
  console.log('\nDone.')
}

run().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
