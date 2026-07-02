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

export function appendHyundaiDealerCodeParam(params: URLSearchParams, dealerCode?: string | null) {
  const normalized = normalizeHyundaiDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
  else params.delete('dealer_code')
  return params
}
