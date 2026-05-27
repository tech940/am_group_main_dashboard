import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const tableExistsCache = new Map<string, boolean>()

type NumericRow = Record<string, unknown>

type ServiceAggregate = {
  serviceType: string
  groupType?: string
  totalJc: number
  labourAmount: number
  partAmount: number
  totalAmount: number
  discountAmount: number
}

type AddonAggregate = {
  serviceType: string
  vasAmount: number
  waCount: number
  waAmount: number
  wbCount: number
  wbAmount: number
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInput(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
    if (year && month && day) return new Date(year, month - 1, day)
  }
  return null
}

function sameDateLastYear(date: Date) {
  return new Date(date.getFullYear() - 1, date.getMonth(), date.getDate())
}

function defaultRange() {
  const today = new Date()
  return {
    startDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toDateInputValue(today),
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? (result as NumericRow[]) : []
}

function numericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

function percent(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0
}

function perRo(amount: number, totalJc: number) {
  return totalJc > 0 ? amount / totalJc : 0
}

function growth(current: number, previous: number) {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

function cacheKey(startDate: string, endDate: string) {
  return `kia:business-excellence:workshop-performance:v15:${createHash('sha1')
    .update(`${startDate}:${endDate}`)
    .digest('hex')}`
}

async function tableExists(tableName: string) {
  if (tableExistsCache.has(tableName)) {
    return tableExistsCache.get(tableName)!
  }

  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  const exists = Boolean(resultRows(result)[0]?.exists)
  tableExistsCache.set(tableName, exists)
  return exists
}

async function fetchServiceSummary(startDate: string, endDate: string): Promise<ServiceAggregate[]> {
  const result = await db.execute(await tableExists('workshop_performance_jc_summary_v1') ? sql`
    SELECT
      group_type,
      service_type,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount,
      COALESCE(SUM(total_amount), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY group_type, service_type
    ORDER BY group_type ASC, total_jc DESC, service_type ASC
  ` : sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(work_type, ''), NULLIF(service_type, ''), 'Unspecified') AS group_type,
        COALESCE(NULLIF(service_type, ''), NULLIF(work_type, ''), 'Unspecified') AS service_type,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt,
        COALESCE(total_amt, 0)::numeric AS total_amt,
        GREATEST(
          COALESCE(dis_amt, 0)::numeric,
          COALESCE(total_disc, 0)::numeric,
          ${numericText(sql.raw('labour_disc'))},
          ${numericText(sql.raw('part_disc'))}
        ) AS discount_amount
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
    ),
    dedup AS (
      SELECT
        group_type,
        service_type,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt,
        (ARRAY_AGG(total_amt ORDER BY ABS(total_amt) DESC))[1] AS total_amt,
        MAX(discount_amount) AS discount_amount
      FROM base
      GROUP BY group_type, service_type, jc_key
    )
    SELECT
      group_type,
      service_type,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount,
      COALESCE(SUM(total_amt), 0)::float AS total_amount,
      COALESCE(SUM(discount_amount), 0)::float AS discount_amount
    FROM dedup
    GROUP BY group_type, service_type
    ORDER BY group_type ASC, total_jc DESC, service_type ASC
  `)

  return resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    groupType: String(row.group_type || row.service_type || 'Unspecified'),
    totalJc: numberValue(row.total_jc),
    labourAmount: numberValue(row.labour_amount),
    partAmount: numberValue(row.part_amount),
    totalAmount: numberValue(row.total_amount),
    discountAmount: numberValue(row.discount_amount),
  }))
}

async function fetchAddonSummary(startDate: string, endDate: string): Promise<AddonAggregate[]> {
  if (await tableExists('workshop_operation_addon_summary_v1')) {
    const result = await db.execute(sql`
      SELECT
        'Others' AS service_type,
        COALESCE(SUM(vas_amount), 0)::float AS vas_amount,
        COALESCE(SUM(wa_count), 0)::int AS wa_count,
        COALESCE(SUM(wa_amount), 0)::float AS wa_amount,
        COALESCE(SUM(wb_count), 0)::int AS wb_count,
        COALESCE(SUM(wb_amount), 0)::float AS wb_amount
      FROM workshop_operation_addon_summary_v1
      WHERE report_month >= date_trunc('month', ${startDate}::date)::date
        AND report_month <= date_trunc('month', ${endDate}::date)::date
    `)

    return resultRows(result).map((row) => ({
      serviceType: String(row.service_type || 'Unspecified'),
      vasAmount: numberValue(row.vas_amount),
      waCount: numberValue(row.wa_count),
      waAmount: numberValue(row.wa_amount),
      wbCount: numberValue(row.wb_count),
      wbAmount: numberValue(row.wb_amount),
    }))
  }

  if (!(await tableExists('operation_wise_analysis_report'))) return []

  const result = await db.execute(sql`
    WITH operation_rows AS (
      SELECT
        COALESCE(NULLIF(op_part_code, ''), id::text) AS addon_key,
        ABS(${numericText(sql.raw('total_amt'))}) AS amount,
        GREATEST(
          ABS(${numericText(sql.raw('total_count'))}),
          ABS(${numericText(sql.raw('sp2ib_seltos_1_5_petrol_count'))}),
          ABS(${numericText(sql.raw('sp2ic_seltos_1_4_petrol_count'))}),
          ABS(${numericText(sql.raw('sp2id_seltos_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('carnival_count'))}),
          ABS(${numericText(sql.raw('qy1ib_sonet_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('qy1ic_sonet_1_0_gasoline_count'))}),
          ABS(${numericText(sql.raw('qy1id_sonet_1_2_gasoline_count'))}),
          ABS(${numericText(sql.raw('ky1ia_carens_1_5_gasoline_count'))}),
          ABS(${numericText(sql.raw('ky1ib_carens_1_5_diesel_count'))}),
          ABS(${numericText(sql.raw('ky1ic_carens_1_4_gasoline_count'))})
        ) AS operation_count,
        LOWER(COALESCE(op_part_code, '')) AS operation_code,
        LOWER(CONCAT_WS(
          ' ',
          report_type,
          op_part_code,
          op_part_desc
        )) AS description
      FROM operation_wise_analysis_report
      WHERE report_month >= date_trunc('month', ${startDate}::date)::date
        AND report_month <= date_trunc('month', ${endDate}::date)::date
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
        ) AS is_wb,
        (
          operation_code ~ '(^|[^a-z])vas([^a-z]|$)'
            OR description ~ '(value[[:space:]-]*added|(^|[^a-z])vas([^a-z]|$))'
            OR description ~ '(ac[[:space:]-]*evaporator[[:space:]-]*cleaning|throttle[[:space:]-]*body[[:space:]-]*carbon|carbon[[:space:]-]*cleaning|ac[[:space:]-]*disinfectant|rodent[[:space:]-]*repellent)'
            OR description ~ '(under[[:space:]-]*body[[:space:]-]*coating|interior[[:space:]-]*enrichment|exterior[[:space:]-]*enrichment|alloy[[:space:]-]*wheel[[:space:]-]*care)'
            OR description ~ '(air[[:space:]-]*intake[[:space:]-]*cleaning|engine[[:space:]-]*dressing|service[[:space:]-]*lubrication|wheel[[:space:]-]*drum[[:space:]-]*painting|silencer[[:space:]-]*coating)'
        ) AS is_vas
      FROM operation_rows
    )
    SELECT
      'Others' AS service_type,
      COALESCE(SUM(amount) FILTER (WHERE is_vas), 0)::float AS vas_amount,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wa), 0)::int AS wa_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wa), 0)::float AS wa_amount,
      COALESCE(SUM(operation_count) FILTER (WHERE is_wb), 0)::int AS wb_count,
      COALESCE(SUM(amount) FILTER (WHERE is_wb), 0)::float AS wb_amount
    FROM classified
  `)

  return resultRows(result).map((row) => ({
    serviceType: String(row.service_type || 'Unspecified'),
    vasAmount: numberValue(row.vas_amount),
    waCount: numberValue(row.wa_count),
    waAmount: numberValue(row.wa_amount),
    wbCount: numberValue(row.wb_count),
    wbAmount: numberValue(row.wb_amount),
  }))
}

async function fetchDailyTrend(startDate: string, endDate: string) {
  const result = await db.execute(await tableExists('workshop_performance_jc_summary_v1') ? sql`
    SELECT
      report_date AS bill_date,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY report_date
    ORDER BY report_date ASC
  ` : sql`
    WITH base AS (
      SELECT
        bill_date::date AS bill_date,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
    ),
    dedup AS (
      SELECT
        bill_date,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      GROUP BY bill_date, jc_key
    )
    SELECT
      bill_date,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY bill_date
    ORDER BY bill_date ASC
  `)

  return resultRows(result).map((row) => ({
    date: String(row.bill_date).slice(0, 10),
    totalJc: numberValue(row.total_jc),
    labourAmount: numberValue(row.labour_amount),
    partAmount: numberValue(row.part_amount),
    totalRevenue: numberValue(row.labour_amount) + numberValue(row.part_amount),
  }))
}

async function fetchAdvisorSummary(startDate: string, endDate: string) {
  const result = await db.execute(await tableExists('workshop_performance_jc_summary_v1') ? sql`
    SELECT
      service_advisor AS advisor,
      COUNT(DISTINCT jc_key)::int AS total_jc,
      COALESCE(SUM(labour_amount), 0)::float AS labour_amount,
      COALESCE(SUM(part_amount), 0)::float AS part_amount
    FROM workshop_performance_jc_summary_v1
    WHERE report_date >= ${startDate}::date
      AND report_date < (${endDate}::date + INTERVAL '1 day')
    GROUP BY service_advisor
    ORDER BY (COALESCE(SUM(labour_amount), 0) + COALESCE(SUM(part_amount), 0)) DESC
    LIMIT 10
  ` : sql`
    WITH base AS (
      SELECT
        COALESCE(NULLIF(service_advisor, ''), 'Unspecified') AS advisor,
        COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text) AS jc_key,
        COALESCE(labour_amt, 0)::numeric AS labour_amt,
        COALESCE(part_amt, 0)::numeric AS part_amt
      FROM ro_billing_report
      WHERE bill_date >= ${startDate}::date
        AND bill_date < (${endDate}::date + INTERVAL '1 day')
    ),
    dedup AS (
      SELECT
        advisor,
        jc_key,
        (ARRAY_AGG(labour_amt ORDER BY ABS(labour_amt) DESC))[1] AS labour_amt,
        (ARRAY_AGG(part_amt ORDER BY ABS(part_amt) DESC))[1] AS part_amt
      FROM base
      GROUP BY advisor, jc_key
    )
    SELECT
      advisor,
      COUNT(*)::int AS total_jc,
      COALESCE(SUM(labour_amt), 0)::float AS labour_amount,
      COALESCE(SUM(part_amt), 0)::float AS part_amount
    FROM dedup
    GROUP BY advisor
    ORDER BY (COALESCE(SUM(labour_amt), 0) + COALESCE(SUM(part_amt), 0)) DESC
    LIMIT 10
  `)

  return resultRows(result).map((row) => {
    const labourAmount = numberValue(row.labour_amount)
    const partAmount = numberValue(row.part_amount)
    const totalJc = numberValue(row.total_jc)
    return {
      advisor: String(row.advisor || 'Unspecified'),
      totalJc,
      labourAmount,
      partAmount,
      totalRevenue: labourAmount + partAmount,
      avgBilling: perRo(labourAmount + partAmount, totalJc),
    }
  })
}

async function fetchAuxiliaryKpis(startDate: string, endDate: string) {
  const [hasEw, hasMcp, hasRsa] = await Promise.all([
    tableExists('ew_report'),
    tableExists('mcp_report'),
    tableExists('rsa_report'),
  ])

  const [ew, mcp, rsa] = await Promise.all([
    hasEw
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM ew_report
          WHERE reg_date >= ${startDate}::date
            AND reg_date < (${endDate}::date + INTERVAL '1 day')
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasMcp
      ? db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM mcp_report
          WHERE package_purchase_date >= ${startDate}::date
            AND package_purchase_date < (${endDate}::date + INTERVAL '1 day')
        `)
      : Promise.resolve([{ count: 0 }] as NumericRow[]),
    hasRsa
      ? db.execute(sql`
          SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(total_amount), 0)::float AS amount
          FROM rsa_report
          WHERE invoice_date >= ${startDate}::date
            AND invoice_date < (${endDate}::date + INTERVAL '1 day')
        `)
      : Promise.resolve([{ count: 0, amount: 0 }] as NumericRow[]),
  ])

  return {
    ewCount: numberValue(resultRows(ew)[0]?.count),
    mcpCount: numberValue(resultRows(mcp)[0]?.count),
    rsaCount: numberValue(resultRows(rsa)[0]?.count),
    rsaAmount: numberValue(resultRows(rsa)[0]?.amount),
  }
}

function normalizedServiceKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function buildRows(serviceRows: ServiceAggregate[], addonRows: AddonAggregate[] = []) {
  const combinedServiceRows = serviceRows
  const totalJc = combinedServiceRows.reduce((total, row) => total + row.totalJc, 0)
  const totalLabour = combinedServiceRows.reduce((total, row) => total + row.labourAmount, 0)
  const addonByService = new Map(addonRows.map((row) => [normalizedServiceKey(row.serviceType), row]))
  const assignedAddonKeys = new Set<string>()

  const rows = combinedServiceRows.map((row) => {
    const addonKey = normalizedServiceKey(row.serviceType)
    const addon = addonByService.get(addonKey)
    if (addon) assignedAddonKeys.add(addonKey)

    const vasAmount = addon?.vasAmount || 0
    const waCount = addon?.waCount || 0
    const waAmount = addon?.waAmount || 0
    const wbCount = addon?.wbCount || 0
    const wbAmount = addon?.wbAmount || 0
    const labMinusVas = Math.max(row.labourAmount - vasAmount, 0)

    return {
      serviceType: row.serviceType,
      groupType: row.groupType,
      totalJc: row.totalJc,
      totalJcPercent: percent(row.totalJc, totalJc),
      labourAmount: row.labourAmount,
      labourPercent: percent(row.labourAmount, totalLabour),
      labourPerRo: perRo(row.labourAmount, row.totalJc),
      lessVas: vasAmount,
      vasPercent: percent(vasAmount, row.labourAmount),
      labPerRoMinusVas: perRo(labMinusVas, row.totalJc),
      labMinusVas,
      spareSale: row.partAmount,
      sparePerRo: perRo(row.partAmount, row.totalJc),
      discount: row.discountAmount,
      waCount,
      waAmount,
      waPerRoPercent: percent(waCount, row.totalJc),
      wbCount,
      wbAmount,
      wbPerRoPercent: percent(wbCount, row.totalJc),
      ewCount: 0,
      rsaCount: 0,
      mcpCount: 0,
    }
  })

  addonRows.forEach((addon) => {
    const addonKey = normalizedServiceKey(addon.serviceType)
    if (assignedAddonKeys.has(addonKey)) return

    rows.push({
      serviceType: addon.serviceType || 'Others',
      groupType: addon.serviceType || 'Others',
      totalJc: 0,
      totalJcPercent: 0,
      labourAmount: 0,
      labourPercent: 0,
      labourPerRo: 0,
      lessVas: addon.vasAmount,
      vasPercent: 0,
      labPerRoMinusVas: 0,
      labMinusVas: 0,
      spareSale: 0,
      sparePerRo: 0,
      discount: 0,
      waCount: addon.waCount,
      waAmount: addon.waAmount,
      waPerRoPercent: 0,
      wbCount: addon.wbCount,
      wbAmount: addon.wbAmount,
      wbPerRoPercent: 0,
      ewCount: 0,
      rsaCount: 0,
      mcpCount: 0,
    })
  })

  return rows
}

function summarizeAddons(addonRows: AddonAggregate[]) {
  return addonRows.reduce((total, row) => ({
    vasAmount: total.vasAmount + row.vasAmount,
    waCount: total.waCount + row.waCount,
    waAmount: total.waAmount + row.waAmount,
    wbCount: total.wbCount + row.wbCount,
    wbAmount: total.wbAmount + row.wbAmount,
  }), {
    vasAmount: 0,
    waCount: 0,
    waAmount: 0,
    wbCount: 0,
    wbAmount: 0,
  })
}

function buildTotalRow(rows: ReturnType<typeof buildRows>, addonTotals = summarizeAddons([]), auxiliaryCounts = { ewCount: 0, rsaCount: 0, mcpCount: 0 }) {
  const totalJc = rows.reduce((total, row) => total + row.totalJc, 0)
  const labourAmount = rows.reduce((total, row) => total + row.labourAmount, 0)
  const lessVas = addonTotals.vasAmount
  const labMinusVas = Math.max(labourAmount - lessVas, 0)
  const spareSale = rows.reduce((total, row) => total + row.spareSale, 0)
  const discount = rows.reduce((total, row) => total + row.discount, 0)
  const waCount = addonTotals.waCount
  const waAmount = addonTotals.waAmount
  const wbCount = addonTotals.wbCount
  const wbAmount = addonTotals.wbAmount

  return {
    serviceType: 'Grand Total',
    totalJc,
    totalJcPercent: 100,
    labourAmount,
    labourPercent: 100,
    labourPerRo: perRo(labourAmount, totalJc),
    lessVas,
    vasPercent: percent(lessVas, labourAmount),
    labPerRoMinusVas: perRo(labMinusVas, totalJc),
    labMinusVas,
    spareSale,
    sparePerRo: perRo(spareSale, totalJc),
    discount,
    waCount,
    waAmount,
    waPerRoPercent: percent(waCount, totalJc),
    wbCount,
    wbAmount,
    wbPerRoPercent: percent(wbCount, totalJc),
    ewCount: auxiliaryCounts.ewCount,
    rsaCount: auxiliaryCounts.rsaCount,
    mcpCount: auxiliaryCounts.mcpCount,
  }
}

async function buildWorkshopPayload(startDate: string, endDate: string) {
  const parsedStart = parseDateInput(startDate)
  const parsedEnd = parseDateInput(endDate)
  const lyStart = parsedStart ? toDateInputValue(sameDateLastYear(parsedStart)) : startDate
  const lyEnd = parsedEnd ? toDateInputValue(sameDateLastYear(parsedEnd)) : endDate

  const [
    serviceRows,
    addonRows,
    dailyTrend,
    advisors,
    auxiliary,
    lyAuxiliary,
    lyServiceRows,
    lyAddonRows,
  ] = await Promise.all([
    fetchServiceSummary(startDate, endDate),
    fetchAddonSummary(startDate, endDate),
    fetchDailyTrend(startDate, endDate),
    fetchAdvisorSummary(startDate, endDate),
    fetchAuxiliaryKpis(startDate, endDate),
    fetchAuxiliaryKpis(lyStart, lyEnd),
    fetchServiceSummary(lyStart, lyEnd),
    fetchAddonSummary(lyStart, lyEnd),
  ])

  const addonTotals = summarizeAddons(addonRows)
  const lyAddonTotals = summarizeAddons(lyAddonRows)
  const rows = buildRows(serviceRows, addonRows)
  const totalRow = buildTotalRow(rows, addonTotals, {
    ewCount: auxiliary.ewCount,
    rsaCount: auxiliary.rsaCount,
    mcpCount: auxiliary.mcpCount,
  })
  const lyRows = buildRows(lyServiceRows, lyAddonRows)
  const lyTotal = buildTotalRow(lyRows, lyAddonTotals, {
    ewCount: lyAuxiliary.ewCount,
    rsaCount: lyAuxiliary.rsaCount,
    mcpCount: lyAuxiliary.mcpCount,
  })

  const totalRevenue = totalRow.labourAmount + totalRow.spareSale
  const lyRevenue = lyTotal.labourAmount + lyTotal.spareSale

  return {
    dateRange: { startDate, endDate, lyStartDate: lyStart, lyEndDate: lyEnd },
    kpis: {
      totalJc: { value: totalRow.totalJc, ly: lyTotal.totalJc, growth: growth(totalRow.totalJc, lyTotal.totalJc) },
      labourAmount: { value: totalRow.labourAmount, ly: lyTotal.labourAmount, growth: growth(totalRow.labourAmount, lyTotal.labourAmount) },
      spareSale: { value: totalRow.spareSale, ly: lyTotal.spareSale, growth: growth(totalRow.spareSale, lyTotal.spareSale) },
      totalRevenue: { value: totalRevenue, ly: lyRevenue, growth: growth(totalRevenue, lyRevenue) },
      vasAmount: { value: totalRow.lessVas, ly: lyTotal.lessVas, growth: growth(totalRow.lessVas, lyTotal.lessVas) },
      labourPerRo: { value: totalRow.labourPerRo, ly: lyTotal.labourPerRo, growth: growth(totalRow.labourPerRo, lyTotal.labourPerRo) },
      sparePerRo: { value: totalRow.sparePerRo, ly: lyTotal.sparePerRo, growth: growth(totalRow.sparePerRo, lyTotal.sparePerRo) },
      ewCount: { value: auxiliary.ewCount, ly: lyAuxiliary.ewCount, growth: growth(auxiliary.ewCount, lyAuxiliary.ewCount) },
      mcpCount: { value: auxiliary.mcpCount, ly: lyAuxiliary.mcpCount, growth: growth(auxiliary.mcpCount, lyAuxiliary.mcpCount) },
      rsaCount: { value: auxiliary.rsaCount, ly: lyAuxiliary.rsaCount, growth: growth(auxiliary.rsaCount, lyAuxiliary.rsaCount), amount: auxiliary.rsaAmount },
    },
    rows: [...rows, totalRow],
    dailyTrend,
    advisors,
    meta: {
      rowCount: rows.length,
      jcDefinition: 'COUNT(DISTINCT COALESCE(bill_no, ro_no, id))',
      cacheTtlSeconds: CACHE_TTL_SECONDS,
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('workshop-performance')
  const authResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
  if (authResponse) return authResponse

  const { searchParams } = new URL(request.url)
  const defaults = defaultRange()
  const startDate = parseDateInput(searchParams.get('startDate'))
    ? searchParams.get('startDate')!.slice(0, 10)
    : defaults.startDate
  const endDate = parseDateInput(searchParams.get('endDate'))
    ? searchParams.get('endDate')!.slice(0, 10)
    : defaults.endDate
  const skipCache = searchParams.get('skipCache') === 'true'

  try {
    const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
      ? buildWorkshopPayload(startDate, endDate)
      : getCachedData(
        cacheKey(startDate, endDate),
        () => buildWorkshopPayload(startDate, endDate),
        CACHE_TTL_SECONDS
      )
    )

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(data), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Workshop Performance:', error)
    return NextResponse.json({ error: 'Failed to build Workshop Performance' }, { status: 500 })
  }
}
