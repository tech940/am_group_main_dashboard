export const SUPER_ADMIN_ROLE_VALUES = ['super_admin'] as const
export const GLOBAL_ACCESS_ROLE_VALUES = ['super_admin', 'md', 'ceo', 'ea', 'eba'] as const
export const ADMIN_ROLE_VALUES = [...SUPER_ADMIN_ROLE_VALUES] as const

export function isSuperAdminRole(role: string | null | undefined) {
  return role === 'super_admin'
}

/** Roles that can access every sidebar section across all branches regardless of assigned branch. */
export function hasGlobalAccessRole(role: string | null | undefined) {
  if (!role) return false
  return (GLOBAL_ACCESS_ROLE_VALUES as readonly string[]).includes(role)
}

export function isBranchAdminRole(role: string | null | undefined) {
  return role === 'branch_admin'
}

export function isAdminRole(role: string | null | undefined) {
  return isSuperAdminRole(role)
}
