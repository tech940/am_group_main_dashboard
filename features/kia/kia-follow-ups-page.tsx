'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  CalendarClock,
  Loader2,
  Search,
  Plus,
  Check,
  Clock,
  Copy,
  X,
  Lock,
  AlertTriangle,
  Phone,
  PhoneCall,
  User2,
  Calendar,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  User,
  SlidersHorizontal
} from 'lucide-react'
import { canRevealKiaFollowupPhone } from '@/lib/kia/pii'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type Followup = {
  id: string; bookingId: string; customerName: string; model: string | null; variant: string | null
  bookingNumber: string | null; bookingStatus: string; dealer: string | null
  assignedTo: string | null; assignedName: string | null; dueAt: string; status: string
  reason: string; priority: string; notes: string | null; source: string; outcome: string | null
  completedAt: string | null; createdAt: string
  notInterestedReason: string | null
  bucket: 'not_connected' | 'pending' | 'next_day' | 'cancelled'
  overdue: boolean
  customerPhone: string | null
}
type Counts = { not_connected: number; pending: number; next_day: number; cancelled: number; overdue: number }
type ListResponse = { rows: Followup[]; counts: Counts; now: string }
type BookingHit = { id: string; customerName: string; model: string; variant: string; bookingNumber: string | null; dealer: string | null; status: string; consultantName: string | null }

type ActivityItem = {
  id: string
  type: string
  message: string
  description: string | null
  actorName: string | null
  createdAt: string
}
type BookingDetailPayload = {
  booking: any
  activities: ActivityItem[]
}

const DEALER_LABELS: Record<string, string> = { JK402: 'Jammu', JK501: 'Udhampur' }
const REASONS = [
  { value: 'callback', label: 'Callback' },
  { value: 'payment_pending', label: 'Payment pending' },
  { value: 'document_pending', label: 'Documents' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'general', label: 'General' },
]
const OUTCOMES = [
  { value: 'reached', label: 'Reached / spoke' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'not_interested', label: 'Not interested' },
  { value: 'converted', label: 'Converted 🎉' },
  { value: 'done', label: 'Done / resolved' },
]
const NOT_INTERESTED_REASONS = [
  { value: 'price', label: 'Price' },
  { value: 'bought_elsewhere', label: 'Bought elsewhere' },
  { value: 'finance_declined', label: 'Finance declined' },
  { value: 'postponed', label: 'Postponed purchase' },
  { value: 'model_unavailable', label: 'Model unavailable' },
  { value: 'other', label: 'Other' },
]
const REASON_LABEL: Record<string, string> = Object.fromEntries(REASONS.map((r) => [r.value, r.label]))

const BUCKETS = [
  { key: 'pending', label: 'Pending', tone: 'text-amber-600', hint: 'Open follow-ups' },
  { key: 'not_connected', label: 'Not Connected', tone: 'text-rose-600', hint: 'Last call failed' },
  { key: 'next_day', label: 'Next Day', tone: 'text-indigo-600', hint: 'Due tomorrow' },
  { key: 'cancelled', label: 'Cancelled', tone: 'text-slate-500', hint: 'Cancelled bookings' },
] as const

const MIN_REMARK_LENGTH = 10
const MIN_REMARK_WORDS = 15
function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length
}
const FOLLOWUP_REPEAT_DAYS = 7
const CONTACTED_OUTCOME_VALUES = new Set(['reached', 'done'])

function dealerLabel(code: string | null) { return code ? (DEALER_LABELS[code] || code) : '—' }
function defaultLocal(daysAhead = 1) {
  const d = new Date(); d.setDate(d.getDate() + daysAhead); d.setHours(10, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDue(iso: string, bucket: Followup['bucket']) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const diffMs = d.getTime() - Date.now()
  if (diffMs < 0 && bucket === 'pending') {
    const mins = Math.floor(-diffMs / 60_000)
    if (mins < 60) return 'Due now'
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h overdue`
    return `${Math.floor(hours / 24)}d overdue`
  }
  const days = Math.round(diffMs / 86_400_000)
  if (days === 0) return `Today · ${time}`
  if (days === 1) return `Tomorrow · ${time}`
  return `${date} · ${time}`
}

function getPaymentStatus(f: Followup) {
  const status = (f.bookingStatus || '').toLowerCase()
  if (status === 'cancelled') return { label: 'Cancelled', tone: 'neutral' as const }
  if (status === 'delivered' || status === 'ready_delivery' || status === 'payment_confirmed') {
    return { label: 'Paid', tone: 'emerald' as const }
  }
  return { label: 'Pending', tone: 'rose' as const }
}

function Badge({ label, tone }: { label: string; tone: 'indigo' | 'rose' | 'amber' | 'emerald' | 'violet' | 'slate' | 'neutral' | 'blue' }) {
  const classes = {
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/10',
    rose: 'bg-rose-50 text-rose-700 ring-rose-600/10',
    amber: 'bg-amber-50 text-amber-700 ring-amber-600/10',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
    violet: 'bg-violet-50 text-violet-700 ring-violet-600/10',
    slate: 'bg-slate-50 text-slate-700 ring-slate-600/10',
    neutral: 'bg-gray-50 text-gray-700 ring-gray-600/10',
    blue: 'bg-blue-50 text-blue-700 ring-blue-600/10',
  }
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-black ring-1 ring-inset uppercase tracking-wide', classes[tone] || classes.neutral)}>
      {label}
    </span>
  )
}

function getActivityMeta(type: string, description: string | null) {
  switch (type) {
    case 'remark_added':
      return {
        icon: MessageSquare,
        iconBg: 'bg-indigo-50 text-indigo-600 border-indigo-100',
        title: 'Remark added',
      }
    case 'followup_completed': {
      const isCall = description?.toLowerCase().includes('reached') || description?.toLowerCase().includes('answer')
      return {
        icon: isCall ? Phone : Check,
        iconBg: 'bg-emerald-50 text-emerald-600 border-emerald-100',
        title: 'Follow-up completed',
      }
    }
    case 'followup_scheduled':
      return {
        icon: Clock,
        iconBg: 'bg-blue-50 text-blue-600 border-blue-100',
        title: 'Follow-up scheduled',
      }
    case 'followup_updated':
      return {
        icon: Calendar,
        iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
        title: 'Follow-up rescheduled',
      }
    case 'followup_cancelled':
      return {
        icon: X,
        iconBg: 'bg-slate-50 text-slate-600 border-slate-100',
        title: 'Follow-up cancelled',
      }
    default:
      return {
        icon: User,
        iconBg: 'bg-slate-50 text-slate-600 border-slate-100',
        title: type.replace(/_/g, ' '),
      }
  }
}

export function KiaFollowUpsPage({ currentUserRole }: { currentUserRole: string }) {
  const [mine, setMine] = useState(false)
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('all')
  const [activeTab, setActiveTab] = useState<Followup['bucket']>('pending')
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'activity' | 'remarks'>('activity')
  const [remarkText, setRemarkText] = useState('')
  const [addingRemark, setAddingRemark] = useState(false)

  // Dialog States
  const [adding, setAdding] = useState(false)
  const [calling, setCalling] = useState<Followup | null>(null)
  const [completing, setCompleting] = useState<Followup | null>(null)
  const [rescheduling, setRescheduling] = useState<Followup | null>(null)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const canCall = canRevealKiaFollowupPhone(currentUserRole)

  const query = useQuery<ListResponse>({
    queryKey: ['kia-followups', mine, search, reason],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (mine) params.set('mine', '1')
      if (search) params.set('search', search)
      if (reason !== 'all') params.set('reason', reason)
      const res = await fetch(`/api/brands/kia/follow-ups?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const data = query.data

  const grouped = useMemo(() => {
    const g: Record<Followup['bucket'], Followup[]> = { not_connected: [], pending: [], next_day: [], cancelled: [] }
    for (const r of data?.rows || []) g[r.bucket].push(r)
    return g
  }, [data])

  const filteredRows = useMemo(() => {
    return grouped[activeTab] || []
  }, [grouped, activeTab])

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredRows.slice(start, end)
  }, [filteredRows, currentPage, pageSize])

  const totalPages = Math.ceil(filteredRows.length / pageSize)

  // Reset page when tab/filters change
  useEffect(() => {
    setCurrentPage(1)
    setSelectedBookingId(null)
  }, [activeTab, search, reason, mine])

  // Fetch selected booking details
  const bookingDetailQuery = useQuery<BookingDetailPayload>({
    queryKey: ['kia-booking-detail', selectedBookingId],
    queryFn: async () => {
      if (!selectedBookingId) return null
      const res = await fetch(`/api/brands/kia/bookings/${selectedBookingId}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load detail')
      return res.json()
    },
    enabled: !!selectedBookingId,
  })

  const remarksOnly = useMemo(() => {
    const list = bookingDetailQuery.data?.activities || []
    return list.filter((act) => act.type === 'remark_added' || act.type === 'followup_completed')
  }, [bookingDetailQuery.data?.activities])

  async function patch(id: string, body: Record<string, unknown>, successMsg: string) {
    const res = await fetch(`/api/brands/kia/follow-ups/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(result.error || 'Failed')
    toast({ title: successMsg, variant: 'success' })
    void query.refetch()
    if (selectedBookingId) {
      void bookingDetailQuery.refetch()
    }
    return result
  }

  async function handleAddRemark() {
    if (!remarkText.trim() || !selectedBookingId) return
    setAddingRemark(true)
    try {
      const res = await fetch(`/api/brands/kia/bookings/${selectedBookingId}/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: remarkText.trim() }),
      })
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || 'Failed to add remark')
      }
      setRemarkText('')
      toast({ title: 'Remark added successfully', variant: 'success' })
      void bookingDetailQuery.refetch()
    } catch (err) {
      toast({
        title: 'Error adding remark',
        description: err instanceof Error ? err.message : 'Try again',
        variant: 'error',
      })
    } finally {
      setAddingRemark(false)
    }
  }

  return (
    <MainLayout title="Booking Follow-ups" subtitle="Redesigned followup desk — scheduled next-touch on every booking so no lead goes cold">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4 items-start">
        {/* Left Side: Table & Filters */}
        <div className="xl:col-span-3 space-y-4">
          
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {[{ k: false, l: 'All' }, { k: true, l: 'Assigned to me' }].map((t) => (
                  <button
                    key={t.l}
                    onClick={() => setMine(t.k)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wider transition-colors',
                      mine === t.k
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    )}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
              
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-9 w-40 rounded-xl text-xs font-black uppercase tracking-wider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="font-bold">
                  <SelectItem value="all">All reasons</SelectItem>
                  {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>

              <div className="relative flex items-center rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 focus-within:bg-white focus-within:border-slate-300 transition-colors">
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, model or booking #…"
                  className="ml-2 w-52 border-0 bg-transparent text-xs font-semibold outline-none text-slate-700"
                />
              </div>

              <Button variant="outline" className="h-9 gap-1.5 rounded-xl text-xs font-black uppercase tracking-wider border-slate-200">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              </Button>
            </div>
            
            <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700 shadow-sm">
              <Plus className="h-4 w-4" /> Add follow-up
            </Button>
          </div>

          {/* Tabs bar */}
          <div className="flex border-b border-slate-200 bg-white px-4 pt-2 rounded-t-2xl border-x border-t border-slate-100">
            {BUCKETS.map((b) => {
              const count = data?.counts[b.key] ?? 0
              const isActive = activeTab === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveTab(b.key)}
                  className={cn(
                    'border-b-2 px-4 py-3 text-xs font-black uppercase tracking-wider transition-all -mb-px flex items-center gap-1.5',
                    isActive
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  )}
                >
                  {b.key === 'cancelled' ? 'Cancelled' : b.key === 'not_connected' ? 'Not Connected' : b.key === 'next_day' ? 'Next Day' : 'Pending'}
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[9px] font-black',
                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Table Container */}
          <div className="bg-white rounded-b-2xl border-x border-b border-slate-100 shadow-sm overflow-hidden min-h-[300px]">
            {query.isLoading ? (
              <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-600" /></div>
            ) : query.isError ? (
              <div className="p-6 text-sm font-bold text-rose-700 bg-rose-50/50">{(query.error as Error)?.message || 'Failed to load.'}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/30 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <th className="p-3 pl-4 w-10"><input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /></th>
                      <th className="p-3">Booking / Customer</th>
                      <th className="p-3">Vehicle / Variant</th>
                      <th className="p-3">Dealer</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Follow-up</th>
                      <th className="p-3">Payment</th>
                      <th className="p-3">Assigned To</th>
                      <th className="p-3 text-right pr-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {paginatedRows.map((f) => {
                      const isSelected = selectedBookingId === f.bookingId
                      const payment = getPaymentStatus(f)
                      const isDone = f.status !== 'pending'
                      return (
                        <tr
                          key={f.id}
                          onClick={() => setSelectedBookingId(f.bookingId)}
                          className={cn(
                            'cursor-pointer transition-colors hover:bg-slate-50/50',
                            isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/50' : '',
                            isDone && 'opacity-70'
                          )}
                        >
                          <td className="p-3 pl-4" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col min-w-[140px]">
                              <span className="font-bold text-indigo-600 text-[11px] uppercase">{f.bookingNumber || '—'}</span>
                              <span className="font-black text-slate-700 mt-0.5 text-sm">{f.customerName}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col min-w-[150px]">
                              <span className="font-extrabold text-slate-800 text-[11px] uppercase tracking-wide">{f.model || '—'}</span>
                              <span className="text-slate-500 text-[11px] mt-0.5 font-medium">{f.variant || '—'}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col min-w-[80px]">
                              <span className="font-bold text-slate-700">{f.dealer || '—'}</span>
                              <span className="text-slate-400 text-[10px] mt-0.5 font-bold">{dealerLabel(f.dealer)}</span>
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge
                              label={f.overdue && !isDone ? 'OVERDUE' : f.status.toUpperCase()}
                              tone={f.overdue && !isDone ? 'rose' : f.status === 'done' ? 'emerald' : f.status === 'cancelled' ? 'slate' : 'amber'}
                            />
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col min-w-[110px]">
                              <span className="font-bold text-slate-600">{new Date(f.dueAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                              <span className={cn('text-[10px] mt-0.5 font-bold flex items-center gap-1', f.overdue && !isDone ? 'text-rose-500' : 'text-slate-400')}>
                                <span className={cn('inline-block h-1 w-1 rounded-full', f.overdue && !isDone ? 'bg-rose-500 animate-pulse' : 'bg-slate-400')} />
                                {formatDue(f.dueAt, f.bucket)}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">
                            <Badge label={payment.label} tone={payment.tone} />
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-2 min-w-[120px]">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-black text-indigo-700 uppercase ring-1 ring-indigo-100">
                                {f.assignedName ? f.assignedName.split(' ').map(n => n[0]).join('').slice(0, 2) : '??'}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-slate-700 truncate">{f.assignedName || 'Unassigned'}</span>
                                <span className="text-slate-400 text-[9px] mt-0.5 uppercase tracking-wider font-bold">Consultant</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-right pr-6" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              {canCall && (
                                <Button
                                  onClick={() => setCalling(f)}
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                                  title="Call Customer"
                                >
                                  <Phone className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                onClick={() => setRescheduling(f)}
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-amber-600"
                                title="Reschedule Follow-up"
                              >
                                <Calendar className="h-4 w-4" />
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                    <X className="h-4 w-4 rotate-45" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="font-bold">
                                  {!isDone && (
                                    <>
                                      <DropdownMenuItem onClick={() => setCompleting(f)} className="text-emerald-600 focus:text-emerald-700 cursor-pointer">
                                        <Check className="mr-2 h-4 w-4" /> Complete follow-up
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={async () => {
                                          try {
                                            await patch(f.id, { action: 'cancel' }, 'Follow-up cancelled')
                                          } catch (e) {
                                            toast({ title: 'Failed', description: e instanceof Error ? e.message : '', variant: 'error' })
                                          }
                                        }}
                                        className="text-rose-600 focus:text-rose-700 cursor-pointer"
                                      >
                                        <X className="mr-2 h-4 w-4" /> Cancel follow-up
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="p-12 text-center text-slate-400 font-bold">
                          <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                          <p className="mt-3 text-sm">No follow-ups in this section.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {filteredRows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-100 bg-slate-50/20 text-xs text-slate-500 font-bold">
                <div>
                  Showing {Math.min((currentPage - 1) * pageSize + 1, filteredRows.length)} to {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} follow-ups
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-lg border-slate-200"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => prev - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {Array.from({ length: totalPages }).map((_, index) => {
                      const pageNum = index + 1
                      if (totalPages > 5 && Math.abs(currentPage - pageNum) > 1 && pageNum !== 1 && pageNum !== totalPages) {
                        if (pageNum === 2 || pageNum === totalPages - 1) {
                          return <span key={pageNum} className="px-1.5 text-slate-400">...</span>
                        }
                        return null
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={currentPage === pageNum ? 'default' : 'outline'}
                          className={cn('h-8 w-8 rounded-lg font-bold', currentPage === pageNum ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'border-slate-200')}
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </Button>
                      )
                    })}
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-lg border-slate-200"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => prev + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span>Rows per page</span>
                    <Select value={String(pageSize)} onValueChange={(val) => { setPageSize(Number(val)); setCurrentPage(1) }}>
                      <SelectTrigger className="h-8 w-16 rounded-lg text-xs font-bold border-slate-200"><SelectValue /></SelectTrigger>
                      <SelectContent className="font-bold">
                        {[10, 20, 50, 100].map(s => <SelectItem key={s} value={String(s)}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Selected Follow-up Sidebar Details */}
        <div className="xl:col-span-1 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 min-h-[500px] flex flex-col">
          {!selectedBookingId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400">
              <CalendarClock className="h-10 w-10 text-slate-200 mb-3 animate-pulse" />
              <p className="text-xs font-black uppercase tracking-wider text-slate-400">No Customer Selected</p>
              <p className="text-[11px] font-semibold text-slate-400 mt-1 leading-relaxed">
                Click any follow-up row in the table to load history timeline and comments logs.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full space-y-4">
              
              {/* Customer Profile Summary */}
              {bookingDetailQuery.data?.booking && (
                <div className="border-b border-slate-100 pb-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Selected Customer</span>
                    <button onClick={() => setSelectedBookingId(null)} className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-50"><X className="h-4 w-4" /></button>
                  </div>
                  <h4 className="font-black text-slate-800 text-base mt-1 leading-tight">{bookingDetailQuery.data.booking.customerName}</h4>
                  <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wide">
                    {bookingDetailQuery.data.booking.model} {bookingDetailQuery.data.booking.variant}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-slate-400">
                    <span>{bookingDetailQuery.data.booking.bookingNumber}</span>
                    <span>{dealerLabel(bookingDetailQuery.data.booking.dealerCode)}</span>
                  </div>
                </div>
              )}

              {/* Sidebar Tabs */}
              <div className="flex border-b border-slate-100 pb-px">
                <button
                  onClick={() => setSidebarTab('activity')}
                  className={cn(
                    'flex-1 text-center py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors',
                    sidebarTab === 'activity' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  )}
                >
                  Activity
                </button>
                <button
                  onClick={() => setSidebarTab('remarks')}
                  className={cn(
                    'flex-1 text-center py-2 text-xs font-black uppercase tracking-wider border-b-2 transition-colors',
                    sidebarTab === 'remarks' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                  )}
                >
                  Remarks <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{remarksOnly.length}</span>
                </button>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto max-h-[380px] kia-scroll pr-1 py-2">
                {bookingDetailQuery.isLoading ? (
                  <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
                ) : bookingDetailQuery.isError ? (
                  <p className="text-xs font-bold text-rose-500 p-3">Failed to load timeline.</p>
                ) : sidebarTab === 'activity' ? (
                  /* Activity Timeline */
                  <div className="relative border-l border-slate-100 pl-4 ml-3 space-y-4 pt-1">
                    {(bookingDetailQuery.data?.activities || []).map((act) => {
                      const meta = getActivityMeta(act.type, act.description)
                      const Icon = meta.icon
                      return (
                        <div key={act.id} className="relative">
                          {/* Timeline icon */}
                          <span className={cn(
                            'absolute -left-[25px] top-0 flex h-4 w-4 items-center justify-center rounded-full border text-[8px] shadow-sm ring-4 ring-white',
                            meta.iconBg
                          )}>
                            <Icon className="h-2 w-2" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{meta.title}</div>
                            {act.description && (
                              <p className="mt-1 text-xs font-semibold text-slate-700 bg-slate-50/60 p-2 rounded-xl border border-slate-100/40 leading-relaxed whitespace-pre-wrap">
                                {act.description}
                              </p>
                            )}
                            <div className="mt-1 flex items-center gap-1.5 text-[9px] font-bold text-slate-400">
                              <span>{act.actorName || 'System'}</span>
                              <span>•</span>
                              <span>{new Date(act.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {(!bookingDetailQuery.data?.activities || bookingDetailQuery.data.activities.length === 0) && (
                      <p className="text-xs font-bold text-slate-400 text-center py-6">No activity logged.</p>
                    )}
                  </div>
                ) : (
                  /* Remarks Only list */
                  <div className="space-y-3">
                    {remarksOnly.map((act) => (
                      <div key={act.id} className="bg-slate-50 p-2.5 rounded-xl border border-slate-100/60 space-y-1.5 text-xs font-semibold text-slate-700">
                        <p className="whitespace-pre-wrap leading-relaxed">{act.description}</p>
                        <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 border-t border-slate-100 pt-1.5 mt-1">
                          <span>{act.actorName || 'System'}</span>
                          <span>{new Date(act.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    ))}
                    {remarksOnly.length === 0 && (
                      <p className="text-xs font-bold text-slate-400 text-center py-6">No remarks recorded.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Add Remark Textarea */}
              <div className="border-t border-slate-100 pt-3 mt-auto">
                <textarea
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value)}
                  rows={2}
                  placeholder="Add a remark..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold outline-none focus:border-slate-300 resize-none"
                />
                <Button
                  onClick={() => void handleAddRemark()}
                  disabled={addingRemark || !remarkText.trim()}
                  className="mt-2 w-full h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold gap-1 shadow-sm"
                >
                  {addingRemark ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
                  Add Remark
                </Button>
              </div>

            </div>
          )}
        </div>
      </div>

      {calling && <CallDialog f={calling} onClose={() => setCalling(null)} />}
      {adding && <AddFollowupDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void query.refetch() }} />}
      {completing && <CompleteDialog f={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); void query.refetch(); if (selectedBookingId) void bookingDetailQuery.refetch() }} />}
      {rescheduling && <RescheduleDialog f={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => { setRescheduling(null); void query.refetch(); if (selectedBookingId) void bookingDetailQuery.refetch() }} />}
    </MainLayout>
  )
}

function CallDialog({ f, onClose }: { f: Followup; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const phone = f.customerPhone
  const error = phone ? null : 'No mobile number is on file for this customer.'

  async function copy() {
    if (!phone) return
    try {
      await navigator.clipboard.writeText(phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast({ title: 'Could not copy', variant: 'error' }) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-indigo-600" /> Call {f.customerName}</DialogTitle>
          <DialogDescription>{[f.model, f.variant].filter(Boolean).join(' ') || '—'}{f.bookingNumber ? ` · ${f.bookingNumber}` : ''}</DialogDescription>
        </DialogHeader>

        <div className="pt-2">
          {!phone ? (
            <p className="rounded-xl bg-rose-50 px-3 py-3 text-center text-[13px] font-semibold text-rose-600">{error}</p>
          ) : (
            <>
              <div className="rounded-2xl bg-gradient-to-b from-indigo-50 to-white px-4 py-5 text-center ring-1 ring-inset ring-indigo-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Mobile</p>
                <p className="mt-1 select-all text-2xl font-black tracking-tight text-slate-900 tabular-nums">{phone}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={`tel:${phone}`}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 text-xs font-bold text-white transition-colors hover:bg-indigo-700"
                >
                  <PhoneCall className="h-3.5 w-3.5" /> Call now
                </a>
                <Button variant="outline" className="h-10 gap-1.5 rounded-xl text-xs font-bold" onClick={() => void copy()}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CompleteDialog({ f, onClose, onSaved }: { f: Followup; onClose: () => void; onSaved: () => void }) {
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [notInterestedReason, setNotInterestedReason] = useState('')
  const [scheduleNext, setScheduleNext] = useState(false)
  const [nextAt, setNextAt] = useState(defaultLocal(FOLLOWUP_REPEAT_DAYS))
  const [saving, setSaving] = useState(false)

  const isNotInterested = outcome === 'not_interested'
  const remarksOk = countWords(notes) > MIN_REMARK_WORDS
  const canSave = Boolean(outcome) && remarksOk && (!isNotInterested || Boolean(notInterestedReason))
  const autoRepeats = CONTACTED_OUTCOME_VALUES.has(outcome)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          outcome: outcome || undefined,
          notes,
          notInterestedReason: isNotInterested ? notInterestedReason : undefined,
          nextDueAt: scheduleNext && nextAt ? new Date(nextAt).toISOString() : undefined,
        }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(result.error || 'Failed to save')
      toast({ title: 'Follow-up completed', description: result.next ? 'Next follow-up scheduled.' : undefined, variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not save', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Check className="h-5 w-5 text-emerald-600" /> Complete follow-up · {f.customerName}</DialogTitle>
          <DialogDescription>Record what happened. You can chain the next touch if the lead is still open.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Outcome</label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Select outcome" /></SelectTrigger>
              <SelectContent>{OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {isNotInterested && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
              <label className="text-[11px] font-black uppercase tracking-wider text-rose-600">Why is the customer not proceeding? *</label>
              <Select value={notInterestedReason} onValueChange={setNotInterestedReason}>
                <SelectTrigger className="mt-1 h-10 rounded-xl bg-white"><SelectValue placeholder="Select their reason" /></SelectTrigger>
                <SelectContent>{NOT_INTERESTED_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] font-semibold text-rose-500">Required. Explain the detail in the remarks below.</p>
            </div>
          )}
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={isNotInterested ? 'What exactly did the customer say about not proceeding?' : 'What did the customer say?'}
              className={cn(
                'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
              )}
            />
            <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
              Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words). This is the customer&apos;s communication history.
            </p>
          </div>
          {autoRepeats && !scheduleNext && (
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-[12px] font-semibold text-indigo-700">
              The next follow-up will be scheduled automatically in {FOLLOWUP_REPEAT_DAYS} days.
            </p>
          )}
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} className="h-4 w-4 rounded" />
            {autoRepeats ? 'Choose a different date instead' : 'Schedule the next follow-up'}
          </label>
          {scheduleNext && <input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-700" onClick={() => void save()} disabled={saving || !canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RescheduleDialog({ f, onClose, onSaved }: { f: Followup; onClose: () => void; onSaved: () => void }) {
  const [dueAt, setDueAt] = useState(defaultLocal(1))
  const [priority, setPriority] = useState(f.priority)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const remarksOk = countWords(notes) > MIN_REMARK_WORDS

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', dueAt: new Date(dueAt).toISOString(), priority, notes }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed')
      toast({ title: 'Rescheduled', variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not reschedule', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-indigo-600" /> Reschedule · {f.customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">New date &amp; time</label>
            <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Why are you moving this follow-up?"
              className={cn(
                'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
              )}
            />
            <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
              Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-indigo-600 px-6 font-bold text-white hover:bg-indigo-700" onClick={() => void save()} disabled={saving || !remarksOk}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddFollowupDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [bookingSearch, setBookingSearch] = useState('')
  const [selected, setSelected] = useState<BookingHit | null>(null)
  const [dueAt, setDueAt] = useState(defaultLocal(1))
  const [reason, setReason] = useState('callback')
  const [priority, setPriority] = useState('normal')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [hits, setHits] = useState<BookingHit[]>([])
  const [searching, setSearching] = useState(false)

  const remarksOk = countWords(notes) > MIN_REMARK_WORDS

  useEffect(() => {
    if (selected) return
    let active = true
    const t = setTimeout(async () => {
      if (active) setSearching(true)
      try {
        const res = await fetch(`/api/brands/kia/follow-ups/bookings?search=${encodeURIComponent(bookingSearch)}`, { cache: 'no-store' })
        const d = await res.json().catch(() => ({ bookings: [] }))
        if (active) setHits(d.bookings || [])
      } finally { if (active) setSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [bookingSearch, selected])

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/api/brands/kia/follow-ups', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: selected.id, dueAt: new Date(dueAt).toISOString(), reason, priority, notes }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create')
      toast({ title: 'Follow-up scheduled', variant: 'success' })
      onSaved()
    } catch (err) { toast({ title: 'Could not create', description: err instanceof Error ? err.message : 'Try again', variant: 'error' }) } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-indigo-600" /> Add follow-up</DialogTitle>
          <DialogDescription>Pick a customer, set when to follow up. It&apos;s assigned to their sales consultant.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {selected ? (
            <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <div>
                <p className="font-black text-slate-800">{selected.customerName}</p>
                <p className="text-[12px] font-semibold text-slate-500">{[selected.model, selected.variant].filter(Boolean).join(' ')} · {dealerLabel(selected.dealer)}{selected.bookingNumber ? ` · ${selected.bookingNumber}` : ''}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div>
              <div className="relative flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2">
                <Search className="h-4 w-4 text-slate-400" />
                <input autoFocus value={bookingSearch} onChange={(e) => setBookingSearch(e.target.value)} placeholder="Search customer, model or booking #…" className="ml-2 flex-1 border-0 bg-transparent text-sm font-semibold outline-none" />
                {searching && <Loader2 className="h-4 w-4 animate-spin text-slate-300" />}
              </div>
              <div className="kia-scroll mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                {hits.map((b) => (
                  <button key={b.id} onClick={() => setSelected(b)} className="flex w-full items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50/40">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-800">{b.customerName}</p>
                      <p className="truncate text-[12px] font-semibold text-slate-500">{[b.model, b.variant].filter(Boolean).join(' ')} · {dealerLabel(b.dealer)}{b.bookingNumber ? ` · ${b.bookingNumber}` : ''}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500"><Lock className="h-2.5 w-2.5" /> No.</span>
                  </button>
                ))}
                {!hits.length && !searching && <p className="px-1 py-3 text-center text-[12px] font-semibold text-slate-400">No matching bookings.</p>}
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Reason</label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Priority</label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Follow up on</label>
                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-slate-400" />
              </div>
              <div>
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Remarks *</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Why are you scheduling this follow-up?"
                  className={cn(
                    'mt-1 w-full rounded-xl border px-3 py-2 text-sm font-medium outline-none focus:border-slate-400',
                    notes.length > 0 && !remarksOk ? 'border-rose-300' : 'border-slate-200',
                  )}
                />
                <p className={cn('mt-1 text-[11px] font-semibold', notes.length > 0 && !remarksOk ? 'text-rose-500' : 'text-slate-400')}>
                  Required — more than {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
                </p>
              </div>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="h-10 rounded-xl font-bold" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="h-10 gap-2 rounded-xl bg-indigo-600 px-6 font-bold text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => void save()} disabled={saving || !selected || !remarksOk}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
