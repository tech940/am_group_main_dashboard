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
  User,
  ShieldCheck,
  Mail,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { formatIndiaDateTime } from '@/lib/date-time'
import { getGatePassStatusInfo } from '@/lib/gate-pass/status'
import { isGatePassApproverRole } from '@/lib/gate-pass/access-shared'
import { GatePassFormDialog } from './gate-pass-form-dialog'
import { GatePassDetail } from './gate-pass-detail'
import { GateOutDialog } from './gate-out-dialog'
import { GateInDialog } from './gate-in-dialog'
import { FleetPanel } from './fleet-panel'
import { type GatePassSummary } from '@/lib/gate-pass/metrics'
import { cn } from '@/lib/utils'

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
}

const TABS = [
  { key: 'awaiting', label: 'Awaiting Approval', status: 'pending_approval' },
  { key: 'approved', label: 'Ready for Gate Out', status: 'approved' },
  { key: 'out', label: 'Out on Road', status: 'out' },
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

export function GatePassClient({ currentUser }: { currentUser: GatePassCurrentUser }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('awaiting')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [decisionFor, setDecisionFor] = useState<PassRow | null>(null)
  const [remarks, setRemarks] = useState('')
  const [acting, setActing] = useState(false)
  const [showFleet, setShowFleet] = useState(false)
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

  const canApprove = isGatePassApproverRole(currentUser.role)
  const statusFilter = TABS.find((t) => t.key === tab)?.status ?? ''

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['gate-passes', tab, search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(`/api/gate-pass?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load gate passes.')
      return res.json() as Promise<{ rows?: PassRow[]; passes?: PassRow[]; total: number }>
    },
  })

  const rawPasses = data?.rows ?? data?.passes ?? []

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
    queryKey: ['gate-pass-summary', search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/gate-pass/summary?${params.toString()}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not load the summary.')
      return res.json() as Promise<{ summary: GatePassSummary; truncated: boolean }>
    },
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
    refetchInterval: 30_000,
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

  // Pre-warm top 10 visible passes into cache automatically
  useEffect(() => {
    if (rows && rows.length > 0) {
      const topRows = rows.slice(0, 10)
      topRows.forEach((r) => {
        prefetchPassDetail(r.id)
      })
    }
  }, [rows, prefetchPassDetail])

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

  const cancel = async (row: PassRow) => {
    try {
      const res = await fetch(`/api/gate-pass/${row.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Withdrawn by requester' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not cancel.')
      toast({ title: 'Cancelled', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
      await refetch()
    } catch (e) {
      toast({ title: 'Failed', description: e instanceof Error ? e.message : 'Try again.', variant: 'error' })
    }
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

  return (
    <MainLayout>
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
              <a href={`/api/gate-pass/export?status=${encodeURIComponent(statusFilter)}`}>
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
              onClick={() => setTab('awaiting')}
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
              onClick={() => setTab('approved')}
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
                  {rows.filter(r => r.status === 'approved').length}
                </span>
                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold">Approved</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {fleetData ? `${fleetData.reserved} booked · awaiting checkout` : 'Ready for gate departure'}
              </p>
            </button>

            <button
              type="button"
              onClick={() => setTab('out')}
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
              onClick={() => setTab('all')}
              className={cn(
                'p-4 rounded-2xl text-left border transition-all cursor-pointer shadow-xs',
                summary.overdueNow > 0
                  ? 'border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/30 ring-2 ring-rose-400/20'
                  : tab === 'all'
                  ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                <span className="font-semibold">
                  {summary.overdueNow > 0 ? 'Overdue Return' : 'Total Fleet & Passes'}
                </span>
                <AlertTriangle className={cn('h-4 w-4', summary.overdueNow > 0 ? 'text-rose-600' : 'text-emerald-500')} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn('text-2xl font-black tabular-nums', summary.overdueNow > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-slate-100')}>
                  {summary.overdueNow > 0 ? summary.overdueNow : (fleetData ? fleetData.total : summary.total)}
                </span>
                <span className={cn('text-xs font-bold', summary.overdueNow > 0 ? 'text-rose-600' : 'text-emerald-600 dark:text-emerald-400')}>
                  {summary.overdueNow > 0 ? 'Past schedule' : (fleetData ? `${fleetData.total} demo cars` : `${summary.completedTrips} closed`)}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {summary.overdueNow > 0
                  ? 'Vehicle return past scheduled time'
                  : fleetData
                  ? `${fleetData.available} free · ${summary.completedTrips} completed trips`
                  : 'All fleet & trip logs'}
              </p>
            </button>
          </div>
        ) : null}

        {/* Fleet Details Toggle Strip */}
        <div className="flex items-center justify-between px-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFleet((v) => !v)}
            className="h-8 px-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 cursor-pointer gap-1.5"
          >
            <Car className="h-3.5 w-3.5" />
            {showFleet ? 'Hide Fleet Availability Panel' : 'Show Fleet Availability Panel'}
            {showFleet ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {showFleet && <FleetPanel />}

        {/* Main Passes Table Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          {/* Controls Bar */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none">
              {TABS.map((t) => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer',
                      active
                        ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs border border-slate-200/80 dark:border-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                    )}
                  >
                    {t.label}
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
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8.5 pr-8 text-xs rounded-xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 font-medium"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
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
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Due Return</th>
                  <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-[11px] uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-indigo-600 mb-2" />
                      <p className="text-xs font-medium">Loading gate passes...</p>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center">
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
                  rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setDetailId(row.id)}
                      onMouseEnter={() => prefetchPassDetail(row.id)}
                      onTouchStart={() => prefetchPassDetail(row.id)}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                    >
                      {/* Pass No & Requester */}
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900 dark:text-slate-100 font-mono tracking-tight">
                          {row.passNo}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <span>by</span>
                          <span className="font-medium text-slate-600 dark:text-slate-300">{row.requestedByName}</span>
                        </div>
                      </td>

                      {/* Vehicle Details */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono text-[13px]">
                          {row.registrationNumber || 'No Plate'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {[row.model, row.color].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </td>

                      {/* Driver */}
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          <span>{row.driverName}</span>
                        </div>
                      </td>

                      {/* Purpose */}
                      <td className="px-4 py-3.5 max-w-[200px]">
                        <div className="font-medium text-slate-700 dark:text-slate-300 truncate" title={row.purpose}>
                          {row.purpose}
                        </div>
                        {row.purposeNote && (
                          <div className="text-[11px] text-slate-400 truncate mt-0.5" title={row.purposeNote}>
                            {row.purposeNote}
                          </div>
                        )}
                      </td>

                      {/* Due Back */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="text-slate-700 dark:text-slate-300 font-medium">
                          {formatIndiaDateTime(row.expectedReturnAt) ?? '—'}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusPill status={row.status} />
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Pending Approval: 1-Click Approve & Reject */}
                          {canApprove && row.status === 'pending_approval' ? (
                            <>
                              <Button
                                size="sm"
                                disabled={approvingId === row.id}
                                onClick={() => approvePass(row)}
                                className="h-7 px-2.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer shadow-2xs gap-1"
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
                                className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 border-rose-200 dark:border-rose-900 rounded-lg cursor-pointer"
                              >
                                <X className="h-3 w-3 mr-0.5" /> Reject
                              </Button>
                            </>
                          ) : null}

                          {/* Approved: Gate Out Button + QR */}
                          {row.status === 'approved' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setGateOutFor(row)}
                                className="h-7 px-3 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1"
                              >
                                <Car className="h-3.5 w-3.5" /> Gate Out
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQr(row)}
                                title="Show Gate Out QR code"
                                className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 cursor-pointer"
                              >
                                <QrCode className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                              </Button>
                            </>
                          ) : null}

                          {/* Out: Gate In Button + QR */}
                          {row.status === 'out' ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => setGateInFor(row)}
                                className="h-7 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-2xs cursor-pointer gap-1"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Gate In
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => showQr(row)}
                                title="Show Gate In QR code"
                                className="h-7 w-7 p-0 rounded-lg border-slate-200 dark:border-slate-700 cursor-pointer"
                              >
                                <QrCode className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
                              </Button>
                            </>
                          ) : null}

                          {/* Cancel if requester */}
                          {row.requestedBy === currentUser.id &&
                          (row.status === 'pending_approval' || row.status === 'approved') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => cancel(row)}
                              title="Cancel request"
                              className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}

                          {/* View Detail */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDetailId(row.id)}
                            title="View details"
                            className="h-7 w-7 p-0 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer */}
          {rows.length > 0 && (
            <div className="p-3.5 border-t border-slate-100 dark:border-slate-800 text-right bg-slate-50/30 dark:bg-slate-900/30">
              <span className="text-[11px] font-medium text-slate-400">
                Showing {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialogs */}
      <GatePassDetail
        passId={detailId}
        open={Boolean(detailId)}
        onOpenChange={(o) => {
          if (!o) setDetailId(null)
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
        onGateInSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['gate-passes'] })
          await queryClient.invalidateQueries({ queryKey: ['gate-pass-summary'] })
          await refetch()
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
    </MainLayout>
  )
}
