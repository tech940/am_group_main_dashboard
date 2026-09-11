import 'server-only'

import { and, desc, eq, inArray, sql, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { demoGatePasses, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { getAppBaseUrl } from '@/lib/approvals/decision-emails'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { formatIndiaDateTime } from '@/lib/date-time'
import { canApproveGatePass, canCancelGatePass, visibleDealerCodes } from './access'
import { nextGatePassNumber, recordGatePassEvent } from './events'
import {
  sendGatePassApprovedEmail,
  sendGatePassGateOutEmail,
  sendGatePassOverdueEmail,
  sendGatePassRejectedEmail,
  sendGatePassSubmittedEmail,
  type GatePassEmailRow,
} from './emails'
import { getDriverProfile } from './drivers'
import { lookupByVin } from './vehicles'
import { findHoldingPass } from './fleet'
import { GATE_PASS_PURPOSES, canTransition, purposeRequiresNote, type GatePassStatus } from './status'
import { buildGateUrl, createGateToken } from './token'

/**
 * The gate pass lifecycle.
 *
 * ── The two rules every mutation here follows ─────────────────────────────────────────────────
 *
 * 1. THE STATUS TRANSITION IS A COMPARE-AND-SWAP, not a re-read.
 *    Every UPDATE carries the status it expects in its own WHERE clause and then checks
 *    `.returning()` for a row. A caller that lost a race updates zero rows and is told so, rather
 *    than overwriting a decision somebody else already made. This is the house pattern
 *    (lib/petty-cash/server.ts) and it is deliberately NOT the fuel-approvals pattern, which keys
 *    its UPDATE on id alone with no status guard and does a read-modify-write on a jsonb history
 *    array outside any transaction — two concurrent actions there silently lose one.
 *
 *    There is exactly one SELECT ... FOR UPDATE in this whole codebase (lib/kia/bookings.ts, for a
 *    double-insert hazard). A status flip does not need one; the CAS is sufficient and cheaper.
 *
 * 2. EMAIL IS SENT AFTER THE TRANSACTION COMMITS. Never inside it.
 *    petty-cash fires an approval email from inside its transaction callback, so a later statement
 *    throwing rolls the database back after the mail has gone. Here the transaction returns the
 *    committed row and the caller mails from that.
 *
 * ⚠️ `db` is constructed with no schema (lib/db/index.ts), so the Drizzle relational API
 * (`db.query.demoGatePasses...`) does not exist. Every read is select().from().where().
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class GatePassError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message)
    this.name = 'GatePassError'
  }
}

// ── Input validation ──────────────────────────────────────────────────────────────────────────

export const createGatePassSchema = z.object({
  vin: z.string().trim().min(1, 'Choose a vehicle.'),
  driverKind: z.enum(['staff', 'customer']).default('staff'),
  driverUserId: z.string().uuid().nullish(),
  driverName: z.string().trim().min(1, 'The driver must be named.').max(120),
  driverPhone: z.string().trim().max(20).nullish(),
  driverLicenceNo: z.string().trim().max(50).nullish(),
  driverLicenceExpiry: z.string().trim().nullish(),
  driverLicenceDocPath: z.string().trim().nullish(),
  purpose: z.string().trim().min(1, 'Choose a purpose for travel.'),
  purposeNote: z.string().trim().max(500).nullish(),
  expectedReturnAt: z.string().trim().nullish(),
  remarks: z.string().trim().max(1000).nullish(),
})

export type CreateGatePassInput = z.infer<typeof createGatePassSchema>

export const listGatePassesSchema = z.object({
  status: z.string().trim().optional(),
  dealerCode: z.string().trim().optional(),
  purpose: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
  mine: z.coerce.boolean().optional(),
  awaitingMe: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
})

// ── Serialisation ─────────────────────────────────────────────────────────────────────────────

type PassRow = typeof demoGatePasses.$inferSelect

function toEmailRow(row: PassRow, driverEmail?: string | null): GatePassEmailRow {
  return {
    id: row.id,
    passNo: row.passNo,
    dealerCode: row.dealerCode,
    registrationNumber: row.registrationNumber,
    model: row.model,
    variant: row.variant,
    color: row.color,
    driverName: row.driverName,
    driverEmail: driverEmail || null,
    purpose: row.purpose,
    purposeNote: row.purposeNote,
    expectedReturnAt: row.expectedReturnAt,
    requestedByName: row.requestedByName,
    requestedByEmail: row.requestedByEmail,
    approvedByName: row.approvedByName,
    approvalRemarks: row.approvalRemarks,
    gateOutAt: row.gateOutAt,
    gateOutOdo: row.gateOutOdo,
    gateInAt: row.gateInAt,
    gateInOdo: row.gateInOdo,
  }
}

async function toEmailRowWithDriver(row: PassRow): Promise<GatePassEmailRow> {
  let driverEmail: string | null = null
  if (row.driverUserId) {
    try {
      const [u] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, row.driverUserId))
        .limit(1)
      if (u?.email) driverEmail = u.email
    } catch {
      // Non-fatal
    }
  }
  return toEmailRow(row, driverEmail)
}

/**
 * ⚠️ The licence number never leaves the server on a list or detail read. Only its owner and the
 * request form need it; everyone else sees the masked form or nothing. Serialising it "just in
 * case" is how a government ID ends up in a CSV export nobody meant to widen.
 */
export function serializeGatePass(row: PassRow) {
  const { driverLicenceNo: _licence, ...rest } = row
  return { ...rest, driverLicenceMasked: _licence ? `••••${_licence.slice(-4)}` : null }
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────

async function readPass(id: string): Promise<PassRow> {
  const [row] = await db.select().from(demoGatePasses).where(eq(demoGatePasses.id, id)).limit(1)
  if (!row) throw new GatePassError('Gate pass not found.', 404)
  return row
}

/**
 * ⚠️ Row scoping, not just permission. `requireGatePassAccess` answers "may you use this section";
 * without the dealer predicate below a correctly-permissioned Udhampur user still receives every
 * Jammu pass. The Vendor Registry shipped exactly that gap and handed over the whole group's
 * payment ledger to anyone who could open the page.
 */
export async function listGatePasses(appUser: AppUser, raw: unknown) {
  const filters = listGatePassesSchema.parse(raw ?? {})
  const scope = visibleDealerCodes(appUser)

  const where = [inArray(demoGatePasses.dealerCode, scope)]

  if (filters.status) {
    const wanted = filters.status.split(',').map((s) => s.trim()).filter(Boolean)
    if (wanted.length > 0) where.push(inArray(demoGatePasses.status, wanted))
  }
  if (filters.dealerCode && filters.dealerCode !== 'all') {
    const code = normalizeKiaDealerCode(filters.dealerCode)
    if (code) where.push(eq(demoGatePasses.dealerCode, code))
  }
  if (filters.purpose && filters.purpose !== 'all') {
    where.push(eq(demoGatePasses.purpose, filters.purpose))
  }
  if (filters.startDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate.trim())
    const start = isIsoDateOnly
      ? new Date(`${filters.startDate.trim()}T00:00:00.000+05:30`)
      : new Date(filters.startDate)
    if (!Number.isNaN(start.getTime())) {
      where.push(gte(demoGatePasses.createdAt, start))
    }
  }
  if (filters.endDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate.trim())
    const end = isIsoDateOnly
      ? new Date(`${filters.endDate.trim()}T23:59:59.999+05:30`)
      : new Date(filters.endDate)
    if (!Number.isNaN(end.getTime())) {
      where.push(lte(demoGatePasses.createdAt, end))
    }
  }
  if (filters.mine) where.push(eq(demoGatePasses.requestedBy, appUser.id))
  // "Waiting on me" is a status filter plus the role test, not a stored assignment — an approver
  // resolved at submit time would go stale the moment somebody changes branch or leaves.
  if (filters.awaitingMe) where.push(eq(demoGatePasses.status, 'pending_approval'))
  if (filters.search) {
    const needle = `%${filters.search.toLowerCase()}%`
    where.push(sql`(
      LOWER(${demoGatePasses.passNo}) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.registrationNumber}, '')) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.model}, '')) LIKE ${needle}
      OR LOWER(${demoGatePasses.driverName}) LIKE ${needle}
      OR LOWER(${demoGatePasses.requestedByName}) LIKE ${needle}
    )`)
  }

  const predicate = and(...where)
  const offset = (filters.page - 1) * filters.pageSize

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(demoGatePasses)
      .where(predicate)
      .orderBy(desc(demoGatePasses.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(demoGatePasses)
      .where(predicate),
  ])

  const visible = filters.awaitingMe
    ? rows.filter((r) => canApproveGatePass(appUser, r.dealerCode))
    : rows

  return {
    rows: visible.map(serializeGatePass),
    total,
    roleFiltered: filters.awaitingMe && visible.length !== rows.length,
    page: filters.page,
    pageSize: filters.pageSize,
  }
}

export async function getGatePassSummary(appUser: AppUser, raw: unknown) {
  const filters = listGatePassesSchema.parse(raw ?? {})
  const scope = visibleDealerCodes(appUser)

  const where = [inArray(demoGatePasses.dealerCode, scope)]

  if (filters.dealerCode && filters.dealerCode !== 'all') {
    const code = normalizeKiaDealerCode(filters.dealerCode)
    if (code) where.push(eq(demoGatePasses.dealerCode, code))
  }
  if (filters.purpose && filters.purpose !== 'all') {
    where.push(eq(demoGatePasses.purpose, filters.purpose))
  }
  if (filters.startDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate.trim())
    const start = isIsoDateOnly
      ? new Date(`${filters.startDate.trim()}T00:00:00.000+05:30`)
      : new Date(filters.startDate)
    if (!Number.isNaN(start.getTime())) {
      where.push(gte(demoGatePasses.createdAt, start))
    }
  }
  if (filters.endDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate.trim())
    const end = isIsoDateOnly
      ? new Date(`${filters.endDate.trim()}T23:59:59.999+05:30`)
      : new Date(filters.endDate)
    if (!Number.isNaN(end.getTime())) {
      where.push(lte(demoGatePasses.createdAt, end))
    }
  }
  if (filters.mine) where.push(eq(demoGatePasses.requestedBy, appUser.id))
  if (filters.search) {
    const needle = `%${filters.search.toLowerCase()}%`
    where.push(sql`(
      LOWER(${demoGatePasses.passNo}) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.registrationNumber}, '')) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.model}, '')) LIKE ${needle}
      OR LOWER(${demoGatePasses.driverName}) LIKE ${needle}
      OR LOWER(${demoGatePasses.requestedByName}) LIKE ${needle}
    )`)
  }

  const predicate = and(...where)

  const [agg] = await db
    .select({
      total: sql<number>`COUNT(*)::int`,
      outNow: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'out')::int`,
      overdueNow: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'out' AND ${demoGatePasses.expectedReturnAt} < NOW())::int`,
      awaitingApproval: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'pending_approval')::int`,
      readyForGateOut: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'approved')::int`,
      completedTrips: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'returned')::int`,
      closedPasses: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} IN ('returned', 'rejected', 'cancelled', 'expired'))::int`,
      onTimeReturns: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.status} = 'returned' AND ${demoGatePasses.gateInAt} <= ${demoGatePasses.expectedReturnAt})::int`,
      totalDistanceKm: sql<number | null>`COALESCE(SUM(CASE WHEN ${demoGatePasses.status} = 'returned' AND ${demoGatePasses.gateInOdo} IS NOT NULL AND ${demoGatePasses.gateOutOdo} IS NOT NULL AND ${demoGatePasses.gateInOdo} >= ${demoGatePasses.gateOutOdo} THEN (${demoGatePasses.gateInOdo} - ${demoGatePasses.gateOutOdo}) ELSE 0 END), 0)::numeric`,
      odometerAnomalies: sql<number>`COUNT(*) FILTER (WHERE ${demoGatePasses.gateInOdo} IS NOT NULL AND ${demoGatePasses.gateOutOdo} IS NOT NULL AND ${demoGatePasses.gateInOdo} < ${demoGatePasses.gateOutOdo})::int`,
      passesMissingEvidence: sql<number>`COUNT(*) FILTER (WHERE (${demoGatePasses.status} = 'out' AND (${demoGatePasses.gateOutSignaturePath} IS NULL OR ${demoGatePasses.gateOutPhotoPaths} IS NULL)) OR (${demoGatePasses.status} = 'returned' AND (${demoGatePasses.gateInSignaturePath} IS NULL OR ${demoGatePasses.gateInPhotoPaths} IS NULL)))::int`,
    })
    .from(demoGatePasses)
    .where(predicate)

  const total = agg?.total ?? 0
  const completedTrips = agg?.completedTrips ?? 0
  const onTimeReturns = agg?.onTimeReturns ?? 0

  return {
    summary: {
      total,
      outNow: agg?.outNow ?? 0,
      overdueNow: agg?.overdueNow ?? 0,
      awaitingApproval: agg?.awaitingApproval ?? 0,
      readyForGateOut: agg?.readyForGateOut ?? 0,
      completedTrips,
      closedPasses: agg?.closedPasses ?? 0,
      onTimeReturns,
      onTimeRate: completedTrips === 0 ? null : Math.round((onTimeReturns / completedTrips) * 100),
      medianTripMinutes: null,
      medianApprovalMinutes: null,
      medianDispatchMinutes: null,
      totalDistanceKm: agg?.totalDistanceKm !== null && agg?.totalDistanceKm !== undefined ? Number(agg.totalDistanceKm) : null,
      passesMissingEvidence: agg?.passesMissingEvidence ?? 0,
      odometerAnomalies: agg?.odometerAnomalies ?? 0,
    },
    truncated: false,
    countedRows: total,
    totalRows: total,
  }
}

export async function getGatePass(appUser: AppUser, id: string) {
  const row = await readPass(id)
  if (!visibleDealerCodes(appUser).includes(row.dealerCode)) {
    throw new GatePassError('This gate pass is not at one of your branches.', 403)
  }
  return serializeGatePass(row)
}

// ── Create ────────────────────────────────────────────────────────────────────────────────────

export async function createGatePass(appUser: AppUser, rawInput: unknown) {
  const input = createGatePassSchema.parse(rawInput)

  if (purposeRequiresNote(input.purpose) && !input.purposeNote?.trim()) {
    throw new GatePassError('Say what the trip is for.')
  }

  let dueBack: Date
  if (input.expectedReturnAt) {
    dueBack = new Date(input.expectedReturnAt)
    if (Number.isNaN(dueBack.getTime())) throw new GatePassError('That return time is not a valid date.')
    if (dueBack.getTime() <= Date.now()) throw new GatePassError('The return time must be in the future.')
  } else {
    // Default to 8 hours from now
    dueBack = new Date(Date.now() + 8 * 60 * 60 * 1000)
  }

  /*
   * The vehicle is SNAPSHOT, not referenced. demo_car_list is read through the pluggable analytics
   * provider (Postgres today, BigQuery-capable), so a foreign key is not expressible — and a gate
   * record should show what the vehicle was when it left, not what today's feed says.
   */
  const vehicle = await lookupByVin(input.vin)
  if (!vehicle) {
    throw new GatePassError('That vehicle is not in the demo fleet, or has been sold.', 404)
  }
  const dealerCode = vehicle.dealerCode
  if (!dealerCode) throw new GatePassError('That vehicle has no branch recorded, so it cannot be signed out.')

  const holding = await findHoldingPass(vehicle.vin)
  if (holding) {
    throw new GatePassError(
      holding.status === 'out'
        ? `That car is already out on ${holding.passNo}, with ${holding.driverName}. It is due back ${formatIndiaDateTime(holding.expectedReturnAt) ?? 'at an unrecorded time'}.`
        : `That car is already booked on ${holding.passNo} by ${holding.requestedByName}. Cancel that pass first, or pick another car.`,
      409,
    )
  }

  // A staff driver's licence is pulled from the registry and checked BEFORE the pass exists,
  // or auto-persisted if provided on creation so the driver never has to upload again.
  let licenceNo: string | null = null
  let licenceExpiry: string | null = null
  if (input.driverKind === 'staff' && input.driverUserId) {
    const profile = await getDriverProfile(input.driverUserId, new Date())
    licenceNo = input.driverLicenceNo || profile?.licenceNo || 'ON_FILE'
    licenceExpiry = input.driverLicenceExpiry || profile?.licenceExpiry || null

    if (input.driverLicenceDocPath || input.driverLicenceNo) {
      try {
        const { upsertDriverProfile } = await import('./drivers')
        await upsertDriverProfile({
          userId: input.driverUserId,
          licenceNo: licenceNo || 'ON_FILE',
          licenceExpiry: licenceExpiry,
          licenceDocPath: input.driverLicenceDocPath || profile?.licenceDocPath || null,
          phone: input.driverPhone || profile?.phone || null,
          updatedBy: appUser.id,
        })
      } catch {
        // Non-fatal
      }
    }
  }

  const created = await db.transaction(async (tx) => {
    const passNo = await nextGatePassNumber(tx, dealerCode)
    const [row] = await tx
      .insert(demoGatePasses)
      .values({
        passNo,
        brand: 'kia',
        dealerCode,
        vin: vehicle.vin,
        registrationNumber: vehicle.registrationNumber,
        model: vehicle.model,
        variant: vehicle.variant,
        color: vehicle.color,
        keyNumber: vehicle.keyNumber,
        requestedBy: appUser.id,
        requestedByName: appUser.fullName,
        requestedByEmail: appUser.email,
        department: appUser.department,
        driverKind: input.driverKind,
        driverUserId: input.driverUserId ?? null,
        driverName: input.driverName,
        driverPhone: input.driverPhone ?? null,
        driverLicenceNo: licenceNo,
        driverLicenceExpiry: licenceExpiry,
        purpose: input.purpose,
        purposeNote: input.purposeNote ?? null,
        expectedReturnAt: dueBack,
        remarks: input.remarks ?? null,
        status: 'pending_approval',
      })
      .returning()

    if (!row) throw new GatePassError('Could not create the gate pass.', 500)

    await recordGatePassEvent(tx, {
      gatePassId: row.id,
      passNo: row.passNo,
      action: 'created',
      actorId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
      previousStatus: null,
      newStatus: 'pending_approval',
      remarks: input.remarks ?? null,
      snapshot: row as unknown as Record<string, unknown>,
    })

    return row
  })

  // AFTER the commit — see rule 2 at the top of this file.
  const { unstaffed } = await sendGatePassSubmittedEmail(toEmailRow(created))

  return { pass: serializeGatePass(created), unstaffed }
}

// ── Approve / reject ──────────────────────────────────────────────────────────────────────────

export async function decideGatePass(
  appUser: AppUser,
  id: string,
  decision: 'approve' | 'reject',
  remarks: string | null,
  request?: Request,
) {
  const current = await readPass(id)

  if (!canApproveGatePass(appUser, current.dealerCode)) {
    throw new GatePassError('You cannot approve gate passes for this branch.', 403)
  }
  const action = decision === 'approve' ? 'approved' : 'rejected'
  if (!canTransition(current.status as GatePassStatus, action)) {
    throw new GatePassError(`This pass is already ${current.status.replace('_', ' ')}.`, 409)
  }
  if (decision === 'reject' && !remarks?.trim()) {
    throw new GatePassError('Say why you are not approving it.')
  }

  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(demoGatePasses)
      .set({
        status: action === 'approved' ? 'approved' : 'rejected',
        approvedBy: appUser.id,
        approvedByName: appUser.fullName,
        approvedByRole: appUser.role,
        approvedAt: now,
        approvalRemarks: remarks?.trim() || null,
        updatedAt: now,
      })
      // The compare-and-swap. A second approver racing this one updates zero rows.
      .where(and(eq(demoGatePasses.id, id), eq(demoGatePasses.status, current.status)))
      .returning()

    if (!row) throw new GatePassError('Somebody else already actioned this pass.', 409)

    await recordGatePassEvent(tx, {
      gatePassId: row.id,
      passNo: row.passNo,
      action,
      actorId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
      previousStatus: current.status as GatePassStatus,
      newStatus: row.status as GatePassStatus,
      remarks: remarks?.trim() || null,
      snapshot: row as unknown as Record<string, unknown>,
    })

    return row
  })

  const emailRow = await toEmailRowWithDriver(updated)

  if (decision === 'approve') {
    /*
     * The OUT token is minted here and nowhere else. The IN token is minted at gate-out, so a
     * screenshot of this approval mail can perform exactly one thing — the gate-out that was going
     * to happen anyway — and can never be used to sign the vehicle back in.
     */
    const token = createGateToken({
      passId: updated.id,
      purpose: 'out',
      expectedReturnAt: updated.expectedReturnAt,
      issuedAt: now,
    })
    await sendGatePassApprovedEmail(emailRow, buildGateUrl(getAppBaseUrl(request), token))
  } else {
    await sendGatePassRejectedEmail(emailRow)
  }

  return serializeGatePass(updated)
}

/**
 * Re-send the gate pass barcode and link to the requester (and CC driver if applicable).
 */
export async function resendGatePassEmail(
  appUser: AppUser,
  id: string,
  request?: Request,
): Promise<{ ok: boolean; recipient: string; purpose: 'out' | 'in' }> {
  const current = await readPass(id)
  if (!visibleDealerCodes(appUser).includes(current.dealerCode)) {
    throw new GatePassError('This gate pass is not at one of your branches.', 403)
  }

  const purpose = current.status === 'approved' ? 'out' : current.status === 'out' ? 'in' : null
  if (!purpose) {
    throw new GatePassError(
      current.status === 'pending_approval'
        ? 'This pass has not been approved yet.'
        : 'This pass is closed, so no gate link is active.',
      409,
    )
  }

  const token = createGateToken({
    passId: current.id,
    purpose,
    expectedReturnAt: current.expectedReturnAt,
    issuedAt: new Date(),
  })
  const url = buildGateUrl(getAppBaseUrl(request), token)
  const emailRow = await toEmailRowWithDriver(current)

  if (purpose === 'out') {
    await sendGatePassApprovedEmail(emailRow, url)
  } else {
    await sendGatePassGateOutEmail(emailRow, url)
  }

  return { ok: true, recipient: emailRow.requestedByEmail, purpose }
}

export async function cancelGatePass(appUser: AppUser, id: string, reason: string | null) {
  const current = await readPass(id)
  if (!canCancelGatePass(appUser, { requestedBy: current.requestedBy, dealerCode: current.dealerCode })) {
    throw new GatePassError('You cannot cancel this gate pass.', 403)
  }
  if (!canTransition(current.status as GatePassStatus, 'cancelled')) {
    throw new GatePassError(`A pass that is ${current.status.replace('_', ' ')} cannot be cancelled.`, 409)
  }

  const now = new Date()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(demoGatePasses)
      .set({
        status: 'cancelled',
        cancelledBy: appUser.id,
        cancelledByName: appUser.fullName,
        cancelledAt: now,
        cancelReason: reason?.trim() || null,
        updatedAt: now,
      })
      .where(and(eq(demoGatePasses.id, id), eq(demoGatePasses.status, current.status)))
      .returning()

    if (!row) throw new GatePassError('Somebody else already actioned this pass.', 409)

    await recordGatePassEvent(tx, {
      gatePassId: row.id,
      passNo: row.passNo,
      action: 'cancelled',
      actorId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
      previousStatus: current.status as GatePassStatus,
      newStatus: 'cancelled',
      remarks: reason?.trim() || null,
      snapshot: row as unknown as Record<string, unknown>,
    })

    return serializeGatePass(row)
  })
}

// ── Gate events (performed by a guard with no account) ────────────────────────────────────────

export type GateEventInput = {
  guardName: string
  odometer: number | null
  photoPaths: Record<string, string>
  signaturePath: string | null
  customerLicencePath?: string | null
  parkedLocation?: string | null
  keyHandoverTo?: string | null
  notes?: string | null
}

/**
 * Sign a vehicle OUT.
 *
 * `alreadyDone` rather than an error when the pass has already moved: the guard scanned a QR and a
 * network retry, a double tap, or a second scan must not read as a failure at a gate with cars
 * queuing. The CAS guarantees only one of them wrote anything.
 */
export async function recordGateOut(passId: string, input: GateEventInput, request?: Request) {
  const current = await readPass(passId)
  if (current.status === 'out' || current.status === 'returned') {
    return { alreadyDone: true, pass: serializeGatePass(current) }
  }
  if (!canTransition(current.status as GatePassStatus, 'gate_out')) {
    throw new GatePassError(`This pass is ${current.status.replace('_', ' ')} and cannot be signed out.`, 409)
  }
  if (!input.guardName.trim()) throw new GatePassError('The guard must record their name.')

  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(demoGatePasses)
      .set({
        status: 'out',
        gateOutAt: now,
        gateOutOdo: input.odometer === null ? null : String(input.odometer),
        gateOutGuardName: input.guardName.trim(),
        gateOutSignaturePath: input.signaturePath,
        gateOutPhotoPaths: input.photoPaths,
        customerLicencePath: input.customerLicencePath ?? null,
        customerLicenceCheckedBy: input.customerLicencePath ? input.guardName.trim() : null,
        updatedAt: now,
      })
      .where(and(eq(demoGatePasses.id, passId), eq(demoGatePasses.status, 'approved')))
      .returning()

    if (!row) throw new GatePassError('This pass has already been actioned.', 409)

    await recordGatePassEvent(tx, {
      gatePassId: row.id,
      passNo: row.passNo,
      action: 'gate_out',
      // A guard has no dashboard account by design, so there is no id and no role to record. The
      // absence is meaningful — never substitute a system user to make the column look populated.
      actorId: null,
      actorName: input.guardName.trim(),
      actorRole: null,
      previousStatus: 'approved',
      newStatus: 'out',
      remarks: input.notes ?? null,
      snapshot: row as unknown as Record<string, unknown>,
    })

    return row
  })

  return { alreadyDone: false, pass: serializeGatePass(updated) }
}

export async function recordGateIn(passId: string, input: GateEventInput) {
  const current = await readPass(passId)
  if (current.status === 'returned') {
    return { alreadyDone: true, pass: serializeGatePass(current) }
  }
  if (!canTransition(current.status as GatePassStatus, 'gate_in')) {
    throw new GatePassError(`This pass is ${current.status.replace('_', ' ')} and cannot be signed in.`, 409)
  }
  if (!input.guardName.trim()) throw new GatePassError('The guard must record their name.')

  const outOdo = current.gateOutOdo === null ? null : Number(current.gateOutOdo)
  if (input.odometer === null || Number.isNaN(input.odometer) || input.odometer < 0) {
    throw new GatePassError('A valid closing odometer reading is required.')
  }
  if (outOdo !== null && Number.isFinite(outOdo) && input.odometer <= outOdo) {
    throw new GatePassError(`Closing odometer (${input.odometer} km) must be greater than Gate Out reading (${outOdo} km).`)
  }
  const odoWentBackwards = false

  const now = new Date()
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(demoGatePasses)
      .set({
        status: 'returned',
        gateInAt: now,
        gateInOdo: input.odometer === null ? null : String(input.odometer),
        gateInGuardName: input.guardName.trim(),
        gateInSignaturePath: input.signaturePath,
        gateInPhotoPaths: input.photoPaths,
        parkedLocation: input.parkedLocation ?? null,
        keyHandoverTo: input.keyHandoverTo ?? null,
        gateInRemarks: input.notes ?? null,
        updatedAt: now,
      })
      .where(and(eq(demoGatePasses.id, passId), eq(demoGatePasses.status, 'out')))
      .returning()

    if (!row) throw new GatePassError('This pass has already been actioned.', 409)

    await recordGatePassEvent(tx, {
      gatePassId: row.id,
      passNo: row.passNo,
      action: 'gate_in',
      actorId: null,
      actorName: input.guardName.trim(),
      actorRole: null,
      previousStatus: 'out',
      newStatus: 'returned',
      remarks: input.notes ?? null,
      snapshot: { ...(row as unknown as Record<string, unknown>), odoWentBackwards },
    })

    return row
  })

  return { alreadyDone: false, pass: serializeGatePass(updated), odoWentBackwards }
}

// ── Overdue sweep ─────────────────────────────────────────────────────────────────────────────

/**
 * Mail once per pass that has been out for >= 12 hours without being returned.
 *
 * ⚠️ `overdue_notified_at` is stamped in the SAME statement that selects the pass, so two sweeps
 * running together cannot both mail it.
 */
export async function runOverdueSweep(now: Date) {
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000)

  const claimed = await db
    .update(demoGatePasses)
    .set({ overdueNotifiedAt: now })
    .where(and(
      eq(demoGatePasses.status, 'out'),
      sql`${demoGatePasses.gateOutAt} <= ${twelveHoursAgo}`,
      sql`${demoGatePasses.overdueNotifiedAt} IS NULL`,
    ))
    .returning()

  for (const row of claimed) {
    const emailRow = await toEmailRowWithDriver(row)
    await sendGatePassOverdueEmail(emailRow)
  }

  /*
   * A pass approved but never driven out is closed rather than left looking live forever.
   *
   * ⚠️ Each expiry gets its own transaction and its own audit event. Expiring in one bulk UPDATE
   * with no events would be the only status change in this module that leaves no trace — and the
   * register would then show passes that changed state with nothing explaining when or why.
   */
  const stale = await db
    .select()
    .from(demoGatePasses)
    .where(and(
      eq(demoGatePasses.status, 'approved'),
      sql`${demoGatePasses.expectedReturnAt} < ${now}`,
    ))

  let expired = 0
  for (const candidate of stale) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(demoGatePasses)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(demoGatePasses.id, candidate.id), eq(demoGatePasses.status, 'approved')))
        .returning()
      // Somebody drove it out between the SELECT and here. Leave it alone.
      if (!row) return

      await recordGatePassEvent(tx, {
        gatePassId: row.id,
        passNo: row.passNo,
        action: 'expired',
        actorId: null,
        actorName: 'Overdue sweep',
        actorRole: null,
        previousStatus: 'approved',
        newStatus: 'expired',
        remarks: 'Approved but never driven out before the return time.',
        snapshot: row as unknown as Record<string, unknown>,
      })
      expired += 1
    })
  }

  return { overdueNotified: claimed.length, expired }
}
