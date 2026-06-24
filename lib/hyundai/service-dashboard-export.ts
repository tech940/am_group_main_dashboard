import path from 'path'
import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import {
  buildServiceDashboardPreviewPayload,
  fillServiceDashboardWorksheet,
  toArrayBuffer,
  type KiaServiceDashboardExport,
  type KiaServiceDashboardPreview,
  type ServiceDashboardMetrics,
} from '@/lib/kia/service-dashboard-export'
import { fetchHyundaiMonthlyOperationMetrics } from '@/lib/hyundai/business-excellence-operations'
import { getHyundaiDealerCodes, hyundaiSourceDealerFilter } from '@/lib/hyundai/dealer-branch'
import {
  HYUNDAI_BE_CALCULATION_META,
  hyundaiActiveBillSql,
  hyundaiRoBillingDealerFilter,
  hyundaiRoBillingInvoiceKeySql,
  hyundaiRoBillingRoKeySql,
} from '@/lib/hyundai/business-excellence-calculations'

type DealerFilter = string | null
type Row = Record<string, unknown>
type ServiceCategory = 'Free Service' | 'Paid Service' | 'Running Repair' | 'Accidental Repair'

const CATEGORIES: ServiceCategory[] = ['Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair']
const VERSION = 'hyundai-service-dashboard-v4'
const TEMPLATE = path.join(process.cwd(), 'templates', 'platinum', 'service-dashboard-template.xlsx')

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : []
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDate(value: string | null | undefined) {
  const normalized = String(value || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`
}

function codeList(dealerCode: DealerFilter) {
  const codes = getHyundaiDealerCodes(dealerCode)
  return codes.length ? sql.join(codes.map((code) => sql`${code}`), sql`, `) : null
}

function roDealerFilter(dealerCode: DealerFilter) {
  return hyundaiRoBillingDealerFilter(dealerCode)
}

function repairDealerFilter(dealerCode: DealerFilter, alias = '') {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw(`${alias}source_dealer_code`),
    [sql.raw(`${alias}dealer_code`), sql.raw(`${alias}dealer`)],
  )
}

function categorySql(column: string) {
  const source = sql.raw(column)
  return sql`
    CASE
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%accident%'
        OR LOWER(COALESCE(${source}::text, '')) LIKE '%bodyshop%' THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%running%' THEN 'Running Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%free%' THEN 'Free Service'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%paid%'
        OR COALESCE(${source}::text, '') ~* '^[0-9]+K$' THEN 'Paid Service'
      ELSE 'Others'
    END
  `
}

function emptyCategories() {
  return Object.fromEntries(CATEGORIES.map((category) => [category, { today: 0, mtd: 0 }])) as ServiceDashboardMetrics['intake']
}

async function exists(table: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS exists`)
  return Boolean(rows(result)[0]?.exists)
}

async function resolveDate(requested: string | null, dealerCode: DealerFilter) {
  const parsed = parseDate(requested)
  if (parsed) return parsed
  const result = await db.execute(sql`
    SELECT MAX(bill_date)::text AS max_date
    FROM hyundai_ro_billing_report
    WHERE bill_date IS NOT NULL ${roDealerFilter(dealerCode)}
  `)
  return parseDate(String(rows(result)[0]?.max_date || '')) || new Date().toISOString().slice(0, 10)
}

async function fetchIntake(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH combined AS (
      SELECT COALESCE(NULLIF(TRIM(r_o_no), ''), NULLIF(TRIM(bill_no), ''), id::text) AS ro_key,
        r_o_date::date AS report_date, ${categorySql('work_type')} AS category, uploaded_at, id
      FROM hyundai_ro_billing_report
      WHERE r_o_date >= ${startDate}::date AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roDealerFilter(dealerCode)}
      UNION ALL
      SELECT COALESCE(NULLIF(TRIM(r_o_no), ''), id::text), r_o_date::date,
        ${categorySql('work_type')}, uploaded_at, id
      FROM hyundai_repair_order_list
      WHERE r_o_date >= ${startDate}::date AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(COALESCE(r_o_status, '')) = 'open'
        ${repairDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT DISTINCT ON (ro_key) ro_key, report_date, category
      FROM combined ORDER BY ro_key, report_date ASC, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT category,
      COUNT(*) FILTER (WHERE report_date = ${endDate}::date)::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup WHERE category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY category
  `)
  const output = emptyCategories()
  for (const row of rows(result)) {
    const category = String(row.category) as ServiceCategory
    if (CATEGORIES.includes(category)) output[category] = { today: numberValue(row.today), mtd: numberValue(row.mtd) }
  }
  return output
}

async function fetchRevenue(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH raw AS (
      SELECT bill_date::date AS report_date, ${categorySql('work_type')} AS category,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        COALESCE(labour_amt, 0)::numeric AS labour, COALESCE(part_amt, 0)::numeric AS parts,
        uploaded_at, id
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${hyundaiActiveBillSql()}
        ${roDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT DISTINCT ON (invoice_key) report_date, category, invoice_key, ro_key, labour, parts
      FROM raw ORDER BY invoice_key, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT category,
      COUNT(DISTINCT ro_key) FILTER (WHERE report_date = ${endDate}::date)::int AS today_count,
      COUNT(DISTINCT ro_key)::int AS mtd_count,
      COALESCE(SUM(labour) FILTER (WHERE report_date = ${endDate}::date),0)::float AS today_labour,
      COALESCE(SUM(labour),0)::float AS mtd_labour,
      COALESCE(SUM(parts) FILTER (WHERE report_date = ${endDate}::date),0)::float AS today_parts,
      COALESCE(SUM(parts),0)::float AS mtd_parts
    FROM dedup WHERE category IN ('Free Service','Paid Service','Running Repair','Accidental Repair')
    GROUP BY category
  `)
  const delivered = emptyCategories()
  const totals = {
    mechanicalLabour: { today: 0, mtd: 0 },
    mechanicalParts: { today: 0, mtd: 0 },
    bodyshopLabour: { today: 0, mtd: 0 },
    bodyshopParts: { today: 0, mtd: 0 },
  }
  for (const row of rows(result)) {
    const category = String(row.category) as ServiceCategory
    if (!CATEGORIES.includes(category)) continue
    delivered[category] = { today: numberValue(row.today_count), mtd: numberValue(row.mtd_count) }
    const target = category === 'Accidental Repair' ? 'bodyshop' : 'mechanical'
    totals[`${target}Labour`].today += numberValue(row.today_labour)
    totals[`${target}Labour`].mtd += numberValue(row.mtd_labour)
    totals[`${target}Parts`].today += numberValue(row.today_parts)
    totals[`${target}Parts`].mtd += numberValue(row.mtd_parts)
  }
  return { delivered, ...totals }
}

async function fetchPending(endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(r_o_no), ''), id::text))
        r_o_date::date AS report_date, ${categorySql('work_type')} AS category
      FROM hyundai_repair_order_list
      WHERE r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(COALESCE(r_o_status, '')) = 'open' ${repairDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(TRIM(r_o_no), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE category='Accidental Repair' AND report_date=${endDate}::date)::int AS accidental_today,
      COUNT(*) FILTER (WHERE category='Accidental Repair')::int AS accidental_mtd,
      COUNT(*) FILTER (WHERE category<>'Accidental Repair' AND report_date=${endDate}::date)::int AS mechanical_today,
      COUNT(*) FILTER (WHERE category<>'Accidental Repair')::int AS mechanical_mtd
    FROM latest
  `)
  const row = rows(result)[0] || {}
  return {
    accidental: { today: numberValue(row.accidental_today), mtd: numberValue(row.accidental_mtd) },
    mechanical: { today: numberValue(row.mechanical_today), mtd: numberValue(row.mechanical_mtd) },
  }
}

async function fetchAddons(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const empty = { today: 0, mtd: 0 }
  const [hasEw, hasRsa, hasMcp] = await Promise.all([
    exists('hyundai_ew_report'), exists('am_hyundai_rsa_report'), exists('am_hyundai_mcp_report'),
  ])
  const codes = codeList(dealerCode)
  const [ew, rsa, mcp] = await Promise.all([
    hasEw ? db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE reg_date=${endDate}::date)::int AS today, COUNT(*)::int AS mtd
      FROM hyundai_ew_report
      WHERE reg_date >= ${startDate}::date AND reg_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(department,'')))='service'
        ${codes ? sql`AND UPPER(TRIM(COALESCE(dlr_no,''))) IN (${codes})` : sql``}
    `) : Promise.resolve([]),
    hasRsa ? db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE invoice_date=${endDate}::date)::int AS today, COUNT(*)::int AS mtd
      FROM am_hyundai_rsa_report
      WHERE invoice_date >= ${startDate}::date AND invoice_date < (${endDate}::date + INTERVAL '1 day')
    `) : Promise.resolve([]),
    hasMcp ? db.execute(sql`
      SELECT COUNT(*) FILTER (WHERE package_purchase_date=${endDate}::date)::int AS today, COUNT(*)::int AS mtd
      FROM am_hyundai_mcp_report
      WHERE package_purchase_date >= ${startDate}::date
        AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(department,'')))='service'
    `) : Promise.resolve([]),
  ])
  const pair = (result: unknown) => {
    const row = rows(result)[0] || {}
    return { today: numberValue(row.today), mtd: numberValue(row.mtd) }
  }
  return {
    ew: hasEw ? pair(ew) : empty,
    rsa: hasRsa ? pair(rsa) : empty,
    mcp: hasMcp ? pair(mcp) : empty,
    bodyshopMcp: empty,
    warnings: [
      ...(!hasEw ? ['Hyundai EW source is unavailable.'] : []),
      ...(!hasRsa ? ['Hyundai RSA source is unavailable.'] : []),
      ...(hasRsa && dealerCode ? ['Hyundai RSA is not dealer-scoped because its source has no verified dealer field.'] : []),
      ...(!hasMcp ? ['Hyundai MCP source is unavailable.'] : []),
    ],
  }
}

async function buildMetrics(endDate: string | null, dealerCode: DealerFilter): Promise<ServiceDashboardMetrics> {
  const exportDate = await resolveDate(endDate, dealerCode)
  const startDate = monthStart(exportDate)
  const [intake, pending, revenue, addons, operations, workingDays] = await Promise.all([
    fetchIntake(startDate, exportDate, dealerCode),
    fetchPending(exportDate, dealerCode),
    fetchRevenue(startDate, exportDate, dealerCode),
    fetchAddons(startDate, exportDate, dealerCode),
    fetchHyundaiMonthlyOperationMetrics(exportDate, dealerCode),
    db.execute(sql`
      SELECT COUNT(DISTINCT bill_date)::int AS count
      FROM hyundai_ro_billing_report
      WHERE bill_date >= ${startDate}::date AND bill_date < (${exportDate}::date + INTERVAL '1 day')
        ${roDealerFilter(dealerCode)}
    `),
  ])
  const warnings = [
    'Oil rows are N/A until validated Hyundai oil-code rules are configured.',
    'Bodyshop PNA is N/A because the Hyundai RO source has no validated PNA field.',
    ...addons.warnings,
    ...(!operations.available ? ['No Hyundai Operation Wise snapshot exists for the selected month.'] : []),
    ...(operations.available && operations.classifiedRows === 0
      ? ['Hyundai Operation Wise snapshot contains no classified VAS/WA/WB rows; zeroes are source-incomplete, not verified business zeroes.']
      : []),
  ]
  return {
    exportDate,
    monthStart: startDate,
    intake,
    pending,
    revenue,
    addons: { ew: addons.ew, rsa: addons.rsa, mcp: addons.mcp, bodyshopMcp: addons.bodyshopMcp },
    operations: {
      alignmentCount: operations.waCount,
      balancingCount: operations.wbCount,
      alignmentLabour: operations.waAmount,
      balancingLabour: operations.wbAmount,
    },
    oil: { engineOilQty: { today: 0, mtd: 0 }, syntheticOilQty: { today: 0, mtd: 0 } },
    vasAmount: operations.vasAmount,
    bodyshopPnaCases: 0,
    unavailableRows: [35, 36, 37, 38, 39, 40, 42],
    sourceWarnings: warnings,
    sourceMetadata: {
      brand: 'hyundai',
      ...HYUNDAI_BE_CALCULATION_META,
      dealerCode,
      startDate,
      endDate: exportDate,
      operationPeriodStart: operations.periodStart,
      operationPeriodEnd: operations.periodEnd,
      workingDayCount: numberValue(rows(workingDays)[0]?.count),
      identifierVersion: operations.identifierVersion,
      operationSourceRows: operations.sourceRows,
      operationClassifiedRows: operations.classifiedRows,
      operationUnknownCodeRows: operations.unknownCodeRows,
      sourceWarnings: warnings,
    },
  }
}

function cacheKey(kind: 'metrics' | 'preview', date: string, dealerCode: DealerFilter) {
  return `hyundai:service-dashboard:${kind}:${VERSION}:${dealerCode || 'all'}:${date}`
}

async function metrics(endDate: string | null, dealerCode: DealerFilter) {
  const resolved = await resolveDate(endDate, dealerCode)
  return getCachedData(cacheKey('metrics', resolved, dealerCode), () => buildMetrics(resolved, dealerCode), CACHE_TTL.DASHBOARD)
}

async function workbook(endDate: string | null, dealerCode: DealerFilter) {
  const dashboardMetrics = await metrics(endDate, dealerCode)
  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile(TEMPLATE)
  book.worksheets.filter((sheet) => sheet.name !== 'Service Dashboard').forEach((sheet) => book.removeWorksheet(sheet.id))
  const sheet = book.getWorksheet('Service Dashboard') || book.worksheets[0]
  if (!sheet) throw new Error('Hyundai Service Dashboard template sheet is missing')
  fillServiceDashboardWorksheet(sheet, dashboardMetrics)
  sheet.getCell('A1').value = `HYUNDAI | DATE | ${dashboardMetrics.exportDate}`
  book.creator = 'AM Hyundai Dashboard'
  book.modified = new Date()
  book.calcProperties.fullCalcOnLoad = true
  return {
    book,
    sheet,
    metrics: dashboardMetrics,
    fileName: `AM_HYUNDAI_Service_Dashboard_${dashboardMetrics.exportDate}.xlsx`,
  }
}

export async function buildHyundaiServiceDashboardExport(options: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardExport> {
  const result = await workbook(options.endDate || null, options.dealerCode || null)
  const output = await result.book.xlsx.writeBuffer()
  return { buffer: toArrayBuffer(output as unknown as ArrayBuffer | Uint8Array), fileName: result.fileName, metrics: result.metrics }
}

export async function buildHyundaiServiceDashboardPreview(options: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardPreview> {
  const resolved = await resolveDate(options.endDate || null, options.dealerCode || null)
  return getCachedData(cacheKey('preview', resolved, options.dealerCode || null), async () => {
    const result = await workbook(resolved, options.dealerCode || null)
    return buildServiceDashboardPreviewPayload(result.sheet, result.metrics, result.fileName)
  }, CACHE_TTL.DASHBOARD)
}
