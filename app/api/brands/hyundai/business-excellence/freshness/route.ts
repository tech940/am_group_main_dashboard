import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import {
  hyundaiSourceDealerSql,
  normalizeHyundaiDealerCode,
} from '@/lib/hyundai/dealer-branch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type FreshnessSource = {
  table: string
  label: string
  dealerColumn?: string
  fallbackDealerColumns?: string[]
  hasUploadedAt?: boolean
  minDateSql?: ReturnType<typeof sql>
  maxDateSql?: ReturnType<typeof sql>
}

const REPORT_SOURCES: Record<string, FreshnessSource[]> = {
  executive_dashboard: [{
    table: 'hyundai_ro_billing_report',
    label: 'RO Billing',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
    minDateSql: sql`MIN(bill_date)::text`,
    maxDateSql: sql`MAX(bill_date)::text`,
  }],
  business_excellence_overview: [
    {
      table: 'hyundai_ro_billing_report',
      label: 'RO Billing',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
      minDateSql: sql`MIN(bill_date)::text`,
      maxDateSql: sql`MAX(bill_date)::text`,
    },
    {
      table: 'hyundai_repair_order_list',
      label: 'Open RO',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code', 'dlr_no'],
      minDateSql: sql`MIN(r_o_date)::text`,
      maxDateSql: sql`MAX(r_o_date)::text`,
    },
    {
      table: 'hyundai_call_center_complaints',
      label: 'Complaints',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code'],
      minDateSql: sql`MIN(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text`,
      maxDateSql: sql`MAX(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text`,
    },
    {
      table: 'hyundai_operation_wise_analysis_report',
      label: 'Operation Analysis',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code'],
      minDateSql: sql`MIN(report_period_start)::text`,
      maxDateSql: sql`MAX(report_period_end)::text`,
    },
    {
      table: 'hyundai_ew_report',
      label: 'EW',
      dealerColumn: 'dlr_no',
      fallbackDealerColumns: ['dealer_code', 'source_dealer_code'],
      minDateSql: sql`MIN(reg_date)::text`,
      maxDateSql: sql`MAX(reg_date)::text`,
    },
  ],
  hyundai_ro_billing_report: [{
    table: 'hyundai_ro_billing_report',
    label: 'RO Billing',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
    minDateSql: sql`MIN(bill_date)::text`,
    maxDateSql: sql`MAX(bill_date)::text`,
  }],
  workshop_performance: [
    {
      table: 'hyundai_ro_billing_report',
      label: 'RO Billing',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
      minDateSql: sql`MIN(bill_date)::text`,
      maxDateSql: sql`MAX(bill_date)::text`,
    },
    {
      table: 'hyundai_operation_wise_analysis_report',
      label: 'Operation Analysis',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code'],
      minDateSql: sql`MIN(report_period_start)::text`,
      maxDateSql: sql`MAX(report_period_end)::text`,
    },
    {
      table: 'hyundai_ew_report',
      label: 'EW',
      dealerColumn: 'dlr_no',
      fallbackDealerColumns: ['dealer_code', 'source_dealer_code'],
      minDateSql: sql`MIN(reg_date)::text`,
      maxDateSql: sql`MAX(reg_date)::text`,
    },
  ],
  open_ro_repair_orders: [{
    table: 'hyundai_repair_order_list',
    label: 'Open RO',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code', 'dlr_no'],
    minDateSql: sql`MIN(r_o_date)::text`,
    maxDateSql: sql`MAX(r_o_date)::text`,
  }],
  hyundai_complaints: [{
    table: 'hyundai_call_center_complaints',
    label: 'Complaints',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code'],
    minDateSql: sql`MIN(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text`,
    maxDateSql: sql`MAX(COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date))::text`,
  }],
  sot_analysis: [{
    table: 'trust_package',
    label: 'SOT Package',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code'],
    minDateSql: sql`MIN(reg_date)::text`,
    maxDateSql: sql`MAX(reg_date)::text`,
  }],
}

type FreshnessRow = {
  table: string
  label: string
  sourceUpdatedAt: string | Date | null
  minDate: string | null
  maxDate: string | null
  rowCount: number | string | null
  dealerScoped: boolean
}

function normalizeReportKey(value: string | null) {
  const normalized = String(value || 'business_excellence_overview')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (normalized === 'service_dashboard') return 'hyundai_ro_billing_report'
  if (normalized.includes('sot_analysis')) return 'sot_analysis'
  return normalized
}

function buildFreshnessSelect(source: FreshnessSource, dealerCode: string | null) {
  const dealerExpression = source.dealerColumn
    ? hyundaiSourceDealerSql(
        sql.raw(`"${source.dealerColumn}"`),
        (source.fallbackDealerColumns || []).map((column) => sql.raw(`"${column}"`))
      )
    : null
  const dealerWhere = dealerCode && dealerExpression
    ? sql`WHERE ${dealerExpression} = ${dealerCode}`
    : sql``

  return sql`
    SELECT
      ${source.table}::text AS "table",
      ${source.label}::text AS "label",
      -- "Last updated" is a source-level fact: the latest cron write to the WHOLE
      -- table, independent of any dealer filter (which would otherwise show an older
      -- per-dealer timestamp).
      (SELECT MAX(uploaded_at) FROM ${sql.raw(`"${source.table}"`)}) AS "sourceUpdatedAt",
      ${source.minDateSql || sql`NULL::text`} AS "minDate",
      ${source.maxDateSql || sql`NULL::text`} AS "maxDate",
      COALESCE((
        SELECT n_live_tup::bigint
        FROM pg_stat_user_tables
        WHERE schemaname = 'public' AND relname = ${source.table}
      ), 0)::bigint AS "rowCount",
      ${Boolean(dealerCode && dealerExpression)}::boolean AS "dealerScoped"
    FROM ${sql.raw(`"${source.table}"`)}
    ${dealerWhere}
  `
}

async function readSourceFreshness(sources: FreshnessSource[], dealerCode: string | null) {
  const queryableSources = sources.filter((source) => source.hasUploadedAt !== false)
  if (queryableSources.length === 0) return []

  const query = sql.join(
    queryableSources.map((source) => buildFreshnessSelect(source, dealerCode)),
    sql` UNION ALL `
  )
  const result = await db.execute(query) as FreshnessRow[]

  return result.map((row) => ({
    table: row.table,
    label: row.label,
    sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).toISOString() : null,
    minDate: row.minDate || null,
    maxDate: row.maxDate || null,
    rowCount: Number(row.rowCount || 0),
    dealerScoped: Boolean(row.dealerScoped),
  }))
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-business-excellence-freshness')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('hyundai'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const reportKey = normalizeReportKey(searchParams.get('report'))
    const dealerCode = normalizeHyundaiDealerCode(searchParams.get('dealer_code'))
    const sources = REPORT_SOURCES[reportKey] || REPORT_SOURCES.business_excellence_overview

    const data = await timer.time('freshness-query', async () => {
      const sourceFreshness = await readSourceFreshness(sources, dealerCode)
      const sourceUpdatedAt = sourceFreshness
        .map((source) => source.sourceUpdatedAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null

      return {
        report: reportKey,
        dealerCode,
        sourceUpdatedAt,
        sources: sourceFreshness,
        lastUpdatedAt: new Date().toISOString(),
      }
    })

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to read Hyundai Business Excellence freshness:', error)
    return NextResponse.json({ error: 'Failed to read Business Excellence freshness' }, { status: 500 })
  }
}
