import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  console.log('====================================================')
  console.log('1. MONTH-WISE POLICY COUNT & YOY (Jan 2025 - Present)')
  console.log('====================================================')
  const monthly = rows(await db.execute(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        id,
        policy_no,
        policy_issue_date::date AS issue_date,
        to_char(policy_issue_date::date, 'YYYY-MM') AS ym,
        gross_premium::numeric AS gross_premium,
        policy_type,
        chassis_no
      FROM hyundai_insurance_policy_summary
      WHERE policy_issue_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT ym, 
           COUNT(*) as total_policies,
           COUNT(*) FILTER (WHERE UPPER(policy_type) = 'NEW') as new_count,
           COUNT(*) FILTER (WHERE UPPER(policy_type) = 'RENEWAL') as renewal_count,
           COUNT(*) FILTER (WHERE UPPER(policy_type) = 'ROLLOVER') as rollover_count,
           SUM(gross_premium) as total_gross_premium
    FROM deduped
    WHERE ym >= '2025-01'
    GROUP BY ym
    ORDER BY ym ASC
  `))
  console.table(monthly)

  console.log('====================================================')
  console.log('2. RENEWAL DEPTH / VINTAGE PER CHASSIS')
  console.log('====================================================')
  const vintage = rows(await db.execute(sql`
    WITH vehicle_policies AS (
      SELECT 
        chassis_no,
        policy_no,
        policy_issue_date::date AS issue_date,
        ROW_NUMBER() OVER (PARTITION BY chassis_no ORDER BY policy_issue_date::date ASC, id ASC) as policy_sequence
      FROM (
        SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
          id, chassis_no, policy_no, policy_issue_date
        FROM hyundai_insurance_policy_summary
        WHERE chassis_no IS NOT NULL AND TRIM(chassis_no) != ''
        ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
      ) sub
      WHERE policy_issue_date IS NOT NULL
    )
    SELECT 
      CASE 
        WHEN policy_sequence = 1 THEN '1st Policy (New)'
        WHEN policy_sequence = 2 THEN '1st Renewal (2nd Year)'
        WHEN policy_sequence = 3 THEN '2nd Renewal (3rd Year)'
        WHEN policy_sequence = 4 THEN '3rd Renewal (4th Year)'
        WHEN policy_sequence = 5 THEN '4th Renewal (5th Year)'
        WHEN policy_sequence = 6 THEN '5th Renewal (6th Year)'
        ELSE '6th+ Renewal'
      END AS sequence_tier,
      policy_sequence,
      COUNT(*) as count_policies,
      COUNT(DISTINCT chassis_no) as unique_vehicles
    FROM vehicle_policies
    GROUP BY policy_sequence
    ORDER BY policy_sequence ASC
    LIMIT 10
  `))
  console.table(vintage)

  console.log('====================================================')
  console.log('3. EXPIRY & RETENTION (1 YEAR OUT: 2025 Expired vs Renewed)')
  console.log('====================================================')
  const expiryCohorts = rows(await db.execute(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        id,
        chassis_no,
        policy_no,
        policy_issue_date::date AS issue_date,
        od_expiry_date::date AS expiry_date,
        gross_premium::numeric AS gross_premium
      FROM hyundai_insurance_policy_summary
      WHERE chassis_no IS NOT NULL AND TRIM(chassis_no) != '' AND od_expiry_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    with_next AS (
      SELECT 
        id,
        chassis_no,
        expiry_date,
        issue_date,
        to_char(expiry_date, 'YYYY-MM') AS expiry_month,
        gross_premium,
        LEAD(issue_date) OVER (PARTITION BY chassis_no ORDER BY issue_date ASC) AS next_issue_date
      FROM deduped
    ),
    evaluated AS (
      SELECT 
        expiry_month,
        expiry_date,
        gross_premium,
        (next_issue_date IS NOT NULL AND next_issue_date <= expiry_date + INTERVAL '90 days') AS renewed_within_window,
        (next_issue_date IS NOT NULL AND next_issue_date > expiry_date + INTERVAL '90 days' AND next_issue_date <= expiry_date + INTERVAL '730 days') AS comeback_later
      FROM with_next
      WHERE expiry_date >= '2025-01-01' AND expiry_date <= '2026-06-30'
    )
    SELECT 
      expiry_month,
      COUNT(*) as expired_policies,
      COUNT(*) FILTER (WHERE renewed_within_window) as renewed_count,
      COUNT(*) FILTER (WHERE NOT renewed_within_window) as lapsed_count,
      ROUND(COUNT(*) FILTER (WHERE renewed_within_window)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as retention_pct,
      COUNT(*) FILTER (WHERE comeback_later) as comeback_count
    FROM evaluated
    GROUP BY expiry_month
    ORDER BY expiry_month ASC
  `))
  console.table(expiryCohorts)

  console.log('====================================================')
  console.log('4. UPCOMING EXPIRIES (Next 30 Days from Current Date)')
  console.log('====================================================')
  const upcoming = rows(await db.execute(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text))
        id,
        chassis_no,
        customer_name,
        veh_regist_no,
        model_name,
        od_expiry_date::date AS expiry_date,
        gross_premium::numeric AS gross_premium,
        insurance_company,
        sub_user as branch,
        rm_name
      FROM hyundai_insurance_policy_summary
      WHERE od_expiry_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(TRIM(policy_no), ''), 'row:' || id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COUNT(*) as total_upcoming,
           SUM(gross_premium) as premium_at_risk,
           MIN(expiry_date) as earliest_expiry,
           MAX(expiry_date) as latest_expiry
    FROM deduped
    WHERE expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
  `))
  console.table(upcoming)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

