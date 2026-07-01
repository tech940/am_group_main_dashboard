import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { analyticsTableColumns } from '@/lib/analytics/table-columns'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import type {
  KiaStockCsvPayload,
  KiaStockDateMode,
  KiaStockFreshnessPayload,
  KiaStockMetricPoint,
  KiaStockMonthOption,
  KiaStockReportPayload,
  KiaStockSummaryPayload,
  KiaStockVehicleRow,
} from '@/lib/kia/stock-report-types'

type Row = Record<string, unknown>

const TABLE = 'kia_purchase_report'
const AVAILABLE_STATUS_SQL = sql`LOWER(TRIM(COALESCE(stock_status::text, ''))) IN ('free stock', 'in transit')`
const DEALER_SQL = sql`COALESCE(NULLIF(TRIM(dealer), ''), NULLIF(TRIM(main_dealer), ''), NULLIF(TRIM(order_dealer), ''), NULLIF(TRIM(billing_dealer_code), ''), 'Unknown')`
const DATE_SQL = sql`COALESCE(grn_date, departure_date, order_date, retail_date)`
const VALUE_SQL = sql`COALESCE(
  NULLIF(regexp_replace(total_invoice_value::text, '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(regexp_replace(kin_invoice_amount::text, '[^0-9.-]', '', 'g'), '')::numeric,
  basic_price,
  0
)`
const DEFAULT_VISIBLE_COLUMNS = [
  'dealer',
  'stock_status',
  'model',
  'variant',
  'color',
  'vin_no',
  'stock_age',
  'stock_location',
  'blocked',
  'grn_date',
  'departure_date',
  'order_date',
  'retail_date',
  'total_invoice_value',
]
const SEARCH_COLUMNS = ['vin_no', 'engine_no', 'model', 'variant', 'color', 'dealer', 'main_dealer', 'order_dealer', 'stock_status', 'stock_location', 'booking_no', 'cust_name']
const DATE_MODES: KiaStockDateMode[] = ['grn_date', 'departure_date', 'order_date', 'retail_date']

function rows(result: unknown) {
  return Array.isArray(result) ? result as Row[] : []
}

function safeText(value: unknown) {
  return String(value ?? '').trim()
}

function upperText(value: unknown) {
  return safeText(value).toUpperCase()
}

function numberValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function integerValue(value: unknown) {
  return Math.max(0, Math.round(numberValue(value)))
}

function isoDate(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(Date.UTC(year, month, 1)))
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function normalizeDateMode(value: string | null | undefined): KiaStockDateMode {
  return DATE_MODES.includes(value as KiaStockDateMode) ? value as KiaStockDateMode : 'grn_date'
}

function resolveDateContext(input: { year?: number | null; month?: number | null; startDate?: string | null; endDate?: string | null }, fallback?: { year: number; month: number }) {
  if (input.startDate && input.endDate) {
    const start = input.startDate
    const end = input.endDate
    const startDate = new Date(`${start}T00:00:00Z`)
    return {
      key: `${start}:${end}`,
      label: `${start} to ${end}`,
      year: startDate.getUTCFullYear(),
      month: startDate.getUTCMonth(),
      startDate: start,
      endDate: end,
      endDateExclusive: nextDate(end),
    }
  }
  const year = Number.isFinite(input.year) && input.year ? Math.floor(input.year) : fallback?.year ?? new Date().getFullYear()
  const month = Number.isFinite(input.month) && input.month !== null && input.month !== undefined ? Math.floor(input.month) : fallback?.month ?? new Date().getMonth()
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const endExclusiveDate = new Date(Date.UTC(year, month + 1, 1))
  const endDate = new Date(endExclusiveDate.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    key: monthKey(year, month),
    label: monthLabel(year, month),
    year,
    month,
    startDate: start,
    endDate,
    endDateExclusive: endExclusiveDate.toISOString().slice(0, 10),
  }
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function formatCurrency(value: number) {
  if (Math.abs(value) >= 10000000) return `Rs ${(value / 10000000).toFixed(2)}Cr`
  if (Math.abs(value) >= 100000) return `Rs ${(value / 100000).toFixed(2)}L`
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`
}

function statusLabel(value: unknown) {
  const text = safeText(value)
  if (text.toLowerCase() === 'free stock') return 'Free Stock'
  if (text.toLowerCase() === 'in transit') return 'In transit'
  return text || 'Unknown'
}

function normalizeVehicle(row: Row): KiaStockVehicleRow {
  return {
    rowKey: safeText(row.vin_no) || safeText(row.id) || `${safeText(row.model)}-${safeText(row.variant)}-${safeText(row.grn_date)}`,
    dealer: safeText(row.dealer_code) || safeText(row.dealer) || 'Unknown',
    stockStatus: statusLabel(row.stock_status),
    model: safeText(row.model) || 'Unknown',
    variant: safeText(row.variant) || 'Unknown',
    color: safeText(row.color) || safeText(row.exterior_color_name) || 'Unknown',
    vin: safeText(row.vin_no),
    stockAge: integerValue(row.age_days),
    stockValue: numberValue(row.stock_value),
    grnDate: isoDate(row.grn_date),
    departureDate: isoDate(row.departure_date),
    stockLocation: safeText(row.stock_location) || '-',
    blocked: safeText(row.blocked) || '-',
  }
}

function topPoints(items: Map<string, number>, limit = 12): KiaStockMetricPoint[] {
  return Array.from(items.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function addToMap(map: Map<string, number>, key: string, value = 1) {
  map.set(key || 'Unknown', (map.get(key || 'Unknown') || 0) + value)
}

function agingBucket(age: number) {
  if (age <= 15) return '0-15D'
  if (age <= 30) return '16-30D'
  if (age <= 60) return '31-60D'
  if (age <= 90) return '61-90D'
  return '90D+'
}

async function latestMonthFallback() {
  const result = rows(await analyticsDb.execute(sql`
    SELECT EXTRACT(YEAR FROM MAX(${DATE_SQL}))::int AS year, (EXTRACT(MONTH FROM MAX(${DATE_SQL}))::int - 1) AS month
    FROM ${sql.raw(TABLE)}
  `))[0] || {}
  const year = Number(result.year)
  const month = Number(result.month)
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : new Date().getMonth(),
  }
}

function dealerClause(dealerCode: string | null) {
  const normalized = normalizeKiaDealerCode(dealerCode) || null
  if (!normalized) return sql``
  return sql`AND UPPER(TRIM(${DEALER_SQL})) = ${normalized}`
}

function searchClause(search: string) {
  const trimmed = safeText(search)
  if (!trimmed) return sql``
  const pattern = `%${trimmed}%`
  return sql`AND (${sql.join(SEARCH_COLUMNS.map((column) => sql`${sql.raw(column)}::text ILIKE ${pattern}`), sql` OR `)})`
}

function selectedFiltersClause(input: { status?: string | null; model?: string | null }) {
  const parts = []
  if (safeText(input.status) && safeText(input.status) !== 'all') {
    parts.push(sql`AND LOWER(TRIM(COALESCE(stock_status::text, ''))) = ${safeText(input.status).toLowerCase()}`)
  }
  if (safeText(input.model) && safeText(input.model) !== 'all') {
    parts.push(sql`AND UPPER(TRIM(COALESCE(model::text, ''))) = ${upperText(input.model)}`)
  }
  return sql.join(parts, sql` `)
}

function dateClause(mode: KiaStockDateMode, startDate: string, endDateExclusive: string) {
  return sql`AND ${sql.raw(mode)} >= ${startDate}::date AND ${sql.raw(mode)} < ${endDateExclusive}::date`
}

async function readCurrentRows(dealerCode: string | null) {
  return rows(await analyticsDb.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(NULLIF(TRIM(vin_no), ''), id::text))
        *,
        ${DEALER_SQL} AS dealer_code,
        ${VALUE_SQL} AS stock_value,
        COALESCE(NULLIF(regexp_replace(stock_age::text, '[^0-9.-]', '', 'g'), '')::numeric, GREATEST((CURRENT_DATE - COALESCE(grn_date, departure_date, order_date, CURRENT_DATE))::int, 0)) AS age_days
      FROM ${sql.raw(TABLE)}
      WHERE COALESCE(NULLIF(TRIM(vin_no), ''), id::text) IS NOT NULL
        ${dealerClause(dealerCode)}
      ORDER BY COALESCE(NULLIF(TRIM(vin_no), ''), id::text), uploaded_at DESC NULLS LAST, id DESC
    )
    SELECT *
    FROM latest
    WHERE ${AVAILABLE_STATUS_SQL}
  `))
}

export async function getKiaStockReportFreshness(dealerCode?: string | null): Promise<KiaStockFreshnessPayload> {
  const normalizedDealerCode = normalizeKiaDealerCode(dealerCode) || null
  return getCachedData(`kia:stock-report:freshness:v1:${normalizedDealerCode || 'all'}`, async () => {
    const [summaryRow, monthRows, dealerRows, statusRows] = await Promise.all([
      analyticsDb.execute(sql`
        SELECT COUNT(*)::int AS row_count, MIN(${DATE_SQL}) AS min_date, MAX(${DATE_SQL}) AS max_date, MAX(uploaded_at) AS source_updated_at
        FROM ${sql.raw(TABLE)}
        WHERE TRUE ${dealerClause(normalizedDealerCode)}
      `),
      analyticsDb.execute(sql`
        SELECT DISTINCT EXTRACT(YEAR FROM ${DATE_SQL})::int AS year, (EXTRACT(MONTH FROM ${DATE_SQL})::int - 1) AS month
        FROM ${sql.raw(TABLE)}
        WHERE ${DATE_SQL} IS NOT NULL ${dealerClause(normalizedDealerCode)}
        ORDER BY year DESC, month DESC
      `),
      analyticsDb.execute(sql`
        SELECT DISTINCT UPPER(TRIM(${DEALER_SQL})) AS dealer
        FROM ${sql.raw(TABLE)}
        WHERE ${DEALER_SQL} IS NOT NULL
        ORDER BY dealer
      `),
      analyticsDb.execute(sql`
        SELECT DISTINCT COALESCE(NULLIF(TRIM(stock_status), ''), 'Unknown') AS status
        FROM ${sql.raw(TABLE)}
        ORDER BY status
      `),
    ])
    const summary = rows(summaryRow)[0] || {}
    const availableMonths = rows(monthRows)
      .filter((row) => Number.isFinite(Number(row.year)) && Number.isFinite(Number(row.month)))
      .map((row) => ({
        key: monthKey(Number(row.year), Number(row.month)),
        label: monthLabel(Number(row.year), Number(row.month)),
        year: Number(row.year),
        month: Number(row.month),
      } satisfies KiaStockMonthOption))
    const firstMonth = availableMonths[0]
    return {
      selectedMonthKey: firstMonth?.key || monthKey(new Date().getFullYear(), new Date().getMonth()),
      sourceUpdatedAt: summary.source_updated_at ? new Date(String(summary.source_updated_at)).toISOString() : null,
      minDate: isoDate(summary.min_date),
      maxDate: isoDate(summary.max_date),
      rowCount: Number(summary.row_count) || 0,
      availableMonths,
      dealerOptions: rows(dealerRows).map((row) => safeText(row.dealer)).filter(Boolean),
      statusOptions: rows(statusRows).map((row) => safeText(row.status)).filter(Boolean),
    }
  }, CACHE_TTL.MEDIUM)
}

export async function getKiaStockReportSummary(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  dateMode?: string | null
}): Promise<KiaStockSummaryPayload> {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const fallback = await latestMonthFallback()
  const context = resolveDateContext(input, fallback)
  const dateMode = normalizeDateMode(input.dateMode)
  const cacheKey = `kia:stock-report:summary:v1:${context.key}:${dealerCode || 'all'}:${dateMode}`
  return getCachedData(cacheKey, async () => {
    const currentRows = await readCurrentRows(dealerCode)
    const currentVehicles = currentRows.map(normalizeVehicle)
    const totalStock = currentVehicles.length
    const freeStock = currentVehicles.filter((row) => row.stockStatus === 'Free Stock').length
    const inTransit = currentVehicles.filter((row) => row.stockStatus === 'In transit').length
    const stockValue = currentVehicles.reduce((sum, row) => sum + row.stockValue, 0)
    const avgAge = totalStock ? Math.round(currentVehicles.reduce((sum, row) => sum + row.stockAge, 0) / totalStock) : 0
    const blocked = currentVehicles.filter((row) => row.blocked !== '-').length

    const dealerMap = new Map<string, number>()
    const modelMap = new Map<string, number>()
    const statusMap = new Map<string, number>()
    const agingMap = new Map<string, number>()
    const variantMap = new Map<string, number>()
    const colorMap = new Map<string, number>()
    const dealerRows = new Map<string, KiaStockSummaryPayload['dealers']['rows'][number]>()
    const modelRows = new Map<string, { units: number; stockValue: number; ageTotal: number; freeStock: number; inTransit: number; variants: Map<string, number>; colors: Map<string, number> }>()
    const agingModelRows = new Map<string, { units: number; ageTotal: number }>()

    for (const vehicle of currentVehicles) {
      addToMap(dealerMap, vehicle.dealer)
      addToMap(modelMap, vehicle.model)
      addToMap(statusMap, vehicle.stockStatus)
      addToMap(agingMap, agingBucket(vehicle.stockAge))
      addToMap(variantMap, vehicle.variant)
      addToMap(colorMap, vehicle.color)
      const dealer = dealerRows.get(vehicle.dealer) || { dealer: vehicle.dealer, total: 0, freeStock: 0, inTransit: 0, stockValue: 0, avgAge: 0, aging: [] }
      dealer.total += 1
      dealer.freeStock += vehicle.stockStatus === 'Free Stock' ? 1 : 0
      dealer.inTransit += vehicle.stockStatus === 'In transit' ? 1 : 0
      dealer.stockValue += vehicle.stockValue
      dealer.avgAge += vehicle.stockAge
      dealerRows.set(vehicle.dealer, dealer)

      const model = modelRows.get(vehicle.model) || { units: 0, stockValue: 0, ageTotal: 0, freeStock: 0, inTransit: 0, variants: new Map<string, number>(), colors: new Map<string, number>() }
      model.units += 1
      model.stockValue += vehicle.stockValue
      model.ageTotal += vehicle.stockAge
      model.freeStock += vehicle.stockStatus === 'Free Stock' ? 1 : 0
      model.inTransit += vehicle.stockStatus === 'In transit' ? 1 : 0
      addToMap(model.variants, vehicle.variant)
      addToMap(model.colors, vehicle.color)
      modelRows.set(vehicle.model, model)

      const agingModel = agingModelRows.get(vehicle.model) || { units: 0, ageTotal: 0 }
      agingModel.units += 1
      agingModel.ageTotal += vehicle.stockAge
      agingModelRows.set(vehicle.model, agingModel)
    }

    const [movementStatus, movementMonthly, movementDaily] = await Promise.all([
      analyticsDb.execute(sql`
        SELECT COALESCE(NULLIF(TRIM(stock_status), ''), 'Unknown') AS name, COUNT(*)::int AS value
        FROM ${sql.raw(TABLE)}
        WHERE TRUE ${dealerClause(dealerCode)} ${dateClause(dateMode, context.startDate, context.endDateExclusive)}
        GROUP BY 1 ORDER BY value DESC
      `),
      analyticsDb.execute(sql`
        SELECT to_char(date_trunc('month', ${sql.raw(dateMode)}), 'YYYY-MM') AS month,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(stock_status, ''))) IN ('free stock', 'in transit'))::int AS arrivals,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(stock_status, ''))) = 'retail')::int AS retail,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(stock_status, ''))) = 'to other dealer')::int AS transfers,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(stock_status, ''))) = 'test drive')::int AS test_drive
        FROM ${sql.raw(TABLE)}
        WHERE ${sql.raw(dateMode)} IS NOT NULL ${dealerClause(dealerCode)}
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
      `),
      analyticsDb.execute(sql`
        SELECT to_char(${sql.raw(dateMode)}, 'DD Mon') AS name, COUNT(*)::int AS value
        FROM ${sql.raw(TABLE)}
        WHERE TRUE ${dealerClause(dealerCode)} ${dateClause(dateMode, context.startDate, context.endDateExclusive)}
        GROUP BY ${sql.raw(dateMode)}
        ORDER BY ${sql.raw(dateMode)}
      `),
    ])

    const updatedRow = rows(await analyticsDb.execute(sql`SELECT MAX(uploaded_at) AS updated_at FROM ${sql.raw(TABLE)} WHERE TRUE ${dealerClause(dealerCode)}`))[0] || {}

    return {
      context: {
        selectedMonthKey: context.key,
        selectedMonthLabel: context.label,
        startDate: context.startDate,
        endDate: context.endDate,
        updatedAt: updatedRow.updated_at ? new Date(String(updatedRow.updated_at)).toISOString() : null,
        dealerCode,
        dateMode,
      },
      overview: {
        kpis: [
          { label: 'Available Stock', value: totalStock, formattedValue: totalStock.toLocaleString('en-IN'), helper: 'Free Stock + In transit only' },
          { label: 'Free Stock', value: freeStock, formattedValue: freeStock.toLocaleString('en-IN'), helper: 'Ready unsold units' },
          { label: 'In Transit', value: inTransit, formattedValue: inTransit.toLocaleString('en-IN'), helper: 'Unsold units on the way' },
          { label: 'Stock Value', value: stockValue, formattedValue: formatCurrency(stockValue), helper: 'Approx. invoice value' },
          { label: 'Avg Stock Age', value: avgAge, formattedValue: `${avgAge} days`, helper: 'Current available stock' },
          { label: 'Blocked Units', value: blocked, formattedValue: blocked.toLocaleString('en-IN'), helper: 'Available stock with blocked flag' },
        ],
        dealerSplit: topPoints(dealerMap),
        modelMix: topPoints(modelMap),
        statusMix: topPoints(statusMap),
        agingBuckets: ['0-15D', '16-30D', '31-60D', '61-90D', '90D+'].map((name) => ({ name, value: agingMap.get(name) || 0 })),
        highValue: [...currentVehicles].sort((a, b) => b.stockValue - a.stockValue).slice(0, 10),
        slowMoving: [...currentVehicles].sort((a, b) => b.stockAge - a.stockAge).slice(0, 10),
      },
      models: {
        cards: Array.from(modelRows.entries()).map(([model, value]) => ({
          model,
          units: value.units,
          stockValue: value.stockValue,
          avgAge: value.units ? Math.round(value.ageTotal / value.units) : 0,
          freeStock: value.freeStock,
          inTransit: value.inTransit,
          variants: topPoints(value.variants, 6),
          colors: topPoints(value.colors, 6),
        })).sort((a, b) => b.units - a.units),
        variantMix: topPoints(variantMap),
        colorMix: topPoints(colorMap),
      },
      dealers: {
        rows: Array.from(dealerRows.values()).map((row) => ({
          ...row,
          avgAge: row.total ? Math.round(row.avgAge / row.total) : 0,
          aging: ['0-15D', '16-30D', '31-60D', '61-90D', '90D+'].map((name) => ({
            name,
            value: currentVehicles.filter((vehicle) => vehicle.dealer === row.dealer && agingBucket(vehicle.stockAge) === name).length,
          })),
        })).sort((a, b) => b.total - a.total),
      },
      movement: {
        arrivals: rows(movementDaily).map((row) => ({ name: safeText(row.name), value: Number(row.value) || 0 })),
        statusCounts: rows(movementStatus).map((row) => ({ name: safeText(row.name), value: Number(row.value) || 0 })),
        monthly: rows(movementMonthly).map((row) => ({
          month: safeText(row.month),
          arrivals: Number(row.arrivals) || 0,
          retail: Number(row.retail) || 0,
          transfers: Number(row.transfers) || 0,
          testDrive: Number(row.test_drive) || 0,
        })),
      },
      aging: {
        buckets: ['0-15D', '16-30D', '31-60D', '61-90D', '90D+'].map((name) => ({ name, value: agingMap.get(name) || 0 })),
        byModel: Array.from(agingModelRows.entries()).map(([model, value]) => ({ model, units: value.units, avgAge: value.units ? Math.round(value.ageTotal / value.units) : 0 })).sort((a, b) => b.avgAge - a.avgAge),
        rows: [...currentVehicles].sort((a, b) => b.stockAge - a.stockAge).slice(0, 10),
      },
    }
  }, CACHE_TTL.SHORT)
}

function normalizePage(value: string | null | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function sortDirection(value: string | null | undefined) {
  return safeText(value).toLowerCase() === 'asc' ? 'asc' : 'desc'
}

function normalizeSortColumn(value: string | null | undefined, columns: string[], fallback: string) {
  const requested = safeText(value)
  return columns.includes(requested) ? requested : fallback
}

function normalizeRowForOutput(row: Row, columns: string[]) {
  const output: Row = {}
  for (const column of columns) {
    output[column] = column.includes('date') || column.endsWith('_at') ? isoDate(row[column]) || row[column] : row[column]
  }
  return output
}

async function readReportRows(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  dateMode?: string | null
  status?: string | null
  model?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
}) {
  const columns = await analyticsTableColumns(TABLE)
  const fallback = await latestMonthFallback()
  const context = resolveDateContext(input, fallback)
  const dateMode = normalizeDateMode(input.dateMode)
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const sortColumn = normalizeSortColumn(input.sort, columns, dateMode)
  const direction = sortDirection(input.direction)
  const filteredRows = rows(await analyticsDb.execute(sql`
    SELECT *
    FROM ${sql.raw(TABLE)}
    WHERE TRUE
      ${dealerClause(dealerCode)}
      ${dateClause(dateMode, context.startDate, context.endDateExclusive)}
      ${selectedFiltersClause(input)}
      ${searchClause(safeText(input.search))}
    ORDER BY ${sql.raw(sortColumn)} ${sql.raw(direction)}, id DESC
    LIMIT 20000
  `))
  return { columns, rows: filteredRows, context, sortColumn, direction }
}

export async function getKiaStockReportTable(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  dateMode?: string | null
  status?: string | null
  model?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
  page?: string | null
  pageSize?: string | null
  filters?: Record<string, string[]> | null
}): Promise<KiaStockReportPayload> {
  const page = normalizePage(input.page, 1)
  const pageSize = Math.min(100, normalizePage(input.pageSize, 10))
  const cacheKey = `kia:stock-report:table:v1:${JSON.stringify({ ...input, page, pageSize })}`
  return getCachedData(cacheKey, async () => {
    const { filters: _filters, ...readInput } = input
    const { columns, rows: fetchedRows } = await readReportRows(readInput)
    
    // Extract unique values from fetchedRows for each column before filters are applied
    const uniqueValues: Record<string, string[]> = {}
    for (const col of columns) {
      const valuesSet = new Set<string>()
      for (const row of fetchedRows) {
        const rawVal = row[col]
        const val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
        valuesSet.add(val)
      }
      uniqueValues[col] = Array.from(valuesSet).sort((a, b) => a.localeCompare(b))
    }

    // Apply column-level filters
    let filteredRows = fetchedRows
    if (input.filters && Object.keys(input.filters).length > 0) {
      filteredRows = fetchedRows.filter((row) => {
        return Object.entries(input.filters!).every(([col, selectedVals]) => {
          if (!selectedVals || selectedVals.length === 0) return true
          const rawVal = row[col]
          const val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
          return selectedVals.includes(val)
        })
      })
    }

    const offset = (page - 1) * pageSize
    return {
      columns,
      defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS.filter((column) => columns.includes(column)),
      rows: filteredRows.slice(offset, offset + pageSize).map((row) => normalizeRowForOutput(row, columns)),
      uniqueValues,
      pagination: {
        page,
        pageSize,
        totalRows: filteredRows.length,
        totalPages: Math.max(1, Math.ceil(filteredRows.length / pageSize)),
      },
    }
  }, CACHE_TTL.SHORT)
}

function escapeCsvCell(value: unknown) {
  const text = String(value ?? '')
  return text.includes('"') || text.includes(',') || text.includes('\n') ? `"${text.replace(/"/g, '""')}"` : text
}

export async function getKiaStockReportCsv(input: {
  year?: number | null
  month?: number | null
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
  dateMode?: string | null
  status?: string | null
  model?: string | null
  search?: string | null
  sort?: string | null
  direction?: string | null
  filters?: Record<string, string[]> | null
}): Promise<KiaStockCsvPayload> {
  const { filters: _csvFilters, ...readCsvInput } = input
  const { columns, rows: fetchedRows, context } = await readReportRows(readCsvInput)
  let filteredRows = fetchedRows
  if (input.filters && Object.keys(input.filters).length > 0) {
    filteredRows = fetchedRows.filter((row) => {
      return Object.entries(input.filters!).every(([col, selectedVals]) => {
        if (!selectedVals || selectedVals.length === 0) return true
        const rawVal = row[col]
        const val = rawVal === null || rawVal === undefined ? '' : String(rawVal).trim()
        return selectedVals.includes(val)
      })
    })
  }
  const outputRows = filteredRows.map((row) => normalizeRowForOutput(row, columns))
  return {
    fileName: `kia-stock-report-${context.key.replace(/:/g, '_')}.csv`,
    content: [
      columns.map(escapeCsvCell).join(','),
      ...outputRows.map((row) => columns.map((column) => escapeCsvCell(row[column])).join(',')),
    ].join('\n'),
  }
}
