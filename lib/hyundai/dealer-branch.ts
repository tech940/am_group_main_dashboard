import { sql } from 'drizzle-orm'

type HyundaiBranchDealer = {
  label: string
  dealerCode: 'JAMMU' | 'AKHNOOR' | 'KATHUA' | 'RS_PURA' | 'VIJAYPUR' | 'BILLAWAR'
  dealerCodes: readonly string[]
}

export const HYUNDAI_BRANCH_DEALERS = [
  { label: 'Hyundai Jammu', dealerCode: 'JAMMU', dealerCodes: ['N5203', 'N5216'] },
  { label: 'Hyundai Akhnoor', dealerCode: 'AKHNOOR', dealerCodes: ['N5701', 'N6844'] },
  { label: 'Hyundai Kathua', dealerCode: 'KATHUA', dealerCodes: ['N5804', 'N6845'] },
  { label: 'Hyundai RS Pura', dealerCode: 'RS_PURA', dealerCodes: ['N6815', 'N6846'] },
  { label: 'Hyundai Vijaypur', dealerCode: 'VIJAYPUR', dealerCodes: ['N6819', 'N6847'] },
  { label: 'Hyundai Billawar', dealerCode: 'BILLAWAR', dealerCodes: ['N6826', 'N6828', 'N6848'] },
] as const satisfies readonly HyundaiBranchDealer[]

export type HyundaiDealerCode = (typeof HYUNDAI_BRANCH_DEALERS)[number]['dealerCode']

/**
 * N5216 is Hyundai's MAIN dealer code, not a peer branch.
 *
 * In `hyundai_operation_wise_analysis_report` the file filed under N5216 is a
 * CONSOLIDATED, all-branch report: the other five codes are its sub-dealers and their
 * rows are a duplicate subset of it. Confirmed independently against
 * `hyundai_ro_billing_report`, where `main_dealer_code = 'N5216'` for all six source
 * dealers, and where ops(N5216) equals the WHOLE GROUP's billed labour to the rupee in
 * 7 of 15 months — never the Jammu-only figure.
 *
 * Consequences, both of which callers must handle explicitly:
 *   - the group total is N5216 ALONE; summing all six double-counts five branches
 *   - the Jammu-only figure exists in that table only as N5216 MINUS the other five
 *
 * ⚠️ This is specific to the Hyundai operation report. Do NOT generalise it: Platinum's
 * N5211 consolidates only Jammu + Poonch (not Rajouri) and KIA does not consolidate at
 * all, so a blanket "use the biggest code" would silently delete real branches.
 */
export const HYUNDAI_CONSOLIDATED_DEALER_CODE = 'N5216'

/** The branch that the consolidated file is filed under, and whose own figure is a residual. */
export const HYUNDAI_CONSOLIDATED_BRANCH: HyundaiDealerCode = 'JAMMU'

export function normalizeHyundaiDealerCode(value: string | null | undefined): HyundaiDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized || normalized === 'ALL' || normalized === 'ALL_LOCATIONS') return null
  if (normalized === 'JAMMU' || normalized === 'HYUNDAI_JAMMU' || normalized === 'JK402') return 'JAMMU'
  if (normalized === 'AKHNOOR' || normalized === 'HYUNDAI_AKHNOOR') return 'AKHNOOR'
  if (normalized === 'KATHUA' || normalized === 'HYUNDAI_KATHUA') return 'KATHUA'
  if (normalized === 'RS_PURA' || normalized === 'RSPURA' || normalized === 'HYUNDAI_RS_PURA') return 'RS_PURA'
  if (normalized === 'VIJAYPUR' || normalized === 'HYUNDAI_VIJAYPUR') return 'VIJAYPUR'
  if (
    normalized === 'BILLAWAR'
    || normalized === 'HYUNDAI_BILLAWAR'
    || normalized === 'UDHAMPUR'
    || normalized === 'HYUNDAI_UDHAMPUR'
    || normalized === 'JK501'
  ) return 'BILLAWAR'

  const branch = HYUNDAI_BRANCH_DEALERS.find((item) => item.dealerCodes.some((code) => code === normalized))
  return branch?.dealerCode || null
}

export function getHyundaiDealerCodes(value: string | null | undefined): string[] {
  const normalized = normalizeHyundaiDealerCode(value)
  return [...(HYUNDAI_BRANCH_DEALERS.find((item) => item.dealerCode === normalized)?.dealerCodes || [])]
}

export function hyundaiSourceDealerSql(
  sourceColumn: ReturnType<typeof sql.raw> = sql.raw('source_dealer_code'),
  fallbackColumns: ReturnType<typeof sql.raw>[] = [],
) {
  const candidates = [
    sql`NULLIF(NULLIF(UPPER(TRIM(COALESCE(${sourceColumn}::text, ''))), ''), 'ACTIVE')`,
    ...fallbackColumns.map((column) => sql`NULLIF(UPPER(TRIM(COALESCE(${column}::text, ''))), '')`),
  ]
  const resolved = sql`COALESCE(${sql.join(candidates, sql`, `)})`

  return sql`
    CASE
      WHEN ${resolved} IN ('N5203', 'N5216', 'JK402') THEN 'JAMMU'
      WHEN ${resolved} IN ('N5701', 'N6844') THEN 'AKHNOOR'
      WHEN ${resolved} IN ('N5804', 'N6845') THEN 'KATHUA'
      WHEN ${resolved} IN ('N6815', 'N6846') THEN 'RS_PURA'
      WHEN ${resolved} IN ('N6819', 'N6847') THEN 'VIJAYPUR'
      WHEN ${resolved} IN ('N6826', 'N6828', 'N6848', 'JK501') THEN 'BILLAWAR'
      WHEN UPPER(TRIM(COALESCE(${sourceColumn}::text, ''))) = 'ACTIVE' THEN 'JAMMU'
      ELSE ${resolved}
    END
  `
}

export function hyundaiSourceDealerFilter(
  dealerCode: string | null | undefined,
  sourceColumn: ReturnType<typeof sql.raw> = sql.raw('source_dealer_code'),
  fallbackColumns: ReturnType<typeof sql.raw>[] = [],
) {
  const normalized = normalizeHyundaiDealerCode(dealerCode)
  return normalized
    ? sql`AND ${hyundaiSourceDealerSql(sourceColumn, fallbackColumns)} = ${normalized}`
    : sql``
}

export function getHyundaiDealerLabel(value: string | null | undefined) {
  const normalized = normalizeHyundaiDealerCode(value)
  return HYUNDAI_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'All Locations'
}

export const getHyundaiBranchLabel = getHyundaiDealerLabel

export function appendHyundaiDealerCodeParam(params: URLSearchParams, dealerCode?: string | null) {
  const normalized = normalizeHyundaiDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
  else params.delete('dealer_code')
  return params
}
