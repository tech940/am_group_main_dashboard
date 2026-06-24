import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'
import { fetchHyundaiMonthlyOperationMetrics } from '../lib/hyundai/business-excellence-operations'

const startDate = '2026-06-01'
const endDate = '2026-06-24'

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

async function testFetchWorkType(dealerCode: string | null) {
  console.log(`Running query for dealerCode: ${dealerCode || 'ALL_LOCATIONS'}...`)
  const start = Date.now()
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    `)
    console.log(`Success! Count: ${result[0]?.total} (took ${Date.now() - start}ms)`)
  } catch (error) {
    console.error(`Query failed for ${dealerCode || 'ALL'}:`, error)
  }
}

async function testFetchOperations(dealerCode: string | null) {
  console.log(`Running operations query for dealerCode: ${dealerCode || 'ALL_LOCATIONS'}...`)
  const start = Date.now()
  try {
    const res = await fetchHyundaiMonthlyOperationMetrics(endDate, dealerCode)
    console.log(`Success! Available: ${res.available}, vasAmount: ${res.vasAmount} (took ${Date.now() - start}ms)`)
  } catch (error) {
    console.error(`Operations query failed for ${dealerCode || 'ALL'}:`, error)
  }
}

async function main() {
  await testFetchWorkType(null)
  await testFetchOperations(null)
  
  const branches = ['JAMMU', 'AKHNOOR', 'KATHUA', 'RS_PURA', 'VIJAYPUR', 'BILLAWAR']
  for (const branch of branches) {
    await testFetchWorkType(branch)
    await testFetchOperations(branch)
  }
}

main().catch(console.error).finally(() => db.end({ timeout: 5 }))
