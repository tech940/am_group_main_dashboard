type HyundaiBranchDealer = {
  label: string
  dealerCode: 'JAMMU' | 'UDHAMPUR'
  dealerCodes: readonly string[]
}

export const HYUNDAI_BRANCH_DEALERS = [
  { label: 'Hyundai Jammu', dealerCode: 'JAMMU', dealerCodes: ['N5216', 'N6846', 'N6847'] },
  { label: 'Hyundai Udhampur', dealerCode: 'UDHAMPUR', dealerCodes: ['N5217', 'N6848', 'N6849'] },
] as const satisfies readonly HyundaiBranchDealer[]

export type HyundaiDealerCode = (typeof HYUNDAI_BRANCH_DEALERS)[number]['dealerCode']

export function normalizeHyundaiDealerCode(value: string | null | undefined): HyundaiDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized || normalized === 'ALL' || normalized === 'ALL_LOCATIONS') return null
  if (normalized === 'JAMMU' || normalized === 'HYUNDAI_JAMMU') return 'JAMMU'
  if (normalized === 'UDHAMPUR' || normalized === 'HYUNDAI_UDHAMPUR') return 'UDHAMPUR'

  const branch = HYUNDAI_BRANCH_DEALERS.find((item) => item.dealerCodes.some((code) => code === normalized))
  return branch?.dealerCode || null
}

export function getHyundaiDealerCodes(value: string | null | undefined): string[] {
  const normalized = normalizeHyundaiDealerCode(value)
  return [...(HYUNDAI_BRANCH_DEALERS.find((item) => item.dealerCode === normalized)?.dealerCodes || [])]
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
