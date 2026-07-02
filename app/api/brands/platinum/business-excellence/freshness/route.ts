import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'
import { platinumSourceDealerSql } from '@/lib/platinum/dealer-filter'
import { getCachedData } from '@/lib/redis/cache-utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const CACHE_TTL_SECONDS = 60

type FreshnessSource = {
  table: string
  label: string
  dealerColumn?: string
  fallbackDealerColumns?: string[]
  hasUploadedAt?: boolean
}

const REPORT_SOURCES: Record<string, FreshnessSource[]> = {
  executive_dashboard: [{
    table: 'am_platinum_ro_billing_report',
    label: 'RO Billing',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
  }],
  business_excellence_overview: [
    {
      table: 'am_platinum_ro_billing_report',
      label: 'RO Billing',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
    },
    {
      table: 'am_platinum_repair_order_list',
      label: 'Open RO',
      dealerColumn: 'dlr_no',
    },
    { table: 'am_platinum_call_center_complaints', label: 'Complaints', dealerColumn: 'source_dealer_code' },
    { table: 'am_platinum_operation_wise_analysis_report', label: 'Operation Analysis', dealerColumn: 'source_dealer_code' },
    {
      table: 'am_platinum_operation_wise_analysis_advisor_report',
      label: 'Advisor Operation Analysis',
      hasUploadedAt: false,
    },
  ],
  am_platinum_ro_billing_report: [{
    table: 'am_platinum_ro_billing_report',
    label: 'RO Billing',
    dealerColumn: 'source_dealer_code',
    fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
  }],
  workshop_performance: [
    {
      table: 'am_platinum_ro_billing_report',
      label: 'RO Billing',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dealer_code', 'main_dealer_code'],
    },
    { table: 'am_platinum_operation_wise_analysis_report', label: 'Operation Analysis', dealerColumn: 'source_dealer_code' },
    {
      table: 'am_platinum_operation_wise_analysis_advisor_report',
      label: 'Advisor Operation Analysis',
      hasUploadedAt: false,
    },
    { table: 'am_platinum_rsa_report', label: 'RSA', hasUploadedAt: false },
    {
      table: 'am_platinum_ew_report',
      label: 'EW',
      dealerColumn: 'source_dealer_code',
      fallbackDealerColumns: ['dlr_no'],
    },
  ],
  open_ro_repair_orders: [{
    table: 'am_platinum_repair_order_list',
    label: 'Open RO',
    dealerColumn: 'dlr_no',
  }],
  platinum_complaints: [{
    table: 'am_platinum_call_center_complaints',
    label: 'Complaints',
    dealerColumn: 'source_dealer_code',
  }],
  sot_analysis: [{
    table: 'am_platinum_trust_package',
    label: 'SOT Package',
    dealerColumn: 'source_dealer_code',
  }],
}

type FreshnessRow = {
  table: string
  label: string
  sourceUpdatedAt: string | Date | null
  rowCount: number | string | null
  dealerScoped: boolean
}

function buildFreshnessSelect(source: FreshnessSource, dealerCode: string | null) {
  const dealerExpression = source.dealerColumn
    ? platinumSourceDealerSql(
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
      MAX(uploaded_at) AS "sourceUpdatedAt",
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
    rowCount: Number(row.rowCount || 0),
    dealerScoped: Boolean(row.dealerScoped),
  }))
}

function normalizeReportKey(value: string | null) {
  const normalized = String(value || 'business_excellence_overview')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (normalized === 'service_dashboard') return 'am_platinum_ro_billing_report'
  if (normalized.includes('sot_analysis')) return 'sot_analysis'
  return normalized
}

export async function GET(request: Request) {
  const timer = createApiTimer('Platinum-business-excellence-freshness')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const reportKey = normalizeReportKey(searchParams.get('report'))
    const dealerCode = normalizePlatinumDealerCode(searchParams.get('dealer_code'))
    const sources = REPORT_SOURCES[reportKey] || REPORT_SOURCES.business_excellence_overview

    const data = await timer.time('response-cache', () => getCachedData(
      `platinum:business-excellence:freshness:v6:${reportKey}:${dealerCode || 'all'}`,
      async () => {
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
      },
      CACHE_TTL_SECONDS
    ))

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
    console.error('Failed to read Platinum Business Excellence freshness:', error)
    return NextResponse.json({ error: 'Failed to read Business Excellence freshness' }, { status: 500 })
  }
}
