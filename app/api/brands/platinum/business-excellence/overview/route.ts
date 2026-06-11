import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizePlatinumDealerCode, PLATINUM_ALL_LOCATIONS_CODE } from '@/lib/platinum/dealer-branch'
import { fetchPlatinumWorkshopVasAmount } from '@/lib/platinum/business-excellence-vas'
import {
  fetchPlatinumComplaintsCoverage,
  fetchPlatinumOpenRoCoverage,
  fetchPlatinumRoBillingCoverage,
} from '@/lib/platinum/business-excellence-coverage'
import type { PlatinumDealerCoverage } from '@/lib/platinum/business-excellence-coverage'
import {
  emptyPlatinumRoBillingAudit,
  fetchPlatinumRoBillingAudit,
} from '@/lib/platinum/ro-billing-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function perUnit(amount: number, count: number) {
  return count > 0 ? amount / count : 0
}

function growth(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function nullableGrowth(current: number, previous: number | null) {
  if (previous === null) return null
  return growth(current, previous)
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
  return `platinum:business-excellence:overview:v35:${chunk}:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, dealerCode }))
    .digest('hex')}`
}

function activeBillStatusSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'`
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
        NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
      ) = ${dealerCode}`
    : sql``
}

function complaintsDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${dealerCode}`
    : sql``
}

function openRoDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), '')
      ) = ${dealerCode}`
    : sql``
}

function comparisonStatus(previous: number, status: 'available' | 'not_comparable' | 'source_missing' = 'available') {
  if (status !== 'available') return status
  return previous === 0 ? 'exact_zero' : 'available'
}

function roBillingComparisonStatus(previous: number, hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? comparisonStatus(previous) : 'not_comparable'
}

function roBillingDelta(current: number, previous: number, hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? growth(current, previous) : null
}

function roBillingComparisonLabel(hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? null : 'No selected-range data'
}

function roBillingUnavailableReason(hasSelectedRangeData: boolean) {
  return hasSelectedRangeData ? null : 'No RO Billing rows exist for the selected dealer/date range'
}

function complaintBusinessDateSql() {
  return sql`COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date`
}

function complaintResolutionEndSql() {
  return sql`COALESCE(close_date, resolving_date, dealer_resolving_date)::date`
}

function sameDateLastYear(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return toDateInputValue(new Date(year - 1, month - 1, day))
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
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
      FROM am_platinum_ew_report
      WHERE reg_date >= ${startDate}::date
        AND reg_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
        ${dealerCode ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${dealerCode}` : sql``}
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
  `
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName)!

  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function shouldUseWorkshopJcSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  if (dealerCode) return false
  if (!(await tableExists('am_platinum_workshop_performance_jc_summary_v1'))) return false

  const result = await db.execute(sql`
    SELECT
      MIN(report_date)::date <= ${startDate}::date
      AND MAX(report_date)::date >= ${endDate}::date AS usable
    FROM am_platinum_workshop_performance_jc_summary_v1
  `)

  return Boolean(resultRows(result)[0]?.usable)
}

function roBillingBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  return sql`
    WITH raw AS (
      SELECT
        bill_date::date AS report_date,
        COALESCE(NULLIF(bill_no, ''), NULLIF(r_o_no, ''), id::text) AS jc_key,
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
        ${numericText(sql.raw('total_amt'))} AS total_amt
      FROM am_platinum_ro_billing_report
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
          ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC
        ) AS row_rank
      FROM raw
    ),
    base AS (
      SELECT
        jc_key,
        (ARRAY_AGG(report_date ORDER BY row_rank ASC))[1] AS report_date,
        (ARRAY_AGG(advisor ORDER BY row_rank ASC))[1] AS advisor,
        (ARRAY_AGG(service_category ORDER BY row_rank ASC))[1] AS service_category,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt
      FROM ranked
      GROUP BY jc_key
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
  return sql`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
        r_o_date::date AS ro_date,
        svc_adv AS service_adv,
        work_type,
        work_type AS service_type,
        r_o_status AS status,
        NULL::date AS promise_date,
        uploaded_at
      FROM am_platinum_repair_order_list
      WHERE LOWER(COALESCE(r_o_status, '')) = 'open'
        AND r_o_date >= ${startDate}::date
        AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        ${openRoDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT
        *,
        GREATEST((CURRENT_DATE - ro_date)::int, 0) AS aging_days,
        CASE
          WHEN (CURRENT_DATE - ro_date)::int <= 4 THEN '0-4D'
          WHEN (CURRENT_DATE - ro_date)::int <= 7 THEN '5-7D'
          WHEN (CURRENT_DATE - ro_date)::int <= 15 THEN '8-15D'
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
          WHEN promise_date IS NOT NULL AND CURRENT_DATE > promise_date THEN 'Delayed'
          ELSE 'On Track'
        END AS delay_status
      FROM active
    )
  `
}

function complaintsBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const complaintBusinessDate = complaintBusinessDateSql()
  const complaintResolutionEnd = complaintResolutionEndSql()

  return sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
        *
      FROM am_platinum_call_center_complaints
      WHERE ${complaintBusinessDate} IS NOT NULL
      ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT
        complaint_no,
        ${complaintBusinessDate} AS complaint_date,
        complaint_date AS source_complaint_date,
        close_date,
        resolving_date,
        dealer_resolving_date,
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
            WHEN ${complaintResolutionEnd} IS NOT NULL THEN GREATEST((${complaintResolutionEnd} - ${complaintBusinessDate})::int, 0)
            ELSE NULL
          END,
          ${numericText(sql.raw('pending_days'))}::int,
          GREATEST((CURRENT_DATE - ${complaintBusinessDate})::int, 0)
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
      WHERE ${complaintBusinessDate} >= ${startDate}::date
        AND ${complaintBusinessDate} < (${endDate}::date + INTERVAL '1 day')
        ${complaintsDealerFilter(dealerCode)}
    )
  `
}

async function fetchAddonKpis(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  const [hasEw, hasMcp, hasRsa] = await Promise.all([
    tableExists('am_platinum_ew_report'),
    tableExists('am_platinum_mcp_report'),
    tableExists('am_platinum_rsa_report'),
  ])

  const [ew, mcp, rsa] = await Promise.all([
    hasEw
      ? db.execute(ewDedupCountSql(startDate, endDate, dealerCode))
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasMcp
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM am_platinum_mcp_report
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

async function fetchWorkshopSnapshot(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  const hasWorkshopSummary = await shouldUseWorkshopJcSummary(startDate, endDate, dealerCode)
  const serviceRowsPromise = db.execute(hasWorkshopSummary ? sql`
    SELECT
      COALESCE(NULLIF(group_type, ''), 'Others') AS service_type,
      MIN(report_date)::text AS min_date,
      MAX(report_date)::text AS max_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM am_platinum_workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY COALESCE(NULLIF(group_type, ''), 'Others')
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
    LIMIT 8
  ` : sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(r_o_no, ''), id::text) AS jc_key,
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
        ${numericText(sql.raw('part_amt'))} AS part_amt
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT
        jc_key,
        (ARRAY_AGG(report_date ORDER BY report_date DESC))[1] AS report_date,
        (ARRAY_AGG(service_type ORDER BY ABS(labour_amt + part_amt) DESC))[1] AS service_type,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM raw
      GROUP BY jc_key
    )
    SELECT
      service_type,
      MIN(report_date)::text AS min_date,
      MAX(report_date)::text AS max_date,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY service_type
    ORDER BY (COALESCE(SUM(labour_amt), 0) + COALESCE(SUM(part_amt), 0)) DESC
    LIMIT 8
  `).catch((error) => {
    console.warn('Platinum overview workshop service snapshot failed:', error)
    return [] as NumericRow[]
  })

  const vasPeriodPromise = fetchPlatinumWorkshopVasAmount(startDate, endDate, dealerCode).catch((error) => {
    console.warn('Platinum overview VAS snapshot failed:', error)
    return {
      amount: 0,
      available: false,
      unavailableReason: 'Platinum VAS source could not be read.',
      source: null,
      sourceTable: null,
      periodStart: null,
      periodEnd: null,
      sourceRows: 0,
      dedupeMode: null,
      latestSnapshotUploadedAt: null,
    }
  })

  const [serviceRows, vasPeriod] = await Promise.all([serviceRowsPromise, vasPeriodPromise])

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

  const totalJc = rows.reduce((sum, row) => sum + row.totalJc, 0)
  const labourAmount = rows.reduce((sum, row) => sum + row.labourAmount, 0)
  const partsAmount = rows.reduce((sum, row) => sum + row.partsAmount, 0)
  const sourceRows = resultRows(serviceRows)

  return {
    totalJc,
    labourAmount,
    partsAmount,
    totalRevenue: labourAmount + partsAmount,
    vasAmount: vasPeriod.amount,
    vasAvailable: vasPeriod.available,
    vasUnavailableReason: vasPeriod.unavailableReason,
    vasSource: vasPeriod.source,
    vasSourceTable: vasPeriod.sourceTable,
    vasPeriodStart: vasPeriod.periodStart,
    vasPeriodEnd: vasPeriod.periodEnd,
    vasSourceRows: vasPeriod.sourceRows,
    vasDedupeMode: vasPeriod.dedupeMode,
    vasLatestSnapshotUploadedAt: vasPeriod.latestSnapshotUploadedAt || null,
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

function emptyAddonKpisValue() {
  return {
    ewCount: 0,
    rsaCount: 0,
    mcpCount: 0,
    rsaAmount: 0,
  }
}

function emptyAddonKpis() {
  return Promise.resolve(emptyAddonKpisValue())
}

function emptyWorkshopSnapshotValue(reason = 'Workshop VAS source table is unavailable') {
  return {
    totalJc: 0,
    labourAmount: 0,
    partsAmount: 0,
    totalRevenue: 0,
    vasAmount: 0,
    vasAvailable: false,
    vasUnavailableReason: reason,
    vasSource: null as string | null,
    vasSourceTable: null as string | null,
    vasPeriodStart: null as string | null,
    vasPeriodEnd: null as string | null,
    vasSourceRows: 0,
    vasDedupeMode: null as string | null,
    vasLatestSnapshotUploadedAt: null as string | null,
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
  }
}

function emptyWorkshopSnapshot(reason?: string) {
  return Promise.resolve(emptyWorkshopSnapshotValue(reason))
}

function emptyCoverageValue(
  dealerCode: DealerFilter,
  sourceLabel: string,
  dateBasis: string,
  reason = `${sourceLabel} coverage could not be checked`
): PlatinumDealerCoverage {
  return {
    dealerCode: dealerCode || PLATINUM_ALL_LOCATIONS_CODE,
    isAllLocations: !dealerCode,
    hasDataInRange: false,
    rowCountInRange: 0,
    latestAvailableDate: null,
    dateBasis,
    sourceLabel,
    emptyReason: reason,
  }
}

type OptionalSourceWarning = {
  source: string
  message: string
}

async function safeOptional<T>(
  source: string,
  promise: Promise<T>,
  fallback: T,
  warnings: OptionalSourceWarning[]
): Promise<T> {
  try {
    return await promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push({ source, message })
    console.warn(`Platinum overview optional source failed: ${source}`, error)
    return fallback
  }
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
  const optionalWarnings: OptionalSourceWarning[] = []
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
    roBillingAudit,
    roBillingCoverage,
    openRoCoverage,
    complaintsCoverage,
  ] = await Promise.all([
    db.execute(sql`
      ${roSql}
      SELECT
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
          dealer_resolving_date,
          pending_days,
          uploaded_at
        FROM am_platinum_call_center_complaints
        WHERE COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date IS NOT NULL
          AND (
            (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date >= ${startDate}::date AND COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date < (${endDate}::date + INTERVAL '1 day'))
            OR (COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date >= ${lyStartDate}::date AND COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date < (${lyEndDate}::date + INTERVAL '1 day'))
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
    safeOptional('add-on KPIs', fetchAddonKpis(startDate, endDate, dealerCode), emptyAddonKpisValue(), optionalWarnings),
    safeOptional(
      'workshop snapshot',
      fetchWorkshopSnapshot(startDate, endDate, dealerCode),
      emptyWorkshopSnapshotValue('Workshop snapshot source is unavailable'),
      optionalWarnings
    ),
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
    includeComparison
      ? safeOptional('LY add-on KPIs', fetchAddonKpis(lyStartDate, lyEndDate, dealerCode), emptyAddonKpisValue(), optionalWarnings)
      : emptyAddonKpis(),
    includeComparison
      ? safeOptional(
        'LY workshop snapshot',
        fetchWorkshopSnapshot(lyStartDate, lyEndDate, dealerCode),
        emptyWorkshopSnapshotValue('LY workshop snapshot source is unavailable'),
        optionalWarnings
      )
      : emptyWorkshopSnapshot(),
    safeOptional(
      'RO Billing audit',
      fetchPlatinumRoBillingAudit(startDate, endDate, dealerCode),
      emptyPlatinumRoBillingAudit(startDate, endDate, dealerCode),
      optionalWarnings
    ),
    safeOptional(
      'RO Billing coverage',
      fetchPlatinumRoBillingCoverage(startDate, endDate, dealerCode),
      emptyCoverageValue(dealerCode, 'RO Billing', 'bill_date'),
      optionalWarnings
    ),
    safeOptional(
      'Open RO coverage',
      fetchPlatinumOpenRoCoverage(startDate, endDate, dealerCode),
      emptyCoverageValue(dealerCode, 'Open RO', 'r_o_date'),
      optionalWarnings
    ),
    safeOptional(
      'Complaints coverage',
      fetchPlatinumComplaintsCoverage(startDate, endDate, dealerCode),
      emptyCoverageValue(dealerCode, 'Complaints', 'COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)'),
      optionalWarnings
    ),
  ])

  const roKpis = resultRows(roKpiRows)[0] || {}
  const openKpis = resultRows(openKpiRows)[0] || {}
  const complaintKpis = resultRows(complaintKpiRows)[0] || {}
  const lyRoKpis = resultRows(lyRoKpiRows)[0] || {}
  const lyOpenKpis = resultRows(lyOpenKpiRows)[0] || {}
  const lyComplaintKpis = resultRows(lyComplaintKpiRows)[0] || {}

  const useRoAudit = roBillingAudit.sourceAvailable
  const totalJc = useRoAudit ? roBillingAudit.dedupedJc : numberValue(roKpis.total_jc)
  const revenue = useRoAudit ? roBillingAudit.revenue : numberValue(roKpis.revenue)
  const labour = useRoAudit ? roBillingAudit.labour : numberValue(roKpis.labour)
  const parts = useRoAudit ? roBillingAudit.parts : numberValue(roKpis.parts)
  const effectiveRoBillingCoverage = !roBillingCoverage.hasDataInRange && totalJc > 0
    ? {
      ...roBillingCoverage,
      hasDataInRange: true,
      rowCountInRange: totalJc,
      latestAvailableDate: dateValue(roKpis.max_bill_date),
      emptyReason: null,
    }
    : roBillingCoverage
  const hasSelectedRoBillingData = effectiveRoBillingCoverage.hasDataInRange
  const totalOpenRo = numberValue(openKpis.total_open_ro)
  const delayedRo = numberValue(openKpis.delayed)
  const openOver15 = numberValue(openKpis.over_15)
  const complaintsTotal = numberValue(complaintKpis.total)
  const complaintsOpen = numberValue(complaintKpis.open)
  const complaintsOver15 = numberValue(complaintKpis.over_15)
  const bucketOrder = ['0-4D', '5-7D', '8-15D', '>15D']
  const bucketMap = new Map(resultRows(agingRows).map((row) => [String(row.bucket), numberValue(row.count)]))
  const addOnTotal = addonKpis.ewCount + addonKpis.rsaCount + addonKpis.mcpCount
  const lyTotalJc = useRoAudit ? roBillingAudit.ly.dedupedJc : numberValue(lyRoKpis.total_jc)
  const lyRevenue = useRoAudit ? roBillingAudit.ly.revenue : numberValue(lyRoKpis.revenue)
  const lyLabour = useRoAudit ? roBillingAudit.ly.labour : numberValue(lyRoKpis.labour)
  const lyParts = useRoAudit ? roBillingAudit.ly.parts : numberValue(lyRoKpis.parts)
  const labourPerVehicle = perUnit(labour, totalJc)
  const partsPerVehicle = perUnit(parts, totalJc)
  const lyLabourPerVehicle = perUnit(lyLabour, lyTotalJc)
  const lyPartsPerVehicle = perUnit(lyParts, lyTotalJc)
  const lyOpenRo = numberValue(lyOpenKpis.total_open_ro)
  const lyDelayedRo = numberValue(lyOpenKpis.delayed)
  const lyOpenOver15 = numberValue(lyOpenKpis.over_15)
  const lyComplaintsTotal = numberValue(lyComplaintKpis.total)
  const lyComplaintsOpen = numberValue(lyComplaintKpis.open)
  const lyComplaintsOver15 = numberValue(lyComplaintKpis.over_15)
  const lyAddOnTotal = lyAddonKpis.ewCount + lyAddonKpis.rsaCount + lyAddonKpis.mcpCount
  const hasComparableWorkshopVasLy = Boolean(
    workshopSnapshot.vasAvailable
    && lyWorkshopSnapshot.vasAvailable
  )
  const workshopVasLyAmount = hasComparableWorkshopVasLy ? lyWorkshopSnapshot.vasAmount : null
  const workshopVasUnavailableReason = !workshopSnapshot.vasAvailable
    ? workshopSnapshot.vasUnavailableReason
    : !lyWorkshopSnapshot.vasAvailable
      ? lyWorkshopSnapshot.vasUnavailableReason
      : null

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
      revenue: {
        cy: revenue,
        ly: lyRevenue,
        deltaPct: roBillingDelta(revenue, lyRevenue, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyRevenue, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      labour: {
        cy: labour,
        ly: lyLabour,
        deltaPct: roBillingDelta(labour, lyLabour, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyLabour, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      parts: {
        cy: parts,
        ly: lyParts,
        deltaPct: roBillingDelta(parts, lyParts, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyParts, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      totalJc: {
        cy: totalJc,
        ly: lyTotalJc,
        deltaPct: roBillingDelta(totalJc, lyTotalJc, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyTotalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      avgBilling: {
        cy: perUnit(revenue, totalJc),
        ly: perUnit(lyRevenue, lyTotalJc),
        deltaPct: roBillingDelta(perUnit(revenue, totalJc), perUnit(lyRevenue, lyTotalJc), hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyTotalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      labourPerVehicle: {
        cy: labourPerVehicle,
        ly: lyLabourPerVehicle,
        deltaPct: roBillingDelta(labourPerVehicle, lyLabourPerVehicle, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyTotalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      partsPerVehicle: {
        cy: partsPerVehicle,
        ly: lyPartsPerVehicle,
        deltaPct: roBillingDelta(partsPerVehicle, lyPartsPerVehicle, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyTotalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      openRo: {
        cy: totalOpenRo,
        ly: null,
        deltaPct: null,
        available: false,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Open RO is current-status data; no historical as-of snapshot exists',
        rawLy: lyOpenRo,
      },
      delayedRo: {
        cy: delayedRo,
        ly: null,
        deltaPct: null,
        available: false,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Open RO is current-status data; no historical as-of snapshot exists',
        rawLy: lyDelayedRo,
      },
      openOver15: {
        cy: openOver15,
        ly: null,
        deltaPct: null,
        available: false,
        comparisonStatus: 'not_comparable',
        comparisonLabel: 'Current WIP only',
        unavailableReason: 'Open RO is current-status data; no historical as-of snapshot exists',
        rawLy: lyOpenOver15,
      },
      complaintsTotal: {
        cy: complaintsTotal,
        ly: lyComplaintsTotal,
        deltaPct: growth(complaintsTotal, lyComplaintsTotal),
        comparisonStatus: comparisonStatus(lyComplaintsTotal),
      },
      complaintsOpen: {
        cy: complaintsOpen,
        ly: lyComplaintsOpen,
        deltaPct: growth(complaintsOpen, lyComplaintsOpen),
        comparisonStatus: comparisonStatus(lyComplaintsOpen),
      },
      complaintsOver15: {
        cy: complaintsOver15,
        ly: lyComplaintsOver15,
        deltaPct: growth(complaintsOver15, lyComplaintsOver15),
        comparisonStatus: comparisonStatus(lyComplaintsOver15),
      },
      addOnTotal: {
        cy: addOnTotal,
        ly: lyAddOnTotal,
        deltaPct: growth(addOnTotal, lyAddOnTotal),
        comparisonStatus: comparisonStatus(lyAddOnTotal),
      },
      ewCount: {
        cy: addonKpis.ewCount,
        ly: lyAddonKpis.ewCount,
        deltaPct: growth(addonKpis.ewCount, lyAddonKpis.ewCount),
        comparisonStatus: comparisonStatus(lyAddonKpis.ewCount),
      },
      rsaCount: {
        cy: addonKpis.rsaCount,
        ly: lyAddonKpis.rsaCount,
        deltaPct: growth(addonKpis.rsaCount, lyAddonKpis.rsaCount),
        comparisonStatus: comparisonStatus(lyAddonKpis.rsaCount),
      },
      mcpCount: {
        cy: addonKpis.mcpCount,
        ly: lyAddonKpis.mcpCount,
        deltaPct: growth(addonKpis.mcpCount, lyAddonKpis.mcpCount),
        comparisonStatus: comparisonStatus(lyAddonKpis.mcpCount),
      },
      workshopRevenue: {
        cy: workshopSnapshot.totalRevenue,
        ly: lyWorkshopSnapshot.totalRevenue,
        deltaPct: roBillingDelta(workshopSnapshot.totalRevenue, lyWorkshopSnapshot.totalRevenue, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyWorkshopSnapshot.totalRevenue, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      workshopTotalJc: {
        cy: workshopSnapshot.totalJc,
        ly: lyWorkshopSnapshot.totalJc,
        deltaPct: roBillingDelta(workshopSnapshot.totalJc, lyWorkshopSnapshot.totalJc, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyWorkshopSnapshot.totalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      workshopLabourPerRo: {
        cy: workshopSnapshot.labourPerRo,
        ly: lyWorkshopSnapshot.labourPerRo,
        deltaPct: roBillingDelta(workshopSnapshot.labourPerRo, lyWorkshopSnapshot.labourPerRo, hasSelectedRoBillingData),
        comparisonStatus: roBillingComparisonStatus(lyWorkshopSnapshot.totalJc, hasSelectedRoBillingData),
        comparisonLabel: roBillingComparisonLabel(hasSelectedRoBillingData),
        unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
      },
      workshopVasAmount: {
        cy: workshopSnapshot.vasAmount,
        ly: workshopVasLyAmount,
        deltaPct: nullableGrowth(workshopSnapshot.vasAmount, workshopVasLyAmount),
        available: hasComparableWorkshopVasLy,
        comparisonStatus: !workshopSnapshot.vasAvailable
          ? 'source_missing'
          : hasComparableWorkshopVasLy
            ? comparisonStatus(workshopVasLyAmount || 0)
            : 'not_comparable',
        comparisonLabel: !workshopSnapshot.vasAvailable
          ? 'Source missing'
          : hasComparableWorkshopVasLy
            ? null
            : 'No comparable LY',
        unavailableReason: workshopVasUnavailableReason,
        source: workshopSnapshot.vasSource,
        sourceTable: workshopSnapshot.vasSourceTable,
        periodStart: workshopSnapshot.vasPeriodStart,
        periodEnd: workshopSnapshot.vasPeriodEnd,
        sourceRows: workshopSnapshot.vasSourceRows,
        dedupeMode: workshopSnapshot.vasDedupeMode,
        lySource: lyWorkshopSnapshot.vasSource,
        lySourceTable: lyWorkshopSnapshot.vasSourceTable,
        lyPeriodStart: lyWorkshopSnapshot.vasPeriodStart,
        lyPeriodEnd: lyWorkshopSnapshot.vasPeriodEnd,
        lySourceRows: lyWorkshopSnapshot.vasSourceRows,
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
      dealerCoverage: {
        dealerCode: effectiveRoBillingCoverage.dealerCode,
        isAllLocations: effectiveRoBillingCoverage.isAllLocations,
        primary: effectiveRoBillingCoverage,
        roBilling: effectiveRoBillingCoverage,
        openRo: openRoCoverage,
        complaints: complaintsCoverage,
        workshopPerformance: effectiveRoBillingCoverage,
      },
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
      },
      sourceStatus: {
        optionalWarnings,
        roBilling: {
          hasSelectedRangeData: hasSelectedRoBillingData,
          comparisonStatus: hasSelectedRoBillingData ? 'available' : 'not_comparable',
          unavailableReason: roBillingUnavailableReason(hasSelectedRoBillingData),
          audit: {
            rawRows: roBillingAudit.rawRows,
            activeRawRows: roBillingAudit.activeRawRows,
            dedupedJc: roBillingAudit.dedupedJc,
            duplicateRowsRemoved: roBillingAudit.duplicateRowsRemoved,
            cancelledRows: roBillingAudit.cancelledRows,
            latestUploadedAt: roBillingAudit.latestUploadedAt,
          },
        },
        vas: {
          available: Boolean(workshopSnapshot.vasAvailable),
          unavailableReason: workshopSnapshot.vasUnavailableReason,
          source: workshopSnapshot.vasSource,
          sourceTable: workshopSnapshot.vasSourceTable,
          periodStart: workshopSnapshot.vasPeriodStart,
          periodEnd: workshopSnapshot.vasPeriodEnd,
        sourceRows: workshopSnapshot.vasSourceRows,
        dedupeMode: workshopSnapshot.vasDedupeMode,
        latestSnapshotUploadedAt: workshopSnapshot.vasLatestSnapshotUploadedAt,
      },
        openRo: {
          promiseDatesAvailable: false,
          amountFieldsAvailable: false,
          comparisonStatus: 'not_comparable',
          unavailableReason: 'Open RO is current-status data; no historical as-of snapshot exists.',
        },
      },
      dateBases: {
        roBilling: 'bill_date',
        openRo: 'ro_date',
        complaints: 'COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)',
        ew: 'reg_date',
        rsa: 'invoice_date',
        mcp: 'package_purchase_date',
        vas: 'report_period_start/report_period_end from am_platinum_operation_wise_analysis_report. Falls back to latest snapshot when no rows match the selected period.',
      },
      roBillingAudit,
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('business-excellence-overview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const defaults = defaultRange()
  const startDate = parseDateInput(searchParams.get('startDate')) || defaults.startDate
  const endDate = parseDateInput(searchParams.get('endDate')) || defaults.endDate
  const chunkParam = searchParams.get('chunk')
  const chunk: OverviewChunk = chunkParam === 'secondary' || chunkParam === 'full' ? chunkParam : 'summary'
  const skipCache = searchParams.get('skipCache') === 'true'
  const comparison = getComparisonParams(searchParams)
  const dealerCode = normalizePlatinumDealerCode(searchParams.get('dealer_code')) || null

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildOverviewPayload(startDate, endDate, chunk, comparison, dealerCode)
      : getCachedData(
        cacheKey(startDate, endDate, chunk, comparison, dealerCode),
        () => buildOverviewPayload(startDate, endDate, chunk, comparison, dealerCode),
        CACHE_TTL_SECONDS
      ))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Business Excellence overview:', error)
    return NextResponse.json({ error: 'Failed to build Business Excellence overview' }, { status: 500 })
  }
}
