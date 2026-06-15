import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getHyundaiDealerCodes, normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type FreshnessSource = {
  table: string
  label: string
}

const REPORT_SOURCES: Record<string, FreshnessSource[]> = {
  executive_dashboard: [{ table: 'hyundai_ro_billing_report', label: 'RO Billing' }],
  business_excellence_overview: [
    { table: 'hyundai_ro_billing_report', label: 'RO Billing' },
    { table: 'hyundai_repair_order_list', label: 'Open RO' },
    { table: 'hyundai_call_center_complaints', label: 'Complaints' },
    { table: 'hyundai_operation_wise_analysis_report', label: 'Operation Analysis' },
    { table: 'hyundai_ew_report', label: 'EW' },
  ],
  hyundai_ro_billing_report: [{ table: 'hyundai_ro_billing_report', label: 'RO Billing' }],
  workshop_performance: [
    { table: 'hyundai_ro_billing_report', label: 'RO Billing' },
    { table: 'hyundai_operation_wise_analysis_report', label: 'Operation Analysis' },
    { table: 'hyundai_ew_report', label: 'EW' },
  ],
  open_ro_repair_orders: [{ table: 'hyundai_repair_order_list', label: 'Open RO' }],
  hyundai_complaints: [{ table: 'hyundai_call_center_complaints', label: 'Complaints' }],
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

function resolveDealerColumn(table: string, columns: Set<string>) {
  if (table === 'hyundai_call_center_complaints' && columns.has('source_dealer_code')) return 'source_dealer_code'
  if (table === 'hyundai_repair_order_list' && columns.has('dealer')) return 'dealer'
  if (table === 'hyundai_ew_report' && columns.has('dlr_no')) return 'dlr_no'
  if (table === 'hyundai_operation_wise_analysis_report' && columns.has('source_dealer_code')) return 'source_dealer_code'
  if (columns.has('dealer_code')) return 'dealer_code'
  if (columns.has('main_dealer_code')) return 'main_dealer_code'
  if (columns.has('billing_dealer_code')) return 'billing_dealer_code'
  if (columns.has('main_dealer')) return 'main_dealer'
  if (columns.has('source_dealer_code')) return 'source_dealer_code'
  return null
}

function resolveDateColumn(table: string, columns: Set<string>) {
  const candidatesByTable: Record<string, string[]> = {
    hyundai_ro_billing_report: ['bill_date', 'uploaded_at'],
    hyundai_repair_order_list: ['r_o_date', 'ro_date', 'uploaded_at'],
    hyundai_call_center_complaints: ['complaint_date', 'uploaded_at'],
    hyundai_operation_wise_analysis_report: ['report_month', 'uploaded_at'],
    hyundai_ew_report: ['reg_date', 'ew_reg_date', 'uploaded_at'],
  }
  return (candidatesByTable[table] || ['uploaded_at']).find((column) => columns.has(column)) || null
}

async function readSourceFreshness(source: FreshnessSource, dealerCode: string | null) {
  const columns = await readColumns(source.table)
  if (!columns.has('uploaded_at')) return null

  const dealerColumn = dealerCode ? resolveDealerColumn(source.table, columns) : null
  const dealerCodes = getHyundaiDealerCodes(dealerCode)
  const dealerWhere = dealerCodes.length > 0 && dealerColumn
    ? sql`WHERE UPPER(TRIM(COALESCE(${sql.raw(`"${dealerColumn}"`)}::text, ''))) IN (${sql.join(dealerCodes.map((code) => sql`${code}`), sql`, `)})`
    : sql``
  const dateColumn = resolveDateColumn(source.table, columns)
  const dateProjection = dateColumn
    ? sql`${sql.raw(`MIN("${dateColumn}")::text`)} AS "minDate", ${sql.raw(`MAX("${dateColumn}")::text`)} AS "maxDate",`
    : sql`NULL::text AS "minDate", NULL::text AS "maxDate",`

  const rows = await db.execute(sql`
    SELECT
      MAX(uploaded_at) AS "sourceUpdatedAt",
      ${dateProjection}
      COUNT(*)::int AS "rowCount"
    FROM ${sql.raw(`"${source.table}"`)}
    ${dealerWhere}
  `) as Array<{ sourceUpdatedAt: string | Date | null; minDate: string | null; maxDate: string | null; rowCount: number | string | null }>

  const row = rows[0]
  return {
    table: source.table,
    label: source.label,
    sourceUpdatedAt: row?.sourceUpdatedAt ? new Date(row.sourceUpdatedAt).toISOString() : null,
    minDate: row?.minDate || null,
    maxDate: row?.maxDate || null,
    rowCount: Number(row?.rowCount || 0),
    dealerScoped: Boolean(dealerColumn && dealerCodes.length > 0),
  }
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
    console.error('Failed to read Hyundai Business Excellence freshness:', error)
    return NextResponse.json({ error: 'Failed to read Business Excellence freshness' }, { status: 500 })
  }
}
