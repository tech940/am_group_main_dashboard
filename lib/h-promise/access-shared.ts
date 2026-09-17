/**
 * Who may do what in H Promise — the pure half, safe to import in the browser.
 *
 * The server resolves the permission snapshot (lib/h-promise/access.ts) and hands the result to the page;
 * the page only uses it to decide what to OFFER. Every route re-checks on the server.
 *
 * ⚠️ All six keys are grant-only (lib/permissions/registry.ts). No role template, tier bundle or brand
 * default can set them: a person has an action because an admin ticked it for them, or because they are a
 * super admin (MD / Developer).
 */

import { FILE_KIND_POLICY, type FileKind } from './constants'

export const HP_PERMISSION_KEYS = {
  registerView: 'tata.h_promise.register.view',
  registerCreate: 'tata.h_promise.register.create',
  registerEdit: 'tata.h_promise.register.edit',
  registerDelete: 'tata.h_promise.register.delete',
  approvalsView: 'tata.h_promise.approvals.view',
  approvalsApprove: 'tata.h_promise.approvals.approve',
  paymentsView: 'tata.h_promise.payments.view',
  paymentsEdit: 'tata.h_promise.payments.edit',
  insightsView: 'tata.h_promise.insights.view',
  settingsView: 'tata.h_promise.settings.view',
  settingsEdit: 'tata.h_promise.settings.edit',
} as const

export type HpArea = 'register' | 'approvals' | 'payments' | 'insights'

export const HP_AREAS: ReadonlyArray<{ id: HpArea; label: string; href: string; viewKey: string; blurb: string }> = [
  { id: 'register', label: 'Vehicle Register', href: '/brands/tata/h-promise/register', viewKey: HP_PERMISSION_KEYS.registerView, blurb: 'Stock, bookings, sales and paperwork' },
  { id: 'approvals', label: 'Approvals', href: '/brands/tata/h-promise/approvals', viewKey: HP_PERMISSION_KEYS.approvalsView, blurb: 'Purchases and sales waiting for a decision' },
  { id: 'payments', label: 'Payment Verification', href: '/brands/tata/h-promise/payments', viewKey: HP_PERMISSION_KEYS.paymentsView, blurb: 'Ledgers for sold vehicles' },
  { id: 'insights', label: 'Insights', href: '/brands/tata/h-promise/insights', viewKey: HP_PERMISSION_KEYS.insightsView, blurb: 'Stock, profit, aging and compliance' },
]

export type HPromiseCapabilities = {
  userId: string
  userName: string
  isSuperAdmin: boolean
  register: { view: boolean; create: boolean; edit: boolean; delete: boolean }
  /**
   * `approve` = the MANAGER stage (the Approve tick, for the GSM and Sales Managers).
   * `final` = the MD stage — the MD, or a Developer acting for the MD (the finance-order flow's precedent). It is
   * a role, not a tick: "approved by MD" must not be grantable to anyone else.
   */
  approvals: { view: boolean; approve: boolean; final: boolean }
  payments: { view: boolean; edit: boolean }
  insights: { view: boolean }
  settings: { view: boolean; edit: boolean }
  /** Can open at least one area — and therefore a vehicle's read-only detail. */
  anyView: boolean
  /**
   * Full phone numbers, buyer address and identity documents (owner decision): only people who work the
   * deal — who enter records, approve them, or verify payments.
   */
  canSeePii: boolean
}

export function deriveCapabilities(
  user: { id: string; name: string },
  effective: Readonly<Record<string, boolean>>,
  isSuperAdmin: boolean,
): HPromiseCapabilities {
  const has = (key: string) => isSuperAdmin || effective[key] === true
  const register = {
    view: has(HP_PERMISSION_KEYS.registerView),
    create: has(HP_PERMISSION_KEYS.registerCreate),
    edit: has(HP_PERMISSION_KEYS.registerEdit),
    delete: has(HP_PERMISSION_KEYS.registerDelete),
  }
  const approvals = { view: has(HP_PERMISSION_KEYS.approvalsView), approve: has(HP_PERMISSION_KEYS.approvalsApprove), final: isSuperAdmin }
  const payments = { view: has(HP_PERMISSION_KEYS.paymentsView), edit: has(HP_PERMISSION_KEYS.paymentsEdit) }
  const insights = { view: has(HP_PERMISSION_KEYS.insightsView) }
  const settings = { view: has(HP_PERMISSION_KEYS.settingsView), edit: has(HP_PERMISSION_KEYS.settingsEdit) }
  return {
    userId: user.id,
    userName: user.name,
    isSuperAdmin,
    register,
    approvals,
    payments,
    insights,
    settings,
    anyView: register.view || approvals.view || payments.view || insights.view,
    canSeePii: isSuperAdmin || register.create || register.edit || approvals.approve || payments.edit,
  }
}

/** Nobody can do anything — what an unreadable permission snapshot resolves to (fail closed). */
export function noCapabilities(user: { id: string; name: string }): HPromiseCapabilities {
  return deriveCapabilities(user, {}, false)
}

export function canViewArea(caps: HPromiseCapabilities, area: HpArea): boolean {
  return caps[area].view
}

export function firstPermittedArea(caps: HPromiseCapabilities) {
  return HP_AREAS.find((area) => canViewArea(caps, area.id)) ?? null
}

/** May this person open a stored file of this kind? */
export function canOpenFileKind(caps: HPromiseCapabilities, kind: FileKind): boolean {
  if (!caps.anyView) return false
  const { sensitivity } = FILE_KIND_POLICY[kind]
  if (sensitivity === 'pii') return caps.canSeePii
  if (sensitivity === 'finance') return caps.canSeePii || caps.payments.view
  return true
}

/** May this person upload a file of this kind? The ledger belongs to payment verification. */
export function canUploadFileKind(caps: HPromiseCapabilities, kind: FileKind): boolean {
  if (kind === 'payment_ledger') return caps.payments.edit
  if (kind === 'purchase_approval_screenshot') return caps.register.create || caps.register.edit
  return caps.register.edit || (caps.register.create && FILE_KIND_POLICY[kind].group === 'purchase')
}
