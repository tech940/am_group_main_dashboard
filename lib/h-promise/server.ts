import 'server-only'

import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tataHPromiseBookings, tataHPromiseExchangeBonuses, tataHPromiseVehicles } from '@/lib/db/schema'
import { getIndiaYmd } from '@/lib/date-time'
import { HPromiseError, type HPromiseActor } from './access'
import type { HPromiseCapabilities } from './access-shared'
import { NOT_TAKEN, SALE_REQUIRED_FILES, formatStockNo, type FileKind } from './constants'
import { diffFields, recordHPromiseEvent, type Tx } from './events'
import { attachStagedFiles, currentFileKinds, describeAttached, supersedeKinds } from './files'
import { assertOption, groupOptions, loadOptions } from './options'
import { assertVehicleId, checkRegistration } from './queries'
import { displayRegNo } from './registration'
import {
  BROKER_RC_FILE_KINDS,
  DOCUMENT_FILE_KINDS,
  LEDGER_FILE_KINDS,
  PURCHASE_FILE_KINDS,
  SALE_FILE_KINDS,
  bookingSchema,
  bookingUpdateSchema,
  brokerRcSchema,
  createPurchaseSchema,
  decisionSchema,
  deleteSchema,
  documentsSchema,
  exchangeBonusSchema,
  ledgerSchema,
  refundSchema,
  reopenSchema,
  resubmitSchema,
  saleSchema,
  updatePurchaseSchema,
  withdrawSchema,
} from './schemas'
import { buildExchangeBonus, ymd, type VehicleRecord } from './serialize'
import { approvalLevelOf, canDecideAt, canPurchaseTransition, canSaleTransition, isSelfDecision, managerStageOf, type ApprovalLevel, type DecisionStatus } from './status'
import type { HpExchangeBonus } from './types'

/**
 * Every H Promise write.
 *
 * ── The rules each one follows (the gate-pass pattern, lib/gate-pass/server.ts) ─────────────────
 *
 * 1. COMPARE-AND-SWAP. A status move carries the status it expects in its own WHERE clause; an edit carries
 *    the `updated_at` the form was opened with. Zero rows updated means someone else got there first, and the
 *    person is told so (409) instead of silently overwriting them.
 * 2. ONE TRANSACTION. The change, the files it attaches and its history row commit together or not at all.
 * 3. NO EMAIL. The notification system was removed from this app on purpose; the section's "Needs attention"
 *    panel is where work waits.
 * 4. THE DATABASE BACKS THE OWNER'S SAFEGUARDS. No self-decision (CHECKs) and locked approved prices
 *    (trigger HP001) are enforced by Postgres too; the checks here exist to give a sentence instead of an error.
 *
 * ⚠️ Partial updates apply ONLY the keys the form sent (`sent`): the schemas turn a missing optional text into
 * null, which would otherwise blank a column nobody touched.
 */

type Capabilities = HPromiseCapabilities
const V = tataHPromiseVehicles
const B = tataHPromiseBookings

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

function sent(raw: unknown, key: string): boolean {
  return typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, key)
}

function money(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2)
}

function today(): string {
  return getIndiaYmd()
}

/** The version check: the row still has the `updated_at` the form was opened with (millisecond precision). */
function sameVersion(expectedIso: string) {
  const expected = new Date(expectedIso)
  if (Number.isNaN(expected.getTime())) throw new HPromiseError('This form is out of date. Reload the vehicle and try again.', 409)
  return sql`date_trunc('milliseconds', ${V.updatedAt}) = ${expected.toISOString()}::timestamptz`
}

const STALE = 'Someone else changed this vehicle a moment ago. Reload it and try again.'

async function readVehicle(id: string, writer: Tx | typeof db = db): Promise<VehicleRecord> {
  assertVehicleId(id)
  const [row] = await writer.select().from(V).where(eq(V.id, id)).limit(1)
  if (!row) throw new HPromiseError('That vehicle was not found.', 404)
  return row
}

function assertLive(vehicle: VehicleRecord): void {
  if (vehicle.deletedAt) throw new HPromiseError('This vehicle was deleted. Restore it first.', 409)
}

function label(vehicle: Pick<VehicleRecord, 'stockNo' | 'regNo'>): string {
  return `${formatStockNo(vehicle.stockNo)} (${vehicle.regNo})`
}

function eventBase(vehicle: Pick<VehicleRecord, 'id' | 'stockNo' | 'regNo'>) {
  return { vehicleId: vehicle.id, stockNo: vehicle.stockNo, regNo: vehicle.regNo }
}

function assertNotFuture(ymdValue: string, what: string): void {
  if (ymdValue > today()) throw new HPromiseError(`The ${what} cannot be in the future.`, 400)
}

function assertNotBefore(ymdValue: string, floor: string | null, what: string, floorWhat: string): void {
  if (floor && ymdValue < floor) throw new HPromiseError(`The ${what} cannot be before the ${floorWhat} (${floor}).`, 400)
}

function assertYear(year: number | null | undefined): void {
  if (year === null || year === undefined) return
  const max = Number(today().slice(0, 4)) + 1
  if (year > max) throw new HPromiseError(`The manufacturing year cannot be after ${max}.`, 400)
}

async function optionLists() {
  return groupOptions(await loadOptions())
}

function statusWord(status: string | null): string {
  if (status === 'pending') return 'waiting for approval'
  if (status === 'approved') return 'already approved'
  if (status === 'rejected') return 'already rejected'
  return 'not recorded'
}

const PURCHASE_MATERIAL = ['regNo', 'purchaseDate', 'purchasePrice', 'purchaseGstPct'] as const
const SALE_MATERIAL = ['saleDate', 'sellingPrice', 'otherCost', 'soldTo'] as const

/*
 * ── Two-stage approval (owner, 2026-09-17) ───────────────────────────────────────────────────────
 * GSM / Sales Manager first (the Approve tick), then the MD (final; may act while the first stage waits).
 * A fresh submission — new, resubmitted, reopened, or with changed numbers — starts again at the manager.
 */
const PURCHASE_MANAGER_RESET = {
  purchaseManagerStatus: 'pending',
  purchaseManagerBy: null,
  purchaseManagerByName: null,
  purchaseManagerRole: null,
  purchaseManagerAt: null,
  purchaseManagerNote: null,
} satisfies Partial<VehicleRecord>
const PURCHASE_FINAL_CLEAR = {
  purchaseDecidedBy: null,
  purchaseDecidedByName: null,
  purchaseDecidedRole: null,
  purchaseDecidedAt: null,
  purchaseDecisionReason: null,
} satisfies Partial<VehicleRecord>
const SALE_MANAGER_RESET = {
  saleManagerStatus: 'pending',
  saleManagerBy: null,
  saleManagerByName: null,
  saleManagerRole: null,
  saleManagerAt: null,
  saleManagerNote: null,
} satisfies Partial<VehicleRecord>
const SALE_FINAL_CLEAR = {
  saleDecidedBy: null,
  saleDecidedByName: null,
  saleDecidedRole: null,
  saleDecidedAt: null,
  saleDecisionReason: null,
} satisfies Partial<VehicleRecord>

function decisionLevel(caps: Capabilities, what: string): ApprovalLevel {
  const level = approvalLevelOf(caps.approvals)
  if (!level) throw new HPromiseError(`You cannot approve ${what}.`, 403)
  return level
}

// ── Purchase ─────────────────────────────────────────────────────────────────────────────────────

export async function createPurchase(actor: HPromiseActor, caps: Capabilities, raw: unknown) {
  if (!caps.register.create) throw new HPromiseError('You cannot record purchases.', 403)
  const input = createPurchaseSchema.parse(raw)
  assertNotFuture(input.purchaseDate, 'purchase date')
  assertYear(input.manufacturingYear)
  const lists = await optionLists()
  assertOption(lists, 'location', input.location)
  assertOption(lists, 'staff', input.purchasedBy)
  assertOption(lists, 'approver', input.purchaseWhatsappApprover)
  if (input.purchaseWhatsappApprover !== NOT_TAKEN && !input.files.purchase_approval_screenshot) {
    throw new HPromiseError('Attach the WhatsApp approval screenshot, or choose "Approval not taken on WhatsApp".', 400)
  }

  const existing = await checkRegistration(input.regNo)
  if (existing.live) {
    throw new HPromiseError(`This registration is already on the register as ${formatStockNo(existing.live.stockNo)}.`, 409)
  }

  const now = new Date()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(V)
      .values({
        regNo: displayRegNo(input.regNo),
        model: input.model,
        colour: input.colour,
        manufacturingYear: input.manufacturingYear,
        odometerKm: input.odometerKm,
        engineNo: input.engineNo,
        chassisNo: input.chassisNo,
        location: input.location,
        purchaseDate: input.purchaseDate,
        purchasePrice: money(input.purchasePrice) as string,
        purchaseGstPct: String(input.purchaseGstPct),
        expectedProfit: money(input.expectedProfit),
        expectedSaleDate: input.expectedSaleDate || null,
        purchaseRemarks: input.purchaseRemarks,
        purchaseFinanced: input.purchaseFinanced,
        purchasedBy: input.purchasedBy,
        salesConsultant: input.salesConsultant,
        sellerPhone: input.sellerPhone,
        purchaseWhatsappApprover: input.purchaseWhatsappApprover,
        purchaseStatus: 'pending',
        purchaseManagerStatus: 'pending',
        purchaseSubmittedBy: actor.id,
        purchaseSubmittedByName: actor.name,
        purchaseSubmittedAt: now,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .returning()
    const attached = await attachStagedFiles(tx, {
      actor,
      vehicleId: row.id,
      files: input.files,
      allowed: PURCHASE_FILE_KINDS,
    })
    await recordHPromiseEvent(tx, {
      ...eventBase(row),
      action: 'purchase_created',
      toStatus: 'pending',
      actor,
      remarks: input.purchaseRemarks,
      changes: {
        purchasePrice: input.purchasePrice,
        purchaseGstPct: input.purchaseGstPct,
        purchaseDate: input.purchaseDate,
        expectedSaleDate: input.expectedSaleDate,
        location: input.location,
        purchaseWhatsappApprover: input.purchaseWhatsappApprover,
        ...describeAttached(attached),
      },
    })
    return { id: row.id, stockNo: row.stockNo }
  })
}

const PURCHASE_FIELDS = [
  'regNo', 'model', 'colour', 'manufacturingYear', 'odometerKm', 'engineNo', 'chassisNo', 'location',
  'purchaseDate', 'purchasePrice', 'purchaseGstPct', 'expectedProfit', 'expectedSaleDate', 'purchaseRemarks', 'purchaseFinanced',
  'purchasedBy', 'salesConsultant', 'sellerPhone', 'purchaseWhatsappApprover',
] as const

/**
 * Edit a purchase. The desk may also correct its OWN entry while it is still pending or rejected with only
 * the create right. Saving a rejected purchase with `resubmit` sends it back to the approvers in the same step.
 */
export async function updatePurchase(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  const input = updatePurchaseSchema.parse(raw)
  const resubmit = input.resubmit === true
  const current = await readVehicle(id)
  assertLive(current)
  const ownOpenEntry = caps.register.create && current.createdBy === actor.id && current.purchaseStatus !== 'approved'
  if (!caps.register.edit && !ownOpenEntry) throw new HPromiseError('You cannot edit this purchase.', 403)

  const patch: Partial<VehicleRecord> = {}
  const lists = await optionLists()
  for (const key of PURCHASE_FIELDS) {
    if (!sent(raw, key)) continue
    const value = input[key]
    switch (key) {
      case 'regNo': patch.regNo = displayRegNo(value as string); break
      case 'purchasePrice': patch.purchasePrice = money(value as number) as string; break
      case 'purchaseGstPct': patch.purchaseGstPct = String(value); break
      case 'expectedProfit': patch.expectedProfit = money(value as number | null); break
      case 'expectedSaleDate': patch.expectedSaleDate = (value as string | null) || null; break
      case 'location': assertOption(lists, 'location', value as string, current.location); patch.location = value as string; break
      case 'purchasedBy': assertOption(lists, 'staff', value as string, current.purchasedBy); patch.purchasedBy = value as string; break
      case 'purchaseWhatsappApprover':
        assertOption(lists, 'approver', value as string, current.purchaseWhatsappApprover)
        patch.purchaseWhatsappApprover = value as string
        break
      case 'purchaseDate': assertNotFuture(value as string, 'purchase date'); patch.purchaseDate = value as string; break
      case 'manufacturingYear': assertYear(value as number | null); patch.manufacturingYear = value as number | null; break
      default:
        ;(patch as Record<string, unknown>)[key] = value
    }
  }

  const changes = diffFields(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, PURCHASE_FIELDS as unknown as string[])
  const priceChanged = 'purchasePrice' in changes || 'purchaseGstPct' in changes
  if (priceChanged && current.purchaseStatus === 'approved') {
    throw new HPromiseError('The purchase price is locked after the MD approved it. Ask the MD to reopen the purchase first.', 409)
  }
  if ('regNo' in changes) {
    const existing = await checkRegistration(patch.regNo as string, id)
    if (existing.live && current.saleStatus !== 'approved') {
      throw new HPromiseError(`That registration is already on the register as ${formatStockNo(existing.live.stockNo)}.`, 409)
    }
  }
  if (current.saleDate && patch.purchaseDate && patch.purchaseDate > ymd(current.saleDate)!) {
    throw new HPromiseError('The purchase date cannot be after the sale date.', 400)
  }
  const approver = patch.purchaseWhatsappApprover ?? current.purchaseWhatsappApprover
  if (approver !== NOT_TAKEN && !input.files.purchase_approval_screenshot && 'purchaseWhatsappApprover' in changes) {
    const present = await currentFileKinds(id)
    if (!present.has('purchase_approval_screenshot')) {
      throw new HPromiseError('Attach the WhatsApp approval screenshot, or choose "Approval not taken on WhatsApp".', 400)
    }
  }
  const hasFiles = Object.values(input.files).some(Boolean)
  if (resubmit && current.purchaseStatus !== 'rejected') {
    throw new HPromiseError(`This purchase is ${statusWord(current.purchaseStatus)}, so it cannot be resubmitted.`, 409)
  }
  if (Object.keys(changes).length === 0 && !hasFiles && !resubmit) return { id, changed: false }

  const now = new Date()
  const set: Partial<VehicleRecord> = { ...patch, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now }
  // Whoever changes the numbers of an undecided purchase is its submitter now, so they cannot approve them.
  const material = PURCHASE_MATERIAL.some((key) => key in changes)
  if (resubmit || (material && current.purchaseStatus === 'pending')) {
    Object.assign(set, { purchaseSubmittedBy: actor.id, purchaseSubmittedByName: actor.name, purchaseSubmittedAt: now })
  }
  if (resubmit) Object.assign(set, { purchaseStatus: 'pending', ...PURCHASE_FINAL_CLEAR, ...PURCHASE_MANAGER_RESET })
  // The GSM / SM approved other numbers. Changed numbers go back to them (the MD can still approve at once).
  const managerReset = !resubmit && material && current.purchaseStatus === 'pending'
    && managerStageOf(current.purchaseStatus, current.purchaseManagerStatus) === 'approved'
  if (managerReset) Object.assign(set, PURCHASE_MANAGER_RESET)

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set(set)
      .where(and(eq(V.id, id), isNull(V.deletedAt), sameVersion(input.expectedUpdatedAt), eq(V.purchaseStatus, current.purchaseStatus)))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError(STALE, 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: id, files: input.files, allowed: PURCHASE_FILE_KINDS })
    if (Object.keys(changes).length > 0 || attached.length > 0) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'purchase_updated',
        fromStatus: current.purchaseStatus,
        toStatus: current.purchaseStatus,
        actor,
        remarks: input.remarks,
        changes: { ...changes, ...describeAttached(attached) },
      })
    }
    if (resubmit) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'purchase_resubmitted',
        fromStatus: 'rejected',
        toStatus: 'pending',
        actor,
        remarks: input.remarks,
      })
    }
    if (managerReset) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'purchase_manager_reset',
        fromStatus: 'pending',
        toStatus: 'pending',
        actor,
        remarks: `The numbers changed after ${current.purchaseManagerByName ?? 'the GSM / SM'} approved them, so the purchase needs their approval again.`,
      })
    }
  })
  return { id, changed: true }
}

export async function resubmitPurchase(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  const input = resubmitSchema.parse(raw ?? {})
  const current = await readVehicle(id)
  assertLive(current)
  const own = caps.register.create && current.createdBy === actor.id
  if (!caps.register.edit && !own) throw new HPromiseError('You cannot resubmit this purchase.', 403)
  if (!canPurchaseTransition('resubmit', current.purchaseStatus)) {
    throw new HPromiseError(`This purchase is ${statusWord(current.purchaseStatus)}, so it cannot be resubmitted.`, 409)
  }
  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        purchaseStatus: 'pending',
        purchaseSubmittedBy: actor.id,
        purchaseSubmittedByName: actor.name,
        purchaseSubmittedAt: now,
        ...PURCHASE_FINAL_CLEAR,
        ...PURCHASE_MANAGER_RESET,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), eq(V.purchaseStatus, 'rejected')))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This purchase changed a moment ago. Reload it and try again.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'purchase_resubmitted',
      fromStatus: 'rejected',
      toStatus: 'pending',
      actor,
      remarks: input.remarks,
    })
  })
}

/**
 * Approve or reject a purchase at the stage this person decides.
 *
 *   GSM / SM (the Approve tick)  approve → the purchase waits for the MD;  reject → back to the desk.
 *   MD (final)                   approve → approved and the price locks;  reject → back to the desk.
 *                                Allowed while the GSM / SM stage still waits; that stage is then "skipped".
 */
export async function decidePurchase(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  const level = decisionLevel(caps, 'purchases')
  const input = decisionSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (current.purchaseStatus !== 'pending') {
    throw new HPromiseError(`This purchase is ${statusWord(current.purchaseStatus)}.`, 409)
  }
  if (!canDecideAt(level, current.purchaseStatus, current.purchaseManagerStatus)) {
    throw new HPromiseError('The GSM / SM stage of this purchase is already done. It is waiting for the MD.', 409)
  }
  if (isSelfDecision(actor.id, [current.createdBy, current.purchaseSubmittedBy])) {
    throw new HPromiseError('You entered this purchase, so someone else must decide it.', 403)
  }
  const approve = input.decision === 'approve'
  const now = new Date()
  const managerWaiting = managerStageOf(current.purchaseStatus, current.purchaseManagerStatus) === 'pending'
  const final = { purchaseDecidedBy: actor.id, purchaseDecidedByName: actor.name, purchaseDecidedRole: actor.role, purchaseDecidedAt: now, purchaseDecisionReason: input.reason }
  const manager = { purchaseManagerBy: actor.id, purchaseManagerByName: actor.name, purchaseManagerRole: actor.role, purchaseManagerAt: now, purchaseManagerNote: input.reason }
  let to: DecisionStatus
  let action: string
  let set: Partial<VehicleRecord>
  if (level === 'md') {
    to = approve ? 'approved' : 'rejected'
    action = approve ? 'purchase_approved' : 'purchase_rejected'
    set = { purchaseStatus: to, ...final, ...(managerWaiting ? { purchaseManagerStatus: 'skipped' } : {}) }
  } else if (approve) {
    to = 'pending'
    action = 'purchase_manager_approved'
    set = { purchaseManagerStatus: 'approved', ...manager }
  } else {
    to = 'rejected'
    action = 'purchase_manager_rejected'
    set = { purchaseStatus: 'rejected', purchaseManagerStatus: 'rejected', ...manager, ...final }
  }
  const stageOpen = level === 'md'
    ? undefined
    : or(isNull(V.purchaseManagerStatus), eq(V.purchaseManagerStatus, 'pending'))
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({ ...set, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
      .where(and(eq(V.id, id), isNull(V.deletedAt), eq(V.purchaseStatus, 'pending'), stageOpen))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('Someone decided this purchase a moment ago. Reload to see it.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action,
      fromStatus: 'pending',
      toStatus: to,
      actor,
      remarks: input.reason,
      changes: { stage: level, ...(level === 'md' && managerWaiting ? { managerStage: 'skipped' } : {}) },
    })
  })
  return { status: to, stage: level }
}

export async function reopenPurchase(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.approvals.final) throw new HPromiseError('Only the MD can reopen an approved purchase.', 403)
  const input = reopenSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (!canPurchaseTransition('reopen', current.purchaseStatus)) {
    throw new HPromiseError(`This purchase is ${statusWord(current.purchaseStatus)}, so there is nothing to reopen.`, 409)
  }
  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        purchaseStatus: 'pending',
        ...PURCHASE_FINAL_CLEAR,
        ...PURCHASE_MANAGER_RESET,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), eq(V.purchaseStatus, 'approved')))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This purchase changed a moment ago. Reload it and try again.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'purchase_reopened',
      fromStatus: 'approved',
      toStatus: 'pending',
      actor,
      remarks: input.reason,
    })
  })
}

// ── Delete / restore ─────────────────────────────────────────────────────────────────────────────

export async function deleteVehicle(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.register.delete) throw new HPromiseError('You cannot delete vehicles.', 403)
  const input = deleteSchema.parse(raw)
  const current = await readVehicle(id)
  if (current.deletedAt) throw new HPromiseError('This vehicle is already deleted.', 409)
  if ((current.purchaseStatus === 'approved' || current.saleStatus === 'approved') && !caps.approvals.final) {
    throw new HPromiseError('The MD approved this vehicle\'s purchase or sale, so only the MD may delete it.', 403)
  }
  const [booking] = await db.select({ id: B.id }).from(B).where(and(eq(B.vehicleId, id), eq(B.status, 'active'))).limit(1)
  if (booking) throw new HPromiseError('This vehicle has a live booking. Refund the booking before deleting the vehicle.', 409)

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({ deletedAt: now, deletedBy: actor.id, deletedByName: actor.name, deleteReason: input.reason, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
      .where(and(eq(V.id, id), isNull(V.deletedAt)))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This vehicle changed a moment ago. Reload it and try again.', 409)
    await recordHPromiseEvent(tx, { ...eventBase(current), action: 'vehicle_deleted', actor, remarks: input.reason })
  })
}

export async function restoreVehicle(actor: HPromiseActor, caps: Capabilities, id: string) {
  if (!caps.register.delete) throw new HPromiseError('You cannot restore vehicles.', 403)
  const current = await readVehicle(id)
  if (!current.deletedAt) throw new HPromiseError('This vehicle is not deleted.', 409)
  if (current.saleStatus !== 'approved') {
    const existing = await checkRegistration(current.regNo, id)
    if (existing.live) {
      throw new HPromiseError(`It cannot come back: ${current.regNo} is on the register again as ${formatStockNo(existing.live.stockNo)}.`, 409)
    }
  }
  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({ deletedAt: null, deletedBy: null, deletedByName: null, deleteReason: null, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
      .where(and(eq(V.id, id), isNotNull(V.deletedAt)))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This vehicle changed a moment ago. Reload it and try again.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'vehicle_restored',
      actor,
      remarks: `Deleted ${current.deletedAt?.toISOString().slice(0, 10)} by ${current.deletedByName ?? 'unknown'}: ${current.deleteReason ?? ''}`.trim(),
    })
  })
}

// ── Bookings ─────────────────────────────────────────────────────────────────────────────────────

export async function createBooking(actor: HPromiseActor, caps: Capabilities, vehicleId: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot record bookings.', 403)
  const input = bookingSchema.parse(raw)
  const vehicle = await readVehicle(vehicleId)
  assertLive(vehicle)
  if (vehicle.saleStatus === 'pending' || vehicle.saleStatus === 'approved') {
    throw new HPromiseError(`${label(vehicle)} is already sold. A booking cannot be added.`, 409)
  }
  assertNotFuture(input.bookingDate, 'booking date')
  assertNotBefore(input.bookingDate, ymd(vehicle.purchaseDate), 'booking date', 'purchase date')
  if (!input.files.booking_receipt) throw new HPromiseError('Attach the booking receipt.', 400)

  const now = new Date()
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .insert(B)
      .values({
        vehicleId,
        status: 'active',
        bookingDate: input.bookingDate,
        amount: money(input.amount) as string,
        remarks: input.remarks,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .returning()
    const attached = await attachStagedFiles(tx, { actor, vehicleId, bookingId: booking.id, files: input.files, allowed: ['booking_receipt'] })
    await recordHPromiseEvent(tx, {
      ...eventBase(vehicle),
      subject: 'booking',
      subjectId: booking.id,
      action: 'booking_recorded',
      toStatus: 'active',
      actor,
      remarks: input.remarks,
      changes: { bookingDate: input.bookingDate, amount: input.amount, ...describeAttached(attached) },
    })
    return { id: booking.id }
  })
}

async function readBooking(bookingId: string) {
  assertVehicleId(bookingId)
  const [booking] = await db.select().from(B).where(eq(B.id, bookingId)).limit(1)
  if (!booking) throw new HPromiseError('That booking was not found.', 404)
  const vehicle = await readVehicle(booking.vehicleId)
  return { booking, vehicle }
}

/** Date, remarks and receipt: the desk. The AMOUNT is money received — only an approver corrects it, with a reason. */
export async function updateBooking(actor: HPromiseActor, caps: Capabilities, bookingId: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot edit bookings.', 403)
  const input = bookingUpdateSchema.parse(raw)
  const { booking, vehicle } = await readBooking(bookingId)
  assertLive(vehicle)
  if (booking.status !== 'active') throw new HPromiseError('A refunded booking cannot be edited.', 409)

  const patch: Partial<typeof B.$inferSelect> = {}
  if (sent(raw, 'bookingDate') && input.bookingDate) {
    assertNotFuture(input.bookingDate, 'booking date')
    assertNotBefore(input.bookingDate, ymd(vehicle.purchaseDate), 'booking date', 'purchase date')
    patch.bookingDate = input.bookingDate
  }
  if (sent(raw, 'remarks')) patch.remarks = input.remarks ?? null
  if (sent(raw, 'amount') && input.amount !== undefined) patch.amount = money(input.amount) as string
  const changes = diffFields(booking as unknown as Record<string, unknown>, patch as Record<string, unknown>, ['bookingDate', 'remarks', 'amount'])
  if ('amount' in changes) {
    if (!caps.approvals.approve) throw new HPromiseError('Only an approver can correct a booking amount.', 403)
    if (!input.reason || input.reason.length < 5) throw new HPromiseError('Say why the booking amount is being corrected.', 400)
  }
  const hasFiles = Object.values(input.files).some(Boolean)
  if (Object.keys(changes).length === 0 && !hasFiles) return

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(B)
      .set({ ...patch, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
      .where(and(eq(B.id, bookingId), eq(B.status, 'active')))
      .returning({ id: B.id })
    if (updated.length === 0) throw new HPromiseError('This booking changed a moment ago. Reload it and try again.', 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: vehicle.id, bookingId, files: input.files, allowed: ['booking_receipt'] })
    await recordHPromiseEvent(tx, {
      ...eventBase(vehicle),
      subject: 'booking',
      subjectId: bookingId,
      action: 'booking_updated',
      actor,
      remarks: input.reason,
      changes: { ...changes, ...describeAttached(attached) },
    })
  })
}

export async function refundBooking(actor: HPromiseActor, caps: Capabilities, bookingId: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot refund bookings.', 403)
  const input = refundSchema.parse(raw)
  const { booking, vehicle } = await readBooking(bookingId)
  assertLive(vehicle)
  if (booking.status !== 'active') throw new HPromiseError('This booking is already refunded.', 409)
  if (vehicle.saleStatus === 'pending' || vehicle.saleStatus === 'approved') {
    throw new HPromiseError('This vehicle has a sale recorded. Withdraw the sale before refunding its booking.', 409)
  }
  assertNotFuture(input.refundDate, 'refund date')
  assertNotBefore(input.refundDate, ymd(booking.bookingDate), 'refund date', 'booking date')
  if (!input.files.refund_cheque) throw new HPromiseError('Attach the refund cheque.', 400)

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(B)
      .set({
        status: 'refunded',
        refundDate: input.refundDate,
        refundRemarks: input.refundRemarks,
        refundedBy: actor.id,
        refundedByName: actor.name,
        refundedAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(B.id, bookingId), eq(B.status, 'active')))
      .returning({ id: B.id })
    if (updated.length === 0) throw new HPromiseError('This booking changed a moment ago. Reload it and try again.', 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: vehicle.id, bookingId, files: input.files, allowed: ['refund_cheque'] })
    await recordHPromiseEvent(tx, {
      ...eventBase(vehicle),
      subject: 'booking',
      subjectId: bookingId,
      action: 'booking_refunded',
      fromStatus: 'active',
      toStatus: 'refunded',
      actor,
      remarks: input.refundRemarks,
      changes: { refundDate: input.refundDate, amount: Number(booking.amount), ...describeAttached(attached) },
    })
  })
}

// ── Sale ─────────────────────────────────────────────────────────────────────────────────────────

const SALE_FIELDS = [
  'saleDate', 'sellingPrice', 'otherCost', 'isDemo', 'soldTo', 'saleFinanced', 'soldBy',
  'buyerName', 'buyerPhone', 'buyerAddress', 'saleWhatsappApprover',
] as const

/**
 * Record a sale (no sale yet) or edit the recorded one. Saving a rejected sale sends it back for approval.
 * The selling price of an approved sale is locked; everything else stays editable and is logged.
 */
export async function saveSale(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot record sales.', 403)
  const input = saleSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  const isNew = current.saleStatus === null
  if (!isNew && !input.expectedUpdatedAt) throw new HPromiseError('This form is out of date. Reload the vehicle and try again.', 409)

  assertNotFuture(input.saleDate, 'sale date')
  assertNotBefore(input.saleDate, ymd(current.purchaseDate), 'sale date', 'purchase date')
  const lists = await optionLists()
  assertOption(lists, 'staff', input.soldBy, current.soldBy)
  assertOption(lists, 'approver', input.saleWhatsappApprover, current.saleWhatsappApprover)

  const patch: Partial<VehicleRecord> = {
    saleDate: input.saleDate,
    sellingPrice: money(input.sellingPrice),
    otherCost: money(input.otherCost) as string,
    isDemo: input.isDemo,
    soldTo: input.soldTo,
    saleFinanced: input.saleFinanced,
    soldBy: input.soldBy,
    buyerName: input.buyerName,
    buyerPhone: input.buyerPhone,
    buyerAddress: input.buyerAddress,
    saleWhatsappApprover: input.saleWhatsappApprover,
  }
  const changes = isNew ? {} : diffFields(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, SALE_FIELDS as unknown as string[])
  if (!isNew && 'sellingPrice' in changes && current.saleStatus === 'approved') {
    throw new HPromiseError('The selling price is locked after the MD approved it. Ask the MD to reopen the sale first.', 409)
  }

  // Required proof, as the sheet enforced: PAN, Aadhaar, gate pass, and the WhatsApp screenshot unless no
  // WhatsApp approval was taken. Files already on a recorded sale count.
  const present = isNew ? new Set<FileKind>() : await currentFileKinds(id)
  const required = SALE_REQUIRED_FILES.filter((kind) => kind !== 'sale_approval_screenshot' || input.saleWhatsappApprover !== NOT_TAKEN)
  const missing = required.filter((kind) => !input.files[kind as (typeof SALE_FILE_KINDS)[number]] && !present.has(kind))
  if (missing.length > 0) {
    const names: Record<string, string> = {
      buyer_pan: "buyer's PAN",
      buyer_aadhaar: "buyer's Aadhaar",
      sale_approval_screenshot: 'WhatsApp approval screenshot',
      gate_pass_photo: 'gate pass',
    }
    throw new HPromiseError(`Attach the ${missing.map((kind) => names[kind] ?? kind).join(', ')}.`, 400)
  }

  const resubmit = current.saleStatus === 'rejected'
  const hasFiles = Object.values(input.files).some(Boolean)
  if (!isNew && !resubmit && Object.keys(changes).length === 0 && !hasFiles) return { id, changed: false }

  const now = new Date()
  const set: Partial<VehicleRecord> = { ...patch, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now }
  const material = SALE_MATERIAL.some((key) => key in changes)
  if (isNew || resubmit || (material && current.saleStatus === 'pending')) {
    Object.assign(set, { saleSubmittedBy: actor.id, saleSubmittedByName: actor.name, saleSubmittedAt: now })
  }
  if (isNew || resubmit) Object.assign(set, { saleStatus: 'pending', ...SALE_FINAL_CLEAR, ...SALE_MANAGER_RESET })
  const managerReset = !isNew && !resubmit && material && current.saleStatus === 'pending'
    && managerStageOf(current.saleStatus, current.saleManagerStatus) === 'approved'
  if (managerReset) Object.assign(set, SALE_MANAGER_RESET)

  await db.transaction(async (tx) => {
    const where = isNew
      ? and(eq(V.id, id), isNull(V.deletedAt), isNull(V.saleStatus))
      : and(eq(V.id, id), isNull(V.deletedAt), eq(V.saleStatus, current.saleStatus as string), sameVersion(input.expectedUpdatedAt as string))
    const updated = await tx.update(V).set(set).where(where).returning({ id: V.id })
    if (updated.length === 0) {
      throw new HPromiseError(isNew ? 'A sale was recorded for this vehicle a moment ago. Reload to see it.' : STALE, 409)
    }
    const attached = await attachStagedFiles(tx, { actor, vehicleId: id, files: input.files, allowed: SALE_FILE_KINDS })
    if (isNew) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'sale_recorded',
        toStatus: 'pending',
        actor,
        changes: {
          saleDate: input.saleDate,
          sellingPrice: input.sellingPrice,
          otherCost: input.otherCost,
          soldTo: input.soldTo,
          soldBy: input.soldBy,
          saleWhatsappApprover: input.saleWhatsappApprover,
          ...describeAttached(attached),
        },
      })
      return
    }
    if (Object.keys(changes).length > 0 || attached.length > 0) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'sale_updated',
        fromStatus: current.saleStatus,
        toStatus: current.saleStatus,
        actor,
        remarks: input.remarks,
        changes: { ...changes, ...describeAttached(attached) },
      })
    }
    if (resubmit) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'sale_resubmitted',
        fromStatus: 'rejected',
        toStatus: 'pending',
        actor,
        remarks: input.remarks,
      })
    }
    if (managerReset) {
      await recordHPromiseEvent(tx, {
        ...eventBase(current),
        action: 'sale_manager_reset',
        fromStatus: 'pending',
        toStatus: 'pending',
        actor,
        remarks: `The sale changed after ${current.saleManagerByName ?? 'the GSM / SM'} approved it, so it needs their approval again.`,
      })
    }
  })
  return { id, changed: true }
}

/** The sale fell through before approval: the car goes back to stock (or to its booking), paperwork retired. */
export async function withdrawSale(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot withdraw sales.', 403)
  const input = withdrawSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (!canSaleTransition('withdraw', current.saleStatus)) {
    throw new HPromiseError(
      current.saleStatus === 'approved'
        ? 'The MD approved this sale. The MD must reopen it before it can be withdrawn.'
        : 'There is no sale to withdraw.',
      409,
    )
  }
  const present = await currentFileKinds(id)
  if (present.has('payment_ledger') && !caps.isSuperAdmin) {
    throw new HPromiseError('The payment ledger for this sale has been uploaded. Ask an admin to withdraw it.', 409)
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        saleStatus: null,
        saleDate: null,
        sellingPrice: null,
        isDemo: null,
        soldTo: null,
        saleFinanced: null,
        soldBy: null,
        buyerName: null,
        buyerPhone: null,
        buyerAddress: null,
        saleWhatsappApprover: null,
        saleSubmittedBy: null,
        saleSubmittedByName: null,
        saleSubmittedAt: null,
        ...SALE_FINAL_CLEAR,
        ...SALE_MANAGER_RESET,
        saleManagerStatus: null,
        brokerRcRemarks: null,
        brokerRcUpdatedBy: null,
        brokerRcUpdatedByName: null,
        brokerRcUpdatedAt: null,
        paymentVerifiedBy: null,
        paymentVerifiedByName: null,
        paymentVerifiedAt: null,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), inArray(V.saleStatus, ['pending', 'rejected'])))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This sale changed a moment ago. Reload it and try again.', 409)
    const retired = await supersedeKinds(tx, id, [...SALE_FILE_KINDS, 'rc_transfer', 'payment_ledger'])
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'sale_withdrawn',
      fromStatus: current.saleStatus,
      toStatus: null,
      actor,
      remarks: input.reason,
      changes: {
        saleDate: { from: ymd(current.saleDate), to: null },
        sellingPrice: { from: Number(current.sellingPrice), to: null },
        soldTo: { from: current.soldTo, to: null },
        buyerName: { from: current.buyerName, to: null },
        buyerPhone: { changed: true },
        filesRetired: retired,
      },
    })
  })
}

/** Approve or reject a sale at the stage this person decides — the same two stages as decidePurchase. */
export async function decideSale(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  const level = decisionLevel(caps, 'sales')
  const input = decisionSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (current.saleStatus !== 'pending') {
    throw new HPromiseError(`This sale is ${statusWord(current.saleStatus)}.`, 409)
  }
  if (!canDecideAt(level, current.saleStatus, current.saleManagerStatus)) {
    throw new HPromiseError('The GSM / SM stage of this sale is already done. It is waiting for the MD.', 409)
  }
  if (isSelfDecision(actor.id, [current.saleSubmittedBy])) {
    throw new HPromiseError('You entered this sale, so someone else must decide it.', 403)
  }
  const approve = input.decision === 'approve'
  const now = new Date()
  const managerWaiting = managerStageOf(current.saleStatus, current.saleManagerStatus) === 'pending'
  const final = { saleDecidedBy: actor.id, saleDecidedByName: actor.name, saleDecidedRole: actor.role, saleDecidedAt: now, saleDecisionReason: input.reason }
  const manager = { saleManagerBy: actor.id, saleManagerByName: actor.name, saleManagerRole: actor.role, saleManagerAt: now, saleManagerNote: input.reason }
  let to: DecisionStatus
  let action: string
  let set: Partial<VehicleRecord>
  if (level === 'md') {
    to = approve ? 'approved' : 'rejected'
    action = approve ? 'sale_approved' : 'sale_rejected'
    set = { saleStatus: to, ...final, ...(managerWaiting ? { saleManagerStatus: 'skipped' } : {}) }
  } else if (approve) {
    to = 'pending'
    action = 'sale_manager_approved'
    set = { saleManagerStatus: 'approved', ...manager }
  } else {
    to = 'rejected'
    action = 'sale_manager_rejected'
    set = { saleStatus: 'rejected', saleManagerStatus: 'rejected', ...manager, ...final }
  }
  const stageOpen = level === 'md'
    ? undefined
    : or(isNull(V.saleManagerStatus), eq(V.saleManagerStatus, 'pending'))
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({ ...set, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
      .where(and(eq(V.id, id), isNull(V.deletedAt), eq(V.saleStatus, 'pending'), stageOpen))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('Someone decided this sale a moment ago. Reload to see it.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action,
      fromStatus: 'pending',
      toStatus: to,
      actor,
      remarks: input.reason,
      changes: { stage: level, ...(level === 'md' && managerWaiting ? { managerStage: 'skipped' } : {}) },
    })
  })
  return { status: to, stage: level }
}

export async function reopenSale(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.approvals.final) throw new HPromiseError('Only the MD can reopen an approved sale.', 403)
  const input = reopenSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (!canSaleTransition('reopen', current.saleStatus)) {
    throw new HPromiseError(`This sale is ${statusWord(current.saleStatus)}, so there is nothing to reopen.`, 409)
  }
  // A reopened sale puts the car back among the live registrations; a buy-back of the same car would collide.
  const existing = await checkRegistration(current.regNo, id)
  if (existing.live) {
    throw new HPromiseError(`${current.regNo} has been bought again as ${formatStockNo(existing.live.stockNo)}, so this older sale can no longer be reopened.`, 409)
  }
  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        saleStatus: 'pending',
        ...SALE_FINAL_CLEAR,
        ...SALE_MANAGER_RESET,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), eq(V.saleStatus, 'approved')))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This sale changed a moment ago. Reload it and try again.', 409)
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'sale_reopened',
      fromStatus: 'approved',
      toStatus: 'pending',
      actor,
      remarks: input.reason,
    })
  })
}

// ── Paperwork ────────────────────────────────────────────────────────────────────────────────────

const DOCUMENT_FIELDS = ['insuranceEndDate', 'hypothecation', 'rtoStatus', 'documentsRemarks'] as const

export async function saveDocuments(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot update documents.', 403)
  const input = documentsSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)

  const patch: Partial<VehicleRecord> = {}
  for (const key of DOCUMENT_FIELDS) {
    if (sent(raw, key)) (patch as Record<string, unknown>)[key] = input[key]
  }
  const changes = diffFields(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, DOCUMENT_FIELDS as unknown as string[])
  const hasFiles = Object.values(input.files).some(Boolean)
  if (Object.keys(changes).length === 0 && !hasFiles) return { changed: false }

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        ...patch,
        documentsUpdatedBy: actor.id,
        documentsUpdatedByName: actor.name,
        documentsUpdatedAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), sameVersion(input.expectedUpdatedAt)))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError(STALE, 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: id, files: input.files, allowed: DOCUMENT_FILE_KINDS })
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'documents_updated',
      actor,
      changes: { ...changes, ...describeAttached(attached) },
    })
  })
  return { changed: true }
}

export async function saveBrokerRc(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.register.edit) throw new HPromiseError('You cannot update the RC status.', 403)
  const input = brokerRcSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (!(current.saleStatus === 'pending' || current.saleStatus === 'approved') || current.soldTo !== 'BROKER') {
    throw new HPromiseError('RC status is tracked only for cars sold to a broker.', 409)
  }
  const patch: Partial<VehicleRecord> = sent(raw, 'brokerRcRemarks') ? { brokerRcRemarks: input.brokerRcRemarks } : {}
  const changes = diffFields(current as unknown as Record<string, unknown>, patch as Record<string, unknown>, ['brokerRcRemarks'])
  const hasFiles = Object.values(input.files).some(Boolean)
  if (Object.keys(changes).length === 0 && !hasFiles) return { changed: false }

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        ...patch,
        brokerRcUpdatedBy: actor.id,
        brokerRcUpdatedByName: actor.name,
        brokerRcUpdatedAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), sameVersion(input.expectedUpdatedAt)))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError(STALE, 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: id, files: input.files, allowed: BROKER_RC_FILE_KINDS })
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: 'broker_rc_updated',
      actor,
      changes: { ...changes, ...describeAttached(attached) },
    })
  })
  return { changed: true }
}

/**
 * Payment verification: the accounts ledger for a sold vehicle, uploaded once. Replacing it is an admin act
 * and is logged as such.
 */
export async function uploadLedger(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown) {
  if (!caps.payments.edit) throw new HPromiseError('You cannot verify payments.', 403)
  const input = ledgerSchema.parse(raw)
  const current = await readVehicle(id)
  assertLive(current)
  if (!(current.saleStatus === 'pending' || current.saleStatus === 'approved')) {
    throw new HPromiseError('Record the sale before uploading its payment ledger.', 409)
  }
  if (!input.files.payment_ledger) throw new HPromiseError('Attach the payment ledger.', 400)
  const present = await currentFileKinds(id)
  const replacing = present.has('payment_ledger')
  if (replacing && !caps.isSuperAdmin) {
    throw new HPromiseError('The ledger for this sale is already uploaded. Only an admin can replace it.', 409)
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(V)
      .set({
        paymentVerifiedBy: actor.id,
        paymentVerifiedByName: actor.name,
        paymentVerifiedAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .where(and(eq(V.id, id), isNull(V.deletedAt), inArray(V.saleStatus, ['pending', 'approved'])))
      .returning({ id: V.id })
    if (updated.length === 0) throw new HPromiseError('This sale changed a moment ago. Reload it and try again.', 409)
    const attached = await attachStagedFiles(tx, { actor, vehicleId: id, files: input.files, allowed: LEDGER_FILE_KINDS })
    await recordHPromiseEvent(tx, {
      ...eventBase(current),
      action: replacing ? 'ledger_replaced' : 'ledger_uploaded',
      actor,
      remarks: input.remarks,
      changes: describeAttached(attached),
    })
  })
}

// ── Exchange bonus register ──────────────────────────────────────────────────────────────────────

const X = tataHPromiseExchangeBonuses
const BONUS_FIELDS = ['entryDate', 'vehicleNo', 'vehicleName', 'salesConsultant', 'newCarModel', 'bonusAmount', 'customerPhone', 'remarks'] as const

export async function createExchangeBonus(actor: HPromiseActor, caps: Capabilities, raw: unknown): Promise<HpExchangeBonus> {
  if (!caps.register.create) throw new HPromiseError('You cannot add exchange bonuses.', 403)
  const input = exchangeBonusSchema.parse(raw)
  if (input.entryDate) assertNotFuture(input.entryDate, 'date')
  const now = new Date()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(X)
      .values({
        entryDate: input.entryDate,
        vehicleNo: displayRegNo(input.vehicleNo),
        vehicleName: input.vehicleName,
        salesConsultant: input.salesConsultant,
        newCarModel: input.newCarModel,
        bonusAmount: money(input.bonusAmount) as string,
        customerPhone: input.customerPhone,
        remarks: input.remarks,
        createdBy: actor.id,
        createdByName: actor.name,
        createdAt: now,
        updatedBy: actor.id,
        updatedByName: actor.name,
        updatedAt: now,
      })
      .returning()
    await recordHPromiseEvent(tx, {
      subject: 'exchange_bonus',
      subjectId: row.id,
      regNo: row.vehicleNo,
      action: 'exchange_bonus_added',
      actor,
      changes: { bonusAmount: input.bonusAmount, newCarModel: input.newCarModel },
    })
    return buildExchangeBonus(row, caps)
  })
}

export async function updateExchangeBonus(actor: HPromiseActor, caps: Capabilities, id: string, raw: unknown): Promise<HpExchangeBonus> {
  if (!caps.register.edit) throw new HPromiseError('You cannot edit exchange bonuses.', 403)
  assertVehicleId(id)
  const input = exchangeBonusSchema.parse(raw)
  const [current] = await db.select().from(X).where(and(eq(X.id, id), isNull(X.deletedAt))).limit(1)
  if (!current) throw new HPromiseError('That exchange bonus was not found.', 404)
  if (input.entryDate) assertNotFuture(input.entryDate, 'date')
  const patch = {
    entryDate: input.entryDate,
    vehicleNo: displayRegNo(input.vehicleNo),
    vehicleName: input.vehicleName,
    salesConsultant: input.salesConsultant,
    newCarModel: input.newCarModel,
    bonusAmount: money(input.bonusAmount) as string,
    customerPhone: input.customerPhone,
    remarks: input.remarks,
  }
  const changes = diffFields(current as unknown as Record<string, unknown>, patch, BONUS_FIELDS as unknown as string[])
  if (Object.keys(changes).length === 0) return buildExchangeBonus(current, caps)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(X)
      .set({ ...patch, updatedBy: actor.id, updatedByName: actor.name, updatedAt: new Date() })
      .where(and(eq(X.id, id), isNull(X.deletedAt)))
      .returning()
    if (!row) throw new HPromiseError('That exchange bonus changed a moment ago. Reload and try again.', 409)
    await recordHPromiseEvent(tx, {
      subject: 'exchange_bonus',
      subjectId: id,
      regNo: row.vehicleNo,
      action: 'exchange_bonus_updated',
      actor,
      changes,
    })
    return buildExchangeBonus(row, caps)
  })
}

export async function deleteExchangeBonus(actor: HPromiseActor, caps: Capabilities, id: string) {
  if (!caps.register.delete) throw new HPromiseError('You cannot delete exchange bonuses.', 403)
  assertVehicleId(id)
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(X)
      .set({ deletedAt: new Date(), deletedBy: actor.id, deletedByName: actor.name })
      .where(and(eq(X.id, id), isNull(X.deletedAt)))
      .returning()
    if (!row) throw new HPromiseError('That exchange bonus was not found.', 404)
    await recordHPromiseEvent(tx, {
      subject: 'exchange_bonus',
      subjectId: id,
      regNo: row.vehicleNo,
      action: 'exchange_bonus_deleted',
      actor,
      changes: { bonusAmount: Number(row.bonusAmount), newCarModel: row.newCarModel },
    })
  })
}
