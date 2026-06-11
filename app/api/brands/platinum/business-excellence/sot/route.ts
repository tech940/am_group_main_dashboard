import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'
import { fetchPlatinumSotCoverage } from '@/lib/platinum/business-excellence-coverage'

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
}

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
  const comparisonStartDate = isInputDate(rawComparisonStartDate)
    ? rawComparisonStartDate
    : shiftInputDateByYears(resolvedStartDate, -1)
  const comparisonEndDate = isInputDate(rawComparisonEndDate)
    ? rawComparisonEndDate
    : shiftInputDateByYears(resolvedEndDate, -1)

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    comparisonStartDate,
    comparisonEndDate,
    model: stringFilter(searchParams.get('model')),
    scheme: stringFilter(searchParams.get('scheme')),
    department: stringFilter(searchParams.get('department')),
    dealerCode: normalizePlatinumDealerCode(searchParams.get('dealer_code')),
  }
}

function cacheKey(filters: SotFilters) {
  return `platinum:business-excellence:sot:v4:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
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

function sotDealerFilterSql(filters: SotFilters) {
  return filters.dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${filters.dealerCode}`
    : sql``
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
        no,
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
      FROM am_platinum_trust_package
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
    SELECT
      COUNT(*)::int AS total_rows,
      MIN(reg_date)::text AS min_date,
      MAX(reg_date)::text AS max_date,
      MAX(uploaded_at) AS uploaded_at
    FROM am_platinum_trust_package
    WHERE TRUE
      ${sotDealerFilterSql(filters)}
  `) as Array<Record<string, unknown>>

  const row = rows[0] || {}
  const sourceWarnings = filters.dealerCode
    ? ['SOT uses source_dealer_code for branch filtering; ACTIVE rows are excluded from dealer-specific views.']
    : []

  return {
    totalRows: numberValue(row.total_rows),
    minDate: dateValue(row.min_date),
    maxDate: dateValue(row.max_date),
    uploadedAt: row.uploaded_at ? new Date(String(row.uploaded_at)).toISOString() : null,
    dealerScoped: Boolean(filters.dealerCode),
    sourceWarnings,
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
    LIMIT 150
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
    uploadedAt: row.uploaded_at ? new Date(String(row.uploaded_at)).toISOString() : null,
  }))
}

async function fetchOptions(filters: SotFilters) {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(jsonb_agg(DISTINCT model ORDER BY model) FILTER (WHERE NULLIF(model, '') IS NOT NULL), '[]'::jsonb) AS models,
      COALESCE(jsonb_agg(DISTINCT jsonb_build_object('schemeNo', scheme_no, 'schemeDesc', scheme_desc)) FILTER (WHERE NULLIF(scheme_no, '') IS NOT NULL), '[]'::jsonb) AS schemes,
      COALESCE(jsonb_agg(DISTINCT department ORDER BY department) FILTER (WHERE NULLIF(department, '') IS NOT NULL), '[]'::jsonb) AS departments
    FROM am_platinum_trust_package
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

async function buildPayload(filters: SotFilters) {
  const comparisonEnabled = Boolean(filters.comparisonStartDate && filters.comparisonEndDate)
  const [kpis, comparisonKpis, metadata, dailyTrend, modelMix, schemeMix, departmentMix, rows, options, dealerCoverage] = await Promise.all([
    fetchKpis(filters, filters.startDate, filters.endDate),
    comparisonEnabled
      ? fetchKpis(filters, filters.comparisonStartDate!, filters.comparisonEndDate!)
      : Promise.resolve(null),
    fetchMetadata(filters),
    fetchDailyTrend(filters),
    fetchBreakdown(filters, 'model'),
    fetchBreakdown(filters, 'scheme_no'),
    fetchBreakdown(filters, 'department'),
    fetchRows(filters),
    fetchOptions(filters),
    fetchPlatinumSotCoverage(filters.startDate, filters.endDate, filters.dealerCode),
  ])

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
  const timer = createApiTimer('Platinum-business-excellence-sot')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const filters = readFilters(searchParams)
    const payload = await timer.time('response-cache', () => getCachedData(
      cacheKey(filters),
      () => buildPayload(filters),
      CACHE_TTL_SECONDS
    ))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Failed to build Platinum SOT analysis:', error)
    return NextResponse.json({ error: 'Failed to build SOT analysis' }, { status: 500 })
  }
}
