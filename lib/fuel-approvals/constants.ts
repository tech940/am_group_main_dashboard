import { FuelLocation, FuelRequiredFor, FuelType, FuelApprovalStatus } from './types'

export const FUEL_LOCATIONS: { value: FuelLocation; label: string }[] = [
  { value: 'KIA JAMMU', label: 'KIA JAMMU' },
  { value: 'KIA UDHAMPUR', label: 'KIA UDHAMPUR' },
  { value: 'KIA BANIHAL', label: 'KIA BANIHAL' },
]

export const FUEL_REQUIRED_FOR_OPTIONS: { value: FuelRequiredFor; label: string }[] = [
  { value: 'DEMO', label: 'DEMO' },
  { value: 'GENSET', label: 'GENSET' },
  { value: 'NEW DELIVERY', label: 'NEW DELIVERY' },
  { value: 'STOCK YARD', label: 'STOCK YARD' },
  { value: 'STOCK TRANSFER', label: 'STOCK TRANSFER' },
  { value: 'DISPLAY VEH', label: 'DISPLAY VEH' },
  { value: 'PAINT BOOTH -KIA -GANYAL', label: 'PAINT BOOTH -KIA -GANYAL' },
  { value: 'CPO', label: 'CPO' },
  { value: 'OTHER', label: 'OTHER' },
]

export const PRECONFIGURED_VEHICLES = [
  'Seltos GTX Plus DCT 1.5T Petrol-RED-PETROL-JK02DP0880',
  'Seltos HTX 1.5 Petrol-BLUE-PETROL-JK02CJ0880',
  'Seltos GTX Plus AT 1.5 Diesel-GREEN-DIESEL-JK02CD0880',
  'Sonet G1.2 5MT Gravity-WHITE-PETROL-JK02DN0880',
  'Sonet G1.2 5MT Gravity-GREEN-PETROL-JK02CP0880',
  'SONET G1.5 MT Gravity-WHITE-DIESEL-JK02CR0880',
  'Carens G1.5 6MT Gravity-WHITE-PETROL-JK02CL0880',
  'CARENS G1.5 DCT LUXARY PLUS 7-WHITE-PETROL-JK02DP1010',
  'Carens D1.5 6AT PRESTIGE Plus 7-BLACK-DIESEL-JK02CC0880',
  'Syros G1.0T 7DCT HTX Plus(O)-BLUE-PETROL-JK02DP0770',
  'Syros D1.5 6MT HTK(O)-WHITE-PETROL-JK02CH0880',
  'Syros G1.0T 6MT HTX-BLUE-DIESEL-JK02CN0880',
  'Kia Carnival D2.2 8AT Limousine Plus-BLACK-DIESEL-JK02DP0008',
  'Carens ClavisD1.5 6AT HTKPlus7-BLUE-DIESEL-JK02CQ6060',
  'Carens Clavis G1.5 6MT HTK7-WHITE-PETROL-JK02DQ0770',
  'Carens Clavis G1.5TDCTHTXPlus6-SILVER-PETROL-JK02DQ8080',
  'DISPLAY SYROS-GREEN-DIESEL-15135',
  'DISPLAY BLACK SONET -BLACK-PETROL-617474',
  'DISPLAY MORNING HAZE SELTOS-HAZE-PETROL-15610',
  'DISPLAY WHITE CARENS-WHITE-PETROL-306897',
  'DISPLAY SILVER CLAVIS-SILVER-PETROL-246446',
  'DISPLAY  GREY CLAVIS-GREY-DIESEL-251548',
  'DEMO IVORY SILVER SELTOS -DEMO IVORY-DIESEL-JK02DU0770',
  'DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070',
  'DEMO BLACK SELTOS GTX -BLACK-PETROL-JK02DU0880',
  'Genset',
  'Stockyard',
  'SYROS-021128',
  'SELTOS- 015610',
  'DISPLAY VEHICLE',
  'CPO',
  'JK14L0880 -Demo Seltos',
  'CARENS CLAVIS - JK14J0880',
  'DEMO TATA MOBILE  JK02DD -1208',
  'DEMO NEW SYROS SILVER - JK02C0059TC',
] as const

export const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'PETROL', label: 'PETROL' },
  { value: 'DIESEL', label: 'DIESEL' },
]

export function detectFuelType(vehicleText: string): FuelType | '' {
  if (!vehicleText) return ''
  const upper = vehicleText.toUpperCase()
  if (upper.includes('DIESEL')) return 'DIESEL'
  if (upper.includes('PETROL')) return 'PETROL'
  return ''
}

export const STATUS_LABELS: Record<FuelApprovalStatus, string> = {
  ed_pending: 'Awaiting ED Approval',
  ed_on_hold: 'Held by ED',
  hr_pending: 'Awaiting HR Approval',
  hr_on_hold: 'Held by HR',
  md_pending: 'Awaiting MD Approval',
  md_on_hold: 'Held by MD',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_back: 'Sent Back',
}

export const STAGE_STEPS = [
  { key: 'submission', label: 'Submission' },
  { key: 'ed', label: 'ED Approval' },
  { key: 'hr', label: 'HR Approval' },
  { key: 'md', label: 'MD Approval' },
] as const
