/**
 * Database rows → API shapes, and the ONE place H Promise decides what a viewer may not see.
 *
 * Pure (no server imports), so scripts/verify-h-promise.ts can prove the redaction without a database.
 *
 * ⚠️ Redaction happens here and only here. A route never builds a vehicle payload by hand, so a new route
 * cannot forget to mask a phone number.
 */

import type { tataHPromiseBookings, tataHPromiseEvents, tataHPromiseExchangeBonuses, tataHPromiseFiles, tataHPromiseVehicles } from '@/lib/db/schema'
import type { HPromiseCapabilities } from './access-shared'
import { canOpenFileKind } from './access-shared'
import { FILE_KIND_POLICY, isFileKind, paperworkOutstanding, type FileKind } from './constants'
import { computeEconomics, paiseToRupeesOrNull, type InterestRatePeriod } from './economics'
import { maskPhone } from './registration'
import { agingBucket, deriveFlags } from './stage'
import { approvalQueueOf, managerStageOf } from './status'
import type {
  HpBooking,
  HpEvent,
  HpExchangeBonus,
  HpFileRef,
  HpVehicleDetail,
  HpVehicleRow,
} from './types'

export type VehicleRecord = typeof tataHPromiseVehicles.$inferSelect
export type BookingRecord = typeof tataHPromiseBookings.$inferSelect
export type FileRecord = typeof tataHPromiseFiles.$inferSelect
export type EventRecord = typeof tataHPromiseEvents.$inferSelect
export type ExchangeBonusRecord = typeof tataHPromiseExchangeBonuses.$inferSelect

/** A timestamp as Drizzle maps it (Date) or as JSON aggregation returns it (ISO text). */
type Stamp = Date | string | null

/** A stored file as the detail read returns it (one statement, JSON-aggregated). */
export type DetailFile = {
  id: string
  vehicleId: string | null
  bookingId: string | null
  kind: string
  storagePath: string
  contentType: string
  sizeBytes: number
  source: string
  uploadedByName: string
  uploadedAt: Stamp
  attachedAt: Stamp
  supersededAt: Stamp
}

export type DetailBooking = {
  id: string
  status: string
  bookingDate: string
  amount: number | string
  remarks: string | null
  refundDate: string | null
  refundRemarks: string | null
  refundedByName: string | null
  refundedAt: Stamp
  createdByName: string
  createdAt: Stamp
}

export type DetailEvent = {
  id: string
  subject: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  actorName: string
  actorRole: string | null
  remarks: string | null
  changes: Record<string, unknown> | null
  createdAt: Stamp
}

/**
 * The columns a register row needs — and ONLY those. The list reads nothing else, so phone numbers, the
 * buyer's address and the other detail-only columns never leave the database for a list, and the payload
 * stays small on a slow link.
 */
export const ROW_FIELDS = [
  'id',
  'stockNo',
  'regNo',
  'model',
  'colour',
  'manufacturingYear',
  'location',
  'purchaseDate',
  'purchasePrice',
  'purchaseGstPct',
  'expectedSaleDate',
  'purchasedBy',
  'purchaseWhatsappApprover',
  'purchaseStatus',
  'purchaseSubmittedBy',
  'purchaseSubmittedByName',
  'purchaseSubmittedAt',
  'purchaseDecidedByName',
  'purchaseDecidedAt',
  'purchaseDecisionReason',
  'purchaseDecidedRole',
  'purchaseManagerStatus',
  'purchaseManagerByName',
  'purchaseManagerRole',
  'purchaseManagerAt',
  'purchaseManagerNote',
  'saleStatus',
  'saleDate',
  'sellingPrice',
  'otherCost',
  'soldTo',
  'soldBy',
  'isDemo',
  'saleFinanced',
  'buyerName',
  'saleWhatsappApprover',
  'saleSubmittedBy',
  'saleSubmittedByName',
  'saleSubmittedAt',
  'saleDecidedByName',
  'saleDecidedAt',
  'saleDecisionReason',
  'saleDecidedRole',
  'saleManagerStatus',
  'saleManagerByName',
  'saleManagerRole',
  'saleManagerAt',
  'saleManagerNote',
  'insuranceEndDate',
  'hypothecation',
  'rtoStatus',
  'paymentVerifiedByName',
  'paymentVerifiedAt',
  'createdBy',
  'createdByName',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'deletedByName',
  'deleteReason',
  'importBatch',
] as const
export type RowField = (typeof ROW_FIELDS)[number]

/** A vehicle row plus what the list query derives next to it in the same statement. */
export type VehicleRowRecord = Pick<VehicleRecord, RowField> & {
  activeBooking: { id: string; bookingDate: string; amount: number | string } | null
  presentFiles: string[] | null
  purchaseEditedAfterApproval: boolean
  saleEditedAfterApproval: boolean
}

/** The full vehicle (detail) with the same derived columns. */
export type VehicleListRecord = VehicleRecord & {
  activeBooking: { id: string; bookingDate: string; amount: number | string } | null
  presentFiles: string[] | null
  purchaseEditedAfterApproval: boolean
  saleEditedAfterApproval: boolean
}

export function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function ymd(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
}

/** Full number for people who work the deal, `••••••1234` for everyone else. */
export function phoneFor(caps: Pick<HPromiseCapabilities, 'canSeePii'>, value: string | null | undefined): string | null {
  if (!value) return null
  return caps.canSeePii ? value : maskPhone(value)
}

export function buildVehicleRow(record: VehicleRowRecord, ctx: { today: string; rates: ReadonlyArray<InterestRatePeriod> }): HpVehicleRow {
  const presentFiles = (record.presentFiles ?? []).filter(isFileKind)
  const present = new Set<FileKind>(presentFiles)
  const purchaseDate = ymd(record.purchaseDate) as string
  const saleDate = ymd(record.saleDate)
  const expectedSaleDate = ymd(record.expectedSaleDate)
  const saleRecorded = record.saleStatus === 'pending' || record.saleStatus === 'approved'
  const flags = deriveFlags(
    {
      deletedAt: record.deletedAt,
      purchaseDate,
      expectedSaleDate,
      purchaseStatus: record.purchaseStatus,
      saleStatus: record.saleStatus,
      saleDate,
      soldTo: record.soldTo,
      insuranceEndDate: ymd(record.insuranceEndDate),
      hasActiveBooking: Boolean(record.activeBooking),
      presentFiles: present,
    },
    ctx.today,
  )
  const economics = computeEconomics(
    {
      purchasePrice: record.purchasePrice,
      purchaseGstPct: record.purchaseGstPct,
      // A rejected or withdrawn sale is not a sale: no profit is shown for it.
      sellingPrice: saleRecorded ? record.sellingPrice : null,
      otherCost: record.otherCost,
      purchaseDate,
      saleDate: saleRecorded ? saleDate : null,
      asOfYmd: ctx.today,
    },
    { interestRates: ctx.rates, interestRunsTo: 'sale_date' },
  )

  return {
    id: record.id,
    stockNo: record.stockNo,
    regNo: record.regNo,
    model: record.model,
    colour: record.colour,
    manufacturingYear: record.manufacturingYear,
    location: record.location,
    purchaseDate,
    purchasePrice: num(record.purchasePrice) ?? 0,
    purchaseGstPct: num(record.purchaseGstPct) ?? 0,
    expectedSaleDate,
    purchasedBy: record.purchasedBy,
    purchaseWhatsappApprover: record.purchaseWhatsappApprover,
    purchaseStatus: record.purchaseStatus,
    purchaseSubmittedById: record.purchaseSubmittedBy,
    purchaseSubmittedByName: record.purchaseSubmittedByName,
    purchaseSubmittedAt: iso(record.purchaseSubmittedAt),
    purchaseDecidedByName: record.purchaseDecidedByName,
    purchaseDecidedAt: iso(record.purchaseDecidedAt),
    purchaseDecisionReason: record.purchaseDecisionReason,
    purchaseDecidedRole: record.purchaseDecidedRole,
    purchaseManagerStatus: managerStageOf(record.purchaseStatus, record.purchaseManagerStatus),
    purchaseManagerByName: record.purchaseManagerByName,
    purchaseManagerRole: record.purchaseManagerRole,
    purchaseManagerAt: iso(record.purchaseManagerAt),
    purchaseManagerNote: record.purchaseManagerNote,
    purchaseEditedAfterApproval: Boolean(record.purchaseEditedAfterApproval),

    saleStatus: record.saleStatus,
    saleDate,
    sellingPrice: num(record.sellingPrice),
    otherCost: num(record.otherCost) ?? 0,
    soldTo: record.soldTo,
    soldBy: record.soldBy,
    isDemo: record.isDemo,
    saleFinanced: record.saleFinanced,
    buyerName: record.buyerName,
    saleWhatsappApprover: record.saleWhatsappApprover,
    saleSubmittedById: record.saleSubmittedBy,
    saleSubmittedByName: record.saleSubmittedByName,
    saleSubmittedAt: iso(record.saleSubmittedAt),
    saleDecidedByName: record.saleDecidedByName,
    saleDecidedAt: iso(record.saleDecidedAt),
    saleDecisionReason: record.saleDecisionReason,
    saleDecidedRole: record.saleDecidedRole,
    saleManagerStatus: managerStageOf(record.saleStatus, record.saleManagerStatus),
    saleManagerByName: record.saleManagerByName,
    saleManagerRole: record.saleManagerRole,
    saleManagerAt: iso(record.saleManagerAt),
    saleManagerNote: record.saleManagerNote,
    saleEditedAfterApproval: Boolean(record.saleEditedAfterApproval),

    booking: record.activeBooking
      ? { id: record.activeBooking.id, bookingDate: String(record.activeBooking.bookingDate).slice(0, 10), amount: num(record.activeBooking.amount) ?? 0 }
      : null,
    insuranceEndDate: ymd(record.insuranceEndDate),
    hypothecation: record.hypothecation,
    rtoStatus: record.rtoStatus,
    paymentVerifiedByName: record.paymentVerifiedByName,
    paymentVerifiedAt: iso(record.paymentVerifiedAt),

    stage: flags.stage,
    flags: {
      purchasePending: flags.purchasePending,
      purchaseQueue: flags.stage === 'deleted' ? null : approvalQueueOf(record.purchaseStatus, record.purchaseManagerStatus),
      saleQueue: flags.stage === 'deleted' ? null : approvalQueueOf(record.saleStatus, record.saleManagerStatus),
      purchaseRejected: flags.purchaseRejected,
      salePending: flags.salePending,
      saleRejected: flags.saleRejected,
      ledgerPending: flags.ledgerPending,
      docsMissing: flags.docsMissing,
      missingDocs: flags.missingDocs,
      brokerRcPending: flags.brokerRcPending,
      paperworkPending: flags.stage !== 'deleted' && (paperworkOutstanding(record.hypothecation) || paperworkOutstanding(record.rtoStatus)),
      insurance: flags.insurance,
      daysInStock: flags.daysInStock,
      agingBucket: flags.daysInStock === null ? null : agingBucket(flags.daysInStock),
      longAging: flags.longAging,
      saleOverdue: flags.saleOverdue,
      daysOverdue: flags.daysOverdue,
    },
    presentFiles,
    economics: {
      priceWithGst: paiseToRupeesOrNull(economics.priceWithGstPaise),
      grossProfit: paiseToRupeesOrNull(economics.grossProfitPaise),
      grossProfitWithGst: paiseToRupeesOrNull(economics.grossProfitWithGstPaise),
      interestDays: economics.interestDays,
      interest: paiseToRupeesOrNull(economics.interestPaise),
      netProfit: paiseToRupeesOrNull(economics.netProfitPaise),
    },

    createdById: record.createdBy,
    createdByName: record.createdByName,
    createdAt: iso(record.createdAt) as string,
    updatedAt: iso(record.updatedAt) as string,
    deletedAt: iso(record.deletedAt),
    deletedByName: record.deletedByName,
    deleteReason: record.deleteReason,
    imported: Boolean(record.importBatch),
  }
}

/** Personal file kinds are never pre-signed: they open through the logging route, one at a time. */
export function buildFileRef(
  file: DetailFile,
  caps: HPromiseCapabilities,
  signed: Readonly<Record<string, string>>,
): HpFileRef | null {
  if (!isFileKind(file.kind)) return null
  const canOpen = canOpenFileKind(caps, file.kind)
  const inlineAllowed = canOpen && FILE_KIND_POLICY[file.kind].sensitivity === 'normal' && file.contentType.startsWith('image/')
  return {
    id: file.id,
    kind: file.kind,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    uploadedAt: iso(file.uploadedAt) as string,
    uploadedByName: file.uploadedByName,
    source: file.source === 'import' ? 'import' : 'upload',
    previewUrl: inlineAllowed ? signed[file.storagePath] ?? null : null,
    canOpen,
  }
}

/** Which stored paths may be pre-signed for this viewer (normal-sensitivity images only). */
export function previewablePaths(files: ReadonlyArray<DetailFile>, caps: HPromiseCapabilities): string[] {
  return files
    .filter((file) => isFileKind(file.kind)
      && canOpenFileKind(caps, file.kind)
      && FILE_KIND_POLICY[file.kind].sensitivity === 'normal'
      && file.contentType.startsWith('image/'))
    .map((file) => file.storagePath)
}

export function buildBooking(record: DetailBooking, files: HpFileRef[]): HpBooking {
  return {
    id: record.id,
    status: record.status,
    bookingDate: ymd(record.bookingDate) as string,
    amount: num(record.amount) ?? 0,
    remarks: record.remarks,
    refundDate: ymd(record.refundDate),
    refundRemarks: record.refundRemarks,
    refundedByName: record.refundedByName,
    refundedAt: iso(record.refundedAt),
    createdByName: record.createdByName,
    createdAt: iso(record.createdAt) as string,
    files,
  }
}

export function buildEvent(record: DetailEvent): HpEvent {
  return {
    id: record.id,
    subject: record.subject,
    action: record.action,
    fromStatus: record.fromStatus,
    toStatus: record.toStatus,
    actorName: record.actorName,
    actorRole: record.actorRole,
    remarks: record.remarks,
    changes: (record.changes ?? {}) as Record<string, unknown>,
    createdAt: iso(record.createdAt) as string,
  }
}

export function buildVehicleDetail(
  row: HpVehicleRow,
  record: VehicleRecord,
  caps: HPromiseCapabilities,
  parts: {
    bookings: DetailBooking[]
    files: DetailFile[]
    events: DetailEvent[]
    signed: Readonly<Record<string, string>>
  },
): HpVehicleDetail {
  const current = parts.files.filter((file) => file.attachedAt && !file.supersededAt)
  const vehicleFiles = current
    .filter((file) => !file.bookingId)
    .map((file) => buildFileRef(file, caps, parts.signed))
    .filter((file): file is HpFileRef => file !== null)
  const bookingFiles = new Map<string, HpFileRef[]>()
  for (const file of current) {
    if (!file.bookingId) continue
    const ref = buildFileRef(file, caps, parts.signed)
    if (!ref) continue
    bookingFiles.set(file.bookingId, [...(bookingFiles.get(file.bookingId) ?? []), ref])
  }
  const replacedFiles = parts.files
    .filter((file) => file.attachedAt && file.supersededAt && isFileKind(file.kind))
    .map((file) => ({
      id: file.id,
      kind: file.kind as FileKind,
      uploadedAt: iso(file.uploadedAt) as string,
      uploadedByName: file.uploadedByName,
      supersededAt: iso(file.supersededAt) as string,
    }))

  return {
    ...row,
    odometerKm: record.odometerKm,
    engineNo: record.engineNo,
    chassisNo: record.chassisNo,
    expectedProfit: num(record.expectedProfit),
    purchaseRemarks: record.purchaseRemarks,
    purchaseFinanced: record.purchaseFinanced,
    salesConsultant: record.salesConsultant,
    sellerPhone: phoneFor(caps, record.sellerPhone),
    buyerPhone: phoneFor(caps, record.buyerPhone),
    buyerAddress: caps.canSeePii ? record.buyerAddress : null,
    documentsRemarks: record.documentsRemarks,
    documentsUpdatedByName: record.documentsUpdatedByName,
    documentsUpdatedAt: iso(record.documentsUpdatedAt),
    brokerRcRemarks: record.brokerRcRemarks,
    brokerRcUpdatedByName: record.brokerRcUpdatedByName,
    brokerRcUpdatedAt: iso(record.brokerRcUpdatedAt),
    updatedByName: record.updatedByName,
    importRow: record.importRow,
    bookings: parts.bookings.map((booking) => buildBooking(booking, bookingFiles.get(booking.id) ?? [])),
    files: vehicleFiles,
    replacedFiles,
    events: parts.events.map(buildEvent),
    redacted: !caps.canSeePii,
  }
}

export function buildExchangeBonus(record: ExchangeBonusRecord, caps: HPromiseCapabilities): HpExchangeBonus {
  return {
    id: record.id,
    entryDate: ymd(record.entryDate),
    vehicleNo: record.vehicleNo,
    vehicleName: record.vehicleName,
    salesConsultant: record.salesConsultant,
    newCarModel: record.newCarModel,
    bonusAmount: num(record.bonusAmount) ?? 0,
    customerPhone: phoneFor(caps, record.customerPhone),
    remarks: record.remarks,
    createdByName: record.createdByName,
    createdAt: iso(record.createdAt) as string,
    updatedAt: iso(record.updatedAt) as string,
  }
}
