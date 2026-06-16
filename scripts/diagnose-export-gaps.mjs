import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const EXPORT = '2026-06-15'
const MONTH = '2026-06-01'
const url = await pickDatabaseUrl(postgres, '[export-gaps]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const activeBill = `LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
const accFilter = `(LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%')`
const dealerRb = `UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'`
const dealerOpen = `UPPER(TRIM(COALESCE(dealer_code, ''))) = '${DEALER}'`

// Mechanical pending variants
const mechQueries = {
  allOpen: `
    SELECT COUNT(*)::int AS mtd,
      COUNT(*) FILTER (WHERE ro_date::date = '${EXPORT}'::date)::int AS today
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) *
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '${MONTH}' AND ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND ${dealerOpen} AND NOT ${accFilter}
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) x`,
  noBillJun_roKey: `
    SELECT COUNT(*)::int AS mtd,
      COUNT(*) FILTER (WHERE ro_date::date = '${EXPORT}'::date)::int AS today
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) o.*
      FROM open_ro_yearly o
      WHERE LOWER(COALESCE(o.status, '')) = 'open'
        AND o.ro_date >= '${MONTH}' AND o.ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND ${dealerOpen.replace('dealer_code', 'o.dealer_code')} AND NOT ${accFilter.replace(/work_type/g, 'o.work_type').replace(/service_type/g, 'o.service_type')}
        AND NOT EXISTS (
          SELECT 1 FROM ro_billing_report rb2
          WHERE ${dealerRb.replace('dealer_code', 'rb2.dealer_code').replace('main_dealer_code', 'rb2.main_dealer_code')}
            AND rb2.bill_date >= '${MONTH}' AND rb2.bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
            AND ${activeBill.replace('bill_status', 'rb2.bill_status')}
            AND NOT ${accFilter.replace(/work_type/g, 'rb2.work_type').replace(/service_type/g, 'rb2.service_type')}
            AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text) = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
        )
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) x`,
  noBillJun_vin: `
    SELECT COUNT(*)::int AS mtd,
      COUNT(*) FILTER (WHERE ro_date::date = '${EXPORT}'::date)::int AS today
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text)) o.*
      FROM open_ro_yearly o
      WHERE LOWER(COALESCE(o.status, '')) = 'open'
        AND o.ro_date >= '${MONTH}' AND o.ro_date < ('${EXPORT}'::date + INTERVAL '1 day')
        AND ${dealerOpen.replace('dealer_code', 'o.dealer_code')} AND NOT ${accFilter.replace(/work_type/g, 'o.work_type').replace(/service_type/g, 'o.service_type')}
        AND NOT EXISTS (
          SELECT 1 FROM ro_billing_report rb2
          WHERE ${dealerRb.replace('dealer_code', 'rb2.dealer_code').replace('main_dealer_code', 'rb2.main_dealer_code')}
            AND rb2.bill_date >= '${MONTH}' AND rb2.bill_date < ('${EXPORT}'::date + INTERVAL '1 day')
            AND ${activeBill.replace('bill_status', 'rb2.bill_status')}
            AND NOT ${accFilter.replace(/work_type/g, 'rb2.work_type').replace(/service_type/g, 'rb2.service_type')}
            AND ((NULLIF(TRIM(o.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vin, ''))) = UPPER(TRIM(o.vin)))
              OR (NULLIF(TRIM(o.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb2.vehicle_reg_no, ''))) = UPPER(TRIM(o.reg_no))))
        )
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) x`,
}

console.log('\n=== MECHANICAL PENDING ===')
for (const [name, q] of Object.entries(mechQueries)) {
  console.log(name, await db.unsafe(q))
}

// Operations with report_type filter
for (const end of ['2026-06-13', '2026-06-15', '2026-06-16']) {
  const [row] = await db.unsafe(`
    WITH latest AS (
      SELECT report_period_start::date AS ps, report_period_end::date AS pe
      FROM operation_wise_analysis_report
      WHERE dealer_code = '${DEALER}' AND report_period_start = '${MONTH}' AND report_period_end <= '${end}'::date
      GROUP BY 1,2 ORDER BY CASE WHEN report_period_end = '${end}'::date THEN 0 ELSE 1 END, pe DESC LIMIT 1
    ), rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS qty,
        COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amt,
        LOWER(COALESCE(source.op_part_code, '')) AS code,
        LOWER(COALESCE(source.report_type, '')) AS rtype,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description
      FROM operation_wise_analysis_report source
      INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
      WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part', '')
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT (SELECT pe::text FROM latest) AS pe,
      COALESCE(SUM(qty) FILTER (WHERE rtype = 'operation' AND (code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align|(^|[^a-z])wa([^a-z]|$)')), 0)::float AS wa_op,
      COALESCE(SUM(qty) FILTER (WHERE rtype = 'operation' AND (code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc|(^|[^a-z])wb([^a-z]|$)')), 0)::float AS wb_op,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align|(^|[^a-z])wa([^a-z]|$)')), 0)::float AS wa_all,
      COALESCE(SUM(qty) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc|(^|[^a-z])wb([^a-z]|$)')), 0)::float AS wb_all,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ 'alignment|align|(^|[^a-z])wa([^a-z]|$)')), 0)::float AS wa_amt,
      COALESCE(SUM(amt) FILTER (WHERE code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ 'balanc|(^|[^a-z])wb([^a-z]|$)')), 0)::float AS wb_amt
    FROM rows`)
  console.log('ops end', end, row)
}

// Oil sources
const [oilAdv] = await db.unsafe(`
  WITH invoice_rows AS (
    SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
      COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
      UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
      UPPER(TRIM(COALESCE(op_part_code, ''))) AS op_part_code,
      LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc, part_no, op_part_code)) AS description
    FROM adv_wise_lubricants_vas
    WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= '${MONTH}'
      AND COALESCE(gst_invoice_date, ro_close_date::date) < ('${EXPORT}'::date + INTERVAL '1 day')
      AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = '${DEALER}'
    ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
  )
  SELECT
    COALESCE(SUM(quantity) FILTER (WHERE part_no LIKE 'NPNENG%' OR op_part_code LIKE 'NPNENG%'), 0)::float AS npn,
    COALESCE(SUM(quantity) FILTER (WHERE part_no LIKE 'NPNENG2P2BIO%' OR part_no LIKE 'NPNENG3D1BIC%' OR part_no LIKE 'NPNENG4D2BIC%' OR op_part_code LIKE 'NPNENG2P2BIO%' OR op_part_code LIKE 'NPNENG3D1BIC%' OR op_part_code LIKE 'NPNENG4D2BIC%'), 0)::float AS coded,
    COALESCE(SUM(quantity), 0)::float AS total
  FROM invoice_rows`)
console.log('\nadv oil:', oilAdv)

// VAS with best-effort period (2026-06-13 fallback)
const vasFilter = `
  (
    description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
    OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
    OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
    OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
  )
  AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'`

for (const pe of ['2026-06-13', '2026-06-15', '2026-06-16']) {
  const [vas] = await db.unsafe(`
    WITH rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(regexp_replace(total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
        LOWER(COALESCE(op_part_desc, '')) AS description,
        LOWER(COALESCE(report_type, '')) AS rtype
      FROM operation_wise_analysis_report
      WHERE dealer_code = '${DEALER}' AND report_period_start = '${MONTH}' AND report_period_end = '${pe}'::date
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(amount) FILTER (WHERE ${vasFilter}), 0)::float AS vas_all,
      COALESCE(SUM(amount) FILTER (WHERE rtype = 'operation' AND ${vasFilter}), 0)::float AS vas_op
    FROM rows`)
  console.log('vas pe', pe, vas)
}

await db.end()
