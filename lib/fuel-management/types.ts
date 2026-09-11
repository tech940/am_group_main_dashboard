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

export type DemoCarFill = {
  requestNumber: string
  /** fuel_filled_date, 'YYYY-MM-DD'. */
  date: string
  litres: number
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

export type FuelManagementResponse = {
  period: FuelManagementPeriod
  kpis: FuelManagementKpis
  byPurpose: FuelPurposeSummary[]
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
