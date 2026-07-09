import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableColumnSet, analyticsTableHasColumn } from '@/lib/analytics/table-columns'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { ACCIDENT_ADVISORS } from '@/lib/business-excellence/workshop-classification'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'
import { fetchPlatinumWorkshopVasAmount, fetchPlatinumWorkshopVasAmounts } from '@/lib/platinum/business-excellence-vas'
import {
  PLATINUM_VAS_IDENTIFIER_VERSION,
  platinumAdvisorDepartmentSql,
  platinumVasCodeSql,
  platinumWheelAlignmentCodeSql,
  platinumWheelBalancingCodeSql,
} from '@/lib/platinum/vas-identifiers'
import { platinumSourceDealerFilter } from '@/lib/platinum/dealer-filter'
import { fetchPlatinumRoBillingCoverage } from '@/lib/platinum/business-excellence-coverage'
import {
  emptyPlatinumRoBillingAudit,
  fetchPlatinumRoBillingAudit,
} from '@/lib/platinum/ro-billing-audit'
import {
  resolvePlatinumComparisonRange,
  type PlatinumComparisonParams,
} from '@/lib/platinum/business-excellence-metrics'
import {
  PLATINUM_BE_CALCULATION_META,
  platinumActiveBillSql,
  platinumRoBillingDealerFilter,
  platinumRoBillingDealerSql,
  platinumRoBillingInvoiceKeySql,
  platinumRoBillingRoKeySql,
  platinumVasPeriodsAlign,
} from '@/lib/platinum/business-excellence-calculations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const RESPONSE_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300'

const CACHE_TTL_SECONDS = CACHE_TTL.PLATINUM
const tableExistsCache = new Map<string, boolean>()
const tableColumnsCache = new Map<string, Set<string>>()

type NumericRow = Record<string, unknown>
type ComparisonParams = PlatinumComparisonParams

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
}

type SourceWarning = {
  source: string
  message: string
}

type PlatinumWorkshopVasMeta = Awaited<ReturnType<typeof fetchPlatinumWorkshopVasAmount>>

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

async function optionalSource<T>(
  source: string,
  promise: Promise<T>,
  fallback: T,
  warnings: SourceWarning[]
) {
  try {
    return await promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push({ source, message })
    console.warn(`Platinum workshop optional source failed: ${source}`, error)
    return fallback
  }
}

function emptyAuxiliaryKpis() {
  return { ewCount: 0, rsaCount: 0, rsaAmount: 0 }
}

function emptyVasMeta(reason: string): PlatinumWorkshopVasMeta {
  return {
    amount: 0,
    available: false,
    unavailableReason: reason,
    source: null,
    sourceTable: null,
    periodStart: null,
    periodEnd: null,
    sourceRows: 0,
    matchedRows: 0,
    unknownCodeRows: 0,
    identifierVersion: PLATINUM_VAS_IDENTIFIER_VERSION,
    dedupeMode: null,
    latestSnapshotUploadedAt: null,
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 3) {
  const results = new Array<T>(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await tasks[index]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

function emptyDealerCoverage(startDate: string, endDate: string, dealerCode: DealerFilter) {
  return {
    dealerCode: dealerCode || 'all',
    isAllLocations: !dealerCode,
    hasDataInRange: false,
    rowCountInRange: 0,
    earliestAvailableDate: null,
    latestAvailableDate: null,
    dateBasis: 'bill_date',
    sourceLabel: 'RO Billing',
    emptyReason: `RO Billing coverage could not be checked for ${startDate} to ${endDate}.`,
    comparisonStatus: 'source_missing' as const,
    unmappedRowCount: 0,
    lastUpdatedAt: null,
  }
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
  return `platinum:business-excellence:workshop-performance:v47:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, advisor, dealerCode }))
    .digest('hex')}`
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return platinumRoBillingDealerFilter(dealerCode)
}

function roBillingDealerKeySql() {
  return sql`COALESCE(${platinumRoBillingDealerSql()}, 'UNMAPPED')`
}

function activeBillStatusSql() {
  return platinumActiveBillSql()
}

function operationDealerFilter(dealerCode: DealerFilter) {
  return platinumSourceDealerFilter(dealerCode)
}

function accidentAdvisorSqlList() {
  return sql.join(ACCIDENT_ADVISORS.map((advisor) => sql`${advisor.toLowerCase()}`), sql`, `)
}

function workshopCategoryExpression(columnName = 'service_advisor') {
  const department = platinumAdvisorDepartmentSql(sql.raw(columnName))
  return sql`
    CASE
      WHEN ${department} = 'B/S'
        OR LOWER(TRIM(COALESCE(${sql.raw(columnName)}, ''))) IN (${accidentAdvisorSqlList()})
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

async function tableColumns(tableName: string) {
  if (tableColumnsCache.has(tableName)) return tableColumnsCache.get(tableName)!
  const columns = await analyticsTableColumnSet(tableName)
  tableColumnsCache.set(tableName, columns)
  return columns
}

function hasColumns(columns: Set<string>, required: string[]) {
  return required.every((column) => columns.has(column))
}

function operationCountExpression(columns: Set<string>) {
  const countColumns = [
    'total_count',
    'santro_count',
    'getz_count',
    'accent_count',
    'elantra_count',
    'nf_sonata_count',
    'e_f_sonata_count',
    'tucsan_count',
    'terracan_count',
    'i10_count',
    'i20_count',
    'verna_count',
    'new_santro_count',
    'next_gen_verna_count',
    'venue_count',
    'grand_i10_nios_count',
    'new_creta_count',
    'new_i20_count',
    'elite_i20_count',
    'xcent_count',
    'other_count',
  ].filter((column) => columns.has(column))

  if (!countColumns.length) return sql`0`
  return sql`GREATEST(${sql.join(countColumns.map((column) => sql`ABS(${numericText(sql.raw(column))})`), sql`, `)})`
}

async function shouldUseWorkshopJcSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  return getCachedData(
    `platinum:business-excellence:workshop-summary-usable:v1:${dealerCode || 'all'}:${startDate}:${endDate}`,
    async () => {
      if (!(await tableExists('am_platinum_workshop_performance_jc_summary_v2'))) return false
      if (!(await analyticsTableHasColumn('am_platinum_workshop_performance_jc_summary_v2', 'ro_key'))) return false

      const result = await db.execute(sql`
        SELECT
          (
            SELECT MIN(report_date)::date <= ${startDate}::date
              AND MAX(report_date)::date >= ${endDate}::date
            FROM am_platinum_workshop_performance_jc_summary_v2
            WHERE 1 = 1
              ${workshopSummaryDealerWhere(dealerCode)}
          ) AS usable
      `)

      return Boolean(resultRows(result)[0]?.usable)
    },
    CACHE_TTL_SECONDS,
  )
}

function workshopSummaryDealerWhere(dealerCode: DealerFilter) {
  return dealerCode ? sql`AND dealer_code = ${dealerCode}` : sql``
}

async function fetchServiceSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<ServiceAggregate[]> {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    WITH classified AS (
      SELECT
        ${workshopCategoryExpression('service_advisor')} AS workshop_category,
        ro_key,
        labour_amount,
        part_amount,
        total_amount,
        discount_amount
      FROM am_platinum_workshop_performance_jc_summary_v2
      WHERE report_date >= ${startDate}::date
        AND report_date < (${endDate}::date + INTERVAL '1 day')
        ${workshopSummaryDealerWhere(dealerCode)}
        ${advisorWhereClause(advisor)}
    )
    SELECT
      workshop_category AS group_type,
      workshop_category AS service_type,
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(labour_amount + part_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM classified
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  ` : sql`
    WITH base AS (
      SELECT
        id,
        ${roBillingDealerKeySql()} AS dealer_key,
        ${workshopCategoryExpression('service_advisor')} AS workshop_category,
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        bill_date::date AS bill_date,
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
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        dealer_key,
        workshop_category,
        invoice_key,
        ro_key,
        labour_amt,
        part_amt,
        total_amt,
        discount_amount,
        ROW_NUMBER() OVER (
          PARTITION BY dealer_key, invoice_key
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT workshop_category, dealer_key, invoice_key, ro_key, labour_amt, part_amt, total_amt, discount_amount
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      workshop_category AS group_type,
      workshop_category AS service_type,
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount,
      COALESCE(SUM(labour_amt + part_amt), 0)::float AS total_amount,
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
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(labour_amount + part_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM am_platinum_workshop_performance_jc_summary_v2
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${workshopSummaryDealerWhere(dealerCode)}
      ${advisorWhereClause(advisor)}
    GROUP BY group_type, service_type
    ORDER BY group_type ASC, total_jc DESC, service_type ASC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        ${roBillingDealerKeySql()} AS dealer_key,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS group_type,
        COALESCE(NULLIF(work_type, ''), 'Unspecified') AS service_type,
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        bill_date::date AS bill_date,
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
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        dealer_key,
        group_type,
        service_type,
        invoice_key,
        ro_key,
        labour_amt,
        part_amt,
        total_amt,
        discount_amount,
        ROW_NUMBER() OVER (
          PARTITION BY dealer_key, invoice_key
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT group_type, service_type, dealer_key, invoice_key, ro_key, labour_amt, part_amt, total_amt, discount_amount
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      group_type,
      service_type,
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount,
      COALESCE(SUM(labour_amt + part_amt), 0)::float AS total_amount,
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

function addonRows(result: unknown): AddonAggregate[] {
  return resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    vasAmount: numberValue(row.vas_amount),
    waCount: numberValue(row.wa_count),
    waAmount: numberValue(row.wa_amount),
    wbCount: numberValue(row.wb_count),
    wbAmount: numberValue(row.wb_amount),
  }))
}

async function fetchAdvisorAddonSummary(
  startDate: string,
  endDate: string,
  advisor: string | null,
  dealerCode: DealerFilter,
  columns: Set<string>
): Promise<AddonAggregate[]> {
  const operationCountSql = operationCountExpression(columns)
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
        ${workshopCategoryExpression('service_advisor')} AS workshop_category,
        report_type,
        op_part_code,
        ${numericText(sql.raw('total_amt'))} AS amount,
        ${operationCountSql} AS operation_count
      FROM am_platinum_operation_wise_analysis_advisor_report
      WHERE report_month >= date_trunc('month', ${startDate}::date)::date
        AND report_month <= date_trunc('month', ${endDate}::date)::date
        ${operationDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
      ORDER BY
        COALESCE(NULLIF(row_hash, ''), id::text),
        uploaded_at DESC NULLS LAST,
        id DESC
    ),
    classified AS (
      SELECT
        *,
        ${platinumWheelAlignmentCodeSql(sql.raw('op_part_code'))} AS is_wa,
        ${platinumWheelBalancingCodeSql(sql.raw('op_part_code'))} AS is_wb,
        (
          LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
          AND ${platinumVasCodeSql(sql.raw('op_part_code'))}
        ) AS is_vas
      FROM operation_rows
    )
    SELECT
      workshop_category AS service_type,
      COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::float AS vas_amount,
      COUNT(*) FILTER (WHERE is_wa)::int AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amount,
      COUNT(*) FILTER (WHERE is_wb)::int AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS wb_amount
    FROM classified
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  `)

  return addonRows(result)
}

async function fetchOperationAddonSummary(
  startDate: string,
  endDate: string,
  advisor: string | null,
  dealerCode: DealerFilter
): Promise<AddonAggregate[]> {
  const table = 'am_platinum_operation_wise_analysis_report'
  if (!(await tableExists(table))) return []

  const columns = await tableColumns(table)
  if (!hasColumns(columns, [
    'report_period_start',
    'report_period_end',
    'report_type',
    'op_part_code',
    'total_amt',
    'source_dealer_code',
  ])) {
    return []
  }

  const hasAdvisor = columns.has('service_advisor')
  if (advisor && !hasAdvisor) return []

  const operationCountSql = operationCountExpression(columns)
  const categorySql = hasAdvisor
    ? workshopCategoryExpression('source.service_advisor')
    : sql`'MECH'`
  const selectedAdvisorSql = hasAdvisor
    ? advisorWhereClause(advisor, 'source.service_advisor')
    : sql``

  const result = await db.execute(sql`
    WITH candidate_period AS (
      SELECT
        report_period_start::date AS period_start,
        report_period_end::date AS period_end
      FROM am_platinum_operation_wise_analysis_report
      WHERE date_trunc('month', report_period_start)::date = date_trunc('month', ${endDate}::date)::date
        ${operationDealerFilter(dealerCode)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY
        report_period_end::date DESC,
        report_period_start::date DESC
      LIMIT 1
    ),
    operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        COALESCE(NULLIF(source.row_hash, ''), source.id::text) AS addon_key,
        ${categorySql} AS workshop_category,
        source.report_type,
        source.op_part_code,
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        ${operationCountSql} AS operation_count
      FROM am_platinum_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      WHERE 1 = 1
        ${platinumSourceDealerFilter(dealerCode, sql.raw('source.source_dealer_code'))}
        ${selectedAdvisorSql}
      ORDER BY
        COALESCE(NULLIF(source.row_hash, ''), source.id::text),
        source.uploaded_at DESC NULLS LAST,
        source.id DESC
    ),
    classified AS (
      SELECT
        *,
        ${platinumWheelAlignmentCodeSql(sql.raw('op_part_code'))} AS is_wa,
        ${platinumWheelBalancingCodeSql(sql.raw('op_part_code'))} AS is_wb,
        (
          LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
          AND ${platinumVasCodeSql(sql.raw('op_part_code'))}
        ) AS is_vas
      FROM operation_rows
    )
    SELECT
      workshop_category AS service_type,
      COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::float AS vas_amount,
      COUNT(*) FILTER (WHERE is_wa)::int AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amount,
      COUNT(*) FILTER (WHERE is_wb)::int AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS wb_amount
    FROM classified
    GROUP BY workshop_category
    ORDER BY CASE WHEN workshop_category = 'MECH' THEN 1 ELSE 2 END
  `)

  return addonRows(result)
}

async function fetchAddonSummary(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null): Promise<AddonAggregate[]> {
  const advisorTable = 'am_platinum_operation_wise_analysis_advisor_report'

  if (await tableExists(advisorTable)) {
    const columns = await tableColumns(advisorTable)
    if (hasColumns(columns, [
      'service_advisor',
      'report_month',
      'report_type',
      'op_part_code',
      'total_amt',
      'source_dealer_code',
    ])) {
      try {
        const rows = await fetchAdvisorAddonSummary(startDate, endDate, advisor, dealerCode, columns)
        if (rows.length > 0) return rows
      } catch (error) {
        console.warn('Platinum advisor add-on source failed; falling back to operation snapshot.', error)
      }
    }
  }

  return fetchOperationAddonSummary(startDate, endDate, advisor, dealerCode)
}

async function fetchDailyTrend(startDate: string, endDate: string, advisor: string | null = null, dealerCode: DealerFilter = null) {
  const result = await db.execute(await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode) ? sql`
    SELECT
      report_date AS bill_date,
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM am_platinum_workshop_performance_jc_summary_v2
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${workshopSummaryDealerWhere(dealerCode)}
      ${advisorWhereClause(advisor)}
    GROUP BY report_date
    ORDER BY report_date ASC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        ${roBillingDealerKeySql()} AS dealer_key,
        bill_date::date AS bill_date,
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        uploaded_at
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
        ${advisorWhereClause(advisor)}
    ),
    ranked AS (
      SELECT
        dealer_key,
        bill_date,
        invoice_key,
        ro_key,
        labour_amt,
        part_amt,
        ROW_NUMBER() OVER (
          PARTITION BY dealer_key, invoice_key
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT bill_date, dealer_key, invoice_key, ro_key, labour_amt, part_amt
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
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM am_platinum_workshop_performance_jc_summary_v2
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
      ${workshopSummaryDealerWhere(dealerCode)}
    GROUP BY service_advisor
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
  ` : sql`
    WITH base AS (
      SELECT
        id,
        ${roBillingDealerKeySql()} AS dealer_key,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        bill_date::date AS bill_date,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        uploaded_at
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT
        dealer_key,
        advisor,
        invoice_key,
        ro_key,
        labour_amt,
        part_amt,
        ROW_NUMBER() OVER (
          PARTITION BY dealer_key, invoice_key
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM base
    ),
    dedup AS (
      SELECT advisor, dealer_key, invoice_key, ro_key, labour_amt, part_amt
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
  const [hasEw, hasRsa] = await Promise.all([
    tableExists('am_platinum_ew_report'),
    tableExists('am_platinum_rsa_report'),
  ])

  const [ew, rsa] = await Promise.all([
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
            FROM am_platinum_ew_report
            WHERE reg_date >= ${startDate}::date
              AND reg_date < (${endDate}::date + INTERVAL '1 day')
              AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
              ${platinumSourceDealerFilter(dealerCode)}
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
            FROM am_platinum_rsa_report
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
    rsaCount: numberValue(resultRows(rsa)[0]?.count),
    rsaAmount: numberValue(resultRows(rsa)[0]?.amount),
  }
}

async function fetchSourceStatus(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const [hasOperation, hasAdvisorOperation, hasEw, hasRsa] = await Promise.all([
    tableExists('am_platinum_operation_wise_analysis_report'),
    tableExists('am_platinum_operation_wise_analysis_advisor_report'),
    tableExists('am_platinum_ew_report'),
    tableExists('am_platinum_rsa_report'),
  ])

  const operationColumns = hasOperation
    ? await tableColumns('am_platinum_operation_wise_analysis_report')
    : new Set<string>()
  const advisorColumns = hasAdvisorOperation
    ? await tableColumns('am_platinum_operation_wise_analysis_advisor_report')
    : new Set<string>()
  const operationUsable = hasOperation && hasColumns(operationColumns, [
    'report_period_start',
    'report_period_end',
    'report_type',
    'op_part_code',
    'total_amt',
    'total_count',
    'source_dealer_code',
  ])
  const advisorUsable = hasAdvisorOperation && hasColumns(advisorColumns, [
    'service_advisor',
    'report_month',
    'report_type',
    'op_part_code',
    'op_part_desc',
    'total_amt',
    'source_dealer_code',
  ])
  const operationCoverage = operationUsable
    ? resultRows(await db.execute(sql`
        SELECT
          report_period_start::date::text AS period_start,
          report_period_end::date::text AS period_end
        FROM am_platinum_operation_wise_analysis_report
        WHERE date_trunc('month', report_period_start)::date = date_trunc('month', ${endDate}::date)::date
          ${operationDealerFilter(dealerCode)}
        GROUP BY report_period_start::date, report_period_end::date
        ORDER BY
          report_period_end::date DESC,
          report_period_start::date DESC
        LIMIT 1
      `))[0]
    : undefined

  return {
    operationAnalysis: {
      table: 'am_platinum_operation_wise_analysis_report',
      available: operationUsable,
      periodStart: operationCoverage?.period_start ? String(operationCoverage.period_start).slice(0, 10) : null,
      periodEnd: operationCoverage?.period_end ? String(operationCoverage.period_end).slice(0, 10) : null,
      coverageMode: operationCoverage
        ? (
            String(operationCoverage.period_start).slice(0, 10) === startDate
            && String(operationCoverage.period_end).slice(0, 10) === endDate
              ? 'exact'
              : 'monthly_snapshot'
          )
        : 'unavailable',
      unavailableReason: operationUsable
        ? operationCoverage
          ? null
          : `No operation snapshot exists for the month containing ${endDate}.`
        : hasOperation
          ? 'Table exists but does not expose the period, code, amount, count, and dealer fields required for VAS/WA/WB.'
          : 'Table is unavailable.',
    },
    advisorOperationAnalysis: {
      table: 'am_platinum_operation_wise_analysis_advisor_report',
      available: advisorUsable,
      unavailableReason: advisorUsable
        ? null
        : hasAdvisorOperation
          ? 'Table exists but does not expose KIA advisor/date fields required for WA/WB/VAS classification.'
          : 'Table is unavailable.',
    },
    auxiliaryAddons: {
      ewAvailable: hasEw,
      rsaAvailable: hasRsa,
    },
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

function buildTotalRow(
  rows: ReturnType<typeof buildRows>,
  addonTotals = summarizeAddons([]),
  auxiliaryCounts = { ewCount: 0, rsaCount: 0 },
  exactTotalJc?: number
) {
  const rolledUpJc = rows.reduce((total, row) => total + row.totalJc, 0)
  const totalJc = exactTotalJc === undefined ? rolledUpJc : exactTotalJc
  const labourAmount = rows.reduce((total, row) => total + row.labourAmount, 0)
  const lessVas = addonTotals.vasAmount
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
  const lyRange = resolvePlatinumComparisonRange(startDate, endDate, comparison)
  const lyStart = lyRange.startDate
  const lyEnd = lyRange.endDate
  const sourceWarnings: SourceWarning[] = []
  const emptyAuxiliary = emptyAuxiliaryKpis()

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
    sourceStatus,
    vasBatch,
    dealerCoverage,
    roBillingAudit,
  ] = await runWithConcurrency<unknown>([
    () => optionalSource('service summary', fetchServiceSummary(startDate, endDate, advisor, dealerCode), [] as ServiceAggregate[], sourceWarnings),
    () => optionalSource('add-on summary', fetchAddonSummary(startDate, endDate, advisor, dealerCode), [] as AddonAggregate[], sourceWarnings),
    () => optionalSource('daily trend', fetchDailyTrend(startDate, endDate, advisor, dealerCode), [] as Awaited<ReturnType<typeof fetchDailyTrend>>, sourceWarnings),
    () => optionalSource('advisor summary', fetchAdvisorSummary(startDate, endDate, dealerCode), [] as Awaited<ReturnType<typeof fetchAdvisorSummary>>, sourceWarnings),
    () => optionalSource('auxiliary KPIs', fetchAuxiliaryKpis(startDate, endDate, dealerCode), emptyAuxiliary, sourceWarnings),
    () => optionalSource('LY auxiliary KPIs', fetchAuxiliaryKpis(lyStart, lyEnd, dealerCode), emptyAuxiliary, sourceWarnings),
    () => optionalSource('LY service summary', fetchServiceSummary(lyStart, lyEnd, advisor, dealerCode), [] as ServiceAggregate[], sourceWarnings),
    () => optionalSource('LY add-on summary', fetchAddonSummary(lyStart, lyEnd, advisor, dealerCode), [] as AddonAggregate[], sourceWarnings),
    () => optionalSource('core service summary', fetchCoreServiceSummary(startDate, endDate, advisor, dealerCode), [] as ServiceAggregate[], sourceWarnings),
    () => optionalSource('source status', fetchSourceStatus(startDate, endDate, dealerCode), null, sourceWarnings),
    () => optionalSource(
      'workshop VAS amounts',
      fetchPlatinumWorkshopVasAmounts(startDate, endDate, lyStart, lyEnd, dealerCode),
      { cy: emptyVasMeta('Platinum VAS source could not be read.'), ly: emptyVasMeta('Platinum LY VAS source could not be read.') },
      sourceWarnings
    ),
    () => optionalSource(
      'dealer coverage',
      fetchPlatinumRoBillingCoverage(startDate, endDate, dealerCode),
      emptyDealerCoverage(startDate, endDate, dealerCode),
      sourceWarnings
    ),
    () => optionalSource(
      'RO Billing audit',
      fetchPlatinumRoBillingAudit(startDate, endDate, dealerCode, {
        lyStartDate: lyStart,
        lyEndDate: lyEnd,
      }),
      emptyPlatinumRoBillingAudit(startDate, endDate, dealerCode, false, {
        lyStartDate: lyStart,
        lyEndDate: lyEnd,
      }),
      sourceWarnings
    ),
  ], 3) as [
    ServiceAggregate[],
    AddonAggregate[],
    Awaited<ReturnType<typeof fetchDailyTrend>>,
    Awaited<ReturnType<typeof fetchAdvisorSummary>>,
    Awaited<ReturnType<typeof fetchAuxiliaryKpis>>,
    Awaited<ReturnType<typeof fetchAuxiliaryKpis>>,
    ServiceAggregate[],
    AddonAggregate[],
    ServiceAggregate[],
    Awaited<ReturnType<typeof fetchSourceStatus>>,
    Awaited<ReturnType<typeof fetchPlatinumWorkshopVasAmounts>>,
    Awaited<ReturnType<typeof fetchPlatinumRoBillingCoverage>>,
    Awaited<ReturnType<typeof fetchPlatinumRoBillingAudit>>,
  ]

  if (
    sourceStatus?.operationAnalysis.coverageMode === 'monthly_snapshot'
    && sourceStatus.operationAnalysis.periodStart
    && sourceStatus.operationAnalysis.periodEnd
  ) {
    sourceWarnings.push({
      source: 'operation add-ons',
      message: `Using the latest monthly Operation Wise snapshot for ${endDate.slice(0, 7)}.`,
    })
  }

  if (!sourceStatus?.advisorOperationAnalysis.available && sourceStatus?.operationAnalysis.available) {
    sourceWarnings.push({
      source: 'advisor add-ons',
      message: advisor
        ? 'Advisor-specific VAS/WA/WB is unavailable because the operation snapshot has no advisor attribution.'
        : 'Advisor add-on source is unavailable; VAS/WA/WB is rolled up from the operation snapshot under MECH.',
    })
  }

  const workshopVasMeta = vasBatch.cy
  const lyWorkshopVasMeta = vasBatch.ly

  const effectiveAddonRows = addonRows
  const addonTotals = summarizeAddons(effectiveAddonRows)
  if (!advisor && workshopVasMeta.available) addonTotals.vasAmount = workshopVasMeta.amount
  const lyAddonTotals = summarizeAddons(lyAddonRows)
  if (!advisor && lyWorkshopVasMeta.available) lyAddonTotals.vasAmount = lyWorkshopVasMeta.amount
  const auxiliaryCounts = advisor
    ? { ewCount: 0, rsaCount: 0, rsaAmount: 0 }
    : auxiliary
  const lyAuxiliaryCounts = advisor
    ? { ewCount: 0, rsaCount: 0, rsaAmount: 0 }
    : lyAuxiliary
  const rows = buildManagementRows(serviceRows, effectiveAddonRows)
  const totalRow = buildTotalRow(rows, addonTotals, {
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
  }, roBillingAudit.dedupedJc)
  const lyRows = buildManagementRows(lyServiceRows, lyAddonRows)
  const lyTotal = buildTotalRow(lyRows, lyAddonTotals, {
    ewCount: lyAuxiliaryCounts.ewCount,
    rsaCount: lyAuxiliaryCounts.rsaCount,
  }, roBillingAudit.ly.dedupedJc)
  const effectiveCoreAddonRows = advisor
    ? [{
        serviceType: 'Others',
        ...summarizeAddons(addonRows),
      }]
    : []
  const coreAddonTotals = summarizeAddons(effectiveCoreAddonRows)
  if (!advisor && workshopVasMeta.available) coreAddonTotals.vasAmount = workshopVasMeta.amount
  const coreRows = buildRows(coreServiceRows, effectiveCoreAddonRows)
  const coreTotalRow = buildTotalRow(coreRows, coreAddonTotals, {
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
  }, roBillingAudit.dedupedJc)

  const totalRevenue = totalRow.labourAmount + totalRow.spareSale
  const lyRevenue = lyTotal.labourAmount + lyTotal.spareSale
  const hasComparableVasLy = lyWorkshopVasMeta.available
  const vasPeriodsAlign = workshopVasMeta.available
    && hasComparableVasLy
    && platinumVasPeriodsAlign(
      workshopVasMeta.periodStart,
      workshopVasMeta.periodEnd,
      lyWorkshopVasMeta.periodStart,
      lyWorkshopVasMeta.periodEnd
    )
  const vasLy = hasComparableVasLy ? lyWorkshopVasMeta.amount : undefined
  const vasComparisonStatus = !workshopVasMeta.available
    ? 'source_missing'
    : !hasComparableVasLy
      ? 'not_comparable'
      : vasPeriodsAlign
        ? (Number(vasLy || 0) === 0 ? 'exact_zero' : 'available')
        : 'period_mismatch'
  const vasComparisonLabel = !workshopVasMeta.available
    ? 'Source missing'
    : !hasComparableVasLy
      ? 'No comparable LY period'
      : vasPeriodsAlign
        ? null
        : `LY covers ${lyWorkshopVasMeta.periodStart} to ${lyWorkshopVasMeta.periodEnd}`

  return {
    dateRange: { startDate, endDate, lyStartDate: lyStart, lyEndDate: lyEnd },
    kpis: {
      totalJc: { value: totalRow.totalJc, ly: lyTotal.totalJc, growth: growth(totalRow.totalJc, lyTotal.totalJc) },
      labourAmount: { value: totalRow.labourAmount, ly: lyTotal.labourAmount, growth: growth(totalRow.labourAmount, lyTotal.labourAmount) },
      spareSale: { value: totalRow.spareSale, ly: lyTotal.spareSale, growth: growth(totalRow.spareSale, lyTotal.spareSale) },
      totalRevenue: { value: totalRevenue, ly: lyRevenue, growth: growth(totalRevenue, lyRevenue) },
      vasAmount: {
        value: totalRow.lessVas,
        ly: vasLy,
        growth: vasLy === undefined || !vasPeriodsAlign ? null : growth(totalRow.lessVas, vasLy),
        comparisonStatus: vasComparisonStatus,
        comparisonLabel: vasComparisonLabel,
      },
      labourPerRo: { value: totalRow.labourPerRo, ly: lyTotal.labourPerRo, growth: growth(totalRow.labourPerRo, lyTotal.labourPerRo) },
      sparePerRo: { value: totalRow.sparePerRo, ly: lyTotal.sparePerRo, growth: growth(totalRow.sparePerRo, lyTotal.sparePerRo) },
      ewCount: { value: auxiliaryCounts.ewCount, growth: null },
      rsaCount: { value: auxiliaryCounts.rsaCount, ly: lyAuxiliaryCounts.rsaCount, growth: growth(auxiliaryCounts.rsaCount, lyAuxiliaryCounts.rsaCount), amount: auxiliaryCounts.rsaAmount },
    },
    rows: [...rows, totalRow],
    coreRows: [...coreRows, coreTotalRow],
    dailyTrend,
    advisors,
    meta: {
      rowCount: rows.length,
      calculation: PLATINUM_BE_CALCULATION_META,
      jcDefinition: PLATINUM_BE_CALCULATION_META.loadDefinition,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      advisor,
      dealerCode,
      dealerCoverage: {
        dealerCode: dealerCoverage.dealerCode,
        isAllLocations: dealerCoverage.isAllLocations,
        primary: dealerCoverage,
        roBilling: dealerCoverage,
      },
      comparison,
      unsupportedComparisonSources: {},
      sourceStatus: {
        ...(sourceStatus || {
          operationAnalysis: {
            table: 'am_platinum_operation_wise_analysis_report',
            available: false,
            unavailableReason: 'Source status could not be checked.',
          },
          advisorOperationAnalysis: {
            table: 'am_platinum_operation_wise_analysis_advisor_report',
            available: false,
            unavailableReason: 'Source status could not be checked.',
          },
          auxiliaryAddons: {
            ewAvailable: false,
            rsaAvailable: false,
          },
        }),
        warnings: sourceWarnings,
        roBillingAudit: {
          rawRows: roBillingAudit.rawRows,
          activeRawRows: roBillingAudit.activeRawRows,
          dedupedJc: roBillingAudit.dedupedJc,
          duplicateRowsRemoved: roBillingAudit.duplicateRowsRemoved,
          cancelledRows: roBillingAudit.cancelledRows,
          latestUploadedAt: roBillingAudit.latestUploadedAt,
        },
      },
      vas: {
        available: workshopVasMeta.available,
        unavailableReason: workshopVasMeta.unavailableReason,
        source: workshopVasMeta.source,
        sourceTable: workshopVasMeta.sourceTable,
        periodStart: workshopVasMeta.periodStart,
        periodEnd: workshopVasMeta.periodEnd,
        sourceRows: workshopVasMeta.sourceRows,
        matchedRows: workshopVasMeta.matchedRows,
        unknownCodeRows: workshopVasMeta.unknownCodeRows,
        identifierVersion: workshopVasMeta.identifierVersion,
        dedupeMode: workshopVasMeta.dedupeMode,
        latestSnapshotUploadedAt: workshopVasMeta.latestSnapshotUploadedAt,
        lyAvailable: hasComparableVasLy,
        comparisonStatus: vasComparisonStatus,
        comparisonLabel: vasComparisonLabel,
        lyUnavailableReason: hasComparableVasLy ? null : lyWorkshopVasMeta.unavailableReason,
        lySource: lyWorkshopVasMeta.source,
        lySourceTable: lyWorkshopVasMeta.sourceTable,
        lyPeriodStart: lyWorkshopVasMeta.periodStart,
        lyPeriodEnd: lyWorkshopVasMeta.periodEnd,
        lySourceRows: lyWorkshopVasMeta.sourceRows,
      },
      roBillingAudit,
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('workshop-performance')
  const authResponse = await timer.time('auth', () => requireBrandSectionApiAccess('platinum', 'platinum.business_excellence.view', request))
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
  const dealerCode = normalizePlatinumDealerCode(searchParams.get('dealer_code')) || null

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
