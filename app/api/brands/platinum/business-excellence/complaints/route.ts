import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type ComplaintFilters = {
  startDate: string | null
  endDate: string | null
  status: string | null
  dealer: string | null
  area: string | null
  model: string | null
  source: string | null
  periodPreset: string | null
  comparisonMode: string | null
  comparisonStartDate: string | null
  comparisonEndDate: string | null
  dealerCode: string | null
}

type ComplaintChunk = 'summary' | 'secondary' | 'details' | 'full'

type NumericRow = Record<string, unknown>
type ComparisonScopeDates = {
  currentStartDate: string
  currentEndDate: string
  previousStartDate: string
  previousEndDate: string
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

function getFilterValue(value: string | null) {
  if (!value || value === '__all') return null
  return value
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return String(value).slice(0, 10) || null
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function complaintAttributeFilters(filters: ComplaintFilters) {
  return sql`
    AND (${filters.status}::text IS NULL OR status_group = ${filters.status})
    AND (${filters.dealer}::text IS NULL OR dealer_name = ${filters.dealer})
    AND (${filters.dealerCode}::text IS NULL OR UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${filters.dealerCode})
    AND (${filters.area}::text IS NULL OR COALESCE(NULLIF(sr_area, ''), 'Unspecified') = ${filters.area})
    AND (${filters.model}::text IS NULL OR COALESCE(NULLIF(vehicle_model, ''), 'Unspecified') = ${filters.model})
    AND (${filters.source}::text IS NULL OR COALESCE(NULLIF(complaint_sub_source, ''), 'Unspecified') = ${filters.source})
  `
}

function complaintBaseSql(filters: ComplaintFilters, comparisonScope?: ComparisonScopeDates) {
  return sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text))
        *
      FROM am_platinum_call_center_complaints
      WHERE complaint_date IS NOT NULL
      ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    enriched AS (
      SELECT
        id,
        status,
        complaint_no,
        sr_no,
        type,
        cust_name,
        mobile_no,
        vin_no,
        dealer_name,
        dealer_code,
        source_dealer_code,
        region,
        complaint_date,
        resolving_date,
        resolved_by_dealer,
        close_date,
        complaint_closing_time,
        closed_by,
        complaint_sub_source,
        complaint_remarks,
        service_engineer_advisor_observation,
        complaint_type,
        sr_area,
        sr_sub_area,
        sr_type,
        vehicle_model,
        varient,
        dealer_sr_area,
        dealer_sr_sub_area,
        delaer_sr_type,
        pending_reason,
        uploaded_at,
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
          WHEN COALESCE(close_date, resolving_date) IS NULL THEN GREATEST((CURRENT_DATE - complaint_date)::int, 0)
          ELSE 0
        END AS open_days,
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
    ),
    filtered AS (
      SELECT *
      FROM enriched
      WHERE (${filters.startDate}::date IS NULL OR complaint_date >= ${filters.startDate}::date)
        AND (${filters.endDate}::date IS NULL OR complaint_date < (${filters.endDate}::date + INTERVAL '1 day'))
        ${complaintAttributeFilters(filters)}
    )
    ${comparisonScope ? sql`,
    comparison_filtered AS (
      SELECT *
      FROM enriched
      WHERE (
          (
            complaint_date >= ${comparisonScope.currentStartDate}::date
            AND complaint_date < (${comparisonScope.currentEndDate}::date + INTERVAL '1 day')
          )
          OR (
            complaint_date >= ${comparisonScope.previousStartDate}::date
            AND complaint_date < (${comparisonScope.previousEndDate}::date + INTERVAL '1 day')
          )
        )
        ${complaintAttributeFilters(filters)}
    ),
    analysis_scope AS (
      SELECT *
      FROM filtered
      UNION ALL
      SELECT *
      FROM comparison_filtered
      WHERE NOT EXISTS (SELECT 1 FROM filtered)
    )
    ` : sql`,
    analysis_scope AS (
      SELECT *
      FROM filtered
    )
    `}
  `
}

function cacheKey(filters: ComplaintFilters, chunk: ComplaintChunk) {
  return `platinum:business-excellence:complaints:v9:${chunk}:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
}

function currentYearFromFilters(filters: ComplaintFilters) {
  const source = filters.endDate || filters.startDate
  if (source && /^\d{4}-\d{2}-\d{2}$/.test(source)) {
    return Number(source.slice(0, 4))
  }
  return new Date().getFullYear()
}

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function buildComplaintsPayload(filters: ComplaintFilters, chunk: ComplaintChunk = 'summary') {
  const includeSummary = chunk === 'summary' || chunk === 'full'
  const includeSecondary = chunk === 'secondary' || chunk === 'full'
  const includeDetails = chunk === 'details' || chunk === 'full'
  const trendYear = currentYearFromFilters(filters)
  const today = new Date()
  const comparisonEndDate = trendYear === today.getFullYear()
    ? inputDate(today)
    : `${trendYear}-12-31`
  const previousComparisonEndDate = `${trendYear - 1}-${comparisonEndDate.slice(5)}`
  const customComparisonActive = Boolean(filters.comparisonStartDate && filters.comparisonEndDate)
  const currentComparisonStartDate = customComparisonActive
    ? (filters.startDate || `${trendYear}-01-01`)
    : `${trendYear}-01-01`
  const currentComparisonEndDate = customComparisonActive
    ? (filters.endDate || comparisonEndDate)
    : comparisonEndDate
  const previousComparisonStartDate = customComparisonActive
    ? filters.comparisonStartDate!
    : `${trendYear - 1}-01-01`
  const previousComparisonRangeEndDate = customComparisonActive
    ? filters.comparisonEndDate!
    : previousComparisonEndDate
  const comparisonScope = {
    currentStartDate: currentComparisonStartDate,
    currentEndDate: currentComparisonEndDate,
    previousStartDate: previousComparisonStartDate,
    previousEndDate: previousComparisonRangeEndDate,
  }
  const baseSql = complaintBaseSql(filters, comparisonScope)

  const [
    kpiRows,
    trendRows,
    ytdRows,
    yearlyRows,
    areaRows,
    subAreaRows,
    dealerRows,
    modelRows,
    sourceRows,
    detailRows,
    optionRows,
    metadataRows,
  ] = await Promise.all([
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
        COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
        COUNT(*) FILTER (WHERE signal_area IN ('Delay / Delivery', 'Parts Delay'))::int AS delay_related,
        COALESCE(AVG(resolution_days), 0)::float AS avg_resolution_days,
        COALESCE(MAX(resolution_days), 0)::int AS max_resolution_days
      FROM filtered
    `) : Promise.resolve([]),
    includeSecondary ? db.execute(sql`
      WITH months AS (
        SELECT generate_series(1, 12) AS month_no
      ),
      latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text)) *
        FROM am_platinum_call_center_complaints
        WHERE complaint_date IS NOT NULL
        ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      enriched AS (
        SELECT
          complaint_date,
          status,
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
            WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
            WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
            WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
            ELSE 'Open'
          END AS status_group
        FROM latest
      ),
      monthly AS (
        SELECT
          EXTRACT(YEAR FROM complaint_date)::int AS year_no,
          EXTRACT(MONTH FROM complaint_date)::int AS month_no,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open_count,
          COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed_count,
          COALESCE(AVG(resolution_days), 0)::float AS avg_days
        FROM enriched
        WHERE complaint_date >= make_date(${trendYear - 1}, 1, 1)
          AND complaint_date < make_date(${trendYear + 1}, 1, 1)
        GROUP BY 1, 2
      )
      SELECT
        months.month_no,
        to_char(make_date(${trendYear}, months.month_no::int, 1), 'Mon') AS month,
        COALESCE(cy.count, 0)::int AS cy_count,
        COALESCE(ly.count, 0)::int AS ly_count,
        COALESCE(cy.open_count, 0)::int AS cy_open,
        COALESCE(ly.open_count, 0)::int AS ly_open,
        COALESCE(cy.closed_count, 0)::int AS cy_closed,
        COALESCE(ly.closed_count, 0)::int AS ly_closed,
        COALESCE(cy.avg_days, 0)::float AS cy_avg_days,
        COALESCE(ly.avg_days, 0)::float AS ly_avg_days
      FROM months
      LEFT JOIN monthly cy ON cy.year_no = ${trendYear} AND cy.month_no = months.month_no
      LEFT JOIN monthly ly ON ly.year_no = ${trendYear - 1} AND ly.month_no = months.month_no
      ORDER BY months.month_no
    `) : Promise.resolve([]),
    includeSecondary ? db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text)) *
        FROM am_platinum_call_center_complaints
        WHERE complaint_date IS NOT NULL
        ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      enriched AS (
        SELECT
          complaint_date,
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
            WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
            WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
            WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
            ELSE 'Open'
          END AS status_group
        FROM latest
      )
      SELECT
        COUNT(*) FILTER (WHERE complaint_date >= ${currentComparisonStartDate}::date AND complaint_date <= ${currentComparisonEndDate}::date)::int AS cy_count,
        COUNT(*) FILTER (WHERE complaint_date >= ${previousComparisonStartDate}::date AND complaint_date <= ${previousComparisonRangeEndDate}::date)::int AS ly_count,
        COUNT(*) FILTER (WHERE complaint_date >= ${currentComparisonStartDate}::date AND complaint_date <= ${currentComparisonEndDate}::date AND status_group <> 'Closed')::int AS cy_open,
        COUNT(*) FILTER (WHERE complaint_date >= ${previousComparisonStartDate}::date AND complaint_date <= ${previousComparisonRangeEndDate}::date AND status_group <> 'Closed')::int AS ly_open,
        COALESCE(AVG(resolution_days) FILTER (WHERE complaint_date >= ${currentComparisonStartDate}::date AND complaint_date <= ${currentComparisonEndDate}::date), 0)::float AS cy_avg_days,
        COALESCE(AVG(resolution_days) FILTER (WHERE complaint_date >= ${previousComparisonStartDate}::date AND complaint_date <= ${previousComparisonRangeEndDate}::date), 0)::float AS ly_avg_days
      FROM enriched
    `) : Promise.resolve([]),
    includeSecondary ? db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text)) *
        FROM am_platinum_call_center_complaints
        WHERE complaint_date IS NOT NULL
        ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      enriched AS (
        SELECT
          complaint_date,
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
            WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
            WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
            WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
            ELSE 'Open'
          END AS status_group
        FROM latest
      )
      SELECT
        EXTRACT(YEAR FROM complaint_date)::int AS year,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group = 'Closed')::int AS closed,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM enriched
      GROUP BY 1
      ORDER BY year DESC
      LIMIT 5
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM analysis_scope
      GROUP BY 1
      ORDER BY total DESC, avg_days DESC
      LIMIT 8
    `) : Promise.resolve([]),
    includeSecondary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(sr_sub_area, ''), 'Unspecified') AS name,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM analysis_scope
      GROUP BY 1
      ORDER BY total DESC, avg_days DESC
      LIMIT 10
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(source_dealer_code, ''), 'Unspecified') AS dealer,
        COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), '-') AS dealer_code,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_group <> 'Closed')::int AS open,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days,
        COUNT(*) FILTER (WHERE resolution_days > 15)::int AS over_15
      FROM analysis_scope
      GROUP BY 1, 2
      ORDER BY total DESC, open DESC, avg_days DESC
      LIMIT 8
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(vehicle_model, ''), 'Unspecified') AS model,
        COUNT(*)::int AS total,
        COALESCE(AVG(resolution_days), 0)::float AS avg_days
      FROM analysis_scope
      GROUP BY 1
      ORDER BY total DESC, avg_days DESC
      LIMIT 8
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(complaint_sub_source, ''), 'Unspecified') AS source,
        COUNT(*)::int AS total
      FROM analysis_scope
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    `) : Promise.resolve([]),
    includeDetails ? db.execute(sql`
      ${baseSql}
      SELECT
        id,
        complaint_no,
        sr_no,
        status_group,
        status,
        type,
        cust_name,
        mobile_no,
        vin_no,
        dealer_name,
        COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), '-') AS dealer_code,
        region,
        complaint_date,
        resolving_date,
        close_date,
        resolved_by_dealer,
        closed_by,
        complaint_sub_source,
        complaint_remarks,
        service_engineer_advisor_observation,
        complaint_type,
        sr_area,
        sr_sub_area,
        sr_type,
        vehicle_model,
        varient,
        dealer_sr_area,
        dealer_sr_sub_area,
        delaer_sr_type,
        pending_reason,
        resolution_days,
        open_days,
        signal_area,
        uploaded_at
      FROM filtered
      ORDER BY
        CASE WHEN status_group <> 'Closed' THEN 0 ELSE 1 END,
        resolution_days DESC,
        complaint_date DESC
      LIMIT 150
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(complaint_no, ''), id::text)) *
        FROM am_platinum_call_center_complaints
        WHERE complaint_date IS NOT NULL
        ORDER BY COALESCE(NULLIF(complaint_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT jsonb_build_object(
        'statuses', COALESCE((SELECT jsonb_agg(status_group ORDER BY status_group) FROM (
          SELECT DISTINCT CASE
            WHEN LOWER(COALESCE(status, '')) IN ('close', 'closed', 'resolved') THEN 'Closed'
            WHEN LOWER(COALESCE(status, '')) LIKE '%hold%' THEN 'Hold'
            WHEN LOWER(COALESCE(status, '')) LIKE '%pending%' THEN 'Pending'
            ELSE 'Open'
          END AS status_group FROM latest
        ) options), '[]'::jsonb),
        'dealers', COALESCE((SELECT jsonb_agg(dealer ORDER BY dealer) FROM (
          SELECT DISTINCT COALESCE(NULLIF(dealer_name, ''), 'Unspecified') AS dealer FROM latest
        ) options), '[]'::jsonb),
        'areas', COALESCE((SELECT jsonb_agg(area ORDER BY area) FROM (
          SELECT DISTINCT COALESCE(NULLIF(sr_area, ''), 'Unspecified') AS area FROM latest
        ) options), '[]'::jsonb),
        'models', COALESCE((SELECT jsonb_agg(model ORDER BY model) FROM (
          SELECT DISTINCT COALESCE(NULLIF(vehicle_model, ''), 'Unspecified') AS model FROM latest
        ) options), '[]'::jsonb),
        'sources', COALESCE((SELECT jsonb_agg(source ORDER BY source) FROM (
          SELECT DISTINCT COALESCE(NULLIF(complaint_sub_source, ''), 'Unspecified') AS source FROM latest
        ) options), '[]'::jsonb)
      ) AS options
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      SELECT
        COUNT(*)::int AS total_rows,
        MIN(complaint_date) AS min_date,
        MAX(complaint_date) AS max_date,
        MAX(uploaded_at) AS uploaded_at
      FROM am_platinum_call_center_complaints
    `) : Promise.resolve([]),
  ])

  const kpis = resultRows(kpiRows)[0] || {}
  const metadata = resultRows(metadataRows)[0] || {}
  const ytd = resultRows(ytdRows)[0] || {}
  const options = (resultRows(optionRows)[0]?.options || {}) as Record<string, string[]>

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    dateRange: { startDate: filters.startDate, endDate: filters.endDate },
    trendYear,
    metadata: {
      totalRows: numberValue(metadata.total_rows),
      minDate: dateValue(metadata.min_date),
      maxDate: dateValue(metadata.max_date),
      uploadedAt: metadata.uploaded_at ? String(metadata.uploaded_at) : null,
    },
    kpis: {
      total: numberValue(kpis.total),
      open: numberValue(kpis.open),
      closed: numberValue(kpis.closed),
      over15: numberValue(kpis.over_15),
      delayRelated: numberValue(kpis.delay_related),
      avgResolutionDays: numberValue(kpis.avg_resolution_days),
      maxResolutionDays: numberValue(kpis.max_resolution_days),
    },
    comparison: {
      selectedYear: trendYear,
      previousYear: trendYear - 1,
      currentPeriod: {
        startDate: currentComparisonStartDate,
        endDate: currentComparisonEndDate,
        count: numberValue(ytd.cy_count),
        open: numberValue(ytd.cy_open),
        avgDays: numberValue(ytd.cy_avg_days),
      },
      previousPeriod: {
        startDate: previousComparisonStartDate,
        endDate: previousComparisonRangeEndDate,
        count: numberValue(ytd.ly_count),
        open: numberValue(ytd.ly_open),
        avgDays: numberValue(ytd.ly_avg_days),
      },
      yearly: resultRows(yearlyRows).map((row) => ({
        year: numberValue(row.year),
        total: numberValue(row.total),
        closed: numberValue(row.closed),
        open: numberValue(row.open),
        over15: numberValue(row.over_15),
        avgDays: numberValue(row.avg_days),
      })),
    },
    charts: {
      monthlyTrend: resultRows(trendRows).map((row) => {
        const cyCount = numberValue(row.cy_count)
        const lyCount = numberValue(row.ly_count)
        return {
          month: stringValue(row.month, ''),
          cyCount,
          lyCount,
          cyOpen: numberValue(row.cy_open),
          lyOpen: numberValue(row.ly_open),
          cyClosed: numberValue(row.cy_closed),
          lyClosed: numberValue(row.ly_closed),
          cyAvgDays: numberValue(row.cy_avg_days),
          lyAvgDays: numberValue(row.ly_avg_days),
          growthPct: lyCount > 0 ? ((cyCount - lyCount) / lyCount) * 100 : cyCount > 0 ? 100 : 0,
        }
      }),
      areaBreakdown: resultRows(areaRows).map((row) => ({
        name: stringValue(row.name),
        total: numberValue(row.total),
        open: numberValue(row.open),
        avgDays: numberValue(row.avg_days),
      })),
      subAreaBreakdown: resultRows(subAreaRows).map((row) => ({
        name: stringValue(row.name),
        total: numberValue(row.total),
        open: numberValue(row.open),
        avgDays: numberValue(row.avg_days),
      })),
      dealerPerformance: resultRows(dealerRows).map((row) => ({
        dealer: stringValue(row.dealer),
        dealerCode: stringValue(row.dealer_code, '-'),
        total: numberValue(row.total),
        open: numberValue(row.open),
        avgDays: numberValue(row.avg_days),
        over15: numberValue(row.over_15),
      })),
      modelBreakdown: resultRows(modelRows).map((row) => ({
        model: stringValue(row.model),
        total: numberValue(row.total),
        avgDays: numberValue(row.avg_days),
      })),
      sourceBreakdown: resultRows(sourceRows).map((row) => ({
        source: stringValue(row.source),
        total: numberValue(row.total),
      })),
    },
    rows: resultRows(detailRows).map((row) => ({
      id: numberValue(row.id),
      complaintNo: stringValue(row.complaint_no, '-'),
      srNo: stringValue(row.sr_no, '-'),
      status: stringValue(row.status, '-'),
      statusGroup: stringValue(row.status_group, 'Open'),
      type: stringValue(row.type, '-'),
      customerName: stringValue(row.cust_name, '-'),
      mobileNo: stringValue(row.mobile_no, '-'),
      vinNo: stringValue(row.vin_no, '-'),
      dealerName: stringValue(row.dealer_name, '-'),
      dealerCode: stringValue(row.dealer_code, '-'),
      region: stringValue(row.region, '-'),
      complaintDate: dateValue(row.complaint_date),
      resolvingDate: dateValue(row.resolving_date),
      closeDate: dateValue(row.close_date),
      resolvedByDealer: stringValue(row.resolved_by_dealer, '-'),
      closedBy: stringValue(row.closed_by, '-'),
      source: stringValue(row.complaint_sub_source, '-'),
      customerRemark: stringValue(row.complaint_remarks, ''),
      remarks: stringValue(row.complaint_remarks, ''),
      observation: stringValue(row.service_engineer_advisor_observation, ''),
      complaintType: stringValue(row.complaint_type, '-'),
      srArea: stringValue(row.sr_area, '-'),
      srSubArea: stringValue(row.sr_sub_area, '-'),
      srType: stringValue(row.sr_type, '-'),
      vehicleModel: stringValue(row.vehicle_model, '-'),
      variant: stringValue(row.varient, '-'),
      dealerArea: stringValue(row.dealer_sr_area, '-'),
      dealerSubArea: stringValue(row.dealer_sr_sub_area, '-'),
      dealerType: stringValue(row.delaer_sr_type, '-'),
      pendingReason: stringValue(row.pending_reason, ''),
      resolutionDays: numberValue(row.resolution_days),
      openDays: numberValue(row.open_days),
      signalArea: stringValue(row.signal_area, 'General Service'),
    })),
    filterOptions: {
      statuses: options.statuses || [],
      dealers: options.dealers || [],
      areas: options.areas || [],
      models: options.models || [],
      sources: options.sources || [],
    },
    meta: {
      rowCount: numberValue(kpis.total),
      detailLimit: 150,
      chunk,
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      dateBasis: 'Complaint Date',
      comparison: {
        preset: filters.periodPreset,
        comparisonMode: filters.comparisonMode || 'none',
        comparisonStartDate: filters.comparisonStartDate,
        comparisonEndDate: filters.comparisonEndDate,
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('Platinum-complaints')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
  if (accessError) return accessError

  try {
    const { searchParams } = new URL(request.url)
    const comparisonStartDate = parseDateInput(searchParams.get('compareStartDate')) || parseDateInput(searchParams.get('comparisonStartDate'))
    const comparisonEndDate = parseDateInput(searchParams.get('compareEndDate')) || parseDateInput(searchParams.get('comparisonEndDate'))
    const filters: ComplaintFilters = {
      startDate: parseDateInput(searchParams.get('startDate')),
      endDate: parseDateInput(searchParams.get('endDate')),
      status: getFilterValue(searchParams.get('status')),
      dealer: getFilterValue(searchParams.get('dealer')),
      area: getFilterValue(searchParams.get('area')),
      model: getFilterValue(searchParams.get('model')),
      source: getFilterValue(searchParams.get('source')),
    periodPreset: searchParams.get('periodPreset') || null,
    comparisonMode: searchParams.get('comparisonMode') || 'none',
    comparisonStartDate,
    comparisonEndDate,
    dealerCode: normalizePlatinumDealerCode(searchParams.get('dealer_code')) || null,
  }
    const skipCache = searchParams.get('skipCache') === 'true'
    const requestedChunk = searchParams.get('chunk')
    const chunk: ComplaintChunk = requestedChunk === 'secondary' || requestedChunk === 'details' || requestedChunk === 'full'
      ? requestedChunk
      : 'summary'

    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildComplaintsPayload(filters, chunk)
      : getCachedData(cacheKey(filters, chunk), () => buildComplaintsPayload(filters, chunk), CACHE_TTL_SECONDS))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Platinum complaints dashboard:', error)
    return NextResponse.json({ error: 'Failed to build Platinum complaints dashboard' }, { status: 500 })
  }
}
