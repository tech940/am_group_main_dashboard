'use client'

import React, { useState, useMemo } from 'react'
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
  ExternalLink,
  ChevronRight,
  X,
  FileText,
  Loader2,
  Check,
  Fuel,
  Wrench,
  Undo2,
  AlertTriangle,
  Layers,
  Calendar,
  Eye,
} from 'lucide-react'
import { FuelFormDialog } from './fuel-form-dialog'
import { FUEL_LOCATIONS, FUEL_REQUIRED_FOR_OPTIONS, STATUS_LABELS } from '@/lib/fuel-approvals/constants'
import type { FuelApprovalRecord, FuelApprovalStatus } from '@/lib/fuel-approvals/types'
import { INDIA_TIME_ZONE } from '@/lib/date-time'

const IST = INDIA_TIME_ZONE

function istDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
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
}

export function FuelApprovalsClient({ currentUser }: FuelApprovalsClientProps) {
  const queryClient = useQueryClient()
  const isDeveloper = currentUser.role?.toLowerCase() === 'developer' || currentUser.role?.toLowerCase() === 'admin'

  const [currentTab, setCurrentTab] = useState<'pending' | 'all' | 'approved' | 'held' | 'sent_back' | 'rejected'>('pending')
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL')
  const [selectedPurpose, setSelectedPurpose] = useState<string>('ALL')
  const [selectedFuelType, setSelectedFuelType] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRecord, setSelectedRecord] = useState<FuelApprovalRecord | null>(null)
  const [formDialogOpen, setFormDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<FuelApprovalRecord | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [inlineActionId, setInlineActionId] = useState<string | null>(null)

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
          edPending: number
          hrPending: number
          mdPending: number
          all: number
          approved: number
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
    edPending: 0,
    hrPending: 0,
    mdPending: 0,
    all: 0,
    approved: 0,
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
    customRemarks?: string
  ) => {
    const finalRemarks = customRemarks !== undefined ? customRemarks : actionRemarks.trim()

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
      return handleStageAction(recordId, action, promptValue.trim())
    }

    setActionLoading(true)
    setInlineActionId(recordId)
    try {
      const res = await fetch(`/api/fuel-approvals/${recordId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, remarks: finalRemarks }),
      })

      const result = await res.json()
      if (!res.ok) {
        throw new Error(result.error || 'Failed to update approval')
      }

      toast({
        title: 'Action completed',
        description: action === 'RESET' ? 'Record reset to ED pending for testing.' : `Request marked as ${action.toLowerCase()} successfully.`,
        variant: 'success',
      })

      setActionRemarks('')
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
    const role = currentUser.role?.trim().toLowerCase() || ''
    if (role === 'developer' || role === 'admin') return true
    const stage = record.currentStage
    const status = record.status

    if (stage === 'ed' && (status === 'ed_pending' || status === 'ed_on_hold')) {
      return role === 'ed'
    }
    if (stage === 'hr' && (status === 'hr_pending' || status === 'hr_on_hold')) {
      return role === 'hr'
    }
    if (stage === 'md' && (status === 'md_pending' || status === 'md_on_hold')) {
      return role === 'md' || role === 'ceo'
    }
    return false
  }

  const getStageActionLabel = (stage: string) => {
    if (stage === 'ed') return 'Approve (ED)'
    if (stage === 'hr') return 'Approve (HR)'
    if (stage === 'md') return 'Approve (MD)'
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
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-500 text-white shadow-2xs">
          PETROL
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-blue-600 text-white shadow-2xs">
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
      case 'ed_on_hold':
      case 'hr_on_hold':
      case 'md_on_hold':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <PauseCircle className="w-3.5 h-3.5 mr-1 text-amber-600" /> On Hold
          </span>
        )
      case 'ed_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-blue-600" /> ED Review
          </span>
        )
      case 'hr_pending':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <Clock className="w-3.5 h-3.5 mr-1 text-purple-600" /> HR Review
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

  return (
    <MainLayout
      title="Fuel Approvals"
      subtitle="Requisition, slip verification and multi-stage workflow (ED → HR → MD)"
    >
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
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-colors">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Pending My Action
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-800 tabular-nums">
                {counts.pending}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block font-medium">Awaiting your approval</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:border-emerald-200 transition-colors">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Approved Fuel
            </span>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-2xl font-black text-emerald-700 tabular-nums">
                {counts.totalLitersApproved}
              </span>
              <span className="text-xs font-bold text-emerald-600">Ltrs</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block font-medium">Total dispensed &amp; authorized</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-colors">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Completed Orders
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-800 tabular-nums">
                {counts.approved}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block font-medium">MD final approved</span>
          </div>

          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs hover:border-slate-300 transition-colors">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              In Pipeline
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-800 tabular-nums">
                {counts.all - counts.approved - counts.rejected}
              </span>
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block font-medium">Under active review</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-slate-200">
          <div className="flex items-center gap-6 text-xs sm:text-sm font-semibold overflow-x-auto whitespace-nowrap scrollbar-none pb-2">
            <button
              onClick={() => {
                setCurrentTab('pending')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'pending'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Pending My Approval</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                counts.pending > 0
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {counts.pending}
              </span>
              {currentTab === 'pending' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab('all')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'all'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>All Requisitions</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                {counts.all}
              </span>
              {currentTab === 'all' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab('approved')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'approved'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Approved</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                {counts.approved}
              </span>
              {currentTab === 'approved' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab('held')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'held'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>On Hold</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                {counts.held}
              </span>
              {currentTab === 'held' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab('sent_back')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'sent_back'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Sent Back</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                counts.sentBack > 0
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}>
                {counts.sentBack}
              </span>
              {currentTab === 'sent_back' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab('rejected')
                setSelectedIds(new Set())
              }}
              className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
                currentTab === 'rejected'
                  ? 'text-teal-800 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <span>Rejected</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">
                {counts.rejected}
              </span>
              {currentTab === 'rejected' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-teal-700 rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex flex-col md:flex-row items-center gap-2.5">
            <div className="relative flex-1 w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
              <Input
                type="text"
                placeholder="Search by vehicle, VIN, submitter or request #..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs rounded-xl h-9 border-slate-200"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="ALL">All Dealerships</option>
                {FUEL_LOCATIONS.map((loc) => (
                  <option key={loc.value} value={loc.value}>
                    {loc.label}
                  </option>
                ))}
              </select>

              <select
                value={selectedPurpose}
                onChange={(e) => setSelectedPurpose(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="ALL">All Purposes</option>
                {FUEL_REQUIRED_FOR_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>

              <select
                value={selectedFuelType}
                onChange={(e) => setSelectedFuelType(e.target.value)}
                className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <option value="ALL">All Fuel Types</option>
                <option value="PETROL">Petrol</option>
                <option value="DIESEL">Diesel</option>
              </select>

              {(selectedLocation !== 'ALL' || selectedPurpose !== 'ALL' || selectedFuelType !== 'ALL' || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedLocation('ALL')
                    setSelectedPurpose('ALL')
                    setSelectedFuelType('ALL')
                    setSearchQuery('')
                  }}
                  className="h-9 px-2 text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Floating Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="p-3 bg-teal-50 border-2 border-teal-400 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-teal-700 text-white font-bold text-xs flex items-center justify-center">
                {selectedIds.size}
              </span>
              <span className="text-xs font-bold text-teal-900">
                Orders Selected
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleBulkAction('APPROVE')}
                style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-black text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
              >
                {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 stroke-[2.5]" />}
                <span>Approve</span>
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setBulkPromptAction('SEND_BACK')}
                style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-black text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
                <span>Send Back</span>
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setBulkPromptAction('REJECT')}
                style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-black text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
              >
                <X className="h-3.5 w-3.5" />
                <span>Reject</span>
              </button>

              <button
                type="button"
                disabled={actionLoading}
                onClick={() => handleBulkAction('HOLD')}
                style={{ backgroundColor: '#475569', color: '#ffffff' }}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3.5 text-xs font-black text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
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
                  className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-black text-white transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer shadow-sm border-none"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>Reset</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="h-8 px-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 cursor-pointer border-none bg-transparent"
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
              {currentTab === 'pending' ? 'No orders awaiting your approval' : 'No fuel records found'}
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              {currentTab === 'pending'
                ? 'When dealership staff submit fuel requests requiring your review, they will show up here.'
                : 'No requests match your selected filters. Try changing or resetting the filters.'}
            </p>
          </div>
        ) : (
          <div>
            {/* Mobile View: High-contrast, tactile cards */}
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
                      {getStatusBadge(record.status)}
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
                        <span className="font-black text-slate-900">
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
                            className="h-8 px-2.5 rounded-xl text-xs font-black flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
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
                            className="h-8 px-2.5 rounded-xl text-xs font-black flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
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
                            className="h-8 px-2.5 rounded-xl text-xs font-black flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
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
                            className="h-8 px-2.5 rounded-xl text-xs font-black flex items-center gap-1 text-white shadow-2xs transition-all hover:brightness-110 cursor-pointer border-none"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Hold</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (record.fuelSlipUrl) window.open(record.fuelSlipUrl, '_blank')
                          else setSelectedRecord(record)
                        }}
                        style={{ backgroundColor: '#ffffff', color: '#334155' }}
                        className="h-8 px-2.5 rounded-xl text-xs font-bold border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 cursor-pointer ml-auto flex items-center gap-1 shadow-xs"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                        <span>Slip</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop View: Colorful, high-craft table with all action buttons visible */}
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
                              <span className="font-black text-slate-900 text-xs">
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
                            {getStatusBadge(record.status)}
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
                                    className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
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
                                    className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
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
                                    className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
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
                                    className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all hover:brightness-110 disabled:opacity-40 cursor-pointer border-none"
                                    title="Place order on hold"
                                  >
                                    <Clock className="w-3 h-3" />
                                    <span>Hold</span>
                                  </button>

                                  {/* 5. SLIP BUTTON */}
                                  <button
                                    type="button"
                                    title="View Fuel Slip"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (record.fuelSlipUrl) window.open(record.fuelSlipUrl, '_blank')
                                      else setSelectedRecord(record)
                                    }}
                                    style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                    className="h-7 px-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
                                  >
                                    <Paperclip className="w-3 h-3 text-slate-500" />
                                    <span>Slip</span>
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedRecord(record)
                                  }}
                                  style={{ backgroundColor: '#ffffff', color: '#334155' }}
                                  className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all shadow-xs cursor-pointer"
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
      </div>

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
                  {getStatusBadge(selectedRecord.status)}
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
                      Simulate moving this record through each stage of the approval pipeline:
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
                        title="Reset to ED pending"
                      >
                        <Undo2 className="w-3 h-3" />
                        Reset to ED
                      </Button>
                    </div>
                  </div>
                )}

                {/* Approval Progress Tracker */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-3">
                    Approval Track (ED → HR → MD)
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

                    {/* Step 2: ED */}
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0 ${
                        selectedRecord.edApprovedAt
                          ? 'bg-teal-700 text-white'
                          : selectedRecord.status === 'ed_pending'
                          ? 'border-2 border-teal-700 text-teal-800 font-bold'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {selectedRecord.edApprovedAt ? '✓' : '2'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>ED Approval</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            {selectedRecord.edApprovedAt ? istDate(selectedRecord.edApprovedAt) : 'Pending'}
                          </span>
                        </div>
                        {selectedRecord.edApprovedByName && (
                          <p className="text-[11px] text-slate-500">
                            By {selectedRecord.edApprovedByName}
                          </p>
                        )}
                        {selectedRecord.edRemarks && (
                          <p className="text-[11px] text-slate-600 italic mt-0.5">
                            "{selectedRecord.edRemarks}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step 3: HR */}
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0 ${
                        selectedRecord.hrApprovedAt
                          ? 'bg-teal-700 text-white'
                          : selectedRecord.status === 'hr_pending'
                          ? 'border-2 border-purple-700 text-purple-800 font-bold'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {selectedRecord.hrApprovedAt ? '✓' : '3'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>HR Approval</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            {selectedRecord.hrApprovedAt ? istDate(selectedRecord.hrApprovedAt) : 'Pending'}
                          </span>
                        </div>
                        {selectedRecord.hrApprovedByName && (
                          <p className="text-[11px] text-slate-500">
                            By {selectedRecord.hrApprovedByName}
                          </p>
                        )}
                        {selectedRecord.hrRemarks && (
                          <p className="text-[11px] text-slate-600 italic mt-0.5">
                            "{selectedRecord.hrRemarks}"
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step 4: MD */}
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0 ${
                        selectedRecord.mdApprovedAt
                          ? 'bg-teal-700 text-white'
                          : selectedRecord.status === 'md_pending'
                          ? 'border-2 border-indigo-700 text-indigo-800 font-bold'
                          : 'bg-slate-200 text-slate-400'
                      }`}>
                        {selectedRecord.mdApprovedAt ? '✓' : '4'}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                          <span>MD Final Approval</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            {selectedRecord.mdApprovedAt ? istDate(selectedRecord.mdApprovedAt) : 'Pending'}
                          </span>
                        </div>
                        {selectedRecord.mdApprovedByName && (
                          <p className="text-[11px] text-slate-500">
                            By {selectedRecord.mdApprovedByName}
                          </p>
                        )}
                        {selectedRecord.mdRemarks && (
                          <p className="text-[11px] text-slate-600 italic mt-0.5">
                            "{selectedRecord.mdRemarks}"
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
                    {selectedRecord.submittedById === currentUser.id && (
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
                      <span className="text-slate-500">Quantity</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-slate-900">
                          {recordLitersLabel(selectedRecord.fuelFilledLtrs)}
                        </span>
                        {getFuelTypeTag(selectedRecord.fuelType)}
                      </div>
                    </div>

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
                          "{selectedRecord.remarks}"
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Fuel Slip Document */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Fuel Receipt Attachment
                    </span>
                    <a
                      href={selectedRecord.fuelSlipUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-lg hover:bg-teal-100 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-teal-700" />
                      <span>View Original</span>
                    </a>
                  </div>

                  <div className="rounded-xl border border-slate-200 p-2 bg-slate-50 flex items-center justify-center">
                    {selectedRecord.fuelSlipUrl.toLowerCase().includes('.pdf') ? (
                      <div className="py-6 text-center space-y-2">
                        <FileText className="w-8 h-8 text-teal-700 mx-auto" />
                        <p className="text-xs font-bold text-slate-700">
                          PDF Receipt Document
                        </p>
                      </div>
                    ) : (
                      <img
                        src={selectedRecord.fuelSlipUrl}
                        alt="Fuel Receipt"
                        className="max-h-56 object-contain rounded-lg"
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Action Pad (Available to authorized approvers or Developer) */}
              {(canActOnRecord(selectedRecord) || isDeveloper) && selectedRecord.status !== 'approved' && selectedRecord.status !== 'rejected' && (
                <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Approval Action ({selectedRecord.currentStage.toUpperCase()} Stage)
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
                      onClick={() => handleStageAction(selectedRecord.id, 'APPROVE')}
                      style={{ backgroundColor: '#055B65', color: '#ffffff' }}
                      className="rounded-xl text-xs font-black h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Approve</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'SEND_BACK')}
                      style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                      className="rounded-xl text-xs font-black h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <CornerUpLeft className="w-3.5 h-3.5" />
                      <span>Send Back</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'REJECT')}
                      style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                      className="rounded-xl text-xs font-black h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStageAction(selectedRecord.id, 'HOLD')}
                      style={{ backgroundColor: '#475569', color: '#ffffff' }}
                      className="rounded-xl text-xs font-black h-9 px-2 cursor-pointer shadow-sm flex items-center justify-center gap-1 border-none hover:brightness-110 disabled:opacity-40"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Hold</span>
                    </button>
                  </div>
                </div>
              )}
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
    </MainLayout>
  )
}

function recordLitersLabel(ltrs: number | string | null | undefined): string {
  if (ltrs === null || ltrs === undefined || ltrs === '') return '0 Ltrs'
  return `${ltrs} Ltrs`
}
