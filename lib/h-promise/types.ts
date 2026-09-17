/**
 * The shapes H Promise's API returns. Client-safe: types only.
 *
 * ⚠️ Money is sent as rupees (numbers), dates as YYYY-MM-DD, instants as ISO strings. Personal values —
 * phone numbers and the buyer's address — arrive already redacted for people who do not work the deal
 * (lib/h-promise/serialize.ts); the client never decides what to hide.
 */

import type { FileKind } from './constants'
import type { AgingBucket, InsuranceState, VehicleStage } from './stage'
import type { InterestRatePeriod } from './economics'
import type { ApprovalQueue, ManagerStatus } from './status'

export type HpFileRef = {
  id: string
  kind: FileKind
  contentType: string
  sizeBytes: number
  uploadedAt: string
  uploadedByName: string
  source: 'upload' | 'import'
  /** A short signed URL for an inline preview — only for kinds this viewer may open that are not personal. */
  previewUrl: string | null
  /** False: the file exists but this viewer may not open it (shown as "on file"). */
  canOpen: boolean
}

export type HpEconomics = {
  priceWithGst: number | null
  grossProfit: number | null
  grossProfitWithGst: number | null
  interestDays: number | null
  interest: number | null
  netProfit: number | null
}

export type HpFlags = {
  purchasePending: boolean
  /** Which Approvals queue the purchase / sale sits in (two-stage approval); null = no sale, or deleted. */
  purchaseQueue: ApprovalQueue | null
  saleQueue: ApprovalQueue | null
  purchaseRejected: boolean
  salePending: boolean
  saleRejected: boolean
  saleOverdue: boolean
  daysOverdue: number | null
  ledgerPending: boolean
  docsMissing: boolean
  missingDocs: FileKind[]
  brokerRcPending: boolean
  paperworkPending: boolean
  insurance: InsuranceState | null
  daysInStock: number | null
  agingBucket: AgingBucket | null
  longAging: boolean
}

export type HpBookingSummary = { id: string; bookingDate: string; amount: number }

/** One row of the register. No personal values. */
export type HpVehicleRow = {
  id: string
  stockNo: number
  regNo: string
  model: string
  colour: string | null
  manufacturingYear: number | null
  location: string
  purchaseDate: string
  purchasePrice: number
  purchaseGstPct: number
  expectedSaleDate: string | null
  purchasedBy: string
  purchaseWhatsappApprover: string
  purchaseStatus: string
  purchaseSubmittedById: string | null
  purchaseSubmittedByName: string | null
  purchaseSubmittedAt: string | null
  purchaseDecidedByName: string | null
  purchaseDecidedAt: string | null
  purchaseDecisionReason: string | null
  /** Role of the final decider (md / developer); null for sheet imports. */
  purchaseDecidedRole: string | null
  /** The GSM / SM stage, as the app reads it (NULL in the database is resolved here). */
  purchaseManagerStatus: ManagerStatus | null
  purchaseManagerByName: string | null
  purchaseManagerRole: string | null
  purchaseManagerAt: string | null
  purchaseManagerNote: string | null
  purchaseEditedAfterApproval: boolean

  saleStatus: string | null
  saleDate: string | null
  sellingPrice: number | null
  otherCost: number
  soldTo: string | null
  soldBy: string | null
  isDemo: boolean | null
  saleFinanced: boolean | null
  buyerName: string | null
  saleWhatsappApprover: string | null
  saleSubmittedById: string | null
  saleSubmittedByName: string | null
  saleSubmittedAt: string | null
  saleDecidedByName: string | null
  saleDecidedAt: string | null
  saleDecisionReason: string | null
  saleDecidedRole: string | null
  saleManagerStatus: ManagerStatus | null
  saleManagerByName: string | null
  saleManagerRole: string | null
  saleManagerAt: string | null
  saleManagerNote: string | null
  saleEditedAfterApproval: boolean

  booking: HpBookingSummary | null
  insuranceEndDate: string | null
  hypothecation: string | null
  rtoStatus: string | null
  paymentVerifiedByName: string | null
  paymentVerifiedAt: string | null

  stage: VehicleStage
  flags: HpFlags
  presentFiles: FileKind[]
  economics: HpEconomics

  createdById: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedByName: string | null
  deleteReason: string | null
  imported: boolean
}

export type HpBooking = {
  id: string
  status: 'active' | 'refunded' | string
  bookingDate: string
  amount: number
  remarks: string | null
  refundDate: string | null
  refundRemarks: string | null
  refundedByName: string | null
  refundedAt: string | null
  createdByName: string
  createdAt: string
  files: HpFileRef[]
}

export type HpEvent = {
  id: string
  subject: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  actorName: string
  actorRole: string | null
  remarks: string | null
  changes: Record<string, unknown>
  createdAt: string
}

export type HpVehicleDetail = HpVehicleRow & {
  odometerKm: number | null
  engineNo: string | null
  chassisNo: string | null
  expectedProfit: number | null
  purchaseRemarks: string | null
  purchaseFinanced: boolean
  salesConsultant: string | null
  /** Full number for people who work the deal; `••••••1234` otherwise. */
  sellerPhone: string | null
  buyerPhone: string | null
  /** Null when redacted — check `redacted`. */
  buyerAddress: string | null
  documentsRemarks: string | null
  documentsUpdatedByName: string | null
  documentsUpdatedAt: string | null
  brokerRcRemarks: string | null
  brokerRcUpdatedByName: string | null
  brokerRcUpdatedAt: string | null
  updatedByName: string | null
  importRow: number | null
  bookings: HpBooking[]
  /** Current vehicle files (booking files sit on their booking). */
  files: HpFileRef[]
  /** Replaced files: kept, never served from here. */
  replacedFiles: Array<{ id: string; kind: FileKind; uploadedAt: string; uploadedByName: string; supersededAt: string }>
  events: HpEvent[]
  /** True when personal values were withheld from this viewer. */
  redacted: boolean
  /** Set on the instant placeholder built from a register row, before the full record arrives. */
  partial?: boolean
}

export type HpOption = {
  id: string
  kind: 'staff' | 'approver' | 'location'
  value: string
  label: string
  sortOrder: number
  isActive: boolean
}

export type HpRateRow = {
  id: string
  effectiveFrom: string
  ratePct: number
  note: string | null
  createdByName: string
  createdAt: string
}

export type HpMeta = {
  today: string
  formulaVersion: string
  options: { staff: HpOption[]; approver: HpOption[]; location: HpOption[] }
  rates: InterestRatePeriod[]
  rateRows: HpRateRow[]
  suggestions: { models: string[]; colours: string[]; consultants: string[] }
}

/** Every booking, refunded ones included — the MIS counts bookings and refunds by month. */
export type HpBookingLite = {
  id: string
  vehicleId: string
  status: string
  bookingDate: string
  amount: number
  refundDate: string | null
}

export type HpListResponse = {
  rows: HpVehicleRow[]
  bookings: HpBookingLite[]
  today: string
  truncated: boolean
}

export type HpExchangeBonus = {
  id: string
  entryDate: string | null
  vehicleNo: string
  vehicleName: string | null
  salesConsultant: string | null
  newCarModel: string
  bonusAmount: number
  /** Redacted like every other phone number. */
  customerPhone: string | null
  remarks: string | null
  createdByName: string
  createdAt: string
  updatedAt: string
}

export type HpUploadResult = {
  fileId: string
  kind: FileKind
  contentType: string
  sizeBytes: number
  previewUrl: string | null
}

export type HpRegCheck = {
  key: string
  looksValid: boolean
  live: { id: string; stockNo: number; stage: VehicleStage } | null
  previous: Array<{ id: string; stockNo: number; saleDate: string | null }>
}
