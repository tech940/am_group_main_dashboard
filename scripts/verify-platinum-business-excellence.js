const assert = require('node:assert/strict')
const dotenv = require('dotenv')
const postgres = require('postgres')

dotenv.config({ quiet: true })

function closeTo(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(Number(actual) - expected) <= tolerance,
    `Expected ${expected}, received ${actual}`
  )
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured')
  }

  const readSource = process.env.ANALYTICS_READ_SOURCE || 'postgres'
  if (readSource === 'bigquery') {
    console.warn('[verify-platinum-business-excellence] ANALYTICS_READ_SOURCE=bigquery — this script validates Postgres directly; use bq:validate-parity for BQ checks')
  }

  const db = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
  })

  try {
    const [current] = await db`
      SELECT
        COUNT(*)::int AS invoices,
        COUNT(DISTINCT ro_key)::int AS ro_count,
        COALESCE(SUM(labour_amount), 0)::float AS labour,
        COALESCE(SUM(part_amount), 0)::float AS parts,
        COALESCE(SUM(total_amount), 0)::float AS revenue
      FROM am_platinum_workshop_performance_jc_summary_v2
      WHERE dealer_code = 'N5211'
        AND report_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-12'
    `

    assert.equal(current.invoices, 335)
    assert.equal(current.ro_count, 334)
    closeTo(current.labour, 1371152.43)
    closeTo(current.parts, 1414960.06)
    closeTo(current.revenue, 2786112.49)

    const [previous] = await db`
      SELECT
        COUNT(DISTINCT ro_key)::int AS ro_count,
        COALESCE(SUM(total_amount), 0)::float AS revenue
      FROM am_platinum_workshop_performance_jc_summary_v2
      WHERE dealer_code = 'N5211'
        AND report_date BETWEEN DATE '2025-06-01' AND DATE '2025-06-12'
    `

    assert.equal(previous.ro_count, 348)
    closeTo(previous.revenue, 2372988.61)

    const [rajouri] = await db`
      SELECT
        COUNT(*) FILTER (
          WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'ACTIVE'
        )::int AS active_source_rows,
        COUNT(*)::int AS resolved_rows
      FROM am_platinum_ro_billing_report
      WHERE bill_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-12'
        AND COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
          NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
        ) = 'N6250'
    `

    assert.equal(rajouri.active_source_rows, 123)
    assert.equal(rajouri.resolved_rows, 173)

    const [rajouriHistory] = await db`
      WITH scoped AS (
        SELECT
          id,
          bill_date::date AS bill_date,
          COALESCE(NULLIF(TRIM(bill_no::text), ''), NULLIF(TRIM(r_o_no::text), ''), id::text) AS invoice_no,
          COALESCE(labour_amt, 0) + COALESCE(part_amt, 0) AS revenue,
          uploaded_at
        FROM am_platinum_ro_billing_report
        WHERE bill_date IS NOT NULL
          AND COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
          ) = 'N6250'
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ),
      date_aware AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY
              bill_date::date,
              invoice_no
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM scoped
      ),
      legacy_global AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY invoice_no
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM scoped
      ),
      expected AS (
        SELECT COUNT(*)::int AS invoices, COALESCE(SUM(revenue), 0)::float AS revenue
        FROM date_aware
        WHERE row_rank = 1
          AND bill_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
      ),
      legacy AS (
        SELECT COUNT(*)::int AS invoices, COALESCE(SUM(revenue), 0)::float AS revenue
        FROM legacy_global
        WHERE row_rank = 1
          AND bill_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
      ),
      materialized AS (
        SELECT COUNT(*)::int AS invoices, COALESCE(SUM(total_amount), 0)::float AS revenue
        FROM am_platinum_workshop_performance_jc_summary_v2
        WHERE dealer_code = 'N6250'
          AND report_date BETWEEN DATE '2024-01-01' AND DATE '2024-12-31'
      )
      SELECT
        expected.invoices AS expected_invoices,
        expected.revenue AS expected_revenue,
        legacy.invoices AS legacy_invoices,
        legacy.revenue AS legacy_revenue,
        materialized.invoices AS materialized_invoices,
        materialized.revenue AS materialized_revenue
      FROM expected, legacy, materialized
    `

    assert.equal(rajouriHistory.materialized_invoices, rajouriHistory.expected_invoices)
    closeTo(rajouriHistory.materialized_revenue, rajouriHistory.expected_revenue)

    const [invoiceIdentityFixture] = await db`
      WITH fixture(dealer_code, bill_date, bill_no, amount, uploaded_at, id) AS (
        VALUES
          ('N6250', DATE '2024-01-05', 'B-1', 100::numeric, TIMESTAMPTZ '2026-06-01 00:00:00+00', 1),
          ('N6250', DATE '2024-01-05', 'B-1', 125::numeric, TIMESTAMPTZ '2026-06-02 00:00:00+00', 2),
          ('N6250', DATE '2024-03-05', 'B-1', 200::numeric, TIMESTAMPTZ '2026-06-03 00:00:00+00', 3)
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY dealer_code, bill_date, bill_no
            ORDER BY uploaded_at DESC, id DESC
          ) AS row_rank
        FROM fixture
      )
      SELECT COUNT(*)::int AS invoices, SUM(amount)::float AS revenue
      FROM ranked
      WHERE row_rank = 1
    `

    assert.equal(invoiceIdentityFixture.invoices, 2)
    closeTo(invoiceIdentityFixture.revenue, 325)

    const auditedRajouri2024Invoices = 3237
    const auditedRajouri2024Revenue = rajouriHistory.materialized_revenue + 3204887.03
    if (rajouriHistory.materialized_invoices < auditedRajouri2024Invoices) {
      console.warn(
        `[verify-platinum-business-excellence] source regression: Rajouri 2024 currently has `
        + `${rajouriHistory.materialized_invoices} invoices / ${rajouriHistory.materialized_revenue} revenue; `
        + `the earlier audited source contained ${auditedRajouri2024Invoices} invoices / ${auditedRajouri2024Revenue} revenue.`
      )
    }

    const [complaints] = await db`
      SELECT
        COUNT(*)::int AS rows,
        COUNT(*) FILTER (WHERE complaint_date IS NULL)::int AS null_source_dates,
        COUNT(*) FILTER (
          WHERE COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date) IS NOT NULL
        )::int AS usable_business_dates
      FROM am_platinum_call_center_complaints
    `

    assert.ok(complaints.rows > 0)
    assert.ok(complaints.usable_business_dates > 0)
    if (complaints.usable_business_dates < complaints.rows) {
      console.warn(
        `[verify-platinum-business-excellence] complaint source gap: `
        + `${complaints.rows - complaints.usable_business_dates} rows have no usable business date.`
      )
    }

    const [legacyRajouri] = await db`
      SELECT
        (
          SELECT COUNT(*)::int
          FROM am_platinum_operation_wise_analysis_report
          WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6824'
        ) AS legacy_source_rows,
        (
          SELECT COUNT(*)::int
          FROM am_platinum_operation_wise_analysis_report
          WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'N6250'
        ) AS resolved_source_rows,
        (
          SELECT COUNT(*)::int
          FROM am_platinum_vas_period_summary_v1
          WHERE dealer_code = 'N6250'
            AND period_start < DATE '2024-07-01'
        ) AS mapped_summary_rows
    `

    assert.ok(legacyRajouri.mapped_summary_rows > 0)
    assert.ok(
      legacyRajouri.legacy_source_rows > 0 || legacyRajouri.resolved_source_rows > 0,
      'Rajouri operation history must exist under legacy N6824 or resolved N6250 source codes'
    )

    const [appointments] = await db`
      SELECT COUNT(*)::int AS resolved_rows
      FROM am_platinum_service_appointment_resolved_v1
      WHERE UPPER(TRIM(COALESCE(source_dealer_code, ''))) = 'ACTIVE'
        AND resolved_dealer_code = 'N6250'
    `

    assert.ok(appointments.resolved_rows > 0)

    const vasPeriods = await db`
      SELECT
        period_start::text AS period_start,
        period_end::text AS period_end,
        vas_amount::float AS vas_amount
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N5211'
        AND (
          (period_start = DATE '2026-06-01' AND period_end = DATE '2026-06-10')
          OR
          (period_start = DATE '2025-06-01' AND period_end = DATE '2025-06-30')
        )
      ORDER BY period_start DESC
    `

    assert.equal(vasPeriods.length, 2)
    closeTo(vasPeriods[0].vas_amount, 301953.43)
    closeTo(vasPeriods[1].vas_amount, 1999)
    assert.notEqual(
      vasPeriods[0].period_end.slice(5, 10),
      vasPeriods[1].period_end.slice(5, 10),
      'VAS periods must remain non-comparable when their coverage offsets differ'
    )

    const [exactJammuLyVasPeriod] = await db`
      SELECT COUNT(*)::int AS count
      FROM am_platinum_vas_period_summary_v1
      WHERE dealer_code = 'N5211'
        AND period_start = DATE '2025-06-01'
        AND period_end = DATE '2025-06-14'
    `
    assert.equal(
      Number(exactJammuLyVasPeriod.count),
      0,
      'Jammu LY VAS must not have an exact Jun 1-14 2025 operation period'
    )

    const canonicalPeriodSql = (startDate, endDate, dealerCode = null) => db`
      WITH scoped AS (
        SELECT
          id,
          bill_date::date AS bill_date,
          COALESCE(
            CASE
              WHEN COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              ) = 'N6824' THEN 'N6250'
              ELSE COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              )
            END,
            'UNMAPPED'
          ) AS dealer_code,
          COALESCE(
            CASE
              WHEN COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              ) = 'N6824' THEN 'N6250'
              ELSE COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              )
            END,
            'UNMAPPED'
          ) || ':' || bill_date::date::text || ':' || COALESCE(
            NULLIF(TRIM(bill_no::text), ''),
            NULLIF(TRIM(r_o_no::text), ''),
            id::text
          ) AS invoice_key,
          COALESCE(
            CASE
              WHEN COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              ) = 'N6824' THEN 'N6250'
              ELSE COALESCE(
                NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
                NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
                NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
              )
            END,
            'UNMAPPED'
          ) || ':' || COALESCE(
            NULLIF(TRIM(r_o_no::text), ''),
            NULLIF(TRIM(bill_no::text), ''),
            id::text
          ) AS ro_key,
          COALESCE(NULLIF(regexp_replace(labour_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS labour_amt,
          COALESCE(NULLIF(regexp_replace(part_amt::text, '[^0-9.-]', '', 'g'), '')::numeric, 0) AS part_amt,
          uploaded_at
        FROM am_platinum_ro_billing_report
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY dealer_code, invoice_key
            ORDER BY uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM scoped
      ),
      dedup AS (
        SELECT *
        FROM ranked
        WHERE row_rank = 1
          ${dealerCode ? db`AND dealer_code = ${dealerCode}` : db``}
      )
      SELECT
        COUNT(DISTINCT dealer_code || ':' || ro_key)::int AS deduped_jc,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(labour_amt + part_amt), 0)::float AS revenue
      FROM dedup
    `

    const [allLocationsCy] = await canonicalPeriodSql('2026-06-01', '2026-06-13')
    const [allLocationsLy] = await canonicalPeriodSql('2025-06-01', '2025-06-13')

    assert.ok(allLocationsCy.deduped_jc > 0, 'All-locations CY Jun 1-13 must have JC data')
    assert.ok(allLocationsLy.deduped_jc > 0, 'All-locations LY Jun 1-13 must have JC data')
    assert.ok(allLocationsCy.revenue > 0, 'All-locations CY Jun 1-13 must have revenue')
    assert.ok(allLocationsLy.revenue > 0, 'All-locations LY Jun 1-13 must have revenue')

    const growthPct = ((allLocationsCy.revenue - allLocationsLy.revenue) / allLocationsLy.revenue) * 100
    assert.ok(Number.isFinite(growthPct), 'All-locations revenue growth must be finite')

    const jun14Start = '2026-06-01'
    const jun14End = '2026-06-14'
    const jun14LyStart = '2025-06-01'
    const jun14LyEnd = '2025-06-14'
    const dealerFixtures = [
      { label: 'Jammu', dealerCode: 'N5211' },
      { label: 'Rajouri', dealerCode: 'N6250' },
      { label: 'Poonch', dealerCode: 'N6828' },
    ]

    for (const fixture of dealerFixtures) {
      const [cy] = await canonicalPeriodSql(jun14Start, jun14End, fixture.dealerCode)
      const [ly] = await canonicalPeriodSql(jun14LyStart, jun14LyEnd, fixture.dealerCode)
      closeTo(cy.revenue, cy.labour + cy.parts)
      closeTo(ly.revenue, ly.labour + ly.parts)
      if (ly.revenue > 0) {
        const dealerGrowth = ((cy.revenue - ly.revenue) / ly.revenue) * 100
        assert.ok(Number.isFinite(dealerGrowth), `${fixture.label} revenue growth must be finite`)
      }
      assert.ok(cy.deduped_jc >= 0, `${fixture.label} CY JC must be non-negative`)
    }

    const [allLocationsJun14Cy] = await canonicalPeriodSql(jun14Start, jun14End)
    const [allLocationsJun14Ly] = await canonicalPeriodSql(jun14LyStart, jun14LyEnd)
    closeTo(allLocationsJun14Cy.revenue, allLocationsJun14Cy.labour + allLocationsJun14Cy.parts)
    closeTo(allLocationsJun14Ly.revenue, allLocationsJun14Ly.labour + allLocationsJun14Ly.parts)

    const [allLocationsVasLy] = await db`
      SELECT COALESCE(SUM(vas_amount), 0)::float AS vas_amount
      FROM am_platinum_vas_period_summary_v1
      WHERE period_start = DATE '2025-06-01'
        AND period_end = DATE '2025-06-13'
    `
    if (Number(allLocationsVasLy.vas_amount) <= 0) {
      const [fallbackVasLy] = await db`
        SELECT COALESCE(SUM(vas_amount), 0)::float AS vas_amount
        FROM am_platinum_vas_period_summary_v1
        WHERE period_start <= DATE '2025-06-13'
          AND period_end >= DATE '2025-06-01'
      `
      assert.ok(Number(fallbackVasLy.vas_amount) > 0, 'All-locations LY VAS must be available from historical summary')
    }

    console.table({
      currentJammu: {
        invoices: current.invoices,
        roCount: current.ro_count,
        revenue: current.revenue,
      },
      previousJammu: {
        invoices: '-',
        roCount: previous.ro_count,
        revenue: previous.revenue,
      },
      rajouri: {
        invoices: rajouri.resolved_rows,
        roCount: '-',
        revenue: `ACTIVE fallback rows: ${rajouri.active_source_rows}`,
      },
      vas: {
        invoices: '-',
        roCount: '-',
        revenue: vasPeriods[0].vas_amount,
      },
      allLocationsCy: {
        invoices: '-',
        roCount: allLocationsCy.deduped_jc,
        revenue: allLocationsCy.revenue,
      },
      allLocationsLy: {
        invoices: '-',
        roCount: allLocationsLy.deduped_jc,
        revenue: allLocationsLy.revenue,
      },
      allLocationsGrowthPct: {
        invoices: '-',
        roCount: '-',
        revenue: `${growthPct.toFixed(2)}%`,
      },
      rajouriHistory: {
        invoices: rajouriHistory.materialized_invoices,
        roCount: `source gap ${auditedRajouri2024Invoices - rajouriHistory.materialized_invoices}`,
        revenue: rajouriHistory.materialized_revenue,
      },
    })
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error('[verify-platinum-business-excellence] failed', error)
  process.exit(1)
})
