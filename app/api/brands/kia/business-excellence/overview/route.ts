import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

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
  return `kia:business-excellence:overview:v30:${chunk}:${createHash('sha1')
    .update(JSON.stringify({ startDate, endDate, comparison, dealerCode }))
    .digest('hex')}`
}

function activeBillStatusSql() {
  return sql`LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

function roBillingDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${dealerCode}`
    : sql``
}

function complaintsDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealerCode}`
    : sql``
}

function openRoDealerFilter(dealerCode: DealerFilter) {
  return dealerCode ? sql`
    AND EXISTS (
      SELECT 1
      FROM ro_billing_report rb
      WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = ${dealerCode}
        AND (
          (
            NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin))
          )
          OR (
            NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no))
          )
        )
    )
  ` : sql``
}

function operationDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealerCode}`
    : sql``
}

function advWiseVasDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(retail_dealer_code, '')))) = ${dealerCode}`
    : sql``
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

function ewDedupCountSql(startDate: string, endDate: string) {
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
            COALESCE(kin_amt, 0)::text
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
            COALESCE(kin_amt, 0)::text
          ), ''),
          id::text
        ) AS ew_key,
        reg_date,
        uploaded_at,
        id
      FROM ew_report
      WHERE reg_date >= ${startDate}::date
        AND reg_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
      ORDER BY
        COALESCE(
          NULLIF(TRIM(certi_no), ''),
          NULLIF(CONCAT_WS(
            '|',
            NULLIF(TRIM(vin), ''),
            NULLIF(TRIM(scheme_desc), ''),
            reg_date::text,
            COALESCE(kin_amt, 0)::text
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
      FROM rsa_report
      WHERE invoice_date::date >= ${startDate}::date
        AND invoice_date::date < (${endDate}::date + INTERVAL '1 day')
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
  if (tableExistsCache.get(tableName) === true) return true

  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  if (exists) tableExistsCache.set(tableName, true)
  else tableExistsCache.delete(tableName)
  return exists
}

async function shouldUseWorkshopJcSummary(startDate: string, endDate: string, dealerCode: DealerFilter = null) {
  if (dealerCode) return false
  if (!(await tableExists('workshop_performance_jc_summary_v1'))) return false

  const result = await db.execute(sql`
    SELECT
      MIN(report_date)::date <= ${startDate}::date
      AND MAX(report_date)::date >= ${endDate}::date AS usable
    FROM workshop_performance_jc_summary_v1
  `)

  return Boolean(resultRows(result)[0]?.usable)
}

function roBillingBaseSql(startDate: string, endDate: string, dealerCode: DealerFilter) {
  return sql`
    WITH raw AS (
      SELECT
        bill_date::date AS report_date,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
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
            THEN 'Paid Service'
          ELSE COALESCE(NULLIF(work_type, ''), 'Others')
        END AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        ${numericText(sql.raw('total_amt'))} AS total_amt
      FROM ro_billing_report
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
        ro_date,
        service_adv,
        work_type,
        service_type,
        status,
        COALESCE(revised_promise_date_time, promise_date_time) AS promise_date,
        uploaded_at
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= ${startDate}::date
        AND ro_date < (${endDate}::date + INTERVAL '1 day')
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
            THEN 'Paid Service'
          ELSE COALESCE(NULLIF(work_type, ''), 'Others')
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
  return sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
        *
      FROM kia_call_center_complaints
      WHERE complaint_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT
        complaint_no,
        complaint_date,
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
      WHERE complaint_date >= ${startDate}::date
        AND complaint_date < (${endDate}::date + INTERVAL '1 day')
        ${complaintsDealerFilter(dealerCode)}
    )
  `
}

async function fetchAddonKpis(startDate: string, endDate: string) {
  const [hasEw, hasMcp, hasRsa] = await Promise.all([
    tableExists('ew_report'),
    tableExists('mcp_report'),
    tableExists('rsa_report'),
  ])

  const [ew, mcp, rsa] = await Promise.all([
    hasEw
      ? db.execute(ewDedupCountSql(startDate, endDate))
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasMcp
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM mcp_report
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
  const serviceRows = await db.execute(hasWorkshopSummary ? sql`
    SELECT
      COALESCE(NULLIF(group_type, ''), 'Others') AS service_type,
      MIN(report_date)::text AS min_date,
      MAX(report_date)::text AS max_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY COALESCE(NULLIF(group_type, ''), 'Others')
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
    LIMIT 8
  ` : sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
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
            THEN 'Paid Service'
          ELSE COALESCE(NULLIF(work_type, ''), 'Others')
        END AS service_type,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
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

  const vasPeriod = await fetchWorkshopVasAmount(startDate, endDate, dealerCode)
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
    vasAvailable: false,
    vasUnavailableReason: 'Workshop VAS source table is unavailable',
    vasSource: null as string | null,
    vasSourceTable: null as string | null,
    vasPeriodStart: null as string | null,
    vasPeriodEnd: null as string | null,
    vasSourceRows: 0,
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
  const hasOperationWise = await tableExists('operation_wise_analysis_report')
  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')

  if (!hasOperationWise && !hasInvoiceWise) {
    return {
      amount: 0,
      available: false,
      unavailableReason: 'Workshop VAS source tables are unavailable',
      source: null as string | null,
      sourceTable: null as string | null,
      periodStart: null as string | null,
      periodEnd: null as string | null,
      sourceRows: 0,
    }
  }

  const vasFilter = sql`
    (
      description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
      OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
      OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
      OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
    )
    AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
  `

  if (hasOperationWise) {
    const result = await db.execute(sql`
      WITH operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
          date_trunc('month', report_month::date)::date AS report_month,
          report_period_start::date AS report_period_start,
          report_period_end::date AS report_period_end,
          report_type,
          op_part_code,
          op_part_desc,
          dealer_code,
          dealer_name,
          ${numericText(sql.raw('total_amt'))} AS amount,
          LOWER(COALESCE(op_part_desc, '')) AS description
        FROM operation_wise_analysis_report
        WHERE report_period_start = ${startDate}::date
          AND report_period_end = ${endDate}::date
          AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
          ${operationDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COALESCE(SUM(amount), 0)::float AS vas_amount,
        COUNT(*)::int AS source_rows,
        MIN(report_period_start)::text AS period_start,
        MAX(report_period_end)::text AS period_end
      FROM operation_rows
      WHERE ${vasFilter}
    `)

    const row = resultRows(result)[0]
    const sourceRows = numberValue(row?.source_rows)

    if (sourceRows > 0) {
      return {
        amount: numberValue(row?.vas_amount),
        available: true,
        unavailableReason: null,
        source: 'operation_period_exact',
        sourceTable: 'operation_wise_analysis_report',
        periodStart: dateValue(row?.period_start),
        periodEnd: dateValue(row?.period_end),
        sourceRows,
      }
    }

    const coveredPeriodResult = await db.execute(sql`
      WITH latest_period AS (
        SELECT
          report_period_start::date AS report_period_start,
          report_period_end::date AS report_period_end
        FROM operation_wise_analysis_report
        WHERE report_period_start = ${startDate}::date
          AND report_period_end <= ${endDate}::date
          AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
          ${operationDealerFilter(dealerCode)}
        GROUP BY report_period_start::date, report_period_end::date
        ORDER BY report_period_end::date DESC
        LIMIT 1
      ),
      operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          COALESCE(NULLIF(source.row_hash, ''), source.id::text) AS addon_key,
          date_trunc('month', source.report_month::date)::date AS report_month,
          source.report_period_start::date AS report_period_start,
          source.report_period_end::date AS report_period_end,
          source.report_type,
          source.op_part_code,
          source.op_part_desc,
          source.dealer_code,
          source.dealer_name,
          ${numericText(sql.raw('source.total_amt'))} AS amount,
          LOWER(COALESCE(source.op_part_desc, '')) AS description
        FROM operation_wise_analysis_report source
        INNER JOIN latest_period
          ON source.report_period_start::date = latest_period.report_period_start
          AND source.report_period_end::date = latest_period.report_period_end
        WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
          ${operationDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT
        COALESCE(SUM(amount), 0)::float AS vas_amount,
        COUNT(*)::int AS source_rows,
        MIN(report_period_start)::text AS period_start,
        MAX(report_period_end)::text AS period_end
      FROM operation_rows
      WHERE ${vasFilter}
    `)

    const coveredPeriodRow = resultRows(coveredPeriodResult)[0]
    const coveredPeriodSourceRows = numberValue(coveredPeriodRow?.source_rows)

    if (coveredPeriodSourceRows > 0) {
      return {
        amount: numberValue(coveredPeriodRow?.vas_amount),
        available: true,
        unavailableReason: null,
        source: 'operation_period_latest_within_range',
        sourceTable: 'operation_wise_analysis_report',
        periodStart: dateValue(coveredPeriodRow?.period_start),
        periodEnd: dateValue(coveredPeriodRow?.period_end),
        sourceRows: coveredPeriodSourceRows,
      }
    }
  }

  if (hasInvoiceWise) {
    const result = await db.execute(sql`
      WITH invoice_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(NULLIF(row_hash, ''), id::text) AS addon_key,
          gst_invoice_date::date AS report_date,
          dealer_code,
          retail_dealer_code,
          ${numericText(sql.raw('taxable_amount'))} AS amount,
          LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
        FROM adv_wise_lubricants_vas
        WHERE gst_invoice_date >= ${startDate}::date
          AND gst_invoice_date < (${endDate}::date + INTERVAL '1 day')
          ${advWiseVasDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COALESCE(SUM(amount), 0)::float AS vas_amount,
        COUNT(*)::int AS source_rows,
        MIN(report_date)::text AS period_start,
        MAX(report_date)::text AS period_end
      FROM invoice_rows
      WHERE ${vasFilter}
    `)

    const row = resultRows(result)[0]
    const sourceRows = numberValue(row?.source_rows)

    if (sourceRows > 0) {
      return {
        amount: numberValue(row?.vas_amount),
        available: true,
        unavailableReason: null,
        source: 'invoice_vas_gst_date',
        sourceTable: 'adv_wise_lubricants_vas',
        periodStart: dateValue(row?.period_start),
        periodEnd: dateValue(row?.period_end),
        sourceRows,
      }
    }
  }

  return {
    amount: 0,
    available: false,
    unavailableReason: `No matching VAS source period for ${startDate} to ${endDate}`,
    source: null as string | null,
    sourceTable: null as string | null,
    periodStart: null as string | null,
    periodEnd: null as string | null,
    sourceRows: 0,
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
          complaint_date,
          status,
          close_date,
          resolving_date,
          pending_days,
          uploaded_at
        FROM kia_call_center_complaints
        WHERE complaint_date IS NOT NULL
          AND (
            (complaint_date >= ${startDate}::date AND complaint_date < (${endDate}::date + INTERVAL '1 day'))
            OR (complaint_date >= ${lyStartDate}::date AND complaint_date < (${lyEndDate}::date + INTERVAL '1 day'))
          )
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
    fetchAddonKpis(startDate, endDate),
    fetchWorkshopSnapshot(startDate, endDate, dealerCode),
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
    includeComparison ? fetchAddonKpis(lyStartDate, lyEndDate) : emptyAddonKpis(),
    includeComparison ? fetchWorkshopSnapshot(lyStartDate, lyEndDate, dealerCode) : emptyWorkshopSnapshot(),
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
  const hasComparableWorkshopVasLy = lyWorkshopSnapshot.vasAvailable
  const workshopVasLyAmount = hasComparableWorkshopVasLy ? lyWorkshopSnapshot.vasAmount : null

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
        deltaPct: growth(revenue, lyRevenue),
      },
      labour: {
        cy: labour,
        ly: lyLabour,
        deltaPct: growth(labour, lyLabour),
      },
      parts: {
        cy: parts,
        ly: lyParts,
        deltaPct: growth(parts, lyParts),
      },
      totalJc: {
        cy: totalJc,
        ly: lyTotalJc,
        deltaPct: growth(totalJc, lyTotalJc),
      },
      avgBilling: {
        cy: perUnit(revenue, totalJc),
        ly: perUnit(lyRevenue, lyTotalJc),
        deltaPct: growth(perUnit(revenue, totalJc), perUnit(lyRevenue, lyTotalJc)),
      },
      openRo: {
        cy: totalOpenRo,
        ly: lyOpenRo,
        deltaPct: growth(totalOpenRo, lyOpenRo),
      },
      delayedRo: {
        cy: delayedRo,
        ly: lyDelayedRo,
        deltaPct: growth(delayedRo, lyDelayedRo),
      },
      openOver15: {
        cy: openOver15,
        ly: lyOpenOver15,
        deltaPct: growth(openOver15, lyOpenOver15),
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
        deltaPct: growth(workshopSnapshot.totalRevenue, lyWorkshopSnapshot.totalRevenue),
      },
      workshopTotalJc: {
        cy: workshopSnapshot.totalJc,
        ly: lyWorkshopSnapshot.totalJc,
        deltaPct: growth(workshopSnapshot.totalJc, lyWorkshopSnapshot.totalJc),
      },
      workshopLabourPerRo: {
        cy: workshopSnapshot.labourPerRo,
        ly: lyWorkshopSnapshot.labourPerRo,
        deltaPct: growth(workshopSnapshot.labourPerRo, lyWorkshopSnapshot.labourPerRo),
      },
      workshopVasAmount: {
        cy: workshopSnapshot.vasAmount,
        ly: workshopVasLyAmount,
        deltaPct: nullableGrowth(
          workshopSnapshot.vasAmount,
          workshopVasLyAmount
        ),
        available: hasComparableWorkshopVasLy,
        unavailableReason: !workshopSnapshot.vasAvailable
          ? workshopSnapshot.vasUnavailableReason
          : !hasComparableWorkshopVasLy
            ? lyWorkshopSnapshot.vasUnavailableReason || 'No comparable LY period'
            : null,
        source: workshopSnapshot.vasSource,
        sourceTable: workshopSnapshot.vasSourceTable,
        periodStart: workshopSnapshot.vasPeriodStart,
        periodEnd: workshopSnapshot.vasPeriodEnd,
        sourceRows: workshopSnapshot.vasSourceRows,
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
      dateBases: {
        roBilling: 'bill_date',
        openRo: 'ro_date',
        complaints: 'complaint_date',
        ew: 'reg_date',
        rsa: 'invoice_date',
        mcp: 'package_purchase_date',
        vas: 'operation_wise_analysis_report.report_period_start/report_period_end, fallback adv_wise_lubricants_vas.gst_invoice_date',
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('business-excellence-overview')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const defaults = defaultRange()
  const startDate = parseDateInput(searchParams.get('startDate')) || defaults.startDate
  const endDate = parseDateInput(searchParams.get('endDate')) || defaults.endDate
  const chunkParam = searchParams.get('chunk')
  const chunk: OverviewChunk = chunkParam === 'secondary' || chunkParam === 'full' ? chunkParam : 'summary'
  const skipCache = searchParams.get('skipCache') === 'true'
  const comparison = getComparisonParams(searchParams)
  const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code')) || null

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
