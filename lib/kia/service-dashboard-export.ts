import path from 'path'
import { readFile } from 'fs/promises'
import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { db as postgresDb } from '@/lib/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import {
  DEFAULT_KIA_DEALER_CODE,
  KIA_ENGINE_OIL_PART_CODES,
  type KiaDealerCode,
} from '@/lib/kia/dealer-branch'
import {
  KIA_BUSINESS_EXCELLENCE_CACHE_VERSION,
  buildKiaSourceMetadata,
  getKiaWorkingDayContext,
} from '@/lib/kia/business-excellence-contract'
import {
  activeBillStatusSql,
  advWiseDealerFilter,
  ewDealerFilter,
  fetchOperationMetrics,
  fetchVasAmount,
  getMonthStart,
  mcpDealerFilter,
  numberValue,
  numericText,
  openRoDealerFilter,
  operationDealerFilter,
  parseDateInput,
  resolveOperationAnalysisPeriod,
  resultRows,
  roBillingDealerFilter,
  rsaDealerFilter,
  serviceCategoryExpression,
  tableExists,
  usesForwardGapSnapshot,
  type OperationAnalysisPeriod,
} from '@/lib/kia/service-dashboard-metrics'

type DealerFilter = KiaDealerCode | null
type NumericRow = Record<string, unknown>

const SERVICE_DASHBOARD_TEMPLATE = path.join(process.cwd(), 'templates', 'kia', 'service-dashboard-template.xlsx')
const SERVICE_DASHBOARD_CACHE_VERSION = 'v7'
const SERVICE_CATEGORIES = ['Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair'] as const
let templateBufferPromise: Promise<Uint8Array> | null = null

type ServiceCategory = typeof SERVICE_CATEGORIES[number]

function resolveServiceDashboardDealerCode(dealerCode: DealerFilter): KiaDealerCode {
  return dealerCode || DEFAULT_KIA_DEALER_CODE
}

type CountPair = {
  today: number
  mtd: number
}

type AmountPair = {
  today: number
  mtd: number
}

type ServiceDashboardCellValue = string | number | null

export type ServiceDashboardMetrics = {
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
  bodyshopPnaCases: number
  sourceMetadata: ReturnType<typeof buildKiaSourceMetadata> | {
    workingDayCount?: number
    [key: string]: unknown
  }
  unavailableRows?: number[]
  sourceWarnings?: string[]
  displayOverrides?: Record<string, ServiceDashboardCellValue>
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

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year}`
}

function emptyCategoryCounts(): Record<ServiceCategory, CountPair> {
  return SERVICE_CATEGORIES.reduce((acc, category) => {
    acc[category] = { today: 0, mtd: 0 }
    return acc
  }, {} as Record<ServiceCategory, CountPair>)
}

async function loadTemplateBuffer() {
  if (!templateBufferPromise) {
    templateBufferPromise = readFile(SERVICE_DASHBOARD_TEMPLATE)
  }
  return templateBufferPromise
}

function engineOilPartCodeMatchSql(partNoColumn: string, opPartCodeColumn: string) {
  const prefixes = KIA_ENGINE_OIL_PART_CODES.map((code) => code.replace(/'/g, "''"))
  const prefixMatches = prefixes
    .map((prefix) => `(UPPER(TRIM(COALESCE(${partNoColumn}, ''))) LIKE '${prefix}%' OR UPPER(TRIM(COALESCE(${opPartCodeColumn}, ''))) LIKE '${prefix}%')`)
    .join(' OR ')
  return sql.raw(`(
    ${prefixMatches}
    OR UPPER(TRIM(COALESCE(${partNoColumn}, ''))) LIKE 'NPNENG%'
    OR UPPER(TRIM(COALESCE(${opPartCodeColumn}, ''))) LIKE 'NPNENG%'
  )`)
}

function syntheticOilMatchSql(descriptionColumn: string) {
  return sql.raw(`(
    ${descriptionColumn} ~ '(^|[^a-z])synthetic([^a-z]|$)'
    AND ${descriptionColumn} !~ '(synthetic[[:space:]-]*filter|transmission|gear)'
  )`)
}

function serviceDashboardCacheKey(kind: 'latest-date' | 'metrics' | 'preview', endDate: string | null, dealerCode: DealerFilter) {
  return `kia:service-dashboard:${kind}:${SERVICE_DASHBOARD_CACHE_VERSION}:${KIA_BUSINESS_EXCELLENCE_CACHE_VERSION}:${dealerCode || 'all'}:${endDate || 'latest'}`
}

async function fetchEngineOilQtyByPeriod(period: OperationAnalysisPeriod, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(source.row_hash, ''), source.id::text))
        ${numericText(sql.raw('source.total_count'))} AS quantity,
        UPPER(TRIM(COALESCE(source.op_part_code, ''))) AS op_part_code,
        LOWER(COALESCE(source.op_part_desc, '')) AS description
      FROM operation_wise_analysis_report source
      WHERE source.report_period_start::date = ${period.periodStart}::date
        AND source.report_period_end::date = ${period.periodEnd}::date
        AND LOWER(COALESCE(source.report_type, '')) IN ('operation', 'part')
        ${operationDealerFilter(dealerCode, 'source.')}
      ORDER BY COALESCE(NULLIF(source.row_hash, ''), source.id::text), source.uploaded_at DESC NULLS LAST, source.id DESC
    ),
    classified AS (
      SELECT
        *,
        ${engineOilPartCodeMatchSql('op_part_code', 'op_part_code')} AS is_engine_oil,
        op_part_code LIKE 'NPNENG4%' AS is_npneng4,
        op_part_code LIKE 'NPNENG3%' AS is_npneng3
      FROM operation_rows
    )
    SELECT
      COALESCE(SUM(quantity) FILTER (WHERE is_engine_oil), 0)::float AS engine_mtd,
      COALESCE(SUM(quantity) FILTER (WHERE is_npneng4), 0)::float AS npneng4_mtd,
      COALESCE(SUM(quantity) FILTER (WHERE is_npneng3), 0)::float AS npneng3_mtd
    FROM classified
  `)

  const row = resultRows(result)[0] || {}
  return {
    engineMtd: numberValue(row.engine_mtd),
    npneng4Mtd: numberValue(row.npneng4_mtd),
    npneng3Mtd: numberValue(row.npneng3_mtd),
  }
}

async function resolveExportDate(requestedEndDate: string | null, dealerCode: DealerFilter) {
  if (requestedEndDate) return requestedEndDate
  return getCachedData(
    serviceDashboardCacheKey('latest-date', 'latest', dealerCode),
    async () => {
      const result = await db.execute(sql`
        SELECT MAX(bill_date)::text AS max_date
        FROM ro_billing_report
        WHERE bill_date IS NOT NULL
          ${roBillingDealerFilter(dealerCode)}
      `)

      return parseDateInput(String(resultRows(result)[0]?.max_date || '')) || toDateInputValue(new Date())
    },
    CACHE_TTL.DASHBOARD,
  )
}

async function fetchIntakeCounts(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH combined AS (
      -- Billed ROs
      SELECT
        COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key,
        ro_date::date AS ro_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS category
      FROM ro_billing_report
      WHERE
        ro_date >= ${monthStart}::date
        AND ro_date < (${exportDate}::date + INTERVAL '1 day')
        AND ${activeBillStatusSql()}
        ${roBillingDealerFilter(dealerCode)}

      UNION

      -- Open ROs
      SELECT
        COALESCE(NULLIF(r_o_no, ''), id::text) AS jc_key,
        ro_date::date AS ro_date,
        ${serviceCategoryExpression('work_type', 'service_type')} AS category
      FROM open_ro_yearly
      WHERE
        ro_date >= ${monthStart}::date
        AND ro_date < (${exportDate}::date + INTERVAL '1 day')
        AND LOWER(TRIM(COALESCE(status, ''))) IN ('open', 'close', 'closed')
        ${openRoDealerFilter(dealerCode)}
    ),
    dedup AS (
      SELECT DISTINCT ON (jc_key)
        jc_key,
        ro_date,
        category
      FROM combined
      ORDER BY jc_key, ro_date ASC
    )
    SELECT
      category,
      COUNT(*) FILTER (WHERE ro_date = ${exportDate}::date)::int AS today,
      COUNT(*)::int AS mtd
    FROM dedup
    WHERE category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
    GROUP BY category
  `)

  const counts = emptyCategoryCounts()
  resultRows(result).forEach((row) => {
    const category = String(row.category || '') as ServiceCategory
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
  const [result, operationalSupplementResult] = await Promise.all([
    db.execute(sql`
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
  `),
    db.execute(sql`
      WITH billed AS (
        SELECT DISTINCT COALESCE(NULLIF(ro_no, ''), NULLIF(bill_no, ''), id::text) AS jc_key
        FROM ro_billing_report
        WHERE bill_date >= ${monthStart}::date
          AND bill_date < (${exportDate}::date + INTERVAL '1 day')
          AND ${activeBillStatusSql()}
          ${roBillingDealerFilter(dealerCode)}
      ),
      operational AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
          COALESCE(NULLIF(o.r_o_no, ''), o.id::text) AS jc_key,
          o.ro_date::date AS report_date,
          ${serviceCategoryExpression('o.work_type', 'o.service_type')} AS service_category,
          LOWER(TRIM(COALESCE(o.ro_sub_status, ''))) AS ro_sub_status,
          o.uploaded_at,
          o.id
        FROM open_ro_yearly o
        WHERE o.ro_date >= ${monthStart}::date
          AND o.ro_date < (${exportDate}::date + INTERVAL '1 day')
          AND LOWER(TRIM(COALESCE(o.status, ''))) IN ('open', 'close', 'closed')
          AND LOWER(TRIM(COALESCE(o.ro_sub_status, ''))) IN ('final inspection', 'work ended')
          ${openRoDealerFilter(dealerCode, 'o')}
        ORDER BY COALESCE(NULLIF(o.r_o_no, ''), o.id::text), o.uploaded_at DESC NULLS LAST, o.id DESC
      ),
      supplement AS (
        SELECT *
        FROM operational o
        WHERE o.ro_sub_status = 'work ended'
          OR NOT EXISTS (
            SELECT 1
            FROM billed b
            WHERE b.jc_key = o.jc_key
          )
      )
      SELECT
        service_category,
        COUNT(*) FILTER (WHERE report_date = ${exportDate}::date)::int AS today_count,
        COUNT(*)::int AS mtd_count
      FROM supplement
      WHERE service_category IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')
      GROUP BY service_category
    `),
  ])

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

  resultRows(operationalSupplementResult).forEach((row) => {
    const category = String(row.service_category || '') as ServiceCategory
    if (!SERVICE_CATEGORIES.includes(category)) return

    delivered[category].today += numberValue(row.today_count)
    delivered[category].mtd += numberValue(row.mtd_count)
  })

  return { delivered, ...totals }
}

async function fetchPendingCounts(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    WITH pending AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(o.r_o_no, ''), o.id::text))
        o.ro_date::date AS report_date,
        ${serviceCategoryExpression('o.work_type', 'o.service_type')} AS service_category,
        o.uploaded_at,
        o.id
      FROM open_ro_yearly o
      WHERE LOWER(TRIM(COALESCE(o.status, ''))) IN ('open', 'close', 'closed')
        AND o.ro_date >= (${exportDate}::date - INTERVAL '30 days')::date
        AND o.ro_date < (${exportDate}::date + INTERVAL '1 day')
        ${openRoDealerFilter(dealerCode, 'o')}
        AND NOT EXISTS (
          SELECT 1
          FROM ro_billing_report rb2
          WHERE rb2.bill_date < (${exportDate}::date + INTERVAL '1 day')
            AND ${activeBillStatusSql('rb2.')}
            ${roBillingDealerFilter(dealerCode, 'rb2.')}
            AND COALESCE(NULLIF(rb2.ro_no, ''), NULLIF(rb2.bill_no, ''), rb2.id::text)
              = COALESCE(NULLIF(o.r_o_no, ''), o.id::text)
            AND (
              (
                ${serviceCategoryExpression('o.work_type', 'o.service_type')} = 'Accidental Repair'
                AND (
                  LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%'
                  OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%'
                )
              )
              OR (
                ${serviceCategoryExpression('o.work_type', 'o.service_type')} <> 'Accidental Repair'
                AND NOT (
                  LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%accident%'
                  OR LOWER(CONCAT_WS(' ', rb2.work_type, rb2.service_type)) LIKE '%bodyshop%'
                )
              )
            )
        )
      ORDER BY COALESCE(NULLIF(o.r_o_no, ''), o.id::text), o.uploaded_at DESC NULLS LAST, o.id DESC
    )
    SELECT
      COUNT(*) FILTER (
        WHERE service_category = 'Accidental Repair'
          AND report_date = ${exportDate}::date
      )::int AS accidental_today,
      COUNT(*) FILTER (WHERE service_category = 'Accidental Repair')::int AS accidental_mtd,
      COUNT(*) FILTER (
        WHERE service_category <> 'Accidental Repair'
          AND report_date = ${exportDate}::date
      )::int AS mechanical_today,
      COUNT(*) FILTER (WHERE service_category <> 'Accidental Repair')::int AS mechanical_mtd
    FROM pending
  `)

  const row = resultRows(result)[0] || {}
  return {
    accidental: { today: numberValue(row.accidental_today), mtd: numberValue(row.accidental_mtd) },
    mechanical: { today: numberValue(row.mechanical_today), mtd: numberValue(row.mechanical_mtd) },
  }
}

async function fetchBodyshopPnaCases(exportDate: string, dealerCode: DealerFilter) {
  const result = await db.execute(sql`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(o.r_o_no, ''), o.id::text))::int AS count
    FROM open_ro_yearly o
    WHERE LOWER(TRIM(COALESCE(o.status, ''))) IN ('open', 'close', 'closed')
      AND o.ro_date < (${exportDate}::date + INTERVAL '1 day')
      AND (
        o.work_type = 'Accidental Repair'
        OR LOWER(CONCAT_WS(' ', o.work_type, o.service_type)) LIKE '%accident%'
        OR LOWER(CONCAT_WS(' ', o.work_type, o.service_type)) LIKE '%bodyshop%'
      )
      AND (
        LOWER(COALESCE(o.delay_reason, '')) LIKE '%parts not available%'
        OR LOWER(COALESCE(o.delay_reason, '')) LIKE '%pna%'
      )
      ${openRoDealerFilter(dealerCode, 'o')}
  `)
  return numberValue(resultRows(result)[0]?.count)
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
        WHERE invoice_date::date >= ${monthStart}::date
          AND invoice_date::date < (${exportDate}::date + INTERVAL '1 day')
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

async function fetchOilMetrics(monthStart: string, exportDate: string, dealerCode: DealerFilter) {
  const emptyOil = {
    engineOilQty: { today: 0, mtd: 0 },
    syntheticOilQty: { today: 0, mtd: 0 },
  }

  let invoiceMetrics: typeof emptyOil | null = null
  const hasInvoiceWise = await tableExists('adv_wise_lubricants_vas')
  if (hasInvoiceWise) {
    const result = await db.execute(sql`
      WITH invoice_rows AS (
        SELECT DISTINCT ON (COALESCE(NULLIF(row_hash, ''), id::text))
          COALESCE(gst_invoice_date, ro_close_date::date) AS report_date,
          ${numericText(sql.raw('qty_hrs'))} AS quantity,
          UPPER(TRIM(COALESCE(part_no, ''))) AS part_no,
          UPPER(TRIM(COALESCE(op_part_code, ''))) AS op_part_code,
          LOWER(CONCAT_WS(' ', op_part_desc, labour_desc, part_desc, part_no, op_part_code)) AS description
        FROM adv_wise_lubricants_vas
        WHERE COALESCE(gst_invoice_date, ro_close_date::date) >= ${monthStart}::date
          AND COALESCE(gst_invoice_date, ro_close_date::date) < (${exportDate}::date + INTERVAL '1 day')
          ${advWiseDealerFilter(dealerCode)}
        ORDER BY COALESCE(NULLIF(row_hash, ''), id::text), uploaded_at DESC NULLS LAST, id DESC
      ),
      classified AS (
        SELECT
          *,
          ${engineOilPartCodeMatchSql('part_no', 'op_part_code')} AS is_engine_oil,
          ${syntheticOilMatchSql('description')} AS is_synthetic
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
    invoiceMetrics = {
      engineOilQty: { today: numberValue(row.engine_today), mtd: numberValue(row.engine_mtd) },
      syntheticOilQty: { today: numberValue(row.synthetic_today), mtd: numberValue(row.synthetic_mtd) },
    }
  }

  if (!(await tableExists('operation_wise_analysis_report'))) {
    return invoiceMetrics ?? emptyOil
  }

  const period = await resolveOperationAnalysisPeriod(monthStart, exportDate, dealerCode, true)
  if (!period) {
    return invoiceMetrics ?? emptyOil
  }

  const forwardOil = await fetchEngineOilQtyByPeriod(period, dealerCode)
  let engineMtd = forwardOil.engineMtd

  if (usesForwardGapSnapshot(period, exportDate)) {
    const belowPeriod = await resolveOperationAnalysisPeriod(monthStart, exportDate, dealerCode, false)
    if (belowPeriod) {
      const belowOil = await fetchEngineOilQtyByPeriod(belowPeriod, dealerCode)
      const npneng3Delta = Math.max(0, forwardOil.npneng3Mtd - belowOil.npneng3Mtd)
      engineMtd = Math.max(0, Math.floor(engineMtd - npneng3Delta))
    }
  }

  const operationMetrics = {
    engineOilQty: {
      today: cleanNumber(engineMtd, 1),
      mtd: cleanNumber(engineMtd, 1),
    },
    syntheticOilQty: {
      today: 0,
      mtd: 0,
    },
  }

  if (!invoiceMetrics || invoiceMetrics.engineOilQty.mtd <= 0) return operationMetrics
  if (operationMetrics.engineOilQty.mtd > invoiceMetrics.engineOilQty.mtd) return operationMetrics
  return invoiceMetrics
}

function parseSnapshotJson<T>(value: unknown): T | null {
  if (value && typeof value === 'object') return value as T
  if (typeof value !== 'string') return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

async function fetchStoredServiceDashboardSnapshot(
  reportDate: string,
  dealerCode: DealerFilter,
): Promise<ServiceDashboardMetrics | null> {
  try {
    const rows = await postgresDb.execute(sql`
      SELECT metrics, cell_overrides, source_label, is_verified, created_at, updated_at
      FROM kia_service_dashboard_snapshots
      WHERE dealer_code = ${dealerCode || 'all'}
        AND report_date = ${reportDate}::date
      LIMIT 1
    `)
    const row = resultRows(rows)[0]
    const metrics = parseSnapshotJson<ServiceDashboardMetrics>(row?.metrics)
    if (!metrics) return null

    const displayOverrides = parseSnapshotJson<Record<string, ServiceDashboardCellValue>>(row.cell_overrides) || {}
    const sourceWarnings = [
      ...(metrics.sourceWarnings || []),
      row.is_verified
        ? `Verified historical snapshot: ${String(row.source_label || reportDate)}`
        : `Saved historical snapshot: ${String(row.source_label || reportDate)}`,
    ]

    return {
      ...metrics,
      exportDate: reportDate,
      displayOverrides,
      sourceWarnings,
      sourceMetadata: {
        ...metrics.sourceMetadata,
        snapshotMode: row.is_verified ? 'verified_historical' : 'captured_historical',
        snapshotCreatedAt: row.created_at,
        snapshotUpdatedAt: row.updated_at,
        sourceLabel: row.source_label,
      },
    }
  } catch (error) {
    const code = String((error as { cause?: { code?: unknown }; code?: unknown })?.cause?.code
      || (error as { code?: unknown })?.code
      || '')
    if (code !== '42P01') {
      console.warn('[kia-service-dashboard] snapshot lookup failed; using live reconstruction', error)
    }
    return null
  }
}

async function buildLiveMetrics(endDate: string | null, dealerCode: DealerFilter): Promise<ServiceDashboardMetrics> {
  const effectiveDealerCode = resolveServiceDashboardDealerCode(dealerCode)
  const exportDate = await resolveExportDate(endDate, effectiveDealerCode)
  const monthStart = getMonthStart(exportDate)

  const [intake, pending, revenue, addons, operations, oil, vasAmount, bodyshopPnaCases, workingDays] = await Promise.all([
    fetchIntakeCounts(monthStart, exportDate, effectiveDealerCode),
    fetchPendingCounts(monthStart, exportDate, effectiveDealerCode),
    fetchRevenueAndDelivered(monthStart, exportDate, effectiveDealerCode),
    fetchAddonCounts(monthStart, exportDate, effectiveDealerCode),
    fetchOperationMetrics(monthStart, exportDate, effectiveDealerCode),
    fetchOilMetrics(monthStart, exportDate, effectiveDealerCode),
    fetchVasAmount(monthStart, exportDate, effectiveDealerCode),
    fetchBodyshopPnaCases(exportDate, effectiveDealerCode),
    getKiaWorkingDayContext(monthStart, exportDate),
  ])
  const deliveredCount = SERVICE_CATEGORIES.reduce(
    (sum, category) => sum + revenue.delivered[category].mtd,
    0,
  )

  const metrics: ServiceDashboardMetrics = {
    exportDate,
    monthStart,
    intake,
    pending,
    revenue,
    addons,
    operations,
    oil,
    vasAmount,
    bodyshopPnaCases,
    sourceMetadata: buildKiaSourceMetadata({
      dealerCode: effectiveDealerCode,
      dateBasis: 'ro_date intake; bill_date delivered/revenue; open RO status as-of end date',
      startDate: monthStart,
      endDate: exportDate,
      rowCount: deliveredCount,
      latestAvailableDate: exportDate,
      deduplicationMode: 'RO/job-card key; billed and open intake union; active bill value ranking',
      ...workingDays,
    }),
    sourceWarnings: [
      'Live reconstruction uses the latest stored source rows. Historical dates can include corrections loaded after the selected date unless a saved dashboard snapshot exists.',
    ],
  }


  return metrics
}

async function buildMetrics(endDate: string | null, dealerCode: DealerFilter): Promise<ServiceDashboardMetrics> {
  const effectiveDealerCode = resolveServiceDashboardDealerCode(dealerCode)
  const requestedDate = parseDateInput(endDate)
  if (requestedDate) {
    const requestedSnapshot = await fetchStoredServiceDashboardSnapshot(requestedDate, effectiveDealerCode)
    if (requestedSnapshot) return requestedSnapshot
  }

  const exportDate = await resolveExportDate(endDate, effectiveDealerCode)
  const resolvedSnapshot = await fetchStoredServiceDashboardSnapshot(exportDate, effectiveDealerCode)
  if (resolvedSnapshot) return resolvedSnapshot

  return buildLiveMetrics(exportDate, effectiveDealerCode)
}

export const buildServiceDashboardMetrics = buildMetrics
export const buildLiveServiceDashboardMetrics = buildLiveMetrics

export async function getCachedServiceDashboardMetrics(
  endDate?: string | null,
  dealerCode?: DealerFilter,
) {
  const effectiveDealerCode = resolveServiceDashboardDealerCode(dealerCode || null)
  const resolvedEndDate = await resolveExportDate(endDate || null, effectiveDealerCode)
  return getCachedData(
    serviceDashboardCacheKey('metrics', resolvedEndDate, effectiveDealerCode),
    () => buildMetrics(resolvedEndDate, effectiveDealerCode),
    CACHE_TTL.DASHBOARD,
  )
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

function setSnapshotPair(worksheet: ExcelJS.Worksheet, row: number, value: number, fractionDigits = 0) {
  setNumber(worksheet, `B${row}`, value, fractionDigits)
  setNumber(worksheet, `C${row}`, value, fractionDigits)
}

function setFormulaPair(worksheet: ExcelJS.Worksheet, row: number, formula: string, result: number, fractionDigits = 0) {
  setFormula(worksheet, `B${row}`, formula, result, fractionDigits)
  setFormula(worksheet, `C${row}`, formula, result, fractionDigits)
}

export function toArrayBuffer(value: ArrayBuffer | Uint8Array) {
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

export function fillServiceDashboardWorksheet(worksheet: ExcelJS.Worksheet, metrics: ServiceDashboardMetrics) {
  worksheet.name = 'Service Dashboard'
  worksheet.getColumn('A').width = 38.140625
  worksheet.getColumn('B').width = 24.28515625
  worksheet.getColumn('C').width = 13
  worksheet.pageSetup.printArea = 'A1:C42'

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

  const mechanicalLabourToday = Math.round(metrics.revenue.mechanicalLabour.today)
  const mechanicalLabourMtd = Math.round(metrics.revenue.mechanicalLabour.mtd)
  const mechanicalPartsToday = Math.ceil(metrics.revenue.mechanicalParts.today)
  const mechanicalPartsMtd = Math.ceil(metrics.revenue.mechanicalParts.mtd)
  const bodyshopLabourToday = Math.round(metrics.revenue.bodyshopLabour.today)
  const bodyshopLabourMtd = Math.round(metrics.revenue.bodyshopLabour.mtd)
  const bodyshopPartsToday = Math.round(metrics.revenue.bodyshopParts.today)
  const bodyshopPartsMtd = Math.round(metrics.revenue.bodyshopParts.mtd)

  setNumber(worksheet, 'B15', mechanicalLabourToday, 0)
  setNumber(worksheet, 'C15', mechanicalLabourMtd, 0)
  setNumber(worksheet, 'B16', mechanicalPartsToday, 0)
  setNumber(worksheet, 'C16', mechanicalPartsMtd, 0)
  setNumber(worksheet, 'B17', bodyshopLabourToday, 0)
  setNumber(worksheet, 'C17', bodyshopLabourMtd, 0)
  setNumber(worksheet, 'B18', bodyshopPartsToday, 0)
  setNumber(worksheet, 'C18', bodyshopPartsMtd, 0)

  const totalLabourToday = mechanicalLabourToday + bodyshopLabourToday
  const totalLabourMtd = mechanicalLabourMtd + bodyshopLabourMtd
  const totalPartsToday = mechanicalPartsToday + bodyshopPartsToday
  const totalPartsMtd = mechanicalPartsMtd + bodyshopPartsMtd
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

  setSnapshotPair(worksheet, 24, metrics.operations.alignmentCount, 0)
  setSnapshotPair(worksheet, 25, metrics.operations.balancingCount, 0)
  setSnapshotPair(worksheet, 26, metrics.operations.alignmentLabour, 0)
  setSnapshotPair(worksheet, 27, metrics.operations.balancingLabour, 0)

  const mechDeliveredMtd = metrics.revenue.delivered['Free Service'].mtd
    + metrics.revenue.delivered['Paid Service'].mtd
    + metrics.revenue.delivered['Running Repair'].mtd
  const bodyshopDeliveredMtd = metrics.revenue.delivered['Accidental Repair'].mtd
  const averageRoDenominator = metrics.sourceMetadata.workingDayCount || 1
  const averageRo = totalVehicleMtd / averageRoDenominator
  const averageRoFormula = `IFERROR((C2+C3+C4+C5)/${averageRoDenominator},0)`
  const averageLabourFormula = 'IFERROR(C13/(C19+C20+C21+C22),0)'
  const averageLabourMechFormula = 'IFERROR(C15/(C19+C20+C21),0)'
  const averageLabourBsFormula = 'IFERROR(C17/C22,0)'
  const averagePartsFormula = 'IFERROR(C14/(C19+C20+C21+C22),0)'
  const averagePartsMechFormula = 'IFERROR(C16/(C19+C21+C20),0)'
  const averagePartsBsFormula = 'IFERROR(C18/C22,0)'
  const oilPerRoFormula = 'IFERROR(B35/(C2+C3+C4+C5),0)'
  const oilPerRoMtdFormula = 'IFERROR(C35/(C2+C3+C4+C5),0)'
  const oilPerRoMechFormula = 'IFERROR(B35/(C19+C20+C21),0)'
  const oilPerRoMechMtdFormula = 'IFERROR(C35/(C19+C20+C21),0)'
  const vasSubtraction = cleanNumber(metrics.vasAmount, 0)
  const labourWithoutVasFormula = `IFERROR((C13-${vasSubtraction})/C23,0)`

  setFormulaPair(worksheet, 28, averageRoFormula, averageRo, 0)
  setFormulaPair(worksheet, 29, averageLabourFormula, safeDivide(totalLabourMtd, totalDeliveredMtd), 0)
  setFormulaPair(worksheet, 30, averageLabourMechFormula, safeDivide(metrics.revenue.mechanicalLabour.mtd, mechDeliveredMtd), 0)
  setFormulaPair(worksheet, 31, averageLabourBsFormula, safeDivide(metrics.revenue.bodyshopLabour.mtd, bodyshopDeliveredMtd), 0)
  setFormulaPair(worksheet, 32, averagePartsFormula, safeDivide(totalPartsMtd, totalDeliveredMtd), 0)
  setFormulaPair(worksheet, 33, averagePartsMechFormula, safeDivide(metrics.revenue.mechanicalParts.mtd, mechDeliveredMtd), 0)
  setFormulaPair(worksheet, 34, averagePartsBsFormula, safeDivide(metrics.revenue.bodyshopParts.mtd, bodyshopDeliveredMtd), 0)

  setNumber(worksheet, 'B35', Math.round(metrics.oil.engineOilQty.today), 0)
  setNumber(worksheet, 'C35', Math.round(metrics.oil.engineOilQty.mtd), 0)
  setFormula(worksheet, 'B36', oilPerRoFormula, safeDivide(metrics.oil.engineOilQty.today, totalVehicleMtd), 0)
  setFormula(worksheet, 'C36', oilPerRoMtdFormula, safeDivide(metrics.oil.engineOilQty.mtd, totalVehicleMtd), 0)
  setNumber(worksheet, 'B37', metrics.oil.syntheticOilQty.today, 1)
  setNumber(worksheet, 'C37', metrics.oil.syntheticOilQty.mtd, 1)
  setNumber(worksheet, 'B38', safeDivide(metrics.oil.syntheticOilQty.today, totalVehicleToday), 2)
  setNumber(worksheet, 'C38', safeDivide(metrics.oil.syntheticOilQty.mtd, totalVehicleMtd), 2)
  setSnapshotPair(worksheet, 39, 0, 0)
  setFormula(worksheet, 'B40', oilPerRoMechFormula, safeDivide(metrics.oil.engineOilQty.today, mechDeliveredMtd), 0)
  setFormula(worksheet, 'C40', oilPerRoMechMtdFormula, safeDivide(metrics.oil.engineOilQty.mtd, mechDeliveredMtd), 0)
  setFormulaPair(worksheet, 41, labourWithoutVasFormula, safeDivide(totalLabourMtd - metrics.vasAmount, totalDeliveredMtd), 0)

  for (const rowNumber of metrics.unavailableRows || []) {
    worksheet.getCell(`B${rowNumber}`).value = 'N/A'
    worksheet.getCell(`C${rowNumber}`).value = 'N/A'
  }

  // Copy row 41 styling to row 42 for Bodyshop PNA Cases
  const row41 = worksheet.getRow(41)
  const row42 = worksheet.getRow(42)
  row42.height = row41.height

  const cellA42 = row42.getCell(1)
  cellA42.value = 'Bodyshop PNA Cases'
  cellA42.style = { ...row41.getCell(1).style }

  const cellB42 = row42.getCell(2)
  cellB42.value = metrics.bodyshopPnaCases
  cellB42.style = { ...row41.getCell(2).style }

  const cellC42 = row42.getCell(3)
  cellC42.value = metrics.bodyshopPnaCases
  cellC42.style = { ...row41.getCell(3).style }

  worksheet.mergeCells('B42:C42')

  for (const [address, value] of Object.entries(metrics.displayOverrides || {})) {
    worksheet.getCell(address).value = value
  }
}

export function buildServiceDashboardPreviewPayload(
  worksheet: ExcelJS.Worksheet,
  metrics: ServiceDashboardMetrics,
  fileName: string,
): KiaServiceDashboardPreview {
  const merges = [...(worksheet.model.merges || [])]
  const mergeLookup = buildMergeLookup(merges)
  const rows: KiaServiceDashboardPreview['rows'] = []

  for (let rowIndex = 1; rowIndex <= 42; rowIndex += 1) {
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
    range: 'A1:C42',
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

export async function buildKiaServiceDashboardWorkbook({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}) {
  const normalizedEndDate = parseDateInput(endDate || null)
  const effectiveDealerCode = resolveServiceDashboardDealerCode(dealerCode || null)
  const metrics = await getCachedServiceDashboardMetrics(normalizedEndDate, effectiveDealerCode)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await loadTemplateBuffer() as any)

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

async function buildKiaServiceDashboardPreviewUncached({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardPreview> {
  const { worksheet, metrics, fileName } = await buildKiaServiceDashboardWorkbook({ endDate, dealerCode })
  return buildServiceDashboardPreviewPayload(worksheet, metrics, fileName)
}

export async function buildKiaServiceDashboardPreview({
  endDate,
  dealerCode,
}: {
  endDate?: string | null
  dealerCode?: DealerFilter
}): Promise<KiaServiceDashboardPreview> {
  const effectiveDealerCode = resolveServiceDashboardDealerCode(dealerCode || null)
  const resolvedEndDate = await resolveExportDate(endDate || null, effectiveDealerCode)
  return getCachedData(
    serviceDashboardCacheKey('preview', resolvedEndDate, effectiveDealerCode),
    () => buildKiaServiceDashboardPreviewUncached({ endDate: resolvedEndDate, dealerCode: effectiveDealerCode }),
    CACHE_TTL.DASHBOARD,
  )
}
