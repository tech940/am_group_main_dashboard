import path from 'path'
import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'

type DealerFilter = string | null
type NumericRow = Record<string, unknown>

const SERVICE_DASHBOARD_TEMPLATE = path.join(process.cwd(), 'templates', 'kia', 'service-dashboard-template.xlsx')
const SERVICE_CATEGORIES = ['Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair'] as const

type ServiceCategory = typeof SERVICE_CATEGORIES[number]

type CountPair = {
  today: number
  mtd: number
}

type AmountPair = {
  today: number
  mtd: number
}

type ServiceDashboardMetrics = {
  exportDate: string
  monthStart: string
  intake: Record<ServiceCategory, CountPair>
  pending: {
    accidental: CountPair
    mechanical: CountPair
  }
  addons: {
    ew: CountPair
    rsa: CountPair
    mcp: CountPair
    bodyshopMcp: CountPair
  }
  revenue: {
    delivered: Record<ServiceCategory, CountPair>
    mechanicalLabour: AmountPair
    mechanicalParts: AmountPair
    bodyshopLabour: AmountPair
    bodyshopParts: AmountPair
  }
  operations: {
    alignmentCount: number
    balancingCount: number
    alignmentLabour: number
    balancingLabour: number
  }
  oil: {
    engineOilQty: AmountPair
    syntheticOilQty: AmountPair
  }
  vasAmount: number
}

export type KiaServiceDashboardExport = {
  buffer: ArrayBuffer
  fileName: string
  metrics: ServiceDashboardMetrics
}

type ServiceDashboardPreviewCellStyle = {
  backgroundColor?: string
  color?: string
  fontWeight?: number
  fontSize?: number
  fontFamily?: string
  textAlign?: string
  verticalAlign?: string
  borderTop?: string
  borderRight?: string
  borderBottom?: string
  borderLeft?: string
  wrapText?: boolean
}

export type ServiceDashboardPreviewCell = {
  address: string
  row: number
  col: number
  text: string
  value: string | number | null
  colspan: number
  rowspan: number
  hidden: boolean
  style: ServiceDashboardPreviewCellStyle
}

export type KiaServiceDashboardPreview = {
  sheetName: string
  range: string
  fileName: string
  metrics: ServiceDashboardMetrics
  columns: Array<{ key: string; width: number }>
  rows: Array<{
    index: number
    height: number | null
    cells: ServiceDashboardPreviewCell[]
  }>
  merges: string[]
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null
  const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getMonthStart(value: string) {
  const [year, month] = value.split('-').map(Number)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function emptyCategoryCounts(): Record<ServiceCategory, CountPair> {
  return SERVICE_CATEGORIES.reduce((acc, category) => {
    acc[category] = { today: 0, mtd: 0 }
    return acc
  }, {} as Record<ServiceCategory, CountPair>)
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function tableExists(tableName: string) {
  return db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
    .then((result) => Boolean(resultRows(result)[0]?.exists))
}

function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

function roBillingDealerFilter(dealerCode: DealerFilter, alias = '') {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(${sql.raw(`${alias}dealer_code`)}, ''), NULLIF(${sql.raw(`${alias}main_dealer_code`)}, '')))) = ${dealerCode}`
    : sql``
}

function openRoDealerFilter(dealerCode: DealerFilter) {
  return dealerCode ? sql`
    AND EXISTS (
      SELECT 1
      FROM ro_billing_report rb
      WHERE UPPER(TRIM(COALESCE(NULLIF(rb.dealer_code, ''), NULLIF(rb.main_dealer_code, '')))) = ${dealerCode}
        AND (
          (
            NULLIF(TRIM(open_ro_yearly.vin), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(open_ro_yearly.vin))
          )
          OR (
            NULLIF(TRIM(open_ro_yearly.reg_no), '') IS NOT NULL
            AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(open_ro_yearly.reg_no))
          )
        )
    )
  ` : sql``
}

function operationDealerFilter(dealerCode: DealerFilter, alias = '') {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(${sql.raw(`${alias}dealer_code`)}, ''))) = ${dealerCode}`
    : sql``
}

function advWiseDealerFilter(dealerCode: DealerFilter, alias = '') {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(${sql.raw(`${alias}dealer_code`)}, ''), NULLIF(${sql.raw(`${alias}retail_dealer_code`)}, '')))) = ${dealerCode}`
    : sql``
}

function ewDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(outlet_code, ''), NULLIF(main_dealer_code, '')))) = ${dealerCode}`
    : sql``
}

function mcpDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dealer_code, ''))) = ${dealerCode}`
    : sql``
}

function rsaDealerFilter(dealerCode: DealerFilter) {
  return dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dealer_workshop_code, ''))) = ${dealerCode}`
    : sql``
}

function serviceCategoryExpression(workTypeColumn: string, serviceTypeColumn: string) {
  return sql`CASE
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%accident%'
      OR LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%bodyshop%'
      THEN 'Accidental Repair'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%running%'
      THEN 'Running Repair'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%free%'
      THEN 'Free Service'
    WHEN LOWER(CONCAT_WS(' ', ${sql.raw(workTypeColumn)}, ${sql.raw(serviceTypeColumn)})) LIKE '%paid%'
      OR COALESCE(${sql.raw(serviceTypeColumn)}, '') ~* '^[0-9]+K$'
      THEN 'Paid Service'
    ELSE COALESCE(NULLIF(${sql.raw(workTypeColumn)}, ''), NULLIF(${sql.raw(serviceTypeColumn)}, ''), 'Others')
  END`
}

function vasDescriptionFilter() {
  return sql`
    (
      description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
      OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
      OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
      OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
    )
    AND description !~ '(painting[[:space:]-]*charges[[:space:]-]*s1|removal[[:space:]]*&[[:space:]]*refit[[:space:]-]*work[[:space:]-]*s1)'
  `
}

async function resolveExportDate(requestedEndDate: string | null, dealerCode: DealerFilter) {
  if (requestedEndDate) return requestedEndDate

  const result = await db.execute(sql`
    SELECT MAX(bill_date)::text AS max_date
    FROM ro_billing_report
    WHERE bill_date IS NOT NULL
      ${roBillingDealerFilter(dealerCode)}
  `)

  return parseDateInput(String(resultRows(result)[0]?.max_date || '')) || toDateInputValue(new Date())
}

async function fetchIntakeCounts(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        ro_date::date AS report_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        uploaded_at,
        id
      FROM ro_billing_report
      WHERE ro_date >= ${monthStart}::date
        AND ro_date < (${exportDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (PARTITION BY jc_key ORDER BY report_date DESC, uploaded_at DESC NULLS LAST, id DESC) AS row_rank
      FROM raw
    ),
    dedup AS (
      SELECT *
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      service_category,
      COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup
    WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY service_category
  `)

  const counts = emptyCategoryCounts()
  resultRows(result).forEach((row) => {
    const category = String(row.service_category || '') as ServiceCategory
    if (SERVICE_CATEGORIES.includes(category)) {
      counts[category] = {
        today: numberValue(row.today),
        mtd: numberValue(row.mtd),
      }
    }
  })
  return counts
}

async function fetchRevenueAndDelivered(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH raw AS (
      SELECT
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        bill_date::date AS report_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        ${numericText(sql.raw('labour_amt'))} AS labour_amt,
        ${numericText(sql.raw('part_amt'))} AS part_amt,
        uploaded_at,
        id
      FROM ro_billing_report
      WHERE bill_date >= ${monthStart}::date
        AND bill_date < (${exportDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY jc_key
          ORDER BY ABS(labour_amt + part_amt) DESC, report_date DESC, uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM raw
    ),
    dedup AS (
      SELECT *
      FROM ranked
      WHERE row_rank = 1
    )
    SELECT
      service_category,
      COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today_count,
      COUNT(*)::int AS mtd_count,
      COALESCE(SUM(labour_amt) FILTER (WHERE report_date = ${exportDate}::date), 0)::float AS today_labour,
      COALESCE(SUM(labour_amt), 0)::float AS mtd_labour,
      COALESCE(SUM(part_amt) FILTER (WHERE report_date = ${exportDate}::date), 0)::float AS today_parts,
      COALESCE(SUM(part_amt), 0)::float AS mtd_parts
    FROM dedup
    WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY service_category
  `)

  const delivered = emptyCategoryCounts()
  const totals = {
    mechanicalLabour: { today: 0, mtd: 0 },
    mechanicalParts: { today: 0, mtd: 0 },
    bodyshopLabour: { today: 0, mtd: 0 },
    bodyshopParts: { today: 0, mtd: 0 },
  }

  resultRows(result).forEach((row) => {
    const category = String(row.service_category || '') as ServiceCategory
    if (!SERVICE_CATEGORIES.includes(category)) return

    delivered[category] = {
      today: numberValue(row.today_count),
      mtd: numberValue(row.mtd_count),
    }

    const labour: AmountPair = {
      today: numberValue(row.today_labour),
      mtd: numberValue(row.mtd_labour),
    }
    const parts: AmountPair = {
      today: numberValue(row.today_parts),
      mtd: numberValue(row.mtd_parts),
    }

    if (category === 'Accidental Repair') {
      totals.bodyshopLabour.today += labour.today
      totals.bodyshopLabour.mtd += labour.mtd
      totals.bodyshopParts.today += parts.today
      totals.bodyshopParts.mtd += parts.mtd
      return
    }

    totals.mechanicalLabour.today += labour.today
    totals.mechanicalLabour.mtd += labour.mtd
    totals.mechanicalParts.today += parts.today
    totals.mechanicalParts.mtd += parts.mtd
  })

  return { delivered, ...totals }
}

async function fetchPendingCounts(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH active AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(r_o_no, ''), id::text))
        ro_date::date AS report_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS service_category,
        uploaded_at,
        id
      FROM open_ro_yearly
      WHERE LOWER(COALESCE(status, '')) = 'open'
        AND ro_date >= ${monthStart}::date
        AND ro_date < (${exportDate}::date + INTERVAL '1 day')
        ${openRoDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(r_o_no, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT
      COUNT(*) FILTER (WHERE service_category = 'Accidental Repair' AND report_date = ${exportDate}::date)::int AS accidental_today,
      COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accidental_mtd,
      COUNT(*) FILTER (WHERE service_category <> 'Accidental Repair' AND report_date = ${exportDate}::date)::int AS mechanical_today,
      COUNT(*) FILTER (WHERE service_category <> 'Accidental Repair')::int AS mechanical_mtd
    FROM active
  `)

  const row = resultRows(result)[0] || {}
  return {
    accidental: { today: numberValue(row.accidental_today), mtd: numberValue(row.accidental_mtd) },
    mechanical: { today: numberValue(row.mechanical_today), mtd: numberValue(row.mechanical_mtd) },
  }
}

async function fetchAddonCounts(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const [hasEw, hasRsa, hasMcp] = await Promise.all([
    tableExists('ew_report'),
    tableExists('rsa_report'),
    tableExists('mcp_report'),
  ])

  const [ew, rsa, mcp, bodyshopMcp] = await Promise.all([
    hasEw ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text)
        )
          reg_date::date AS report_date
        FROM ew_report
        WHERE reg_date >= ${monthStart}::date
          AND reg_date < (${exportDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
          ${ewDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today,
        COUNT(*)::int AS mtd
      FROM dedup
    `) : Promise.resolve([{ today: 0, mtd: 0 }] as NumericRow[]),
    hasRsa ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text)
        )
          invoice_date::date AS report_date
        FROM rsa_report
        WHERE invoice_date >= ${monthStart}::date
          AND invoice_date < (${exportDate}::date + INTERVAL '1 day')
          ${rsaDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today,
        COUNT(*)::int AS mtd
      FROM dedup
    `) : Promise.resolve([{ today: 0, mtd: 0 }] as NumericRow[]),
    hasMcp ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text)
        )
          package_purchase_date::date AS report_date
        FROM mcp_report
        WHERE package_purchase_date >= ${monthStart}::date
          AND package_purchase_date < (${exportDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
          ${mcpDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today,
        COUNT(*)::int AS mtd
      FROM dedup
    `) : Promise.resolve([{ today: 0, mtd: 0 }] as NumericRow[]),
    hasMcp ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(reg_no), ''), package_purchase_date::text), id::text)
        )
          package_purchase_date::date AS report_date,
          vin,
          reg_no
        FROM mcp_report
        WHERE package_purchase_date >= ${monthStart}::date
          AND package_purchase_date < (${exportDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
          ${mcpDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(reg_no), ''), package_purchase_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      bodyshop AS (
        SELECT *
        FROM dedup source
        WHERE EXISTS (
          SELECT 1
          FROM ro_billing_report rb
          WHERE rb.bill_date >= ${monthStart}::date
            AND rb.bill_date < (${exportDate}::date + INTERVAL '1 day')
            AND ${activeBillStatusSql('rb.')}
            ${roBillingDealerFilter(dealerCode, 'rb.')}
            AND ${serviceCategoryExpression('rb.work_type', 'rb.service_type')} = 'Accidental Repair'
            AND (
              (
                NULLIF(TRIM(source.vin), '') IS NOT NULL
                AND UPPER(TRIM(COALESCE(rb.vin, ''))) = UPPER(TRIM(source.vin))
              )
              OR (
                NULLIF(TRIM(source.reg_no), '') IS NOT NULL
                AND UPPER(TRIM(COALESCE(rb.vehicle_reg_no, ''))) = UPPER(TRIM(source.reg_no))
              )
            )
        )
      )
      SELECT
        COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today,
        COUNT(*)::int AS mtd
      FROM bodyshop
    `) : Promise.resolve([{ today: 0, mtd: 0 }] as NumericRow[]),
  ])

  const readPair = (result: unknown): CountPair => {
    const row = resultRows(result)[0] || {}
    return { today: numberValue(row.today), mtd: numberValue(row.mtd) }
  }

  return {
    ew: readPair(ew),
    rsa: readPair(rsa),
    mcp: readPair(mcp),
    bodyshopMcp: readPair(bodyshopMcp),
  }
}

async function fetchOperationMetrics(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  if (!(await tableExists('operation_wise_analysis_report'))) {
    return { alignmentCount: 0, balancingCount: 0, alignmentLabour: 0, balancingLabour: 0 }
  }

  const result = await db.execute(sql`
    WITH latest_period AS (
      SELECT
        report_period_start::date AS report_period_start,
        report_period_end::date AS report_period_end
      FROM operation_wise_analysis_report
      WHERE report_period_start = ${monthStart}::date
        AND report_period_end <= ${exportDate}::date
        AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
        ${operationDealerFilter(dealerCode)}
      GROUP BY report_period_start::date, report_period_end::date
      ORDER BY report_period_end::date DESC
      LIMIT 1
    ),
    operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_count'))} AS operation_count,
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code
      FROM operation_wise_analysis_report source
      INNER JOIN latest_period
        ON source.report_period_start::date = latest_period.report_period_start
        AND source.report_period_end::date = latest_period.report_period_end
      WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
        ${operationDealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT
        *,
        (
          operation_code ~ '(^|[^a-z])wa([^a-z]|$)'
          OR description ~ '(wheel[[:space:]-]*alignment|alignment|align|(^|[^a-z])wa([^a-z]|$))'
        ) AS is_wa,
        (
          operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
          OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'
        ) AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::float AS alignment_count,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::float AS balancing_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS alignment_labour,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS balancing_labour
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  return {
    alignmentCount: numberValue(row.alignment_count),
    balancingCount: numberValue(row.balancing_count),
    alignmentLabour: numberValue(row.alignment_labour),
    balancingLabour: numberValue(row.balancing_labour),
  }
}

async function fetchVasAmount(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const hasOperationWise = await tableExists('operation_wise_analysis_report')
  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')

  if (hasOperationWise) {
    const result = await db.execute(sql`
      WITH latest_period AS (
        SELECT
          report_period_start::date AS report_period_start,
          report_period_end::date AS report_period_end
        FROM operation_wise_analysis_report
        WHERE report_period_start = ${monthStart}::date
          AND report_period_end <= ${exportDate}::date
          AND LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
          ${operationDealerFilter(dealerCode)}
        GROUP BY report_period_start::date, report_period_end::date
        ORDER BY report_period_end::date DESC
        LIMIT 1
      ),
      operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          ${numericText(sql.raw('source.total_amt'))} AS amount,
          LOWER(COALESCE(source.op_part_desc, '')) AS description
        FROM operation_wise_analysis_report source
        INNER JOIN latest_period
          ON source.report_period_start::date = latest_period.report_period_start
          AND source.report_period_end::date = latest_period.report_period_end
        WHERE LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
          ${operationDealerFilter(dealerCode, 'source.')}
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
      FROM operation_rows
      WHERE ${vasDescriptionFilter()}
    `)

    const amount = numberValue(resultRows(result)[0]?.vas_amount)
    if (amount > 0) return amount
  }

  if (!hasInvoiceWise) return 0

  const result = await db.execute(sql`
    WITH invoice_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        ${numericText(sql.raw('taxable_amount'))} AS amount,
        LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= ${monthStart}::date
        AND gst_invoice_date < (${exportDate}::date + INTERVAL '1 day')
        ${advWiseDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
    FROM invoice_rows
    WHERE ${vasDescriptionFilter()}
  `)

  return numberValue(resultRows(result)[0]?.vas_amount)
}

async function fetchOilMetrics(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  if (!(await tableExists('adv_wise_lubricants_vas'))) {
    return {
      engineOilQty: { today: 0, mtd: 0 },
      syntheticOilQty: { today: 0, mtd: 0 },
    }
  }

  const result = await db.execute(sql`
    WITH invoice_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
        gst_invoice_date::date AS report_date,
        ${numericText(sql.raw('qty_hrs'))} AS quantity,
        LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc, part_no)) AS description
      FROM adv_wise_lubricants_vas
      WHERE gst_invoice_date >= ${monthStart}::date
        AND gst_invoice_date < (${exportDate}::date + INTERVAL '1 day')
        ${advWiseDealerFilter(dealerCode)}
      ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    ),
    classified AS (
      SELECT
        *,
        (
          description ~ '(engine[[:space:]-]*oil|synthetic[[:space:]-]*oil|(^|[^0-9])0w[[:space:]-]*20([^0-9]|$)|(^|[^0-9])5w[[:space:]-]*30([^0-9]|$)|(^|[^0-9])10w[[:space:]-]*30([^0-9]|$)|(^|[^0-9])15w[[:space:]-]*40([^0-9]|$))'
          AND description !~ '(filter|seal|gasket|plug|pan|cooler|assy|r[[:space:]]*&[[:space:]]*r|spring|coil|gauge)'
        ) AS is_engine_oil,
        description ~ '(synthetic|0w[[:space:]-]*20|5w[[:space:]-]*30)' AS is_synthetic
      FROM invoice_rows
    )
    SELECT
      COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil AND report_date = ${exportDate}::date), 0)::float AS engine_today,
      COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil), 0)::float AS engine_mtd,
      COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil AND is_synthetic AND report_date = ${exportDate}::date), 0)::float AS synthetic_today,
      COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil AND is_synthetic), 0)::float AS synthetic_mtd
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  return {
    engineOilQty: { today: numberValue(row.engine_today), mtd: numberValue(row.engine_mtd) },
    syntheticOilQty: { today: numberValue(row.synthetic_today), mtd: numberValue(row.synthetic_mtd) },
  }
}

async function buildMetrics(endDate: string | null, dealerCode: DealerFilter): Promise<ServiceDashboardMetrics> {
  const exportDate = await resolveExportDate(endDate, dealerCode)
  const monthStart = getMonthStart(exportDate)

  const [intake, pending, revenue, addons, operations, oil, vasAmount] = await Promise.all([
    fetchIntakeCounts(monthStart, exportDate, dealerCode),
    fetchPendingCounts(monthStart, exportDate, dealerCode),
    fetchRevenueAndDelivered(monthStart, exportDate, dealerCode),
    fetchAddonCounts(monthStart, exportDate, dealerCode),
    fetchOperationMetrics(monthStart, exportDate, dealerCode),
    fetchOilMetrics(monthStart, exportDate, dealerCode),
    fetchVasAmount(monthStart, exportDate, dealerCode),
  ])

  return {
    exportDate,
    monthStart,
    intake,
    pending,
    revenue,
    addons,
    operations,
    oil,
    vasAmount,
  }
}

function cleanNumber(value: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return 0
  const rounded = Number(value.toFixed(fractionDigits))
  return Object.is(rounded, -0) ? 0 : rounded
}

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0
}

function setNumber(worksheet: ExcelJS.Worksheet, address: string, value: number, fractionDigits = 2) {
  worksheet.getCell(address).value = cleanNumber(value, fractionDigits)
}

function setFormula(worksheet: ExcelJS.Worksheet, address: string, formula: string, result: number, fractionDigits = 2) {
  worksheet.getCell(address).value = {
    formula,
    result: cleanNumber(result, fractionDigits),
  }
}

function toArrayBuffer(value: ArrayBuffer | Uint8Array) {
  const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value)
  const buffer = new ArrayBuffer(view.byteLength)
  new Uint8Array(buffer).set(view)
  return buffer
}

function argbToCssColor(argb?: string) {
  if (!argb) return undefined
  const normalized = argb.replace(/^#/, '')
  if (normalized.length === 8) return `#${normalized.slice(2)}`
  if (normalized.length === 6) return `#${normalized}`
  return undefined
}

function borderToCss(border?: Partial<ExcelJS.Border>) {
  if (!border?.style) return undefined
  const color = argbToCssColor(border.color?.argb) || '#1f2937'
  const width = border.style === 'thick' || border.style === 'double' ? '2px' : '1px'
  return `${width} solid ${color}`
}

function getCellBackground(fill?: ExcelJS.Fill) {
  if (!fill || fill.type !== 'pattern') return undefined
  return argbToCssColor(fill.fgColor?.argb || fill.bgColor?.argb)
}

function getCellRawValue(cell: ExcelJS.Cell) {
  const value = cell.value
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'result' in value) {
    const result = value.result
    return typeof result === 'number' || typeof result === 'string' ? result : null
  }
  if (value instanceof Date) return value.toISOString()
  return cell.text || String(value)
}

function getCellText(cell: ExcelJS.Cell) {
  const rawValue = getCellRawValue(cell)
  if (typeof rawValue === 'number') return rawValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return rawValue === null ? '' : String(rawValue)
}

function getCellStyle(cell: ExcelJS.Cell): ServiceDashboardPreviewCellStyle {
  return {
    backgroundColor: getCellBackground(cell.fill),
    color: argbToCssColor(cell.font?.color?.argb),
    fontWeight: cell.font?.bold ? 900 : undefined,
    fontSize: cell.font?.size,
    fontFamily: cell.font?.name,
    textAlign: cell.alignment?.horizontal,
    verticalAlign: cell.alignment?.vertical,
    borderTop: borderToCss(cell.border?.top),
    borderRight: borderToCss(cell.border?.right),
    borderBottom: borderToCss(cell.border?.bottom),
    borderLeft: borderToCss(cell.border?.left),
    wrapText: cell.alignment?.wrapText,
  }
}

function columnLetterToNumber(value: string) {
  return value.toUpperCase().split('').reduce((sum, char) => (sum * 26) + char.charCodeAt(0) - 64, 0)
}

function parseCellAddress(address: string) {
  const match = address.match(/^([A-Z]+)(\d+)$/i)
  if (!match) return null
  return {
    col: columnLetterToNumber(match[1]),
    row: Number(match[2]),
  }
}

function parseMergeRange(range: string) {
  const [start, end] = range.split(':')
  const startCell = parseCellAddress(start)
  const endCell = parseCellAddress(end || start)
  if (!startCell || !endCell) return null
  return {
    startRow: Math.min(startCell.row, endCell.row),
    endRow: Math.max(startCell.row, endCell.row),
    startCol: Math.min(startCell.col, endCell.col),
    endCol: Math.max(startCell.col, endCell.col),
  }
}

function buildMergeLookup(merges: string[]) {
  const lookup = new Map<string, { master: string; colspan: number; rowspan: number; hidden: boolean }>()
  merges.forEach((range) => {
    const parsed = parseMergeRange(range)
    if (!parsed) return
    const master = `${parsed.startRow}:${parsed.startCol}`
    for (let row = parsed.startRow; row <= parsed.endRow; row += 1) {
      for (let col = parsed.startCol; col <= parsed.endCol; col += 1) {
        lookup.set(`${row}:${col}`, {
          master,
          colspan: parsed.endCol - parsed.startCol + 1,
          rowspan: parsed.endRow - parsed.startRow + 1,
          hidden: row !== parsed.startRow || col !== parsed.startCol,
        })
      }
    }
  })
  return lookup
}

function fillServiceDashboardWorksheet(worksheet: ExcelJS.Worksheet, metrics: ServiceDashboardMetrics) {
  worksheet.name = 'Service Dashboard'
  worksheet.getColumn('A').width = 38.140625
  worksheet.getColumn('B').width = 24.28515625
  worksheet.getColumn('C').width = 13
  worksheet.pageSetup.printArea = 'A1:C41'

  worksheet.getCell('A1').value = `DATE |   ${formatDisplayDate(metrics.exportDate)}`
  worksheet.getCell('B1').value = 'Today'
  worksheet.getCell('C1').value = 'MTD'

  setNumber(worksheet, 'B2', metrics.intake['Free Service'].today, 0)
  setNumber(worksheet, 'C2', metrics.intake['Free Service'].mtd, 0)
  setNumber(worksheet, 'B3', metrics.intake['Paid Service'].today, 0)
  setNumber(worksheet, 'C3', metrics.intake['Paid Service'].mtd, 0)
  setNumber(worksheet, 'B4', metrics.intake['Running Repair'].today, 0)
  setNumber(worksheet, 'C4', metrics.intake['Running Repair'].mtd, 0)
  setNumber(worksheet, 'B5', metrics.intake['Accidental Repair'].today, 0)
  setNumber(worksheet, 'C5', metrics.intake['Accidental Repair'].mtd, 0)

  const totalVehicleToday = SERVICE_CATEGORIES.reduce((sum, category) => sum + metrics.intake[category].today, 0)
  const totalVehicleMtd = SERVICE_CATEGORIES.reduce((sum, category) => sum + metrics.intake[category].mtd, 0)
  setFormula(worksheet, 'B6', 'SUM(B2:B5)', totalVehicleToday, 0)
  setFormula(worksheet, 'C6', 'SUM(C2:C5)', totalVehicleMtd, 0)

  setNumber(worksheet, 'B7', metrics.pending.accidental.today, 0)
  setNumber(worksheet, 'C7', metrics.pending.accidental.mtd, 0)
  setNumber(worksheet, 'B8', metrics.pending.mechanical.today, 0)
  setNumber(worksheet, 'C8', metrics.pending.mechanical.mtd, 0)
  setNumber(worksheet, 'B9', metrics.addons.ew.today, 0)
  setNumber(worksheet, 'C9', metrics.addons.ew.mtd, 0)
  setNumber(worksheet, 'B10', metrics.addons.rsa.today, 0)
  setNumber(worksheet, 'C10', metrics.addons.rsa.mtd, 0)
  setNumber(worksheet, 'B11', metrics.addons.mcp.today, 0)
  setNumber(worksheet, 'C11', metrics.addons.mcp.mtd, 0)
  setNumber(worksheet, 'B12', metrics.addons.bodyshopMcp.today, 0)
  setNumber(worksheet, 'C12', metrics.addons.bodyshopMcp.mtd, 0)

  setNumber(worksheet, 'B15', metrics.revenue.mechanicalLabour.today, 0)
  setNumber(worksheet, 'C15', metrics.revenue.mechanicalLabour.mtd, 0)
  setNumber(worksheet, 'B16', metrics.revenue.mechanicalParts.today, 0)
  setNumber(worksheet, 'C16', metrics.revenue.mechanicalParts.mtd, 0)
  setNumber(worksheet, 'B17', metrics.revenue.bodyshopLabour.today, 0)
  setNumber(worksheet, 'C17', metrics.revenue.bodyshopLabour.mtd, 0)
  setNumber(worksheet, 'B18', metrics.revenue.bodyshopParts.today, 0)
  setNumber(worksheet, 'C18', metrics.revenue.bodyshopParts.mtd, 0)

  const totalLabourToday = metrics.revenue.mechanicalLabour.today + metrics.revenue.bodyshopLabour.today
  const totalLabourMtd = metrics.revenue.mechanicalLabour.mtd + metrics.revenue.bodyshopLabour.mtd
  const totalPartsToday = metrics.revenue.mechanicalParts.today + metrics.revenue.bodyshopParts.today
  const totalPartsMtd = metrics.revenue.mechanicalParts.mtd + metrics.revenue.bodyshopParts.mtd
  setFormula(worksheet, 'B13', 'B15+B17', totalLabourToday, 0)
  setFormula(worksheet, 'C13', 'C15+C17', totalLabourMtd, 0)
  setFormula(worksheet, 'B14', 'B16+B18', totalPartsToday, 0)
  setFormula(worksheet, 'C14', 'C16+C18', totalPartsMtd, 0)

  setNumber(worksheet, 'B19', metrics.revenue.delivered['Free Service'].today, 0)
  setNumber(worksheet, 'C19', metrics.revenue.delivered['Free Service'].mtd, 0)
  setNumber(worksheet, 'B20', metrics.revenue.delivered['Paid Service'].today, 0)
  setNumber(worksheet, 'C20', metrics.revenue.delivered['Paid Service'].mtd, 0)
  setNumber(worksheet, 'B21', metrics.revenue.delivered['Running Repair'].today, 0)
  setNumber(worksheet, 'C21', metrics.revenue.delivered['Running Repair'].mtd, 0)
  setNumber(worksheet, 'B22', metrics.revenue.delivered['Accidental Repair'].today, 0)
  setNumber(worksheet, 'C22', metrics.revenue.delivered['Accidental Repair'].mtd, 0)

  const totalDeliveredToday = SERVICE_CATEGORIES.reduce((sum, category) => sum + metrics.revenue.delivered[category].today, 0)
  const totalDeliveredMtd = SERVICE_CATEGORIES.reduce((sum, category) => sum + metrics.revenue.delivered[category].mtd, 0)
  setFormula(worksheet, 'B23', 'SUM(B19:B22)', totalDeliveredToday, 0)
  setFormula(worksheet, 'C23', 'SUM(C19:C22)', totalDeliveredMtd, 0)

  setNumber(worksheet, 'B24', metrics.operations.alignmentCount, 0)
  setNumber(worksheet, 'B25', metrics.operations.balancingCount, 0)
  setNumber(worksheet, 'B26', metrics.operations.alignmentLabour, 0)
  setNumber(worksheet, 'B27', metrics.operations.balancingLabour, 0)

  const mechDeliveredMtd = metrics.revenue.delivered['Free Service'].mtd
    + metrics.revenue.delivered['Paid Service'].mtd
    + metrics.revenue.delivered['Running Repair'].mtd
  const bodyshopDeliveredMtd = metrics.revenue.delivered['Accidental Repair'].mtd
  const averageRo = totalVehicleMtd / 5
  setFormula(worksheet, 'B28', 'IFERROR((C2+C3+C4+C5)/5,0)', averageRo, 0)
  setFormula(worksheet, 'B29', 'IFERROR(C13/(C19+C20+C21+C22),0)', safeDivide(totalLabourMtd, totalDeliveredMtd), 0)
  setFormula(worksheet, 'B30', 'IFERROR(C15/(C19+C20+C21),0)', safeDivide(metrics.revenue.mechanicalLabour.mtd, mechDeliveredMtd), 0)
  setFormula(worksheet, 'B31', 'IFERROR(C17/C22,0)', safeDivide(metrics.revenue.bodyshopLabour.mtd, bodyshopDeliveredMtd), 0)
  setFormula(worksheet, 'B32', 'IFERROR(C14/(C19+C20+C21+C22),0)', safeDivide(totalPartsMtd, totalDeliveredMtd), 0)
  setFormula(worksheet, 'B33', 'IFERROR(C16/(C19+C21+C20),0)', safeDivide(metrics.revenue.mechanicalParts.mtd, mechDeliveredMtd), 0)
  setFormula(worksheet, 'B34', 'IFERROR(C18/C22,0)', safeDivide(metrics.revenue.bodyshopParts.mtd, bodyshopDeliveredMtd), 0)

  setNumber(worksheet, 'B35', metrics.oil.engineOilQty.mtd, 1)
  setFormula(worksheet, 'B36', 'IFERROR(B35/(C2+C3+C4+C5),0)', safeDivide(metrics.oil.engineOilQty.mtd, totalVehicleMtd), 0)
  setNumber(worksheet, 'B37', metrics.oil.syntheticOilQty.today, 1)
  setNumber(worksheet, 'C37', metrics.oil.syntheticOilQty.mtd, 1)
  setNumber(worksheet, 'B38', safeDivide(metrics.oil.syntheticOilQty.today, totalVehicleToday), 2)
  setNumber(worksheet, 'C38', safeDivide(metrics.oil.syntheticOilQty.mtd, totalVehicleMtd), 2)
  setFormula(worksheet, 'B39', 'IFERROR(0/C22,0)', 0, 0)
  setFormula(worksheet, 'B40', 'IFERROR(B35/(C19+C20+C21),0)', safeDivide(metrics.oil.engineOilQty.mtd, mechDeliveredMtd), 0)
  setFormula(worksheet, 'B41', `IFERROR((C13-${cleanNumber(metrics.vasAmount, 0)})/C23,0)`, safeDivide(totalLabourMtd - metrics.vasAmount, totalDeliveredMtd), 0)
}

export async function buildKiaServiceDashboardWorkbook({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}) {
  const normalizedEndDate = parseDateInput(endDate || null)
  const metrics = await buildMetrics(normalizedEndDate, dealerCode || null)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(SERVICE_DASHBOARD_TEMPLATE)

  workbook.worksheets
    .filter((worksheet) => worksheet.name !== 'Service Dashboard')
    .forEach((worksheet) => workbook.removeWorksheet(worksheet.id))

  const worksheet = workbook.getWorksheet('Service Dashboard') || workbook.worksheets[0]
  if (!worksheet) {
    throw new Error('Service Dashboard template sheet is missing')
  }

  fillServiceDashboardWorksheet(worksheet, metrics)
  workbook.creator = 'AM Dashboard'
  workbook.lastModifiedBy = 'AM Dashboard'
  workbook.modified = new Date()
  workbook.calcProperties.fullCalcOnLoad = true

  return {
    workbook,
    worksheet,
    metrics,
    fileName: `AM_KIA_Service_Dashboard_${metrics.exportDate}.xlsx`,
  }
}

export async function buildKiaServiceDashboardExport({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardExport> {
  const { workbook, metrics, fileName } = await buildKiaServiceDashboardWorkbook({ endDate, dealerCode })
  const output = await workbook.xlsx.writeBuffer()
  const buffer = toArrayBuffer(output as unknown as ArrayBuffer | Uint8Array)

  return {
    buffer,
    fileName,
    metrics,
  }
}

export async function buildKiaServiceDashboardPreview({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardPreview> {
  const { worksheet, metrics, fileName } = await buildKiaServiceDashboardWorkbook({ endDate, dealerCode })
  const merges = [...(worksheet.model.merges || [])]
  const mergeLookup = buildMergeLookup(merges)
  const rows: KiaServiceDashboardPreview['rows'] = []

  for (let rowIndex = 1; rowIndex <= 41; rowIndex += 1) {
    const row = worksheet.getRow(rowIndex)
    const cells: ServiceDashboardPreviewCell[] = []

    for (let colIndex = 1; colIndex <= 3; colIndex += 1) {
      const cell = row.getCell(colIndex)
      const merge = mergeLookup.get(`${rowIndex}:${colIndex}`)
      const hidden = Boolean(merge?.hidden)
      cells.push({
        address: cell.address,
        row: rowIndex,
        col: colIndex,
        text: getCellText(cell),
        value: getCellRawValue(cell),
        colspan: hidden ? 1 : merge?.colspan || 1,
        rowspan: hidden ? 1 : merge?.rowspan || 1,
        hidden,
        style: getCellStyle(cell),
      })
    }

    rows.push({
      index: rowIndex,
      height: row.height || null,
      cells,
    })
  }

  return {
    sheetName: worksheet.name,
    range: 'A1:C41',
    fileName,
    metrics,
    columns: ['A', 'B', 'C'].map((key) => ({
      key,
      width: worksheet.getColumn(key).width || 12,
    })),
    rows,
    merges,
  }
}
