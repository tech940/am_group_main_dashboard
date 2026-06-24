import 'dotenv/config'
import postgres from 'postgres'

const startDate = process.argv[2] || '2026-06-01'
const endDate = process.argv[3] || '2026-06-30'
const rawUrl = process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL || process.env.POSTGRES_URL
if (!rawUrl) throw new Error('DATABASE_URL is not configured')

const db = postgres(rawUrl, {
  ssl: { rejectUnauthorized: false },
  prepare: false,
  max: 1,
  connect_timeout: 30,
  connection: {
    application_name: 'verify_hyundai_business_excellence_parity',
    statement_timeout: 300_000,
  },
})

const dealerCase = `
  CASE
    WHEN resolved_dealer IN ('N5203', 'N5216') OR source_dealer = 'ACTIVE' THEN 'JAMMU'
    WHEN resolved_dealer IN ('N5701', 'N6844') THEN 'AKHNOOR'
    WHEN resolved_dealer IN ('N5804', 'N6845') THEN 'KATHUA'
    WHEN resolved_dealer IN ('N6815', 'N6846') THEN 'RS_PURA'
    WHEN resolved_dealer IN ('N6819', 'N6847') THEN 'VIJAYPUR'
    WHEN resolved_dealer IN ('N6826', 'N6828', 'N6848') THEN 'BILLAWAR'
    ELSE COALESCE(resolved_dealer, 'UNMAPPED')
  END
`

async function main() {
  const integrity = await db`
    SELECT
      (SELECT COUNT(*) FROM hyundai_ro_billing_report)::int AS billing_rows,
      (SELECT COUNT(DISTINCT row_hash) FROM hyundai_ro_billing_report)::int AS billing_hashes,
      (SELECT COUNT(*) FROM hyundai_repair_order_list)::int AS repair_rows,
      (SELECT COUNT(DISTINCT row_hash) FROM hyundai_repair_order_list)::int AS repair_hashes,
      (SELECT COUNT(*) FROM hyundai_operation_wise_analysis_report)::int AS operation_rows,
      (SELECT COUNT(DISTINCT row_hash) FROM hyundai_operation_wise_analysis_report)::int AS operation_hashes,
      (
        SELECT COUNT(*)::int
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
            'hyundai_ro_billing_safe_hash',
            'hyundai_repair_order_safe_hash',
            'hyundai_operation_safe_hash'
          )
      ) AS safe_hash_triggers
  `
  const billing = await db.unsafe(`
    WITH normalized AS (
      SELECT
        *,
        UPPER(TRIM(COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) AS resolved_dealer,
        UPPER(TRIM(COALESCE(source_dealer_code, ''))) AS source_dealer
      FROM hyundai_ro_billing_report
      WHERE bill_date >= $1::date
        AND bill_date < ($2::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(bill_type, ''))) NOT LIKE '%cancel%'
    ),
    keyed AS (
      SELECT
        ${dealerCase} AS dealer,
        bill_date::date AS bill_date,
        COALESCE(NULLIF(TRIM(bill_no), ''), NULLIF(TRIM(r_o_no), ''), id::text) AS invoice_no,
        COALESCE(NULLIF(TRIM(r_o_no), ''), NULLIF(TRIM(bill_no), ''), id::text) AS ro_no,
        COALESCE(labour_amt, 0)::numeric AS labour,
        COALESCE(part_amt, 0)::numeric AS parts,
        uploaded_at,
        id
      FROM normalized
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY dealer, bill_date, invoice_no
          ORDER BY ABS(labour + parts) DESC, uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM keyed
    )
    SELECT
      dealer,
      COUNT(DISTINCT dealer || ':' || ro_no)::int AS load,
      ROUND(SUM(labour), 2)::float AS labour,
      ROUND(SUM(parts), 2)::float AS parts,
      ROUND(SUM(labour + parts), 2)::float AS revenue
    FROM ranked
    WHERE row_rank = 1
    GROUP BY dealer
    ORDER BY dealer
  `, [startDate, endDate])

  const complaints = await db`
    SELECT
      COUNT(*)::int AS rows_with_business_date,
      MIN(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text AS min_date,
      MAX(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text AS max_date
    FROM hyundai_call_center_complaints
    WHERE COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date) IS NOT NULL
  `

  const operationExists = await db`SELECT to_regclass('public.hyundai_operation_wise_analysis_report') IS NOT NULL AS exists`
  const operation = operationExists[0]?.exists
    ? await db`
        SELECT
          MIN(report_period_start)::text AS min_period_start,
          MAX(report_period_end)::text AS max_period_end,
          COUNT(*)::int AS rows,
          COUNT(DISTINCT NULLIF(row_hash, ''))::int AS distinct_hashes
        FROM hyundai_operation_wise_analysis_report
      `
    : [{ min_period_start: null, max_period_end: null, rows: 0, distinct_hashes: 0 }]

  const unmappedLegacyCodes = await db`
    SELECT code, SUM(rows)::int AS rows
    FROM (
      SELECT UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, main_dealer_code, ''))) AS code, COUNT(*)::int AS rows
      FROM hyundai_ro_billing_report
      WHERE UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, main_dealer_code, ''))) IN ('N5217', 'N6849')
      GROUP BY 1
      UNION ALL
      SELECT UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, dlr_no, ''))) AS code, COUNT(*)::int AS rows
      FROM hyundai_repair_order_list
      WHERE UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, dlr_no, ''))) IN ('N5217', 'N6849')
      GROUP BY 1
      UNION ALL
      SELECT UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, ''))) AS code, COUNT(*)::int AS rows
      FROM hyundai_operation_wise_analysis_report
      WHERE UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, ''))) IN ('N5217', 'N6849')
      GROUP BY 1
    ) source
    GROUP BY code
    ORDER BY code
  `

  const totals = billing.reduce((acc, row) => ({
    load: acc.load + Number(row.load || 0),
    labour: acc.labour + Number(row.labour || 0),
    parts: acc.parts + Number(row.parts || 0),
    revenue: acc.revenue + Number(row.revenue || 0),
  }), { load: 0, labour: 0, parts: 0, revenue: 0 })

  const result = {
    dateRange: { startDate, endDate },
    dealerRows: billing,
    allLocations: totals,
    complaints: complaints[0],
    operationWise: operation[0],
    integrity: integrity[0],
    unmappedLegacyCodes,
    checks: {
      revenueReconciles: Math.abs(totals.revenue - totals.labour - totals.parts) < 0.02,
      complaintFallbackHasRows: Number(complaints[0]?.rows_with_business_date || 0) > 0,
      billingRecoveryCount: Number(integrity[0]?.billing_rows) === 134485,
      repairRecoveryCount: Number(integrity[0]?.repair_rows) === 170132,
      operationRecoveryCount: Number(integrity[0]?.operation_rows) === 34979,
      uniqueSafeHashes:
        Number(integrity[0]?.billing_rows) === Number(integrity[0]?.billing_hashes)
        && Number(integrity[0]?.repair_rows) === Number(integrity[0]?.repair_hashes)
        && Number(integrity[0]?.operation_rows) === Number(integrity[0]?.operation_hashes),
      safeHashTriggersInstalled: Number(integrity[0]?.safe_hash_triggers) === 3,
    },
  }

  console.log(JSON.stringify(result, null, 2))
  if (Object.values(result.checks).some((value) => !value)) process.exitCode = 1
}

try {
  await main()
} finally {
  await db.end()
}
