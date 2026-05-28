'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { UserPlus, Users, Shield, Trash2, Edit, Search, Filter } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { USER_BRANCH_OPTIONS, getUserBranchLabel, type UserBranchValue } from '@/lib/branches'

interface User {
  id: string
  email: string
  fullName: string
  role: 'admin' | 'purchase_manager' | 'ea' | 'md' | 'accounts' | 'manager' | 'technician' | 'viewer'
  brand?: string
  department?: string
  isActive: boolean
  createdAt: string
}

type UserRole = User['role']

interface UsersPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface UsersSummary {
  totalUsers: number
  admins: number
  managers: number
  active: number
}

const DEFAULT_PAGINATION: UsersPagination = {
  page: 1,
  pageSize: 10,
  total: 0,
  totalPages: 1,
}

const ROLE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Roles & Departments' },
  { value: 'role:admin', label: 'Admin' },
  { value: 'role:purchase_manager', label: 'Purchase Managers' },
  { value: 'role:ea', label: 'EA' },
  { value: 'role:md', label: 'MD' },
  { value: 'role:accounts', label: 'Accounts Team' },
  { value: 'role:manager', label: 'Managers' },
  { value: 'role:technician', label: 'Technicians' },
  { value: 'role:viewer', label: 'Viewers' },
  { value: 'combo:hr_managers', label: 'HR Managers' },
  { value: 'combo:sales_managers', label: 'Sales Managers' },
] as const

function getRoleAndDepartmentFromFilter(filter: string) {
  switch (filter) {
    case 'combo:hr_managers':
      return { role: 'manager', department: 'HR' }
    case 'combo:sales_managers':
      return { role: 'manager', department: 'SALES' }
    default:
      return filter.startsWith('role:')
        ? { role: filter.replace('role:', ''), department: 'all' }
        : { role: 'all', department: 'all' }
  }
}

export default function AdminUsersPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [branchFilter, setBranchFilter] = useState<string>('any')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [users, setUsers] = useState<User[]>([])
  const [fetchingUsers, setFetchingUsers] = useState(true)
  const [pagination, setPagination] = useState<UsersPagination>(DEFAULT_PAGINATION)
  const [summary, setSummary] = useState<UsersSummary>({
    totalUsers: 0,
    admins: 0,
    managers: 0,
    active: 0,
  })
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([])

  const fetchUsers = useCallback(async (page = 1) => {
    try {
      setFetchingUsers(true)
      const quickFilter = getRoleAndDepartmentFromFilter(roleFilter)
      const resolvedDepartment = departmentFilter !== 'all' ? departmentFilter : quickFilter.department
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '10',
        search: searchQuery.trim(),
        role: quickFilter.role,
        department: resolvedDepartment,
        branch: branchFilter,
        status: statusFilter,
      })
      const response = await fetch(`/api/admin/users?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
        setPagination(data.pagination || DEFAULT_PAGINATION)
        setSummary(data.summary || { totalUsers: 0, admins: 0, managers: 0, active: 0 })
        setDepartmentOptions(data.filterOptions?.departments || [])
      }
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setFetchingUsers(false)
    }
  }, [branchFilter, departmentFilter, roleFilter, searchQuery, statusFilter])

  // Fetch users from API
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUsers(1)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [fetchUsers])

  const goToPage = (page: number) => {
    const nextPage = Math.min(Math.max(1, page), pagination.totalPages)
    void fetchUsers(nextPage)
  }

  const resetToFirstPage = (callback: () => void) => {
    callback()
    setPagination((current) => ({ ...current, page: 1 }))
  }

  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    role: 'viewer' as UserRole,
    brand: '',
    department: ''
  })

  const [editFormData, setEditFormData] = useState({
    id: '',
    email: '',
    fullName: '',
    role: 'viewer' as UserRole,
    brand: '',
    department: '',
    isActive: true
  })

  const pageNumbers = useMemo(() => {
    const totalPages = pagination.totalPages || 1
    const start = Math.max(1, pagination.page - 2)
    const end = Math.min(totalPages, start + 4)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [pagination.page, pagination.totalPages])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })

      if (response.ok) {
        setIsCreateDialogOpen(false)
        setFormData({
          email: '',
          fullName: '',
          password: '',
          role: 'viewer',
          brand: '',
          department: ''
        })
        alert('User created successfully!')
        // Refresh the user list
        void fetchUsers()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error || error.message || 'Failed to create user'}`)
      }
    } catch (error) {
      console.error('Error creating user:', error)
      alert('Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleEditUser = (user: User) => {
    setEditFormData({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      brand: user.brand || '',
      department: user.department || '',
      isActive: user.isActive
    })
    setIsEditDialogOpen(true)
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData)
      })

      if (response.ok) {
        setIsEditDialogOpen(false)
        alert('User updated successfully!')
        void fetchUsers()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error || 'Failed to update user'}`)
      }
    } catch (error) {
      console.error('Error updating user:', error)
      alert('Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (userId: string, userEmail: string) => {
    if (!confirm(`Are you sure you want to delete user: ${userEmail}?\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/admin/users?id=${userId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        alert('User deleted successfully!')
        void fetchUsers()
      } else {
        const error = await response.json()
        alert(`Error: ${error.error || 'Failed to delete user'}`)
      }
    } catch (error) {
      console.error('Error deleting user:', error)
      alert('Failed to delete user')
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-[#023468] text-white'
      case 'purchase_manager':
        return 'bg-purple-500 text-white'
      case 'ea':
        return 'bg-indigo-500 text-white'
      case 'md':
        return 'bg-violet-500 text-white'
      case 'accounts':
        return 'bg-amber-500 text-white'
      case 'manager':
        return 'bg-[#034b82] text-white'
      case 'technician':
        return 'bg-blue-500 text-white'
      default:
        return 'bg-slate-500 text-white'
    }
  }

  return (
    <MainLayout title="User Management" subtitle="Admin Panel">
      <div className="space-y-6 max-w-[1600px] mx-auto animate-in fade-in duration-500">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-800">User Management</h1>
            <p className="text-slate-500 mt-2 font-semibold">Create and manage user accounts</p>
          </div>
          
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-[#023468] to-[#034b82] text-white shadow-lg shadow-[#023468]/25 hover:from-[#012348] hover:to-[#023468] rounded-xl font-bold">
                <UserPlus className="mr-2 h-4 w-4" />
                Create New User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] rounded-2xl bg-white">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black text-slate-800">Create New User</DialogTitle>
                <DialogDescription className="text-slate-500 font-semibold">
                  Add a new user to the system with specific credentials and role.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateUser} autoComplete="off" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName" className="text-sm font-bold text-slate-700">Full Name</Label>
                    <Input
                      id="fullName"
                      placeholder="John Doe"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      required
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-bold text-slate-700">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@amgroup.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-sm font-bold text-slate-700">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role" className="text-sm font-bold text-slate-700">Role</Label>
                    <Select value={formData.role} onValueChange={(value: UserRole) => setFormData({ ...formData, role: value })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                        <SelectItem value="admin" className="bg-white hover:bg-slate-50">Admin</SelectItem>
                        <SelectItem value="purchase_manager" className="bg-white hover:bg-slate-50">Purchase Manager</SelectItem>
                        <SelectItem value="ea" className="bg-white hover:bg-slate-50">EA (Executive Assistant)</SelectItem>
                        <SelectItem value="md" className="bg-white hover:bg-slate-50">MD (Managing Director)</SelectItem>
                        <SelectItem value="accounts" className="bg-white hover:bg-slate-50">Accounts</SelectItem>
                        <SelectItem value="manager" className="bg-white hover:bg-slate-50">Manager</SelectItem>
                        <SelectItem value="technician" className="bg-white hover:bg-slate-50">Technician</SelectItem>
                        <SelectItem value="viewer" className="bg-white hover:bg-slate-50">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand" className="text-sm font-bold text-slate-700">Assigned Branch Access</Label>
                    <Select value={formData.brand} onValueChange={(value: UserBranchValue) => setFormData({ ...formData, brand: value })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select branch access" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                        {USER_BRANCH_OPTIONS.map((branch) => (
                          <SelectItem key={branch.value} value={branch.value} className="bg-white hover:bg-slate-50">
                            {branch.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="department" className="text-sm font-bold text-slate-700">Department (Optional)</Label>
                    <Input
                      id="department"
                      placeholder="Operations"
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                    className="flex-1 rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-gradient-to-r from-[#023468] to-[#034b82] text-white hover:from-[#012348] hover:to-[#023468] rounded-xl"
                  >
                    {loading ? 'Creating...' : 'Create User'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Edit User Dialog */}
          <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
            <DialogContent className="sm:max-w-[500px] rounded-2xl bg-white">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black text-slate-800">Edit User</DialogTitle>
                <DialogDescription className="text-slate-500 font-semibold">
                  Update user information and permissions.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdateUser} autoComplete="off" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-fullName" className="text-sm font-bold text-slate-700">Full Name</Label>
                    <Input
                      id="edit-fullName"
                      placeholder="John Doe"
                      value={editFormData.fullName}
                      onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                      required
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-email" className="text-sm font-bold text-slate-700">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      placeholder="john@amgroup.com"
                      value={editFormData.email}
                      onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                      required
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-role" className="text-sm font-bold text-slate-700">Role</Label>
                    <Select value={editFormData.role} onValueChange={(value: UserRole) => setEditFormData({ ...editFormData, role: value })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                        <SelectItem value="admin" className="bg-white hover:bg-slate-50">Admin</SelectItem>
                        <SelectItem value="purchase_manager" className="bg-white hover:bg-slate-50">Purchase Manager</SelectItem>
                        <SelectItem value="ea" className="bg-white hover:bg-slate-50">EA (Executive Assistant)</SelectItem>
                        <SelectItem value="md" className="bg-white hover:bg-slate-50">MD (Managing Director)</SelectItem>
                        <SelectItem value="accounts" className="bg-white hover:bg-slate-50">Accounts</SelectItem>
                        <SelectItem value="manager" className="bg-white hover:bg-slate-50">Manager</SelectItem>
                        <SelectItem value="technician" className="bg-white hover:bg-slate-50">Technician</SelectItem>
                        <SelectItem value="viewer" className="bg-white hover:bg-slate-50">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-brand" className="text-sm font-bold text-slate-700">Assigned Branch Access</Label>
                    <Select value={editFormData.brand} onValueChange={(value: UserBranchValue) => setEditFormData({ ...editFormData, brand: value })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select branch access" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                        {USER_BRANCH_OPTIONS.map((branch) => (
                          <SelectItem key={branch.value} value={branch.value} className="bg-white hover:bg-slate-50">
                            {branch.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-department" className="text-sm font-bold text-slate-700">Department (Optional)</Label>
                    <Input
                      id="edit-department"
                      placeholder="Operations"
                      value={editFormData.department}
                      onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                      className="rounded-xl border-slate-200"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-isActive" className="text-sm font-bold text-slate-700">Status</Label>
                    <Select value={editFormData.isActive ? 'active' : 'inactive'} onValueChange={(value) => setEditFormData({ ...editFormData, isActive: value === 'active' })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                        <SelectItem value="active" className="bg-white hover:bg-slate-50">Active</SelectItem>
                        <SelectItem value="inactive" className="bg-white hover:bg-slate-50">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditDialogOpen(false)}
                    className="flex-1 rounded-xl"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-xl"
                  >
                    {loading ? 'Updating...' : 'Update User'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Total Users</p>
                  <p className="text-3xl font-black text-slate-800 mt-2">{summary.totalUsers}</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-[#edf4fb] flex items-center justify-center">
                  <Users className="h-6 w-6 text-[#023468]" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Admins</p>
                  <p className="text-3xl font-black text-slate-800 mt-2">{summary.admins}</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-[#edf4fb] flex items-center justify-center">
                  <Shield className="h-6 w-6 text-[#023468]" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Managers</p>
                  <p className="text-3xl font-black text-slate-800 mt-2">{summary.managers}</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Active</p>
                  <p className="text-3xl font-black text-slate-800 mt-2">{summary.active}</p>
                </div>
                <div className="h-12 w-12 rounded-xl bg-[#edf4fb] flex items-center justify-center">
                  <Users className="h-6 w-6 text-[#023468]" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Users Table */}
        <Card className="border-none shadow-xl shadow-slate-200/50 rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <CardTitle className="text-xl font-black text-slate-800">All Users</CardTitle>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  Showing {users.length} of {pagination.total} matching user{pagination.total === 1 ? '' : 's'}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:flex xl:items-center">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => resetToFirstPage(() => setSearchQuery(e.target.value))}
                    className="pl-10 rounded-xl border-slate-200 w-full xl:w-64"
                  />
                </div>
                <Select value={roleFilter} onValueChange={(value) => resetToFirstPage(() => setRoleFilter(value))}>
                  <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white xl:w-56">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Role or team" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                    {ROLE_FILTER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="bg-white hover:bg-slate-50">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={departmentFilter} onValueChange={(value) => resetToFirstPage(() => setDepartmentFilter(value))}>
                  <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white xl:w-48">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                    <SelectItem value="all" className="bg-white hover:bg-slate-50">All Departments</SelectItem>
                    {departmentOptions.map((department) => (
                      <SelectItem key={department} value={department} className="bg-white hover:bg-slate-50">
                        {department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={branchFilter} onValueChange={(value) => resetToFirstPage(() => setBranchFilter(value))}>
                  <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white xl:w-48">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                    <SelectItem value="any" className="bg-white hover:bg-slate-50">All Branch Access</SelectItem>
                    {USER_BRANCH_OPTIONS.map((branch) => (
                      <SelectItem key={branch.value} value={branch.value} className="bg-white hover:bg-slate-50">
                        {branch.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => resetToFirstPage(() => setStatusFilter(value))}>
                  <SelectTrigger className="w-full rounded-xl border-slate-200 bg-white xl:w-36">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl z-[200] bg-white border border-slate-200 shadow-xl">
                    <SelectItem value="all" className="bg-white hover:bg-slate-50">All Status</SelectItem>
                    <SelectItem value="active" className="bg-white hover:bg-slate-50">Active</SelectItem>
                    <SelectItem value="inactive" className="bg-white hover:bg-slate-50">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#023468]">
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">User</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Email</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Role</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Branch Access</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Department</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-widest text-white">Created</th>
                    <th className="px-6 py-4 text-center text-xs font-black uppercase tracking-widest text-white">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fetchingUsers ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-8 w-8 border-4 border-[#b9ccde] border-t-[#023468] rounded-full animate-spin"></div>
                          <p className="text-sm font-bold text-slate-400 uppercase tracking-wider">Loading users...</p>
                        </div>
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-20 text-center text-slate-400 font-bold">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#023468] to-[#034b82] flex items-center justify-center text-white font-bold">
                            {user.fullName.charAt(0)}
                          </div>
                          <span className="font-bold text-slate-800">{user.fullName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-semibold">{user.email}</td>
                      <td className="px-6 py-4">
                        <Badge className={`${getRoleBadgeColor(user.role)} rounded-lg font-bold uppercase text-xs shadow-sm`}>
                          {user.role}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-semibold">{getUserBranchLabel(user.brand)}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-semibold">{user.department || '—'}</td>
                      <td className="px-6 py-4">
                        <Badge className={user.isActive ? 'bg-[#edf4fb] text-[#023468] rounded-lg font-bold' : 'bg-slate-100 text-slate-700 rounded-lg font-bold'}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-semibold">
                        {new Date(user.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit'
                        })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditUser(user)}
                            className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600 rounded-lg"
                            title="Edit user"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteUser(user.id, user.email)}
                            className="h-8 w-8 p-0 hover:bg-rose-50 hover:text-rose-600 rounded-lg"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-semibold text-slate-500">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goToPage(pagination.page - 1)}
                  disabled={fetchingUsers || pagination.page <= 1}
                  className="rounded-xl border-slate-200 bg-white"
                >
                  Previous
                </Button>
                {pageNumbers.map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    type="button"
                    variant={pageNumber === pagination.page ? 'default' : 'outline'}
                    onClick={() => goToPage(pageNumber)}
                    disabled={fetchingUsers}
                    className={pageNumber === pagination.page
                      ? 'rounded-xl bg-[#023468] text-white hover:bg-[#012348]'
                      : 'rounded-xl border-slate-200 bg-white'}
                  >
                    {pageNumber}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goToPage(pagination.page + 1)}
                  disabled={fetchingUsers || pagination.page >= pagination.totalPages}
                  className="rounded-xl border-slate-200 bg-white"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  )
}

// Made with Bob
