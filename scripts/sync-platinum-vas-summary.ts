import 'dotenv/config'
import postgres from 'postgres'
import {
  PLATINUM_FUEL_INJECTOR_CODES,
  PLATINUM_VAS_CODES,
  PLATINUM_VAS_IDENTIFIER_VERSION,
  PLATINUM_WHEEL_ALIGNMENT_CODES,
  PLATINUM_WHEEL_BALANCING_CODES,
} from '../lib/platinum/vas-identifiers'

type CatalogCategory = 'vas' | 'wheel_alignment' | 'wheel_balancing' | 'fuel_injector'

const catalog = [
  ...PLATINUM_VAS_CODES.map((code) => ({ code, category: 'vas' as CatalogCategory })),
  ...PLATINUM_WHEEL_ALIGNMENT_CODES.map((code) => ({ code, category: 'wheel_alignment' as CatalogCategory })),
  ...PLATINUM_WHEEL_BALANCING_CODES.map((code) => ({ code, category: 'wheel_balancing' as CatalogCategory })),
  ...PLATINUM_FUEL_INJECTOR_CODES.map((code) => ({ code, category: 'fuel_injector' as CatalogCategory })),
]

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')

  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    await sql.begin(async (tx) => {
      await tx`
        CREATE TABLE IF NOT EXISTS am_platinum_operation_identifier_catalog (
          code text PRIMARY KEY,
          category text NOT NULL CHECK (
            category IN ('vas', 'wheel_alignment', 'wheel_balancing', 'fuel_injector')
          ),
          identifier_version text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `

      await tx`
        INSERT INTO am_platinum_operation_identifier_catalog ${tx(
          catalog.map((row) => ({
            ...row,
            identifier_version: PLATINUM_VAS_IDENTIFIER_VERSION,
            updated_at: new Date(),
          })),
          'code',
          'category',
          'identifier_version',
          'updated_at'
        )}
        ON CONFLICT (code) DO UPDATE SET
          category = EXCLUDED.category,
          identifier_version = EXCLUDED.identifier_version,
          updated_at = EXCLUDED.updated_at
      `

      await tx`
        DELETE FROM am_platinum_operation_identifier_catalog
        WHERE code NOT IN ${tx(catalog.map((row) => row.code))}
      `

      await tx.unsafe('DROP MATERIALIZED VIEW IF EXISTS am_platinum_vas_period_summary_v1')
      await tx.unsafe(`
        CREATE MATERIALIZED VIEW am_platinum_vas_period_summary_v1 AS
        WITH ranked AS (
          SELECT
            CASE
              WHEN COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                'UNMAPPED'
              ) = 'N6824' THEN 'N6250'
              ELSE COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                'UNMAPPED'
              )
            END AS dealer_code,
            report_period_start::date AS period_start,
            report_period_end::date AS period_end,
            COALESCE(NULLIF(row_hash, ''), id::text) AS row_key,
            COALESCE(total_amt, 0)::numeric AS amount,
            UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
            uploaded_at,
            id,
            ROW_NUMBER() OVER (
              PARTITION BY
                CASE
                  WHEN COALESCE(
                    NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                    'UNMAPPED'
                  ) = 'N6824' THEN 'N6250'
                  ELSE COALESCE(
                    NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                    'UNMAPPED'
                  )
                END,
                report_period_start::date,
                report_period_end::date,
                COALESCE(NULLIF(row_hash, ''), id::text)
              ORDER BY uploaded_at DESC NULLS LAST, id DESC
            ) AS row_rank
          FROM am_platinum_operation_wise_analysis_report
          WHERE report_period_start IS NOT NULL
            AND report_period_end IS NOT NULL
            AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
        ),
        latest AS (
          SELECT *
          FROM ranked
          WHERE row_rank = 1
        )
        SELECT
          latest.dealer_code,
          latest.period_start,
          latest.period_end,
          COUNT(*)::int AS period_rows,
          COUNT(*) FILTER (WHERE catalog.category = 'vas')::int AS source_rows,
          COUNT(*) FILTER (
            WHERE latest.code <> '' AND catalog.code IS NULL
          )::int AS unknown_code_rows,
          COALESCE(
            SUM(latest.amount) FILTER (WHERE catalog.category = 'vas'),
            0
          )::numeric AS vas_amount,
          MAX(latest.uploaded_at) AS uploaded_at
        FROM latest
        LEFT JOIN am_platinum_operation_identifier_catalog catalog
          ON catalog.code = latest.code
        GROUP BY latest.dealer_code, latest.period_start, latest.period_end
      `)

      await tx.unsafe(`
        CREATE UNIQUE INDEX am_platinum_vas_period_summary_v1_unique
          ON am_platinum_vas_period_summary_v1 (dealer_code, period_start, period_end)
      `)
      await tx.unsafe(`
        CREATE INDEX am_platinum_vas_period_summary_v1_period_idx
          ON am_platinum_vas_period_summary_v1 (period_start, period_end, dealer_code)
      `)
    })

    const parity = await sql`
      WITH ranked AS (
        SELECT
          CASE
            WHEN UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6824' THEN 'N6250'
            ELSE UPPER(TRIM(COALESCE(source_dealer_code, '')))
          END AS dealer_code,
          report_period_start::date AS period_start,
          report_period_end::date AS period_end,
          COALESCE(NULLIF(row_hash, ''), id::text) AS row_key,
          COALESCE(total_amt, 0)::numeric AS amount,
          UPPER(TRIM(COALESCE(op_part_code, ''))) AS code,
          ROW_NUMBER() OVER (
            PARTITION BY
              CASE
                WHEN UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6824' THEN 'N6250'
                ELSE UPPER(TRIM(COALESCE(source_dealer_code, '')))
              END,
              report_period_start::date,
              report_period_end::date,
              COALESCE(NULLIF(row_hash, ''), id::text)
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM am_platinum_operation_wise_analysis_report
        WHERE report_period_start IS NOT NULL
          AND report_period_end IS NOT NULL
          AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
      ),
      live AS (
        SELECT
          ranked.dealer_code,
          ranked.period_start,
          ranked.period_end,
          COUNT(*)::int AS period_rows,
          COUNT(*) FILTER (WHERE catalog.category = 'vas')::int AS source_rows,
          COUNT(*) FILTER (WHERE ranked.code <> '' AND catalog.code IS NULL)::int AS unknown_code_rows,
          COALESCE(SUM(ranked.amount) FILTER (WHERE catalog.category = 'vas'), 0)::numeric AS vas_amount
        FROM ranked
        LEFT JOIN am_platinum_operation_identifier_catalog catalog
          ON catalog.code = ranked.code
        WHERE ranked.row_rank = 1
        GROUP BY ranked.dealer_code, ranked.period_start, ranked.period_end
      )
      SELECT
        COUNT(*)::int AS summary_periods,
        COUNT(*) FILTER (
          WHERE summary.dealer_code IS NULL
            OR live.dealer_code IS NULL
            OR summary.period_rows <> live.period_rows
            OR summary.source_rows <> live.source_rows
            OR summary.unknown_code_rows <> live.unknown_code_rows
            OR ABS(summary.vas_amount - live.vas_amount) > 0.01
        )::int AS mismatched_periods
      FROM live
      FULL OUTER JOIN am_platinum_vas_period_summary_v1 summary
        USING (dealer_code, period_start, period_end)
    `

    if (Number(parity[0]?.mismatched_periods || 0) > 0) {
      throw new Error(`VAS summary parity failed for ${parity[0].mismatched_periods} periods`)
    }

    const target = await sql`
      SELECT
        dealer_code,
        period_start::text,
        period_end::text,
        vas_amount::float,
        source_rows,
        unknown_code_rows
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N5211'
        AND period_start = DATE '2025-06-01'
        AND period_end = DATE '2025-06-15'
      UNION ALL
      SELECT
        dealer_code,
        period_start::text,
        period_end::text,
        vas_amount::float,
        source_rows,
        unknown_code_rows
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N5211'
        AND period_start = DATE '2026-06-01'
        AND period_end = DATE '2026-06-15'
      ORDER BY period_start
    `

    console.log(`[platinum-vas] synced ${catalog.length} identifiers (${PLATINUM_VAS_IDENTIFIER_VERSION})`)
    console.log(`[platinum-vas] rebuilt ${parity[0]?.summary_periods || 0} summary periods`)
    console.log('[platinum-vas] live-source parity matched for every period')
    console.table(target)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('[platinum-vas] sync failed', error)
  process.exit(1)
})
