export interface BrandModels {
  brand: string
  popular?: boolean
  models: {
    name: string
    bodyType?: 'Hatchback' | 'Sedan' | 'SUV' | 'MUV' | 'Luxury'
    baseNewPriceLakhs: number // Approx ex-showroom new price in Lakhs for baseline valuation
  }[]
}

export const CAR_BRANDS_DATA: BrandModels[] = [
  {
    brand: 'Hyundai',
    popular: true,
    models: [
      { name: 'Creta', bodyType: 'SUV', baseNewPriceLakhs: 11.0 },
      { name: 'Venue', bodyType: 'SUV', baseNewPriceLakhs: 7.9 },
      { name: 'i20', bodyType: 'Hatchback', baseNewPriceLakhs: 7.0 },
      { name: 'Grand i10 Nios', bodyType: 'Hatchback', baseNewPriceLakhs: 5.9 },
      { name: 'Verna', bodyType: 'Sedan', baseNewPriceLakhs: 11.0 },
      { name: 'Exter', bodyType: 'SUV', baseNewPriceLakhs: 6.1 },
      { name: 'Aura', bodyType: 'Sedan', baseNewPriceLakhs: 6.5 },
      { name: 'Alcazar', bodyType: 'SUV', baseNewPriceLakhs: 16.8 },
      { name: 'Tucson', bodyType: 'SUV', baseNewPriceLakhs: 29.0 },
      { name: 'Santro', bodyType: 'Hatchback', baseNewPriceLakhs: 4.9 },
      { name: 'Eon', bodyType: 'Hatchback', baseNewPriceLakhs: 3.5 },
      { name: 'Elantra', bodyType: 'Sedan', baseNewPriceLakhs: 18.0 },
      { name: 'i10', bodyType: 'Hatchback', baseNewPriceLakhs: 4.5 },
      { name: 'Other Hyundai Model', bodyType: 'Hatchback', baseNewPriceLakhs: 7.0 },
    ],
  },
  {
    brand: 'Maruti Suzuki',
    popular: true,
    models: [
      { name: 'Swift', bodyType: 'Hatchback', baseNewPriceLakhs: 6.5 },
      { name: 'Baleno', bodyType: 'Hatchback', baseNewPriceLakhs: 6.7 },
      { name: 'Brezza', bodyType: 'SUV', baseNewPriceLakhs: 8.4 },
      { name: 'Dzire', bodyType: 'Sedan', baseNewPriceLakhs: 6.6 },
      { name: 'Wagon R', bodyType: 'Hatchback', baseNewPriceLakhs: 5.6 },
      { name: 'Ertiga', bodyType: 'MUV', baseNewPriceLakhs: 8.7 },
      { name: 'Fronx', bodyType: 'SUV', baseNewPriceLakhs: 7.5 },
      { name: 'Grand Vitara', bodyType: 'SUV', baseNewPriceLakhs: 11.0 },
      { name: 'Alto K10', bodyType: 'Hatchback', baseNewPriceLakhs: 4.0 },
      { name: 'Alto 800', bodyType: 'Hatchback', baseNewPriceLakhs: 3.5 },
      { name: 'Celerio', bodyType: 'Hatchback', baseNewPriceLakhs: 5.4 },
      { name: 'Ignis', bodyType: 'Hatchback', baseNewPriceLakhs: 5.8 },
      { name: 'XL6', bodyType: 'MUV', baseNewPriceLakhs: 11.6 },
      { name: 'Ciaz', bodyType: 'Sedan', baseNewPriceLakhs: 9.4 },
      { name: 'S-Presso', bodyType: 'Hatchback', baseNewPriceLakhs: 4.3 },
      { name: 'Jimny', bodyType: 'SUV', baseNewPriceLakhs: 12.7 },
      { name: 'Other Maruti Model', bodyType: 'Hatchback', baseNewPriceLakhs: 6.0 },
    ],
  },
  {
    brand: 'Tata',
    popular: true,
    models: [
      { name: 'Nexon', bodyType: 'SUV', baseNewPriceLakhs: 8.0 },
      { name: 'Punch', bodyType: 'SUV', baseNewPriceLakhs: 6.1 },
      { name: 'Altroz', bodyType: 'Hatchback', baseNewPriceLakhs: 6.6 },
      { name: 'Tiago', bodyType: 'Hatchback', baseNewPriceLakhs: 5.6 },
      { name: 'Harrier', bodyType: 'SUV', baseNewPriceLakhs: 15.5 },
      { name: 'Safari', bodyType: 'SUV', baseNewPriceLakhs: 16.2 },
      { name: 'Tigor', bodyType: 'Sedan', baseNewPriceLakhs: 6.3 },
      { name: 'Curvv', bodyType: 'SUV', baseNewPriceLakhs: 10.0 },
      { name: 'Nexon EV', bodyType: 'SUV', baseNewPriceLakhs: 14.5 },
      { name: 'Punch EV', bodyType: 'SUV', baseNewPriceLakhs: 10.0 },
      { name: 'Other Tata Model', bodyType: 'Hatchback', baseNewPriceLakhs: 7.0 },
    ],
  },
  {
    brand: 'Mahindra',
    popular: true,
    models: [
      { name: 'Thar / Thar Roxx', bodyType: 'SUV', baseNewPriceLakhs: 11.5 },
      { name: 'Scorpio-N', bodyType: 'SUV', baseNewPriceLakhs: 13.8 },
      { name: 'Scorpio Classic', bodyType: 'SUV', baseNewPriceLakhs: 13.6 },
      { name: 'XUV700', bodyType: 'SUV', baseNewPriceLakhs: 14.0 },
      { name: 'XUV 3XO / XUV300', bodyType: 'SUV', baseNewPriceLakhs: 7.8 },
      { name: 'Bolero / Bolero Neo', bodyType: 'SUV', baseNewPriceLakhs: 9.9 },
      { name: 'Marazzo', bodyType: 'MUV', baseNewPriceLakhs: 14.3 },
      { name: 'XUV400 EV', bodyType: 'SUV', baseNewPriceLakhs: 15.5 },
      { name: 'Other Mahindra Model', bodyType: 'SUV', baseNewPriceLakhs: 10.0 },
    ],
  },
  {
    brand: 'Kia',
    popular: true,
    models: [
      { name: 'Seltos', bodyType: 'SUV', baseNewPriceLakhs: 11.0 },
      { name: 'Sonet', bodyType: 'SUV', baseNewPriceLakhs: 8.0 },
      { name: 'Carens', bodyType: 'MUV', baseNewPriceLakhs: 10.6 },
      { name: 'Carnival', bodyType: 'MUV', baseNewPriceLakhs: 30.0 },
      { name: 'EV6', bodyType: 'SUV', baseNewPriceLakhs: 60.0 },
      { name: 'Other Kia Model', bodyType: 'SUV', baseNewPriceLakhs: 10.0 },
    ],
  },
  {
    brand: 'Toyota',
    popular: true,
    models: [
      { name: 'Innova Crysta', bodyType: 'MUV', baseNewPriceLakhs: 19.9 },
      { name: 'Innova Hycross', bodyType: 'MUV', baseNewPriceLakhs: 19.8 },
      { name: 'Fortuner', bodyType: 'SUV', baseNewPriceLakhs: 33.5 },
      { name: 'Urban Cruiser Hyryder', bodyType: 'SUV', baseNewPriceLakhs: 11.1 },
      { name: 'Glanza', bodyType: 'Hatchback', baseNewPriceLakhs: 6.9 },
      { name: 'Rumion', bodyType: 'MUV', baseNewPriceLakhs: 10.4 },
      { name: 'Etios / Liva', bodyType: 'Sedan', baseNewPriceLakhs: 6.5 },
      { name: 'Yaris', bodyType: 'Sedan', baseNewPriceLakhs: 9.0 },
      { name: 'Hilux', bodyType: 'SUV', baseNewPriceLakhs: 30.4 },
      { name: 'Camry', bodyType: 'Luxury', baseNewPriceLakhs: 46.0 },
      { name: 'Other Toyota Model', bodyType: 'SUV', baseNewPriceLakhs: 15.0 },
    ],
  },
  {
    brand: 'Honda',
    popular: true,
    models: [
      { name: 'City', bodyType: 'Sedan', baseNewPriceLakhs: 12.0 },
      { name: 'Amaze', bodyType: 'Sedan', baseNewPriceLakhs: 7.2 },
      { name: 'Elevate', bodyType: 'SUV', baseNewPriceLakhs: 11.7 },
      { name: 'WR-V', bodyType: 'SUV', baseNewPriceLakhs: 9.0 },
      { name: 'Jazz', bodyType: 'Hatchback', baseNewPriceLakhs: 8.0 },
      { name: 'Civic', bodyType: 'Sedan', baseNewPriceLakhs: 18.0 },
      { name: 'BR-V / CR-V', bodyType: 'SUV', baseNewPriceLakhs: 12.0 },
      { name: 'Other Honda Model', bodyType: 'Sedan', baseNewPriceLakhs: 8.0 },
    ],
  },
  {
    brand: 'Volkswagen',
    models: [
      { name: 'Taigun', bodyType: 'SUV', baseNewPriceLakhs: 11.7 },
      { name: 'Virtus', bodyType: 'Sedan', baseNewPriceLakhs: 11.5 },
      { name: 'Polo', bodyType: 'Hatchback', baseNewPriceLakhs: 7.5 },
      { name: 'Vento', bodyType: 'Sedan', baseNewPriceLakhs: 9.5 },
      { name: 'Tiguan', bodyType: 'SUV', baseNewPriceLakhs: 35.0 },
      { name: 'Other Volkswagen Model', bodyType: 'Hatchback', baseNewPriceLakhs: 9.0 },
    ],
  },
  {
    brand: 'Skoda',
    models: [
      { name: 'Kushaq', bodyType: 'SUV', baseNewPriceLakhs: 11.0 },
      { name: 'Slavia', bodyType: 'Sedan', baseNewPriceLakhs: 10.7 },
      { name: 'Rapid', bodyType: 'Sedan', baseNewPriceLakhs: 8.5 },
      { name: 'Octavia', bodyType: 'Sedan', baseNewPriceLakhs: 27.0 },
      { name: 'Superb', bodyType: 'Luxury', baseNewPriceLakhs: 35.0 },
      { name: 'Kodiaq', bodyType: 'SUV', baseNewPriceLakhs: 38.0 },
      { name: 'Other Skoda Model', bodyType: 'Sedan', baseNewPriceLakhs: 10.0 },
    ],
  },
  {
    brand: 'Renault',
    models: [
      { name: 'Kwid', bodyType: 'Hatchback', baseNewPriceLakhs: 4.7 },
      { name: 'Triber', bodyType: 'MUV', baseNewPriceLakhs: 6.0 },
      { name: 'Kiger', bodyType: 'SUV', baseNewPriceLakhs: 6.0 },
      { name: 'Duster', bodyType: 'SUV', baseNewPriceLakhs: 9.5 },
      { name: 'Other Renault Model', bodyType: 'Hatchback', baseNewPriceLakhs: 5.5 },
    ],
  },
  {
    brand: 'Ford',
    models: [
      { name: 'EcoSport', bodyType: 'SUV', baseNewPriceLakhs: 9.0 },
      { name: 'Endeavour', bodyType: 'SUV', baseNewPriceLakhs: 30.0 },
      { name: 'Figo', bodyType: 'Hatchback', baseNewPriceLakhs: 6.0 },
      { name: 'Aspire', bodyType: 'Sedan', baseNewPriceLakhs: 6.5 },
      { name: 'Freestyle', bodyType: 'Hatchback', baseNewPriceLakhs: 6.5 },
      { name: 'Other Ford Model', bodyType: 'SUV', baseNewPriceLakhs: 8.0 },
    ],
  },
  {
    brand: 'MG',
    models: [
      { name: 'Hector / Hector Plus', bodyType: 'SUV', baseNewPriceLakhs: 14.0 },
      { name: 'Astor', bodyType: 'SUV', baseNewPriceLakhs: 10.0 },
      { name: 'ZS EV', bodyType: 'SUV', baseNewPriceLakhs: 19.0 },
      { name: 'Comet EV', bodyType: 'Hatchback', baseNewPriceLakhs: 7.0 },
      { name: 'Gloster', bodyType: 'SUV', baseNewPriceLakhs: 38.0 },
      { name: 'Other MG Model', bodyType: 'SUV', baseNewPriceLakhs: 12.0 },
    ],
  },
  {
    brand: 'Nissan',
    models: [
      { name: 'Magnite', bodyType: 'SUV', baseNewPriceLakhs: 6.0 },
      { name: 'Kicks', bodyType: 'SUV', baseNewPriceLakhs: 9.5 },
      { name: 'Micra', bodyType: 'Hatchback', baseNewPriceLakhs: 5.5 },
      { name: 'Sunny', bodyType: 'Sedan', baseNewPriceLakhs: 7.5 },
      { name: 'Other Nissan Model', bodyType: 'Hatchback', baseNewPriceLakhs: 6.0 },
    ],
  },
  {
    brand: 'Other Brand',
    models: [
      { name: 'Other Car Model', bodyType: 'Sedan', baseNewPriceLakhs: 7.0 },
    ],
  },
]

export const MANUFACTURING_YEARS = [
  2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010,
]

export const FUEL_TYPES = [
  { id: 'petrol', label: 'Petrol' },
  { id: 'diesel', label: 'Diesel' },
  { id: 'cng', label: 'CNG' },
  { id: 'electric', label: 'Electric (EV)' },
  { id: 'hybrid', label: 'Hybrid' },
] as const

export const TRANSMISSION_TYPES = [
  { id: 'manual', label: 'Manual' },
  { id: 'automatic', label: 'Automatic' },
] as const

export const KM_RANGES = [
  { id: 'under_20k', label: '< 20,000 km', midKm: 12000 },
  { id: '20k_40k', label: '20,000 - 40,000 km', midKm: 30000 },
  { id: '40k_70k', label: '40,000 - 70,000 km', midKm: 55000 },
  { id: '70k_100k', label: '70,000 - 1,00,000 km', midKm: 85000 },
  { id: 'above_100k', label: '1,00,000+ km', midKm: 120000 },
] as const

export const JAMMU_AREAS = [
  'Jammu City',
  'Gandhi Nagar',
  'Channi Himmat',
  'Talab Tillo',
  'Janipur / Bantalab',
  'Bahu Plaza / Trikuta Nagar',
  'Bari Brahmana / Gangyal',
  'Akhnoor',
  'Samba',
  'Kathua',
  'Udhampur',
  'Katra / Reasi',
  'R.S. Pura',
  'Nagrota',
  'Rajouri / Poonch',
  'Other (Jammu & Kashmir)',
]

/**
 * Intelligent fair valuation estimation range in Lakhs (₹)
 * Based on Indian market depreciation standards (12%/yr) and odometer wear.
 */
export function calculateEstimatedValuation(params: {
  brand: string
  model: string
  year: number
  fuelType?: string
  transmission?: string
  kmRangeId?: string
  exactKm?: number
}): { minPriceLakhs: number; maxPriceLakhs: number; minPriceFormatted: string; maxPriceFormatted: string } {
  const currentYear = new Date().getFullYear()
  const age = Math.max(0, currentYear - params.year)

  // Find base price
  const brandData = CAR_BRANDS_DATA.find((b) => b.brand.toLowerCase() === params.brand.toLowerCase())
  const modelData = brandData?.models.find((m) => m.name.toLowerCase() === params.model.toLowerCase())
  const baseNew = modelData?.baseNewPriceLakhs ?? 7.5

  // Depreciation Curve:
  // Year 0: ~90%
  // Year 1: ~82%
  // Year 2: ~74%
  // Year 3: ~66%
  // Year 4: ~58%
  // Year 5: ~50%
  // Year 6+: drops by ~6-7% per year, min floor 15%
  let remainingFactor = 0.90
  if (age === 1) remainingFactor = 0.82
  else if (age === 2) remainingFactor = 0.74
  else if (age === 3) remainingFactor = 0.66
  else if (age === 4) remainingFactor = 0.58
  else if (age === 5) remainingFactor = 0.50
  else if (age > 5) remainingFactor = Math.max(0.15, 0.50 - (age - 5) * 0.06)

  // Mileage penalty/bonus
  const kmItem = KM_RANGES.find((k) => k.id === params.kmRangeId)
  const km = params.exactKm ?? (kmItem?.midKm ?? 45000)
  const expectedKm = Math.max(10000, age * 12000)
  const kmDiffRatio = (km - expectedKm) / 100000
  const kmFactor = Math.max(0.80, Math.min(1.10, 1 - (kmDiffRatio * 0.15)))

  // Fuel type factor
  let fuelFactor = 1.0
  if (params.fuelType === 'diesel') fuelFactor = 1.04
  if (params.fuelType === 'cng') fuelFactor = 0.97
  if (params.fuelType === 'electric') fuelFactor = 0.95

  // Transmission factor
  let transFactor = 1.0
  if (params.transmission === 'automatic') transFactor = 1.05

  const estimatedCenter = baseNew * remainingFactor * kmFactor * fuelFactor * transFactor
  const spread = Math.max(0.25, estimatedCenter * 0.07) // ~7% variance range
  
  const minPriceLakhs = Math.max(0.60, Number((estimatedCenter - spread).toFixed(2)))
  const maxPriceLakhs = Math.max(minPriceLakhs + 0.25, Number((estimatedCenter + spread).toFixed(2)))

  const formatLakhs = (val: number) => {
    if (val >= 100) return `₹${(val / 100).toFixed(2)} Cr`
    return `₹${val.toFixed(2)} Lakh`
  }

  return {
    minPriceLakhs,
    maxPriceLakhs,
    minPriceFormatted: formatLakhs(minPriceLakhs),
    maxPriceFormatted: formatLakhs(maxPriceLakhs),
  }
}
