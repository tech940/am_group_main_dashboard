// Client-safe role gating for the KIA Proforma / booking workflow.
// Imported by BOTH the React client and the server (lib + API routes) so the
// same rules are enforced in the UI and re-enforced on the backend.
//
// Workflow:
//   sales_executive  -> Create Booking, Generate Proforma, Deliver
//   sales_manager / general_manager / md -> Approve / Decline Proforma
//   (anyone except sales_executive) -> Allot Vehicle / Request Transfer
//   accounts -> Confirm Payment Release + Invoice # + Invoice PDF (single step)
//   sales_executive -> Mark Delivered
// admin / developer bypass everything.

function norm(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

const PROFORMA_APPROVER_ROLES = ['sales_manager', 'general_manager', 'md']

export function isKiaWorkflowAdmin(role?: string | null) {
  const r = norm(role)
  return r === 'admin' || r === 'developer'
}

export function isKiaSalesExecutive(role?: string | null) {
  return norm(role) === 'sales_executive'
}

/** Sales Manager / General Manager / MD (+ admin): approve/decline proformas, view all, pending approval, history. */
export function canApproveKiaProforma(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || PROFORMA_APPROVER_ROLES.includes(r)
}

/** Sales Executive (+ approvers/admin): create booking & generate proforma. */
export function canCreateKiaBooking(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'sales_executive' || canApproveKiaProforma(r)
}

/** Accounts (+ admin): confirm payment release, enter invoice #, upload invoice PDF. */
export function canVerifyKiaAccounts(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'accounts'
}

/** Payment is now confirmed by Accounts (Finance stage removed). */
export function canConfirmKiaPayment(role?: string | null) {
  return canVerifyKiaAccounts(role)
}

/** Sales Executive (+ admin): mark the vehicle delivered. */
export function canDeliverKiaBooking(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'sales_executive'
}

/** Vehicle allotment — any workflow participant EXCEPT the Sales Executive. */
export function canAllotKiaVehicle(role?: string | null) {
  const r = norm(role)
  if (r === 'sales_executive') return false
  return isKiaWorkflowAdmin(r) || canApproveKiaProforma(r) || canVerifyKiaAccounts(r)
}

/** Transfer requests follow the same rule as allotment. */
export function canTransferKiaVehicle(role?: string | null) {
  return canAllotKiaVehicle(role)
}

/**
 * Who may see EVERY booking. Sales Executives (and any non-privileged role) see
 * only their own bookings; approvers, Accounts, Finance Head, MD and admins see
 * all of them (they need the full pipeline to approve / act on it).
 */
export function canViewAllKiaBookings(role?: string | null) {
  const r = norm(role)
  return (
    isKiaWorkflowAdmin(r) ||
    canApproveKiaProforma(r) ||
    r === 'accounts' ||
    r === 'finance_head'
  )
}
