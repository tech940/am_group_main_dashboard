// Role gates for the KIA Booking Payment History section. Deliberately ROLE-based, not
// permission-based, and the SINGLE SOURCE OF TRUTH shared by the page, the API route, and BOTH
// sidebar gaters (components/layout/sidebar.tsx + lib/navigation/sections.ts).
//
// Why not the permission snapshot: the required set is a specific, NON-hierarchical group that the
// tiered ("pyramid") permission model provably cannot express —
//   • granting `sales_manager` leaks UP to `sales_head` (same sales track, tier ≤ HEAD via
//     tierBundleKeys), which must be EXCLUDED here;
//   • global-access roles (ceo/ea/eba/ed) are all forced to the SAME default for restricted sections
//     by resolveEffectiveSnapshot, so EA cannot be granted without also granting ceo/eba/ed.
// A hardcoded allowlist (like Vehicle Tracker, CA, Petty Cash) is the only faithful, drift-proof way
// to restrict to exactly these roles. No tier/permission/override can widen it.
//
// Visibility: MD, Developer, Admin (platform super-admins) + EA see ALL branches; Sales Manager and
// General Manager (General SALES Manager) see ONLY their assigned branch — the branch boundary is
// applied on top in the API via getUserDealerScope('kia'), NOT here.
//
// This module is intentionally CLIENT-SAFE (no server-only imports) so the client sidebar can import
// it directly instead of duplicating the role list.

export const BOOKING_PAYMENT_HISTORY_VIEW_ROLES = [
  'admin', 'developer', 'md', 'ea',
] as const

export function canViewBookingPaymentHistory(role?: string | null, permissionMap?: Record<string, boolean> | null): boolean {
  const r = String(role || '').toLowerCase().trim()
  if ((BOOKING_PAYMENT_HISTORY_VIEW_ROLES as readonly string[]).includes(r)) return true
  if (permissionMap && permissionMap['kia.booking_payment_history.view'] === true) return true
  return false
}
