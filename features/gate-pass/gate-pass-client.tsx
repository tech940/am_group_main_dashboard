'use client'

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ScanLine,
  Plus,
  RefreshCw,
  Search,
  Download,
  Loader2,
  QrCode,
  Check,
  X,
  Ban,
  Car,
  CheckCircle2,
  Eye,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  User,
  ShieldCheck,
  Mail,
  Filter,
  Calendar,
  MapPin,
  RotateCcw,
  Compass,
  UserCheck,
  Satellite,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDateTime } from '@/lib/date-time'
import { getGatePassStatusInfo, isFuelFillingPurpose } from '@/lib/gate-pass/status'
import { isGatePassApproverRole } from '@/lib/gate-pass/access-shared'
import { KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { GatePassFormDialog } from './gate-pass-form-dialog'
import { GatePassDetail } from './gate-pass-detail'
import { GateOutDialog } from './gate-out-dialog'
import { GateInDialog } from './gate-in-dialog'
import { FuelProofDialog } from './fuel-proof-dialog'
import { FleetPanel } from './fleet-panel'
import { TrackersPanel } from './trackers-panel'
import { type GatePassSummary } from '@/lib/gate-pass/metrics'
import { cn } from '@/lib/utils'
import { Fuel } from 'lucide-react'

const FILTER_PURPOSES = [
  'Customer test drive',
  'Customer home demo',
  'Showroom visit',
  'Stockyard visit',
  'Workshop visit',
  'Sales event or rally',
  'Inter-branch movement',
  'Service/Maintenance',
  'Internal Use',
  'Other',
] as const

function formatISTDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function getCarColorDot(colorStr?: string | null): string {
  if (!colorStr) return '#94a3b8'
  const c = colorStr.toLowerCase()
  if (c.includes('red')) return '#ef4444'
  if (c.includes('blue')) return '#2563eb'
  if (c.includes('white') || c.includes('pearl')) return '#f8fafc'
  if (c.includes('black')) return '#0f172a'
  if (c.includes('grey') || c.includes('gray')) return '#64748b'
  if (c.includes('silver')) return '#cbd5e1'
  if (c.includes('green')) return '#10b981'
  if (c.includes('yellow') || c.includes('gold')) return '#eab308'
  if (c.includes('orange')) return '#f97316'
  if (c.includes('brown')) return '#92400e'
  return '#94a3b8'
}

function getPurposeBadgeStyle(purpose?: string | null): { bg: string; text: string; border: string; dot: string } {
  const p = (purpose || '').toLowerCase()
  if (p.includes('test drive') || p.includes('home demo') || p.includes('customer')) {
    return {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800',
      dot: 'bg-emerald-500',
    }
  }
  if (p.includes('workshop') || p.includes('service') || p.includes('maintenance')) {
    return {
      bg: 'bg-sky-50 dark:bg-sky-950/40',
      text: 'text-sky-700 dark:text-sky-300',
      border: 'border-sky-200 dark:border-sky-800',
      dot: 'bg-sky-500',
    }
  }
  if (p.includes('event') || p.includes('display') || p.includes('showroom')) {
    return {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-800',
      dot: 'bg-amber-500',
    }
  }
  if (p.includes('inter-branch') || p.includes('stockyard') || p.includes('transfer')) {
    return {
      bg: 'bg-indigo-50 dark:bg-indigo-950/40',
      text: 'text-indigo-700 dark:text-indigo-300',
      border: 'border-indigo-200 dark:border-indigo-800',
      dot: 'bg-indigo-500',
    }
  }
  if (p.includes('sir') || p.includes('vip') || p.includes('payment') || p.includes('bank')) {
    return {
      bg: 'bg-purple-50 dark:bg-purple-950/40',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-200 dark:border-purple-800',
      dot: 'bg-purple-500',
    }
  }
  return {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
    dot: 'bg-slate-400',
  }
}

function getDriverInitials(name?: string | null): string {
  if (!name) return 'DR'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function isTripOverdue(dateStr?: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now()
}

export type GatePassCurrentUser = {
  id: string
  role: string
  fullName: string
  email: string
  brand: string | null
  dealers: string | null
}

type PassRow = {
  id: string
  passNo: string
  status: string
  dealerCode: string
  registrationNumber: string | null
  model: string | null
  variant: string | null
  color: string | null
  driverName: string
  purpose: string
  purposeNote: string | null
  expectedReturnAt: string
  requestedByName: string
  requestedByEmail?: string | null
  requestedBy: string | null
  approvedByName: string | null
  approvalRemarks: string | null
  gateOutAt: string | null
  gateOutOdo: string | null
  gateOutGuardName: string | null
  gateInAt: string | null
  gateInOdo: string | null
  gateInGuardName: string | null
  parkedLocation: string | null
  createdAt: string
  fuelSlipPath?: string | null
  pumpStartPath?: string | null
  pumpStopPath?: string | null
  fuelAmount?: string | number | null
  fuelLitres?: string | number | null
  fuelDocsUploadedAt?: string | null
}

const TABS = [
  { key: 'awaiting', label: 'Awaiting Approval', status: 'pending_approval' },
  { key: 'approved', label: 'Ready for Gate Out', status: 'approved' },
  { key: 'out', label: 'Out on Road', status: 'out' },
  { key: 'fuel_filling', label: 'Fuel Filling', status: '' },
  { key: 'closed', label: 'Completed / Closed', status: 'returned,rejected,cancelled,expired' },
  { key: 'all', label: 'All Passes', status: '' },
] as const

const STATUS_BADGE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  pending_approval: {
    bg: 'bg-amber-50 dark:bg-amber-950/50',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-800',
  },
  approved: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/50',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200 dark:border-indigo-800',
  },
  out: {
    bg: 'bg-blue-50 dark:bg-blue-950/50',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-800',
  },
  returned: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/50',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-800',
  },
  rejected: {
    bg: 'bg-rose-50 dark:bg-rose-950/50',
    text: 'text-rose-700 dark:text-rose-300',
    border: 'border-rose-200 dark:border-rose-800',
  },
  cancelled: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
  },
  expired: {
    bg: 'bg-red-50 dark:bg-red-950/50',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
  },
}

function StatusPill({ status }: { status: string }) {
  const info = getGatePassStatusInfo(status)
  const style = STATUS_BADGE_STYLES[status] ?? {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-700',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border',
        style.bg,
        style.text,
        style.border
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'pending_approval' ? 'bg-amber-500 animate-pulse' :
          status === 'approved' ? 'bg-indigo-500' :
          status === 'out' ? 'bg-blue-500 animate-pulse' :
          status === 'returned' ? 'bg-emerald-500' : 'bg-slate-400'
        )}
      />
      {info.pillLabel}
    </span>
  )
}

/*
 * ⚠️ canManageTrackers is computed on the SERVER (app/gate-pass/page.tsx) with the same predicate the tracker
 * mappings route enforces. Never derive it from `canApprove` below: that is a role list, and it disagrees with
 * gate_pass.approve — ceo is on the list without the permission, and Access Map grants are not on it at all.
 */
export function GatePassClient({ currentUser, embedded = false, canManageTrackers = false }: { currentUser: GatePassCurrentUser; embedded?: boolean; canManageTrackers?: boolean }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('all')
  const [page, setPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)
  const [selectedDealer, setSelectedDealer] = useState<string>('all')
  const [selectedPurpose, setSelectedPurpose] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('all')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [mineOnly, setMineOnly] = useState<boolean>(false)
  const [awaitingMeOnly, setAwaitingMeOnly] = useState<boolean>(false)
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [decisionFor, setDecisionFor] = useState<PassRow | null>(null)
  const [remarks, setRemarks] = useState('')
  const [acting, setActing] = useState(false)
  const [showFleet, setShowFleet] = useState(false)
  const [showTrackers, setShowTrackers] = useState(false)
  const [qr, setQr] = useState<{
    id: string
    passNo: string
    dataUrl: string
    purpose: string
    url: string
    requestedByEmail?: string | null
  } | null>(null)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [gateOutFor, setGateOutFor] = useState<PassRow | null>(null)
  const [gateInFor, setGateInFor] = useState<PassRow | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [cancelFor, setCancelFor] = useState<PassRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [fuelProofFor, setFuelProofFor] = useState<PassRow | null>(null)

  const canApprove = isGatePassApproverRole(currentUser.role)
  const statusFilter = TABS.find((t) => t.key === tab)?.status ?? ''

  // Calculate IST Date bounds
  const { startDate, endDate } = useMemo(() => {
    const now = new Date()
    if (dateFilter === 'today') {
      const todayStr = formatISTDate(now)
      return { startDate: todayStr, endDate: todayStr }
    }
    if (dateFilter === 'yesterday') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(yesterday), endDate: formatISTDate(yesterday) }
    }
    if (dateFilter === 'last7days') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(start), endDate: formatISTDate(now) }
    }
    if (dateFilter === 'last30days') {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { startDate: formatISTDate(start), endDate: formatISTDate(now) }
    }
    if (dateFilter === 'custom') {
      return { startDate: customStartDate || undefined, endDate: customEndDate || undefined }
    }
    return { startDate: undefined, endDate: undefined }
  }, [dateFilter, customStartDate, customEndDate])

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: [
      'gate-passes',
      tab,
      page,
      pageSize,
      search,
      selectedDealer,
      selectedPurpose,
      startDate,
      endDate,
      mineOnly,
      awaitingMeOnly,
    ],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      if (selectedDealer && selectedDealer !== 'all') params.set('dealerCode', selectedDealer)
      if (tab === 'fuel_filling') {
        params.set('purpose', 'Fuel filling')
      } else if (selectedPurpose && selectedPurpose !== 'all') {
        params.set('purpose', selectedPurpose)
      }
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (mineOnly) params.set('mine', 'true')
      if (awaitingMeOnly) params.set('awaitingMe', 'true')
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/gate-pass?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load gate passes.')
      return res.json() as Promise<{ rows?: PassRow[]; passes?: PassRow[]; total: number }>
    },
    staleTime: 30_000,
  })

  const hasActiveFilters =
    selectedDealer !== 'all' ||
    selectedPurpose !== 'all' ||
    dateFilter !== 'all' ||
    mineOnly ||
    awaitingMeOnly ||
    Boolean(search.trim())

  const resetFilters = () => {
    setSelectedDealer('all')
    setSelectedPurpose('all')
    setDateFilter('all')
    setCustomStartDate('')
    setCustomEndDate('')
    setMineOnly(false)
    setAwaitingMeOnly(false)
    setSearch('')
    setPage(1)
  }

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (selectedDealer && selectedDealer !== 'all') params.set('dealerCode', selectedDealer)
    if (selectedPurpose && selectedPurpose !== 'all') params.set('purpose', selectedPurpose)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    if (mineOnly) params.set('mine', 'true')
    if (awaitingMeOnly) params.set('awaitingMe', 'true')
    if (search.trim()) params.set('search', search.trim())
    return `/api/gate-pass/export?${params.toString()}`
  }, [statusFilter, selectedDealer, selectedPurpose, startDate, endDate, mineOnly, awaitingMeOnly, search])

  const rawPasses = useMemo(() => {
    const list = data?.rows ?? data?.passes ?? []
    if (tab === 'fuel_filling') {
      return list.filter((p) => isFuelFillingPurpose(p.purpose))
    }
    return list
  }, [data, tab])

  const totalCount = tab === 'fuel_filling' ? rawPasses.length : (data?.total ?? 0)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // Client-side search for instantaneous feedback
  const rows = useMemo(() => {
    if (!search.trim()) return rawPasses
    const q = search.toLowerCase().trim()
    return rawPasses.filter(
      (p) =>
        p.passNo.toLowerCase().includes(q) ||
        (p.registrationNumber && p.registrationNumber.toLowerCase().includes(q)) ||
        (p.model && p.model.toLowerCase().includes(q)) ||
        p.driverName.toLowerCase().includes(q) ||
        p.requestedByName.toLowerCase().includes(q) ||
        p.purpose.toLowerCase().includes(q)
    )
  }, [rawPasses, search])

  const { data: summaryData } = useQuery({
    queryKey: ['gate-pass-summary', search, selectedDealer, selectedPurpose, startDate, endDate, mineOnly],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (selectedDealer && selectedDealer !== 'all') params.set('dealerCode', selectedDealer)
      if (selectedPurpose && selectedPurpose !== 'all') params.set('purpose', selectedPurpose)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (mineOnly) params.set('mine', 'true')
      const res = await fetch(`/api/gate-pass/summary?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the summary.')
      return res.json() as Promise<{ summary: GatePassSummary; truncated: boolean }>
    },
    staleTime: 30_000,
  })
  const summary = summaryData?.summary

  const { data: fleetData } = useQuery({
    queryKey: ['gate-pass-fleet'],
    queryFn: async () => {
      const res = await fetch('/api/gate-pass/fleet', { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the fleet.')
      return res.json() as Promise<{
        total: number
        available: number
        reserved: number
        out: number
        overdue: number
        vehicles: Array<{
          vin: string
          registrationNumber: string | null
          model: string | null
          variant: string | null
          color: string | null
          branchLabel: string
          state: 'available' | 'reserved' | 'out'
          passNo: string | null
          driverName: string | null
          expectedReturnAt: string | null
          overdue: boolean
        }>
      }>
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  // Prefetch detail on hover or touchstart for 0ms instant modal display
  const prefetchPassDetail = useCallback(
    (id: string) => {
      if (!id) return
      void queryClient.prefetchQuery({
        queryKey: ['gate-pass-detail', id],
        queryFn: async () => {
          const res = await fetch(`/api/gate-pass/${id}`, { cache: 'no-store' })
          if (!res.ok) throw new Error('Could not load pass detail')
          return res.json()
        },
        staleTime: 60_000,
      })
    },
    [queryClient],
  )

  // Direct 1-Click Approve (no remark prompt, no duplicate confirmation)
  const approvePass = async (row: PassRow) => {
    try {
      setApprovingId(row.id)
      const res = await fetch(`/api/gate-pass/${row.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', remarks: null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Approval failed.')
      
      toast({
        title: 'Gate Pass Approved',
        description: `${row.passNo} has been approved. Departure barcode & link emailed to requester.`,
        variant: 'success',
      })
      
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
      await refetch()
      setTab('approved')
    } catch (e) {
      toast({
        title: 'Approval failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'error',
      })
    } finally {
      setApprovingId(null)
    }
  }

  // Act Reject with required remarks
  const actReject = async () => {
    if (!decisionFor) return
    if (!remarks.trim()) {
      toast({ title: 'Remarks required', description: 'Please provide a reason for rejection.', variant: 'error' })
      return
    }
    setActing(true)
    try {
      const res = await fetch(`/api/gate-pass/${decisionFor.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'reject', remarks: remarks.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not record that.')
      toast({
        title: 'Rejected',
        description: `Gate Pass ${decisionFor.passNo} rejected.`,
        variant: 'success',
      })
      setDecisionFor(null)
      setRemarks('')
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
      await refetch()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'error' })
    } finally {
      setActing(false)
    }
  }

  const confirmCancel = async () => {
    if (!cancelFor) return
    setCancelling(true)
    try {
      const res = await fetch(`/api/gate-pass/${cancelFor.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason.trim() || 'Cancelled before gate departure' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not cancel gate pass.')
      toast({
        title: 'Gate Pass Cancelled',
        description: `Pass ${cancelFor.passNo} cancelled. Vehicle returned to yard availability.`,
        variant: 'success',
      })
      setCancelFor(null)
      setCancelReason('')
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-fleet'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-detail'] })
      await refetch()
    } catch (e) {
      toast({
        title: 'Cancellation failed',
        description: e instanceof Error ? e.message : 'Try again.',
        variant: 'error',
      })
    } finally {
      setCancelling(false)
    }
  }

  const cancel = async (row: PassRow) => {
    setCancelFor(row)
    setCancelReason('')
  }

  const showQr = async (row: PassRow) => {
    try {
      const res = await fetch(`/api/gate-pass/${row.id}/qr`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'No code available.')
      setQr({
        id: row.id,
        passNo: row.passNo,
        dataUrl: json.dataUrl,
        purpose: json.purpose,
        url: json.url,
        requestedByEmail: row.requestedByEmail,
      })
    } catch (e) {
      toast({ title: 'No QR', description: e instanceof Error ? e.message : '', variant: 'error' })
    }
  }

  const sendEmailToRequester = async (passId: string) => {
    try {
      setSendingEmail(true)
      const res = await fetch(`/api/gate-pass/${passId}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to send email.')
      toast({
        title: 'Email Sent',
        description: `Barcode & gate link emailed to ${json.recipient || 'requester email'}.`,
        variant: 'success',
      })
    } catch (e) {
      toast({
        title: 'Email Failed',
        description: e instanceof Error ? e.message : 'Could not send email.',
        variant: 'error',
      })
    } finally {
      setSendingEmail(false)
    }
  }

  const selectTab = (newTab: (typeof TABS)[number]['key']) => {
    setTab(newTab)
    setPage(1)
  }

  const content = (
    <>
      <div className="space-y-5 p-4 sm:p-6 max-w-[1600px] mx-auto font-sans">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 shrink-0">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">Demo Car GatePass</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Manage travel approvals, gate departure (Gate Out), and vehicle return inspection (Gate In).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-9 px-3 rounded-xl text-xs font-semibold border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="h-9 px-3 rounded-xl text-xs font-semibold border-slate-200 dark:border-slate-800"
            >
              <a href={exportUrl}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Export
              </a>
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="h-9 px-4 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer gap-1.5"
            >
              <Plus className="h-4 w-4" /> Raise Gate Pass
            </Button>
          </div>
        </div>

        {/* Streamlined Metrics Strip */}
        {summary ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => selectTab('awaiting')}
              className={cn(
                'p-4 rounded-2xl text-left border transition-all cursor-pointer shadow-xs',
                tab === 'awaiting'
                  ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 ring-2 ring-amber-400/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Awaiting Approval</span>
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                  {summary.awaitingApproval}
                </span>
                <span className="text-xs text-amber-600 dark:text-amber-400 font-bold">
                  {summary.awaitingApproval === 1 ? '1 pending pass' : `${summary.awaitingApproval} pending`}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {fleetData ? `${fleetData.available} demo cars ready on yard` : 'Pending manager decision'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => selectTab('approved')}
              className={cn(
                'p-4 rounded-2xl text-left border transition-all cursor-pointer shadow-xs',
                tab === 'approved'
                  ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-400/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Ready for Gate Out</span>
                <ShieldCheck className="h-4 w-4 text-indigo-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                  {summary.readyForGateOut ?? (fleetData ? fleetData.reserved : 0)}
                </span>
                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold">Approved</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {fleetData ? `${fleetData.reserved} booked · awaiting checkout` : 'Ready for gate departure'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => selectTab('out')}
              className={cn(
                'p-4 rounded-2xl text-left border transition-all cursor-pointer shadow-xs',
                tab === 'out'
                  ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 ring-2 ring-blue-400/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Demo Cars Out</span>
                <Car className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                  {fleetData ? fleetData.out : summary.outNow}
                </span>
                <span className="text-xs text-blue-600 dark:text-blue-400 font-bold">
                  On the road
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {fleetData ? `${fleetData.available} of ${fleetData.total} demo cars in yard` : 'Active on the road'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => selectTab('all')}
              className={cn(
                'p-4 rounded-2xl text-left border transition-all cursor-pointer shadow-xs',
                tab === 'all'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">Total Fleet &amp; Passes</span>
                <Check className="h-4 w-4 text-emerald-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                  {fleetData ? fleetData.total : summary.total}
                </span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {fleetData ? `${fleetData.total} demo cars` : `${summary.completedTrips} closed`}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {fleetData
                  ? `${fleetData.available} free · ${summary.completedTrips} completed passes`
                  : 'All fleet & trip logs'}
              </p>
            </button>
          </div>
        ) : null}

        {/* Fleet Details Toggle Strip */}
        <div className="flex flex-wrap items-center gap-1 px-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFleet((v) => !v)}
            className="h-8 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer gap-1.5 [&_svg]:size-3.5"
          >
            <Car className="h-3.5 w-3.5" />
            {showFleet ? 'Hide Fleet Availability Panel' : 'Show Fleet Availability Panel'}
            {showFleet ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          {canManageTrackers ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTrackers((v) => !v)}
              aria-expanded={showTrackers}
              className="h-8 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer gap-1.5 [&_svg]:size-3.5"
            >
              <Satellite className="h-3.5 w-3.5" />
              {showTrackers ? 'Hide GPS Trackers' : 'Show GPS Trackers'}
              {showTrackers ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
        </div>

        {showFleet && <FleetPanel />}

        {canManageTrackers && showTrackers && <TrackersPanel />}

        {/* Main Passes Table Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          {/* Controls Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            {/* Filter Tabs with Stage Count Badges */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
              {TABS.map((t) => {
                const active = tab === t.key
                const count =
                  t.key === 'awaiting'
                    ? summary?.awaitingApproval ?? 0
                    : t.key === 'approved'
                    ? summary?.readyForGateOut ?? 0
                    : t.key === 'out'
                    ? summary?.outNow ?? 0
                    : t.key === 'fuel_filling'
                    ? (data?.rows ?? data?.passes ?? []).filter((p) => isFuelFillingPurpose(p.purpose)).length
                    : t.key === 'closed'
                    ? summary?.closedPasses ?? 0
                    : summary?.total ?? 0

                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => selectTab(t.key)}
                    className={cn(
                      'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer',
                      active
                        ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs border border-slate-200/80 dark:border-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    )}
                  >
                    <span>{t.label}</span>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-bold rounded-full transition-colors tabular-nums',
                        active
                          ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                          : count > 0
                          ? t.key === 'awaiting'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            : t.key === 'approved'
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                            : t.key === 'out'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-slate-100 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500'
                      )}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-full lg:w-72 shrink-0">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Search pass no, vehicle, driver..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                className="h-9 pl-8.5 pr-8 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 font-medium"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Secondary Filter Controls Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Branch / Dealership Filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" /> Branch:
                </Label>
                <Select
                  value={selectedDealer}
                  onValueChange={(v) => {
                    setSelectedDealer(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-8.5 w-36 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-lg">
                    <SelectValue placeholder="All Branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Branches</SelectItem>
                    {KIA_BRANCH_DEALERS.map((b) => (
                      <SelectItem key={b.dealerCode} value={b.dealerCode} className="text-xs">
                        {b.label} ({b.dealerCode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Purpose Filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 flex items-center gap-1">
                  <Compass className="w-3.5 h-3.5 text-slate-400" /> Purpose:
                </Label>
                <Select
                  value={selectedPurpose}
                  onValueChange={(v) => {
                    setSelectedPurpose(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-lg">
                    <SelectValue placeholder="All Purposes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Purposes</SelectItem>
                    {FILTER_PURPOSES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Filter */}
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 shrink-0 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" /> Date:
                </Label>
                <Select
                  value={dateFilter}
                  onValueChange={(v) => {
                    setDateFilter(v)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="h-8.5 w-36 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-lg">
                    <SelectValue placeholder="All Time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">All Time</SelectItem>
                    <SelectItem value="today" className="text-xs">Today</SelectItem>
                    <SelectItem value="yesterday" className="text-xs">Yesterday</SelectItem>
                    <SelectItem value="last7days" className="text-xs">Last 7 Days</SelectItem>
                    <SelectItem value="last30days" className="text-xs">Last 30 Days</SelectItem>
                    <SelectItem value="custom" className="text-xs">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Date Pickers */}
              {dateFilter === 'custom' && (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value)
                      setPage(1)
                    }}
                    className="h-8.5 text-xs bg-slate-50 dark:bg-slate-800/80 w-32 rounded-lg font-medium"
                  />
                  <span className="text-xs text-slate-400">to</span>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value)
                      setPage(1)
                    }}
                    className="h-8.5 text-xs bg-slate-50 dark:bg-slate-800/80 w-32 rounded-lg font-medium"
                  />
                </div>
              )}

              {/* Quick Filter: My Passes */}
              <button
                type="button"
                onClick={() => {
                  setMineOnly((v) => !v)
                  setPage(1)
                }}
                className={cn(
                  'h-8.5 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer inline-flex items-center gap-1.5',
                  mineOnly
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <User className="w-3 h-3" />
                My Passes
              </button>

              {/* Quick Filter: Awaiting Me (if approver) */}
              {canApprove && (
                <button
                  type="button"
                  onClick={() => {
                    setAwaitingMeOnly((v) => !v)
                    setPage(1)
                  }}
                  className={cn(
                    'h-8.5 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer inline-flex items-center gap-1.5',
                    awaitingMeOnly
                      ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                      : 'bg-amber-50/60 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80'
                  )}
                >
                  <UserCheck className="w-3 h-3" />
                  Needs My Approval
                </button>
              )}

              {/* Clear / Reset Filters button */}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="h-8.5 px-2.5 rounded-lg text-xs font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors inline-flex items-center gap-1 cursor-pointer"
                  title="Reset all filters"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </div>

            {/* Active results count indicator */}
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Showing <strong>{rows.length}</strong> {rows.length === 1 ? 'pass' : 'passes'}
            </div>
          </div>

          {/* Clean Modern Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Pass Details</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Vehicle</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Driver</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Purpose</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-[11px] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-slate-500">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600 mb-2" />
                      <p className="text-xs font-medium">Loading gate passes...</p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <div className="max-w-xs mx-auto space-y-2">
                        <div className="h-10 w-10 mx-auto rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                          <Car className="h-5 w-5" />
                        </div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">No gate passes found</p>
                        <p className="text-[11px] text-slate-400">
                          {search ? 'Try adjusting your search terms.' : 'No passes recorded in this view.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const purposeStyle = getPurposeBadgeStyle(row.purpose)
                    const isOverdueNow = row.status === 'out' && isTripOverdue(row.expectedReturnAt)

                    return (
                      <tr
                        key={row.id}
                        onClick={() => setDetailId(row.id)}
                        onMouseEnter={() => prefetchPassDetail(row.id)}
                        onTouchStart={() => prefetchPassDetail(row.id)}
                        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                      >
                        {/* Pass No & Requester */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800 px-2 py-0.5 rounded-md font-mono text-xs tracking-tight shadow-2xs">
                              {row.passNo}
                            </span>
                            <span
                              className={cn(
                                'text-[10px] font-bold px-1.5 py-0.2 rounded border uppercase tracking-wider',
                                row.dealerCode === 'JK402'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                                  : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'
                              )}
                            >
                              {row.dealerCode === 'JK402' ? 'Jammu' : row.dealerCode === 'JK501' ? 'Udhampur' : row.dealerCode}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-1">
                            <span>by</span>
                            <span className="font-semibold text-slate-700 dark:text-slate-300">{row.requestedByName}</span>
                          </div>
                        </td>

                        {/* Vehicle Details */}
                        <td className="px-4 py-3.5">
                          <div className="inline-flex items-center gap-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80 px-2 py-0.5 rounded-md font-mono font-bold text-xs tracking-wider shadow-2xs">
                            <Car className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>{row.registrationNumber || 'No Plate'}</span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full border border-slate-300 shrink-0 shadow-2xs"
                              style={{ backgroundColor: getCarColorDot(row.color) }}
                              title={`Color: ${row.color || 'Standard'}`}
                            />
                            <span className="font-medium">{[row.model, row.color].filter(Boolean).join(' · ') || '—'}</span>
                          </div>
                        </td>

                        {/* Driver */}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-bold text-[10px] flex items-center justify-center shrink-0 border border-teal-200 dark:border-teal-800 shadow-2xs">
                              {getDriverInitials(row.driverName)}
                            </div>
                            <span className="font-semibold text-slate-800 dark:text-slate-200">{row.driverName}</span>
                          </div>
                        </td>

                        {/* Purpose */}
                        <td className="px-4 py-3.5 max-w-[210px]">
                          <div className="space-y-1">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border shadow-2xs',
                                purposeStyle.bg,
                                purposeStyle.text,
                                purposeStyle.border
                              )}
                            >
                              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', purposeStyle.dot)} />
                              {row.purpose}
                            </span>
                            {row.purposeNote && (
                              <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[190px]" title={row.purposeNote}>
                                {row.purposeNote}
                              </div>
                            )}
                            {isFuelFillingPurpose(row.purpose) && (
                              <div className="pt-0.5">
                                {row.fuelSlipPath && row.pumpStartPath && row.pumpStopPath ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 rounded">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" /> Proofs Attached
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                    <Fuel className="w-2.5 h-2.5 text-amber-600" /> Proofs Pending
                                  </span>
                                )}
                              </div>
                            )}
                            {isOverdueNow && (
                              <div className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 px-1.5 py-0.2 rounded">
                                <Clock className="w-2.5 h-2.5" /> Overdue Return
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <StatusPill status={row.status} />
                        </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Pending Approval: 1-Click Approve, Reject & Cancel */}
                          {row.status === 'pending_approval' ? (
                            <>
                              {canApprove ? (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={approvingId === row.id}
                                    onClick={() => approvePass(row)}
                                    className="h-7 px-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer shadow-2xs gap-1 [&_svg]:size-3"
                                  >
                                    {approvingId === row.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Check className="h-3 w-3" />
                                    )}
                                    Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setDecisionFor(row)
                                      setRemarks('')
                                    }}
                                    className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900 rounded-lg cursor-pointer [&_svg]:size-3"
                                  >
                                    <X className="h-3 w-3 mr-0.5" /> Reject
                                  </Button>
                                </>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => cancel(row)}
                                title="Cancel gate pass request"
                                className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-800 rounded-lg cursor-pointer gap-1 [&_svg]:size-3"
                              >
                                <Ban className="h-3 w-3" /> Cancel
                              </Button>
                            </>
                          ) : null}

                          {/* Approved (Vehicle at Gate, Yet to Go Out): Gate Out Button + QR + Cancel Button */}
                          {row.status === 'approved' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setGateOutFor(row)}
                                className="h-7 px-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1 [&_svg]:size-3.5"
                              >
                                <Car className="h-3.5 w-3.5" /> Gate Out
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQr(row)}
                                title="Show Gate Out QR code"
                                className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 cursor-pointer [&_svg]:size-3.5"
                              >
                                <QrCode className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => cancel(row)}
                                title="Cancel gate pass request (vehicle is at gate and yet to go out)"
                                className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-800 rounded-lg cursor-pointer gap-1 [&_svg]:size-3"
                              >
                                <Ban className="h-3 w-3" /> Cancel
                              </Button>
                            </>
                          ) : null}

                          {/* Out: Gate In Button + QR */}
                          {row.status === 'out' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setGateInFor(row)}
                                className="h-7 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1 [&_svg]:size-3.5"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Gate In
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQr(row)}
                                title="Show Gate In QR code"
                                className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 cursor-pointer [&_svg]:size-3.5"
                              >
                                <QrCode className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                              </Button>
                            </>
                          ) : null}

                          {/* Fuel Proofs upload button for Fuel Filling passes */}
                          {isFuelFillingPurpose(row.purpose) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setFuelProofFor(row)}
                              title="Upload/Manage 3 Fuel Proofs (Slip, Pump 0.00, Pump Stop)"
                              className="h-7 px-2 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/50 border-amber-200 dark:border-amber-800 rounded-lg cursor-pointer gap-1 [&_svg]:size-3"
                            >
                              <Fuel className="h-3 w-3 text-amber-600" />
                              {row.fuelSlipPath && row.pumpStartPath && row.pumpStopPath ? 'Fuel Proofs' : 'Add Proofs'}
                            </Button>
                          ) : null}

                          {/* View Detail */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetailId(row.id)}
                            title="View details"
                            className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer [&_svg]:size-3.5"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
              {totalCount > 0 ? (
                <span>
                  Showing <strong className="text-slate-700 dark:text-slate-200">{(page - 1) * pageSize + 1}</strong> to{' '}
                  <strong className="text-slate-700 dark:text-slate-200">{Math.min(page * pageSize, totalCount)}</strong> of{' '}
                  <strong className="text-slate-700 dark:text-slate-200">{totalCount}</strong> passes
                </span>
              ) : (
                <span>No passes found</span>
              )}
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-[11px] text-slate-400">20 per page</span>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                  className="h-8 px-2.5 text-xs font-semibold rounded-xl border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Prev</span>
                </Button>

                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                        acc.push('...')
                      }
                      acc.push(p)
                      return acc
                    }, [])
                    .map((item, idx) =>
                      typeof item === 'string' ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-xs text-slate-400 select-none">
                          …
                        </span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          onClick={() => setPage(item)}
                          disabled={isFetching}
                          className={cn(
                            'min-w-[28px] h-7 px-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer tabular-nums',
                            item === page
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
                          )}
                        >
                          {item}
                        </button>
                      )
                    )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isFetching}
                  className="h-8 px-2.5 text-xs font-semibold rounded-xl border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed gap-1"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Dialogs */}
      <GatePassDetail
        passId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(o) => {
          if (!o) setDetailId(null)
        }}
        onCancelPass={(pass) => {
          setDetailId(null)
          setCancelFor(pass as PassRow)
          setCancelReason('')
        }}
      />

      <GatePassFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        currentUser={currentUser}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
          queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
        }}
      />

      <GateOutDialog
        open={Boolean(gateOutFor)}
        onOpenChange={(o) => {
          if (!o) setGateOutFor(null)
        }}
        pass={gateOutFor}
        onGateOutSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
          await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
          await refetch()
        }}
      />

      <GateInDialog
        open={Boolean(gateInFor)}
        onOpenChange={(o) => {
          if (!o) setGateInFor(null)
        }}
        pass={gateInFor}
        onGateInSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
          void queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
          void refetch()
        }}
      />

      <FuelProofDialog
        open={Boolean(fuelProofFor)}
        onOpenChange={(o) => {
          if (!o) setFuelProofFor(null)
        }}
        pass={fuelProofFor}
        onSuccess={() => {
          void queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
          void queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
          void refetch()
        }}
      />

      {/* Dedicated Reject Dialog */}
      <Dialog
        open={Boolean(decisionFor)}
        onOpenChange={(o) => {
          if (!o) setDecisionFor(null)
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-50">
              Reject Gate Pass {decisionFor?.passNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              {decisionFor?.registrationNumber || 'No registration'} ·{' '}
              {[decisionFor?.model, decisionFor?.color].filter(Boolean).join(' ')} · driven by {decisionFor?.driverName}
            </p>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              placeholder="Why are you rejecting this request? (required)"
              className="text-xs rounded-xl"
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDecisionFor(null)}
              disabled={acting}
              className="h-9 rounded-xl text-xs font-semibold"
            >
              Cancel
            </Button>
            <Button
              onClick={actReject}
              disabled={acting}
              className="h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white"
            >
              {acting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog
        open={Boolean(cancelFor)}
        onOpenChange={(o) => {
          if (!o) setCancelFor(null)
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
              <Ban className="h-4 w-4" />
              Cancel Gate Pass {cancelFor?.passNo}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="rounded-xl border border-rose-100 dark:border-rose-950/60 bg-rose-50/60 dark:bg-rose-950/20 p-3 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between">
                <span>{cancelFor?.registrationNumber || 'No plate'} · {cancelFor?.model || 'Demo Car'}</span>
                <span className="font-mono text-[11px] text-rose-600 font-bold uppercase">{cancelFor?.status}</span>
              </div>
              <div className="text-slate-600 dark:text-slate-400 text-[11px]">
                Driver: <span className="font-medium text-slate-800 dark:text-slate-200">{cancelFor?.driverName}</span> · Purpose: <span className="font-medium text-slate-800 dark:text-slate-200">{cancelFor?.purpose}</span>
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Are you sure you want to cancel this gate pass request? The vehicle reservation will be cancelled and returned to the available yard fleet immediately.
            </p>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Cancellation Reason <span className="text-[11px] font-normal text-slate-400">(optional)</span>
              </label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                placeholder="e.g. Customer cancelled test drive, trip postponed, etc."
                className="text-xs rounded-xl"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              onClick={() => setCancelFor(null)}
              disabled={cancelling}
              className="h-9 rounded-xl text-xs font-semibold"
            >
              Keep Gate Pass
            </Button>
            <Button
              onClick={confirmCancel}
              disabled={cancelling}
              className="h-9 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white gap-1.5"
            >
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Code Dialog */}
      <Dialog
        open={Boolean(qr)}
        onOpenChange={(o) => {
          if (!o) setQr(null)
        }}
      >
        <DialogContent className="sm:max-w-sm rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {qr?.purpose === 'in' ? 'Return Verification Code' : 'Gate Departure QR'} · {qr?.passNo}
            </DialogTitle>
          </DialogHeader>
          {qr ? (
            <div className="space-y-4 text-center">
              <div className="p-3 bg-white rounded-2xl border border-slate-200 inline-block shadow-2xs">
                <img
                  src={qr.dataUrl}
                  alt="Gate pass QR code"
                  width={220}
                  height={220}
                  className="mx-auto rounded-xl"
                />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                {qr.purpose === 'in'
                  ? 'Show to guard at gate when vehicle returns to log odometer IN, parking location, and key handover.'
                  : 'Show to guard at gate before departure to log odometer OUT, 4-angle vehicle photos, and open gate.'}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(qr.url)
                    toast({ title: 'Link copied', description: 'Guard link copied to clipboard.', variant: 'success' })
                  }}
                  className="w-full h-8.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Copy Link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={sendingEmail}
                  onClick={() => sendEmailToRequester(qr.id)}
                  className="w-full h-8.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 cursor-pointer"
                >
                  {sendingEmail ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mail className="mr-1 h-3.5 w-3.5 text-indigo-500" />
                  )}
                  Email Link
                </Button>
                <Button
                  size="sm"
                  asChild
                  className="w-full h-8.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  <a href={qr.url} target="_blank" rel="noreferrer">
                    Open Guard Page
                  </a>
                </Button>
              </div>
              {qr.requestedByEmail ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-0.5">
                  Submitter: <span className="font-medium text-slate-600 dark:text-slate-300">{qr.requestedByEmail}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )

  if (embedded) {
    return content
  }

  return <MainLayout>{content}</MainLayout>
}
