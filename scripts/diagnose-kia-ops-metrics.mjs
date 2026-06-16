import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = 'JK402'
const MONTH = '2026-06-01'
const EXPORT = '2026-06-15'
const url = await pickDatabaseUrl(postgres, '[kia-ops]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const periods = await db.unsafe(`
  SELECT DISTINCT report_period_end::date AS pe
  FROM operation_wise_analysis_report
  WHERE dealer_code = '${DEALER}' AND report_period_start = '${MONTH}'
  ORDER BY pe`)
console.log('periods', periods.map((r) => r.pe))

async function counts(pe) {
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS operation_count,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT *,
        (operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))') AS is_wa,
        (report_type = 'operation' AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')) AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::float AS wa,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::float AS wb
    FROM classified`)
  return r
}

async function labour(pe) {
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) AS amount,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT *,
        (operation_code ~ '(^|[^a-z])wa([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))') AS is_wa,
        (report_type = 'operation' AND (operation_code ~ '(^|[^a-z])wb([^a-z]|$)' OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))')) AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amt,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS wb_op
    FROM classified`)
  return r
}

async function bc5(pe) {
  const [r] = await db.unsafe(`
    SELECT COALESCE(SUM(amt),0)::float AS bc5 FROM (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash,''), id::text))
        COALESCE(NULLIF(regexp_replace(total_amt::text,'[^0-9.-]','','g'),'')::numeric,0) amt
      FROM operation_wise_analysis_report
      WHERE report_period_start='${MONTH}' AND report_period_end='${pe}'
        AND UPPER(TRIM(dealer_code))='${DEALER}'
        AND UPPER(op_part_code)='A10VAWHEELBC5'
        AND LOWER(COALESCE(report_type,''))='operation'
      ORDER BY COALESCE(NULLIF(row_hash,''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ) x`)
  return r.bc5
}

async function oil(pe) {
  const prefixes = ['NPNENG2P2BIO', 'NPNENG3D1BIC', 'NPNENG4D2BIC']
  const prefixMatch = prefixes.map((p) => `UPPER(TRIM(COALESCE(op_part_code, ''))) LIKE '${p}%'`).join(' OR ')
  const [r] = await db.unsafe(`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(regexp_replace(source.total_count::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS quantity,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS op_part_code
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = '${MONTH}'::date
        AND source.report_period_end::date = '${pe}'::date
        AND UPPER(TRIM(COALESCE(source.dealer_code,''))) = '${DEALER}'
        AND LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COALESCE(SUM(quantity) FILTER (WHERE (${prefixMatch}) OR op_part_code LIKE 'NPNENG%'), 0)::float AS engine,
      COALESCE(SUM(quantity) FILTER (WHERE op_part_code LIKE 'NPNENG4%'), 0)::float AS npneng4
    FROM operation_rows`)
  return r
}

for (const pe of ['2026-06-13', '2026-06-14', '2026-06-15', '2026-06-16']) {
  const c = await counts(pe)
  const l = await labour(pe)
  const o = await oil(pe)
  const b = await bc5(pe)
  console.log(pe, { counts: c, labour: l, oil: o, bc5: b })
}

const j13c = await counts('2026-06-13')
const j16c = await counts('2026-06-16')
const j13l = await labour('2026-06-13')
const j16l = await labour('2026-06-16')
const j13o = await oil('2026-06-13')
const j16o = await oil('2026-06-16')
const bc5Amt = await bc5('2026-06-16')

const exportDay = 15
const belowDay = 13
const forwardDay = 16
const ratio = (exportDay - belowDay) / (forwardDay - belowDay)

const waInterp = Math.floor(j13c.wa + (j16c.wa - j13c.wa) * ratio)
const wbInterp = Math.round(j13c.wb + (j16c.wb - j13c.wb) * ratio)
console.log('\ninterp 2/3', { waInterp, wbInterp, ratio })

const waDelta = j16l.wa_amt - j13l.wa_amt
const wbDelta = j16l.wb_op - j13l.wb_op
const alignCarry = Math.max(0, waDelta - wbDelta)
const wbNorm = Math.round(j16l.wb_op - bc5Amt - alignCarry)
console.log('labour norm', {
  waDelta, wbDelta, alignCarry, bc5: bc5Amt, wbNorm,
  waAmt: Math.round(j16l.wa_amt),
})

const npnDelta = j16o.npneng4 - j13o.npneng4
console.log('oil', {
  j16: j16o.engine,
  minusNpn4: j16o.engine - npnDelta,
  npnDelta,
})

// workshop VAS from advisor report
const [advVas] = await db.unsafe(`
  WITH latest_period AS (
    SELECT report_period_start::date AS ps, report_period_end::date AS pe
    FROM operation_wise_analysis_advisor_report
    WHERE report_period_start = '${MONTH}' AND report_period_end <= '${EXPORT}'::date
      AND UPPER(TRIM(dealer_code)) = '${DEALER}'
    GROUP BY 1,2 ORDER BY pe DESC LIMIT 1
  ),
  rows AS (
    SELECT DISTINCT COALESCE(NULLIF(source.row_hash, ''), source.id::text) AS k,
      COALESCE(NULLIF(regexp_replace(source.total_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS amount,
      LOWER(COALESCE(source.op_part_desc, '')) AS vas_description,
      LOWER(COALESCE(source.report_type, '')) AS report_type
    FROM operation_wise_analysis_advisor_report source
    INNER JOIN latest_period lp ON source.report_period_start::date = lp.ps AND source.report_period_end::date = lp.pe
    WHERE UPPER(TRIM(source.dealer_code)) = '${DEALER}'
  )
  SELECT COALESCE(SUM(amount) FILTER (WHERE report_type IN ('operation', 'part')
    AND vas_description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$)|ac[[:space:]-]*evaporator|throttle|carbon[[:space:]-]*cleaning|under[[:space:]-]*body|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel|air[[:space:]-]*intake|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum|silencer[[:space:]-]*coating|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
    AND vas_description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'), 0)::float AS vas,
    (SELECT pe::text FROM latest_period) AS period
  FROM rows`)
console.log('\nworkshop advisor VAS', advVas)

await db.end()
