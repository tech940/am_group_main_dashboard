export const MG_BRANCH_DEALERS = [
  { label: 'MG Jammu', dealerCode: 'JAMMU' },
  { label: 'MG Kathua', dealerCode: 'KATHUA' },
] as const

export type MgDealerCode = (typeof MG_BRANCH_DEALERS)[number]['dealerCode']

export const DEFAULT_MG_DEALER_CODE: MgDealerCode = 'JAMMU'

export function normalizeMgDealerCode(value: string | null | undefined): MgDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'JAMMU' || normalized === 'MG_JAMMU' || normalized === 'MG-JAMMU' || normalized === 'MG-JM') return 'JAMMU'
  if (normalized === 'KATHUA' || normalized === 'MG_KATHUA' || normalized === 'MG-KATHUA' || normalized === 'MG-KT') return 'KATHUA'
  return MG_BRANCH_DEALERS.some((branch) => branch.dealerCode === normalized)
    ? (normalized as MgDealerCode)
    : null
}

export function getMgBranchLabel(dealerCode: string | null | undefined) {
  const normalized = normalizeMgDealerCode(dealerCode)
  return MG_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'MG Jammu'
}

export function appendMgDealerCodeParam(params: URLSearchParams, dealerCode: string | null | undefined) {
  const normalized = normalizeMgDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
}
