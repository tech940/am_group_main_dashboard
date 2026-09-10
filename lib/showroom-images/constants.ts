export type ShowroomBrandKey =
  | 'kia'
  | 'hyundai'
  | 'tata'
  | 'mg'
  | 'platinum'
  | 'two_wheelers'

export type ShowroomBrandConfig = {
  key: ShowroomBrandKey
  label: string
  bucketId: string
  locations: readonly string[]
  accentColor: string
  badgeClass: string
}

export const SHOWROOM_BRANDS: readonly ShowroomBrandConfig[] = [
  {
    key: 'kia',
    label: 'AM Kia',
    bucketId: 'showroom-kia',
    locations: ['Jammu', 'Udhampur', 'Banihal'],
    accentColor: '#e11d48',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  {
    key: 'hyundai',
    label: 'AM Hyundai',
    bucketId: 'showroom-hyundai',
    locations: ['Jammu', 'Akhnoor', 'Kathua', 'RS Pura', 'Vijaypur', 'Billawar'],
    accentColor: '#0284c7',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  {
    key: 'tata',
    label: 'AM Tata',
    bucketId: 'showroom-tata',
    locations: ['Jammu', 'Akhnoor', 'Kathua', 'Rajouri', 'Udhampur'],
    accentColor: '#2563eb',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'mg',
    label: 'AM MG',
    bucketId: 'showroom-mg',
    locations: ['Jammu'],
    accentColor: '#dc2626',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
  },
  {
    key: 'platinum',
    label: 'AM Platinum',
    bucketId: 'showroom-platinum',
    locations: ['Jammu', 'Poonch', 'Rajouri'],
    accentColor: '#7c3aed',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  {
    key: 'two_wheelers',
    label: 'AM 2-Wheelers',
    bucketId: 'showroom-two-wheelers',
    locations: [
      'Diamond Honda (Jammu)',
      'KTM (Jammu)',
      'Triumph (Jammu)',
      'Bajaj (Jammu)',
    ],
    accentColor: '#ea580c',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
  },
] as const

export function getShowroomBrandConfig(key: string | null | undefined): ShowroomBrandConfig | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase()
  return SHOWROOM_BRANDS.find((b) => b.key === normalized) || null
}

export function isValidShowroomBrand(key: string | null | undefined): key is ShowroomBrandKey {
  return Boolean(getShowroomBrandConfig(key))
}

export function getShowroomBucketForBrand(brandKey: ShowroomBrandKey): string {
  const cfg = getShowroomBrandConfig(brandKey)
  return cfg?.bucketId || 'showroom-kia'
}

export function getLocationsForBrand(brandKey: ShowroomBrandKey): readonly string[] {
  const cfg = getShowroomBrandConfig(brandKey)
  return cfg?.locations || []
}

export type ShowroomDepartmentKey = 'sales' | 'service'

export type ShowroomDepartmentConfig = {
  key: ShowroomDepartmentKey
  label: string
  badgeClass: string
}

export const SHOWROOM_DEPARTMENTS: readonly ShowroomDepartmentConfig[] = [
  {
    key: 'sales',
    label: 'Sales',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    key: 'service',
    label: 'Service',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  },
] as const

export function getShowroomDepartmentConfig(key: string | null | undefined): ShowroomDepartmentConfig | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase()
  return SHOWROOM_DEPARTMENTS.find((d) => d.key === normalized) || null
}

export type ShowroomCategoryKey = 'vehicles' | 'tv' | 'bathroom'

export type ShowroomCategoryConfig = {
  key: ShowroomCategoryKey
  label: string
  shortLabel: string
  description: string
  slotCount: number
  badgeClass: string
}

export const SHOWROOM_CATEGORIES: readonly ShowroomCategoryConfig[] = [
  {
    key: 'vehicles',
    label: 'Vehicles',
    shortLabel: 'Vehicle',
    description: 'Display & showroom floor vehicles',
    slotCount: 2,
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  {
    key: 'tv',
    label: 'TV Display',
    shortLabel: 'TV',
    description: 'Showroom customer lounge / display TV screens',
    slotCount: 2,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  {
    key: 'bathroom',
    label: 'Washroom',
    shortLabel: 'Washroom',
    description: 'Customer & staff washroom cleanliness',
    slotCount: 2,
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
  },
] as const

export function getShowroomCategoryConfig(key: string | null | undefined): ShowroomCategoryConfig | null {
  if (!key) return null
  const normalized = key.trim().toLowerCase()
  return SHOWROOM_CATEGORIES.find((c) => c.key === normalized) || null
}
