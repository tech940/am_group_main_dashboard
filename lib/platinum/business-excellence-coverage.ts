import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getPlatinumBranchLabel, PLATINUM_ALL_LOCATIONS_CODE } from '@/lib/platinum/dealer-branch'
import { platinumSourceDealerFilter } from '@/lib/platinum/dealer-filter'
import {
  platinumActiveBillSql,
  platinumRoBillingDealerFilter,
  platinumRoBillingDealerSql,
} from '@/lib/platinum/business-excellence-calculations'

export type PlatinumDealerCoverage = {
  dealerCode: string | null
  isAllLocations: boolean
  hasDataInRange: boolean
  rowCountInRange: number
  earliestAvailableDate: string | null
  latestAvailableDate: string | null
  dateBasis: string
  sourceLabel: string
  emptyReason: string | null
  comparisonStatus: 'available' | 'source_missing' | 'not_comparable'
  unmappedRowCount: number
  lastUpdatedAt: string | null
}

type NumericRow = Record<string, unknown>

function resultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? result as NumericRow[] : []
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10) || null
}

function makeCoverage(
  dealerCode: string | null,
  sourceLabel: string,
  dateBasis: string,
  rowCountInRange: number,
  earliestAvailableDate: string | null,
  latestAvailableDate: string | null,
  unmappedRowCount = 0,
  lastUpdatedAt: string | null = null,
  comparisonStatus: PlatinumDealerCoverage['comparisonStatus'] = rowCountInRange > 0 ? 'available' : 'source_missing'
): PlatinumDealerCoverage {
  const isAllLocations = !dealerCode
  const responseDealerCode = dealerCode || PLATINUM_ALL_LOCATIONS_CODE
  const hasDataInRange = rowCountInRange > 0
  const dealerLabel = getPlatinumBranchLabel(dealerCode)
  const emptyReason = hasDataInRange
    ? null
    : latestAvailableDate
      ? `No ${dealerLabel} ${sourceLabel} data for the selected range. Latest ${sourceLabel} data is ${latestAvailableDate}.`
      : `No ${dealerLabel} ${sourceLabel} data found for this source.`

  return {
    dealerCode: responseDealerCode,
    isAllLocations,
    hasDataInRange,
    rowCountInRange,
    earliestAvailableDate,
    latestAvailableDate,
    dateBasis,
    sourceLabel,
    emptyReason,
    comparisonStatus,
    unmappedRowCount,
    lastUpdatedAt,
  }
}

function timestampValue(value: unknown) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  return String(value) || null
}

export async function fetchPlatinumRoBillingCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = platinumRoBillingDealerFilter(dealerCode)

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MIN(bill_date)::text AS earliest_date,
      MAX(bill_date)::text AS latest_date,
      COUNT(*) FILTER (
        WHERE ${platinumRoBillingDealerSql()} IS NULL
      )::int AS unmapped_rows,
      MAX(uploaded_at)::text AS last_updated_at
    FROM am_platinum_ro_billing_report
    WHERE ${platinumActiveBillSql()}
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(
    dealerCode,
    'RO Billing',
    'bill_date',
    numberValue(row?.row_count),
    dateValue(row?.earliest_date),
    dateValue(row?.latest_date),
    numberValue(row?.unmapped_rows),
    timestampValue(row?.last_updated_at)
  )
}

export async function fetchPlatinumOpenRoCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND COALESCE(
        NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
        NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), '')
      ) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE r_o_date >= ${startDate}::date
          AND r_o_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MIN(r_o_date)::text AS earliest_date,
      MAX(r_o_date)::text AS latest_date,
      COUNT(*) FILTER (
        WHERE COALESCE(
          NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE'),
          NULLIF(UPPER(TRIM(COALESCE(dealer, ''))), '')
        ) IS NULL
      )::int AS unmapped_rows,
      MAX(uploaded_at)::text AS last_updated_at
    FROM am_platinum_repair_order_list
    WHERE TRUE
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(
    dealerCode,
    'Open RO',
    'r_o_date',
    numberValue(row?.row_count),
    dateValue(row?.earliest_date),
    dateValue(row?.latest_date),
    numberValue(row?.unmapped_rows),
    timestampValue(row?.last_updated_at),
    'not_comparable'
  )
}

export async function fetchPlatinumComplaintsCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = platinumSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code')
  )
  const businessDate = sql`COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date`

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE ${businessDate} >= ${startDate}::date
          AND ${businessDate} < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MIN(${businessDate})::text AS earliest_date,
      MAX(${businessDate})::text AS latest_date,
      COUNT(*) FILTER (
        WHERE NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE') IS NULL
      )::int AS unmapped_rows,
      MAX(uploaded_at)::text AS last_updated_at
    FROM am_platinum_call_center_complaints
    WHERE ${businessDate} IS NOT NULL
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(
    dealerCode,
    'Complaints',
    'COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)',
    numberValue(row?.row_count),
    dateValue(row?.earliest_date),
    dateValue(row?.latest_date),
    numberValue(row?.unmapped_rows),
    timestampValue(row?.last_updated_at)
  )
}

export async function fetchPlatinumEwCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = platinumSourceDealerFilter(dealerCode)

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MIN(reg_date)::text AS earliest_date,
      MAX(reg_date)::text AS latest_date,
      COUNT(*) FILTER (
        WHERE NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE') IS NULL
      )::int AS unmapped_rows,
      MAX(uploaded_at)::text AS last_updated_at
    FROM am_platinum_ew_report
    WHERE LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(
    dealerCode,
    'EW',
    'reg_date',
    numberValue(row?.row_count),
    dateValue(row?.earliest_date),
    dateValue(row?.latest_date),
    numberValue(row?.unmapped_rows),
    timestampValue(row?.last_updated_at)
  )
}

export async function fetchPlatinumSotCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = platinumSourceDealerFilter(dealerCode)

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MIN(reg_date)::text AS earliest_date,
      MAX(reg_date)::text AS latest_date,
      COUNT(*) FILTER (
        WHERE NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code, ''))), ''), 'ACTIVE') IS NULL
      )::int AS unmapped_rows,
      MAX(uploaded_at)::text AS last_updated_at
    FROM am_platinum_trust_package
    WHERE TRUE
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(
    dealerCode,
    'SOT',
    'reg_date',
    numberValue(row?.row_count),
    dateValue(row?.earliest_date),
    dateValue(row?.latest_date),
    numberValue(row?.unmapped_rows),
    timestampValue(row?.last_updated_at)
  )
}
