'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  ShieldOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type TriState = 'allow' | 'inherit' | 'deny'

type PermissionRow = { key: string; groupKey: string; label: string; action: string }
type GroupRow = { key: string; name: string; parentKey: string | null; description: string; sortOrder?: number }
type ManagedUserLite = {
  id: string
  fullName: string
  email?: string
  role: string
  branchLabel?: string
  canManage?: boolean
}

export type AccessControlData = {
  users: ManagedUserLite[]
  selectedUser: (ManagedUserLite & { canManage: boolean }) | null
  groups: GroupRow[]
  permissions: PermissionRow[]
  snapshot: {
    effective: Record<string, boolean>
    roleDefaults: Record<string, boolean>
    overrides: Record<string, boolean>
  }
}

type AccessControlPanelProps = {
  data: AccessControlData
  selectedUserId: string
  onSelectUser: (id: string) => void
  changes: Record<string, boolean | null>
  setChanges: (updater: (current: Record<string, boolean | null>) => Record<string, boolean | null>) => void
  saving: boolean
  onSave: () => void
  roleLabels: Record<string, string>
}

const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'audit']
const ACTION_LABEL: Record<string, string> = {
  view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve', audit: 'Audit',
}

function stateFromBool(value: boolean | null | undefined): TriState {
  if (value === true) return 'allow'
  if (value === false) return 'deny'
  return 'inherit'
}
function boolFromState(state: TriState): boolean | null {
  if (state === 'allow') return true
  if (state === 'deny') return false
  return null
}

function TriToggle({
  value,
  disabled,
  size = 'md',
  onChange,
}: {
  value: TriState
  disabled?: boolean
  size?: 'sm' | 'md'
  onChange: (next: TriState) => void
}) {
  const opts: Array<{ v: TriState; label: string; on: string }> = [
    { v: 'allow', label: 'Allow', on: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    { v: 'inherit', label: 'Inherit', on: 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' },
    { v: 'deny', label: 'Deny', on: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  ]
  return (
    <div className={cn('inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5', disabled && 'opacity-50')}>
      {opts.map((opt) => (
        <button
          key={opt.v}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && onChange(opt.v)}
          className={cn(
            'rounded-md font-semibold tracking-wide transition',
            size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
            value === opt.v ? opt.on : 'text-slate-400 hover:text-slate-600',
            !disabled && 'cursor-pointer',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function AccessControlPanel({
  data,
  selectedUserId,
  onSelectUser,
  changes,
  setChanges,
  saving,
  onSave,
  roleLabels,
}: AccessControlPanelProps) {
  const [userQuery, setUserQuery] = useState('')
  const [sectionQuery, setSectionQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copyOpen, setCopyOpen] = useState(false)
  const [copying, setCopying] = useState(false)

  const canManage = data.selectedUser?.canManage ?? false
  const { roleDefaults, overrides } = data.snapshot

  // --- lookups -----------------------------------------------------------
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, GroupRow[]>()
    for (const group of data.groups) {
      const list = map.get(group.parentKey) || []
      list.push(group)
      map.set(group.parentKey, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    }
    return map
  }, [data.groups])

  const actionsByGroup = useMemo(() => {
    const map = new Map<string, PermissionRow[]>()
    for (const permission of data.permissions) {
      const list = map.get(permission.groupKey) || []
      list.push(permission)
      map.set(permission.groupKey, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action))
    }
    return map
  }, [data.permissions])

  // --- state resolution --------------------------------------------------
  const originalState = useCallback((key: string): TriState => {
    if (key in overrides) return overrides[key] ? 'allow' : 'deny'
    return 'inherit'
  }, [overrides])

  const desiredState = useCallback((key: string): TriState => {
    if (key in changes) return stateFromBool(changes[key])
    return originalState(key)
  }, [changes, originalState])

  const effectiveVisible = useCallback((key: string): boolean => {
    const state = desiredState(key)
    if (state === 'inherit') return roleDefaults[key] === true
    return state === 'allow'
  }, [desiredState, roleDefaults])

  const setKeyState = useCallback((key: string, next: TriState) => {
    setChanges((current) => {
      const draft = { ...current }
      if (next === originalState(key)) {
        delete draft[key]
      } else {
        draft[key] = boolFromState(next)
      }
      return draft
    })
  }, [originalState, setChanges])

  // descendant view-permission keys under a group (self + children), for bulk actions & rollups
  const descendantViewKeys = useCallback((groupKey: string): string[] => {
    const keys: string[] = []
    const walk = (key: string) => {
      const viewPerm = (actionsByGroup.get(key) || []).find((p) => p.action === 'view')
      if (viewPerm) keys.push(viewPerm.key)
      for (const child of childrenByParent.get(key) || []) walk(child.key)
    }
    walk(groupKey)
    return keys
  }, [actionsByGroup, childrenByParent])

  const bulkSet = useCallback((groupKey: string, next: TriState) => {
    if (!canManage) return
    const keys = descendantViewKeys(groupKey)
    setChanges((current) => {
      const draft = { ...current }
      for (const key of keys) {
        if (next === originalState(key)) delete draft[key]
        else draft[key] = boolFromState(next)
      }
      return draft
    })
  }, [canManage, descendantViewKeys, originalState, setChanges])

  const resetToRoleDefault = useCallback(() => {
    if (!canManage) return
    // Reset = remove every override (send null for each currently-overridden key).
    setChanges(() => {
      const draft: Record<string, boolean | null> = {}
      for (const key of Object.keys(overrides)) draft[key] = null
      return draft
    })
  }, [canManage, overrides, setChanges])

  const copyFromUser = useCallback(async (sourceUserId: string) => {
    if (!canManage || !sourceUserId) return
    setCopying(true)
    try {
      const response = await fetch(`/api/admin/permissions?userId=${encodeURIComponent(sourceUserId)}`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to load source user.')
      const sourceOverrides: Record<string, boolean> = payload.snapshot?.overrides || {}
      setChanges(() => {
        const draft: Record<string, boolean | null> = {}
        for (const permission of data.permissions) {
          const key = permission.key
          const sourceState: TriState = key in sourceOverrides ? (sourceOverrides[key] ? 'allow' : 'deny') : 'inherit'
          if (sourceState !== originalState(key)) draft[key] = boolFromState(sourceState)
        }
        return draft
      })
    } catch {
      // Swallow — the parent surfaces load errors; a failed copy simply changes nothing.
    } finally {
      setCopying(false)
      setCopyOpen(false)
    }
  }, [canManage, data.permissions, originalState, setChanges])

  // --- diff summary ------------------------------------------------------
  const diff = useMemo(() => {
    let allow = 0, deny = 0, inherit = 0
    for (const key of Object.keys(changes)) {
      if (desiredState(key) === originalState(key)) continue
      const s = desiredState(key)
      if (s === 'allow') allow++
      else if (s === 'deny') deny++
      else inherit++
    }
    return { allow, deny, inherit, total: allow + deny + inherit }
  }, [changes, desiredState, originalState])

  const visibleSectionCount = useMemo(() => {
    let visible = 0, total = 0
    for (const permission of data.permissions) {
      if (permission.action !== 'view') continue
      total++
      if (effectiveVisible(permission.key)) visible++
    }
    return { visible, total }
  }, [data.permissions, effectiveVisible])

  const overrideCount = Object.keys(overrides).length

  // --- section filtering -------------------------------------------------
  // Plain recursive function (not memoised) so it can reference itself; it reads the latest
  // sectionQuery/childrenByParent from the render closure.
  const sectionFilter = sectionQuery.trim().toLowerCase()
  const matchesQuery = (group: GroupRow): boolean => {
    if (!sectionFilter) return true
    if (`${group.name} ${group.key}`.toLowerCase().includes(sectionFilter)) return true
    return (childrenByParent.get(group.key) || []).some(matchesQuery)
  }

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    if (!q) return data.users
    return data.users.filter((u) => `${u.fullName} ${u.email || ''} ${u.role} ${u.branchLabel || ''}`.toLowerCase().includes(q))
  }, [data.users, userQuery])

  // --- rollup ------------------------------------------------------------
  const rollup = useCallback((groupKey: string) => {
    const keys = descendantViewKeys(groupKey)
    const visible = keys.filter((key) => effectiveVisible(key)).length
    return { visible, total: keys.length }
  }, [descendantViewKeys, effectiveVisible])

  const toggleCollapse = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // --- render a group node -----------------------------------------------
  const renderNode = (group: GroupRow, depth: number) => {
    if (!matchesQuery(group)) return null
    const children = childrenByParent.get(group.key) || []
    const hasChildren = children.length > 0
    const isCollapsed = collapsed.has(group.key) && !sectionQuery.trim()
    const actions = actionsByGroup.get(group.key) || []
    const viewPerm = actions.find((p) => p.action === 'view')
    const otherActions = actions.filter((p) => p.action !== 'view')
    const roll = hasChildren ? rollup(group.key) : null

    return (
      <div key={group.key} className={cn(depth === 0 && 'mt-2 first:mt-0')}>
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2 hover:bg-slate-50',
            depth === 0 && 'bg-slate-50/70',
          )}
          style={{ paddingLeft: `${8 + depth * 18}px` }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleCollapse(group.key)}
            className={cn('flex h-4 w-4 flex-none items-center justify-center text-slate-400', !hasChildren && 'invisible')}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} />
          </button>

          <div className="min-w-0 flex-1">
            <p className={cn('truncate font-semibold text-slate-800', depth === 0 ? 'text-[13px]' : 'text-[12.5px] font-medium text-slate-700')}>
              {group.name}
            </p>
            {depth > 0 && <p className="truncate font-mono text-[10px] text-slate-400">{group.key}</p>}
          </div>

          {roll && (
            <span className="text-[11px] font-medium tabular-nums text-slate-400">{roll.visible}/{roll.total} visible</span>
          )}

          {viewPerm && (
            <TriToggle
              value={desiredState(viewPerm.key)}
              disabled={!canManage}
              onChange={(next) => setKeyState(viewPerm.key, next)}
            />
          )}
        </div>

        {otherActions.length > 0 && !isCollapsed && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-2 pt-0.5" style={{ paddingLeft: `${8 + (depth + 1) * 18 + 4}px` }}>
            {otherActions.map((permission) => (
              <div key={permission.key} className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{ACTION_LABEL[permission.action] || permission.action}</span>
                <TriToggle
                  size="sm"
                  value={desiredState(permission.key)}
                  disabled={!canManage}
                  onChange={(next) => setKeyState(permission.key, next)}
                />
              </div>
            ))}
          </div>
        )}

        {hasChildren && !isCollapsed && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  const rootGroups = childrenByParent.get(null) || []
  const selected = data.selectedUser

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      {/* User rail */}
      <Card className="self-start">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Users</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="mb-1 flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
              placeholder="Search users…"
              className="w-full border-0 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-[600px] space-y-1 overflow-y-auto pr-1">
            {filteredUsers.map((user) => (
              <button
                key={user.id}
                onClick={() => onSelectUser(user.id)}
                className={cn(
                  'w-full rounded-xl border p-2.5 text-left transition',
                  selectedUserId === user.id ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:bg-slate-50',
                )}
              >
                <p className="truncate text-[13px] font-semibold text-slate-900">{user.fullName}</p>
                <p className="truncate text-[11px] text-slate-500">{roleLabels[user.role] || user.role}{user.branchLabel ? ` · ${user.branchLabel}` : ''}</p>
              </button>
            ))}
            {filteredUsers.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">No users match.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      <div className="space-y-4">
        {/* Context strip */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Editing access for</p>
            <p className="mt-1 truncate text-[15px] font-bold text-slate-900">{selected?.fullName || '—'}</p>
            <p className="truncate text-[11px] text-slate-500">{selected ? `${roleLabels[selected.role] || selected.role}${selected.branchLabel ? ` · ${selected.branchLabel}` : ''}` : ''}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sections visible</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{visibleSectionCount.visible}<span className="text-sm font-semibold text-slate-400"> / {visibleSectionCount.total}</span></p>
            <p className="text-[11px] text-slate-500">after role + overrides</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Explicit overrides</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-indigo-600">{overrideCount}</p>
            <p className="text-[11px] text-slate-500">on top of the role default</p>
          </div>
        </div>

        <Card>
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/60 p-3">
            <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <KeyRound className="h-3.5 w-3.5" /> Bulk
            </span>
            <div className="relative">
              <Button variant="outline" size="sm" className="gap-1.5" disabled={!canManage || copying} onClick={() => setCopyOpen((v) => !v)}>
                {copying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />} Copy from user
              </Button>
              {copyOpen && (
                <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  {data.users.filter((u) => u.id !== selectedUserId).map((user) => (
                    <button key={user.id} onClick={() => void copyFromUser(user.id)} className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[12px] hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{user.fullName}</span>
                      <span className="text-slate-400"> · {roleLabels[user.role] || user.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={!canManage} onClick={resetToRoleDefault}>
              <RotateCcw className="h-3.5 w-3.5" /> Reset to role default
            </Button>
            <div className="ml-auto flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                value={sectionQuery}
                onChange={(event) => setSectionQuery(event.target.value)}
                placeholder="Filter sections…"
                className="w-40 border-0 bg-transparent text-[12px] outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          {!canManage && selected && (
            <div className="m-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              Managed by Developer. Access is read-only.
            </div>
          )}

          <CardContent className="pt-3">
            {rootGroups.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-400">No sections available for your delegation scope.</p>
            ) : (
              <div className="space-y-1">
                {rootGroups.filter(matchesQuery).map((group) => {
                  const roll = rollup(group.key)
                  return (
                    <div key={group.key} className="rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-900">{group.name}</p>
                          {group.description && <p className="truncate text-[11px] text-slate-400">{group.description}</p>}
                        </div>
                        {canManage && (
                          <div className="flex flex-none items-center gap-1">
                            <button type="button" onClick={() => bulkSet(group.key, 'allow')} title="Allow all sections" className="rounded-md p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><Check className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => bulkSet(group.key, 'inherit')} title="Inherit all" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Minus className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => bulkSet(group.key, 'deny')} title="Deny all sections" className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><ShieldOff className="h-3.5 w-3.5" /></button>
                            <span className="ml-1 text-[11px] font-medium tabular-nums text-slate-400">{roll.visible}/{roll.total}</span>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-slate-100 px-1 pb-2">
                        {(childrenByParent.get(group.key) || []).length === 0
                          ? renderNode(group, 0)
                          : (childrenByParent.get(group.key) || []).map((child) => renderNode(child, 0))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sticky diff / save bar */}
      {diff.total > 0 && (
        <div className="sticky bottom-4 z-10 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white shadow-xl">
            <span className="text-[13px] font-bold">{diff.total} unsaved change{diff.total === 1 ? '' : 's'}</span>
            <div className="flex items-center gap-1.5">
              {diff.allow > 0 && <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">+{diff.allow} allow</span>}
              {diff.deny > 0 && <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-bold text-rose-300">−{diff.deny} deny</span>}
              {diff.inherit > 0 && <span className="rounded-full bg-slate-500/30 px-2.5 py-0.5 text-[11px] font-bold text-slate-200">{diff.inherit} reset</span>}
            </div>
            <span className="hidden text-[11px] text-slate-400 sm:inline">Every change is written to the permission audit log.</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setChanges(() => ({}))}>
                <X className="h-3.5 w-3.5" /> Discard
              </Button>
              <Button size="sm" className="gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400" disabled={saving || !canManage} onClick={onSave}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save access
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
