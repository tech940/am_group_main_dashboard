// Access control helper for Scrap Management.
// Allowed roles: MD, Developer, EBA.
// Access can also be granted to individual users/roles via the Access Control map (scrap_erp.view).

export const SCRAP_ERP_VIEW_ROLES = [
  'developer', 'md', 'eba',
] as const

export function canAccessScrapErp(role?: string | null, permissionMap?: Record<string, boolean> | null): boolean {
  const r = String(role || '').toLowerCase().trim()
  if ((SCRAP_ERP_VIEW_ROLES as readonly string[]).includes(r)) return true
  if (permissionMap && permissionMap['scrap_erp.view'] === true) return true
  return false
}
