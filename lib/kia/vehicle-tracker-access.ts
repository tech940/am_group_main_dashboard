// Role gates for the KIA Vehicle Tracker. Deliberately ROLE-based, not permission-based:
// `canUserAccessPermission` auto-grants every `kia.*` permission to any user whose
// brand is 'kia' (see lib/permissions/service.ts), so a `kia.*` permission cannot
// exclude the General Sales Manager. These roles are the single source of truth and
// are shared by the page, the API routes, and the sidebar.
//
// - Fill (log out / mark returned): Branch Admin only (+ MD & Developer, who can do anything).
// - View: Branch Admin + General Service Manager (+ MD & Developer).
// - General Sales Manager (`general_manager`) is intentionally excluded — service only.

export const VEHICLE_TRACKER_VIEW_ROLES = ['developer', 'md', 'branch_admin', 'service_general_manager'] as const
export const VEHICLE_TRACKER_FILL_ROLES = ['developer', 'md', 'branch_admin'] as const

export function canViewVehicleTracker(role?: string | null): boolean {
  return (VEHICLE_TRACKER_VIEW_ROLES as readonly string[]).includes(String(role || ''))
}

export function canFillVehicleTracker(role?: string | null): boolean {
  return (VEHICLE_TRACKER_FILL_ROLES as readonly string[]).includes(String(role || ''))
}
