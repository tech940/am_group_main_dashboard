export const HYUNDAI_WARRANTY_EXCLUDED_DEALERS = ['N5211', 'N6250', 'N6828'] as const

export const HYUNDAI_WARRANTY_DEALER_GROUPS = [
  { key: 'jammu', label: 'Jammu', dealerCodes: ['N5203', 'N5216'] },
  { key: 'akhnoor', label: 'Akhnoor', dealerCodes: ['N5701', 'N6844'] },
  { key: 'kathua', label: 'Kathua', dealerCodes: ['N5804', 'N6845'] },
  { key: 'rs_pura', label: 'RS Pura', dealerCodes: ['N6815', 'N6846'] },
  { key: 'vijaypur', label: 'Vijaypur', dealerCodes: ['N6819', 'N6847'] },
  { key: 'billawar', label: 'Billawar', dealerCodes: ['N6826', 'N6848'] },
] as const

export type HyundaiWarrantyDealerGroupKey = (typeof HYUNDAI_WARRANTY_DEALER_GROUPS)[number]['key']

export const HYUNDAI_WARRANTY_ALLOWED_DEALERS = [
  ...new Set(HYUNDAI_WARRANTY_DEALER_GROUPS.flatMap((group) => group.dealerCodes)),
] as const

const EXCLUDED_SET = new Set<string>(HYUNDAI_WARRANTY_EXCLUDED_DEALERS)
const ALLOWED_SET = new Set<string>(HYUNDAI_WARRANTY_ALLOWED_DEALERS)

const DEALER_TO_GROUP = new Map<string, (typeof HYUNDAI_WARRANTY_DEALER_GROUPS)[number]>(
  HYUNDAI_WARRANTY_DEALER_GROUPS.flatMap((group) =>
    group.dealerCodes.map((code) => [code, group] as const),
  ),
)

export function normalizeHyundaiWarrantyDealerCode(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function isExcludedHyundaiWarrantyDealer(value: unknown) {
  return EXCLUDED_SET.has(normalizeHyundaiWarrantyDealerCode(value))
}

export function isAllowedHyundaiWarrantyDealer(value: unknown) {
  const code = normalizeHyundaiWarrantyDealerCode(value)
  return ALLOWED_SET.has(code) && !EXCLUDED_SET.has(code)
}

export function getHyundaiWarrantyGroupForDealer(value: unknown) {
  return DEALER_TO_GROUP.get(normalizeHyundaiWarrantyDealerCode(value)) || null
}
