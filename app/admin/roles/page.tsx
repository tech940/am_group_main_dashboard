'use client'

import { useEffect, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2, Shield } from 'lucide-react'
import { USER_ROLE_OPTIONS } from '@/lib/dashboard-config'

interface User {
  id: string
  email: string
  role: string
  full_name?: string
}

export default function RoleManagementPage() {
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState<string | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string>('')

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch('/api/auth/user')
      if (response.ok) {
        const data = await response.json()
        setCurrentUserRole(data.role)
      }
    } catch (error) {
      console.error('Error fetching current user:', error)
    }
  }

  const fetchUsers = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/users')
      if (response.ok) {
        const data = await response.json()
        setUsers(Array.isArray(data) ? data : data.users || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCurrentUser()
      void fetchUsers()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [])

  const updateUserRole = async (userId: string, newRole: string) => {
    try {
      setIsSaving(userId)
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: userId, role: newRole })
      })

      if (response.ok) {
        setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u))
        alert('Role updated successfully!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error updating role:', error)
      alert('Failed to update role')
    } finally {
      setIsSaving(null)
    }
  }

  const getRoleColor = (role: string) => {
    return USER_ROLE_OPTIONS.find(r => r.value === role)?.color || 'bg-gray-500'
  }

  const getRoleLabel = (role: string) => {
    return USER_ROLE_OPTIONS.find(r => r.value === role)?.label || role
  }

  if (currentUserRole !== 'admin' && currentUserRole !== 'md') {
    return (
      <MainLayout>
        <Card className="border-2 border-red-300 bg-red-50">
          <CardContent className="p-6 text-center">
            <Shield className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-red-800 mb-2">Access Denied</h2>
            <p className="text-red-700">Only administrators and MD can access role management.</p>
          </CardContent>
        </Card>
      </MainLayout>
    )
  }

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Role Management</h1>
          <p className="text-gray-600 mt-1">Assign roles to users for approval workflows</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>User Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {users.length === 0 ? (
                <p className="text-center text-gray-500 py-8">No users found</p>
              ) : (
                users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{user.full_name || user.email}</p>
                      <p className="text-sm text-gray-600">{user.email}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge className={`${getRoleColor(user.role)} text-white`}>
                        {getRoleLabel(user.role)}
                      </Badge>
                      <Select
                        value={user.role}
                        onValueChange={(newRole) => updateUserRole(user.id, newRole)}
                        disabled={isSaving === user.id}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {USER_ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role.value} value={role.value}>
                              {role.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isSaving === user.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-800">Role Descriptions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold text-blue-900">Admin</p>
                <p className="text-blue-700">Full system access, can override any stage</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">Purchase Manager</p>
                <p className="text-blue-700">Handles vendor info and GRN stages</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">Finance Head</p>
                <p className="text-blue-700">Creates and manages Finance Orders before EA/MD approval</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">CEO</p>
                <p className="text-blue-700">Executive read access for controlled workflow modules</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">EA (Executive Assistant)</p>
                <p className="text-blue-700">First level approval after vendor info</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">MD (Managing Director)</p>
                <p className="text-blue-700">Final approval before GRN</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">Accounts</p>
                <p className="text-blue-700">Processes payments and completes orders</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900">Manager/Technician</p>
                <p className="text-blue-700">Can create new purchase requests</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  )
}

// Made with Bob
