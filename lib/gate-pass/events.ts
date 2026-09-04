import 'server-only'

import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePassEvents, demoGatePasses } from '@/lib/db/schema'
import type { GatePassAction, GatePassStatus } from './status'

/**
 * The audit writer. Every transition of a gate pass goes through here.
 *
 * ── Why a table and not a jsonb column ────────────────────────────────────────────────────────
 * kia_approval_requests and fuel_approvals both keep their chain in a `history` jsonb array,
 * appended read-modify-write OUTSIDE a transaction (see app/api/fuel-approvals/[id]/action/route.ts
 * — read the row, push onto the array, write it back). Two actions landing together silently lose
 * one entry. For an approvals list that is bad; for a log of which vehicles left the premises and
 * when, it is the whole point of the record.
 *
 * So: a real table, one row per transition, written INSIDE the same transaction that moved the
 * pass. If the move rolls back, so does its log line, and neither can exist without the other.
 *
 * ── Why the full snapshot ─────────────────────────────────────────────────────────────────────
 * `snapshot` carries the entire post-action row, the way bank_sanction_history does. Together with
 * gate_pass_id ON DELETE SET NULL that means the audit trail survives the deletion of the pass it
 * describes, and answers "what did this pass look like at 14:32" without replaying every diff.
 */

/** Any Drizzle transaction handle. Callers pass `tx`; the type stays inferred from db.transaction. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type GatePassEventInput = {
  gatePassId: string
  passNo: string
  action: GatePassAction
  /** Null for a guard — they have no dashboard account by design. */
  actorId: string | null
  actorName: string
  /** Null for a guard, for the same reason. Never invent one; the absence is meaningful. */
  actorRole: string | null
  previousStatus: GatePassStatus | null
  newStatus: GatePassStatus | null
  remarks?: string | null
  /** The full post-action row. */
  snapshot: Record<string, unknown>
}

/**
 * Write one audit row.
 *
 * ⚠️ ALWAYS pass the `tx` from the transaction that moved the pass. The signature makes it
 * required rather than optional on purpose: an optional transaction is an invitation to omit it,
 * and omitting it reintroduces exactly the race this table exists to close.
 */
export async function recordGatePassEvent(tx: Tx, input: GatePassEventInput): Promise<void> {
  await tx.insert(demoGatePassEvents).values({
    gatePassId: input.gatePassId,
    passNo: input.passNo,
    action: input.action,
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    previousStatus: input.previousStatus,
    newStatus: input.newStatus,
    remarks: input.remarks ?? null,
    snapshot: redactSnapshot(input.snapshot),
  })
}

/**
 * What never goes into an audit snapshot.
 *
 * The snapshot is read back by anyone with `gate_pass.audit`, which is a wider set than the people
 * who may see a driver's licence number. Storing it here would route it around the field-level
 * masking the detail view applies, so it is dropped at write time — not filtered at read time,
 * because a read filter is one forgotten call site away from leaking.
 */
const SNAPSHOT_EXCLUDED_FIELDS = new Set([
  'driverLicenceNo',
  'driver_licence_no',
  'driverPhone',
  'driver_phone',
])

function redactSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (SNAPSHOT_EXCLUDED_FIELDS.has(key)) continue
    out[key] = value
  }
  return out
}

/** The timeline for one pass, newest first. */
export async function readGatePassEvents(gatePassId: string) {
  return db
    .select()
    .from(demoGatePassEvents)
    .where(eq(demoGatePassEvents.gatePassId, gatePassId))
    .orderBy(desc(demoGatePassEvents.createdAt))
}

/**
 * The timeline for a pass NUMBER rather than an id.
 *
 * Needed because gate_pass_id goes NULL when a pass is deleted, and the flat pass_no copy is then
 * the only way back to its history — which is the reason that column exists.
 */
export async function readGatePassEventsByPassNo(passNo: string) {
  return db
    .select()
    .from(demoGatePassEvents)
    .where(eq(demoGatePassEvents.passNo, passNo))
    .orderBy(desc(demoGatePassEvents.createdAt))
}

/**
 * Human-readable pass numbers: GP-<DEALER>-<6 digits>, sequential per dealer.
 *
 * Derived from the current maximum rather than a Postgres sequence so the number is per-dealer and
 * readable at the gate. The insert runs inside the caller's transaction and pass_no carries a
 * UNIQUE constraint, so a concurrent raise collides on the constraint and is retried rather than
 * silently issuing a duplicate.
 */
export async function nextGatePassNumber(tx: Tx, dealerCode: string): Promise<string> {
  const prefix = `GP-${String(dealerCode).trim().toUpperCase()}-`
  const [latest] = await tx
    .select({ passNo: demoGatePasses.passNo })
    .from(demoGatePasses)
    .where(eq(demoGatePasses.dealerCode, dealerCode))
    .orderBy(desc(demoGatePasses.passNo))
    .limit(1)

  const current = latest?.passNo?.startsWith(prefix)
    ? Number(latest.passNo.slice(prefix.length).replace(/[^0-9]/g, ''))
    : 0
  const next = Number.isFinite(current) && current > 0 ? current + 1 : 1
  return `${prefix}${String(next).padStart(6, '0')}`
}
