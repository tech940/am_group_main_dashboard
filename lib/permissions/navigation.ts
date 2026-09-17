import { SECTION_ROUTES } from './registry'

/**
 * href → `<section>.view` permission key, generated from the single SECTION_ROUTES source in
 * the registry. Replaces the hand-maintained `sidebarPermissionByHref` map that used to live
 * in components/layout/sidebar.tsx — adding a navigable section now only means adding it to
 * SECTION_ROUTES. Shared by the sidebar (link gating) and route guards.
 */
export const SIDEBAR_PERMISSION_BY_HREF: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const [groupKey, route] of Object.entries(SECTION_ROUTES)) {
    const viewKey = `${groupKey}.view`
    map[route.href] = viewKey
    for (const alias of route.aliases || []) map[alias] = viewKey
  }
  return map
})()

/** The `<section>.view` permission a path requires, or undefined if the path is ungated. */
export function permissionKeyForHref(href: string): string | undefined {
  return SIDEBAR_PERMISSION_BY_HREF[href]
}

/**
 * ONE sidebar link that opens several Access-Map sections, shown to anyone holding ANY of them.
 *
 * AM Tata · H Promise (owner, 2026-09-17): "put all of them in one option … H Promise … inside handle
 * everything". The Access Map keeps its four H Promise columns — an admin still grants Vehicle Register,
 * Approvals, Payment Verification and MIS one person at a time — but the sidebar and search show a single
 * H Promise row, and the page shows only the tabs the person holds.
 *
 * ⚠️ Every member must be a routed group (SECTION_ROUTES), so each stays tickable; scripts/verify-nav-map.ts
 * checks that. ⚠️ Without an entry here, a composite href has no permission key and the sidebar's final
 * `return true` would show it to everyone who can see the brand card.
 */
export const COMPOSITE_SIDEBAR_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  '/brands/tata/h-promise': [
    'tata.h_promise.register.view',
    'tata.h_promise.approvals.view',
    'tata.h_promise.payments.view',
    'tata.h_promise.insights.view',
  ],
}

/** The view keys behind a composite link, or undefined for an ordinary one. */
export function compositeViewKeysForHref(href: string): readonly string[] | undefined {
  return COMPOSITE_SIDEBAR_SECTIONS[href]
}
