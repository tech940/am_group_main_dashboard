import 'dotenv/config'
import postgres from 'postgres'
const url = (process.env.DATABASE_URL || '').replace(':6543', ':5432').replace(/([?&])pgbouncer=true&?/, '$1')
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })

console.log('==================== L. work_type blank / dealer attribution ====================')
{
  const [k] = await sql`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE COALESCE(TRIM(work_type::text),'')='')::int blank,
    COUNT(*) FILTER (WHERE COALESCE(TRIM(dealer_code),'')='')::int no_dealer
    FROM kia_ro_billing_report WHERE bill_date >= '2025-04-01'::date`
  console.log(`   kia      rows=${k.n} blank_work_type=${k.blank} blank_dealer_code=${k.no_dealer}`)
}
for (const [brand, table] of [['hyundai','hyundai_ro_billing_report'],['platinum','am_platinum_ro_billing_report']]) {
  const t = sql.unsafe(table)
  const [r] = await sql`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE COALESCE(TRIM(work_type::text),'')='')::int blank,
    COUNT(*) FILTER (WHERE COALESCE(TRIM(source_dealer_code),'')='')::int no_source,
    COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(source_dealer_code,'')))='ACTIVE')::int active_sentinel
    FROM ${t} WHERE bill_date >= '2025-04-01'::date`
  console.log(`   ${brand.padEnd(8)} rows=${r.n} blank_work_type=${r.blank} blank_source_dealer=${r.no_source} source='ACTIVE'=${r.active_sentinel}`)
}

console.log('\n\n==================== M. FY26+ monthly, RO-dedup basis, brand level (PARTITION includes month) ====================')
const CAT = sql`CASE
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%' OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'BS'
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%running%' OR LOWER(COALESCE(work_type::text,'')) LIKE '%free%'
    OR LOWER(COALESCE(work_type::text,'')) LIKE '%paid%' OR COALESCE(work_type::text,'') ~* '^[0-9]+K$' THEN 'MECH'
  ELSE 'OTHER' END`
for (const [brand, table] of [['hyundai','hyundai_ro_billing_report'], ['platinum','am_platinum_ro_billing_report']]) {
  const t = sql.unsafe(table)
  const rows = await sql`
    WITH base AS (
      SELECT to_char(bill_date,'YYYY-MM') ym,
        COALESCE(NULLIF(UPPER(TRIM(source_dealer_code)),''), NULLIF(UPPER(TRIM(dealer_code)),''),'') || ':' ||
          COALESCE(NULLIF(TRIM(r_o_no),''), NULLIF(TRIM(bill_no),''), id::text) k,
        ${CAT} cat, COALESCE(labour_amt,0)::numeric lab, COALESCE(part_amt,0)::numeric prt,
        bill_date::date d, uploaded_at, id
      FROM ${t} WHERE bill_date >= '2025-04-01'::date AND bill_date < '2026-09-01'::date
    ), r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ym, k ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM base)
    SELECT ym, COUNT(*)::int ro_all, COUNT(*) FILTER (WHERE cat<>'OTHER')::int ro_canon,
      ROUND(SUM(lab))::bigint lab_total,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='MECH'),0))::bigint lab_mech,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='BS'),0))::bigint lab_bs,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='OTHER'),0))::bigint lab_other
    FROM r WHERE rn=1 GROUP BY 1 ORDER BY 1`
  console.log(`\n### ${brand}`); console.table(rows)
}

console.log('\n\n==================== N. Platinum Poonch under the TWO competing dealer expressions (Jul-2026) ====================')
{
  // dealer-filter.ts version: N6828/N6848 -> 'N6828'  (used inside platinumRoBillingRoKeySql -> the dedup KEY)
  const KEYDEALER = sql`CASE
    WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) = 'N6824' THEN 'N6250'
    WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6828','N6848') THEN 'N6828'
    ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) END`
  // dealer-branch.ts version: names, N6848 NOT mapped  (used for the GROUP BY in lib/targets/actuals.ts)
  const GROUPDEALER = sql`CASE
    WHEN COALESCE(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),'')) = 'N5211' THEN 'JAMMU'
    WHEN COALESCE(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),'')) = 'N6250' THEN 'RAJOURI'
    WHEN COALESCE(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),'')) = 'N6828' THEN 'POONCH'
    ELSE COALESCE(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),'')) END`
  const rows = await sql`
    WITH base AS (
      SELECT ${KEYDEALER} || ':' || COALESCE(NULLIF(TRIM(r_o_no),''), NULLIF(TRIM(bill_no),''), id::text) k,
        ${GROUPDEALER} grp, COALESCE(labour_amt,0)::numeric lab, COALESCE(part_amt,0)::numeric prt,
        bill_date::date d, uploaded_at, id
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= '2026-07-01'::date AND bill_date <= '2026-07-31'::date
        AND LOWER(TRIM(COALESCE(bill_type::text,''))) NOT LIKE '%cancel%'
    ), r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY k ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM base)
    SELECT grp, COUNT(*)::int ro, ROUND(SUM(lab))::bigint lab FROM r WHERE rn=1 GROUP BY 1 ORDER BY 1`
  console.log('   Exactly what lib/targets/actuals.ts fetchBrandService produces (key=dealer-filter, group=dealer-branch):')
  console.table(rows)
  const poonch = rows.filter(r => r.grp==='POONCH' || r.grp==='N6848')
  console.log(`   -> POONCH + N6848 both normalise to N6828: ro=${poonch.reduce((a,r)=>a+r.ro,0)} lab=${poonch.reduce((a,r)=>a+Number(r.lab),0)}`)
  console.log('   (Workshop Summary / BE for Poonch reports the SAME set because the dedup key already collapsed N6848 into N6828.)')
}

await sql.end()
