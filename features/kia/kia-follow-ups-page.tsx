'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  SlidersHorizontal,
  TrendingUp,
  CheckCheck,
  Timer,
  MessageCircle
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
  assignedTo: string | null; assignedName: string | null; consultantName: string | null; dueAt: string; status: string
  reason: string; priority: string; notes: string | null; source: string; outcome: string | null
  completedAt: string | null; createdAt: string
  notInterestedReason: string | null
  bucket: 'not_connected' | 'pending' | 'next_day' | 'scheduled' | 'cancelled'
  overdue: boolean
  customerPhone: string | null
}
type Counts = { not_connected: number; pending: number; next_day: number; scheduled: number; cancelled: number; overdue: number }
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
  { value: '__custom__', label: '✏️ Custom outcome…' },
]
const RESCHEDULE_REASONS = [
  { value: 'followup_call', label: 'Follow-up call' },
  { value: 'customer_request', label: 'Customer request' },
  { value: 'no_answer', label: 'No answer — retry' },
  { value: 'payment_delay', label: 'Payment delay' },
  { value: 'document_pending', label: 'Documents pending' },
  { value: '__custom__', label: '✏️ Custom reason…' },
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
  { key: 'scheduled', label: 'Scheduled', tone: 'text-teal-600', hint: 'Future follow-ups' },
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

function agingLabel(dueAt: string, isDone: boolean): { text: string; cls: string } | null {
  if (isDone) return null
  const diffMs = Date.now() - new Date(dueAt).getTime()
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 0) return null // future
  if (days === 0) return { text: 'Due today', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
  if (days === 1) return { text: '1 day overdue', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
  return { text: `${days}d overdue`, cls: 'bg-rose-100 text-rose-800 border-rose-300' }
}

function urgencyBorderClass(f: Followup, isDone: boolean): string {
  if (isDone) return ''
  const diffMs = new Date(f.dueAt).getTime() - Date.now()
  const daysDiff = diffMs / 86_400_000
  if (diffMs < 0) return 'border-l-4 border-l-rose-500'      // overdue — red
  if (daysDiff < 1) return 'border-l-4 border-l-amber-400'   // due today — amber
  if (daysDiff < 2) return 'border-l-4 border-l-emerald-400' // due tomorrow — green
  return ''
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
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Followup['bucket']>('pending')
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'details' | 'activity' | 'remarks'>('details')
  const [remarkText, setRemarkText] = useState('')
  const [addingRemark, setAddingRemark] = useState(false)

  // Details Modal trigger state
  const [detailBookingOpen, setDetailBookingOpen] = useState(false)

  // Alarm System States
  const [alertedIds, setAlertedIds] = useState<Set<string>>(new Set())
  const [activeAlarmFollowup, setActiveAlarmFollowup] = useState<Followup | null>(null)

  // Dialog States
  const [adding, setAdding] = useState(false)
  const [calling, setCalling] = useState<Followup | null>(null)
  const [completing, setCompleting] = useState<Followup | null>(null)
  const [rescheduling, setRescheduling] = useState<Followup | null>(null)

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkRescheduling, setBulkRescheduling] = useState(false)
  const [bulkDueAt, setBulkDueAt] = useState(defaultLocal(1))
  const [bulkActioning, setBulkActioning] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const canCall = canRevealKiaFollowupPhone(currentUserRole)

  const query = useQuery<ListResponse>({
    queryKey: ['kia-followups', mine, search, reason, startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (mine) params.set('mine', '1')
      if (search) params.set('search', search)
      if (reason !== 'all') params.set('reason', reason)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      const res = await fetch(`/api/brands/kia/follow-ups?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const data = query.data

  const playAlertChime = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const playChime = (timeOffset: number, frequency: number) => {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime + timeOffset)
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + timeOffset)
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + timeOffset + 0.45)
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.start(audioCtx.currentTime + timeOffset)
        osc.stop(audioCtx.currentTime + timeOffset + 0.45)
      }
      playChime(0, 523.25)   // C5
      playChime(0.12, 659.25) // E5
      playChime(0.24, 783.99) // G5
    } catch (e) {
      console.warn('Could not play audio chime', e)
    }
  }

  // Same-day alarm scheduler checking every 10 seconds
  useEffect(() => {
    const checkAlarms = () => {
      if (!data?.rows) return
      const now = Date.now()
      const todayString = new Date().toDateString() // Today local date
      
      for (const f of data.rows) {
        if (f.status !== 'pending') continue
        
        const dueTime = new Date(f.dueAt).getTime()
        const dueLocalDate = new Date(f.dueAt).toDateString()
        
        // Same-day check: is the follow-up scheduled for today?
        const isSameDay = dueLocalDate === todayString
        
        // Has the due time been reached or passed?
        const isTimeReached = dueTime <= now
        
        // Has it not been alerted in the current session?
        const isNotAlerted = !alertedIds.has(f.id)
        
        if (isSameDay && isTimeReached && isNotAlerted) {
          // Trigger alarm!
          setAlertedIds((prev) => {
            const next = new Set(prev)
            next.add(f.id)
            return next
          })
          setActiveAlarmFollowup(f)
          playAlertChime()
          break // show one popup alert at a time
        }
      }
    }
    
    // Initial check and 10 second polling interval
    checkAlarms()
    const timer = setInterval(checkAlarms, 10000)
    return () => clearInterval(timer)
  }, [data?.rows, alertedIds])

  const grouped = useMemo(() => {
    const g: Record<Followup['bucket'], Followup[]> = { not_connected: [], pending: [], next_day: [], scheduled: [], cancelled: [] }
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

  // Prefetch booking details for all visible rows so sidebar opens instantly
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!paginatedRows.length) return
    for (const row of paginatedRows) {
      void queryClient.prefetchQuery({
        queryKey: ['kia-booking-detail', row.bookingId],
        queryFn: async () => {
          const res = await fetch(`/api/brands/kia/bookings/${row.bookingId}`, { cache: 'no-store' })
          if (!res.ok) return null
          return res.json()
        },
        staleTime: 2 * 60 * 1000, // treat as fresh for 2 minutes
      })
    }
  }, [paginatedRows, queryClient])

  // Reset page when tab/filters change
  useEffect(() => {
    setCurrentPage(1)
    setSelectedBookingId(null)
  }, [activeTab, search, reason, mine, startDate, endDate])

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

  const activitiesList = useMemo(() => {
    return bookingDetailQuery.data?.activities || []
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

  // CRE Performance stats — computed from already-fetched rows
  const allRows = data?.rows || []
  const todayStr = new Date().toDateString()
  const completedToday = allRows.filter(
    (r) => r.status === 'done' && r.completedAt && new Date(r.completedAt).toDateString() === todayStr
  ).length
  const totalPending = data?.counts.pending ?? 0
  const totalOverdue = data?.counts.overdue ?? 0

  // Bulk helpers
  function toggleSelectAll(rows: Followup[]) {
    if (rows.length > 0 && rows.every((r) => selectedIds.has(r.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)))
    }
  }
  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkComplete() {
    if (selectedIds.size === 0) return
    setBulkActioning(true)
    const ids = Array.from(selectedIds)
    let ok = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/brands/kia/follow-ups/${id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'complete', outcome: 'done', notes: 'Bulk completed by CRE team.' }),
        })
        if (res.ok) ok++
      } catch { /* continue */ }
    }
    setBulkActioning(false)
    setSelectedIds(new Set())
    toast({ title: `${ok}/${ids.length} follow-ups completed`, variant: 'success' })
    void query.refetch()
  }

  async function handleBulkReschedule() {
    if (selectedIds.size === 0 || !bulkDueAt) return
    setBulkActioning(true)
    const ids = Array.from(selectedIds)
    let ok = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/brands/kia/follow-ups/${id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'update', dueAt: new Date(bulkDueAt).toISOString(), notes: 'Bulk rescheduled by CRE team.' }),
        })
        if (res.ok) ok++
      } catch { /* continue */ }
    }
    setBulkActioning(false)
    setBulkRescheduling(false)
    setSelectedIds(new Set())
    toast({ title: `${ok}/${ids.length} follow-ups rescheduled`, variant: 'success' })
    void query.refetch()
  }

  return (
    <MainLayout title="Booking Follow-ups" subtitle="Redesigned followup desk — scheduled next-touch on every booking so no lead goes cold">
      <div className="space-y-4 w-full">
          
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
                  className="ml-2 w-44 border-0 bg-transparent text-xs font-semibold outline-none text-slate-700"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-9 px-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-xs font-bold text-slate-700 w-28 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider shrink-0">To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-9 px-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-xs font-bold text-slate-700 w-28 cursor-pointer"
                />
              </div>
              {(startDate || endDate) && (
                <Button 
                  onClick={() => { setStartDate(''); setEndDate('') }}
                  variant="ghost" 
                  className="h-9 px-2.5 rounded-xl text-xs font-black uppercase text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                >
                  Clear
                </Button>
              )}

              <Button variant="outline" className="h-9 gap-1.5 rounded-xl text-xs font-black uppercase tracking-wider border-slate-200">
                <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
              </Button>
            </div>
            
            <Button onClick={() => setAdding(true)} className="h-9 gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700 shadow-sm">
              <Plus className="h-4 w-4" /> Add follow-up
            </Button>
          </div>

          {/* CRE Performance Stats Bar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100">
                <CheckCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Completed Today</p>
                <p className="text-2xl font-black text-emerald-600 leading-tight">{completedToday}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-100">
                <Timer className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pending</p>
                <p className="text-2xl font-black text-amber-600 leading-tight">{totalPending}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 border border-rose-100">
                <TrendingUp className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Overdue</p>
                <p className="text-2xl font-black text-rose-600 leading-tight">{totalOverdue}</p>
              </div>
            </div>
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
                  {b.label}
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
                      <th className="p-3 pl-4 w-10">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={paginatedRows.length > 0 && paginatedRows.every((r) => selectedIds.has(r.id))}
                          onChange={() => toggleSelectAll(paginatedRows)}
                        />
                      </th>
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
                      const aging = agingLabel(f.dueAt, isDone)
                      const actCount = (f as any).activityCount as number | undefined
                      return (
                        <tr
                          key={f.id}
                          onClick={() => {
                            setSelectedBookingId(f.bookingId)
                          }}
                          className={cn(
                            'cursor-pointer transition-colors hover:bg-slate-50/50',
                            isSelected ? 'bg-indigo-50/40 hover:bg-indigo-50/50' : '',
                            isDone && 'opacity-70',
                            urgencyBorderClass(f, isDone)
                          )}
                        >
                          <td className="p-3 pl-4" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              checked={selectedIds.has(f.id)}
                              onChange={() => toggleSelectOne(f.id)}
                            />
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col min-w-[140px]">
                              <span className="font-bold text-indigo-600 text-[11px] uppercase">{f.bookingNumber || '—'}</span>
                              <span className="font-black text-slate-700 mt-0.5 text-sm">{f.customerName}</span>
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                {aging && (
                                  <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-black border uppercase tracking-wide', aging.cls)}>
                                    {aging.text}
                                  </span>
                                )}
                                {typeof actCount === 'number' && actCount > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-black bg-slate-100 text-slate-600 border border-slate-200">
                                    <MessageCircle className="h-2.5 w-2.5" />{actCount}
                                  </span>
                                )}
                              </div>
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
                                {f.assignedName ? f.assignedName.split(' ').map(n => n[0]).join('').slice(0, 2) : (f.consultantName ? f.consultantName.split(' ').map(n => n[0]).join('').slice(0, 2) : '??')}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="font-bold text-slate-700 truncate">{f.assignedName || f.consultantName || 'Unassigned'}</span>
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

        {/* Floating Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-2xl ring-1 ring-black/5">
            <span className="text-sm font-black text-slate-700">{selectedIds.size} selected</span>
            <div className="h-5 w-px bg-slate-200" />
            {!bulkRescheduling ? (
              <>
                <Button
                  onClick={() => void handleBulkComplete()}
                  disabled={bulkActioning}
                  className="h-9 gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700 shadow-sm"
                >
                  {bulkActioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                  Complete all
                </Button>
                <Button
                  onClick={() => setBulkRescheduling(true)}
                  variant="outline"
                  className="h-9 gap-1.5 rounded-xl px-4 text-xs font-black border-slate-200 hover:bg-slate-50"
                >
                  <CalendarClock className="h-4 w-4" /> Reschedule all
                </Button>
              </>
            ) : (
              <>
                <input
                  type="datetime-local"
                  value={bulkDueAt}
                  onChange={(e) => setBulkDueAt(e.target.value)}
                  className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold outline-none focus:border-indigo-400"
                />
                <Button
                  onClick={() => void handleBulkReschedule()}
                  disabled={bulkActioning}
                  className="h-9 gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-black text-white hover:bg-indigo-700 shadow-sm"
                >
                  {bulkActioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                  Confirm
                </Button>
                <Button onClick={() => setBulkRescheduling(false)} variant="ghost" className="h-9 rounded-xl px-3 text-xs font-black text-slate-500">
                  Cancel
                </Button>
              </>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="ml-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Slide-over Customer Details Sidebar Drawer — plain overlay, no Radix Dialog */}
        {selectedBookingId && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              onClick={() => setSelectedBookingId(null)}
            />
            {/* Slide-over panel */}
            <div className="fixed inset-y-0 right-0 z-50 flex h-dvh max-h-dvh w-full max-w-lg flex-col gap-0 border-l border-slate-100 bg-white shadow-2xl sm:rounded-l-3xl overflow-hidden">
            {/* (aria hidden title for screen readers) */}
            <span className="sr-only">Customer Profile Details &amp; Remarks Feed</span>
            
            {bookingDetailQuery.isLoading ? (
              <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
            ) : bookingDetailQuery.isError ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm font-bold text-rose-600">Failed to load details.</div>
            ) : bookingDetailQuery.data?.booking ? (
              <div className="flex flex-1 flex-col h-full overflow-hidden">
                
                {/* Header Area */}
                <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Selected Customer</span>
                    <button onClick={() => setSelectedBookingId(null)} className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-100 transition-colors"><X className="h-4 w-4" /></button>
                  </div>
                  <h4 className="font-black text-slate-800 text-lg mt-1 leading-tight">{bookingDetailQuery.data.booking.customerName}</h4>
                  <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-wide">
                    {bookingDetailQuery.data.booking.model} {bookingDetailQuery.data.booking.variant}
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-400">
                    <span className="font-mono text-indigo-600">{bookingDetailQuery.data.booking.bookingNumber}</span>
                    <span>{dealerLabel(bookingDetailQuery.data.booking.dealerCode)}</span>
                  </div>
                  {bookingDetailQuery.data.booking.customerPhone && (
                    <div className="mt-3 flex items-center gap-2">
                      <a
                        href={`https://wa.me/91${String(bookingDetailQuery.data.booking.customerPhone).replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                      <a
                        href={`tel:${bookingDetailQuery.data.booking.customerPhone}`}
                        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors"
                      >
                        <Phone className="h-3.5 w-3.5" /> {bookingDetailQuery.data.booking.customerPhone}
                      </a>
                    </div>
                  )}
                </div>

                {/* Tab Controls */}
                <div className="flex border-b border-slate-100 bg-white px-2">
                  <button
                    onClick={() => setSidebarTab('details')}
                    className={cn(
                      'flex-1 text-center py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors',
                      sidebarTab === 'details' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                    )}
                  >
                    Details
                  </button>
                  <button
                    onClick={() => setSidebarTab('activity')}
                    className={cn(
                      'flex-1 text-center py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors',
                      sidebarTab === 'activity' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                    )}
                  >
                    Activity
                  </button>
                  <button
                    onClick={() => setSidebarTab('remarks')}
                    className={cn(
                      'flex-1 text-center py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors',
                      sidebarTab === 'remarks' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
                    )}
                  >
                    Remarks <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 font-black">{remarksOnly.length}</span>
                  </button>
                </div>

                {/* Tab Body Content (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-5 kia-scroll">
                  
                  {/* 1. Full Specs/Details Tab */}
                  {sidebarTab === 'details' && (
                    <div className="space-y-5 text-xs font-bold text-slate-700">
                      <div>
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-2 border-b border-indigo-50 pb-1">Customer Specs</h5>
                        <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Phone</span>
                            <p className="text-slate-800 font-black mt-0.5">{bookingDetailQuery.data.booking.customerPhone || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Email</span>
                            <p className="text-slate-800 font-black mt-0.5 truncate">{bookingDetailQuery.data.booking.customerEmail || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Aadhaar</span>
                            <p className="text-slate-800 mt-0.5">{bookingDetailQuery.data.booking.customerAadhar || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">PAN</span>
                            <p className="text-slate-800 mt-0.5">{bookingDetailQuery.data.booking.customerPan || '—'}</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase">Address</span>
                            <p className="text-slate-700 font-semibold mt-0.5 leading-relaxed">{bookingDetailQuery.data.booking.address || '—'}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-2 border-b border-indigo-50 pb-1">Vehicle Details</h5>
                        <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Model</span>
                            <p className="text-slate-800 font-black mt-0.5 uppercase">{bookingDetailQuery.data.booking.model}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Variant</span>
                            <p className="text-slate-800 mt-0.5 uppercase">{bookingDetailQuery.data.booking.variant}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Color</span>
                            <p className="text-slate-800 mt-0.5 uppercase">{bookingDetailQuery.data.booking.color || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Fuel Type</span>
                            <p className="text-slate-800 mt-0.5 uppercase">{bookingDetailQuery.data.booking.fuelType || '—'}</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase">Allotted VIN</span>
                            <p className="text-slate-800 mt-0.5 font-mono">{bookingDetailQuery.data.booking.allocatedVin || '—'}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-indigo-500 mb-2 border-b border-indigo-50 pb-1">Booking &amp; Finance</h5>
                        <div className="grid grid-cols-2 gap-3 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Booking Date</span>
                            <p className="text-slate-800 font-black mt-0.5">
                              {bookingDetailQuery.data.booking.createdAt
                                ? new Date(bookingDetailQuery.data.booking.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Status</span>
                            <p className="text-slate-800 font-black mt-0.5 uppercase">{bookingDetailQuery.data.booking.status}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Delivery Target</span>
                            <p className="text-slate-800 mt-0.5">{bookingDetailQuery.data.booking.expectedDeliveryDate || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Booking Amount</span>
                            <p className="text-slate-800 mt-0.5 font-mono">
                              {bookingDetailQuery.data.booking.bookingAmount != null
                                ? `₹${Number(bookingDetailQuery.data.booking.bookingAmount).toLocaleString('en-IN')}`
                                : '—'}
                            </p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Proforma ID</span>
                            <p className="text-slate-800 mt-0.5 font-mono">{bookingDetailQuery.data.booking.proformaNumber || '—'}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Finance Order ID</span>
                            <p className="text-slate-800 mt-0.5 font-mono">{bookingDetailQuery.data.booking.financeOrderNumber || '—'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 2. Activity Timeline Tab */}
                  {sidebarTab === 'activity' && (
                    <div className="relative border-l border-slate-100 pl-4 ml-3 space-y-4 pt-1">
                      {activitiesList.map((act) => {
                        const meta = getActivityMeta(act.type, act.description)
                        const Icon = meta.icon
                        return (
                          <div key={act.id} className="relative">
                            <span className={cn(
                              'absolute -left-[25px] top-0 flex h-4 w-4 items-center justify-center rounded-full border text-[8px] shadow-sm ring-4 ring-white',
                              meta.iconBg
                            )}>
                              <Icon className="h-2 w-2" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{meta.title}</div>
                              {act.description && (
                                <p className="mt-1 text-xs font-semibold text-slate-800 bg-slate-100 p-2.5 rounded-xl border border-slate-200 leading-relaxed whitespace-pre-wrap">
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
                    </div>
                  )}

                  {/* 3. Secondary/Remarks Feed Tab */}
                  {sidebarTab === 'remarks' && (
                    <div className="space-y-4">
                      
                      {/* Remarks List Feed */}
                      <div className="space-y-3">
                        {remarksOnly.map((act) => {
                          const isCall = act.type === 'followup_completed'
                          return (
                            <div
                              key={act.id}
                              className={cn(
                                'p-3 rounded-xl border shadow-sm text-slate-800',
                                isCall
                                  ? 'bg-emerald-50/90 border-emerald-100/80'
                                  : 'bg-indigo-50/80 border-indigo-100/80'
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider',
                                  isCall ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'
                                )}>
                                  {isCall ? 'Call log' : 'Remark'}
                                </span>
                                <span className="text-[9px] font-bold text-slate-400">
                                  {new Date(act.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="mt-1.5 text-xs font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                                {act.description}
                              </p>
                              <div className="mt-1.5 text-[9px] font-bold text-slate-400 text-right">
                                — {act.actorName || 'System'}
                              </div>
                            </div>
                          )
                        })}
                        {remarksOnly.length === 0 && (
                          <div className="py-8 text-center text-slate-400 font-bold">
                            No remarks recorded.
                          </div>
                        )}
                      </div>

                      {/* Add Remark Form */}
                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        <textarea
                          value={remarkText}
                          onChange={(e) => setRemarkText(e.target.value)}
                          rows={3}
                          placeholder="Add a remark..."
                          className="w-full rounded-xl border border-slate-200 p-3 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-400 bg-white"
                        />
                        <Button
                          onClick={() => void handleAddRemark()}
                          disabled={addingRemark || !remarkText.trim()}
                          className="w-full h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold gap-1.5 shadow-sm"
                        >
                          {addingRemark ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                          Add Remark
                        </Button>
                      </div>

                    </div>
                  )}

                </div>

              </div>
            ) : null}
            </div>
          </>
        )}

      {calling && <CallDialog f={calling} onClose={() => setCalling(null)} />}
      {adding && <AddFollowupDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void query.refetch() }} />}
      {completing && <CompleteDialog f={completing} onClose={() => setCompleting(null)} onSaved={() => { setCompleting(null); void query.refetch(); if (selectedBookingId) void bookingDetailQuery.refetch() }} />}
      {rescheduling && <RescheduleDialog f={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => { setRescheduling(null); void query.refetch(); if (selectedBookingId) void bookingDetailQuery.refetch() }} />}

      <BookingDetailsDialog 
        open={detailBookingOpen} 
        onClose={() => setDetailBookingOpen(false)} 
        bookingDetail={bookingDetailQuery.data} 
        isLoading={bookingDetailQuery.isLoading} 
      />

      <AlarmAlertPopup 
        followup={activeAlarmFollowup} 
        onClose={() => setActiveAlarmFollowup(null)} 
        onCall={(f) => {
          setActiveAlarmFollowup(null)
          setCalling(f)
        }}
      />
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
  const [customOutcome, setCustomOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [notInterestedReason, setNotInterestedReason] = useState('')
  const [scheduleNext, setScheduleNext] = useState(false)
  const [nextAt, setNextAt] = useState(defaultLocal(FOLLOWUP_REPEAT_DAYS))
  const [saving, setSaving] = useState(false)

  const isCustomOutcome = outcome === '__custom__'
  const isNotInterested = outcome === 'not_interested'
  const effectiveOutcome = isCustomOutcome ? customOutcome.trim() : outcome
  const remarksOk = countWords(notes) > MIN_REMARK_WORDS
  const canSave = Boolean(effectiveOutcome) && remarksOk && (!isNotInterested || Boolean(notInterestedReason)) && (!isCustomOutcome || customOutcome.trim().length > 2)
  const autoRepeats = CONTACTED_OUTCOME_VALUES.has(outcome)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          outcome: effectiveOutcome || undefined,
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
            {isCustomOutcome && (
              <input
                autoFocus
                value={customOutcome}
                onChange={(e) => setCustomOutcome(e.target.value)}
                placeholder="Type your custom outcome…"
                className="mt-2 w-full rounded-xl border border-indigo-300 bg-indigo-50/50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500 placeholder-slate-400"
              />
            )}
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
  const [rescheduleReason, setRescheduleReason] = useState('')
  const [customReason, setCustomReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const isCustomReason = rescheduleReason === '__custom__'
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
            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Reason for rescheduling</label>
            <Select value={rescheduleReason} onValueChange={setRescheduleReason}>
              <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Select reason" /></SelectTrigger>
              <SelectContent>{RESCHEDULE_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            {isCustomReason && (
              <input
                autoFocus
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Type your custom reason…"
                className="mt-2 w-full rounded-xl border border-indigo-300 bg-indigo-50/50 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-500 placeholder-slate-400"
              />
            )}
          </div>
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

function BookingDetailsDialog({
  open,
  onClose,
  bookingDetail,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  bookingDetail: any
  isLoading: boolean
}) {
  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-6">
        <DialogHeader className="border-b border-slate-100 pb-4">
          <DialogTitle className="text-xl font-black text-slate-800">
            Booking Specification File Details
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-slate-400 mt-1">
            Complete records of this customer booking from first entry to current stage
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          </div>
        ) : !bookingDetail?.booking ? (
          <div className="p-8 text-center text-slate-400 font-bold">
            No booking data found.
          </div>
        ) : (
          <div className="space-y-6 pt-4 text-xs font-bold text-slate-700">
            {/* 1. Customer & General Specs */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3 border-b border-indigo-50 pb-1">1. Customer Info</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Name</span>
                  <span className="text-slate-800 text-sm font-black mt-0.5 block">{bookingDetail.booking.customerName}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Phone</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.customerPhone || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Email</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.customerEmail || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Aadhaar Card</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.customerAadhar || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">PAN Number</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.customerPan || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Customer Type</span>
                  <span className="text-slate-800 mt-0.5 block font-bold uppercase">{bookingDetail.booking.customerType || '—'}</span>
                </div>
                <div className="md:col-span-3">
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Address</span>
                  <span className="text-slate-700 mt-0.5 block font-semibold leading-relaxed">{bookingDetail.booking.address || '—'}</span>
                </div>
              </div>
            </div>

            {/* 2. Vehicle & Target Specs */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3 border-b border-indigo-50 pb-1">2. Vehicle Specifications</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Model</span>
                  <span className="text-slate-800 text-sm font-black mt-0.5 block uppercase">{bookingDetail.booking.model}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Variant</span>
                  <span className="text-slate-800 mt-0.5 block font-bold uppercase">{bookingDetail.booking.variant}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Color Preference</span>
                  <span className="text-slate-800 mt-0.5 block font-bold uppercase">{bookingDetail.booking.color || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Fuel Type</span>
                  <span className="text-slate-800 mt-0.5 block font-bold uppercase">{bookingDetail.booking.fuelType || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Chassis / VIN Number</span>
                  <span className="text-slate-800 mt-0.5 block font-mono font-bold">{bookingDetail.booking.allocatedVin || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Consultant Name</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.consultantName || '—'}</span>
                </div>
              </div>
            </div>

            {/* 3. Booking Details */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3 border-b border-indigo-50 pb-1">3. Booking Status & Dates</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Booking Number</span>
                  <span className="text-indigo-600 font-extrabold mt-0.5 block">{bookingDetail.booking.bookingNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Status</span>
                  <span className="text-slate-800 mt-0.5 block font-black uppercase">{bookingDetail.booking.status}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Target Delivery Date</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.expectedDeliveryDate || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Dealer Branch</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{DEALER_LABELS[bookingDetail.booking.dealerCode] || bookingDetail.booking.dealerCode}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Finance Required</span>
                  <span className="text-slate-800 mt-0.5 block font-bold">{bookingDetail.booking.financeRequired ? 'Yes' : 'No'}</span>
                </div>
              </div>
            </div>

            {/* 4. Proforma & Payouts */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3 border-b border-indigo-50 pb-1">4. Proforma & Payouts</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Proforma ID</span>
                  <span className="text-slate-800 mt-0.5 block font-mono">{bookingDetail.booking.proformaNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] font-black uppercase text-slate-400 block">Finance Order ID</span>
                  <span className="text-slate-800 mt-0.5 block font-mono">{bookingDetail.booking.financeOrderNumber || '—'}</span>
                </div>
              </div>
            </div>

            {/* 5. Document Scans */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 mb-3 border-b border-indigo-50 pb-1">5. Customer Document Scans</h3>
              <div className="flex gap-4">
                {bookingDetail.booking.metadata?.aadharCardUrl ? (
                  <a
                    href={String(bookingDetail.booking.metadata.aadharCardUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-indigo-600"
                  >
                    Download Aadhaar Scan
                  </a>
                ) : (
                  <span className="text-slate-400 font-semibold p-2 border border-dashed rounded-xl">No Aadhaar Uploaded</span>
                )}
                {bookingDetail.booking.metadata?.panCardUrl ? (
                  <a
                    href={String(bookingDetail.booking.metadata.panCardUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-indigo-600"
                  >
                    Download PAN Scan
                  </a>
                ) : (
                  <span className="text-slate-400 font-semibold p-2 border border-dashed rounded-xl">No PAN Uploaded</span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 border-t border-slate-100 pt-4 flex justify-end">
          <Button onClick={onClose} className="h-10 px-6 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold">
            Close specifications file
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AlarmAlertPopup({
  followup,
  onClose,
  onCall,
}: {
  followup: Followup | null
  onClose: () => void
  onCall: (f: Followup) => void
}) {
  if (!followup) return null

  return (
    <Dialog open={Boolean(followup)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md rounded-2xl p-6 border-2 border-indigo-500 shadow-2xl bg-white">
        <DialogHeader className="text-center flex flex-col items-center">
          <div className="h-16 w-16 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 border-2 border-indigo-200">
            <Clock className="h-8 w-8" />
          </div>
          <DialogTitle className="text-lg font-black text-indigo-900 mt-4">
            ⏰ Follow-up Alarm Callback Alert!
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-slate-400 mt-1">
            This customer callback scheduled for today is due now.
          </DialogDescription>
        </DialogHeader>

        <div className="my-5 bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-2.5 text-xs text-slate-600 font-bold">
          <div className="flex justify-between border-b border-slate-100 pb-1.5">
            <span className="text-slate-400">Customer Name</span>
            <span className="text-slate-800 text-sm font-black uppercase">{followup.customerName}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-1.5">
            <span className="text-slate-400">Booking / Model</span>
            <span className="text-slate-800 font-extrabold">{followup.bookingNumber || '—'} · {followup.model}</span>
          </div>
          <div className="flex justify-between border-b border-slate-100 pb-1.5">
            <span className="text-slate-400">Scheduled Time</span>
            <span className="text-indigo-600 font-black">{new Date(followup.dueAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {followup.notes && (
            <div className="pt-1.5">
              <span className="text-slate-400 block mb-1">Previous Notes</span>
              <p className="text-slate-700 bg-white border border-slate-100 p-2.5 rounded-lg font-medium leading-relaxed italic">
                "{followup.notes}"
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <Button 
            variant="outline" 
            className="h-11 rounded-xl text-xs font-black uppercase tracking-wider border-slate-200" 
            onClick={onClose}
          >
            Acknowledge
          </Button>
          <Button 
            className="h-11 gap-1.5 rounded-xl bg-indigo-600 text-xs font-black uppercase tracking-wider text-white hover:bg-indigo-700 shadow-md shadow-indigo-100" 
            onClick={() => onCall(followup)}
          >
            <Phone className="h-4 w-4" /> Start Call
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
