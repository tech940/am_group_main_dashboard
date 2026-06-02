'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronRight, History, Lock, RotateCcw, Save, Search, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve'

type ManagedUser = {
  id: string
  email: string
  fullName: string
  role: string
  brand: string | null
  branchLabel: string
  department: string | null
  isActive: boolean
}

type PermissionGroup = {
  key: string
  name: string
  parentKey: string | null
  description: string | null
  sortOrder: number
}

type Permission = {
  id: string
  key: string
  groupKey: string
  label: string | null
  description: string | null
  resource: string
  action: PermissionAction
  sortOrder: number
}

type PermissionSnapshot = {
  effective: Record<string, boolean>
  roleDefaults: Record<string, boolean>
  overrides: Record<string, boolean>
}

type RoleTemplate = {
  label: string
  permissions: Record<string, boolean>
}

type AuditEntry = {
  id: string
  permissionKey: string
  permissionLabel: string | null
  changedByName: string | null
  changedByEmail: string | null
  oldValue: boolean | null
  newValue: boolean | null
  reason: string | null
  createdAt: string
}

type PermissionPayload = {
  users: ManagedUser[]
  selectedUser: ManagedUser | null
  groups: PermissionGroup[]
  permissions: Permission[]
  snapshot: PermissionSnapshot
  templates: Record<string, RoleTemplate>
  auditTrail: AuditEntry[]
  error?: string
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
}

const ACTIONS: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'approve']

const EMPTY_SNAPSHOT: PermissionSnapshot = {
  effective: {},
  roleDefaults: {},
  overrides: {},
}

function formatRole(role: string) {
  return role.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildDepth(groups: PermissionGroup[]) {
  const byKey = new Map(groups.map((group) => [group.key, group]))
  const getDepth = (group: PermissionGroup): number => {
    if (!group.parentKey) return 0
    const parent = byKey.get(group.parentKey)
    return parent ? getDepth(parent) + 1 : 0
  }
  return Object.fromEntries(groups.map((group) => [group.key, getDepth(group)]))
}

function PermissionsManagerContent() {
  const searchParams = useSearchParams()
  const initialUserId = searchParams.get('user') || ''
  const [payload, setPayload] = useState<PermissionPayload | null>(null)
  const [selectedUserId, setSelectedUserId] = useState(initialUserId)
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(EMPTY_SNAPSHOT)
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean | null>>({})
  const [search, setSearch] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(['kia', 'kia.business_excellence']))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadPermissions = useCallback(async (userId?: string) => {
    try {
      setLoading(true)
      setError('')
      const params = new URLSearchParams()
      if (userId) params.set('userId', userId)
      const response = await fetch(`/api/admin/permissions${params.toString() ? `?${params.toString()}` : ''}`)
      const data = await response.json() as PermissionPayload
      if (!response.ok) throw new Error(data.error || 'Failed to load permissions')

      setPayload(data)
      setSnapshot(data.snapshot || EMPTY_SNAPSHOT)
      setPendingChanges({})
      setSelectedTemplate('')
      if (data.selectedUser?.id) setSelectedUserId(data.selectedUser.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPermissions(initialUserId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [initialUserId, loadPermissions])

  const groups = useMemo(() => payload?.groups || [], [payload?.groups])
  const permissions = useMemo(() => payload?.permissions || [], [payload?.permissions])
  const users = useMemo(() => payload?.users || [], [payload?.users])
  const selectedUser = users.find((user) => user.id === selectedUserId) || payload?.selectedUser || null
  const groupDepth = useMemo(() => buildDepth(groups), [groups])

  const permissionsByGroup = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const permission of permissions) {
      const current = map.get(permission.groupKey) || []
      current.push(permission)
      map.set(permission.groupKey, current)
    }
    return map
  }, [permissions])

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    const groupByKey = new Map(groups.map((group) => [group.key, group]))
    const isVisibleByExpansion = (group: PermissionGroup) => {
      let parentKey = group.parentKey
      while (parentKey) {
        if (!expandedGroups.has(parentKey)) return false
        parentKey = groupByKey.get(parentKey)?.parentKey || null
      }
      return true
    }

    const expandedFiltered = groups.filter(isVisibleByExpansion)
    if (!query) return expandedFiltered

    return expandedFiltered.filter((group) => {
      const groupMatches = `${group.name} ${group.description || ''}`.toLowerCase().includes(query)
      const permissionMatches = (permissionsByGroup.get(group.key) || []).some((permission) =>
        `${permission.label || permission.key} ${permission.description || ''}`.toLowerCase().includes(query)
      )
      return groupMatches || permissionMatches
    })
  }, [expandedGroups, groups, permissionsByGroup, search])

  const effectiveValue = (permissionKey: string) => {
    if (permissionKey in pendingChanges) {
      const pending = pendingChanges[permissionKey]
      if (pending === null) return snapshot.roleDefaults[permissionKey] === true
      return pending
    }
    return snapshot.effective[permissionKey] === true
  }

  const isOverride = (permissionKey: string) => (
    permissionKey in pendingChanges
      ? pendingChanges[permissionKey] !== null
      : permissionKey in snapshot.overrides
  )

  const setPermission = (permissionKey: string, value: boolean | null) => {
    setPendingChanges((current) => ({ ...current, [permissionKey]: value }))
  }

  const saveChanges = async () => {
    if (!selectedUser || Object.keys(pendingChanges).length === 0) return
    try {
      setSaving(true)
      setError('')
      const response = await fetch('/api/admin/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          permissions: pendingChanges,
          reason: 'Updated from Access Control Manager',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save permissions')

      setSnapshot(data.snapshot || EMPTY_SNAPSHOT)
      setPendingChanges({})
      setPayload((current) => current ? { ...current, snapshot: data.snapshot, auditTrail: data.auditTrail || current.auditTrail } : current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions')
    } finally {
      setSaving(false)
    }
  }

  const applyTemplate = () => {
    if (!payload || !selectedTemplate) return
    const template = payload.templates[selectedTemplate]
    if (!template) return
    setPendingChanges(template.permissions)
  }

  const bulkSetVisible = (value: boolean | null) => {
    const next: Record<string, boolean | null> = {}
    for (const group of visibleGroups) {
      for (const permission of permissionsByGroup.get(group.key) || []) {
        next[permission.key] = value
      }
    }
    setPendingChanges((current) => ({ ...current, ...next }))
  }

  return (
    <MainLayout title="Access Control" subtitle="Permission Center">
      <div className="mx-auto max-w-[1700px] space-y-6 animate-in fade-in duration-500">
        <section className="rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.95),rgba(235,241,249,0.88))] p-8 shadow-xl shadow-slate-200/60">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#023468]/15 bg-[#023468]/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-[#023468]">
                <ShieldCheck className="h-4 w-4" />
                Admin Permission Center
              </div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950">Access Control Manager</h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
                Control exactly which sections, sub-sections, pages, and actions each user can access. Role templates give a clean baseline; user overrides handle exceptions without code changes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                <p className="text-2xl font-black text-slate-950">{users.length}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Users</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                <p className="text-2xl font-black text-slate-950">{groups.length}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Sections</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                <p className="text-2xl font-black text-slate-950">{permissions.length}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Actions</p>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/85 shadow-xl shadow-slate-200/60">
            <CardContent className="p-0">
              <div className="border-b border-slate-100 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#023468]/10 text-[#023468]">
                    <Users className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-950">Users</p>
                    <p className="text-xs font-semibold text-slate-500">Select a user to edit access</p>
                  </div>
                </div>
              </div>
              <div className="max-h-[780px] overflow-y-auto p-3">
                {loading ? (
                  <div className="space-y-3 p-2">
                    {Array.from({ length: 8 }).map((_, index) => (
                      <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
                    ))}
                  </div>
                ) : users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => void loadPermissions(user.id)}
                    className={cn(
                      'mb-2 w-full rounded-2xl border p-4 text-left transition-all',
                      selectedUserId === user.id
                        ? 'border-[#023468] bg-[#023468]/5 shadow-sm'
                        : 'border-slate-100 bg-white hover:border-[#023468]/30 hover:bg-slate-50'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-black text-slate-950">{user.fullName}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{user.email}</p>
                      </div>
                      <Badge className="bg-slate-950 text-white">{formatRole(user.role)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
                        {user.branchLabel}
                      </span>
                      {user.department && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
                          {user.department}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/90 shadow-xl shadow-slate-200/60">
              <CardContent className="p-0">
                <div className="flex flex-col gap-4 border-b border-slate-100 p-5 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Permission Editor</p>
                    <h2 className="mt-1 text-2xl font-black text-slate-950">
                      {selectedUser ? selectedUser.fullName : 'Select a user'}
                    </h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search sections..."
                        className="h-11 w-64 rounded-2xl border-slate-200 bg-white pl-10"
                      />
                    </div>
                    <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                      <SelectTrigger className="h-11 w-52 rounded-2xl border-slate-200 bg-white">
                        <SelectValue placeholder="Role template" />
                      </SelectTrigger>
                      <SelectContent className="z-[200] rounded-xl border border-slate-200 bg-white shadow-xl">
                        {Object.entries(payload?.templates || {}).map(([role, template]) => (
                          <SelectItem key={role} value={role} className="bg-white hover:bg-slate-50">
                            {template.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="outline" onClick={applyTemplate} disabled={!selectedTemplate} className="h-11 rounded-2xl border-slate-200 bg-white">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Apply Template
                    </Button>
                    <Button type="button" onClick={saveChanges} disabled={saving || Object.keys(pendingChanges).length === 0} className="h-11 rounded-2xl bg-[#023468] text-white hover:bg-[#012348]">
                      <Save className="mr-2 h-4 w-4" />
                      {saving ? 'Saving...' : `Save ${Object.keys(pendingChanges).length || ''}`}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
                  <Button type="button" variant="outline" onClick={() => bulkSetVisible(true)} className="rounded-xl border-slate-200 bg-white">
                    Allow Visible
                  </Button>
                  <Button type="button" variant="outline" onClick={() => bulkSetVisible(false)} className="rounded-xl border-slate-200 bg-white">
                    Remove Visible
                  </Button>
                  <Button type="button" variant="outline" onClick={() => bulkSetVisible(null)} className="rounded-xl border-slate-200 bg-white">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset Visible to Role
                  </Button>
                  <p className="text-xs font-semibold text-slate-500">
                    Locked sections remain visible in navigation but show a no-access message when opened.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px]">
                    <thead>
                      <tr className="bg-slate-950 text-white">
                        <th className="px-5 py-4 text-left text-[11px] font-black uppercase tracking-[0.2em]">Section</th>
                        {ACTIONS.map((action) => (
                          <th key={action} className="px-3 py-4 text-center text-[11px] font-black uppercase tracking-[0.2em]">
                            {ACTION_LABELS[action]}
                          </th>
                        ))}
                        <th className="px-5 py-4 text-left text-[11px] font-black uppercase tracking-[0.2em]">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleGroups.map((group) => {
                        const childCount = groups.filter((item) => item.parentKey === group.key).length
                        const isExpanded = expandedGroups.has(group.key)
                        const rowPermissions = permissionsByGroup.get(group.key) || []
                        const depth = groupDepth[group.key] || 0

                        return (
                          <tr key={group.key} className="bg-white transition-colors hover:bg-slate-50">
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3" style={{ paddingLeft: `${depth * 22}px` }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedGroups((current) => {
                                      const next = new Set(current)
                                      if (next.has(group.key)) next.delete(group.key)
                                      else next.add(group.key)
                                      return next
                                    })
                                  }}
                                  className={cn(
                                    'flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500',
                                    childCount === 0 && 'opacity-40'
                                  )}
                                  disabled={childCount === 0}
                                >
                                  {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                                <div>
                                  <p className="font-black text-slate-950">{group.name}</p>
                                  <p className="mt-1 max-w-xl text-xs font-semibold text-slate-500">{group.description}</p>
                                </div>
                              </div>
                            </td>
                            {ACTIONS.map((action) => {
                              const permission = rowPermissions.find((item) => item.action === action)
                              if (!permission) {
                                return <td key={action} className="px-3 py-4 text-center text-slate-300">-</td>
                              }
                              const checked = effectiveValue(permission.key)
                              return (
                                <td key={action} className="px-3 py-4 text-center">
                                  <div className="flex flex-col items-center gap-2">
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={(value) => setPermission(permission.key, value === true)}
                                      className="h-5 w-5 rounded-md data-[state=checked]:border-[#023468] data-[state=checked]:bg-[#023468]"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setPermission(permission.key, null)}
                                      className={cn(
                                        'text-[10px] font-black uppercase tracking-[0.14em]',
                                        isOverride(permission.key) ? 'text-[#023468]' : 'text-slate-300'
                                      )}
                                    >
                                      Reset
                                    </button>
                                  </div>
                                </td>
                              )
                            })}
                            <td className="px-5 py-4">
                              <div className="flex flex-wrap gap-2">
                                {rowPermissions.length === 0 ? (
                                  <Badge variant="outline" className="rounded-full border-slate-200 text-slate-400">Section only</Badge>
                                ) : rowPermissions.map((permission) => (
                                  <Badge
                                    key={permission.key}
                                    className={cn(
                                      'rounded-full',
                                      isOverride(permission.key)
                                        ? 'bg-[#023468] text-white'
                                        : 'bg-slate-100 text-slate-600'
                                    )}
                                  >
                                    {isOverride(permission.key) ? 'Override' : 'Inherited'}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/90 shadow-xl shadow-slate-200/60">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <History className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-950">Audit Trail</p>
                    <p className="text-xs font-semibold text-slate-500">Last permission changes for the selected user</p>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {(payload?.auditTrail || []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-400">
                      No permission changes recorded yet.
                    </div>
                  ) : payload?.auditTrail.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-950">{entry.permissionLabel || entry.permissionKey}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {entry.changedByName || entry.changedByEmail || 'System'} · {formatDateTime(entry.createdAt)}
                          </p>
                        </div>
                        <Badge className={entry.newValue ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}>
                          {String(entry.oldValue)} → {String(entry.newValue)}
                        </Badge>
                      </div>
                      {entry.reason && (
                        <p className="mt-3 text-xs font-semibold text-slate-500">{entry.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {!loading && users.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <Lock className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 font-black text-slate-800">No users found</p>
          </div>
        )}
      </div>
    </MainLayout>
  )
}

export default function PermissionsManagerPage() {
  return (
    <Suspense
      fallback={(
        <MainLayout title="Access Control" subtitle="Permission Center">
          <div className="mx-auto max-w-[1700px] space-y-6">
            <div className="h-48 animate-pulse rounded-[2rem] bg-slate-100" />
            <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
              <div className="h-[620px] animate-pulse rounded-[1.75rem] bg-slate-100" />
              <div className="h-[620px] animate-pulse rounded-[1.75rem] bg-slate-100" />
            </div>
          </div>
        </MainLayout>
      )}
    >
      <PermissionsManagerContent />
    </Suspense>
  )
}
