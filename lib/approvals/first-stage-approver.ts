/**
 * Who signs off the FIRST approval stage — for Petty Cash and for Vendor Payment Approvals alike.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────────────────────
 * Only KIA has an Executive Director. Every other brand routes that same first stage to the
 * General Manager for the relevant side of the business:
 *
 *   KIA         submitted → ED  → EA → MD → Accounts
 *   all others  submitted → GSM → EA → MD → Accounts     (GSM = Sales or Service, per department)
 *
 * ── Why this reuses the existing stage rather than adding one ─────────────────────────────────
 * The first stage slot already exists in both workflows (`ed_approval` in petty cash,
 * `vp_approval` / stage key `sales_manager` in approvals). Only the person who may act on it, and
 * what it is called, differ by brand. Adding a parallel `gsm_approval` stage would mean new values
 * in `petty_cash_request_status` and `petty_cash_expense_status` — and a missing ALTER TYPE on a
 * Postgres enum has already taken this app down once. Reusing the slot needs no migration and no
 * enum change.
 *
 * Client-safe: no server-only imports, so the UI and the API enforce the identical rule.
 */

/** The only brand with an Executive Director. Everything else uses a GSM. */
export const ED_BRANDS = ['kia'] as const

export type FirstStageTrack = 'sales' | 'service' | 'unknown'

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

/** Does this brand have an ED to approve the first stage? */
export function brandHasEd(brand: unknown): boolean {
  const b = norm(brand)
  return (ED_BRANDS as readonly string[]).some((known) => b === known || b.startsWith(`${known}`))
}

/**
 * Sales or service, from the free-text `department` both tables carry.
 *
 * ⚠️ Case-insensitive and substring-based on purpose: live data holds 'Sales', 'SALES', 'Service'
 * and 'SERVICE' already, and an exact match would silently drop a request into 'unknown'.
 */
export function trackForDepartment(department: unknown): FirstStageTrack {
  const d = norm(department)
  if (!d) return 'unknown'
  if (d.includes('service')) return 'service'
  if (d.includes('sales')) return 'sales'
  return 'unknown'
}

/**
 * The roles that may act on the first approval stage for this request.
 *
 * Excludes the blanket admin/developer/MD overrides — those are applied by each caller's own
 * existing checks, and folding them in here would hide them from anyone reading this rule.
 *
 * An UNKNOWN department returns BOTH GSMs rather than guessing. A blank department is a data-entry
 * gap, and a request must not be stuck behind one; whichever GSM picks it up, a GSM has still seen
 * it before it reaches EA.
 */
export function firstStageApproverRoles(brand: unknown, department: unknown): string[] {
  if (brandHasEd(brand)) return ['ed']
  switch (trackForDepartment(department)) {
    case 'sales': return ['general_manager']
    case 'service': return ['service_general_manager']
    default: return ['general_manager', 'service_general_manager']
  }
}

/**
 * Same rule, for a caller that has ALREADY worked out the track.
 *
 * The Approvals section classifies service work more richly than `department` alone — it also reads
 * approval-type keywords (PARTS, WORKSHOP, LABOUR, MAINTENANCE). That classification is better than
 * anything this module could infer, so it passes its answer in rather than having it re-derived and
 * silently disagree.
 */
export function firstStageApproverRolesForTrack(brand: unknown, track: FirstStageTrack): string[] {
  if (brandHasEd(brand)) return ['ed']
  switch (track) {
    case 'sales': return ['general_manager']
    case 'service': return ['service_general_manager']
    default: return ['general_manager', 'service_general_manager']
  }
}

/** May this role sign off the first stage of this request? */
export function canApproveFirstStage(role: unknown, brand: unknown, department: unknown): boolean {
  return firstStageApproverRoles(brand, department).includes(norm(role))
}

/**
 * What to call the stage on screen and in emails.
 *
 * ⚠️ Never hardcode "ED" in a shared surface again — that label is what made the KIA-only
 * assumption invisible for so long. Both sections had it written into the UI, the emails and the
 * approvals history rows.
 */
export function firstStageLabel(brand: unknown, department: unknown): string {
  if (brandHasEd(brand)) return 'ED Approval'
  switch (trackForDepartment(department)) {
    case 'sales': return 'GSM Approval (Sales)'
    case 'service': return 'GSM Approval (Service)'
    default: return 'GSM Approval'
  }
}

/** Short form for a chip or a history row. */
export function firstStageShortLabel(brand: unknown, department: unknown): string {
  return brandHasEd(brand) ? 'ED' : 'GSM'
}
