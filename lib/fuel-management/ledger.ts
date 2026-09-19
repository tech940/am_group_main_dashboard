/**
 * Fuel Management — the ledger. PURE: no database, no clock, no 'server-only'.
 *
 * It joins what the rest of the app records separately into ONE story per fuel request:
 *
 *   request → approval → pump meter (gate pass) → bill → drives since the last fill → GPS → mileage → cost
 *
 * ./ledger-reads.ts fetches the rows and calls buildLedger once per period (the result is cached); every screen
 * then asks summariseLedger / listLedgerEvents / ledgerTransaction / ledgerVehicle for a filtered view of it.
 *
 * Rules it keeps (owner decisions, 2026-09-11 and 2026-09-16):
 *  - Requested, approved and actual are three facts. A missing one stays missing — never borrowed from another.
 *  - Mileage and cost per km come from ./engine.ts only: full tank to full tank, labelled when provisional.
 *  - A plate is not an identity. A record is tied to a car by its resolved VIN, by the demo-fill matcher in
 *    ./metrics.ts (evidence naming exactly one car), or by the gate pass the requester picked.
 *  - An exception is a prompt to look, worded as a measurement. Nothing here says fraud.
 *  - Nothing is estimated silently: a figure the data cannot support is null, and the reason is stated.
 */

import { BRANCH_OPTIONS } from '../branches'
import {
  FUEL_LIFECYCLE_LABELS,
  STATUS_LABELS,
  getFuelFinalization,
  getFuelLifecycleState,
  isNonVehiclePurpose,
} from '../fuel-approvals/constants'
import {
  DEFAULT_FUEL_SETTINGS,
  assessEfficiency,
  attentionReasons,
  buildSegments,
  compareFills,
  decomposeCostChange,
  describeFleetPeriod,
  detectExceptions,
  expectedQuantity,
  fleetEfficiency,
  formatNumber,
  resolveBenchmark,
  summariseVehicleMileage,
  unitPrice,
  type EnergyType,
  type EnergyUnit,
  type EngineFill,
  type FuelBenchmark,
  type FuelException,
  type FuelIntelligenceSettings,
  type MileageSegment,
} from './engine'
import {
  GATE_ODOMETER_TOLERANCE_KM,
  demoCarLabel,
  driveOdometerKm,
  fuelVehicleLabel,
  indexDemoFleet,
  matchDemoFill,
  normalisePurpose,
  parseOdometerKm,
  titleCase,
  unmatchedDemoFillMessage,
  vinKey,
} from './metrics'
import type {
  FuelActivityItem,
  FuelAttentionItem,
  FuelBreakdownRow,
  FuelEnergy,
  FuelEventRow,
  FuelExceptionReview,
  FuelExceptionRow,
  FuelExceptionSeverity,
  FuelFilterOptions,
  FuelFilters,
  FuelFleetFigure,
  FuelHeadline,
  FuelIdentity,
  FuelLifecycle,
  FuelManagementResponse,
  FuelMileage,
  FuelOption,
  FuelPassDetail,
  FuelQualityKey,
  FuelQualityRow,
  FuelTraceStep,
  FuelTransactionDetail,
  FuelTransactionsResponse,
  FuelTrendPoint,
  FuelUnit,
  FuelVehicleProfile,
  FuelVehicleRow,
} from './types'

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────

export type LedgerWindow = {
  /** The period asked for, India calendar days, both ends included. */
  from: string
  to: string
  /** The period of the same length immediately before it. */
  prevFrom: string
  prevTo: string
  /** How far back rows are read, so mileage and baselines see enough history. */
  readFrom: string
  /** Today, India calendar day. */
  today: string
}

export type LedgerTrailEntry = { action: string; actorName: string; actorRole: string | null; at: string }

export type LedgerRowInput = {
  id: string
  requestNumber: string
  brand: string
  location: string
  purpose: string
  vehRegNo: string
  vinNo: string
  vehicleVin: string | null
  assetCode: string | null
  fuelType: string | null
  energyType: string | null
  quantityUnit: string | null
  requested: number | null
  approved: number | null
  actual: number | null
  totalCost: number | null
  odometerKm: number | null
  kmReadingText: string | null
  isFullTank: boolean | null
  odometerOverride: boolean
  stationName: string | null
  department: string | null
  gatePassId: string | null
  date: string
  createdAt: string
  status: string
  requesterName: string
  approverName: string | null
  approvedAt: string | null
  /** Action, actor name and role, time — never an email address or a note. */
  trail: LedgerTrailEntry[]
}

export type LedgerTripInput = {
  status: string
  gpsKm: number | null
  deltaKm: number | null
  movingSeconds: number | null
  stoppedSeconds: number | null
  stops: number | null
  alerts: number | null
  /** isTripDiscrepancy() from lib/loconav/trips.ts, decided by the reads (that file is server-only). */
  discrepancy: boolean
}

export type LedgerPassInput = {
  id: string
  passNo: string
  vin: string
  registrationNumber: string | null
  model: string | null
  dealerCode: string
  branchKey: string
  branchLabel: string
  purpose: string
  isFuelFilling: boolean
  status: string
  driverKind: string
  /** Set by the reads for STAFF drivers only. A customer is never named. */
  staffDriverName: string | null
  raisedByName: string
  gateOutAt: string | null
  gateOutYmd: string | null
  gateInAt: string | null
  gateInYmd: string | null
  gateOutOdo: number | null
  gateInOdo: number | null
  fuelLitres: number | null
  fuelAmount: number | null
  trip: LedgerTripInput | null
}

export type LedgerFleetCar = {
  vin: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  branchLabel: string
  sharedPlate: boolean
}

export type LedgerReviewInput = FuelExceptionReview & { key: string }

export type LedgerInput = {
  window: LedgerWindow
  rows: LedgerRowInput[]
  passes: LedgerPassInput[]
  fleet: LedgerFleetCar[]
  benchmarks: FuelBenchmark[]
  settings: FuelIntelligenceSettings
  settingsConfigured: boolean
  reviews: LedgerReviewInput[]
  sync: { loconavLastRunAt: string | null; loconavStatus: string | null }
  generatedAt: string
}

// ── The cached ledger ───────────────────────────────────────────────────────────────────────────────

export type LedgerVehicle = Omit<
  FuelVehicleRow,
  'events' | 'approvedQty' | 'actualQty' | 'spend' | 'avgFill' | 'previousQty' | 'gateKm' | 'gpsKm' | 'drives' | 'openExceptions'
> & { energy: FuelEnergy }

export type Ledger = {
  window: LedgerWindow
  events: FuelEventRow[]
  exceptions: FuelExceptionRow[]
  vehicles: Record<string, LedgerVehicle>
  segments: MileageSegment[]
  passes: LedgerPassInput[]
  trails: Record<string, LedgerTrailEntry[]>
  settings: FuelIntelligenceSettings
  settingsConfigured: boolean
  benchmarksConfigured: number
  sync: LedgerInput['sync']
  generatedAt: string
}

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

/**
 * The day requested/approved/actual, the gate-pass link and the close-out fields went live (migration 0071).
 * A record older than this could not have carried them, so it is not counted as a data gap for lacking them.
 */
export const ACCOUNTABILITY_SINCE = '2026-09-16'

/**
 * A pump reading a guard types at the gate is checked for being physically possible before it is believed.
 * These are plausibility limits for a passenger car — not prices, not tank sizes of any particular model.
 */
export const PUMP_MAX_PLAUSIBLE_LITRES = 120
export const PUMP_PLAUSIBLE_RUPEES_PER_LITRE = { min: 40, max: 250 } as const
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const round2 = (value: number) => Math.round(value * 100) / 100
const sumOf = (values: readonly (number | null | undefined)[]) =>
  round2(values.reduce<number>((total, v) => total + (isNum(v) ? v : 0), 0))

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

/** A UTC-midnight instant (built by ymdToUtc) back to its calendar day. Never used on a real timestamp. */
function utcToYmd(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(ymd: string, days: number): string {
  return utcToYmd(ymdToUtc(ymd) + days * DAY_MS)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((ymdToUtc(to) - ymdToUtc(from)) / DAY_MS)
}

/** The window for a period: the previous period of the same length, and about 13 months of history. */
export function ledgerWindow(from: string, to: string, today: string): LedgerWindow {
  const length = daysBetween(from, to) + 1
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(from, -length)
  const history = addDays(to, -400)
  return { from, to, prevFrom, prevTo, readFrom: prevFrom < history ? prevFrom : history, today }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

/** 'KIA JAMMU' → 'JAMMU'. The brand word leads every stored location; the place is the branch. */
export function branchKeyOfLocation(location: string, brand: string): string {
  const text = String(location ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  const brandWord = String(brand ?? '').trim().toUpperCase()
  const stripped = brandWord && text.startsWith(`${brandWord} `) ? text.slice(brandWord.length + 1) : text.replace(/^KIA\s+/, '')
  return stripped || 'NOT RECORDED'
}

export function branchLabelOfKey(key: string): string {
  return key === 'NOT RECORDED' ? 'Branch not recorded' : titleCase(key)
}

export function brandLabelOf(brand: string): string {
  const key = String(brand ?? '').trim().toLowerCase()
  return BRANCH_OPTIONS.find((option) => option.value === key)?.label ?? (key ? titleCase(key) : 'Brand not recorded')
}

const ENERGY_LABELS: Record<FuelEnergy, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  cng: 'CNG',
  ev: 'Electric',
  hybrid: 'Hybrid',
  other: 'Other',
}

export function energyLabel(energy: FuelEnergy, unit?: FuelUnit): string {
  return unit ? `${ENERGY_LABELS[energy]} (${unit})` : ENERGY_LABELS[energy]
}

function energyOf(row: Pick<LedgerRowInput, 'energyType' | 'fuelType'>): FuelEnergy {
  const text = String(row.energyType || row.fuelType || '').trim().toLowerCase()
  if (text === 'petrol' || text === 'diesel' || text === 'cng' || text === 'ev' || text === 'hybrid') return text
  if (text === 'electric') return 'ev'
  return 'other'
}

function unitOf(row: Pick<LedgerRowInput, 'quantityUnit'>, energy: FuelEnergy): FuelUnit {
  const stored = String(row.quantityUnit ?? '').trim()
  if (stored === 'kg' || stored === 'kWh' || stored === 'L') return stored
  return energy === 'ev' ? 'kWh' : energy === 'cng' ? 'kg' : 'L'
}

const QUALITY_TEXT: Record<FuelQualityKey, { label: string; description: string }> = {
  vehicle_unidentified: {
    label: 'Demo car not identified',
    description: 'A demo fill whose vehicle details do not name exactly one demo car. It gets no mileage and no car history.',
  },
  odometer_missing: {
    label: 'Odometer missing',
    description: 'A fill for an identified car with no odometer reading, so no distance can be measured across it.',
  },
  odometer_unreadable: {
    label: 'Odometer not a number',
    description: 'The odometer was typed as text that is not a number (for example "NA" or two readings).',
  },
  full_tank_missing: {
    label: 'Full tank not recorded',
    description: 'A closed order for a car with no full-tank answer. Mileage is only measured between full tanks.',
  },
  actual_missing: {
    label: 'Actual litres missing',
    description: 'A completed order with no actual quantity, so approved vs actual cannot be compared.',
  },
  cost_missing: {
    label: 'Bill amount missing',
    description: 'A completed order with no bill total, so its spend and cost per km are unknown.',
  },
  pass_missing: {
    label: 'No fuel-filling gate pass',
    description: 'An approved demo-car fill with no gate pass picked, so there is no pump-meter reading to check it against.',
  },
  gps_missing: {
    label: 'No GPS for the drive',
    description: 'A returned demo drive with no GPS distance — the car has no tracker linked, or LocoNav had no data.',
  },
}

// ── Exceptions: wording and severity ────────────────────────────────────────────────────────────────

const ENGINE_KIND: Record<FuelException['kind'], { severity: FuelExceptionSeverity; label: string; title: string }> = {
  odometer_decrease: { severity: 'critical', label: 'Odometer anomaly', title: 'Odometer went backwards' },
  above_tank_capacity: { severity: 'critical', label: 'Mismatch', title: 'More fuel than the tank holds' },
  mileage_drop: { severity: 'review', label: 'Low mileage', title: 'Mileage dropped' },
  refuel_frequency: { severity: 'review', label: 'Frequent refuelling', title: 'Refuelled more often than usual' },
  impossible_mileage: { severity: 'review', label: 'Unusual', title: 'Mileage too high to be real' },
  price_out_of_range: { severity: 'info', label: 'Unusual price', title: 'Price per unit out of range' },
  possible_duplicate: { severity: 'review', label: 'Possible duplicate', title: 'Possible duplicate entry' },
}

const SEVERITY_RANK: Record<FuelExceptionSeverity, number> = { critical: 0, review: 1, info: 2 }

const LIFECYCLE_ORDER: FuelLifecycle[] = ['in_review', 'on_hold', 'sent_back', 'to_finalise', 'completed', 'rejected']

// ── Build ───────────────────────────────────────────────────────────────────────────────────────────

type Draft = FuelEventRow & { raw: LedgerRowInput; engineQty: number | null }

export function buildLedger(input: LedgerInput): Ledger {
  const { window, settings } = input
  const fleetIndex = indexDemoFleet(input.fleet.map((car) => ({
    vin: car.vin,
    registrationNumber: car.registrationNumber,
    model: car.model,
    branchLabel: car.branchLabel,
    sharedPlate: car.sharedPlate,
  })))
  const fleetByVin = new Map(input.fleet.map((car) => [vinKey(car.vin), car]))
  const passById = new Map(input.passes.map((pass) => [pass.id, pass]))
  const reviews = new Map(input.reviews.map((review) => [review.key, review]))
  const trails: Record<string, LedgerTrailEntry[]> = {}

  // 1. One record per request.
  const drafts: Draft[] = input.rows.map((row) => {
    const energy = energyOf(row)
    const unit = unitOf(row, energy)
    const purposeKey = normalisePurpose(row.purpose) || 'NOT RECORDED'
    const branchKey = branchKeyOfLocation(row.location, row.brand)
    const pass = row.gatePassId ? passById.get(row.gatePassId) ?? null : null
    const lifecycle = getFuelLifecycleState({ status: row.status, history: row.trail.map((t) => ({ action: t.action, userName: t.actorName, timestamp: t.at })) })
    const finalisation = getFuelFinalization({ history: row.trail.map((t) => ({ action: t.action, userName: t.actorName, timestamp: t.at })) })

    // Identity, strongest evidence first.
    let vin: string | null = null
    let identity: FuelIdentity = 'label'
    let identityNote: string | null = null
    const resolved = vinKey(row.vehicleVin)
    const assetish = row.assetCode || isNonVehiclePurpose(row.purpose)
    if (resolved.length === 17) {
      vin = resolved
      identity = 'vin'
    } else if (pass?.vin && pass.vin.length === 17 && !assetish) {
      vin = pass.vin
      identity = 'vin'
    } else if (purposeKey === 'DEMO') {
      const match = matchDemoFill({ vehRegNo: row.vehRegNo, vinNo: row.vinNo }, fleetIndex)
      if (match.matched) {
        vin = match.vin
        identity = 'vin'
      } else {
        identityNote = unmatchedDemoFillMessage(match)
      }
    }
    if (!vin && assetish) identity = 'asset'

    const assetName = row.assetCode ? titleCase(row.assetCode) : titleCase(purposeKey)
    const vehicleKey = identity === 'vin'
      ? (vin as string)
      : identity === 'asset'
        ? `ASSET:${(row.assetCode || purposeKey).toUpperCase()}:${branchKey}`
        : `LABEL:${String(row.vehRegNo || row.vinNo || '').trim().replace(/\s+/g, ' ').toUpperCase() || row.id}`
    const car = vin ? fleetByVin.get(vin) : undefined
    const vehicleLabel = identity === 'vin'
      ? car
        ? demoCarLabel(car)
        : pass
          ? demoCarLabel({ vin: vin as string, registrationNumber: pass.registrationNumber, model: pass.model })
          : fuelVehicleLabel(row.vehRegNo, row.vinNo)
      : identity === 'asset'
        ? `${assetName} · ${branchLabelOfKey(branchKey)}`
        : fuelVehicleLabel(row.vehRegNo, row.vinNo)

    const odometerKm = isNum(row.odometerKm) ? row.odometerKm : parseOdometerKm(row.kmReadingText)
    const approvedish = row.status === 'approved'
    const engineQty = approvedish ? (row.actual ?? row.approved ?? row.requested) : null
    const priceBase = row.actual ?? row.approved
    const price = isNum(row.totalCost) && isNum(priceBase) ? unitPrice({ totalCost: row.totalCost, quantity: priceBase }) : null
    // No bill: estimate an approved petrol/diesel fill at the configured market price (owner, 2026-09-19).
    const marketPrice = energy === 'petrol' ? settings.marketPricePetrolPerLitre : energy === 'diesel' ? settings.marketPriceDieselPerLitre : 0
    const estimatedCost = !isNum(row.totalCost) && isNum(engineQty) && engineQty > 0 && unit === 'L' && marketPrice > 0
      ? round2(engineQty * marketPrice)
      : null

    trails[row.id] = row.trail
    const statusKey = String(row.status ?? '').trim().toLowerCase()

    return {
      raw: row,
      engineQty,
      id: row.id,
      requestNumber: row.requestNumber,
      date: row.date,
      createdAt: row.createdAt,
      approvedAt: row.approvedAt,
      closedAt: finalisation.finalized ? finalisation.at ?? null : null,
      branchKey,
      branchLabel: branchLabelOfKey(branchKey),
      brandKey: String(row.brand ?? '').trim().toLowerCase() || 'unknown',
      brandLabel: brandLabelOf(row.brand),
      purposeKey,
      purposeLabel: purposeKey === 'NOT RECORDED' ? 'Purpose not recorded' : titleCase(purposeKey),
      department: row.department,
      energy,
      unit,
      vehicleKey,
      vehicleLabel,
      vin,
      identity,
      isDemo: Boolean(vin && fleetByVin.has(vin)),
      identityNote,
      requested: row.requested,
      approved: row.approved,
      actual: row.actual,
      variance: isNum(row.actual) && isNum(row.approved) ? round2(row.actual - row.approved) : null,
      cost: row.totalCost,
      estimatedCost,
      unitPrice: price === null ? null : round2(price),
      odometerKm,
      fullTank: row.isFullTank,
      station: row.stationName,
      lifecycle,
      lifecycleLabel: FUEL_LIFECYCLE_LABELS[lifecycle],
      statusLabel: (STATUS_LABELS as Record<string, string>)[statusKey] ?? titleCase(statusKey.replace(/_/g, ' ')),
      requesterName: row.requesterName,
      approverName: row.approverName,
      closedByName: finalisation.finalized ? finalisation.byName ?? null : null,
      passId: pass?.id ?? null,
      passNo: pass?.passNo ?? null,
      pumpLitres: pass?.fuelLitres ?? null,
      exceptionKinds: [],
      openExceptions: 0,
      quality: [],
    }
  })

  // 2. The engine: segments and its own exceptions over approved fills of identified consumers.
  const fills: EngineFill[] = drafts
    .filter((d) => d.engineQty !== null && d.engineQty > 0 && d.identity !== 'label')
    .map((d) => ({
      id: d.id,
      vehicleKey: d.vehicleKey,
      date: d.date,
      sequence: Date.parse(d.createdAt) || 0,
      energyType: (d.energy === 'other' ? 'petrol' : d.energy) as EnergyType,
      unit: d.unit as EnergyUnit,
      quantity: d.engineQty as number,
      totalCost: d.cost,
      estimatedCost: d.estimatedCost,
      // A genset has no odometer; its fills never form a mileage segment.
      odometerKm: d.identity === 'vin' ? d.odometerKm : null,
      isFullTank: d.identity === 'vin' ? d.fullTank : null,
      odometerOverride: d.raw.odometerOverride,
    }))
  const segments = buildSegments(fills, settings)

  // 3. What each consumer is.
  const vehicles: Record<string, LedgerVehicle> = {}
  const latestByKey = new Map<string, Draft>()
  for (const d of [...drafts].sort((a, b) => compareFills({ date: a.date, sequence: Date.parse(a.createdAt) || 0 }, { date: b.date, sequence: Date.parse(b.createdAt) || 0 }))) {
    latestByKey.set(d.vehicleKey, d)
  }
  const passVins = new Set(input.passes.map((p) => p.vin).filter((v) => v.length === 17))

  const benchmarkFor = (key: string, unit: EnergyUnit): FuelBenchmark | null => {
    const latest = latestByKey.get(key)
    const car = fleetByVin.get(key)
    if (!latest || latest.identity !== 'vin') return null
    return resolveBenchmark(
      { vin: key, model: car?.model ?? null, variant: car?.variant ?? null, energyType: (latest.energy === 'other' ? 'petrol' : latest.energy) as EnergyType, unit },
      input.benchmarks,
    )
  }

  const engineExceptions = detectExceptions({ fills, segments, benchmarkFor, settings })

  // km since the last fill: the highest gate-in reading on or after that fill's day, minus the fill's reading.
  const kmSinceLastFill = new Map<string, number | null>()
  for (const d of [...drafts].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))) {
    if (d.identity !== 'vin' || d.raw.status !== 'approved' || !isNum(d.odometerKm) || d.date > window.to) continue
    const readings = input.passes
      .filter((p) => p.vin === d.vehicleKey && p.gateInYmd !== null && p.gateInYmd >= d.date && p.gateInYmd <= window.to && isNum(p.gateInOdo))
      .map((p) => p.gateInOdo as number)
    const highest = readings.length ? Math.max(...readings) : null
    kmSinceLastFill.set(d.vehicleKey, highest !== null && highest >= d.odometerKm ? round2(highest - d.odometerKm) : null)
  }

  const describeVehicle = (key: string, latest: Draft | null): LedgerVehicle => {
    const car = fleetByVin.get(key)
    const pass = input.passes.find((p) => p.vin === key)
    const identity: FuelIdentity = latest?.identity ?? 'vin'
    const unit: FuelUnit = latest?.unit ?? 'L'
    const energy: FuelEnergy = latest?.energy ?? 'other'
    const summary = summariseVehicleMileage(segments, key, unit, window.to, settings)
    const benchmark = identity === 'vin' ? benchmarkFor(key, unit) : null
    const assessment = assessEfficiency(summary.average, benchmark?.expectedEfficiency ?? null, settings)
    const before = fleetEfficiency(segments, unit, window.prevFrom, window.prevTo, new Set([key]))
    const now = fleetEfficiency(segments, unit, window.from, window.to, new Set([key]))
    const change = isNum(before.costPerKm) && isNum(now.costPerKm) && before.costPerKm > 0
      ? ((now.costPerKm - before.costPerKm) / before.costPerKm) * 100
      : null
    const mine = engineExceptions.filter((e) => e.vehicleKey === key && e.date >= window.from && e.date <= window.to)
    const mileage: FuelMileage = {
      current: summary.current,
      average: summary.average,
      best: summary.best,
      worst: summary.worst,
      basis: summary.basis,
      segmentsUsed: summary.segmentsUsed,
      declining: summary.declining,
      unavailableReason: identity === 'vin'
        ? summary.unavailableReason
        : identity === 'asset'
          ? 'Not a road vehicle — no mileage.'
          : 'Not tied to one vehicle, so no mileage.',
    }
    const allFills = drafts.filter((d) => d.vehicleKey === key && d.raw.status === 'approved' && d.date <= window.to)
    const lastFill = allFills.length ? allFills.map((d) => d.date).sort().at(-1) ?? null : null
    return {
      key,
      label: identity === 'vin'
        ? car ? demoCarLabel(car) : pass ? demoCarLabel({ vin: key, registrationNumber: pass.registrationNumber, model: pass.model }) : latest?.vehicleLabel ?? key
        : latest?.vehicleLabel ?? key,
      kind: identity,
      vin: identity === 'vin' ? key : null,
      registration: car?.registrationNumber ?? pass?.registrationNumber ?? null,
      model: car?.model ? titleCase(car.model) : pass?.model ? titleCase(pass.model) : null,
      variant: car?.variant ?? null,
      branchLabel: car?.branchLabel ?? pass?.branchLabel ?? latest?.branchLabel ?? 'Branch not recorded',
      isDemo: fleetByVin.has(key),
      unit,
      energy,
      energyLabel: energyLabel(energy, unit),
      mileage,
      expected: benchmark?.expectedEfficiency ?? null,
      tankCapacity: benchmark?.tankCapacity ?? null,
      efficiencyStatus: identity === 'vin' ? assessment.status : 'no_data',
      efficiencyPct: assessment.efficiencyPct === null ? null : Math.round(assessment.efficiencyPct),
      costPerKm: summary.costPerKm,
      lastFill,
      kmSinceLastFill: kmSinceLastFill.get(key) ?? null,
      attention: identity === 'vin'
        ? attentionReasons({ summary, assessment, exceptions: mine, costPerKmChangePct: change, settings })
        : [],
    }
  }

  for (const [key, latest] of latestByKey) vehicles[key] = describeVehicle(key, latest)
  for (const vin of passVins) if (!vehicles[vin]) vehicles[vin] = describeVehicle(vin, null)

  // 4. Exceptions.
  const byId = new Map(drafts.map((d) => [d.id, d]))
  const exceptions: FuelExceptionRow[] = []
  const push = (row: Omit<FuelExceptionRow, 'review'>) => {
    const review = reviews.get(row.key)
    exceptions.push({ ...row, review: review ? { outcome: review.outcome, note: review.note, reviewerName: review.reviewerName, at: review.at } : null })
  }
  const fromEvent = (d: Draft) => ({
    vehicleKey: d.vehicleKey,
    vehicleLabel: d.vehicleLabel,
    eventId: d.id,
    requestNumber: d.requestNumber,
    passNo: d.passNo,
    branchKey: d.branchKey,
    branchLabel: d.branchLabel,
  })

  for (const e of engineExceptions) {
    const d = byId.get(e.fillId)
    if (!d) continue
    const meta = ENGINE_KIND[e.kind]
    push({
      key: `${e.kind}:${e.fillId}`,
      kind: e.kind,
      severity: meta.severity,
      label: meta.label,
      title: meta.title,
      message: e.message,
      date: e.date,
      ...fromEvent(d),
      measured: e.value === null ? null : round2(e.value),
      expected: e.expected === null ? null : round2(e.expected),
      variance: e.variance === null ? null : round2(e.variance),
      unit: e.kind === 'mileage_drop' || e.kind === 'impossible_mileage' ? `km/${d.unit}` : e.kind === 'price_out_of_range' ? `₹/${d.unit}` : e.kind === 'odometer_decrease' ? 'km' : d.unit,
    })
  }

  // The engine only sees identified consumers. Duplicates among typed labels still matter.
  const seenLabel = new Map<string, Draft>()
  for (const d of [...drafts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (d.identity !== 'label' || d.raw.status === 'rejected' || !isNum(d.requested)) continue
    const key = `${d.vehicleKey}|${d.date}|${d.requested.toFixed(2)}`
    const first = seenLabel.get(key)
    if (!first) {
      seenLabel.set(key, d)
      continue
    }
    push({
      key: `possible_duplicate:${d.id}`,
      kind: 'possible_duplicate',
      severity: 'review',
      label: 'Possible duplicate',
      title: 'Possible duplicate entry',
      message: `Same vehicle text, date and quantity (${formatNumber(d.requested, 2)} ${d.unit}) as ${first.requestNumber}.`,
      date: d.date,
      ...fromEvent(d),
      measured: d.requested,
      expected: null,
      variance: null,
      unit: d.unit,
    })
  }

  const tol = settings.actualVariancePct
  for (const d of drafts) {
    if (d.raw.status !== 'approved') continue
    // Approved vs actual.
    if (isNum(d.actual) && isNum(d.approved) && d.approved > 0) {
      const diff = d.actual - d.approved
      const pct = (diff / d.approved) * 100
      if (diff >= settings.actualVarianceMinQty && pct >= tol) {
        push({
          key: `actual_over_approved:${d.id}`,
          kind: 'actual_over_approved',
          severity: pct >= tol * 4 ? 'critical' : 'review',
          label: 'Mismatch',
          title: 'More fuel than approved',
          message: `${formatNumber(d.actual, 2)} ${d.unit} filled against ${formatNumber(d.approved, 2)} ${d.unit} approved — ${formatNumber(diff, 2)} ${d.unit} (${Math.round(pct)}%) more.`,
          date: d.date,
          ...fromEvent(d),
          measured: d.actual,
          expected: d.approved,
          variance: round2(diff),
          unit: d.unit,
        })
      } else if (-diff >= settings.actualVarianceMinQty && -pct >= tol) {
        push({
          key: `actual_under_approved:${d.id}`,
          kind: 'actual_under_approved',
          severity: 'info',
          label: 'Mismatch',
          title: 'Less fuel than approved',
          message: `${formatNumber(d.actual, 2)} ${d.unit} filled against ${formatNumber(d.approved, 2)} ${d.unit} approved.`,
          date: d.date,
          ...fromEvent(d),
          measured: d.actual,
          expected: d.approved,
          variance: round2(diff),
          unit: d.unit,
        })
      }
    }
    // Pump meter vs the bill.
    if (isNum(d.pumpLitres) && isNum(d.actual) && d.pumpLitres > 0) {
      const diff = d.actual - d.pumpLitres
      if (Math.abs(diff) >= settings.actualVarianceMinQty && (Math.abs(diff) / d.pumpLitres) * 100 >= tol) {
        push({
          key: `pump_bill_mismatch:${d.id}`,
          kind: 'pump_bill_mismatch',
          severity: 'review',
          label: 'Mismatch',
          title: 'Bill and pump meter disagree',
          message: `The bill records ${formatNumber(d.actual, 2)} L; the pump meter on ${d.passNo} shows ${formatNumber(d.pumpLitres, 2)} L.`,
          date: d.date,
          ...fromEvent(d),
          measured: d.actual,
          expected: d.pumpLitres,
          variance: round2(diff),
          unit: 'L',
        })
      }
    }
    // Waiting too long for its bill.
    if (d.lifecycle === 'to_finalise' && d.approvedAt) {
      const approvedYmd = d.approvedAt.slice(0, 10)
      const waited = daysBetween(approvedYmd, window.today)
      if (waited > settings.closeOverdueDays) {
        push({
          key: `close_overdue:${d.id}`,
          kind: 'close_overdue',
          severity: 'info',
          label: 'Review required',
          title: 'Bill not recorded yet',
          message: `Approved ${waited} days ago; the bill and actual litres have not been recorded.`,
          date: d.date,
          ...fromEvent(d),
          measured: waited,
          expected: settings.closeOverdueDays,
          variance: waited - settings.closeOverdueDays,
          unit: 'days',
        })
      }
    }
  }

  // Fuel on a demo car with no drive since its previous fill.
  const approvedByVin = new Map<string, Draft[]>()
  for (const d of drafts) {
    if (d.identity !== 'vin' || !d.isDemo || d.raw.status !== 'approved') continue
    approvedByVin.set(d.vehicleKey, [...(approvedByVin.get(d.vehicleKey) ?? []), d])
  }
  for (const [vin, list] of approvedByVin) {
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1]
      const current = ordered[i]
      const drove = input.passes.some((p) =>
        p.vin === vin && !p.isFuelFilling && p.gateOutYmd !== null && p.gateOutYmd >= previous.date && p.gateOutYmd <= current.date,
      )
      if (!drove) {
        push({
          key: `fill_without_usage:${current.id}`,
          kind: 'fill_without_usage',
          severity: 'info',
          label: 'No usage recorded',
          title: 'Refuelled with no drive recorded',
          message: `No demo drive was recorded for this car between the fill on ${previous.date} and this one.`,
          date: current.date,
          ...fromEvent(current),
          measured: null,
          expected: null,
          variance: null,
          unit: null,
        })
      }
    }
  }

  // Gate passes: fuel with no request, and GPS that disagrees with the odometer.
  const linkedPassIds = new Set(drafts.map((d) => d.passId).filter(Boolean) as string[])
  for (const p of input.passes) {
    const vehicle = vehicles[p.vin]
    const label = vehicle?.label ?? demoCarLabel({ vin: p.vin, registrationNumber: p.registrationNumber, model: p.model })
    const perLitre = isNum(p.fuelAmount) && isNum(p.fuelLitres) && p.fuelLitres > 0 ? p.fuelAmount / p.fuelLitres : null
    const implausible = p.isFuelFilling && p.gateInYmd !== null && (
      (isNum(p.fuelLitres) && p.fuelLitres > PUMP_MAX_PLAUSIBLE_LITRES)
      || (perLitre !== null && (perLitre < PUMP_PLAUSIBLE_RUPEES_PER_LITRE.min || perLitre > PUMP_PLAUSIBLE_RUPEES_PER_LITRE.max))
    )
    if (implausible) {
      const swapped = isNum(p.fuelLitres) && isNum(p.fuelAmount) && p.fuelAmount < p.fuelLitres
      push({
        key: `implausible_pump_reading:${p.id}`,
        kind: 'implausible_pump_reading',
        severity: 'review',
        label: 'Unusual',
        title: 'Pump reading does not look possible',
        message: `${p.passNo} records ${isNum(p.fuelLitres) ? `${formatNumber(p.fuelLitres, 2)} L` : 'no litres'} for ${isNum(p.fuelAmount) ? `₹${formatNumber(p.fuelAmount)}` : 'no amount'}${swapped ? ' — the litres and the amount may have been typed the wrong way round' : ''}. Check the pump photos on the gate pass.`,
        date: p.gateInYmd as string,
        vehicleKey: p.vin,
        vehicleLabel: label,
        eventId: null,
        requestNumber: null,
        passNo: p.passNo,
        branchKey: p.branchKey,
        branchLabel: p.branchLabel,
        measured: p.fuelLitres,
        expected: null,
        variance: null,
        unit: 'L',
      })
    }
    if (p.isFuelFilling && p.status === 'returned' && p.gateInYmd && (isNum(p.fuelLitres) || isNum(p.fuelAmount)) && !linkedPassIds.has(p.id)) {
      const waited = daysBetween(p.gateInYmd, window.today)
      // A request for the same car within a day of the fill, not yet linked to any pass, is the likely partner.
      const candidate = drafts.find((d) =>
        d.vehicleKey === p.vin && !d.passId && d.raw.status !== 'rejected' && Math.abs(daysBetween(d.date, p.gateInYmd as string)) <= 1,
      )
      const reading = implausible
        ? 'a pump reading that needs checking'
        : isNum(p.fuelLitres) ? `${formatNumber(p.fuelLitres, 2)} L on the pump meter` : 'a pump bill'
      push({
        key: `pass_without_request:${p.id}`,
        kind: 'pass_without_request',
        severity: waited > 2 ? 'critical' : 'review',
        label: 'Fuel without request',
        title: 'Fuel filled with no fuel request linked',
        message: `${p.passNo} came back with ${reading}${!implausible && isNum(p.fuelAmount) ? ` (₹${formatNumber(p.fuelAmount)})` : ''}, and no fuel request names this pass.`
          + (candidate ? ` ${candidate.requestNumber} is for the same car on ${candidate.date} — link the pass when recording its bill.` : ''),
        date: p.gateInYmd,
        vehicleKey: p.vin,
        vehicleLabel: label,
        eventId: null,
        requestNumber: null,
        passNo: p.passNo,
        branchKey: p.branchKey,
        branchLabel: p.branchLabel,
        measured: p.fuelLitres,
        expected: null,
        variance: null,
        unit: 'L',
      })
    }
    if (p.trip?.discrepancy && p.gateInYmd) {
      const odo = driveOdometerKm({ gateOutOdo: p.gateOutOdo, gateInOdo: p.gateInOdo })
      push({
        key: `gps_distance_mismatch:${p.id}`,
        kind: 'gps_distance_mismatch',
        severity: 'review',
        label: 'Distance mismatch',
        title: 'GPS and odometer disagree',
        message: `${p.passNo}: GPS measured ${isNum(p.trip.gpsKm) ? formatNumber(p.trip.gpsKm, 1) : '—'} km, the gate odometer ${isNum(odo) ? formatNumber(odo, 1) : '—'} km.`,
        date: p.gateInYmd,
        vehicleKey: p.vin,
        vehicleLabel: label,
        eventId: null,
        requestNumber: null,
        passNo: p.passNo,
        branchKey: p.branchKey,
        branchLabel: p.branchLabel,
        measured: p.trip.gpsKm,
        expected: odo,
        variance: p.trip.deltaKm,
        unit: 'km',
      })
    }
  }

  // A gate-in reading from an EARLIER day above the odometer typed on a later fill (same rule as ./metrics.ts).
  for (const d of drafts) {
    if (d.identity !== 'vin' || d.raw.status === 'rejected' || !isNum(d.odometerKm)) continue
    const earlier = input.passes
      .filter((p) => p.vin === d.vehicleKey && p.gateInYmd !== null && p.gateInYmd < d.date && isNum(p.gateInOdo))
      .sort((a, b) => (b.gateInOdo as number) - (a.gateInOdo as number))[0]
    if (!earlier || (earlier.gateInOdo as number) <= d.odometerKm + GATE_ODOMETER_TOLERANCE_KM) continue
    const gap = (earlier.gateInOdo as number) - d.odometerKm
    push({
      key: `gate_odometer_mismatch:${d.id}`,
      kind: 'gate_odometer_mismatch',
      severity: 'review',
      label: 'Odometer anomaly',
      title: 'Fill odometer below an earlier gate reading',
      message: `The gate recorded ${formatNumber(earlier.gateInOdo as number)} km on ${earlier.gateInYmd} (${earlier.passNo}), but this fill records ${formatNumber(d.odometerKm)} km — ${formatNumber(gap)} km lower.`,
      date: d.date,
      ...fromEvent(d),
      measured: d.odometerKm,
      expected: earlier.gateInOdo,
      variance: round2(-gap),
      unit: 'km',
    })
  }

  exceptions.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.date.localeCompare(a.date))

  // 5. Stamp exceptions and data quality onto the records.
  const kindsById = new Map<string, FuelExceptionRow[]>()
  for (const e of exceptions) if (e.eventId) kindsById.set(e.eventId, [...(kindsById.get(e.eventId) ?? []), e])
  const events: FuelEventRow[] = drafts.map((d) => {
    const mine = kindsById.get(d.id) ?? []
    const quality: FuelQualityKey[] = []
    const live = d.raw.status !== 'rejected'
    if (live && d.purposeKey === 'DEMO' && d.identity === 'label') quality.push('vehicle_unidentified')
    if (live && d.identity === 'vin' && d.odometerKm === null) {
      quality.push(String(d.raw.kmReadingText ?? '').trim() ? 'odometer_unreadable' : 'odometer_missing')
    }
    const closedSinceLaunch = d.lifecycle === 'completed' && (d.closedAt ?? '') >= ACCOUNTABILITY_SINCE
    const raisedSinceLaunch = d.createdAt >= ACCOUNTABILITY_SINCE
    if (closedSinceLaunch && d.identity === 'vin' && d.fullTank === null) quality.push('full_tank_missing')
    if (closedSinceLaunch && d.actual === null) quality.push('actual_missing')
    if (d.lifecycle === 'completed' && d.cost === null) quality.push('cost_missing')
    if (raisedSinceLaunch && d.raw.status === 'approved' && d.isDemo && d.purposeKey === 'DEMO' && !d.passId) quality.push('pass_missing')
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { raw, engineQty, ...row } = d
    return {
      ...row,
      exceptionKinds: [...new Set(mine.map((e) => e.kind))],
      openExceptions: mine.filter((e) => !e.review).length,
      quality,
    }
  })

  return {
    window,
    events: events.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    exceptions,
    vehicles,
    segments,
    passes: input.passes,
    trails,
    settings,
    settingsConfigured: input.settingsConfigured,
    benchmarksConfigured: input.benchmarks.length,
    sync: input.sync,
    generatedAt: input.generatedAt,
  }
}

// ── Filtering ───────────────────────────────────────────────────────────────────────────────────────

const inRange = (ymd: string | null, from: string, to: string) => Boolean(ymd && ymd >= from && ymd <= to)

export function eventMatches(event: FuelEventRow, filters: FuelFilters, from = filters.from, to = filters.to): boolean {
  if (!inRange(event.date, from, to)) return false
  if (filters.branch && event.branchKey !== filters.branch) return false
  if (filters.brand && event.brandKey !== filters.brand) return false
  if (filters.purpose && event.purposeKey !== filters.purpose) return false
  if (filters.department && (event.department ?? 'NONE') !== filters.department) return false
  if (filters.energy && event.energy !== filters.energy) return false
  if (filters.fleet === 'demo' && !event.isDemo) return false
  if (filters.fleet === 'other' && event.isDemo) return false
  if (filters.vehicle && event.vehicleKey !== filters.vehicle) return false
  return true
}

/** Gate passes belong to demo cars. A filter that can only describe other fuel leaves none. */
export function passMatches(ledger: Ledger, pass: LedgerPassInput, filters: FuelFilters, from = filters.from, to = filters.to): boolean {
  if (!inRange(pass.gateOutYmd, from, to)) return false
  if (filters.fleet === 'other') return false
  if (filters.purpose && filters.purpose !== 'DEMO') return false
  if (filters.department) return false
  if (filters.branch && pass.branchKey !== filters.branch) return false
  if (filters.vehicle && pass.vin !== filters.vehicle) return false
  if (filters.energy && ledger.vehicles[pass.vin]?.energy !== filters.energy) return false
  // Brand: every gate pass is AM Kia's today; a brand filter for anything else leaves none.
  if (filters.brand && filters.brand !== 'kia') return false
  return true
}

function exceptionMatches(ledger: Ledger, row: FuelExceptionRow, filters: FuelFilters, eventIds: ReadonlySet<string>): boolean {
  if (row.eventId) return eventIds.has(row.eventId)
  if (!inRange(row.date, filters.from, filters.to)) return false
  if (filters.fleet === 'other' || filters.department || (filters.purpose && filters.purpose !== 'DEMO')) return false
  if (filters.brand && filters.brand !== 'kia') return false
  if (filters.branch && row.branchKey !== filters.branch) return false
  if (filters.vehicle && row.vehicleKey !== filters.vehicle) return false
  if (filters.energy && row.vehicleKey && ledger.vehicles[row.vehicleKey]?.energy !== filters.energy) return false
  return true
}

// ── Aggregation ─────────────────────────────────────────────────────────────────────────────────────

const counts = (events: readonly FuelEventRow[], unit: FuelUnit = 'L') => {
  const live = events.filter((e) => e.lifecycle !== 'rejected')
  const approved = live.filter((e) => e.approved !== null && e.unit === unit)
  return {
    live,
    approvedEvents: live.filter((e) => e.approved !== null).length,
    approvedQty: sumOf(approved.map((e) => e.approved)),
    actualQty: sumOf(live.filter((e) => e.unit === unit).map((e) => e.actual)),
    spend: sumOf(live.map((e) => e.cost)),
    estimated: sumOf(live.filter((e) => e.cost === null).map((e) => e.estimatedCost)),
    estimatedEvents: live.filter((e) => e.cost === null && e.estimatedCost !== null).length,
  }
}

function breakdown(events: readonly FuelEventRow[], keyOf: (e: FuelEventRow) => [string, string], limit = 12): FuelBreakdownRow[] {
  const groups = new Map<string, { label: string; list: FuelEventRow[] }>()
  for (const e of events) {
    if (e.lifecycle === 'rejected') continue
    const [key, label] = keyOf(e)
    const group = groups.get(key)
    if (group) group.list.push(e)
    else groups.set(key, { label, list: [e] })
  }
  const total = sumOf(events.filter((e) => e.lifecycle !== 'rejected' && e.unit === 'L').map((e) => e.approved))
  return [...groups.entries()]
    .map(([key, { label, list }]) => {
      const c = counts(list)
      return {
        key,
        label,
        events: list.length,
        approvedQty: c.approvedQty,
        actualQty: c.actualQty,
        spend: c.spend,
        sharePct: total > 0 ? Math.round((c.approvedQty / total) * 1000) / 10 : 0,
      }
    })
    .sort((a, b) => b.approvedQty - a.approvedQty || b.events - a.events || a.label.localeCompare(b.label))
    .slice(0, limit)
}

function trend(events: readonly FuelEventRow[], from: string, to: string): { granularity: 'day' | 'week' | 'month'; points: FuelTrendPoint[] } {
  const days = daysBetween(from, to) + 1
  const granularity = days <= 45 ? 'day' : days <= 190 ? 'week' : 'month'
  const bucketOf = (ymd: string) => {
    if (granularity === 'day') return ymd
    if (granularity === 'month') return ymd.slice(0, 7)
    // Weeks start on the period's first day, so every bucket is a whole 7 days inside the period.
    const offset = Math.floor(daysBetween(from, ymd) / 7) * 7
    return addDays(from, offset)
  }
  const points = new Map<string, FuelTrendPoint>()
  let cursor = from
  while (cursor <= to) {
    const bucket = bucketOf(cursor)
    if (!points.has(bucket)) {
      points.set(bucket, {
        bucket,
        label: granularity === 'month' ? monthLabel(bucket) : dayLabel(bucket),
        approvedQty: 0,
        actualQty: 0,
        spend: 0,
        events: 0,
      })
    }
    cursor = granularity === 'month' ? `${addDays(`${cursor.slice(0, 7)}-28`, 4).slice(0, 7)}-01` : addDays(cursor, granularity === 'day' ? 1 : 7)
  }
  for (const e of events) {
    if (e.lifecycle === 'rejected') continue
    const point = points.get(bucketOf(e.date))
    if (!point) continue
    point.events += 1
    if (e.unit === 'L') {
      point.approvedQty = round2(point.approvedQty + (e.approved ?? 0))
      point.actualQty = round2(point.actualQty + (e.actual ?? 0))
    }
    point.spend = round2(point.spend + (e.cost ?? 0))
  }
  return { granularity, points: [...points.values()] }
}

function options(events: readonly FuelEventRow[], vehicles: Ledger['vehicles']): FuelFilterOptions {
  const tally = (keyOf: (e: FuelEventRow) => [string, string] | null): FuelOption[] => {
    const map = new Map<string, FuelOption>()
    for (const e of events) {
      const pair = keyOf(e)
      if (!pair) continue
      const found = map.get(pair[0])
      if (found) found.count += 1
      else map.set(pair[0], { value: pair[0], label: pair[1], count: 1 })
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }
  return {
    branches: tally((e) => [e.branchKey, e.branchLabel]),
    brands: tally((e) => [e.brandKey, e.brandLabel]),
    purposes: tally((e) => [e.purposeKey, e.purposeLabel]),
    departments: tally((e) => [e.department ?? 'NONE', e.department ?? 'Not recorded']),
    energies: tally((e) => [e.energy, energyLabel(e.energy)]),
    vehicles: tally((e) => (e.identity === 'label' ? null : [e.vehicleKey, vehicles[e.vehicleKey]?.label ?? e.vehicleLabel])).slice(0, 200),
  }
}

function vehicleRows(
  ledger: Ledger,
  events: readonly FuelEventRow[],
  previous: readonly FuelEventRow[],
  passes: readonly LedgerPassInput[],
  exceptions: readonly FuelExceptionRow[],
  filters: FuelFilters,
): { rows: FuelVehicleRow[]; spikes: FuelExceptionRow[] } {
  const keys = new Set<string>()
  for (const e of events) if (e.lifecycle !== 'rejected') keys.add(e.vehicleKey)
  for (const p of passes) keys.add(p.vin)
  const spikes: FuelExceptionRow[] = []
  const rows: FuelVehicleRow[] = []
  for (const key of keys) {
    const meta = ledger.vehicles[key]
    if (!meta) continue
    const mine = events.filter((e) => e.vehicleKey === key)
    const before = previous.filter((e) => e.vehicleKey === key)
    const c = counts(mine, meta.unit)
    const p = counts(before, meta.unit)
    const myPasses = passes.filter((pass) => pass.vin === key)
    const returned = myPasses.filter((pass) => pass.status === 'returned')
    const gateKm = sumOf(returned.map((pass) => driveOdometerKm({ gateOutOdo: pass.gateOutOdo, gateInOdo: pass.gateInOdo })))
    const gps = returned.filter((pass) => pass.trip?.status === 'reconciled' && isNum(pass.trip.gpsKm))
    const attention = [...meta.attention]
    const s = ledger.settings
    if (meta.kind === 'vin' && p.approvedQty > 0 && c.approvedQty >= s.consumptionSpikeMinQty) {
      const rise = ((c.approvedQty - p.approvedQty) / p.approvedQty) * 100
      if (rise >= s.consumptionSpikePct) {
        const text = `Used ${formatNumber(c.approvedQty, 1)} ${meta.unit} against ${formatNumber(p.approvedQty, 1)} ${meta.unit} in the previous period (+${Math.round(rise)}%).`
        attention.push(text)
        spikes.push({
          key: `consumption_spike:${key}:${filters.from}:${filters.to}`,
          kind: 'consumption_spike',
          severity: 'review',
          label: 'High consumption',
          title: 'Consumption spike',
          message: text,
          date: filters.to,
          vehicleKey: key,
          vehicleLabel: meta.label,
          eventId: null,
          requestNumber: null,
          passNo: null,
          branchKey: mine[0]?.branchKey ?? null,
          branchLabel: meta.branchLabel,
          measured: c.approvedQty,
          expected: p.approvedQty,
          variance: round2(c.approvedQty - p.approvedQty),
          unit: meta.unit,
          review: null,
        })
      }
    }
    const approvedEvents = mine.filter((e) => e.approved !== null && e.unit === meta.unit).length
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { energy, ...rest } = meta
    rows.push({
      ...rest,
      attention,
      events: mine.length,
      approvedQty: c.approvedQty,
      actualQty: c.actualQty,
      spend: c.spend,
      avgFill: approvedEvents ? round2(c.approvedQty / approvedEvents) : null,
      previousQty: before.length ? p.approvedQty : null,
      gateKm,
      gpsKm: sumOf(gps.map((pass) => pass.trip?.gpsKm)),
      drives: returned.length,
      openExceptions: exceptions.filter((x) => x.vehicleKey === key && !x.review).length,
    })
  }
  const weight = (row: FuelVehicleRow) => (row.attention.length > 0 || row.openExceptions > 0 ? 0 : 1)
  rows.sort((a, b) => weight(a) - weight(b) || b.approvedQty - a.approvedQty || b.gateKm - a.gateKm || a.label.localeCompare(b.label))
  return { rows, spikes }
}

function qualityRows(events: readonly FuelEventRow[], passes: readonly LedgerPassInput[]): FuelQualityRow[] {
  const live = events.filter((e) => e.lifecycle !== 'rejected')
  const closedSince = (e: FuelEventRow) => e.lifecycle === 'completed' && (e.closedAt ?? '') >= ACCOUNTABILITY_SINCE
  const applies: Record<FuelQualityKey, number> = {
    vehicle_unidentified: live.filter((e) => e.purposeKey === 'DEMO').length,
    odometer_missing: live.filter((e) => e.identity === 'vin').length,
    odometer_unreadable: live.filter((e) => e.identity === 'vin').length,
    full_tank_missing: live.filter((e) => closedSince(e) && e.identity === 'vin').length,
    actual_missing: live.filter(closedSince).length,
    cost_missing: live.filter((e) => e.lifecycle === 'completed').length,
    pass_missing: live.filter((e) => e.createdAt >= ACCOUNTABILITY_SINCE && e.approved !== null && e.isDemo && e.purposeKey === 'DEMO').length,
    gps_missing: passes.filter((p) => p.status === 'returned' && !p.isFuelFilling).length,
  }
  const found: Record<FuelQualityKey, number> = {
    vehicle_unidentified: 0, odometer_missing: 0, odometer_unreadable: 0, full_tank_missing: 0,
    actual_missing: 0, cost_missing: 0, pass_missing: 0,
    gps_missing: passes.filter((p) => p.status === 'returned' && !p.isFuelFilling && p.trip?.status !== 'reconciled').length,
  }
  for (const e of live) for (const q of e.quality) found[q] += 1
  return (Object.keys(QUALITY_TEXT) as FuelQualityKey[])
    .map((key) => ({ key, ...QUALITY_TEXT[key], count: found[key], of: applies[key] }))
    .filter((row) => row.of > 0)
    .sort((a, b) => b.count - a.count)
}

/** The whole overview for one filtered view. */
export function summariseLedger(ledger: Ledger, filters: FuelFilters): FuelManagementResponse {
  const { window } = ledger
  const current = ledger.events.filter((e) => eventMatches(e, filters))
  const previous = ledger.events.filter((e) => eventMatches(e, filters, window.prevFrom, window.prevTo))
  const passes = ledger.passes.filter((p) => passMatches(ledger, p, filters))
  const previousPasses = ledger.passes.filter((p) => passMatches(ledger, p, filters, window.prevFrom, window.prevTo))
  const eventIds = new Set(current.map((e) => e.id))
  const baseExceptions = ledger.exceptions.filter((x) => exceptionMatches(ledger, x, filters, eventIds))

  const { rows: vehicles, spikes } = vehicleRows(ledger, current, previous, passes, baseExceptions, filters)
  const exceptions = [...baseExceptions, ...spikes].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.date.localeCompare(a.date),
  )

  const c = counts(current)
  const p = counts(previous)
  const withActual = c.live.filter((e) => e.actual !== null && e.unit === 'L')
  const both = withActual.filter((e) => e.approved !== null)
  const otherUnits = (['kg', 'kWh'] as FuelUnit[])
    .map((unit) => ({ unit, ...counts(current, unit) }))
    .filter((x) => x.approvedQty > 0 || x.actualQty > 0)
    .map((x) => ({ unit: x.unit, approvedQty: x.approvedQty, actualQty: x.actualQty }))

  const returned = passes.filter((pass) => pass.status === 'returned')
  const gps = returned.filter((pass) => pass.trip?.status === 'reconciled' && isNum(pass.trip.gpsKm))
  const vinKeys = new Set(vehicles.filter((v) => v.kind === 'vin').map((v) => v.key))
  const fleetNow = fleetEfficiency(ledger.segments, 'L', filters.from, filters.to, vinKeys)
  const fleetBefore = fleetEfficiency(ledger.segments, 'L', window.prevFrom, window.prevTo, vinKeys)
  const fleet: FuelFleetFigure | null = vinKeys.size === 0 ? null : {
    unit: 'L',
    efficiency: fleetNow.efficiency,
    costPerKm: fleetNow.costPerKm,
    costPerKmWithEstimates: fleetNow.costPerKmWithEstimates,
    distanceKm: round2(fleetNow.distanceKm),
    quantity: round2(fleetNow.quantity),
    segments: fleetNow.segments,
    costedSegments: fleetNow.costedSegments,
    estimatedSegments: fleetNow.estimatedSegments,
    implausibleSegments: fleetNow.implausibleSegments,
    basis: fleetNow.basis,
  }

  const openRows = exceptions.filter((x) => !x.review)
  const toClose = c.live.filter((e) => e.lifecycle === 'to_finalise')
  const overdueKeys = new Set(exceptions.filter((x) => x.kind === 'close_overdue').map((x) => x.eventId))
  const headline: FuelHeadline = {
    spend: {
      current: c.spend,
      previous: previous.length ? p.spend : null,
      costedEvents: c.live.filter((e) => e.cost !== null).length,
      closedEvents: c.live.filter((e) => e.lifecycle === 'completed').length,
      estimated: round2(c.estimated),
      estimatedEvents: c.estimatedEvents,
      previousWithEstimates: previous.length ? round2(p.spend + p.estimated) : null,
      prices: { petrol: ledger.settings.marketPricePetrolPerLitre, diesel: ledger.settings.marketPriceDieselPerLitre },
    },
    requestedQty: sumOf(c.live.filter((e) => e.unit === 'L').map((e) => e.requested)),
    approvedQty: { current: c.approvedQty, previous: previous.length ? p.approvedQty : null },
    actualQty: {
      current: c.actualQty,
      previous: previous.length ? p.actualQty : null,
      recordedEvents: withActual.length,
      eligibleEvents: c.live.filter((e) => e.approved !== null && e.unit === 'L').length,
    },
    reconciled: {
      events: both.length,
      approvedQty: sumOf(both.map((e) => e.approved)),
      actualQty: sumOf(both.map((e) => e.actual)),
      variance: sumOf(both.map((e) => e.variance)),
    },
    approvedEvents: { current: c.approvedEvents, previous: previous.length ? p.approvedEvents : null },
    otherUnits,
    vehiclesFuelled: new Set(c.live.filter((e) => e.approved !== null && e.identity === 'vin').map((e) => e.vehicleKey)).size,
    distance: {
      gateKm: sumOf(returned.map((pass) => driveOdometerKm({ gateOutOdo: pass.gateOutOdo, gateInOdo: pass.gateInOdo }))),
      drives: returned.length,
      gpsKm: sumOf(gps.map((pass) => pass.trip?.gpsKm)),
      gpsDrives: gps.length,
      previousGateKm: previousPasses.length
        ? sumOf(previousPasses.filter((pass) => pass.status === 'returned').map((pass) => driveOdometerKm({ gateOutOdo: pass.gateOutOdo, gateInOdo: pass.gateInOdo })))
        : null,
    },
    fleet,
    pending: {
      review: c.live.filter((e) => e.lifecycle === 'in_review' || e.lifecycle === 'on_hold').length,
      toClose: toClose.length,
      overdueToClose: toClose.filter((e) => overdueKeys.has(e.id)).length,
    },
    exceptions: {
      open: openRows.length,
      critical: openRows.filter((x) => x.severity === 'critical').length,
      review: openRows.filter((x) => x.severity === 'review').length,
      info: openRows.filter((x) => x.severity === 'info').length,
      reviewed: exceptions.length - openRows.length,
    },
    vehiclesNeedingAttention: vehicles.filter((v) => v.attention.length > 0 || v.openExceptions > 0).length,
  }

  // Narrative: the engine's sentences, then the accountability ones.
  // Only when EVERY stretch in both periods carries a bill: a partial cost would split a change that isn't whole.
  const fullyCosted = fleetBefore.segments > 0 && fleetNow.segments > 0
    && fleetBefore.costedSegments === fleetBefore.segments && fleetNow.costedSegments === fleetNow.segments
  const breakdownOfSpend = fullyCosted
    ? decomposeCostChange(
        { distanceKm: fleetBefore.distanceKm, quantity: fleetBefore.quantity, cost: (fleetBefore.costPerKm ?? 0) * fleetBefore.distanceKm },
        { distanceKm: fleetNow.distanceKm, quantity: fleetNow.quantity, cost: (fleetNow.costPerKm ?? 0) * fleetNow.distanceKm },
      )
    : null
  const narrative: string[] = []
  if (c.approvedEvents === 0) {
    narrative.push('No fuel was approved in this period for the filters chosen.')
  } else {
    narrative.push(
      `${c.approvedEvents} request${c.approvedEvents === 1 ? '' : 's'} approved for ${formatNumber(c.approvedQty, 1)} L`
      + (headline.requestedQty > c.approvedQty + 0.01 ? ` (${formatNumber(headline.requestedQty, 1)} L requested).` : '.'),
    )
    narrative.push(
      withActual.length === 0
        ? 'No actual litres are recorded yet, so approved and actual cannot be compared.'
        : `Actual litres are recorded on ${withActual.length} of ${headline.actualQty.eligibleEvents}: ${formatNumber(headline.reconciled.actualQty, 1)} L against ${formatNumber(headline.reconciled.approvedQty, 1)} L approved.`,
    )
    if (fleet && fleet.segments > 0) {
      // Cost per km is stated only when EVERY stretch behind the mileage carries a bill.
      const allCosted = fleet.costedSegments === fleet.segments
      const sentences = describeFleetPeriod({
        streams: [{ unit: 'L', quantity: fleet.quantity, distanceKm: fleet.distanceKm, spend: allCosted && fleet.costPerKm !== null ? fleet.costPerKm * fleet.distanceKm : null }],
        vehiclesBelowExpected: vehicles.filter((v) => v.efficiencyStatus === 'poor' || v.efficiencyStatus === 'watch').length,
        benchmarksConfigured: ledger.benchmarksConfigured > 0,
        spendBefore: previous.length ? p.spend : null,
        spendAfter: c.spend,
        breakdown: breakdownOfSpend,
      }).filter((s) => !s.startsWith('Cost is unavailable'))
      narrative.push(sentences[0])
      if (fleet.basis === 'provisional') {
        narrative.push('That mileage is provisional — measured fill to fill, because no car has two full-tank fills with readings yet.')
      }
      if (!allCosted) {
        narrative.push(`Cost per km needs a bill on every fill of a stretch; ${fleet.costedSegments} of ${fleet.segments} stretches have one.`)
        if (fleet.costPerKmWithEstimates !== null && fleet.estimatedSegments > 0) {
          narrative.push(`Pricing the unbilled fills at the market rate (petrol ₹${formatNumber(ledger.settings.marketPricePetrolPerLitre, 2)}/L, diesel ₹${formatNumber(ledger.settings.marketPriceDieselPerLitre, 2)}/L), cost per km is about ₹${formatNumber(fleet.costPerKmWithEstimates, 2)} — an estimate until the bills are recorded.`)
        }
      }
      narrative.push(...sentences.slice(1, 2))
    } else if (vinKeys.size > 0) {
      narrative.push('Mileage is not available yet: it needs two full-tank fills with odometer readings on the same car.')
    }
  }

  const attention: FuelAttentionItem[] = []
  for (const x of openRows.filter((row) => row.severity === 'critical').slice(0, 4)) {
    attention.push({ id: `x:${x.key}`, severity: 'critical', title: `${x.title} — ${x.vehicleLabel}`, detail: x.message, target: { kind: 'exception', key: x.key } })
  }
  if (headline.pending.review > 0) {
    attention.push({
      id: 'pending-review',
      severity: 'review',
      title: `${headline.pending.review} request${headline.pending.review === 1 ? '' : 's'} waiting for approval`,
      detail: 'Approve, hold or send back in Fuel Approvals.',
      target: { kind: 'tab', tab: 'transactions', state: 'in_review' },
    })
  }
  if (headline.pending.toClose > 0) {
    attention.push({
      id: 'to-close',
      severity: headline.pending.overdueToClose > 0 ? 'review' : 'info',
      title: `${headline.pending.toClose} approved order${headline.pending.toClose === 1 ? '' : 's'} without a bill`,
      detail: headline.pending.overdueToClose > 0
        ? `${headline.pending.overdueToClose} have waited more than ${ledger.settings.closeOverdueDays} days. Record the actual litres and the bill.`
        : 'Record the actual litres and the bill when they arrive.',
      target: { kind: 'tab', tab: 'transactions', state: 'to_finalise' },
    })
  }
  for (const v of vehicles.filter((row) => row.attention.length > 0).slice(0, 3)) {
    attention.push({ id: `v:${v.key}`, severity: 'review', title: v.label, detail: v.attention[0], target: { kind: 'vehicle', key: v.key } })
  }
  const remaining = openRows.filter((row) => row.severity === 'review').length
  if (remaining > 0) {
    attention.push({
      id: 'exceptions-review',
      severity: 'review',
      title: `${remaining} exception${remaining === 1 ? '' : 's'} to review`,
      detail: 'Mismatches, odometer anomalies and unusual usage, each with the figures behind it.',
      target: { kind: 'tab', tab: 'exceptions' },
    })
  }
  const quality = qualityRows(current, passes)
  const worst = quality.find((q) => q.count > 0 && q.key !== 'gps_missing')
  if (worst) {
    attention.push({
      id: `q:${worst.key}`,
      severity: 'info',
      title: `${worst.label} on ${worst.count} of ${worst.of}`,
      detail: worst.description,
      target: { kind: 'tab', tab: 'quality' },
    })
  }
  attention.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

  const activity: FuelActivityItem[] = current
    .map((e): FuelActivityItem => {
      const last = (ledger.trails[e.id] ?? []).at(-1)
      const action = String(last?.action ?? 'SUBMIT').toUpperCase()
      const kind: FuelActivityItem['kind'] = action === 'APPROVE' ? 'approved'
        : action === 'FINALIZE' ? 'closed'
          : action === 'SEND_BACK' ? 'sent_back'
            : action === 'REJECT' ? 'rejected'
              : 'raised'
      return {
        eventId: e.id,
        at: last?.at ?? e.createdAt,
        kind,
        requestNumber: e.requestNumber,
        vehicleLabel: e.vehicleLabel,
        branchLabel: e.branchLabel,
        qty: kind === 'closed' ? e.actual ?? e.approved : kind === 'approved' ? e.approved : e.requested,
        unit: e.unit,
        cost: kind === 'closed' ? e.cost : null,
        lifecycle: e.lifecycle,
        lifecycleLabel: e.lifecycleLabel,
        openExceptions: e.openExceptions,
      }
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10)

  const periodEvents = ledger.events.filter((e) => inRange(e.date, filters.from, filters.to))
  return {
    filters,
    previous: { from: window.prevFrom, to: window.prevTo },
    options: options(periodEvents, ledger.vehicles),
    headline,
    narrative,
    attention: attention.slice(0, 8),
    activity,
    breakdowns: {
      purpose: breakdown(current, (e) => [e.purposeKey, e.purposeLabel]),
      branch: breakdown(current, (e) => [e.branchKey, e.branchLabel]),
      brand: breakdown(current, (e) => [e.brandKey, e.brandLabel]),
      department: breakdown(current, (e) => [e.department ?? 'NONE', e.department ?? 'Not recorded']),
      energy: breakdown(current, (e) => [`${e.energy}:${e.unit}`, energyLabel(e.energy, e.unit)]),
      vehicle: breakdown(current.filter((e) => e.identity !== 'label'), (e) => [e.vehicleKey, ledger.vehicles[e.vehicleKey]?.label ?? e.vehicleLabel], 10),
    },
    trend: trend(current, filters.from, filters.to),
    vehicles,
    exceptions,
    quality,
    settingsSource: ledger.settingsConfigured ? 'configured' : 'defaults',
    benchmarksConfigured: ledger.benchmarksConfigured,
    sync: ledger.sync,
    generatedAt: ledger.generatedAt,
  }
}

// ── Transactions list ───────────────────────────────────────────────────────────────────────────────

export type LedgerEventQuery = {
  state: FuelLifecycle | 'open_exceptions' | null
  quality: FuelQualityKey | null
  q: string | null
  sort: 'date' | 'quantity' | 'cost' | 'variance'
  direction: 'asc' | 'desc'
  page: number
  pageSize: number
}

export function listLedgerEvents(ledger: Ledger, filters: FuelFilters, query: LedgerEventQuery): FuelTransactionsResponse {
  const needle = (query.q ?? '').trim().toLowerCase()
  const matches = ledger.events.filter((e) => {
    if (!eventMatches(e, filters)) return false
    if (query.state === 'open_exceptions') {
      if (e.openExceptions === 0) return false
    } else if (query.state && e.lifecycle !== query.state) {
      return false
    }
    if (query.quality && !e.quality.includes(query.quality)) return false
    if (needle) {
      const hay = [e.requestNumber, e.vehicleLabel, e.vin, e.passNo, e.requesterName, e.approverName, e.purposeLabel, e.branchLabel, e.department]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
  const value = (e: FuelEventRow): number | string => {
    switch (query.sort) {
      case 'quantity': return e.actual ?? e.approved ?? e.requested ?? -1
      case 'cost': return e.cost ?? -1
      case 'variance': return e.variance === null ? -Infinity : Math.abs(e.variance)
      default: return `${e.date}|${e.createdAt}`
    }
  }
  const sign = query.direction === 'asc' ? 1 : -1
  matches.sort((a, b) => {
    const x = value(a)
    const y = value(b)
    if (x < y) return -1 * sign
    if (x > y) return 1 * sign
    return b.createdAt.localeCompare(a.createdAt)
  })
  const pageSize = Math.min(Math.max(query.pageSize, 5), 100)
  const pages = Math.max(1, Math.ceil(matches.length / pageSize))
  const page = Math.min(Math.max(query.page, 1), pages)
  const live = matches.filter((e) => e.lifecycle !== 'rejected')
  return {
    rows: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
    totals: {
      approvedQty: sumOf(live.filter((e) => e.unit === 'L').map((e) => e.approved)),
      actualQty: sumOf(live.filter((e) => e.unit === 'L').map((e) => e.actual)),
      spend: sumOf(live.map((e) => e.cost)),
    },
  }
}

// ── One transaction, end to end ─────────────────────────────────────────────────────────────────────

function passDetail(pass: LedgerPassInput): FuelPassDetail {
  return {
    id: pass.id,
    passNo: pass.passNo,
    status: pass.status,
    purpose: pass.purpose,
    driverKind: pass.driverKind,
    staffDriverName: pass.staffDriverName,
    raisedByName: pass.raisedByName,
    gateOutAt: pass.gateOutAt,
    gateInAt: pass.gateInAt,
    gateOutOdo: pass.gateOutOdo,
    gateInOdo: pass.gateInOdo,
    odometerKm: driveOdometerKm({ gateOutOdo: pass.gateOutOdo, gateInOdo: pass.gateInOdo }),
    pumpLitres: pass.fuelLitres,
    pumpAmount: pass.fuelAmount,
    gps: pass.trip ? { ...pass.trip } : null,
  }
}

const ACTION_WORDS: Record<string, string> = {
  SUBMIT: 'Raised',
  RESUBMIT: 'Re-submitted',
  APPROVE: 'Approved',
  HOLD: 'Put on hold',
  SEND_BACK: 'Sent back',
  REJECT: 'Rejected',
  FINALIZE: 'Bill recorded',
  RESET: 'Approval reset',
}

export function ledgerTransaction(ledger: Ledger, id: string, vehicleRow: FuelVehicleRow | null): FuelTransactionDetail | null {
  const event = ledger.events.find((e) => e.id === id)
  if (!event) return null
  const pass = event.passId ? ledger.passes.find((p) => p.id === event.passId) ?? null : null
  const exceptions = ledger.exceptions.filter((x) => x.eventId === id)
  const hasException = (kind: string) => exceptions.some((x) => x.kind === kind)
  const unit = event.unit

  const history = ledger.events
    .filter((e) => e.vehicleKey === event.vehicleKey && e.identity !== 'label' && e.approved !== null && e.id !== id)
    .filter((e) => e.date < event.date || (e.date === event.date && e.createdAt < event.createdAt))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const previousFill = history[0] ?? null
  const drives = event.vin && previousFill
    ? ledger.passes
        .filter((p) => p.vin === event.vin && !p.isFuelFilling && p.gateOutYmd !== null && p.gateOutYmd >= previousFill.date && p.gateOutYmd <= event.date)
        .map((p) => ({
          passNo: p.passNo,
          gateOutAt: p.gateOutAt ?? '',
          odometerKm: driveOdometerKm({ gateOutOdo: p.gateOutOdo, gateInOdo: p.gateInOdo }),
          gpsKm: p.trip?.status === 'reconciled' ? p.trip.gpsKm : null,
        }))
    : []

  const segment = ledger.segments.find((s) => s.closingFillId === id && s.usable) ?? null
  const distanceSincePreviousKm = isNum(event.odometerKm) && previousFill && isNum(previousFill.odometerKm)
    ? round2(event.odometerKm - previousFill.odometerKm)
    : null
  const expectedEfficiency = vehicleRow?.expected ?? null
  const expectedQty = expectedQuantity(segment?.distanceKm ?? distanceSincePreviousKm, expectedEfficiency)
  const notes: string[] = []
  if (event.identity === 'label') notes.push(event.identityNote ?? 'This record is not tied to one vehicle, so it has no mileage.')
  if (!previousFill && event.identity === 'vin') notes.push('This is the first fill on record for this car — distance is measured from the next one.')
  if (segment?.kind === 'provisional') notes.push('Mileage here is provisional: it is fill-to-fill, not full tank to full tank.')
  if (!segment && event.identity === 'vin' && previousFill) {
    notes.push(event.fullTank === false ? 'A partial fill does not close a mileage stretch.' : 'No mileage for this fill yet — see the vehicle for the reason.')
  }
  if (expectedEfficiency === null && event.identity === 'vin') notes.push('No expected mileage is set for this car, so there is no expected quantity.')

  const qty = (n: number | null) => (n === null ? null : `${formatNumber(n, 2)} ${unit}`)
  const steps: FuelTraceStep[] = []
  steps.push({ key: 'requested', label: 'Requested', state: 'done', value: qty(event.requested), detail: event.purposeLabel, at: event.createdAt, actor: event.requesterName })
  steps.push({
    key: 'approved',
    label: 'Approved',
    state: event.approved !== null ? 'done' : event.lifecycle === 'rejected' ? 'not_applicable' : 'pending',
    value: qty(event.approved),
    detail: event.lifecycle === 'rejected'
      ? 'Rejected'
      : event.lifecycle === 'sent_back'
        ? 'Sent back for correction'
        : event.approved !== null && event.requested !== null && Math.abs(event.approved - event.requested) >= 0.01
          ? `Changed from ${qty(event.requested)}`
          : event.approved !== null ? 'As requested' : 'Waiting for approval',
    at: event.approvedAt,
    actor: event.approverName,
  })
  steps.push({
    key: 'filled',
    label: 'Pump meter',
    state: pass
      ? isNum(pass.fuelLitres) ? (hasException('pump_bill_mismatch') ? 'mismatch' : 'done') : 'pending'
      : event.isDemo && event.purposeKey === 'DEMO' ? 'missing' : 'not_applicable',
    value: pass && isNum(pass.fuelLitres) ? `${formatNumber(pass.fuelLitres, 2)} L` : null,
    detail: pass
      ? `${pass.passNo}${isNum(pass.fuelAmount) ? ` · ₹${formatNumber(pass.fuelAmount)}` : ''}${isNum(pass.fuelLitres) ? '' : ' · reading added at gate-in'}`
      : event.isDemo && event.purposeKey === 'DEMO' ? 'No fuel-filling gate pass was picked' : 'Not a gate-pass fill',
    at: pass?.gateInAt ?? null,
    actor: pass?.staffDriverName ?? null,
  })
  steps.push({
    key: 'closed',
    label: 'Bill recorded',
    state: event.lifecycle === 'completed'
      ? event.actual === null ? 'missing' : hasException('actual_over_approved') || hasException('actual_under_approved') ? 'mismatch' : 'done'
      : event.lifecycle === 'to_finalise' ? 'pending' : 'not_applicable',
    value: event.actual !== null ? `${qty(event.actual)}${event.cost !== null ? ` · ₹${formatNumber(event.cost)}` : ''}` : event.cost !== null ? `₹${formatNumber(event.cost)}` : null,
    detail: event.variance !== null && Math.abs(event.variance) >= 0.01
      ? `${event.variance > 0 ? '+' : '−'}${formatNumber(Math.abs(event.variance), 2)} ${unit} against approved`
      : event.lifecycle === 'completed' && event.actual === null ? 'Actual litres were not recorded' : event.station,
    at: event.closedAt,
    actor: event.closedByName,
  })
  if (event.identity === 'vin') {
    const km = sumOf(drives.map((d) => d.odometerKm))
    steps.push({
      key: 'driven',
      label: 'Driven since last fill',
      state: !previousFill ? 'not_applicable' : drives.length ? 'done' : hasException('fill_without_usage') ? 'mismatch' : 'missing',
      value: drives.length ? `${formatNumber(km, 1)} km` : null,
      detail: !previousFill ? 'First fill on record' : `${drives.length} drive${drives.length === 1 ? '' : 's'} since ${previousFill.date}`,
      at: null,
      actor: null,
    })
    const gpsKm = sumOf(drives.map((d) => d.gpsKm))
    const withGps = drives.filter((d) => d.gpsKm !== null).length
    const disagree = drives.some((d) => ledger.exceptions.some((x) => x.kind === 'gps_distance_mismatch' && x.passNo === d.passNo))
    steps.push({
      key: 'verified',
      label: 'GPS check',
      state: !drives.length ? 'not_applicable' : disagree ? 'mismatch' : withGps ? 'done' : 'missing',
      value: withGps ? `${formatNumber(gpsKm, 1)} km` : null,
      detail: !drives.length ? null : withGps ? `GPS on ${withGps} of ${drives.length} drives` : 'No tracker data for these drives',
      at: null,
      actor: null,
    })
  }

  return {
    event,
    steps,
    timeline: (ledger.trails[id] ?? []).map((t) => ({
      at: t.at,
      action: ACTION_WORDS[String(t.action).toUpperCase()] ?? titleCase(String(t.action).replace(/_/g, ' ')),
      actorName: t.actorName,
      actorRole: t.actorRole,
    })),
    vehicle: vehicleRow,
    pass: pass ? passDetail(pass) : null,
    drivesSincePrevious: drives,
    analysis: {
      previousFillDate: previousFill?.date ?? null,
      distanceSincePreviousKm,
      expectedQty: expectedQty === null ? null : round2(expectedQty),
      expectedEfficiency,
      efficiency: segment?.efficiency === null || segment?.efficiency === undefined ? null : Math.round(segment.efficiency * 10) / 10,
      efficiencyBasis: segment ? segment.kind : null,
      costPerKm: segment?.costPerKm ?? null,
      unitPrice: event.unitPrice,
      notes,
    },
    exceptions,
  }
}

// ── One vehicle ─────────────────────────────────────────────────────────────────────────────────────

export function ledgerVehicle(ledger: Ledger, key: string, vehicleRow: FuelVehicleRow): FuelVehicleProfile {
  const to = ledger.window.to
  const firstMonth = `${addDays(`${to.slice(0, 7)}-15`, -330).slice(0, 7)}`
  const months: string[] = []
  let cursor = firstMonth
  while (cursor <= to.slice(0, 7)) {
    months.push(cursor)
    cursor = addDays(`${cursor}-28`, 4).slice(0, 7)
  }
  const fills = ledger.events.filter((e) => e.vehicleKey === key)
  const passes = ledger.passes.filter((p) => p.vin === key)
  const keys = new Set([key])
  const monthly = months.map((month) => {
    const inMonth = fills.filter((e) => e.date.startsWith(month) && e.lifecycle !== 'rejected')
    const monthEnd = addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1)
    const eff = fleetEfficiency(ledger.segments, vehicleRow.unit, `${month}-01`, monthEnd, keys)
    return {
      month,
      label: monthLabel(month),
      qty: sumOf(inMonth.map((e) => e.actual ?? e.approved)),
      spend: sumOf(inMonth.map((e) => e.cost)),
      gateKm: sumOf(passes.filter((p) => p.status === 'returned' && p.gateOutYmd?.startsWith(month)).map((p) => driveOdometerKm({ gateOutOdo: p.gateOutOdo, gateInOdo: p.gateInOdo }))),
      efficiency: eff.efficiency === null ? null : Math.round(eff.efficiency * 10) / 10,
    }
  })
  return {
    vehicle: vehicleRow,
    monthly,
    segments: ledger.segments
      .filter((s) => s.vehicleKey === key)
      .map((s) => ({
        openedOn: s.openedOn,
        closedOn: s.closedOn,
        kind: s.kind,
        distanceKm: s.distanceKm,
        quantity: round2(s.quantity),
        efficiency: s.efficiency === null ? null : Math.round(s.efficiency * 10) / 10,
        costPerKm: s.costPerKm === null ? null : round2(s.costPerKm),
        usable: s.usable,
        problem: s.problem,
      }))
      .reverse(),
    fills,
    drives: passes
      .filter((p) => p.gateOutAt)
      .sort((a, b) => String(b.gateOutAt).localeCompare(String(a.gateOutAt)))
      .map((p) => ({
        passNo: p.passNo,
        purpose: p.purpose,
        gateOutAt: p.gateOutAt as string,
        gateInAt: p.gateInAt,
        odometerKm: driveOdometerKm({ gateOutOdo: p.gateOutOdo, gateInOdo: p.gateInOdo }),
        gpsKm: p.trip?.status === 'reconciled' ? p.trip.gpsKm : null,
        pumpLitres: p.fuelLitres,
      })),
    exceptions: ledger.exceptions.filter((x) => x.vehicleKey === key),
  }
}

/** A vehicle row for one key over the whole period, ignoring every filter but the dates. */
export function vehicleRowFor(ledger: Ledger, key: string, filters: FuelFilters): FuelVehicleRow | null {
  const scoped: FuelFilters = { ...filters, branch: null, brand: null, purpose: null, department: null, energy: null, fleet: null, vehicle: key }
  const current = ledger.events.filter((e) => eventMatches(e, scoped))
  const previous = ledger.events.filter((e) => eventMatches(e, scoped, ledger.window.prevFrom, ledger.window.prevTo))
  const passes = ledger.passes.filter((p) => passMatches(ledger, p, scoped))
  const ids = new Set(current.map((e) => e.id))
  const exceptions = ledger.exceptions.filter((x) => exceptionMatches(ledger, x, scoped, ids))
  const { rows } = vehicleRows(ledger, current, previous, passes, exceptions, scoped)
  const found = rows.find((row) => row.key === key)
  if (found) return found
  const meta = ledger.vehicles[key]
  if (!meta) return null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { energy, ...rest } = meta
  return {
    ...rest,
    events: 0,
    approvedQty: 0,
    actualQty: 0,
    spend: 0,
    avgFill: null,
    previousQty: null,
    gateKm: 0,
    gpsKm: 0,
    drives: 0,
    openExceptions: ledger.exceptions.filter((x) => x.vehicleKey === key && !x.review).length,
  }
}

export { DEFAULT_FUEL_SETTINGS, LIFECYCLE_ORDER }
