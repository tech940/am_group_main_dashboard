/**
 * Who signs off the FIRST approval stage — for Petty Cash and for Vendor Payment Approvals alike.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────────────────────
 * - KIA:               submitted → ED / GSM → CEO → HR (if required) → EA → MD → Accounts
 * - Hyundai:           submitted → sales GSM, or the GROUP SERVICE MANAGER on service → EA → MD → Accounts
 * - MG:                submitted → VP (both sales & service) → EA → MD → Accounts
 * - Platinum SERVICE:  submitted → DGM → EA → MD → Accounts
 * - Platinum SALES:    submitted → EA → MD → Accounts (no first stage; routes directly to EA)
 * - all others:        submitted → GSM → EA → MD → Accounts (GSM = Sales or Service, per department)
 *
 * ⚠️ PLATINUM IS THE ONLY BRAND WHOSE FIRST STAGE DEPENDS ON THE TRACK, which is why
 * brandHasFirstStage takes the department. Everywhere else the brand alone decides.
 *
 * Client-safe: no server-only imports, so the UI and the API enforce the identical rule.
 */

/** The only brand with an Executive Director. Everything else uses a GSM. */
export const ED_BRANDS = ['kia'] as const

/**
 * Brands whose SERVICE approvals belong to the Group Service Manager (VP).
 * Hyundai service approvals route to the VP (Group Service Manager).
 * Platinum service routes to the DGM instead — see DGM_BRANDS below.
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

/** The only brand whose first stage belongs to a Deputy General Manager, and only on service. */
export const DGM_BRANDS = ['platinum'] as const

export function isDgmBrand(brand: unknown): boolean {
  const b = norm(brand)
  return (DGM_BRANDS as readonly string[]).some((known) => b === known || b.startsWith(known))
}

/**
 * Does this request have a first-stage approval (ED / GSM / VP / DGM)?
 *
 * ⚠️ PLATINUM IS TRACK-DEPENDENT, and it is the only brand that is.
 *   Platinum SERVICE → DGM → EA → MD → Accounts
 *   Platinum SALES   → EA → MD → Accounts (no first stage)
 * Every other brand answers on the brand alone.
 *
 * ⚠️ `department` is OPTIONAL so the existing call sites still compile — but for Platinum, omitting
 * it answers `false`, i.e. the pre-DGM behaviour. That is a deliberate fail-safe direction: a caller
 * that does not know the track cannot accidentally park a Platinum SALES request on a desk that has
 * no business approving it. Every caller that can supply the department MUST, or Platinum service
 * requests silently skip the DGM.
 */
export function brandHasFirstStage(brand: unknown, department?: unknown, approvalType?: unknown): boolean {
  const b = norm(brand)
  if (!b) return true // default fallback is KIA
  if (isDgmBrand(b)) {
    if (department === undefined && approvalType === undefined) return false
    return isServiceApproval(department, approvalType)
  }
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
export function firstStageApproverRoles(brand: unknown, department: unknown, approvalType?: unknown): string[] {
  const b = norm(brand)
  if (!brandHasFirstStage(b, department, approvalType)) return []
  // Platinum's first stage exists only on service, and belongs to the DGM alone.
  if (isDgmBrand(b)) return ['dgm']
  // MG: VP approves both Sales and Service requests
  if (b === 'mg') return ['vp']
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
  /*
   * The track is already resolved here, so Platinum is answered directly rather than through
   * brandHasFirstStage's department sniffing. Only 'service' has a first stage at Platinum; an
   * 'unknown' track deliberately does NOT, matching the fail-safe direction documented above.
   */
  if (isDgmBrand(b)) return track === 'service' ? ['dgm'] : []
  if (!brandHasFirstStage(b)) return []
  // MG: VP approves both Sales and Service requests
  if (b === 'mg') return ['vp']
  const serviceRole = usesVpService(b) || b === 'kia' ? 'vp' : 'service_general_manager'
  switch (track) {
    case 'sales': return ['general_manager']
    case 'service': return [serviceRole]
    default: return ['general_manager', serviceRole]
  }
}

/** May this role sign off the first stage of this request? */
export function canApproveFirstStage(role: unknown, brand: unknown, department: unknown, approvalType?: unknown): boolean {
  if (!brandHasFirstStage(brand, department, approvalType)) return false
  return firstStageApproverRoles(brand, department, approvalType).includes(norm(role))
}

/**
 * What to call the stage on screen and in emails.
 */
export function firstStageLabel(brand: unknown, department: unknown, approvalType?: unknown): string {
  const b = norm(brand)
  if (!brandHasFirstStage(b, department, approvalType)) return 'EA Approval'
  if (isDgmBrand(b)) return 'DGM Approval'
  if (b === 'mg') return 'VP Approval'
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
  if (!brandHasFirstStage(b, department, approvalType)) return 'EA'
  if (isDgmBrand(b)) return 'DGM'
  if (b === 'mg') return 'VP'
  if ((usesVpService(b) || b === 'kia') && isServiceApproval(department, approvalType)) {
    return 'VP'
  }
  return 'GSM'
}
