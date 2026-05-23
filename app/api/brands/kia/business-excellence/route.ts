import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getCachedData, invalidateCachePattern } from '@/lib/redis/cache-utils'
import { CACHE_KEYS } from '@/lib/redis/client'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const CACHE_TTL_SECONDS = 60 * 60
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
  { slug: 'open_ro_yearly', table: 'open_ro_yearly', sheetName: 'Open RO Yearly' },
  { slug: 'ro_billing_report', table: 'ro_billing_report', sheetName: 'RO Billing Report' },
  { slug: 'mcp_report', table: 'mcp_report', sheetName: 'MCP Report' },
  { slug: 'ew_report', table: 'ew_report', sheetName: 'EW Report' },
  { slug: 'rsa_report', table: 'rsa_report', sheetName: 'RSA Report' },
  { slug: 'psf_yearly', table: 'psf_yearly', sheetName: 'PSF Yearly' },
  { slug: 'adv_wise_lubricants_vas', table: 'adv_wise_lubricants_vas', sheetName: 'Adv. wise lubricants & VAS' },
  { slug: 'kia_call_center_complaints', table: 'kia_call_center_complaints', sheetName: 'Kia Call Center Complaints' },
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

function roBillingProjectedRowsSql(table: BusinessExcellenceTable, selectedLimit: number, selectedOffset: number, startDate?: string | null, endDate?: string | null, skipSort = false) {
  const dateFilter = startDate && endDate
    ? sql`WHERE bill_date BETWEEN ${startDate}::date AND ${endDate}::date`
    : sql``

  return sql`
    SELECT
      id,
      bill_no,
      ro_no,
      bill_date,
      labour_amt,
      part_amt,
      total_amt,
      work_type,
      service_type,
      technician,
      service_advisor,
      model,
      bill_type,
      bill_status,
      pick_drop,
      avg_rating,
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

async function getColumns(table: BusinessExcellenceTable) {
  const rows = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table.table}
    ORDER BY ordinal_position
  `)

  return rows.map((row) => String(row.column_name))
}

async function getTableMetadata(table: BusinessExcellenceTable) {
  const [columns, stats] = await Promise.all([
    getColumns(table),
    db.execute(sql`
      SELECT
        COUNT(*)::int AS "totalRows",
        MAX(uploaded_at) AS "uploadedAt"
      FROM ${tableSql(table)}
    `),
  ])

  return {
    id: table.slug,
    brand: 'kia',
    sheetName: table.sheetName,
    tableName: table.table,
    columns,
    uploadedAt: stats[0]?.uploadedAt || null,
    totalRows: Number(stats[0]?.totalRows || 0),
  }
}

async function fetchMetadata() {
  const tableNameParams = BUSINESS_EXCELLENCE_TABLES.map((table) => sql`${table.table}`)
  const existingTables = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${sql.join(tableNameParams, sql`, `)})
  `)
  const existingTableNames = new Set(existingTables.map((row) => String(row.table_name)))
  const tables = BUSINESS_EXCELLENCE_TABLES.filter((table) => existingTableNames.has(table.table))

  if (tables.length === 0) return []

  const existingTableParams = tables.map((table) => sql`${table.table}`)
  const [columnRows, statsRows] = await Promise.all([
    db.execute(sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${sql.join(existingTableParams, sql`, `)})
      ORDER BY table_name, ordinal_position
    `),
    db.execute(sql.join(
      tables.map((table) => sql`
        SELECT ${table.table} AS table_name, COUNT(*)::int AS "totalRows", MAX(uploaded_at) AS "uploadedAt"
        FROM ${tableSql(table)}
      `),
      sql` UNION ALL `
    )),
  ])

  const columnsByTable = new Map<string, string[]>()
  for (const row of columnRows) {
    const tableName = String(row.table_name)
    const columns = columnsByTable.get(tableName) || []
    columns.push(String(row.column_name))
    columnsByTable.set(tableName, columns)
  }

  const statsByTable = new Map<string, { totalRows: number; uploadedAt: unknown }>()
  for (const row of statsRows) {
    statsByTable.set(String(row.table_name), {
      totalRows: Number(row.totalRows || 0),
      uploadedAt: row.uploadedAt || null,
    })
  }

  return tables.map((table) => {
    const stats = statsByTable.get(table.table)
    return {
      id: table.slug,
      brand: 'kia',
      sheetName: table.sheetName,
      tableName: table.table,
      columns: columnsByTable.get(table.table) || [],
      uploadedAt: stats?.uploadedAt || null,
      totalRows: stats?.totalRows || 0,
    }
  })
}

async function fetchTableRows({
  table,
  page,
  limit,
  fetchAll,
  startDate,
  endDate,
}: {
  table: BusinessExcellenceTable
  page: number
  limit: number
  fetchAll: boolean
  startDate?: string | null
  endDate?: string | null
}) {
  const offset = (page - 1) * limit
  const selectedLimit = fetchAll ? 50000 : limit
  const selectedOffset = fetchAll ? 0 : offset
  const useBillDateWindow = table.slug === 'ro_billing_report' && startDate && endDate

  if (table.slug === 'ro_billing_report' && fetchAll) {
    const rowsResult = await db.execute(roBillingProjectedRowsSql(table, selectedLimit, selectedOffset, startDate, endDate, true))

    return {
      id: table.slug,
      brand: 'kia',
      sheetName: table.sheetName,
      tableName: table.table,
      columns: RO_BILLING_PROJECTED_COLUMNS,
      uploadedAt: null,
      totalRows: rowsResult.length,
      page,
      limit: selectedLimit,
      rows: rowsResult,
    }
  }

  const [metadata, rowsResult] = await Promise.all([
    getTableMetadata(table),
    table.slug === 'ro_billing_report'
      ? db.execute(roBillingProjectedRowsSql(table, selectedLimit, selectedOffset, startDate, endDate))
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
    rows: table.slug === 'ro_billing_report' ? rowsResult : rowsResult.map((row) => row.row),
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-business-excellence')
  try {
    const accessError = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessError) return accessError

    const { searchParams } = new URL(request.url)
    const brand = searchParams.get('brand') || 'kia'
    const sheet = searchParams.get('sheet')
    const sheetId = searchParams.get('sheetId')
    const skipCache = searchParams.get('skipCache') === 'true'

    if (brand !== 'kia') {
      return NextResponse.json({ error: 'Only KIA Business Excellence tables are configured' }, { status: 400 })
    }

    if (sheet || sheetId) {
      const table = resolveTable(sheet, sheetId)
      if (!table) return NextResponse.json({ error: 'Unknown Business Excellence table' }, { status: 404 })

      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10) || 10))
      const fetchAll = searchParams.get('fetchAll') === 'true'
      const startDate = searchParams.get('startDate')
      const endDate = searchParams.get('endDate')
      const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:${table.slug}:v5:${fetchAll ? 'all' : `page:${page}:limit:${limit}`}:start:${startDate || 'none'}:end:${endDate || 'none'}`
      const data = await timer.time(skipCache ? 'db' : 'cache-db', () => skipCache
        ? fetchTableRows({ table, page, limit, fetchAll, startDate, endDate })
        : getCachedData(cacheKey, () => fetchTableRows({ table, page, limit, fetchAll, startDate, endDate }), CACHE_TTL_SECONDS))

      const { serverTiming } = timer.finish()
      return withServerTiming(NextResponse.json(data), serverTiming)
    }

    const cacheKey = `${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:metadata:kia`
    const data = await timer.time(skipCache ? 'metadata-db' : 'metadata-cache-db', () => skipCache
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
  const accessError = await requireBrandApiAccess('kia')
  if (accessError) return accessError

  await invalidateCachePattern(`${CACHE_KEYS.BUSINESS_EXCELLENCE}:relational:*`)
  await invalidateCachePattern('ro_billing:*')
  return NextResponse.json(
    {
      error: 'Business Excellence now uses relational SQL tables populated by the cron/import pipeline. Spreadsheet JSON uploads are disabled for this section.',
    },
    { status: 405 }
  )
}
