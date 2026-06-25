import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { analyticsTableColumns } from '@/lib/analytics/table-columns'
import { getCachedData, invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_KEYS, CACHE_TTL } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { normalizePlatinumDealerCode } from '@/lib/platinum/dealer-branch'
import { fetchPlatinumRoBillingCoverage } from '@/lib/platinum/business-excellence-coverage'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD
const RO_BILLING_PROJECTED_COLUMNS = [
  'id',
  'bill_no',
  'ro_no',
  'bill_date',
  'labour_amt',
  'part_amt',
  'total_amt',
  'work_type',
  'service_type',
  'technician',
  'service_advisor',
  'model',
  'bill_type',
  'bill_status',
  'pick_drop',
  'avg_rating',
  'vehicle_reg_no',
  'dealer_code',
  'main_dealer_code',
  'dis_amt',
  'total_disc',
  'labour_disc',
  'part_disc',
  'vin',
  'uploaded_at',
]

const BUSINESS_EXCELLENCE_TABLES = [
  { slug: 'am_platinum_ro_billing_report', table: 'am_platinum_ro_billing_report', sheetName: 'RO Billing Report' },
] as const

type BusinessExcellenceTable = typeof BUSINESS_EXCELLENCE_TABLES[number]

function normalizeSheetSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function resolveTable(sheet?: string | null, sheetId?: string | null): BusinessExcellenceTable | null {
  const key = normalizeSheetSlug(sheet || sheetId || '')
  if (!key) return null

  return BUSINESS_EXCELLENCE_TABLES.find((entry) => {
    return entry.slug === key
      || normalizeSheetSlug(entry.sheetName) === key
      || entry.table === key
  }) || null
}

function tableSql(table: BusinessExcellenceTable) {
  return sql.raw(`"${table.table}"`)
}

function roBillingWhereClause(startDate?: string | null, endDate?: string | null, dealerCode?: string | null) {
  const clauses = []
  if (startDate && endDate) {
    clauses.push(sql`bill_date BETWEEN ${startDate}::date AND ${endDate}::date`)
  }
  if (dealerCode) {
    clauses.push(sql`COALESCE(
      NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
      NULLIF(UPPER(TRIM(COALESCE(dealer_code, ''))), ''),
      NULLIF(UPPER(TRIM(COALESCE(main_dealer_code, ''))), '')
    ) = ${dealerCode}`)
  }
  return clauses.length > 0 ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``
}

function roBillingProjectedRowsSql(table: BusinessExcellenceTable, selectedLimit: number, selectedOffset: number, startDate?: string | null, endDate?: string | null, dealerCode?: string | null, skipSort = false) {
  const dateFilter = roBillingWhereClause(startDate, endDate, dealerCode)

  return sql`
    SELECT
      id,
      bill_no,
      r_o_no AS ro_no,
      bill_date,
      labour_amt,
      part_amt,
      total_amt,
      work_type,
      work_type AS service_type,
      techniciar AS technician,
      service_advisor,
      model,
      bill_type,
      bill_type AS bill_status,
      NULL::text AS pick_drop,
      NULL::numeric AS avg_rating,
      vehicle_reg_no,
      dealer_code,
      main_dealer_code,
      dis_amt,
      total_disc,
      labour_disc,
      part_disc,
      vin,
      uploaded_at
    FROM ${tableSql(table)}
    ${dateFilter}
    ${skipSort ? sql`` : sql`ORDER BY bill_date, id`}
    LIMIT ${selectedLimit}
    OFFSET ${selectedOffset}
  `
}

function roBillingStatsSql(table: BusinessExcellenceTable, startDate?: string | null, endDate?: string | null, dealerCode?: string | null) {
  const dateFilter = roBillingWhereClause(startDate, endDate, dealerCode)

  return sql`
    SELECT COUNT(*)::int AS "totalRows", MAX(uploaded_at) AS "uploadedAt"
    FROM ${tableSql(table)}
    ${dateFilter}
  `
}

async function getRoBillingStats(table: BusinessExcellenceTable, startDate?: string | null, endDate?: string | null, dealerCode?: string | null) {
  return getCachedData(
    `${CACHE_KEYS.BUSINESS_EXCELLENCE}:ro-billing-stats:v1:${table.slug}:start:${startDate || 'none'}:end:${endDate || 'none'}:dealer:${dealerCode || 'all'}`,
    async () => {
      const statsRows = await db.execute(roBillingStatsSql(table, startDate, endDate, dealerCode))
      const stats = statsRows[0]
      return {
        uploadedAt: stats?.uploadedAt || null,
        totalRows: Number(stats?.totalRows || 0),
      }
    },
    CACHE_TTL_SECONDS
  )
}

async function getColumns(table: BusinessExcellenceTable) {
  return await analyticsTableColumns(table.table)
}

async function getTableMetadata(table: BusinessExcellenceTable) {
  return getCachedData(
    `${CACHE_KEYS.BUSINESS_EXCELLENCE}:table-metadata:v1:${table.slug}`,
    async () => {
      const [columns, stats] = await Promise.all([
        getColumns(table),
        getRoBillingStats(table),
      ])

      return {
        id: table.slug,
        brand: 'platinum',
        sheetName: table.sheetName,
        tableName: table.table,
        columns,
        uploadedAt: stats.uploadedAt,
        totalRows: stats.totalRows,
      }
    },
    CACHE_TTL_SECONDS
  )
}

async function fetchMetadata() {
  const table = BUSINESS_EXCELLENCE_TABLES[0]
  const stats = await getRoBillingStats(table)
  return [{
    id: table.slug,
    brand: 'platinum',
    sheetName: table.sheetName,
    tableName: table.table,
    columns: RO_BILLING_PROJECTED_COLUMNS,
    uploadedAt: stats.uploadedAt,
    totalRows: stats.totalRows,
  }]
}

async function fetchTableRows({
  table,
  page,
  limit,
  fetchAll,
  startDate,
  endDate,
  dealerCode,
}: {
  table: BusinessExcellenceTable
  page: number
  limit: number
  fetchAll: boolean
  startDate?: string | null
  endDate?: string | null
  dealerCode?: string | null
}) {
  const offset = (page - 1) * limit
  const selectedLimit = fetchAll ? 50000 : limit
  const selectedOffset = fetchAll ? 0 : offset
  const useBillDateWindow = table.slug === 'am_platinum_ro_billing_report' && startDate && endDate
  const dealerCoverage = useBillDateWindow
    ? await fetchPlatinumRoBillingCoverage(startDate, endDate, dealerCode || null)
    : null
  const meta = dealerCoverage
    ? {
        dealerCode: dealerCoverage.dealerCode,
        dealerCoverage: {
          dealerCode: dealerCoverage.dealerCode,
          isAllLocations: dealerCoverage.isAllLocations,
          primary: dealerCoverage,
          roBilling: dealerCoverage,
        },
      }
    : undefined

  if (table.slug === 'am_platinum_ro_billing_report' && fetchAll) {
    const rowsResult = await db.execute(roBillingProjectedRowsSql(table, selectedLimit, selectedOffset, startDate, endDate, dealerCode, true))

    return {
      id: table.slug,
      brand: 'platinum',
      sheetName: table.sheetName,
      tableName: table.table,
      columns: RO_BILLING_PROJECTED_COLUMNS,
      uploadedAt: null,
      totalRows: rowsResult.length,
      page,
      limit: selectedLimit,
      rows: rowsResult,
      meta,
    }
  }

  if (table.slug === 'am_platinum_ro_billing_report') {
    const [stats, rowsResult] = await Promise.all([
      getRoBillingStats(table, startDate, endDate, dealerCode),
      db.execute(roBillingProjectedRowsSql(table, selectedLimit, selectedOffset, startDate, endDate, dealerCode)),
    ])

    return {
      id: table.slug,
      brand: 'platinum',
      sheetName: table.sheetName,
      tableName: table.table,
      columns: RO_BILLING_PROJECTED_COLUMNS,
      uploadedAt: stats.uploadedAt,
      totalRows: stats.totalRows,
      page,
      limit: selectedLimit,
      rows: rowsResult,
      meta,
    }
  }

  const [metadata, rowsResult] = await Promise.all([
    getTableMetadata(table),
    table.slug === 'am_platinum_ro_billing_report'
      ? db.execute(roBillingProjectedRowsSql(table, selectedLimit, selectedOffset, startDate, endDate, dealerCode))
      : useBillDateWindow
      ? db.execute(sql`
          SELECT to_jsonb(t) AS row
          FROM (
            SELECT *
            FROM ${tableSql(table)}
            WHERE bill_date BETWEEN ${startDate}::date AND ${endDate}::date
            ORDER BY bill_date, id
            LIMIT ${selectedLimit}
            OFFSET ${selectedOffset}
          ) t
        `)
      : db.execute(sql`
          SELECT to_jsonb(t) AS row
          FROM (
            SELECT *
            FROM ${tableSql(table)}
            ORDER BY id
            LIMIT ${selectedLimit}
            OFFSET ${selectedOffset}
          ) t
        `),
  ])

  return {
    ...metadata,
    page,
    limit: selectedLimit,
    rows: table.slug === 'am_platinum_ro_billing_report' ? rowsResult : rowsResult.map((row) => row.row),
    meta,
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('Platinum-business-excellence')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('platinum'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const brand = searchParams.get('brand') || 'platinum'
    const sheet = searchParams.get('sheet')
    const sheetId = searchParams.get('sheetId')
    const skipCache = searchParams.get('skipCache') === 'true'

    if (brand !== 'platinum') {
      return NextResponse.json({ error: 'Only Platinum Business Excellence tables are configured' }, { status: 400 })
    }

    if (sheet || sheetId) {
      const table = resolveTable(sheet, sheetId)
      if (!table) return NextResponse.json({ error: 'Unknown Business Excellence table' }, { status: 404 })

      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10))
      const fetchAll = searchParams.get('fetchAll') === 'true'
      const startDate = searchParams.get('startDate')
      const endDate = searchParams.get('endDate')
      const dealerCode = normalizePlatinumDealerCode(searchParams.get('dealer_code'))
      const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:${table.slug}:v8:${fetchAll ? 'all' : `page:${page}:limit:${limit}`}:start:${startDate || 'none'}:end:${endDate || 'none'}:dealer:${dealerCode || 'all'}`
      const data = await timer.time(skipCache ? 'db' : 'response-cache', () => skipCache
        ? fetchTableRows({ table, page, limit, fetchAll, startDate, endDate, dealerCode })
        : getCachedData(cacheKey, () => fetchTableRows({ table, page, limit, fetchAll, startDate, endDate, dealerCode }), CACHE_TTL_SECONDS))

      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json(data), serverTiming)
    }

    const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:metadata:Platinum:ro_billing_only:v1`
    const data = await timer.time(skipCache ? 'metadata-db' : 'response-cache', () => skipCache
      ? fetchMetadata()
      : getCachedData(cacheKey, fetchMetadata, CACHE_TTL_SECONDS))

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json(data), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error fetching relational business excellence data:', error)
    return NextResponse.json({ error: 'Failed to fetch Business Excellence data' }, { status: 500 })
  }
}

export async function POST() {
  const accessError = await requireBrandApiAccess('platinum')
  if (accessError) return accessError

  await Promise.all([
    invalidateCachePattern(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:*`),
    invalidateCachePattern('platinum:service-dashboard:*'),
  ])
  return NextResponse.json(
    {
      error: 'Business Excellence now uses relational SQL tables populated by the cron/import pipeline. Spreadsheet JSON uploads are disabled for this section.',
    },
    { status: 405 }
  )
}
