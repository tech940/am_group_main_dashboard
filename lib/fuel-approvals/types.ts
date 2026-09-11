export type FuelLocation = 'KIA JAMMU' | 'KIA UDHAMPUR' | 'KIA BANIHAL'

export type FuelRequiredFor =
  | 'DEMO'
  | 'GENSET'
  | 'NEW DELIVERY'
  | 'STOCK YARD'
  | 'STOCK TRANSFER'
  | 'DISPLAY VEH'
  | 'PAINT BOOTH -KIA -GANYAL'
  | 'CPO'
  | 'OTHER'

export type FuelType = 'PETROL' | 'DIESEL'

export type FuelApprovalStatus =
  | 'ceo_pending'
  | 'ceo_on_hold'
  | 'accounts_pending'
  | 'accounts_on_hold'
  | 'approved'
  | 'rejected'
  | 'sent_back'
  // Legacy status support for historical records
  | 'ea_pending'
  | 'ea_on_hold'
  | 'md_pending'
  | 'md_on_hold'
  | 'ed_pending'
  | 'ed_on_hold'
  | 'hr_pending'
  | 'hr_on_hold'

export type FuelApprovalStage = 'ceo' | 'accounts' | 'completed' | 'rejected' | 'submitter' | 'ea' | 'md' | 'ed' | 'hr'

export interface FuelApprovalHistoryItem {
  id: string
  action: 'SUBMIT' | 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESUBMIT'
  stage: 'ceo' | 'accounts' | 'submitter' | 'ea' | 'md' | 'ed' | 'hr'
  userId: string
  userName: string
  userEmail: string
  userRole: string
  remarks?: string
  timestamp: string
}

export interface FuelApprovalRecord {
  id: string
  requestNumber: string
  brand: string
  location: FuelLocation | string
  fuelRequiredFor: FuelRequiredFor | string
  vehRegNo: string
  vinNo: string
  lastFuelFilledDate: string | null
  fuelType: FuelType | string
  currentKmReading: string | null
  fuelFilledDate: string
  fuelFilledLtrs: string | number
  fuelSlipUrl: string
  remarks: string | null
  status: FuelApprovalStatus
  currentStage: FuelApprovalStage

  ceoApprovedBy?: string | null
  ceoApprovedByName?: string | null
  ceoApprovedAt?: string | null
  ceoRemarks?: string | null

  accountsApprovedBy?: string | null
  accountsApprovedByName?: string | null
  accountsApprovedAt?: string | null
  accountsRemarks?: string | null

  eaApprovedBy?: string | null
  eaApprovedByName?: string | null
  eaApprovedAt?: string | null
  eaRemarks?: string | null

  edApprovedBy?: string | null
  edApprovedByName?: string | null
  edApprovedAt?: string | null
  edRemarks?: string | null

  hrApprovedBy?: string | null
  hrApprovedByName?: string | null
  hrApprovedAt?: string | null
  hrRemarks?: string | null

  mdApprovedBy?: string | null
  mdApprovedByName?: string | null
  mdApprovedAt?: string | null
  mdRemarks?: string | null

  rejectedBy?: string | null
  rejectedByName?: string | null
  rejectedAt?: string | null
  rejectStage?: string | null
  rejectRemarks?: string | null

  sendBackReason?: string | null

  // ── Fuel intelligence (migration 0063) ──────────────────────────────────────
  // Everything lib/fuel-management/engine.ts needs to state a mileage or a cost per km. All optional:
  // the 20 records that predate the rework carry none of it, and an absent value must read as
  // "not recorded" rather than as a zero that quietly enters an average.
  // ⚠️ fuelFilledLtrs above IS the quantity; quantityUnit only says whether it means L, kg or kWh.
  // There is deliberately no unitPrice field — it is totalCost ÷ quantity, derived by the engine.
  energyType?: 'petrol' | 'diesel' | 'cng' | 'ev' | 'hybrid' | null
  quantityUnit?: 'L' | 'kg' | 'kWh' | string | null
  /** The receipt total, as typed by the person who paid it. */
  totalCost?: string | number | null
  /** The parsed odometer. currentKmReading above stays as the raw text that was typed. */
  odometerKm?: string | number | null
  /** null means "not recorded" — never read as either answer. */
  isFullTank?: boolean | null
  /** An authorised person accepted an abnormal reading; the engine refuses to measure across it. */
  odometerOverride?: boolean | null
  odometerOverrideBy?: string | null
  odometerOverrideAt?: string | null
  odometerOverrideReason?: string | null
  /** The resolved 17-character VIN. ⚠️ vinNo above is NOT a VIN in any historical row. */
  vehicleVin?: string | null
  /** For fuel that never enters a vehicle: GENSET, STOCKYARD. Never set with vehicleVin. */
  assetCode?: string | null
  driverUserId?: string | null
  driverName?: string | null
  stationName?: string | null
  stationLocation?: string | null

  submittedById?: string | null
  submittedByName: string
  submittedByEmail: string

  history: FuelApprovalHistoryItem[]

  createdAt: string | Date
  updatedAt: string | Date
}
