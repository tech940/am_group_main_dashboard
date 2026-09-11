/**
 * The fuel intelligence engine. Every mileage, cost, efficiency and exception figure Fuel Management shows comes out of
 * this file, so a number on any screen can be traced to one function and its inputs.
 *
 * PURE: no database, no 'server-only', no clock — the "as of" date is always passed in. scripts/verify-fuel-management.ts
 * runs it on fixtures. The data layer's only job is to turn rows into EngineFill objects.
 *
 * ── What it encodes (owner decisions, 2026-09-11) ─────────────────────────────────────────────────────────────────────
 * - Mileage is FULL-TANK TO FULL-TANK. A figure built any other way is labelled Provisional; with too little data the
 *   answer is "Mileage unavailable", never a small-sample number.
 * - Staff type the RECEIPT TOTAL; price per unit is derived from it.
 * - No expected mileage lives in code. Benchmarks and every threshold arrive as configuration.
 * - Energy units are never mixed: km/L, km/kg and km/kWh are separate streams, and a hybrid simply has two.
 * - An abnormal entry is warned about, never silently rejected; an authorised person may override it, and that
 *   override is part of the data this engine reads.
 */

export type EnergyType = 'petrol' | 'diesel' | 'cng' | 'ev' | 'hybrid'
export type EnergyUnit = 'L' | 'kg' | 'kWh'

/** The unit a single-energy vehicle is filled in. A hybrid's fills each carry their own unit. */
export const ENERGY_UNIT: Record<Exclude<EnergyType, 'hybrid'>, EnergyUnit> = {
  petrol: 'L',
  diesel: 'L',
  cng: 'kg',
  ev: 'kWh',
}

export function efficiencyUnitLabel(unit: EnergyUnit): string {
  return `km/${unit}`
}

/** One fuel or charging transaction, as the engine needs it. */
export type EngineFill = {
  id: string
  /** The VIN for a vehicle; an asset code (genset, stock yard) for a non-vehicle consumer. */
  vehicleKey: string
  /** IST civil date of the fill, YYYY-MM-DD. */
  date: string
  /** Orders fills on the same day (e.g. created_at in ms). */
  sequence: number
  energyType: EnergyType
  /** What `quantity` is measured in. */
  unit: EnergyUnit
  quantity: number
  /** The receipt total. Null when it was not captured (every entry before the rework). */
  totalCost: number | null
  odometerKm: number | null
  /** Null means "not recorded" — never read as either answer. */
  isFullTank: boolean | null
  /** An authorised person accepted an abnormal odometer reading on this fill. */
  odometerOverride: boolean
}

export type FuelIntelligenceSettings = {
  /** Below this distance a segment gives no mileage figure at all. */
  minSegmentDistanceKm: number
  /** Efficiency % of expected at or above which a vehicle is Good. */
  statusGoodMinPct: number
  /** Efficiency % at or above which a vehicle is Watch; below it, Poor. */
  statusWatchMinPct: number
  /** How far above configured tank capacity a quantity may be before it is flagged. */
  tankTolerancePct: number
  /** A segment this far below the vehicle's own recent median is a mileage drop. */
  mileageDropPct: number
  /** Minimum earlier segments before a drop or a baseline-based check can fire. */
  mileageBaselineSegments: number
  refuelWindowDays: number
  /** More fills than this inside the window is flagged. */
  refuelMaxFillsInWindow: number
  /** Mileage above expected (or the vehicle's baseline) × this is a possible data-entry error. */
  impossibleMileageMultiplier: number
  /** A unit price this far from the period median for its energy unit is flagged. */
  pricePctFromMedian: number
  /** Minimum priced fills of one energy unit before a price is compared with the median. */
  priceMinSamples: number
  /** Strictly falling mileage across this many consecutive segments is a declining trend. */
  decliningTrendSegments: number
  /** A rise in cost per km at or above this % marks a vehicle for attention. */
  costPerKmRisePct: number
}

/**
 * Starting values for the settings screen. They are parameters of the RULES — distances, percentages, counts — not facts
 * about any vehicle, and every one is editable there. No expected mileage appears here or anywhere else in code.
 */
export const DEFAULT_FUEL_SETTINGS: FuelIntelligenceSettings = {
  minSegmentDistanceKm: 100,
  statusGoodMinPct: 95,
  statusWatchMinPct: 85,
  tankTolerancePct: 5,
  mileageDropPct: 20,
  mileageBaselineSegments: 3,
  refuelWindowDays: 1,
  refuelMaxFillsInWindow: 2,
  impossibleMileageMultiplier: 2,
  pricePctFromMedian: 15,
  priceMinSamples: 5,
  decliningTrendSegments: 4,
  costPerKmRisePct: 10,
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── helpers */

const DAY_MS = 86_400_000

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0)

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function compareFills(a: Pick<EngineFill, 'date' | 'sequence'>, b: Pick<EngineFill, 'date' | 'sequence'>): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  return a.sequence - b.sequence
}

/** Indian digit grouping (1,82,400), a fixed number of decimals. */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Mileage is shown to one decimal — more implies a precision fuel receipts and odometers do not have. */
export function formatEfficiency(value: number, unit: EnergyUnit): string {
  return `${formatNumber(value, 1)} ${efficiencyUnitLabel(unit)}`
}

export function formatCostPerKm(value: number): string {
  return `₹${formatNumber(value, 2)}/km`
}

function formatQuantity(value: number, unit: EnergyUnit): string {
  return `${formatNumber(value, value >= 100 ? 0 : 1)} ${unit}`
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── segments */

export type SegmentKind = 'full_tank' | 'provisional'
export type SegmentProblem = 'missing_odometer' | 'override_inside' | 'odometer_decrease' | 'too_short'

export type MileageSegment = {
  vehicleKey: string
  unit: EnergyUnit
  kind: SegmentKind
  openingFillId: string
  closingFillId: string
  openedOn: string
  closedOn: string
  closingSequence: number
  /** Null when either end has no odometer reading. */
  distanceKm: number | null
  /** Fuel counted: every fill AFTER the opening fill, through the closing fill. */
  quantity: number
  /** Null unless every counted fill carries a receipt total. */
  cost: number | null
  /** Distance ÷ quantity, only when the segment is usable. */
  efficiency: number | null
  costPerKm: number | null
  usable: boolean
  problem: SegmentProblem | null
  countedFillIds: string[]
}

function makeSegment(
  kind: SegmentKind,
  opening: EngineFill,
  counted: readonly EngineFill[],
  settings: FuelIntelligenceSettings,
): MileageSegment {
  const closing = counted[counted.length - 1]
  const quantity = sum(counted.map((f) => f.quantity))
  const costs = counted.map((f) => f.totalCost)
  const cost = costs.every(isNum) ? sum(costs as number[]) : null

  let problem: SegmentProblem | null = null
  let distanceKm: number | null = null
  if (!isNum(opening.odometerKm) || !isNum(closing.odometerKm)) {
    problem = 'missing_odometer'
  } else {
    distanceKm = closing.odometerKm - opening.odometerKm
    const readings = [opening, ...counted].map((f) => f.odometerKm).filter(isNum)
    /*
     * ⚠️ An override INSIDE the stretch means somebody accepted a reading as abnormal — a replaced odometer, a
     * correction. The distance across it cannot be trusted, so it gives no mileage. An override on the OPENING fill is
     * the new starting point and does not spoil the stretch after it.
     */
    if (counted.some((f) => f.odometerOverride)) problem = 'override_inside'
    else if (readings.some((r, i) => i > 0 && r < readings[i - 1])) problem = 'odometer_decrease'
    else if (distanceKm < settings.minSegmentDistanceKm) problem = 'too_short'
  }

  const usable = problem === null && quantity > 0 && distanceKm !== null && distanceKm > 0
  const efficiency = usable ? distanceKm! / quantity : null
  return {
    vehicleKey: opening.vehicleKey,
    unit: closing.unit,
    kind,
    openingFillId: opening.id,
    closingFillId: closing.id,
    openedOn: opening.date,
    closedOn: closing.date,
    closingSequence: closing.sequence,
    distanceKm,
    quantity,
    cost,
    efficiency,
    costPerKm: usable && cost !== null ? cost / distanceKm! : null,
    usable,
    problem,
    countedFillIds: counted.map((f) => f.id),
  }
}

/**
 * Every mileage segment the fills support, for every vehicle and energy unit.
 *
 * FULL TANK: from one full fill to the next full fill in the same unit. Fuel = every fill after the opening one, through
 * the closing one — partial fills in between add fuel and do not break the stretch. Distance = closing odometer −
 * opening odometer.
 *
 * PROVISIONAL: for a fill no full-tank stretch counts, fill-to-fill — distance since the previous reading ÷ this fill's
 * quantity. Emitted only when both readings exist and this fill is not known to be partial, and always labelled.
 */
export function buildSegments(
  fills: readonly EngineFill[],
  settings: FuelIntelligenceSettings = DEFAULT_FUEL_SETTINGS,
): MileageSegment[] {
  const streams = new Map<string, EngineFill[]>()
  for (const fill of fills) {
    const key = `${fill.vehicleKey} ${fill.unit}`
    const list = streams.get(key)
    if (list) list.push(fill)
    else streams.set(key, [fill])
  }

  const out: MileageSegment[] = []
  for (const stream of streams.values()) {
    const sorted = [...stream].sort(compareFills)
    const inFullStretch = new Set<string>()

    let opening: EngineFill | null = null
    let between: EngineFill[] = []
    for (const fill of sorted) {
      if (opening === null) {
        if (fill.isFullTank === true) opening = fill
        continue
      }
      between.push(fill)
      if (fill.isFullTank === true) {
        out.push(makeSegment('full_tank', opening, between, settings))
        between.forEach((f) => inFullStretch.add(f.id))
        opening = fill
        between = []
      }
    }

    let previous: EngineFill | null = null
    for (const fill of sorted) {
      if (
        previous &&
        !inFullStretch.has(fill.id) &&
        fill.isFullTank !== false &&
        isNum(previous.odometerKm) &&
        isNum(fill.odometerKm)
      ) {
        out.push(makeSegment('provisional', previous, [fill], settings))
      }
      previous = fill
    }
  }

  return out.sort((a, b) => (a.closedOn !== b.closedOn ? (a.closedOn < b.closedOn ? -1 : 1) : a.closingSequence - b.closingSequence))
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── vehicle summary */

export type MileageBasis = 'full_tank' | 'provisional' | 'none'

export type VehicleMileageSummary = {
  vehicleKey: string
  unit: EnergyUnit
  basis: MileageBasis
  /** The latest usable segment. */
  current: number | null
  /** Σ distance ÷ Σ fuel — never the average of per-segment ratios. */
  average: number | null
  best: number | null
  worst: number | null
  /** Up to the last three usable segments, oldest first. */
  lastRefuels: number[]
  last30Days: number | null
  last90Days: number | null
  yearToDate: number | null
  totalDistanceKm: number
  totalQuantity: number
  /** Null unless every usable segment has a known cost. */
  totalCost: number | null
  costPerKm: number | null
  segmentsUsed: number
  /** Strictly falling across the last `decliningTrendSegments` usable segments. */
  declining: boolean
  /** Plain words for why there is no figure. Null when there is one. */
  unavailableReason: string | null
}

function windowEfficiency(segments: readonly MileageSegment[]): number | null {
  const distance = sum(segments.map((s) => s.distanceKm ?? 0))
  const quantity = sum(segments.map((s) => s.quantity))
  return quantity > 0 && distance > 0 ? distance / quantity : null
}

/**
 * One vehicle's mileage in one energy unit, as of a date.
 *
 * Full-tank segments are the basis whenever any is usable; provisional ones are used only when there is no full-tank
 * figure at all, and the basis says so. A segment belongs to the window in which it CLOSES.
 */
export function summariseVehicleMileage(
  segments: readonly MileageSegment[],
  vehicleKey: string,
  unit: EnergyUnit,
  asOf: string,
  settings: FuelIntelligenceSettings = DEFAULT_FUEL_SETTINGS,
): VehicleMileageSummary {
  const mine = segments.filter((s) => s.vehicleKey === vehicleKey && s.unit === unit)
  const full = mine.filter((s) => s.kind === 'full_tank' && s.usable)
  const provisional = mine.filter((s) => s.kind === 'provisional' && s.usable)
  const basis: MileageBasis = full.length ? 'full_tank' : provisional.length ? 'provisional' : 'none'
  const chosen = basis === 'full_tank' ? full : basis === 'provisional' ? provisional : []

  const asOfUtc = ymdToUtc(asOf)
  const closedBy = chosen.filter((s) => ymdToUtc(s.closedOn) <= asOfUtc)
  const inLastDays = (days: number) => closedBy.filter((s) => ymdToUtc(s.closedOn) > asOfUtc - days * DAY_MS)
  const effs = closedBy.map((s) => s.efficiency as number)
  const totalDistanceKm = sum(closedBy.map((s) => s.distanceKm ?? 0))
  const totalQuantity = sum(closedBy.map((s) => s.quantity))
  const costs = closedBy.map((s) => s.cost)
  const totalCost = closedBy.length && costs.every(isNum) ? sum(costs as number[]) : null

  const n = settings.decliningTrendSegments
  const tail = effs.slice(-n)
  const declining = n >= 2 && tail.length === n && tail.every((v, i) => i === 0 || v < tail[i - 1])

  let unavailableReason: string | null = null
  if (!closedBy.length) {
    const problems = new Set(mine.map((s) => s.problem))
    unavailableReason = problems.has('odometer_decrease')
      ? 'Odometer readings go backwards — see Exceptions.'
      : problems.has('override_inside')
        ? 'An odometer correction sits inside this stretch, so its distance cannot be trusted.'
        : problems.has('too_short')
          ? 'Not enough distance between fills yet for a reliable figure.'
          : problems.has('missing_odometer')
            ? 'A fill is missing its odometer reading.'
            : 'Needs a second fill with an odometer reading.'
  }

  return {
    vehicleKey,
    unit,
    basis: closedBy.length ? basis : 'none',
    current: effs.length ? effs[effs.length - 1] : null,
    average: windowEfficiency(closedBy),
    best: effs.length ? Math.max(...effs) : null,
    worst: effs.length ? Math.min(...effs) : null,
    lastRefuels: effs.slice(-3),
    last30Days: windowEfficiency(inLastDays(30)),
    last90Days: windowEfficiency(inLastDays(90)),
    yearToDate: windowEfficiency(closedBy.filter((s) => s.closedOn.slice(0, 4) === asOf.slice(0, 4))),
    totalDistanceKm,
    totalQuantity,
    totalCost,
    costPerKm: totalCost !== null && totalDistanceKm > 0 ? totalCost / totalDistanceKm : null,
    segmentsUsed: closedBy.length,
    declining,
    unavailableReason,
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── expected vs actual */

export type FuelBenchmark = {
  scope: 'vehicle' | 'model_variant' | 'model'
  vin?: string | null
  model?: string | null
  variant?: string | null
  energyType: EnergyType
  unit: EnergyUnit
  /** km per unit. Null when only a tank capacity is configured. */
  expectedEfficiency: number | null
  tankCapacity: number | null
}

export type BenchmarkSubject = { vin: string; model: string | null; variant: string | null; energyType: EnergyType; unit: EnergyUnit }

const keyText = (value: unknown) => String(value ?? '').trim().toUpperCase()

/** Most specific first: this VIN → model and variant → model. Always the same energy type AND unit. None → null. */
export function resolveBenchmark(subject: BenchmarkSubject, benchmarks: readonly FuelBenchmark[]): FuelBenchmark | null {
  const same = benchmarks.filter((b) => b.energyType === subject.energyType && b.unit === subject.unit)
  const vin = keyText(subject.vin)
  const model = keyText(subject.model)
  const variant = keyText(subject.variant)
  return (
    same.find((b) => b.scope === 'vehicle' && vin && keyText(b.vin) === vin) ??
    same.find((b) => b.scope === 'model_variant' && model && variant && keyText(b.model) === model && keyText(b.variant) === variant) ??
    same.find((b) => b.scope === 'model' && model && keyText(b.model) === model) ??
    null
  )
}

export type EfficiencyStatus = 'good' | 'watch' | 'poor' | 'no_benchmark' | 'no_data'

export type EfficiencyAssessment = {
  status: EfficiencyStatus
  actual: number | null
  expected: number | null
  /** actual ÷ expected × 100 */
  efficiencyPct: number | null
  /** actual − expected, in km per unit */
  variance: number | null
}

export function assessEfficiency(
  actual: number | null,
  expected: number | null,
  settings: FuelIntelligenceSettings = DEFAULT_FUEL_SETTINGS,
): EfficiencyAssessment {
  if (!isNum(actual)) return { status: 'no_data', actual: null, expected: isNum(expected) ? expected : null, efficiencyPct: null, variance: null }
  if (!isNum(expected) || expected <= 0) return { status: 'no_benchmark', actual, expected: null, efficiencyPct: null, variance: null }
  const efficiencyPct = (actual / expected) * 100
  const status: EfficiencyStatus =
    efficiencyPct >= settings.statusGoodMinPct ? 'good' : efficiencyPct >= settings.statusWatchMinPct ? 'watch' : 'poor'
  return { status, actual, expected, efficiencyPct, variance: actual - expected }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── cost */

export type PeriodFuelFactors = { distanceKm: number; quantity: number; cost: number }
export type CostChangeBreakdown = { total: number; distance: number; efficiency: number; price: number }

/**
 * Why spend changed between two periods, in three parts that add up EXACTLY to the change.
 *
 *   cost = distance × (1 ÷ mileage) × price per unit
 *   Δcost = w·ln(D₂/D₁) + w·ln(M₁/M₂) + w·ln(P₂/P₁),   w = (C₂ − C₁) ÷ (ln C₂ − ln C₁)
 *
 * The log-mean weight leaves no residual term, so "₹60K distance + ₹35K price + ₹25K efficiency" is always the whole
 * ₹1.2L. Distance, quantity and cost must describe the same fuel (usable segments with known costs), in ONE energy unit.
 * Null when any factor is missing or not positive.
 */
export function decomposeCostChange(before: PeriodFuelFactors, after: PeriodFuelFactors): CostChangeBreakdown | null {
  const values = [before.distanceKm, before.quantity, before.cost, after.distanceKm, after.quantity, after.cost]
  if (!values.every((v) => isNum(v) && v > 0)) return null
  const c1 = before.cost
  const c2 = after.cost
  const weight = c1 === c2 ? c1 : (c2 - c1) / (Math.log(c2) - Math.log(c1))
  const mileage1 = before.distanceKm / before.quantity
  const mileage2 = after.distanceKm / after.quantity
  const price1 = c1 / before.quantity
  const price2 = c2 / after.quantity
  return {
    total: c2 - c1,
    distance: weight * Math.log(after.distanceKm / before.distanceKm),
    efficiency: weight * Math.log(mileage1 / mileage2),
    price: weight * Math.log(price2 / price1),
  }
}

/** Receipt total ÷ quantity. */
export function unitPrice(fill: Pick<EngineFill, 'totalCost' | 'quantity'>): number | null {
  return isNum(fill.totalCost) && fill.quantity > 0 ? fill.totalCost / fill.quantity : null
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── exceptions */

export type FuelExceptionKind =
  | 'odometer_decrease'
  | 'above_tank_capacity'
  | 'mileage_drop'
  | 'refuel_frequency'
  | 'impossible_mileage'
  | 'price_out_of_range'
  | 'possible_duplicate'

export type FuelException = {
  kind: FuelExceptionKind
  severity: 'warning' | 'info'
  vehicleKey: string
  fillId: string
  date: string
  value: number | null
  expected: number | null
  variance: number | null
  message: string
}

export type ExceptionInput = {
  fills: readonly EngineFill[]
  segments: readonly MileageSegment[]
  /** The benchmark for a vehicle in a unit, or null. */
  benchmarkFor: (vehicleKey: string, unit: EnergyUnit) => FuelBenchmark | null
  settings?: FuelIntelligenceSettings
}

/**
 * Every exception rule. Each needs a minimum of data before it fires, and every message states a measurement — never
 * fraud, never a mechanical fault.
 */
export function detectExceptions(input: ExceptionInput): FuelException[] {
  const settings = input.settings ?? DEFAULT_FUEL_SETTINGS
  const out: FuelException[] = []
  const byVehicle = new Map<string, EngineFill[]>()
  for (const fill of input.fills) {
    const list = byVehicle.get(fill.vehicleKey)
    if (list) list.push(fill)
    else byVehicle.set(fill.vehicleKey, [fill])
  }

  for (const [vehicleKey, list] of byVehicle) {
    const sorted = [...list].sort(compareFills)

    // Odometer decrease — per VEHICLE, across energy units: the odometer does not care what went in the tank.
    let lastReading: EngineFill | null = null
    for (const fill of sorted) {
      if (!isNum(fill.odometerKm)) continue
      if (lastReading && isNum(lastReading.odometerKm) && fill.odometerKm < lastReading.odometerKm && !fill.odometerOverride) {
        const diff = lastReading.odometerKm - fill.odometerKm
        out.push({
          kind: 'odometer_decrease', severity: 'warning', vehicleKey, fillId: fill.id, date: fill.date,
          value: fill.odometerKm, expected: lastReading.odometerKm, variance: -diff,
          message: `Odometer ${formatNumber(fill.odometerKm)} km is ${formatNumber(diff)} km lower than the previous reading (${formatNumber(lastReading.odometerKm)} km on ${lastReading.date}).`,
        })
      }
      lastReading = fill
    }

    // Above configured tank capacity.
    for (const fill of sorted) {
      const capacity = input.benchmarkFor(vehicleKey, fill.unit)?.tankCapacity
      if (!isNum(capacity) || capacity <= 0) continue
      if (fill.quantity > capacity * (1 + settings.tankTolerancePct / 100)) {
        out.push({
          kind: 'above_tank_capacity', severity: 'warning', vehicleKey, fillId: fill.id, date: fill.date,
          value: fill.quantity, expected: capacity, variance: fill.quantity - capacity,
          message: `${formatQuantity(fill.quantity, fill.unit)} entered; the configured tank capacity is ${formatQuantity(capacity, fill.unit)}.`,
        })
      }
    }

    // Refuelling frequency.
    const flaggedWindows = new Set<string>()
    for (const fill of sorted) {
      const end = ymdToUtc(fill.date)
      const start = end - (settings.refuelWindowDays - 1) * DAY_MS
      const inWindow = sorted.filter((f) => ymdToUtc(f.date) >= start && ymdToUtc(f.date) <= end && compareFills(f, fill) <= 0)
      if (inWindow.length > settings.refuelMaxFillsInWindow && !flaggedWindows.has(inWindow[0].id)) {
        flaggedWindows.add(inWindow[0].id)
        out.push({
          kind: 'refuel_frequency', severity: 'warning', vehicleKey, fillId: fill.id, date: fill.date,
          value: inWindow.length, expected: settings.refuelMaxFillsInWindow, variance: inWindow.length - settings.refuelMaxFillsInWindow,
          message: `${inWindow.length} fills within ${settings.refuelWindowDays} day${settings.refuelWindowDays === 1 ? '' : 's'}.`,
        })
      }
    }

    // Possible duplicate: same vehicle, date and quantity.
    const seen = new Map<string, EngineFill>()
    for (const fill of sorted) {
      const key = `${fill.date}|${fill.unit}|${fill.quantity.toFixed(2)}`
      const first = seen.get(key)
      if (first) {
        out.push({
          kind: 'possible_duplicate', severity: 'warning', vehicleKey, fillId: fill.id, date: fill.date,
          value: fill.quantity, expected: null, variance: null,
          message: `Same vehicle, date and quantity as entry ${first.id}.`,
        })
      } else {
        seen.set(key, fill)
      }
    }
  }

  // Mileage drop and impossible mileage — per vehicle AND unit, against the vehicle's own recent history.
  const streams = new Map<string, MileageSegment[]>()
  for (const segment of input.segments) {
    if (!segment.usable) continue
    const key = `${segment.vehicleKey} ${segment.unit}`
    const list = streams.get(key)
    if (list) list.push(segment)
    else streams.set(key, [segment])
  }
  for (const list of streams.values()) {
    const ordered = [...list].sort((a, b) => (a.closedOn !== b.closedOn ? (a.closedOn < b.closedOn ? -1 : 1) : a.closingSequence - b.closingSequence))
    const fullOnly = ordered.filter((s) => s.kind === 'full_tank')
    fullOnly.forEach((segment, i) => {
      const prior = fullOnly.slice(Math.max(0, i - settings.mileageBaselineSegments), i)
      if (prior.length < settings.mileageBaselineSegments) return
      const baseline = median(prior.map((s) => s.efficiency as number))
      const eff = segment.efficiency as number
      if (baseline && eff < baseline * (1 - settings.mileageDropPct / 100)) {
        const pct = Math.round((1 - eff / baseline) * 100)
        out.push({
          kind: 'mileage_drop', severity: 'warning', vehicleKey: segment.vehicleKey, fillId: segment.closingFillId, date: segment.closedOn,
          value: eff, expected: baseline, variance: eff - baseline,
          message: `Mileage ${formatEfficiency(eff, segment.unit)} is ${pct}% below this vehicle's recent ${formatEfficiency(baseline, segment.unit)}.`,
        })
      }
    })
    ordered.forEach((segment) => {
      const benchmark = input.benchmarkFor(segment.vehicleKey, segment.unit)?.expectedEfficiency
      const earlier = fullOnly.filter((s) => compareSegments(s, segment) < 0).slice(-settings.mileageBaselineSegments)
      const baseline = earlier.length >= settings.mileageBaselineSegments ? median(earlier.map((s) => s.efficiency as number)) : null
      const reference = isNum(benchmark) && benchmark > 0 ? benchmark : baseline
      const eff = segment.efficiency as number
      if (isNum(reference) && reference > 0 && eff > reference * settings.impossibleMileageMultiplier) {
        out.push({
          kind: 'impossible_mileage', severity: 'warning', vehicleKey: segment.vehicleKey, fillId: segment.closingFillId, date: segment.closedOn,
          value: eff, expected: reference, variance: eff - reference,
          message: `${formatEfficiency(eff, segment.unit)} is more than ${settings.impossibleMileageMultiplier}× the expected ${formatEfficiency(reference, segment.unit)} — possibly a data-entry error.`,
        })
      }
    })
  }

  // Price out of range — per energy unit, against the median of the fills given.
  const byUnit = new Map<EnergyUnit, { fill: EngineFill; price: number }[]>()
  for (const fill of input.fills) {
    const price = unitPrice(fill)
    if (price === null) continue
    const list = byUnit.get(fill.unit)
    if (list) list.push({ fill, price })
    else byUnit.set(fill.unit, [{ fill, price }])
  }
  for (const [unit, priced] of byUnit) {
    if (priced.length < settings.priceMinSamples) continue
    const mid = median(priced.map((p) => p.price)) as number
    for (const { fill, price } of priced) {
      const pct = ((price - mid) / mid) * 100
      if (Math.abs(pct) > settings.pricePctFromMedian) {
        out.push({
          kind: 'price_out_of_range', severity: 'info', vehicleKey: fill.vehicleKey, fillId: fill.id, date: fill.date,
          value: price, expected: mid, variance: price - mid,
          message: `₹${formatNumber(price, 2)}/${unit} is ${Math.round(Math.abs(pct))}% ${pct > 0 ? 'above' : 'below'} the period's median of ₹${formatNumber(mid, 2)}/${unit}.`,
        })
      }
    }
  }

  return out.sort((a, b) => (a.severity !== b.severity ? (a.severity === 'warning' ? -1 : 1) : a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function compareSegments(a: MileageSegment, b: MileageSegment): number {
  if (a.closedOn !== b.closedOn) return a.closedOn < b.closedOn ? -1 : 1
  return a.closingSequence - b.closingSequence
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── entry preview */

export type FuelEntryDraft = {
  vehicleKey: string
  /** False for a genset, stock yard or other asset: no odometer, no mileage, no full-tank question. */
  isVehicle: boolean
  energyType: EnergyType
  unit: EnergyUnit
  date: string
  quantity: number | null
  totalCost: number | null
  odometerKm: number | null
  isFullTank: boolean | null
}

export type FuelEntryContext = {
  /** The vehicle's latest earlier fill that has an odometer reading, in any unit. */
  previousReading: EngineFill | null
  /** The latest earlier FULL fill in this unit with no full fill after it. */
  openFullTank: EngineFill | null
  /** Fills in this unit after `openFullTank`. */
  fillsSinceFullTank: readonly EngineFill[]
  tankCapacity: number | null
  expectedEfficiency: number | null
  baselineEfficiency: number | null
}

export type EntryIssue = {
  code: 'quantity' | 'total_cost' | 'odometer_missing' | 'odometer_negative' | 'full_tank_missing' | 'odometer_decrease' | 'above_tank_capacity' | 'impossible_mileage'
  level: 'error' | 'warning'
  /** A warning an authorised person must explicitly accept before it saves. */
  requiresOverride: boolean
  message: string
}

export type FuelEntryPreview = {
  distanceSincePreviousKm: number | null
  efficiency: number | null
  efficiencyBasis: 'full_tank' | 'provisional' | null
  efficiencyLabel: string
  cost: number | null
  unitPrice: number | null
  costPerKm: number | null
}

/**
 * What a new entry will record, and what is wrong with it — shown BEFORE it is saved, from the same rules the module
 * uses afterwards. Errors block; warnings explain; an odometer lower than the last reading needs an authorised override.
 */
export function previewFuelEntry(
  draft: FuelEntryDraft,
  context: FuelEntryContext,
  settings: FuelIntelligenceSettings = DEFAULT_FUEL_SETTINGS,
): { issues: EntryIssue[]; preview: FuelEntryPreview } {
  const issues: EntryIssue[] = []
  const error = (code: EntryIssue['code'], message: string) => issues.push({ code, level: 'error', requiresOverride: false, message })

  if (!isNum(draft.quantity) || draft.quantity <= 0) error('quantity', `Enter the quantity filled, in ${draft.unit}.`)
  if (!isNum(draft.totalCost) || draft.totalCost <= 0) error('total_cost', 'Enter the total amount on the receipt.')
  if (draft.isVehicle) {
    if (!isNum(draft.odometerKm)) error('odometer_missing', 'Enter the odometer reading.')
    else if (draft.odometerKm < 0) error('odometer_negative', 'The odometer reading cannot be negative.')
    if (draft.isFullTank === null) error('full_tank_missing', 'Say whether the tank was filled full.')
  }

  const quantity = isNum(draft.quantity) && draft.quantity > 0 ? draft.quantity : null
  const odometer = draft.isVehicle && isNum(draft.odometerKm) && draft.odometerKm >= 0 ? draft.odometerKm : null
  const previous = context.previousReading
  const distanceSincePreviousKm = odometer !== null && previous && isNum(previous.odometerKm) ? odometer - previous.odometerKm : null

  if (distanceSincePreviousKm !== null && distanceSincePreviousKm < 0 && previous) {
    issues.push({
      code: 'odometer_decrease', level: 'warning', requiresOverride: true,
      message: `The odometer is ${formatNumber(-distanceSincePreviousKm)} km lower than the previous reading (${formatNumber(previous.odometerKm as number)} km on ${previous.date}). Confirm it is a correction to save it.`,
    })
  }
  if (quantity !== null && isNum(context.tankCapacity) && context.tankCapacity > 0 && quantity > context.tankCapacity * (1 + settings.tankTolerancePct / 100)) {
    issues.push({
      code: 'above_tank_capacity', level: 'warning', requiresOverride: true,
      message: `${formatQuantity(quantity, draft.unit)} is more than the configured tank capacity of ${formatQuantity(context.tankCapacity, draft.unit)}.`,
    })
  }

  let efficiency: number | null = null
  let efficiencyBasis: FuelEntryPreview['efficiencyBasis'] = null
  let costPerKm: number | null = null
  const cost = isNum(draft.totalCost) && draft.totalCost > 0 ? draft.totalCost : null

  const open = context.openFullTank
  if (draft.isVehicle && quantity !== null && odometer !== null && draft.isFullTank === true && open && isNum(open.odometerKm)) {
    const partials = context.fillsSinceFullTank.filter((f) => f.unit === draft.unit)
    const readings = [open, ...partials].map((f) => f.odometerKm).filter(isNum).concat(odometer)
    const distance = odometer - open.odometerKm
    const clean = readings.every((r, i) => i === 0 || r >= readings[i - 1]) && !partials.some((f) => f.odometerOverride)
    if (clean && distance >= settings.minSegmentDistanceKm) {
      const fuel = sum(partials.map((f) => f.quantity)) + quantity
      efficiency = distance / fuel
      efficiencyBasis = 'full_tank'
      const partialCosts = partials.map((f) => f.totalCost)
      costPerKm = cost !== null && partialCosts.every(isNum) ? (sum(partialCosts as number[]) + cost) / distance : null
    }
  }
  if (efficiency === null && draft.isVehicle && quantity !== null && draft.isFullTank !== false && isNum(distanceSincePreviousKm) && distanceSincePreviousKm >= settings.minSegmentDistanceKm) {
    efficiency = distanceSincePreviousKm / quantity
    efficiencyBasis = 'provisional'
    costPerKm = cost !== null ? cost / distanceSincePreviousKm : null
  }

  const reference = isNum(context.expectedEfficiency) && context.expectedEfficiency > 0 ? context.expectedEfficiency : context.baselineEfficiency
  if (efficiency !== null && isNum(reference) && reference > 0 && efficiency > reference * settings.impossibleMileageMultiplier) {
    issues.push({
      code: 'impossible_mileage', level: 'warning', requiresOverride: true,
      message: `${formatEfficiency(efficiency, draft.unit)} is more than ${settings.impossibleMileageMultiplier}× the expected ${formatEfficiency(reference, draft.unit)} — check the odometer and quantity.`,
    })
  }

  return {
    issues,
    preview: {
      distanceSincePreviousKm,
      efficiency,
      efficiencyBasis,
      efficiencyLabel: efficiencyUnitLabel(draft.unit),
      cost,
      unitPrice: cost !== null && quantity !== null ? cost / quantity : null,
      costPerKm,
    },
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────── attention + narrative */

/** Plain reasons a vehicle needs a look. Empty when it does not. */
export function attentionReasons(input: {
  summary: VehicleMileageSummary
  assessment: EfficiencyAssessment
  exceptions: readonly FuelException[]
  costPerKmChangePct: number | null
  settings?: FuelIntelligenceSettings
}): string[] {
  const settings = input.settings ?? DEFAULT_FUEL_SETTINGS
  const reasons: string[] = []
  const { summary, assessment } = input
  if ((assessment.status === 'poor' || assessment.status === 'watch') && isNum(assessment.actual) && isNum(assessment.expected)) {
    reasons.push(`Mileage ${formatEfficiency(assessment.actual, summary.unit)} is ${Math.round(assessment.efficiencyPct as number)}% of the expected ${formatEfficiency(assessment.expected, summary.unit)}.`)
  }
  if (summary.declining) {
    reasons.push(`Mileage declining over the last ${summary.lastRefuels.length >= settings.decliningTrendSegments ? settings.decliningTrendSegments : summary.lastRefuels.length} refuels.`)
  }
  for (const exception of input.exceptions) {
    if (exception.severity === 'warning') reasons.push(exception.message)
  }
  if (isNum(input.costPerKmChangePct) && input.costPerKmChangePct >= settings.costPerKmRisePct) {
    reasons.push(`Fuel cost per km up ${Math.round(input.costPerKmChangePct)}%.`)
  }
  return reasons
}

export type FleetStreamFigures = { unit: EnergyUnit; quantity: number; distanceKm: number; spend: number | null }

/**
 * The sentences that say what the numbers mean. Each states only what its inputs support — no cost sentence without
 * receipt totals, no mileage without distance, no "below expected" without benchmarks.
 */
export function describeFleetPeriod(input: {
  streams: readonly FleetStreamFigures[]
  vehiclesBelowExpected: number
  benchmarksConfigured: boolean
  spendBefore: number | null
  spendAfter: number | null
  breakdown: CostChangeBreakdown | null
}): string[] {
  const sentences: string[] = []
  for (const s of input.streams) {
    if (s.quantity <= 0) continue
    if (s.distanceKm > 0) {
      const eff = s.distanceKm / s.quantity
      const perKm = isNum(s.spend) && s.spend > 0 ? ` at ${formatCostPerKm(s.spend / s.distanceKm)}` : ''
      sentences.push(`${formatQuantity(s.quantity, s.unit)} consumed across ${formatNumber(s.distanceKm)} km, averaging ${formatEfficiency(eff, s.unit)}${perKm}.`)
    } else {
      sentences.push(`${formatQuantity(s.quantity, s.unit)} consumed, with no usable distance between fills yet, so mileage is unavailable.`)
    }
    if (!isNum(s.spend)) sentences.push('Cost is unavailable: no receipt amounts were recorded for this fuel.')
  }

  if (!input.benchmarksConfigured) sentences.push('No expected mileage is set yet, so no vehicle is marked below expected.')
  else if (input.vehiclesBelowExpected === 0) sentences.push('No vehicle is below its expected efficiency.')
  else if (input.vehiclesBelowExpected === 1) sentences.push('1 vehicle is below its expected efficiency.')
  else sentences.push(`${input.vehiclesBelowExpected} vehicles are below their expected efficiency.`)

  if (isNum(input.spendBefore) && isNum(input.spendAfter) && input.spendBefore > 0) {
    const change = input.spendAfter - input.spendBefore
    const pct = Math.round((Math.abs(change) / input.spendBefore) * 100)
    if (change === 0 || pct === 0) {
      sentences.push('Fuel spend is unchanged from the previous period.')
    } else {
      const direction = change > 0 ? 'rose' : 'fell'
      let because = ''
      const b = input.breakdown
      if (b) {
        const sign = Math.sign(b.total)
        const parts: [keyof Omit<CostChangeBreakdown, 'total'>, number][] = [['distance', b.distance], ['price', b.price], ['efficiency', b.efficiency]]
        const driver = parts.filter(([, v]) => Math.sign(v) === sign).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]
        const phrase: Record<string, [string, string]> = {
          distance: ['more distance travelled', 'less distance travelled'],
          price: ['higher fuel prices', 'lower fuel prices'],
          efficiency: ['lower fuel efficiency', 'better fuel efficiency'],
        }
        if (driver) because = `, mainly because of ${phrase[driver[0]][sign > 0 ? 0 : 1]}`
      }
      sentences.push(`Fuel spend ${direction} ${pct}% compared with the previous period${because}.`)
    }
  }
  return sentences
}
