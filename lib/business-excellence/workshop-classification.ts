export const ACCIDENT_ADVISORS = ['Parul Bakshi', 'Naresh'] as const

export function normalizeWorkshopAdvisor(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

const accidentAdvisorSet = new Set(ACCIDENT_ADVISORS.map(normalizeWorkshopAdvisor))

export function classifyWorkshopAdvisor(value: string | null | undefined) {
  return accidentAdvisorSet.has(normalizeWorkshopAdvisor(value)) ? 'Accident' : 'MECH'
}
