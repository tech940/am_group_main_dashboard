export const SUPER_ADMIN_ROLE_VALUES = ['super_admin', 'admin'] as const
export const ADMIN_ROLE_VALUES = [...SUPER_ADMIN_ROLE_VALUES, 'branch_admin'] as const

export function isSuperAdminRole(role: string | null | undefined) {
  return role === 'super_admin' || role === 'admin'
}

export function isBranchAdminRole(role: string | null | undefined) {
  return role === 'branch_admin'
}

export function isAdminRole(role: string | null | undefined) {
  return isSuperAdminRole(role) || isBranchAdminRole(role)
}
