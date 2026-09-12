export const MG_BRANCH_DEALERS = [
  // The Jammu showroom is known locally as Channi. ⚠️ The CODE stays JAMMU: it is what the DMS feed and the
  // 2 payment approvals already filed against this branch carry. Only the label people read changed.
  { label: 'MG Channi', dealerCode: 'JAMMU' },
  { label: 'MG Kathua', dealerCode: 'KATHUA' },
] as const

export type MgDealerCode = (typeof MG_BRANCH_DEALERS)[number]['dealerCode']

export const DEFAULT_MG_DEALER_CODE: MgDealerCode = 'JAMMU'

export function normalizeMgDealerCode(value: string | null | undefined): MgDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'JAMMU' || normalized === 'MG_JAMMU' || normalized === 'MG-JAMMU' || normalized === 'MG-JM') return 'JAMMU'
  if (normalized === 'CHANNI' || normalized === 'MG_CHANNI' || normalized === 'MG-CHANNI' || normalized === 'MG-CN') return 'JAMMU'
  if (normalized === 'KATHUA' || normalized === 'MG_KATHUA' || normalized === 'MG-KATHUA' || normalized === 'MG-KT') return 'KATHUA'
  return MG_BRANCH_DEALERS.some((branch) => branch.dealerCode === normalized)
    ? (normalized as MgDealerCode)
    : null
}

export function getMgBranchLabel(dealerCode: string | null | undefined) {
  const normalized = normalizeMgDealerCode(dealerCode)
  return MG_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'MG Channi'
}

export function appendMgDealerCodeParam(params: URLSearchParams, dealerCode: string | null | undefined) {
  const normalized = normalizeMgDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
}
