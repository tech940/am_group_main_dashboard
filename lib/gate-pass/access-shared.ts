/**
 * The parts of the gate pass access rule that BOTH the server and the browser need.
 *
 * ⚠️ No 'server-only' here, and no db import — this file is bundled into the client. lib/gate-pass/
 * access.ts re-exports from it rather than restating it, so the sidebar, the page guard, every API
 * route and the UI's "show the Approve button" test all resolve to the SAME list.
 *
 * That single-source rule is not stylistic. Guard/API desync has caused four separate outages in
 * this codebase, every one of them a client and a server each holding their own copy of a rule that
 * then drifted — a button that appears and then 403s, or a section visible in the sidebar that
 * bounces you home on click.
 */

/**
 * Who may approve a gate pass.
 *
 * ⚠️ An EXPLICIT list, deliberately NOT hasGlobalAccessRole(). That helper spans
 * developer/md/ceo/ea/eba/ed/edp/process_coordinator/hr — nine roles including HR and the EAs, none
 * of whom were chosen to sign a demo car out of the showroom. Approval authority here is a product
 * decision (Sales Manager, with GM and MD as fallback so a car is never stuck behind one person on
 * leave), and a helper that quietly widens it would hand that decision to whoever next edits an
 * unrelated array.
 */
export const GATE_PASS_APPROVER_ROLES = new Set([
  'sales_manager',
  'general_manager',
  'md',
  // Support access. Present so a stuck pass can be unstuck; every action is signed in the audit
  // trail with this role attached, so its use is visible rather than silent.
  'developer',
])

export function isGatePassApproverRole(role: string | null | undefined): boolean {
  if (!role) return false
  return GATE_PASS_APPROVER_ROLES.has(String(role).trim().toLowerCase())
}
