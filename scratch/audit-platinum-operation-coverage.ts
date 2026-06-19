import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'
import { PLATINUM_ALL_IDENTIFIER_CODES, PLATINUM_VAS_CODES } from '../lib/platinum/vas-identifiers'

type Row = Record<string, unknown>
const rows = (result: unknown) => Array.isArray(result) ? result as Row[] : []
const list = (codes: readonly string[]) => sql.join(codes.map((code) => sql`${code}`), sql`, `)

async function main() {
  const schema = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'am_platinum_operation_wise_analysis_report'
    ORDER BY ordinal_position
  `)

  const dealerOverview = await db.execute(sql`
    SELECT
      UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS dealer_code,
      COUNT(*)::int AS raw_rows,
      COUNT(DISTINCT COALESCE(NULLIF(row_hash, ''), id::text))::int AS distinct_row_keys,
      MIN(report_period_start)::text AS min_period_start,
      MAX(report_period_end)::text AS max_period_end,
      MIN(uploaded_at)::text AS first_upload,
      MAX(uploaded_at)::text AS latest_upload,
      COUNT(*) FILTER (WHERE report_period_start IS NULL OR report_period_end IS NULL)::int AS missing_period_rows,
      COUNT(*) FILTER (WHERE NULLIF(TRIM(COALESCE(op_part_code, '')), '') IS NULL)::int AS missing_code_rows,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(report_type, '')) NOT IN ('operation', 'part'))::int AS other_report_type_rows
    FROM am_platinum_operation_wise_analysis_report
    GROUP BY UPPER(TRIM(COALESCE(source_dealer_code, '')))
    ORDER BY dealer_code
  `)

  const yearly = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (
        UPPER(TRIM(COALESCE(source_dealer_code, ''))),
        report_period_start::date,
        report_period_end::date,
        COALESCE(NULLIF(row_hash, ''), id::text)
      )
        UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS dealer_code,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
      UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
      LOWER(COALESCE(report_type, '')) AS report_type,
        COALESCE(total_amt, 0)::numeric AS amount,
        COALESCE(total_count, 0)::numeric AS operation_count,
        uploaded_at,
        id
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start IS NOT NULL
        AND report_period_end IS NOT NULL
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      ORDER BY UPPER(TRIM(COALESCE(source_dealer_code, ''))), report_period_start::date,
        report_period_end::date, COALESCE(NULLIF(row_hash, ''), id::text),
        uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      dealer_code,
      EXTRACT(YEAR FROM period_start)::int AS year,
      COUNT(DISTINCT (period_start, period_end))::int AS period_count,
      COUNT(DISTINCT EXTRACT(MONTH FROM period_start))::int AS start_month_count,
      MIN(period_start)::text AS min_period_start,
      MAX(period_end)::text AS max_period_end,
      COUNT(*)::int AS latest_rows,
      COALESCE(SUM(operation_count), 0)::float AS operation_count,
      COALESCE(SUM(amount), 0)::float AS total_amount,
      COUNT(*) FILTER (WHERE code IN (${list(PLATINUM_VAS_CODES)}))::int AS vas_rows,
      COALESCE(SUM(amount) FILTER (WHERE code IN (${list(PLATINUM_VAS_CODES)})), 0)::float AS vas_amount,
      COUNT(*) FILTER (WHERE code <> '' AND code NOT IN (${list(PLATINUM_ALL_IDENTIFIER_CODES)}))::int AS unknown_code_rows
    FROM latest
    GROUP BY dealer_code, EXTRACT(YEAR FROM period_start)
    ORDER BY dealer_code, year
  `)

  const periods = await db.execute(sql`
    WITH ranked AS (
      SELECT
        UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS dealer_code,
        report_period_start::date AS period_start,
        report_period_end::date AS period_end,
        COALESCE(NULLIF(row_hash, ''), id::text) AS row_key,
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        COALESCE(total_amt, 0)::numeric AS amount,
        COALESCE(total_count, 0)::numeric AS operation_count,
        uploaded_at,
        id,
        ROW_NUMBER() OVER (
          PARTITION BY UPPER(TRIM(COALESCE(source_dealer_code, ''))),
            report_period_start::date, report_period_end::date,
            COALESCE(NULLIF(row_hash, ''), id::text)
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start IS NOT NULL
        AND report_period_end IS NOT NULL
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
    )
    SELECT
      dealer_code,
      period_start::text,
      period_end::text,
      (period_end - period_start + 1)::int AS period_days,
      COUNT(*) FILTER (WHERE row_rank = 1)::int AS latest_rows,
      COUNT(*)::int AS raw_rows,
      (COUNT(*) - COUNT(*) FILTER (WHERE row_rank = 1))::int AS superseded_rows,
      COUNT(DISTINCT row_key)::int AS distinct_row_keys,
      COUNT(DISTINCT uploaded_at)::int AS upload_versions,
      MIN(uploaded_at)::text AS first_upload,
      MAX(uploaded_at)::text AS latest_upload,
      COALESCE(SUM(operation_count) FILTER (WHERE row_rank = 1), 0)::float AS operation_count,
      COALESCE(SUM(amount) FILTER (WHERE row_rank = 1), 0)::float AS total_amount,
      COUNT(*) FILTER (WHERE row_rank = 1 AND code IN (${list(PLATINUM_VAS_CODES)}))::int AS vas_rows,
      COALESCE(SUM(amount) FILTER (WHERE row_rank = 1 AND code IN (${list(PLATINUM_VAS_CODES)})), 0)::float AS vas_amount,
      COUNT(*) FILTER (
        WHERE row_rank = 1 AND code <> '' AND code NOT IN (${list(PLATINUM_ALL_IDENTIFIER_CODES)})
      )::int AS unknown_code_rows
    FROM ranked
    GROUP BY dealer_code, period_start, period_end
    ORDER BY dealer_code, period_start, period_end
  `)

  const hashReuse = await db.execute(sql`
    SELECT
      COUNT(*)::int AS reused_hash_groups,
      COALESCE(SUM(period_count), 0)::int AS period_occurrences
    FROM (
      SELECT source_dealer_code, row_hash, COUNT(DISTINCT (report_period_start, report_period_end))::int AS period_count
      FROM am_platinum_operation_wise_analysis_report
      WHERE NULLIF(row_hash, '') IS NOT NULL
      GROUP BY source_dealer_code, row_hash
      HAVING COUNT(DISTINCT (report_period_start, report_period_end)) > 1
    ) reused
  `)

  const reportTypes = await db.execute(sql`
    SELECT COALESCE(NULLIF(LOWER(TRIM(report_type)), ''), '(blank)') AS report_type, COUNT(*)::int AS rows
    FROM am_platinum_operation_wise_analysis_report
    GROUP BY COALESCE(NULLIF(LOWER(TRIM(report_type)), ''), '(blank)')
    ORDER BY rows DESC
  `)

  const periodIntegrity = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE report_month IS NULL)::int AS missing_report_month,
      COUNT(*) FILTER (
        WHERE report_month IS NOT NULL
          AND DATE_TRUNC('month', report_month)::date <> DATE_TRUNC('month', report_period_start)::date
      )::int AS report_month_mismatch,
      COUNT(*) FILTER (WHERE report_period_end < report_period_start)::int AS reversed_periods,
      COUNT(*) FILTER (WHERE total_count < 0 OR total_amt < 0 OR total_tax < 0)::int AS negative_total_rows,
      COUNT(*) FILTER (WHERE total_count <> TRUNC(total_count))::int AS fractional_count_rows,
      COUNT(*) FILTER (
        WHERE ABS(COALESCE(total_tot_amt_tax_amt, 0) - (COALESCE(total_amt, 0) + COALESCE(total_tax, 0))) > 0.05
      )::int AS total_tax_mismatch_rows
    FROM am_platinum_operation_wise_analysis_report
  `)

  const semanticDuplicates = await db.execute(sql`
    SELECT COUNT(*)::int AS duplicate_groups, COALESCE(SUM(row_count - 1), 0)::int AS extra_rows
    FROM (
      SELECT COUNT(*)::int AS row_count
      FROM am_platinum_operation_wise_analysis_report
      GROUP BY source_dealer_code, report_period_start, report_period_end, report_type,
        UPPER(TRIM(COALESCE(op_part_code, ''))), COALESCE(total_count, 0),
        COALESCE(total_tax, 0), COALESCE(total_amt, 0), COALESCE(total_tot_amt_tax_amt, 0)
      HAVING COUNT(*) > 1
    ) duplicates
  `)

  const historicalVasCandidates = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (
        UPPER(TRIM(COALESCE(source_dealer_code, ''))),
        report_period_start::date,
        report_period_end::date,
        COALESCE(NULLIF(row_hash, ''), id::text)
      )
        UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS dealer_code,
        EXTRACT(YEAR FROM report_period_start)::int AS year,
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        LOWER(COALESCE(report_type, '')) AS report_type,
        MAX(op_part_desc) OVER (
          PARTITION BY UPPER(TRIM(COALESCE(op_part_code, '')))
        ) AS description,
        COALESCE(total_amt, 0)::numeric AS amount,
        COALESCE(total_count, 0)::numeric AS operation_count,
        uploaded_at,
        id
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start IS NOT NULL
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      ORDER BY UPPER(TRIM(COALESCE(source_dealer_code, ''))), report_period_start::date,
        report_period_end::date, COALESCE(NULLIF(row_hash, ''), id::text),
        uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT dealer_code, year, code, MAX(description) AS description,
      COUNT(*)::int AS rows, SUM(operation_count)::float AS operation_count,
      SUM(amount)::float AS amount
    FROM latest
    WHERE code NOT IN (${list(PLATINUM_ALL_IDENTIFIER_CODES)})
      AND report_type = 'operation'
      AND code LIKE 'A10AA%'
      AND LOWER(COALESCE(description, '')) ~
        '(disinfect|antimicrobial|underbody|under body|silencer coat|engine cleaning|engine dressing|throttle body|rodent|interior enrichment|exterior beaut|paint protection|rubbing|polishing|lubrication|crossmember|egr cleaner|alloy wheel polish|headlamp restoration)'
    GROUP BY dealer_code, year, code
    HAVING SUM(amount) <> 0
    ORDER BY year DESC, dealer_code, amount DESC
  `)

  const june2026CatalogGap = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (
        UPPER(TRIM(COALESCE(source_dealer_code, ''))),
        report_period_start::date,
        report_period_end::date,
        COALESCE(NULLIF(row_hash, ''), id::text)
      )
        UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS dealer_code,
        UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
        op_part_desc AS description,
        COALESCE(total_amt, 0)::numeric AS amount,
        COALESCE(total_count, 0)::numeric AS operation_count,
        uploaded_at,
        id
      FROM am_platinum_operation_wise_analysis_report
      WHERE report_period_start = '2026-06-01'::date
        AND report_period_end = '2026-06-15'::date
        AND LOWER(COALESCE(report_type, '')) = 'operation'
      ORDER BY UPPER(TRIM(COALESCE(source_dealer_code, ''))), report_period_start::date,
        report_period_end::date, COALESCE(NULLIF(row_hash, ''), id::text),
        uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT dealer_code, code, MAX(description) AS description,
      SUM(operation_count)::float AS operation_count, SUM(amount)::float AS amount
    FROM latest
    WHERE code NOT IN (${list(PLATINUM_ALL_IDENTIFIER_CODES)})
      AND (code LIKE '%VAS%' OR LOWER(COALESCE(description, '')) = 'crossmember lubrication')
    GROUP BY dealer_code, code
    ORDER BY dealer_code, amount DESC
  `)

  console.log(JSON.stringify({
    schema: rows(schema),
    dealerOverview: rows(dealerOverview),
    yearly: rows(yearly),
    periods: rows(periods),
    hashReuse: rows(hashReuse),
    reportTypes: rows(reportTypes),
    periodIntegrity: rows(periodIntegrity),
    semanticDuplicates: rows(semanticDuplicates),
    historicalVasCandidates: rows(historicalVasCandidates),
    june2026CatalogGap: rows(june2026CatalogGap),
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
