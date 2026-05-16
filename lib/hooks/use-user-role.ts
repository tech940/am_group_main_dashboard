'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useUserRole() {
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userBrand, setUserBrand] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const response = await fetch('/api/admin/users')
          if (response.ok) {
            const users = await response.json()
            const currentUser = users.find((u: any) => u.email === user.email)
            if (currentUser) {
              setUserRole(currentUser.role)
              setUserBrand(currentUser.brand || null)
            }
          }
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
    isAdmin: userRole === 'admin',
    isManager: userRole === 'manager',
    isTechnician: userRole === 'technician',
    isViewer: userRole === 'viewer'
  }
}

// Made with Bob
