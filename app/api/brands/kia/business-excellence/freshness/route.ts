import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type FreshnessSource = {
  table: string
  label: string
}

const REPORT_SOURCES: Record<string, FreshnessSource[]> = {
  executive_dashboard: [{ table: 'ro_billing_report', label: 'RO Billing' }],
  business_excellence_overview: [
    { table: 'ro_billing_report', label: 'RO Billing' },
    { table: 'open_ro_yearly', label: 'Open RO' },
    { table: 'kia_call_center_complaints', label: 'Complaints' },
    { table: 'operation_wise_analysis_report', label: 'Operation Analysis' },
    { table: 'operation_wise_analysis_advisor_report', label: 'Advisor Operation Analysis' },
  ],
  ro_billing_report: [{ table: 'ro_billing_report', label: 'RO Billing' }],
  workshop_performance: [
    { table: 'ro_billing_report', label: 'RO Billing' },
    { table: 'operation_wise_analysis_report', label: 'Operation Analysis' },
    { table: 'operation_wise_analysis_advisor_report', label: 'Advisor Operation Analysis' },
    { table: 'rsa_report', label: 'RSA' },
    { table: 'ew_report', label: 'EW' },
    { table: 'mcp_report', label: 'MCP' },
  ],
  open_ro_repair_orders: [{ table: 'open_ro_yearly', label: 'Open RO' }],
  kia_complaints: [{ table: 'kia_call_center_complaints', label: 'Complaints' }],
}

function normalizeReportKey(value: string | null) {
  return String(value || 'business_excellence_overview')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

async function readColumns(table: string) {
  const rows = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
  `) as Array<{ column_name: string }>

  return new Set(rows.map((row) => row.column_name))
}

function resolveDealerColumn(columns: Set<string>) {
  if (columns.has('dealer_code')) return 'dealer_code'
  if (columns.has('main_dealer_code')) return 'main_dealer_code'
  if (columns.has('billing_dealer_code')) return 'billing_dealer_code'
  if (columns.has('main_dealer')) return 'main_dealer'
  return null
}

async function readSourceFreshness(source: FreshnessSource, dealerCode: string | null) {
  const columns = await readColumns(source.table)
  if (!columns.has('uploaded_at')) return null

  const dealerColumn = dealerCode ? resolveDealerColumn(columns) : null
  const dealerWhere = dealerCode && dealerColumn
    ? sql`WHERE UPPER(TRIM(COALESCE(${sql.raw(`"${dealerColumn}"`)}::text, ''))) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      MAX(uploaded_at) AS "sourceUpdatedAt",
      COUNT(*)::int AS "rowCount"
    FROM ${sql.raw(`"${source.table}"`)}
    ${dealerWhere}
  `) as Array<{ sourceUpdatedAt: string | Date | null; rowCount: number | string | null }>

  const row = rows[0]
  return {
    table: source.table,
    label: source.label,
    sourceUpdatedAt: row?.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).toISOString() : null,
    rowCount: Number(row?.rowCount || 0),
    dealerScoped: Boolean(dealerColumn && dealerCode),
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-business-excellence-freshness')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const reportKey = normalizeReportKey(searchParams.get('report'))
    const dealerCode = normalizeKiaDealerCode(searchParams.get('dealer_code'))
    const sources = REPORT_SOURCES[reportKey] || REPORT_SOURCES.business_excellence_overview

    const sourceFreshness = (await timer.time('freshness-db', async () => {
      const settled = await Promise.allSettled(sources.map((source) => readSourceFreshness(source, dealerCode)))
      return settled
        .map((result) => result.status === 'fulfilled' ? result.value : null)
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    }))

    const sourceUpdatedAt = sourceFreshness
      .map((source) => source.sourceUpdatedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null

    const timing = timer.finish()
    return withServerTiming(NextResponse.json({
      report: reportKey,
      dealerCode,
      sourceUpdatedAt,
      sources: sourceFreshness,
    }), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to read KIA Business Excellence freshness:', error)
    return NextResponse.json({ error: 'Failed to read Business Excellence freshness' }, { status: 500 })
  }
}
