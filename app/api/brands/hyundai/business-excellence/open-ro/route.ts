import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { hyundaiSourceDealerFilter, normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import { HYUNDAI_BE_CALCULATION_META } from '@/lib/hyundai/business-excellence-calculations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type NumericRow = Record<string, unknown>

type OpenRoFilters = {
  advisor: string | null
  workType: string | null
  agingBucket: string | null
  insurance: string | null
  startDate: string | null
  endDate: string | null
  periodPreset: string | null
  comparisonMode: string | null
  comparisonStartDate: string | null
  comparisonEndDate: string | null
  dealerCode: string | null
}

type OpenRoChunk = 'summary' | 'details' | 'full'

function openRoDealerFilter(filters: OpenRoFilters) {
  return hyundaiSourceDealerFilter(
    filters.dealerCode,
    sql.raw('hyundai_repair_order_list.source_dealer_code'),
    [
      sql.raw('hyundai_repair_order_list.dealer_code'),
      sql.raw('hyundai_repair_order_list.dlr_no')
    ]
  )
}

function openRoBaseSql(filters: OpenRoFilters) {
  return sql`
    WITH active AS (
      SELECT DISTINCT ON (
        COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dlr_no, ''), '-') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text)
      )
        id,
        COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dlr_no, ''), '-') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text) AS ro_key,
        r_o_no,
        r_o_date::date AS ro_date,
        reg_no,
        vin,
        model,
        work_type,
        work_type AS service_type,
        '-' AS customer_name,
        svc_adv AS service_adv,
        tech_name AS main_technician,
        r_o_status AS status,
        r_o_status AS new_r_o_status,
        ro_source AS ro_sub_status,
        NULL::date AS promise_date,
        NULL::date AS promise_date_time,
        NULL::date AS revised_promise_date_time,
        NULL::text AS mileage,
        '-' AS insurance_company_name,
        0::numeric AS estimate_amt,
        0::numeric AS labour_amt,
        0::numeric AS part_amt,
        0::numeric AS total,
        NULL::text AS delay_reason,
        NULL::text AS ro_remaks,
        NULL::text AS revisit_vehicle,
        0::int AS re_open_count,
        special_message AS task_description,
        uploaded_at
      FROM hyundai_repair_order_list
      WHERE cancel_date IS NULL
        AND LOWER(COALESCE(NULLIF(TRIM(r_o_status::text), ''), NULLIF(TRIM(status::text), ''), NULLIF(TRIM(new_r_o_status::text), ''), '')) = 'open'
        AND (${filters.startDate}::date IS NULL OR r_o_date >= ${filters.startDate}::date)
        AND (${filters.endDate}::date IS NULL OR r_o_date < (${filters.endDate}::date + INTERVAL '1 day'))
        ${openRoDealerFilter(filters)}
      ORDER BY
        COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dlr_no, ''), '-') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text),
        uploaded_at DESC NULLS LAST,
        id DESC
    ),
    enriched AS (
      SELECT
        *,
        CASE
          WHEN ro_date IS NULL THEN 0
          ELSE GREATEST((COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int, 0)
        END AS aging_days,
        CASE
          WHEN ro_date IS NULL THEN '0-4D'
          WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 4 THEN '0-4D'
          WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 7 THEN '5-7D'
          WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 15 THEN '8-15D'
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
          WHEN COALESCE(revised_promise_date_time, promise_date_time) IS NOT NULL
            AND CURRENT_DATE > COALESCE(revised_promise_date_time, promise_date_time)
            THEN 'Delayed'
          ELSE 'On Track'
        END AS delay_status
      FROM active
    ),
    filtered AS (
      SELECT *
      FROM enriched
      WHERE (${filters.advisor}::text IS NULL OR service_adv = ${filters.advisor})
        AND (${filters.workType}::text IS NULL OR service_category = ${filters.workType})
        AND (${filters.agingBucket}::text IS NULL OR aging_bucket = ${filters.agingBucket})
        AND (${filters.insurance}::text IS NULL OR insurance_company_name = ${filters.insurance})
    )
  `
}

type OpenRoDetailRow = {
  roNo: string
  roDate: string | null
  regNo: string
  customerName: string
  advisor: string
  technician: string
  model: string
  workType: string
  serviceType: string
  serviceCategory: string
  agingDays: number
  agingBucket: string
  currentStatus: string
  newStatus: string
  subStatus: string
  promiseDate: string | null
  delayStatus: 'Delayed' | 'On Track'
  insuranceCompany: string
  estimateAmount: number
  labourAmount: number
  partAmount: number
  totalAmount: number
  delayReason: string
  remarks: string
  alerts: Array<{ label: string; severity: 'high' | 'medium' | 'low' }>
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringValue(value: unknown, fallback = 'Unassigned') {
  const text = String(value || '').trim()
  return text || fallback
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const text = String(value)
  return text ? text.slice(0, 10) : null
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function getFilterValue(value: string | null) {
  if (!value || value === '__all') return null
  return value
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  return null
}

function cacheKey(filters: OpenRoFilters, chunk: OpenRoChunk) {
  const stableParams = JSON.stringify(filters)
  return `hyundai:business-excellence:open-ro:v12:${chunk}:${createHash('sha1').update(stableParams).digest('hex')}`
}

function buildAlerts(row: OpenRoDetailRow) {
  const combined = [
    row.currentStatus,
    row.newStatus,
    row.subStatus,
    row.delayReason,
    row.remarks,
  ].join(' ').toLowerCase()
  const alerts: OpenRoDetailRow['alerts'] = []

  if (row.agingDays > 15) alerts.push({ label: 'Vehicle in Workshop >15 Days', severity: 'high' })
  if (row.delayStatus === 'Delayed') alerts.push({ label: 'Promise Date Breached', severity: 'high' })
  if (combined.includes('ready') || combined.includes('delivery')) {
    alerts.push({ label: 'Vehicle ready but not collected', severity: 'medium' })
  }
  if (combined.includes('part')) alerts.push({ label: 'Waiting for Parts', severity: 'medium' })
  if (combined.includes('insurance') || combined.includes('approval') || combined.includes('surveyor')) {
    alerts.push({ label: 'Insurance Approval Pending', severity: 'medium' })
  }
  if (combined.includes('final inspection')) {
    alerts.push({ label: 'Final Inspection Pending', severity: 'low' })
  }
  if (combined.includes('rework') || combined.includes('revisit')) {
    alerts.push({ label: 'Rework Risk', severity: 'medium' })
  }

  return alerts
}

function mapDetailRow(row: NumericRow): OpenRoDetailRow {
  const detail: OpenRoDetailRow = {
    roNo: stringValue(row.r_o_no, 'Unknown RO'),
    roDate: dateValue(row.ro_date),
    regNo: stringValue(row.reg_no, '-'),
    customerName: stringValue(row.customer_name, '-'),
    advisor: stringValue(row.service_adv),
    technician: stringValue(row.main_technician, '-'),
    model: stringValue(row.model, '-'),
    workType: stringValue(row.work_type, '-'),
    serviceType: stringValue(row.service_type, '-'),
    serviceCategory: stringValue(row.service_category, 'Others'),
    agingDays: numberValue(row.aging_days),
    agingBucket: stringValue(row.aging_bucket, '0-4D'),
    currentStatus: stringValue(row.status, 'Open'),
    newStatus: stringValue(row.new_r_o_status, '-'),
    subStatus: stringValue(row.ro_sub_status, '-'),
    promiseDate: dateValue(row.promise_date),
    delayStatus: row.delay_status === 'Delayed' ? 'Delayed' : 'On Track',
    insuranceCompany: stringValue(row.insurance_company_name, '-'),
    estimateAmount: numberValue(row.estimate_amt),
    labourAmount: numberValue(row.labour_amt),
    partAmount: numberValue(row.part_amt),
    totalAmount: numberValue(row.total),
    delayReason: stringValue(row.delay_reason, ''),
    remarks: stringValue(row.ro_remaks, ''),
    alerts: [],
  }
  detail.alerts = buildAlerts(detail)
  return detail
}

async function buildOpenRoPayload(filters: OpenRoFilters, chunk: OpenRoChunk = 'summary') {
  const baseSql = openRoBaseSql(filters)
  const includeSummary = chunk !== 'details'
  const includeDetails = chunk !== 'summary'
  const [kpiRows, summaryRows, delayReasonRows, bucketRows, advisorRows, workTypeRows, trendRows, detailRows, optionRows] = await Promise.all([
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COUNT(*)::int AS total_open_ro,
        COALESCE(AVG(aging_days), 0)::float AS avg_aging,
        COUNT(*) FILTER (WHERE aging_days > 15)::int AS over_15_days,
        COUNT(*) FILTER (WHERE delay_status = 'Delayed')::int AS delayed_ro,
        COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accident_jobs,
        COUNT(*) FILTER (WHERE service_category = 'Running Repair')::int AS running_repairs
      FROM filtered
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        service_category,
        COUNT(*)::int AS total_wip,
        COUNT(*) FILTER (WHERE aging_bucket = '0-4D')::int AS bucket_0_4,
        COUNT(*) FILTER (WHERE aging_bucket = '5-7D')::int AS bucket_5_7,
        COUNT(*) FILTER (WHERE aging_bucket = '8-15D')::int AS bucket_8_15,
        COUNT(*) FILTER (WHERE aging_bucket = '>15D')::int AS bucket_over_15,
        COALESCE(AVG(aging_days), 0)::float AS avg_days
      FROM filtered
      GROUP BY service_category
      ORDER BY
        CASE service_category
          WHEN 'Accidental Repair' THEN 1
          WHEN 'Running Repair' THEN 2
          WHEN 'Paid Service' THEN 3
          WHEN 'Free Service' THEN 4
          ELSE 5
        END,
        total_wip DESC
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT
        COALESCE(NULLIF(TRIM(new_r_o_status), ''), '-') AS new_status,
        COALESCE(NULLIF(TRIM(delay_reason), ''), 'No Reason Specified') AS delay_reason,
        COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS acc_count,
        COUNT(*) FILTER (WHERE service_category <> 'Accidental Repair')::int AS mech_count,
        COUNT(*) FILTER (WHERE aging_bucket = '0-4D')::int AS bucket_0_4,
        COUNT(*) FILTER (WHERE aging_bucket = '5-7D')::int AS bucket_5_7,
        COUNT(*) FILTER (WHERE aging_bucket = '8-15D')::int AS bucket_8_15,
        COUNT(*) FILTER (WHERE aging_bucket = '>15D')::int AS bucket_over_15,
        COUNT(*)::int AS total,
        COALESCE(AVG(aging_days), 0)::float AS avg_days
      FROM filtered
      GROUP BY
        COALESCE(NULLIF(TRIM(new_r_o_status), ''), '-'),
        COALESCE(NULLIF(TRIM(delay_reason), ''), 'No Reason Specified')
      ORDER BY total DESC, avg_days DESC, new_status ASC, delay_reason ASC
      LIMIT 20
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT aging_bucket AS bucket, COUNT(*)::int AS count
      FROM filtered
      GROUP BY aging_bucket
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT service_adv AS advisor, COUNT(*)::int AS open_ro, COALESCE(AVG(aging_days), 0)::float AS avg_aging
      FROM filtered
      GROUP BY service_adv
      ORDER BY open_ro DESC, avg_aging DESC
      LIMIT 12
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT service_category, COUNT(*)::int AS count
      FROM filtered
      GROUP BY service_category
      ORDER BY count DESC
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      ${baseSql}
      SELECT ro_date::text AS date, COUNT(*)::int AS open_ro, COALESCE(AVG(aging_days), 0)::float AS avg_aging
      FROM filtered
      WHERE ro_date IS NOT NULL
      GROUP BY ro_date
      ORDER BY ro_date ASC
      LIMIT 60
    `) : Promise.resolve([]),
    includeDetails ? db.execute(sql`
      ${baseSql}
      SELECT *
      FROM filtered
      ORDER BY aging_days DESC, promise_date ASC NULLS LAST, service_category ASC
      LIMIT 1000
    `) : Promise.resolve([]),
    includeSummary ? db.execute(sql`
      WITH active AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dlr_no, ''), '-') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text)
        )
          svc_adv AS service_adv,
          work_type,
          work_type AS service_type,
          '-' AS insurance_company_name,
          r_o_date::date AS ro_date
        FROM hyundai_repair_order_list
      WHERE cancel_date IS NULL
        AND LOWER(COALESCE(NULLIF(TRIM(r_o_status::text), ''), NULLIF(TRIM(status::text), ''), NULLIF(TRIM(new_r_o_status::text), ''), '')) = 'open'
        AND (${filters.startDate}::date IS NULL OR r_o_date >= ${filters.startDate}::date)
        AND (${filters.endDate}::date IS NULL OR r_o_date < (${filters.endDate}::date + INTERVAL '1 day'))
        ${openRoDealerFilter(filters)}
        ORDER BY
          COALESCE(NULLIF(source_dealer_code, ''), NULLIF(dealer_code, ''), NULLIF(dlr_no, ''), '-') || ':' || COALESCE(NULLIF(r_o_no, ''), id::text),
          uploaded_at DESC NULLS LAST,
          id DESC
      ),
      enriched AS (
        SELECT
          service_adv,
          insurance_company_name,
          CASE
            WHEN ro_date IS NULL THEN '0-4D'
            WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 4 THEN '0-4D'
            WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 7 THEN '5-7D'
            WHEN (COALESCE(${filters.endDate}::date, CURRENT_DATE) - ro_date)::int <= 15 THEN '8-15D'
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
          END AS service_category
        FROM active
      )
      SELECT
        COALESCE(jsonb_agg(DISTINCT service_adv) FILTER (WHERE NULLIF(service_adv, '') IS NOT NULL), '[]'::jsonb) AS advisors,
        COALESCE(jsonb_agg(DISTINCT service_category) FILTER (WHERE NULLIF(service_category, '') IS NOT NULL), '[]'::jsonb) AS work_types,
        COALESCE(jsonb_agg(DISTINCT insurance_company_name) FILTER (WHERE NULLIF(insurance_company_name, '') IS NOT NULL), '[]'::jsonb) AS insurance_companies
      FROM enriched
    `) : Promise.resolve([]),
  ])

  const kpis = resultRows(kpiRows)[0] || {}
  const details = resultRows(detailRows).map(mapDetailRow)
  const alertSummary = details.reduce<Record<string, number>>((summary, detail) => {
    detail.alerts.forEach((alert) => {
      summary[alert.label] = (summary[alert.label] || 0) + 1
    })
    return summary
  }, {})

  const optionRow = resultRows(optionRows)[0] || {}
  const asStringArray = (value: unknown) => Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean).sort((a, b) => a.localeCompare(b))
    : []

  const bucketOrder = ['0-4D', '5-7D', '8-15D', '>15D']
  const bucketMap = new Map(resultRows(bucketRows).map((row) => [String(row.bucket), numberValue(row.count)]))

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    kpis: {
      totalOpenRo: numberValue(kpis.total_open_ro),
      avgAging: numberValue(kpis.avg_aging),
      over15Days: numberValue(kpis.over_15_days),
      delayedRo: numberValue(kpis.delayed_ro),
      accidentJobs: numberValue(kpis.accident_jobs),
      runningRepairs: numberValue(kpis.running_repairs),
    },
    rows: resultRows(summaryRows).map((row) => ({
      serviceType: stringValue(row.service_category, 'Others'),
      totalWip: numberValue(row.total_wip),
      bucket04: numberValue(row.bucket_0_4),
      bucket57: numberValue(row.bucket_5_7),
      bucket815: numberValue(row.bucket_8_15),
      bucketOver15: numberValue(row.bucket_over_15),
      avgDays: numberValue(row.avg_days),
    })),
    delayReasonSummary: resultRows(delayReasonRows).map((row) => ({
      newStatus: stringValue(row.new_status, '-'),
      delayReason: stringValue(row.delay_reason, 'No Reason Specified'),
      mechCount: numberValue(row.mech_count),
      accCount: numberValue(row.acc_count),
      bucket04: numberValue(row.bucket_0_4),
      bucket57: numberValue(row.bucket_5_7),
      bucket815: numberValue(row.bucket_8_15),
      bucketOver15: numberValue(row.bucket_over_15),
      total: numberValue(row.total),
      avgDays: numberValue(row.avg_days),
    })),
    details,
    charts: {
      agingDistribution: bucketOrder.map((bucket) => ({ bucket, count: bucketMap.get(bucket) || 0 })),
      advisorLoad: resultRows(advisorRows).map((row) => ({
        advisor: stringValue(row.advisor),
        openRo: numberValue(row.open_ro),
        avgAging: numberValue(row.avg_aging),
      })),
      workTypeDistribution: resultRows(workTypeRows).map((row) => ({
        name: stringValue(row.service_category, 'Others'),
        value: numberValue(row.count),
      })),
      agingTrend: resultRows(trendRows).map((row) => ({
        date: String(row.date || ''),
        openRo: numberValue(row.open_ro),
        avgAging: numberValue(row.avg_aging),
      })),
    },
    alerts: {
      summary: Object.entries(alertSummary)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      highPriority: details
        .filter((detail) => detail.alerts.some((alert) => alert.severity === 'high'))
        .slice(0, 8),
    },
    filterOptions: {
      advisors: asStringArray(optionRow.advisors),
      workTypes: asStringArray(optionRow.work_types),
      agingBuckets: bucketOrder,
      insuranceCompanies: asStringArray(optionRow.insurance_companies),
    },
    meta: {
      ...HYUNDAI_BE_CALCULATION_META,
      rowCount: details.length,
      detailLimit: 1000,
      chunk,
      dateRange: { startDate: filters.startDate, endDate: filters.endDate },
      statusDefinition: "LOWER(status) = 'open'",
      agingDefinition: 'selected_end_date - ro_date',
      promiseDateDefinition: 'COALESCE(revised_promise_date_time, promise_date_time)',
      cacheTtlSeconds: CACHE_TTL_SECONDS,
      comparison: {
        supported: false,
        reason: 'hyundai_repair_order_list currently has only Apr 2026 onward coverage, so historical comparisons are disabled.',
        preset: filters.periodPreset,
        comparisonMode: filters.comparisonMode || 'none',
        comparisonStartDate: filters.comparisonStartDate,
        comparisonEndDate: filters.comparisonEndDate,
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('open-ro')
  const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
  if (accessError) return accessError

  const { searchParams } = new URL(request.url)
  const skipCache = searchParams.get('skipCache') === 'true'
  const requestedChunk = searchParams.get('chunk')
  const chunk: OpenRoChunk = requestedChunk === 'details' || requestedChunk === 'full' ? requestedChunk : 'summary'
  const comparisonStartDate = parseDateInput(searchParams.get('compareStartDate')) || parseDateInput(searchParams.get('comparisonStartDate'))
  const comparisonEndDate = parseDateInput(searchParams.get('compareEndDate')) || parseDateInput(searchParams.get('comparisonEndDate'))
  const filters: OpenRoFilters = {
    advisor: getFilterValue(searchParams.get('advisor')),
    workType: getFilterValue(searchParams.get('workType')),
    agingBucket: getFilterValue(searchParams.get('agingBucket')),
    insurance: getFilterValue(searchParams.get('insurance')),
    startDate: parseDateInput(searchParams.get('startDate')),
    endDate: parseDateInput(searchParams.get('endDate')),
    periodPreset: searchParams.get('periodPreset') || null,
    comparisonMode: searchParams.get('comparisonMode') || 'none',
    comparisonStartDate,
    comparisonEndDate,
    dealerCode: normalizeHyundaiDealerCode(searchParams.get('dealer_code')) || null,
  }

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildOpenRoPayload(filters, chunk)
      : getCachedData(cacheKey(filters, chunk), () => buildOpenRoPayload(filters, chunk), CACHE_TTL_SECONDS))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Open RO dashboard:', error)
    return NextResponse.json({ error: 'Failed to build Open RO dashboard' }, { status: 500 })
  }
}
