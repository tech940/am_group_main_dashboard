'use client'

import { useQuery } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'
import { isAdminRole, isSuperAdminRole } from '@/lib/auth/roles'

export function useUserRole() {
  const { data: currentUser, isLoading: loading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      const response = await fetch('/api/auth/user', { cache: 'no-store' })
      if (!response.ok) return null
      return await response.json() as { id?: string; role?: string; brand?: string; fullName?: string; email?: string }
    },
    staleTime: 60 * 1000,
  })

  const userId = currentUser?.id || null
  const userRole = currentUser?.role || null
  const userBrand = currentUser?.brand || null
  const fullName = currentUser?.fullName || null
  const email = currentUser?.email || null

  return {
    userId,
    userRole,
    userBrand,
    fullName,
    email,
    loading,
    isAdmin: isSuperAdminRole(userRole),
    isSuperAdmin: isSuperAdminRole(userRole),
    isBranchAdmin: userRole === 'branch_admin',
    canAccessAdmin: isAdminRole(userRole),
    isManager: userRole === 'manager',
    isTechnician: userRole === 'technician',
    isViewer: userRole === 'viewer'
  }
}

// Made with Bob
