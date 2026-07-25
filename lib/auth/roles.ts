export const DEVELOPER_ROLE_VALUES = ['developer'] as const
export const GLOBAL_ACCESS_ROLE_VALUES = ['developer', 'md', 'ceo', 'ea', 'eba', 'ed', 'edp'] as const
export const ADMIN_ROLE_VALUES = [...DEVELOPER_ROLE_VALUES] as const

export function isSuperAdminRole(role: string | null | undefined) {
  return role === 'developer' || role === 'md'
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
