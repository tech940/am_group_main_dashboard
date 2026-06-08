export const PLATINUM_BRANCH_DEALERS = [
  { label: 'Platinum Jammu', dealerCode: 'N5211' },
  { label: 'Platinum Rajouri', dealerCode: 'N6824' },
  { label: 'Platinum Poonch', dealerCode: 'N6828' },
] as const

export type PlatinumDealerCode = (typeof PLATINUM_BRANCH_DEALERS)[number]['dealerCode']
export const PLATINUM_ALL_LOCATIONS_CODE = 'all'
export type PlatinumDealerSelection = PlatinumDealerCode | typeof PLATINUM_ALL_LOCATIONS_CODE

export const DEFAULT_PLATINUM_DEALER_CODE: PlatinumDealerCode = 'N5211'

export function normalizePlatinumDealerCode(value: string | null | undefined): PlatinumDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
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
