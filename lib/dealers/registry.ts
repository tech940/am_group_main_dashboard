import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { HYUNDAI_BRANCH_DEALERS } from '@/lib/hyundai/dealer-branch'
import { PLATINUM_BRANCH_DEALERS } from '@/lib/platinum/dealer-branch'

// A "dealer" here is a physical branch/location within a brand (what the Business Excellence
// dealer selector switches between). A user can be pinned to one or more of these so they only
// ever see that branch's data. The stored value is the same code the BE routes filter on.
export type DealerOption = { code: string; label: string }

export const BRAND_DEALERS: Record<string, DealerOption[]> = {
  kia: KIA_BRANCH_DEALERS.map((dealer) => ({ code: dealer.dealerCode, label: dealer.label })),
  hyundai: HYUNDAI_BRANCH_DEALERS.map((dealer) => ({ code: dealer.dealerCode, label: dealer.label })),
  platinum: PLATINUM_BRANCH_DEALERS.map((dealer) => ({ code: dealer.dealerCode, label: dealer.label })),
}

export function getBrandDealers(brand: string | null | undefined): DealerOption[] {
  return (brand && BRAND_DEALERS[brand]) || []
}

export function brandHasDealers(brand: string | null | undefined): boolean {
  return getBrandDealers(brand).length > 0
}

export function isValidDealerForBrand(brand: string, code: string): boolean {
  return getBrandDealers(brand).some((dealer) => dealer.code === code)
}

export function getDealerLabel(brand: string, code: string): string {
  return getBrandDealers(brand).find((dealer) => dealer.code === code)?.label || code
}

/** Parse a stored `users.dealers` string ("JK402,JK501") into codes valid for the brand. */
export function parseUserDealers(brand: string | null | undefined, dealers: string | null | undefined): string[] {
  if (!brand || !dealers) return []
  const valid = new Set(getBrandDealers(brand).map((dealer) => dealer.code))
  return dealers.split(',').map((code) => code.trim()).filter((code) => valid.has(code))
}
