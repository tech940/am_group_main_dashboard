'use client'

import { useState, useEffect } from 'react'

export function useUserRole() {
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userBrand, setUserBrand] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const response = await fetch('/api/auth/user', { cache: 'no-store' })

        if (response.ok) {
          const currentUser = await response.json()
          setUserRole(currentUser.role || null)
          setUserBrand(currentUser.brand || null)
        }
      } catch (error) {
        console.error('Error fetching user role:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUserRole()
  }, [])

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
