import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet: true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 60, idle_timeout: 20, max: 1, prepare: false })
const S = '2026-08-01', E = '2026-08-28'

// ---- Canonical Hyundai / Platinum audit replica (NO nvi filter, canonical keys) ----
const canon = async (t, dealerCase) => {
  const r = await sql.unsafe(`
    WITH scoped AS (
      SELECT id, bill_date::date AS bill_date,
        ${dealerCase} AS dealer_code,
        COALESCE(NULLIF(TRIM(r_o_no::text),''), NULLIF(TRIM(bill_no::text),''), id::text) AS ro_part,
        COALESCE(NULLIF(TRIM(bill_no::text),''), NULLIF(TRIM(r_o_no::text),''), id::text) AS inv_part,
        COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS labour_amt,
        COALESCE(NULLIF(regexp_replace(part_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS part_amt,
        uploaded_at
      FROM ${t}
      WHERE bill_date >= '${S}'::date AND bill_date < ('${E}'::date + INTERVAL '1 day')
    ), active AS (SELECT * FROM scoped),
    ranked AS (SELECT *, ROW_NUMBER() OVER (
        PARTITION BY COALESCE(dealer_code,'UNMAPPED'), COALESCE(dealer_code,'UNMAPPED')||':'||bill_date::text||':'||inv_part
        ORDER BY ABS(labour_amt+part_amt) DESC, uploaded_at DESC NULLS LAST, id DESC) rr FROM active),
    dedup AS (SELECT * FROM ranked WHERE rr=1)
    SELECT COUNT(*)::int deduped_invoices,
      COUNT(DISTINCT COALESCE(dealer_code,'UNMAPPED')||':'||COALESCE(dealer_code,'UNMAPPED')||':'||ro_part)::int deduped_jc,
      COALESCE(SUM(labour_amt),0)::float labour, COALESCE(SUM(part_amt),0)::float parts,
      COALESCE(SUM(labour_amt+part_amt),0)::float revenue,
      (SELECT COUNT(*)::int FROM scoped) raw_rows
    FROM dedup`)
  return r[0]
}
const HYCASE = `CASE
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5203','N5216','JK402') THEN 'JAMMU'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5701','N6844') THEN 'AKHNOOR'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N5804','N6845') THEN 'KATHUA'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6815','N6846') THEN 'RS_PURA'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6819','N6847') THEN 'VIJAYPUR'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6826','N6828','N6848','JK501') THEN 'BILLAWAR'
  WHEN UPPER(TRIM(COALESCE(source_dealer_code::text,''))) = 'ACTIVE' THEN 'JAMMU'
  ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) END`
const PLCASE = `CASE
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) = 'N6824' THEN 'N6250'
  WHEN COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) IN ('N6828','N6848') THEN 'N6828'
  ELSE COALESCE(NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text,''))),''),'ACTIVE'), NULLIF(UPPER(TRIM(COALESCE(dealer_code::text,''))),''), NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text,''))),'')) END`

console.log('HY canonical audit  ', JSON.stringify(await canon('hyundai_ro_billing_report', HYCASE)))
console.log('PL canonical audit  ', JSON.stringify(await canon('am_platinum_ro_billing_report', PLCASE)))

// ---- N6848 cross-feed overlap ----
console.log('--- N6848 Aug per feed ---')
console.log('HY', JSON.stringify((await sql`select count(*)::int n, sum(coalesce(labour_amt,0)+coalesce(part_amt,0))::float net from hyundai_ro_billing_report where source_dealer_code='N6848' and bill_date between ${S} and ${E}`)[0]))
console.log('PL', JSON.stringify((await sql`select count(*)::int n, sum(coalesce(labour_amt,0)+coalesce(part_amt,0))::float net from am_platinum_ro_billing_report where source_dealer_code='N6848' and bill_date between ${S} and ${E}`)[0]))
console.log('--- cross-feed identical (bill_no,bill_date,vin) 2026 ---')
console.log(JSON.stringify(await sql`
  select count(*)::int n from hyundai_ro_billing_report h
  join am_platinum_ro_billing_report pl
    on h.bill_no = pl.bill_no and h.bill_date = pl.bill_date and coalesce(h.vin,'')=coalesce(pl.vin,'')
  where h.bill_date >= '2026-01-01'`))
console.log('--- cross-feed shared VIN 2026 (distinct vins) ---')
console.log(JSON.stringify(await sql`
  select count(distinct h.vin)::int shared_vins from hyundai_ro_billing_report h
  where h.bill_date >= '2026-01-01' and h.vin is not null and h.vin <> ''
    and exists (select 1 from am_platinum_ro_billing_report pl where pl.vin = h.vin and pl.bill_date >= '2026-01-01')`))
console.log('--- N6848 sample both feeds ---')
console.log('HY', JSON.stringify(await sql`select bill_no, bill_date::text, vin, customer_name, main_dealer_code from hyundai_ro_billing_report where source_dealer_code='N6848' and bill_date >= '2026-08-01' order by bill_date desc limit 5`))
console.log('PL', JSON.stringify(await sql`select bill_no, bill_date::text, vin, customer_name, main_dealer_code from am_platinum_ro_billing_report where source_dealer_code='N6848' and bill_date >= '2026-08-01' order by bill_date desc limit 5`))
await sql.end()
