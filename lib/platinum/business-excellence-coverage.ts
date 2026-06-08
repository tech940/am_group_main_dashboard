import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getPlatinumBranchLabel, PLATINUM_ALL_LOCATIONS_CODE } from '@/lib/platinum/dealer-branch'

export type PlatinumDealerCoverage = {
  dealerCode: string | null
  isAllLocations: boolean
  hasDataInRange: boolean
  rowCountInRange: number
  latestAvailableDate: string | null
  dateBasis: string
  sourceLabel: string
  emptyReason: string | null
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
  latestAvailableDate: string | null
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
    latestAvailableDate,
    dateBasis,
    sourceLabel,
    emptyReason,
  }
}

export async function fetchPlatinumRoBillingCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MAX(bill_date)::text AS latest_date
    FROM am_platinum_ro_billing_report
    WHERE LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(dealerCode, 'RO Billing', 'bill_date', numberValue(row?.row_count), dateValue(row?.latest_date))
}

export async function fetchPlatinumOpenRoCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dealer, ''))) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE r_o_date >= ${startDate}::date
          AND r_o_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MAX(r_o_date)::text AS latest_date
    FROM am_platinum_repair_order_list
    WHERE TRUE
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(dealerCode, 'Open RO', 'r_o_date', numberValue(row?.row_count), dateValue(row?.latest_date))
}

export async function fetchPlatinumComplaintsCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${dealerCode}`
    : sql``
  const businessDate = sql`COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)::date`

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE ${businessDate} >= ${startDate}::date
          AND ${businessDate} < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MAX(${businessDate})::text AS latest_date
    FROM am_platinum_call_center_complaints
    WHERE ${businessDate} IS NOT NULL
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(dealerCode, 'Complaints', 'COALESCE(complaint_date, resolving_date, dealer_resolving_date, close_date)', numberValue(row?.row_count), dateValue(row?.latest_date))
}

export async function fetchPlatinumEwCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(dlr_no, ''))) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MAX(reg_date)::text AS latest_date
    FROM am_platinum_ew_report
    WHERE LOWER(TRIM(COALESCE(department::text, ''))) = 'service'
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(dealerCode, 'EW', 'reg_date', numberValue(row?.row_count), dateValue(row?.latest_date))
}

export async function fetchPlatinumSotCoverage(startDate: string, endDate: string, dealerCode: string | null = null) {
  const dealerFilter = dealerCode
    ? sql`AND UPPER(TRIM(COALESCE(source_dealer_code, ''))) = ${dealerCode}`
    : sql``

  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE reg_date >= ${startDate}::date
          AND reg_date < (${endDate}::date + INTERVAL '1 day')
      )::int AS row_count,
      MAX(reg_date)::text AS latest_date
    FROM am_platinum_trust_package
    WHERE TRUE
      ${dealerFilter}
  `)
  const row = resultRows(rows)[0]
  return makeCoverage(dealerCode, 'SOT', 'reg_date', numberValue(row?.row_count), dateValue(row?.latest_date))
}
