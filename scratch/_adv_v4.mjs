import postgres from 'postgres'
import dotenv from 'dotenv'
dotenv.config({ path: 'C:/Users/sahil/Downloads/am_group_main_dashboard/.env', quiet:true })
const cs = process.env.DATABASE_URL.replace(':6543', ':5432').replace(/[?&]pgbouncer=true/, '')
const sql = postgres(cs, { connect_timeout: 30, idle_timeout: 20, max: 1, prepare: false })
const S='2026-08-01', E='2026-08-28'

// --- A. tax-inclusive reconciliation
for (const t of ['kia_ro_billing_report','hyundai_ro_billing_report','am_platinum_ro_billing_report']) {
  const r = await sql.unsafe(`
    select
      sum(total_amt)::numeric ttl,
      sum(coalesce(labour_amt,0)+coalesce(part_amt,0))::numeric net,
      sum(coalesce(labour_tax,0)+coalesce(part_tax,0))::numeric tax,
      sum(coalesce(other_amt,0))::numeric oth,
      sum(coalesce(dis_amt,0))::numeric dis,
      sum(coalesce(total_disc,0))::numeric tdisc,
      sum(coalesce(nullif(regexp_replace(round_off::text,'[^0-9.-]','','g'),''),'0')::numeric) ro
    from ${t} where bill_date between '${S}' and '${E}'`)
  const x=r[0]
  const resid = Number(x.ttl)-Number(x.net)-Number(x.tax)
  console.log(t, JSON.stringify(x), 'resid(ttl-net-tax)=', resid.toFixed(2), 'taxrate=', (Number(x.tax)/Number(x.net)*100).toFixed(3)+'%')
}

// --- B. KIA canonical (workshop-summary replica) per dealer, Aug 1-28
const kiaCanon = async (dealer) => {
  const r = await sql.unsafe(`
    WITH raw AS (
      SELECT COALESCE(NULLIF(bill_no,''), NULLIF(ro_no,''), id::text) AS jc_key,
        CASE
          WHEN LOWER(TRIM(COALESCE(work_type::text,''))) LIKE '%accident%' OR LOWER(TRIM(COALESCE(work_type::text,''))) LIKE '%bodyshop%' THEN 'Accidental Repair'
          WHEN LOWER(TRIM(COALESCE(work_type::text,''))) LIKE '%running%' THEN 'Running Repair'
          WHEN LOWER(TRIM(COALESCE(work_type::text,''))) LIKE '%free%' THEN 'Free Service'
          WHEN LOWER(TRIM(COALESCE(work_type::text,''))) LIKE '%paid%' THEN 'Paid Service'
          ELSE 'Others' END AS service_category,
        COALESCE(NULLIF(regexp_replace(labour_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS labour_amt,
        COALESCE(NULLIF(regexp_replace(part_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS part_amt,
        bill_date::date AS report_date, uploaded_at, id
      FROM kia_ro_billing_report
      WHERE bill_date >= '${S}'::date AND bill_date < ('${E}'::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(bill_status::text,''))) NOT IN ('cancel','cancelled','canceled')
        ${dealer ? `AND UPPER(TRIM(COALESCE(NULLIF(dealer_code,''), NULLIF(main_dealer_code,''), ''))) IN ('${dealer}')` : ''}
    ), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY ABS(labour_amt+part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC) rn FROM raw),
    dedup AS (SELECT * FROM ranked WHERE rn=1)
    SELECT COUNT(*)::int ro_count, COALESCE(SUM(labour_amt),0)::float labour, COALESCE(SUM(part_amt),0)::float parts,
           COALESCE(SUM(labour_amt+part_amt),0)::float billing
    FROM dedup WHERE service_category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')`)
  return r[0]
}
console.log('KIA canon JK402', JSON.stringify(await kiaCanon('JK402')))
console.log('KIA canon JK501', JSON.stringify(await kiaCanon('JK501')))
console.log('KIA canon ALL  ', JSON.stringify(await kiaCanon(null)))
await sql.end()
