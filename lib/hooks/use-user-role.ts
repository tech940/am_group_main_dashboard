'use client'

import { useQuery } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'

export function useUserRole() {
  const { data: currentUser, isLoading: loading } = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: async () => {
      const response = await fetch('/api/auth/user')
      if (!response.ok) return null
      return await response.json() as { role?: string; brand?: string }
    },
    staleTime: DASHBOARD_STALE_TIME_MS,
  })

  const userRole = currentUser?.role || null
  const userBrand = currentUser?.brand || null

  return {
    userRole,
    userBrand,
    loading,
    isAdmin: userRole === 'admin' || userRole === 'md',
    canAccessAdmin: userRole === 'admin' || userRole === 'md',
    isManager: userRole === 'manager',
    isTechnician: userRole === 'technician',
    isViewer: userRole === 'viewer'
  }
}

// Made with Bob
