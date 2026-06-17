import { analyticsDb as db } from '@/lib/analytics/db'
import { sql } from 'drizzle-orm'
import { fetchDeliveredBillingKpis } from '@/lib/kia/ro-billing-kpis'

async function main() {
  try {
    const startDate = '2026-06-01'
    const endDate = '2026-06-17'

    // 1. Get KPI values
    const kpis = await fetchDeliveredBillingKpis(startDate, endDate)
    console.log('KPI Cards (Correct values):')
    console.log({
      load: kpis.deliveredCount,
      labour: kpis.labour,
      parts: kpis.parts,
      labPerVeh: Math.round(kpis.labourPerVehicle),
      partPerVeh: Math.round(kpis.partsPerVehicle),
      avgBilling: Math.round(kpis.avgBilling)
    })

    // 2. Get daily aggregate values from analysis (dedup GROUP BY bill_key, bill_date)
    const dailyResult = await db.execute(sql`
      WITH dedup AS (
        SELECT
          bill_key,
          bill_date,
          (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
          (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
        FROM (
          SELECT
            COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS bill_key,
            bill_date::date AS bill_date,
            COALESCE(labour_amt, 0)::numeric AS labour_amt,
            COALESCE(part_amt, 0)::numeric AS part_amt
          FROM ro_billing_report
          WHERE bill_date >= ${startDate}::date
            AND bill_date <= ${endDate}::date
            AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
            AND CASE
              WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%accident%'
                OR LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%bodyshop%'
                THEN 'Accidental Repair'
              WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%running%'
                THEN 'Running Repair'
              WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%free%'
                THEN 'Free Service'
              WHEN LOWER(CONCAT_WS(' ', work_type, service_type)) LIKE '%paid%'
                OR COALESCE(service_type, '') ~* '^[0-9]+K$'
                THEN 'Paid Service'
              ELSE 'Others'
            END IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
        ) base
        GROUP BY bill_key, bill_date
      )
      SELECT
        COUNT(*)::int AS load,
        SUM(labour_amt)::float AS labour,
        SUM(part_amt)::float AS parts
      FROM dedup
    `)
    console.log('\nDaily Aggregate Query (used for TD/MTD/QTD/YTD trend table):')
    const load = Number(dailyResult[0]?.load || 0)
    const labour = Number(dailyResult[0]?.labour || 0)
    const parts = Number(dailyResult[0]?.parts || 0)
    console.log({
      load,
      labour,
      parts,
      labPerVeh: Math.round(load > 0 ? labour / load : 0),
      partPerVeh: Math.round(load > 0 ? parts / load : 0),
      avgBilling: Math.round(load > 0 ? (labour + parts) / load : 0)
    })

  } catch (error) {
    console.error('Error running script:', error)
  }
}

main()
