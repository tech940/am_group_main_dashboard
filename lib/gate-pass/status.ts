/**
 * The gate pass status vocabulary, and the one place a status becomes words on a screen.
 *
 * ⚠️ NOT a pgEnum. The column is plain text — the rule stated in
 * lib/db/migrations/0050_add_kia_discount_approval_chain.sql: a new status must not need a
 * migration, ALTER TYPE ... ADD VALUE cannot run inside a transaction, and a missing one has taken
 * this app down before. This file is the vocabulary; the database only stores the string.
 *
 * ⚠️ NO `current_stage` anywhere. With a single approver, `status` alone is authoritative.
 * purchase_orders models the same fact three times (stage enum + status enum + per-stage columns)
 * and the three drifted apart; kia_approval_requests INFERS the stage from five free-text columns
 * and the inference was duplicated into three files that disagreed, which left the MD's queue
 * permanently empty. One field, one map, no inference.
 *
 * This module is deliberately client-safe (no 'server-only', no db import) so the server and the UI
 * render a pass from the SAME map and cannot disagree about what it says — the property that makes
 * lib/petty-cash/status-tracking.ts the nicest presentation layer in this repo.
 */

export const GATE_PASS_STATUSES = [
  'pending_approval',
  'approved',
  'rejected',
  'out',
  'returned',
  'cancelled',
  'expired',
] as const

export type GatePassStatus = (typeof GATE_PASS_STATUSES)[number]

/** Statuses where the vehicle is still our problem — the pass is live and someone owes an action. */
export const OPEN_GATE_PASS_STATUSES = ['pending_approval', 'approved', 'out'] as const

/** Nothing further can happen to a pass in one of these. Every transition out of them is refused. */
export const TERMINAL_GATE_PASS_STATUSES = ['rejected', 'returned', 'cancelled', 'expired'] as const

export function isGatePassStatus(value: unknown): value is GatePassStatus {
  return typeof value === 'string' && (GATE_PASS_STATUSES as readonly string[]).includes(value)
}

export function isOpenGatePassStatus(value: unknown): boolean {
  return typeof value === 'string' && (OPEN_GATE_PASS_STATUSES as readonly string[]).includes(value)
}

export function isTerminalGatePassStatus(value: unknown): boolean {
  return typeof value === 'string' && (TERMINAL_GATE_PASS_STATUSES as readonly string[]).includes(value)
}

/** The actions that move a pass. Also the `action` column on demo_gate_pass_events. */
export const GATE_PASS_ACTIONS = [
  'created',
  'approved',
  'rejected',
  'cancelled',
  'gate_out',
  'gate_in',
  'expired',
] as const

export type GatePassAction = (typeof GATE_PASS_ACTIONS)[number]

/**
 * The state machine, as data.
 *
 * Every transition is also enforced in SQL by a WHERE clause on the current status, so a replayed
 * request (a screenshotted QR, a double-tapped button, a retried POST) that finds the pass already
 * moved updates zero rows and is reported as an idempotent success. This table is what the server
 * checks BEFORE it tries, so the caller gets a useful message rather than a silent no-op.
 */
export const GATE_PASS_TRANSITIONS: Record<GatePassAction, { from: readonly GatePassStatus[]; to: GatePassStatus }> = {
  created: { from: [], to: 'pending_approval' },
  approved: { from: ['pending_approval'], to: 'approved' },
  rejected: { from: ['pending_approval'], to: 'rejected' },
  cancelled: { from: ['pending_approval', 'approved'], to: 'cancelled' },
  gate_out: { from: ['approved'], to: 'out' },
  // Deliberately NOT reachable from 'expired'. A pass that expired before the car left is closed;
  // if the car does need to go out, someone raises a new pass and an approver signs for it.
  gate_in: { from: ['out'], to: 'returned' },
  expired: { from: ['approved'], to: 'expired' },
}

export function canTransition(from: GatePassStatus, action: GatePassAction): boolean {
  return (GATE_PASS_TRANSITIONS[action].from as readonly string[]).includes(from)
}

export type GatePassStatusInfo = {
  /** Long form, for the detail view. */
  label: string
  /** Short form, for the pill in a table row. */
  pillLabel: string
  /** Who the pass is waiting on. Empty once nobody owes an action. */
  waitingOn: string
  /** Drives colour only — never branch behaviour on this. */
  tone: 'pending' | 'success' | 'danger' | 'active' | 'muted'
}

const STATUS_INFO: Record<GatePassStatus, GatePassStatusInfo> = {
  pending_approval: {
    label: 'Awaiting approval',
    pillLabel: 'Pending',
    waitingOn: 'Sales Manager',
    tone: 'pending',
  },
  approved: {
    label: 'Approved — not yet left',
    pillLabel: 'Approved',
    waitingOn: 'Gate',
    tone: 'success',
  },
  rejected: {
    label: 'Rejected',
    pillLabel: 'Rejected',
    waitingOn: '',
    tone: 'danger',
  },
  out: {
    label: 'Out of the premises',
    pillLabel: 'Out',
    waitingOn: 'Return',
    tone: 'active',
  },
  returned: {
    label: 'Returned',
    pillLabel: 'Returned',
    waitingOn: '',
    tone: 'muted',
  },
  cancelled: {
    label: 'Cancelled',
    pillLabel: 'Cancelled',
    waitingOn: '',
    tone: 'muted',
  },
  expired: {
    label: 'Expired without leaving',
    pillLabel: 'Expired',
    waitingOn: '',
    tone: 'muted',
  },
}

/**
 * Never throws and never returns undefined: an unrecognised string (a hand-edited row, a value
 * written by a newer deploy) renders as itself rather than blanking the cell or crashing the table.
 */
export function getGatePassStatusInfo(status: string | null | undefined): GatePassStatusInfo {
  if (isGatePassStatus(status)) return STATUS_INFO[status]
  const raw = String(status ?? '').trim()
  return {
    label: raw || 'Unknown',
    pillLabel: raw || 'Unknown',
    waitingOn: '',
    tone: 'muted',
  }
}

/** Why the vehicle is going out. Free text against this list, same posture as the statuses. */
export const GATE_PASS_PURPOSES = [
  'Customer test drive',
  'Customer home demo',
  'Event / display',
  'Inter-branch movement',
  'Workshop / service',
  'Official use',
  'Other',
] as const

export type GatePassPurpose = (typeof GATE_PASS_PURPOSES)[number]

/** 'Other' has to say what it is, so the register does not fill up with unexplained trips. */
export function purposeRequiresNote(purpose: string | null | undefined): boolean {
  return String(purpose ?? '').trim() === 'Other'
}
