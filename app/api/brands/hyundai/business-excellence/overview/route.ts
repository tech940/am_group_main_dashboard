import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import {
  getHyundaiDealerCodes,
  hyundaiSourceDealerFilter,
  normalizeHyundaiDealerCode,
} from '@/lib/hyundai/dealer-branch'
import { fetchHyundaiMonthlyOperationMetrics } from '@/lib/hyundai/business-excellence-operations'
import {
  HYUNDAI_BE_CALCULATION_META,
  hyundaiActiveBillSql,
  hyundaiComparisonGrowth,
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
type OverviewChunk = 'summary' | 'secondary' | 'full'
type ComparisonParams = {
  preset: string | null
  comparisonMode: string | null
  comparisonStartDate: string | null
  comparisonEndDate: string | null
}

type DealerFilter = string | null

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null
  const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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

function stringValue(value: unknown, fallback = 'Unspecified') {
  const text = String(value || '').trim()
  return text || fallback
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10) || null
}

function dateGapInDays(left: string | null, right: string | null) {
  if (!left || !right) return Number.POSITIVE_INFINITY
  const leftDate = new Date(`${left}T00:00:00Z`)
  const rightDate = new Date(`${right}T00:00:00Z`)
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return Number.POSITIVE_INFINITY
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000)
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`CASE WHEN regexp_replace(${column}::text, '[^0-9.-]', '', 'g') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN regexp_replace(${column}::text, '[^0-9.-]', '', 'g')::numeric ELSE 0 END`
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function perUnit(amount: number, count: number) {
  return count > 0 ? amount / count : 0
}

function growth(current: number, previous: number) {
  return hyundaiComparisonGrowth(current, previous)
}

function getComparisonParams(searchParams: URLSearchParams): ComparisonParams {
  return {
    preset: searchParams.get('periodPreset') || null,
    comparisonMode: searchParams.get('comparisonMode') || 'none',
    comparisonStartDate: parseDateInput(searchParams.get('comparisonStartDate')),
    comparisonEndDate: parseDateInput(searchParams.get('comparisonEndDate')),
  }
}

function cacheKey(startDate: string, endDate: string, chunk: OverviewChunk, comparison: ComparisonParams, dealerCode: DealerFilter) {
  return `hyundai:business-excellence:overview:v30:${chunk}:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, dealerCode }))
    .digest('hex')}`
}

function activeBillStatusSql() {
  return hyundaiActiveBillSql()
}

function dealerCodeListSql(dealerCode: DealerFilter) {
  const dealerCodes = getHyundaiDealerCodes(dealerCode)
  return dealerCodes.length > 0 ? sql.join(dealerCodes.map((code) => sql`${code}`), sql`, `) : null
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return hyundaiRoBillingDealerFilter(dealerCode)
}

async function fetchRoBillingCoverage(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS raw_rows_in_range,
      COUNT(*) FILTER (
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql()}
      )::int AS row_count_in_range,
      COUNT(*) FILTER (
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
          AND NOT (${activeBillStatusSql()})
      )::int AS cancelled_rows_in_range,
      MIN(bill_date)::text AS earliest_available_date,
      MAX(bill_date)::text AS latest_available_date,
      MAX(uploaded_at)::text AS last_updated_at
    FROM hyundai_ro_billing_report
    WHERE TRUE
      ${roBillingDealerFilter(dealerCode)}
  `)
  const row = resultRows(result)[0] || {}
  const latestAvailableDate = dateValue(row.latest_available_date)
  const rowCountInRange = numberValue(row.row_count_in_range)
  const hasCompleteCoverage = Boolean(latestAvailableDate && dateGapInDays(latestAvailableDate, endDate) <= 1)
  return {
    dealerCode: dealerCode || 'ALL_LOCATIONS',
    isAllLocations: !dealerCode,
    hasDataInRange: rowCountInRange > 0,
    hasCompleteCoverage,
    rowCountInRange,
    rawRowsInRange: numberValue(row.raw_rows_in_range),
    cancelledRowsInRange: numberValue(row.cancelled_rows_in_range),
    earliestAvailableDate: dateValue(row.earliest_available_date),
    latestAvailableDate,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    dateBasis: 'bill_date',
    sourceLabel: 'RO Billing',
    comparisonStatus: hasCompleteCoverage ? 'available' : 'not_comparable',
    comparisonLabel: hasCompleteCoverage
      ? null
      : latestAvailableDate
        ? `CY available through ${latestAvailableDate}`
        : 'RO Billing source unavailable',
    lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : null,
  } as const
}

function complaintsDealerFilter(dealerCode: DealerFilter) {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code')],
  )
}

function openRoDealerFilter(dealerCode: DealerFilter) {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('dealer_code_2'), sql.raw('dlr_no'), sql.raw('dealer_name')]
  )
}

function sameDateLastYear(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return toDateInputValue(new Date(year - 1, month - 1, day))
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function endOfMonth(value: string) {
  const { year, month } = parseDateParts(value)
  return toDateInputValue(new Date(year, month, 0))
}

function sameQuarterToDateLastYear(endDate: string) {
  const { year, month } = parseDateParts(endDate)
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3
  return {
    startDate: toDateInputValue(new Date(year - 1, quarterStartMonth, 1)),
    endDate: sameDateLastYear(endDate),
  }
}

function yearToDateLastYear(startDate: string, endDate: string) {
  const { year } = parseDateParts(startDate)
  return {
    startDate: `${year - 1}-01-01`,
    endDate: sameDateLastYear(endDate),
  }
}

function fullPreviousFinancialYear(value: string) {
  const { year, month } = parseDateParts(value)
  const currentFinancialYearStart = month >= 4 ? year : year - 1
  return {
    startDate: `${currentFinancialYearStart - 1}-04-01`,
    endDate: `${currentFinancialYearStart}-03-31`,
  }
}

function isMonthAnchoredRange(startDate: string, endDate: string) {
  const start = parseDateParts(startDate)
  const end = parseDateParts(endDate)
  return start.day === 1 && start.year === end.year && start.month === end.month
}

function resolveOverviewComparisonRange(startDate: string, endDate: string, comparison: ComparisonParams) {
  if (comparison.comparisonStartDate && comparison.comparisonEndDate) {
    return {
      startDate: comparison.comparisonStartDate,
      endDate: comparison.comparisonEndDate,
      source: 'custom',
    }
  }

  if (comparison.preset === 'qtd' || comparison.preset === 'current_quarter') {
    return { ...sameQuarterToDateLastYear(endDate), source: 'same-quarter-to-date-ly' }
  }

  if (comparison.preset === 'ytd') {
    return { ...yearToDateLastYear(startDate, endDate), source: 'year-to-date-ly' }
  }

  if (comparison.preset === 'current_fy') {
    return { ...fullPreviousFinancialYear(startDate), source: 'full-financial-year-ly' }
  }

  if (comparison.preset === 'mtd' || comparison.preset === 'current_month' || isMonthAnchoredRange(startDate, endDate)) {
    return {
      startDate: sameDateLastYear(startDate),
      endDate: sameDateLastYear(endDate),
      source: 'same-month-to-date-ly',
    }
  }

  return {
    startDate: sameDateLastYear(startDate),
    endDate: sameDateLastYear(endDate),
    source: 'same-dates-ly',
  }
}

function ewDedupCountSql(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  const dealerCodes = dealerCodeListSql(dealerCode)
  return sql`
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
  `
}

function rsaDedupKpiSql(startDate: string, endDate: string) {
  return sql`
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
        ${numericText(sql.raw('total_amount'))} AS total_amount,
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
  `
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName)!

  const exists = await analyticsTableExists(tableName)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function shouldUseWorkshopJcSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  if (dealerCode) return false
  if (!(await tableExists('am_hyundai_workshop_performance_jc_summary_v1'))) return false

  const result = await db.execute(sql`
    SELECT
      MIN(report_date)::date <= ${startDate}::date
      AND MAX(report_date)::date >= ${endDate}::date AS usable
    FROM am_hyundai_workshop_performance_jc_summary_v1
  `)

  return Boolean(resultRows(result)[0]?.usable)
}

function roBillingBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  return sql`
    WITH raw AS (
      SELECT
        id,
        bill_date::date AS report_date,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        CASE
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%accident%'
            OR LOWER(COALESCE(work_type, '')) LIKE '%bodyshop%'
            THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%running%'
            THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%free%'
            THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%paid%'
            OR COALESCE(work_type, '') ~* '^[0-9]+K$'
            THEN 'Paid Service'
          ELSE 'Others'
        END AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        ${numericText(sql.raw('total_amt'))} AS total_amt,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
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
      FROM raw
    ),
    base AS (
      SELECT
        invoice_key,
        ro_key AS jc_key,
        report_date,
        advisor,
        service_category,
        labour_amt,
        part_amt,
        total_amt
      FROM ranked
      WHERE row_rank = 1
    ),
    enriched AS (
      SELECT
        *,
        labour_amt + part_amt AS revenue
      FROM base
    )
  `
}

function openRoBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const openRoDealerKey = sql`COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dealer_code_2, ''), NULLIF(dlr_no, ''), NULLIF(dealer_name, ''), '-')`
  return sql`
    WITH active AS (
      SELECT DISTINCT ON (
        ${openRoDealerKey} || ':' || COALESCE(NULLIF(r_o_no, ''), id::text)
      )
        ${openRoDealerKey} || ':' || COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
        r_o_date::date AS ro_date,
        svc_adv AS service_adv,
        work_type,
        work_type AS service_type,
        r_o_status AS status,
        NULL::date AS promise_date,
        uploaded_at
      FROM hyundai_repair_order_list
      WHERE cancel_date IS NULL
        AND LOWER(COALESCE(NULLIF(TRIM(r_o_status::text), ''), NULLIF(TRIM(status::text), ''), NULLIF(TRIM(new_r_o_status::text), ''), '')) = 'open'
        AND r_o_date >= ${startDate}::date
        AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        ${openRoDealerFilter(dealerCode)}
      ORDER BY
        ${openRoDealerKey} || ':' || COALESCE(NULLIF(r_o_no, ''), id::text),
        uploaded_at DESC NULLS LAST,
        id DESC
    ),
    enriched AS (
      SELECT
        *,
        GREATEST((COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int, 0) AS aging_days,
        CASE
          WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 4 THEN '0-4D'
          WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 7 THEN '5-7D'
          WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 15 THEN '8-15D'
          ELSE '>15D'
        END AS aging_bucket,
        CASE
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%accident%'
            OR LOWER(COALESCE(work_type, '')) LIKE '%bodyshop%'
            THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%running%'
            THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%free%'
            THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%paid%'
            OR COALESCE(work_type, '') ~* '^[0-9]+K$'
            THEN 'Paid Service'
          ELSE 'Others'
        END AS service_category,
        CASE
          WHEN promise_date IS NOT NULL AND COALESCE(${endDate}::date, CURRENT_DATE) > promise_date THEN 'Delayed'
          ELSE 'On Track'
        END AS delay_status
      FROM active
    )
  `
}

function complaintsBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const complaintDate = sql`COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date`
  return sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
        *
      FROM hyundai_call_center_complaints
      WHERE ${complaintDate} IS NOT NULL
      ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT
        complaint_no,
        ${complaintDate} AS complaint_date,
        close_date,
        resolving_date,
        dealer_name,
        dealer_code,
        vehicle_model,
        COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS sr_area,
        COALESCE(NULLIF(sr_sub_area, ''), 'Unspecified') AS sr_sub_area,
        CASE
          WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
          WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
          WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
          ELSE 'Open'
        END AS status_group,
        COALESCE(
          CASE
            WHEN close_date IS NOT NULL THEN GREATEST((close_date - complaint_date)::int, 0)
            WHEN resolving_date IS NOT NULL THEN GREATEST((resolving_date - complaint_date)::int, 0)
            ELSE NULL
          END,
          ${numericText(sql.raw('pending_days'))}::int,
          GREATEST((CURRENT_DATE - complaint_date)::int, 0)
        ) AS resolution_days,
        CASE
          WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%part%' THEN 'Parts Delay'
          WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%deliver%'
            OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%delay%' THEN 'Delay / Delivery'
          WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%insurance%'
            OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%approval%' THEN 'Approval / Insurance'
          WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%noise%'
            OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%rattl%' THEN 'Noise / Quality'
          WHEN LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%accident%'
            OR LOWER(CONCAT_WS(' ', complaint_remarks, sr_area, sr_sub_area, dealer_sr_area, dealer_sr_sub_area, pending_reason)) LIKE '%body%' THEN 'Bodyshop'
          ELSE COALESCE(NULLIF(sr_area, ''), 'General Service')
        END AS signal_area
      FROM latest
      WHERE ${complaintDate} >= ${startDate}::date
        AND ${complaintDate} < (${endDate}::date + INTERVAL '1 day')
        ${complaintsDealerFilter(dealerCode)}
    )
  `
}

async function fetchAddonKpis(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  const [hasEw, hasMcp, hasRsa] = await Promise.all([
    tableExists('hyundai_ew_report'),
    tableExists('am_hyundai_mcp_report'),
    tableExists('am_hyundai_rsa_report'),
  ])

  const [ew, mcp, rsa] = await Promise.all([
    hasEw
      ? db.execute(ewDedupCountSql(startDate, endDate, dealerCode))
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
      ? db.execute(rsaDedupKpiSql(startDate, endDate))
      : Promise.resolve([{ count: 0, amount: 0 }] as NumericRow[]),
  ])

  return {
    ewCount: numberValue(resultRows(ew)[0]?.count),
    mcpCount: numberValue(resultRows(mcp)[0]?.count),
    rsaCount: numberValue(resultRows(rsa)[0]?.count),
    rsaAmount: numberValue(resultRows(rsa)[0]?.amount),
  }
}

async function fetchWorkshopSnapshot(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null,
  vasEndDate?: string,
) {
  const hasWorkshopSummary = await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode)
  const serviceRows = await db.execute(hasWorkshopSummary ? sql`
    SELECT
      COALESCE(NULLIF(group_type, ''), 'Others') AS service_type,
      MIN(report_date)::text AS min_date,
      MAX(report_date)::text AS max_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM am_hyundai_workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY COALESCE(NULLIF(group_type, ''), 'Others')
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
    LIMIT 8
  ` : sql`
    WITH raw AS (
      SELECT
        id,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        bill_date::date AS report_date,
        CASE
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%accident%'
            OR LOWER(COALESCE(work_type, '')) LIKE '%bodyshop%'
            THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%running%'
            THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%free%'
            THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type, '')) LIKE '%paid%'
            OR COALESCE(work_type, '') ~* '^[0-9]+K$'
            THEN 'Paid Service'
          ELSE COALESCE(NULLIF(work_type, ''), 'Others')
        END AS service_type,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
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
      FROM raw
    ),
    dedup AS (
      SELECT invoice_key, ro_key, report_date, service_type, labour_amt, part_amt
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      service_type,
      MIN(report_date)::text AS min_date,
      MAX(report_date)::text AS max_date,
      COUNT(DISTINCT ro_key)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY service_type
    ORDER BY (COALESCE(SUM(labour_amt), 0) + COALESCE(SUM(part_amt), 0)) DESC
    LIMIT 8
  `)

  const rows = resultRows(serviceRows).map((row) => {
    const labourAmount = numberValue(row.labour_amount)
    const partsAmount = numberValue(row.part_amount)
    return {
      name: stringValue(row.service_type, 'Others'),
      totalJc: numberValue(row.total_jc),
      labourAmount,
      partsAmount,
      totalRevenue: labourAmount + partsAmount,
    }
  })

  const vasAmount = await fetchWorkshopVasAmount(startDate, vasEndDate || endDate, dealerCode)
  const totalJc = rows.reduce((sum, row) => sum + row.totalJc, 0)
  const labourAmount = rows.reduce((sum, row) => sum + row.labourAmount, 0)
  const partsAmount = rows.reduce((sum, row) => sum + row.partsAmount, 0)
  const sourceRows = resultRows(serviceRows)

  return {
    totalJc,
    labourAmount,
    partsAmount,
    totalRevenue: labourAmount + partsAmount,
    vasAmount,
    labourPerRo: perUnit(labourAmount, totalJc),
    minDate: sourceRows.reduce<string | null>((current, row) => {
      const value = dateValue(row.min_date)
      if (!value) return current
      return !current || value < current ? value : current
    }, null),
    maxDate: sourceRows.reduce<string | null>((current, row) => {
      const value = dateValue(row.max_date)
      if (!value) return current
      return !current || value > current ? value : current
    }, null),
    serviceMix: rows.slice(0, 5).map((row) => ({
      ...row,
      vasAmount: 0,
    })),
  }
}

function emptyRows() {
  return Promise.resolve([] as NumericRow[])
}

function emptyAddonKpis() {
  return Promise.resolve({
    ewCount: 0,
    rsaCount: 0,
    mcpCount: 0,
    rsaAmount: 0,
  })
}

function emptyWorkshopSnapshot() {
  return Promise.resolve({
    totalJc: 0,
    labourAmount: 0,
    partsAmount: 0,
    totalRevenue: 0,
    vasAmount: 0,
    labourPerRo: 0,
    minDate: null as string | null,
    maxDate: null as string | null,
    serviceMix: [] as Array<{
      name: string
      totalJc: number
      labourAmount: number
      partsAmount: number
      totalRevenue: number
      vasAmount: number
    }>,
  })
}

async function fetchWorkshopVasAmount(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  void startDate
  return (await fetchHyundaiMonthlyOperationMetrics(endDate, dealerCode)).vasAmount
}

async function buildOverviewPayload(
  startDate: string,
  endDate: string,
  chunk: OverviewChunk = 'summary',
  comparison: ComparisonParams = {
    preset: null,
    comparisonMode: 'none',
    comparisonStartDate: null,
    comparisonEndDate: null,
  },
  dealerCode: DealerFilter = null
) {
  const includeSecondary = chunk === 'secondary' || chunk === 'full'
  const includeComparison = true
  const roSql = roBillingBaseSql(startDate, endDate, dealerCode)
  const openSql = openRoBaseSql(startDate, endDate, dealerCode)
  const complaintSql = complaintsBaseSql(startDate, endDate, dealerCode)
  const comparisonRange = resolveOverviewComparisonRange(startDate, endDate, comparison)
  const lyStartDate = comparisonRange.startDate
  const lyEndDate = comparisonRange.endDate
  const lyOperationEndDate = comparison.preset === 'mtd'
    || comparison.preset === 'current_month'
    || isMonthAnchoredRange(startDate, endDate)
    ? endOfMonth(lyEndDate)
    : lyEndDate
  const lyRoSql = roBillingBaseSql(lyStartDate, lyEndDate, dealerCode)
  const lyOpenSql = openRoBaseSql(lyStartDate, lyEndDate, dealerCode)
  const lyComplaintSql = complaintsBaseSql(lyStartDate, lyEndDate, dealerCode)

  const [
    roKpiRows,
    roDailyRows,
    roMixRows,
    advisorRows,
    openKpiRows,
    agingRows,
    openAdvisorRows,
    openWorkTypeRows,
    complaintKpiRows,
    complaintAreaRows,
    complaintStatusRows,
    complaintMonthRows,
    addonKpis,
    workshopSnapshot,
    lyRoKpiRows,
    lyOpenKpiRows,
    lyComplaintKpiRows,
    lyAddonKpis,
    lyWorkshopSnapshot,
    operationCoverage,
    lyOperationCoverage,
    roBillingCoverage,
  ] = await Promise.all([
    db.execute(sql`
      ${roSql}
      SELECT
        COUNT(*)::int AS deduped_invoices,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        MIN(report_date)::text AS min_bill_date,
        MAX(report_date)::text AS max_bill_date,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(revenue), 0)::float AS revenue,
        COALESCE(AVG(revenue), 0)::float AS avg_line_value
      FROM enriched
    `),
    includeSecondary ? db.execute(sql`
      ${roSql}
      SELECT
        report_date::text AS date,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY report_date
      ORDER BY report_date ASC
      LIMIT 45
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      ${roSql}
      SELECT
        service_category,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY service_category
      ORDER BY total_jc DESC, revenue DESC
      LIMIT 6
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      ${roSql}
      SELECT
        advisor,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY advisor
      ORDER BY revenue DESC, total_jc DESC
      LIMIT 8
    `) : emptyRows(),
    db.execute(sql`
      ${openSql}
      SELECT
        COUNT(*)::int AS total_open_ro,
        MIN(ro_date)::text AS min_ro_date,
        MAX(ro_date)::text AS max_ro_date,
        COALESCE(AVG(aging_days), 0)::float AS avg_aging,
        COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15,
        COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed,
        COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accident_jobs
      FROM enriched
    `),
    includeSecondary ? db.execute(sql`
      ${openSql}
      SELECT aging_bucket AS bucket, COUNT(*)::int AS count
      FROM enriched
      GROUP BY aging_bucket
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      ${openSql}
      SELECT
        COALESCE(NULLIF(service_adv, ''), 'Unspecified') AS advisor,
        COUNT(*)::int AS open_ro,
        COALESCE(AVG(aging_days), 0)::float AS avg_aging
      FROM enriched
      GROUP BY 1
      ORDER BY open_ro DESC, avg_aging DESC
      LIMIT 8
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      ${openSql}
      SELECT service_category, COUNT(*)::int AS count
      FROM enriched
      GROUP BY service_category
      ORDER BY count DESC
    `) : emptyRows(),
    db.execute(sql`
      ${complaintSql}
      SELECT
        COUNT(*)::int AS total,
        MIN(complaint_date)::text AS min_complaint_date,
        MAX(complaint_date)::text AS max_complaint_date,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
        COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM enriched
    `),
    includeSecondary ? db.execute(sql`
      ${complaintSql}
      SELECT
        signal_area AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM enriched
      GROUP BY signal_area
      ORDER BY total DESC, open DESC
      LIMIT 8
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      ${complaintSql}
      SELECT status_group AS status, COUNT(*)::int AS count
      FROM enriched
      GROUP BY status_group
      ORDER BY count DESC
    `) : emptyRows(),
    includeSecondary ? db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
          complaint_no,
          COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date AS complaint_date,
          status,
          close_date,
          resolving_date,
          pending_days,
          uploaded_at
        FROM hyundai_call_center_complaints
        WHERE COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date IS NOT NULL
          AND (
            (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date >= ${startDate}::date
              AND COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date < (${endDate}::date + INTERVAL '1 day'))
            OR (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date >= ${lyStartDate}::date
              AND COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date < (${lyEndDate}::date + INTERVAL '1 day'))
          )
          ${complaintsDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        EXTRACT(MONTH FROM complaint_date)::int AS month_no,
        TO_CHAR(MAKE_DATE(2000, EXTRACT(MONTH FROM complaint_date)::int, 1), 'Mon') AS month,
        COUNT(*) FILTER (
          WHERE complaint_date >= ${startDate}::date
            AND complaint_date < (${endDate}::date + INTERVAL '1 day')
        )::int AS cy_count,
        COUNT(*) FILTER (
          WHERE complaint_date >= ${lyStartDate}::date
            AND complaint_date < (${lyEndDate}::date + INTERVAL '1 day')
        )::int AS ly_count
      FROM latest
      GROUP BY EXTRACT(MONTH FROM complaint_date)::int
      HAVING
        COUNT(*) FILTER (
          WHERE complaint_date >= ${startDate}::date
            AND complaint_date < (${endDate}::date + INTERVAL '1 day')
        ) > 0
        OR COUNT(*) FILTER (
          WHERE complaint_date >= ${lyStartDate}::date
            AND complaint_date < (${lyEndDate}::date + INTERVAL '1 day')
        ) > 0
      ORDER BY EXTRACT(MONTH FROM complaint_date)::int ASC
    `) : emptyRows(),
    fetchAddonKpis(startDate, endDate, dealerCode),
    fetchWorkshopSnapshot(startDate, endDate, dealerCode, endDate),
    includeComparison ? db.execute(sql`
      ${lyRoSql}
      SELECT
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
    `) : emptyRows(),
    includeComparison ? db.execute(sql`
      ${lyOpenSql}
      SELECT
        COUNT(*)::int AS total_open_ro,
        COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15,
        COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed
      FROM enriched
    `) : emptyRows(),
    includeComparison ? db.execute(sql`
      ${lyComplaintSql}
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
        COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM enriched
    `) : emptyRows(),
    includeComparison ? fetchAddonKpis(lyStartDate, lyEndDate, dealerCode) : emptyAddonKpis(),
    includeComparison ? fetchWorkshopSnapshot(lyStartDate, lyEndDate, dealerCode, lyOperationEndDate) : emptyWorkshopSnapshot(),
    fetchHyundaiMonthlyOperationMetrics(endDate, dealerCode),
    includeComparison ? fetchHyundaiMonthlyOperationMetrics(lyOperationEndDate, dealerCode) : Promise.resolve(null),
    fetchRoBillingCoverage(startDate, endDate, dealerCode),
  ])

  const roKpis = resultRows(roKpiRows)[0] || {}
  const openKpis = resultRows(openKpiRows)[0] || {}
  const complaintKpis = resultRows(complaintKpiRows)[0] || {}
  const lyRoKpis = resultRows(lyRoKpiRows)[0] || {}
  const lyOpenKpis = resultRows(lyOpenKpiRows)[0] || {}
  const lyComplaintKpis = resultRows(lyComplaintKpiRows)[0] || {}

  const totalJc = numberValue(roKpis.total_jc)
  const revenue = numberValue(roKpis.revenue)
  const labour = numberValue(roKpis.labour)
  const parts = numberValue(roKpis.parts)
  const totalOpenRo = numberValue(openKpis.total_open_ro)
  const delayedRo = numberValue(openKpis.delayed)
  const openOver15 = numberValue(openKpis.over_15)
  const complaintsTotal = numberValue(complaintKpis.total)
  const complaintsOpen = numberValue(complaintKpis.open)
  const complaintsOver15 = numberValue(complaintKpis.over_15)
  const bucketOrder = ['0-4D', '5-7D', '8-15D', '>15D']
  const bucketMap = new Map(resultRows(agingRows).map((row) => [String(row.bucket), numberValue(row.count)]))
  const addOnTotal = addonKpis.ewCount + addonKpis.rsaCount + addonKpis.mcpCount
  const lyTotalJc = numberValue(lyRoKpis.total_jc)
  const lyRevenue = numberValue(lyRoKpis.revenue)
  const lyLabour = numberValue(lyRoKpis.labour)
  const lyParts = numberValue(lyRoKpis.parts)
  const lyOpenRo = numberValue(lyOpenKpis.total_open_ro)
  const lyDelayedRo = numberValue(lyOpenKpis.delayed)
  const lyOpenOver15 = numberValue(lyOpenKpis.over_15)
  const lyComplaintsTotal = numberValue(lyComplaintKpis.total)
  const lyComplaintsOpen = numberValue(lyComplaintKpis.open)
  const lyComplaintsOver15 = numberValue(lyComplaintKpis.over_15)
  const lyAddOnTotal = lyAddonKpis.ewCount + lyAddonKpis.rsaCount + lyAddonKpis.mcpCount
  const roBillingMaxDate = dateValue(roKpis.max_bill_date)
  const effectiveRoBillingCoverage = roBillingCoverage.hasDataInRange && roBillingMaxDate
    ? {
        ...roBillingCoverage,
        hasCompleteCoverage: dateGapInDays(roBillingMaxDate, endDate) <= 1,
        latestAvailableDate: roBillingMaxDate,
        comparisonStatus: dateGapInDays(roBillingMaxDate, endDate) <= 1 ? 'available' : 'not_comparable',
        comparisonLabel: dateGapInDays(roBillingMaxDate, endDate) <= 1 ? null : `CY available through ${roBillingMaxDate}`,
      }
    : roBillingCoverage
  const roBillingComparable = effectiveRoBillingCoverage.hasCompleteCoverage
  const roBillingComparisonStatus = roBillingComparable ? 'available' : 'not_comparable'
  const roBillingComparisonLabel = effectiveRoBillingCoverage.comparisonLabel
  const billingComparison = (cy: number, ly: number) => ({
    cy,
    ly,
    deltaPct: roBillingComparable ? growth(cy, ly) : null,
    comparisonStatus: roBillingComparisonStatus,
    comparisonLabel: roBillingComparisonLabel,
    unavailableReason: roBillingComparable
      ? null
      : `Requested through ${endDate}; source is available through ${effectiveRoBillingCoverage.latestAvailableDate || 'no date'}.`,
  })

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    dateRange: { startDate, endDate },
    kpis: {
      revenue,
      labour,
      parts,
      totalJc,
      avgBilling: perUnit(revenue, totalJc),
      openRo: totalOpenRo,
      delayedRo,
      openOver15,
      avgOpenAging: numberValue(openKpis.avg_aging),
      accidentOpenJobs: numberValue(openKpis.accident_jobs),
      complaintsTotal,
      complaintsOpen,
      complaintsClosed: numberValue(complaintKpis.closed),
      complaintsOver15,
      avgComplaintDays: numberValue(complaintKpis.avg_days),
      ewCount: addonKpis.ewCount,
      rsaCount: addonKpis.rsaCount,
      mcpCount: addonKpis.mcpCount,
      rsaAmount: addonKpis.rsaAmount,
      delayedRoPct: percent(delayedRo, totalOpenRo),
      agedRoPct: percent(openOver15, totalOpenRo),
      complaintOpenPct: percent(complaintsOpen, complaintsTotal),
      addOnPerJc: perUnit(addOnTotal, totalJc),
    },
    workshopSnapshot,
    comparison: includeComparison ? {
      lyRange: {
        startDate: lyStartDate,
        endDate: lyEndDate,
      },
      revenue: billingComparison(revenue, lyRevenue),
      labour: billingComparison(labour, lyLabour),
      parts: billingComparison(parts, lyParts),
      totalJc: billingComparison(totalJc, lyTotalJc),
      avgBilling: billingComparison(perUnit(revenue, totalJc), perUnit(lyRevenue, lyTotalJc)),
      openRo: {
        cy: totalOpenRo,
        ly: lyOpenRo,
        deltaPct: null,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Open RO is a current-state source and has no historical snapshot comparison.',
      },
      delayedRo: {
        cy: delayedRo,
        ly: lyDelayedRo,
        deltaPct: null,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Delayed RO is derived from the current open-RO state.',
      },
      openOver15: {
        cy: openOver15,
        ly: lyOpenOver15,
        deltaPct: null,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Aged WIP is derived from the current open-RO state.',
      },
      complaintsTotal: {
        cy: complaintsTotal,
        ly: lyComplaintsTotal,
        deltaPct: growth(complaintsTotal, lyComplaintsTotal),
      },
      complaintsOpen: {
        cy: complaintsOpen,
        ly: lyComplaintsOpen,
        deltaPct: growth(complaintsOpen, lyComplaintsOpen),
      },
      complaintsOver15: {
        cy: complaintsOver15,
        ly: lyComplaintsOver15,
        deltaPct: growth(complaintsOver15, lyComplaintsOver15),
      },
      addOnTotal: {
        cy: addOnTotal,
        ly: lyAddOnTotal,
        deltaPct: growth(addOnTotal, lyAddOnTotal),
      },
      ewCount: {
        cy: addonKpis.ewCount,
        ly: lyAddonKpis.ewCount,
        deltaPct: growth(addonKpis.ewCount, lyAddonKpis.ewCount),
      },
      rsaCount: {
        cy: addonKpis.rsaCount,
        ly: lyAddonKpis.rsaCount,
        deltaPct: growth(addonKpis.rsaCount, lyAddonKpis.rsaCount),
      },
      mcpCount: {
        cy: addonKpis.mcpCount,
        ly: lyAddonKpis.mcpCount,
        deltaPct: growth(addonKpis.mcpCount, lyAddonKpis.mcpCount),
      },
      workshopRevenue: {
        cy: workshopSnapshot.totalRevenue,
        ly: lyWorkshopSnapshot.totalRevenue,
        deltaPct: roBillingComparable ? growth(workshopSnapshot.totalRevenue, lyWorkshopSnapshot.totalRevenue) : null,
        comparisonStatus: roBillingComparisonStatus,
        comparisonLabel: roBillingComparisonLabel,
      },
      workshopTotalJc: {
        cy: workshopSnapshot.totalJc,
        ly: lyWorkshopSnapshot.totalJc,
        deltaPct: roBillingComparable ? growth(workshopSnapshot.totalJc, lyWorkshopSnapshot.totalJc) : null,
        comparisonStatus: roBillingComparisonStatus,
        comparisonLabel: roBillingComparisonLabel,
      },
      workshopLabourPerRo: {
        cy: workshopSnapshot.labourPerRo,
        ly: lyWorkshopSnapshot.labourPerRo,
        deltaPct: roBillingComparable ? growth(workshopSnapshot.labourPerRo, lyWorkshopSnapshot.labourPerRo) : null,
        comparisonStatus: roBillingComparisonStatus,
        comparisonLabel: roBillingComparisonLabel,
      },
      workshopVasAmount: {
        cy: workshopSnapshot.vasAmount,
        ly: lyWorkshopSnapshot.vasAmount,
        deltaPct: operationCoverage.available
          && Boolean(lyOperationCoverage?.available)
          && operationCoverage.periodStart?.slice(5, 7) === lyOperationCoverage?.periodStart?.slice(5, 7)
          ? growth(workshopSnapshot.vasAmount, lyWorkshopSnapshot.vasAmount)
          : null,
        comparisonStatus: !operationCoverage.available || !lyOperationCoverage?.available
          ? 'source_missing'
          : operationCoverage.periodStart?.slice(5, 7) === lyOperationCoverage.periodStart?.slice(5, 7)
            ? (lyWorkshopSnapshot.vasAmount === 0 ? 'exact_zero' : 'available')
            : 'period_mismatch',
        comparisonLabel: !operationCoverage.available || !lyOperationCoverage?.available
          ? 'Operation Wise source unavailable'
          : operationCoverage.periodStart?.slice(5, 7) === lyOperationCoverage.periodStart?.slice(5, 7)
            ? null
            : 'Source periods differ',
        unavailableReason: !operationCoverage.available || !lyOperationCoverage?.available
          ? 'VAS comparison requires both CY and LY monthly Operation Wise snapshots.'
          : null,
        periodStart: operationCoverage.periodStart,
        periodEnd: operationCoverage.periodEnd,
        lyPeriodStart: lyOperationCoverage?.periodStart || null,
        lyPeriodEnd: lyOperationCoverage?.periodEnd || null,
      },
    } : undefined,
    charts: {
      revenueTrend: resultRows(roDailyRows).map((row) => ({
        date: dateValue(row.date),
        label: dateValue(row.date)?.slice(5) || '',
        revenue: numberValue(row.revenue),
        totalJc: numberValue(row.total_jc),
      })),
      serviceMix: resultRows(roMixRows).map((row) => ({
        name: stringValue(row.service_category, 'Others'),
        totalJc: numberValue(row.total_jc),
        revenue: numberValue(row.revenue),
      })),
      advisorRevenue: resultRows(advisorRows).map((row) => ({
        advisor: stringValue(row.advisor),
        totalJc: numberValue(row.total_jc),
        revenue: numberValue(row.revenue),
      })),
      agingDistribution: bucketOrder.map((bucket) => ({ bucket, count: bucketMap.get(bucket) || 0 })),
      openRoAdvisorLoad: resultRows(openAdvisorRows).map((row) => ({
        advisor: stringValue(row.advisor),
        openRo: numberValue(row.open_ro),
        avgAging: numberValue(row.avg_aging),
      })),
      openRoWorkType: resultRows(openWorkTypeRows).map((row) => ({
        name: stringValue(row.service_category, 'Others'),
        value: numberValue(row.count),
      })),
      complaintAreas: resultRows(complaintAreaRows).map((row) => ({
        name: stringValue(row.name),
        total: numberValue(row.total),
        open: numberValue(row.open),
        avgDays: numberValue(row.avg_days),
      })),
      complaintStatus: resultRows(complaintStatusRows).map((row) => ({
        status: stringValue(row.status),
        count: numberValue(row.count),
      })),
      complaintMonthlyComparison: resultRows(complaintMonthRows).map((row) => {
        const cyCount = numberValue(row.cy_count)
        const lyCount = numberValue(row.ly_count)
        return {
          month: stringValue(row.month, ''),
          monthNo: numberValue(row.month_no),
          cyCount,
          lyCount,
          growthPct: growth(cyCount, lyCount),
        }
      }),
      addOnMix: [
        { name: 'EW', value: addonKpis.ewCount },
        { name: 'RSA', value: addonKpis.rsaCount },
        { name: 'MCP', value: addonKpis.mcpCount },
      ],
    },
    insights: [
      {
        label: 'Workshop WIP Pressure',
        value: `${totalOpenRo.toLocaleString('en-IN')} open`,
        context: `${delayedRo.toLocaleString('en-IN')} delayed and ${openOver15.toLocaleString('en-IN')} beyond 15 days.`,
        tone: delayedRo > 0 || openOver15 > 0 ? 'risk' : 'good',
      },
      {
        label: 'Billing Velocity',
        value: `${totalJc.toLocaleString('en-IN')} JC`,
        context: `Average billing is ${Math.round(perUnit(revenue, totalJc)).toLocaleString('en-IN')} per closed RO.`,
        tone: totalJc > 0 ? 'neutral' : 'watch',
      },
      {
        label: 'Customer Voice',
        value: `${complaintsTotal.toLocaleString('en-IN')} complaints`,
        context: `${complaintsOpen.toLocaleString('en-IN')} still open with ${complaintsOver15.toLocaleString('en-IN')} crossing 15 days.`,
        tone: complaintsOpen > 0 || complaintsOver15 > 0 ? 'watch' : 'good',
      },
      {
        label: 'Add-on Attachment',
        value: `${addOnTotal.toLocaleString('en-IN')} sold`,
        context: `${addonKpis.ewCount.toLocaleString('en-IN')} EW, ${addonKpis.rsaCount.toLocaleString('en-IN')} RSA and ${addonKpis.mcpCount.toLocaleString('en-IN')} MCP in the selected period.`,
        tone: addOnTotal > 0 ? 'good' : 'watch',
      },
    ],
    meta: {
      ...HYUNDAI_BE_CALCULATION_META,
      chunk,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      periodScope: {
        startDate,
        endDate,
        lyStartDate,
        lyEndDate,
        lySource: comparisonRange.source,
      },
      comparison,
      sourceCoverage: {
        roBilling: {
          minDate: dateValue(roKpis.min_bill_date),
          maxDate: dateValue(roKpis.max_bill_date),
        },
        openRo: {
          minDate: dateValue(openKpis.min_ro_date),
          maxDate: dateValue(openKpis.max_ro_date),
        },
        complaints: {
          minDate: dateValue(complaintKpis.min_complaint_date),
          maxDate: dateValue(complaintKpis.max_complaint_date),
        },
        workshopPerformance: {
          minDate: workshopSnapshot.minDate,
          maxDate: workshopSnapshot.maxDate,
        },
        operationWise: {
          available: operationCoverage.available,
          periodStart: operationCoverage.periodStart,
          periodEnd: operationCoverage.periodEnd,
          identifierVersion: operationCoverage.identifierVersion,
          sourceRows: operationCoverage.sourceRows,
          classifiedRows: operationCoverage.classifiedRows,
          unknownCodeRows: operationCoverage.unknownCodeRows,
        },
      },
      dealerCoverage: {
        primary: effectiveRoBillingCoverage,
        roBilling: effectiveRoBillingCoverage,
      },
      roBillingAudit: {
        sourceAvailable: true,
        rawRows: effectiveRoBillingCoverage.rawRowsInRange,
        activeRawRows: effectiveRoBillingCoverage.rowCountInRange,
        cancelledRows: effectiveRoBillingCoverage.cancelledRowsInRange,
        dedupedInvoices: numberValue(roKpis.deduped_invoices),
        dedupedJc: totalJc,
        duplicateRowsRemoved: Math.max(
          0,
          effectiveRoBillingCoverage.rowCountInRange - numberValue(roKpis.deduped_invoices),
        ),
        labour,
        parts,
        revenue,
        minBillDate: dateValue(roKpis.min_bill_date),
        maxBillDate: roBillingMaxDate,
        latestUploadedAt: effectiveRoBillingCoverage.lastUpdatedAt,
      },
      sourceWarnings: [
        ...(!effectiveRoBillingCoverage.hasCompleteCoverage
          ? [`RO Billing is available through ${effectiveRoBillingCoverage.latestAvailableDate || 'no date'}; comparison and health scoring are suppressed for the requested end date ${endDate}.`]
          : []),
        ...(!operationCoverage.available ? ['No contained Hyundai Operation Wise snapshot exists for the selected period.'] : []),
        ...(operationCoverage.available && operationCoverage.classifiedRows === 0 && normalizeHyundaiDealerCode(dealerCode) !== 'JAMMU'
          ? ['Hyundai Operation Wise snapshot exists but contains no classified VAS/WA/WB rows. Reload the complete report before treating zero values as business performance.']
          : []),
        ...(includeComparison && !lyOperationCoverage?.available ? ['No comparable Hyundai Operation Wise snapshot exists for the comparison period.'] : []),
      ],
      dateBases: {
        roBilling: 'bill_date',
        openRo: 'ro_date',
        complaints: 'COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)',
        ew: 'reg_date',
        rsa: 'invoice_date',
        mcp: 'package_purchase_date',
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('business-excellence-overview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const defaults = defaultRange()
  const startDate = parseDateInput(searchParams.get('startDate')) || defaults.startDate
  const endDate = parseDateInput(searchParams.get('endDate')) || defaults.endDate
  const chunkParam = searchParams.get('chunk')
  const chunk: OverviewChunk = chunkParam === 'secondary' || chunkParam === 'full' ? chunkParam : 'summary'
  const skipCache = searchParams.get('skipCache') === 'true'
  const comparison = getComparisonParams(searchParams)
  const dealerCode = normalizeHyundaiDealerCode(searchParams.get('dealer_code')) || null

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildOverviewPayload(startDate, endDate, chunk, comparison, dealerCode)
      : getCachedData(
        cacheKey(startDate, endDate, chunk, comparison, dealerCode),
        () => buildOverviewPayload(startDate, endDate, chunk, comparison, dealerCode),
        CACHE_TTL_SECONDS
      ))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data, {
      headers: { 'Cache-Control': RESPONSE_CACHE_CONTROL },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Business Excellence overview:', error)
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({
      error: process.env.NODE_ENV === 'production'
        ? 'Failed to build Business Excellence overview'
        : `Failed to build Business Excellence overview: ${detail}`,
    }, { status: 500 })
  }
}
