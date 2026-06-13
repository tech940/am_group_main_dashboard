import { sql } from 'drizzle-orm'
import { platinumSourceDealerFilter, platinumSourceDealerSql } from '@/lib/platinum/dealer-filter'

export const PLATINUM_BE_CALCULATION_VERSION = '2026-06-cy-ly-correction-v2'

export const PLATINUM_BE_CALCULATION_META = {
  calculationVersion: PLATINUM_BE_CALCULATION_VERSION,
  dateBasis: 'bill_date',
  loadDefinition: 'COUNT(DISTINCT dealer_code + r_o_no), falling back to bill_no and row id',
  invoiceDefinition: 'dealer_code + bill_date + bill_no, falling back to r_o_no and row id',
  revenueDefinition: 'SUM(labour_amt + part_amt) after latest-invoice deduplication',
  grossDefinition: 'total_amt is source reconciliation only and is not dashboard revenue',
} as const

export function platinumRoBillingDealerSql() {
  return platinumSourceDealerSql(
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('main_dealer_code')]
  )
}

export function platinumRoBillingDealerFilter(dealerCode: string | null) {
  return platinumSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('main_dealer_code')]
  )
}

export function platinumRoBillingInvoiceKeySql() {
  return sql`COALESCE(${platinumRoBillingDealerSql()}, 'UNMAPPED') || ':' || bill_date::date::text || ':' || COALESCE(
      NULLIF(TRIM(bill_no::text), ''),
      NULLIF(TRIM(r_o_no::text), ''),
      id::text
    )`
}

export function platinumRoBillingRoKeySql() {
  return sql`COALESCE(${platinumRoBillingDealerSql()}, 'UNMAPPED') || ':' || COALESCE(
      NULLIF(TRIM(r_o_no::text), ''),
      NULLIF(TRIM(bill_no::text), ''),
      id::text
    )`
}

export function platinumActiveBillSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'`
}

export function platinumCancelledBillSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) LIKE '%cancel%'`
}

export function platinumRevenueSql() {
  return sql`COALESCE(labour_amt, 0)::numeric + COALESCE(part_amt, 0)::numeric`
}

export function platinumVasPeriodsAlign(
  currentStart: string | null | undefined,
  currentEnd: string | null | undefined,
  previousStart: string | null | undefined,
  previousEnd: string | null | undefined
) {
  if (!currentStart || !currentEnd || !previousStart || !previousEnd) return false
  return currentStart.slice(5, 10) === previousStart.slice(5, 10)
    && currentEnd.slice(5, 10) === previousEnd.slice(5, 10)
}

export function platinumComparisonGrowth(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}
