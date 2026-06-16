import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'

const url = await pickDatabaseUrl(postgres, '[intake-diag]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const catExpr = `CASE
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%' THEN 'Running Repair'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%' THEN 'Free Service'
  WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%' OR COALESCE(service_type, '') ~* '^[0-9]+K$' THEN 'Paid Service'
  ELSE 'Others' END`

const roDateToday = await db.unsafe(`
  SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
    ro_date::date, bill_date::date, work_type, service_type, bill_no, ro_no,
    ${catExpr} AS cat
  FROM ro_billing_report
  WHERE ro_date = '${EXPORT}'::date
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ORDER BY cat, jc_key
`)
console.log('=== ro_date today (no dedup) ===')
for (const cat of ['Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair', 'Others']) {
  const rows = roDateToday.filter((r) => r.cat === cat)
  console.log(cat, rows.length, rows)
}

const deduped = await db.unsafe(`
  WITH raw AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date AS report_date, work_type, service_type, uploaded_at, id,
      ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank
    FROM raw
  )
  SELECT cat, COUNT(*) FILTER (WHERE report_date = '${EXPORT}'::date)::int AS today, COUNT(*)::int AS mtd
  FROM ranked WHERE row_rank = 1 AND cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('\n=== current fetchIntakeCounts logic ===')
console.log(deduped)

const billTodayNotRo = await db.unsafe(`
  SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
    ro_date::date, bill_date::date, work_type, service_type, ${catExpr} AS cat
  FROM ro_billing_report
  WHERE bill_date = '${EXPORT}'::date AND (ro_date IS NULL OR ro_date <> '${EXPORT}'::date)
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ORDER BY cat
`)
console.log('\n=== bill_date today but ro_date != today ===')
console.log(billTodayNotRo)

const accOpen = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  ),
  ro_keys AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  pending AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key, ro_date::date AS report_date,
      work_type, service_type, vin, reg_no, status, r_o_no
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
        OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT *, jc_key NOT IN (SELECT jc_key FROM ro_keys) AS supplement_eligible FROM pending
`)
console.log('\n=== open accidental (supplement candidates) ===')
console.log(accOpen)

const supplement = await db.unsafe(`
  WITH dealer_keys AS (
    SELECT DISTINCT NULLIF(UPPER(TRIM(COALESCE(rb.vin, ''))), '') AS vin_norm,
      NULLIF(UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))), '') AS reg_norm
    FROM ro_billing_report rb
    WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = '${DEALER}'
      AND ((rb.vin IS NOT NULL AND TRIM(rb.vin) <> '') OR (rb.vehicle_reg_no IS NOT NULL AND TRIM(rb.vehicle_reg_no) <> ''))
  ),
  ro_keys AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ),
  pending AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
      COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key, ro_date::date AS report_date
    FROM open_ro_yearly
    WHERE LOWER(COALESCE(status, '')) = 'open'
      AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
      AND ((NULLIF(TRIM(vin), '') IS NOT NULL AND UPPER(TRIM(vin)) IN (SELECT vin_norm FROM dealer_keys WHERE vin_norm IS NOT NULL))
        OR (NULLIF(TRIM(reg_no), '') IS NOT NULL AND UPPER(TRIM(reg_no)) IN (SELECT reg_norm FROM dealer_keys WHERE reg_norm IS NOT NULL)))
    ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT
    COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys))::int AS mtd,
    COUNT(*) FILTER (WHERE jc_key NOT IN (SELECT jc_key FROM ro_keys) AND report_date = '${EXPORT}'::date)::int AS today
  FROM pending
`)
console.log('\n=== supplement counts ===', supplement[0])

// MTD gaps: rows excluded by dedup
const dedupLosers = await db.unsafe(`
  WITH raw AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      ro_date::date AS report_date, work_type, service_type, uploaded_at, id,
      ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank
    FROM raw
  )
  SELECT jc_key, report_date, cat, work_type, service_type
  FROM ranked WHERE row_rank > 1 AND cat IN ('Paid Service','Running Repair','Accidental Repair')
  ORDER BY cat, jc_key, report_date
`)
console.log('\n=== dedup losers (earlier ro_date same jc_key) ===')
console.log(dedupLosers)

const accTodayEither = await db.unsafe(`
  SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
    ro_date::date, bill_date::date, work_type, service_type
  FROM ro_billing_report
  WHERE UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
    AND (ro_date = '${EXPORT}'::date OR bill_date = '${EXPORT}'::date)
  ORDER BY ro_date, bill_date
`)
console.log('\n=== accidental ro_date OR bill_date today ===')
console.log(accTodayEither)

const openAccToday = await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, vin, reg_no, status
  FROM open_ro_yearly
  WHERE LOWER(COALESCE(status, '')) = 'open' AND ro_date = '${EXPORT}'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
`)
console.log('\n=== open accidental ro_date=today (all dealers) ===')
console.log(openAccToday)

// Hypothesis: intake today = bill_date today (like delivered but count not sum)
const intakeByBillToday = await db.unsafe(`
  WITH raw AS (
    SELECT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
      bill_date::date AS report_date, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE bill_date >= '${MONTH}'::date AND bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC) AS row_rank FROM raw
  )
  SELECT cat, COUNT(*) FILTER (WHERE report_date = '${EXPORT}'::date)::int AS today, COUNT(*)::int AS mtd
  FROM ranked WHERE row_rank = 1 AND cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('\n=== intake if using bill_date ===')
console.log(intakeByBillToday)

const openAccTodayAny = await db.unsafe(`
  SELECT r_o_no, ro_date::date, work_type, vin, reg_no, status, uploaded_at::date
  FROM open_ro_yearly
  WHERE ro_date = '${EXPORT}'::date
    AND (LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')
  ORDER BY status, r_o_no
`)
console.log('\n=== open accidental ro_date=today ANY status ===')
console.log(openAccTodayAny)

// Intake today hybrid: ro_date today + bill_date today where ro_date <> today (per category)
const hybridToday = await db.unsafe(`
  WITH ro_today AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date = '${EXPORT}'::date
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  bill_supplement AS (
    SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE bill_date = '${EXPORT}'::date AND (ro_date IS NULL OR ro_date <> '${EXPORT}'::date)
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  ),
  combined AS (
    SELECT jc_key, cat FROM ro_today
    UNION
    SELECT jc_key, cat FROM bill_supplement WHERE cat IN ('Paid Service', 'Accidental Repair')
  )
  SELECT cat, COUNT(*)::int AS today FROM combined
  WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('\n=== hybrid today: ro_date + bill supplement paid/accidental ===')
console.log(hybridToday)

const noDedupMtd = await db.unsafe(`
  WITH tagged AS (
    SELECT ro_date::date, ${catExpr} AS cat
    FROM ro_billing_report
    WHERE ro_date >= '${MONTH}'::date AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
      AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
  )
  SELECT cat,
    COUNT(*) FILTER (WHERE ro_date = '${EXPORT}'::date)::int AS today,
    COUNT(*)::int AS mtd
  FROM tagged
  WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
  GROUP BY cat ORDER BY cat
`)
console.log('\n=== MTD without jc_key dedup ===')
console.log(noDedupMtd)

await db.end()
