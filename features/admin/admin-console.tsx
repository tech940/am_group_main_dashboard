'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  UserCog,
  Users,
  Wrench,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { BRANCH_OPTIONS, USER_BRANCH_OPTIONS } from '@/lib/branches'
import { cn } from '@/lib/utils'

type Capabilities = {
  authority: 'super_admin' | 'branch_admin'
  branch: string | null
  canManageSettings: boolean
  canManageBranchAdmins: boolean
  canPermanentlyDelete: boolean
  assignableRoles: string[]
}

type ManagedUser = {
  id: string
  email: string
  fullName: string
  role: string
  brand: string | null
  department: string | null
  phoneNumber: string | null
  isActive: boolean
  updatedAt: string
  capabilities: {
    canManage: boolean
    canChangePermissions: boolean
    managedBySuperAdmin: boolean
  }
}

type UsersResponse = {
  users: ManagedUser[]
  actorCapabilities: Capabilities
  summary: {
    totalUsers: number
    administrators: number
    managers: number
    active: number
    inactive: number
  }
}

type PermissionResponse = {
  users: Array<ManagedUser & { branchLabel: string; canManage: boolean }>
  selectedUser: (ManagedUser & { canManage: boolean }) | null
  groups: Array<{ key: string; name: string; parentKey: string | null; description: string }>
  permissions: Array<{ key: string; groupKey: string; label: string; action: string }>
  snapshot: {
    effective: Record<string, boolean>
    roleDefaults: Record<string, boolean>
    overrides: Record<string, boolean>
  }
  actorCapabilities: Capabilities
}

type OverviewResponse = {
  actorCapabilities: Capabilities
  summary: {
    totalUsers: number
    activeUsers: number
    inactiveUsers: number
    administrators: number
    protectedUsers: number
    permissionExceptions: number
  }
  branches: Array<{ branch: string | null; total: number; active: number }>
  recentActivity: Array<{ id: string; action: string; branch: string | null; createdAt: string }>
}

type AuditResponse = {
  actorCapabilities: Capabilities
  source?: 'admin' | 'kia'
  entries: Array<{
    id: string
    action: string
    branch: string | null
    reason: string | null
    createdAt: string
    actor: { fullName: string } | null
    target: { fullName: string } | null
  }>
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  branch_admin: 'Branch Admin',
  admin: 'Legacy Admin',
  ceo: 'CEO',
  md: 'MD',
  ea: 'EA',
  accounts: 'Accounts',
  purchase_manager: 'Purchase Manager',
  finance_head: 'Finance Head',
  manager: 'Manager',
  technician: 'Technician',
  viewer: 'Employee / Viewer',
  service_manager: 'Service Manager',
  general_manager: 'General Manager',
  sales_head: 'Sales Head',
}

const TAB_DEFINITIONS: Array<{
  key: 'overview' | 'users' | 'branch-admins' | 'access' | 'audit' | 'system' | 'settings'
  label: string
  icon: typeof Users
  superOnly?: boolean
}> = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'branch-admins', label: 'Branch Admins', icon: UserCog, superOnly: true },
  { key: 'access', label: 'Access', icon: KeyRound },
  { key: 'audit', label: 'Audit', icon: ShieldCheck },
  { key: 'system', label: 'System', icon: Wrench, superOnly: true },
  { key: 'settings', label: 'Settings', icon: Settings, superOnly: true },
]

function branchLabel(branch: string | null) {
  if (!branch) return 'Unassigned'
  if (branch === 'all') return 'All Branches'
  if (branch.includes(',')) {
    return branch
      .split(',')
      .map((b) => BRANCH_OPTIONS.find((item) => item.value === b.trim())?.label || b)
      .join(', ')
  }
  return BRANCH_OPTIONS.find((item) => item.value === branch)?.label || 'Unassigned'
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Users }) {
  return (
    <Card className="border-slate-200/80 bg-white/85 shadow-sm">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-black text-slate-950">{value}</p>
        </div>
        <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700"><Icon className="h-5 w-5" /></div>
      </CardContent>
    </Card>
  )
}

function BranchSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const currentValues = value ? value.split(',').map((v) => v.trim()) : [];
  const isAll = currentValues.includes('all');

  const toggleBranch = (branchVal: string) => {
    if (branchVal === 'all') {
      onChange('all');
      return;
    }

    let nextValues = isAll ? [] : [...currentValues];
    if (nextValues.includes(branchVal)) {
      nextValues = nextValues.filter((v) => v !== branchVal);
    } else {
      nextValues.push(branchVal);
    }

    if (nextValues.length === 0) {
      onChange('');
    } else if (nextValues.length === BRANCH_OPTIONS.length) {
      onChange('all');
    } else {
      onChange(nextValues.join(','));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3 bg-slate-50">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <input
          type="checkbox"
          id="branch-all"
          checked={isAll}
          onChange={() => toggleBranch('all')}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <label htmlFor="branch-all" className="text-xs font-semibold text-slate-700">All Branches</label>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {BRANCH_OPTIONS.map((branch) => {
          const checked = isAll || currentValues.includes(branch.value);
          return (
            <div key={branch.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`branch-${branch.value}`}
                checked={checked}
                disabled={isAll}
                onChange={() => toggleBranch(branch.value)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <label htmlFor={`branch-${branch.value}`} className="text-xs text-slate-600 font-medium">{branch.label}</label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminConsole() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab') || 'overview'
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  const [usersData, setUsersData] = useState<UsersResponse | null>(null)
  const [permissionsData, setPermissionsData] = useState<PermissionResponse | null>(null)
  const [auditData, setAuditData] = useState<AuditResponse | null>(null)
  const [auditSource, setAuditSource] = useState<'admin' | 'kia'>('admin')
  const [systemCounts, setSystemCounts] = useState<{ bookings: number; activity: number; allocations: number; transfers: number; retailMarks: number } | null>(null)
  const [emailLogs, setEmailLogs] = useState<{
    counts: { pending: number; sent: number; failed: number; total: number }
    last24h: { total: number; failed: number }
    rows: Array<{ id: string; customerEmail: string; subject: string; emailType: string | null; status: string; error: string | null; sentAt: string | null; createdAt: string }>
  } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [settingsData, setSettingsData] = useState<Record<string, unknown> | null>(null)
  const [settingsText, setSettingsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState(1)
  const [createForm, setCreateForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'viewer',
    brand: '',
    department: '',
  })
  const [saving, setSaving] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get('user') || '')
  const [permissionChanges, setPermissionChanges] = useState<Record<string, boolean | null>>({})
  const [editUser, setEditUser] = useState<ManagedUser | null>(null)
  const [editForm, setEditForm] = useState({ fullName: '', email: '', password: '', role: '', brand: '', department: '', phoneNumber: '' })

  const activeTab = useMemo(() => {
    const definition = TAB_DEFINITIONS.find((item) => item.key === requestedTab)
    if (!definition) return 'overview'
    if (definition.superOnly && capabilities?.authority !== 'super_admin') return 'overview'
    return definition.key
  }, [requestedTab, capabilities])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const endpoint = activeTab === 'overview'
        ? '/api/admin/overview'
        : activeTab === 'users' || activeTab === 'branch-admins'
          ? '/api/admin/users?pageSize=100'
          : activeTab === 'access'
            ? `/api/admin/permissions${selectedUserId ? `?userId=${selectedUserId}` : ''}`
            : activeTab === 'audit'
              ? `/api/admin/audit?pageSize=50&source=${auditSource}`
              : activeTab === 'system'
                ? '/api/admin/reset-test-data'
                : '/api/admin/settings'
      const response = await fetch(endpoint, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to load the Admin Console.')

      if (activeTab === 'overview') {
        setOverview(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'users' || activeTab === 'branch-admins') {
        setUsersData(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'access') {
        setPermissionsData(payload)
        setCapabilities(payload.actorCapabilities)
        setSelectedUserId(payload.selectedUser?.id || '')
        setPermissionChanges({})
      } else if (activeTab === 'audit') {
        setAuditData(payload)
        setCapabilities(payload.actorCapabilities)
      } else if (activeTab === 'system') {
        setSystemCounts(payload.counts)
        const emailResponse = await fetch('/api/admin/email-logs', { cache: 'no-store' })
        if (emailResponse.ok) setEmailLogs(await emailResponse.json())
      } else {
        setSettingsData(payload)
        setSettingsText(JSON.stringify(payload, null, 2))
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load the Admin Console.')
    } finally {
      setLoading(false)
    }
  }, [activeTab, selectedUserId, auditSource])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const visibleTabs = TAB_DEFINITIONS.filter((tab) => !tab.superOnly || capabilities?.authority === 'super_admin')
  const filteredUsers = (usersData?.users || []).filter((user) => {
    if (activeTab === 'branch-admins' && user.role !== 'branch_admin') return false
    const query = search.trim().toLowerCase()
    return !query || `${user.fullName} ${user.email} ${user.role} ${user.brand}`.toLowerCase().includes(query)
  })

  async function createUser() {
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          brand: capabilities?.authority === 'branch_admin' ? capabilities.branch : createForm.brand,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to create user.')
      setCreateOpen(false)
      setCreateStep(1)
      setCreateForm({ fullName: '', email: '', password: '', role: 'viewer', brand: '', department: '' })
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to create user.')
    } finally {
      setSaving(false)
    }
  }

  async function setUserActive(user: ManagedUser, isActive: boolean) {
    setSaving(true)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive, expectedUpdatedAt: user.updatedAt }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to update user.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update user.')
    } finally {
      setSaving(false)
    }
  }

  function openEditUser(user: ManagedUser) {
    setEditUser(user)
    setEditForm({
      fullName: user.fullName,
      email: user.email,
      password: '',
      role: user.role,
      brand: user.brand || '',
      department: user.department || '',
      phoneNumber: user.phoneNumber || '',
    })
  }

  async function updateUser() {
    if (!editUser) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editUser.id,
          expectedUpdatedAt: editUser.updatedAt,
          fullName: editForm.fullName,
          department: editForm.department,
          phoneNumber: editForm.phoneNumber,
          ...(capabilities?.authority === 'super_admin' ? {
            role: editForm.role,
            brand: editForm.brand,
            email: editForm.email,
            ...(editForm.password ? { password: editForm.password } : {}),
          } : {}),
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to update user.')
      setEditUser(null)
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update user.')
    } finally {
      setSaving(false)
    }
  }

  async function permanentlyDeleteUser(user: ManagedUser) {
    if (!window.confirm(`Permanently delete ${user.fullName}? This cannot be undone.`)) return
    setSaving(true)
    try {
      const response = await fetch(`/api/admin/users?id=${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to permanently delete user.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to permanently delete user.')
    } finally {
      setSaving(false)
    }
  }

  async function savePermissions() {
    if (!permissionsData?.selectedUser || !Object.keys(permissionChanges).length) return
    setSaving(true)
    try {
      const response = await fetch('/api/admin/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: permissionsData.selectedUser.id,
          permissions: permissionChanges,
          reason: 'Updated from hierarchical Admin Console',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to save permissions.')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save permissions.')
    } finally {
      setSaving(false)
    }
  }

  async function resetTestData() {
    const c = systemCounts
    const summary = c ? `${c.bookings} bookings, ${c.allocations} allocations, ${c.transfers} transfers, ${c.retailMarks} retail markers` : 'all test bookings and allocations'
    if (!window.confirm(`Reset test data?\n\nThis permanently deletes:\n• ${summary}\n\nProformas, users and real inventory are NOT touched. A record is written to the audit log. This cannot be undone.`)) return
    setResetting(true)
    setError('')
    try {
      const response = await fetch('/api/admin/reset-test-data', { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to reset test data.')
      setSystemCounts(payload.counts)
      window.alert(`Test data reset. Removed ${payload.removed.bookings} bookings, ${payload.removed.allocations} allocations, ${payload.removed.transfers} transfers and ${payload.removed.retailMarks} retail markers.`)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset test data.')
    } finally {
      setResetting(false)
    }
  }

  async function saveSettings() {
    if (!settingsText) return
    setSaving(true)
    try {
      const parsedSettings = JSON.parse(settingsText) as Record<string, unknown>
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: parsedSettings }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to save settings.')
      setSettingsData(parsedSettings)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <MainLayout title="Admin Console" subtitle={capabilities?.authority === 'branch_admin' ? `${branchLabel(capabilities.branch)} administration` : 'Group-wide access governance'}>
      <div className="mx-auto max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-sm backdrop-blur">
          <div className="flex flex-wrap gap-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <Button
                  key={tab.key}
                  variant="ghost"
                  onClick={() => router.replace(`/admin?tab=${tab.key}`)}
                  className={cn(
                    'gap-2 rounded-xl',
                    activeTab === tab.key ? 'bg-slate-950 text-white hover:bg-slate-800 hover:text-white' : 'text-slate-600'
                  )}
                >
                  <Icon className="h-4 w-4" /> {tab.label}
                </Button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 px-2">
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
              {capabilities?.authority === 'branch_admin' ? 'Branch Admin' : 'Super Admin'}
            </Badge>
            <Button variant="ghost" size="icon" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>
        ) : (
          <>
            {activeTab === 'overview' && overview && (
              <div className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard label="Users" value={overview.summary.totalUsers} icon={Users} />
                  <StatCard label="Active" value={overview.summary.activeUsers} icon={Check} />
                  <StatCard label="Inactive" value={overview.summary.inactiveUsers} icon={Activity} />
                  <StatCard label="Administrators" value={overview.summary.administrators} icon={Shield} />
                  <StatCard label="Permission Exceptions" value={overview.summary.permissionExceptions} icon={KeyRound} />
                </div>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card>
                    <CardHeader><CardTitle>Branch Distribution</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {overview.branches.map((row) => (
                        <div key={row.branch || 'none'} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                          <span className="font-semibold text-slate-700">{branchLabel(row.branch)}</span>
                          <span className="text-sm text-slate-500">{row.active} active / {row.total} total</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle>Recent Administrative Activity</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {overview.recentActivity.length ? overview.recentActivity.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-slate-100 px-4 py-3">
                          <p className="font-semibold text-slate-800">{entry.action}</p>
                          <p className="mt-1 text-xs text-slate-500">{branchLabel(entry.branch)} · {new Date(entry.createdAt).toLocaleString()}</p>
                        </div>
                      )) : <p className="text-sm text-slate-500">No administrative activity recorded yet.</p>}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {(activeTab === 'users' || activeTab === 'branch-admins') && usersData && (
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div>
                    <CardTitle>{activeTab === 'branch-admins' ? 'Branch Administrators' : 'Users'}</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">Authority is enforced by the server for every action.</p>
                  </div>
                  <Button onClick={() => {
                    setCreateForm((current) => ({
                      ...current,
                      role: activeTab === 'branch-admins'
                        ? 'branch_admin'
                        : (usersData.actorCapabilities.assignableRoles.includes('viewer') ? 'viewer' : usersData.actorCapabilities.assignableRoles[0] || 'viewer'),
                      brand: capabilities?.branch || '',
                    }))
                    setCreateOpen(true)
                  }} className="gap-2">
                    <Plus className="h-4 w-4" /> Add {activeTab === 'branch-admins' ? 'Branch Admin' : 'User'}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 flex max-w-md items-center gap-2 rounded-xl border bg-white px-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users..." className="border-0 shadow-none focus-visible:ring-0" />
                  </div>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                        <tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Branch</th><th className="p-3">Department</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredUsers.map((user) => (
                          <tr key={user.id} className="hover:bg-slate-50/70">
                            <td className="p-3"><p className="font-semibold text-slate-900">{user.fullName}</p><p className="text-xs text-slate-500">{user.email}</p></td>
                            <td className="p-3"><Badge variant="outline">{ROLE_LABELS[user.role] || user.role}</Badge></td>
                            <td className="p-3">{branchLabel(user.brand)}</td>
                            <td className="p-3 text-slate-600">{user.department || '-'}</td>
                            <td className="p-3"><Badge className={user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}>{user.isActive ? 'Active' : 'Inactive'}</Badge></td>
                            <td className="p-3 text-right">
                              {user.capabilities.canManage ? (
                                <div className="flex justify-end gap-2">
                                  <Button size="sm" variant="outline" disabled={saving} onClick={() => openEditUser(user)}>Edit</Button>
                                  <Button size="sm" variant="outline" disabled={saving} onClick={() => void setUserActive(user, !user.isActive)}>
                                    {user.isActive ? 'Deactivate' : 'Reactivate'}
                                  </Button>
                                  {capabilities?.canPermanentlyDelete && (
                                    <Button size="sm" variant="outline" className="text-red-600" disabled={saving} onClick={() => void permanentlyDeleteUser(user)}>Delete</Button>
                                  )}
                                </div>
                              ) : <span className="text-xs font-medium text-slate-400">Managed by Super Admin</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'access' && permissionsData && (
              <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
                <Card>
                  <CardHeader><CardTitle>Select User</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    {permissionsData.users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => setSelectedUserId(user.id)}
                        className={cn('w-full rounded-xl border p-3 text-left transition', selectedUserId === user.id ? 'border-indigo-400 bg-indigo-50' : 'hover:bg-slate-50')}
                      >
                        <p className="font-semibold text-slate-900">{user.fullName}</p>
                        <p className="text-xs text-slate-500">{ROLE_LABELS[user.role] || user.role} · {user.branchLabel}</p>
                      </button>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <div>
                      <CardTitle>{permissionsData.selectedUser?.fullName || 'Access Editor'}</CardTitle>
                      <p className="mt-1 text-sm text-slate-500">Inherited, explicit, and unavailable access is resolved server-side.</p>
                    </div>
                    <Button disabled={saving || !permissionsData.selectedUser?.canManage || !Object.keys(permissionChanges).length} onClick={() => void savePermissions()}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Access
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!permissionsData.selectedUser?.canManage && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">Managed by Super Admin. Access is read-only.</div>
                    )}
                    {permissionsData.groups.map((group) => {
                      const groupPermissions = permissionsData.permissions.filter((permission) => permission.groupKey === group.key)
                      if (!groupPermissions.length) return null
                      return (
                        <div key={group.key} className="rounded-xl border p-4">
                          <div className="mb-3"><p className="font-bold text-slate-900">{group.name}</p><p className="text-xs text-slate-500">{group.description}</p></div>
                          <div className="flex flex-wrap gap-3">
                            {groupPermissions.map((permission) => {
                              const value = permission.key in permissionChanges
                                ? permissionChanges[permission.key] === true
                                : permissionsData.snapshot.effective[permission.key] === true
                              const inherited = !(permission.key in permissionsData.snapshot.overrides)
                              return (
                                <label key={permission.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                  <Checkbox
                                    checked={value}
                                    disabled={!permissionsData.selectedUser?.canManage}
                                    onCheckedChange={(checked) => setPermissionChanges((current) => ({ ...current, [permission.key]: checked === true }))}
                                  />
                                  <span className="capitalize">{permission.action}</span>
                                  <span className="text-[10px] uppercase text-slate-400">{inherited ? 'inherited' : 'explicit'}</span>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'audit' && auditData && (
              <Card>
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle>{auditSource === 'kia' ? 'KIA Booking Activity' : 'Administrative Audit'}</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">
                      {auditSource === 'kia'
                        ? 'Every booking lifecycle event — created, allocated, approved, payment confirmed, delivered.'
                        : 'User, permission and maintenance actions across the console.'}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg border border-slate-200 p-1">
                    {([['admin', 'Admin actions'], ['kia', 'Booking activity']] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAuditSource(value)}
                        className={cn(
                          'rounded-md px-3 py-1.5 text-xs font-bold transition',
                          auditSource === value ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">{auditSource === 'kia' ? 'Booking / Customer' : 'Target'}</th><th className="p-3">Branch</th><th className="p-3">{auditSource === 'kia' ? 'Detail' : 'Reason'}</th></tr></thead>
                      <tbody className="divide-y">
                        {auditData.entries.length === 0 && (
                          <tr><td colSpan={6} className="p-6 text-center text-slate-400">No entries yet.</td></tr>
                        )}
                        {auditData.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td className="p-3 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                            <td className="p-3 font-medium">{entry.actor?.fullName || 'System'}</td>
                            <td className="p-3"><Badge variant="outline">{entry.action}</Badge></td>
                            <td className="p-3">{entry.target?.fullName || '-'}</td>
                            <td className="p-3">{branchLabel(entry.branch)}</td>
                            <td className="p-3 text-slate-500">{entry.reason || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'system' && (
              <Card>
                <CardHeader>
                  <CardTitle>Maintenance · Reset Test Data</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">Super-Admin-only. Wipes KIA test bookings and their allocations/transfers/activity, and clears the &lsquo;retail&rsquo; stock markers created while testing (returning those vehicles to available stock). Proformas, users, permissions and real inventory are not touched.</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    {[
                      { label: 'Bookings', value: systemCounts?.bookings },
                      { label: 'Activity log', value: systemCounts?.activity },
                      { label: 'Allocations', value: systemCounts?.allocations },
                      { label: 'Transfers', value: systemCounts?.transfers },
                      { label: 'Retail markers', value: systemCounts?.retailMarks },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                        <p className="text-2xl font-black text-slate-900">{item.value ?? '—'}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <div className="flex-1 min-w-[240px] text-sm font-semibold text-rose-800">
                      This is destructive and cannot be undone. A snapshot of the counts is written to the audit log.
                    </div>
                    <Button variant="destructive" onClick={() => void resetTestData()} disabled={resetting || !systemCounts}>
                      {resetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
                      Reset Test Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'system' && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>Email Delivery</CardTitle>
                    <p className="mt-1 text-sm text-slate-500">Every proforma-approval and quote email is logged here. Watch for failures so a bounced customer email doesn&rsquo;t go unnoticed.</p>
                  </div>
                  {emailLogs && emailLogs.last24h.failed > 0 && (
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">{emailLogs.last24h.failed} failed in last 24h</span>
                  )}
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Sent', value: emailLogs?.counts.sent, cls: 'text-emerald-600' },
                      { label: 'Failed', value: emailLogs?.counts.failed, cls: 'text-rose-600' },
                      { label: 'Pending', value: emailLogs?.counts.pending, cls: 'text-amber-600' },
                      { label: 'Total', value: emailLogs?.counts.total, cls: 'text-slate-900' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                        <p className={cn('text-2xl font-black', item.cls)}>{item.value ?? '—'}</p>
                        <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="bg-slate-100 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Recipient</th>
                          <th className="px-3 py-2">Subject</th>
                          <th className="px-3 py-2">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(emailLogs?.rows || []).slice(0, 30).map((row) => (
                          <tr key={row.id} className="border-t border-slate-100 align-top">
                            <td className="px-3 py-2">
                              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-black uppercase',
                                row.status === 'sent' ? 'bg-emerald-50 text-emerald-700'
                                  : row.status === 'failed' ? 'bg-rose-50 text-rose-700'
                                    : 'bg-amber-50 text-amber-700')}>{row.status}</span>
                            </td>
                            <td className="px-3 py-2 font-semibold text-slate-600">{row.emailType || '—'}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800">{row.customerEmail}</td>
                            <td className="px-3 py-2 text-slate-600">
                              <div className="max-w-[280px] truncate">{row.subject}</div>
                              {row.error && <div className="mt-0.5 max-w-[280px] truncate text-[11px] font-semibold text-rose-600" title={row.error}>{row.error}</div>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-500">{new Date(row.sentAt || row.createdAt).toLocaleString()}</td>
                          </tr>
                        ))}
                        {!emailLogs?.rows.length && (
                          <tr><td colSpan={5} className="px-3 py-8 text-center font-semibold text-slate-400">No emails logged yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'settings' && settingsData && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div><CardTitle>System Settings</CardTitle><p className="mt-1 text-sm text-slate-500">Super-Admin-only dashboard configuration.</p></div>
                  <Button onClick={() => void saveSettings()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Settings</Button>
                </CardHeader>
                <CardContent>
                  <Textarea
                    className="min-h-[480px] font-mono text-xs"
                    value={settingsText}
                    onChange={(event) => setSettingsText(event.target.value)}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Create User · Step {createStep} of 3</DialogTitle>
            <DialogDescription>Identity, authority, and branch access are reviewed before creation.</DialogDescription>
          </DialogHeader>
          {createStep === 1 && (
            <div className="grid gap-4 py-3">
              <div><Label>Full name</Label><Input value={createForm.fullName} onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
              <div><Label>Email</Label><Input type="email" value={createForm.email} onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))} /></div>
              <div><Label>Temporary password</Label><Input type="password" value={createForm.password} onChange={(event) => setCreateForm((current) => ({ ...current, password: event.target.value }))} /></div>
            </div>
          )}
          {createStep === 2 && (
            <div className="grid gap-4 py-3 max-h-[60vh] overflow-y-auto pr-2">
              <div>
                <Label>Role</Label>
                <Select value={createForm.role} onValueChange={(value) => setCreateForm((current) => ({ ...current, role: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{capabilities?.assignableRoles.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role] || role}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block">Branch(es)</Label>
                {capabilities?.authority === 'branch_admin'
                  ? <Input value={branchLabel(capabilities.branch)} disabled />
                  : (
                    <BranchSelector value={createForm.brand} onChange={(value) => setCreateForm((current) => ({ ...current, brand: value }))} />
                  )}
              </div>
              <div><Label>Department</Label><Input value={createForm.department} onChange={(event) => setCreateForm((current) => ({ ...current, department: event.target.value }))} /></div>
            </div>
          )}
          {createStep === 3 && (
            <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
              <p><strong>{createForm.fullName}</strong> · {createForm.email}</p>
              <p>Role: <strong>{ROLE_LABELS[createForm.role] || createForm.role}</strong></p>
              <p>Branch: <strong>{branchLabel(capabilities?.authority === 'branch_admin' ? capabilities.branch : createForm.brand)}</strong></p>
              <p className="text-slate-500">The server will apply the role template and enforce branch scope. Optional access changes can be made in the Access tab.</p>
            </div>
          )}
          <div className="flex justify-between pt-2">
            <Button variant="outline" disabled={createStep === 1 || saving} onClick={() => setCreateStep((step) => step - 1)}><ChevronLeft className="mr-1 h-4 w-4" /> Back</Button>
            {createStep < 3
              ? <Button onClick={() => setCreateStep((step) => step + 1)}>Next <ChevronRight className="ml-1 h-4 w-4" /></Button>
              : <Button disabled={saving} onClick={() => void createUser()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create User</Button>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              {capabilities?.authority === 'branch_admin'
                ? 'You can update profile and lifecycle fields for ordinary users in your branch.'
                : 'Update role, branch, and profile details.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3 max-h-[60vh] overflow-y-auto pr-2">
            {capabilities?.authority === 'super_admin' ? (
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Full name</Label><Input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
                <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))} /></div>
              </div>
            ) : (
              <div><Label>Full name</Label><Input value={editForm.fullName} onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))} /></div>
            )}
            
            {capabilities?.authority === 'super_admin' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Role</Label>
                  <Select value={editForm.role} onValueChange={(value) => setEditForm((current) => ({ ...current, role: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{capabilities.assignableRoles.map((role) => <SelectItem key={role} value={role}>{ROLE_LABELS[role] || role}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>New Password (optional override)</Label>
                  <Input type="password" placeholder="Leave blank to keep current" value={editForm.password} onChange={(event) => setEditForm((current) => ({ ...current, password: event.target.value }))} />
                </div>
              </div>
            )}

            {capabilities?.authority === 'super_admin' && (
              <div>
                <Label className="mb-1.5 block">Branch(es)</Label>
                <BranchSelector value={editForm.brand} onChange={(value) => setEditForm((current) => ({ ...current, brand: value }))} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Department</Label><Input value={editForm.department} onChange={(event) => setEditForm((current) => ({ ...current, department: event.target.value }))} /></div>
              <div><Label>Phone</Label><Input value={editForm.phoneNumber} onChange={(event) => setEditForm((current) => ({ ...current, phoneNumber: event.target.value }))} /></div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button disabled={saving} onClick={() => void updateUser()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
