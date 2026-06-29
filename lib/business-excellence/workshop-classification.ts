export const ACCIDENT_ADVISORS = ['Parul Bakshi', 'Naresh'] as const
export type BusinessExcellenceBrand = 'hyundai' | 'platinum'
export type ServiceTypeCategory = 'paid' | 'free' | 'running' | 'accident' | 'other'

export function normalizeWorkshopAdvisor(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase()
}

const accidentAdvisorSet = new Set(ACCIDENT_ADVISORS.map(normalizeWorkshopAdvisor))

export function classifyWorkshopAdvisor(value: string | null | undefined) {
  return accidentAdvisorSet.has(normalizeWorkshopAdvisor(value)) ? 'Accident' : 'MECH'
}

type ServiceTypeRule = {
  exact: string[]
  contains?: string[]
  mileagePattern?: boolean
}

const PAID_SERVICE_MILEAGE_PATTERN = /(^|\s)(20|30|40|50|60|70|80|90|100|110|120|130|140|150|160|170)k(\s|$)/

const BRAND_SERVICE_TYPE_RULES: Record<BusinessExcellenceBrand, Record<Exclude<ServiceTypeCategory, 'other'>, ServiceTypeRule>> = {
  hyundai: {
    paid: {
      exact: ['Paid Service', 'Service Package'],
      mileagePattern: true,
    },
    free: {
      exact: [
        'Free Service',
        'Free Services',
        'First Free Service',
        'Second Free Service',
        'Third Free Service',
        'TMA First Free Service',
        'TMA Second Free Service',
        'TMA Third Free Service',
        'TMA-First Free Service',
        'TMA-Second Free Service',
        'TMA-Third Free Service',
        'Sixth Free Service',
      ],
    },
    running: {
      exact: ['Running Repair', 'Running Repairs'],
    },
    accident: {
      exact: ['Accident', 'Accidental Repair', 'Bodyshop', 'Body Shop', 'Insurance', 'CRASH', 'Accident Repair', 'Body Repair', 'Paint & Body', 'Paint and Body'],
      contains: ['accident', 'bodyshop', 'body shop', 'insurance', 'crash', 'body repair', 'paint', 'panel'],
    },
  },
  platinum: {
    paid: {
      exact: ['Paid Service', 'Service Package'],
      mileagePattern: true,
    },
    free: {
      exact: [
        'Free Service',
        'Free Services',
        'First Free Service',
        'Second Free Service',
        'Third Free Service',
        'TMA First Free Service',
        'TMA Second Free Service',
        'TMA Third Free Service',
        'TMA-First Free Service',
        'TMA-Second Free Service',
        'TMA-Third Free Service',
        'Sixth Free Service',
      ],
    },
    running: {
      exact: ['Running Repair', 'Running Repairs'],
    },
    accident: {
      exact: ['Accident', 'Accidental Repair', 'Bodyshop', 'Body Shop', 'Insurance', 'CRASH', 'Accident Repair', 'Body Repair', 'Paint & Body', 'Paint and Body'],
      contains: ['accident', 'bodyshop', 'body shop', 'insurance', 'crash', 'body repair', 'paint', 'panel'],
    },
  },
}

export function normalizeServiceTypeName(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function isMileageServiceTypeLabel(value: string | null | undefined) {
  return PAID_SERVICE_MILEAGE_PATTERN.test(normalizeServiceTypeName(value))
}

function exactServiceTypeSet(brand: BusinessExcellenceBrand, category: Exclude<ServiceTypeCategory, 'other'>) {
  return new Set(BRAND_SERVICE_TYPE_RULES[brand][category].exact.map(normalizeServiceTypeName))
}

export function matchesServiceTypeCategory(
  value: string | null | undefined,
  brand: BusinessExcellenceBrand,
  category: Exclude<ServiceTypeCategory, 'other'>,
) {
  const normalized = normalizeServiceTypeName(value)
  if (!normalized) return false

  const rule = BRAND_SERVICE_TYPE_RULES[brand][category]
  if (rule.mileagePattern && PAID_SERVICE_MILEAGE_PATTERN.test(normalized)) return true
  if (exactServiceTypeSet(brand, category).has(normalized)) return true
  return (rule.contains || []).some((needle) => normalized.includes(normalizeServiceTypeName(needle)))
}

export function getServiceTypeCategory(value: string | null | undefined, brand: BusinessExcellenceBrand): ServiceTypeCategory {
  if (matchesServiceTypeCategory(value, brand, 'paid')) return 'paid'
  if (matchesServiceTypeCategory(value, brand, 'free')) return 'free'
  if (matchesServiceTypeCategory(value, brand, 'running')) return 'running'
  if (matchesServiceTypeCategory(value, brand, 'accident')) return 'accident'
  return 'other'
}

export function partitionServiceTypeRows<T>(
  rows: T[],
  getLabel: (row: T) => string | null | undefined,
  brand: BusinessExcellenceBrand,
) {
  const paidRows = rows.filter((row) => matchesServiceTypeCategory(getLabel(row), brand, 'paid'))
  const freeRows = rows.filter((row) => matchesServiceTypeCategory(getLabel(row), brand, 'free'))
  const runningRows = rows.filter((row) => matchesServiceTypeCategory(getLabel(row), brand, 'running'))
  const accidentRows = rows.filter((row) => matchesServiceTypeCategory(getLabel(row), brand, 'accident'))
  const assigned = new Set([...paidRows, ...freeRows, ...runningRows, ...accidentRows])

  return {
    paidRows,
    freeRows,
    runningRows,
    accidentRows,
    otherRows: rows.filter((row) => !assigned.has(row)),
  }
}
