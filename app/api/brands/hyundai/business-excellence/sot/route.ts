import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { requireBrandSectionApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withApiDiagnostics } from '@/lib/api/timing'
import {
  hyundaiSourceDealerFilter,
  normalizeHyundaiDealerCode,
} from '@/lib/hyundai/dealer-branch'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type SotFilters = {
  startDate: string
  endDate: string
  comparisonStartDate: string | null
  comparisonEndDate: string | null
  model: string | null
  scheme: string | null
  department: string | null
  dealerCode: string | null
  page: number
  pageSize: number
}

type SotChunk = 'summary' | 'details' | 'full'
type DataRow = Record<string, unknown>

function toInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isInputDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function defaultDateRange() {
  const today = new Date()
  return {
    startDate: toInputDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: toInputDate(today),
  }
}

function shiftInputDateByYears(value: string, years: number) {
  const [year, month, day] = value.split('-').map(Number)
  const shifted = new Date(year + years, month - 1, day)
  if (shifted.getMonth() !== month - 1) {
    return toInputDate(new Date(year + years, month, 0))
  }
  return toInputDate(shifted)
}

function stringFilter(value: string | null) {
  const trimmed = String(value || '').trim()
  return trimmed && trimmed !== '__all__' ? trimmed : null
}

function readFilters(searchParams: URLSearchParams): SotFilters {
  const defaults = defaultDateRange()
  const startDate = searchParams.get('startDate')?.slice(0, 10) || defaults.startDate
  const endDate = searchParams.get('endDate')?.slice(0, 10) || defaults.endDate
  const resolvedStartDate = isInputDate(startDate) ? startDate : defaults.startDate
  const resolvedEndDate = isInputDate(endDate) ? endDate : defaults.endDate
  const rawComparisonStartDate = searchParams.get('comparisonStartDate')?.slice(0, 10) || searchParams.get('compareStartDate')?.slice(0, 10) || null
  const rawComparisonEndDate = searchParams.get('comparisonEndDate')?.slice(0, 10) || searchParams.get('compareEndDate')?.slice(0, 10) || null

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    comparisonStartDate: isInputDate(rawComparisonStartDate)
      ? rawComparisonStartDate
      : shiftInputDateByYears(resolvedStartDate, -1),
    comparisonEndDate: isInputDate(rawComparisonEndDate)
      ? rawComparisonEndDate
      : shiftInputDateByYears(resolvedEndDate, -1),
    model: stringFilter(searchParams.get('model')),
    scheme: stringFilter(searchParams.get('scheme')),
    department: stringFilter(searchParams.get('department')),
    dealerCode: normalizeHyundaiDealerCode(searchParams.get('dealer_code')),
    page: Math.max(1, Number(searchParams.get('page')) || 1),
    pageSize: Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 100)),
  }
}

function cacheKey(filters: SotFilters, chunk: SotChunk) {
  return `hyundai:business-excellence:sot:v1:${chunk}:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
}

function resultRows(result: unknown) {
  return Array.isArray(result) ? result as DataRow[] : []
}

function numberValue(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function stringValue(value: unknown, fallback = '-') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function dateValue(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : toInputDate(date)
}

function timestampValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return String(value) || null
}

function growth(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function comparisonStatus(previous: number) {
  return previous === 0 ? 'exact_zero' : 'available'
}

function comparisonMetric(current: number, previous: number) {
  return {
    cy: current,
    ly: previous,
    deltaPct: growth(current, previous),
    comparisonStatus: comparisonStatus(previous),
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit = 3) {
  const results = new Array<T>(tasks.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await tasks[index]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

function sotDealerFilterSql(filters: SotFilters) {
  return hyundaiSourceDealerFilter(filters.dealerCode, sql.raw('source_dealer_code'), [sql.raw('dealer_code')])
}

function filterSql(filters: SotFilters, startDate: string, endDate: string) {
  return sql`
    WHERE reg_date >= ${startDate}::date
      AND reg_date < (${endDate}::date + INTERVAL '1 day')
      ${sotDealerFilterSql(filters)}
      ${filters.model ? sql`AND model = ${filters.model}` : sql``}
      ${filters.scheme ? sql`AND scheme_no = ${filters.scheme}` : sql``}
      ${filters.department ? sql`AND department = ${filters.department}` : sql``}
  `
}

function sotBaseCte(filters: SotFilters, startDate: string, endDate: string) {
  return sql`
    WITH raw AS (
      SELECT
        id,
        row_hash,
        trust_package_section,
        source_dealer_code,
        COALESCE(NULLIF(cert_no, ''), NULLIF(vin, ''), id::text) AS cert_key,
        cert_no,
        reg_date::date AS reg_date,
        vin,
        model,
        scheme_no,
        scheme_desc,
        department,
        customer_name,
        cust_address,
        COALESCE(hmil_amt, 0)::numeric AS hmil_amt,
        uploaded_at
      FROM trust_package
      ${filterSql(filters, startDate, endDate)}
    ),
    base AS (
      SELECT DISTINCT ON (cert_key)
        *
      FROM raw
      ORDER BY cert_key, uploaded_at DESC NULLS LAST, id DESC
    )
  `
}

async function fetchKpis(filters: SotFilters, startDate: string, endDate: string) {
  const rows = await db.execute(sql`
    ${sotBaseCte(filters, startDate, endDate)}
    SELECT
      COUNT(*)::int AS certificates,
      COALESCE(SUM(hmil_amt), 0)::float AS total_value,
      COALESCE(AVG(hmil_amt), 0)::float AS avg_value,
      COUNT(DISTINCT NULLIF(model, ''))::int AS models,
      COUNT(DISTINCT NULLIF(scheme_no, ''))::int AS schemes,
      COUNT(DISTINCT NULLIF(department, ''))::int AS departments,
      MIN(reg_date)::text AS min_date,
      MAX(reg_date)::text AS max_date
    FROM base
  `) as Array<Record<string, unknown>>

  const row = rows[0] || {}
  return {
    certificates: numberValue(row.certificates),
    totalValue: numberValue(row.total_value),
    avgValue: numberValue(row.avg_value),
    models: numberValue(row.models),
    schemes: numberValue(row.schemes),
    departments: numberValue(row.departments),
    minDate: dateValue(row.min_date),
    maxDate: dateValue(row.max_date),
  }
}

async function fetchMetadata(filters: SotFilters) {
  const rows = await db.execute(sql`
    ${sotBaseCte(filters, filters.startDate, filters.endDate)}
    SELECT
      COUNT(*)::int AS total_rows,
      MIN(reg_date)::text AS min_date,
      MAX(reg_date)::text AS max_date,
      MAX(uploaded_at) AS uploaded_at
    FROM base
  `) as Array<Record<string, unknown>>

  const row = rows[0] || {}
  return {
    totalRows: numberValue(row.total_rows),
    minDate: dateValue(row.min_date),
    maxDate: dateValue(row.max_date),
    uploadedAt: timestampValue(row.uploaded_at),
    dealerScoped: Boolean(filters.dealerCode),
    sourceWarnings: [] as string[],
  }
}

async function fetchDailyTrend(filters: SotFilters) {
  const rows = await db.execute(sql`
    ${sotBaseCte(filters, filters.startDate, filters.endDate)}
    SELECT
      reg_date::text AS date,
      COUNT(*)::int AS certificates,
      COALESCE(SUM(hmil_amt), 0)::float AS value
    FROM base
    GROUP BY reg_date
    ORDER BY reg_date ASC
  `) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    date: dateValue(row.date),
    certificates: numberValue(row.certificates),
    value: numberValue(row.value),
  }))
}

async function fetchBreakdown(filters: SotFilters, column: 'model' | 'scheme_no' | 'department') {
  const labelSql = column === 'scheme_no'
    ? sql`COALESCE(NULLIF(scheme_no, ''), 'Unspecified')`
    : column === 'department'
      ? sql`COALESCE(NULLIF(department, ''), 'Unspecified')`
      : sql`COALESCE(NULLIF(model, ''), 'Unspecified')`

  const rows = await db.execute(sql`
    ${sotBaseCte(filters, filters.startDate, filters.endDate)}
    SELECT
      ${labelSql} AS name,
      COUNT(*)::int AS certificates,
      COALESCE(SUM(hmil_amt), 0)::float AS value,
      COALESCE(AVG(hmil_amt), 0)::float AS avg_value
    FROM base
    GROUP BY ${labelSql}
    ORDER BY value DESC, certificates DESC, name ASC
    LIMIT 20
  `) as Array<Record<string, unknown>>

  const total = rows.reduce((sum, row) => sum + numberValue(row.certificates), 0)
  return rows.map((row) => ({
    name: stringValue(row.name, 'Unspecified'),
    certificates: numberValue(row.certificates),
    value: numberValue(row.value),
    avgValue: numberValue(row.avg_value),
    share: total > 0 ? (numberValue(row.certificates) / total) * 100 : 0,
  }))
}

async function fetchRows(filters: SotFilters) {
  const rows = await db.execute(sql`
    ${sotBaseCte(filters, filters.startDate, filters.endDate)}
    SELECT
      id,
      trust_package_section,
      source_dealer_code,
      cert_no,
      reg_date::text AS reg_date,
      vin,
      model,
      scheme_no,
      scheme_desc,
      department,
      customer_name,
      cust_address,
      hmil_amt::float AS hmil_amt,
      uploaded_at
    FROM base
    ORDER BY reg_date DESC NULLS LAST, uploaded_at DESC NULLS LAST, id DESC
    LIMIT ${filters.pageSize}
    OFFSET ${(filters.page - 1) * filters.pageSize}
  `) as Array<Record<string, unknown>>

  return rows.map((row) => ({
    id: numberValue(row.id),
    section: stringValue(row.trust_package_section),
    sourceDealerCode: stringValue(row.source_dealer_code),
    certNo: stringValue(row.cert_no),
    regDate: dateValue(row.reg_date),
    vin: stringValue(row.vin),
    model: stringValue(row.model),
    schemeNo: stringValue(row.scheme_no),
    schemeDesc: stringValue(row.scheme_desc),
    department: stringValue(row.department),
    customerName: stringValue(row.customer_name),
    customerAddress: stringValue(row.cust_address),
    hmilAmount: numberValue(row.hmil_amt),
    uploadedAt: timestampValue(row.uploaded_at),
  }))
}

async function fetchOptions(filters: SotFilters) {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(jsonb_agg(DISTINCT model ORDER BY model) FILTER (WHERE NULLIF(model, '') IS NOT NULL), '[]'::jsonb) AS models,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('schemeNo', scheme_no, 'schemeDesc', scheme_desc)) FILTER (WHERE NULLIF(scheme_no, '') IS NOT NULL), '[]'::jsonb) AS schemes,
      COALESCE(jsonb_agg(DISTINCT department ORDER BY department) FILTER (WHERE NULLIF(department, '') IS NOT NULL), '[]'::jsonb) AS departments
    FROM trust_package
    WHERE reg_date >= ${filters.startDate}::date
      AND reg_date < (${filters.endDate}::date + INTERVAL '1 day')
      ${sotDealerFilterSql(filters)}
  `) as Array<Record<string, unknown>>

  const row = rows[0] || {}
  return {
    models: Array.isArray(row.models) ? row.models.map((value) => String(value)) : [],
    schemes: Array.isArray(row.schemes)
      ? row.schemes.map((item) => item as { schemeNo: string; schemeDesc: string })
      : [],
    departments: Array.isArray(row.departments) ? row.departments.map((value) => String(value)) : [],
  }
}

async function fetchHyundaiSotCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const cacheId = `hyundai:coverage:sot:${startDate}:${endDate}:${dealerCode || 'all'}`
  return getCachedData(
    cacheId,
    async () => {
      const rows = await db.execute(sql`
        SELECT
          COUNT(*) FILTER (
            WHERE reg_date >= ${startDate}::date
              AND reg_date < (${endDate}::date + INTERVAL '1 day')
          )::int AS row_count,
          MIN(reg_date)::text AS earliest_date,
          MAX(reg_date)::text AS latest_date,
          COUNT(*) FILTER (
            WHERE NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, dealer_code, ''))), '') IS NULL
          )::int AS unmapped_rows,
          MAX(uploaded_at)::text AS last_updated_at
        FROM trust_package
        WHERE TRUE
          ${hyundaiSourceDealerFilter(dealerCode, sql.raw('source_dealer_code'), [sql.raw('dealer_code')])}
      `) as Array<Record<string, unknown>>

      const row = rows[0] || {}
      const rowCountInRange = numberValue(row.row_count)
      const latestAvailableDate = dateValue(row.latest_date)
      return {
        dealerCode: dealerCode || 'all',
        isAllLocations: !dealerCode,
        hasDataInRange: rowCountInRange > 0,
        rowCountInRange,
        earliestAvailableDate: dateValue(row.earliest_date),
        latestAvailableDate,
        dateBasis: 'reg_date',
        sourceLabel: 'SOT',
        emptyReason: rowCountInRange > 0
          ? null
          : latestAvailableDate
            ? `No Hyundai SOT data for the selected range. Latest SOT data is ${latestAvailableDate}.`
            : 'No Hyundai SOT data found for this source.',
        comparisonStatus: rowCountInRange > 0 ? 'available' : 'source_missing',
        unmappedRowCount: numberValue(row.unmapped_rows),
        lastUpdatedAt: timestampValue(row.last_updated_at),
      }
    },
    CACHE_TTL_SECONDS
  )
}

async function buildPayload(filters: SotFilters, chunk: SotChunk) {
  const includeSummary = chunk !== 'details'
  const includeDetails = chunk !== 'summary'
  const comparisonEnabled = Boolean(filters.comparisonStartDate && filters.comparisonEndDate)
  const [
    kpis,
    comparisonKpis,
    metadata,
    dailyTrend,
    modelMix,
    schemeMix,
    departmentMix,
    rows,
    options,
    dealerCoverage,
  ] = await runWithConcurrency<unknown>([
    () => includeSummary ? fetchKpis(filters, filters.startDate, filters.endDate) : Promise.resolve({
      certificates: 0, totalValue: 0, avgValue: 0, models: 0, schemes: 0, departments: 0, minDate: null, maxDate: null,
    }),
    () => includeSummary && comparisonEnabled
      ? fetchKpis(filters, filters.comparisonStartDate!, filters.comparisonEndDate!)
      : Promise.resolve(null),
    () => includeSummary ? fetchMetadata(filters) : Promise.resolve({ totalRows: 0, minDate: null, maxDate: null, uploadedAt: null, dealerScoped: Boolean(filters.dealerCode), sourceWarnings: [] }),
    () => includeSummary ? fetchDailyTrend(filters) : Promise.resolve([]),
    () => includeSummary ? fetchBreakdown(filters, 'model') : Promise.resolve([]),
    () => includeSummary ? fetchBreakdown(filters, 'scheme_no') : Promise.resolve([]),
    () => includeSummary ? fetchBreakdown(filters, 'department') : Promise.resolve([]),
    () => includeDetails ? fetchRows(filters) : Promise.resolve([]),
    () => includeSummary ? fetchOptions(filters) : Promise.resolve({ models: [], schemes: [], departments: [] }),
    () => includeSummary
      ? fetchHyundaiSotCoverage(filters.startDate, filters.endDate, filters.dealerCode)
      : Promise.resolve({
        dealerCode: filters.dealerCode,
        isAllLocations: !filters.dealerCode,
        hasDataInRange: false,
        rowCountInRange: 0,
        latestAvailableDate: null,
        dateBasis: 'reg_date',
        sourceLabel: 'SOT',
        emptyReason: null,
      }),
  ], 3) as [
    Awaited<ReturnType<typeof fetchKpis>>,
    Awaited<ReturnType<typeof fetchKpis>> | null,
    Awaited<ReturnType<typeof fetchMetadata>>,
    Awaited<ReturnType<typeof fetchDailyTrend>>,
    Awaited<ReturnType<typeof fetchBreakdown>>,
    Awaited<ReturnType<typeof fetchBreakdown>>,
    Awaited<ReturnType<typeof fetchBreakdown>>,
    Awaited<ReturnType<typeof fetchRows>>,
    Awaited<ReturnType<typeof fetchOptions>>,
    Awaited<ReturnType<typeof fetchHyundaiSotCoverage>> | {
      dealerCode: string | null
      isAllLocations: boolean
      hasDataInRange: boolean
      rowCountInRange: number
      latestAvailableDate: null
      dateBasis: string
      sourceLabel: string
      emptyReason: null
    },
  ]

  return {
    asOfDate: filters.endDate,
    dateRange: {
      startDate: filters.startDate,
      endDate: filters.endDate,
      comparisonStartDate: filters.comparisonStartDate,
      comparisonEndDate: filters.comparisonEndDate,
    },
    filters: {
      selected: {
        model: filters.model,
        scheme: filters.scheme,
        department: filters.department,
        dealerCode: filters.dealerCode,
      },
      options,
    },
    kpis,
    comparison: {
      enabled: comparisonEnabled,
      kpis: comparisonKpis,
      metrics: comparisonKpis ? {
        certificates: comparisonMetric(kpis.certificates, comparisonKpis.certificates),
        totalValue: comparisonMetric(kpis.totalValue, comparisonKpis.totalValue),
        avgValue: comparisonMetric(kpis.avgValue, comparisonKpis.avgValue),
      } : null,
      growth: comparisonKpis ? {
        certificates: growth(kpis.certificates, comparisonKpis.certificates),
        totalValue: growth(kpis.totalValue, comparisonKpis.totalValue),
        avgValue: growth(kpis.avgValue, comparisonKpis.avgValue),
      } : null,
    },
    charts: {
      dailyTrend,
      modelMix,
      schemeMix,
      departmentMix,
    },
    rows,
    metadata: {
      ...metadata,
      page: filters.page,
      pageSize: filters.pageSize,
      totalPages: Math.max(1, Math.ceil(metadata.totalRows / filters.pageSize)),
      chunk,
      sourceWarnings: metadata.sourceWarnings,
      dealerCoverage: {
        dealerCode: dealerCoverage.dealerCode,
        isAllLocations: dealerCoverage.isAllLocations,
        primary: dealerCoverage,
        sot: dealerCoverage,
      },
    },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-business-excellence-sot')
  try {
    const accessError = await timer.time('auth', () => requireBrandSectionApiAccess('hyundai', 'hyundai.business_excellence.view', request))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const filters = readFilters(searchParams)
    const requestedChunk = searchParams.get('chunk')
    const chunk: SotChunk = requestedChunk === 'details' || requestedChunk === 'full' ? requestedChunk : 'summary'
    const payload = await timer.time('response-cache', () => getCachedData(
      cacheKey(filters, chunk),
      () => buildPayload(filters, chunk),
      CACHE_TTL_SECONDS
    ))

    const timing = timer.finish()
    const responseData = { ...payload, lastUpdatedAt: new Date().toISOString() }
    return withApiDiagnostics(NextResponse.json(responseData), timing.serverTiming, responseData)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Hyundai SOT analysis:', error)
    return NextResponse.json({ error: 'Failed to build SOT analysis' }, { status: 500 })
  }
}
