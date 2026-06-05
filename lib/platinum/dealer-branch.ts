export const PLATINUM_BRANCH_DEALERS = [
  { label: 'Platinum Jammu', dealerCode: 'N5211' },
  { label: 'Platinum Rajouri', dealerCode: 'N6824' },
  { label: 'Platinum Poonch', dealerCode: 'N6828' },
] as const

export type PlatinumDealerCode = (typeof PLATINUM_BRANCH_DEALERS)[number]['dealerCode']

export const DEFAULT_PLATINUM_DEALER_CODE: PlatinumDealerCode = 'N5211'

export function normalizePlatinumDealerCode(value: string | null | undefined): PlatinumDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  return PLATINUM_BRANCH_DEALERS.some((branch) => branch.dealerCode === normalized)
    ? normalized as PlatinumDealerCode
    : null
}

export function getPlatinumBranchLabel(dealerCode: string | null | undefined) {
  const normalized = normalizePlatinumDealerCode(dealerCode)
  return PLATINUM_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'Platinum Jammu'
}

export function appendPlatinumDealerCodeParam(params: URLSearchParams, dealerCode: string | null | undefined) {
  const normalized = normalizePlatinumDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
}
