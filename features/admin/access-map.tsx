'use client'

import { useMemo, useState } from 'react'
import {
  Check,
  Loader2,
  Search,
  X,
  User,
  Shield,
  Lock,
  Eye,
  AlertCircle,
  Fingerprint,
  RefreshCw,
  CheckCircle2,
  Settings,
  ChevronDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Section = { key: string; name: string; parentKey: string | null; sortOrder?: number }
type MatrixUser = { id: string; fullName: string; email?: string; role: string; branchLabel?: string; isActive: boolean; canManage?: boolean }
type Cell = { visible: boolean; override: boolean; defaultVisible: boolean }

export type AccessMatrixData = {
  users: MatrixUser[]
  sections: Section[]
  access: Record<string, Record<string, Cell>>
}

type AccessMapProps = {
  data: AccessMatrixData
  roleLabels: Record<string, string>
  onEditUser: (id: string) => void
  onReload?: () => void
}

function prefixLabel(prefix: string) {
  return prefix.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

// Grid layout constants
const GROUP_ROW_H = 38
const SECTION_ROW_H = 130
const USER_COL_W = 240
const COL_W = 46

export function AccessMap({ data, roleLabels, onEditUser, onReload }: AccessMapProps) {
  const [mode, setMode] = useState<'grid' | 'section'>('grid')
  const [userQuery, setUserQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [sectionKey, setSectionKey] = useState<string>(data.sections[0]?.key || '')
  const [edits, setEdits] = useState<Record<string, Record<string, boolean>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const groups = useMemo(() => {
    const byPrefix = new Map<string, Section[]>()
    for (const section of data.sections) {
      const prefix = section.key.split('.')[0]
      const list = byPrefix.get(prefix) || []
      list.push(section)
      byPrefix.set(prefix, list)
    }
    return Array.from(byPrefix.entries()).map(([prefix, sections]) => ({ prefix, label: prefixLabel(prefix), sections }))
  }, [data.sections])

  const visibleGroups = groupFilter === 'all' ? groups : groups.filter((g) => g.prefix === groupFilter)
  const columns = visibleGroups.flatMap((g) => g.sections)
  const groupStart = (i: number) => i > 0 && columns[i - 1].key.split('.')[0] !== columns[i].key.split('.')[0]

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    if (!q) return data.users
    return data.users.filter((u) => `${u.fullName} ${u.email || ''} ${u.role} ${u.branchLabel || ''}`.toLowerCase().includes(q))
  }, [data.users, userQuery])

  // --- edit helpers ---
  const desired = (userId: string, key: string) => {
    const pending = edits[userId]?.[key]
    if (pending !== undefined) return pending
    return data.access[userId]?.[key]?.visible ?? false
  }
  const isDirty = (userId: string, key: string) => edits[userId]?.[key] !== undefined

  const toggle = (user: MatrixUser, key: string) => {
    if (!user.canManage) return
    const original = data.access[user.id]?.[key]?.visible ?? false
    const next = !desired(user.id, key)
    setEdits((current) => {
      const forUser = { ...(current[user.id] || {}) }
      if (next === original) delete forUser[key]
      else forUser[key] = next
      const draft = { ...current }
      if (Object.keys(forUser).length) draft[user.id] = forUser
      else delete draft[user.id]
      return draft
    })
  }

  const changeCount = Object.values(edits).reduce((n, m) => n + Object.keys(m).length, 0)
  const countVisible = (userId: string) => columns.reduce((n, s) => n + (desired(userId, s.key) ? 1 : 0), 0)

  async function save() {
    if (!changeCount) return
    setSaving(true)
    setError('')
    try {
      await Promise.all(Object.entries(edits).map(([userId, sectionMap]) => {
        const permissions: Record<string, boolean | null> = {}
        for (const [key, want] of Object.entries(sectionMap)) {
          const def = data.access[userId]?.[key]?.defaultVisible ?? false
          permissions[`${key}.view`] = want === def ? null : want
        }
        return fetch('/api/admin/permissions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, permissions, reason: 'Updated from Access Map' }),
        }).then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            throw new Error(payload.error || 'Failed to save access.')
          }
        })
      }))
      setEdits({})
      onReload?.()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save access.')
    } finally {
      setSaving(false)
    }
  }

  const sectionUsers = useMemo(() => {
    if (!sectionKey) return { withAccess: [] as MatrixUser[], without: [] as MatrixUser[] }
    const withAccess: MatrixUser[] = []
    const without: MatrixUser[] = []
    for (const user of filteredUsers) {
      ;(data.access[user.id]?.[sectionKey]?.visible ? withAccess : without).push(user)
    }
    return { withAccess, without }
  }, [sectionKey, filteredUsers, data.access])

  return (
    <div className="space-y-6">
      
      {/* Sleek Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Grid vs Section Mode Switch */}
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {(['grid', 'section'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider transition-all duration-200',
                  mode === m 
                    ? 'bg-slate-900 text-white shadow-sm' 
                    : 'text-slate-500 hover:text-slate-900'
                )}
              >
                {m === 'grid' ? 'Grid Matrix' : 'By Section'}
              </button>
            ))}
          </div>

          {/* Glowing Search Bar */}
          <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100">
            <Search className="h-4 w-4 text-slate-400" />
            <input 
              value={userQuery} 
              onChange={(e) => setUserQuery(e.target.value)} 
              placeholder="Search operators..." 
              className="ml-2 w-48 border-0 bg-transparent text-xs font-semibold text-slate-800 outline-none placeholder:text-slate-400" 
            />
          </div>

          {/* Dropdown Filters with Chevron */}
          {mode === 'grid' && (
            <div className="relative">
              <select 
                value={groupFilter} 
                onChange={(e) => setGroupFilter(e.target.value)} 
                className="appearance-none rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 py-2 text-xs font-black uppercase tracking-wider text-slate-700 outline-none transition hover:border-slate-300"
              >
                <option value="all">All operational areas ({groups.length})</option>
                {groups.map((g) => <option key={g.prefix} value={g.prefix}>{g.label} ({g.sections.length})</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          )}

          {mode === 'section' && (
            <div className="relative">
              <select 
                value={sectionKey} 
                onChange={(e) => setSectionKey(e.target.value)} 
                className="appearance-none rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 py-2 text-xs font-black uppercase tracking-wider text-slate-700 outline-none transition hover:border-slate-300"
              >
                {groups.map((g) => (
                  <optgroup key={g.prefix} label={g.label}>
                    {g.sections.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          )}

        </div>

        {/* Legend Indicators */}
        <div className="flex flex-wrap items-center gap-4 text-[10.5px] font-black uppercase tracking-wider text-slate-500">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-emerald-500 border border-emerald-500 text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
            </span> 
            Allowed
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-5 w-5 rounded-[6px] border border-solid border-slate-300 bg-white" /> 
            Denied
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo-500 animate-pulse" /> 
            Override
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 shadow-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {mode === 'grid' ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white shadow-xl overflow-hidden">
          
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4.5 w-4.5 text-indigo-600" />
              <p className="text-xs font-black uppercase tracking-widest text-slate-700">Access Control Matrix</p>
            </div>
            <p className="text-[11px] font-semibold text-slate-400">
              Tick cells to grant permissions. Rows for users managed by another developer are read-only.
            </p>
          </div>

          <div className="overflow-auto" style={{ maxHeight: '72vh' }}>
            <table className="access-map-grid border-separate border-spacing-0 text-[12px] w-full text-center">
              <thead>
                
                {/* Row 1: Groups (sticky top) */}
                <tr className="bg-slate-950 text-white">
                  <th
                    className="sticky left-0 top-0 z-40 bg-slate-950 border-b border-r border-slate-800 px-4 text-left align-middle text-[9px] font-black uppercase tracking-[0.2em] text-slate-400"
                    style={{ left: 0, top: 0, height: GROUP_ROW_H, minWidth: USER_COL_W, width: USER_COL_W }}
                  >
                    User Context <span className="font-bold lowercase text-slate-500">({filteredUsers.length})</span>
                  </th>
                  {visibleGroups.map((g) => (
                    <th
                      key={g.prefix}
                      colSpan={g.sections.length}
                      className="sticky top-0 z-30 bg-slate-950 border-b border-l border-slate-800 px-2 text-center text-[9px] font-black uppercase tracking-[0.2em]"
                      style={{ top: 0, height: GROUP_ROW_H }}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>

                {/* Row 2: Sections (sticky below group row) */}
                <tr className="bg-slate-900 text-slate-200">
                  <th
                    className="sticky left-0 z-40 bg-slate-900 border-b border-r border-slate-800"
                    style={{ left: 0, top: GROUP_ROW_H, minWidth: USER_COL_W, width: USER_COL_W }}
                  />
                  {columns.map((s, i) => (
                    <th
                      key={s.key}
                      title={s.name}
                      className={cn(
                        'sticky z-30 bg-slate-900 border-b border-slate-800 p-0 align-bottom transition-colors hover:bg-slate-850',
                        groupStart(i) && 'border-l border-l-slate-700'
                      )}
                      style={{ top: GROUP_ROW_H, height: SECTION_ROW_H, minWidth: COL_W, width: COL_W }}
                    >
                      <div className="flex items-end justify-center pb-3" style={{ height: SECTION_ROW_H }}>
                        <span 
                          className="whitespace-nowrap text-[9.5px] font-black uppercase tracking-wider text-slate-300" 
                          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                        >
                          {s.name}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>

              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/80 transition-colors">
                    
                    {/* Pinned Column 1: User details */}
                    <td
                      className={cn(
                        "am-user sticky left-0 z-20 border-b border-r px-4 py-2 text-left transition-colors",
                        user.isActive 
                          ? 'border-slate-100 dark:border-slate-800' 
                          : 'opacity-85 border-slate-100 dark:border-slate-800'
                      )}
                      style={{ left: 0, minWidth: USER_COL_W, width: USER_COL_W }}
                    >
                      <button 
                        type="button"
                        onClick={() => onEditUser(user.id)} 
                        className="block w-full text-left outline-none group"
                        title="Open access details editor"
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Avatar Initials Icon */}
                          <div className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[11px] font-black shadow-sm",
                            user.isActive 
                              ? "bg-slate-100 text-slate-800 border border-slate-200/60" 
                              : "bg-slate-100/50 text-slate-400"
                          )}>
                            {getInitials(user.fullName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className={cn(
                              'block truncate text-xs font-black tracking-tight leading-tight', 
                              user.isActive ? 'text-slate-900 group-hover:text-indigo-600' : 'text-slate-400'
                            )}>
                              {user.fullName}
                            </span>
                            <span className="block truncate text-[10px] font-bold text-slate-400 mt-0.5">
                              {roleLabels[user.role] || user.role}
                            </span>
                          </div>
                        </div>

                        {/* Visible tags & counts */}
                        <div className="mt-2 flex items-center justify-between">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-500 tracking-wider">
                            {countVisible(user.id)} sections
                          </span>
                          {!user.canManage && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700 border border-amber-200">
                              read-only
                            </span>
                          )}
                        </div>
                      </button>
                    </td>

                    {/* Checkbox columns */}
                    {columns.map((s, i) => {
                      const cell = data.access[user.id]?.[s.key]
                      const checked = desired(user.id, s.key)
                      const dirty = isDirty(user.id, s.key)
                      const override = checked !== (cell?.defaultVisible ?? false)
                      
                      return (
                        <td
                          key={s.key}
                          className={cn(
                            'border-b border-slate-100 text-center transition-colors', 
                            groupStart(i) && 'border-l border-l-slate-200/80', 
                            dirty && 'bg-indigo-50/40'
                          )}
                          style={{ minWidth: COL_W, width: COL_W }}
                        >
                          <div className="relative flex h-9 items-center justify-center">
                            <button
                              type="button"
                              disabled={!user.canManage}
                              onClick={() => toggle(user, s.key)}
                              title={user.canManage ? (checked ? 'Deny access' : 'Grant access') : 'Managed by Developer'}
                              className={cn(
                                'am-check flex h-5 w-5 items-center justify-center rounded-[6px] border border-solid transition-all duration-150 outline-none',
                                checked && 'is-on',
                                checked 
                                  ? '!text-white shadow-sm shadow-emerald-500/20 scale-105' 
                                  : '!text-transparent hover:border-slate-400',
                                user.canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                                dirty && 'ring-2 ring-indigo-400 ring-offset-1 border-indigo-400',
                              )}
                            >
                              <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
                            </button>

                            {/* Glow override indicator */}
                            {override && !dirty && (
                              <span 
                                className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" 
                                title="Explicit role override active" 
                              />
                            )}
                          </div>
                        </td>
                      )
                    })}

                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={columns.length + 1} className="px-4 py-16 text-center text-xs font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                      No matching users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        
        /* BY-SECTION VIEW: SPLIT PANEL CARDS */
        <div className="grid gap-6 lg:grid-cols-2">
          
          <Card className="rounded-[2rem] border border-slate-200 bg-white shadow-lg overflow-hidden">
            <CardContent className="p-6">
              
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Authorization Status</p>
                  <h3 className="mt-0.5 text-base font-black text-slate-900">
                    Can Access <span className="text-emerald-600">({sectionUsers.withAccess.length})</span>
                  </h3>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black text-slate-600 tracking-wide">
                  {data.sections.find((s) => s.key === sectionKey)?.name}
                </span>
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {sectionUsers.withAccess.map((u) => (
                  <button 
                    key={u.id} 
                    onClick={() => onEditUser(u.id)} 
                    className="flex w-full items-center justify-between rounded-2xl border border-slate-100/80 bg-slate-50/50 px-4 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-black">
                        {getInitials(u.fullName)}
                      </div>
                      <div>
                        <span className="text-xs font-black text-slate-900 block leading-tight">{u.fullName}</span>
                        <span className="text-[10px] font-semibold text-slate-400 mt-0.5 block">
                          {roleLabels[u.role] || u.role}{u.branchLabel ? ` · ${u.branchLabel}` : ''}
                        </span>
                      </div>
                    </div>
                    {data.access[u.id]?.[sectionKey]?.override && (
                      <span className="rounded-full bg-indigo-50 border border-indigo-100 px-2 py-0.5 text-[8.5px] font-black uppercase tracking-wider text-indigo-600">
                        override
                      </span>
                    )}
                  </button>
                ))}
                {sectionUsers.withAccess.length === 0 && (
                  <div className="px-4 py-16 text-center text-xs font-black text-slate-400 uppercase tracking-widest">
                    No active accounts can access this section.
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border border-slate-200 bg-white shadow-lg overflow-hidden">
            <CardContent className="p-6">
              
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Authorization Status</p>
                  <h3 className="mt-0.5 text-base font-black text-slate-900">
                    No Access <span className="text-slate-400">({sectionUsers.without.length})</span>
                  </h3>
                </div>
              </div>

              <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {sectionUsers.without.map((u) => (
                  <button 
                    key={u.id} 
                    onClick={() => onEditUser(u.id)} 
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-100/50 px-4 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-400 text-xs font-black">
                      {getInitials(u.fullName)}
                    </div>
                    <div>
                      <span className="text-xs font-black text-slate-700 block leading-tight">{u.fullName}</span>
                      <span className="text-[10px] font-semibold text-slate-400 mt-0.5 block">
                        {roleLabels[u.role] || u.role}{u.branchLabel ? ` · ${u.branchLabel}` : ''}
                      </span>
                    </div>
                  </button>
                ))}
                {sectionUsers.without.length === 0 && (
                  <div className="px-4 py-16 text-center text-xs font-black text-slate-400 uppercase tracking-widest">
                    All accounts have access to this section.
                  </div>
                )}
              </div>

            </CardContent>
          </Card>

        </div>
      )}

      {/* Sticky Save Floating Action Bar */}
      {changeCount > 0 && (
        <div className="sticky bottom-6 z-40 px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 rounded-3xl border border-slate-800 bg-slate-900/95 px-5 py-4 text-white shadow-2xl backdrop-blur-md">
            
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Settings className="h-4.5 w-4.5 animate-spin" style={{ animationDuration: '6s' }} />
              </span>
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider text-white">
                  {changeCount} Pending Change{changeCount === 1 ? '' : 's'}
                </p>
                <p className="text-[10px] font-semibold text-slate-400 mt-0.5">
                  Affects {Object.keys(edits).length} user account{Object.keys(edits).length === 1 ? '' : 's'} · Audit logs generated
                </p>
              </div>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                className="gap-1.5 text-xs font-black uppercase tracking-wider text-slate-300 hover:bg-white/10 hover:text-white rounded-xl h-10 px-4" 
                onClick={() => setEdits({})}
              >
                <X className="h-4 w-4" /> Discard
              </Button>
              <Button 
                size="sm" 
                className="gap-1.5 bg-indigo-500 hover:bg-indigo-400 text-white font-black uppercase tracking-wider text-xs rounded-xl shadow-lg shadow-indigo-500/20 h-10 px-5" 
                disabled={saving} 
                onClick={() => void save()}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" strokeWidth={2.5} /> Save Changes
                  </>
                )}
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
