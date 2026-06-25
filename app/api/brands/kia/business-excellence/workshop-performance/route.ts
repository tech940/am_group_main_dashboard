import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { ACCIDENT_ADVISORS } from '@/lib/business-excellence/workshop-classification'
import { normalizeKiaDealerCode, type KiaDealerCode } from '@/lib/kia/dealer-branch'
import {
  KIA_BUSINESS_EXCELLENCE_CACHE_VERSION,
  buildKiaSourceMetadata,
  fetchKiaBillingSourceMetadata,
  kiaActiveBillStatusSql,
  kiaActiveServiceCategoryFilter,
} from '@/lib/kia/business-excellence-contract'
import {
  fetchCanonicalOperationMetrics,
  fetchEwRsaMcpCounts,
  fetchWorkshopVasDetails,
  operationDealerFilter,
  roBillingDealerFilter,
  wheelBalancingLabourMatchSql,
} from '@/lib/kia/service-dashboard-metrics'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const RESPONSE_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300'

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const tableExistsCache = new Map<string, boolean>()

type NumericRow = Record<string, unknown>
type ComparisonParams = {
  preset: string | null
  comparisonMode: string | null
  comparisonStartDate: string | null
  comparisonEndDate: string | null
}

type DealerFilter = KiaDealerCode | null

type ServiceAggregate = {
  serviceType: string
  groupType?: string
  totalJc: number
  labourAmount: number
  partAmount: number
  totalAmount: number
  discountAmount: number
}

type AddonAggregate = {
  serviceType: string
  vasAmount: number
  waCount: number
  waAmount: number
  wbCount: number
  wbAmount: number
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
    if (year && month && day) return new Date(year, month - 1, day)
  }
  return null
}

function sameDateLastYear(date: Date) {
  return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate())
}

function defaultRange() {
  const today = new Date()
  return {
    startDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toDateInputValue(today),
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function perRo(amount: number, totalJc: number) {
  return totalJc > 0 ? amount / totalJc : 0
}

function growth(current: number, previous: number) {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

function getComparisonParams(searchParams: URLSearchParams): ComparisonParams {
  return {
    preset: searchParams.get('periodPreset') || null,
    comparisonMode: searchParams.get('comparisonMode') || 'none',
    comparisonStartDate: searchParams.get('comparisonStartDate')?.slice(0, 10) || null,
    comparisonEndDate: searchParams.get('comparisonEndDate')?.slice(0, 10) || null,
  }
}

function cacheKey(startDate: string, endDate: string, comparison: ComparisonParams, advisor: string | null, dealerCode: DealerFilter) {
  return `kia:business-excellence:workshop-performance:${KIA_BUSINESS_EXCELLENCE_CACHE_VERSION}:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, advisor, dealerCode }))
    .digest('hex')}`
}

function accidentAdvisorSqlList() {
  return sql.join(ACCIDENT_ADVISORS.map((advisor) => sql`${advisor.toLowerCase()}`), sql`, `)
}

function workshopCategoryExpression(columnName = 'service_advisor') {
  return sql`CASE WHEN LOWER(TRIM(COALESCE(${sql.raw(columnName)}, ''))) IN (${accidentAdvisorSqlList()}) THEN 'Accident' ELSE 'MECH' END`
}

function advisorWhereClause(advisor: string | null, columnName = 'service_advisor') {
  return advisor
    ? sql`AND COALESCE(NULLIF(TRIM(${sql.raw(columnName)}), ''), 'Unspecified') = ${advisor}`
    : sql``
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) {
    return tableExistsCache.get(tableName)!
  }

  const exists = await analyticsTableExists(tableName)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function shouldUseWorkshopJcSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  return getCachedData(
    `kia:business-excellence:workshop-summary-usable:v1:${dealerCode || 'all'}:${startDate}:${endDate}`,
    async () => {
      if (dealerCode) return false
      if (!(await tableExists('workshop_performance_jc_summary_v1'))) return false

      const result = await db.execute(sql`
        WITH summary AS (
          SELECT
            COUNT(DISTINCT jc_key)::int AS total_jc,
            COALESCE(SUM(labour_amount), 0)::numeric AS labour,
            COALESCE(SUM(part_amount), 0)::numeric AS parts
          FROM workshop_performance_jc_summary_v1
          WHERE report_date >= ${startDate}::date
            AND report_date < (${endDate}::date + INTERVAL '1 day')
        ),
        raw AS (
          SELECT
            COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
            COALESCE(labour_amt, 0)::numeric AS labour,
            COALESCE(part_amt, 0)::numeric AS parts
          FROM ro_billing_report
          WHERE bill_date >= ${startDate}::date
            AND bill_date < (${endDate}::date + INTERVAL '1 day')
            AND ${kiaActiveBillStatusSql()}
            AND ${kiaActiveServiceCategoryFilter()}
        ),
        raw_dedup AS (
          SELECT
            jc_key,
            (ARRAY_AGG(labour ORDER BY ABS(labour) DESC))[1] AS labour,
            (ARRAY_AGG(parts ORDER BY ABS(parts) DESC))[1] AS parts
          FROM raw
          GROUP BY jc_key
        ),
        raw_totals AS (
          SELECT
            COUNT(*)::int AS total_jc,
            COALESCE(SUM(labour), 0)::numeric AS labour,
            COALESCE(SUM(parts), 0)::numeric AS parts
          FROM raw_dedup
        )
        SELECT
          summary.total_jc = raw_totals.total_jc
          AND ABS(summary.labour - raw_totals.labour) < 0.01
          AND ABS(summary.parts - raw_totals.parts) < 0.01 AS usable
        FROM summary
        CROSS JOIN raw_totals
      `)

      return Boolean(resultRows(result)[0]?.usable)
    },
    CACHE_TTL_SECONDS,
  )
}

async function fetchServiceSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<ServiceAggregate[]> {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    WITH classified AS (
      SELECT
        ${workshopCategoryExpression('service_advisor')} AS workshop_category,
        jc_key,
        labour_amount,
        part_amount,
        total_amount,
        discount_amount
      FROM workshop_performance_jc_summary_v1
      WHERE report_date >= ${startDate}::date
        AND report_date < (${endDate}::date + INTERVAL '1 day')
        ${advisorWhereClause(advisor)}
    )
    SELECT
      workshop_category AS group_type,
      workshop_category AS service_type,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM classified
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  ` : sql`
    WITH base AS (
      SELECT
        ${workshopCategoryExpression('service_advisor')} AS workshop_category,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount_amount
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${kiaActiveBillStatusSql()}
        AND ${kiaActiveServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    dedup AS (
      SELECT
        workshop_category,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
        MAX(discount_amount) AS discount_amount
      FROM base
      GROUP BY workshop_category, jc_key
    )
    SELECT
      workshop_category AS group_type,
      workshop_category AS service_type,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount,
      COALESCE(SUM(total_amt), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM dedup
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  `)

  return resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    groupType: String(row.group_type || row.service_type || 'Unspecified'),
    totalJc: numberValue(row.total_jc),
    labourAmount: numberValue(row.labour_amount),
    partAmount: numberValue(row.part_amount),
    totalAmount: numberValue(row.total_amount),
    discountAmount: numberValue(row.discount_amount),
  }))
}

async function fetchCoreServiceSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<ServiceAggregate[]> {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    SELECT
      COALESCE(NULLIF(group_type, ''), 'Unspecified') AS group_type,
      COALESCE(NULLIF(group_type, ''), 'Unspecified') AS service_type,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${advisorWhereClause(advisor)}
    GROUP BY COALESCE(NULLIF(group_type, ''), 'Unspecified')
    ORDER BY group_type ASC, total_jc DESC
  ` : sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS group_type,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS service_type,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount_amount
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${kiaActiveBillStatusSql()}
        AND ${kiaActiveServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    dedup AS (
      SELECT
        group_type,
        service_type,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
        MAX(discount_amount) AS discount_amount
      FROM base
      GROUP BY group_type, service_type, jc_key
    )
    SELECT
      group_type,
      service_type,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount,
      COALESCE(SUM(total_amt), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM dedup
    GROUP BY group_type, service_type
    ORDER BY group_type ASC, total_jc DESC, service_type ASC
  `)

  return resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    groupType: String(row.group_type || row.service_type || 'Unspecified'),
    totalJc: numberValue(row.total_jc),
    labourAmount: numberValue(row.labour_amount),
    partAmount: numberValue(row.part_amount),
    totalAmount: numberValue(row.total_amount),
    discountAmount: numberValue(row.discount_amount),
  }))
}

async function fetchAddonSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<AddonAggregate[]> {
  if (!advisor) {
    const [canonical, vasPeriod] = await Promise.all([
      fetchCanonicalOperationMetrics(endDate, dealerCode),
      fetchWorkshopVasDetails(startDate, endDate, dealerCode),
    ])
    return [{
      serviceType: 'MECH',
      vasAmount: vasPeriod.amount,
      waCount: canonical.alignmentCount,
      waAmount: canonical.alignmentLabour,
      wbCount: canonical.balancingCount,
      wbAmount: canonical.balancingLabour,
    }]
  }

  if (!(await tableExists('operation_wise_analysis_advisor_report'))) {
    return []
  }

  const result = await db.execute(sql`
    WITH latest_period AS (
      SELECT
        report_period_start::date AS report_period_start,
        report_period_end::date AS report_period_end
      FROM operation_wise_analysis_advisor_report
      WHERE report_period_start = ${startDate}::date
        AND report_period_end <= ${endDate}::date
        ${operationDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY report_period_end::date DESC
      LIMIT 1
    ),
    operation_rows AS (
      SELECT DISTINCT
        COALESCE(NULLIF(source.row_hash, ''), source.id::text) AS addon_key,
        ${workshopCategoryExpression('source.service_advisor')} AS workshop_category,
        source.report_type,
        source.op_part_code,
        source.op_part_desc,
        source.service_advisor,
        source.dealer_code,
        source.dealer_name,
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        GREATEST(
          ABS(${numericText(sql.raw('source.total_count'))}),
          ABS(${numericText(sql.raw('source.sp2ib_seltos_1_5_petrol_count'))}),
          ABS(${numericText(sql.raw('source.sp2ic_seltos_1_4_petrol_count'))}),
          ABS(${numericText(sql.raw('source.sp2id_seltos_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('source.carnival_count'))}),
          ABS(${numericText(sql.raw('source.qy1ib_sonet_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('source.qy1ic_sonet_1_0_gasoline_count'))}),
          ABS(${numericText(sql.raw('source.qy1id_sonet_1_2_gasoline_count'))}),
          ABS(${numericText(sql.raw('source.ky1ia_carens_1_5_gasoline_count'))}),
          ABS(${numericText(sql.raw('source.ky1ib_carens_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('source.ky1ic_carens_1_4_gasoline_count'))})
        ) AS operation_count,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(CONCAT_WS(
          ' ',
          source.report_type,
          source.op_part_code,
          source.op_part_desc
        )) AS description,
        LOWER(COALESCE(source.op_part_desc, '')) AS vas_description
      FROM operation_wise_analysis_advisor_report source
      INNER JOIN latest_period
        ON source.report_period_start::date = latest_period.report_period_start
        AND source.report_period_end::date = latest_period.report_period_end
      WHERE 1 = 1
        ${operationDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor, 'source.service_advisor')}
    ),
    classified AS (
      SELECT
        *,
        (
          operation_code ~ '(^|[^a-z])wa([^a-z]|$)'
            OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'
        ) AS is_wa,
        (
          ${wheelBalancingLabourMatchSql()}
        ) AS is_wb,
        (
          LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
            AND (
              vas_description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
                OR vas_description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
                OR vas_description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
                OR vas_description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
            )
            AND vas_description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
        ) AS is_vas
      FROM operation_rows
    )
    SELECT
      workshop_category AS service_type,
      COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::float AS vas_amount,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::int AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amount,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::int AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS wb_amount
    FROM classified
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  `)

  const rows = resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    vasAmount: numberValue(row.vas_amount),
    waCount: numberValue(row.wa_count),
    waAmount: numberValue(row.wa_amount),
    wbCount: numberValue(row.wb_count),
    wbAmount: numberValue(row.wb_amount),
  }))

  return rows
}

async function fetchCoreAddonSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<AddonAggregate[]> {
  if (advisor) {
    const addonTotals = summarizeAddons(await fetchAddonSummary(startDate, endDate, advisor, dealerCode))

    return [{
      serviceType: 'Others',
      ...addonTotals,
    }]
  }

  const [canonical, vasPeriod] = await Promise.all([
    fetchCanonicalOperationMetrics(endDate, dealerCode),
    fetchWorkshopVasDetails(startDate, endDate, dealerCode),
  ])

  return [{
    serviceType: 'Others',
    vasAmount: vasPeriod.amount,
    waCount: canonical.alignmentCount,
    waAmount: canonical.alignmentLabour,
    wbCount: canonical.balancingCount,
    wbAmount: canonical.balancingLabour,
  }]
}

async function fetchDailyTrend(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null) {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    SELECT
      report_date AS bill_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${advisorWhereClause(advisor)}
    GROUP BY report_date
    ORDER BY report_date ASC
  ` : sql`
    WITH base AS (
      SELECT
        bill_date::date AS bill_date,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${kiaActiveBillStatusSql()}
        AND ${kiaActiveServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    dedup AS (
      SELECT
        bill_date,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      GROUP BY bill_date, jc_key
    )
    SELECT
      bill_date,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY bill_date
    ORDER BY bill_date ASC
  `)

  return resultRows(result).map((row) => ({
    date: String(row.bill_date).slice(0, 10),
    totalJc: numberValue(row.total_jc),
    labourAmount: numberValue(row.labour_amount),
    partAmount: numberValue(row.part_amount),
    totalRevenue: numberValue(row.labour_amount) + numberValue(row.part_amount),
  }))
}

async function fetchAdvisorSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    SELECT
      service_advisor AS advisor,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY service_advisor
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
  ` : sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${kiaActiveBillStatusSql()}
        AND ${kiaActiveServiceCategoryFilter()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT
        advisor,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      GROUP BY advisor, jc_key
    )
    SELECT
      advisor,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY advisor
    ORDER BY (COALESCE(SUM(labour_amt), 0) + COALESCE(SUM(part_amt), 0)) DESC
  `)

  return resultRows(result).map((row) => {
    const labourAmount = numberValue(row.labour_amount)
    const partAmount = numberValue(row.part_amount)
    const totalJc = numberValue(row.total_jc)
    return {
      advisor: String(row.advisor || 'Unspecified'),
      totalJc,
      labourAmount,
      partAmount,
      totalRevenue: labourAmount + partAmount,
      avgBilling: perRo(labourAmount + partAmount, totalJc),
    }
  })
}

async function fetchAuxiliaryKpis(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  return fetchEwRsaMcpCounts(startDate, endDate, dealerCode)
}

function normalizedServiceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function buildRows(serviceRows: ServiceAggregate[], addonRows: AddonAggregate[] = []) {
  const combinedServiceRows = serviceRows
  const totalJc = combinedServiceRows.reduce((total, row) => total + row.totalJc, 0)
  const totalLabour = combinedServiceRows.reduce((total, row) => total + row.labourAmount, 0)
  const addonByService = new Map(addonRows.map((row) => [normalizedServiceKey(row.serviceType), row]))
  const assignedAddonKeys = new Set<string>()

  const rows = combinedServiceRows.map((row) => {
    const addonKey = normalizedServiceKey(row.serviceType)
    const addon = addonByService.get(addonKey)
    if (addon) assignedAddonKeys.add(addonKey)

    const vasAmount = addon?.vasAmount || 0
    const waCount = addon?.waCount || 0
    const waAmount = addon?.waAmount || 0
    const wbCount = addon?.wbCount || 0
    const wbAmount = addon?.wbAmount || 0
    const labMinusVas = Math.max(row.labourAmount - vasAmount, 0)

    return {
      serviceType: row.serviceType,
      groupType: row.groupType,
      totalJc: row.totalJc,
      totalJcPercent: percent(row.totalJc, totalJc),
      labourAmount: row.labourAmount,
      labourPercent: percent(row.labourAmount, totalLabour),
      labourPerRo: perRo(row.labourAmount, row.totalJc),
      lessVas: vasAmount,
      vasPercent: percent(vasAmount, row.labourAmount),
      labPerRoMinusVas: perRo(labMinusVas, row.totalJc),
      labMinusVas,
      spareSale: row.partAmount,
      sparePerRo: perRo(row.partAmount, row.totalJc),
      discount: row.discountAmount,
      waCount,
      waAmount,
      waPerRoPercent: percent(waCount, row.totalJc),
      wbCount,
      wbAmount,
      wbPerRoPercent: percent(wbCount, row.totalJc),
      ewCount: 0,
      rsaCount: 0,
      mcpCount: 0,
    }
  })

  addonRows.forEach((addon) => {
    const addonKey = normalizedServiceKey(addon.serviceType)
    if (assignedAddonKeys.has(addonKey)) return

    rows.push({
      serviceType: addon.serviceType || 'Others',
      groupType: addon.serviceType || 'Others',
      totalJc: 0,
      totalJcPercent: 0,
      labourAmount: 0,
      labourPercent: 0,
      labourPerRo: 0,
      lessVas: addon.vasAmount,
      vasPercent: 0,
      labPerRoMinusVas: 0,
      labMinusVas: 0,
      spareSale: 0,
      sparePerRo: 0,
      discount: 0,
      waCount: addon.waCount,
      waAmount: addon.waAmount,
      waPerRoPercent: 0,
      wbCount: addon.wbCount,
      wbAmount: addon.wbAmount,
      wbPerRoPercent: 0,
      ewCount: 0,
      rsaCount: 0,
      mcpCount: 0,
    })
  })

  return rows
}

function buildManagementRows(serviceRows: ServiceAggregate[], addonRows: AddonAggregate[] = []) {
  const categoryRows = ['MECH', 'Accident'].map((category) => {
    const existing = serviceRows.find((row) => row.serviceType === category)
    return existing || {
      serviceType: category,
      groupType: category,
      totalJc: 0,
      labourAmount: 0,
      partAmount: 0,
      totalAmount: 0,
      discountAmount: 0,
    }
  })

  return buildRows(categoryRows, addonRows)
    .filter((row) => row.serviceType === 'MECH' || row.serviceType === 'Accident')
    .sort((a, b) => (a.serviceType === 'MECH' ? 0 : 1) - (b.serviceType === 'MECH' ? 0 : 1))
}

function summarizeAddons(addonRows: AddonAggregate[]) {
  return addonRows.reduce((total, row) => ({
    vasAmount: total.vasAmount + row.vasAmount,
    waCount: total.waCount + row.waCount,
    waAmount: total.waAmount + row.waAmount,
    wbCount: total.wbCount + row.wbCount,
    wbAmount: total.wbAmount + row.wbAmount,
  }), {
    vasAmount: 0,
    waCount: 0,
    waAmount: 0,
    wbCount: 0,
    wbAmount: 0,
  })
}

function buildTotalRow(rows: ReturnType<typeof buildRows>, addonTotals = summarizeAddons([]), auxiliaryCounts = { ewCount: 0, rsaCount: 0, mcpCount: 0 }) {
  const totalJc = rows.reduce((total, row) => total + row.totalJc, 0)
  const labourAmount = rows.reduce((total, row) => total + row.labourAmount, 0)
  const lessVas = addonTotals.vasAmount
  const labMinusVas = rows.reduce((total, row) => total + row.labMinusVas, 0)
  const spareSale = rows.reduce((total, row) => total + row.spareSale, 0)
  const discount = rows.reduce((total, row) => total + row.discount, 0)
  const waCount = addonTotals.waCount
  const waAmount = addonTotals.waAmount
  const wbCount = addonTotals.wbCount
  const wbAmount = addonTotals.wbAmount

  return {
    serviceType: 'Grand Total',
    totalJc,
    totalJcPercent: 100,
    labourAmount,
    labourPercent: 100,
    labourPerRo: perRo(labourAmount, totalJc),
    lessVas,
    vasPercent: percent(lessVas, labourAmount),
    labPerRoMinusVas: perRo(labMinusVas, totalJc),
    labMinusVas,
    spareSale,
    sparePerRo: perRo(spareSale, totalJc),
    discount,
    waCount,
    waAmount,
    waPerRoPercent: percent(waCount, totalJc),
    wbCount,
    wbAmount,
    wbPerRoPercent: percent(wbCount, totalJc),
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
    mcpCount: auxiliaryCounts.mcpCount,
  }
}

async function buildWorkshopPayload(
  startDate: string,
  endDate: string,
  comparison: ComparisonParams = {
    preset: null,
    comparisonMode: 'none',
    comparisonStartDate: null,
    comparisonEndDate: null,
  },
  advisor: string | null = null,
  dealerCode: DealerFilter = null
) {
  const parsedStart = parseDateInput(startDate)
  const parsedEnd = parseDateInput(endDate)
  const lyStart = comparison.comparisonStartDate || (parsedStart ? toDateInputValue(sameDateLastYear(parsedStart)) : startDate)
  const lyEnd = comparison.comparisonEndDate || (parsedEnd ? toDateInputValue(sameDateLastYear(parsedEnd)) : endDate)
  const sourceMetadata = await fetchKiaBillingSourceMetadata(startDate, endDate, dealerCode)

  const [
    serviceRows,
    addonRows,
    dailyTrend,
    advisors,
    auxiliary,
    lyAuxiliary,
    lyServiceRows,
    lyAddonRows,
    coreServiceRows,
  ] = await Promise.all([
    fetchServiceSummary(startDate, endDate, advisor, dealerCode),
    fetchAddonSummary(startDate, endDate, advisor, dealerCode),
    fetchDailyTrend(startDate, endDate, advisor, dealerCode),
    fetchAdvisorSummary(startDate, endDate, dealerCode),
    fetchAuxiliaryKpis(startDate, endDate, dealerCode),
    fetchAuxiliaryKpis(lyStart, lyEnd, dealerCode),
    fetchServiceSummary(lyStart, lyEnd, advisor, dealerCode),
    fetchAddonSummary(lyStart, lyEnd, advisor, dealerCode),
    fetchCoreServiceSummary(startDate, endDate, advisor, dealerCode),
  ])

  const addonTotals = summarizeAddons(addonRows)
  const lyAddonTotals = summarizeAddons(lyAddonRows)
  const auxiliaryCounts = advisor
    ? { ewCount: 0, rsaCount: 0, mcpCount: 0, rsaAmount: 0 }
    : auxiliary
  const lyAuxiliaryCounts = advisor
    ? { ewCount: 0, rsaCount: 0, mcpCount: 0, rsaAmount: 0 }
    : lyAuxiliary
  const rows = buildManagementRows(serviceRows, addonRows)
  const totalRow = buildTotalRow(rows, addonTotals, {
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
    mcpCount: auxiliaryCounts.mcpCount,
  })
  const lyRows = buildManagementRows(lyServiceRows, lyAddonRows)
  const lyTotal = buildTotalRow(lyRows, lyAddonTotals, {
    ewCount: lyAuxiliaryCounts.ewCount,
    rsaCount: lyAuxiliaryCounts.rsaCount,
    mcpCount: lyAuxiliaryCounts.mcpCount,
  })
  const coreAddonRows = advisor
    ? [{
        serviceType: 'Others',
        ...summarizeAddons(addonRows),
      }]
    : [{
        serviceType: 'Others',
        ...addonTotals,
      }]
  const coreAddonTotals = summarizeAddons(coreAddonRows)
  const coreRows = buildRows(coreServiceRows, coreAddonRows)
  const coreTotalRow = buildTotalRow(coreRows, coreAddonTotals, {
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
    mcpCount: auxiliaryCounts.mcpCount,
  })

  const totalRevenue = totalRow.labourAmount + totalRow.spareSale
  const lyRevenue = lyTotal.labourAmount + lyTotal.spareSale

  return {
    dateRange: { startDate, endDate, lyStartDate: lyStart, lyEndDate: lyEnd },
    kpis: {
      totalJc: { value: totalRow.totalJc, ly: lyTotal.totalJc, growth: growth(totalRow.totalJc, lyTotal.totalJc) },
      labourAmount: { value: totalRow.labourAmount, ly: lyTotal.labourAmount, growth: growth(totalRow.labourAmount, lyTotal.labourAmount) },
      spareSale: { value: totalRow.spareSale, ly: lyTotal.spareSale, growth: growth(totalRow.spareSale, lyTotal.spareSale) },
      totalRevenue: { value: totalRevenue, ly: lyRevenue, growth: growth(totalRevenue, lyRevenue) },
      vasAmount: { value: totalRow.lessVas, ly: lyTotal.lessVas, growth: growth(totalRow.lessVas, lyTotal.lessVas) },
      labourPerRo: { value: totalRow.labourPerRo, ly: lyTotal.labourPerRo, growth: growth(totalRow.labourPerRo, lyTotal.labourPerRo) },
      sparePerRo: { value: totalRow.sparePerRo, ly: lyTotal.sparePerRo, growth: growth(totalRow.sparePerRo, lyTotal.sparePerRo) },
      ewCount: { value: auxiliaryCounts.ewCount, growth: null },
      mcpCount: { value: auxiliaryCounts.mcpCount, growth: null },
      rsaCount: { value: auxiliaryCounts.rsaCount, ly: lyAuxiliaryCounts.rsaCount, growth: growth(auxiliaryCounts.rsaCount, lyAuxiliaryCounts.rsaCount), amount: auxiliaryCounts.rsaAmount },
    },
    rows: [...rows, totalRow],
    coreRows: [...coreRows, coreTotalRow],
    dailyTrend,
    advisors,
    meta: {
      rowCount: rows.length,
      jcDefinition: 'COUNT(DISTINCT COALESCE(bill_no, ro_no, id))',
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      advisor,
      dealerCode,
      comparison,
      source: buildKiaSourceMetadata({
        ...sourceMetadata,
        deduplicationMode: 'canonical active billed job card; materialized view only when count and amount parity succeeds',
      }),
      unsupportedComparisonSources: {
        ew_report: 'EW has only May 2026 data.',
        mcp_report: 'MCP is close to one year but not enough for full LY comparisons yet.',
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('workshop-performance')
  const authResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
  if (authResponse) return authResponse

  const { searchParams } = new URL(request.url)
  const defaults = defaultRange()
  const startDate = parseDateInput(searchParams.get('startDate'))
    ? searchParams.get('startDate')!.slice(0, 10)
    : defaults.startDate
  const endDate = parseDateInput(searchParams.get('endDate'))
    ? searchParams.get('endDate')!.slice(0, 10)
    : defaults.endDate
  const skipCache = searchParams.get('skipCache') === 'true'
  const comparison = getComparisonParams(searchParams)
  const advisorParam = searchParams.get('advisor')
  const advisor = advisorParam && advisorParam !== 'all' ? advisorParam.trim() || null : null
  const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code')) || null

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildWorkshopPayload(startDate, endDate, comparison, advisor, dealerCode)
      : getCachedData(
        cacheKey(startDate, endDate, comparison, advisor, dealerCode),
        () => buildWorkshopPayload(startDate, endDate, comparison, advisor, dealerCode),
        CACHE_TTL_SECONDS
      )
    )

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data, {
      headers: { 'Cache-Control': RESPONSE_CACHE_CONTROL },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Workshop Performance:', error)
    return NextResponse.json({ error: 'Failed to build Workshop Performance' }, { status: 500 })
  }
}
