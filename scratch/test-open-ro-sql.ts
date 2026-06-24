import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db'

const startDate = '2026-06-01'
const endDate = '2026-06-24'

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

function openRoDealerFilter(dealerCode: string | null, tableAlias = '') {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw(`${tableAlias}dealer`),
    [
      sql.raw(`${tableAlias}source_dealer_code`),
      sql.raw(`${tableAlias}dealer_code`),
      sql.raw(`${tableAlias}dlr_no`)
    ]
  )
}

function getUniqueRoKeySql() {
  return sql`COALESCE(${hyundaiSourceDealerSql(sql.raw('dealer'), [sql.raw('source_dealer_code'), sql.raw('dealer_code'), sql.raw('dlr_no')])}, 'UNMAPPED') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text)`
}

async function testOpenRoQuery(dealerCode: string | null, enforceStartDate: boolean) {
  console.log(`Testing open RO query for dealerCode: ${dealerCode || 'ALL_LOCATIONS'}, enforceStartDate: ${enforceStartDate}...`)
  const start = Date.now()
  try {
    const result = await db.execute(sql`
      WITH latest_ro AS (
        SELECT DISTINCT ON (${getUniqueRoKeySql()})
          id,
          ${getUniqueRoKeySql()} AS ro_key,
          r_o_date::date AS ro_date,
          r_o_status,
          status,
          new_r_o_status,
          type_of_free_service,
          cancel_date,
          uploaded_at
        FROM hyundai_repair_order_list
        WHERE r_o_date < (${endDate}::date + INTERVAL '1 day')
          ${enforceStartDate ? sql`AND r_o_date >= ${startDate}::date` : sql``}
          ${openRoDealerFilter(dealerCode)}
        ORDER BY ${getUniqueRoKeySql()}, uploaded_at DESC NULLS LAST, id DESC
      ),
      active AS (
        SELECT
          ro_key,
          ro_date,
          uploaded_at
        FROM latest_ro
        WHERE cancel_date IS NULL
          AND NOT (
            LOWER(COALESCE(status::text, '')) ~ '(close|closed|delivered|cancel)'
            OR LOWER(COALESCE(r_o_status::text, '')) ~ '(close|closed|delivered|cancel)'
            OR LOWER(COALESCE(new_r_o_status::text, '')) ~ '(close|closed|delivered|cancel)'
            OR LOWER(COALESCE(type_of_free_service::text, '')) ~ '(close|closed|delivered|cancel)'
          )
      )
      SELECT COUNT(*)::int AS total FROM active
    `)
    console.log(`Success! Total Open ROs: ${result[0]?.total} (took ${Date.now() - start}ms)`)
  } catch (error) {
    console.error(`Open RO query failed for ${dealerCode || 'ALL'}:`, error)
  }
}

async function main() {
  console.log('--- WITH START DATE FILTER (June 2026 only) ---')
  await testOpenRoQuery(null, true)
  await testOpenRoQuery('JAMMU', true)
  await testOpenRoQuery('KATHUA', true)

  console.log('\n--- WITHOUT START DATE FILTER (All historical open ROs up to June 2026) ---')
  await testOpenRoQuery(null, false)
  const branches = ['JAMMU', 'AKHNOOR', 'KATHUA', 'RS_PURA', 'VIJAYPUR', 'BILLAWAR']
  for (const branch of branches) {
    await testOpenRoQuery(branch, false)
  }
}

main().catch(console.error).finally(() => db.end({ timeout: 5 }))
