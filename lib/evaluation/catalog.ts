/**
 * The car catalogue behind /sell-used-car (client-safe).
 *
 * Models are the names owners use for their car, newest and most common first, including models that are no
 * longer sold but still change hands in Jammu (Santro, Indica, Beat…). Every list ends in "Other model" on
 * the form, so a missing name never blocks a lead — it is typed instead.
 */

export type CarBrand = { name: string; models: readonly string[] }

/** The brands shown as tiles first — the ones Jammu owners mostly bring. Hyundai leads: it is AM Group's oldest franchise here. */
export const PRIMARY_BRANDS: readonly CarBrand[] = [
  {
    name: 'Hyundai',
    models: [
      'Creta', 'i20', 'Grand i10 Nios', 'Venue', 'Verna', 'Grand i10', 'Exter', 'Aura', 'Alcazar', 'Xcent', 'i10',
      'Santro', 'Eon', 'Elite i20', 'i20 Active', 'Tucson', 'Elantra', 'Creta Electric', 'Kona Electric', 'Ioniq 5',
      'Accent', 'Getz', 'Santa Fe', 'Sonata',
    ],
  },
  {
    name: 'Maruti Suzuki',
    models: [
      'Swift', 'Dzire', 'Wagon R', 'Baleno', 'Brezza', 'Ertiga', 'Alto K10', 'Alto 800', 'Alto', 'Celerio', 'Fronx',
      'Grand Vitara', 'XL6', 'S-Presso', 'Ignis', 'Ciaz', 'S-Cross', 'Eeco', 'Jimny', 'Invicto', 'Ritz', 'Estilo',
      'A-Star', 'SX4', 'Omni', 'Gypsy', 'Zen', 'Esteem', '800',
    ],
  },
  {
    name: 'Tata',
    models: [
      'Nexon', 'Punch', 'Tiago', 'Altroz', 'Harrier', 'Safari', 'Tigor', 'Curvv', 'Nexon EV', 'Punch EV', 'Tiago EV',
      'Tigor EV', 'Curvv EV', 'Harrier EV', 'Sierra', 'Hexa', 'Zest', 'Bolt', 'Indica', 'Indigo', 'Nano', 'Sumo', 'Aria',
    ],
  },
  {
    name: 'Mahindra',
    models: [
      'Scorpio-N', 'Scorpio', 'Scorpio Classic', 'Thar', 'Thar Roxx', 'Bolero', 'Bolero Neo', 'XUV700', 'XUV 3XO',
      'XUV300', 'XUV500', 'XUV400', 'BE 6', 'XEV 9e', 'TUV300', 'KUV100', 'Marazzo', 'Xylo', 'Alturas G4', 'Quanto',
      'Verito', 'Logan',
    ],
  },
  { name: 'Kia', models: ['Seltos', 'Sonet', 'Carens', 'Carens Clavis', 'Syros', 'Carnival', 'EV6', 'EV9'] },
  {
    name: 'Toyota',
    models: [
      'Innova Crysta', 'Innova', 'Innova Hycross', 'Fortuner', 'Glanza', 'Urban Cruiser Hyryder', 'Urban Cruiser Taisor',
      'Rumion', 'Etios', 'Etios Liva', 'Etios Cross', 'Urban Cruiser', 'Corolla Altis', 'Camry', 'Yaris', 'Hilux',
      'Qualis', 'Land Cruiser', 'Vellfire',
    ],
  },
  {
    name: 'Honda',
    models: ['City', 'Amaze', 'Elevate', 'Jazz', 'WR-V', 'Brio', 'Civic', 'BR-V', 'Mobilio', 'CR-V', 'Accord'],
  },
  { name: 'MG', models: ['Hector', 'Hector Plus', 'Astor', 'Windsor EV', 'ZS EV', 'Comet EV', 'Gloster'] },
]

/** Behind "Other brand". Anything not here is typed. */
export const MORE_BRANDS: readonly CarBrand[] = [
  { name: 'Volkswagen', models: ['Polo', 'Vento', 'Virtus', 'Taigun', 'Ameo', 'Tiguan', 'Jetta', 'Passat'] },
  { name: 'Skoda', models: ['Rapid', 'Slavia', 'Kushaq', 'Kylaq', 'Octavia', 'Superb', 'Kodiaq', 'Laura', 'Fabia', 'Yeti'] },
  { name: 'Renault', models: ['Kwid', 'Triber', 'Kiger', 'Duster', 'Lodgy', 'Scala', 'Pulse', 'Captur'] },
  { name: 'Nissan', models: ['Magnite', 'Micra', 'Sunny', 'Kicks', 'Terrano', 'X-Trail'] },
  { name: 'Ford', models: ['EcoSport', 'Figo', 'Aspire', 'Freestyle', 'Endeavour', 'Fiesta', 'Ikon'] },
  { name: 'Chevrolet', models: ['Beat', 'Spark', 'Sail', 'Cruze', 'Enjoy', 'Tavera', 'Aveo', 'Optra', 'Captiva', 'Trailblazer'] },
  { name: 'Jeep', models: ['Compass', 'Meridian', 'Wrangler'] },
  { name: 'Citroën', models: ['C3', 'C3 Aircross', 'Basalt', 'eC3', 'C5 Aircross'] },
  { name: 'Datsun', models: ['redi-GO', 'GO', 'GO+'] },
  { name: 'Fiat', models: ['Punto', 'Linea'] },
  { name: 'Mercedes-Benz', models: ['C-Class', 'E-Class', 'A-Class Limousine', 'GLA', 'GLC', 'GLE', 'S-Class'] },
  { name: 'BMW', models: ['3 Series', '5 Series', 'X1', 'X3', 'X5', '7 Series'] },
  { name: 'Audi', models: ['A4', 'A6', 'Q3', 'Q5', 'Q7'] },
]

export const ALL_BRANDS: readonly CarBrand[] = [...PRIMARY_BRANDS, ...MORE_BRANDS]

export function modelsForBrand(brand: string): readonly string[] {
  return ALL_BRANDS.find((b) => b.name === brand)?.models ?? []
}

/** Years shown as chips; anything older is picked from a list. */
export const RECENT_YEAR_COUNT = 15
export const OLDEST_YEAR = 1995

/** The furthest ahead an evaluation can be asked for. */
export const EVALUATION_WINDOW_DAYS = 60
export const MAX_KILOMETRES = 999_999

const INDIA_TIME_ZONE = 'Asia/Kolkata'

/** Today's date in India as YYYY-MM-DD, whatever the device's own time zone. */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: INDIA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Calendar arithmetic on a YYYY-MM-DD string (UTC noon, so no DST or zone edge can shift the day). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function currentIndiaYear(now: Date = new Date()): number {
  return Number(indiaToday(now).slice(0, 4))
}

/** "Sat, 20 Sep" / "Saturday, 20 September" for a YYYY-MM-DD string. */
export function formatDay(ymd: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${ymd}T12:00:00Z`)
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    weekday: style,
    day: 'numeric',
    month: style,
  }).format(d)
}

/** 45000 → "45,000"; 125000 → "1,25,000" (Indian grouping, the way odometers are read out here). */
export function formatKm(km: number): string {
  return new Intl.NumberFormat('en-IN').format(km)
}

/** Accepts +91 / 0 prefixes and spaces; returns the 10-digit mobile or null. */
export function normaliseMobile(value: string): string | null {
  let digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}
