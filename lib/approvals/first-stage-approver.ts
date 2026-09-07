/**
 * Who signs off the FIRST approval stage — for Petty Cash and for Vendor Payment Approvals alike.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────────────────────
 * - KIA:               submitted → ED / GSM → CEO → HR (if required) → EA → MD → Accounts
 * - Hyundai:           submitted → sales GSM, or the GROUP SERVICE MANAGER on service → EA → MD → Accounts
 * - Platinum:          submitted → EA → MD → Accounts (No first stage GSM/VP; routes directly to EA)
 * - all others:        submitted → GSM → EA → MD → Accounts (GSM = Sales or Service, per department)
 *
 * Client-safe: no server-only imports, so the UI and the API enforce the identical rule.
 */

/** The only brand with an Executive Director. Everything else uses a GSM. */
export const ED_BRANDS = ['kia'] as const

/**
 * Brands whose SERVICE approvals belong to the Group Service Manager (VP).
 * Hyundai service approvals route to the VP (Group Service Manager).
 * Platinum routes directly to EA -> MD -> Accounts.
 */
export const VP_SERVICE_BRANDS = ['hyundai'] as const
export const GROUP_SERVICE_BRANDS = VP_SERVICE_BRANDS

/** Does this brand's SERVICE side route to the Vice President? */
export function usesVpService(brand: unknown): boolean {
  const b = norm(brand)
  return (VP_SERVICE_BRANDS as readonly string[]).some((known) => b === known || b.startsWith(known))
}

/** Legacy alias for backward compatibility. */
export const usesGroupServiceManager = usesVpService

export type FirstStageTrack = 'sales' | 'service' | 'unknown'

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/**
 * Does this brand have a first-stage approval (ED / GSM / VP)?
 *
 * ⚠️ PLATINUM HAS NO FIRST STAGE.
 * Platinum vendor payment requests route directly: Submit → EA → MD → Accounts.
 * Other brands (KIA, Hyundai, MG, etc.) retain their respective first-stage review.
 */
export function brandHasFirstStage(brand: unknown): boolean {
  const b = norm(brand)
  if (!b) return true // default fallback is KIA
  if (b === 'platinum' || b.startsWith('platinum')) return false
  return true
}

/**
 * Is this request SERVICE work? The one definition, for every surface.
 */
const SERVICE_DEPARTMENT_MARKERS = ['service', 'parts', 'spare', 'body', 'bodyshop', 'workshop', 'labour']
const SERVICE_TYPE_MARKERS = ['parts', 'workshop', 'labour', 'service', 'spare', 'bodyshop', 'maintenance']

export function isServiceApproval(department: unknown, approvalType: unknown): boolean {
  const d = norm(department)
  const a = norm(approvalType)

  // 1. Any department explicitly containing 'sales' is strictly a SALES order (ED / GSM).
  // Under no circumstances should a Sales order be routed to Service / VP.
  if (d.includes('sales')) {
    return false
  }

  // 2. Department explicitly matches service / workshop / parts / body / labour markers
  if (SERVICE_DEPARTMENT_MARKERS.some((m) => d.includes(m))) {
    return true
  }

  // 3. Fallback when department is unassigned or generic (and not sales):
  // Check if the approval type is specifically a workshop/service activity
  return SERVICE_TYPE_MARKERS.some((m) => a.includes(m))
}

/** The track a request belongs to, as every approvals surface resolves it. */
export function approvalTrackFor(department: unknown, approvalType: unknown): FirstStageTrack {
  return isServiceApproval(department, approvalType) ? 'service' : 'sales'
}

/** Does this brand have an ED to approve the first stage? */
export function brandHasEd(brand: unknown): boolean {
  const b = norm(brand)
  return (ED_BRANDS as readonly string[]).some((known) => b === known || b.startsWith(`${known}`))
}

/**
 * Sales or service, from the free-text `department` both tables carry.
 */
export function trackForDepartment(department: unknown): FirstStageTrack {
  const d = norm(department)
  if (!d) return 'unknown'
  if (d.includes('sales')) return 'sales'
  if (SERVICE_DEPARTMENT_MARKERS.some((m) => d.includes(m))) return 'service'
  return 'unknown'
}

/**
 * The roles that may act on the first approval stage for this request.
 */
export function firstStageApproverRoles(brand: unknown, department: unknown): string[] {
  const b = norm(brand)
  if (!brandHasFirstStage(b)) return []
  const serviceRole = usesVpService(b) || b === 'kia' ? 'vp' : 'service_general_manager'
  switch (trackForDepartment(department)) {
    case 'sales': return ['general_manager']
    case 'service': return [serviceRole]
    default: return ['general_manager', serviceRole]
  }
}

/**
 * Same rule, for a caller that has ALREADY worked out the track.
 */
export function firstStageApproverRolesForTrack(brand: unknown, track: FirstStageTrack): string[] {
  const b = norm(brand)
  if (!brandHasFirstStage(b)) return []
  const serviceRole = usesVpService(b) || b === 'kia' ? 'vp' : 'service_general_manager'
  switch (track) {
    case 'sales': return ['general_manager']
    case 'service': return [serviceRole]
    default: return ['general_manager', serviceRole]
  }
}

/** May this role sign off the first stage of this request? */
export function canApproveFirstStage(role: unknown, brand: unknown, department: unknown): boolean {
  if (!brandHasFirstStage(brand)) return false
  return firstStageApproverRoles(brand, department).includes(norm(role))
}

/**
 * What to call the stage on screen and in emails.
 */
export function firstStageLabel(brand: unknown, department: unknown): string {
  const b = norm(brand)
  if (!brandHasFirstStage(b)) return 'EA Approval'
  switch (trackForDepartment(department)) {
    case 'sales': return 'GSM Approval (Sales)'
    case 'service': return (usesVpService(b) || b === 'kia') ? 'VP Approval' : 'GSM Approval (Service)'
    default: return 'GSM Approval'
  }
}

/**
 * Short form for a chip, a history row or a decision email.
 */
export function firstStageShortLabel(brand: unknown, department: unknown, approvalType?: unknown): string {
  const b = norm(brand)
  if (!brandHasFirstStage(b)) return 'EA'
  if ((usesVpService(b) || b === 'kia') && isServiceApproval(department, approvalType)) {
    return 'VP'
  }
  return 'GSM'
}
