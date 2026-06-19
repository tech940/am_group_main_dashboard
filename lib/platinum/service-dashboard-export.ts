import path from 'path'
import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { CACHE_TTL } from '@/lib/redis/client'
import { getCachedData } from '@/lib/redis/cache-utils'
import {
  buildServiceDashboardPreviewPayload,
  fillServiceDashboardWorksheet,
  toArrayBuffer,
  type KiaServiceDashboardExport,
  type KiaServiceDashboardPreview,
  type ServiceDashboardMetrics,
} from '@/lib/kia/service-dashboard-export'
import {
  platinumActiveBillSql,
  platinumRoBillingDealerFilter,
  platinumRoBillingDealerSql,
  platinumRoBillingInvoiceKeySql,
  platinumRoBillingRoKeySql,
} from '@/lib/platinum/business-excellence-calculations'
import { fetchPlatinumWorkshopVasAmount } from '@/lib/platinum/business-excellence-vas'
import { platinumSourceDealerFilter, platinumSourceDealerSql } from '@/lib/platinum/dealer-filter'
import {
  platinumVasCodeSql,
  platinumWheelAlignmentCodeSql,
  platinumWheelBalancingCodeSql,
} from '@/lib/platinum/vas-identifiers'

type DealerFilter = string | null
type NumericRow = Record<string, unknown>
type ServiceCategory = 'Free Service' | 'Paid Service' | 'Running Repair' | 'Accidental Repair'

const SERVICE_CATEGORIES: ServiceCategory[] = [
  'Free Service',
  'Paid Service',
  'Running Repair',
  'Accidental Repair',
]
const PLATINUM_SERVICE_DASHBOARD_VERSION = 'platinum-service-dashboard-v3'
const SERVICE_DASHBOARD_TEMPLATE = path.join(
  process.cwd(),
  'templates',
  'platinum',
  'service-dashboard-template.xlsx',
)

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? result as NumericRow[] : []
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDateInput(value: string | null | undefined) {
  const normalized = String(value || '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null
}

function monthStart(value: string) {
  return `${value.slice(0, 7)}-01`
}

function serviceCategorySql(column = 'work_type') {
  const source = sql.raw(column)
  return sql`
    CASE
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%accident%'
        OR LOWER(COALESCE(${source}::text, '')) LIKE '%bodyshop%'
        THEN 'Accidental Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%running%'
        THEN 'Running Repair'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%free%'
        THEN 'Free Service'
      WHEN LOWER(COALESCE(${source}::text, '')) LIKE '%paid%'
        OR COALESCE(${source}::text, '') ~* '^[0-9]+K$'
        THEN 'Paid Service'
      ELSE 'Others'
    END
  `
}

function emptyCategoryCounts() {
  return Object.fromEntries(
    SERVICE_CATEGORIES.map((category) => [category, { today: 0, mtd: 0 }]),
  ) as ServiceDashboardMetrics['intake']
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
}

async function resolveExportDate(requested: string | null, dealerCode: DealerFilter) {
  const parsed = parseDateInput(requested)
  if (parsed) return parsed
  const result = await db.execute(sql`
    SELECT MAX(bill_date)::text AS max_date
    FROM am_platinum_ro_billing_report
    WHERE bill_date IS NOT NULL
      ${platinumRoBillingDealerFilter(dealerCode)}
  `)
  return parseDateInput(String(resultRows(result)[0]?.max_date || ''))
    || new Date().toISOString().slice(0, 10)
}

async function fetchIntake(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH combined AS (
      SELECT
        COALESCE(${platinumRoBillingDealerSql()}, 'UNMAPPED') || ':' ||
          COALESCE(NULLIF(TRIM(r_o_no::text), ''), NULLIF(TRIM(bill_no::text), ''), id::text) AS ro_key,
        r_o_date::date AS report_date,
        ${serviceCategorySql('work_type')} AS category,
        uploaded_at,
        id
      FROM am_platinum_ro_billing_report
      WHERE r_o_date >= ${startDate}::date
        AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND ${platinumActiveBillSql()}
        ${platinumRoBillingDealerFilter(dealerCode)}

      UNION ALL

      SELECT
        COALESCE(${platinumSourceDealerSql(
          sql.raw('source_dealer_code'),
          [sql.raw('dealer')],
        )}, 'UNMAPPED') || ':' || COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text) AS ro_key,
        r_o_date::date AS report_date,
        ${serviceCategorySql('work_type')} AS category,
        uploaded_at,
        id
      FROM am_platinum_repair_order_list
      WHERE r_o_date >= ${startDate}::date
        AND r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(COALESCE(r_o_status, '')) = 'open'
        ${platinumSourceDealerFilter(
          dealerCode,
          sql.raw('source_dealer_code'),
          [sql.raw('dealer')],
        )}
    ),
    dedup AS (
      SELECT DISTINCT ON (ro_key)
        ro_key, report_date, category
      FROM combined
      ORDER BY ro_key, report_date ASC, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      category,
      COUNT(*) FILTER (WHERE report_date = ${endDate}::date)::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup
    WHERE category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY category
  `)

  const counts = emptyCategoryCounts()
  for (const row of resultRows(result)) {
    const category = String(row.category || '') as ServiceCategory
    if (SERVICE_CATEGORIES.includes(category)) {
      counts[category] = { today: numberValue(row.today), mtd: numberValue(row.mtd) }
    }
  }
  return counts
}

async function fetchRevenue(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        ${platinumRoBillingInvoiceKeySql()} AS invoice_key,
        ${platinumRoBillingRoKeySql()} AS ro_key,
        bill_date::date AS report_date,
        ${serviceCategorySql('work_type')} AS category,
        COALESCE(labour_amt, 0)::numeric AS labour_amount,
        COALESCE(part_amt, 0)::numeric AS part_amount,
        uploaded_at,
        id
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
        AND ${platinumActiveBillSql()}
        ${platinumRoBillingDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT DISTINCT ON (invoice_key)
        invoice_key, ro_key, report_date, category, labour_amount, part_amount
      FROM raw
      ORDER BY invoice_key, uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      category,
      COUNT(DISTINCT ro_key) FILTER (WHERE report_date = ${endDate}::date)::int AS today_count,
      COUNT(DISTINCT ro_key)::int AS mtd_count,
      COALESCE(SUM(labour_amount) FILTER (WHERE report_date = ${endDate}::date), 0)::float AS today_labour,
      COALESCE(SUM(labour_amount), 0)::float AS mtd_labour,
      COALESCE(SUM(part_amount) FILTER (WHERE report_date = ${endDate}::date), 0)::float AS today_parts,
      COALESCE(SUM(part_amount), 0)::float AS mtd_parts
    FROM dedup
    WHERE category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY category
  `)

  const delivered = emptyCategoryCounts()
  const totals = {
    mechanicalLabour: { today: 0, mtd: 0 },
    mechanicalParts: { today: 0, mtd: 0 },
    bodyshopLabour: { today: 0, mtd: 0 },
    bodyshopParts: { today: 0, mtd: 0 },
  }
  for (const row of resultRows(result)) {
    const category = String(row.category || '') as ServiceCategory
    if (!SERVICE_CATEGORIES.includes(category)) continue
    delivered[category] = {
      today: numberValue(row.today_count),
      mtd: numberValue(row.mtd_count),
    }
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
      SELECT DISTINCT ON (
        COALESCE(${platinumSourceDealerSql(
          sql.raw('source_dealer_code'),
          [sql.raw('dealer')],
        )}, 'UNMAPPED'),
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text)
      )
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text) AS ro_key,
        r_o_date::date AS report_date,
        ${serviceCategorySql('work_type')} AS category
      FROM am_platinum_repair_order_list
      WHERE r_o_date < (${endDate}::date + INTERVAL '1 day')
        AND LOWER(COALESCE(r_o_status, '')) = 'open'
        ${platinumSourceDealerFilter(
          dealerCode,
          sql.raw('source_dealer_code'),
          [sql.raw('dealer')],
        )}
      ORDER BY
        COALESCE(${platinumSourceDealerSql(
          sql.raw('source_dealer_code'),
          [sql.raw('dealer')],
        )}, 'UNMAPPED'),
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), id::text),
        uploaded_at DESC NULLS LAST,
        id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE category = 'Accidental Repair' AND report_date = ${endDate}::date)::int AS accidental_today,
      COUNT(*) FILTER (WHERE category = 'Accidental Repair')::int AS accidental_mtd,
      COUNT(*) FILTER (WHERE category <> 'Accidental Repair' AND report_date = ${endDate}::date)::int AS mechanical_today,
      COUNT(*) FILTER (WHERE category <> 'Accidental Repair')::int AS mechanical_mtd
    FROM latest
  `)
  const row = resultRows(result)[0] || {}
  return {
    accidental: { today: numberValue(row.accidental_today), mtd: numberValue(row.accidental_mtd) },
    mechanical: { today: numberValue(row.mechanical_today), mtd: numberValue(row.mechanical_mtd) },
  }
}

async function fetchOperations(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH candidate_period AS (
      SELECT report_period_start::date AS period_start, report_period_end::date AS period_end
      FROM am_platinum_operation_wise_analysis_report
      WHERE date_trunc('month', report_period_start)::date = date_trunc('month', ${endDate}::date)::date
        ${platinumSourceDealerFilter(dealerCode)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY
        report_period_end::date DESC,
        report_period_start::date DESC
      LIMIT 1
    ),
    latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        source.op_part_code,
        source.report_type,
        COALESCE(source.total_count, 0)::numeric AS operation_count,
        COALESCE(source.total_amt, 0)::numeric AS amount
      FROM am_platinum_operation_wise_analysis_report source
      JOIN candidate_period period
        ON source.report_period_start::date = period.period_start
       AND source.report_period_end::date = period.period_end
      WHERE 1 = 1
        ${platinumSourceDealerFilter(dealerCode, sql.raw('source.source_dealer_code'))}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE ${platinumWheelAlignmentCodeSql(sql.raw('op_part_code'))})::float AS alignment_count,
      COUNT(*) FILTER (WHERE ${platinumWheelBalancingCodeSql(sql.raw('op_part_code'))})::float AS balancing_count,
      COALESCE(SUM(amount) FILTER (WHERE ${platinumWheelAlignmentCodeSql(sql.raw('op_part_code'))}), 0)::float AS alignment_labour,
      COALESCE(SUM(amount) FILTER (WHERE ${platinumWheelBalancingCodeSql(sql.raw('op_part_code'))}), 0)::float AS balancing_labour,
      COALESCE(SUM(amount) FILTER (WHERE LOWER(COALESCE(report_type, '')) IN ('operation', 'part') AND ${platinumVasCodeSql(sql.raw('op_part_code'))}), 0)::float AS vas_amount
    FROM latest
  `)
  const row = resultRows(result)[0] || {}
  return {
    alignmentCount: numberValue(row.alignment_count),
    balancingCount: numberValue(row.balancing_count),
    alignmentLabour: numberValue(row.alignment_labour),
    balancingLabour: numberValue(row.balancing_labour),
    vasAmount: numberValue(row.vas_amount),
  }
}

async function fetchAddons(startDate: string, endDate: string, dealerCode: DealerFilter) {
  const empty = { today: 0, mtd: 0 }
  const [hasEw, hasRsa, hasTrustPackage] = await Promise.all([
    tableExists('am_platinum_ew_report'),
    tableExists('am_platinum_rsa_report'),
    tableExists('am_platinum_trust_package'),
  ])

  const [ewResult, rsaResult, mcpResult] = await Promise.all([
    hasEw ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(TRIM(vin), ''), id::text)
        )
          reg_date::date AS report_date
        FROM am_platinum_ew_report
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
          ${platinumSourceDealerFilter(dealerCode)}
        ORDER BY
          COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(TRIM(vin), ''), id::text),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT COUNT(*) FILTER (WHERE report_date = ${endDate}::date)::int AS today, COUNT(*)::int AS mtd
      FROM dedup
    `) : Promise.resolve([]),
    hasRsa ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(invoice_no), ''), NULLIF(TRIM(vin_chasis_no), ''), id::text)
        )
          invoice_date::date AS report_date
        FROM am_platinum_rsa_report
        WHERE invoice_date >= ${startDate}::date
          AND invoice_date < (${endDate}::date + INTERVAL '1 day')
        ORDER BY
          COALESCE(NULLIF(TRIM(invoice_no), ''), NULLIF(TRIM(vin_chasis_no), ''), id::text),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT COUNT(*) FILTER (WHERE report_date = ${endDate}::date)::int AS today, COUNT(*)::int AS mtd
      FROM dedup
    `) : Promise.resolve([]),
    hasTrustPackage ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(cert_no), ''), NULLIF(TRIM(vin), ''), id::text)
        )
          reg_date::date AS report_date,
          LOWER(CONCAT_WS(' ', trust_package_section, scheme_desc, department)) AS classification
        FROM am_platinum_trust_package
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
          ${platinumSourceDealerFilter(dealerCode)}
        ORDER BY
          COALESCE(NULLIF(TRIM(cert_no), ''), NULLIF(TRIM(vin), ''), id::text),
          uploaded_at DESC NULLS LAST,
          id DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE report_date = ${endDate}::date)::int AS today,
        COUNT(*)::int AS mtd,
        COUNT(*) FILTER (WHERE classification ~ '(body|accident)' AND report_date = ${endDate}::date)::int AS bodyshop_today,
        COUNT(*) FILTER (WHERE classification ~ '(body|accident)')::int AS bodyshop_mtd
      FROM dedup
    `) : Promise.resolve([]),
  ])

  const pair = (result: unknown) => {
    const row = resultRows(result)[0] || {}
    return { today: numberValue(row.today), mtd: numberValue(row.mtd) }
  }
  const mcpRow = resultRows(mcpResult)[0] || {}
  return {
    ew: hasEw ? pair(ewResult) : empty,
    rsa: hasRsa ? pair(rsaResult) : empty,
    mcp: hasTrustPackage ? pair(mcpResult) : empty,
    bodyshopMcp: hasTrustPackage
      ? { today: numberValue(mcpRow.bodyshop_today), mtd: numberValue(mcpRow.bodyshop_mtd) }
      : empty,
    warnings: [
      ...(!hasEw ? ['Extended-warranty source is unavailable.'] : []),
      ...(!hasRsa ? ['RSA source is unavailable.'] : []),
      ...(hasRsa && dealerCode ? ['RSA is not dealer-scoped because the current source has no verified Platinum dealer field.'] : []),
      ...(!hasTrustPackage ? ['Trust-package source is unavailable.'] : []),
    ],
  }
}

async function buildMetrics(endDate: string | null, dealerCode: DealerFilter): Promise<ServiceDashboardMetrics> {
  const exportDate = await resolveExportDate(endDate, dealerCode)
  const startDate = monthStart(exportDate)
  const [intake, pending, revenue, addons, operations, vas, workingDays] = await Promise.all([
    fetchIntake(startDate, exportDate, dealerCode),
    fetchPending(exportDate, dealerCode),
    fetchRevenue(startDate, exportDate, dealerCode),
    fetchAddons(startDate, exportDate, dealerCode),
    fetchOperations(startDate, exportDate, dealerCode),
    fetchPlatinumWorkshopVasAmount(startDate, exportDate, dealerCode),
    db.execute(sql`
      SELECT COUNT(DISTINCT bill_date)::int AS count
      FROM am_platinum_ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${exportDate}::date + INTERVAL '1 day')
        AND ${platinumActiveBillSql()}
        ${platinumRoBillingDealerFilter(dealerCode)}
    `),
  ])

  const sourceWarnings = [
    'Oil-related rows are N/A because no validated Platinum oil source is configured.',
    'Bodyshop PNA is N/A because the Platinum Repair Order source has no verified PNA field.',
    ...addons.warnings,
    ...(vas.unknownCodeRows > 0
      ? [`${vas.unknownCodeRows} operation rows use unknown codes and were excluded from VAS.`]
      : []),
  ]

  return {
    exportDate,
    monthStart: startDate,
    intake,
    pending,
    revenue,
    addons: {
      ew: addons.ew,
      rsa: addons.rsa,
      mcp: addons.mcp,
      bodyshopMcp: addons.bodyshopMcp,
    },
    operations: {
      alignmentCount: operations.alignmentCount,
      balancingCount: operations.balancingCount,
      alignmentLabour: operations.alignmentLabour,
      balancingLabour: operations.balancingLabour,
    },
    oil: {
      engineOilQty: { today: 0, mtd: 0 },
      syntheticOilQty: { today: 0, mtd: 0 },
    },
    vasAmount: vas.available ? vas.amount : operations.vasAmount,
    bodyshopPnaCases: 0,
    unavailableRows: [35, 36, 37, 38, 39, 40, 42],
    sourceWarnings,
    sourceMetadata: {
      brand: 'platinum',
      dealerCode,
      startDate,
      endDate: exportDate,
      dateBasis: 'r_o_date intake/pending; bill_date delivered/revenue; source report periods for VAS/WA/WB',
      workingDayCount: numberValue(resultRows(workingDays)[0]?.count),
      identifierVersion: vas.identifierVersion,
      vasMatchedRows: vas.matchedRows,
      vasUnknownCodeRows: vas.unknownCodeRows,
      sourceWarnings,
    },
  }
}

function cacheKey(kind: 'metrics' | 'preview', endDate: string, dealerCode: DealerFilter) {
  return `platinum:service-dashboard:${kind}:${PLATINUM_SERVICE_DASHBOARD_VERSION}:${dealerCode || 'all'}:${endDate}`
}

async function getMetrics(endDate: string | null, dealerCode: DealerFilter) {
  const resolvedEndDate = await resolveExportDate(endDate, dealerCode)
  return getCachedData(
    cacheKey('metrics', resolvedEndDate, dealerCode),
    () => buildMetrics(resolvedEndDate, dealerCode),
    CACHE_TTL.DASHBOARD,
  )
}

async function buildWorkbook(endDate: string | null, dealerCode: DealerFilter) {
  const metrics = await getMetrics(endDate, dealerCode)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(SERVICE_DASHBOARD_TEMPLATE)
  workbook.worksheets
    .filter((worksheet) => worksheet.name !== 'Service Dashboard')
    .forEach((worksheet) => workbook.removeWorksheet(worksheet.id))
  const worksheet = workbook.getWorksheet('Service Dashboard') || workbook.worksheets[0]
  if (!worksheet) throw new Error('Platinum Service Dashboard template sheet is missing')

  fillServiceDashboardWorksheet(worksheet, metrics)
  worksheet.getCell('A1').value = `PLATINUM | DATE | ${metrics.exportDate}`
  workbook.creator = 'AM Platinum Dashboard'
  workbook.lastModifiedBy = 'AM Platinum Dashboard'
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  return {
    workbook,
    worksheet,
    metrics,
    fileName: `AM_PLATINUM_Service_Dashboard_${metrics.exportDate}.xlsx`,
  }
}

export async function buildPlatinumServiceDashboardExport({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardExport> {
  const { workbook, metrics, fileName } = await buildWorkbook(endDate || null, dealerCode || null)
  const output = await workbook.xlsx.writeBuffer()
  return {
    buffer: toArrayBuffer(output as unknown as ArrayBuffer | Uint8Array),
    fileName,
    metrics,
  }
}

export async function buildPlatinumServiceDashboardPreview({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardPreview> {
  const resolvedEndDate = await resolveExportDate(endDate || null, dealerCode || null)
  return getCachedData(
    cacheKey('preview', resolvedEndDate, dealerCode || null),
    async () => {
      const { worksheet, metrics, fileName } = await buildWorkbook(resolvedEndDate, dealerCode || null)
      return buildServiceDashboardPreviewPayload(worksheet, metrics, fileName)
    },
    CACHE_TTL.DASHBOARD,
  )
}
