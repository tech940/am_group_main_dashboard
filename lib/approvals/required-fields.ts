/**
 * What an approval request must carry before it is accepted — for every brand.
 *
 * ── Why this is shared ────────────────────────────────────────────────────────────────────────
 * The rule has to hold in three places at once: the submit form, the KIA create route, and the
 * `[brand]` create route that serves Hyundai, Platinum and MG. Before this module the form checked
 * eight fields and BOTH server routes checked four (email, name, department, amount), so a request
 * missing its dealer code, approval type, payment type, vendor, GL account or remarks was accepted
 * without complaint.
 *
 * ⚠️ That gap matters more here than in most sections: the create endpoints are DELIBERATELY
 * unauthenticated, because submitters have no login. Client-side validation is therefore a
 * courtesy, not a control — anyone can POST the bare JSON. The server is the only enforcement.
 *
 * ── What is NOT required ──────────────────────────────────────────────────────────────────────
 * Bills and documents stay optional by decision: a request often precedes the invoice.
 * Two more are excluded because the user never types them —
 *   `gst`  is copied from the selected vendor record.
 *   `specifyOtherDepartment` is derived from the Department picker, so requiring Department covers it.
 */

export type ApprovalPayload = {
  email?: unknown
  name?: unknown
  location?: unknown
  dealerCode?: unknown
  dealerName?: unknown
  department?: unknown
  approvalType?: unknown
  specifyOtherApprovalType?: unknown
  vendorName?: unknown
  previousAdvance?: unknown
  vehicleNumber?: unknown
  amount?: unknown
  typeOfPayment?: unknown
  glAccountId?: unknown
  remarks?: unknown
}

const text = (v: unknown) => String(v ?? '').trim()

/** Approval types that reveal an extra field on the form, and therefore require it. */
export function needsSpecifyOtherType(approvalType: unknown): boolean {
  return text(approvalType) === 'Others'
}
export function needsPreviousAdvance(approvalType: unknown): boolean {
  return text(approvalType).toUpperCase().includes('ADVANCE')
}
export function needsVehicleNumber(approvalType: unknown): boolean {
  const t = text(approvalType)
  return t.toLowerCase().includes('stock transfer') || t === 'Stock Transfer'
}

/**
 * The first missing field, phrased for the person filling the form, or null when the request is
 * complete. Order matches the form top to bottom so the message points at the earliest gap rather
 * than an arbitrary one.
 */
export function findMissingApprovalField(payload: ApprovalPayload): string | null {
  const required: Array<[unknown, string]> = [
    [payload.email, 'Email address is required.'],
    [payload.name, 'Name is required.'],
    [payload.location, 'Location is required.'],
    [payload.dealerCode, 'Dealer Code is required.'],
    [payload.dealerName, 'Dealer Name is required.'],
    [payload.department, 'Department Category (Sales or Service) is mandatory.'],
    [payload.approvalType, 'Approval Type is required.'],
  ]

  // Conditional fields: required exactly when the form shows them.
  if (needsSpecifyOtherType(payload.approvalType)) {
    required.push([payload.specifyOtherApprovalType, 'Please specify the approval type.'])
  }
  if (needsPreviousAdvance(payload.approvalType)) {
    required.push([payload.previousAdvance, 'Previous advance is required for an advance request. Enter 0 if there is none.'])
  }
  if (needsVehicleNumber(payload.approvalType)) {
    required.push([payload.vehicleNumber, 'Chassis number is required for a stock transfer.'])
  }

  required.push(
    [payload.vendorName, 'Vendor name is required.'],
    [payload.typeOfPayment, 'Payment Type is required.'],
    [payload.glAccountId, 'GL account is required.'],
    [payload.remarks, 'Remarks are required.'],
  )

  for (const [value, message] of required) {
    if (!text(value)) return message
  }

  // Amount is checked last because "greater than 0" is a different failure from "missing".
  const amount = Number(text(payload.amount))
  if (!text(payload.amount) || Number.isNaN(amount) || amount <= 0) {
    return 'Please enter a valid amount greater than 0.'
  }

  return null
}
