'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import {
  Search,
  Plus,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  RotateCcw,
  CornerUpLeft,
  Paperclip,
  X,
  FileText,
  Loader2,
  Check,
  Fuel,
  Wrench,
  Undo2,
  Calendar,
  Eye,
  Maximize2,
  ZoomIn,
  ExternalLink,
  Receipt,
  Download,
  PencilLine,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FuelFormDialog } from './fuel-form-dialog'
import { FuelFinalizeDialog } from './fuel-finalize-dialog'
import {
  FUEL_LOCATIONS,
  FUEL_REQUIRED_FOR_OPTIONS,
  parseFuelSlipUrls,
  getFuelFinalization,
  getFuelLifecycleState,
  getFuelQuantities,
  type FuelFinalization,
} from '@/lib/fuel-approvals/constants'
import type { FuelApprovalRecord, FuelApprovalStatus } from '@/lib/fuel-approvals/types'
import { canUserApproveStage } from '@/lib/fuel-approvals/access'
import { INDIA_TIME_ZONE } from '@/lib/date-time'

const IST = INDIA_TIME_ZONE

function istDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The sentence a finalised marker carries on hover.
 *
 * Deliberately names the person and the moment rather than saying "Finalised" alone: this marker is
 * the thing that stops somebody re-opening the form, so it has to answer "finalised by whom, when"
 * without needing the record opened.
 */
function finalizedTitle(fin: FuelFinalization): string {
  const who = fin.byName ? ` by ${fin.byName}` : ''
  const when = fin.at ? ` on ${istDate(fin.at)}${istTime(fin.at) ? ' ' + istTime(fin.at) : ''}` : ''
  return `Finalised${who}${when}. Use Edit to correct the amount or slips.`
}

function istTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })
}

interface FuelApprovalsClientProps {
  currentUser: {
    id: string
    role: string
    fullName: string
    email: string
  }
  embedded?: boolean
}

export function FuelApprovalsClient({ currentUser, embedded = false }: FuelApprovalsClientProps) {
  const queryClient = useQueryClient()
  const isDeveloper = currentUser.role?.toLowerCase() === 'developer' || currentUser.role?.toLowerCase() === 'admin'

  /*
    * ⚠️ "Approved" IS NOT ONE SECTION. The CEO's decision opens the finalisation job rather than
    * closing the order, so an approved order is either still to be finalised or actually completed,
    * and those are two different queues for two different people. One combined tab is what made a
    * finished-looking list of orders whose bills nobody had recorded.
    */
  type FuelTabKey = 'pending' | 'to_finalise' | 'completed' | 'all' | 'held' | 'sent_back' | 'rejected'
  const [currentTab, setCurrentTab] = useState<FuelTabKey>('pending')
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL')
  const [selectedPurpose, setSelectedPurpose] = useState<string>('ALL')
  const [selectedFuelType, setSelectedFuelType] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<FuelApprovalRecord | null>(null)
  const [finalizeRecord, setFinalizeRecord] = useState<FuelApprovalRecord | null>(null)
  const [formDialogOpen, setFormDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<FuelApprovalRecord | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  // Litres the approver approves. Blank = approve what was requested (migration 0071).
  const [approveLitres, setApproveLitres] = useState('')
  // A figure typed for one request must never carry over to the next one opened.
  const selectedRecordId = selectedRecord?.id ?? null
  useEffect(() => {
    setApproveLitres('')
  }, [selectedRecordId])
  const [actionLoading, setActionLoading] = useState(false)
  const [inlineActionId, setInlineActionId] = useState<string | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{ title: string; url: string } | null>(null)

  // Multiple selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPromptAction, setBulkPromptAction] = useState<'SEND_BACK' | 'REJECT' | null>(null)
  const [bulkRemarks, setBulkRemarks] = useState('')

  // Fetch records and status counts
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['fuel-approvals', currentTab, selectedLocation, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams()
      params.set('tab', currentTab)
      if (selectedLocation !== 'ALL') params.set('location', selectedLocation)
      if (searchQuery) params.set('search', searchQuery)
      params.set('_t', Date.now().toString())

      const res = await fetch(`/api/fuel-approvals?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
      })
      if (!res.ok) throw new Error('Failed to load fuel approvals')
      return res.json() as Promise<{
        items: FuelApprovalRecord[]
        counts: {
          pending: number
          ceoPending: number
          accountsPending: number
          eaPending: number
          mdPending: number
          all: number
          approved: number
          toFinalise: number
          completed: number
          held: number
          sentBack: number
          rejected: number
          totalLitersApproved: number
        }
        currentUser: any
      }>
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  const rawItems = data?.items || []
  const counts = data?.counts || {
    pending: 0,
    ceoPending: 0,
    accountsPending: 0,
    eaPending: 0,
    mdPending: 0,
    all: 0,
    approved: 0,
    toFinalise: 0,
    completed: 0,
    held: 0,
    sentBack: 0,
    rejected: 0,
    totalLitersApproved: 0,
  }

  // Client-side additional filters (purpose & fuel type)
  const items = useMemo(() => {
    return rawItems.filter((row) => {
      if (selectedPurpose !== 'ALL' && row.fuelRequiredFor !== selectedPurpose) return false
      if (selectedFuelType !== 'ALL' && row.fuelType !== selectedFuelType) return false
      return true
    })
  }, [rawItems, selectedPurpose, selectedFuelType])

  // Select all toggle
  const allIds = useMemo(() => items.map((i) => i.id), [items])
  const isAllSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id))
  const isSomeSelected = items.some((i) => selectedIds.has(i.id)) && !isAllSelected

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  const toggleSelectRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Execute single stage action
  const handleStageAction = async (
    recordId: string,
    action: 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESET',
    customRemarks?: string,
    approvedQuantity?: number
  ) => {
    const finalRemarks = customRemarks !== undefined ? customRemarks : actionRemarks.trim()
    if (approvedQuantity !== undefined && (!Number.isFinite(approvedQuantity) || approvedQuantity <= 0)) {
      toast({ title: 'Invalid litres', description: 'Approved litres must be a number above zero.', variant: 'error' })
      return
    }

    if ((action === 'SEND_BACK' || action === 'REJECT') && !finalRemarks) {
      const promptValue = window.prompt(`Please enter remark / reason for ${action === 'SEND_BACK' ? 'Send Back' : 'Reject'}:`)
      if (!promptValue || !promptValue.trim()) {
        toast({
          title: 'Remarks required',
          description: `You must provide remarks when performing ${action === 'SEND_BACK' ? 'Send Back' : 'Reject'}.`,
          variant: 'error',
        })
        return
      }
      return handleStageAction(recordId, action, promptValue.trim(), approvedQuantity)
    }

    setActionLoading(true)
    setInlineActionId(recordId)
    try {
      const res = await fetch(`/api/fuel-approvals/${recordId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          remarks: finalRemarks,
          ...(action === 'APPROVE' && approvedQuantity !== undefined ? { approvedQuantity } : {}),
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to update approval')
      }

      toast({
        title: 'Action completed',
        description: action === 'RESET' ? 'Record reset to CEO pending for testing.' : `Request marked as ${action.toLowerCase()} successfully.`,
        variant: 'success',
      })

      setActionRemarks('')
      setApproveLitres('')
      if (selectedRecord && selectedRecord.id === recordId) {
        setSelectedRecord(null)
      }
      await queryClient.invalidateQueries({ queryKey: ['fuel-approvals'] })
      await refetch()
    } catch (err: any) {
      toast({
        title: 'Action failed',
        description: err.message || 'Could not perform action',
        variant: 'error',
      })
    } finally {
      setActionLoading(false)
      setInlineActionId(null)
    }
  }

  // Execute bulk action
  const handleBulkAction = async (
    action: 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESET',
    explicitRemarks?: string
  ) => {
    const ids = Array.from(selectedIds)
    if (!ids.length) return

    if ((action === 'SEND_BACK' || action === 'REJECT') && !explicitRemarks) {
      setBulkPromptAction(action)
      return
    }

    setActionLoading(true)
    try {
      const res = await fetch('/api/fuel-approvals/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids,
          action,
          remarks: explicitRemarks || 'Bulk action applied',
        }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to execute bulk action')
      }

      toast({
        title: 'Bulk Action Successful',
        description: result.message || `Processed ${ids.length} orders successfully.`,
        variant: 'success',
      })

      setSelectedIds(new Set())
      setBulkPromptAction(null)
      setBulkRemarks('')
      await queryClient.invalidateQueries({ queryKey: ['fuel-approvals'] })
      await refetch()
    } catch (err: any) {
      toast({
        title: 'Bulk Action Failed',
        description: err.message || 'Could not complete bulk operation',
        variant: 'error',
      })
    } finally {
      setActionLoading(false)
    }
  }

  // Check if current user is authorized to act on a record's current stage
  const canActOnRecord = (record: FuelApprovalRecord) => {
    return canUserApproveStage(currentUser, record.status, record.currentStage)
  }

  const getStageActionLabel = (stage: string) => {
    if (stage === 'ceo' || stage === 'ed') return 'Approve (CEO)'
    return 'Approve'
  }

  // Colored Badges for Locations
  const getLocationBadge = (location: string) => {
    if (location === 'KIA JAMMU') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-100 text-sky-800 border border-sky-300">
          KIA Jammu
        </span>
      )
    }
    if (location === 'KIA UDHAMPUR') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
          KIA Udhampur
        </span>
      )
    }
    if (location === 'KIA BANIHAL') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
          KIA Banihal
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
        {location}
      </span>
    )
  }

  // Colored Badges for Purposes
  const getPurposeBadge = (purpose: string) => {
    switch (purpose) {
      case 'DEMO':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-300">
            Demo
          </span>
        )
      case 'GENSET':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-orange-100 text-orange-900 border border-orange-300">
            Genset
          </span>
        )
      case 'NEW DELIVERY':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            New Delivery
          </span>
        )
      case 'STOCK YARD':
      case 'STOCK TRANSFER':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-cyan-100 text-cyan-800 border border-cyan-300">
            {purpose}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300">
            {purpose}
          </span>
        )
    }
  }

  // Colored Badges for Fuel Type
  const getFuelTypeTag = (fuelType: string) => {
    if (fuelType === 'PETROL') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white shadow-2xs">
          PETROL
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white shadow-2xs">
        DIESEL
      </span>
    )
  }

  const getStatusBadge = (status: FuelApprovalStatus) => {
    switch (status) {
      case 'approved':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-teal-700" /> Approved
          </span>
        )
      case 'rejected':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5 mr-1 text-rose-600" /> Rejected
          </span>
        )
      case 'sent_back':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <RotateCcw className="w-3.5 h-3.5 mr-1 text-amber-600" /> Sent Back
          </span>
        )
      case 'accounts_on_hold':
      case 'ceo_on_hold':
      case 'ea_on_hold':
      case 'md_on_hold':
      case 'ed_on_hold':
      case 'hr_on_hold':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <PauseCircle className="w-3.5 h-3.5 mr-1 text-amber-600" /> On Hold
          </span>
        )
      case 'ceo_pending':
      case 'ed_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-blue-600" /> CEO Review
          </span>
        )
      case 'accounts_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Pending Review
          </span>
        )
      case 'ea_pending':
      case 'hr_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-purple-600" /> EA Review
          </span>
        )
      case 'md_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-indigo-600" /> MD Review
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        )
    }
  }

  /**
   * What the Stage Status column says. One chip, stating where the order actually IS.
   *
   * ⚠️ An approved order does NOT get a green "Approved" chip any more. Until its bill and slips are
   * recorded it is open work and reads as such; only a finalised order reads as done. getStatusBadge
   * still owns every other status — this adds the position that `status` cannot express.
   */
  const getLifecycleBadge = (record: FuelApprovalRecord) => {
    const state = getFuelLifecycleState(record)
    if (state === 'to_finalise') {
      return (
        <span
          title="CEO approved. The fuel bill and slips still have to be recorded before this order is complete."
          style={{ backgroundColor: '#fffbeb', color: '#92400e', borderColor: '#fcd34d' }}
          className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border"
        >
          <Clock className="w-3.5 h-3.5 mr-1" /> To Finalise
        </span>
      )
    }
    if (state === 'completed') {
      return (
        <span
          title={finalizedTitle(getFuelFinalization(record))}
          style={{ backgroundColor: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}
          className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border"
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Completed
        </span>
      )
    }
    return getStatusBadge(record.status)
  }

  /** The one line under the chip: what is outstanding, or what was recorded. Null when neither. */
  const lifecycleNote = (record: FuelApprovalRecord): string | null => {
    const state = getFuelLifecycleState(record)
    if (state === 'to_finalise') {
      return record.ceoApprovedAt ? `CEO approved ${istDate(record.ceoApprovedAt)}` : 'Bill not recorded'
    }
    if (state === 'completed') {
      const fin = getFuelFinalization(record)
      const cost = record.totalCost ? `₹${Number(record.totalCost).toLocaleString('en-IN')}` : null
      return [cost, fin.at ? istDate(fin.at) : null].filter(Boolean).join(' · ') || null
    }
    return null
  }

  const stageStatusCell = (record: FuelApprovalRecord, align: 'start' | 'end' = 'start') => {
    const note = lifecycleNote(record)
    return (
      <div className={`flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
        {getLifecycleBadge(record)}
        {note && <span className="text-[10px] font-semibold text-slate-400">{note}</span>}
      </div>
    )
  }

  const mainContent = (
    <div className="space-y-5 max-w-full pb-16">
      {/* Workspace Action Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold text-slate-800">
            Dealership Fuel Orders
          </h2>
          <span className="text-xs font-bold text-teal-800 bg-teal-100 px-2.5 py-0.5 rounded-full border border-teal-200">
            {counts.all} orders
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-9 px-3 rounded-xl border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-teal-700' : 'text-slate-600'}`} />
          </Button>

          <Button
            onClick={() => {
              setEditRecord(null)
              setFormDialogOpen(true)
            }}
            className="h-9 px-4 rounded-xl text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Fill Fuel Form
          </Button>
        </div>
      </div>

      {/* Executive Metric Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Pending My Action
          </span>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl sm:text-[25px] font-semibold text-slate-900 tabular-nums">
              {counts.pending}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Awaiting your approval</span>
        </div>

        {/*
          * ⚠️ This tile used to be captioned "Completed Orders / CEO approved" over counts.approved —
          * it counted 38 orders as completed whose bills nobody had recorded. Approved is now split
          * into the work still outstanding and the work actually finished, and both are clickable
          * because a number nobody can act on is decoration.
          */}
        <button
          type="button"
          onClick={() => { setCurrentTab('to_finalise'); setSelectedIds(new Set()) }}
          className="p-4 text-left rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-amber-300 transition-colors cursor-pointer"
        >
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            To Finalise
          </span>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl sm:text-[25px] font-semibold tabular-nums" style={{ color: counts.toFinalise > 0 ? '#b45309' : '#0f172a' }}>
              {counts.toFinalise}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Approved, bill not recorded</span>
        </button>

        <button
          type="button"
          onClick={() => { setCurrentTab('completed'); setSelectedIds(new Set()) }}
          className="p-4 text-left rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-emerald-300 transition-colors cursor-pointer"
        >
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Completed
          </span>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl sm:text-[25px] font-semibold tabular-nums text-emerald-700">
              {counts.completed}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Bill &amp; slips recorded</span>
        </button>

        <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs hover:border-slate-300 transition-colors">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
            Approved Fuel
          </span>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-2xl sm:text-[25px] font-semibold tabular-nums text-emerald-700">
              {counts.totalLitersApproved}
            </span>
            <span className="text-xs font-semibold text-emerald-600">Ltrs</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block font-medium">Total dispensed &amp; authorized</span>
        </div>
      </div>

      {/*
        * Tab Navigation — one row of data, not six hand-copied buttons. The order is the pipeline:
        * what needs approving, what needs finalising, what is done, then the archives.
        */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-6 text-xs sm:text-sm font-semibold overflow-x-auto whitespace-nowrap scrollbar-none pb-2">
          {([
            { key: 'pending', label: 'Pending My Approval', count: counts.pending, tone: 'teal' },
            { key: 'to_finalise', label: 'To Finalise', count: counts.toFinalise, tone: 'amber' },
            { key: 'completed', label: 'Completed', count: counts.completed, tone: 'plain' },
            { key: 'all', label: 'All Requisitions', count: counts.all, tone: 'plain' },
            { key: 'held', label: 'On Hold', count: counts.held, tone: 'plain' },
            { key: 'sent_back', label: 'Sent Back', count: counts.sentBack, tone: 'amber' },
            { key: 'rejected', label: 'Rejected', count: counts.rejected, tone: 'plain' },
          ] as { key: FuelTabKey; label: string; count: number; tone: 'teal' | 'amber' | 'plain' }[]).map((tab) => {
            const active = currentTab === tab.key
            /* A count only shouts when there is something to do about it. */
            const loud = tab.count > 0 && tab.tone !== 'plain'
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setCurrentTab(tab.key)
                  setSelectedIds(new Set())
                }}
                aria-current={active ? 'page' : undefined}
                className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                  active ? 'text-teal-800 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  style={
                    loud
                      ? { backgroundColor: tab.tone === 'amber' ? '#b45309' : '#0f766e', color: '#ffffff' }
                      : { backgroundColor: '#f1f5f9', color: '#475569' }
                  }
                >
                  {tab.count}
                </span>
                {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
        <div className="relative sm:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search order #, reg, VIN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs rounded-xl bg-white border-slate-200"
          />
        </div>

        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="h-9 px-3 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600"
        >
          <option value="ALL">All Dealership Locations</option>
          {FUEL_LOCATIONS.map((loc) => (
            <option key={loc.value} value={loc.value}>
              {loc.label}
            </option>
          ))}
        </select>

        <select
          value={selectedPurpose}
          onChange={(e) => setSelectedPurpose(e.target.value)}
          className="h-9 px-3 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600"
        >
          <option value="ALL">All Requisition Purposes</option>
          {FUEL_REQUIRED_FOR_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={selectedFuelType}
          onChange={(e) => setSelectedFuelType(e.target.value)}
          className="h-9 px-3 text-xs rounded-xl bg-white border border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600"
        >
          <option value="ALL">All Fuel Types (Petrol / Diesel)</option>
          <option value="PETROL">Petrol</option>
          <option value="DIESEL">Diesel</option>
        </select>
      </div>

      {/* Floating Multi-Select Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 p-3 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-300 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">
              {selectedIds.size}
            </span>
            <span className="text-xs font-semibold text-slate-800">
              {selectedIds.size} {selectedIds.size === 1 ? 'order' : 'orders'} selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleBulkAction('APPROVE')}
              style={{ backgroundColor: '#055B65', color: '#ffffff' }}
              className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
            >
              {actionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              )}
              <span>Approve All Selected</span>
            </button>

            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleBulkAction('SEND_BACK')}
              style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
              className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
              <span>Send Back</span>
            </button>

            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleBulkAction('REJECT')}
              style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
              className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
            >
              <X className="h-3.5 w-3.5" />
              <span>Reject</span>
            </button>

            <button
              type="button"
              disabled={actionLoading}
              onClick={() => handleBulkAction('HOLD')}
              style={{ backgroundColor: '#475569', color: '#ffffff' }}
              className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Hold</span>
            </button>

            {isDeveloper && (
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleBulkAction('RESET')}
                style={{ backgroundColor: '#4f46e5', color: '#ffffff' }}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="h-8 px-2.5 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer border-none bg-transparent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Content Section: Table & Mobile Cards */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-slate-200">
          <Loader2 className="w-6 h-6 animate-spin text-teal-700 mb-2" />
          <span className="text-xs font-semibold text-slate-600">Loading fuel orders...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 bg-white rounded-2xl border border-slate-200 text-center">
          <Fuel className="w-8 h-8 text-slate-300 mb-2" />
          <p className="text-sm font-bold text-slate-800">
            {currentTab === 'pending'
              ? 'No orders awaiting your approval'
              : currentTab === 'to_finalise'
              ? 'Nothing waiting to be finalised'
              : currentTab === 'completed'
              ? 'No completed orders yet'
              : 'No fuel records found'}
          </p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">
            {currentTab === 'to_finalise'
              ? 'Every approved order has had its fuel bill and slips recorded.'
              : currentTab === 'completed'
              ? 'An order lands here once someone records its fuel bill and slips.'
              : currentTab === 'pending'
              ? 'When dealership staff submit fuel requests requiring your review, they will show up here.'
              : 'No requests match your selected filters. Try changing or resetting the filters.'}
          </p>
        </div>
      ) : (
        <div>
          {/* Mobile View: High-contrast cards */}
          <div className="grid grid-cols-1 gap-3 sm:hidden">
            {items.map((record) => {
              const canAct = canActOnRecord(record)
              const isActionBusy = inlineActionId === record.id && actionLoading
              const isSelected = selectedIds.has(record.id)

              return (
                <div
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                  className={`p-4 rounded-2xl bg-white border shadow-2xs space-y-3 cursor-pointer transition-colors ${
                    isSelected ? 'border-teal-500 bg-teal-50/20' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        onClick={(e) => toggleSelectRow(record.id, e)}
                        className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                        {record.requestNumber}
                      </span>
                    </div>
                    {stageStatusCell(record, 'end')}
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900 line-clamp-1">
                      {record.vehRegNo}
                    </h4>
                    <div className="flex items-center gap-1.5 mt-1">
                      {getLocationBadge(record.location)}
                      {getPurposeBadge(record.fuelRequiredFor)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-900">
                        {record.fuelFilledLtrs} L
                      </span>
                      {getFuelTypeTag(record.fuelType)}
                    </div>

                    <span className="text-[11px] text-slate-600 font-semibold flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {istDate(record.fuelFilledDate)}
                    </span>
                  </div>

                  {/* All Buttons Visible on Mobile */}
                  <div
                    className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canAct && record.status !== 'approved' && record.status !== 'rejected' && (
                      <>
                        <button
                          type="button"
                          disabled={isActionBusy}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStageAction(record.id, 'APPROVE')
                          }}
                          style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                        >
                          {isActionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                          <span>{getStageActionLabel(record.currentStage)}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isActionBusy}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStageAction(record.id, 'SEND_BACK')
                          }}
                          style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                        >
                          <CornerUpLeft className="w-3.5 h-3.5" />
                          <span>Send Back</span>
                        </button>

                        <button
                          type="button"
                          disabled={isActionBusy}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStageAction(record.id, 'REJECT')
                          }}
                          style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>

                        <button
                          type="button"
                          disabled={isActionBusy}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleStageAction(record.id, 'HOLD')
                          }}
                          style={{ backgroundColor: '#475569', color: '#ffffff' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Hold</span>
                        </button>
                      </>
                    )}

                    {/*
                      * ⚠️ A FINALISED ORDER IS A STATE, NOT A BUTTON. This used to be one button whose
                      * LABEL flipped to "Finalised" while its click handler still opened the finalise
                      * form — so the screen said the work was done and then invited you to do it again.
                      * Finalised now renders as a marker you cannot press, and correcting it is a
                      * separate, deliberate Edit. See getFuelFinalization for why the test is the
                      * history entry and not `totalCost`.
                      */}
                    {record.status === 'approved' && (() => {
                      const fin = getFuelFinalization(record)
                      if (!fin.finalized) {
                        return (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFinalizeRecord(record)
                            }}
                            style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                            className="h-8 px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                            title="Finalise fuel cost and slips"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Finalise</span>
                          </button>
                        )
                      }
                      /* Completed is stated once, in the Stage Status column. Here it is only an action. */
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setFinalizeRecord(record)
                          }}
                          style={{ backgroundColor: '#ffffff', color: '#334155' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-bold border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 flex items-center gap-1 shadow-xs cursor-pointer"
                          title={`${finalizedTitle(fin)} Opens the finalise form so the amount or slips can be corrected.`}
                        >
                          <PencilLine className="w-3.5 h-3.5 text-slate-500" />
                          <span>Edit Final</span>
                        </button>
                      )
                    })()}

                    {(() => {
                      const slipUrls = parseFuelSlipUrls(record.fuelSlipUrl)
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (slipUrls.length === 1) window.open(slipUrls[0], '_blank')
                            else setSelectedRecord(record)
                          }}
                          style={{ backgroundColor: '#ffffff', color: '#334155' }}
                          className="h-8 px-2.5 rounded-xl text-xs font-bold border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 cursor-pointer ml-auto flex items-center gap-1 shadow-xs"
                        >
                          <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                          <span>Slip{slipUrls.length > 1 ? ` (${slipUrls.length})` : ''}</span>
                        </button>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop View: Clean executive table */}
          <div className="hidden sm:block overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs fuel-approvals-clean-table">
                <thead className="border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3 w-10">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = isSomeSelected
                        }}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3">Request #</th>
                    <th className="py-3 px-3">Vehicle / Equipment</th>
                    <th className="py-3 px-3">VIN / Chassis</th>
                    <th className="py-3 px-3">Location</th>
                    <th className="py-3 px-3">Purpose</th>
                    <th className="py-3 px-3">Quantity</th>
                    <th className="py-3 px-3">Fill Date</th>
                    <th className="py-3 px-3">Submitter</th>
                    <th className="py-3 px-3">Stage Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((record) => {
                    const canAct = canActOnRecord(record)
                    const isActionBusy = inlineActionId === record.id && actionLoading
                    const isSelected = selectedIds.has(record.id)

                    return (
                      <tr
                        key={record.id}
                        onClick={() => setSelectedRecord(record)}
                        className={`hover:bg-teal-50/30 transition-colors cursor-pointer ${
                          isSelected ? 'bg-teal-50/40' : ''
                        }`}
                      >
                        <td
                          className="py-3 px-3 w-10"
                          onClick={(e) => toggleSelectRow(record.id, e)}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            onClick={(e) => toggleSelectRow(record.id, e)}
                            className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 cursor-pointer"
                          />
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-md hover:underline">
                            {record.requestNumber}
                          </span>
                        </td>

                        <td className="py-3 px-3 font-bold text-slate-900 max-w-[220px] truncate">
                          {record.vehRegNo}
                        </td>

                        <td className="py-3 px-3 font-mono text-slate-700">
                          <span className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[11px] font-semibold">
                            {record.vinNo}
                          </span>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {getLocationBadge(record.location)}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {getPurposeBadge(record.fuelRequiredFor)}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900 text-xs">
                              {record.fuelFilledLtrs} L
                            </span>
                            {getFuelTypeTag(record.fuelType)}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-slate-700 whitespace-nowrap font-medium">
                          {istDate(record.fuelFilledDate)}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-teal-100 text-teal-800 font-bold text-[10px] flex items-center justify-center shrink-0">
                              {record.submittedByName?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block text-xs">
                                {record.submittedByName}
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {record.submittedByEmail}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          {stageStatusCell(record)}
                        </td>

                        {/* ALL ACTION BUTTONS DIRECTLY VISIBLE ON ROW */}
                        <td
                          className="py-3 px-3 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            {canAct && record.status !== 'approved' && record.status !== 'rejected' ? (
                              <>
                                {/* 1. APPROVE BUTTON */}
                                <button
                                  type="button"
                                  disabled={isActionBusy}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStageAction(record.id, 'APPROVE')
                                  }}
                                  style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                                  className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
                                  title={`Approve request at ${record.currentStage.toUpperCase()} stage`}
                                >
                                  {isActionBusy ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Check className="w-3 h-3 stroke-[2.5]" />
                                  )}
                                  <span>{getStageActionLabel(record.currentStage)}</span>
                                </button>

                                {/* 2. SEND BACK BUTTON */}
                                <button
                                  type="button"
                                  disabled={isActionBusy}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStageAction(record.id, 'SEND_BACK')
                                  }}
                                  style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                                  className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
                                  title="Send Back to Submitter for Revision"
                                >
                                  <CornerUpLeft className="w-3 h-3" />
                                  <span>Send Back</span>
                                </button>

                                {/* 3. REJECT BUTTON */}
                                <button
                                  type="button"
                                  disabled={isActionBusy}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStageAction(record.id, 'REJECT')
                                  }}
                                  style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                                  className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
                                  title="Reject / Deny Request"
                                >
                                  <X className="w-3 h-3" />
                                  <span>Reject</span>
                                </button>

                                {/* 4. HOLD BUTTON */}
                                <button
                                  type="button"
                                  disabled={isActionBusy}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleStageAction(record.id, 'HOLD')
                                  }}
                                  style={{ backgroundColor: '#475569', color: '#ffffff' }}
                                  className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
                                  title="Place order on hold"
                                >
                                  <Clock className="w-3 h-3" />
                                  <span>Hold</span>
                                </button>

                                {/* 5. SLIP BUTTON */}
                                {(() => {
                                  const slipUrls = parseFuelSlipUrls(record.fuelSlipUrl)
                                  return (
                                    <button
                                      type="button"
                                      title="View Fuel Slip(s)"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (slipUrls.length === 1) window.open(slipUrls[0], '_blank')
                                        else setSelectedRecord(record)
                                      }}
                                      style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                      className="h-7 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                                    >
                                      <Paperclip className="w-3 h-3 text-slate-500" />
                                      <span>Slip{slipUrls.length > 1 ? ` (${slipUrls.length})` : ''}</span>
                                    </button>
                                  )
                                })()}
                              </>
                            ) : record.status === 'approved' ? (
                              <div className="flex items-center gap-1.5">
                                {/* Same rule as the card view above: finalised is a marker, editing is its own button. */}
                                {(() => {
                                  const fin = getFuelFinalization(record)
                                  if (!fin.finalized) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setFinalizeRecord(record)
                                        }}
                                        style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                                        className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                                        title="Finalise fuel cost and slips"
                                      >
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>Finalise</span>
                                      </button>
                                    )
                                  }
                                  /* Completed is stated once, in the Stage Status column. Here it is only an action. */
                                  return (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setFinalizeRecord(record)
                                      }}
                                      style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                      className="h-7 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                                      title={`${finalizedTitle(fin)} Opens the finalise form so the amount or slips can be corrected.`}
                                    >
                                      <PencilLine className="w-3 h-3 text-slate-500" />
                                      <span>Edit Final</span>
                                    </button>
                                  )
                                })()}
                                {(() => {
                                  const slipUrls = parseFuelSlipUrls(record.fuelSlipUrl)
                                  if (slipUrls.length === 0) return null
                                  return (
                                    <button
                                      type="button"
                                      title="View Fuel Slip(s)"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (slipUrls.length === 1) window.open(slipUrls[0], '_blank')
                                        else setSelectedRecord(record)
                                      }}
                                      style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                      className="h-7 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                                    >
                                      <Paperclip className="w-3 h-3 text-slate-500" />
                                      <span>Slip{slipUrls.length > 1 ? ` (${slipUrls.length})` : ''}</span>
                                    </button>
                                  )
                                })()}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedRecord(record)
                                  }}
                                  style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                  className="h-7 px-2 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                                  title="View Details"
                                >
                                  <Eye className="w-3 h-3 text-slate-500" />
                                  <span>View</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedRecord(record)
                                }}
                                style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                className="h-7 px-2.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                              >
                                <Eye className="w-3 h-3 text-slate-500" />
                                <span>View</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Remarks Prompt Modal */}
      {bulkPromptAction && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {bulkPromptAction === 'SEND_BACK' ? 'Bulk Send Back Orders' : 'Bulk Reject Orders'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Enter the reason or instructions for the {selectedIds.size} selected fuel orders.
              </p>
            </div>

            <Textarea
              placeholder="Enter remarks (required)..."
              value={bulkRemarks}
              onChange={(e) => setBulkRemarks(e.target.value)}
              className="text-xs rounded-xl min-h-[80px]"
              autoFocus
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkPromptAction(null)
                  setBulkRemarks('')
                }}
                className="rounded-xl text-xs"
              >
                Cancel
              </Button>

              <Button
                size="sm"
                disabled={actionLoading || !bulkRemarks.trim()}
                onClick={() => handleBulkAction(bulkPromptAction, bulkRemarks.trim())}
                className={`rounded-xl text-xs font-bold text-white ${
                  bulkPromptAction === 'SEND_BACK'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                Confirm {bulkPromptAction === 'SEND_BACK' ? 'Send Back' : 'Reject'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-Over Detail & Action Drawer */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div
            className="absolute inset-0 bg-slate-800/30 backdrop-blur-2xs transition-opacity"
            onClick={() => {
              setSelectedRecord(null)
              setActionRemarks('')
            }}
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col h-full">
              {/* Drawer Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                    {selectedRecord.requestNumber}
                  </span>
                  <p className="text-xs text-slate-600 font-bold truncate max-w-[260px] mt-1">
                    {selectedRecord.vehRegNo}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {getLifecycleBadge(selectedRecord)}
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Drawer Content */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5">
                {/* Developer Simulation Box */}
                {isDeveloper && (
                  <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                        <Wrench className="w-3.5 h-3.5 text-teal-700" /> Developer Flow Testing Controls
                      </span>
                      <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">
                        Stage: {selectedRecord.currentStage.toUpperCase()}
                      </span>
                    </div>

                    <p className="text-[11px] text-teal-800">
                      Simulate moving this record through each stage of the approval pipeline (Submit → CEO → EA → MD):
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {selectedRecord.status !== 'approved' && (
                        <Button
                          size="sm"
                          disabled={actionLoading}
                          onClick={() => handleStageAction(selectedRecord.id, 'APPROVE')}
                          className="h-7 text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white rounded-lg px-2.5 cursor-pointer"
                        >
                          {getStageActionLabel(selectedRecord.currentStage)}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionLoading}
                        onClick={() => handleStageAction(selectedRecord.id, 'RESET')}
                        className="h-7 text-xs font-semibold border-teal-300 text-teal-800 hover:bg-teal-100 rounded-lg px-2.5 cursor-pointer flex items-center gap-1"
                        title="Reset to CEO pending"
                      >
                        <Undo2 className="w-3 h-3" />
                        Reset to CEO
                      </Button>
                    </div>
                  </div>
                )}

                {/* Approval Progress Tracker (Submit → CEO) */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-3">
                    Approval Track (Submit → CEO Approval)
                  </span>

                  <div className="space-y-3">
                    {/* Step 1: Submission */}
                    <div className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-teal-700 text-white flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0">
                        ✓
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>Submitted</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            {istDate(selectedRecord.createdAt)}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          By {selectedRecord.submittedByName}
                        </p>
                      </div>
                    </div>

                    {/* Step 2: CEO */}
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0 ${
                        selectedRecord.status === 'approved' || selectedRecord.ceoApprovedAt || selectedRecord.edApprovedAt
                          ? 'bg-teal-700 text-white'
                          : selectedRecord.status === 'ceo_pending' || selectedRecord.status === 'ed_pending'
                          ? 'border-2 border-blue-700 text-blue-800 font-bold'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {selectedRecord.status === 'approved' || selectedRecord.ceoApprovedAt || selectedRecord.edApprovedAt ? '✓' : '2'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>CEO Approval (Confirmed)</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            {selectedRecord.ceoApprovedAt
                              ? istDate(selectedRecord.ceoApprovedAt)
                              : selectedRecord.edApprovedAt
                              ? istDate(selectedRecord.edApprovedAt)
                              : selectedRecord.status === 'approved'
                              ? istDate(selectedRecord.updatedAt)
                              : 'Pending'}
                          </span>
                        </div>
                        {(selectedRecord.ceoApprovedByName || selectedRecord.edApprovedByName) && (
                          <p className="text-[11px] text-slate-500">
                            By {selectedRecord.ceoApprovedByName || selectedRecord.edApprovedByName}
                          </p>
                        )}
                        {(selectedRecord.ceoRemarks || selectedRecord.edRemarks) && (
                          <p className="text-[11px] text-slate-600 italic mt-0.5">
                            &ldquo;{selectedRecord.ceoRemarks || selectedRecord.edRemarks}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sent Back Banner */}
                {selectedRecord.status === 'sent_back' && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs">
                    <p className="font-bold text-amber-900">
                      Request Sent Back
                    </p>
                    <p className="text-amber-700 mt-0.5">
                      Reason: {selectedRecord.sendBackReason || 'Please review and update the details.'}
                    </p>
                    {(selectedRecord.submittedById === currentUser.id || isDeveloper) && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditRecord(selectedRecord)
                          setFormDialogOpen(true)
                          setSelectedRecord(null)
                        }}
                        className="rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white mt-2 w-full h-8 cursor-pointer"
                      >
                        Edit &amp; Re-Submit Order
                      </Button>
                    )}
                  </div>
                )}

                {/* Requisition Spec Rows */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Order Specifications
                  </span>

                  <div className="divide-y divide-slate-100 text-xs">
                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">Requested</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-900">
                          {recordLitersLabel(selectedRecord.fuelFilledLtrs)}
                        </span>
                        {getFuelTypeTag(selectedRecord.fuelType)}
                      </div>
                    </div>
                    {(() => {
                      // Approved and actual are separate facts (migration 0071); a missing one says so.
                      const q = getFuelQuantities(selectedRecord)
                      return (
                        <>
                          <div className="py-2 flex justify-between items-center">
                            <span className="text-slate-500">Approved</span>
                            <span className={q.approved !== null ? 'font-bold text-slate-900' : 'text-slate-400'}>
                              {q.approved !== null ? `${q.approved} Ltrs` : 'Not approved yet'}
                            </span>
                          </div>
                          <div className="py-2 flex justify-between items-center">
                            <span className="text-slate-500">Actual</span>
                            <span className={q.actual !== null ? 'font-bold text-slate-900' : 'text-slate-400'}>
                              {q.actual !== null
                                ? `${q.actual} Ltrs${q.approved !== null && Math.abs(q.actual - q.approved) >= 0.01 ? ` (${q.actual > q.approved ? '+' : '−'}${Math.abs(q.actual - q.approved).toFixed(2)} vs approved)` : ''}`
                                : 'Recorded when finalised'}
                            </span>
                          </div>
                          {selectedRecord.department && (
                            <div className="py-2 flex justify-between items-center">
                              <span className="text-slate-500">Department</span>
                              <span className="font-semibold text-slate-900">{selectedRecord.department}</span>
                            </div>
                          )}
                        </>
                      )
                    })()}

                    {selectedRecord.totalCost !== undefined && selectedRecord.totalCost !== null && (
                      <div className="py-2 flex justify-between items-center">
                        <span className="text-slate-500">Fuel Cost</span>
                        <span className="font-bold text-slate-900">
                          ₹{Number(selectedRecord.totalCost).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">Location</span>
                      {getLocationBadge(selectedRecord.location)}
                    </div>

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">Purpose</span>
                      {getPurposeBadge(selectedRecord.fuelRequiredFor)}
                    </div>

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">VIN / Chassis</span>
                      <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {selectedRecord.vinNo}
                      </span>
                    </div>

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">KM Reading</span>
                      <span className="font-semibold text-slate-800">
                        {selectedRecord.currentKmReading ? `${selectedRecord.currentKmReading} km` : '—'}
                      </span>
                    </div>

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">Filled Date</span>
                      <span className="font-semibold text-slate-800">
                        {istDate(selectedRecord.fuelFilledDate)}
                      </span>
                    </div>

                    <div className="py-2 flex justify-between items-center">
                      <span className="text-slate-500">Last Filled Date</span>
                      <span className="font-semibold text-slate-800">
                        {istDate(selectedRecord.lastFuelFilledDate)}
                      </span>
                    </div>

                    {selectedRecord.remarks && (
                      <div className="py-2">
                        <span className="text-slate-500 block mb-0.5">Submitter Notes</span>
                        <p className="text-slate-700 italic">
                          &ldquo;{selectedRecord.remarks}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Fuel Slip Document(s) */}
                {(() => {
                  const slipUrls = parseFuelSlipUrls(selectedRecord.fuelSlipUrl)
                  if (slipUrls.length === 0) return null

                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Fuel Receipt Attachment{slipUrls.length > 1 ? `s (${slipUrls.length})` : ''}
                        </span>
                        {slipUrls.length === 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxImage({
                                title: `Fuel Receipt - VIN ${selectedRecord.vinNo || ''}`,
                                url: slipUrls[0],
                              })
                            }
                            className="text-xs font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                          >
                            <Maximize2 className="w-3.5 h-3.5 text-teal-700" />
                            <span>Preview Fullscreen</span>
                          </button>
                        )}
                      </div>

                      {slipUrls.length === 1 ? (
                        <div className="group relative rounded-2xl border border-slate-200 bg-white p-3 shadow-2xs hover:border-teal-300 transition-all">
                          {slipUrls[0].toLowerCase().includes('.pdf') ? (
                            <div className="py-8 text-center space-y-3">
                              <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-700 mx-auto flex items-center justify-center border border-teal-200 shadow-2xs">
                                <FileText className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800">PDF Receipt Document</p>
                                <p className="text-[11px] text-slate-400">Official fuel invoice attachment</p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setLightboxImage({
                                    title: `Fuel Receipt - VIN ${selectedRecord.vinNo || ''}`,
                                    url: slipUrls[0],
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-[#055B65] hover:brightness-110 rounded-xl shadow-2xs cursor-pointer transition-all"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Preview Document</span>
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxImage({
                                  title: `Fuel Receipt - VIN ${selectedRecord.vinNo || ''}`,
                                  url: slipUrls[0],
                                })
                              }
                              className="relative w-full rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center p-2 cursor-pointer group"
                            >
                              <img
                                src={slipUrls[0]}
                                alt="Fuel Receipt"
                                className="max-h-56 object-contain rounded-lg group-hover:scale-102 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-slate-950/0 group-hover:bg-slate-950/20 transition-colors flex items-center justify-center">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/85 text-white text-xs font-bold px-3 py-1.5 rounded-full backdrop-blur-xs flex items-center gap-1.5 shadow-md">
                                  <ZoomIn className="w-3.5 h-3.5" /> Click to Zoom
                                </span>
                              </div>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2.5">
                          {slipUrls.map((url, i) => {
                            const isPdf = url.toLowerCase().includes('.pdf')
                            return (
                              <div
                                key={`${url}-${i}`}
                                className="group relative rounded-xl border border-slate-200 bg-white p-2.5 shadow-2xs hover:border-teal-300 hover:shadow-xs transition-all flex flex-col justify-between"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-md bg-teal-50 text-teal-800 flex items-center justify-center font-bold text-[10px] border border-teal-200/80">
                                      #{i + 1}
                                    </div>
                                    <span className="text-xs font-bold text-slate-800">
                                      Slip {i + 1}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLightboxImage({
                                        title: `Fuel Slip #${i + 1} - VIN ${selectedRecord.vinNo || ''}`,
                                        url,
                                      })
                                    }
                                    className="h-6 px-2 text-[11px] font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-md border border-teal-200/80 transition-colors inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Maximize2 className="w-3 h-3" />
                                    <span>Preview</span>
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxImage({
                                      title: `Fuel Slip #${i + 1} - VIN ${selectedRecord.vinNo || ''}`,
                                      url,
                                    })
                                  }
                                  className="relative w-full h-28 bg-slate-50 rounded-lg border border-slate-100 overflow-hidden flex items-center justify-center cursor-pointer group-hover:border-slate-200 transition-colors"
                                >
                                  {isPdf ? (
                                    <div className="text-center py-2">
                                      <FileText className="w-7 h-7 text-teal-700 mx-auto mb-1" />
                                      <span className="text-[11px] text-slate-600 font-semibold">PDF Document</span>
                                    </div>
                                  ) : (
                                    <>
                                      <img
                                        src={url}
                                        alt={`Fuel Slip ${i + 1}`}
                                        className="w-full h-full object-contain p-1 group-hover:scale-105 transition-transform duration-200"
                                      />
                                      <div className="absolute inset-0 bg-slate-950/0 group-hover:bg-slate-950/20 transition-colors flex items-center justify-center">
                                        <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/85 text-white text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-xs flex items-center gap-1 shadow-xs">
                                          <ZoomIn className="w-3 h-3" /> Click to Zoom
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* Action Pad (Available to authorized approvers or Developer) */}
              {(canActOnRecord(selectedRecord) || isDeveloper) && selectedRecord.status !== 'approved' && selectedRecord.status !== 'rejected' && (
                <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Approval Action ({selectedRecord.currentStage.toUpperCase()} Stage)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="approve-litres" className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                      Litres to approve
                    </label>
                    <Input
                      id="approve-litres"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={String(Number(selectedRecord.fuelFilledLtrs))}
                      value={approveLitres}
                      onChange={(e) => setApproveLitres(e.target.value)}
                      className="h-8 text-xs rounded-lg bg-white border-slate-200 font-bold"
                    />
                    <span className="text-[11px] text-slate-500 whitespace-nowrap">
                      {approveLitres.trim() ? `of ${Number(selectedRecord.fuelFilledLtrs)} requested` : 'blank = as requested'}
                    </span>
                  </div>

                  <Textarea
                    placeholder="Enter approval remark or reason..."
                    value={actionRemarks}
                    onChange={(e) => setActionRemarks(e.target.value)}
                    className="text-xs rounded-xl min-h-[50px] bg-white border-slate-200"
                  />

                  <div className="grid grid-cols-4 gap-2">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(
                        selectedRecord.id,
                        'APPROVE',
                        undefined,
                        approveLitres.trim() ? Number(approveLitres) : undefined,
                      )}
                      style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                      className="rounded-xl text-xs font-semibold h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Approve</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'SEND_BACK')}
                      style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                      className="rounded-xl text-xs font-semibold h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>Send Back</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'REJECT')}
                      style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                      className="rounded-xl text-xs font-semibold h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'HOLD')}
                      style={{ backgroundColor: '#475569', color: '#ffffff' }}
                      className="rounded-xl text-xs font-semibold h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Hold</span>
                    </button>
                  </div>
                </div>
              )}
              {/* Finalize Action Box for Approved Requests */}
              {selectedRecord.status === 'approved' && (() => {
                const fin = getFuelFinalization(selectedRecord)
                const cost = selectedRecord.totalCost
                  ? `₹${Number(selectedRecord.totalCost).toLocaleString('en-IN')}`
                  : null
                return (
                  <div className="p-4 border-t border-slate-200 bg-emerald-50/50 space-y-2.5">
                    <div>
                      <span className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-teal-700" />
                        {fin.finalized ? 'Order Finalised' : 'Order Approved by CEO'}
                      </span>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {fin.finalized
                          ? [
                              cost ? `Fuel cost ${cost} recorded` : 'Closed without a cost figure',
                              fin.byName ? `by ${fin.byName}` : null,
                              fin.at ? `on ${istDate(fin.at)}${istTime(fin.at) ? ' ' + istTime(fin.at) : ''}` : null,
                            ].filter(Boolean).join(' ') + '.'
                          : 'Enter final fuel bill amount and upload receipts / fuel slips.'}
                      </p>
                    </div>
                    {/*
                      * Finalised orders offer EDIT, not Finalise again. The button that used to sit here
                      * kept inviting the same action it had just reported complete.
                      */}
                    <Button
                      onClick={() => {
                        setFinalizeRecord(selectedRecord)
                      }}
                      style={
                        fin.finalized
                          ? { backgroundColor: '#ffffff', color: '#334155', borderColor: '#e2e8f0' }
                          : { backgroundColor: '#055B65', color: '#ffffff' }
                      }
                      className={
                        fin.finalized
                          ? 'w-full rounded-xl text-xs font-bold h-9 shadow-sm border hover:bg-slate-50 cursor-pointer flex items-center justify-center gap-2'
                          : 'w-full rounded-xl text-xs font-bold h-9 shadow-sm hover:brightness-110 cursor-pointer flex items-center justify-center gap-2 border-none'
                      }
                    >
                      {fin.finalized ? <PencilLine className="w-4 h-4 text-slate-500" /> : <CheckCircle2 className="w-4 h-4" />}
                      <span>{fin.finalized ? 'Edit Finalised Details' : 'Finalise Fuel Order'}</span>
                    </Button>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Fuel Form Dialog */}
      <FuelFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        initialData={editRecord}
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['fuel-approvals'] })
          await refetch()
        }}
      />

      {/* Fuel Finalize Dialog */}
      <FuelFinalizeDialog
        open={Boolean(finalizeRecord)}
        onOpenChange={(open) => {
          if (!open) setFinalizeRecord(null)
        }}
        record={finalizeRecord}
        onSuccess={async () => {
          await queryClient.invalidateQueries({ queryKey: ['fuel-approvals'] })
          await refetch()
        }}
      />

      {/* Fuel Receipt Lightbox Modal */}
      <Dialog open={Boolean(lightboxImage)} onOpenChange={(o) => !o && setLightboxImage(null)}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-slate-950 border-slate-800 text-white rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/90">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-400" />
              <DialogTitle className="text-xs font-bold text-slate-200">
                {lightboxImage?.title || 'Fuel Receipt Attachment'}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              {lightboxImage?.url && (
                <a
                  href={lightboxImage.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors border border-slate-700"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open in Tab</span>
                </a>
              )}
            </div>
          </div>
          <div className="p-4 flex items-center justify-center min-h-[320px] max-h-[78vh] overflow-auto bg-slate-950">
            {lightboxImage?.url?.toLowerCase().includes('.pdf') ? (
              <iframe
                src={lightboxImage.url}
                title="PDF Receipt"
                className="w-full h-[70vh] rounded-lg border border-slate-800 bg-white"
              />
            ) : lightboxImage?.url ? (
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title || 'Fuel Receipt'}
                className="max-h-[72vh] max-w-full object-contain rounded-lg shadow-md select-none"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )

  if (embedded) {
    return mainContent
  }

  return (
    <MainLayout
      title="Fuel Approvals"
      subtitle="Requisition, slip verification and workflow (Submit → CEO Approval)"
    >
      {mainContent}
    </MainLayout>
  )
}

function recordLitersLabel(ltrs: number | string | null | undefined): string {
  if (ltrs === null || ltrs === undefined || ltrs === '') return '0 Ltrs'
  return `${ltrs} Ltrs`
}
