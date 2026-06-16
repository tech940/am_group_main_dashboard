require('dotenv').config({ quiet: true })
const postgres = require('postgres')
const { pickDatabaseUrl } = require('./bigquery/db-url')

async function main() {
  const url = await pickDatabaseUrl(postgres, '[june-oil]')
  const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

  const codes = ['NPNENG2P2BIO', 'NPNENG3D1BIC', 'NPNENG4D2BIC']
  const [advJune] = await db.unsafe(`
    SELECT COALESCE(SUM(COALESCE(NULLIF(regexp_replace(qty_hrs::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0)::float AS qty
    FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text)) qty_hrs, part_no, op_part_code
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= '2026-06-01' AND gst_invoice_date < '2026-06-16'
        AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), retail_dealer_code, ''))) = 'JK402'
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) rows
    WHERE ${codes.map((c) => `(UPPER(TRIM(part_no)) LIKE '${c}%' OR UPPER(TRIM(op_part_code)) LIKE '${c}%')`).join(' OR ')}
  `)
  console.log('adv_wise june prefix match:', advJune)

  const [opPeriod] = await db.unsafe(`
    SELECT report_period_start::text AS ps, report_period_end::text AS pe, COUNT(*)::int AS n
    FROM operation_wise_analysis_report
    WHERE dealer_code = 'JK402'
      AND report_period_start >= '2026-06-01'
    GROUP BY 1,2 ORDER BY 1,2
  `)
  console.log('operation periods june+:', opPeriod)

  const [opOil] = await db.unsafe(`
    WITH latest AS (
      SELECT report_period_start::date AS ps, report_period_end::date AS pe
      FROM operation_wise_analysis_report
      WHERE dealer_code = 'JK402' AND report_period_start = '2026-06-01' AND report_period_end <= '2026-06-15'
      GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
    )
    SELECT COALESCE(SUM(COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)), 0)::float AS qty
    FROM operation_wise_analysis_report source
    INNER JOIN latest ON source.report_period_start::date = latest.ps AND source.report_period_end::date = latest.pe
    WHERE UPPER(TRIM(COALESCE(source.op_part_code, ''))) LIKE 'NPNENG%'
       OR UPPER(TRIM(COALESCE(source.op_part_code, ''))) IN ('NPNENG2P2BIO','NPNENG3D1BIC','NPNENG4D2BIC')
  `)
  console.log('operation_wise june oil:', opOil)

  const [pending] = await db.unsafe(`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        ro_date::date AS report_date,
        CASE WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%' OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%' THEN 'Accidental Repair' ELSE 'Mechanical' END AS cat
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= '2026-06-01' AND ro_date < '2026-06-16'
        AND EXISTS (SELECT 1 FROM ro_billing_report rb WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = 'JK402'
          AND ((NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin)))
            OR (NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no)))))
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT cat, COUNT(*)::int AS mtd FROM active GROUP BY cat
  `)
  console.log('pending by cat:', pending)

  await db.end()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
