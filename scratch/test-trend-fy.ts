import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'

const startDate = new Date('2026-06-01')
const endDate = new Date('2026-06-24')

// Helper functions copied from overview route
function normalizeHyundaiDealerCode(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized || normalized === 'ALL' || normalized === 'ALL_LOCATIONS') return null
  if (normalized === 'JAMMU' || normalized === 'HYUNDAI_JAMMU') return 'JAMMU'
  if (normalized === 'AKHNOOR' || normalized === 'HYUNDAI_AKHNOOR') return 'AKHNOOR'
  if (normalized === 'KATHUA' || normalized === 'HYUNDAI_KATHUA') return 'KATHUA'
  if (normalized === 'RS_PURA' || normalized === 'RSPURA' || normalized === 'HYUNDAI_RS_PURA') return 'RS_PURA'
  if (normalized === 'VIJAYPUR' || normalized === 'HYUNDAI_VIJAYPUR') return 'VIJAYPUR'
  if (normalized === 'BILLAWAR' || normalized === 'HYUNDAI_BILLAWAR' || normalized === 'UDHAMPUR' || normalized === 'HYUNDAI_UDHAMPUR') return 'BILLAWAR'
  return null
}

function getHyundaiDealerCodes(value: string | null | undefined): string[] {
  const normalized = normalizeHyundaiDealerCode(value)
  if (normalized === 'JAMMU') return ['N5203', 'N5216']
  if (normalized === 'AKHNOOR') return ['N5701', 'N6844']
  if (normalized === 'KATHUA') return ['N5804', 'N6845']
  if (normalized === 'RS_PURA') return ['N6815', 'N6846']
  if (normalized === 'VIJAYPUR') return ['N6819', 'N6847']
  if (normalized === 'BILLAWAR') return ['N6826', 'N6828', 'N6848']
  return []
}

function hyundaiSourceDealerSql(
  sourceColumn = sql.raw('source_dealer_code'),
  fallbackColumns: any[] = [],
) {
  const candidates = [
    sql`NULLIF(NULLIF(UPPER(TRIM(COALESCE(${sourceColumn}::text, ''))), ''), 'ACTIVE')`,
    ...fallbackColumns.map((column) => sql`NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), '')`),
  ]
  const resolved = sql`COALESCE(${sql.join(candidates, sql`, `)})`

  return sql`
    CASE
      WHEN ${resolved} IN ('N5203', 'N5216') THEN 'JAMMU'
      WHEN ${resolved} IN ('N5701', 'N6844') THEN 'AKHNOOR'
      WHEN ${resolved} IN ('N5804', 'N6845') THEN 'KATHUA'
      WHEN ${resolved} IN ('N6815', 'N6846') THEN 'RS_PURA'
      WHEN ${resolved} IN ('N6819', 'N6847') THEN 'VIJAYPUR'
      WHEN ${resolved} IN ('N6826', 'N6828', 'N6848') THEN 'BILLAWAR'
      WHEN UPPER(TRIM(COALESCE(${sourceColumn}::text, ''))) = 'ACTIVE' THEN 'JAMMU'
      ELSE ${resolved}
    END
  `
}

function hyundaiSourceDealerFilter(
  dealerCode: string | null | undefined,
  sourceColumn = sql.raw('source_dealer_code'),
  fallbackColumns: any[] = [],
) {
  const normalized = normalizeHyundaiDealerCode(dealerCode)
  return normalized
    ? sql`AND ${hyundaiSourceDealerSql(sourceColumn, fallbackColumns)} = ${normalized}`
    : sql``
}

function roBillingDealerFilter(dealerCode: string | null) {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('main_dealer_code')],
  )
}

function activeBillStatusSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'`
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sameDateLastYear(date: Date) {
  return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate())
}

async function testFetchDaily(dealerCode: string | null) {
  console.log(`Running daily trend query for dealerCode: ${dealerCode || 'ALL_LOCATIONS'}...`)
  const start = Date.now()
  const relationalStart = sameDateLastYear(startDate)
  const relationalEnd = endDate
  try {
    const result = await db.execute(sql`
      WITH ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY bill_key
            ORDER BY ABS(labour_amt + part_amt) DESC, uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM (
          SELECT
            id,
            COALESCE(${hyundaiSourceDealerSql()}, 'UNMAPPED') || ':' || bill_date::date::text || ':' || COALESCE(
              NULLIF(TRIM(bill_no::text), ''),
              NULLIF(TRIM(r_o_no::text), ''),
              id::text
            ) AS bill_key,
            COALESCE(${hyundaiSourceDealerSql()}, 'UNMAPPED') || ':' || COALESCE(
              NULLIF(TRIM(r_o_no::text), ''),
              NULLIF(TRIM(bill_no::text), ''),
              id::text
            ) AS ro_key,
            bill_date::date AS bill_date,
            COALESCE(labour_amt, 0)::numeric AS labour_amt,
            COALESCE(part_amt, 0)::numeric AS part_amt,
            uploaded_at
          FROM hyundai_ro_billing_report
          WHERE bill_date >= ${toDateInputValue(relationalStart)}::date
            AND bill_date < (${toDateInputValue(relationalEnd)}::date + INTERVAL '1 day')
            AND ${activeBillStatusSql()}
            ${roBillingDealerFilter(dealerCode)}
        ) base
      ),
      dedup AS (
        SELECT bill_key, ro_key, bill_date, labour_amt, part_amt
        FROM ranked
        WHERE row_rank = 1
      )
      SELECT
        bill_date,
        COUNT(DISTINCT ro_key)::int AS load,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts
      FROM dedup
      GROUP BY bill_date
      ORDER BY bill_date
    `)
    console.log(`Success! Daily rows: ${result.length} (took ${Date.now() - start}ms)`)
  } catch (error) {
    console.error(`Daily query failed for ${dealerCode || 'ALL'}:`, error)
  }
}

async function testFetchFiscal(dealerCode: string | null) {
  console.log(`Running fiscal trend query for dealerCode: ${dealerCode || 'ALL_LOCATIONS'}...`)
  const start = Date.now()
  try {
    const result = await db.execute(sql`
      WITH ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY bill_key
            ORDER BY ABS(labour_amt + part_amt) DESC, uploaded_at DESC NULLS LAST, id DESC
          ) AS row_rank
        FROM (
          SELECT
            id,
            COALESCE(${hyundaiSourceDealerSql()}, 'UNMAPPED') || ':' || bill_date::date::text || ':' || COALESCE(
              NULLIF(TRIM(bill_no::text), ''),
              NULLIF(TRIM(r_o_no::text), ''),
              id::text
            ) AS bill_key,
            COALESCE(${hyundaiSourceDealerSql()}, 'UNMAPPED') || ':' || COALESCE(
              NULLIF(TRIM(r_o_no::text), ''),
              NULLIF(TRIM(bill_no::text), ''),
              id::text
            ) AS ro_key,
            bill_date::date AS bill_date,
            COALESCE(labour_amt, 0)::numeric AS labour_amt,
            COALESCE(part_amt, 0)::numeric AS part_amt,
            uploaded_at
          FROM hyundai_ro_billing_report
          WHERE bill_date IS NOT NULL
            AND ${activeBillStatusSql()}
            ${roBillingDealerFilter(dealerCode)}
        ) base
      ),
      dedup AS (
        SELECT bill_key, ro_key, bill_date, labour_amt, part_amt
        FROM ranked
        WHERE row_rank = 1
      ),
      fiscal AS (
        SELECT
          CASE
            WHEN EXTRACT(MONTH FROM bill_date) >= 4 THEN EXTRACT(YEAR FROM bill_date)::int
            ELSE EXTRACT(YEAR FROM bill_date)::int - 1
          END AS fiscal_start_year,
          COUNT(DISTINCT ro_key)::int AS load,
          COALESCE(SUM(labour_amt), 0)::float AS labour,
          COALESCE(SUM(part_amt), 0)::float AS parts
        FROM dedup
        GROUP BY fiscal_start_year
      )
      SELECT
        ('FY ' || fiscal_start_year::text || '-' || RIGHT((fiscal_start_year + 1)::text, 2)) AS fy,
        load,
        labour,
        parts
      FROM fiscal
      ORDER BY fiscal_start_year DESC
      LIMIT 5
    `)
    console.log(`Success! Fiscal rows: ${result.length} (took ${Date.now() - start}ms)`)
  } catch (error) {
    console.error(`Fiscal query failed for ${dealerCode || 'ALL'}:`, error)
  }
}

async function main() {
  await testFetchDaily(null)
  await testFetchFiscal(null)
}

main().catch(console.error).finally(() => db.end({ timeout: 5 }))
