import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import type { KiaDealerCode } from '@/lib/kia/dealer-branch'
import {
  activeBillStatusSql,
  getMonthStart,
  numberValue,
  numericText,
  resultRows,
  roBillingDealerFilter,
  serviceCategoryExpression,
} from '@/lib/kia/service-dashboard-metrics'
import { buildServiceDashboardMetrics } from '@/lib/kia/service-dashboard-export'

export const KIA_SERVICE_CATEGORIES = [
  'Free Service',
  'Paid Service',
  'Running Repair',
  'Accidental Repair',
] as const

export type KiaServiceCategory = typeof KIA_SERVICE_CATEGORIES[number]
export type KiaServiceDealerFilter = KiaDealerCode | null

export type DeliveredBillingKpis = {
  deliveredCount: number
  labour: number
  parts: number
  revenue: number
  labourPerVehicle: number
  partsPerVehicle: number
  avgBilling: number
  minBillDate: string | null
  maxBillDate: string | null
  deliveredByCategory: Record<KiaServiceCategory, number>
}

function perUnit(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function emptyDeliveredByCategory() {
  return KIA_SERVICE_CATEGORIES.reduce<Record<KiaServiceCategory, number>>((accumulator, category) => {
    accumulator[category] = 0
    return accumulator
  }, {} as Record<KiaServiceCategory, number>)
}

function isServiceDashboardMonthWindow(startDate: string, endDate: string) {
  return startDate === getMonthStart(endDate)
}

export function deriveDeliveredBillingKpis(input: {
  deliveredByCategory: Record<KiaServiceCategory, number>
  labour: number
  parts: number
  minBillDate?: string | null
  maxBillDate?: string | null
}): DeliveredBillingKpis {
  const deliveredCount = KIA_SERVICE_CATEGORIES.reduce(
    (sum, category) => sum + input.deliveredByCategory[category],
    0,
  )
  const labour = input.labour
  const parts = input.parts
  const revenue = labour + parts

  return {
    deliveredCount,
    labour,
    parts,
    revenue,
    labourPerVehicle: perUnit(labour, deliveredCount),
    partsPerVehicle: perUnit(parts, deliveredCount),
    avgBilling: perUnit(revenue, deliveredCount),
    minBillDate: input.minBillDate ?? null,
    maxBillDate: input.maxBillDate ?? null,
    deliveredByCategory: input.deliveredByCategory,
  }
}

/** Canonical delivered RO billing KPIs — same dedup, categories, and denominator as the Service Dashboard export (C23). */
export async function fetchDeliveredBillingKpis(
  startDate: string,
  endDate: string,
  dealerCode: KiaServiceDealerFilter = null,
): Promise<DeliveredBillingKpis> {
  if (isServiceDashboardMonthWindow(startDate, endDate)) {
    const metrics = await buildServiceDashboardMetrics(endDate, dealerCode)
    const deliveredByCategory = emptyDeliveredByCategory()
    KIA_SERVICE_CATEGORIES.forEach((category) => {
      deliveredByCategory[category] = metrics.revenue.delivered[category]?.mtd ?? 0
    })

    return deriveDeliveredBillingKpis({
      deliveredByCategory,
      labour: metrics.revenue.mechanicalLabour.mtd + metrics.revenue.bodyshopLabour.mtd,
      parts: metrics.revenue.mechanicalParts.mtd + metrics.revenue.bodyshopParts.mtd,
      minBillDate: metrics.monthStart,
      maxBillDate: metrics.exportDate,
    })
  }

  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        bill_date::date AS report_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        uploaded_at,
        id
      FROM kia_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY jc_key
          ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM raw
    ),
    dedup AS (
      SELECT *
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      service_category,
      COUNT(*)::int AS mtd_count,
      COALESCE(SUM(labour_amt), 0)::float AS mtd_labour,
      COALESCE(SUM(part_amt), 0)::float AS mtd_parts,
      MIN(report_date)::text AS min_bill_date,
      MAX(report_date)::text AS max_bill_date
    FROM dedup
    WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY service_category
  `)

  const deliveredByCategory = emptyDeliveredByCategory()
  let labour = 0
  let parts = 0
  let minBillDate: string | null = null
  let maxBillDate: string | null = null

  resultRows(result).forEach((row) => {
    const category = String(row.service_category || '') as KiaServiceCategory
    if (!KIA_SERVICE_CATEGORIES.includes(category)) return

    deliveredByCategory[category] = numberValue(row.mtd_count)
    labour += numberValue(row.mtd_labour)
    parts += numberValue(row.mtd_parts)

    const rowMin = row.min_bill_date ? String(row.min_bill_date) : null
    const rowMax = row.max_bill_date ? String(row.max_bill_date) : null
    if (rowMin && (!minBillDate || rowMin < minBillDate)) minBillDate = rowMin
    if (rowMax && (!maxBillDate || rowMax > maxBillDate)) maxBillDate = rowMax
  })

  return deriveDeliveredBillingKpis({
    deliveredByCategory,
    labour,
    parts,
    minBillDate,
    maxBillDate,
  })
}
