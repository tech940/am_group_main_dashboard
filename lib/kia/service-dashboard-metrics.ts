import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableExists } from '@/lib/analytics/table-exists'
import {
  getKiaDealerFilterValues,
  normalizeKiaDealerCode,
  type KiaDealerCode,
} from '@/lib/kia/dealer-branch'
import { kiaServiceCategoryExpression } from '@/lib/kia/business-excellence-contract'

export type KiaServiceDealerFilter = KiaDealerCode | null
export type NumericRow = Record<string, unknown>

export type OperationAnalysisPeriod = {
  periodStart: string
  periodEnd: string
}

export type WorkshopVasResult = {
  amount: number
  available: boolean
  unavailableReason: string | null
  source: string | null
  sourceTable: string | null
  periodStart: string | null
  periodEnd: string | null
  sourceRows: number
}

export type CanonicalOperationMetrics = {
  vasAmount: number
  alignmentCount: number
  balancingCount: number
  alignmentLabour: number
  balancingLabour: number
  period: OperationAnalysisPeriod | null
}

export type AddonKpiResult = {
  ewCount: number
  rsaCount: number
  mcpCount: number
  rsaAmount: number
}

export function parseDateInput(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null
  const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getMonthStart(value: string) {
  const [year, month] = value.split('-').map(Number)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

export function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

export async function tableExists(tableName: string) {
  return await analyticsTableExists(tableName)
}

export function activeBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

function dealerInListFilter(codes: string[], columns: string[]) {
  if (codes.length === 0) return sql.raw('AND FALSE')
  return sql.raw(`AND (${columns
    .map((column) => `UPPER(TRIM(COALESCE(${column}, ''))) IN (${codes.map((code) => `'${code}'`).join(', ')})`)
    .join(' OR ')})`)
}

function coalescedDealerInListFilter(codes: string[], columns: string[]) {
  if (codes.length === 0) return sql.raw('AND FALSE')
  const coalesced = `UPPER(TRIM(COALESCE(${columns.map((column) => `NULLIF(${column}, '')`).join(', ')}, '')))`
  return sql.raw(`AND ${coalesced} IN (${codes.map((code) => `'${code}'`).join(', ')})`)
}

export function roBillingDealerFilter(dealerCode: KiaServiceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return coalescedDealerInListFilter(codes, [
    `${alias}dealer_code`,
    `${alias}main_dealer_code`,
  ])
}

export function advWiseDealerFilter(dealerCode: KiaServiceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return coalescedDealerInListFilter(codes, [
    `${alias}dealer_code`,
    `${alias}retail_dealer_code`,
  ])
}

export function openRoDealerFilter(dealerCode: KiaServiceDealerFilter, alias = 'open_ro_yearly') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return dealerInListFilter(codes, [`${alias}.dealer_code`])
}

export function operationDealerFilter(dealerCode: KiaServiceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return dealerInListFilter(codes, [`${alias}dealer_code`])
}

export function ewDealerFilter(dealerCode: KiaServiceDealerFilter) {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return sql.raw(`AND (
    UPPER(TRIM(COALESCE(dealer_code, ''))) IN (${codes.map((c) => `'${c}'`).join(', ')})
    OR UPPER(TRIM(COALESCE(outlet_code, ''))) IN (${codes.map((c) => `'${c}'`).join(', ')})
    OR UPPER(TRIM(COALESCE(main_dealer_code, ''))) IN (${codes.map((c) => `'${c}'`).join(', ')})
    OR dealer_code IS NULL
  )`)
}

export function mcpDealerFilter(dealerCode: KiaServiceDealerFilter) {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return sql.raw(`AND (
    UPPER(TRIM(COALESCE(dealer_code, ''))) IN (${codes.map((c) => `'${c}'`).join(', ')})
    OR dealer_code IS NULL
  )`)
}

export function rsaDealerFilter(dealerCode: KiaServiceDealerFilter) {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return sql.raw(`AND (
    UPPER(TRIM(COALESCE(dealer_workshop_code, ''))) IN (${codes.map((c) => `'${c}'`).join(', ')})
    OR dealer_workshop_code IS NULL
  )`)
}

export function serviceCategoryExpression(workTypeColumn: string, serviceTypeColumn: string) {
  void serviceTypeColumn
  return kiaServiceCategoryExpression(workTypeColumn)
}

export function vasDescriptionFilter() {
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

export async function resolveOperationAnalysisPeriod(
  monthStart: string,
  exportDate: string,
  dealerCode: KiaServiceDealerFilter,
  allowForwardGap: boolean,
): Promise<OperationAnalysisPeriod | null> {
  if (!(await tableExists('operation_wise_analysis_report'))) return null

  const result = await db.execute(sql`
    WITH periods AS (
      SELECT DISTINCT
        report_period_start::date AS period_start,
        report_period_end::date AS period_end
      FROM operation_wise_analysis_report
      WHERE report_period_start::date = ${monthStart}::date
        ${operationDealerFilter(dealerCode)}
    ),
    below AS (
      SELECT MAX(period_end) AS period_end
      FROM periods
      WHERE period_end <= ${exportDate}::date
    ),
    above AS (
      SELECT MIN(period_end) AS period_end
      FROM periods
      WHERE period_end > ${exportDate}::date
    )
    SELECT
      ${monthStart}::text AS period_start,
      CASE
        WHEN ${allowForwardGap}
          AND (SELECT period_end FROM above) IS NOT NULL
          AND ((SELECT period_end FROM above) - ${exportDate}::date) <= 2
          AND (
            (SELECT period_end FROM below) IS NULL
            OR (${exportDate}::date - (SELECT period_end FROM below)) >= 1
          )
        THEN (SELECT period_end FROM above)::text
        ELSE COALESCE((SELECT period_end FROM below), (SELECT period_end FROM above))::text
      END AS period_end
  `)

  const row = resultRows(result)[0] || {}
  const periodStart = parseDateInput(String(row.period_start || ''))
  const periodEnd = parseDateInput(String(row.period_end || ''))
  if (!periodStart || !periodEnd) return null
  return { periodStart, periodEnd }
}

export function usesForwardGapSnapshot(period: OperationAnalysisPeriod | null, exportDate: string) {
  return Boolean(period && period.periodEnd > exportDate)
}

function forwardGapBlendRatio(
  exportDate: string,
  belowPeriod: OperationAnalysisPeriod,
  forwardPeriod: OperationAnalysisPeriod,
) {
  const exportDay = Number(exportDate.slice(8, 10))
  const belowDay = Number(belowPeriod.periodEnd.slice(8, 10))
  const forwardDay = Number(forwardPeriod.periodEnd.slice(8, 10))
  if (!Number.isFinite(exportDay) || !Number.isFinite(belowDay) || !Number.isFinite(forwardDay)) return 1
  if (forwardDay <= belowDay) return 1
  return Math.max(0, Math.min(1, (exportDay - belowDay) / (forwardDay - belowDay)))
}

export function normalizeWheelOperationCounts(
  counts: { alignmentCount: number; balancingCount: number },
  exportDate: string,
  countPeriod: OperationAnalysisPeriod | null,
  belowCounts: { alignmentCount: number; balancingCount: number } | null = null,
  belowPeriod: OperationAnalysisPeriod | null = null,
) {
  if (!usesForwardGapSnapshot(countPeriod, exportDate) || !belowCounts || !belowPeriod || !countPeriod) {
    return {
      alignmentCount: Math.round(counts.alignmentCount),
      balancingCount: Math.round(counts.balancingCount),
    }
  }

  const ratio = forwardGapBlendRatio(exportDate, belowPeriod, countPeriod)
  return {
    alignmentCount: Math.max(0, Math.floor(
      belowCounts.alignmentCount + (counts.alignmentCount - belowCounts.alignmentCount) * ratio,
    )),
    balancingCount: Math.max(0, Math.round(
      belowCounts.balancingCount + (counts.balancingCount - belowCounts.balancingCount) * ratio,
    )),
  }
}

async function fetchAdvisorWheelMetrics(period: OperationAnalysisPeriod, dealerCode: KiaServiceDealerFilter) {
  if (!(await tableExists('operation_wise_analysis_advisor_report'))) return null

  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_count'))} AS operation_count,
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_advisor_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
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
          report_type = 'operation'
          AND (
            operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
            OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'
          )
        ) AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::float AS alignment_count,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::float AS balancing_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS alignment_labour,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS balancing_labour,
      COUNT(*)::int AS source_rows
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  const sourceRows = numberValue(row.source_rows)
  if (sourceRows <= 0) return null

  return {
    alignmentCount: numberValue(row.alignment_count),
    balancingCount: numberValue(row.balancing_count),
    alignmentLabour: numberValue(row.alignment_labour),
    balancingLabour: numberValue(row.balancing_labour),
  }
}

async function fetchOperationWheelCounts(period: OperationAnalysisPeriod, dealerCode: KiaServiceDealerFilter) {
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_count'))} AS operation_count,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
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
          report_type = 'operation'
          AND (
            operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
            OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'
          )
        ) AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::float AS alignment_count,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::float AS balancing_count
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  return {
    alignmentCount: numberValue(row.alignment_count),
    balancingCount: numberValue(row.balancing_count),
  }
}

function workshopVasDescriptionFilter() {
  return sql`
    LOWER(COALESCE(report_type, '')) IN ('operation', 'part')
    AND (
      ${vasDescriptionFilter()}
    )
  `
}

async function fetchWorkshopOverviewVasFromOperationReport(
  period: OperationAnalysisPeriod,
  dealerCode: KiaServiceDealerFilter,
) {
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        LOWER(COALESCE(source.op_part_desc, '')) AS description,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
        ${operationDealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT
      COALESCE(SUM(amount), 0)::float AS vas_amount,
      COUNT(*)::int AS source_rows
    FROM operation_rows
    WHERE ${workshopVasDescriptionFilter()}
  `)

  const row = resultRows(result)[0] || {}
  return {
    amount: numberValue(row.vas_amount),
    sourceRows: numberValue(row.source_rows),
  }
}

export function wheelBalancingLabourMatchSql() {
  return sql.raw(`(
    LOWER(COALESCE(report_type, '')) = 'operation'
    AND (
      operation_code ~ '(^|[^a-z])wb([^a-z]|$)'
      OR description ~ '(wheel[[:space:]-]*balanc|balanc|balance|(^|[^a-z])wb([^a-z]|$))'
    )
  )`)
}

function wheelBalancingBc5LabourSql(alias = 'source.') {
  return sql.raw(`(
    UPPER(TRIM(COALESCE(${alias}op_part_code, ''))) = 'A10VAWHEELBC5'
    AND LOWER(COALESCE(${alias}report_type, '')) = 'operation'
  )`)
}

export async function fetchWheelLabourAmounts(period: OperationAnalysisPeriod, dealerCode: KiaServiceDealerFilter) {
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        LOWER(CONCAT_WS(' ', source.report_type, source.op_part_code, source.op_part_desc)) AS description,
        LOWER(COALESCE(source.op_part_code, '')) AS operation_code,
        LOWER(COALESCE(source.report_type, '')) AS report_type
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
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
        ${wheelBalancingLabourMatchSql()} AS is_wb
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS alignment_labour,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS balancing_labour
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  return {
    alignmentLabour: numberValue(row.alignment_labour),
    balancingLabour: numberValue(row.balancing_labour),
  }
}

async function fetchWheelBalancingBc5Labour(period: OperationAnalysisPeriod, dealerCode: KiaServiceDealerFilter) {
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_amt'))} AS amount
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
        AND ${wheelBalancingBc5LabourSql('source.')}
        ${operationDealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT COALESCE(SUM(amount), 0)::float AS bc5_labour
    FROM operation_rows
  `)

  return numberValue(resultRows(result)[0]?.bc5_labour)
}

export async function normalizeWheelOperationLabour(
  labour: { alignmentLabour: number; balancingLabour: number },
  monthStart: string,
  exportDate: string,
  period: OperationAnalysisPeriod | null,
  dealerCode: KiaServiceDealerFilter,
) {
  const alignmentLabour = Math.round(labour.alignmentLabour)

  if (!usesForwardGapSnapshot(period, exportDate)) {
    return {
      alignmentLabour,
      balancingLabour: Math.round(labour.balancingLabour),
    }
  }

  const belowPeriod = await resolveOperationAnalysisPeriod(monthStart, exportDate, dealerCode, false)
  if (!belowPeriod) {
    return {
      alignmentLabour,
      balancingLabour: Math.round(labour.balancingLabour),
    }
  }

  const [belowLabour, bc5Labour] = await Promise.all([
    fetchWheelLabourAmounts(belowPeriod, dealerCode),
    fetchWheelBalancingBc5Labour(period!, dealerCode),
  ])

  const alignmentDelta = Math.max(0, labour.alignmentLabour - belowLabour.alignmentLabour)
  const balancingDelta = Math.max(0, labour.balancingLabour - belowLabour.balancingLabour)
  const alignmentCarryLabour = Math.max(0, alignmentDelta - balancingDelta)
  const balancingLabour = Math.max(
    0,
    labour.balancingLabour - bc5Labour - alignmentCarryLabour,
  )

  return {
    alignmentLabour,
    balancingLabour: Math.round(balancingLabour),
  }
}

export async function fetchVasAmount(
  monthStart: string,
  exportDate: string,
  dealerCode: KiaServiceDealerFilter,
) {
  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')
  const hasOperationWise = await tableExists('operation_wise_analysis_report')

  if (hasInvoiceWise) {
    const invoiceResult = await db.execute(sql`
      WITH invoice_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          ${numericText(sql.raw('taxable_amount'))} AS amount,
          LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
        FROM adv_wise_lubricants_vas
        WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= ${monthStart}::date
          AND COALESCE(gst_invoice_date, ro_close_date::date) < (${exportDate}::date + INTERVAL '1 day')
          ${advWiseDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
      FROM invoice_rows
      WHERE ${vasDescriptionFilter()}
    `)

    const invoiceAmount = numberValue(resultRows(invoiceResult)[0]?.vas_amount)
    if (invoiceAmount > 0) return invoiceAmount
  }

  if (!hasOperationWise) return 0

  const period = await resolveOperationAnalysisPeriod(monthStart, exportDate, dealerCode, true)
  if (!period) return 0

  if (await tableExists('operation_wise_analysis_advisor_report')) {
    const advisorResult = await db.execute(sql`
      WITH operation_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
          ${numericText(sql.raw('source.total_amt'))} AS amount,
          LOWER(COALESCE(source.op_part_desc, '')) AS description,
          LOWER(COALESCE(source.report_type, '')) AS report_type
        FROM operation_wise_analysis_advisor_report source
        WHERE source.report_period_start::date = ${period.periodStart}::date
          AND source.report_period_end::date = ${period.periodEnd}::date
          ${operationDealerFilter(dealerCode, 'source.')}
        ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
      )
      SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
      FROM operation_rows
      WHERE ${workshopVasDescriptionFilter()}
    `)

    const advisorAmount = numberValue(resultRows(advisorResult)[0]?.vas_amount)
    if (advisorAmount > 0) return advisorAmount
  }

  const operationResult = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_amt'))} AS amount,
        LOWER(COALESCE(source.op_part_desc, '')) AS description
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
        AND LOWER(COALESCE(source.report_type, '')) = 'operation'
        ${operationDealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    )
    SELECT COALESCE(SUM(amount), 0)::float AS vas_amount
    FROM operation_rows
    WHERE ${vasDescriptionFilter()}
  `)

  return numberValue(resultRows(operationResult)[0]?.vas_amount)
}

export async function fetchWorkshopVasAmountDetailed(
  startDate: string,
  endDate: string,
  dealerCode: KiaServiceDealerFilter = null,
): Promise<WorkshopVasResult> {
  const normalizedDealer = normalizeKiaDealerCode(dealerCode) || null
  const monthStart = getMonthStart(endDate)
  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')
  const hasOperationWise = await tableExists('operation_wise_analysis_report')

  if (!hasInvoiceWise && !hasOperationWise) {
    return {
      amount: 0,
      available: false,
      unavailableReason: 'Workshop VAS source tables are unavailable',
      source: null,
      sourceTable: null,
      periodStart: null,
      periodEnd: null,
      sourceRows: 0,
    }
  }

  if (hasInvoiceWise) {
    const invoiceResult = await db.execute(sql`
      WITH invoice_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(gst_invoice_date, ro_close_date::date) AS report_date,
          ${numericText(sql.raw('taxable_amount'))} AS amount,
          LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc)) AS description
        FROM adv_wise_lubricants_vas
        WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= ${monthStart}::date
          AND COALESCE(gst_invoice_date, ro_close_date::date) < (${endDate}::date + INTERVAL '1 day')
          ${advWiseDealerFilter(normalizedDealer)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COALESCE(SUM(amount), 0)::float AS vas_amount,
        COUNT(*)::int AS source_rows,
        MIN(report_date)::text AS period_start,
        MAX(report_date)::text AS period_end
      FROM invoice_rows
      WHERE ${vasDescriptionFilter()}
    `)

    const row = resultRows(invoiceResult)[0]
    const invoiceAmount = numberValue(row?.vas_amount)
    const sourceRows = numberValue(row?.source_rows)

    if (invoiceAmount > 0) {
      return {
        amount: invoiceAmount,
        available: true,
        unavailableReason: null,
        source: 'invoice_vas_gst_date',
        sourceTable: 'adv_wise_lubricants_vas',
        periodStart: parseDateInput(String(row?.period_start || '')),
        periodEnd: parseDateInput(String(row?.period_end || '')),
        sourceRows,
      }
    }
  }

  if (!hasOperationWise) {
    return {
      amount: 0,
      available: false,
      unavailableReason: `No matching VAS source period for ${startDate} to ${endDate}`,
      source: null,
      sourceTable: null,
      periodStart: null,
      periodEnd: null,
      sourceRows: 0,
    }
  }

  const forwardPeriod = await resolveOperationAnalysisPeriod(monthStart, endDate, normalizedDealer, true)
  if (!forwardPeriod) {
    return {
      amount: 0,
      available: false,
      unavailableReason: `No matching VAS source period for ${startDate} to ${endDate}`,
      source: null,
      sourceTable: null,
      periodStart: null,
      periodEnd: null,
      sourceRows: 0,
    }
  }

  const vasPeriod = usesForwardGapSnapshot(forwardPeriod, endDate)
    ? await resolveOperationAnalysisPeriod(monthStart, endDate, normalizedDealer, false) ?? forwardPeriod
    : forwardPeriod

  const operationResult = await fetchWorkshopOverviewVasFromOperationReport(vasPeriod, normalizedDealer)
  const amount = operationResult.amount
  const sourceRows = operationResult.sourceRows

  return {
    amount,
    available: sourceRows > 0,
    unavailableReason: sourceRows > 0 ? null : `No matching VAS source period for ${startDate} to ${endDate}`,
    source: usesForwardGapSnapshot(forwardPeriod, endDate) ? 'operation_workshop_vas_below_period' : 'operation_workshop_vas_resolved',
    sourceTable: 'operation_wise_analysis_report',
    periodStart: vasPeriod.periodStart,
    periodEnd: vasPeriod.periodEnd,
    sourceRows,
  }
}

export async function fetchCanonicalOperationMetrics(
  endDate: string,
  dealerCode: KiaServiceDealerFilter = null,
): Promise<CanonicalOperationMetrics> {
  const normalizedDealer = normalizeKiaDealerCode(dealerCode) || null
  const monthStart = getMonthStart(endDate)
  const empty = {
    vasAmount: 0,
    alignmentCount: 0,
    balancingCount: 0,
    alignmentLabour: 0,
    balancingLabour: 0,
    period: null as OperationAnalysisPeriod | null,
  }

  const period = await resolveOperationAnalysisPeriod(monthStart, endDate, normalizedDealer, true)
  if (!period) {
    const vasAmount = await fetchVasAmount(monthStart, endDate, normalizedDealer)
    return { ...empty, vasAmount }
  }

  const [advisorMetrics, vasAmount] = await Promise.all([
    fetchAdvisorWheelMetrics(period, normalizedDealer),
    fetchVasAmount(monthStart, endDate, normalizedDealer),
  ])

  if (advisorMetrics) {
    return {
      vasAmount,
      alignmentCount: Math.round(advisorMetrics.alignmentCount),
      balancingCount: Math.round(advisorMetrics.balancingCount),
      alignmentLabour: Math.round(advisorMetrics.alignmentLabour),
      balancingLabour: Math.round(advisorMetrics.balancingLabour),
      period,
    }
  }

  const belowPeriod = usesForwardGapSnapshot(period, endDate)
    ? await resolveOperationAnalysisPeriod(monthStart, endDate, normalizedDealer, false)
    : null

  const [countResult, labour, belowCounts] = await Promise.all([
    fetchOperationWheelCounts(period, normalizedDealer),
    fetchWheelLabourAmounts(period, normalizedDealer),
    belowPeriod ? fetchOperationWheelCounts(belowPeriod, normalizedDealer) : Promise.resolve(null),
  ])

  const normalizedCounts = normalizeWheelOperationCounts(
    countResult,
    endDate,
    period,
    belowCounts,
    belowPeriod,
  )
  const normalizedLabour = await normalizeWheelOperationLabour(
    labour,
    monthStart,
    endDate,
    period,
    normalizedDealer,
  )

  return {
    vasAmount,
    alignmentCount: normalizedCounts.alignmentCount,
    balancingCount: normalizedCounts.balancingCount,
    alignmentLabour: normalizedLabour.alignmentLabour,
    balancingLabour: normalizedLabour.balancingLabour,
    period,
  }
}

export async function fetchOperationMetrics(
  monthStart: string,
  exportDate: string,
  dealerCode: KiaServiceDealerFilter = null,
) {
  const canonical = await fetchCanonicalOperationMetrics(exportDate, dealerCode)
  return {
    alignmentCount: canonical.alignmentCount,
    balancingCount: canonical.balancingCount,
    alignmentLabour: canonical.alignmentLabour,
    balancingLabour: canonical.balancingLabour,
  }
}

export async function fetchAddonKpisForPeriod(
  startDate: string,
  endDate: string,
  dealerCode: KiaServiceDealerFilter = null,
): Promise<AddonKpiResult> {
  const normalizedDealer = normalizeKiaDealerCode(dealerCode) || null
  const [hasEw, hasRsa, hasMcp] = await Promise.all([
    tableExists('ew_report'),
    tableExists('rsa_report'),
    tableExists('mcp_report'),
  ])

  const [ew, rsa, mcp] = await Promise.all([
    hasEw ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text)
        )
          reg_date::date AS report_date
        FROM ew_report
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
          ${ewDealerFilter(normalizedDealer)}
        ORDER BY COALESCE(NULLIF(TRIM(certi_no), ''), NULLIF(CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(scheme_desc), ''), reg_date::text), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COUNT(*)::int AS count
      FROM dedup
    `) : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasRsa ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text)
        )
          (
            CASE 
              WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
              WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
              ELSE invoice_date::date
            END
          ) AS report_date,
          ${numericText(sql.raw('total_amount'))} AS total_amount
        FROM rsa_report
        WHERE (
          CASE 
            WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
            WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
            ELSE invoice_date::date
          END
        ) >= ${startDate}::date
          AND (
            CASE 
              WHEN invoice_date ~ '^\d{4}-\d{2}-\d{2}' THEN invoice_date::date
              WHEN invoice_date ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN to_date(invoice_date, 'FMMonth/FMDD/YYYY')
              ELSE invoice_date::date
            END
          ) < (${endDate}::date + INTERVAL '1 day')
          ${rsaDealerFilter(normalizedDealer)}
        ORDER BY COALESCE(NULLIF(TRIM(invoice_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin_chasis_no), ''), NULLIF(TRIM(policy_name), ''), invoice_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_amount), 0)::float AS amount
      FROM dedup
    `) : Promise.resolve([{ count: 0, amount: 0 }] as NumericRow[]),
    hasMcp ? db.execute(sql`
      WITH dedup AS (
        SELECT DISTINCT ON (
          COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text)
        )
          package_purchase_date::date AS report_date
        FROM mcp_report
        WHERE package_purchase_date >= ${startDate}::date
          AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
          ${mcpDealerFilter(normalizedDealer)}
        ORDER BY COALESCE(NULLIF(TRIM(cert_no), ''), CONCAT_WS('|', NULLIF(TRIM(vin), ''), NULLIF(TRIM(package_name), ''), package_purchase_date::text), id::text), uploaded_at DESC NULLS LAST, id DESC
      )
      SELECT COUNT(*)::int AS count
      FROM dedup
    `) : Promise.resolve([{ count: 0 }] as NumericRow[]),
  ])

  const rsaRow = resultRows(rsa)[0] || {}
  return {
    ewCount: numberValue(resultRows(ew)[0]?.count),
    rsaCount: numberValue(rsaRow.count),
    mcpCount: numberValue(resultRows(mcp)[0]?.count),
    rsaAmount: numberValue(rsaRow.amount),
  }
}

/** Alias used by Overview route. */
export const fetchEwRsaMcpCounts = fetchAddonKpisForPeriod

/** Alias used by Overview route. */
export const fetchWorkshopVasDetails = fetchWorkshopVasAmountDetailed
