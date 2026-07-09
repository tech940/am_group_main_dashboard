// Pure, isomorphic helpers for the KIA Bookings status-visibility indicator.
// No `server-only` import here so both the list rows and the detail/side panel
// (all client-rendered) can share the exact same status -> stage/approver map.
//
// This mirrors `lib/petty-cash/status-tracking.ts` (same shape + the same
// `formatWaitingDuration` formatting) so the two workflows read identically.
//
// The proforma approval gate is the SINGLE shared stage from the redesign — we
// defer to `kiaApprovalStage()` / `kiaStageActorLabel()` and never reintroduce
// the old finance_head / sales_manager / general_manager chain.

import { kiaApprovalStage, kiaStageActorLabel } from '@/lib/kia-proforma/approval'

// 'pending'  = actively waiting on someone (counts towards "time waiting")
// 'draft'    = created but not yet in the workflow (no one is waiting yet)
// 'terminal' = delivered / cancelled — nothing is pending
export type KiaBookingStageState = 'pending' | 'draft' | 'terminal'

export type KiaBookingStageInfo = {
  // Human-readable name of the stage the booking is currently sitting at.
  stageLabel: string
  // Who the booking is waiting on right now (null for draft / terminal).
  pendingWith: string | null
  state: KiaBookingStageState
}

const TERMINAL_DELIVERED: KiaBookingStageInfo = { stageLabel: 'Delivered', pendingWith: null, state: 'terminal' }
const TERMINAL_CANCELLED: KiaBookingStageInfo = { stageLabel: 'Cancelled', pendingWith: null, state: 'terminal' }
const FALLBACK: KiaBookingStageInfo = { stageLabel: 'Unknown', pendingWith: null, state: 'terminal' }

// Bookings waiting longer than this at a single stage are highlighted as stale
// (a subtle rose accent). Same 2-day threshold as the petty-cash board.
export const KIA_BOOKING_STALE_WAIT_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Given a booking `status` and (optionally) its linked proforma `approvalStatus`,
 * return the current stage, who it is pending with, and whether it is in-flight.
 *
 * `approvalStatus` refines the `proforma_generated` status: the booking sits at
 * that status from proforma generation until a VIN is allotted, so the actual
 * gate (approval vs. allocation) depends on the proforma's approval state. The
 * list rows don't carry the proforma approval, so they pass it undefined and get
 * the sensible default (the approval gate that immediately follows generation).
 */
export function getKiaBookingStageInfo(
  status: string | null | undefined,
  approvalStatus?: string | null,
): KiaBookingStageInfo {
  const s = String(status || '').trim().toLowerCase()

  switch (s) {
    case 'draft':
      return { stageLabel: 'Draft', pendingWith: 'Sales Executive', state: 'draft' }
    case 'booking_created':
      // Booking exists; the Sales Executive must generate & submit the proforma.
      return { stageLabel: 'Proforma Generation', pendingWith: 'Sales Executive', state: 'pending' }
    case 'proforma_generated': {
      // Refine using the single shared approval stage when we know it.
      const stage = kiaApprovalStage(approvalStatus)
      if (stage === 'approved') {
        return { stageLabel: 'Vehicle Allocation', pendingWith: 'Stock / Sales Manager', state: 'pending' }
      }
      if (stage === 'declined') {
        return { stageLabel: 'Proforma Declined', pendingWith: 'Sales Executive', state: 'pending' }
      }
      // Default (undefined approvalStatus, PENDING, or legacy) — the approval gate.
      return { stageLabel: 'Proforma Approval', pendingWith: kiaStageActorLabel('approval'), state: 'pending' }
    }
    case 'on_hold':
      return { stageLabel: 'On Hold · Reallocation', pendingWith: 'Stock / Sales Manager', state: 'pending' }
    case 'vehicle_allocated':
      return { stageLabel: 'Payment & Invoice', pendingWith: 'Accounts', state: 'pending' }
    case 'transfer_requested':
      return { stageLabel: 'Vehicle Transfer', pendingWith: 'Stock / Accounts', state: 'pending' }
    case 'finance_pending':
      return { stageLabel: 'Finance Processing', pendingWith: 'Finance', state: 'pending' }
    case 'payment_confirmed':
      return { stageLabel: 'Accounts Verification', pendingWith: 'Accounts', state: 'pending' }
    case 'ready_delivery':
      return { stageLabel: 'Delivery', pendingWith: 'Sales Executive', state: 'pending' }
    case 'delivered':
      return TERMINAL_DELIVERED
    case 'cancelled':
      return TERMINAL_CANCELLED
    default:
      return FALLBACK
  }
}

/**
 * Formats how long a booking has waited at its current stage, e.g. "just now",
 * "12 mins", "3h 20m", "5d 2h". Adapted verbatim from the petty-cash helper so
 * both workflows format "time waiting" identically. `fromIso` is the marker for
 * when the booking entered its current stage.
 */
export function formatWaitingDuration(fromIso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!fromIso) return '—'
  const from = new Date(fromIso).getTime()
  if (!Number.isFinite(from)) return '—'

  const diffMs = Math.max(0, nowMs - from)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'}`

  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  if (hours < 24) return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remainderHours = hours % 24
  return remainderHours > 0 ? `${days}d ${remainderHours}h` : `${days}d`
}

/** Whether a booking has been waiting at its current stage past the stale threshold. */
export function isKiaBookingWaitLong(fromIso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!fromIso) return false
  const from = new Date(fromIso).getTime()
  return Number.isFinite(from) && nowMs - from > KIA_BOOKING_STALE_WAIT_MS
}
