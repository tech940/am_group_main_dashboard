'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, ListChecks, Loader2, Plus, TriangleAlert, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { canDelegateTasks, canViewAllDelegationTasks } from '@/lib/delegation/access'

// ── Types (match the server payload) ─────────────────────────────────────────────────────────────
type TaskRow = {
  id: string
  title: string
  description: string | null
  assignedTo: string
  assignedName: string | null
  assignedEmail: string | null
  dueAt: string | null
  status: 'assigned' | 'in_progress' | 'done' | 'cancelled'
  priority: 'low' | 'normal' | 'high'
  brand: string | null
  completionRemark: string | null
  completedAt: string | null
  createdBy: string
  createdAt: string
  viewerIsCreator: boolean
  viewerIsAssignee: boolean
  viewerCanManage: boolean
  viewerIsEa: boolean
  isOverdue: boolean
}
type Activity = { id: string; type: string; message: string | null; actorName: string; actorRole: string; createdAt: string }
type Assignee = { id: string; fullName: string; email: string; role: string; brand: string | null }
type BrandRollup = { brand: string; assigned: number; in_progress: number; done: number; cancelled: number; overdue: number; total: number }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`)
  return res.json()
}

const STATUS_LABEL: Record<TaskRow['status'], string> = { assigned: 'Assigned', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }
const STATUS_STYLE: Record<TaskRow['status'], string> = {
  assigned: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-indigo-100 text-indigo-700',
  done: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-400 line-through',
}
const PRIORITY_STYLE: Record<TaskRow['priority'], string> = {
  low: 'bg-slate-100 text-slate-500',
  normal: 'bg-sky-100 text-sky-700',
  high: 'bg-rose-100 text-rose-700',
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}
function fmtDateTime(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────
export function DelegationTasksPage({ currentUserRole, currentUserId, currentUserBrand }: { currentUserRole?: string; currentUserId?: string; currentUserBrand?: string | null }) {
  const queryClient = useQueryClient()
  const canDelegate = canDelegateTasks(currentUserRole)
  const groupWide = canViewAllDelegationTasks({ role: currentUserRole, brand: currentUserBrand })

  const isLeader = ['md', 'developer', 'ea'].includes(String(currentUserRole || '').trim().toLowerCase())
  const [tab, setTab] = useState<'mine' | 'delegated' | 'all'>(isLeader ? 'all' : 'mine')
  const [statusFilter, setStatusFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [delegateOpen, setDelegateOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: ['delegation-tasks', tab, statusFilter, brandFilter, search],
    queryFn: () => fetchJson<{ rows: TaskRow[]; rollup: BrandRollup[] | null; groupWide: boolean }>(
      `/api/delegation-tasks?tab=${tab}&status=${statusFilter}&brand=${brandFilter}&search=${encodeURIComponent(search)}`,
    ),
    staleTime: 10_000,
  })
  const rows = useMemo(() => listQuery.data?.rows ?? [], [listQuery.data])

  useEffect(() => {
    if (rows.length) {
      rows.forEach((r) => {
        queryClient.prefetchQuery({
          queryKey: ['delegation-task', r.id],
          queryFn: () => fetchJson<{ task: TaskRow; activity: Activity[] }>(`/api/delegation-tasks/${r.id}`),
          staleTime: 60_000,
        })
      })
    }
  }, [rows, queryClient])

  const rollup = listQuery.data?.rollup ?? null

  const kpis = useMemo(() => {
    const mine = rows.filter((r) => r.viewerIsAssignee)
    return {
      open: mine.filter((r) => r.status === 'assigned' || r.status === 'in_progress').length,
      overdue: mine.filter((r) => r.isOverdue).length,
      inProgress: mine.filter((r) => r.status === 'in_progress').length,
      done: mine.filter((r) => r.status === 'done').length,
    }
  }, [rows])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['delegation-tasks'] })

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<ListChecks className="h-4 w-4" />} label="My Open" value={kpis.open} tone="text-slate-800" />
        <Kpi icon={<TriangleAlert className="h-4 w-4" />} label="Overdue" value={kpis.overdue} tone="text-rose-600" />
        <Kpi icon={<Clock className="h-4 w-4" />} label="In Progress" value={kpis.inProgress} tone="text-indigo-600" />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Completed" value={kpis.done} tone="text-emerald-600" />
      </div>

      {/* Cross-branch rollup — group MD only. Click a brand card to drill the list into it. */}
      {groupWide && rollup && rollup.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Tasks by branch</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {rollup.map((b) => (
              <button key={b.brand} onClick={() => setBrandFilter(brandFilter === b.brand ? 'all' : b.brand)}
                className={cn('rounded-2xl border p-3 text-left transition', brandFilter === b.brand ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300')}>
                <p className="text-xs font-black uppercase tracking-wider text-slate-700">{b.brand}</p>
                <p className="mt-0.5 text-2xl font-black text-slate-900">{b.total}<span className="ml-1 text-xs font-bold text-slate-400">tasks</span></p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold">
                  <span className="text-slate-500">{b.assigned + b.in_progress} open</span>
                  {b.overdue > 0 && <span className="text-rose-600">{b.overdue} overdue</span>}
                  <span className="text-emerald-600">{b.done} done</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5">
          <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')}>My Tasks</TabBtn>
          {canDelegate && <TabBtn active={tab === 'delegated'} onClick={() => setTab('delegated')}>Delegated by Me</TabBtn>}
          {canDelegate && <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>{groupWide ? 'All Tasks' : 'My Branch'}</TabBtn>}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="done">Done</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        {groupWide && rollup && rollup.length > 0 && (
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="h-9 w-36 rounded-xl text-xs font-bold"><SelectValue placeholder="Branch" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {rollup.map((b) => <SelectItem key={b.brand} value={b.brand} className="capitalize">{b.brand}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title or assignee…" className="h-9 w-56 rounded-xl" />
        <div className="ml-auto">
          {canDelegate && (
            <Button onClick={() => setDelegateOpen(true)} className="h-9 gap-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> Delegate Task
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-4 py-2.5 text-left">Task</th>
                <th className="px-4 py-2.5 text-left">Assignee</th>
                <th className="px-4 py-2.5 text-left">Priority</th>
                <th className="px-4 py-2.5 text-left">Due</th>
                <th className="px-4 py-2.5 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr>
              )}
              {!listQuery.isLoading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">No tasks here yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpenId(r.id)}
                  className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-800">{r.title}</p>
                      {groupWide && r.brand && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">{r.brand}</span>}
                    </div>
                    {r.description && <p className="line-clamp-1 text-xs text-slate-400">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.assignedName || '—'}</td>
                  <td className="px-4 py-3"><span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold capitalize', PRIORITY_STYLE[r.priority])}>{r.priority}</span></td>
                  <td className="px-4 py-3">
                    <span className={cn('text-slate-600', r.isOverdue && 'font-bold text-rose-600')}>{fmtDate(r.dueAt)}{r.isOverdue && ' · overdue'}</span>
                  </td>
                  <td className="px-4 py-3"><span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', STATUS_STYLE[r.status])}>{STATUS_LABEL[r.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {openId && (() => {
        const selectedTask = rows.find(r => r.id === openId)
        return (
          <TaskDrawer taskId={openId} initialTask={selectedTask} onClose={() => setOpenId(null)} onChanged={invalidate}
            canDelegate={canDelegate} assigneesEnabled={canDelegate} />
        )
      })()}
      {delegateOpen && (
        <DelegateDialog onClose={() => setDelegateOpen(false)} onCreated={() => { setDelegateOpen(false); invalidate() }} />
      )}
    </div>
  )
}

// ── Drawer ─────────────────────────────────────────────────────────────────────────────────────
function TaskDrawer({ taskId, initialTask, onClose, onChanged, canDelegate, assigneesEnabled }: {
  taskId: string; initialTask?: TaskRow; onClose: () => void; onChanged: () => void; canDelegate: boolean; assigneesEnabled: boolean
}) {
  const queryClient = useQueryClient()
  const [remark, setRemark] = useState('')
  const [reassignTo, setReassignTo] = useState('')
  const detailQuery = useQuery({
    queryKey: ['delegation-task', taskId],
    queryFn: () => fetchJson<{ task: TaskRow; activity: Activity[] }>(`/api/delegation-tasks/${taskId}`),
    placeholderData: initialTask ? { task: initialTask, activity: [] } : undefined,
  })
  const assigneesQuery = useQuery({
    queryKey: ['delegation-assignees'],
    queryFn: () => fetchJson<{ assignees: Assignee[] }>(`/api/delegation-tasks/assignees`),
    enabled: assigneesEnabled,
    staleTime: 5 * 60 * 1000,
  })

  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchJson(`/api/delegation-tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegation-task', taskId] })
      onChanged()
      setRemark(''); setReassignTo('')
    },
  })

  const task = detailQuery.data?.task
  const isOpen = task && (task.status === 'assigned' || task.status === 'in_progress')

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30" />
      <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Task</p>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {!task ? (
          <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <h2 className="text-lg font-black text-slate-900">{task.title}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', STATUS_STYLE[task.status])}>{STATUS_LABEL[task.status]}</span>
              <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold capitalize', PRIORITY_STYLE[task.priority])}>{task.priority} priority</span>
            </div>
            {task.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{task.description}</p>}

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Field label="Assignee" value={task.assignedName || '—'} />
              <Field label="Due" value={fmtDate(task.dueAt)} tone={task.isOverdue ? 'text-rose-600' : undefined} />
              <Field label="Created" value={fmtDateTime(task.createdAt)} />
              {task.completedAt && <Field label="Completed" value={fmtDateTime(task.completedAt)} />}
            </dl>
            {task.completionRemark && (
              <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Completion remark</p>
                <p className="mt-1 whitespace-pre-wrap">{task.completionRemark}</p>
              </div>
            )}

            {/* Actions */}
            <div className="mt-5 space-y-3">
              {task.viewerIsAssignee && task.status === 'assigned' && (
                <Button onClick={() => action.mutate({ action: 'start' })} disabled={action.isPending}
                  className="w-full rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">Start working</Button>
              )}
              {task.viewerIsEa && isOpen && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Complete task</p>
                  <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What was done? (required)" className="mt-2 h-20 rounded-lg" />
                  <Button onClick={() => action.mutate({ action: 'complete', completionRemark: remark })}
                    disabled={action.isPending || !remark.trim()}
                    className="mt-2 w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Mark Done</Button>
                </div>
              )}
              {task.viewerCanManage && task.status === 'done' && (
                <Button variant="outline" onClick={() => action.mutate({ action: 'reopen' })} disabled={action.isPending}
                  className="w-full rounded-xl">Reopen task</Button>
              )}
              {task.viewerCanManage && isOpen && canDelegate && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reassign</p>
                  <Select value={reassignTo} onValueChange={setReassignTo}>
                    <SelectTrigger className="mt-2 h-9 rounded-lg"><SelectValue placeholder="Choose a person…" /></SelectTrigger>
                    <SelectContent>
                      {(assigneesQuery.data?.assignees ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.fullName} · {a.role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={() => action.mutate({ action: 'reassign', assignedTo: reassignTo })}
                    disabled={action.isPending || !reassignTo} variant="outline" className="mt-2 w-full rounded-xl">Reassign</Button>
                </div>
              )}
              {task.viewerCanManage && isOpen && (
                <Button variant="outline" onClick={() => action.mutate({ action: 'cancel' })} disabled={action.isPending}
                  className="w-full rounded-xl text-rose-600 hover:bg-rose-50">Cancel task</Button>
              )}
              {action.error && <p className="text-sm font-semibold text-rose-600">{(action.error as Error).message}</p>}
            </div>

            {/* Activity */}
            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Activity</p>
              <ol className="mt-2 space-y-3 border-l border-slate-200 pl-4">
                {(detailQuery.data?.activity ?? []).map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-indigo-400" />
                    <p className="text-sm font-semibold capitalize text-slate-700">{a.type.replace(/_/g, ' ')}</p>
                    {a.message && <p className="text-xs text-slate-500">{a.message}</p>}
                    <p className="text-[11px] text-slate-400">{a.actorName} · {fmtDateTime(a.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Delegate dialog ─────────────────────────────────────────────────────────────────────────────
function DelegateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [priority, setPriority] = useState('normal')

  const assigneesQuery = useQuery({
    queryKey: ['delegation-assignees'],
    queryFn: () => fetchJson<{ assignees: Assignee[] }>(`/api/delegation-tasks/assignees`),
    staleTime: 5 * 60 * 1000,
  })
  const create = useMutation({
    mutationFn: () => fetchJson(`/api/delegation-tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, assignedTo, dueAt: dueAt || null, priority }),
    }),
    onSuccess: onCreated,
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader><DialogTitle>Delegate a task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" className="mt-1 rounded-xl" />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Details</label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Context, links, expectations…" className="mt-1 h-20 rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Assign to</label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue placeholder="Choose a person…" /></SelectTrigger>
                <SelectContent>
                  {(assigneesQuery.data?.assignees ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.fullName} · {a.role}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Due date</label>
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 rounded-xl" />
          </div>
          {create.error && <p className="text-sm font-semibold text-rose-600">{(create.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !title.trim() || !assignedTo}
              className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
              {create.isPending ? 'Delegating…' : 'Delegate'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Small bits ─────────────────────────────────────────────────────────────────────────────────
function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <Card className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-1.5 text-slate-400">{icon}<span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <p className={cn('mt-1 text-2xl font-black', tone)}>{value}</p>
    </Card>
  )
}
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition', active ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800')}>
      {children}
    </button>
  )
}
function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</dt>
      <dd className={cn('mt-0.5 font-semibold text-slate-700', tone)}>{value}</dd>
    </div>
  )
}
