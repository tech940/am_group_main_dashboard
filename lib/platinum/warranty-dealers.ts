export const PLATINUM_WARRANTY_DEALER_GROUPS = [
  { key: 'jammu', label: 'Platinum Jammu', dealerCodes: ['N5211'] },
  { key: 'rajouri', label: 'Platinum Rajouri', dealerCodes: ['N6250', 'N6824'] },
  { key: 'poonch', label: 'Platinum Poonch', dealerCodes: ['N6828', 'N6848'] },
] as const

export type PlatinumWarrantyDealerGroupKey = (typeof PLATINUM_WARRANTY_DEALER_GROUPS)[number]['key']

export const PLATINUM_WARRANTY_ALLOWED_DEALERS = [
  ...new Set(PLATINUM_WARRANTY_DEALER_GROUPS.flatMap((group) => group.dealerCodes)),
] as const

const ALLOWED_SET = new Set<string>(PLATINUM_WARRANTY_ALLOWED_DEALERS)

const DEALER_TO_GROUP = new Map<string, (typeof PLATINUM_WARRANTY_DEALER_GROUPS)[number]>(
  PLATINUM_WARRANTY_DEALER_GROUPS.flatMap((group) =>
    group.dealerCodes.map((code) => [code, group] as const),
  ),
)

export function normalizePlatinumWarrantyDealerCode(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function isAllowedPlatinumWarrantyDealer(value: unknown) {
  const code = normalizePlatinumWarrantyDealerCode(value)
  return ALLOWED_SET.has(code)
}

export function getPlatinumWarrantyGroupForDealer(value: unknown) {
  return DEALER_TO_GROUP.get(normalizePlatinumWarrantyDealerCode(value)) || null
}
