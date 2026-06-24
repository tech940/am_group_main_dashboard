import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { analyticsDb as db } from '@/lib/analytics/db'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { requirePermission } from '@/lib/permissions/service'
import { normalizeHyundaiDealerCode } from '@/lib/hyundai/dealer-branch'
import {
  HYUNDAI_BE_CALCULATION_META,
  hyundaiActiveBillSql,
  hyundaiRoBillingDealerSql,
  hyundaiRoBillingInvoiceKeySql,
  hyundaiRoBillingRoKeySql,
} from '@/lib/hyundai/business-excellence-calculations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGE_SIZE = 10
const CACHE_TTL_SECONDS = CACHE_TTL.DASHBOARD

type BillingFilters = {
  page: number
  pageSize: number
  search: string
  branch: string
  dealerCode: string | null
  billType: string
  workType: string
  advisor: string
  startDate: string
  endDate: string
}

type ResultRow = Record<string, unknown>

function resultRows(result: unknown): ResultRow[] {
  return Array.isArray(result) ? result as ResultRow[] : []
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function normalizedFilter(value: string | null) {
  const normalized = String(value || 'all').trim()
  return normalized || 'all'
}

function normalizedBranch(value: string | null) {
  const normalized = String(value || 'all').trim().toLowerCase()
  if (normalized === 'udhampur') return 'billawar'
  return ['all', 'jammu', 'billawar'].includes(normalized) ? normalized : 'all'
}

function normalizedDate(value: string | null) {
  const normalized = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function getFilters(searchParams: URLSearchParams): BillingFilters {
  const branch = normalizedBranch(searchParams.get('branch'))
  return {
    page: positiveInteger(searchParams.get('page'), 1),
    pageSize: Math.min(50, positiveInteger(searchParams.get('pageSize'), PAGE_SIZE)),
    search: String(searchParams.get('search') || '').trim(),
    branch,
    dealerCode: normalizeHyundaiDealerCode(searchParams.get('dealer_code'))
      || (branch === 'jammu' ? 'JAMMU' : branch === 'billawar' ? 'BILLAWAR' : null),
    billType: normalizedFilter(searchParams.get('billType')),
    workType: normalizedFilter(searchParams.get('workType')),
    advisor: normalizedFilter(searchParams.get('advisor')),
    startDate: normalizedDate(searchParams.get('startDate')),
    endDate: normalizedDate(searchParams.get('endDate')),
  }
}

function createCacheKey(filters: BillingFilters) {
  return `hyundai:business-excellence:ro-billing-report:v4:${createHash('sha1').update(JSON.stringify(filters)).digest('hex')}`
}

async function tableExists(tableName: string) {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists`)
  return Boolean(resultRows(result)[0]?.exists)
}

function amountExpression(columnName: string) {
  return sql`
    COALESCE(
      NULLIF(regexp_replace(${sql.raw(columnName)}::text, '[^0-9.-]', '', 'g'), '')::numeric,
      0
    )
  `
}

function dateExpression(columnName: string) {
  return sql`
    CASE
      WHEN NULLIF(TRIM(${sql.raw(columnName)}::text), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN LEFT(TRIM(${sql.raw(columnName)}::text), 10)::date
      WHEN NULLIF(TRIM(${sql.raw(columnName)}::text), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}' THEN to_date(LEFT(TRIM(${sql.raw(columnName)}::text), 10), 'DD/MM/YYYY')
      ELSE NULL::date
    END
  `
}

function baseQuery(filters: BillingFilters) {
  return sql`
    WITH base_raw AS (
      SELECT
        id::text AS id,
        ${hyundaiRoBillingInvoiceKeySql()} AS invoice_key,
        ${hyundaiRoBillingRoKeySql()} AS ro_key,
        ${hyundaiRoBillingDealerSql()} AS canonical_dealer,
        COALESCE(NULLIF(TRIM(bill_no::text), ''), '-') AS bill_no,
        ${dateExpression('bill_date')} AS bill_date,
        COALESCE(NULLIF(TRIM(bill_type::text), ''), '-') AS bill_type,
        COALESCE(NULLIF(TRIM(customer_name::text), ''), '-') AS customer_name,
        COALESCE(NULLIF(TRIM(mobile_no::text), ''), '-') AS mobile_no,
        COALESCE(NULLIF(TRIM(vin::text), ''), '-') AS vin,
        COALESCE(NULLIF(TRIM(vehicle_reg_no::text), ''), '-') AS vehicle_reg_no,
        COALESCE(NULLIF(TRIM(model::text), ''), '-') AS model,
        COALESCE(NULLIF(TRIM(r_o_no::text), ''), '-') AS ro_no,
        ${dateExpression('r_o_date')} AS ro_date,
        COALESCE(NULLIF(TRIM(service_advisor::text), ''), '-') AS service_advisor,
        COALESCE(NULLIF(TRIM(techniciar::text), ''), '-') AS technician,
        COALESCE(NULLIF(TRIM(work_type::text), ''), '-') AS work_type,
        COALESCE(NULLIF(TRIM(dealer_code::text), ''), NULLIF(TRIM(main_dealer_code::text), ''), NULLIF(TRIM(source_dealer_code::text), ''), '-') AS dealer_code,
        COALESCE(NULLIF(TRIM(ins_comp_name::text), ''), '-') AS insurance_company,
        ${amountExpression('total_amt')} AS total_amount,
        ${amountExpression('labour_amt')} AS labour_amount,
        ${amountExpression('part_amt')} AS parts_amount,
        ${amountExpression('other_amt')} AS other_amount,
        ${amountExpression('dis_amt')} AS discount_amount,
        ${amountExpression('total_disc')} AS total_discount,
        ${amountExpression('part_disc')} AS parts_discount,
        ${amountExpression('labour_disc')} AS labour_discount,
        uploaded_at
      FROM hyundai_ro_billing_report
      WHERE ${hyundaiActiveBillSql()}
    ),
    ranked AS (
      SELECT
        *,
        ROW_NUMBER() OVER (
          PARTITION BY invoice_key
          ORDER BY ABS(labour_amount + parts_amount) DESC, uploaded_at DESC NULLS LAST, id DESC
        ) AS row_rank
      FROM base_raw
    ),
    base AS (
      SELECT *
      FROM ranked
      WHERE row_rank = 1
    ),
    filtered AS (
      SELECT *
      FROM base
      WHERE (${filters.billType} = 'all' OR lower(bill_type) = lower(${filters.billType}))
        AND (
          ${filters.dealerCode}::text IS NULL
          OR canonical_dealer = ${filters.dealerCode}
        )
        AND (${filters.workType} = 'all' OR lower(work_type) = lower(${filters.workType}))
        AND (${filters.advisor} = 'all' OR lower(service_advisor) = lower(${filters.advisor}))
        AND (${filters.startDate} = '' OR bill_date >= NULLIF(${filters.startDate}, '')::date)
        AND (${filters.endDate} = '' OR bill_date <= NULLIF(${filters.endDate}, '')::date)
        AND (
          ${filters.search} = ''
          OR bill_no ILIKE ${`%${filters.search}%`}
          OR customer_name ILIKE ${`%${filters.search}%`}
          OR mobile_no ILIKE ${`%${filters.search}%`}
          OR vin ILIKE ${`%${filters.search}%`}
          OR vehicle_reg_no ILIKE ${`%${filters.search}%`}
          OR model ILIKE ${`%${filters.search}%`}
          OR ro_no ILIKE ${`%${filters.search}%`}
          OR service_advisor ILIKE ${`%${filters.search}%`}
          OR technician ILIKE ${`%${filters.search}%`}
          OR work_type ILIKE ${`%${filters.search}%`}
        )
    ),
    paged AS (
      SELECT *
      FROM filtered
      ORDER BY bill_date DESC NULLS LAST, id DESC
      LIMIT ${filters.pageSize}
      OFFSET ${(filters.page - 1) * filters.pageSize}
    )
    SELECT
      (SELECT COUNT(*)::integer FROM filtered) AS total_rows,
      (SELECT MAX(uploaded_at) FROM base) AS source_updated_at,
      (
        SELECT jsonb_build_object(
          'bills', COUNT(DISTINCT invoice_key)::integer,
          'repairOrders', COUNT(DISTINCT ro_key)::integer,
          'revenue', COALESCE(SUM(labour_amount + parts_amount), 0),
          'labourAmount', COALESCE(SUM(labour_amount), 0),
          'partsAmount', COALESCE(SUM(parts_amount), 0),
          'otherAmount', COALESCE(SUM(other_amount), 0),
          'discountAmount', COALESCE(SUM(discount_amount + total_discount + parts_discount + labour_discount), 0),
          'avgBilling', COALESCE(AVG(NULLIF(total_amount, 0)), 0)
        )
        FROM filtered
      ) AS summary,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'billNo', bill_no,
          'billDate', bill_date,
          'billType', bill_type,
          'customerName', customer_name,
          'mobileNo', mobile_no,
          'vin', vin,
          'vehicleRegNo', vehicle_reg_no,
          'model', model,
          'roNo', ro_no,
          'roDate', ro_date,
          'serviceAdvisor', service_advisor,
          'technician', technician,
          'workType', work_type,
          'dealerCode', dealer_code,
          'insuranceCompany', insurance_company,
          'totalAmount', total_amount,
          'labourAmount', labour_amount,
          'partsAmount', parts_amount,
          'otherAmount', other_amount,
          'discountAmount', discount_amount + total_discount + parts_discount + labour_discount,
          'uploadedAt', uploaded_at
        ))
        FROM paged
      ), '[]'::jsonb) AS rows,
      jsonb_build_object(
        'billTypes', COALESCE((SELECT jsonb_agg(DISTINCT bill_type ORDER BY bill_type) FROM base WHERE bill_type <> '-'), '[]'::jsonb),
        'workTypes', COALESCE((SELECT jsonb_agg(DISTINCT work_type ORDER BY work_type) FROM base WHERE work_type <> '-'), '[]'::jsonb),
        'advisors', COALESCE((SELECT jsonb_agg(DISTINCT service_advisor ORDER BY service_advisor) FROM base WHERE service_advisor <> '-'), '[]'::jsonb)
      ) AS options
  `
}

async function buildPayload(filters: BillingFilters) {
  const hasTable = await tableExists('hyundai_ro_billing_report')

  if (!hasTable) {
    return {
      meta: {
        calculationMeta: HYUNDAI_BE_CALCULATION_META,
        source: 'hyundai_ro_billing_report',
        generatedAt: new Date().toISOString(),
        sourceUpdatedAt: null,
        warning: 'hyundai_ro_billing_report table is not available yet.',
      },
      summary: {
        bills: 0,
        repairOrders: 0,
        revenue: 0,
        labourAmount: 0,
        partsAmount: 0,
        otherAmount: 0,
        discountAmount: 0,
        avgBilling: 0,
      },
      rows: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalRows: 0, totalPages: 1 },
      options: { billTypes: [], workTypes: [], advisors: [] },
    }
  }

  const result = await db.execute(baseQuery(filters))
  const row = resultRows(result)[0] || {}
  const totalRows = Number(row.total_rows || 0)

  return {
    meta: {
      calculationMeta: HYUNDAI_BE_CALCULATION_META,
      source: 'hyundai_ro_billing_report',
      generatedAt: new Date().toISOString(),
      sourceUpdatedAt: row.source_updated_at || null,
    },
    summary: row.summary || {
      bills: 0,
      repairOrders: 0,
      revenue: 0,
      labourAmount: 0,
      partsAmount: 0,
      otherAmount: 0,
      discountAmount: 0,
      avgBilling: 0,
    },
    rows: Array.isArray(row.rows) ? row.rows : [],
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalRows,
      totalPages: Math.max(1, Math.ceil(totalRows / filters.pageSize)),
    },
    options: row.options || { billTypes: [], workTypes: [], advisors: [] },
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('hyundai-business-excellence-ro-billing')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessBrand(appUser, 'hyundai')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const permission = await timer.time('permission', () => requirePermission(appUser, 'hyundai.business_excellence.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const filters = getFilters(searchParams)
    const payload = await timer.time('ro-billing-cache', () => getCachedData(
      createCacheKey(filters),
      () => buildPayload(filters),
      CACHE_TTL_SECONDS
    ))
    const timing = timer.finish()

    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to build Hyundai RO Billing Report:', error)
    const timing = timer.finish()
    return withServerTiming(
      NextResponse.json({ error: 'Failed to build Hyundai RO Billing Report' }, { status: 500 }),
      timing.serverTiming
    )
  }
}
