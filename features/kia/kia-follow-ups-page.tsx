'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  MessageCircle,
  Download,
  BarChart3
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
  bucket: 'not_connected' | 'customer_concerns' | 'pending' | 'next_day' | 'scheduled' | 'cancelled' | 'rescheduled'
  overdue: boolean
  customerPhone: string | null
}
type Counts = { not_connected: number; customer_concerns: number; pending: number; next_day: number; scheduled: number; cancelled: number; rescheduled: number; overdue: number }
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
  { value: 'customer_concern', label: 'Customer Concern' },
  { value: 'general', label: 'General' },
]
const OUTCOMES = [
  { value: 'reached', label: 'Reached / spoke' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'customer_concern', label: 'Customer Concern' },
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
  { value: 'customer_concern', label: 'Customer Concern' },
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
  { key: 'pending', label: 'Pending Call', tone: 'text-amber-600', hint: 'Open follow-ups' },
  { key: 'not_connected', label: 'Not Connected', tone: 'text-rose-600', hint: 'Last call failed' },
  { key: 'customer_concerns', label: 'Customer Concerns', tone: 'text-amber-600', hint: 'Logged customer concerns' },
  { key: 'rescheduled', label: 'Rescheduled', tone: 'text-violet-600', hint: 'Rescheduled open touches' },
  { key: 'next_day', label: 'Next Day', tone: 'text-indigo-600', hint: 'Due tomorrow' },
  { key: 'scheduled', label: 'Scheduled', tone: 'text-teal-600', hint: 'Future follow-ups' },
  { key: 'cancelled', label: 'Cancelled', tone: 'text-slate-500', hint: 'Cancelled bookings' },
  { key: 'analytics', label: 'Analytics', tone: 'text-indigo-600', hint: 'Performance & completion metrics' },
] as const

const MIN_REMARK_LENGTH = 10
const MIN_REMARK_WORDS = 10
function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length
}
const FOLLOWUP_REPEAT_DAYS = 7
const CONTACTED_OUTCOME_VALUES = new Set(['reached', 'done'])

function dealerLabel(code: string | null) { return code ? (DEALER_LABELS[code] || code) : '—' }

/** Converts an HTML datetime-local string (e.g. "2026-07-25T16:30") explicitly to IST ISO. */
function toIstIso(value: string): string {
  if (!value) return new Date().toISOString()
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}:00+05:30`).toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}+05:30`).toISOString()
  }
  return new Date(trimmed).toISOString()
}

function defaultLocal(daysAhead = 1) {
  const now = new Date()
  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' }
  const formatter = new Intl.DateTimeFormat('en-CA', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' })
  const targetTime = new Date(now.getTime() + daysAhead * 86_400_000)
  const ymd = formatter.format(targetTime)
  return `${ymd}T10:00`
}

function formatDue(iso: string, bucket: Followup['bucket']) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'

  const options: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata' }
  const time = d.toLocaleTimeString('en-IN', { ...options, hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = d.toLocaleDateString('en-IN', { ...options, day: '2-digit', month: 'short' })

  const now = new Date()
  const targetFormatter = new Intl.DateTimeFormat('en-CA', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' })
  const targetYmd = targetFormatter.format(d)
  const nowYmd = targetFormatter.format(now)

  const targetDate = new Date(`${targetYmd}T00:00:00+05:30`)
  const nowDate = new Date(`${nowYmd}T00:00:00+05:30`)
  const dayDiff = Math.round((targetDate.getTime() - nowDate.getTime()) / 86_400_000)

  const diffMs = d.getTime() - now.getTime()
  if (diffMs < 0 && (bucket === 'pending' || bucket === 'rescheduled')) {
    const mins = Math.floor(-diffMs / 60_000)
    if (mins < 60) return 'Due now'
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h overdue`
    return `${Math.floor(hours / 24)}d overdue`
  }

  if (dayDiff === 0) return `Today · ${time}`
  if (dayDiff === 1) return `Tomorrow · ${time}`
  if (dayDiff === -1) return `Yesterday · ${time}`
  return `${dateStr} · ${time}`
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
    return { label: 'Payment Confirmed', tone: 'emerald' as const }
  }
  return { label: 'Payment Pending', tone: 'amber' as const }
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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [reason, setReason] = useState('all')
  const [rescheduleReason, setRescheduleReason] = useState('all')
  const [dealer, setDealer] = useState('all')
  const [model, setModel] = useState('all')
  const [bookingStatus, setBookingStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [dateField, setDateField] = useState<'due_date' | 'booking_date' | 'completed_date'>('due_date')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<Followup['bucket'] | 'analytics'>('pending')
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'details' | 'activity' | 'remarks'>('details')
  const [remarkText, setRemarkText] = useState('')
  const [addingRemark, setAddingRemark] = useState(false)

  // Search Debouncing (350ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
    }, 350)
    return () => clearTimeout(handler)
  }, [search])

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

  // Customer Concern Dialog State
  const [concerningFollowup, setConcerningFollowup] = useState<Followup | null>(null)
  const [concernText, setConcernText] = useState('')
  const [isSubmittingConcern, setIsSubmittingConcern] = useState(false)

  const handleSubmitConcern = async () => {
    if (!concerningFollowup || !concernText.trim()) return
    setIsSubmittingConcern(true)
    try {
      const formattedNote = `[CUSTOMER CONCERN] ${concernText.trim()}`
      await patch(concerningFollowup.id, {
        action: 'update',
        reason: 'customer_concern',
        outcome: 'customer_concern',
        notes: formattedNote,
      }, 'Customer Concern Logged Successfully')

      await fetch(`/api/brands/kia/bookings/${concerningFollowup.bookingId}/remarks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remark: formattedNote }),
      }).catch(() => {})

      setConcerningFollowup(null)
      setConcernText('')
    } catch (e) {
      toast({ title: 'Failed to log concern', description: e instanceof Error ? e.message : '', variant: 'error' })
    } finally {
      setIsSubmittingConcern(false)
    }
  }

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkRescheduling, setBulkRescheduling] = useState(false)
  const [bulkDueAt, setBulkDueAt] = useState(defaultLocal(1))
  const [bulkActioning, setBulkActioning] = useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Excel export
  const [exporting, setExporting] = useState(false)

  const canCall = canRevealKiaFollowupPhone(currentUserRole)

  // Quick Status Action Handler for the + Icon
  const handleQuickStatusAction = async (
    f: Followup,
    action: 'delivered' | 'cancelled' | 'fake_booking' | 'pending' | 'demo_vehicle' | 'repeated_booking'
  ) => {
    try {
      if (action === 'delivered') {
        await patch(f.id, { action: 'complete', outcome: 'converted', notes: 'Delivered' }, 'Marked as Delivered & Completed')
      } else if (action === 'cancelled') {
        await patch(f.id, { action: 'cancel', notes: 'Booking Cancelled' }, 'Booking Cancelled')
      } else if (action === 'fake_booking') {
        await patch(f.id, { action: 'update', notes: 'Fake Booking', reason: 'fake_booking' }, 'Marked as Fake Booking')
      } else if (action === 'pending') {
        await patch(f.id, { action: 'update', notes: 'Status set to Pending', reason: 'pending' }, 'Status set to Pending')
      } else if (action === 'demo_vehicle') {
        await patch(f.id, { action: 'update', notes: 'Demo Vehicle', reason: 'demo_vehicle' }, 'Marked as Demo Vehicle')
      } else if (action === 'repeated_booking') {
        await patch(f.id, { action: 'update', notes: 'Repeated Booking', reason: 'repeated_booking' }, 'Marked as Repeated Booking')
      }
    } catch (e) {
      toast({ title: 'Action Failed', description: e instanceof Error ? e.message : '', variant: 'error' })
    }
  }

  // Build params helper — shared by list query + export
  const buildParams = () => {
    const params = new URLSearchParams()
    if (mine) params.set('mine', '1')
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (reason !== 'all') params.set('reason', reason)
    if (rescheduleReason !== 'all') params.set('rescheduleReason', rescheduleReason)
    if (dealer !== 'all') params.set('dealer', dealer)
    if (model !== 'all') params.set('model', model)
    if (bookingStatus !== 'all') params.set('bookingStatus', bookingStatus)
    if (priority !== 'all') params.set('priority', priority)
    if (dateField !== 'due_date') params.set('dateField', dateField)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    return params
  }

  // Count active (non-default) filters for the badge
  const activeFilterCount = [
    mine,
    reason !== 'all',
    rescheduleReason !== 'all',
    dealer !== 'all',
    model !== 'all',
    bookingStatus !== 'all',
    priority !== 'all',
    Boolean(startDate || endDate),
  ].filter(Boolean).length

  // Quick date preset helper (IST-aware)
  const applyDatePreset = (preset: 'today' | 'tomorrow' | 'this_week' | 'this_month' | 'all') => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    if (preset === 'all') { setStartDate(''); setEndDate(''); return }
    if (preset === 'today') { setStartDate(fmt(now)); setEndDate(fmt(now)); return }
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
    if (preset === 'tomorrow') { setStartDate(fmt(tomorrow)); setEndDate(fmt(tomorrow)); return }
    if (preset === 'this_week') {
      const day = now.getDay()
      const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
      setStartDate(fmt(mon)); setEndDate(fmt(sun)); return
    }
    if (preset === 'this_month') {
      setStartDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`)
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      setEndDate(fmt(lastDay)); return
    }
  }

  const clearAllFilters = () => {
    setMine(false); setSearch(''); setDebouncedSearch(''); setReason('all'); setRescheduleReason('all'); setDealer('all')
    setModel('all'); setBookingStatus('all'); setPriority('all')
    setDateField('due_date'); setStartDate(''); setEndDate('')
  }

  const query = useQuery<ListResponse>({
    queryKey: ['kia-followups', mine, debouncedSearch, reason, rescheduleReason, dealer, model, bookingStatus, priority, dateField, startDate, endDate],
    queryFn: async () => {
      const params = buildParams()
      const res = await fetch(`/api/brands/kia/follow-ups?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load')
      return res.json()
    },
  })

  const data = query.data

  // Download every follow-up (honouring the current filters) as an .xlsx. The server never puts the
  // customer mobile number in the file — see app/api/brands/kia/follow-ups/export/route.ts.
  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const params = buildParams()
      const res = await fetch(`/api/brands/kia/follow-ups/export?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `booking-follow-ups-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not export follow-ups')
    } finally {
      setExporting(false)
    }
  }

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

        // ONLY trigger alarm if the follow-up was explicitly rescheduled for today!
        const isRescheduledSameDay = f.source === 'rescheduled' && isSameDay
        
        if (isRescheduledSameDay && isTimeReached && isNotAlerted) {
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
    const g: Record<Followup['bucket'], Followup[]> = { not_connected: [], customer_concerns: [], pending: [], next_day: [], scheduled: [], cancelled: [], rescheduled: [] }
    for (const r of data?.rows || []) g[r.bucket].push(r)
    return g
  }, [data])

  const filteredRows = useMemo(() => {
    if (activeTab === 'analytics') return []
    return grouped[activeTab as Followup['bucket']] || []
  }, [grouped, activeTab])

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    const end = start + pageSize
    return filteredRows.slice(start, end)
  }, [filteredRows, currentPage, pageSize])

  const totalPages = Math.ceil(filteredRows.length / pageSize)

  // Warm the detail cache ONLY for the row the user is about to open — hover-intent + pointerdown,
  // never every visible row. The previous "prefetch all rows so the sidebar opens instantly" effect
  // re-fired on every paginatedRows identity change (each keystroke, tab, filter, page, refetch) and
  // put /api/brands/kia/bookings/[id] at ~950 invocations against 45 list loads in a couple of
  // hours; its ~20 parallel detail fetches per burst (×3 pooled statements each) also drove the
  // 4-5% error spikes (pooler saturation). Same fix as the bookings table's hover storm.
  const queryClient = useQueryClient()
  const prefetchBookingDetail = useCallback((bookingId: string | null | undefined) => {
    if (!bookingId) return
    void queryClient.prefetchQuery({
      queryKey: ['kia-booking-detail', bookingId],
      queryFn: async () => {
        const res = await fetch(`/api/brands/kia/bookings/${bookingId}`, { cache: 'no-store' })
        // Throw on failure: prefetchQuery swallows the error, and we must NOT cache null — the old
        // version did, which left the sidebar rendering an empty payload until staleness.
        if (!res.ok) throw new Error('Failed to load detail')
        return res.json()
      },
      staleTime: 60_000,
    })
  }, [queryClient])
  // One shared hover-intent timer for the whole table: entering a row arms it, leaving cancels it,
  // so sweeping the pointer down the list fires nothing. Pointerdown warms immediately on a real
  // click (it precedes click by ~100ms), so the sidebar still opens on a warm/in-flight cache.
  const hoverIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduleRowPrefetch = useCallback((bookingId: string | null | undefined) => {
    if (hoverIntentTimer.current) clearTimeout(hoverIntentTimer.current)
    hoverIntentTimer.current = setTimeout(() => prefetchBookingDetail(bookingId), 220)
  }, [prefetchBookingDetail])
  const cancelRowPrefetch = useCallback(() => {
    if (hoverIntentTimer.current) clearTimeout(hoverIntentTimer.current)
  }, [])

  // Reset page when tab/filters change
  useEffect(() => {
    setCurrentPage(1)
    setSelectedBookingId(null)
  }, [activeTab, search, reason, mine, dealer, model, bookingStatus, priority, dateField, startDate, endDate])

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
    return list.filter((act) => 
      act.type === 'remark_added' || 
      act.type === 'followup_completed' || 
      act.type === 'followup_updated' || 
      act.type === 'followup_scheduled' ||
      act.type === 'followup_remark' ||
      (Boolean(act.description) && String(act.description).trim().length > 0)
    )
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
          body: JSON.stringify({ action: 'update', dueAt: toIstIso(bulkDueAt), notes: 'Bulk rescheduled by CRE team.' }),
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
          
          {/* ── Toolbar ─────────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

            {/* Primary bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              {/* Left: search + toggle */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative flex items-center h-9 w-72 rounded-xl border border-slate-200 bg-slate-50 px-3 gap-2 focus-within:bg-white focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                  <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, model, booking #, consultant…"
                    className="flex-1 border-0 bg-transparent text-xs font-medium outline-none text-slate-700 placeholder:text-slate-400"
                  />
                  {search && (
                    <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Filters toggle button */}
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={cn(
                    'inline-flex items-center gap-2 h-9 px-4 rounded-xl border text-xs font-bold tracking-wide transition-all duration-150',
                    filtersOpen || activeFilterCount > 0
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className={cn(
                      'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-black',
                      filtersOpen ? 'bg-white/20 text-white' : 'bg-indigo-600 text-white'
                    )}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {/* Clear-all pill */}
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-500 text-xs font-bold hover:bg-rose-100 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear all
                  </button>
                )}
              </div>

              {/* Right: export */}
              <Button
                onClick={handleExport}
                disabled={exporting}
                variant="outline"
                title="Download all follow-ups as Excel (mobile numbers excluded)"
                className="h-9 gap-2 rounded-xl px-4 text-xs font-bold border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                {exporting ? 'Exporting…' : 'Export Excel'}
              </Button>
            </div>

            {/* Active filter chips strip */}
            {activeFilterCount > 0 && !filtersOpen && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-3">
                {reason !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                    Reason: {REASONS.find(r => r.value === reason)?.label ?? reason}
                    <button onClick={() => setReason('all')} className="ml-0.5 hover:text-indigo-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {dealer !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                    Dealer: {dealer}
                    <button onClick={() => setDealer('all')} className="ml-0.5 hover:text-indigo-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {model !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                    Model: {model}
                    <button onClick={() => setModel('all')} className="ml-0.5 hover:text-indigo-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {bookingStatus !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                    Status: {bookingStatus.replace(/_/g, ' ')}
                    <button onClick={() => setBookingStatus('all')} className="ml-0.5 hover:text-indigo-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {priority !== 'all' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-semibold">
                    Priority: {priority}
                    <button onClick={() => setPriority('all')} className="ml-0.5 hover:text-indigo-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {(startDate || endDate) && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[11px] font-semibold">
                    {dateField === 'due_date' ? 'Due' : dateField === 'booking_date' ? 'Booked' : 'Completed'}: {startDate || '…'} → {endDate || '…'}
                    <button onClick={() => { setStartDate(''); setEndDate('') }} className="ml-0.5 hover:text-violet-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
                {mine && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold">
                    My follow-ups
                    <button onClick={() => setMine(false)} className="ml-0.5 hover:text-emerald-900"><X className="h-3 w-3" /></button>
                  </span>
                )}
              </div>
            )}

            {/* ── Expanded filter drawer ──────────────────────────────── */}
            {filtersOpen && (
              <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-5 py-5 space-y-5">

                {/* Section: Date range */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Date Range</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    {/* Date Field selector */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filter by</label>
                      <Select value={dateField} onValueChange={(v) => setDateField(v as typeof dateField)}>
                        <SelectTrigger className="h-9 w-44 rounded-xl border-slate-200 text-xs font-semibold bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="due_date">Due Date</SelectItem>
                          <SelectItem value="booking_date">Booking Date</SelectItem>
                          <SelectItem value="completed_date">Completed Date</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* From */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">From</label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="h-9 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white text-xs font-semibold text-slate-700 w-36 cursor-pointer"
                      />
                    </div>

                    {/* To */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">To</label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="h-9 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 bg-white text-xs font-semibold text-slate-700 w-36 cursor-pointer"
                      />
                    </div>

                    {/* Quick presets */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Quick</label>
                      <div className="flex items-center gap-1">
                        {(['today', 'tomorrow', 'this_week', 'this_month', 'all'] as const).map((p) => {
                          const isActive =
                            p === 'all' ? !startDate && !endDate : false
                          return (
                            <button
                              key={p}
                              onClick={() => applyDatePreset(p)}
                              className={cn(
                                'h-9 px-3 rounded-xl border text-[10px] font-bold uppercase tracking-wide transition-all',
                                isActive
                                  ? 'bg-indigo-600 border-indigo-600 text-white'
                                  : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
                              )}
                            >
                              {p === 'this_week' ? 'Week' : p === 'this_month' ? 'Month' : p.charAt(0).toUpperCase() + p.slice(1).replace('_', ' ')}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Attribute filters */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Filters</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">

                    {/* Dealer */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dealer</label>
                      <Select value={dealer} onValueChange={setDealer}>
                        <SelectTrigger className={cn('h-9 w-40 rounded-xl text-xs font-semibold bg-white', dealer !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All Dealers" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Dealers</SelectItem>
                          <SelectItem value="JK402">Jammu (JK402)</SelectItem>
                          <SelectItem value="JK501">Udhampur (JK501)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Model */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vehicle Model</label>
                      <Select value={model} onValueChange={setModel}>
                        <SelectTrigger className={cn('h-9 w-40 rounded-xl text-xs font-semibold bg-white', model !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All Models" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Models</SelectItem>
                          <SelectItem value="Seltos">Seltos</SelectItem>
                          <SelectItem value="Sonet">Sonet</SelectItem>
                          <SelectItem value="Carens">Carens</SelectItem>
                          <SelectItem value="EV6">EV6</SelectItem>
                          <SelectItem value="Carnival">Carnival</SelectItem>
                          <SelectItem value="Syros">Syros</SelectItem>
                          <SelectItem value="EV9">EV9</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Booking Status */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Booking Status</label>
                      <Select value={bookingStatus} onValueChange={setBookingStatus}>
                        <SelectTrigger className={cn('h-9 w-48 rounded-xl text-xs font-semibold bg-white', bookingStatus !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All Statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="booking_done">Booking Done</SelectItem>
                          <SelectItem value="allotted">Allotted</SelectItem>
                          <SelectItem value="proforma_generated">Proforma Generated</SelectItem>
                          <SelectItem value="payment_confirmed">Payment Confirmed</SelectItem>
                          <SelectItem value="ready_delivery">Ready for Delivery</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Priority */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Priority</label>
                      <Select value={priority} onValueChange={setPriority}>
                        <SelectTrigger className={cn('h-9 w-36 rounded-xl text-xs font-semibold bg-white', priority !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Priorities</SelectItem>
                          <SelectItem value="high">🔴 High</SelectItem>
                          <SelectItem value="normal">🟡 Normal</SelectItem>
                          <SelectItem value="low">🟢 Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Reason */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Follow-up Reason</label>
                      <Select value={reason} onValueChange={setReason}>
                        <SelectTrigger className={cn('h-9 w-48 rounded-xl text-xs font-semibold bg-white', reason !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All Reasons" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Reasons</SelectItem>
                          {REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Reschedule Reason / Remarks */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reschedule Reason / Remarks</label>
                      <Select value={rescheduleReason} onValueChange={setRescheduleReason}>
                        <SelectTrigger className={cn('h-9 w-52 rounded-xl text-xs font-semibold bg-white', rescheduleReason !== 'all' ? 'border-indigo-400 text-indigo-700' : 'border-slate-200')}>
                          <SelectValue placeholder="All Remarks / Reasons" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Remarks / Reasons</SelectItem>
                          {RESCHEDULE_REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                          <SelectItem value="fake_booking">Fake Booking</SelectItem>
                          <SelectItem value="demo_vehicle">Demo Vehicle</SelectItem>
                          <SelectItem value="repeated_booking">Repeated Booking</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Mine toggle */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned To</label>
                      <button
                        onClick={() => setMine((v) => !v)}
                        className={cn(
                          'inline-flex items-center gap-2 h-9 px-4 rounded-xl border text-xs font-semibold transition-all',
                          mine
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                        )}
                      >
                        <User2 className="h-3.5 w-3.5" />
                        {mine ? 'My Follow-ups' : 'All Staff'}
                      </button>
                    </div>

                  </div>
                </div>

              </div>
            )}
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
          <div className="flex border-b border-slate-200 bg-white px-4 pt-2 rounded-t-2xl border-x border-t border-slate-100 flex-wrap">
            {BUCKETS.map((b) => {
              const isAnalytics = b.key === 'analytics'
              const count = isAnalytics ? null : (data?.counts[b.key as keyof Counts] ?? 0)
              const isActive = activeTab === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setActiveTab(b.key as typeof activeTab)}
                  className={cn(
                    'border-b-2 px-4 py-3 text-xs font-black uppercase tracking-wider transition-all -mb-px flex items-center gap-1.5 cursor-pointer',
                    isActive
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  )}
                >
                  {b.key === 'analytics' && <BarChart3 className="h-3.5 w-3.5" />}
                  {b.label}
                  {count !== null && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-black',
                        isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Container */}
          <div className="bg-white rounded-b-2xl border-x border-b border-slate-100 shadow-sm overflow-hidden min-h-[300px]">
            {activeTab === 'analytics' ? (
              <FollowupsAnalyticsView dealer={dealer} />
            ) : query.isLoading ? (
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
                          onMouseEnter={() => scheduleRowPrefetch(f.bookingId)}
                          onMouseLeave={cancelRowPrefetch}
                          onPointerDown={() => prefetchBookingDetail(f.bookingId)}
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

                              <Button
                                onClick={() => setConcerningFollowup(f)}
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 rounded-lg text-slate-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                                title="Log Customer Concern"
                              >
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                    title="Quick Actions"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="font-bold w-48 shadow-lg">
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'delivered')}
                                    className="text-emerald-600 focus:text-emerald-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <CheckCheck className="h-4 w-4 text-emerald-600" /> Delivered
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'cancelled')}
                                    className="text-rose-600 focus:text-rose-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <X className="h-4 w-4 text-rose-600" /> Booking Cancelled
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'fake_booking')}
                                    className="text-amber-600 focus:text-amber-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Fake Booking
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'pending')}
                                    className="text-indigo-600 focus:text-indigo-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <Timer className="h-4 w-4 text-indigo-600" /> Pending
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'demo_vehicle')}
                                    className="text-blue-600 focus:text-blue-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <SlidersHorizontal className="h-4 w-4 text-blue-600" /> Demo Vehicle
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleQuickStatusAction(f, 'repeated_booking')}
                                    className="text-violet-600 focus:text-violet-700 cursor-pointer flex items-center gap-2"
                                  >
                                    <Copy className="h-4 w-4 text-violet-600" /> Repeated Booking
                                  </DropdownMenuItem>
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
                            <p className="text-slate-800 mt-0.5">{String(bookingDetailQuery.data.booking.metadata?.aadhaarNumber || '—')}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">PAN</span>
                            <p className="text-slate-800 mt-0.5">{String(bookingDetailQuery.data.booking.metadata?.panNumber || '—')}</p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-[9px] font-black text-slate-400 uppercase">Address</span>
                            <p className="text-slate-700 font-semibold mt-0.5 leading-relaxed">{bookingDetailQuery.data.booking.address || String(bookingDetailQuery.data.booking.metadata?.customerAddress || '—')}</p>
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
                            <p className="text-slate-800 mt-0.5">{bookingDetailQuery.data.booking.expectedDeliveryDate || String(bookingDetailQuery.data.booking.metadata?.expectedDeliveryDate || bookingDetailQuery.data.booking.metadata?.promiseDate || '—')}</p>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase">Booking Amount</span>
                            <p className="text-slate-800 mt-0.5 font-mono">
                              {bookingDetailQuery.data.booking.metadata?.bookingAmount != null
                                ? `₹${Number(bookingDetailQuery.data.booking.metadata.bookingAmount).toLocaleString('en-IN')}`
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
                          const isUpdate = act.type === 'followup_updated' || act.type === 'followup_scheduled'
                          const badgeLabel = isCall ? 'Call log' : isUpdate ? 'Follow-up update' : 'Remark'
                          return (
                            <div
                              key={act.id}
                              className={cn(
                                'p-3 rounded-xl border shadow-sm text-slate-800',
                                isCall
                                  ? 'bg-emerald-50/90 border-emerald-100/80'
                                  : isUpdate
                                  ? 'bg-amber-50/90 border-amber-100/80'
                                  : 'bg-indigo-50/80 border-indigo-100/80'
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <span className={cn(
                                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider',
                                  isCall ? 'bg-emerald-100 text-emerald-800' : isUpdate ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'
                                )}>
                                  {badgeLabel}
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

      {/* Customer Concern Dialog */}
      <Dialog open={!!concerningFollowup} onOpenChange={(open) => { if (!open) setConcerningFollowup(null) }}>
        <DialogContent className="sm:max-w-md font-bold rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Log Customer Concern
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Record a customer complaint, issue, or special concern for {concerningFollowup?.customerName} ({concerningFollowup?.bookingNumber || 'Booking'})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Concern Details / Remark</label>
              <textarea
                rows={4}
                value={concernText}
                onChange={(e) => setConcernText(e.target.value)}
                placeholder="Describe the exact concern raised by the customer (e.g. delay in delivery date, pricing discrepancy, accessory issue)..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConcerningFollowup(null)} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleSubmitConcern}
              disabled={isSubmittingConcern || !concernText.trim()}
              className="rounded-xl bg-amber-600 text-xs text-white hover:bg-amber-700 font-black gap-1.5 cursor-pointer"
            >
              {isSubmittingConcern ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />} Log Concern
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
  const remarksOk = countWords(notes) >= MIN_REMARK_WORDS
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
          nextDueAt: scheduleNext && nextAt ? toIstIso(nextAt) : undefined,
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
              Required — at least {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words). This is the customer&apos;s communication history.
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
  const remarksOk = countWords(notes) >= MIN_REMARK_WORDS

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/brands/kia/follow-ups/${f.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update', dueAt: toIstIso(dueAt), priority, notes }),
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
              Required — at least {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
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

  const remarksOk = countWords(notes) >= MIN_REMARK_WORDS

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
        body: JSON.stringify({ bookingId: selected.id, dueAt: toIstIso(dueAt), reason, priority, notes }),
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
                  Required — at least {MIN_REMARK_WORDS} words (entered: {countWords(notes)} words).
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

function FollowupsAnalyticsView({ dealer }: { dealer: string }) {
  const [days, setDays] = useState<number>(30)

  const query = useQuery({
    queryKey: ['kia-followups-analytics', days, dealer],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) })
      if (dealer && dealer !== 'all') params.set('dealer', dealer)
      const res = await fetch(`/api/brands/kia/call-analytics?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load analytics')
      return res.json()
    },
  })

  const data = query.data

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (query.isError || !data) {
    return (
      <div className="p-8 text-center text-rose-600 font-bold bg-rose-50/50 rounded-2xl border border-rose-100">
        Failed to load follow-up analytics. Please try again.
      </div>
    )
  }

  const { followups, consultantLeaderboard, outcomes, sources } = data

  return (
    <div className="p-6 space-y-6 bg-slate-50/50 rounded-b-2xl">
      {/* Top Header & Time Filter */}
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-600" /> Follow-up Performance Analytics
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Real-time completion metrics, outcome breakdown, and staff conversion leaderboards
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Timeframe:</span>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer border',
                days === d
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
              )}
            >
              Last {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border border-slate-200/80 bg-white rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Completion Rate</span>
            <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600">
              <CheckCheck className="h-4 w-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{followups.completionRate}%</p>
          <p className="text-xs text-emerald-600 font-bold mt-1">
            {followups.completed} of {followups.created} completed
          </p>
        </Card>

        <Card className="p-4 border border-slate-200/80 bg-white rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Total Created</span>
            <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600">
              <CalendarClock className="h-4 w-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{followups.created}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">New touches initiated</p>
        </Card>

        <Card className="p-4 border border-slate-200/80 bg-white rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Pending Open</span>
            <div className="p-2 rounded-xl bg-amber-50 border border-amber-100 text-amber-600">
              <Timer className="h-4 w-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{followups.pending}</p>
          <p className="text-xs text-amber-600 font-bold mt-1">Awaiting staff action</p>
        </Card>

        <Card className="p-4 border border-slate-200/80 bg-white rounded-2xl shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Overdue</span>
            <div className="p-2 rounded-xl bg-rose-50 border border-rose-100 text-rose-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{followups.overdue}</p>
          <p className="text-xs text-rose-600 font-bold mt-1">Past scheduled due time</p>
        </Card>
      </div>

      {/* Outcome Breakdown & Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Outcome Breakdown */}
        <Card className="p-5 border border-slate-200/80 bg-white rounded-2xl shadow-xs space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-indigo-600" /> Follow-up Outcome Breakdown
          </h4>
          <div className="space-y-3">
            {outcomes && outcomes.length > 0 ? (
              outcomes.map((item: { key: string; count: number }) => {
                const total = followups.completed || 1
                const percent = Math.round((item.count / total) * 100)
                return (
                  <div key={item.key} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span className="capitalize">{item.key.replace(/_/g, ' ')}</span>
                      <span>{item.count} ({percent}%)</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          item.key === 'converted' ? 'bg-emerald-500' : item.key === 'no_answer' ? 'bg-rose-500' : 'bg-indigo-500'
                        )}
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-slate-400 font-bold">No outcome data available for this range.</p>
            )}
          </div>
        </Card>

        {/* Source Breakdown */}
        <Card className="p-5 border border-slate-200/80 bg-white rounded-2xl shadow-xs space-y-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" /> Follow-up Source Channel
          </h4>
          <div className="space-y-3">
            {sources && sources.length > 0 ? (
              sources.map((item: { key: string; count: number }) => {
                const total = followups.created || 1
                const percent = Math.round((item.count / total) * 100)
                return (
                  <div key={item.key} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold text-slate-700">
                      <span className="capitalize">{item.key.replace(/_/g, ' ')}</span>
                      <span>{item.count} ({percent}%)</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, percent)}%` }}
                      />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-xs text-slate-400 font-bold">No source data available for this range.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Staff Leaderboard */}
      <Card className="p-5 border border-slate-200/80 bg-white rounded-2xl shadow-xs space-y-4">
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
          <User className="h-4 w-4 text-indigo-600" /> Staff Follow-up Performance Leaderboard
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                <th className="p-3">Staff / Consultant</th>
                <th className="p-3">Assigned</th>
                <th className="p-3">Completed</th>
                <th className="p-3">Overdue</th>
                <th className="p-3">Conversions 🎉</th>
                <th className="p-3 text-right">Completion Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-bold">
              {consultantLeaderboard && consultantLeaderboard.length > 0 ? (
                consultantLeaderboard.map((row: any) => {
                  const rate = row.assigned > 0 ? Math.round((row.completed / row.assigned) * 100) : 0
                  return (
                    <tr key={row.consultant} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 text-slate-900 font-black">{row.consultant}</td>
                      <td className="p-3 text-slate-600">{row.assigned}</td>
                      <td className="p-3 text-emerald-600">{row.completed}</td>
                      <td className="p-3 text-rose-600">{row.overdue}</td>
                      <td className="p-3 text-indigo-600 font-black">{row.converted}</td>
                      <td className="p-3 text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {rate}%
                        </span>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No leaderboard data recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
