import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getPlatinumBranchLabel, PLATINUM_ALL_LOCATIONS_CODE } from '@/lib/platinum/dealer-branch'
import { platinumSourceDealerFilter } from '@/lib/platinum/dealer-filter'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

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

function coverageCacheKey(source: string, startDate: string, endDate: string, dealerCode: string | null) {
  return `platinum:coverage:${source}:${startDate}:${endDate}:${dealerCode || 'all'}`
}

export async function fetchPlatinumRoBillingCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  return getCachedData(
    coverageCacheKey('ro-billing', startDate, endDate, dealerCode),
    async () => {
      const dealerFilter = dealerCode
        ? sql`AND dealer_code = ${dealerCode}`
        : sql``

      const rows = await analyticsDb.execute(sql`
        SELECT
          COALESCE(SUM(invoice_count) FILTER (
            WHERE bill_date >= ${startDate}::date
              AND bill_date < (${endDate}::date + INTERVAL '1 day')
          ), 0)::int AS row_count,
          MIN(bill_date)::text AS earliest_date,
          MAX(bill_date)::text AS latest_date,
          COALESCE(SUM(invoice_count) FILTER (
            WHERE dealer_code = 'UNMAPPED'
          ), 0)::int AS unmapped_rows,
          MAX(uploaded_at)::text AS last_updated_at
        FROM am_platinum_ro_billing_daily_summary_v2
        WHERE TRUE
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
    },
    CACHE_TTL.PLATINUM
  )
}

export async function fetchPlatinumOpenRoCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  return getCachedData(
    coverageCacheKey('open-ro', startDate, endDate, dealerCode),
    async () => {
      const dealerFilter = dealerCode
        ? sql`AND dealer_code = ${dealerCode}`
        : sql``

      const rows = await analyticsDb.execute(sql`
        SELECT
          COALESCE(SUM(open_ro) FILTER (
            WHERE report_date >= ${startDate}::date
              AND report_date < (${endDate}::date + INTERVAL '1 day')
          ), 0)::int AS row_count,
          MIN(report_date)::text AS earliest_date,
          MAX(report_date)::text AS latest_date,
          COALESCE(SUM(open_ro) FILTER (
            WHERE dealer_code = 'UNMAPPED'
          ), 0)::int AS unmapped_rows,
          MAX(uploaded_at)::text AS last_updated_at
        FROM am_platinum_open_ro_daily_summary_v1
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
    },
    CACHE_TTL.PLATINUM
  )
}

export async function fetchPlatinumComplaintsCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  return getCachedData(
    coverageCacheKey('complaints', startDate, endDate, dealerCode),
    async () => {
      const dealerFilter = dealerCode
        ? sql`AND dealer_code = ${dealerCode}`
        : sql``

      const rows = await analyticsDb.execute(sql`
        SELECT
          COALESCE(SUM(complaints) FILTER (
            WHERE report_date >= ${startDate}::date
              AND report_date < (${endDate}::date + INTERVAL '1 day')
          ), 0)::int AS row_count,
          MIN(report_date)::text AS earliest_date,
          MAX(report_date)::text AS latest_date,
          COALESCE(SUM(complaints) FILTER (
            WHERE dealer_code = 'UNMAPPED'
          ), 0)::int AS unmapped_rows,
          MAX(uploaded_at)::text AS last_updated_at
        FROM am_platinum_complaints_daily_summary_v1
        WHERE TRUE
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
    },
    CACHE_TTL.PLATINUM
  )
}

export async function fetchPlatinumEwCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  return getCachedData(
    coverageCacheKey('ew', startDate, endDate, dealerCode),
    async () => {
      const dealerFilter = platinumSourceDealerFilter(dealerCode)

      const rows = await analyticsDb.execute(sql`
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
    },
    CACHE_TTL.PLATINUM
  )
}

export async function fetchPlatinumSotCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  return getCachedData(
    coverageCacheKey('sot', startDate, endDate, dealerCode),
    async () => {
      const dealerFilter = platinumSourceDealerFilter(dealerCode)

      const rows = await analyticsDb.execute(sql`
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
    },
    CACHE_TTL.PLATINUM
  )
}
