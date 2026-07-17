// Client-safe role gating for the KIA Proforma / booking workflow.
// Imported by BOTH the React client and the server (lib + API routes) so the
// same rules are enforced in the UI and re-enforced on the backend.
//
// Workflow:
//   sales_executive  -> Create Booking, Generate Proforma
//   sales_manager / general_manager / md -> Approve / Decline Proforma
//   idt -> Allot Vehicle to a booking (exclusive)
//   (anyone except sales_executive) -> stock holds / BBND allot / Request Transfer
//   accounts -> Confirm Payment Release + Invoice # + Invoice PDF (single step)
//   cxm -> Mark Delivered (ccm is the backup when the CXM is absent; crm is RETIRED)
// admin / developer bypass everything.
//
// These predicates are the ONLY thing restricting these actions. Do NOT try to gate them with a
// `kia.*` permission: applyBrandDefault() in lib/permissions/service.ts grants every non-restricted
// kia.* key to every KIA user whose role isn't template-only, so `kia.bookings.edit` excludes nobody.
// The requirePermission() calls on the routes are brand/section checks, not action restrictions.

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

/**
 * CXM — Customer Experience Management (+ CCM as backup, + admin/developer): mark the vehicle
 * delivered. Every other role is read-only on delivery status; admin/developer keep the override so
 * a super admin can never be locked out of their own workflow.
 *
 * CCM (Customer Care Manager) is a deliberate SECOND owner, not a widening: delivery is the last
 * step of the sale and cannot wait for one person to be at their desk.
 *
 * Took over from `crm`, which is retired. The enum value 'crm' survives forever (Postgres cannot drop
 * one), so this must actively return FALSE for it rather than merely stop mentioning it.
 *
 * Do NOT be tempted to add cxm/ccm to isKiaWorkflowAdmin instead — that one-liner would also hand
 * them proforma approve/decline, booking creation, vehicle allotment and Accounts payment
 * confirmation. Six capabilities for the price of one.
 */
export function canDeliverKiaBooking(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'cxm' || r === 'ccm'
}

/**
 * IDT — Internal Development Trainee (+ admin/developer): allot a vehicle to a booking. Exclusive.
 *
 * Deliberately SEPARATE from canAllotKiaVehicle below, which still governs stock holds, BBND allot
 * and transfer requests — those keep their existing "anyone except the Sales Executive" rule. Only
 * the booking allotment itself is IDT-exclusive.
 */
export function canAllotKiaVehicleToBooking(role?: string | null) {
  const r = norm(role)
  return isKiaWorkflowAdmin(r) || r === 'idt' || r === 'general_manager'
}

/**
 * Stock holds / BBND allot / transfer requests — any workflow participant EXCEPT the Sales Executive.
 * NOT the gate for allotting a vehicle to a booking; that is canAllotKiaVehicleToBooking.
 */
export function canAllotKiaVehicle(role?: string | null) {
  const r = norm(role)
  if (r === 'sales_executive') return false
  return true
}

/** Transfer requests follow the same rule as allotment. */
export function canTransferKiaVehicle(role?: string | null) {
  return canAllotKiaVehicle(role)
}

/**
 * Who may see EVERY booking. Sales Executives (and any non-privileged role) see only their own
 * bookings; approvers, Accounts, Finance Head, MD, IDT, CXM/CCM and admins see all of them (they need
 * the full pipeline to act on it).
 *
 * ⚠️ AN ACTION-OWNING ROLE MUST BE LISTED HERE OR IT IS INERT. The sole caller (lib/kia/bookings.ts
 * :614) sends every role NOT in this list down an own-bookings filter — createdBy / consultantEmail /
 * consultantName. A role like CXM creates no bookings and is never the consultant, so all three miss
 * and it sees ZERO rows. This is not hypothetical: `crm` held the EXCLUSIVE right to mark bookings
 * delivered while absent from this list, and saw 0 of 55 bookings — the exclusive owner of an action
 * it could not reach. Measured before this change.
 *
 * crm is deliberately NOT re-added: it is retired and should see nothing.
 */
export function canViewAllKiaBookings(role?: string | null) {
  const r = norm(role)
  return (
    isKiaWorkflowAdmin(r) ||
    canApproveKiaProforma(r) ||
    r === 'accounts' ||
    r === 'finance_head' ||
    r === 'idt' ||
    r === 'cxm' ||
    r === 'ccm'
  )
}
