import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const tableExistsCache = new Map<string, boolean>()

type NumericRow = Record<string, unknown>

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

function cacheKey(startDate: string, endDate: string) {
  return `kia:business-excellence:overview:v3:${createHash('sha1').update(`${startDate}:${endDate}`).digest('hex')}`
}

function sameDateLastYear(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return toDateInputValue(new Date(year - 1, month - 1, day))
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) return tableExistsCache.get(tableName)!

  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  tableExistsCache.set(tableName, exists)
  return exists
}

function roBillingBaseSql(startDate: string, endDate: string) {
  return sql`
    WITH base AS (
      SELECT
        bill_date::date AS report_date,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        CASE
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
            OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%'
            THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%'
            THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%'
            THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
            OR COALESCE(service_type, '') ~* '^[0-9]+K$'
            THEN 'Paid Service'
          ELSE 'Others'
        END AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        ${numericText(sql.raw('total_amt'))} AS total_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
    ),
    enriched AS (
      SELECT
        *,
        labour_amt + part_amt AS revenue
      FROM base
    )
  `
}

function openRoBaseSql(startDate: string, endDate: string) {
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
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%accident%'
            OR LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%bodyshop%'
            THEN 'Accidental Repair'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%running%'
            THEN 'Running Repair'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%free%'
            THEN 'Free Service'
          WHEN LOWER(COALESCE(work_type, '') || ' ' || COALESCE(service_type, '')) LIKE '%paid%'
            OR COALESCE(service_type, '') ~* '^[0-9]+K$'
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

function complaintsBaseSql(startDate: string, endDate: string) {
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
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM ew_report
          WHERE reg_date >= ${startDate}::date
            AND reg_date < (${endDate}::date + INTERVAL '1 day')
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasMcp
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM mcp_report
          WHERE package_purchase_date >= ${startDate}::date
            AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasRsa
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count, COALESCE(SUM(${numericText(sql.raw('total_amount'))}), 0)::float AS amount
          FROM rsa_report
          WHERE invoice_date >= ${startDate}::date
            AND invoice_date < (${endDate}::date + INTERVAL '1 day')
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

async function buildOverviewPayload(startDate: string, endDate: string) {
  const roSql = roBillingBaseSql(startDate, endDate)
  const openSql = openRoBaseSql(startDate, endDate)
  const complaintSql = complaintsBaseSql(startDate, endDate)
  const lyStartDate = sameDateLastYear(startDate)
  const lyEndDate = sameDateLastYear(endDate)

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
    db.execute(sql`
      ${roSql}
      SELECT
        report_date::text AS date,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY report_date
      ORDER BY report_date ASC
      LIMIT 45
    `),
    db.execute(sql`
      ${roSql}
      SELECT
        service_category,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY service_category
      ORDER BY total_jc DESC, revenue DESC
      LIMIT 6
    `),
    db.execute(sql`
      ${roSql}
      SELECT
        advisor,
        COUNT(DISTINCT jc_key)::int AS total_jc,
        COALESCE(SUM(revenue), 0)::float AS revenue
      FROM enriched
      GROUP BY advisor
      ORDER BY revenue DESC, total_jc DESC
      LIMIT 8
    `),
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
    db.execute(sql`
      ${openSql}
      SELECT aging_bucket AS bucket, COUNT(*)::int AS count
      FROM enriched
      GROUP BY aging_bucket
    `),
    db.execute(sql`
      ${openSql}
      SELECT
        COALESCE(NULLIF(service_adv, ''), 'Unspecified') AS advisor,
        COUNT(*)::int AS open_ro,
        COALESCE(AVG(aging_days), 0)::float AS avg_aging
      FROM enriched
      GROUP BY 1
      ORDER BY open_ro DESC, avg_aging DESC
      LIMIT 8
    `),
    db.execute(sql`
      ${openSql}
      SELECT service_category, COUNT(*)::int AS count
      FROM enriched
      GROUP BY service_category
      ORDER BY count DESC
    `),
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
    db.execute(sql`
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
    `),
    db.execute(sql`
      ${complaintSql}
      SELECT status_group AS status, COUNT(*)::int AS count
      FROM enriched
      GROUP BY status_group
      ORDER BY count DESC
    `),
    db.execute(sql`
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
    `),
    fetchAddonKpis(startDate, endDate),
  ])

  const roKpis = resultRows(roKpiRows)[0] || {}
  const openKpis = resultRows(openKpiRows)[0] || {}
  const complaintKpis = resultRows(complaintKpiRows)[0] || {}

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
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      periodScope: {
        startDate,
        endDate,
        lyStartDate,
        lyEndDate,
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
      },
      dateBases: {
        roBilling: 'bill_date',
        openRo: 'ro_date',
        complaints: 'complaint_date',
        ew: 'reg_date',
        rsa: 'invoice_date',
        mcp: 'package_purchase_date',
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
  const skipCache = searchParams.get('skipCache') === 'true'

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildOverviewPayload(startDate, endDate)
      : getCachedData(cacheKey(startDate, endDate), () => buildOverviewPayload(startDate, endDate), CACHE_TTL_SECONDS))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Business Excellence overview:', error)
    return NextResponse.json({ error: 'Failed to build Business Excellence overview' }, { status: 500 })
  }
}
