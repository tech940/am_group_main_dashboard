import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import {
  platinumActiveBillSql,
  platinumRoBillingDealerFilter,
  platinumRoBillingDealerSql,
  platinumRoBillingInvoiceKeySql,
  platinumRoBillingRoKeySql,
} from '@/lib/platinum/business-excellence-calculations'

type DealerFilter = string | null
type ResultRow = Record<string, unknown>

export type PlatinumRoBillingAuditLevel = 'none' | 'watch' | 'critical'

export type PlatinumRoBillingAudit = {
  sourceAvailable: boolean
  startDate: string
  endDate: string
  dealerCode: string
  rawRows: number
  activeRawRows: number
  cancelledRows: number
  dedupedInvoices: number
  dedupedJc: number
  duplicateRowsRemoved: number
  labour: number
  parts: number
  revenue: number
  minBillDate: string | null
  maxBillDate: string | null
  latestUploadedAt: string | null
  ly: {
    startDate: string
    endDate: string
    dedupedJc: number
    labour: number
    parts: number
    revenue: number
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
  }
  previousPeriod: {
    startDate: string
    endDate: string
    dedupedJc: number
    labour: number
    parts: number
    revenue: number
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
  }
  dailySplit: Array<{
    date: string
    rawRows: number
    dedupedJc: number
    labour: number
    parts: number
    revenue: number
  }>
  dealerSplit: Array<{
    dealerCode: string
    rawRows: number
    dedupedJc: number
    labour: number
    parts: number
    revenue: number
  }>
  topInvoices: Array<{
    billNo: string | null
    roNo: string | null
    billDate: string | null
    dealerCode: string
    workType: string | null
    billType: string | null
    labour: number
    parts: number
    revenue: number
    uploadedAt: string | null
  }>
  anomaly: {
    level: PlatinumRoBillingAuditLevel
    reasons: string[]
    jcGrowthPct: number | null
    revenueGrowthPct: number | null
    previousJcGrowthPct: number | null
    previousRevenueGrowthPct: number | null
  }
}

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? (result as ResultRow[]) : []
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function stringOrNull(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10) || null
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

function timestampValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return String(value) || null
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function dealerFilter(dealerCode: DealerFilter) {
  return platinumRoBillingDealerFilter(dealerCode)
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function sameDateLastYear(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  // ⚠️ Clamp, do not concatenate. Building the string directly produced "2027-02-29" for a 29 Feb
  // input — a date Postgres REJECTS ("date/time field value out of range"), which threw the whole
  // audit query. The throw was swallowed by cockpit-data.ts's .catch(() => null), so the brand
  // silently disappeared from the Group Cockpit instead of erroring visibly. The feed holds 104 real
  // rows on 2024-02-29, so the input is reachable.
  const lastDayOfLyMonth = new Date(Date.UTC(year - 1, month, 0)).getUTCDate()
  const safeDay = Math.min(day, lastDayOfLyMonth)
  return `${year - 1}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
}

function inclusiveDayCount(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`).getTime()
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1
  return Math.round((end - start) / 86400000) + 1
}

function growthPct(current: number, previous: number) {
  if (!Number.isFinite(previous) || previous <= 0) return current > 0 ? null : 0
  return ((current - previous) / previous) * 100
}

type RoPeriodSummary = {
  startDate: string
  endDate: string
  rawRows: number
  activeRawRows: number
  cancelledRows: number
  dedupedInvoices: number
  dedupedJc: number
  duplicateRowsRemoved: number
  labour: number
  parts: number
  revenue: number
  minBillDate: string | null
  maxBillDate: string | null
  latestUploadedAt: string | null
}

export type PlatinumRoBillingAuditRangeOptions = {
  lyStartDate?: string
  lyEndDate?: string
}

function resolveLyRange(
  startDate: string,
  endDate: string,
  options?: PlatinumRoBillingAuditRangeOptions
) {
  return {
    lyStartDate: options?.lyStartDate || sameDateLastYear(startDate),
    lyEndDate: options?.lyEndDate || sameDateLastYear(endDate),
  }
}

export function emptyPlatinumRoBillingAudit(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null,
  sourceAvailable = false,
  rangeOptions?: PlatinumRoBillingAuditRangeOptions
): PlatinumRoBillingAudit {
  const days = inclusiveDayCount(startDate, endDate)
  const previousEndDate = addDays(startDate, -1)
  const previousStartDate = addDays(startDate, -days)
  const { lyStartDate, lyEndDate } = resolveLyRange(startDate, endDate, rangeOptions)

  return {
    sourceAvailable,
    startDate,
    endDate,
    dealerCode: dealerCode || 'all',
    rawRows: 0,
    activeRawRows: 0,
    cancelledRows: 0,
    dedupedInvoices: 0,
    dedupedJc: 0,
    duplicateRowsRemoved: 0,
    labour: 0,
    parts: 0,
    revenue: 0,
    minBillDate: null,
    maxBillDate: null,
    latestUploadedAt: null,
    ly: {
      startDate: lyStartDate,
      endDate: lyEndDate,
      dedupedJc: 0,
      labour: 0,
      parts: 0,
      revenue: 0,
      jcGrowthPct: null,
      revenueGrowthPct: null,
    },
    previousPeriod: {
      startDate: previousStartDate,
      endDate: previousEndDate,
      dedupedJc: 0,
      labour: 0,
      parts: 0,
      revenue: 0,
      jcGrowthPct: null,
      revenueGrowthPct: null,
    },
    dailySplit: [],
    dealerSplit: [],
    topInvoices: [],
    anomaly: {
      level: 'none',
      reasons: [],
      jcGrowthPct: null,
      revenueGrowthPct: null,
      previousJcGrowthPct: null,
      previousRevenueGrowthPct: null,
    },
  }
}

function buildAnomaly(
  current: RoPeriodSummary,
  ly: RoPeriodSummary,
  previous: RoPeriodSummary
) {
  const jcGrowth = growthPct(current.dedupedJc, ly.dedupedJc)
  const revenueGrowth = growthPct(current.revenue, ly.revenue)
  const previousJcGrowth = growthPct(current.dedupedJc, previous.dedupedJc)
  const previousRevenueGrowth = growthPct(current.revenue, previous.revenue)
  const reasons: string[] = []
  let level: PlatinumRoBillingAuditLevel = 'none'

  const addReason = (candidateLevel: PlatinumRoBillingAuditLevel, reason: string) => {
    reasons.push(reason)
    if (candidateLevel === 'critical' || level === 'none') level = candidateLevel
  }

  if (revenueGrowth !== null && revenueGrowth >= 250) {
    addReason('critical', `Revenue is ${revenueGrowth.toFixed(1)}% above LY same period.`)
  } else if (revenueGrowth !== null && revenueGrowth >= 100) {
    addReason('watch', `Revenue is ${revenueGrowth.toFixed(1)}% above LY same period.`)
  }

  if (jcGrowth !== null && jcGrowth >= 200) {
    addReason('critical', `JC count is ${jcGrowth.toFixed(1)}% above LY same period.`)
  } else if (jcGrowth !== null && jcGrowth >= 100) {
    addReason('watch', `JC count is ${jcGrowth.toFixed(1)}% above LY same period.`)
  }

  if (previousRevenueGrowth !== null && previousRevenueGrowth >= 250) {
    addReason('critical', `Revenue is ${previousRevenueGrowth.toFixed(1)}% above previous same-length period.`)
  } else if (previousRevenueGrowth !== null && previousRevenueGrowth >= 100) {
    addReason('watch', `Revenue is ${previousRevenueGrowth.toFixed(1)}% above previous same-length period.`)
  }

  if (previousJcGrowth !== null && previousJcGrowth >= 200) {
    addReason('critical', `JC count is ${previousJcGrowth.toFixed(1)}% above previous same-length period.`)
  } else if (previousJcGrowth !== null && previousJcGrowth >= 100) {
    addReason('watch', `JC count is ${previousJcGrowth.toFixed(1)}% above previous same-length period.`)
  }

  return {
    level,
    reasons,
    jcGrowthPct: jcGrowth,
    revenueGrowthPct: revenueGrowth,
    previousJcGrowthPct: previousJcGrowth,
    previousRevenueGrowthPct: previousRevenueGrowth,
  }
}

export async function fetchPlatinumRoBillingAudit(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null,
  rangeOptions?: PlatinumRoBillingAuditRangeOptions
): Promise<PlatinumRoBillingAudit> {
  const { lyStartDate, lyEndDate } = resolveLyRange(startDate, endDate, rangeOptions)
  const dealerKey = dealerCode || 'all'
  const cacheKey = `platinum:ro-billing-audit:v1:${dealerKey}:${startDate}:${endDate}:${lyStartDate}:${lyEndDate}`

  return getCachedData(
    cacheKey,
    () => queryPlatinumRoBillingAudit(startDate, endDate, dealerCode, rangeOptions),
    CACHE_TTL.PLATINUM
  )
}

async function queryPlatinumRoBillingAudit(
  startDate: string,
  endDate: string,
  dealerCode: DealerFilter = null,
  rangeOptions?: PlatinumRoBillingAuditRangeOptions
): Promise<PlatinumRoBillingAudit> {
  const days = inclusiveDayCount(startDate, endDate)
  const previousEndDate = addDays(startDate, -1)
  const previousStartDate = addDays(startDate, -days)
  const { lyStartDate, lyEndDate } = resolveLyRange(startDate, endDate, rangeOptions)

  const result = await analyticsDb.execute(sql`
    WITH range_def AS (
      SELECT *
      FROM (
        VALUES
          ('current'::text, ${startDate}::date, ${endDate}::date),
          ('ly'::text, ${lyStartDate}::date, ${lyEndDate}::date),
          ('previous'::text, ${previousStartDate}::date, ${previousEndDate}::date)
      ) AS ranges(period_key, start_date, end_date)
    ),
    scoped AS (
      SELECT
        id,
        ranges.period_key,
        bill_date::date AS bill_date,
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        NULLIF(TRIM(bill_no::text), '') AS bill_no,
        NULLIF(TRIM(r_o_no::text), '') AS r_o_no,
        COALESCE(${platinumRoBillingDealerSql()}, 'UNMAPPED') AS dealer_code,
        NULLIF(TRIM(work_type::text), '') AS work_type,
        NULLIF(TRIM(bill_type::text), '') AS bill_type,
        LOWER(TRIM(COALESCE(bill_type::text, ''))) AS bill_type_normalized,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        uploaded_at
      FROM am_platinum_ro_billing_report
      JOIN range_def ranges
        ON bill_date >= ranges.start_date
       AND bill_date < (ranges.end_date + INTERVAL '1 day')
      WHERE 1 = 1
        ${dealerFilter(dealerCode)}
    ),
    active AS (
      SELECT *
      FROM scoped
      WHERE ${platinumActiveBillSql()}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY period_key, dealer_code, invoice_key
          ORDER BY uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM active
    ),
    dedup AS (
      SELECT *
      FROM ranked
      WHERE row_rank = 1
    ),
    raw_summary AS (
      SELECT
        period_key,
        COUNT(*)::int AS raw_rows,
        COUNT(*) FILTER (WHERE bill_type_normalized NOT LIKE '%cancel%')::int AS active_raw_rows,
        COUNT(*) FILTER (WHERE bill_type_normalized LIKE '%cancel%')::int AS cancelled_rows,
        MAX(uploaded_at)::text AS latest_uploaded_at
      FROM scoped
      GROUP BY period_key
    ),
    dedup_summary AS (
      SELECT
        period_key,
        COUNT(*)::int AS deduped_invoices,
        COUNT(DISTINCT dealer_code || ':' || ro_key)::int AS deduped_jc,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(labour_amt + part_amt), 0)::float AS revenue,
        MIN(bill_date)::text AS min_bill_date,
        MAX(bill_date)::text AS max_bill_date
      FROM dedup
      GROUP BY period_key
    ),
    summary AS (
      SELECT
        ranges.period_key,
        COALESCE(raw_summary.raw_rows, 0) AS raw_rows,
        COALESCE(raw_summary.active_raw_rows, 0) AS active_raw_rows,
        COALESCE(raw_summary.cancelled_rows, 0) AS cancelled_rows,
        COALESCE(dedup_summary.deduped_invoices, 0) AS deduped_invoices,
        COALESCE(dedup_summary.deduped_jc, 0) AS deduped_jc,
        GREATEST(COALESCE(raw_summary.active_raw_rows, 0) - COALESCE(dedup_summary.deduped_invoices, 0), 0) AS duplicate_rows_removed,
        COALESCE(dedup_summary.labour, 0) AS labour,
        COALESCE(dedup_summary.parts, 0) AS parts,
        COALESCE(dedup_summary.revenue, 0) AS revenue,
        dedup_summary.min_bill_date,
        dedup_summary.max_bill_date,
        raw_summary.latest_uploaded_at
      FROM range_def ranges
      LEFT JOIN raw_summary ON raw_summary.period_key = ranges.period_key
      LEFT JOIN dedup_summary ON dedup_summary.period_key = ranges.period_key
    ),
    daily AS (
      SELECT
        bill_date,
        (SELECT COUNT(*) FROM active source_rows WHERE source_rows.period_key = 'current' AND source_rows.bill_date = dedup.bill_date)::int AS raw_rows,
        COUNT(DISTINCT dealer_code || ':' || ro_key)::int AS deduped_jc,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(labour_amt + part_amt), 0)::float AS revenue
      FROM dedup
      WHERE period_key = 'current'
      GROUP BY bill_date
      ORDER BY bill_date ASC
    ),
    dealers AS (
      SELECT
        dealer_code,
        (SELECT COUNT(*) FROM active source_rows WHERE source_rows.period_key = 'current' AND source_rows.dealer_code = dedup.dealer_code)::int AS raw_rows,
        COUNT(DISTINCT dealer_code || ':' || ro_key)::int AS deduped_jc,
        COALESCE(SUM(labour_amt), 0)::float AS labour,
        COALESCE(SUM(part_amt), 0)::float AS parts,
        COALESCE(SUM(labour_amt + part_amt), 0)::float AS revenue
      FROM dedup
      WHERE period_key = 'current'
      GROUP BY dealer_code
      ORDER BY revenue DESC, deduped_jc DESC
    ),
    top_invoices AS (
      SELECT
        bill_no,
        r_o_no,
        bill_date::text AS bill_date,
        dealer_code,
        work_type,
        bill_type,
        labour_amt::float AS labour,
        part_amt::float AS parts,
        (labour_amt + part_amt)::float AS revenue,
        uploaded_at::text AS uploaded_at
      FROM dedup
      WHERE period_key = 'current'
      ORDER BY ABS(labour_amt + part_amt) DESC
      LIMIT 8
    )
    SELECT
      (
        SELECT COALESCE(jsonb_object_agg(period_key, jsonb_build_object(
          'rawRows', raw_rows,
          'activeRawRows', active_raw_rows,
          'cancelledRows', cancelled_rows,
          'dedupedInvoices', deduped_invoices,
          'dedupedJc', deduped_jc,
          'duplicateRowsRemoved', duplicate_rows_removed,
          'labour', labour,
          'parts', parts,
          'revenue', revenue,
          'minBillDate', min_bill_date,
          'maxBillDate', max_bill_date,
          'latestUploadedAt', latest_uploaded_at
        )), '{}'::jsonb)
        FROM summary
      ) AS summaries,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'date', bill_date::text,
          'rawRows', raw_rows,
          'dedupedJc', deduped_jc,
          'labour', labour,
          'parts', parts,
          'revenue', revenue
        ) ORDER BY bill_date ASC), '[]'::jsonb)
        FROM daily
      ) AS daily_split,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'dealerCode', dealer_code,
          'rawRows', raw_rows,
          'dedupedJc', deduped_jc,
          'labour', labour,
          'parts', parts,
          'revenue', revenue
        ) ORDER BY revenue DESC, deduped_jc DESC), '[]'::jsonb)
        FROM dealers
      ) AS dealer_split,
      (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'billNo', bill_no,
          'roNo', r_o_no,
          'billDate', bill_date,
          'dealerCode', dealer_code,
          'workType', work_type,
          'billType', bill_type,
          'labour', labour,
          'parts', parts,
          'revenue', revenue,
          'uploadedAt', uploaded_at
        ) ORDER BY revenue DESC), '[]'::jsonb)
        FROM top_invoices
      ) AS top_invoices
  `)

  // Exactly one row is structurally guaranteed here (scalar subqueries, no FROM) — see the same guard
  // in lib/hyundai/ro-billing-audit.ts. Zero rows means the read failed, not that there was no
  // business, and `|| {}` would launder that into a cacheable ₹0.
  const rows = resultRows(result)
  if (rows.length === 0) {
    throw new Error('platinum ro-billing audit: read returned no rows (expected exactly one) — refusing to report this as zero revenue')
  }
  const row = rows[0]
  const summaries = jsonValue<Record<string, ResultRow>>(row.summaries, {})
  const dailySplitRaw = jsonValue<ResultRow[]>(row.daily_split, [])
  const dealerSplitRaw = jsonValue<ResultRow[]>(row.dealer_split, [])
  const topInvoicesRaw = jsonValue<ResultRow[]>(row.top_invoices, [])
  const summaryFor = (key: string, rangeStart: string, rangeEnd: string) => {
    const summary = summaries[key] || {}
    const activeRawRows = numberValue(summary.activeRawRows)
    const dedupedJc = numberValue(summary.dedupedJc)
    return {
      startDate: rangeStart,
      endDate: rangeEnd,
      rawRows: numberValue(summary.rawRows),
      activeRawRows,
      cancelledRows: numberValue(summary.cancelledRows),
      dedupedInvoices: numberValue(summary.dedupedInvoices),
      dedupedJc,
      duplicateRowsRemoved: Math.max(0, numberValue(summary.duplicateRowsRemoved || activeRawRows - numberValue(summary.dedupedInvoices))),
      labour: numberValue(summary.labour),
      parts: numberValue(summary.parts),
      revenue: numberValue(summary.revenue),
      minBillDate: dateValue(summary.minBillDate),
      maxBillDate: dateValue(summary.maxBillDate),
      latestUploadedAt: timestampValue(summary.latestUploadedAt),
    }
  }

  const current = summaryFor('current', startDate, endDate)
  const ly = summaryFor('ly', lyStartDate, lyEndDate)
  const previous = summaryFor('previous', previousStartDate, previousEndDate)
  const dailySplit = dailySplitRaw.map((split) => ({
    date: dateValue(split.date) || '',
    rawRows: numberValue(split.rawRows),
    dedupedJc: numberValue(split.dedupedJc),
    labour: numberValue(split.labour),
    parts: numberValue(split.parts),
    revenue: numberValue(split.revenue),
  }))
  const dealerSplit = dealerSplitRaw.map((split) => ({
    dealerCode: String(split.dealerCode || 'UNMAPPED'),
    rawRows: numberValue(split.rawRows),
    dedupedJc: numberValue(split.dedupedJc),
    labour: numberValue(split.labour),
    parts: numberValue(split.parts),
    revenue: numberValue(split.revenue),
  }))
  const topInvoices = topInvoicesRaw.map((invoice) => ({
    billNo: stringOrNull(invoice.billNo),
    roNo: stringOrNull(invoice.roNo),
    billDate: dateValue(invoice.billDate),
    dealerCode: String(invoice.dealerCode || 'UNMAPPED'),
    workType: stringOrNull(invoice.workType),
    billType: stringOrNull(invoice.billType),
    labour: numberValue(invoice.labour),
    parts: numberValue(invoice.parts),
    revenue: numberValue(invoice.revenue),
    uploadedAt: timestampValue(invoice.uploadedAt),
  }))

  const lyJcGrowth = growthPct(current.dedupedJc, ly.dedupedJc)
  const lyRevenueGrowth = growthPct(current.revenue, ly.revenue)
  const previousJcGrowth = growthPct(current.dedupedJc, previous.dedupedJc)
  const previousRevenueGrowth = growthPct(current.revenue, previous.revenue)

  return {
    sourceAvailable: true,
    startDate,
    endDate,
    dealerCode: dealerCode || 'all',
    rawRows: current.rawRows,
    activeRawRows: current.activeRawRows,
    cancelledRows: current.cancelledRows,
    dedupedInvoices: current.dedupedInvoices,
    dedupedJc: current.dedupedJc,
    duplicateRowsRemoved: current.duplicateRowsRemoved,
    labour: current.labour,
    parts: current.parts,
    revenue: current.revenue,
    minBillDate: current.minBillDate,
    maxBillDate: current.maxBillDate,
    latestUploadedAt: current.latestUploadedAt,
    ly: {
      startDate: lyStartDate,
      endDate: lyEndDate,
      dedupedJc: ly.dedupedJc,
      labour: ly.labour,
      parts: ly.parts,
      revenue: ly.revenue,
      jcGrowthPct: lyJcGrowth,
      revenueGrowthPct: lyRevenueGrowth,
    },
    previousPeriod: {
      startDate: previousStartDate,
      endDate: previousEndDate,
      dedupedJc: previous.dedupedJc,
      labour: previous.labour,
      parts: previous.parts,
      revenue: previous.revenue,
      jcGrowthPct: previousJcGrowth,
      revenueGrowthPct: previousRevenueGrowth,
    },
    dailySplit,
    dealerSplit,
    topInvoices,
    anomaly: buildAnomaly(current, ly, previous),
  }
}
