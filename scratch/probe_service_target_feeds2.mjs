import 'dotenv/config'
import postgres from 'postgres'

const url = (process.env.DATABASE_URL || '').replace(':6543', ':5432').replace(/([?&])pgbouncer=true&?/, '$1')
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })

const START = '2026-07-01', END = '2026-07-31'

console.log('==================== A. service_advisor column present? ====================')
for (const t of ['kia_ro_billing_report', 'hyundai_ro_billing_report', 'am_platinum_ro_billing_report']) {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${t}
      AND column_name IN ('service_advisor','labour_disc','part_disc','dis_amt','total_disc','model','vin_no','chassis_no')`
  console.log(`   ${t.padEnd(32)} -> ${cols.map(c=>c.column_name).join(', ') || 'NONE'}`)
}

console.log('\n\n==================== B. KIA: advisor-split (BE Executive table) vs work_type split (Workshop Summary) ====================')
{
  const rows = await sql`
    WITH base AS (
      SELECT
        CASE WHEN LOWER(TRIM(COALESCE(service_advisor,''))) IN ('parul bakshi','naresh') THEN 'Accident' ELSE 'MECH' END AS adv_cat,
        CASE
          WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%' OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%running%' THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%free%' THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%paid%' THEN 'Paid Service'
          ELSE 'Others' END AS wt_cat,
        COALESCE(NULLIF(bill_no,''), NULLIF(ro_no,''), id::text) AS jc_key,
        COALESCE(labour_amt,0)::numeric AS lab,
        COALESCE(part_amt,0)::numeric AS prt,
        bill_date::date AS d, uploaded_at, id
      FROM kia_ro_billing_report
      WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date
        AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM base
    )
    SELECT adv_cat, wt_cat, COUNT(*)::int n, ROUND(SUM(lab))::bigint lab
    FROM ranked WHERE rn=1 AND wt_cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY 1,2 ORDER BY 1,2`
  console.table(rows)
  const advAcc = rows.filter(r=>r.adv_cat==='Accident').reduce((a,r)=>a+Number(r.lab),0)
  const wtAcc  = rows.filter(r=>r.wt_cat==='Accidental Repair').reduce((a,r)=>a+Number(r.lab),0)
  console.log(`   ADVISOR 'Accident' labour = ${advAcc}   |   WORK_TYPE 'Accidental Repair' labour = ${wtAcc}`)
}

console.log('\n\n==================== C. KIA dealer_code nulls / mismatch with main_dealer_code ====================')
{
  const rows = await sql`
    SELECT COALESCE(NULLIF(UPPER(TRIM(dealer_code)),''),'(empty)') dc,
           COALESCE(NULLIF(UPPER(TRIM(main_dealer_code)),''),'(empty)') mdc,
           COUNT(*)::int n
    FROM kia_ro_billing_report
    WHERE bill_date >= '2025-04-01'::date
    GROUP BY 1,2 ORDER BY 3 DESC`
  console.table(rows)
}

console.log('\n\n==================== D. Hyundai/Platinum: INVOICE-key dedup (BE metrics) vs RO-key dedup (targets/actuals + workshop summary) ====================')
const HY_DEALER = sql`CASE
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5203','N5216','JK402') THEN 'JAMMU'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5701','N6844') THEN 'AKHNOOR'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5804','N6845') THEN 'KATHUA'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6815','N6846') THEN 'RS_PURA'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6819','N6847') THEN 'VIJAYPUR'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6826','N6828','N6848','JK501') THEN 'BILLAWAR'
  ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),''))
END`

const PL_DEALER = sql`CASE
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) = 'N6824' THEN 'N6250'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6828','N6848') THEN 'N6828'
  ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),''))
END`

const CAT = sql`CASE
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%' OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'Accidental Repair'
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%running%' THEN 'Running Repair'
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%free%' THEN 'Free Service'
  WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%paid%' OR COALESCE(work_type::text,'') ~* '^[0-9]+K$' THEN 'Paid Service'
  ELSE 'Others' END`

for (const [brand, table, dealerExpr] of [['hyundai','hyundai_ro_billing_report',HY_DEALER], ['platinum','am_platinum_ro_billing_report',PL_DEALER]]) {
  const t = sql.unsafe(table)
  const rows = await sql`
    WITH scoped AS (
      SELECT id, bill_date::date AS d, ${dealerExpr} AS dealer, ${CAT} AS cat,
        COALESCE(${dealerExpr},'UNMAPPED') || ':' || bill_date::date::text || ':' || COALESCE(NULLIF(TRIM(bill_no::text),''), NULLIF(TRIM(r_o_no::text),''), id::text) AS invoice_key,
        COALESCE(${dealerExpr},'UNMAPPED') || ':' || COALESCE(NULLIF(TRIM(r_o_no::text),''), NULLIF(TRIM(bill_no::text),''), id::text) AS ro_key,
        COALESCE(labour_amt,0)::numeric AS lab, COALESCE(part_amt,0)::numeric AS prt, uploaded_at
      FROM ${t}
      WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date
        AND LOWER(TRIM(COALESCE(bill_type::text,''))) NOT LIKE '%cancel%'
    ),
    inv AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY dealer, invoice_key ORDER BY ABS(lab+prt) DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM scoped
    ),
    ro AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY ro_key ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM scoped
    )
    SELECT
      (SELECT dealer FROM scoped LIMIT 0) AS _ignore,
      i.dealer,
      i.inv_jc, i.inv_lab,
      r.ro_rows, r.ro_lab, r.ro_lab_mech, r.ro_lab_bs, r.ro_mech, r.ro_bs
    FROM (
      SELECT dealer, COUNT(DISTINCT dealer || ':' || ro_key)::int AS inv_jc, ROUND(SUM(lab))::bigint AS inv_lab
      FROM inv WHERE rn=1 GROUP BY dealer
    ) i
    FULL JOIN (
      SELECT dealer, COUNT(*)::int AS ro_rows, ROUND(SUM(lab))::bigint AS ro_lab,
        ROUND(COALESCE(SUM(lab) FILTER (WHERE cat IN ('Free Service','Paid Service','Running Repair')),0))::bigint AS ro_lab_mech,
        ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='Accidental Repair'),0))::bigint AS ro_lab_bs,
        COUNT(*) FILTER (WHERE cat IN ('Free Service','Paid Service','Running Repair'))::int AS ro_mech,
        COUNT(*) FILTER (WHERE cat='Accidental Repair')::int AS ro_bs
      FROM ro WHERE rn=1 GROUP BY dealer
    ) r ON r.dealer = i.dealer
    ORDER BY 2`
  console.log(`\n### ${brand} Jul-2026, branch-mapped. inv_* = BE metrics basis (invoice dedup), ro_* = workshop-summary/targets basis (RO dedup)`)
  console.table(rows.map(({_ignore, ...rest}) => rest))
}

console.log('\n\n==================== E. Cancelled-bill rows over full history ====================')
for (const [brand, table, expr] of [
  ['kia','kia_ro_billing_report', sql`LOWER(TRIM(COALESCE(bill_status::text,''))) IN ('cancel','cancelled','canceled')`],
  ['hyundai','hyundai_ro_billing_report', sql`LOWER(TRIM(COALESCE(bill_type::text,''))) LIKE '%cancel%'`],
  ['platinum','am_platinum_ro_billing_report', sql`LOWER(TRIM(COALESCE(bill_type::text,''))) LIKE '%cancel%'`],
]) {
  const t = sql.unsafe(table)
  const [r] = await sql`
    SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE ${expr})::int cancelled,
      ROUND(COALESCE(SUM(COALESCE(labour_amt,0)::numeric) FILTER (WHERE ${expr}),0))::bigint cancelled_labour
    FROM ${t} WHERE bill_date >= '2025-04-01'::date`
  console.log(`   ${brand.padEnd(10)} FY26-onward rows=${r.total} cancelled=${r.cancelled} cancelled_labour=${r.cancelled_labour}`)
}

console.log('\n\n==================== F. bill_status / bill_type distinct values ====================')
for (const [brand, table, col] of [
  ['kia','kia_ro_billing_report','bill_status'],
  ['kia','kia_ro_billing_report','bill_type'],
  ['hyundai','hyundai_ro_billing_report','bill_type'],
  ['platinum','am_platinum_ro_billing_report','bill_type'],
]) {
  const t = sql.unsafe(table), c = sql.unsafe(col)
  const rows = await sql`SELECT COALESCE(${c}::text,'(null)') v, COUNT(*)::int n FROM ${t} WHERE bill_date >= '2025-04-01'::date GROUP BY 1 ORDER BY 2 DESC LIMIT 12`
  console.log(`   ${brand}.${col}: ${rows.map(r=>`${r.v}=${r.n}`).join(' | ')}`)
}

console.log('\n\n==================== G. 12-month FY26 series: total labour + RO count per brand (RO-dedup basis) ====================')
{
  const kia = await sql`
    WITH base AS (
      SELECT COALESCE(NULLIF(bill_no,''), NULLIF(ro_no,''), id::text) AS k,
        CASE WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%' OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'BS'
             WHEN LOWER(COALESCE(work_type::text,'')) ~ '(running|free|paid)' THEN 'MECH' ELSE 'OTHER' END AS cat,
        COALESCE(labour_amt,0)::numeric lab, COALESCE(part_amt,0)::numeric prt,
        bill_date::date d, uploaded_at, id
      FROM kia_ro_billing_report
      WHERE bill_date >= '2025-04-01'::date AND bill_date < '2026-09-01'::date
        AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
    ), r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY k ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM base)
    SELECT to_char(d,'YYYY-MM') ym, COUNT(*)::int ro,
      ROUND(SUM(lab))::bigint lab_total,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='MECH'),0))::bigint lab_mech,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat='BS'),0))::bigint lab_bs
    FROM r WHERE rn=1 AND cat<>'OTHER' GROUP BY 1 ORDER BY 1`
  console.log('\n### KIA monthly (FY26 + Apr-Aug26)')
  console.table(kia)
}

await sql.end()
