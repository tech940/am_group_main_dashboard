/**
 * Fuel Management — the contract of GET /api/fuel-management, and the plain inputs ./metrics.ts computes from.
 *
 * No imports, so the screen, the server and scripts/verify-fuel-management.ts can all use it.
 *
 * ⚠️ Every response field is something the screen shows. Personal details of whoever raised a request, attached
 * files, free-text notes, the approval trail and approver ids are deliberately absent — the old route shipped
 * whole database rows to any signed-in employee. Do not add them "for later".
 */

// ── Request ─────────────────────────────────────────────────────────────────────────────────────────

/** 'JK402' is KIA Jammu, 'JK501' is KIA Udhampur. */
export type FuelManagementBranch = 'ALL' | 'JK402' | 'JK501'

/** India calendar days, 'YYYY-MM-DD', both ends included. */
export type FuelManagementPeriod = { from: string; to: string; branch: FuelManagementBranch }

// ── Response ────────────────────────────────────────────────────────────────────────────────────────

export type FuelAwaitingStage = {
  /** fuel_approvals.current_stage, lower-cased: 'ceo', 'accounts', or a legacy 'ea' | 'md' | 'ed' | 'hr'. */
  stage: string
  /** 'CEO', 'Accounts', 'EA', 'MD', 'ED', 'HR'. */
  label: string
  count: number
}

export type FuelManagementKpis = {
  /** Litres on APPROVED requests filled in the period, every purpose. */
  approvedLitres: number
  approvedRequests: number
  /** Every request that is not approved, rejected or sent back — held requests included. */
  awaiting: { total: number; byStage: FuelAwaitingStage[] }
  /** Returned gate passes in the period with both odometer readings (gate-in minus gate-out). */
  demoDriveKm: number
  demoDrives: number
  /** LocoNav distance for drives whose trip is reconciled. */
  gpsVerifiedKm: number
  gpsVerifiedDrives: number
  /** Warnings only; info checks are not counted. */
  checksNeedingAttention: number
}

export type FuelPurposeSummary = {
  /** fuel_required_for, trimmed and upper-cased: 'STOCK TRANSFER', 'DEMO', 'DISPLAY VEH'. */
  purpose: string
  /** Title case: 'Stock Transfer'. */
  label: string
  approvedLitres: number
  approvedRequests: number
  awaitingRequests: number
}

export type FuelEnergyTypeSummary = {
  energyType: 'PETROL' | 'DIESEL' | 'CNG' | 'EV' | 'OTHER'
  label: string
  approvedLitres: number
  totalLitres: number
  approvedRequests: number
  totalRequests: number
  avgFillSize: number
  percentage: number
}

export type FuelBranchEnergySummary = {
  branch: string
  branchLabel: string
  petrolLitres: number
  dieselLitres: number
  cngLitres: number
  evKwh: number
  totalLitres: number
  petrolPct: number
  dieselPct: number
}

export type FuelPurposeEnergyMatrixRow = {
  purpose: string
  purposeLabel: string
  petrolLitres: number
  dieselLitres: number
  cngLitres: number
  evKwh: number
  totalLitres: number
  requestsCount: number
}

export type DemoCarFill = {
  requestNumber: string
  /** fuel_filled_date, 'YYYY-MM-DD'. */
  date: string
  litres: number
  energyType?: string
  /** Parsed from the odometer reading typed on the request; null when missing or not a number. */
  odometerKm: number | null
  status: string
  /** The Fuel Approvals section's own wording for the status, so the two screens never disagree. */
  statusLabel: string
}

export type DemoCarDrive = {
  passNo: string
  /** ISO timestamp. */
  gateOutAt: string
  status: string
  /** gate_in_odo − gate_out_odo when both are present and the result is not negative. */
  odometerKm: number | null
  gateOutOdo?: number | null
  gateInOdo?: number | null
  /** LocoNav distance, only when the trip is reconciled. */
  gpsKm: number | null
}

export type DemoCarFuelSummary = {
  /** Upper-case VIN — the car's identity. A plate is not one (trade plates are shared). */
  vin: string
  registrationNumber: string | null
  model: string | null
  branchLabel: string
  /** Approved litres in the period at the chosen branch (the `fills` below). */
  approvedLitres: number
  /**
   * The car's last APPROVED fill in the period, whichever branch recorded it — the fill kmSinceLastFill counts
   * from. It can therefore be a fill the branch filter leaves out of `fills`.
   */
  lastFillDate: string | null
  lastFillOdometerKm: number | null
  /** Latest / highest odometer reading recorded on Demo Gate Passes for this vehicle. */
  lastGatePassOdometerKm: number | null
  /** Most accurate odometer reading (prefers Demo Gate Pass odometer, falls back to fuel fill odometer). */
  lastOdometerKm: number | null
  /** Highest gate-in odometer on/after the last approved fill's day, minus that fill's odometer. */
  kmSinceLastFill: number | null
  /**
   * Fill-to-fill on the car's own odometer: (last reading − first reading) ÷ litres of the fills after the first,
   * over every approved fill with a reading in the period (any branch — a fill hidden by the filter still put fuel
   * in the tank between two readings). null with a note when it cannot be worked out honestly.
   */
  kmPerLitre: { value: number; fillsUsed: number } | null
  kmPerLitreNote: string | null
  /** Sum of odometerKm over this car's returned drives in the period. */
  driveKm: number
  /** Sum of gpsKm over this car's drives in the period. */
  gpsKm: number
  /** Approved and awaiting fills in the period at the chosen branch, oldest first. */
  fills: DemoCarFill[]
  /** Gate passes that went out in the period at the chosen branch, oldest first. */
  drives: DemoCarDrive[]
}

export type OtherFuelRow = {
  requestNumber: string
  date: string
  purpose: string
  purposeLabel: string
  energyType?: string
  /** The vehicle text as the requester entered it — these are not demo cars and are not matched to one. */
  vehicleLabel: string
  branchLabel: string
  litres: number
  status: string
  statusLabel: string
}

export type FuelCheckKind =
  | 'odometer_backwards'
  | 'gate_odometer_mismatch'
  | 'possible_duplicate'
  | 'unmatched_demo_fill'
  | 'missing_odometer'

export type FuelCheckSeverity = 'warning' | 'info'

export type FuelCheck = {
  kind: FuelCheckKind
  severity: FuelCheckSeverity
  requestNumber: string
  /** The demo car the request is tied to, when it is tied to one. */
  vin: string | null
  vehicleLabel: string
  /** Plain words, written for the person who has to go and look. */
  message: string
}

export type DemoFuelReconciliation = {
  period: FuelManagementPeriod
  kpis: FuelManagementKpis
  byPurpose: FuelPurposeSummary[]
  byEnergyType: FuelEnergyTypeSummary[]
  byBranchEnergy: FuelBranchEnergySummary[]
  purposeEnergyMatrix: FuelPurposeEnergyMatrixRow[]
  demoCars: DemoCarFuelSummary[]
  otherFuel: OtherFuelRow[]
  /** Warnings first, then info; newest fill first within each. */
  checks: FuelCheck[]
  /** ISO timestamp. */
  generatedAt: string
}

/** Every non-200 answer. The text is written for the person on the screen; driver messages are never passed on. */
export type FuelManagementErrorResponse = { error: string }

// ── Inputs to ./metrics.ts (built by ./reconciliation.ts) ───────────────────────────────────────────

export type UnmatchedDemoReason = 'no_plate_in_label' | 'plate_not_in_demo_fleet' | 'shared_plate' | 'ambiguous'

export type FuelRowInput = {
  requestNumber: string
  location: string
  /** fuel_required_for as stored. */
  purpose: string
  /** Free text: a dropdown label, 'Stock transfer', or a VIN tail. */
  vehRegNo: string
  /** Never a VIN on live data: a VIN's last 6 digits, a plate, or free text. */
  vinNo: string
  /** current_km_reading as stored (TEXT). */
  kmReadingText: string | null
  /** 'YYYY-MM-DD'. */
  date: string
  litres: number
  energyType?: string
  /** Lower-cased. */
  status: string
  statusLabel: string
  currentStage: string
  branchLabel: string
  /** ISO timestamp — orders two fills on the same day. */
  createdAt: string
}

/** An approved DEMO fill from BEFORE the period that carries a usable odometer reading. */
export type PriorDemoFillInput = {
  requestNumber: string
  vehRegNo: string
  vinNo: string
  kmReadingText: string | null
  date: string
  createdAt: string
}

export type DemoFleetCarInput = {
  vin: string
  registrationNumber: string | null
  model: string | null
  branchLabel: string
  /** True when more than one demo car carries this registration number. */
  sharedPlate: boolean
}

export type DrivePassInput = {
  passNo: string
  vin: string
  /** Snapshot on the pass — used only to describe a car that is no longer on the demo list. */
  registrationNumber: string | null
  model: string | null
  branchLabel: string
  status: string
  gateOutAt: string
  gateOutOdo: number | null
  gateInOdo: number | null
  /** provider_distance_km, only when the trip is reconciled. */
  gpsKm: number | null
}

export type GateReadingInput = {
  passNo: string
  vin: string
  /** ISO timestamp. */
  gateInAt: string
  /** The India calendar day of gateInAt, 'YYYY-MM-DD'. */
  gateInYmd: string
  gateInOdo: number
}

export type FuelManagementInput = {
  period: FuelManagementPeriod
  /** Fills dated in the period at the chosen branch. Everything counted and listed comes from these. */
  fuelRows: FuelRowInput[]
  /**
   * Non-rejected fills dated in the period at the OTHER branches (empty for 'ALL'). Comparison partners only —
   * never counted, listed or reported on.
   */
  otherBranchFuelRows: FuelRowInput[]
  /** Approved DEMO fills before the period with a usable reading — at least the latest one per vehicle label. */
  priorDemoFills: PriorDemoFillInput[]
  /** The demo fleet as lib/gate-pass/vehicles.ts lists it. */
  demoFleet: DemoFleetCarInput[]
  /** Gate passes that went out in the period at the chosen branch. */
  drives: DrivePassInput[]
  /** Returned passes, any branch, whose gate-in falls in the period. */
  returnedInPeriod: GateReadingInput[]
  /** Per VIN, the returned pass with the highest gate-in odometer before the period (any branch). */
  highestReturnedBeforePeriod: GateReadingInput[]
  generatedAt: string
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// The control-centre contract (redesign, 2026-09-16)
//
// One record per fuel request, traced from request to approval to the bill or the pump meter, the gate pass,
// GPS and mileage. Every field is something the screen shows. Still deliberately absent: email addresses,
// file URLs, free-text notes, raw approval trails, customer names or phone numbers. People appear by NAME
// only, because accountability needs a name — the section is open to EA, MD and Developer only.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type FuelUnit = 'L' | 'kg' | 'kWh'
export type FuelEnergy = 'petrol' | 'diesel' | 'cng' | 'ev' | 'hybrid' | 'other'

/** Where the request is in its life. Mirrors getFuelLifecycleState in lib/fuel-approvals/constants.ts. */
export type FuelLifecycle = 'in_review' | 'on_hold' | 'sent_back' | 'rejected' | 'to_finalise' | 'completed'

/** How a record is tied to a consumer: a car by VIN, a genset or yard by asset, or only a typed label. */
export type FuelIdentity = 'vin' | 'asset' | 'label'

/** Every server-side filter the screen offers. Null means "not filtered". */
export type FuelFilters = {
  from: string
  to: string
  branch: string | null
  brand: string | null
  purpose: string | null
  department: string | null
  energy: FuelEnergy | null
  fleet: 'demo' | 'other' | null
  vehicle: string | null
}

export type FuelOption = { value: string; label: string; count: number }

export type FuelFilterOptions = {
  branches: FuelOption[]
  brands: FuelOption[]
  purposes: FuelOption[]
  departments: FuelOption[]
  energies: FuelOption[]
  vehicles: FuelOption[]
}

export type FuelQualityKey =
  | 'vehicle_unidentified'
  | 'odometer_missing'
  | 'odometer_unreadable'
  | 'full_tank_missing'
  | 'actual_missing'
  | 'cost_missing'
  | 'pass_missing'
  | 'gps_missing'

export type FuelEventRow = {
  id: string
  requestNumber: string
  /** Fill date, India calendar day. */
  date: string
  /** ISO timestamps. */
  createdAt: string
  approvedAt: string | null
  closedAt: string | null

  branchKey: string
  branchLabel: string
  brandKey: string
  brandLabel: string
  purposeKey: string
  purposeLabel: string
  department: string | null
  energy: FuelEnergy
  unit: FuelUnit

  vehicleKey: string
  vehicleLabel: string
  vin: string | null
  identity: FuelIdentity
  isDemo: boolean
  /** Why a demo fill could not be tied to a car, when it could not. */
  identityNote: string | null

  requested: number | null
  approved: number | null
  actual: number | null
  /** actual − approved, when both are recorded. */
  variance: number | null
  /** The receipt total. */
  cost: number | null
  /** Receipt total ÷ (actual, else approved) — from the engine. */
  unitPrice: number | null
  odometerKm: number | null
  fullTank: boolean | null
  station: string | null

  lifecycle: FuelLifecycle
  lifecycleLabel: string
  statusLabel: string
  requesterName: string
  approverName: string | null
  closedByName: string | null

  passId: string | null
  passNo: string | null
  pumpLitres: number | null

  /** Exception kinds raised on this record (open or reviewed). */
  exceptionKinds: string[]
  openExceptions: number
  quality: FuelQualityKey[]
}

export type FuelBreakdownRow = {
  key: string
  label: string
  events: number
  approvedQty: number
  actualQty: number
  spend: number
  /** Share of the approved litres in view, 0–100. */
  sharePct: number
}

export type FuelTrendPoint = {
  /** 'YYYY-MM-DD' (day or week start) or 'YYYY-MM'. */
  bucket: string
  label: string
  approvedQty: number
  actualQty: number
  spend: number
  events: number
}

export type FuelComparison = { current: number; previous: number | null }

export type FuelFleetFigure = {
  unit: FuelUnit
  efficiency: number | null
  costPerKm: number | null
  distanceKm: number
  quantity: number
  segments: number
  costedSegments: number
  basis: 'full_tank' | 'provisional' | 'none'
}

export type FuelHeadline = {
  spend: FuelComparison & { costedEvents: number; closedEvents: number }
  requestedQty: number
  approvedQty: FuelComparison
  actualQty: FuelComparison & { recordedEvents: number; eligibleEvents: number }
  /** On the records that carry BOTH figures: what was approved and what was actually filled. */
  reconciled: { events: number; approvedQty: number; actualQty: number; variance: number }
  approvedEvents: FuelComparison
  otherUnits: { unit: FuelUnit; approvedQty: number; actualQty: number }[]
  vehiclesFuelled: number
  distance: { gateKm: number; drives: number; gpsKm: number; gpsDrives: number; previousGateKm: number | null }
  fleet: FuelFleetFigure | null
  pending: { review: number; toClose: number; overdueToClose: number }
  exceptions: { open: number; critical: number; review: number; info: number; reviewed: number }
  vehiclesNeedingAttention: number
}

export type FuelExceptionSeverity = 'critical' | 'review' | 'info'

export type FuelExceptionReview = {
  outcome: 'explained' | 'data_error' | 'follow_up'
  note: string
  reviewerName: string
  at: string
}

export type FuelExceptionRow = {
  key: string
  kind: string
  severity: FuelExceptionSeverity
  /** Neutral status word: 'Mismatch', 'High consumption', 'Odometer anomaly'. Never an accusation. */
  label: string
  title: string
  message: string
  date: string
  vehicleKey: string | null
  vehicleLabel: string
  eventId: string | null
  requestNumber: string | null
  passNo: string | null
  branchKey: string | null
  branchLabel: string | null
  measured: number | null
  expected: number | null
  variance: number | null
  unit: string | null
  review: FuelExceptionReview | null
}

export type FuelMileage = {
  current: number | null
  average: number | null
  best: number | null
  worst: number | null
  basis: 'full_tank' | 'provisional' | 'none'
  segmentsUsed: number
  declining: boolean
  unavailableReason: string | null
}

export type FuelVehicleRow = {
  key: string
  label: string
  kind: FuelIdentity
  vin: string | null
  registration: string | null
  model: string | null
  variant: string | null
  branchLabel: string
  isDemo: boolean
  unit: FuelUnit
  energyLabel: string
  events: number
  approvedQty: number
  actualQty: number
  spend: number
  avgFill: number | null
  previousQty: number | null
  gateKm: number
  gpsKm: number
  drives: number
  mileage: FuelMileage
  expected: number | null
  tankCapacity: number | null
  /** good | watch | poor | no_benchmark | no_data — decided by the engine. */
  efficiencyStatus: string
  efficiencyPct: number | null
  costPerKm: number | null
  lastFill: string | null
  kmSinceLastFill: number | null
  attention: string[]
  openExceptions: number
}

export type FuelQualityRow = {
  key: FuelQualityKey
  label: string
  description: string
  count: number
  /** How many records the rule applies to. */
  of: number
}

export type FuelAttentionItem = {
  id: string
  severity: FuelExceptionSeverity
  title: string
  detail: string
  target:
    | { kind: 'exception'; key: string }
    | { kind: 'event'; id: string }
    | { kind: 'vehicle'; key: string }
    | { kind: 'tab'; tab: 'transactions' | 'exceptions' | 'vehicles' | 'quality'; state?: string }
}

export type FuelActivityItem = {
  eventId: string
  at: string
  kind: 'raised' | 'approved' | 'closed' | 'sent_back' | 'rejected'
  requestNumber: string
  vehicleLabel: string
  branchLabel: string
  qty: number | null
  unit: FuelUnit
  cost: number | null
  lifecycle: FuelLifecycle
  lifecycleLabel: string
  openExceptions: number
}

export type FuelManagementResponse = {
  filters: FuelFilters
  previous: { from: string; to: string }
  options: FuelFilterOptions
  headline: FuelHeadline
  /** Plain sentences stating only what the figures support. */
  narrative: string[]
  attention: FuelAttentionItem[]
  activity: FuelActivityItem[]
  breakdowns: {
    purpose: FuelBreakdownRow[]
    branch: FuelBreakdownRow[]
    brand: FuelBreakdownRow[]
    department: FuelBreakdownRow[]
    energy: FuelBreakdownRow[]
    vehicle: FuelBreakdownRow[]
  }
  trend: { granularity: 'day' | 'week' | 'month'; points: FuelTrendPoint[] }
  vehicles: FuelVehicleRow[]
  exceptions: FuelExceptionRow[]
  quality: FuelQualityRow[]
  settingsSource: 'defaults' | 'configured'
  benchmarksConfigured: number
  sync: { loconavLastRunAt: string | null; loconavStatus: string | null }
  generatedAt: string
}

export type FuelTransactionsResponse = {
  rows: FuelEventRow[]
  total: number
  page: number
  pageSize: number
  totals: { approvedQty: number; actualQty: number; spend: number }
}

export type FuelTraceStep = {
  key: 'requested' | 'approved' | 'filled' | 'closed' | 'driven' | 'verified'
  label: string
  state: 'done' | 'pending' | 'missing' | 'mismatch' | 'not_applicable'
  value: string | null
  detail: string | null
  at: string | null
  actor: string | null
}

export type FuelPassDetail = {
  id: string
  passNo: string
  status: string
  purpose: string
  driverKind: string
  /** A staff driver's name. A customer driver is never named here. */
  staffDriverName: string | null
  raisedByName: string
  gateOutAt: string | null
  gateInAt: string | null
  gateOutOdo: number | null
  gateInOdo: number | null
  odometerKm: number | null
  pumpLitres: number | null
  pumpAmount: number | null
  gps: {
    status: string
    gpsKm: number | null
    deltaKm: number | null
    movingSeconds: number | null
    stoppedSeconds: number | null
    stops: number | null
    alerts: number | null
    discrepancy: boolean
  } | null
}

export type FuelTransactionDetail = {
  event: FuelEventRow
  steps: FuelTraceStep[]
  timeline: { at: string; action: string; actorName: string; actorRole: string | null }[]
  vehicle: FuelVehicleRow | null
  pass: FuelPassDetail | null
  /** Demo drives between the previous fill of this car and this one. */
  drivesSincePrevious: { passNo: string; gateOutAt: string; odometerKm: number | null; gpsKm: number | null }[]
  analysis: {
    previousFillDate: string | null
    distanceSincePreviousKm: number | null
    expectedQty: number | null
    expectedEfficiency: number | null
    efficiency: number | null
    efficiencyBasis: 'full_tank' | 'provisional' | null
    costPerKm: number | null
    unitPrice: number | null
    notes: string[]
  }
  exceptions: FuelExceptionRow[]
}

export type FuelVehicleProfile = {
  vehicle: FuelVehicleRow
  monthly: { month: string; label: string; qty: number; spend: number; gateKm: number; efficiency: number | null }[]
  segments: {
    openedOn: string
    closedOn: string
    kind: 'full_tank' | 'provisional'
    distanceKm: number | null
    quantity: number
    efficiency: number | null
    costPerKm: number | null
    usable: boolean
    problem: string | null
  }[]
  fills: FuelEventRow[]
  drives: {
    passNo: string
    purpose: string
    gateOutAt: string
    gateInAt: string | null
    odometerKm: number | null
    gpsKm: number | null
    pumpLitres: number | null
  }[]
  exceptions: FuelExceptionRow[]
}

export type FuelSettingsResponse = {
  canEdit: boolean
  settings: { key: string; label: string; unit: string; value: number; defaultValue: number; overridden: boolean }[]
  benchmarks: {
    id: string
    scope: 'vehicle' | 'model_variant' | 'model'
    vin: string | null
    model: string | null
    variant: string | null
    energyType: string
    unit: string
    expectedEfficiency: number | null
    tankCapacity: number | null
    notes: string | null
    setByName: string | null
    updatedAt: string
  }[]
  models: { model: string; variants: string[]; cars: number }[]
  changes: { at: string; actorName: string; target: string; action: string; label: string | null }[]
}
