export const BRANCH_OPTIONS = [
  { value: 'kia', label: 'AM Kia' },
  { value: 'tata', label: 'AM Tata' },
  { value: 'hyundai', label: 'AM Hyundai' },
  { value: 'honda', label: 'AM Diamond Honda' },
  { value: 'ktm', label: 'AM KTM' },
  { value: 'triumph', label: 'AM Triumph' },
  { value: 'bajaj', label: 'AM Bajaj' },
  { value: 'mg', label: 'AM MG' },
] as const

export type BranchValue = typeof BRANCH_OPTIONS[number]['value']

export function isBranchValue(value: unknown): value is BranchValue {
  return typeof value === 'string' && BRANCH_OPTIONS.some((branch) => branch.value === value)
}

export function getBranchLabel(value: string | null | undefined) {
  return BRANCH_OPTIONS.find((branch) => branch.value === value)?.label || 'Unassigned Branch'
}
