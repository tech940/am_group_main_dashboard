import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from '../scripts/bigquery/db-url.js'

const url = await pickDatabaseUrl(postgres, '[platinum-jan-2025-audit]')
const db = postgres(url, {
  ssl: { rejectUnauthorized: false },
  prepare: false,
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
})

const roDealer = `
  CASE
    WHEN COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
    ) = 'N6824' THEN 'N6250'
    ELSE COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
    )
  END
`

const repairDealer = `
  CASE
    WHEN COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), '')
    ) = 'N6824' THEN 'N6250'
    ELSE COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), '')
    )
  END
`

const sourceDealer = `
  CASE
    WHEN NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE') = 'N6824'
      THEN 'N6250'
    ELSE NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE')
  END
`

async function query(name, text) {
  const startedAt = Date.now()
  const rows = await db.unsafe(`SET statement_timeout TO '30000ms'; ${text}`)
  console.error(`${name}: ${Date.now() - startedAt}ms`)
  return rows
}

const result = {}

try {
  result.tableCoverage = await query('tableCoverage', `
    SELECT 'ro_billing' AS source,
      MIN(bill_date)::text AS min_date, MAX(bill_date)::text AS max_date,
      COUNT(*)::int AS raw_rows, COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      MIN(uploaded_at)::text AS first_upload, MAX(uploaded_at)::text AS latest_upload
    FROM am_platinum_ro_billing_report
    UNION ALL
    SELECT 'repair_orders', MIN(r_o_date)::text, MAX(r_o_date)::text,
      COUNT(*)::int, COUNT(DISTINCT row_hash)::int,
      MIN(uploaded_at)::text, MAX(uploaded_at)::text
    FROM am_platinum_repair_order_list
    UNION ALL
    SELECT 'operation_wise', MIN(report_period_start)::text, MAX(report_period_end)::text,
      COUNT(*)::int, COUNT(DISTINCT row_hash)::int,
      MIN(uploaded_at)::text, MAX(uploaded_at)::text
    FROM am_platinum_operation_wise_analysis_report
    UNION ALL
    SELECT 'advisor_lubricants_vas', NULL::text, NULL::text,
      COUNT(*)::int, COUNT(DISTINCT row_hash)::int,
      MIN(uploaded_at)::text, MAX(uploaded_at)::text
    FROM am_platinum_adv_wise_lubricants_vas
  `)

  result.roMonthly = await query('roMonthly', `
    WITH base AS (
      SELECT
        ${roDealer} AS dealer,
        bill_date::date AS bill_date,
        COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text) AS bill_ref,
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), NULLIF(TRIM(bill_no::text), ''), id::text) AS ro_ref,
        COALESCE(labour_amt, 0)::numeric AS labour,
        COALESCE(part_amt, 0)::numeric AS parts,
        COALESCE(total_amt, 0)::numeric AS source_total,
        uploaded_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY ${roDealer}, bill_date::date,
            COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS invoice_rank
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= DATE '2024-01-01' AND bill_date < DATE '2026-01-01'
        AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
    )
    SELECT DATE_TRUNC('month', bill_date)::date::text AS month, dealer,
      COUNT(*)::int AS active_raw_rows,
      COUNT(*) FILTER (WHERE invoice_rank = 1)::int AS invoices,
      COUNT(DISTINCT ro_ref) FILTER (WHERE invoice_rank = 1)::int AS repair_orders,
      COUNT(DISTINCT bill_date)::int AS covered_dates,
      MIN(bill_date)::text AS min_bill_date, MAX(bill_date)::text AS max_bill_date,
      ROUND(SUM(labour) FILTER (WHERE invoice_rank = 1), 2)::float AS labour,
      ROUND(SUM(parts) FILTER (WHERE invoice_rank = 1), 2)::float AS parts,
      ROUND(SUM(labour + parts) FILTER (WHERE invoice_rank = 1), 2)::float AS dashboard_revenue,
      ROUND(SUM(source_total) FILTER (WHERE invoice_rank = 1), 2)::float AS source_total,
      (COUNT(*) - COUNT(*) FILTER (WHERE invoice_rank = 1))::int AS duplicate_invoice_rows
    FROM base
    GROUP BY DATE_TRUNC('month', bill_date), dealer
    ORDER BY month, dealer
  `)

  result.roJanuary = await query('roJanuary', `
    WITH base AS (
      SELECT
        ${roDealer} AS dealer,
        bill_date::date AS bill_date,
        COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text) AS bill_ref,
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), NULLIF(TRIM(bill_no::text), ''), id::text) AS ro_ref,
        COALESCE(labour_amt, 0)::numeric AS labour,
        COALESCE(part_amt, 0)::numeric AS parts,
        COALESCE(total_amt, 0)::numeric AS source_total,
        bill_type,
        row_hash,
        uploaded_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY ${roDealer}, bill_date::date,
            COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS invoice_rank
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= DATE '2025-01-01' AND bill_date <= DATE '2025-01-31'
    )
    SELECT dealer,
      COUNT(*)::int AS raw_rows,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(bill_type::text, ''))) LIKE '%cancel%')::int AS cancelled_rows,
      COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      COUNT(*) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      )::int AS active_invoices,
      COUNT(DISTINCT ro_ref) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      )::int AS active_repair_orders,
      COUNT(DISTINCT bill_date)::int AS covered_dates,
      MIN(bill_date)::text AS min_bill_date, MAX(bill_date)::text AS max_bill_date,
      ROUND(SUM(labour) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ), 2)::float AS labour,
      ROUND(SUM(parts) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ), 2)::float AS parts,
      ROUND(SUM(labour + parts) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ), 2)::float AS dashboard_revenue,
      ROUND(SUM(source_total) FILTER (
        WHERE invoice_rank = 1
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ), 2)::float AS source_total,
      MIN(uploaded_at)::text AS first_upload, MAX(uploaded_at)::text AS latest_upload
    FROM base
    GROUP BY dealer
    ORDER BY dealer
  `)

  result.roJanuaryDaily = await query('roJanuaryDaily', `
    WITH ranked AS (
      SELECT
        ${roDealer} AS dealer,
        bill_date::date AS bill_date,
        COALESCE(labour_amt, 0)::numeric AS labour,
        COALESCE(part_amt, 0)::numeric AS parts,
        ROW_NUMBER() OVER (
          PARTITION BY ${roDealer}, bill_date::date,
            COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS invoice_rank
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= DATE '2025-01-01' AND bill_date <= DATE '2025-01-31'
        AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
    )
    SELECT dealer, bill_date::text, COUNT(*) FILTER (WHERE invoice_rank = 1)::int AS invoices,
      ROUND(SUM(labour + parts) FILTER (WHERE invoice_rank = 1), 2)::float AS revenue
    FROM ranked
    GROUP BY dealer, bill_date
    ORDER BY dealer, bill_date
  `)

  result.repairJanuary = await query('repairJanuary', `
    SELECT ${repairDealer} AS dealer,
      COUNT(*)::int AS raw_rows,
      COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text))::int AS distinct_repair_orders,
      COUNT(DISTINCT r_o_date::date)::int AS covered_dates,
      MIN(r_o_date)::text AS min_ro_date, MAX(r_o_date)::text AS max_ro_date,
      MIN(uploaded_at)::text AS first_upload, MAX(uploaded_at)::text AS latest_upload
    FROM am_platinum_repair_order_list
    WHERE r_o_date >= DATE '2025-01-01' AND r_o_date <= DATE '2025-01-31'
    GROUP BY ${repairDealer}
    ORDER BY dealer
  `)

  result.repairJanuaryComparison = await query('repairJanuaryComparison', `
    SELECT EXTRACT(YEAR FROM r_o_date)::int AS year, ${repairDealer} AS dealer,
      COUNT(*)::int AS raw_rows,
      COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      COUNT(DISTINCT COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text))::int AS distinct_repair_orders,
      COUNT(DISTINCT r_o_date::date)::int AS covered_dates,
      MIN(r_o_date)::text AS min_ro_date, MAX(r_o_date)::text AS max_ro_date
    FROM am_platinum_repair_order_list
    WHERE (
      r_o_date >= DATE '2024-01-01' AND r_o_date <= DATE '2024-01-31'
    ) OR (
      r_o_date >= DATE '2025-01-01' AND r_o_date <= DATE '2025-01-31'
    )
    GROUP BY EXTRACT(YEAR FROM r_o_date), ${repairDealer}
    ORDER BY year, dealer
  `)

  result.operationJanuary = await query('operationJanuary', `
    WITH ranked AS (
      SELECT
        ${sourceDealer} AS dealer,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        report_type,
        COALESCE(total_count, 0)::numeric AS operation_count,
        COALESCE(total_amt, 0)::numeric AS amount,
        row_hash,
        uploaded_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY ${sourceDealer}, report_period_start::date, report_period_end::date,
            COALESCE(NULLIF(row_hash, ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start <= DATE '2025-01-31'
        AND report_period_end >= DATE '2025-01-01'
    )
    SELECT dealer, period_start::text, period_end::text, report_type,
      COUNT(*)::int AS raw_rows,
      COUNT(*) FILTER (WHERE row_rank = 1)::int AS deduped_rows,
      COUNT(*) FILTER (WHERE operation_count <> TRUNC(operation_count))::int AS fractional_count_rows,
      ROUND(SUM(operation_count) FILTER (WHERE row_rank = 1), 2)::float AS operation_count,
      ROUND(SUM(amount) FILTER (WHERE row_rank = 1), 2)::float AS amount,
      MIN(uploaded_at)::text AS first_upload, MAX(uploaded_at)::text AS latest_upload
    FROM ranked
    GROUP BY dealer, period_start, period_end, report_type
    ORDER BY dealer, period_start, period_end, report_type
  `)

  result.operationJanuaryComparison = await query('operationJanuaryComparison', `
    WITH ranked AS (
      SELECT
        ${sourceDealer} AS dealer,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        report_type,
        COALESCE(total_count, 0)::numeric AS operation_count,
        COALESCE(total_amt, 0)::numeric AS amount,
        uploaded_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY ${sourceDealer}, report_period_start::date, report_period_end::date,
            COALESCE(NULLIF(row_hash, ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM am_platinum_operation_wise_analysis_report
      WHERE (
        report_period_start <= DATE '2024-01-31' AND report_period_end >= DATE '2024-01-01'
      ) OR (
        report_period_start <= DATE '2025-01-31' AND report_period_end >= DATE '2025-01-01'
      )
    )
    SELECT EXTRACT(YEAR FROM period_start)::int AS year, dealer, period_start::text, period_end::text,
      COUNT(*)::int AS raw_rows,
      COUNT(*) FILTER (WHERE row_rank = 1)::int AS deduped_rows,
      ROUND(SUM(operation_count) FILTER (WHERE row_rank = 1), 2)::float AS operation_count,
      ROUND(SUM(amount) FILTER (WHERE row_rank = 1), 2)::float AS amount
    FROM ranked
    GROUP BY EXTRACT(YEAR FROM period_start), dealer, period_start, period_end
    ORDER BY year, dealer, period_start, period_end
  `)

  result.roN6250JanuarySourceRows = await query('roN6250JanuarySourceRows', `
    SELECT EXTRACT(YEAR FROM bill_date)::int AS year,
      UPPER(TRIM(COALESCE(source_dealer_code::text, ''))) AS source_dealer_code,
      UPPER(TRIM(COALESCE(dealer_code::text, ''))) AS dealer_code,
      UPPER(TRIM(COALESCE(main_dealer_code::text, ''))) AS main_dealer_code,
      COUNT(*)::int AS rows,
      COUNT(DISTINCT bill_date::date)::int AS covered_dates,
      MIN(bill_date)::text AS min_bill_date, MAX(bill_date)::text AS max_bill_date,
      ROUND(SUM(COALESCE(labour_amt, 0) + COALESCE(part_amt, 0)), 2)::float AS raw_revenue
    FROM am_platinum_ro_billing_report
    WHERE (
      bill_date >= DATE '2024-01-01' AND bill_date <= DATE '2024-01-31'
    ) OR (
      bill_date >= DATE '2025-01-01' AND bill_date <= DATE '2025-01-31'
    )
    GROUP BY EXTRACT(YEAR FROM bill_date), source_dealer_code, dealer_code, main_dealer_code
    ORDER BY year, rows DESC
  `)

  result.roSummaryJanuaryComparison = await query('roSummaryJanuaryComparison', `
    SELECT EXTRACT(YEAR FROM bill_date)::int AS year, dealer_code AS dealer,
      SUM(load_count)::int AS load_count,
      SUM(invoice_count)::int AS invoice_count,
      COUNT(DISTINCT bill_date)::int AS covered_dates,
      MIN(bill_date)::text AS min_bill_date, MAX(bill_date)::text AS max_bill_date,
      ROUND(SUM(labour_amount), 2)::float AS labour,
      ROUND(SUM(part_amount), 2)::float AS parts,
      ROUND(SUM(revenue), 2)::float AS revenue,
      MAX(uploaded_at)::text AS latest_source_upload
    FROM am_platinum_ro_billing_daily_summary_v2
    WHERE (
      bill_date >= DATE '2024-01-01' AND bill_date <= DATE '2024-01-31'
    ) OR (
      bill_date >= DATE '2025-01-01' AND bill_date <= DATE '2025-01-31'
    )
    GROUP BY EXTRACT(YEAR FROM bill_date), dealer_code
    ORDER BY year, dealer
  `)

  result.advisorLubricants = await query('advisorLubricants', `
    SELECT ${sourceDealer} AS dealer,
      COUNT(*)::int AS raw_rows,
      COUNT(DISTINCT row_hash)::int AS distinct_hashes,
      COUNT(*) FILTER (WHERE COALESCE(total_count, 0) <> TRUNC(COALESCE(total_count, 0)))::int AS fractional_count_rows,
      ROUND(SUM(COALESCE(total_count, 0)), 2)::float AS total_count,
      ROUND(SUM(COALESCE(total_amt, 0)), 2)::float AS total_amount,
      MIN(uploaded_at)::text AS first_upload, MAX(uploaded_at)::text AS latest_upload
    FROM am_platinum_adv_wise_lubricants_vas
    GROUP BY ${sourceDealer}
    ORDER BY dealer
  `)

  result.advisorLubricantsDateColumns = await query('advisorLubricantsDateColumns', `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'am_platinum_adv_wise_lubricants_vas'
      AND (
        column_name ILIKE '%date%'
        OR column_name ILIKE '%month%'
        OR column_name ILIKE '%period%'
      )
    ORDER BY ordinal_position
  `)

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} finally {
  await db.end({ timeout: 2 })
}
