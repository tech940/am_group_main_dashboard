export const KIA_BRANCH_DEALERS = [
  { label: 'Jammu', dealerCode: 'JK402' },
  { label: 'Udhampur', dealerCode: 'JK501' },
] as const

export type KiaDealerCode = (typeof KIA_BRANCH_DEALERS)[number]['dealerCode']

export const DEFAULT_KIA_DEALER_CODE: KiaDealerCode = 'JK402'

export function normalizeKiaDealerCode(value: string | null | undefined): KiaDealerCode | null {
  const normalized = String(value || '').trim().toUpperCase()
  return KIA_BRANCH_DEALERS.some((branch) => branch.dealerCode === normalized)
    ? normalized as KiaDealerCode
    : null
}

export function getKiaBranchLabel(dealerCode: string | null | undefined) {
  const normalized = normalizeKiaDealerCode(dealerCode)
  return KIA_BRANCH_DEALERS.find((branch) => branch.dealerCode === normalized)?.label || 'Jammu'
}

export function appendKiaDealerCodeParam(params: URLSearchParams, dealerCode: string | null | undefined) {
  const normalized = normalizeKiaDealerCode(dealerCode)
  if (normalized) params.set('dealer_code', normalized)
}
