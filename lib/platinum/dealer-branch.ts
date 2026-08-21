import { sql } from 'drizzle-orm'

export const PLATINUM_BRANCH_DEALERS = [
  { label: 'Platinum Jammu', dealerCode: 'N5211' },
  { label: 'Platinum Rajouri', dealerCode: 'N6250' },
  { label: 'Platinum Poonch', dealerCode: 'N6828' },
] as const

export type PlatinumDealerCode = (typeof PLATINUM_BRANCH_DEALERS)[number]['dealerCode']

/**
 * N5211 is a PARTIAL consolidation in `am_platinum_operation_wise_analysis_report`.
 *
 * Its file covers Jammu **and Poonch (N6828)**, but NOT Rajouri (N6250). Poonch also files
 * its own report, so those rows are a duplicate subset of N5211. Measured on every complete
 * month from 2025-01: N6828 never exceeds N5211 on any code (0 containment violations, and
 * 0 codes present at Poonch but absent from N5211), while N6250 violates containment on
 * 73-122 codes every month — Rajouri is genuinely separate.
 *
 * So:  group   = N5211 + N6250      (summing all three double-counts Poonch)
 *      Jammu   = N5211 - N6828
 *      Poonch  = N6828
 *      Rajouri = N6250
 *
 * Measured impact of getting this wrong: group overstated 7.8-10.8%, Jammu 10.8-13.8%.
 *
 * ⚠️ The consolidation shape differs per brand and must not be generalised. Hyundai's N5216
 * consolidates ALL branches; KIA does not consolidate at all.
 */
export const PLATINUM_CONSOLIDATED_DEALER_CODE: PlatinumDealerCode = 'N5211'

/** Branches whose rows are already contained inside the consolidated N5211 file. */
export const PLATINUM_CONSOLIDATED_CONTAINS: readonly PlatinumDealerCode[] = ['N6828']

/** Branches that file independently and are NOT inside the consolidated file. */
export const PLATINUM_INDEPENDENT_DEALER_CODES: readonly PlatinumDealerCode[] = ['N6250']

/**
 * Per-dealer weights that turn the raw rows into the requested scope.
 * `+1` adds a dealer's rows, `-1` subtracts them, absent means excluded.
 */
export function getPlatinumDealerWeights(
  dealerCode: string | null | undefined,
): Record<string, number> {
  const normalized = normalizePlatinumDealerCode(dealerCode)

  if (!normalized) {
    // All Locations: the consolidated file plus only the branches it does not contain.
    return {
      [PLATINUM_CONSOLIDATED_DEALER_CODE]: 1,
      ...Object.fromEntries(PLATINUM_INDEPENDENT_DEALER_CODES.map((code) => [code, 1])),
    }
  }

  if (normalized === PLATINUM_CONSOLIDATED_DEALER_CODE) {
    // Jammu has no file of its own; it exists only as the consolidated file minus Poonch.
    return {
      [PLATINUM_CONSOLIDATED_DEALER_CODE]: 1,
      ...Object.fromEntries(PLATINUM_CONSOLIDATED_CONTAINS.map((code) => [code, -1])),
    }
  }

  return { [normalized]: 1 }
}
export const PLATINUM_ALL_LOCATIONS_CODE = 'all'
export type PlatinumDealerSelection = PlatinumDealerCode | typeof PLATINUM_ALL_LOCATIONS_CODE

export const DEFAULT_PLATINUM_DEALER_CODE: PlatinumDealerCode = 'N5211'

export function normalizePlatinumDealerCode(value: string | null | undefined): PlatinumDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'N6848' || normalized === 'POONCH' || normalized === 'PLATINUM_POONCH') return 'N6828'
  if (normalized === 'N6824' || normalized === 'RAJOURI' || normalized === 'PLATINUM_RAJOURI') return 'N6250'
  if (normalized === 'JAMMU' || normalized === 'PLATINUM_JAMMU') return 'N5211'
  return PLATINUM_BRANCH_DEALERS.some((branch) => branch.dealerCode === normalized)
    ? normalized as PlatinumDealerCode
    : null
}

export function isPlatinumAllLocations(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase() === PLATINUM_ALL_LOCATIONS_CODE
}

export function normalizePlatinumDealerSelection(value: string | null | undefined): PlatinumDealerSelection | null {
  if (isPlatinumAllLocations(value)) return PLATINUM_ALL_LOCATIONS_CODE
  return normalizePlatinumDealerCode(value)
}

export function getPlatinumBranchLabel(dealerCode: string | null | undefined) {
  if (isPlatinumAllLocations(dealerCode) || !dealerCode) return 'All Locations'
  const normalized = normalizePlatinumDealerCode(dealerCode)
  return PLATINUM_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'Platinum Jammu'
}

export function appendPlatinumDealerCodeParam(params: URLSearchParams, dealerCode: string | null | undefined) {
  if (isPlatinumAllLocations(dealerCode)) {
    params.set('dealer_code', PLATINUM_ALL_LOCATIONS_CODE)
    return
  }
  const normalized = normalizePlatinumDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
}

export function platinumSourceDealerSql(
  sourceColumn: ReturnType<typeof sql.raw> = sql.raw('source_dealer_code'),
  fallbackColumns: ReturnType<typeof sql.raw>[] = [],
) {
  const candidates = [
    sql`NULLIF(UPPER(TRIM(COALESCE(${sourceColumn}::text, ''))), '')`,
    ...fallbackColumns.map((column) => sql`NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), '')`),
  ]
  const resolved = sql`COALESCE(${sql.join(candidates, sql`, `)})`

  return sql`
    CASE
      WHEN ${resolved} = 'N5211' THEN 'JAMMU'
      WHEN ${resolved} = 'N6250' THEN 'RAJOURI'
      WHEN ${resolved} = 'N6828' THEN 'POONCH'
      ELSE ${resolved}
    END
  `
}

