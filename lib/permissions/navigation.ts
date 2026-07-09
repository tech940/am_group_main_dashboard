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
