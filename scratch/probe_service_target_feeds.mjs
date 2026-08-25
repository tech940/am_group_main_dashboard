import 'dotenv/config'
import postgres from 'postgres'

const url = (process.env.DATABASE_URL || '').replace(':6543', ':5432').replace(/([?&])pgbouncer=true&?/, '$1')
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' })

const TABLES = ['kia_ro_billing_report', 'hyundai_ro_billing_report', 'am_platinum_ro_billing_report']
const WANT = new Set([
  'bill_date', 'labour_amt', 'part_amt', 'total_amt', 'work_type', 'service_type',
  'dealer_code', 'source_dealer_code', 'main_dealer_code', 'bill_status', 'bill_type',
  'bill_no', 'ro_no', 'r_o_no', 'uploaded_at', 'id',
])

console.log('==================== 1. COLUMN TYPES ====================')
for (const t of TABLES) {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${t}
    ORDER BY ordinal_position`
  if (!cols.length) { console.log(`\n### ${t}: TABLE NOT FOUND in public schema`); continue }
  console.log(`\n### ${t}  (${cols.length} cols total)`)
  for (const c of cols) {
    if (WANT.has(c.column_name)) {
      console.log(`   ${c.column_name.padEnd(20)} ${c.data_type.padEnd(28)} null=${c.is_nullable}`)
    }
  }
  const present = new Set(cols.map((c) => c.column_name))
  const missing = [...WANT].filter((w) => !present.has(w))
  console.log(`   MISSING of interest: ${missing.join(', ') || 'none'}`)
}

console.log('\n\n==================== 2. work_type DISTINCT VALUES (last 3 months) ====================')
const specs = [
  { brand: 'kia', table: 'kia_ro_billing_report', statusCol: 'bill_status', statusExpr: sql`LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')` },
  { brand: 'hyundai', table: 'hyundai_ro_billing_report', statusCol: 'bill_type', statusExpr: sql`LOWER(TRIM(COALESCE(bill_type::text,''))) NOT LIKE '%cancel%'` },
  { brand: 'platinum', table: 'am_platinum_ro_billing_report', statusCol: 'bill_type', statusExpr: sql`LOWER(TRIM(COALESCE(bill_type::text,''))) NOT LIKE '%cancel%'` },
]

// Shared category CASE. KIA has no ^[0-9]+K$ arm; Hyundai/Platinum do. Probe BOTH so the delta shows.
const catBase = sql`
  CASE
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%'
      OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'Accidental Repair'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%running%' THEN 'Running Repair'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%free%' THEN 'Free Service'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%paid%' THEN 'Paid Service'
    ELSE 'Others'
  END`
const catWithK = sql`
  CASE
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%accident%'
      OR LOWER(COALESCE(work_type::text,'')) LIKE '%bodyshop%' THEN 'Accidental Repair'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%running%' THEN 'Running Repair'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%free%' THEN 'Free Service'
    WHEN LOWER(COALESCE(work_type::text,'')) LIKE '%paid%'
      OR COALESCE(work_type::text,'') ~* '^[0-9]+K$' THEN 'Paid Service'
    ELSE 'Others'
  END`

for (const s of specs) {
  const t = sql.unsafe(s.table)
  const rows = await sql`
    SELECT COALESCE(work_type::text,'(null)') AS wt,
           COUNT(*)::int AS n,
           ${catBase} AS cat_base,
           ${catWithK} AS cat_k
    FROM ${t}
    WHERE bill_date >= '2026-05-01'::date AND bill_date < '2026-08-01'::date
    GROUP BY 1,3,4 ORDER BY 2 DESC LIMIT 30`
  console.log(`\n### ${s.brand} (${s.table}) work_type values, bill_date May-Jul 2026:`)
  for (const r of rows) {
    const flag = r.cat_base !== r.cat_k ? `   <-- DIFFERS: base=${r.cat_base} withK=${r.cat_k}` : ''
    console.log(`   ${String(r.wt).padEnd(32)} n=${String(r.n).padStart(6)}  -> ${r.cat_k}${flag}`)
  }
}

console.log('\n\n==================== 3. MAX(bill_date) per brand ====================')
for (const s of specs) {
  const t = sql.unsafe(s.table)
  const [r] = await sql`SELECT MIN(bill_date)::text AS mn, MAX(bill_date)::text AS mx, COUNT(*)::int AS n FROM ${t}`
  console.log(`   ${s.brand.padEnd(10)} min=${r.mn} max=${r.mx} rows=${r.n}`)
}

console.log('\n\n==================== 4. MECH / BODYSHOP / TOTAL LABOUR + RO COUNT, per branch, Jul-2026 ====================')
const START = '2026-07-01', END = '2026-07-31'

// --- KIA: bill-first dedup key, raw dealer_code group (matches lib/targets/actuals.ts fetchKiaService)
{
  const rows = await sql`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no,''), NULLIF(ro_no,''), id::text) AS jc_key,
        ${catBase} AS cat,
        COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS lab,
        COALESCE(NULLIF(regexp_replace(part_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS prt,
        bill_date::date AS d,
        UPPER(BTRIM(COALESCE(dealer_code::text,''))) AS dealer,
        uploaded_at, id
      FROM kia_ro_billing_report
      WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date
        AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn
      FROM raw
    )
    SELECT dealer,
      COUNT(*)::int AS ro_total,
      COUNT(*) FILTER (WHERE cat <> 'Accidental Repair')::int AS ro_mech,
      COUNT(*) FILTER (WHERE cat = 'Accidental Repair')::int AS ro_bs,
      ROUND(SUM(lab))::bigint AS lab_total,
      ROUND(SUM(lab) FILTER (WHERE cat <> 'Accidental Repair'))::bigint AS lab_mech,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat = 'Accidental Repair'),0))::bigint AS lab_bs,
      ROUND(SUM(prt))::bigint AS parts_total
    FROM ranked WHERE rn=1
      AND cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY dealer ORDER BY dealer`
  console.log('\n### KIA (dedup bill_no->ro_no->id, active bill_status, 4 canonical categories)')
  console.table(rows)
}

// --- Hyundai + Platinum: RO-first dedup, dealer CASE inlined (mirrors the brands' own SQL)
const HY_DEALER = sql`CASE
  WHEN UPPER(BTRIM(COALESCE(NULLIF(source_dealer_code,''), NULLIF(dealer_code,''), NULLIF(main_dealer_code,''), ''))) = '' THEN 'UNMAPPED'
  ELSE UPPER(BTRIM(COALESCE(NULLIF(source_dealer_code,''), NULLIF(dealer_code,''), NULLIF(main_dealer_code,''), '')))
END`

for (const [brand, table] of [['hyundai', 'hyundai_ro_billing_report'], ['platinum', 'am_platinum_ro_billing_report']]) {
  const t = sql.unsafe(table)
  const rows = await sql`
    WITH raw AS (
      SELECT ${HY_DEALER} || ':' || COALESCE(NULLIF(TRIM(r_o_no::text),''), NULLIF(TRIM(bill_no::text),''), id::text) AS jc_key,
        ${catWithK} AS cat,
        COALESCE(labour_amt,0)::numeric AS lab,
        COALESCE(part_amt,0)::numeric AS prt,
        bill_date::date AS d,
        ${HY_DEALER} AS dealer,
        uploaded_at, id
      FROM ${t}
      WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date
        AND LOWER(TRIM(COALESCE(bill_type::text,''))) NOT LIKE '%cancel%'
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(lab+prt) DESC, d DESC, uploaded_at DESC NULLS LAST, id DESC) rn
      FROM raw
    )
    SELECT dealer,
      COUNT(*)::int AS ro_all,
      COUNT(*) FILTER (WHERE cat IN ('Free Service','Paid Service','Running Repair','Accidental Repair'))::int AS ro_canon,
      COUNT(*) FILTER (WHERE cat IN ('Free Service','Paid Service','Running Repair'))::int AS ro_mech,
      COUNT(*) FILTER (WHERE cat = 'Accidental Repair')::int AS ro_bs,
      ROUND(SUM(lab))::bigint AS lab_all,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat IN ('Free Service','Paid Service','Running Repair')),0))::bigint AS lab_mech,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat = 'Accidental Repair'),0))::bigint AS lab_bs,
      ROUND(COALESCE(SUM(lab) FILTER (WHERE cat = 'Others'),0))::bigint AS lab_others
    FROM ranked WHERE rn=1
    GROUP BY dealer ORDER BY dealer`
  console.log(`\n### ${brand} (dedup dealer:r_o_no->bill_no->id, active bill_type, raw dealer codes)`)
  console.table(rows)
}

console.log('\n\n==================== 5. CANCELLED-BILL IMPACT on labour (Jul-2026, brand level) ====================')
for (const s of specs) {
  const t = sql.unsafe(s.table)
  const [r] = await sql`
    SELECT
      ROUND(SUM(COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0)))::bigint AS lab_all_rows,
      ROUND(SUM(COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0)) FILTER (WHERE ${s.statusExpr}))::bigint AS lab_active,
      COUNT(*)::int AS rows_all,
      COUNT(*) FILTER (WHERE ${s.statusExpr})::int AS rows_active
    FROM ${t}
    WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date`
  console.log(`   ${s.brand.padEnd(10)} rows ${r.rows_all} -> active ${r.rows_active} | labour ${r.lab_all_rows} -> active ${r.lab_active}`)
}

console.log('\n\n==================== 6. Others bucket: labour money sitting outside the 4 categories (Jul-2026) ====================')
for (const s of specs) {
  const t = sql.unsafe(s.table)
  const cat = s.brand === 'kia' ? catBase : catWithK
  const rows = await sql`
    SELECT ${cat} AS cat, COUNT(*)::int AS n,
      ROUND(SUM(COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0)))::bigint AS lab
    FROM ${t}
    WHERE bill_date >= ${START}::date AND bill_date <= ${END}::date AND ${s.statusExpr}
    GROUP BY 1 ORDER BY 3 DESC`
  console.log(`\n### ${s.brand} (raw rows, no dedup)`)
  console.table(rows)
}

await sql.end()
