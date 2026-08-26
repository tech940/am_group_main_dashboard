import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from '../scripts/bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[verify-renewal-2]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1, connect_timeout: 15, idle_timeout: 5 })
async function q(label, text) {
  const r = await db.unsafe(`SET statement_timeout TO '60000ms'; ${text}`)
  const rows = r[1] || r
  console.log(`\n=== ${label} ===`); console.table(rows.slice(0, 20)); return rows
}

await q('O. prev_policy_no population — a direct renewal-chain link', `
  SELECT COUNT(*)::int AS rows,
         COUNT(*) FILTER (WHERE COALESCE(BTRIM(prev_policy_no),'') <> '')::int AS prev_filled,
         COUNT(*) FILTER (WHERE policytype='Renewal')::int AS renewal_rows,
         COUNT(*) FILTER (WHERE policytype='Renewal' AND COALESCE(BTRIM(prev_policy_no),'') <> '')::int AS renewal_with_prev
  FROM kia_insurance`)

await q('P. does prev_policy_no actually resolve to a policy we hold?', `
  WITH p AS (SELECT REPLACE(BTRIM(policyno),'\`','') AS pol FROM kia_insurance WHERE COALESCE(policyno,'')<>'')
  SELECT COUNT(*)::int AS rows_with_prev,
         COUNT(*) FILTER (WHERE REPLACE(BTRIM(prev_policy_no),'\`','') IN (SELECT pol FROM p))::int AS prev_resolves_in_table
  FROM kia_insurance WHERE COALESCE(BTRIM(prev_policy_no),'') <> ''`)

await q('Q. LEFT-CENSORING: renewal-typed VINs where we hold only ONE policy', `
  WITH per_vin AS (
    SELECT UPPER(BTRIM(vinno)) AS vin, COUNT(DISTINCT policyno)::int AS n_pol,
           BOOL_OR(policytype='Renewal') AS has_renewal_row
    FROM kia_insurance WHERE COALESCE(vinno,'')<>'' AND COALESCE(policyno,'')<>'' GROUP BY 1)
  SELECT COUNT(*) FILTER (WHERE has_renewal_row)::int AS vins_with_a_renewal_policy,
         COUNT(*) FILTER (WHERE has_renewal_row AND n_pol=1)::int AS renewal_but_no_prior_in_table,
         COUNT(*) FILTER (WHERE has_renewal_row AND n_pol>1)::int AS renewal_with_prior_in_table
  FROM per_vin`)

await q('R. kia_insurance_form_data — what is it?', `
  SELECT COUNT(*)::int AS rows FROM kia_insurance_form_data`)
await q('R2. its columns', `
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='kia_insurance_form_data' ORDER BY ordinal_position LIMIT 40`)

await q('S. does kia_insurance link to the customer key at all, or only VIN?', `
  SELECT column_name FROM information_schema.columns
  WHERE table_name='kia_insurance' AND (column_name ILIKE '%cust%' OR column_name ILIKE '%mobile%'
    OR column_name ILIKE '%phone%' OR column_name ILIKE '%email%') ORDER BY 1`)

await q('T. overlap: insured VINs that are also in kia_sales_report', `
  SELECT COUNT(DISTINCT UPPER(BTRIM(i.vinno)))::int AS insured_vins_with_sales_row
  FROM kia_insurance i
  WHERE EXISTS (SELECT 1 FROM kia_sales_report s WHERE UPPER(BTRIM(s.vin_number))=UPPER(BTRIM(i.vinno)))`)

await db.end()
