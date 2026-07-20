'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, ListChecks, Loader2, Plus, TriangleAlert, X, Check, MessageSquare, Mail, MessageCircle, Phone, UserPlus, Download } from 'lucide-react'
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
  assignedPhone: string | null
  dueAt: string | null
  followUpAt: string | null
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
type Assignee = { id: string; fullName: string; email: string; role: string; brand: string | null; phoneNumber?: string; isExternal?: boolean }
type BrandRollup = { brand: string; assigned: number; in_progress: number; done: number; cancelled: number; overdue: number; total: number }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`)
  return res.json()
}

const STATUS_LABEL: Record<TaskRow['status'], string> = { assigned: 'Assigned', in_progress: 'In Progress', done: 'Done', cancelled: 'Cancelled' }
const STATUS_STYLE: Record<TaskRow['status'], string> = {
  assigned: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-slate-100 text-slate-700',
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

function getWhatsAppLink(r: any) {
  if (!r.assignedPhone) return null
  let phone = r.assignedPhone.replace(/\D/g, '')
  if (phone.length === 10) phone = '91' + phone
  const msg = `Hi ${r.assignedName}, reminder for task: "${r.description || r.title}". Due on: ${fmtDate(r.dueAt)}. Please action it.`
  return `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}`
}

function getEmailLink(r: any) {
  if (!r.assignedEmail) return null
  const subject = `Task Reminder: ${r.title}`
  const body = `Hi ${r.assignedName},\n\nThis is a reminder for the delegated task: "${r.description || r.title}".\nDue Date: ${fmtDate(r.dueAt)}\n\nPlease action it.\n\nBest regards.`
  return `mailto:${r.assignedEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────
export function DelegationTasksPage({ currentUserRole, currentUserId, currentUserBrand }: { currentUserRole?: string; currentUserId?: string; currentUserBrand?: string | null }) {
  const queryClient = useQueryClient()
  const canDelegate = canDelegateTasks(currentUserRole)
  const groupWide = canViewAllDelegationTasks({ role: currentUserRole, brand: currentUserBrand })
  const isEa = ['ea', 'eba', 'admin', 'developer'].includes(String(currentUserRole || '').trim().toLowerCase())

  const isLeader = ['md', 'developer', 'admin', 'ea', 'eba'].includes(String(currentUserRole || '').trim().toLowerCase())
  const [tab, setTab] = useState<'mine' | 'delegated' | 'all'>(isLeader ? 'all' : 'mine')
  const [statusFilter, setStatusFilter] = useState('assigned')
  const [brandFilter, setBrandFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [noteTaskId, setNoteTaskId] = useState<string | null>(null)
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null)
  const [reassignTaskId, setReassignTaskId] = useState<string | null>(null)
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'list' | 'performance'>('list')
  const [selectedEmp, setSelectedEmp] = useState<any | null>(null)
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string; type: 'success' | 'error' | 'info' } | null>(null)

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)

  useEffect(() => {
    setSelectedTaskIds([])
  }, [tab, statusFilter, brandFilter, search])

  const handleBulkComplete = async () => {
    if (selectedTaskIds.length === 0) return
    setBulkLoading(true)
    try {
      let successCount = 0
      let failCount = 0
      
      await Promise.all(selectedTaskIds.map(async (taskId) => {
        try {
          await fetchJson(`/api/delegation-tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'complete' })
          })
          successCount++
        } catch {
          failCount++
        }
      }))

      invalidate()
      setSelectedTaskIds([])
      setAlertInfo({
        title: 'Bulk Completion',
        message: `Successfully marked ${successCount} task(s) as completed.${failCount > 0 ? ` Failed to mark ${failCount} task(s).` : ''}`,
        type: successCount > 0 ? 'success' : 'error'
      })
    } catch (err) {
      setAlertInfo({
        title: 'Error',
        message: (err as Error).message || 'Failed to perform bulk completion',
        type: 'error'
      })
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkEmail = async () => {
    if (selectedTaskIds.length === 0) return
    setBulkLoading(true)
    try {
      let successCount = 0
      let failCount = 0

      await Promise.all(selectedTaskIds.map(async (taskId) => {
        try {
          await fetchJson(`/api/delegation-tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remind' })
          })
          successCount++
        } catch {
          failCount++
        }
      }))

      invalidate()
      setSelectedTaskIds([])
      setAlertInfo({
        title: 'Bulk Reminders',
        message: `Successfully sent reminders for ${successCount} task(s).${failCount > 0 ? ` Failed for ${failCount} task(s).` : ''}`,
        type: successCount > 0 ? 'success' : 'error'
      })
    } catch (err) {
      setAlertInfo({
        title: 'Error',
        message: (err as Error).message || 'Failed to send bulk reminders',
        type: 'error'
      })
    } finally {
      setBulkLoading(false)
    }
  }

  const remindMutation = useMutation({
    mutationFn: (taskId: string) => {
      setSendingEmailId(taskId)
      return fetchJson(`/api/delegation-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remind' })
      })
    },
    onSuccess: () => {
      setAlertInfo({
        title: 'Success',
        message: 'Reminder email dispatched successfully to the assignee!',
        type: 'success'
      })
      setSendingEmailId(null)
      invalidate()
    },
    onError: (err) => {
      setAlertInfo({
        title: 'Error',
        message: (err as Error).message || 'Failed to send reminder email',
        type: 'error'
      })
      setSendingEmailId(null)
    }
  })

  const completeMutation = useMutation({
    mutationFn: (taskId: string) => {
      setCompletingTaskId(taskId)
      return fetchJson(`/api/delegation-tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      })
    },
    onSuccess: () => {
      setCompletingTaskId(null)
      invalidate()
    },
    onError: (err) => {
      setAlertInfo({
        title: 'Error',
        message: (err as Error).message || 'Failed to mark task as done',
        type: 'error'
      })
      setCompletingTaskId(null)
    }
  })

  const listQuery = useQuery({
    queryKey: ['delegation-tasks', tab, brandFilter, search],
    queryFn: () => fetchJson<{ rows: TaskRow[]; rollup: BrandRollup[] | null; groupWide: boolean }>(
      `/api/delegation-tasks?tab=${tab}&brand=${brandFilter}&search=${encodeURIComponent(search)}`,
    ),
    staleTime: 10_000,
  })
  const rows = useMemo(() => listQuery.data?.rows ?? [], [listQuery.data])

  const filteredRows = useMemo(() => {
    if (statusFilter === 'all') return rows
    return rows.filter((r) => r.status === statusFilter)
  }, [rows, statusFilter])

  const handleExportCsv = () => {
    if (filteredRows.length === 0) {
      setAlertInfo({
        title: 'Export CSV',
        message: 'No tasks to export.',
        type: 'info'
      })
      return
    }

    const headers = ['Employee Name', 'Task Title', 'Description', 'Priority', 'Status', 'Due Date', 'Follow-up Date', 'Completed At', 'Created At']
    const csvContent = [
      headers.join(','),
      ...filteredRows.map(r => {
        const row = [
          r.assignedName || '',
          r.title || '',
          r.description || '',
          r.priority || '',
          r.status || '',
          r.dueAt ? new Date(r.dueAt).toISOString().split('T')[0] : '',
          r.followUpAt ? new Date(r.followUpAt).toISOString().split('T')[0] : '',
          r.completedAt ? new Date(r.completedAt).toISOString().split('T')[0] : '',
          r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : ''
        ]
        return row.map(val => `"${String(val ?? '').replace(/"/g, '""')}"`).join(',')
      })
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `delegation-tasks-${tab}-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const perfQuery = useQuery({
    queryKey: ['delegation-performance'],
    queryFn: () => fetchJson<{ leaderboard: any[] }>('/api/delegation-tasks/performance'),
    enabled: activeView === 'performance',
    staleTime: 30_000,
  })

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
    const list = tab === 'mine'
      ? rows.filter((r) => r.viewerIsAssignee)
      : tab === 'delegated'
      ? rows.filter((r) => r.viewerIsCreator)
      : rows
    return {
      open: list.filter((r) => r.status === 'assigned').length,
      overdue: list.filter((r) => r.isOverdue).length,
      done: list.filter((r) => r.status === 'done').length,
    }
  }, [rows, tab])

  const weeklyPerformance = useMemo(() => {
    if (!rows.length) return []
    const groups: Record<string, { weekStart: string; onTime: number; delayed: number; pending: number; total: number; timestamp: number }> = {}
    
    rows.forEach(r => {
      if (!r.dueAt) return
      const d = new Date(r.dueAt)
      if (Number.isNaN(d.getTime())) return
      
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(d.getFullYear(), d.getMonth(), diff)
      const weekLabel = `Week of ${monday.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
      const key = monday.getTime().toString()
      
      if (!groups[key]) {
        groups[key] = { weekStart: weekLabel, onTime: 0, delayed: 0, pending: 0, total: 0, timestamp: monday.getTime() }
      }
      
      const isDone = r.status === 'done'
      const due = r.dueAt ? new Date(r.dueAt) : null
      const completed = r.completedAt ? new Date(r.completedAt) : null
      
      let status: 'ontime' | 'delayed' | 'pending' = 'pending'
      if (isDone) {
        if (!due || !completed || completed <= due) {
          status = 'ontime'
        } else {
          status = 'delayed'
        }
      } else {
        if (due && due < new Date()) {
          status = 'delayed'
        } else {
          status = 'pending'
        }
      }
      
      groups[key].total++
      if (status === 'ontime') groups[key].onTime++
      else if (status === 'delayed') groups[key].delayed++
      else groups[key].pending++
    })
    
    return Object.values(groups)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4)
  }, [rows])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['delegation-tasks'] })

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi icon={<ListChecks className="h-4 w-4" />} label={tab === 'mine' ? 'My Open' : tab === 'delegated' ? 'Delegated Open' : 'Total Open'} value={kpis.open} tone="text-slate-800" />
        <Kpi icon={<TriangleAlert className="h-4 w-4" />} label="Overdue" value={kpis.overdue} tone="text-rose-600" />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label={tab === 'mine' ? 'Completed' : tab === 'delegated' ? 'Delegated Done' : 'Total Completed'} value={kpis.done} tone="text-emerald-600" />
      </div>

      {/* Weekly Performance Scoring */}
      {weeklyPerformance.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Weekly Performance (On-Time vs Delayed)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {weeklyPerformance.map((w) => {
              const score = w.total > 0 ? Math.round((w.onTime / w.total) * 100) : 0
              return (
                <Card key={w.weekStart} className="rounded-2xl border border-slate-200 p-4 bg-white shadow-sm">
                  <p className="text-xs font-bold text-slate-600">{w.weekStart}</p>
                  <div className="mt-2 flex items-baseline justify-between">
                    <p className="text-2xl font-black text-slate-900">{score}%</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">On-Time Score</p>
                  </div>
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-slate-800 rounded-full" style={{ width: `${score}%` }} />
                  </div>
                  <div className="mt-2.5 flex justify-between text-[10px] font-bold text-slate-500">
                    <span className="text-slate-700">{w.onTime} On-Time</span>
                    <span className="text-rose-600">{w.delayed} Delayed</span>
                    <span>{w.total} Total</span>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Cross-branch rollup — group MD only. Click a brand card to drill the list into it. */}
      {groupWide && rollup && rollup.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Tasks by branch</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {rollup.map((b) => (
              <button key={b.brand} onClick={() => setBrandFilter(brandFilter === b.brand ? 'all' : b.brand)}
                className={cn('rounded-2xl border p-3 text-left transition', brandFilter === b.brand ? 'border-slate-800 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300')}>
                <p className="text-xs font-black uppercase tracking-wider text-slate-700">{b.brand}</p>
                <p className="mt-0.5 text-2xl font-black text-slate-900">{b.total}<span className="ml-1 text-xs font-bold text-slate-400">tasks</span></p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold">
                  <span className="text-slate-500">{b.assigned} open</span>
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
          <TabBtn active={tab === 'mine' && activeView === 'list'} onClick={() => { setTab('mine'); setActiveView('list'); }}>My Tasks</TabBtn>
          {canDelegate && <TabBtn active={tab === 'delegated' && activeView === 'list'} onClick={() => { setTab('delegated'); setActiveView('list'); }}>Delegated by Me</TabBtn>}
          {canDelegate && <TabBtn active={tab === 'all' && activeView === 'list'} onClick={() => { setTab('all'); setActiveView('list'); }}>{groupWide ? 'All Tasks' : 'My Branch'}</TabBtn>}
        </div>

        {/* View Switcher */}
        <div className="flex rounded-xl border border-slate-200 bg-white p-0.5 ml-1">
          <TabBtn active={activeView === 'list'} onClick={() => setActiveView('list')}>Tasks List</TabBtn>
          <TabBtn active={activeView === 'performance'} onClick={() => setActiveView('performance')}>Performance Leaderboard</TabBtn>
        </div>

        {activeView === 'list' && (
          <>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-bold"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="assigned">Active / Assigned</SelectItem>
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
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canDelegate && activeView === 'list' && (
            <Button onClick={handleExportCsv} variant="outline" className="h-9 gap-1.5 rounded-xl border-slate-200 hover:bg-slate-50 font-black text-slate-700 text-xs px-3 shadow-none">
              <Download className="h-3.5 w-3.5 text-slate-500" /> Export CSV
            </Button>
          )}
          {canDelegate && (
            <Button onClick={() => setDelegateOpen(true)} className="h-9 gap-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800">
              <Plus className="h-4 w-4" /> Delegate Task
            </Button>
          )}
        </div>
      </div>

      {activeView === 'list' && selectedTaskIds.length > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-2xl mb-4 shadow-lg animate-in fade-in slide-in-from-top-4">
          <span className="text-xs font-black">{selectedTaskIds.length} task(s) selected</span>
          <div className="flex items-center gap-2 ml-auto">
            {isEa && (
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={handleBulkComplete}
                className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-8 text-xs font-black px-3 shadow-sm border border-emerald-500"
              >
                {bulkLoading ? 'Processing...' : 'Mark Done'}
              </Button>
            )}
            <Button
              size="sm"
              disabled={bulkLoading}
              onClick={handleBulkEmail}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl h-8 text-xs font-black px-3 shadow-sm border border-violet-500"
            >
              {bulkLoading ? 'Processing...' : 'Send Reminders'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkLoading}
              onClick={() => setSelectedTaskIds([])}
              className="text-slate-400 hover:text-white rounded-xl h-8 text-xs font-bold px-3 hover:bg-slate-800"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {activeView === 'list' ? (
        <Card className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <th className="px-4 py-2.5 text-left w-10">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4 cursor-pointer"
                      checked={filteredRows.length > 0 && selectedTaskIds.length === filteredRows.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTaskIds(filteredRows.map(r => r.id))
                        } else {
                          setSelectedTaskIds([])
                        }
                      }}
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left">Employee</th>
                  <th className="px-4 py-2.5 text-left">Task</th>
                  <th className="px-4 py-2.5 text-left">Due Date</th>
                  <th className="px-4 py-2.5 text-left">Follow-up Date</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr>
                )}
                {!listQuery.isLoading && filteredRows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-sm font-semibold text-slate-400">No tasks here yet.</td></tr>
                )}
                {filteredRows.map((r) => {
                  const waUrl = getWhatsAppLink(r)
                  const emailUrl = getEmailLink(r)
                  return (
                    <tr key={r.id} onClick={() => setOpenId(r.id)}
                      className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/70">
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4 cursor-pointer"
                          checked={selectedTaskIds.includes(r.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTaskIds(prev => [...prev, r.id])
                            } else {
                              setSelectedTaskIds(prev => prev.filter(id => id !== r.id))
                            }
                          }}
                        />
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{r.assignedName || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-slate-800">{r.title}</p>
                          {groupWide && r.brand && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">{r.brand}</span>}
                        </div>
                        {r.description && <p className="line-clamp-1 text-xs text-slate-400 mt-0.5">{r.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className={cn(r.isOverdue && 'font-bold text-rose-600')}>{fmtDate(r.dueAt)}{r.isOverdue && ' · overdue'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{fmtDate(r.followUpAt)}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {/* Call button */}
                          {r.assignedPhone && (
                            <Button size="sm" variant="ghost"
                              onClick={() => setAlertInfo({
                                title: 'Mobile Number',
                                message: `Mobile number for ${r.assignedName}:\n${r.assignedPhone}`,
                                type: 'info'
                              })}
                              className="h-7 gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-black text-sky-600 hover:bg-sky-100 hover:text-sky-700 transition shadow-sm border border-sky-100">
                              <Phone className="h-3.5 w-3.5" /> Call
                            </Button>
                          )}
                          {/* WhatsApp button */}
                          {waUrl && (
                            <a href={waUrl} target="_blank" rel="noopener noreferrer" title="WhatsApp Assignee"
                              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 transition shadow-sm border border-emerald-100">
                              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                            </a>
                          )}
                          {/* Email button */}
                          {r.assignedEmail && (
                            <Button size="sm" variant="ghost" disabled={sendingEmailId === r.id}
                              onClick={() => remindMutation.mutate(r.id)}
                              className="h-7 gap-1.5 rounded-full bg-violet-50 text-violet-600 hover:bg-violet-100 hover:text-violet-700 font-black text-xs px-2.5 shadow-sm border border-violet-100 disabled:opacity-50">
                              <Mail className="h-3.5 w-3.5" /> {sendingEmailId === r.id ? 'Sending...' : 'Email'}
                            </Button>
                          )}
                          {/* Complete / Done button */}
                          {r.status === 'assigned' && r.viewerIsEa && (
                            <Button size="sm" variant="ghost" disabled={completingTaskId === r.id}
                              onClick={() => completeMutation.mutate(r.id)}
                              className="h-7 gap-1.5 rounded-full bg-teal-50 text-teal-600 hover:bg-teal-100 hover:text-teal-700 font-black text-xs px-2.5 shadow-sm border border-teal-100 disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" /> {completingTaskId === r.id ? 'Saving...' : 'Done'}
                            </Button>
                          )}
                          {/* Reassign button */}
                          {r.status === 'assigned' && r.viewerCanManage && canDelegate && (
                            <Button size="sm" variant="ghost" onClick={() => setReassignTaskId(r.id)}
                              className="h-7 gap-1.5 rounded-full bg-amber-50 text-amber-600 hover:bg-amber-100 hover:text-amber-700 font-black text-xs px-2.5 shadow-sm border border-amber-100">
                              <UserPlus className="h-3.5 w-3.5" /> Reassign
                            </Button>
                          )}
                          {/* Add Note button */}
                          <Button size="sm" variant="ghost" onClick={() => setNoteTaskId(r.id)}
                            className="h-7 gap-1.5 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-800 font-black text-xs px-2.5 shadow-sm border border-slate-200">
                            <MessageSquare className="h-3.5 w-3.5" /> Add Note
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="p-6 rounded-2xl border border-slate-200 bg-white">
          <div className="mb-4">
            <h3 className="text-lg font-black text-slate-900">Employee Performance Scorecard</h3>
            <p className="text-xs font-semibold text-slate-400">Completion ratio, overdue count, and rating scores analyzed for active task assignees.</p>
          </div>
          {perfQuery.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
          ) : !perfQuery.data?.leaderboard?.length ? (
            <div className="text-center py-12 text-sm font-semibold text-slate-400">No performance data available.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <th className="px-4 py-2.5 text-left w-20">Rank</th>
                    <th className="px-4 py-2.5 text-left">Employee</th>
                    <th className="px-4 py-2.5 text-center">Completed (On-time / Delayed)</th>
                    <th className="px-4 py-2.5 text-center">Pending (On-track / Overdue)</th>
                    <th className="px-4 py-2.5 text-center">Score (Marks)</th>
                    <th className="px-4 py-2.5 text-right">Rating / Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {perfQuery.data.leaderboard.map((u: any, idx: number) => {
                    const rank = idx + 1
                    let rankBadge = `${rank}`
                    if (rank === 1) rankBadge = '🏆 1st'
                    else if (rank === 2) rankBadge = '🥈 2nd'
                    else if (rank === 3) rankBadge = '🥉 3rd'
                    else rankBadge = `${rank}th`

                    return (
                      <tr key={u.name} onClick={() => setSelectedEmp(u)} className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                        <td className="px-4 py-3.5 font-black text-slate-800 text-xs">{rankBadge}</td>
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-slate-800">{u.name}</p>
                          {u.email && <p className="text-[11px] text-slate-400 mt-0.5">{u.email}</p>}
                        </td>
                        <td className="px-4 py-3.5 text-center font-semibold text-slate-600">
                          <span className="text-emerald-600">{u.onTime}</span>
                          <span className="text-slate-300 mx-1.5">/</span>
                          <span className="text-amber-600">{u.delayed}</span>
                          <span className="text-xs text-slate-400 font-bold ml-1">({u.onTime + u.delayed} done)</span>
                        </td>
                        <td className="px-4 py-3.5 text-center font-semibold text-slate-600">
                          <span className="text-sky-600">{u.onTrack}</span>
                          <span className="text-slate-300 mx-1.5">/</span>
                          <span className="text-rose-600">{u.overdue}</span>
                          <span className="text-xs text-slate-400 font-bold ml-1">({u.onTrack + u.overdue} open)</span>
                        </td>
                        <td className="px-4 py-3.5 text-center font-black text-slate-800 text-base">
                          {u.score} <span className="text-[10px] font-bold text-slate-400">/ 100</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-black uppercase tracking-wider",
                            u.color === 'emerald' && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                            u.color === 'teal' && "bg-teal-50 text-teal-700 border border-teal-200",
                            u.color === 'sky' && "bg-sky-50 text-sky-700 border border-sky-200",
                            u.color === 'amber' && "bg-amber-50 text-amber-700 border border-amber-200",
                            u.color === 'rose' && "bg-rose-50 text-rose-700 border border-rose-200"
                          )}>
                            {u.grade}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

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
      {noteTaskId && (
        <AddNoteDialog taskId={noteTaskId} onClose={() => setNoteTaskId(null)} onAdded={() => { setNoteTaskId(null); invalidate() }} />
      )}

      {reassignTaskId && (
        <ReassignTaskDialog taskId={reassignTaskId} onClose={() => setReassignTaskId(null)} onReassigned={() => { setReassignTaskId(null); invalidate() }} />
      )}
      {selectedEmp && (
        <EmployeeScoringBreakdownDialog
          employee={selectedEmp}
          onClose={() => setSelectedEmp(null)}
        />
      )}
      {alertInfo && (
        <Dialog open onOpenChange={(o) => { if (!o) setAlertInfo(null) }}>
          <DialogContent className="max-w-md rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-6">
            <div className="flex flex-col items-center text-center space-y-4 pt-2">
              <div className={cn(
                "rounded-full p-3 flex items-center justify-center",
                alertInfo.type === 'success' && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                alertInfo.type === 'error' && "bg-rose-50 text-rose-700 border border-rose-200",
                alertInfo.type === 'info' && "bg-sky-50 text-sky-700 border border-sky-200"
              )}>
                {alertInfo.type === 'success' && <CheckCircle2 className="h-6 w-6" />}
                {alertInfo.type === 'error' && <TriangleAlert className="h-6 w-6" />}
                {alertInfo.type === 'info' && <Phone className="h-6 w-6" />}
              </div>
              <DialogTitle className="text-lg font-black text-slate-900">{alertInfo.title}</DialogTitle>
              <p className="text-sm font-semibold text-slate-500 whitespace-pre-line leading-relaxed">{alertInfo.message}</p>
              <Button onClick={() => setAlertInfo(null)} className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800 h-10 font-bold">
                Dismiss
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
              {task.viewerIsEa && isOpen && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Complete task</p>
                  <Button onClick={() => action.mutate({ action: 'complete' })}
                    disabled={action.isPending}
                    className="mt-2 w-full rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Mark Task Done</Button>
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
                  <li key={a.id} className="relative text-left">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-slate-400" />
                    <p className="text-xs font-bold capitalize text-slate-800">{a.type.replace(/_/g, ' ')}</p>
                    {a.message && (
                      <p className={cn(
                        "mt-0.5 text-xs text-slate-500",
                        a.message.startsWith('Rescheduled: ') && "rounded-lg bg-amber-50 p-2 text-amber-800 border border-amber-100/50 mt-1 font-semibold whitespace-pre-line text-left"
                      )}>
                        {a.message.startsWith('Rescheduled: ') ? a.message.replace('Rescheduled: ', 'Reason: ') : a.message}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">{a.actorName} · {fmtDateTime(a.createdAt)}</p>
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
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueAt, setDueAt] = useState('')

  // Search and dropdown state for searchable selector
  const [searchEmp, setSearchEmp] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Manual contact details if "Other" is chosen
  const [extName, setExtName] = useState('')
  const [extEmail, setExtEmail] = useState('')
  const [extPhone, setExtPhone] = useState('')

  const assigneesQuery = useQuery({
    queryKey: ['delegation-assignees'],
    queryFn: () => fetchJson<{ assignees: Assignee[] }>(`/api/delegation-tasks/assignees`),
    staleTime: 5 * 60 * 1000,
  })

  // Filter assignees based on search input
  const filteredAssignees = useMemo(() => {
    const list = assigneesQuery.data?.assignees ?? []
    if (!searchEmp.trim()) return list
    const kw = searchEmp.toLowerCase()
    return list.filter(a =>
      a.fullName.toLowerCase().includes(kw) ||
      (a.role && a.role.toLowerCase().includes(kw))
    )
  }, [assigneesQuery.data?.assignees, searchEmp])

  const selectedAssignee = useMemo(() => {
    return (assigneesQuery.data?.assignees ?? []).find(a => a.id === assignedTo)
  }, [assigneesQuery.data?.assignees, assignedTo])

  const create = useMutation({
    mutationFn: () => {
      const payload: Record<string, any> = {
        assignedTo,
        description,
        dueAt: dueAt || null,
        isExternal: selectedAssignee?.isExternal || assignedTo === 'other'
      }
      if (assignedTo === 'other') {
        payload.externalContactName = extName
        payload.externalContactEmail = extEmail
        payload.externalContactPhone = extPhone
      }
      return fetchJson(`/api/delegation-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    },
    onSuccess: onCreated,
  })

  const isFormValid = useMemo(() => {
    if (!assignedTo) return false
    if (assignedTo === 'other') {
      if (!extName.trim() || !extPhone.trim()) return false
    }
    return description.trim().length > 0
  }, [assignedTo, extName, extPhone, description])

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-slate-900">Delegate a task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* 1. Employee Name (searchable dropdown) */}
          <div className="relative">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Employee Name</label>
            <Input
              value={searchEmp}
              onChange={(e) => {
                setSearchEmp(e.target.value)
                setDropdownOpen(true)
                setAssignedTo('')
              }}
              onFocus={() => setDropdownOpen(true)}
              placeholder="Search employee or external contact..."
              className="mt-1.5 h-10 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold"
            />
            {dropdownOpen && (
              <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                {filteredAssignees.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-500">No matches found.</div>
                )}
                {filteredAssignees.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAssignedTo(a.id)
                      setSearchEmp(a.fullName)
                      setDropdownOpen(false)
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50"
                  >
                    <div>
                      <p className="font-bold text-slate-800">{a.fullName}</p>
                      {a.email && <p className="text-[10px] text-slate-400">{a.email}</p>}
                    </div>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">{a.role}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setAssignedTo('other')
                    setSearchEmp('Other (Enter manually)')
                    setDropdownOpen(false)
                  }}
                  className="flex w-full items-center justify-between rounded-lg border-t border-slate-100 px-3 py-2.5 text-left text-xs text-slate-900 hover:bg-slate-50 font-bold"
                >
                  <span>Other...</span>
                  <span className="text-[9px] font-black uppercase text-slate-400">Add external contact</span>
                </button>
              </div>
            )}
          </div>

          {/* Manual inputs if Other is selected */}
          {assignedTo === 'other' && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 space-y-3">
              <p className="text-xs font-bold text-slate-700">Enter External Contact Details</p>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Name</label>
                <Input
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="Employee / Contact Name"
                  className="mt-1 h-9 rounded-xl border-slate-200 bg-white font-semibold"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Email</label>
                <Input
                  value={extEmail}
                  onChange={(e) => setExtEmail(e.target.value)}
                  placeholder="contact@email.com (optional)"
                  className="mt-1 h-9 rounded-xl border-slate-200 bg-white font-semibold"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Phone Number (Mandatory)</label>
                <Input
                  value={extPhone}
                  onChange={(e) => setExtPhone(e.target.value)}
                  placeholder="e.g. +91 98765 43210"
                  className="mt-1 h-9 rounded-xl border-slate-200 bg-white font-semibold"
                />
              </div>
            </div>
          )}

          {/* 2. Planned Date */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Planned Date</label>
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="mt-1.5 h-10 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold"
            />
          </div>

          {/* 3. Task Description */}
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Task Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs doing? Include context, expectations, links..."
              className="mt-1.5 h-24 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold"
            />
          </div>

          {create.error && <p className="text-xs font-semibold text-rose-600">{(create.error as Error).message}</p>}
          
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={create.isPending || !isFormValid}
              className="rounded-xl h-10 bg-slate-900 text-white hover:bg-slate-800"
            >
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
      className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition', active ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800')}>
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

function AddNoteDialog({ taskId, onClose, onAdded }: { taskId: string; onClose: () => void; onAdded: () => void }) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()

  const addNoteMutation = useMutation({
    mutationFn: () => fetchJson(`/api/delegation-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'comment', completionRemark: note })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegation-task', taskId] })
      onAdded()
    }
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-6">
        <DialogHeader><DialogTitle className="text-lg font-black text-slate-900">Add Note</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Type your note here..."
            className="h-28 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold"
          />
          {addNoteMutation.error && <p className="text-xs font-semibold text-rose-600">{(addNoteMutation.error as Error).message}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
            <Button
              onClick={() => addNoteMutation.mutate()}
              disabled={addNoteMutation.isPending || !note.trim()}
              className="rounded-xl h-10 bg-slate-900 text-white hover:bg-slate-800"
            >
              {addNoteMutation.isPending ? 'Saving...' : 'Add Note'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}



function ReassignTaskDialog({ taskId, onClose, onReassigned }: { taskId: string; onClose: () => void; onReassigned: () => void }) {
  const queryClient = useQueryClient()
  const [dueAt, setDueAt] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [remark, setRemark] = useState('')

  const taskQuery = useQuery({
    queryKey: ['delegation-task', taskId],
    queryFn: () => fetchJson<{ task: TaskRow; activity: any[] }>(`/api/delegation-tasks/${taskId}`),
  })

  useEffect(() => {
    if (taskQuery.data?.task) {
      const t = taskQuery.data.task
      if (t.dueAt) {
        setDueAt(new Date(t.dueAt).toISOString().split('T')[0])
      }
      if (t.followUpAt) {
        setFollowUpAt(new Date(t.followUpAt).toISOString().split('T')[0])
      }
    }
  }, [taskQuery.data?.task])

  const reassignMutation = useMutation({
    mutationFn: () => fetchJson(`/api/delegation-tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reassign',
        dueAt: dueAt || null,
        followUpAt: followUpAt || null,
        remark: remark
      })
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegation-task', taskId] })
      onReassigned()
    }
  })

  const task = taskQuery.data?.task

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-6">
        <DialogHeader><DialogTitle className="text-lg font-black text-slate-900">Reschedule / Reassign Task</DialogTitle></DialogHeader>
        {taskQuery.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Assignee</label>
              <Input
                value={task?.assignedName || '—'}
                disabled
                className="mt-1.5 h-10 rounded-xl bg-slate-50 border-slate-200 text-slate-500 font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Due Date</label>
                <Input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="mt-1.5 h-10 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold text-slate-700"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Follow-up Date</label>
                <Input
                  type="date"
                  value={followUpAt}
                  onChange={(e) => setFollowUpAt(e.target.value)}
                  className="mt-1.5 h-10 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold text-slate-700"
                />
              </div>
            </div>
            
            <div>
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Remark / Reason for Delay (Mandatory)</label>
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="Explain why this task is being rescheduled/delayed..."
                className="mt-1.5 h-20 rounded-xl border-slate-200 focus:ring-slate-900 font-semibold text-slate-700"
              />
            </div>

            {reassignMutation.error && <p className="text-xs font-semibold text-rose-600">{(reassignMutation.error as Error).message}</p>}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={onClose} className="rounded-xl h-10">Cancel</Button>
              <Button
                onClick={() => reassignMutation.mutate()}
                disabled={reassignMutation.isPending || !remark.trim()}
                className="rounded-xl h-10 bg-slate-900 text-white hover:bg-slate-800"
              >
                {reassignMutation.isPending ? 'Rescheduling...' : 'Update Dates'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EmployeeScoringBreakdownDialog({ employee, onClose }: {
  employee: any
  onClose: () => void
}) {
  const [subTab, setSubTab] = useState<'all' | 'pending' | 'completed'>('all')

  const breakdownQuery = useQuery({
    queryKey: ['delegation-performance-breakdown', employee.email, employee.name],
    queryFn: () => fetchJson<{ tasks: any[] }>(
      `/api/delegation-tasks/performance/breakdown?email=${encodeURIComponent(employee.email || '')}&name=${encodeURIComponent(employee.name || '')}`
    ),
    staleTime: 30_000,
  })

  if (breakdownQuery.isLoading) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-w-md rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-12 flex flex-col items-center justify-center">
          <DialogTitle className="sr-only">Loading breakdown data</DialogTitle>
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <p className="mt-2 text-xs font-bold text-slate-400">Loading breakdown data...</p>
        </DialogContent>
      </Dialog>
    )
  }

  const rawTasks = breakdownQuery.data?.tasks ?? []
  const now = new Date()

  // Group tasks by category and score
  const items = rawTasks.map((t: any) => {
    let category = 'Unknown'
    let points = 0
    let statusLabel = ''

    if (t.status === 'done') {
      const completed = t.completedAt ? new Date(t.completedAt) : null
      const due = t.dueAt ? new Date(t.dueAt) : null
      if (completed && due && completed <= due) {
        category = 'Completed On-Time'
        points = 100
        statusLabel = 'Done (On-Time)'
      } else {
        category = 'Completed Delayed'
        points = 50
        statusLabel = 'Done (Delayed)'
      }
    } else {
      const due = t.dueAt ? new Date(t.dueAt) : null
      if (due && due < now) {
        category = 'Overdue Pending'
        points = 0
        statusLabel = 'Overdue'
      } else {
        category = 'On-Track Pending'
        points = 80
        statusLabel = 'On-Track'
      }
    }

    return {
      id: t.id,
      title: t.title,
      description: t.description,
      dueAt: t.dueAt,
      completedAt: t.completedAt,
      statusLabel,
      points,
      category,
      status: t.status
    }
  })

  const totalPoints = items.reduce((sum: number, item: any) => sum + item.points, 0)
  const score = items.length > 0 ? Math.round(totalPoints / items.length) : 100

  const onTimeCount = items.filter((i: any) => i.points === 100).length
  const onTrackCount = items.filter((i: any) => i.points === 80).length
  const delayedCount = items.filter((i: any) => i.points === 50).length
  const overdueCount = items.filter((i: any) => i.points === 0).length

  const completedTasks = items.filter((i: any) => i.status === 'done')
  const completedCount = completedTasks.length
  const pendingCount = items.length - completedCount

  const onTimeRate = completedCount > 0 ? Math.round((onTimeCount / completedCount) * 100) : 0
  const overdueRate = pendingCount > 0 ? Math.round((overdueCount / pendingCount) * 100) : 0

  const filteredItems = items.filter((i: any) => {
    if (subTab === 'pending') return i.status !== 'done'
    if (subTab === 'completed') return i.status === 'done'
    return true
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl rounded-2xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.08)] bg-white p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900 flex items-center justify-between">
            <span>Detailed Scoring Breakdown</span>
            <span className={cn(
              "text-xs font-black uppercase tracking-wider rounded-full px-2.5 py-0.5 border",
              employee.color === 'emerald' && "bg-emerald-50 text-emerald-700 border-emerald-200",
              employee.color === 'teal' && "bg-teal-50 text-teal-700 border-teal-200",
              employee.color === 'sky' && "bg-sky-50 text-sky-700 border-sky-200",
              employee.color === 'amber' && "bg-amber-50 text-amber-700 border-amber-200",
              employee.color === 'rose' && "bg-rose-50 text-rose-700 border-rose-200"
            )}>
              {employee.grade} Grade
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* Summary & Score Panel */}
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-base font-black text-slate-900">{employee.name}</h4>
                <p className="text-xs text-slate-400 font-semibold">{employee.email || 'No email configured'}</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black text-slate-900">{score}<span className="text-sm font-bold text-slate-400">/100</span></p>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Performance Score</p>
              </div>
            </div>

            {/* Weights Distribution */}
            <div className="mt-4 border-t border-slate-200/60 pt-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scoring Weights Distribution</p>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs font-bold">
                <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-2">
                  <p className="text-emerald-700 text-lg font-black">{onTimeCount}</p>
                  <p className="text-[9px] text-emerald-600/80 font-black mt-0.5">On-Time (100pt)</p>
                </div>
                <div className="rounded-lg bg-sky-50/50 border border-sky-100 p-2">
                  <p className="text-sky-700 text-lg font-black">{onTrackCount}</p>
                  <p className="text-[9px] text-sky-600/80 font-black mt-0.5">On-Track (80pt)</p>
                </div>
                <div className="rounded-lg bg-amber-50/50 border border-amber-100 p-2">
                  <p className="text-amber-700 text-lg font-black">{delayedCount}</p>
                  <p className="text-[9px] text-amber-600/80 font-black mt-0.5">Delayed (50pt)</p>
                </div>
                <div className="rounded-lg bg-rose-50/50 border border-rose-100 p-2">
                  <p className="text-rose-700 text-lg font-black">{overdueCount}</p>
                  <p className="text-[9px] text-rose-600/80 font-black mt-0.5">Overdue (0pt)</p>
                </div>
              </div>

              {/* Exact arithmetic */}
              <div className="mt-3 text-[11px] font-semibold text-slate-500 bg-white border border-slate-100 rounded-lg p-2.5 text-center">
                Arithmetic: (({onTimeCount} × 100) + ({onTrackCount} × 80) + ({delayedCount} × 50) + ({overdueCount} × 0)) ÷ {items.length} = <strong className="text-slate-800 font-bold">{score} Marks</strong>
              </div>
            </div>
          </div>

          {/* Quick Analytics Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 p-3 bg-white shadow-sm text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">On-Time Rate</p>
              <p className="text-xl font-black text-slate-800 mt-1">{onTimeRate}%</p>
            </div>
            <div className="rounded-xl border border-slate-100 p-3 bg-white shadow-sm text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Overdue Rate</p>
              <p className="text-xl font-black text-rose-600 mt-1">{overdueRate}%</p>
            </div>
            <div className="rounded-xl border border-slate-100 p-3 bg-white shadow-sm text-center">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Assigned</p>
              <p className="text-xl font-black text-slate-800 mt-1">{items.length}</p>
            </div>
          </div>

          {/* Tasks List tab selectors */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Task Breakdown History</p>
              <div className="flex gap-1.5 bg-slate-100/70 p-0.5 rounded-lg border border-slate-200/50">
                <button onClick={() => setSubTab('all')}
                  className={cn("px-2 py-0.5 rounded text-[10px] font-bold transition", subTab === 'all' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
                  All
                </button>
                <button onClick={() => setSubTab('pending')}
                  className={cn("px-2 py-0.5 rounded text-[10px] font-bold transition", subTab === 'pending' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
                  Pending
                </button>
                <button onClick={() => setSubTab('completed')}
                  className={cn("px-2 py-0.5 rounded text-[10px] font-bold transition", subTab === 'completed' ? "bg-white text-slate-800 shadow-sm" : "text-slate-400 hover:text-slate-600")}>
                  Completed
                </button>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50 shadow-sm bg-white">
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 font-bold">No tasks match this filter.</div>
              ) : filteredItems.map(item => (
                <div key={item.id} className="p-3 flex items-center justify-between hover:bg-slate-50/30">
                  <div className="space-y-0.5 pr-4">
                    <p className="font-bold text-slate-800 text-xs line-clamp-1">{item.title}</p>
                    <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                      <span>Due: {fmtDate(item.dueAt)}</span>
                      {item.completedAt && <span>• Completed: {fmtDate(item.completedAt)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded border",
                      item.points === 100 && "bg-emerald-50 text-emerald-700 border-emerald-100",
                      item.points === 80 && "bg-sky-50 text-sky-700 border-sky-100",
                      item.points === 50 && "bg-amber-50 text-amber-700 border-amber-100",
                      item.points === 0 && "bg-rose-50 text-rose-700 border-rose-100"
                    )}>
                      {item.statusLabel}
                    </span>
                    <span className="font-black text-xs text-slate-700 w-12 text-right">+{item.points} pts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button onClick={onClose} className="rounded-xl h-10 bg-slate-900 text-white hover:bg-slate-800 w-24 font-bold text-xs">Close</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
