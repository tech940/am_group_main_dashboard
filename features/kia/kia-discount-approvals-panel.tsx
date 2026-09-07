'use client'

import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  Tag,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Car,
  User2,
  Building2,
  Check,
  X,
  AlertTriangle,
  Loader2,
  ArrowRight,
  ShieldCheck,
  FileText,
  CreditCard,
  Banknote,
  Percent,
  Calendar,
  Phone,
  Filter,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { DISCOUNT_STAGE_LABEL, requiresMdApproval, type DiscountStage } from '@/lib/kia/discount-chain'

type DiscountItem = {
  id: string
  bookingId: string
  requestedAmount: string
  approvedAmount: string | null
  discountType: string | null
  reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  requestedBy: string
  requestedByName: string
  smStatus: string | null
  smByName: string | null
  smRemarks: string | null
  smAt: string | null
  ceoStatus: string | null
  ceoByName: string | null
  ceoRemarks: string | null
  ceoAt: string | null
  ceoApprovedAmount: string | null
  mdStatus: string | null
  mdByName: string | null
  mdRemarks: string | null
  mdAt: string | null
  mdApprovedAmount: string | null
  payoutStatus: string | null
  payoutByName: string | null
  payoutRemarks: string | null
  payoutAt: string | null
  payoutReference: string | null
  vehicleSnapshot: Record<string, any> | null
  createdAt: string
  updatedAt: string
  bookingNumber: string
  customerName: string
  customerPhone: string | null
  model: string | null
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  bookingStatus: string | null
  stage: DiscountStage
  stageLabel: string
  isHighValue: boolean
  canAct: boolean
}

function formatCurrency(val: string | number | null | undefined) {
  const num = Number(val || 0)
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num)
}

function formatDate(val: string | null | undefined) {
  if (!val) return '—'
  const d = new Date(val)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function KiaDiscountApprovalsPanel({
  currentUser,
}: {
  currentUser: { id: string; role: string; fullName: string; email: string }
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<'all' | 'pending_mine' | DiscountStage>('pending_mine')
  const [amountFilter, setAmountFilter] = useState<'all' | 'lte_5k' | 'gt_5k'>('all')
  const [selectedDiscount, setSelectedDiscount] = useState<DiscountItem | null>(null)
  const [showApprovalTrail, setShowApprovalTrail] = useState(false)
  const [actionRemarks, setActionRemarks] = useState('')
  const [customApprovedAmount, setCustomApprovedAmount] = useState('')
  const [payoutRef, setPayoutRef] = useState('')
  const [activeAction, setActiveAction] = useState<null | 'approve' | 'reject' | 'payout' | 'hold'>(null)

  const { data, isLoading, refetch, isRefetching } = useQuery<{
    success: boolean
    discounts: DiscountItem[]
    totalCount: number
  }>({
    queryKey: ['kia-discount-approvals', search],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/brands/kia/bookings/discounts?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load discount requests')
      return res.json()
    },
    refetchInterval: 30000,
  })

  const rawDiscounts = useMemo(() => data?.discounts || [], [data?.discounts])

  // Compute KPI metrics
  const metrics = useMemo(() => {
    let totalRequested = 0
    let pendingMine = 0
    let withSm = 0
    let withCeo = 0
    let withMd = 0
    let withAccounts = 0
    let completedPaid = 0
    let totalPaidAmount = 0

    for (const d of rawDiscounts) {
      const amt = Number(d.approvedAmount || d.requestedAmount || 0)
      totalRequested += Number(d.requestedAmount || 0)

      if (d.canAct && d.stage !== 'done' && d.stage !== 'rejected') {
        pendingMine += 1
      }

      if (d.stage === 'sales_manager') withSm += 1
      else if (d.stage === 'ceo') withCeo += 1
      else if (d.stage === 'md') withMd += 1
      else if (d.stage === 'accounts') withAccounts += 1
      else if (d.stage === 'done' || d.payoutStatus === 'PAID') {
        completedPaid += 1
        totalPaidAmount += amt
      }
    }

    return {
      totalCount: rawDiscounts.length,
      totalRequested,
      pendingMine,
      withSm,
      withCeo,
      withMd,
      withAccounts,
      completedPaid,
      totalPaidAmount,
    }
  }, [rawDiscounts])

  // Filtered rows for the table
  const displayedDiscounts = useMemo(() => {
    return rawDiscounts.filter((item) => {
      // Stage filter
      if (stageFilter === 'pending_mine') {
        if (!item.canAct || item.stage === 'done' || item.stage === 'rejected') return false
      } else if (stageFilter !== 'all') {
        if (item.stage !== stageFilter) return false
      }

      // Amount filter
      const reqAmt = Number(item.requestedAmount || 0)
      if (amountFilter === 'lte_5k' && reqAmt > 5000) return false
      if (amountFilter === 'gt_5k' && reqAmt <= 5000) return false

      return true
    })
  }, [rawDiscounts, stageFilter, amountFilter])

  // Mutation for executing actions
  const actionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      remarks,
      approvedAmount,
      payoutReference,
      payoutStatus,
    }: {
      id: string
      action: 'approve' | 'reject' | 'payout' | 'hold'
      remarks?: string
      approvedAmount?: number | string
      payoutReference?: string
      payoutStatus?: string
    }) => {
      const res = await fetch(`/api/brands/kia/discounts/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, remarks, approvedAmount, payoutReference, payoutStatus }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to execute discount action')
      return json
    },
    onSuccess: (res) => {
      toast({
        title: 'Action Successful',
        description: `Discount ${res.stageLabel ? `is now ${res.stageLabel}` : 'updated successfully'}.`,
        variant: 'success',
      })
      queryClient.invalidateQueries({ queryKey: ['kia-discount-approvals'] })
      queryClient.invalidateQueries({ queryKey: ['kia-global-discounts'] })
      setSelectedDiscount(null)
      setShowApprovalTrail(false)
      setActionRemarks('')
      setCustomApprovedAmount('')
      setPayoutRef('')
    },
    onError: (err) => {
      toast({
        title: 'Action Failed',
        description: err instanceof Error ? err.message : 'Failed to update discount',
        variant: 'error',
      })
    },
    onSettled: () => {
      setActiveAction(null)
    },
  })

  const handleOpenDetail = (item: DiscountItem) => {
    setSelectedDiscount(item)
    setShowApprovalTrail(false)
    setActionRemarks('')
    setCustomApprovedAmount(item.approvedAmount || item.requestedAmount || '')
    setPayoutRef(item.payoutReference || '')
  }

  const handleExecuteAction = async (action: 'approve' | 'reject' | 'payout' | 'hold') => {
    if (!selectedDiscount) return

    if ((action === 'reject' || action === 'hold') && !actionRemarks.trim()) {
      toast({
        title: 'Remarks required',
        description: `Please provide a reason or note for ${action === 'reject' ? 'rejection' : 'putting on hold'}.`,
        variant: 'error',
      })
      return
    }

    setActiveAction(action)
    actionMutation.mutate({
      id: selectedDiscount.id,
      action,
      remarks: actionRemarks.trim(),
      approvedAmount: (selectedDiscount.stage === 'ceo' || selectedDiscount.stage === 'md') ? customApprovedAmount : undefined,
      payoutReference: selectedDiscount.stage === 'accounts' ? payoutRef.trim() : undefined,
      payoutStatus: action === 'reject' ? 'NOT_PAID' : action === 'hold' ? 'HELD' : 'PAID',
    })
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Total Requests</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{metrics.totalCount}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">{formatCurrency(metrics.totalRequested)}</p>
        </div>

        <div className={cn(
          "rounded-2xl border p-4 shadow-xs transition-all",
          metrics.pendingMine > 0
            ? "border-amber-300 bg-amber-50/60 ring-2 ring-amber-200"
            : "border-slate-200 bg-white"
        )}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Pending My Action</p>
            {metrics.pendingMine > 0 && (
              <span className="flex h-2 w-2 rounded-full bg-amber-500 animate-ping" />
            )}
          </div>
          <p className="mt-1 text-2xl font-black text-amber-900">{metrics.pendingMine}</p>
          <p className="mt-0.5 text-xs font-semibold text-amber-700">Awaiting your approval</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">With GSM / SM</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{metrics.withSm}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">Stage 1</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">With CEO</p>
          <p className="mt-1 text-2xl font-black text-slate-800">{metrics.withCeo}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">Stage 2</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">With MD (&gt; ₹5k)</p>
          <p className="mt-1 text-2xl font-black text-indigo-900">{metrics.withMd}</p>
          <p className="mt-0.5 text-xs font-semibold text-indigo-600">High-value stage</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Paid / Completed</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{metrics.completedPaid}</p>
          <p className="mt-0.5 text-xs font-semibold text-slate-600">{formatCurrency(metrics.totalPaidAmount)}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search booking #, customer, VIN, consultant, dealer..."
              className="h-10 rounded-2xl border-slate-200 bg-slate-50 pl-9 font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white"
            />
          </div>

          {/* Amount Filter Pills */}
          <div className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100 p-1">
            {(['all', 'lte_5k', 'gt_5k'] as const).map((mode) => {
              const labels = {
                all: 'All Amounts',
                lte_5k: '≤ ₹5,000 (CEO Final)',
                gt_5k: '> ₹5,000 (Requires MD)',
              }
              const isActive = amountFilter === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAmountFilter(mode)}
                  className={cn(
                    'rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                    isActive ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  )}
                >
                  {labels[mode]}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={isLoading || isRefetching}
            className="h-10 gap-2 rounded-2xl border-slate-200 font-bold"
          >
            <RefreshCw className={cn('h-4 w-4', (isLoading || isRefetching) && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stage Navigation Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {([
            { key: 'pending_mine', label: `Pending My Action (${metrics.pendingMine})` },
            { key: 'all', label: `All Requests (${metrics.totalCount})` },
            { key: 'sales_manager', label: `With GSM/SM (${metrics.withSm})` },
            { key: 'ceo', label: `With CEO (${metrics.withCeo})` },
            { key: 'md', label: `With MD (${metrics.withMd})` },
            { key: 'accounts', label: `With Accounts (${metrics.withAccounts})` },
            { key: 'done', label: `Completed (${metrics.completedPaid})` },
            { key: 'rejected', label: 'Rejected' },
          ] as const).map((tab) => {
            const isActive = stageFilter === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStageFilter(tab.key)}
                className={cn(
                  'whitespace-nowrap rounded-2xl px-4 py-2 text-xs font-bold transition-all',
                  isActive
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Discounts Table */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="h-20 animate-pulse rounded-3xl border border-slate-100 bg-slate-50" />
          ))}
        </div>
      ) : displayedDiscounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <CheckCircle2 className="h-6 w-6 text-slate-400" />
          </div>
          <h3 className="mt-3 text-base font-bold text-slate-900">No discount requests found</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            {stageFilter === 'pending_mine'
              ? 'You have no discounts waiting for your action right now.'
              : 'Try changing your search or filter parameters.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 pl-6 pr-3">Booking / Customer</th>
                  <th className="px-3 py-3.5">Vehicle</th>
                  <th className="px-3 py-3.5">Discount Type</th>
                  <th className="px-3 py-3.5 text-right">Requested</th>
                  <th className="px-3 py-3.5 text-right">Approved</th>
                  <th className="px-3 py-3.5">Stage / Status</th>
                  <th className="px-3 py-3.5">Requested Date</th>
                  <th className="py-3.5 pl-3 pr-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                {displayedDiscounts.map((item) => {
                  const isPendingForMe = item.canAct && item.stage !== 'done' && item.stage !== 'rejected'
                  const vehicle = item.vehicleSnapshot || {}
                  const vin = vehicle.vin || '—'

                  return (
                    <tr
                      key={item.id}
                      onClick={() => handleOpenDetail(item)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-slate-50/80",
                        isPendingForMe && "bg-amber-50/20"
                      )}
                    >
                      <td className="py-4 pl-6 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-slate-900">
                            {item.bookingNumber}
                          </span>
                          {item.isHighValue && (
                            <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-black text-indigo-700 ring-1 ring-inset ring-indigo-200">
                              &gt; ₹5k
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs font-bold text-slate-800">{item.customerName}</p>
                        {item.customerPhone && (
                          <p className="text-[11px] text-slate-400 font-mono">{item.customerPhone}</p>
                        )}
                      </td>

                      <td className="px-3 py-4">
                        <p className="font-bold text-slate-900">{item.model || vehicle.model || '—'}</p>
                        <p className="text-[11px] text-slate-500 font-medium">{item.variant || vehicle.variant || ''}</p>
                        <p className="text-[10px] font-mono text-slate-400">{vin}</p>
                      </td>

                      <td className="px-3 py-4">
                        <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                          {item.discountType || 'Discount'}
                        </span>
                        {item.reason && (
                          <p className="mt-1 line-clamp-1 max-w-[200px] text-[11px] italic text-slate-500">
                            “{item.reason}”
                          </p>
                        )}
                      </td>

                      <td className="px-3 py-4 text-right font-black text-slate-900">
                        {formatCurrency(item.requestedAmount)}
                      </td>

                      <td className="px-3 py-4 text-right font-black text-slate-900 font-mono">
                        {item.approvedAmount ? formatCurrency(item.approvedAmount) : '—'}
                      </td>

                      <td className="px-3 py-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={cn(
                              'inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wide uppercase',
                              item.stage === 'done' && 'bg-slate-100 text-slate-800 ring-1 ring-slate-200',
                              item.stage === 'rejected' && 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
                              item.stage === 'sales_manager' && 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
                              item.stage === 'ceo' && 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
                              item.stage === 'md' && 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
                              item.stage === 'accounts' && 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                            )}
                          >
                            {item.stageLabel}
                          </span>
                          {item.payoutStatus && (
                            <span className="text-[10px] font-bold text-slate-400">
                              Payout: {item.payoutStatus}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-4 text-slate-500 font-medium">
                        {formatDate(item.createdAt)}
                      </td>

                      <td className="py-4 pl-3 pr-6 text-right">
                        {isPendingForMe ? (
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              disabled={actionMutation.isPending}
                              onClick={() => {
                                if (item.stage === 'accounts') {
                                  handleOpenDetail(item)
                                } else {
                                  actionMutation.mutate({
                                    id: item.id,
                                    action: 'approve',
                                    remarks: 'Approved',
                                    approvedAmount: item.requestedAmount,
                                  })
                                }
                              }}
                              className="h-7 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-2.5 text-[11px] font-bold shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                            >
                              <Check className="w-3 h-3 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() => handleOpenDetail(item)}
                              className="h-7 rounded-lg border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100 hover:text-rose-800 px-2 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              <X className="w-3 h-3 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionMutation.isPending}
                              onClick={() => handleOpenDetail(item)}
                              className="h-7 rounded-lg border-amber-200 bg-amber-50/60 text-amber-800 hover:bg-amber-100 px-2 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              <Clock className="w-3 h-3 mr-1" />
                              Hold
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleOpenDetail(item)}
                              className="h-7 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              Review
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenDetail(item)}
                              className="h-7 rounded-lg border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-3 text-[11px] font-bold transition-all cursor-pointer shadow-2xs"
                            >
                              Review
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail & Action Dialog */}
      <Dialog open={selectedDiscount !== null} onOpenChange={(open) => !open && setSelectedDiscount(null)}>
        <DialogContent className="max-w-2xl rounded-3xl p-0 overflow-hidden border border-slate-200">
          {selectedDiscount ? (
            <div>
              {/* Header */}
              <DialogHeader className="border-b border-slate-100 bg-slate-50/80 p-6 text-left space-y-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-black text-slate-500">
                    Booking #{selectedDiscount.bookingNumber}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-3 py-1 text-xs font-black tracking-wide uppercase',
                      selectedDiscount.stage === 'done' && 'bg-slate-100 text-slate-800 ring-1 ring-slate-200 font-bold',
                      selectedDiscount.stage === 'rejected' && 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
                      selectedDiscount.stage === 'sales_manager' && 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
                      selectedDiscount.stage === 'ceo' && 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
                      selectedDiscount.stage === 'md' && 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
                      selectedDiscount.stage === 'accounts' && 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                    )}
                  >
                    {selectedDiscount.stageLabel}
                  </span>
                </div>

                <div className="mt-4">
                  <DialogTitle className="text-3xl font-black text-slate-900">
                    {formatCurrency(selectedDiscount.requestedAmount)}
                  </DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs font-bold text-slate-500">
                    {selectedDiscount.discountType || 'Discount'} · Customer: {selectedDiscount.customerName}
                  </DialogDescription>
                </div>
              </DialogHeader>

              {/* Body */}
              <div className="max-h-[60vh] space-y-6 overflow-y-auto p-6 text-xs">
                {/* Visual Workflow Steps with Approver & Timestamp */}
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                      Approval Flow ({selectedDiscount.isHighValue ? 'Threshold > ₹5,000: 4 Stages' : 'Threshold ≤ ₹5,000: 3 Stages'})
                    </p>
                    <span className="text-[11px] font-bold text-slate-400">
                      Current Desk: <span className="font-black text-slate-700">{selectedDiscount.stageLabel}</span>
                    </span>
                  </div>

                  <div className={cn(
                    "grid gap-2.5",
                    selectedDiscount.isHighValue ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3"
                  )}>
                    {/* Step 1: GSM / SM */}
                    <div className={cn(
                      "rounded-2xl p-3 border transition-all flex flex-col justify-between min-h-[5.5rem]",
                      selectedDiscount.smStatus === 'APPROVED' ? "border-slate-300 bg-slate-100/70 text-slate-900 shadow-2xs" :
                      selectedDiscount.smStatus === 'REJECTED' ? "border-rose-200 bg-rose-50/90 text-rose-950 shadow-2xs" :
                      selectedDiscount.smStatus === 'HELD' ? "border-amber-200 bg-amber-50/90 text-amber-950 shadow-2xs" :
                      selectedDiscount.stage === 'sales_manager' ? "border-amber-300 bg-amber-50/70 text-amber-950 ring-2 ring-amber-300/60 font-bold shadow-2xs" :
                      "border-slate-200 bg-white text-slate-400"
                    )}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs">1. GSM / SM</span>
                        <span className={cn(
                          "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider",
                          selectedDiscount.smStatus === 'APPROVED' ? "bg-slate-900 text-white" :
                          selectedDiscount.smStatus === 'REJECTED' ? "bg-rose-200/80 text-rose-900" :
                          selectedDiscount.smStatus === 'HELD' ? "bg-amber-200/80 text-amber-900" :
                          selectedDiscount.stage === 'sales_manager' ? "bg-amber-200 text-amber-900 animate-pulse" :
                          "bg-slate-100 text-slate-400"
                        )}>
                          {selectedDiscount.smStatus || (selectedDiscount.stage === 'sales_manager' ? 'In Review' : 'Pending')}
                        </span>
                      </div>

                      <div className="mt-2 text-left">
                        {selectedDiscount.smByName ? (
                          <div className="space-y-0.5">
                            <p className="text-xs font-black text-slate-900 truncate">
                              {selectedDiscount.smByName}
                            </p>
                            <p className="text-[10px] font-semibold text-slate-500">
                              {formatDate(selectedDiscount.smAt)}
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-400 italic">
                            {selectedDiscount.stage === 'sales_manager' ? 'Awaiting action' : 'Not reached yet'}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step 2: CEO */}
                    <div className={cn(
                      "rounded-2xl p-3 border transition-all flex flex-col justify-between min-h-[5.5rem]",
                      selectedDiscount.ceoStatus === 'APPROVED' ? "border-slate-300 bg-slate-100/70 text-slate-900 shadow-2xs" :
                      selectedDiscount.ceoStatus === 'REJECTED' ? "border-rose-200 bg-rose-50/90 text-rose-950 shadow-2xs" :
                      selectedDiscount.ceoStatus === 'HELD' ? "border-amber-200 bg-amber-50/90 text-amber-950 shadow-2xs" :
                      selectedDiscount.stage === 'ceo' ? "border-sky-300 bg-sky-50/70 text-sky-950 ring-2 ring-sky-300/60 font-bold shadow-2xs" :
                      "border-slate-200 bg-white text-slate-400"
                    )}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs">2. CEO</span>
                        <span className={cn(
                          "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider",
                          selectedDiscount.ceoStatus === 'APPROVED' ? "bg-slate-900 text-white" :
                          selectedDiscount.ceoStatus === 'REJECTED' ? "bg-rose-200/80 text-rose-900" :
                          selectedDiscount.ceoStatus === 'HELD' ? "bg-amber-200/80 text-amber-900" :
                          selectedDiscount.stage === 'ceo' ? "bg-sky-200 text-sky-900 animate-pulse" :
                          "bg-slate-100 text-slate-400"
                        )}>
                          {selectedDiscount.ceoStatus || (selectedDiscount.stage === 'ceo' ? 'In Review' : 'Pending')}
                        </span>
                      </div>

                      <div className="mt-2 text-left">
                        {selectedDiscount.ceoByName ? (
                          <div className="space-y-0.5">
                            <p className="text-xs font-black text-slate-900 truncate">
                              {selectedDiscount.ceoByName}
                            </p>
                            <p className="text-[10px] font-semibold text-slate-500">
                              {formatDate(selectedDiscount.ceoAt)}
                            </p>
                            {selectedDiscount.ceoApprovedAmount && (
                              <p className="text-[10px] font-bold text-slate-700 font-mono">
                                Approved: {formatCurrency(selectedDiscount.ceoApprovedAmount)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-400 italic">
                            {selectedDiscount.stage === 'ceo' ? 'Awaiting action' : 'Not reached yet'}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step 3: MD (only if > 5000) */}
                    {selectedDiscount.isHighValue && (
                      <div className={cn(
                        "rounded-2xl p-3 border transition-all flex flex-col justify-between min-h-[5.5rem]",
                        selectedDiscount.mdStatus === 'APPROVED' ? "border-slate-300 bg-slate-100/70 text-slate-900 shadow-2xs" :
                        selectedDiscount.mdStatus === 'REJECTED' ? "border-rose-200 bg-rose-50/90 text-rose-950 shadow-2xs" :
                        selectedDiscount.mdStatus === 'HELD' ? "border-amber-200 bg-amber-50/90 text-amber-950 shadow-2xs" :
                        selectedDiscount.stage === 'md' ? "border-indigo-300 bg-indigo-50/70 text-indigo-950 ring-2 ring-indigo-300/60 font-bold shadow-2xs" :
                        "border-slate-200 bg-white text-slate-400"
                      )}>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold text-xs">3. MD (&gt; ₹5k)</span>
                          <span className={cn(
                            "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider",
                            selectedDiscount.mdStatus === 'APPROVED' ? "bg-slate-900 text-white" :
                            selectedDiscount.mdStatus === 'REJECTED' ? "bg-rose-200/80 text-rose-900" :
                            selectedDiscount.mdStatus === 'HELD' ? "bg-amber-200/80 text-amber-900" :
                            selectedDiscount.stage === 'md' ? "bg-indigo-200 text-indigo-900 animate-pulse" :
                            "bg-slate-100 text-slate-400"
                          )}>
                            {selectedDiscount.mdStatus || (selectedDiscount.stage === 'md' ? 'In Review' : 'Pending')}
                          </span>
                        </div>

                        <div className="mt-2 text-left">
                          {selectedDiscount.mdByName ? (
                            <div className="space-y-0.5">
                              <p className="text-xs font-black text-slate-900 truncate">
                                {selectedDiscount.mdByName}
                              </p>
                              <p className="text-[10px] font-semibold text-slate-500">
                                {formatDate(selectedDiscount.mdAt)}
                              </p>
                              {selectedDiscount.mdApprovedAmount && (
                                <p className="text-[10px] font-bold text-slate-700 font-mono">
                                  Approved: {formatCurrency(selectedDiscount.mdApprovedAmount)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-[11px] font-medium text-slate-400 italic">
                              {selectedDiscount.stage === 'md' ? 'Awaiting action' : 'Not reached yet'}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Step 4 / Final: Accounts */}
                    <div className={cn(
                      "rounded-2xl p-3 border transition-all flex flex-col justify-between min-h-[5.5rem]",
                      selectedDiscount.payoutStatus === 'PAID' ? "border-slate-300 bg-slate-100/70 text-slate-900 shadow-2xs" :
                      selectedDiscount.payoutStatus === 'NOT_PAID' ? "border-rose-200 bg-rose-50/90 text-rose-950 shadow-2xs" :
                      selectedDiscount.payoutStatus === 'HELD' ? "border-amber-200 bg-amber-50/90 text-amber-950 shadow-2xs" :
                      selectedDiscount.stage === 'accounts' ? "border-violet-300 bg-violet-50/70 text-violet-950 ring-2 ring-violet-300/60 font-bold shadow-2xs" :
                      "border-slate-200 bg-white text-slate-400"
                    )}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-xs">{selectedDiscount.isHighValue ? '4. Accounts' : '3. Accounts'}</span>
                        <span className={cn(
                          "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider",
                          selectedDiscount.payoutStatus === 'PAID' ? "bg-slate-900 text-white" :
                          selectedDiscount.payoutStatus === 'NOT_PAID' ? "bg-rose-200/80 text-rose-900" :
                          selectedDiscount.payoutStatus === 'HELD' ? "bg-amber-200/80 text-amber-900" :
                          selectedDiscount.stage === 'accounts' ? "bg-violet-200 text-violet-900 animate-pulse" :
                          "bg-slate-100 text-slate-400"
                        )}>
                          {selectedDiscount.payoutStatus || (selectedDiscount.stage === 'accounts' ? 'Payout Due' : 'Pending')}
                        </span>
                      </div>

                      <div className="mt-2 text-left">
                        {selectedDiscount.payoutByName ? (
                          <div className="space-y-0.5">
                            <p className="text-xs font-black text-slate-900 truncate">
                              {selectedDiscount.payoutByName}
                            </p>
                            <p className="text-[10px] font-semibold text-slate-500">
                              {formatDate(selectedDiscount.payoutAt)}
                            </p>
                            {selectedDiscount.payoutReference && (
                              <p className="text-[10px] font-mono text-slate-600 truncate">
                                Ref: {selectedDiscount.payoutReference}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] font-medium text-slate-400 italic">
                            {selectedDiscount.stage === 'accounts' ? 'Awaiting action' : 'Not reached yet'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer Name</p>
                    <p className="mt-1 font-bold text-slate-900">{selectedDiscount.customerName}</p>
                    <p className="text-[11px] font-mono text-slate-500">{selectedDiscount.customerPhone || '—'}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vehicle</p>
                    <p className="mt-1 font-bold text-slate-900">{selectedDiscount.model || '—'}</p>
                    <p className="text-[11px] text-slate-500">{selectedDiscount.variant || '—'}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">VIN Number</p>
                    <p className="mt-1 font-mono font-bold text-slate-900">
                      {selectedDiscount.vehicleSnapshot?.vin || '—'}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Requested By</p>
                    <p className="mt-1 font-bold text-slate-900">{selectedDiscount.requestedByName}</p>
                    <p className="text-[11px] text-slate-500">{formatDate(selectedDiscount.createdAt)}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Consultant / Dealer</p>
                    <p className="mt-1 font-bold text-slate-900">{selectedDiscount.consultantName || '—'}</p>
                    <p className="text-[11px] text-slate-500">Dealer: {selectedDiscount.dealerCode || '—'}</p>
                  </div>

                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ex-Showroom Price</p>
                    <p className="mt-1 font-bold text-slate-900">
                      {selectedDiscount.vehicleSnapshot?.exShowroom ? formatCurrency(selectedDiscount.vehicleSnapshot.exShowroom) : '—'}
                    </p>
                  </div>
                </div>

                {/* Reason */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reason / Justification</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-800">
                    {selectedDiscount.reason || 'No specific reason provided.'}
                  </p>
                </div>

                {/* Approval History / Remarks Timeline (Hidden by Default) */}
                {(() => {
                  const trailCount = [
                    Boolean(selectedDiscount.smAt),
                    Boolean(selectedDiscount.ceoAt),
                    Boolean(selectedDiscount.mdAt),
                    Boolean(selectedDiscount.payoutAt),
                  ].filter(Boolean).length

                  return (
                    <div className="rounded-2xl border border-slate-200/80 bg-white overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        onClick={() => setShowApprovalTrail((prev) => !prev)}
                        className="w-full flex items-center justify-between p-3.5 text-left bg-slate-50/70 hover:bg-slate-100/80 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-slate-500" />
                          <span className="text-xs font-black uppercase tracking-wider text-slate-700">Approval Trail</span>
                          {trailCount > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-200 text-slate-700">
                              {trailCount} {trailCount === 1 ? 'record' : 'records'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
                          <span>{showApprovalTrail ? 'Hide Trail' : 'View Trail'}</span>
                          {showApprovalTrail ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </div>
                      </button>

                      {showApprovalTrail && (
                        <div className="p-4 space-y-2.5 border-t border-slate-100 bg-slate-50/30">
                          {trailCount === 0 ? (
                            <p className="text-center text-xs text-slate-400 py-3 font-semibold">No approval actions recorded yet.</p>
                          ) : (
                            <>
                              {selectedDiscount.smAt && (
                                <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-2xs">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white font-bold text-xs">
                                    ✓
                                  </span>
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-900">Stage 1: GSM / SM ({selectedDiscount.smByName})</p>
                                    <p className="text-[11px] text-slate-500">{formatDate(selectedDiscount.smAt)} · Status: {selectedDiscount.smStatus}</p>
                                    {selectedDiscount.smRemarks && (
                                      <p className="mt-1 italic text-slate-600">“{selectedDiscount.smRemarks}”</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {selectedDiscount.ceoAt && (
                                <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-2xs">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white font-bold text-xs">
                                    ✓
                                  </span>
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-900">Stage 2: CEO ({selectedDiscount.ceoByName})</p>
                                    <p className="text-[11px] text-slate-500">
                                      {formatDate(selectedDiscount.ceoAt)} · Status: {selectedDiscount.ceoStatus}
                                      {selectedDiscount.ceoApprovedAmount && ` · Approved Amount: ${formatCurrency(selectedDiscount.ceoApprovedAmount)}`}
                                    </p>
                                    {selectedDiscount.ceoRemarks && (
                                      <p className="mt-1 italic text-slate-600">“{selectedDiscount.ceoRemarks}”</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {selectedDiscount.mdAt && (
                                <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-2xs">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white font-bold text-xs">
                                    ✓
                                  </span>
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-900">Stage 3: MD ({selectedDiscount.mdByName})</p>
                                    <p className="text-[11px] text-slate-500">
                                      {formatDate(selectedDiscount.mdAt)} · Status: {selectedDiscount.mdStatus}
                                      {selectedDiscount.mdApprovedAmount && ` · Approved Amount: ${formatCurrency(selectedDiscount.mdApprovedAmount)}`}
                                    </p>
                                    {selectedDiscount.mdRemarks && (
                                      <p className="mt-1 italic text-slate-600">“{selectedDiscount.mdRemarks}”</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {selectedDiscount.payoutAt && (
                                <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-2xs">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white font-bold text-xs">
                                    ✓
                                  </span>
                                  <div className="flex-1">
                                    <p className="font-bold text-slate-900">Final Payout: Accounts ({selectedDiscount.payoutByName})</p>
                                    <p className="text-[11px] text-slate-500">
                                      {formatDate(selectedDiscount.payoutAt)} · Status: {selectedDiscount.payoutStatus}
                                      {selectedDiscount.payoutReference && ` · Ref: ${selectedDiscount.payoutReference}`}
                                    </p>
                                    {selectedDiscount.payoutRemarks && (
                                      <p className="mt-1 italic text-slate-600">“{selectedDiscount.payoutRemarks}”</p>
                                    )}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Stage Action Form (if current user can act) */}
                {selectedDiscount.canAct && selectedDiscount.stage !== 'done' && selectedDiscount.stage !== 'rejected' && (
                  <div className="rounded-3xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50/50 to-slate-50/80 p-5 space-y-4 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-900 font-black">
                      <ShieldCheck className="h-5 w-5 text-indigo-600" />
                      <span>Take Action on {selectedDiscount.stageLabel}</span>
                    </div>

                    {(selectedDiscount.stage === 'ceo' || selectedDiscount.stage === 'md') && (
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Approved Amount (₹) — Modify if granting different amount
                        </label>
                        <Input
                          type="number"
                          value={customApprovedAmount}
                          onChange={(e) => setCustomApprovedAmount(e.target.value)}
                          placeholder="Approved amount..."
                          className="h-10 rounded-xl bg-white font-bold"
                        />
                      </div>
                    )}

                    {selectedDiscount.stage === 'accounts' && (
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          Payment / Bank Reference # (Optional)
                        </label>
                        <Input
                          value={payoutRef}
                          onChange={(e) => setPayoutRef(e.target.value)}
                          placeholder="e.g. UTR / Cheque # / Ref..."
                          className="h-10 rounded-xl bg-white font-bold"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Remarks / Justification
                      </label>
                      <Textarea
                        value={actionRemarks}
                        onChange={(e) => setActionRemarks(e.target.value)}
                        placeholder="Add remarks or justification..."
                        className="rounded-xl bg-white font-medium text-xs"
                        rows={2}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-200/70">
                      <Button
                        type="button"
                        onClick={() => handleExecuteAction(selectedDiscount.stage === 'accounts' ? 'payout' : 'approve')}
                        disabled={activeAction !== null}
                        className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                      >
                        {activeAction === 'approve' || activeAction === 'payout' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>{selectedDiscount.stage === 'accounts' ? 'Confirm & Record Payout' : 'Approve & Forward'}</span>
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleExecuteAction('reject')}
                        disabled={activeAction !== null}
                        className="h-10 px-4 rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer"
                      >
                        {activeAction === 'reject' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <X className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        onClick={() => handleExecuteAction('hold')}
                        disabled={activeAction !== null}
                        className="h-10 px-4 rounded-xl bg-slate-600 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all active:scale-[0.98] cursor-pointer"
                      >
                        {activeAction === 'hold' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Clock className="h-3.5 w-3.5" />
                            <span>Hold</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <DialogTitle className="sr-only">Discount Details</DialogTitle>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
