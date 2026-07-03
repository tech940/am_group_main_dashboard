export const BRANCH_OPTIONS = [
  { value: 'kia', label: 'AM Kia' },
  { value: 'tata', label: 'AM Tata' },
  { value: 'hyundai', label: 'AM Hyundai' },
  { value: 'platinum', label: 'AM Platinum' },
  { value: 'honda', label: 'AM Diamond Honda' },
  { value: 'ktm', label: 'AM KTM' },
  { value: 'triumph', label: 'AM Triumph' },
  { value: 'bajaj', label: 'AM Bajaj' },
  { value: 'mg', label: 'AM MG' },
] as const

export const ALL_BRANCH_OPTION = { value: 'all', label: 'All Branches' } as const

export const USER_BRANCH_OPTIONS = [
  ALL_BRANCH_OPTION,
  ...BRANCH_OPTIONS,
] as const

export type BranchValue = typeof BRANCH_OPTIONS[number]['value']
export type UserBranchValue = typeof USER_BRANCH_OPTIONS[number]['value']

export function isBranchValue(value: unknown): value is BranchValue {
  return typeof value === 'string' && BRANCH_OPTIONS.some((branch) => branch.value === value)
}

export function isUserBranchValue(value: unknown): value is UserBranchValue {
  return value === ALL_BRANCH_OPTION.value || isBranchValue(value)
}

export function hasAllBranchAccess(value: string | null | undefined) {
  return value === ALL_BRANCH_OPTION.value
}

export function getBranchLabel(value: string | null | undefined) {
  return BRANCH_OPTIONS.find((branch) => branch.value === value)?.label || 'Unassigned Branch'
}

export function getUserBranchLabel(value: string | null | undefined) {
  if (value === ALL_BRANCH_OPTION.value) {
    return ALL_BRANCH_OPTION.label
  }

  if (value && value.includes(',')) {
    return value
      .split(',')
      .map((val) => getBranchLabel(val.trim()))
      .join(', ')
  }

  return getBranchLabel(value)
}
