import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getHyundaiDealerCodes, normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import { fetchHyundaiMonthlyOperationMetrics } from '@/lib/hyundai/business-excellence-operations'
import {
  HYUNDAI_BE_CALCULATION_META,
  hyundaiActiveBillSql,
  hyundaiRoBillingDealerFilter,
  hyundaiRoBillingInvoiceKeySql,
  hyundaiRoBillingRoKeySql,
} from '@/lib/hyundai/business-excellence-calculations'

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

type DealerFilter = string | null

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
  /**
   * True when the figures are workshop-level and carry no service-type attribution.
   * The Operation Wise report is keyed by op code x model only — it has no service-type
   * or advisor dimension — so VAS/WA/WB cannot be split across PAID SERVICE, RUNNING
   * REPAIR, etc. Such rows belong on the Grand Total only and must never be appended
   * to the per-service-type table as a standalone row.
   */
  workshopLevel?: boolean
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

function endOfMonth(value: string) {
  const [year, month] = value.split('-').map(Number)
  return toDateInputValue(new Date(year, month, 0))
}

function isMonthAnchoredRange(startDate: string, endDate: string) {
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth] = endDate.split('-').map(Number)
  return startDay === 1 && startYear === endYear && startMonth === endMonth
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
  return `hyundai:business-excellence:workshop-performance:v36:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, advisor, dealerCode }))
    .digest('hex')}`
}

function dealerCodeListSql(dealerCode: DealerFilter) {
  const dealerCodes = getHyundaiDealerCodes(dealerCode)
  return dealerCodes.length > 0 ? sql.join(dealerCodes.map((code) => sql`${code}`), sql`, `) : null
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return hyundaiRoBillingDealerFilter(dealerCode)
}

function workshopManagementCategoryExpression(primaryColumnName: string, secondaryColumnName?: string) {
  const primary = sql.raw(primaryColumnName)
  const secondary = secondaryColumnName ? sql.raw(secondaryColumnName) : sql.raw(primaryColumnName)
  return sql`
    CASE
      WHEN LOWER(CONCAT_WS(' ', COALESCE(${primary}::text, ''), COALESCE(${secondary}::text, ''))) ~ '(accident|accidental|bodyshop|body shop|insurance|crash|body repair|paint)'
        THEN 'Accident'
      ELSE 'MECH'
    END
  `
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
    `hyundai:business-excellence:workshop-summary-usable:v1:${dealerCode || 'all'}:${startDate}:${endDate}`,
    async () => {
      if (dealerCode) return false
      if (!(await tableExists('am_hyundai_workshop_performance_jc_summary_v1'))) return false

      const result = await db.execute(sql`
        SELECT
          MIN(report_date)::date <= ${startDate}::date
          AND MAX(report_date)::date >= ${endDate}::date AS usable
        FROM am_hyundai_workshop_performance_jc_summary_v1
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
        ${workshopManagementCategoryExpression('group_type', 'service_type')} AS workshop_category,
        jc_key,
        labour_amount,
        part_amount,
        total_amount,
        discount_amount
      FROM am_hyundai_workshop_performance_jc_summary_v1
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
        id,
        ${workshopManagementCategoryExpression('work_type', 'work_type')} AS workshop_category,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount_amount,
        work_type,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY invoice_key
          ORDER BY
            ABS(labour_amt + part_amt) DESC,
            uploaded_at DESC NULLS LAST,
            id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT workshop_category, invoice_key, ro_key, labour_amt, part_amt, total_amt, discount_amount
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      workshop_category AS group_type,
      workshop_category AS service_type,
      COUNT(DISTINCT ro_key)::int AS total_jc,
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
      group_type,
      service_type,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM am_hyundai_workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${advisorWhereClause(advisor)}
    GROUP BY group_type, service_type
    ORDER BY group_type ASC, total_jc DESC, service_type ASC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS group_type,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS service_type,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount_amount,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY invoice_key
          ORDER BY
            ABS(labour_amt + part_amt) DESC,
            uploaded_at DESC NULLS LAST,
            id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT group_type, service_type, invoice_key, ro_key, labour_amt, part_amt, total_amt, discount_amount
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      group_type,
      service_type,
      COUNT(DISTINCT ro_key)::int AS total_jc,
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
  // The Operation Wise report is published as cumulative month-to-date snapshots, so the
  // narrowest window it can answer is "1st of endDate's month .. latest snapshot". An
  // arbitrary startDate cannot be honoured from this source.
  void startDate
  if (advisor) return []
  const operation = await fetchHyundaiMonthlyOperationMetrics(endDate, dealerCode)
  if (!operation.available) return []
  return [{
    // 'MECH' matches the management view's MECH/Accident axis, where VAS is mechanical
    // work by definition. It intentionally matches no row in the per-service-type table;
    // workshopLevel keeps it off that table instead of appearing as a 0-JC phantom row.
    serviceType: 'MECH',
    vasAmount: operation.vasAmount,
    waCount: operation.waCount,
    waAmount: operation.waAmount,
    wbCount: operation.wbCount,
    wbAmount: operation.wbAmount,
    workshopLevel: true,
  }]
}

async function fetchCoreAddonSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<AddonAggregate[]> {
  if (advisor) return []
  return fetchAddonSummary(startDate, endDate, null, dealerCode)
}

async function fetchDailyTrend(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null) {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    SELECT
      report_date AS bill_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM am_hyundai_workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${advisorWhereClause(advisor)}
    GROUP BY report_date
    ORDER BY report_date ASC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        bill_date::date AS bill_date,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY invoice_key
          ORDER BY
            ABS(labour_amt + part_amt) DESC,
            uploaded_at DESC NULLS LAST,
            id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT bill_date, invoice_key, ro_key, labour_amt, part_amt
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      bill_date,
      COUNT(DISTINCT ro_key)::int AS total_jc,
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
    FROM am_hyundai_workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY service_advisor
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY invoice_key
          ORDER BY
            ABS(labour_amt + part_amt) DESC,
            uploaded_at DESC NULLS LAST,
            id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT advisor, invoice_key, ro_key, labour_amt, part_amt
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      advisor,
      COUNT(DISTINCT ro_key)::int AS total_jc,
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
  const dealerCodes = dealerCodeListSql(dealerCode)
  const [hasEw, hasMcp, hasRsa] = await Promise.all([
    tableExists('hyundai_ew_report'),
    tableExists('am_hyundai_mcp_report'),
    tableExists('am_hyundai_rsa_report'),
  ])

  const [ew, mcp, rsa] = await Promise.all([
    hasEw
      ? db.execute(sql`
          WITH dedup AS (
            SELECT DISTINCT ON (
              COALESCE(
                NULLIF(TRIM(certi_no), ''),
                NULLIF(CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin), ''),
                  NULLIF(TRIM(scheme_desc), ''),
                  reg_date::text,
                  COALESCE(hml_amt, 0)::text
                ), ''),
                id::text
              )
            )
              COALESCE(
                NULLIF(TRIM(certi_no), ''),
                NULLIF(CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin), ''),
                  NULLIF(TRIM(scheme_desc), ''),
                  reg_date::text,
                  COALESCE(hml_amt, 0)::text
                ), ''),
                id::text
              ) AS ew_key,
              reg_date,
              uploaded_at,
              id
            FROM hyundai_ew_report
            WHERE reg_date >= ${startDate}::date
              AND reg_date < (${endDate}::date + INTERVAL '1 day')
              AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
              ${dealerCodes ? sql`AND UPPER(TRIM(COALESCE(dlr_no, ''))) IN (${dealerCodes})` : sql``}
            ORDER BY
              COALESCE(
                NULLIF(TRIM(certi_no), ''),
                NULLIF(CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin), ''),
                  NULLIF(TRIM(scheme_desc), ''),
                  reg_date::text,
                  COALESCE(hml_amt, 0)::text
                ), ''),
                id::text
              ),
              uploaded_at DESC NULLS LAST,
              id DESC
          )
          SELECT COUNT(*)::int AS count
          FROM dedup
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasMcp
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM am_hyundai_mcp_report
          WHERE package_purchase_date >= ${startDate}::date
            AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
            AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasRsa
      ? db.execute(sql`
          WITH dedup AS (
            SELECT DISTINCT ON (
              COALESCE(
                NULLIF(TRIM(invoice_no), ''),
                CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin_chasis_no), ''),
                  NULLIF(TRIM(policy_name), ''),
                  invoice_date::text,
                  COALESCE(total_amount, 0)::text
                ),
                id::text
              )
            )
              COALESCE(
                NULLIF(TRIM(invoice_no), ''),
                CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin_chasis_no), ''),
                  NULLIF(TRIM(policy_name), ''),
                  invoice_date::text,
                  COALESCE(total_amount, 0)::text
                ),
                id::text
              ) AS rsa_key,
              invoice_date,
              COALESCE(total_amount, 0)::numeric AS total_amount,
              uploaded_at,
              id
            FROM am_hyundai_rsa_report
            WHERE invoice_date >= ${startDate}::date
              AND invoice_date < (${endDate}::date + INTERVAL '1 day')
            ORDER BY
              COALESCE(
                NULLIF(TRIM(invoice_no), ''),
                CONCAT_WS(
                  '|',
                  NULLIF(TRIM(vin_chasis_no), ''),
                  NULLIF(TRIM(policy_name), ''),
                  invoice_date::text,
                  COALESCE(total_amount, 0)::text
                ),
                id::text
              ),
              uploaded_at DESC NULLS LAST,
              id DESC
          )
          SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(total_amount), 0)::float AS amount
          FROM dedup
        `)
      : Promise.resolve([{ count: 0, amount: 0 }] as NumericRow[]),
  ])

  return {
    ewCount: numberValue(resultRows(ew)[0]?.count),
    mcpCount: numberValue(resultRows(mcp)[0]?.count),
    rsaCount: numberValue(resultRows(rsa)[0]?.count),
    rsaAmount: numberValue(resultRows(rsa)[0]?.amount),
  }
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
    // Workshop-level VAS/WA/WB has no service-type attribution. Appending it here produced a
    // phantom row (0 JC, zero labour, the entire VAS amount) in the per-service-type table,
    // because no real service type — PAID SERVICE, RUNNING REPAIR, FREE SERVICE … — ever
    // matches the 'MECH' key. The figures still reach the user via the Grand Total row.
    if (addon.workshopLevel) return

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
  // Derived from the totals, not summed from rows: VAS is workshop-level and is not
  // attributed to any individual service type, so the per-row labMinusVas values have
  // nothing subtracted and would total to plain labour.
  const labMinusVas = Math.max(labourAmount - lessVas, 0)
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
  const lyOperationEnd = comparison.preset === 'mtd'
    || comparison.preset === 'current_month'
    || isMonthAnchoredRange(startDate, endDate)
    ? endOfMonth(lyEnd)
    : lyEnd

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
    operationCoverage,
    lyOperationCoverage,
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
    fetchHyundaiMonthlyOperationMetrics(endDate, dealerCode),
    fetchHyundaiMonthlyOperationMetrics(lyOperationEnd, dealerCode),
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
  const coreAddonRows = advisor ? [] : addonRows
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
      ...HYUNDAI_BE_CALCULATION_META,
      rowCount: rows.length,
      jcDefinition: HYUNDAI_BE_CALCULATION_META.loadDefinition,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      advisor,
      dealerCode,
      comparison,
      operationCoverage: {
        current: {
          available: operationCoverage.available,
          periodStart: operationCoverage.periodStart,
          periodEnd: operationCoverage.periodEnd,
          identifierVersion: operationCoverage.identifierVersion,
          sourceRows: operationCoverage.sourceRows,
          classifiedRows: operationCoverage.classifiedRows,
          unknownCodeRows: operationCoverage.unknownCodeRows,
        },
        previous: {
          available: lyOperationCoverage.available,
          periodStart: lyOperationCoverage.periodStart,
          periodEnd: lyOperationCoverage.periodEnd,
          identifierVersion: lyOperationCoverage.identifierVersion,
          sourceRows: lyOperationCoverage.sourceRows,
          classifiedRows: lyOperationCoverage.classifiedRows,
          unknownCodeRows: lyOperationCoverage.unknownCodeRows,
        },
      },
      sourceWarnings: [
        ...(!operationCoverage.available ? ['No contained Hyundai Operation Wise snapshot exists for the selected period.'] : []),
        // Jammu is no longer excluded here. The exclusion existed because Jammu's figures come
        // from the consolidated N5216 file, which made the old row counts read as zero; the
        // reader now carries that file's diagnostics through, so the check is meaningful again
        // -- and Jammu, being a derived residual, is the selection that most needs the caveat.
        ...(operationCoverage.available && operationCoverage.classifiedRows === 0
          ? ['Hyundai Operation Wise snapshot exists but contains no classified VAS/WA/WB rows. Reload the complete report before treating zero values as business performance.']
          : []),
        ...(operationCoverage.coverageWarning ? [operationCoverage.coverageWarning] : []),
        ...(dealerCode && auxiliaryCounts.rsaCount > 0 ? ['RSA source is not dealer-scoped unless a verified dealer column is present.'] : []),
      ],
      unsupportedComparisonSources: {
        hyundai_ew_report: 'EW has only May 2026 data.',
        am_hyundai_mcp_report: 'MCP is close to one year but not enough for full LY comparisons yet.',
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('workshop-performance')
  const authResponse = await timer.time('auth', () => requireBrandSectionApiAccess('hyundai', 'hyundai.business_excellence.view', request))
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
  const dealerCode = normalizeHyundaiDealerCode(searchParams.get('dealer_code')) || null

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
