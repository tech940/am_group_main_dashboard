// SINGLE SOURCE OF TRUTH for the two "common" modules whose PAGES gate on a role allowlist rather
// than the permission snapshot: AM Finance (app/am-finance/page.tsx) and Petty Cash
// (app/petty-cash/page.tsx). Both the page guards (lib/am-finance/access.ts, lib/petty-cash/access.ts)
// AND the sidebar links (components/layout/sidebar.tsx) import from here, so the visible-in-sidebar
// rule and the page-guard rule can never drift — that drift is exactly what showed a link the page
// then rejected ("you don't have access — go home"). scripts/verify-guard-parity.ts enforces the wiring.
//
// This module is intentionally CLIENT-SAFE: it has no server-only imports (only an erased `import type`),
// so the client sidebar can import it directly instead of duplicating the role lists.

// AM Finance: the union of the page's allowlist + global-access roles collapses to exactly these six.
export const AM_FINANCE_VIEW_ROLES = ['admin', 'developer', 'ceo', 'md', 'ea', 'eba', 'ed'] as const

// Petty Cash: the roles the page allows (see lib/petty-cash/access.ts canAccessPettyCash).
export const PETTY_CASH_VIEW_ROLES = [
  'admin', 'developer', 'branch_admin', 'ea', 'md', 'eba', 'accounts', 'manager', 'general_manager', 'sales_manager', 'ed',
] as const

/*
 * ⚠️ 'general_manager' here is the General SALES Manager. The General SERVICE Manager
 * ('service_general_manager') is a SEPARATE role and is deliberately NOT listed: every role in this
 * array gets Petty Cash by ROLE, and a role added here must ALSO carry `petty_cash.view` in its
 * template or the sidebar (role AND permission) hides a link the page (role OR explicit grant) then
 * admits — the desync scripts/verify-petty-cash-multibrand.ts section 3 exists to catch.
 *
 * A Service GM reaches Petty Cash the other way: an explicit Access-Map grant, which the page has
 * always honoured and the sidebar now honours too (hasExplicitGrant in components/layout/sidebar.tsx).
 * That grants it to the ONE user an admin ticked rather than to every Service GM by default.
 */

export function isAmFinanceViewRole(role: string | null | undefined): boolean {
  return Boolean(role && (AM_FINANCE_VIEW_ROLES as readonly string[]).includes(role))
}

export function isPettyCashViewRole(role: string | null | undefined): boolean {
  return Boolean(role && (PETTY_CASH_VIEW_ROLES as readonly string[]).includes(role))
}

// CA (Chartered Accountant) — deliberately HARDCODED to exactly these roles (per product decision), so
// no tier/permission/override can widen it. The CA link is nested under Purchase Orders; the page +
// every /api/ca route gate on this list (not on the `ca.view` permission).
export const CA_VIEW_ROLES = ['ca', 'md', 'developer'] as const

export function isCaViewRole(role: string | null | undefined): boolean {
  return Boolean(role && (CA_VIEW_ROLES as readonly string[]).includes(role))
}
