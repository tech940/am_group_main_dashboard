'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ROLE_PROFILE } from '@/lib/permissions/tiers'

const TIER_LABEL: Record<number, string> = { 0: 'Employee', 1: 'Supervisor', 2: 'Manager', 3: 'Head / GM', 4: 'Leadership', 5: 'Super-admin' }
function tierInfo(roleKey: string): { tier: string; track: string } | null {
  const profile = ROLE_PROFILE[roleKey as keyof typeof ROLE_PROFILE]
  if (!profile) return null
  const track = profile.family === 'super' ? 'all access' : profile.family === 'special' ? 'standalone' : (profile.track || '')
  return { tier: TIER_LABEL[profile.tier], track }
}

type PermissionRow = { key: string; groupKey: string; label: string; action: string }
type GroupRow = { key: string; name: string; parentKey: string | null; description?: string; sortOrder?: number }
type RoleRow = { key: string; label: string; editable: boolean }

export type RolesData = {
  roles: RoleRow[]
  groups: GroupRow[]
  permissions: PermissionRow[]
  grants: Record<string, Record<string, boolean>>
}

const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'approve', 'audit']
const ACTION_LABEL: Record<string, string> = { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', approve: 'Approve', audit: 'Audit' }

export function RolesPanel({ data }: { data: RolesData }) {
  const [selectedRole, setSelectedRole] = useState<string>(data.roles.find((r) => r.editable)?.key || data.roles[0]?.key || '')
  const [grants, setGrants] = useState<Record<string, Record<string, boolean>>>(data.grants)
  const [changes, setChanges] = useState<Record<string, boolean>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [sectionQuery, setSectionQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const role = data.roles.find((r) => r.key === selectedRole)
  const editable = role?.editable ?? false
  const selectedTier = tierInfo(selectedRole)

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, GroupRow[]>()
    for (const group of data.groups) {
      const list = map.get(group.parentKey) || []
      list.push(group)
      map.set(group.parentKey, list)
    }
    for (const list of map.values()) list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    return map
  }, [data.groups])

  const actionsByGroup = useMemo(() => {
    const map = new Map<string, PermissionRow[]>()
    for (const permission of data.permissions) {
      const list = map.get(permission.groupKey) || []
      list.push(permission)
      map.set(permission.groupKey, list)
    }
    for (const list of map.values()) list.sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action))
    return map
  }, [data.permissions])

  const original = useCallback((key: string) => grants[selectedRole]?.[key] === true, [grants, selectedRole])
  const granted = useCallback((key: string) => (key in changes ? changes[key] : original(key)), [changes, original])

  const toggle = useCallback((key: string) => {
    if (!editable) return
    setChanges((current) => {
      const next = !granted(key)
      const draft = { ...current }
      if (next === original(key)) delete draft[key]
      else draft[key] = next
      return draft
    })
  }, [editable, granted, original])

  const sectionFilter = sectionQuery.trim().toLowerCase()
  const matches = (group: GroupRow): boolean => {
    if (!sectionFilter) return true
    if (`${group.name} ${group.key}`.toLowerCase().includes(sectionFilter)) return true
    return (childrenByParent.get(group.key) || []).some(matches)
  }

  const changeCount = Object.keys(changes).length

  const onSelectRole = (key: string) => { setSelectedRole(key); setChanges({}); setError('') }

  async function save() {
    if (!changeCount) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, changes }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Failed to update role.')
      setGrants(payload.grants)
      setChanges({})
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update role.')
    } finally {
      setSaving(false)
    }
  }

  const renderNode = (group: GroupRow, depth: number) => {
    if (!matches(group)) return null
    const children = childrenByParent.get(group.key) || []
    const hasChildren = children.length > 0
    const isCollapsed = collapsed.has(group.key) && !sectionFilter
    const actions = actionsByGroup.get(group.key) || []

    return (
      <div key={group.key}>
        <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-2 py-2 hover:bg-slate-50', depth === 0 && 'bg-slate-50/70')} style={{ paddingLeft: `${8 + depth * 18}px` }}>
          <button type="button" onClick={() => hasChildren && setCollapsed((c) => { const n = new Set(c); if (n.has(group.key)) n.delete(group.key); else n.add(group.key); return n })} className={cn('flex h-4 w-4 flex-none items-center justify-center text-slate-400', !hasChildren && 'invisible')}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} />
          </button>
          <div className="min-w-0 flex-1">
            <p className={cn('truncate font-semibold', depth === 0 ? 'text-[13px] text-slate-800' : 'text-[12.5px] font-medium text-slate-700')}>{group.name}</p>
            {depth > 0 && <p className="truncate font-mono text-[10px] text-slate-400">{group.key}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {actions.map((permission) => {
              const on = granted(permission.key)
              return (
                <button
                  key={permission.key}
                  type="button"
                  disabled={!editable}
                  onClick={() => toggle(permission.key)}
                  className={cn('rounded-md px-2 py-1 text-[11px] font-semibold ring-1 transition',
                    on ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-400 ring-slate-200',
                    editable ? 'cursor-pointer hover:ring-slate-300' : 'opacity-70')}
                >
                  {ACTION_LABEL[permission.action] || permission.action}
                </button>
              )
            })}
          </div>
        </div>
        {hasChildren && !isCollapsed && <div>{children.map((child) => renderNode(child, depth + 1))}</div>}
      </div>
    )
  }

  const rootGroups = childrenByParent.get(null) || []

  return (
    <div className="grid gap-5 xl:grid-cols-[240px_1fr]">
      {/* role rail */}
      <Card className="self-start">
        <CardContent className="space-y-1 p-3">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Roles</p>
          <div className="max-h-[620px] space-y-1 overflow-y-auto">
            {data.roles.map((r) => {
              const ti = tierInfo(r.key)
              return (
                <button
                  key={r.key}
                  onClick={() => onSelectRole(r.key)}
                  className={cn('flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left transition',
                    selectedRole === r.key ? 'border-indigo-300 bg-indigo-50' : 'border-transparent hover:bg-slate-50')}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-slate-800">{r.label}</span>
                    {ti && <span className="truncate text-[10px] font-medium text-slate-400">{ti.tier}{ti.track ? ` · ${ti.track}` : ''}</span>}
                  </span>
                  {!r.editable && <span className="ml-2 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-400">auto</span>}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* editor */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[15px] font-bold text-slate-900">{role?.label} <span className="text-[12px] font-medium text-slate-400">default access</span></p>
            {selectedTier && (
              <p className="text-[11px] font-medium text-indigo-600">Tier: {selectedTier.tier}{selectedTier.track ? ` · ${selectedTier.track}` : ''} — inherits lower tiers in its track.</p>
            )}
            <p className="text-[11px] text-slate-500">Applies to every user with this role. Per-user exceptions live in the Access tab.</p>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={sectionQuery} onChange={(e) => setSectionQuery(e.target.value)} placeholder="Filter sections…" className="w-40 border-0 bg-transparent text-[12px] outline-none placeholder:text-slate-400" />
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}
        {!editable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
            This role always resolves to broad access in the permission engine, so its defaults are read-only.
          </div>
        )}

        <Card>
          <CardContent className="space-y-1 pt-4">
            {rootGroups.filter(matches).map((group) => renderNode(group, 0))}
          </CardContent>
        </Card>
      </div>

      {changeCount > 0 && (
        <div className="sticky bottom-4 z-10 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white shadow-xl">
            <span className="text-[13px] font-bold">{changeCount} change{changeCount === 1 ? '' : 's'} to {role?.label}</span>
            <span className="hidden text-[11px] text-slate-400 sm:inline">Re-computes access for every user with this role.</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setChanges({})}>Discard</Button>
              <Button size="sm" className="gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400" disabled={saving} onClick={() => void save()}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save role
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
