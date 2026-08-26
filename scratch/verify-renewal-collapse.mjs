import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from '../scripts/bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[verify-renewal-collapse]')
const db = postgres(url, {
  ssl: { rejectUnauthorized: false },
  prepare: false,
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
})

async function q(label, text) {
  const r = await db.unsafe(`SET statement_timeout TO '60000ms'; ${text}`)
  const rows = r[1] || r
  console.log(`\n=== ${label} ===`)
  console.table(rows.slice(0, 25))
  return rows
}

// 1. Does od_tenure exist on kia_insurance? What columns are there?
await q('A. kia_insurance columns matching tenure/product/policy/od', `
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='kia_insurance'
    AND (column_name ILIKE '%tenure%' OR column_name ILIKE '%product%'
         OR column_name ILIKE '%policy%' OR column_name ILIKE '%od%'
         OR column_name ILIKE '%vin%' OR column_name ILIKE '%upload%')
  ORDER BY column_name`)

// 2. Row / VIN / policy counts
await q('B. kia_insurance shape', `
  SELECT COUNT(*)::int AS rows,
         COUNT(DISTINCT UPPER(BTRIM(vinno)))::int AS distinct_vins,
         COUNT(DISTINCT policyno)::int AS distinct_policyno,
         COUNT(DISTINCT row_hash)::int AS distinct_row_hash,
         MIN(policy_effective_date) AS min_eff, MAX(policy_expiry_date) AS max_exp
  FROM kia_insurance WHERE COALESCE(vinno,'') <> ''`)

// 3. THE HEADLINE PROBE: VINs with >1 distinct policyno
await q('C. distinct policyno per VIN distribution', `
  WITH per_vin AS (
    SELECT UPPER(BTRIM(vinno)) AS vin,
           COUNT(DISTINCT policyno)::int AS n_pol,
           COUNT(*)::int AS n_rows
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    GROUP BY 1)
  SELECT n_pol, COUNT(*)::int AS vins, SUM(n_rows)::int AS rows
  FROM per_vin GROUP BY 1 ORDER BY 1`)

await q('D. headline numbers', `
  WITH per_vin AS (
    SELECT UPPER(BTRIM(vinno)) AS vin, COUNT(DISTINCT policyno)::int AS n_pol
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    GROUP BY 1)
  SELECT COUNT(*)::int AS insured_vins,
         COUNT(*) FILTER (WHERE n_pol > 1)::int AS vins_multi_policy,
         MAX(n_pol)::int AS max_policies_per_vin
  FROM per_vin`)

// 4. CRITICAL: are the multi-policy VINs real RENEWALS (successive years)
//    or OD+TP companion pairs / same-day corrections?
await q('E. multi-policy VINs: producttype mix on the SAME vin', `
  WITH multi AS (
    SELECT UPPER(BTRIM(vinno)) AS vin
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    GROUP BY 1 HAVING COUNT(DISTINCT policyno) > 1)
  SELECT COUNT(DISTINCT k.vin)::int AS multi_vins,
         COUNT(DISTINCT k.vin) FILTER (WHERE k.n_ptypes > 1)::int AS vins_mixing_producttype,
         COUNT(DISTINCT k.vin) FILTER (WHERE k.n_ptypes = 1)::int AS vins_single_producttype
  FROM (SELECT UPPER(BTRIM(vinno)) AS vin, COUNT(DISTINCT producttype)::int AS n_ptypes
        FROM kia_insurance WHERE UPPER(BTRIM(vinno)) IN (SELECT vin FROM multi)
        GROUP BY 1) k`)

await q('F. producttype breakdown overall', `
  SELECT producttype, COUNT(*)::int AS rows,
         COUNT(DISTINCT UPPER(BTRIM(vinno)))::int AS vins
  FROM kia_insurance GROUP BY 1 ORDER BY 2 DESC`)

await q('G. policytype breakdown overall', `
  SELECT policytype, COUNT(*)::int AS rows,
         COUNT(DISTINCT UPPER(BTRIM(vinno)))::int AS vins
  FROM kia_insurance GROUP BY 1 ORDER BY 2 DESC`)

// 5. Do multi-policy VINs show SUCCESSIVE, NON-OVERLAPPING cover periods (= real renewal)?
await q('H. multi-policy VINs: gap between consecutive policy effective dates', `
  WITH d AS (
    SELECT DISTINCT ON (UPPER(BTRIM(vinno)), policyno)
      UPPER(BTRIM(vinno)) AS vin, policyno, policy_effective_date AS eff, policy_expiry_date AS exp,
      producttype, policytype
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    ORDER BY UPPER(BTRIM(vinno)), policyno, uploaded_at DESC NULLS LAST),
  multi AS (SELECT vin FROM d GROUP BY vin HAVING COUNT(*) > 1),
  seq AS (
    SELECT d.*, LAG(exp) OVER (PARTITION BY vin ORDER BY eff, exp) AS prev_exp
    FROM d WHERE vin IN (SELECT vin FROM multi))
  SELECT
    COUNT(*) FILTER (WHERE prev_exp IS NOT NULL)::int AS successor_policies,
    COUNT(*) FILTER (WHERE prev_exp IS NOT NULL AND eff >= prev_exp - 45)::int AS looks_like_renewal_starts_at_prior_expiry,
    COUNT(*) FILTER (WHERE prev_exp IS NOT NULL AND eff < prev_exp - 45)::int AS overlapping_concurrent_cover,
    ROUND(AVG((eff - prev_exp)) FILTER (WHERE prev_exp IS NOT NULL))::int AS avg_days_eff_minus_prev_exp
  FROM seq`)

await q('I. sample multi-policy VINs (redacted vin tail)', `
  WITH d AS (
    SELECT DISTINCT ON (UPPER(BTRIM(vinno)), policyno)
      UPPER(BTRIM(vinno)) AS vin, policyno, policy_effective_date AS eff,
      policy_expiry_date AS exp, producttype, policytype, grosspremium
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    ORDER BY UPPER(BTRIM(vinno)), policyno, uploaded_at DESC NULLS LAST),
  multi AS (SELECT vin FROM d GROUP BY vin HAVING COUNT(*) > 2)
  SELECT LEFT(d.vin,3)||'...'||RIGHT(d.vin,4) AS vin, LEFT(d.policyno,14) AS pol,
         d.eff, d.exp, d.producttype, d.policytype, d.grosspremium
  FROM d WHERE d.vin IN (SELECT vin FROM multi ORDER BY vin LIMIT 4)
  ORDER BY d.vin, d.eff`)

// 6. Does the OD-only (Addon) predicate still leave multiple policies per VIN?
await q('J. OD-only (producttype=Addon) policies per VIN', `
  WITH per_vin AS (
    SELECT UPPER(BTRIM(vinno)) AS vin, COUNT(DISTINCT policyno)::int AS n_pol
    FROM kia_insurance
    WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> '' AND producttype = 'Addon'
    GROUP BY 1)
  SELECT COUNT(*)::int AS od_vins,
         COUNT(*) FILTER (WHERE n_pol > 1)::int AS od_vins_multi_policy,
         MAX(n_pol)::int AS max_od_policies_per_vin
  FROM per_vin`)

// 7. Is the multi-policy population an upload artefact? Same policyno re-uploaded?
await q('K. rows per (vin, policyno) — snapshot re-upload check', `
  SELECT n_rows, COUNT(*)::int AS vin_policy_pairs FROM (
    SELECT UPPER(BTRIM(vinno)) AS vin, policyno, COUNT(*)::int AS n_rows
    FROM kia_insurance WHERE COALESCE(vinno,'') <> '' AND COALESCE(policyno,'') <> ''
    GROUP BY 1,2) t GROUP BY 1 ORDER BY 1`)

// 8. What DISTINCT ON currently returns vs full history: how many VINs lose rows
await q('L. rows hidden by the current DISTINCT ON collapse', `
  SELECT (SELECT COUNT(DISTINCT (UPPER(BTRIM(vinno)), policyno))
          FROM kia_insurance WHERE COALESCE(vinno,'')<>'' AND COALESCE(policyno,'')<>'')::int AS distinct_vin_policy_pairs,
         (SELECT COUNT(DISTINCT UPPER(BTRIM(vinno)))
          FROM kia_insurance WHERE COALESCE(vinno,'')<>'' AND COALESCE(policyno,'')<>'')::int AS vins_shown_today`)

// 9. Cross-check: do the OTHER insurance tables exist and carry od_tenure + chassis_no?
await q('M. sibling insurance tables', `
  SELECT table_name,
         COUNT(*) FILTER (WHERE column_name='od_tenure')::int AS has_od_tenure,
         COUNT(*) FILTER (WHERE column_name='chassis_no')::int AS has_chassis_no,
         COUNT(*) FILTER (WHERE column_name='policy_no')::int AS has_policy_no
  FROM information_schema.columns
  WHERE table_name IN ('hyundai_insurance_policy_summary','am_platinum_insurance_policy_summary','kia_insurance')
  GROUP BY 1 ORDER BY 1`)

// 10. Any OTHER kia insurance-ish table under a different name?
await q('N. any other insurance-named tables', `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name ILIKE '%insur%' ORDER BY 1`)

await db.end()
