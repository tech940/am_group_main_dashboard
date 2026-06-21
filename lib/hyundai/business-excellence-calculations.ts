import { sql } from 'drizzle-orm'
import {
  hyundaiSourceDealerFilter,
  hyundaiSourceDealerSql,
} from '@/lib/hyundai/dealer-branch'

export const HYUNDAI_BE_CALCULATION_VERSION = '2026-06-hyundai-platinum-parity-v1'

export const HYUNDAI_BE_CALCULATION_META = {
  calculationVersion: HYUNDAI_BE_CALCULATION_VERSION,
  dateBasis: 'bill_date',
  loadDefinition: 'COUNT(DISTINCT canonical dealer + r_o_no), falling back to bill_no and row id',
  invoiceDefinition: 'canonical dealer + bill_date + bill_no, falling back to r_o_no and row id',
  revenueDefinition: 'SUM(labour_amt + part_amt) after canonical invoice deduplication',
  grossDefinition: 'total_amt is source reconciliation only and is not dashboard revenue',
  cancelledDefinition: 'bill_type containing cancel is excluded from active calculations',
} as const

export function hyundaiRoBillingDealerSql() {
  return hyundaiSourceDealerSql(
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('main_dealer_code')],
  )
}

export function hyundaiRoBillingDealerFilter(dealerCode: string | null) {
  return hyundaiSourceDealerFilter(
    dealerCode,
    sql.raw('source_dealer_code'),
    [sql.raw('dealer_code'), sql.raw('main_dealer_code')],
  )
}

export function hyundaiRoBillingInvoiceKeySql() {
  return sql`COALESCE(${hyundaiRoBillingDealerSql()}, 'UNMAPPED') || ':' || bill_date::date::text || ':' || COALESCE(
    NULLIF(TRIM(bill_no::text), ''),
    NULLIF(TRIM(r_o_no::text), ''),
    id::text
  )`
}

export function hyundaiRoBillingRoKeySql() {
  return sql`COALESCE(${hyundaiRoBillingDealerSql()}, 'UNMAPPED') || ':' || COALESCE(
    NULLIF(TRIM(r_o_no::text), ''),
    NULLIF(TRIM(bill_no::text), ''),
    id::text
  )`
}

export function hyundaiActiveBillSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) NOT LIKE '%cancel%'`
}

export function hyundaiCancelledBillSql() {
  return sql`LOWER(TRIM(COALESCE(bill_type::text, ''))) LIKE '%cancel%'`
}

export function hyundaiRevenueSql() {
  return sql`COALESCE(labour_amt, 0)::numeric + COALESCE(part_amt, 0)::numeric`
}

export function hyundaiComparisonGrowth(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function hyundaiOperationPeriodsAlign(
  currentStart: string | null | undefined,
  previousStart: string | null | undefined,
) {
  if (!currentStart || !previousStart) return false
  return currentStart.slice(5, 7) === previousStart.slice(5, 7)
}
