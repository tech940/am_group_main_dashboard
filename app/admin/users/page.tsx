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
import { UserPlus, Users, Shield, Trash2, Edit, Search, Filter, KeyRound, Eye, EyeOff, ClipboardList, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  BRANCH_MODULE_ACCESS_ROLE_EDIT_OPTIONS,
  BRANCH_MODULE_ACCESS_ROLE_KEEP,
  BRANCH_MODULE_ACCESS_ROLE_OPTIONS,
  canUseBranchModuleAccessRole,
  type BranchModuleAccessRoleEditValue,
  type BranchModuleAccessRoleValue,
} from '@/lib/branch-module-access'
import { USER_BRANCH_OPTIONS, USER_ROLE_OPTIONS, getUserBranchLabel, type UserBranchValue } from '@/lib/dashboard-config'
import { useUserRole } from '@/lib/hooks/use-user-role'

interface User {
  id: string
  email: string
  fullName: string
  role: 'admin' | 'ceo' | 'purchase_manager' | 'finance_head' | 'ea' | 'md' | 'accounts' | 'manager' | 'technician' | 'viewer'
  brand?: string
  department?: string
  isActive: boolean
  createdAt: string
}

type UserRole = User['role']

type BulkUserDraft = {
  fullName: string
  email: string
  password: string
  role: UserRole
  brand: string
  department: string
  branchModuleRole: BranchModuleAccessRoleValue
}

type BulkCreateResult = {
  index: number
  email: string
  fullName: string
  status: 'created' | 'failed'
  error?: string
  permissionWarning?: string | null
}

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
  { value: 'role:ceo', label: 'CEO' },
  { value: 'role:purchase_manager', label: 'Purchase Managers' },
  { value: 'role:finance_head', label: 'Finance Heads' },
  { value: 'role:ea', label: 'EA' },
  { value: 'role:md', label: 'MD' },
  { value: 'role:accounts', label: 'Accounts Team' },
  { value: 'role:manager', label: 'Managers' },
  { value: 'role:technician', label: 'Technicians' },
  { value: 'role:viewer', label: 'Viewers' },
  { value: 'combo:hr_managers', label: 'HR Managers' },
  { value: 'combo:sales_managers', label: 'Sales Managers' },
] as const

const USER_MODAL_SELECT_CONTENT_PROPS = {
  side: 'bottom',
  align: 'start',
  avoidCollisions: false,
  className: 'z-[200] max-h-[16rem] rounded-xl border border-slate-200 bg-white shadow-xl',
} as const

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

function parseDelimitedLine(line: string) {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  const delimiter = line.includes('\t') ? '\t' : ','

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"'
      index += 1
    } else if (character === '"') {
      inQuotes = !inQuotes
    } else if (character === delimiter && !inQuotes) {
      cells.push(current.trim())
      current = ''
    } else {
      current += character
    }
  }

  cells.push(current.trim())
  return cells
}

function normalizeRole(value: string): UserRole {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  return USER_ROLE_OPTIONS.some((role) => role.value === normalized)
    ? normalized as UserRole
    : 'viewer'
}

function normalizeBranchModuleRole(value: string): BranchModuleAccessRoleValue {
  const normalized = value.trim().toLowerCase()
  return BRANCH_MODULE_ACCESS_ROLE_OPTIONS.some((role) => role.value === normalized)
    ? normalized as BranchModuleAccessRoleValue
    : 'inherit'
}

function normalizeBranch(value: string) {
  const normalized = value.trim().toLowerCase()
  const matchedBranch = USER_BRANCH_OPTIONS.find((branch) => (
    branch.value.toLowerCase() === normalized
    || branch.label.toLowerCase() === normalized
  ))
  return matchedBranch?.value || ''
}

function parseBulkUsersInput(raw: string): BulkUserDraft[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) return []

  const firstLine = parseDelimitedLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[\s_-]+/g, ''))
  const hasHeader = firstLine.includes('email') || firstLine.includes('fullname') || firstLine.includes('name')
  const dataLines = hasHeader ? lines.slice(1) : lines
  const headerIndex = (aliases: string[], fallback: number) => {
    if (!hasHeader) return fallback
    const foundIndex = firstLine.findIndex((cell) => aliases.includes(cell))
    return foundIndex >= 0 ? foundIndex : fallback
  }

  const fullNameIndex = headerIndex(['fullname', 'name', 'user'], 0)
  const emailIndex = headerIndex(['email', 'emailid', 'mail'], 1)
  const passwordIndex = headerIndex(['password', 'pass'], 2)
  const roleIndex = headerIndex(['role', 'approle'], 3)
  const branchIndex = headerIndex(['branch', 'brand', 'assignedbranchaccess'], 4)
  const departmentIndex = headerIndex(['department', 'dept'], 5)
  const branchRoleIndex = headerIndex(['branchmodulerole', 'branchrole', 'modulerole'], 6)

  return dataLines.map((line) => {
    const cells = parseDelimitedLine(line)
    const brand = normalizeBranch(cells[branchIndex] || '')
    const branchModuleRole = normalizeBranchModuleRole(cells[branchRoleIndex] || '')

    return {
      fullName: cells[fullNameIndex] || '',
      email: (cells[emailIndex] || '').trim().toLowerCase(),
      password: cells[passwordIndex] || '',
      role: normalizeRole(cells[roleIndex] || ''),
      brand,
      department: cells[departmentIndex] || '',
      branchModuleRole: canUseBranchModuleAccessRole(brand) ? branchModuleRole : 'inherit',
    }
  })
}

function worksheetRowsToDelimitedText(rows: unknown[][]) {
  return rows
    .map((row) => row
      .map((cell) => {
        const value = String(cell ?? '').trim()
        return value.includes('\t') || value.includes('"') || value.includes(',')
          ? `"${value.replace(/"/g, '""')}"`
          : value
      })
      .join('\t'))
    .join('\n')
}

const BULK_USER_SAMPLE = `fullName,email,password,role,branch,department,branchModuleRole
Rupali Sharma,rupali@example.com,User@123456,manager,kia,Sales,branch_sales
Ankit Kumar,ankit@example.com,User@123456,viewer,kia,Service,branch_service`

export default function AdminUsersPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isBulkCreateDialogOpen, setIsBulkCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkInput, setBulkInput] = useState('')
  const [bulkImportFileName, setBulkImportFileName] = useState('')
  const [bulkResults, setBulkResults] = useState<BulkCreateResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [branchFilter, setBranchFilter] = useState<string>('any')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [users, setUsers] = useState<User[]>([])
  const [fetchingUsers, setFetchingUsers] = useState(true)
  const [pagination, setPagination] = useState<UsersPagination>(DEFAULT_PAGINATION)
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [summary, setSummary] = useState<UsersSummary>({
    totalUsers: 0,
    admins: 0,
    managers: 0,
    active: 0,
  })
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([])
  const { userRole } = useUserRole()

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
    department: '',
    branchModuleRole: 'inherit' as BranchModuleAccessRoleValue,
  })

  const [editFormData, setEditFormData] = useState({
    id: '',
    email: '',
    fullName: '',
    role: 'viewer' as UserRole,
    brand: '',
    department: '',
    branchModuleRole: BRANCH_MODULE_ACCESS_ROLE_KEEP as BranchModuleAccessRoleEditValue,
    isActive: true
  })

  const pageNumbers = useMemo(() => {
    const totalPages = pagination.totalPages || 1
    const start = Math.max(1, pagination.page - 2)
    const end = Math.min(totalPages, start + 4)
    return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  }, [pagination.page, pagination.totalPages])

  const bulkUsers = useMemo(() => parseBulkUsersInput(bulkInput), [bulkInput])

  const validBulkUsers = useMemo(() => (
    bulkUsers.filter((user) => user.fullName && user.email && user.password && user.role)
  ), [bulkUsers])

  const handleBulkCreateUsers = async (event: React.FormEvent) => {
    event.preventDefault()

    if (validBulkUsers.length === 0) {
      alert('Paste at least one valid user row before creating.')
      return
    }

    if (bulkUsers.length > 50) {
      alert('Bulk create supports up to 50 users at a time.')
      return
    }

    setBulkLoading(true)
    setBulkResults([])

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulkUsers: validBulkUsers }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok && !payload?.results) {
        alert(`Error: ${payload?.error || 'Failed to create users in bulk'}`)
        return
      }

      setBulkResults(payload?.results || [])

      if ((payload?.created || 0) > 0) {
        void fetchUsers()
      }
    } catch (error) {
      console.error('Error bulk creating users:', error)
      alert('Failed to create users in bulk')
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkExcelUpload = async (file: File | null) => {
    if (!file) return

    setBulkResults([])
    setBulkImportFileName(file.name)

    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]

      if (!firstSheetName) {
        alert('This Excel file does not contain any sheets.')
        return
      }

      const worksheet = workbook.Sheets[firstSheetName]
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: '',
        blankrows: false,
        raw: false,
      })

      const usableRows = rows.filter((row) => row.some((cell) => String(cell ?? '').trim()))

      if (usableRows.length === 0) {
        alert('No user rows found in the uploaded Excel file.')
        return
      }

      setBulkInput(worksheetRowsToDelimitedText(usableRows))
    } catch (error) {
      console.error('Error reading bulk user Excel file:', error)
      alert('Could not read this Excel file. Please upload a valid .xlsx, .xls, or .csv file.')
    }
  }

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
        const payload = await response.json().catch(() => null)
        setFormData({
          email: '',
          fullName: '',
          password: '',
          role: 'viewer',
          brand: '',
          department: '',
          branchModuleRole: 'inherit',
        })
        setShowCreatePassword(false)
        alert(payload?.permissionWarning || 'User created successfully!')
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
      branchModuleRole: BRANCH_MODULE_ACCESS_ROLE_KEEP,
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
        const payload = await response.json().catch(() => null)
        setIsEditDialogOpen(false)
        alert(payload?.permissionWarning || 'User updated successfully!')
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
      case 'finance_head':
        return 'bg-violet-600 text-white'
      case 'ceo':
        return 'bg-slate-950 text-white'
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

          <div className="flex flex-wrap items-center justify-end gap-3">
          <Dialog
            open={isBulkCreateDialogOpen}
            onOpenChange={(open) => {
              setIsBulkCreateDialogOpen(open)
              if (!open) setBulkResults([])
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-xl border-[#023468] bg-white font-bold text-[#023468] shadow-lg hover:bg-[#edf4fb]">
                <ClipboardList className="mr-2 h-4 w-4" />
                Bulk Create Users
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-auto rounded-2xl bg-white sm:max-w-[980px]">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black text-slate-800">Bulk Create Users</DialogTitle>
                <DialogDescription className="text-slate-500 font-semibold">
                  Upload Excel or paste rows. Required columns: fullName, email, password, role, branch, department, branchModuleRole.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleBulkCreateUsers} className="mt-4 space-y-4">
                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-2">
                    <div className="rounded-2xl border border-[#023468]/20 bg-[#edf4fb] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest text-[#023468]">Excel Upload</p>
                          <p className="mt-1 text-xs font-semibold text-slate-600">
                            First sheet will be used. Header names can match the same CSV fields.
                          </p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center rounded-xl bg-[#023468] px-4 py-2 text-sm font-black text-white shadow-lg hover:bg-[#062b55]">
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Excel
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            onChange={(event) => {
                              void handleBulkExcelUpload(event.target.files?.[0] || null)
                              event.target.value = ''
                            }}
                          />
                        </label>
                      </div>
                      {bulkImportFileName && (
                        <p className="mt-3 rounded-lg border border-white bg-white px-3 py-2 text-xs font-bold text-slate-700">
                          Loaded file: <span className="text-[#023468]">{bulkImportFileName}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="bulk-users" className="text-sm font-bold text-slate-700">User Rows</Label>
                      <button
                        type="button"
                        onClick={() => setBulkInput(BULK_USER_SAMPLE)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-[#023468] hover:bg-[#edf4fb]"
                      >
                        Use sample
                      </button>
                    </div>
                    <textarea
                      id="bulk-users"
                      value={bulkInput}
                      onChange={(event) => {
                        setBulkInput(event.target.value)
                        setBulkResults([])
                      }}
                      placeholder={BULK_USER_SAMPLE}
                      className="min-h-[260px] w-full rounded-2xl border border-slate-200 bg-white p-4 font-mono text-xs font-semibold text-slate-800 outline-none transition focus:border-[#023468] focus:ring-4 focus:ring-[#edf4fb]"
                    />
                    <p className="text-xs font-semibold text-slate-500">
                      Branch role is optional. Valid examples: branch_sales, branch_service, branch_proforma_approver, branch_admin.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Preview</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rows Parsed</p>
                        <p className="mt-1 text-2xl font-black text-slate-900">{bulkUsers.length}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ready</p>
                        <p className="mt-1 text-2xl font-black text-[#023468]">{validBulkUsers.length}</p>
                      </div>
                    </div>
                    <div className="mt-4 max-h-[260px] overflow-auto rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-white">
                          <tr>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Name</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Email</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Role</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Branch</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkUsers.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-3 py-8 text-center font-bold text-slate-400">Paste rows to preview users.</td>
                            </tr>
                          ) : bulkUsers.slice(0, 12).map((user, index) => (
                            <tr key={`${user.email || index}-${index}`} className="border-b border-slate-100">
                              <td className="px-3 py-2 font-bold text-slate-800">{user.fullName || '-'}</td>
                              <td className="px-3 py-2 font-semibold text-slate-600">{user.email || '-'}</td>
                              <td className="px-3 py-2 font-semibold text-slate-600">{user.role}</td>
                              <td className="px-3 py-2 font-semibold text-slate-600">{getUserBranchLabel(user.brand)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {bulkUsers.length > 12 && (
                      <p className="mt-2 text-xs font-bold text-slate-500">Showing first 12 rows in preview.</p>
                    )}
                  </div>
                </div>

                {bulkResults.length > 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-500">Bulk Create Results</p>
                    <div className="mt-3 max-h-[220px] overflow-auto rounded-xl border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-950 text-white">
                          <tr>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">User</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Email</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Status</th>
                            <th className="px-3 py-2 font-black uppercase tracking-widest">Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkResults.map((result) => (
                            <tr key={`${result.email}-${result.index}`} className="border-b border-slate-100">
                              <td className="px-3 py-2 font-bold text-slate-800">{result.fullName || '-'}</td>
                              <td className="px-3 py-2 font-semibold text-slate-600">{result.email || '-'}</td>
                              <td className="px-3 py-2">
                                <Badge className={result.status === 'created' ? 'bg-[#edf4fb] text-[#023468]' : 'bg-rose-50 text-rose-700'}>
                                  {result.status}
                                </Badge>
                              </td>
                              <td className="px-3 py-2 font-semibold text-slate-600">{result.error || result.permissionWarning || 'Done'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsBulkCreateDialogOpen(false)}
                    className="flex-1 rounded-xl border-slate-200 bg-white"
                  >
                    Close
                  </Button>
                  <Button
                    type="submit"
                    disabled={bulkLoading || validBulkUsers.length === 0}
                    className="app-primary-action flex-1 rounded-xl"
                  >
                    {bulkLoading ? 'Creating users...' : `Create ${validBulkUsers.length || ''} Users`}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={(open) => {
              setIsCreateDialogOpen(open)
              if (!open) setShowCreatePassword(false)
            }}
          >
            <DialogTrigger asChild>
              <Button className="app-primary-action rounded-xl font-bold shadow-lg">
                <UserPlus className="mr-2 h-4 w-4" />
                Create New User
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px] rounded-2xl bg-white">
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
                  <div className="space-y-2 relative">
                    <Label htmlFor="password" className="text-sm font-bold text-slate-700">Password</Label>
                    <Input
                      id="password"
                      type={showCreatePassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                      className="rounded-xl border-slate-200 pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePassword((current) => !current)}
                      className="absolute right-3 top-[2.35rem] rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                      aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      title={showCreatePassword ? 'Hide password' : 'Show password'}
                    >
                      {showCreatePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role" className="text-sm font-bold text-slate-700">Role</Label>
                    <Select value={formData.role} onValueChange={(value: UserRole) => setFormData({ ...formData, role: value })}>
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
                        {USER_ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role.value} value={role.value} className="bg-white hover:bg-slate-50">
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brand" className="text-sm font-bold text-slate-700">Assigned Branch Access</Label>
                    <Select
                      value={formData.brand}
                      onValueChange={(value: UserBranchValue) => setFormData({
                        ...formData,
                        brand: value,
                        branchModuleRole: canUseBranchModuleAccessRole(value) ? formData.branchModuleRole : 'inherit',
                      })}
                    >
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select branch access" />
                      </SelectTrigger>
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
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
                {canUseBranchModuleAccessRole(formData.brand) && (
                  <div className="space-y-2 rounded-2xl border border-[#b9ccde] bg-[#edf4fb]/60 p-3">
                    <Label htmlFor="branchModuleRole" className="text-sm font-bold text-slate-700">Branch Role</Label>
                    <Select
                      value={formData.branchModuleRole}
                      onValueChange={(value: BranchModuleAccessRoleValue) => setFormData({ ...formData, branchModuleRole: value })}
                    >
                      <SelectTrigger className="rounded-xl border-[#b9ccde] bg-white">
                      <SelectValue placeholder="Select role inside this branch" />
                      </SelectTrigger>
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
                        {BRANCH_MODULE_ACCESS_ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="bg-white hover:bg-slate-50">
                            <div className="flex flex-col">
                              <span>{option.label}</span>
                              <span className="text-[10px] font-semibold text-slate-400">{option.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs font-semibold text-slate-500">
                      Applies this role only inside the selected branch. Global roles like MD, CEO, and EA still keep their global access.
                    </p>
                  </div>
                )}
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
            <DialogContent className="sm:max-w-[560px] rounded-2xl bg-white">
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
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
                        {USER_ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role.value} value={role.value} className="bg-white hover:bg-slate-50">
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-brand" className="text-sm font-bold text-slate-700">Assigned Branch Access</Label>
                    <Select
                      value={editFormData.brand}
                      onValueChange={(value: UserBranchValue) => setEditFormData({
                        ...editFormData,
                        brand: value,
                        branchModuleRole: canUseBranchModuleAccessRole(value)
                          ? editFormData.branchModuleRole
                          : BRANCH_MODULE_ACCESS_ROLE_KEEP,
                      })}
                    >
                      <SelectTrigger className="rounded-xl border-slate-200 bg-white">
                        <SelectValue placeholder="Select branch access" />
                      </SelectTrigger>
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
                        {USER_BRANCH_OPTIONS.map((branch) => (
                          <SelectItem key={branch.value} value={branch.value} className="bg-white hover:bg-slate-50">
                            {branch.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {canUseBranchModuleAccessRole(editFormData.brand) && (
                  <div className="space-y-2 rounded-2xl border border-[#b9ccde] bg-[#edf4fb]/60 p-3">
                    <Label htmlFor="edit-branchModuleRole" className="text-sm font-bold text-slate-700">Branch Role</Label>
                    <Select
                      value={editFormData.branchModuleRole}
                      onValueChange={(value: BranchModuleAccessRoleEditValue) => setEditFormData({ ...editFormData, branchModuleRole: value })}
                    >
                      <SelectTrigger className="rounded-xl border-[#b9ccde] bg-white">
                      <SelectValue placeholder="Select role inside this branch" />
                      </SelectTrigger>
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
                        {BRANCH_MODULE_ACCESS_ROLE_EDIT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value} className="bg-white hover:bg-slate-50">
                            <div className="flex flex-col">
                              <span>{option.label}</span>
                              <span className="text-[10px] font-semibold text-slate-400">{option.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs font-semibold text-slate-500">
                      Choose a branch-only role preset, or keep current overrides unchanged.
                    </p>
                  </div>
                )}
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
                      <SelectContent {...USER_MODAL_SELECT_CONTENT_PROPS}>
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
                          <div className="admin-user-avatar">
                            {(user.fullName || user.email || '?').charAt(0).toUpperCase()}
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
                          {userRole === 'admin' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(`/admin/permissions?user=${user.id}`, '_blank', 'noopener,noreferrer')}
                              className="h-8 w-8 p-0 hover:bg-[#edf4fb] hover:text-[#023468] rounded-lg"
                              title="Manage permissions"
                            >
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}
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
