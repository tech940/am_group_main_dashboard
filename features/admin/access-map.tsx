'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2, Search, X } from 'lucide-react'
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

// Grid layout constants (kept in sync with the sticky header top offsets).
const GROUP_ROW_H = 34
const SECTION_ROW_H = 120
const USER_COL_W = 210
const COL_W = 44

export function AccessMap({ data, roleLabels, onEditUser, onReload }: AccessMapProps) {
  const [mode, setMode] = useState<'grid' | 'section'>('grid')
  const [userQuery, setUserQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [sectionKey, setSectionKey] = useState<string>(data.sections[0]?.key || '')
  // edits: userId -> sectionKey -> desired visible (only cells that differ from the saved state)
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

  // --- edit helpers ---------------------------------------------------------
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
      // One PATCH per edited user. The override value is the delta from the role default:
      // matches default -> null (inherit); otherwise the desired boolean (allow/deny).
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

  // by-section view
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
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['grid', 'section'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition', mode === m ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-900')}
            >
              {m === 'grid' ? 'Grid (user × section)' : 'By section'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search users…" className="w-44 border-0 bg-transparent text-[13px] outline-none placeholder:text-slate-400" />
        </div>
        {mode === 'grid' && (
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700 outline-none">
            <option value="all">All areas ({groups.length})</option>
            {groups.map((g) => <option key={g.prefix} value={g.prefix}>{g.label} ({g.sections.length})</option>)}
          </select>
        )}
        {mode === 'section' && (
          <select value={sectionKey} onChange={(e) => setSectionKey(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700 outline-none">
            {groups.map((g) => (
              <optgroup key={g.prefix} label={g.label}>
                {g.sections.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border text-white" style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}><Check className="h-2.5 w-2.5" strokeWidth={3} /></span> can access</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-[4px] border border-slate-300" style={{ backgroundColor: '#fff' }} /> no access</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" /> override</span>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{error}</div>}
      {mode === 'grid' && (
        <p className="text-[12px] text-slate-500">Tick a box to grant a section, untick to deny it. Rows for users managed by another Developer are read-only.</p>
      )}

      {mode === 'grid' ? (
        <Card className="overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
            <table className="access-map-grid border-separate border-spacing-0 text-[12px]">
              <thead>
                {/* Row 1 — group labels (sticky top) */}
                <tr>
                  <th
                    className="sticky z-40 border-b border-r border-slate-200 px-3 text-left align-middle text-[11px] font-bold uppercase tracking-wide"
                    style={{ left: 0, top: 0, height: GROUP_ROW_H, minWidth: USER_COL_W, width: USER_COL_W }}
                  >
                    User <span className="font-medium normal-case text-slate-400">({filteredUsers.length})</span>
                  </th>
                  {visibleGroups.map((g) => (
                    <th
                      key={g.prefix}
                      colSpan={g.sections.length}
                      className="am-group sticky z-30 border-b border-l border-slate-200 px-2 text-center text-[10px] font-bold uppercase tracking-wide"
                      style={{ top: 0, height: GROUP_ROW_H }}
                    >
                      {g.label}
                    </th>
                  ))}
                </tr>
                {/* Row 2 — section names (sticky below the group row) */}
                <tr>
                  <th
                    className="sticky z-40 border-b border-r border-slate-200"
                    style={{ left: 0, top: GROUP_ROW_H, minWidth: USER_COL_W, width: USER_COL_W }}
                  />
                  {columns.map((s, i) => (
                    <th
                      key={s.key}
                      title={s.name}
                      className={cn('sticky z-30 border-b border-slate-200 p-0 align-bottom', groupStart(i) && 'border-l border-l-slate-300')}
                      style={{ top: GROUP_ROW_H, height: SECTION_ROW_H, minWidth: COL_W, width: COL_W }}
                    >
                      <div className="flex items-end justify-center pb-2" style={{ height: SECTION_ROW_H }}>
                        <span className="whitespace-nowrap text-[10px] font-semibold" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{s.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="group">
                    <td
                      className="am-user sticky z-20 border-b border-r border-slate-100 px-3 py-1.5"
                      style={{ left: 0, minWidth: USER_COL_W, width: USER_COL_W }}
                    >
                      <button onClick={() => onEditUser(user.id)} className="block w-full text-left" title="Open full editor">
                        <span className={cn('block truncate text-[13px] font-semibold', user.isActive ? 'text-slate-900' : 'text-slate-400')}>
                          {user.fullName}{!user.canManage && <span className="ml-1 text-[9px] font-bold uppercase text-slate-300">read-only</span>}
                        </span>
                        <span className="block truncate text-[10.5px] text-slate-500">{roleLabels[user.role] || user.role}{user.branchLabel ? ` · ${user.branchLabel}` : ''} · {countVisible(user.id)} visible</span>
                      </button>
                    </td>
                    {columns.map((s, i) => {
                      const cell = data.access[user.id]?.[s.key]
                      const checked = desired(user.id, s.key)
                      const dirty = isDirty(user.id, s.key)
                      const override = checked !== (cell?.defaultVisible ?? false)
                      return (
                        <td
                          key={s.key}
                          className={cn('border-b border-slate-100 text-center group-hover:bg-slate-50', groupStart(i) && 'border-l border-l-slate-200', dirty && 'bg-indigo-50/60')}
                          style={{ minWidth: COL_W, width: COL_W }}
                        >
                          <div className="relative flex h-8 items-center justify-center">
                            <button
                              type="button"
                              disabled={!user.canManage}
                              onClick={() => toggle(user, s.key)}
                              title={user.canManage ? (checked ? 'Deny access' : 'Grant access') : 'Managed by Developer'}
                              className={cn(
                                'am-check flex h-5 w-5 items-center justify-center rounded-[5px] border transition',
                                checked && 'is-on',
                                user.canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
                                dirty && 'ring-2 ring-indigo-400 ring-offset-1',
                              )}
                            >
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </button>
                            {override && !dirty && <span className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-500" title="Explicit override" />}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-3 py-10 text-center text-sm text-slate-400">No users match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <p className="text-[13px] font-bold text-slate-900">Can access <span className="text-emerald-600">{sectionUsers.withAccess.length}</span></p>
                <p className="text-[11px] text-slate-400">{data.sections.find((s) => s.key === sectionKey)?.name}</p>
              </div>
              <div className="max-h-[60vh] space-y-1 overflow-y-auto">
                {sectionUsers.withAccess.map((u) => (
                  <button key={u.id} onClick={() => onEditUser(u.id)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50">
                    <span><span className="text-[13px] font-semibold text-slate-900">{u.fullName}</span><span className="block text-[11px] text-slate-500">{roleLabels[u.role] || u.role}{u.branchLabel ? ` · ${u.branchLabel}` : ''}</span></span>
                    {data.access[u.id]?.[sectionKey]?.override && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">override</span>}
                  </button>
                ))}
                {sectionUsers.withAccess.length === 0 && <p className="px-2 py-6 text-center text-xs text-slate-400">No one can access this section.</p>}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-[13px] font-bold text-slate-900">No access <span className="text-slate-400">({sectionUsers.without.length})</span></p>
              <div className="max-h-[60vh] space-y-1 overflow-y-auto">
                {sectionUsers.without.map((u) => (
                  <button key={u.id} onClick={() => onEditUser(u.id)} className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-50">
                    <span><span className="text-[13px] font-semibold text-slate-600">{u.fullName}</span><span className="block text-[11px] text-slate-400">{roleLabels[u.role] || u.role}{u.branchLabel ? ` · ${u.branchLabel}` : ''}</span></span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Sticky save bar */}
      {changeCount > 0 && (
        <div className="sticky bottom-4 z-20">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white shadow-xl">
            <span className="text-[13px] font-bold">{changeCount} change{changeCount === 1 ? '' : 's'} across {Object.keys(edits).length} user{Object.keys(edits).length === 1 ? '' : 's'}</span>
            <span className="hidden text-[11px] text-slate-400 sm:inline">Every change is written to the permission audit log.</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setEdits({})}>
                <X className="h-3.5 w-3.5" /> Discard
              </Button>
              <Button size="sm" className="gap-1.5 bg-indigo-500 text-white hover:bg-indigo-400" disabled={saving} onClick={() => void save()}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save access
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
