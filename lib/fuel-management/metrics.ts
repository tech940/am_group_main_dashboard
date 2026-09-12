/**
 * Fuel Management — every figure and every "needs a look" flag, as PURE functions.
 *
 * No database, no clock, no 'server-only'. ./reconciliation.ts reads the rows and hands them here, and
 * scripts/verify-fuel-management.ts tests this file against the real labels. The only imports are the import-free
 * plate helpers in lib/loconav/matching.ts and the types.
 *
 * ── What the data is actually like (measured live, 2026-09-11) ─────────────────────────────────────────────
 *  - fuel_approvals.vin_no is NEVER a VIN: 0 of 20 are 17 characters. It holds a VIN's last 6 digits ('686082'), a
 *    plate ('jk02du7070') or free text ('Stock yad'). veh_reg_no is a dropdown label such as
 *    'DEMO MORNING HAZE SELTOS -MORNING HAZE-PETROL-JK02DU7070', or 'Stock transfer', or a VIN tail.
 *  - ⚠️ A plate is NOT an identity. Trade plate JK02C0059TC is on five demo cars and on passes for three different
 *    VINs. So a fill is tied to a car only on evidence that names exactly one car, and gate passes are tied to
 *    cars by VIN only — never by plate. The previous version keyed cars by plate with a fuzzy "contains" match,
 *    which merged cars and put fuel on the wrong one.
 *  - Fuel covers ALL driving, not only demo drives, so "demo-drive km ÷ litres filled" measures nothing. km per
 *    litre here is fill-to-fill on the car's own odometer. There are no efficiency labels, thresholds or rupee
 *    costs: nothing in the data supports them, and the fixed 10/6 km/L bands and per-litre prices that used to be
 *    here were invented.
 *  - Only one fill per vehicle exists so far, so every km per litre is null with its note today. That is the
 *    honest answer, not a bug.
 */

import { extractPlateTokens, normalisePlate } from '../loconav/matching'
import type {
  DemoCarDrive,
  DemoCarFill,
  DemoCarFuelSummary,
  DemoFleetCarInput,
  DrivePassInput,
  FuelAwaitingStage,
  FuelBranchEnergySummary,
  FuelCheck,
  FuelCheckKind,
  FuelCheckSeverity,
  FuelEnergyTypeSummary,
  FuelManagementBranch,
  FuelManagementInput,
  FuelManagementPeriod,
  FuelManagementResponse,
  FuelPurposeEnergyMatrixRow,
  FuelPurposeSummary,
  FuelRowInput,
  GateReadingInput,
  OtherFuelRow,
  UnmatchedDemoReason,
} from './types'

// ── Period ──────────────────────────────────────────────────────────────────────────────────────────

export const FUEL_MANAGEMENT_BRANCHES: readonly FuelManagementBranch[] = ['ALL', 'JK402', 'JK501']
/** Both ends counted, so a leap year fits. */
export const MAX_PERIOD_DAYS = 366

const DAY_MS = 86_400_000
const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isFuelManagementBranch(value: unknown): value is FuelManagementBranch {
  return typeof value === 'string' && (FUEL_MANAGEMENT_BRANCHES as readonly string[]).includes(value)
}

/** UTC midnight of a real calendar day, or null — '2026-02-30' is refused, not rolled into March. */
function ymdToUtcMs(value: string): number | null {
  if (!YMD_PATTERN.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const ms = Date.UTC(year, month - 1, day)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return ms
}

export type FuelManagementPeriodResult =
  | { ok: true; period: FuelManagementPeriod }
  | { ok: false; error: string }

/**
 * The period and branch a request asks for. `todayIstYmd` is today's India calendar day (getIndiaYmd()), passed in
 * so this stays pure.
 *
 *  - Neither date sent → the current India month to date.
 *  - Only one sent → refused, not guessed.
 *  - Both must be real calendar days, from <= to, spanning at most MAX_PERIOD_DAYS days (both ends counted).
 *  - branch absent → 'ALL'; anything other than ALL | JK402 | JK501 is refused.
 */
export function resolveFuelManagementPeriod(
  params: { from?: string | null; to?: string | null; branch?: string | null },
  todayIstYmd: string,
): FuelManagementPeriodResult {
  const from = String(params.from ?? '').trim()
  const to = String(params.to ?? '').trim()
  const branch = String(params.branch ?? '').trim().toUpperCase() || 'ALL'

  if (!isFuelManagementBranch(branch)) {
    return { ok: false, error: 'Branch must be All, Jammu (JK402) or Udhampur (JK501).' }
  }

  if (!from && !to) {
    return { ok: true, period: { from: `${todayIstYmd.slice(0, 8)}01`, to: todayIstYmd, branch } }
  }
  if (!from || !to) return { ok: false, error: 'Choose both a start date and an end date.' }

  const fromMs = ymdToUtcMs(from)
  const toMs = ymdToUtcMs(to)
  if (fromMs === null || toMs === null) {
    return { ok: false, error: 'Dates must be real calendar dates written as YYYY-MM-DD.' }
  }
  if (fromMs > toMs) return { ok: false, error: 'The start date must be on or before the end date.' }
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    return { ok: false, error: `Choose a period of ${MAX_PERIOD_DAYS} days or less.` }
  }

  return { ok: true, period: { from, to, branch } }
}

// ── Field readers ───────────────────────────────────────────────────────────────────────────────────

/**
 * An odometer reading from current_km_reading (TEXT), or null.
 *
 * Commas, whitespace and a trailing "km" are dropped; what is left must be digits with at most one decimal point.
 * Anything else — '', 'NA', '10207/10210', '1.2.3' — is null: an unreadable reading is missing, never guessed.
 *
 * ⚠️ ./reconciliation.ts restates this exact test in SQL (hasUsableOdometer) to find earlier fills that carry a
 * reading. Change the two together.
 */
export function parseOdometerKm(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim().replace(/[,\s]/g, '').replace(/km$/i, '')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const km = Number(text)
  return Number.isFinite(km) ? km : null
}

export const DEMO_PURPOSE = 'DEMO'

/** 'Stock  transfer ' → 'STOCK TRANSFER'. The stored values use spaces, not underscores. */
export function normalisePurpose(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
}

const KEEP_UPPER_CASE = new Set(['CPO', 'EV', 'KIA'])

/** 'STOCK TRANSFER' → 'Stock Transfer'; 'PAINT BOOTH -KIA -GANYAL' → 'Paint Booth -KIA -Ganyal'. */
export function titleCase(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      const letters = word.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
      if (KEEP_UPPER_CASE.has(letters)) return word.toUpperCase()
      return word.toLowerCase().replace(/^([^a-z0-9]*)([a-z])/, (_match, lead: string, first: string) => lead + first.toUpperCase())
    })
    .join(' ')
}

function purposeLabel(purposeKey: string): string {
  return purposeKey ? titleCase(purposeKey) : 'Purpose not recorded'
}

export function normaliseStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

const NOT_AWAITING_STATUSES = new Set(['approved', 'rejected', 'sent_back'])

/** Awaiting = anything not approved, rejected or sent back. Held requests are still awaiting a decision. */
export function isAwaitingStatus(status: unknown): boolean {
  return !NOT_AWAITING_STATUSES.has(normaliseStatus(status))
}

/** Workflow order today (CEO, Accounts), then the legacy stages older rows can still carry. */
const STAGE_ORDER = ['ceo', 'accounts', 'ea', 'md', 'ed', 'hr'] as const
const STAGE_LABELS: Record<string, string> = { ceo: 'CEO', accounts: 'Accounts', ea: 'EA', md: 'MD', ed: 'ED', hr: 'HR' }

export function fuelStageLabel(stage: unknown): string {
  const key = String(stage ?? '').trim().toLowerCase()
  if (!key) return 'Stage not recorded'
  return STAGE_LABELS[key] ?? titleCase(key.replace(/_/g, ' '))
}

/**
 * The KIA dealer code a fuel location belongs to: naming UDHAMPUR → JK501, else naming JAMMU → JK402, else null
 * ('KIA BANIHAL' belongs to neither branch filter).
 *
 * ⚠️ ./reconciliation.ts restates this in SQL (fuelAtBranch). Change the two together.
 */
export function fuelBranchOfLocation(location: unknown): 'JK402' | 'JK501' | null {
  const text = String(location ?? '').toUpperCase()
  if (text.includes('UDHAMPUR')) return 'JK501'
  if (text.includes('JAMMU')) return 'JK402'
  return null
}

export function vinKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

// ── Matching a DEMO fill to a demo car ──────────────────────────────────────────────────────────────

export type DemoFleetIndex = {
  byVin: ReadonlyMap<string, DemoFleetCarInput>
  /** Normalised plate → every demo car carrying it. */
  byPlate: ReadonlyMap<string, readonly DemoFleetCarInput[]>
}

export function indexDemoFleet(fleet: readonly DemoFleetCarInput[]): DemoFleetIndex {
  const byVin = new Map<string, DemoFleetCarInput>()
  const byPlate = new Map<string, DemoFleetCarInput[]>()
  for (const listed of fleet) {
    const vin = vinKey(listed.vin)
    if (!vin || byVin.has(vin)) continue
    const car = { ...listed, vin }
    byVin.set(vin, car)
    const plate = normalisePlate(car.registrationNumber)
    if (plate) byPlate.set(plate, [...(byPlate.get(plate) ?? []), car])
  }
  return { byVin, byPlate }
}

export type DemoMatchEvidence = 'plate' | 'vin' | 'vin_tail'

export type UnmatchedDemoFill = {
  matched: false
  reason: UnmatchedDemoReason
  /** Every plate found in the two labels. */
  plates: string[]
  /** The plates among them that more than one demo car carries. */
  sharedPlates: string[]
  /** How many demo cars carry the most-shared of those plates. */
  sharedPlateCarCount: number
  /** vin_no, when it was tried as a full VIN or a VIN tail and named no single demo car. */
  vinText: string | null
}

export type DemoFillMatch = { matched: true; vin: string; via: DemoMatchEvidence[] } | UnmatchedDemoFill

export const MIN_VIN_TAIL_LENGTH = 6
const FULL_VIN_LENGTH = 17

/**
 * Which demo car a DEMO fill is for — or why it cannot be said.
 *
 * Each of these NOMINATES a car:
 *  (a) a plate found in veh_reg_no or vin_no that exactly ONE demo car carries, and that car's plate is not marked
 *      shared;
 *  (b) vin_no, stripped to letters and digits, is a full 17-character demo VIN;
 *  (c) vin_no is 6+ letters/digits (and not itself a plate) that exactly ONE demo VIN ends with.
 *
 * The fill is tied to a car only when the nominations name exactly one car AND nothing on the fill points at a
 * different one — a shared plate the nominated car does not carry, or a VIN tail several cars end with that
 * excludes it. A plate carried by several cars nominates nobody: trade plate JK02C0059TC is on five.
 *
 * Unmatched reasons, most specific first: 'ambiguous' (evidence names several cars), 'shared_plate',
 * 'plate_not_in_demo_fleet' (a plate, but no demo car carries it), 'no_plate_in_label'.
 */
export function matchDemoFill(labels: { vehRegNo: unknown; vinNo: unknown }, fleet: DemoFleetIndex): DemoFillMatch {
  const plates = [...extractPlateTokens(labels.vehRegNo, labels.vinNo)]
  const candidates = new Map<string, Set<DemoMatchEvidence>>()
  const nominate = (vin: string, via: DemoMatchEvidence) => {
    candidates.set(vin, (candidates.get(vin) ?? new Set<DemoMatchEvidence>()).add(via))
  }

  // (a)
  const sharedPlates: string[] = []
  let sharedPlateCarCount = 0
  for (const plate of plates) {
    const cars = fleet.byPlate.get(plate) ?? []
    if (cars.length === 0) continue
    if (cars.length === 1 && !cars[0].sharedPlate) {
      nominate(cars[0].vin, 'plate')
    } else {
      sharedPlates.push(plate)
      sharedPlateCarCount = Math.max(sharedPlateCarCount, cars.length)
    }
  }

  // (b) and (c)
  const rawVin = String(labels.vinNo ?? '').trim().toUpperCase()
  const compactVin = rawVin.replace(/[^A-Z0-9]/g, '')
  let vinText: string | null = null
  let tailVins: string[] = []
  if (compactVin.length === FULL_VIN_LENGTH) {
    if (fleet.byVin.has(compactVin)) nominate(compactVin, 'vin')
    else vinText = compactVin
  } else if (
    /^[A-Z0-9]+$/.test(rawVin)
    && rawVin.length >= MIN_VIN_TAIL_LENGTH
    && rawVin.length < FULL_VIN_LENGTH
    && extractPlateTokens(rawVin).size === 0
  ) {
    tailVins = [...fleet.byVin.keys()].filter((vin) => vin.endsWith(rawVin))
    if (tailVins.length === 1) nominate(tailVins[0], 'vin_tail')
    else vinText = rawVin
  }

  const unmatched = (reason: UnmatchedDemoReason): UnmatchedDemoFill => ({
    matched: false,
    reason,
    plates,
    sharedPlates,
    sharedPlateCarCount,
    vinText,
  })

  if (candidates.size === 1) {
    const [[vin, via]] = [...candidates]
    const carPlate = normalisePlate(fleet.byVin.get(vin)?.registrationNumber)
    const sharedPlateOfAnotherCar = sharedPlates.some((plate) => plate !== carPlate)
    const tailExcludesThisCar = tailVins.length > 1 && !tailVins.includes(vin)
    if (!sharedPlateOfAnotherCar && !tailExcludesThisCar) return { matched: true, vin, via: [...via] }
    return unmatched('ambiguous')
  }
  if (candidates.size > 1) return unmatched('ambiguous')
  if (sharedPlates.length > 0) return unmatched('shared_plate')
  if (tailVins.length > 1) return unmatched('ambiguous')
  if (plates.length > 0) return unmatched('plate_not_in_demo_fleet')
  return unmatched('no_plate_in_label')
}

// ── Labels and wording ──────────────────────────────────────────────────────────────────────────────

/** The vehicle text as entered: veh_reg_no, plus vin_no when it adds something. */
export function fuelVehicleLabel(vehRegNo: unknown, vinNo: unknown): string {
  const name = String(vehRegNo ?? '').trim().replace(/\s+/g, ' ')
  const vin = String(vinNo ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return vin || 'Vehicle not recorded'
  if (!vin || normalisePlate(name).includes(normalisePlate(vin))) return name
  return `${name} · ${vin}`
}

/** 'JK02DU0770 · Seltos', or 'VIN …013434 · Seltos' when the car has no plate on record. */
export function demoCarLabel(car: Pick<DemoFleetCarInput, 'vin' | 'registrationNumber' | 'model'>): string {
  const id = car.registrationNumber?.trim() || `VIN …${car.vin.slice(-6)}`
  const model = car.model?.trim()
  return model ? `${id} · ${titleCase(model)}` : id
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-09-07' → '07 Sep 2026'. A calendar day, so no timezone is involved. */
export function formatFillDate(ymd: string): string {
  const [year, month, day] = ymd.split('-')
  const name = MONTHS[Number(month) - 1]
  return name && day && year ? `${day} ${name} ${year}` : ymd
}

const KM_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
const LITRE_FORMAT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

export function unmatchedDemoFillMessage(match: UnmatchedDemoFill): string {
  switch (match.reason) {
    case 'shared_plate': {
      const plates = match.sharedPlates.join(', ')
      const cars = match.sharedPlateCarCount > 1 ? ` on ${match.sharedPlateCarCount} demo cars` : ''
      const verb = match.sharedPlates.length === 1 ? 'is a shared plate' : 'are shared plates'
      return `${plates} ${verb}${cars}, so this fill cannot be tied to one car. The last 6 digits of the VIN in the VIN field would identify it.`
    }
    case 'plate_not_in_demo_fleet': {
      const verb = match.plates.length === 1 ? 'is' : 'are'
      return `${match.plates.join(', ')} ${verb} not on the demo car list, so this fill is not tied to a demo car.`
    }
    case 'ambiguous':
      return 'The vehicle details on this fill could belong to more than one demo car, so it is not tied to any of them.'
    case 'no_plate_in_label':
      if (!match.vinText) return 'No registration number or VIN on this fill, so it is not tied to a demo car.'
      return match.vinText.length === FULL_VIN_LENGTH
        ? `No registration number on this fill, and ${match.vinText} is not a demo car's VIN, so it is not tied to a car.`
        : `No registration number on this fill, and "${match.vinText}" is not the end of any demo car's VIN, so it is not tied to a car.`
  }
}

export function missingOdometerMessage(kmReadingText: string | null): string {
  const text = String(kmReadingText ?? '').trim()
  if (!text) return 'No odometer reading on this demo fill, so it cannot count towards km per litre.'
  const shown = text.length > 40 ? `${text.slice(0, 40)}…` : text
  return `The odometer reading "${shown}" is not a number, so this demo fill cannot count towards km per litre.`
}

// ── Figures ─────────────────────────────────────────────────────────────────────────────────────────

export const KM_PER_LITRE_NOTE = {
  needsSecondFill: 'Needs a second fill with an odometer reading.',
  goesBackwards: 'Odometer readings go backwards — see Needs a look.',
} as const

/** A gate reading may run this far past the reading on a later fill before it is called a mismatch. */
export const GATE_ODOMETER_TOLERANCE_KM = 5

/** Litres as whole hundredths — numeric(10,2) summed without floating-point drift. */
const toHundredths = (litres: number) => Math.round(litres * 100)
const round1 = (value: number) => Math.round(value * 10) / 10
const round2 = (value: number) => Math.round(value * 100) / 100

/** gate_in_odo − gate_out_odo, when both are present and the answer is not negative. */
export function driveOdometerKm(pass: Pick<DrivePassInput, 'gateOutOdo' | 'gateInOdo'>): number | null {
  const { gateOutOdo, gateInOdo } = pass
  if (gateOutOdo === null || gateInOdo === null) return null
  if (!Number.isFinite(gateOutOdo) || !Number.isFinite(gateInOdo)) return null
  const km = gateInOdo - gateOutOdo
  return km >= 0 ? round1(km) : null
}

/**
 * Fill-to-fill km per litre over a car's APPROVED fills, oldest first. Fills without a reading are skipped.
 *
 * Fill 1 fills the tank at reading R1; the fuel of fills 2..n is what was burned to get from R1 to Rn. So the
 * value is (Rn − R1) ÷ litres of fills 2..n — the first fill's own litres were burned before R1 and do not count.
 */
export function fillToFillKmPerLitre(
  approvedFills: ReadonlyArray<{ odometerKm: number | null; litres: number }>,
): { kmPerLitre: { value: number; fillsUsed: number } | null; note: string | null } {
  const readings: Array<{ odometerKm: number; litres: number }> = []
  for (const fill of approvedFills) {
    if (fill.odometerKm !== null) readings.push({ odometerKm: fill.odometerKm, litres: fill.litres })
  }
  if (readings.length < 2) return { kmPerLitre: null, note: KM_PER_LITRE_NOTE.needsSecondFill }

  for (let i = 1; i < readings.length; i += 1) {
    if (readings[i].odometerKm < readings[i - 1].odometerKm) {
      return { kmPerLitre: null, note: KM_PER_LITRE_NOTE.goesBackwards }
    }
  }

  const litresAfterFirst = readings.slice(1).reduce((sum, fill) => sum + toHundredths(fill.litres), 0) / 100
  if (!(litresAfterFirst > 0)) return { kmPerLitre: null, note: KM_PER_LITRE_NOTE.needsSecondFill }

  const km = readings[readings.length - 1].odometerKm - readings[0].odometerKm
  return { kmPerLitre: { value: round1(km / litresAfterFirst), fillsUsed: readings.length }, note: null }
}

type Row = FuelRowInput & {
  /** False for other-branch rows, which are comparison partners only. */
  inScope: boolean
  purposeKey: string
  approved: boolean
  awaiting: boolean
  odometerKm: number | null
  /** Only DEMO rows are tried against the demo fleet. */
  match: DemoFillMatch | null
}

type FillOrder = { date: string; createdAt: string; requestNumber: string }

const byFillOrder = (a: FillOrder, b: FillOrder) =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.requestNumber.localeCompare(b.requestNumber)

const matchedVinOf = (row: Row): string | null => (row.match && row.match.matched ? row.match.vin : null)

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

const SEVERITY_RANK: Record<FuelCheckSeverity, number> = { warning: 0, info: 1 }
const KIND_RANK: Record<FuelCheckKind, number> = {
  odometer_backwards: 0,
  gate_odometer_mismatch: 1,
  possible_duplicate: 2,
  unmatched_demo_fill: 3,
  missing_odometer: 4,
}

/**
 * The whole response, from rows already read.
 *
 * ⚠️ Two scopes, on purpose:
 *  - What is COUNTED and LISTED (KPIs, purposes, each car's fills, drives and litres, other fuel, the checks
 *    reported) comes only from `fuelRows` and `drives` — the period at the chosen branch.
 *  - What keeps a car's own record TRUE (km per litre, last fill, km since last fill, and the comparisons behind the
 *    checks) also reads the car's fills at other branches, its fill before the period, and its gate readings at any
 *    branch. Otherwise a fill hidden by the branch filter would inflate km per litre, and the same Jammu fill would
 *    be flagged under "All" but not under "Jammu".
 */
export function buildFuelManagementResponse(input: FuelManagementInput): FuelManagementResponse {
  const { period } = input
  const fleet = indexDemoFleet(input.demoFleet)
  const inPeriod = (date: string) => date >= period.from && date <= period.to

  const classify = (row: FuelRowInput, inScope: boolean): Row => {
    const purposeKey = normalisePurpose(row.purpose)
    const status = normaliseStatus(row.status)
    return {
      ...row,
      status,
      inScope,
      purposeKey,
      approved: status === 'approved',
      awaiting: isAwaitingStatus(status),
      odometerKm: parseOdometerKm(row.kmReadingText),
      match: purposeKey === DEMO_PURPOSE ? matchDemoFill(row, fleet) : null,
    }
  }

  const scoped = input.fuelRows.filter((row) => inPeriod(row.date)).map((row) => classify(row, true)).sort(byFillOrder)
  const scopedRequests = new Set(scoped.map((row) => row.requestNumber))
  const context = input.otherBranchFuelRows
    .filter((row) => inPeriod(row.date) && !scopedRequests.has(row.requestNumber) && normaliseStatus(row.status) !== 'rejected')
    .map((row) => classify(row, false))
  const allRows = [...scoped, ...context].sort(byFillOrder)

  // ── KPIs and purposes ──
  let approvedHundredths = 0
  let approvedRequests = 0
  const awaitingByStage = new Map<string, number>()
  const purposes = new Map<string, { approvedHundredths: number; approvedRequests: number; awaitingRequests: number }>()

  for (const row of scoped) {
    const purpose = purposes.get(row.purposeKey) ?? { approvedHundredths: 0, approvedRequests: 0, awaitingRequests: 0 }
    if (row.approved) {
      approvedHundredths += toHundredths(row.litres)
      approvedRequests += 1
      purpose.approvedHundredths += toHundredths(row.litres)
      purpose.approvedRequests += 1
    } else if (row.awaiting) {
      const stage = String(row.currentStage ?? '').trim().toLowerCase()
      awaitingByStage.set(stage, (awaitingByStage.get(stage) ?? 0) + 1)
      purpose.awaitingRequests += 1
    }
    purposes.set(row.purposeKey, purpose)
  }

  const stageRank = (stage: string) => {
    const rank = (STAGE_ORDER as readonly string[]).indexOf(stage)
    return rank === -1 ? STAGE_ORDER.length : rank
  }
  const byStage: FuelAwaitingStage[] = [...awaitingByStage]
    .map(([stage, count]) => ({ stage, label: fuelStageLabel(stage), count }))
    .sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.label.localeCompare(b.label))

  const byPurpose: FuelPurposeSummary[] = [...purposes]
    .filter(([, totals]) => totals.approvedRequests + totals.awaitingRequests > 0)
    .map(([purpose, totals]) => ({
      purpose,
      label: purposeLabel(purpose),
      approvedLitres: totals.approvedHundredths / 100,
      approvedRequests: totals.approvedRequests,
      awaitingRequests: totals.awaitingRequests,
    }))
    .sort((a, b) => b.approvedLitres - a.approvedLitres || b.awaitingRequests - a.awaitingRequests || a.label.localeCompare(b.label))

  // ── Gate readings, by VIN (any branch) ──
  const readingsInPeriod = new Map<string, GateReadingInput[]>()
  for (const reading of input.returnedInPeriod) {
    if (Number.isFinite(reading.gateInOdo)) pushTo(readingsInPeriod, vinKey(reading.vin), reading)
  }
  const readingsBeforePeriod = new Map<string, GateReadingInput[]>()
  for (const reading of input.highestReturnedBeforePeriod) {
    if (Number.isFinite(reading.gateInOdo)) pushTo(readingsBeforePeriod, vinKey(reading.vin), reading)
  }

  // ── Each car's approved fills in the period, any branch, oldest first ──
  const approvedFillsByVin = new Map<string, Row[]>()
  for (const row of allRows) {
    const vin = matchedVinOf(row)
    if (vin && row.approved) pushTo(approvedFillsByVin, vin, row)
  }

  // ── Each car's latest approved fill with a reading BEFORE the period ──
  const priorFillByVin = new Map<string, { requestNumber: string; date: string; createdAt: string; odometerKm: number }>()
  for (const prior of input.priorDemoFills) {
    if (prior.date >= period.from) continue
    const odometerKm = parseOdometerKm(prior.kmReadingText)
    if (odometerKm === null) continue
    const match = matchDemoFill(prior, fleet)
    if (!match.matched) continue
    const known = priorFillByVin.get(match.vin)
    if (!known || byFillOrder(prior, known) > 0) {
      priorFillByVin.set(match.vin, { requestNumber: prior.requestNumber, date: prior.date, createdAt: prior.createdAt, odometerKm })
    }
  }

  // ── Demo cars: a fill or a drive in scope puts a car on the list ──
  type CarActivity = { car: DemoFleetCarInput; fills: Row[]; drives: DrivePassInput[] }
  const cars = new Map<string, CarActivity>()
  const activityFor = (vin: string, describe: () => DemoFleetCarInput): CarActivity => {
    let activity = cars.get(vin)
    if (!activity) {
      activity = { car: fleet.byVin.get(vin) ?? describe(), fills: [], drives: [] }
      cars.set(vin, activity)
    }
    return activity
  }

  for (const row of scoped) {
    const vin = matchedVinOf(row)
    if (!vin || !(row.approved || row.awaiting)) continue
    activityFor(vin, () => ({ vin, registrationNumber: null, model: null, branchLabel: row.branchLabel, sharedPlate: false })).fills.push(row)
  }

  let demoDriveKm = 0
  let demoDrives = 0
  let gpsVerifiedKm = 0
  let gpsVerifiedDrives = 0
  for (const pass of input.drives) {
    const vin = vinKey(pass.vin)
    if (!vin) continue
    // A car that has left the demo list (sold) still drove: describe it from the pass's own snapshot.
    activityFor(vin, () => ({
      vin,
      registrationNumber: pass.registrationNumber?.trim() || null,
      model: pass.model?.trim() || null,
      branchLabel: pass.branchLabel,
      sharedPlate: false,
    })).drives.push(pass)

    const km = driveOdometerKm(pass)
    if (normaliseStatus(pass.status) === 'returned' && km !== null) {
      demoDrives += 1
      demoDriveKm += km
    }
    if (pass.gpsKm !== null && Number.isFinite(pass.gpsKm)) {
      gpsVerifiedDrives += 1
      gpsVerifiedKm += pass.gpsKm
    }
  }

  const demoCars: DemoCarFuelSummary[] = [...cars.values()].map(({ car, fills, drives }) => {
    const approvedFills = approvedFillsByVin.get(car.vin) ?? []
    const lastApproved = approvedFills.length > 0 ? approvedFills[approvedFills.length - 1] : null
    const { kmPerLitre, note } = fillToFillKmPerLitre(approvedFills)

    let kmSinceLastFill: number | null = null
    if (lastApproved && lastApproved.odometerKm !== null) {
      const since = (readingsInPeriod.get(car.vin) ?? []).filter(
        (reading) => reading.gateInYmd >= lastApproved.date && reading.gateInYmd <= period.to,
      )
      if (since.length > 0) {
        const km = Math.max(...since.map((reading) => reading.gateInOdo)) - lastApproved.odometerKm
        // Negative only when every later reading predates the fill on the same day: nothing driven since.
        kmSinceLastFill = km >= 0 ? round1(km) : null
      }
    }

    const fillRows: DemoCarFill[] = fills.map((fill) => ({
      requestNumber: fill.requestNumber,
      date: fill.date,
      litres: round2(fill.litres),
      odometerKm: fill.odometerKm,
      status: fill.status,
      statusLabel: fill.statusLabel,
    }))

    let driveKm = 0
    let gpsKm = 0
    const driveRows: DemoCarDrive[] = [...drives]
      .sort((a, b) => a.gateOutAt.localeCompare(b.gateOutAt) || a.passNo.localeCompare(b.passNo))
      .map((pass) => {
        const odometerKm = driveOdometerKm(pass)
        const status = normaliseStatus(pass.status)
        const passGpsKm = pass.gpsKm !== null && Number.isFinite(pass.gpsKm) ? pass.gpsKm : null
        if (status === 'returned' && odometerKm !== null) driveKm += odometerKm
        if (passGpsKm !== null) gpsKm += passGpsKm
        return { passNo: pass.passNo, gateOutAt: pass.gateOutAt, status, odometerKm, gpsKm: passGpsKm === null ? null : round1(passGpsKm) }
      })

    return {
      vin: car.vin,
      registrationNumber: car.registrationNumber,
      model: car.model,
      branchLabel: car.branchLabel,
      approvedLitres: fills.filter((fill) => fill.approved).reduce((sum, fill) => sum + toHundredths(fill.litres), 0) / 100,
      lastFillDate: lastApproved?.date ?? null,
      lastFillOdometerKm: lastApproved?.odometerKm ?? null,
      kmSinceLastFill,
      kmPerLitre,
      kmPerLitreNote: note,
      driveKm: round1(driveKm),
      gpsKm: round1(gpsKm),
      fills: fillRows,
      drives: driveRows,
    }
  })
  demoCars.sort(
    (a, b) => b.approvedLitres - a.approvedLitres || b.driveKm - a.driveKm || demoCarLabel(a).localeCompare(demoCarLabel(b)),
  )

  // ── Checks ──
  const pending: Array<FuelCheck & { date: string }> = []
  const vehicleLabelOf = (row: Row) => {
    const vin = matchedVinOf(row)
    const car = vin ? fleet.byVin.get(vin) : undefined
    return car ? demoCarLabel(car) : fuelVehicleLabel(row.vehRegNo, row.vinNo)
  }
  const flag = (kind: FuelCheckKind, severity: FuelCheckSeverity, row: Row, message: string) => {
    pending.push({ kind, severity, requestNumber: row.requestNumber, vin: matchedVinOf(row), vehicleLabel: vehicleLabelOf(row), message, date: row.date })
  }

  // odometer_backwards — each approved reading against the car's previous approved reading, which may be at
  // another branch or before the period.
  for (const [vin, approvedFills] of approvedFillsByVin) {
    let previous: { requestNumber: string; date: string; odometerKm: number } | null = priorFillByVin.get(vin) ?? null
    for (const fill of approvedFills) {
      if (fill.odometerKm === null) continue
      if (previous && fill.inScope && fill.odometerKm < previous.odometerKm) {
        flag(
          'odometer_backwards',
          'warning',
          fill,
          `Odometer ${KM_FORMAT.format(fill.odometerKm)} km is lower than the ${KM_FORMAT.format(previous.odometerKm)} km recorded on ${previous.requestNumber} (${formatFillDate(previous.date)}).`,
        )
      }
      previous = { requestNumber: fill.requestNumber, date: fill.date, odometerKm: fill.odometerKm }
    }
  }

  // gate_odometer_mismatch — a gate reading from a day BEFORE the fill that is already past the fill's reading.
  for (const { car, fills } of cars.values()) {
    const readings = [...(readingsBeforePeriod.get(car.vin) ?? []), ...(readingsInPeriod.get(car.vin) ?? [])]
    if (readings.length === 0) continue
    for (const fill of fills) {
      if (fill.odometerKm === null) continue
      let highest: GateReadingInput | null = null
      for (const reading of readings) {
        if (reading.gateInYmd >= fill.date) continue
        if (!highest || reading.gateInOdo > highest.gateInOdo || (reading.gateInOdo === highest.gateInOdo && reading.gateInAt > highest.gateInAt)) {
          highest = reading
        }
      }
      if (!highest) continue
      const gap = highest.gateInOdo - fill.odometerKm
      if (gap > GATE_ODOMETER_TOLERANCE_KM) {
        flag(
          'gate_odometer_mismatch',
          'warning',
          fill,
          `Odometer at fill is ${KM_FORMAT.format(fill.odometerKm)} km, but gate pass ${highest.passNo} came back on ${formatFillDate(highest.gateInYmd)} reading ${KM_FORMAT.format(highest.gateInOdo)} km — ${KM_FORMAT.format(round1(gap))} km more, before this fill.`,
        )
      }
    }
  }

  // possible_duplicate — same vehicle, same day, same litres. The earliest is taken as the original; each later one
  // is flagged.
  const duplicateGroups = new Map<string, Row[]>()
  for (const row of allRows) {
    if (row.status === 'rejected') continue
    const vin = matchedVinOf(row)
    const vehicle = vin ? `vin:${vin}` : `label:${normalisePlate(row.vehRegNo)}|${normalisePlate(row.vinNo)}`
    pushTo(duplicateGroups, `${vehicle}#${row.date}#${toHundredths(row.litres)}`, row)
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue
    const [original, ...repeats] = group
    for (const row of repeats) {
      if (!row.inScope) continue
      flag(
        'possible_duplicate',
        'warning',
        row,
        `Same vehicle, day and quantity as ${original.requestNumber}: ${LITRE_FORMAT.format(row.litres)} L on ${formatFillDate(row.date)}.`,
      )
    }
  }

  // unmatched_demo_fill and missing_odometer — DEMO rows that have not been rejected.
  for (const row of scoped) {
    if (row.purposeKey !== DEMO_PURPOSE || row.status === 'rejected') continue
    const match = row.match
    if (match && !match.matched) flag('unmatched_demo_fill', 'info', row, unmatchedDemoFillMessage(match))
    if (row.odometerKm === null) flag('missing_odometer', 'info', row, missingOdometerMessage(row.kmReadingText))
  }

  pending.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || b.date.localeCompare(a.date)
      || KIND_RANK[a.kind] - KIND_RANK[b.kind]
      || a.requestNumber.localeCompare(b.requestNumber),
  )
  const checks: FuelCheck[] = pending.map((check) => ({
    kind: check.kind,
    severity: check.severity,
    requestNumber: check.requestNumber,
    vin: check.vin,
    vehicleLabel: check.vehicleLabel,
    message: check.message,
  }))

  // ── Other fuel: everything that is not a demo fill, newest first ──
  const otherFuel: OtherFuelRow[] = scoped
    .filter((row) => row.purposeKey !== DEMO_PURPOSE && (row.approved || row.awaiting))
    .sort((a, b) => byFillOrder(b, a))
    .map((row) => ({
      requestNumber: row.requestNumber,
      date: row.date,
      purpose: row.purposeKey,
      purposeLabel: purposeLabel(row.purposeKey),
      energyType: row.energyType,
      vehicleLabel: fuelVehicleLabel(row.vehRegNo, row.vinNo),
      branchLabel: row.branchLabel,
      litres: round2(row.litres),
      status: row.status,
      statusLabel: row.statusLabel,
    }))

  // ── Multi-Energy & Fuel Type Intelligence (Petrol, Diesel, CNG, EV) ──
  const energyMap = new Map<string, { approvedHundredths: number; totalHundredths: number; approvedRequests: number; totalRequests: number }>()
  for (const row of scoped) {
    const energy = (row.energyType || 'PETROL').trim().toUpperCase()
    const e = energyMap.get(energy) ?? { approvedHundredths: 0, totalHundredths: 0, approvedRequests: 0, totalRequests: 0 }
    e.totalHundredths += toHundredths(row.litres)
    e.totalRequests += 1
    if (row.approved) {
      e.approvedHundredths += toHundredths(row.litres)
      e.approvedRequests += 1
    }
    energyMap.set(energy, e)
  }

  const grandTotalHundredths = [...energyMap.values()].reduce((sum, e) => sum + e.totalHundredths, 0)
  const byEnergyType: FuelEnergyTypeSummary[] = [...energyMap.entries()].map(([energy, data]) => {
    const totalLitres = data.totalHundredths / 100
    const approvedLitres = data.approvedHundredths / 100
    const avgFillSize = data.totalRequests > 0 ? round1(totalLitres / data.totalRequests) : 0
    const percentage = grandTotalHundredths > 0 ? round1((data.totalHundredths / grandTotalHundredths) * 100) : 0
    const label = energy === 'PETROL' ? 'Petrol' : energy === 'DIESEL' ? 'Diesel' : energy === 'CNG' ? 'CNG' : energy === 'EV' ? 'Electric (EV)' : titleCase(energy)
    return {
      energyType: energy as any,
      label,
      approvedLitres,
      totalLitres,
      approvedRequests: data.approvedRequests,
      totalRequests: data.totalRequests,
      avgFillSize,
      percentage,
    }
  }).sort((a, b) => b.totalLitres - a.totalLitres)

  // ── Branch Multi-Energy Distribution ──
  const branchEnergyMap = new Map<string, { branchLabel: string; petrolHundredths: number; dieselHundredths: number; cngHundredths: number; evKwh: number; totalHundredths: number }>()
  for (const row of scoped) {
    const branchKey = row.location || 'Unknown'
    const branchLabel = row.branchLabel || branchKey
    const be = branchEnergyMap.get(branchKey) ?? { branchLabel, petrolHundredths: 0, dieselHundredths: 0, cngHundredths: 0, evKwh: 0, totalHundredths: 0 }
    const energy = (row.energyType || 'PETROL').trim().toUpperCase()
    const h = toHundredths(row.litres)
    be.totalHundredths += h
    if (energy === 'PETROL') be.petrolHundredths += h
    else if (energy === 'DIESEL') be.dieselHundredths += h
    else if (energy === 'CNG') be.cngHundredths += h
    else if (energy === 'EV') be.evKwh += row.litres
    branchEnergyMap.set(branchKey, be)
  }

  const byBranchEnergy: FuelBranchEnergySummary[] = [...branchEnergyMap.entries()].map(([branch, bData]) => {
    const totalLitres = bData.totalHundredths / 100
    const petrolLitres = bData.petrolHundredths / 100
    const dieselLitres = bData.dieselHundredths / 100
    const cngLitres = bData.cngHundredths / 100
    const petrolPct = totalLitres > 0 ? round1((petrolLitres / totalLitres) * 100) : 0
    const dieselPct = totalLitres > 0 ? round1((dieselLitres / totalLitres) * 100) : 0
    return {
      branch,
      branchLabel: bData.branchLabel,
      petrolLitres,
      dieselLitres,
      cngLitres,
      evKwh: round1(bData.evKwh),
      totalLitres,
      petrolPct,
      dieselPct,
    }
  }).sort((a, b) => b.totalLitres - a.totalLitres)

  // ── Purpose vs Energy Matrix ──
  const matrixMap = new Map<string, { petrolHundredths: number; dieselHundredths: number; cngHundredths: number; evKwh: number; totalHundredths: number; count: number }>()
  for (const row of scoped) {
    const p = row.purposeKey
    const m = matrixMap.get(p) ?? { petrolHundredths: 0, dieselHundredths: 0, cngHundredths: 0, evKwh: 0, totalHundredths: 0, count: 0 }
    const energy = (row.energyType || 'PETROL').trim().toUpperCase()
    const h = toHundredths(row.litres)
    m.totalHundredths += h
    m.count += 1
    if (energy === 'PETROL') m.petrolHundredths += h
    else if (energy === 'DIESEL') m.dieselHundredths += h
    else if (energy === 'CNG') m.cngHundredths += h
    else if (energy === 'EV') m.evKwh += row.litres
    matrixMap.set(p, m)
  }

  const purposeEnergyMatrix: FuelPurposeEnergyMatrixRow[] = [...matrixMap.entries()].map(([purpose, m]) => ({
    purpose,
    purposeLabel: purposeLabel(purpose),
    petrolLitres: m.petrolHundredths / 100,
    dieselLitres: m.dieselHundredths / 100,
    cngLitres: m.cngHundredths / 100,
    evKwh: round1(m.evKwh),
    totalLitres: m.totalHundredths / 100,
    requestsCount: m.count,
  })).sort((a, b) => b.totalLitres - a.totalLitres)

  return {
    period,
    kpis: {
      approvedLitres: approvedHundredths / 100,
      approvedRequests,
      awaiting: { total: byStage.reduce((sum, stage) => sum + stage.count, 0), byStage },
      demoDriveKm: round1(demoDriveKm),
      demoDrives,
      gpsVerifiedKm: round1(gpsVerifiedKm),
      gpsVerifiedDrives,
      checksNeedingAttention: checks.filter((check) => check.severity === 'warning').length,
    },
    byPurpose,
    byEnergyType,
    byBranchEnergy,
    purposeEnergyMatrix,
    demoCars,
    otherFuel,
    checks,
    generatedAt: input.generatedAt,
  }
}
