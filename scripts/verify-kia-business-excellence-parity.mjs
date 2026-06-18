import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '../lib/analytics/db.ts'
import {
  getKiaWorkingDayContext,
  kiaActiveBillStatusSql,
  kiaActiveServiceCategoryFilter,
  kiaOpenRoActiveStateSql,
  kiaOpenRoDealerFilter,
  kiaRoBillingDealerFilter,
  kiaServiceCategoryExpression,
} from '../lib/kia/business-excellence-contract.ts'
import { fetchDeliveredBillingKpis } from '../lib/kia/ro-billing-kpis.ts'
import {
  buildKiaServiceDashboardWorkbook,
  buildServiceDashboardMetrics,
} from '../lib/kia/service-dashboard-export.ts'

const START_DATE = '2026-06-01'
const END_DATE = '2026-06-17'
const DEALER = 'JK402'

const MD_EXPECTED = new Map([
  [2, [0, 38]],
  [3, [4, 43]],
  [4, [1, 38]],
  [5, [0, 33]],
  [6, [5, 152]],
  [7, [0, 17]],
  [8, [1, 1]],
  [9, [0, 3]],
  [10, [1, 18]],
  [11, [0, 1]],
  [12, [0, 0]],
  [13, [21007, 599479]],
  [14, [62410, 1016086]],
  [15, [16486, 298011]],
  [16, [21748, 520941]],
  [17, [4521, 301468]],
  [18, [40662, 495145]],
  [19, [0, 38]],
  [20, [4, 46]],
  [21, [0, 37]],
  [22, [2, 27]],
  [23, [6, 148]],
  [24, [57, 57]],
  [25, [48, 48]],
  [26, [35436, 35436]],
  [27, [30073, 30073]],
  [28, [12, 12]],
  [29, [4051, 4051]],
  [30, [2463, 2463]],
  [31, [11165, 11165]],
  [32, [6865, 6865]],
  [33, [4305, 4305]],
  [34, [18339, 18339]],
  [35, [309, 309]],
  [36, [2, 2]],
  [37, [0, 0]],
  [38, [0, 0]],
  [39, [0, 0]],
  [40, [3, 3]],
  [41, [3625, 3625]],
  [42, [6, 6]],
])

function cellNumber(cell) {
  const value = cell.value
  if (value && typeof value === 'object' && 'result' in value) return Number(value.result || 0)
  return Number(cell.text.replace(/,/g, '') || 0)
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`)
  }
  console.log(`OK ${label}: ${actual}`)
}

async function fetchCanonicalOpenCount(dealerCode) {
  const rows = await db.execute(sql`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
        COALESCE(NULLIF(o.r_o_no, ''), o.id::text) AS ro_key,
        ${kiaServiceCategoryExpression('o.work_type')} AS service_category
      FROM open_ro_yearly o
      WHERE ${kiaOpenRoActiveStateSql('o.')}
        AND o.ro_date >= ${START_DATE}::date
        AND o.ro_date < (${END_DATE}::date + INTERVAL '1 day')
        ${kiaOpenRoDealerFilter(dealerCode, 'o.')}
        AND NOT EXISTS (
          SELECT 1
          FROM ro_billing_report rb
          WHERE rb.bill_date < (${END_DATE}::date + INTERVAL '1 day')
            AND ${kiaActiveBillStatusSql('rb.')}
            ${kiaRoBillingDealerFilter(dealerCode, 'rb.')}
            AND COALESCE(NULLIF(rb.ro_no, ''), NULLIF(rb.bill_no, ''), rb.id::text)
              = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
        )
      ORDER BY COALESCE(NULLIF(o.r_o_no, ''), o.id::text), o.uploaded_at DESC NULLS LAST, o.id DESC
    )
    SELECT COUNT(*)::int AS total_open
    FROM active
  `)
  return Number(rows[0]?.total_open || 0)
}

async function fetchCanonicalBillingCount(dealerCode) {
  const rows = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS delivered
    FROM ro_billing_report
    WHERE bill_date >= ${START_DATE}::date
      AND bill_date < (${END_DATE}::date + INTERVAL '1 day')
      AND ${kiaActiveBillStatusSql()}
      AND ${kiaActiveServiceCategoryFilter()}
      ${kiaRoBillingDealerFilter(dealerCode)}
  `)
  return Number(rows[0]?.delivered || 0)
}

async function verifyDealerScope(dealerCode) {
  const [dashboard, billing, directBilling, openCount] = await Promise.all([
    buildServiceDashboardMetrics(END_DATE, dealerCode),
    fetchDeliveredBillingKpis(START_DATE, END_DATE, dealerCode),
    fetchCanonicalBillingCount(dealerCode),
    fetchCanonicalOpenCount(dealerCode),
  ])
  const dashboardDelivered = Object.values(dashboard.revenue.delivered)
    .reduce((sum, value) => sum + value.mtd, 0)

  assertEqual(`${dealerCode || 'all'} dashboard vs RO Billing delivered`, dashboardDelivered, billing.deliveredCount)
  assertEqual(`${dealerCode || 'all'} RO Billing helper vs direct SQL`, billing.deliveredCount, directBilling)
  console.log(`OK ${dealerCode || 'all'} canonical open RO count: ${openCount}`)
}

async function main() {
  const [{ worksheet }, workingDays] = await Promise.all([
    buildKiaServiceDashboardWorkbook({ endDate: END_DATE, dealerCode: DEALER }),
    getKiaWorkingDayContext(START_DATE, END_DATE),
  ])

  for (const [row, [expectedToday, expectedMtd]] of MD_EXPECTED) {
    assertEqual(`MD row ${row} Today`, cellNumber(worksheet.getCell(`B${row}`)), expectedToday)
    assertEqual(`MD row ${row} MTD`, cellNumber(worksheet.getCell(`C${row}`)), expectedMtd)
  }
  assertEqual('Completed working days', workingDays.workingDayCount, 13)

  await verifyDealerScope('JK402')
  await verifyDealerScope('JK501')
  await verifyDealerScope(null)
  console.log('KIA Business Excellence parity verification passed.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
