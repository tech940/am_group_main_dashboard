// Client-safe role gating for the KIA Proforma / booking workflow.
// Imported by BOTH the React client and the server (lib + API routes) so the
// same rules are enforced in the UI and re-enforced on the backend.
//
// Workflow:
//   sales_executive  -> Create Booking, Generate Proforma, Deliver
//   sales_manager / general_manager / md -> Approve / Decline Proforma
//   (anyone except sales_executive) -> Allot Vehicle / Request Transfer
//   finance_head / finance_team -> Confirm Payment Received
//   accounts -> Enter Invoice #, upload Invoice PDF, verify documents
//   sales_executive -> Mark Delivered
// admin / super_admin bypass everything.

function norm(role?: string | null) {
  return String(role || '').trim().toLowerCase()
}

const PROFORMA_APPROVER_ROLES = ['sales_manager', 'general_manager', 'md']
const FINANCE_ROLES = ['finance_head', 'finance_team']

export function isKiaWorkflowAdmin(role?: string | null) {
  const r = norm(role)
  return r === 'admin' || r === 'super_admin'
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

/** Finance Head / Finance Team (+ admin): confirm payment received (no invoice here). */
export function canConfirmKiaPayment(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || FINANCE_ROLES.includes(r)
}

/** Accounts (+ admin): enter invoice number, upload invoice PDF, verify documentation. */
export function canVerifyKiaAccounts(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'accounts'
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
  return isKiaWorkflowAdmin(r) || canApproveKiaProforma(r) || canConfirmKiaPayment(r) || canVerifyKiaAccounts(r)
}

/** Transfer requests follow the same rule as allotment. */
export function canTransferKiaVehicle(role?: string | null) {
  return canAllotKiaVehicle(role)
}
