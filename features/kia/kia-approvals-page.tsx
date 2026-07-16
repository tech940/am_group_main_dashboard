'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Search, 
  FileText, 
  RefreshCw, 
  ShieldCheck, 
  ChevronDown, 
  ChevronUp, 
  FileSpreadsheet, 
  IndianRupee, 
  ExternalLink,
  MessageSquare,
  Info,
  Paperclip,
  Clock,
  User2,
  Building2,
  CreditCard,
  Store,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const LOCATION_OPTIONS = ['JAMMU', 'UDHAMPUR', 'BANIHAL']

interface ApprovalHistoryEntry {
  id: string
  role: string
  roleKey: string
  user: string
  action: 'APPROVED' | 'NOT APPROVED' | 'HELD'
  remarks: string
  timestamp: string
}

interface ApprovalRequest {
  id: string
  email: string
  name: string
  employeeId: string | null
  location: string | null
  dealerCode: string | null
  dealerName: string | null
  department: string | null
  specifyOtherDepartment: string | null
  approvalType: string | null
  vendorName: string | null
  specifyOtherApprovalType: string | null
  previousAdvance: string | null
  amount: string
  typeOfPayment: string | null
  remarks: string | null
  vpApproval: string | null
  accountApproval: string | null
  hrApproval: string | null
  eaApproval: string | null
  managementApproval: string | null
  managementRemarks: string | null
  uploadBillUrl1: string | null
  uploadBillUrl2: string | null
  uploadDocUrl: string | null
  emailSendStatus: string | null
  history: ApprovalHistoryEntry[]
  createdAt: string
  updatedAt: string
}

interface CurrentUser {
  id: string
  role: string
  fullName: string
  email: string
}

export function KiaApprovalsClient({ currentUser }: { currentUser: CurrentUser }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedLocation, setSelectedLocation] = useState('All')
  const [selectedStage, setSelectedStage] = useState('All')
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const dateRangeLabel = useMemo(() => {
    if (!startDate) return 'Filter by Date'
    const startStr = startDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    if (!endDate) return `${startStr}`
    const endStr = endDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${startStr} - ${endStr}`
  }, [startDate, endDate])

  const daysInMonth = useMemo(() => {
    const year = currentMonth.getFullYear()
    const month = currentMonth.getMonth()
    const firstDayIndex = new Date(year, month, 1).getDay()
    const startOffset = firstDayIndex === 0 ? 6 : firstDayIndex - 1

    const days = []
    const prevMonthDays = new Date(year, month, 0).getDate()
    for (let i = startOffset - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthDays - i),
        isCurrentMonth: false,
      })
    }

    const totalDays = new Date(year, month + 1, 0).getDate()
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      })
    }

    const remaining = 42 - days.length
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      })
    }

    return days
  }, [currentMonth])

  const [selectedDepartment, setSelectedDepartment] = useState('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  const [actionStage, setActionStage] = useState<'sales_manager' | 'accounts' | 'ea' | 'md' | null>(null)
  const [actionRow, setActionRow] = useState<ApprovalRequest | null>(null)

  const { data, isLoading, isFetching, refetch } = useQuery<{ rows: ApprovalRequest[] }>({
    queryKey: ['kia-approval-requests'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/approvals/list')
      if (!res.ok) throw new Error('Failed to load approvals list')
      return res.json()
    }
  })

  const uniqueDepartments = useMemo(() => {
    if (!data?.rows) return []
    const depts = new Set<string>()
    data.rows.forEach(r => {
      if (r.department) depts.add(r.department.trim().toUpperCase())
    })
    return Array.from(depts).sort()
  }, [data?.rows])

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, stage, remarks }: { id: string; action: 'APPROVE' | 'REJECT' | 'HOLD'; stage: string; remarks: string }) => {
      const res = await fetch(`/api/brands/kia/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stage, remarks })
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to complete approval action')
      return data
    },
    onSuccess: (data) => {
      toast({ title: 'Action recorded', description: data.message || 'Successfully updated the request status.', variant: 'success' })
      setActionRemarks('')
      setActionStage(null)
      setActionRow(null)
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
    },
    onError: (err) => {
      toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please check your role permissions.', variant: 'error' })
    }
  })

  const getPendingStageLabel = (req: ApprovalRequest) => {
    if (req.managementApproval === 'APPROVED') return 'Fully Approved'
    if (req.managementApproval === 'NOT APPROVED') return 'Rejected by MD'
    if (req.managementApproval === 'HELD') return 'Held by MD'
    if (req.eaApproval === 'NOT APPROVED') return 'Rejected by EA'
    if (req.eaApproval === 'HELD') return 'Held by EA'
    if (req.accountApproval === 'NOT APPROVED') return 'Rejected by Accounts'
    if (req.accountApproval === 'HELD') return 'Held by Accounts'
    if (req.vpApproval === 'NOT APPROVED') return 'Rejected by Sales Manager'
    if (req.vpApproval === 'HELD') return 'Held by Sales Manager'
    if (!req.vpApproval || req.vpApproval === '') return 'Pending Sales Manager'
    if (!req.accountApproval || req.accountApproval === '') return 'Pending Accounts'
    if (!req.eaApproval || req.eaApproval === '') return 'Pending EA'
    if (!req.managementApproval || req.managementApproval === '') return 'Pending MD'
    return 'Unknown'
  }

  const isUserAuthorizedForStage = (stage: string) => {
    if (['developer', 'admin'].includes(currentUser.role)) return true
    if (stage === 'sales_manager') return ['sales_manager', 'manager'].includes(currentUser.role)
    if (stage === 'accounts') return ['accounts', 'finance_head'].includes(currentUser.role)
    if (stage === 'ea') return ['ea'].includes(currentUser.role)
    if (stage === 'md') return ['md', 'ceo'].includes(currentUser.role)
    return false
  }

  const filteredRows = data?.rows.filter(row => {
    const matchesSearch =
      row.name.toLowerCase().includes(search.toLowerCase()) ||
      row.email.toLowerCase().includes(search.toLowerCase()) ||
      (row.vendorName && row.vendorName.toLowerCase().includes(search.toLowerCase())) ||
      (row.department && row.department.toLowerCase().includes(search.toLowerCase())) ||
      (row.approvalType && row.approvalType.toLowerCase().includes(search.toLowerCase())) ||
      row.amount.includes(search)
    const matchesLocation = selectedLocation === 'All' || row.location === selectedLocation
    
    const matchesDepartment = selectedDepartment === 'All' || 
      (row.department && row.department.trim().toUpperCase() === selectedDepartment.trim().toUpperCase())
    
    let matchesDate = true
    if (startDate) {
      const createdDate = new Date(row.createdAt)
      const rowDay = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate())
      const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
      
      if (endDate) {
        const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
        matchesDate = rowDay >= startDay && rowDay <= endDay
      } else {
        matchesDate = rowDay.getTime() === startDay.getTime()
      }
    }

    const pendingLabel = getPendingStageLabel(row)
    const matchesStage = selectedStage === 'All' ||
      (selectedStage === 'pending_sales_manager' && pendingLabel === 'Pending Sales Manager') ||
      (selectedStage === 'pending_accounts' && pendingLabel === 'Pending Accounts') ||
      (selectedStage === 'pending_ea' && pendingLabel === 'Pending EA') ||
      (selectedStage === 'pending_md' && pendingLabel === 'Pending MD') ||
      (selectedStage === 'completed' && pendingLabel === 'Fully Approved') ||
      (selectedStage === 'rejected' && pendingLabel.startsWith('Rejected'))
    return matchesSearch && matchesLocation && matchesDepartment && matchesDate && matchesStage
  }) || []

  const totalAmount = data?.rows.filter(r => r.managementApproval === 'APPROVED').reduce((sum, r) => sum + Number(r.amount), 0) || 0
  const pendingCount = data?.rows.filter(r => getPendingStageLabel(r).startsWith('Pending')).length || 0
  const rejectedCount = data?.rows.filter(r => getPendingStageLabel(r).startsWith('Rejected')).length || 0

  const getRoleRemarksStyles = (roleKey: string) => {
    switch (roleKey) {
      case 'md': return 'bg-violet-50 border-violet-200 text-violet-800'
      case 'ea': return 'bg-sky-50 border-sky-200 text-sky-800'
      case 'accounts': return 'bg-emerald-50 border-emerald-200 text-emerald-800'
      case 'sales_manager': return 'bg-amber-50 border-amber-200 text-amber-800'
      default: return 'bg-slate-50 border-slate-200 text-slate-700'
    }
  }

  const getRoleBadgeColor = (roleKey: string) => {
    switch (roleKey) {
      case 'md': return 'bg-violet-600 text-white'
      case 'ea': return 'bg-sky-600 text-white'
      case 'accounts': return 'bg-emerald-600 text-white'
      case 'sales_manager': return 'bg-amber-500 text-white'
      default: return 'bg-slate-700 text-white'
    }
  }

  const renderStepChip = (label: string, status: string | null) => {
    if (status === 'APPROVED') return (
      <div className="flex flex-col items-center justify-center py-1.5 px-1.5 sm:px-2.5 rounded-xl border bg-emerald-50 border-emerald-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-emerald-700">✓ OK</span>
      </div>
    )
    if (status === 'NOT APPROVED') return (
      <div className="flex flex-col items-center justify-center py-1.5 px-1.5 sm:px-2.5 rounded-xl border bg-rose-50 border-rose-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-rose-400 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-rose-700">✗ No</span>
      </div>
    )
    if (status === 'HELD') return (
      <div className="flex flex-col items-center justify-center py-1.5 px-1.5 sm:px-2.5 rounded-xl border bg-amber-50 border-amber-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-amber-500 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-amber-700">‖ Hold</span>
      </div>
    )
    return (
      <div className="flex flex-col items-center justify-center py-1.5 px-1.5 sm:px-2.5 rounded-xl border bg-slate-100 border-slate-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</span>
        <span className="text-[9px] font-semibold text-slate-400">—</span>
      </div>
    )
  }

  return (
    <MainLayout title="Payment Approvals" subtitle="Manage payment requests and multi-stage approval workflows">
      <div className="space-y-6">

        {/* KPI Strip */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Requests</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl sm:text-3xl font-black text-slate-900">{data?.rows.length || 0}</span>
              <span className="text-xs font-semibold text-slate-500">logged</span>
            </div>
          </div>
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-500">Pending Approvals</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl sm:text-3xl font-black text-amber-600">{pendingCount}</span>
              <span className="text-xs font-semibold text-slate-500">awaiting</span>
            </div>
          </div>
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500">Approved Volume</span>
            <div className="flex items-baseline gap-1 mt-2 text-emerald-700 flex-wrap">
              <IndianRupee className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
              <span className="text-2xl sm:text-3xl font-black truncate">{totalAmount.toLocaleString('en-IN')}</span>
            </div>
          </div>
          <div className="kia-surface p-4 sm:p-5 flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-500">Rejected</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl sm:text-3xl font-black text-rose-600">{rejectedCount}</span>
              <span className="text-xs font-semibold text-slate-500">flagged</span>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-4 flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, department, vendor, amount..."
              className="pl-11 h-10 w-full rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold"
            />
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              value={selectedLocation}
              onChange={e => setSelectedLocation(e.target.value)}
              className="h-10 px-4 w-full sm:w-[150px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Locations</option>
              {LOCATION_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select
              value={selectedDepartment}
              onChange={e => setSelectedDepartment(e.target.value)}
              className="h-10 px-4 w-full sm:w-[150px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Departments</option>
              {uniqueDepartments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {/* Custom Date Range Calendar Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setCalendarOpen(prev => !prev)}
                className={`h-10 px-4 w-full sm:w-auto rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer flex items-center justify-between gap-2 transition-all ${
                  startDate ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{dateRangeLabel}</span>
                </div>
                {startDate && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      setStartDate(null)
                      setEndDate(null)
                    }}
                    className="hover:bg-indigo-100 p-0.5 rounded-full"
                  >
                    <X className="w-3 h-3 text-indigo-500" />
                  </span>
                )}
              </button>

              {calendarOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 top-12 z-50 w-[320px] bg-white border border-slate-200 rounded-3xl shadow-[0_20px_50px_rgba(15,23,42,0.15)] p-4 space-y-4">
                  {/* Calendar Header */}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
                      }}
                      className="p-1.5 hover:bg-slate-100 rounded-xl"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-600" />
                    </button>
                    <span className="text-xs font-black text-slate-900 tracking-tight">
                      {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
                      }}
                      className="p-1.5 hover:bg-slate-100 rounded-xl"
                    >
                      <ChevronRight className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>

                  {/* Weekdays */}
                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <span>Mo</span>
                    <span>Tu</span>
                    <span>We</span>
                    <span>Th</span>
                    <span>Fr</span>
                    <span>Sa</span>
                    <span>Su</span>
                  </div>

                  {/* Days Grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {daysInMonth.map((day, idx) => {
                      const isSelectedStart = startDate && day.date.toDateString() === startDate.toDateString()
                      const isSelectedEnd = endDate && day.date.toDateString() === endDate.toDateString()
                      const isInRange = startDate && endDate && day.date > startDate && day.date < endDate

                      let cellClass = "h-8 w-8 text-xs flex items-center justify-center rounded-xl transition-all cursor-pointer "
                      if (isSelectedStart) {
                        cellClass += "bg-slate-950 text-white font-black"
                      } else if (isSelectedEnd) {
                        cellClass += "bg-slate-950 text-white font-black"
                      } else if (isInRange) {
                        cellClass += "bg-slate-100 text-slate-900 font-bold"
                      } else if (!day.isCurrentMonth) {
                        cellClass += "text-slate-300 hover:bg-slate-55"
                      } else {
                        cellClass += "text-slate-800 hover:bg-slate-100 font-semibold"
                      }

                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (!startDate || (startDate && endDate)) {
                              setStartDate(day.date)
                              setEndDate(null)
                            } else if (startDate && !endDate) {
                              if (day.date < startDate) {
                                setStartDate(day.date)
                              } else {
                                setEndDate(day.date)
                              }
                            }
                          }}
                          className={cellClass}
                        >
                          {day.date.getDate()}
                        </div>
                      )
                    })}
                  </div>

                  {/* Preset Shortcuts */}
                  <div className="flex flex-wrap gap-1.5 pt-3 border-t border-slate-100">
                    {[
                      { label: 'Today', getValue: () => { const d = new Date(); return [d, d] } },
                      { label: 'Yesterday', getValue: () => { const d = new Date(); d.setDate(d.getDate() - 1); return [d, d] } },
                      { label: 'Last 7 Days', getValue: () => { const d = new Date(); const s = new Date(); s.setDate(s.getDate() - 7); return [s, d] } },
                      { label: 'This Month', getValue: () => { const d = new Date(); const s = new Date(d.getFullYear(), d.getMonth(), 1); return [s, d] } },
                    ].map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          const [s, e] = p.getValue()
                          setStartDate(s)
                          setEndDate(e)
                          setCalendarOpen(false)
                        }}
                        className="text-[9px] font-black uppercase tracking-wider px-2.5 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setStartDate(null)
                        setEndDate(null)
                        setCalendarOpen(false)
                      }}
                      className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalendarOpen(false)}
                      className="text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 bg-slate-950 text-white rounded-xl hover:bg-slate-800"
                    >
                      Apply
                    </button>
                  </div>

                </div>
              )}
            </div>
            <select
              value={selectedStage}
              onChange={e => setSelectedStage(e.target.value)}
              className="h-10 px-4 w-full sm:w-[200px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Workflow States</option>
              <option value="pending_sales_manager">Pending Sales Manager</option>
              <option value="pending_accounts">Pending Accounts</option>
              <option value="pending_ea">Pending EA</option>
              <option value="pending_md">Pending MD</option>
              <option value="completed">Completed (Approved)</option>
              <option value="rejected">Rejected Cases</option>
            </select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading || isFetching} className="h-10 w-10 rounded-2xl border-slate-200 flex-shrink-0">
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <RefreshCw className="w-4 h-4 text-slate-500" />}
            </Button>
          </div>
        </div>

        {/* Requests List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-slate-900" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Requests Queue...</span>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center space-y-3 shadow-[0_10px_30px_rgba(15,23,42,0.01)]">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">No Requests Found</h3>
            <p className="text-xs text-slate-400 font-semibold max-w-sm mx-auto">There are no payment approval requests matching your active filter criteria.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRows.map(row => {
              const isExpanded = expandedId === row.id
              const pendingLabel = getPendingStageLabel(row)
              const isApproved = pendingLabel === 'Fully Approved'
              const isRejected = pendingLabel.startsWith('Rejected')
              const isMD = ['md', 'ceo'].includes(currentUser.role)

              // Stage-driven styles
              let accentBar = 'bg-slate-400'
              let cardBg = 'bg-slate-50/50'
              let cardBorder = 'border-slate-200 hover:border-slate-400'
              let cardShadow = 'shadow-[0_8px_24px_rgba(148,163,184,0.05)]'

              if (pendingLabel === 'Fully Approved') {
                accentBar = 'bg-emerald-500'
                cardBg = 'bg-emerald-50/45'
                cardBorder = 'border-emerald-200 hover:border-emerald-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(16,185,129,0.12)] hover:shadow-[0_24px_48px_rgba(16,185,129,0.2)]'
              } else if (pendingLabel.startsWith('Rejected')) {
                accentBar = 'bg-rose-500'
                cardBg = 'bg-rose-50/35'
                cardBorder = 'border-rose-200 hover:border-rose-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(239,68,68,0.12)] hover:shadow-[0_24px_48px_rgba(239,68,68,0.2)]'
              } else if (pendingLabel.startsWith('Held')) {
                accentBar = 'bg-amber-500'
                cardBg = 'bg-amber-50/35'
                cardBorder = 'border-amber-200 hover:border-amber-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(245,158,11,0.12)] hover:shadow-[0_24px_48px_rgba(245,158,11,0.2)]'
              } else if (pendingLabel === 'Pending Sales Manager') {
                accentBar = 'bg-amber-500'
                cardBg = 'bg-amber-50/25'
                cardBorder = 'border-amber-200 hover:border-amber-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(245,158,11,0.1)] hover:shadow-[0_24px_48px_rgba(245,158,11,0.18)]'
              } else if (pendingLabel === 'Pending Accounts') {
                accentBar = 'bg-teal-500'
                cardBg = 'bg-teal-50/25'
                cardBorder = 'border-teal-200 hover:border-teal-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(20,184,166,0.1)] hover:shadow-[0_24px_48px_rgba(20,184,166,0.18)]'
              } else if (pendingLabel === 'Pending EA') {
                accentBar = 'bg-sky-500'
                cardBg = 'bg-sky-50/25'
                cardBorder = 'border-sky-200 hover:border-sky-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(14,165,233,0.1)] hover:shadow-[0_24px_48px_rgba(14,165,233,0.18)]'
              } else if (pendingLabel === 'Pending MD') {
                accentBar = 'bg-violet-500'
                cardBg = 'bg-violet-50/25'
                cardBorder = 'border-violet-200 hover:border-violet-400'
                cardShadow = 'shadow-[0_12px_36px_rgba(139,92,246,0.1)] hover:shadow-[0_24px_48px_rgba(139,92,246,0.18)]'
              }

              return (
                <div
                  key={row.id}
                  className={`rounded-[2rem] border-2 transition-all duration-300 overflow-hidden bg-white ${cardBorder} ${cardShadow}`}
                >
                  {/* Colored left accent bar */}
                  <div className="flex">
                    <div className={`w-2 flex-shrink-0 rounded-l-[2rem] ${accentBar}`} />
                    <div className="flex-1 min-w-0 p-5 sm:p-7 space-y-5">

                      {/* ── Row 1: Badges + Name + Status ── */}
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className={`text-[9px] font-black tabular-nums px-2 py-0.5 rounded-full border ${
                              isApproved ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
                              : isRejected ? 'bg-rose-100 border-rose-200 text-rose-700'
                              : 'bg-amber-100 border-amber-200 text-amber-700'
                            }`}>#{(filteredRows.indexOf(row) + 1).toString().padStart(2, '0')}</span>
                            <Badge variant="outline" className="rounded-full bg-slate-950 text-white font-black text-[9px] uppercase tracking-wider py-0.5 px-2.5">{row.location}</Badge>
                            <Badge variant="outline" className="rounded-full bg-slate-100 border-slate-200 text-slate-700 font-extrabold text-[9px] uppercase tracking-wider py-0.5 px-2">{row.department}</Badge>
                            <Badge variant="outline" className="rounded-full bg-indigo-50 border-indigo-100 text-indigo-700 font-black text-[9px] uppercase tracking-wider py-0.5 px-2">{row.approvalType}</Badge>
                            <Badge variant="outline" className={`rounded-full font-black text-[9px] uppercase tracking-wider py-0.5 px-2.5 ${
                              pendingLabel === 'Fully Approved'
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : pendingLabel.startsWith('Rejected')
                                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                                  : 'bg-amber-50 border-amber-200 text-amber-700'
                            }`}>{pendingLabel}</Badge>
                          </div>
                          <h3 className="text-xl font-black tracking-tight text-slate-950">{row.name}</h3>
                          <p className="text-sm text-slate-500 font-semibold">{row.email}</p>
                        </div>

                        {/* Amount + Stepper chips */}
                        <div className="flex flex-col items-start sm:items-end gap-2 flex-shrink-0">
                          <div className="text-right">
                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Requested</span>
                            <span className="text-2xl font-black text-slate-950">₹{Number(row.amount).toLocaleString('en-IN')}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-1.5">
                            {renderStepChip('SM', row.vpApproval)}
                            {renderStepChip('ACC', row.accountApproval)}
                            {renderStepChip('EA', row.eaApproval)}
                            {renderStepChip('MD', row.managementApproval)}
                          </div>
                        </div>
                      </div>

                      {/* ── Row 2: Request Details grid (always visible) ── */}
                      <div className="border-t border-slate-200 pt-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Request Details</p>
                        <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4">
                          {[
                            { icon: <Building2 className="w-3.5 h-3.5" />, label: 'Dealer Name', value: row.dealerName },
                            { icon: <Store className="w-3.5 h-3.5" />, label: 'Dealer Code', value: row.dealerCode, mono: true },
                            { icon: <CreditCard className="w-3.5 h-3.5" />, label: 'Payment Type', value: row.typeOfPayment },
                            { icon: <Clock className="w-3.5 h-3.5" />, label: 'Submitted', value: new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) },
                            ...(row.vendorName ? [{ icon: <User2 className="w-3.5 h-3.5" />, label: 'Vendor', value: row.vendorName }] : []),
                            ...(row.previousAdvance ? [{ icon: <IndianRupee className="w-3.5 h-3.5" />, label: 'Prev. Advance', value: row.previousAdvance }] : []),
                          ].map((item, i) => (
                            <div key={i} className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-slate-500">{item.icon}<span className="text-[10px] font-bold uppercase tracking-wider">{item.label}</span></div>
                              <span className={`text-sm font-bold text-slate-900 block truncate ${item.mono ? 'font-mono' : ''}`}>{item.value || '—'}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Row 3: Remarks note (if any) ── */}
                      {row.remarks && (
                        <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200">
                          <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-1.5">Submitter's Note</span>
                          <p className="text-sm font-medium text-amber-900 leading-relaxed">{row.remarks}</p>
                        </div>
                      )}

                      {/* ── Row 4: Attachments (if any) ── */}
                      {(row.uploadBillUrl1 || row.uploadBillUrl2 || row.uploadDocUrl) && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 w-full mb-1">Attachments</span>
                          {row.uploadBillUrl1 && (
                            <a href={row.uploadBillUrl1} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                              <FileText className="w-4 h-4 text-slate-500" /> Bill 1 <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            </a>
                          )}
                          {row.uploadBillUrl2 && (
                            <a href={row.uploadBillUrl2} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                              <FileText className="w-4 h-4 text-slate-500" /> Bill 2 <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            </a>
                          )}
                          {row.uploadDocUrl && (
                            <a href={row.uploadDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                              <ShieldCheck className="w-4 h-4 text-slate-500" /> Support Doc <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            </a>
                          )}
                        </div>
                      )}

                      {/* ── Row 5: Action Center (always visible if pending) ── */}
                      {pendingLabel !== 'Fully Approved' && !pendingLabel.startsWith('Rejected') && (
                        <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-5 space-y-3">
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-indigo-600" />
                            <span className="text-sm font-black text-indigo-900 tracking-tight">Take Action</span>
                            {isMD && (
                              <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 border border-violet-200 px-2.5 py-0.5 rounded-full">MD: can action any stage</span>
                            )}
                          </div>
                          <div className="grid gap-2.5 grid-cols-2 xl:grid-cols-4">
                            {[
                              { key: 'sales_manager', label: 'Sales Manager', currentStatus: row.vpApproval },
                              { key: 'accounts', label: 'Accounts', currentStatus: row.accountApproval },
                              { key: 'ea', label: 'EA', currentStatus: row.eaApproval },
                              { key: 'md', label: 'MD Approval', currentStatus: row.managementApproval }
                            ].map(stg => {
                              const isEligible = isUserAuthorizedForStage(stg.key)
                              const isStepPending = !stg.currentStatus || stg.currentStatus === ''
                              let canClick = isEligible && isStepPending
                              if (stg.key === 'accounts' && row.vpApproval !== 'APPROVED' && !isMD) canClick = false
                              if (stg.key === 'ea' && (row.vpApproval !== 'APPROVED' || row.accountApproval !== 'APPROVED') && !isMD) canClick = false
                              if (stg.key === 'md' && (row.vpApproval !== 'APPROVED' || row.accountApproval !== 'APPROVED' || row.eaApproval !== 'APPROVED') && !isMD) canClick = false

                              return (
                                <button
                                  key={stg.key}
                                  type="button"
                                  disabled={!canClick}
                                  onClick={() => {
                                    setActionRow(row)
                                    setActionStage(stg.key as any)
                                    setActionRemarks('')
                                  }}
                                  className={`p-4 rounded-2xl border-2 text-left flex flex-col justify-between transition-all min-h-[80px] ${
                                    canClick
                                      ? 'border-indigo-300 bg-white hover:border-indigo-500 cursor-pointer hover:shadow-[0_6px_18px_rgba(99,102,241,0.15)]'
                                      : 'border-slate-200 bg-white/60 opacity-50 cursor-not-allowed'
                                  }`}
                                >
                                  <span className="text-xs font-black uppercase tracking-wider text-slate-700">{stg.label}</span>
                                  <div className="mt-2">
                                    {stg.currentStatus === 'APPROVED' ? (
                                      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black uppercase">✓ Approved</Badge>
                                    ) : stg.currentStatus === 'NOT APPROVED' ? (
                                      <Badge className="bg-rose-100 text-rose-800 border border-rose-300 text-[9px] font-black uppercase">✗ Rejected</Badge>
                                    ) : stg.currentStatus === 'HELD' ? (
                                      <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-black uppercase">‖ Held</Badge>
                                    ) : canClick ? (
                                      <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-300 text-[9px] font-black uppercase animate-pulse">Tap to Act ›</Badge>
                                    ) : (
                                      <Badge className="bg-slate-100 text-slate-500 border border-slate-300 text-[9px] font-semibold uppercase">Locked</Badge>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── Row 6: Activity Log toggle ── */}
                      <div className="border-t border-slate-200 pt-4">
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedId(isExpanded ? null : row.id)
                          }}
                          className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500 hover:text-slate-900 transition-colors"
                        >
                          <MessageSquare className="w-4 h-4" />
                          Activity Log & Remarks
                          <span className="bg-slate-200 text-slate-700 rounded-full px-2.5 py-0.5 text-[10px] font-black">{1 + row.history.length}</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>

                        {isExpanded && (
                          <div className="mt-3 space-y-2">
                            {/* Initiator */}
                            <div className="p-3.5 rounded-2xl border border-slate-100 bg-white/80 space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-900 text-white">Initiator</span>
                                  <span className="text-xs font-black text-slate-900">{row.name}</span>
                                </div>
                                <span className="text-[9px] font-bold text-slate-400 whitespace-nowrap">{new Date(row.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <p className="text-xs font-semibold text-slate-600 leading-relaxed">{row.remarks || 'Request submitted with no remarks.'}</p>
                              <p className="text-[9px] font-mono text-slate-400">{row.email}</p>
                            </div>

                            {row.history.length === 0 ? (
                              <div className="flex flex-col items-center justify-center py-6 gap-2 text-slate-300">
                                <MessageSquare className="w-7 h-7" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">No approver remarks yet</span>
                              </div>
                            ) : (
                              row.history.map(entry => (
                                <div
                                  key={entry.id}
                                  className={`p-3.5 rounded-2xl border space-y-1.5 ${getRoleRemarksStyles(entry.roleKey)}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${getRoleBadgeColor(entry.roleKey)}`}>{entry.role}</span>
                                      <span className="text-xs font-black">{entry.user}</span>
                                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                                        entry.action === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                                        entry.action === 'HELD' ? 'bg-amber-100 text-amber-800' :
                                        'bg-rose-100 text-rose-800'
                                      }`}>
                                        {entry.action === 'APPROVED' ? '✓ Approved' : entry.action === 'HELD' ? '‖ Held' : '✗ Rejected'}
                                      </span>
                                    </div>
                                    <span className="text-[9px] font-bold opacity-60 whitespace-nowrap">{new Date(entry.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                  <p className="text-xs font-semibold leading-relaxed">{entry.remarks || 'No remarks left.'}</p>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={Boolean(actionStage && actionRow)} onOpenChange={(open) => { if (!open) { setActionStage(null); setActionRow(null); setActionRemarks(''); } }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
              Take Action — {actionStage === 'sales_manager' ? 'Sales Manager' : actionStage === 'accounts' ? 'Accounts' : actionStage === 'ea' ? 'EA' : 'MD'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
              Select your decision for the request from <strong>{actionRow?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Remarks / Notes (Optional)
              </label>
              <Textarea
                value={actionRemarks}
                onChange={e => setActionRemarks(e.target.value)}
                placeholder="Add any remarks or reasons (optional)..."
                className="min-h-[100px] rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold text-slate-800 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2">
            <Button
              variant="outline"
              onClick={() => { setActionStage(null); setActionRow(null); setActionRemarks(''); }}
              disabled={actionMutation.isPending}
              className="h-10 rounded-2xl text-xs font-bold border-slate-200 order-last sm:order-none"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (actionRow && actionStage) {
                  actionMutation.mutate({
                    id: actionRow.id,
                    action: 'REJECT',
                    stage: actionStage,
                    remarks: actionRemarks
                  })
                }
              }}
              disabled={actionMutation.isPending}
              className="h-10 rounded-2xl bg-rose-600 text-white text-xs font-black hover:bg-rose-700"
            >
              {actionMutation.isPending && actionMutation.variables?.action === 'REJECT' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Deny
            </Button>
            <Button
              onClick={() => {
                if (actionRow && actionStage) {
                  actionMutation.mutate({
                    id: actionRow.id,
                    action: 'HOLD',
                    stage: actionStage,
                    remarks: actionRemarks
                  })
                }
              }}
              disabled={actionMutation.isPending}
              className="h-10 rounded-2xl bg-amber-500 text-white text-xs font-black hover:bg-amber-600"
            >
              {actionMutation.isPending && actionMutation.variables?.action === 'HOLD' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Hold
            </Button>
            <Button
              onClick={() => {
                if (actionRow && actionStage) {
                  actionMutation.mutate({
                    id: actionRow.id,
                    action: 'APPROVE',
                    stage: actionStage,
                    remarks: actionRemarks
                  })
                }
              }}
              disabled={actionMutation.isPending}
              className="h-10 rounded-2xl bg-slate-950 text-white text-xs font-black hover:bg-slate-800"
            >
              {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Approve
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  )
}
