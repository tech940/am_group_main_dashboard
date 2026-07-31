'use client'

import React, { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout/main-layout'
import {
  Search,
  Filter,
  CheckCircle,
  XCircle,
  IndianRupee,
  FileText,
  User,
  Building2,
  Calendar as CalendarIcon,
  MessageSquare,
  ChevronDown,
  Loader2,
  Check,
  X,
  RefreshCw,
  Hash,
  Car,
  Tag,
  CreditCard,
  Banknote,
  MapPin,
  Layers,
  Download,
  ShieldCheck,
  BarChart3,
  TrendingUp,
  History,
  RotateCcw,
} from 'lucide-react'

type DiscountApproval = {
  id: string
  requesterName: string
  branch: string
  customerId: string
  customerName: string | null
  model: string | null
  variant: string | null
  color: string | null
  discountAmount: string
  accessoriesAmount: string | null
  tlManager: string | null
  teleDate?: string | null
  insuranceType?: string | null
  deliveryDate: string | null
  reference: string | null
  status: 'PENDING_SM' | 'PENDING_VP' | 'PENDING_GSM' | 'PENDING_MD' | 'APPROVED' | 'REJECTED'
  remarks: string | null
  history?: Array<{
    action: string
    actorName: string
    actorRole: string
    timestamp: string
    previousStatus: string | null
    newStatus: string
    remarks: string | null
  }> | null
  createdAt: string
  updatedAt: string
  bookingData?: BookingRawData | null
}

type BookingRawData = {
  id?: number
  booking_date?: string | null
  name_of_the_customer?: string | null
  contact_number?: string | null
  model?: string | null
  variant?: string | null
  color?: string | null
  mode_of_purchase?: string | null
  dsa_financier?: string | null
  amount_received?: number | string | null
  balance_payment?: string | null
  order_ref_no?: string | null
  enquiry_date?: string | null
  assigned_date?: string | null
  committed_delivery_date?: string | null
  last_follow_up_remarks?: string | null
  team_leader?: string | null
  consultant_name?: string | null
  age?: string | null
  booking_age?: string | null
  customer_block?: string | null
  main_source?: string | null
  sub_source?: string | null
  activity?: string | null
  location?: string | null
  customer_id?: string | null
  exchange?: string | null
  file_login_date?: string | null
  approval_date?: string | null
  loan_amount?: number | string | null
  approved_loan_amount?: number | string | null
  pan_number?: string | null
  dealer_code?: string | null
}

type Props = {
  currentUser: {
    id: string
    role: string
    fullName: string
    email: string
    brand: string | null
  }
  branch?: 'hyundai' | 'platinum'
}

export function DiscountApprovalsDashboardClient({ currentUser, branch }: Props) {
  const [data, setData] = useState<DiscountApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Staged Filter State (inputs before clicking Apply)
  const [stagedSearchTerm, setStagedSearchTerm] = useState('')
  const [stagedBranchFilter, setStagedBranchFilter] = useState<'all' | 'hyundai' | 'platinum'>('all')
  const [stagedSelectedMonth, setStagedSelectedMonth] = useState<string>('all') // Month-wise format: "YYYY-MM" or "all"
  const [stagedInsuranceFilter, setStagedInsuranceFilter] = useState<'all' | 'In House' | 'Out House'>('all')

  // Applied Filter State (only updated on clicking Apply Filters)
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('')
  const [appliedBranchFilter, setAppliedBranchFilter] = useState<'all' | 'hyundai' | 'platinum'>('all')
  const [appliedSelectedMonth, setAppliedSelectedMonth] = useState<string>('all')
  const [appliedInsuranceFilter, setAppliedInsuranceFilter] = useState<'all' | 'In House' | 'Out House'>('all')

  // Section Tabs & Toggles
  const [activeSection, setActiveSection] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [showAllPending, setShowAllPending] = useState(false)
  const [showDeepAnalysis, setShowDeepAnalysis] = useState(false)

  // Approval Dialog/Inline action state
  const [selectedRequest, setSelectedRequest] = useState<DiscountApproval | null>(null)
  const [actionStatus, setActionStatus] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [remarksInput, setRemarksInput] = useState('')
  const [isSubmittingAction, setIsSubmittingAction] = useState(false)

  // Booking Detail Drawer state
  const [drawerItem, setDrawerItem] = useState<DiscountApproval | null>(null)
  const [drawerBooking, setDrawerBooking] = useState<BookingRawData | null>(null)
  const [isLoadingDrawer, setIsLoadingDrawer] = useState(false)

  // Direct Inline loading state
  const [inlineSubmittingId, setInlineSubmittingId] = useState<string | null>(null)

  // Apply Staged Filters Action
  const handleApplyFilters = () => {
    setAppliedSearchTerm(stagedSearchTerm)
    setAppliedBranchFilter(stagedBranchFilter)
    setAppliedSelectedMonth(stagedSelectedMonth)
    setAppliedInsuranceFilter(stagedInsuranceFilter)
  }

  // Reset Filters Action
  const handleResetFilters = () => {
    setStagedSearchTerm('')
    setStagedBranchFilter('all')
    setStagedSelectedMonth('all')
    setStagedInsuranceFilter('all')

    setAppliedSearchTerm('')
    setAppliedBranchFilter('all')
    setAppliedSelectedMonth('all')
    setAppliedInsuranceFilter('all')
  }

  // Handle direct approve
  const handleDirectApprove = async (item: DiscountApproval) => {
    setInlineSubmittingId(item.id)
    try {
      const res = await fetch('/api/discount-approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          status: 'APPROVED',
          remarks: '',
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        alert(result.error || 'Failed to update request status')
        return
      }

      // Update local state
      setData((prev) =>
        prev.map((it) => (it.id === item.id ? result.data : it))
      )
    } catch (err) {
      console.error(err)
      alert('Error updating request status')
    } finally {
      setInlineSubmittingId(null)
    }
  }

  // Unified 2-Stage Approval Check:
  // Stage 1: GSM OR VP (either can approve Stage 1 -> moves to PENDING_MD immediately)
  // Stage 2: MD (actionable only when PENDING_MD -> moves to APPROVED)
  const canUserApprove = (item: DiscountApproval) => {
    const role = (currentUser.role || '').toLowerCase()
    
    // Stage 1: General Sales Manager OR Vice President
    if (['PENDING_GSM', 'PENDING_VP', 'PENDING_SM'].includes(item.status)) {
      return role === 'general_manager' || role === 'vp' || role === 'admin' || role === 'developer'
    }
    
    // Stage 2: MD (actionable ONLY after Stage 1 clears)
    if (item.status === 'PENDING_MD') {
      return role === 'md' || role === 'admin' || role === 'developer'
    }

    return false
  }

  // Fetch submissions
  const fetchSubmissions = async () => {
    setLoading(true)
    setError('')
    try {
      const url = '/api/discount-approvals'
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error('Failed to load discount approvals data')
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      console.error(err)
      setError('Failed to fetch data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubmissions()
  }, [branch])

  // Open booking detail drawer
  const openDrawer = async (item: DiscountApproval) => {
    setDrawerItem(item)
    if (item.bookingData !== undefined) {
      setDrawerBooking(item.bookingData)
      setIsLoadingDrawer(false)
      return
    }

    setDrawerBooking(null)
    setIsLoadingDrawer(true)
    try {
      const res = await fetch(
        `/api/discount-approvals/lookup?branch=${encodeURIComponent(item.branch)}&vin=${encodeURIComponent(item.customerId)}`
      )
      if (res.ok) {
        const json = await res.json()
        setDrawerBooking(json.rawData || null)
      }
    } catch (err) {
      console.error('Drawer fetch error:', err)
    } finally {
      setIsLoadingDrawer(false)
    }
  }

  const closeDrawer = () => {
    setDrawerItem(null)
    setDrawerBooking(null)
  }

  // Handle action (Approve/Reject) modal submit
  const handleActionSubmit = async () => {
    if (!selectedRequest || !actionStatus) return

    setIsSubmittingAction(true)
    try {
      const res = await fetch('/api/discount-approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRequest.id,
          status: actionStatus,
          remarks: remarksInput,
        }),
      })

      const result = await res.json()

      if (!res.ok) {
        alert(result.error || 'Failed to update request status')
        return
      }

      // Update local state
      setData((prev) =>
        prev.map((item) => (item.id === selectedRequest.id ? result.data : item))
      )
      setSelectedRequest(null)
      setActionStatus(null)
      setRemarksInput('')
    } catch (err) {
      console.error(err)
      alert('Error updating request status')
    } finally {
      setIsSubmittingAction(false)
    }
  }

  // Filtered entries based strictly on APPLIED filters
  const filteredData = data.filter((item) => {
    const matchesSearch =
      !appliedSearchTerm ||
      (item.customerName || '').toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      (item.customerId || '').toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      (item.requesterName || '').toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      (item.tlManager || '').toLowerCase().includes(appliedSearchTerm.toLowerCase()) ||
      (item.model || '').toLowerCase().includes(appliedSearchTerm.toLowerCase())

    const matchesBranch = appliedBranchFilter === 'all' || item.branch === appliedBranchFilter

    // Month-wise Date filter (Tele Date or CreatedAt)
    const matchesMonth = (() => {
      if (!appliedSelectedMonth || appliedSelectedMonth === 'all') return true
      const itemDate = item.teleDate || item.createdAt.substring(0, 10)
      if (!itemDate) return true
      return itemDate.substring(0, 7) === appliedSelectedMonth
    })()

    // Insurance Type filter
    const matchesInsurance = appliedInsuranceFilter === 'all' || item.insuranceType === appliedInsuranceFilter

    let matchesSection = true
    if (activeSection === 'pending') {
      const isPending = ['PENDING_SM', 'PENDING_VP', 'PENDING_GSM', 'PENDING_MD'].includes(item.status)
      if (!isPending) return false

      if (!showAllPending) {
        const role = (currentUser.role || '').toLowerCase()
        if (role === 'general_manager' || role === 'vp') {
          matchesSection = item.status === 'PENDING_GSM' || item.status === 'PENDING_VP' || item.status === 'PENDING_SM'
        } else if (['md', 'admin', 'developer'].includes(role)) {
          matchesSection = item.status === 'PENDING_MD'
        }
      }
    } else if (activeSection === 'approved') {
      matchesSection = item.status === 'APPROVED'
    } else if (activeSection === 'rejected') {
      matchesSection = item.status === 'REJECTED'
    }

    return matchesSearch && matchesBranch && matchesMonth && matchesInsurance && matchesSection
  })

  // Export to Excel / CSV function
  const handleExportExcel = () => {
    if (!filteredData.length) {
      alert('No records available to export.')
      return
    }

    const headers = [
      'ID',
      'Tele Date',
      'Requester (Sales Exec)',
      'TL / Manager',
      'Branch',
      'Customer ID / VIN',
      'Customer Name',
      'Model',
      'Variant',
      'Color',
      'Insurance Type',
      'Discount Amount (INR)',
      'Accessories Amount (INR)',
      'Status',
      'Remarks',
      'Submitted At',
    ]

    const rows = filteredData.map((item) => [
      item.id,
      item.teleDate || formatDate(item.createdAt),
      `"${(item.requesterName || '').replace(/"/g, '""')}"`,
      `"${(item.tlManager || '—').replace(/"/g, '""')}"`,
      item.branch.toUpperCase(),
      `"${(item.customerId || '').replace(/"/g, '""')}"`,
      `"${(item.customerName || '—').replace(/"/g, '""')}"`,
      `"${(item.model || '—').replace(/"/g, '""')}"`,
      `"${(item.variant || '—').replace(/"/g, '""')}"`,
      `"${(item.color || '—').replace(/"/g, '""')}"`,
      `"${(item.insuranceType || '—').replace(/"/g, '""')}"`,
      item.discountAmount,
      item.accessoriesAmount || 0,
      item.status,
      `"${(item.remarks || '').replace(/"/g, '""')}"`,
      item.createdAt,
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `discount_approvals_export_${new Date().toISOString().substring(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Aggregated Stats & Deep Analysis Metrics
  const totalCount = data.length
  const pendingCount = data.filter((item) => ['PENDING_SM', 'PENDING_VP', 'PENDING_GSM', 'PENDING_MD'].includes(item.status)).length
  const approvedCount = data.filter((item) => item.status === 'APPROVED').length
  const rejectedCount = data.filter((item) => item.status === 'REJECTED').length

  const totalDiscountVal = data.reduce((acc, item) => acc + (Number(item.discountAmount) || 0), 0)
  const totalAccVal = data.reduce((acc, item) => acc + (Number(item.accessoriesAmount) || 0), 0)
  const approvedDiscountVal = data.filter((item) => item.status === 'APPROVED').reduce((acc, item) => acc + (Number(item.discountAmount) || 0), 0)
  const avgDiscountVal = totalCount > 0 ? Math.round(totalDiscountVal / totalCount) : 0

  // Insurance breakdown
  const inHouseList = data.filter((item) => item.insuranceType === 'In House')
  const outHouseList = data.filter((item) => item.insuranceType === 'Out House')
  const inHouseDiscountVal = inHouseList.reduce((acc, item) => acc + (Number(item.discountAmount) || 0), 0)
  const outHouseDiscountVal = outHouseList.reduce((acc, item) => acc + (Number(item.discountAmount) || 0), 0)

  // Model-wise breakdown
  const modelMap: Record<string, { count: number; totalDiscount: number }> = {}
  data.forEach((item) => {
    const m = (item.model || 'Unknown').toUpperCase().trim()
    if (!modelMap[m]) modelMap[m] = { count: 0, totalDiscount: 0 }
    modelMap[m].count += 1
    modelMap[m].totalDiscount += Number(item.discountAmount) || 0
  })
  const topModels = Object.entries(modelMap)
    .map(([model, meta]) => ({ model, ...meta }))
    .sort((a, b) => b.totalDiscount - a.totalDiscount)
    .slice(0, 5)

  // Extract unique months for Month-wise filter dropdown
  const monthOptions = Array.from(
    new Set(
      data
        .map((item) => (item.teleDate || item.createdAt.substring(0, 10)).substring(0, 7))
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a))

  // Currency formatting helper
  const formatCurrency = (val: string | number | null) => {
    if (!val) return '—'
    const num = Number(val)
    if (isNaN(num)) return '—'
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num)
  }

  // Date formatting helper
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    try {
      const d = new Date(dateStr)
      if (isNaN(d.getTime())) return dateStr
      return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(d)
    } catch {
      return dateStr
    }
  }

  const formatMonthLabel = (monthStr: string) => {
    if (!monthStr || monthStr === 'all') return 'All Months'
    try {
      const [year, month] = monthStr.split('-')
      const d = new Date(Number(year), Number(month) - 1, 1)
      return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(d)
    } catch {
      return monthStr
    }
  }

  const hasFilterChanges =
    stagedSearchTerm !== appliedSearchTerm ||
    stagedBranchFilter !== appliedBranchFilter ||
    stagedSelectedMonth !== appliedSelectedMonth ||
    stagedInsuranceFilter !== appliedInsuranceFilter

  const hasActiveFilters =
    Boolean(appliedSearchTerm) ||
    appliedBranchFilter !== 'all' ||
    appliedSelectedMonth !== 'all' ||
    appliedInsuranceFilter !== 'all'

  return (
    <MainLayout>
      {/* Top Header Banner */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
            <IndianRupee className="h-6 w-6 text-[var(--dashboard-action-bg,#055B65)]" />
            Discount Approvals Dashboard
          </h1>
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 mt-1">
            Unified 2-Stage Approval System & Deep Analytics
          </p>
        </div>

        {/* Action Buttons styled strictly with theme CSS variables */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDeepAnalysis(!showDeepAnalysis)}
            className="h-10 px-4 bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_10%,transparent)] text-[var(--dashboard-action-bg,#055B65)] border border-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_30%,transparent)] rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
          >
            <BarChart3 className="h-4 w-4" />
            {showDeepAnalysis ? 'Hide Deep Analysis' : 'Show Deep Analysis'}
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            style={{ backgroundColor: 'var(--dashboard-action-bg, #055B65)', color: 'var(--dashboard-action-fg, #ffffff)' }}
            className="h-10 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-md hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            Export Excel
          </button>
        </div>
      </div>

      {/* Deep Analysis & Summary Section */}
      {showDeepAnalysis && (
        <div className="mb-8 space-y-6 animate-in fade-in slide-in-from-top-3 duration-250">
          {/* Executive Overview KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-950 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-black uppercase tracking-wider">Total Requested Discount</span>
                <IndianRupee className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">
                {formatCurrency(totalDiscountVal)}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                Across {totalCount} total discount requests
              </p>
            </div>

            <div className="bg-white dark:bg-slate-950 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-black uppercase tracking-wider">Average Discount / Booking</span>
                <TrendingUp className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">
                {formatCurrency(avgDiscountVal)}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                Average per submitted vehicle
              </p>
            </div>

            <div className="bg-white dark:bg-slate-950 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-black uppercase tracking-wider">Approved Discount Total</span>
                <CheckCircle className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              </div>
              <p className="text-xl font-black text-[var(--dashboard-action-bg,#055B65)]">
                {formatCurrency(approvedDiscountVal)}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                {approvedCount} requests approved by MD ({totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0}% rate)
              </p>
            </div>

            <div className="bg-white dark:bg-slate-950 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-2">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-black uppercase tracking-wider">Total Accessories Amount</span>
                <Layers className="h-4 w-4 text-[var(--dashboard-action-bg,#055B65)]" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white">
                {formatCurrency(totalAccVal)}
              </p>
              <p className="text-[10px] text-slate-400 font-semibold">
                Additional accessories requested
              </p>
            </div>
          </div>

          {/* Deep Breakdown Subsection: Insurance Type & Top Car Models */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Insurance Type Breakdown Card */}
            <div className="bg-white dark:bg-slate-950 p-6 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[var(--dashboard-action-bg,#055B65)]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    Insurance Type Deep Analysis
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">In House vs Out House</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_10%,transparent)] border border-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_25%,transparent)] rounded-2xl space-y-1">
                  <span className="text-[10px] font-black uppercase text-[var(--dashboard-action-bg,#055B65)] block">In House Insurance</span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">{inHouseList.length} Requests</p>
                  <p className="text-xs font-bold text-[var(--dashboard-action-bg,#055B65)]">{formatCurrency(inHouseDiscountVal)}</p>
                  <p className="text-[9px] text-slate-400 pt-1">
                    {totalDiscountVal > 0 ? Math.round((inHouseDiscountVal / totalDiscountVal) * 100) : 0}% of total discount value
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-1">
                  <span className="text-[10px] font-black uppercase text-slate-600 dark:text-slate-400 block">Out House Insurance</span>
                  <p className="text-lg font-black text-slate-900 dark:text-white">{outHouseList.length} Requests</p>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{formatCurrency(outHouseDiscountVal)}</p>
                  <p className="text-[9px] text-slate-400 pt-1">
                    {totalDiscountVal > 0 ? Math.round((outHouseDiscountVal / totalDiscountVal) * 100) : 0}% of total discount value
                  </p>
                </div>
              </div>

              {/* Insurance Visual Ratio Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Distribution Ratio</span>
                  <span>{inHouseList.length} In-House / {outHouseList.length} Out-House</span>
                </div>
                <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  <div
                    style={{ width: `${totalCount > 0 ? (inHouseList.length / totalCount) * 100 : 50}%`, backgroundColor: 'var(--dashboard-action-bg, #055B65)' }}
                    className="h-full transition-all"
                    title={`In House: ${inHouseList.length}`}
                  />
                  <div
                    style={{ width: `${totalCount > 0 ? (outHouseList.length / totalCount) * 100 : 50}%` }}
                    className="h-full bg-slate-400 dark:bg-slate-600 transition-all"
                    title={`Out House: ${outHouseList.length}`}
                  />
                </div>
              </div>
            </div>

            {/* Model-wise Discount Expenditure Breakdown Card */}
            <div className="bg-white dark:bg-slate-950 p-6 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Car className="h-5 w-5 text-[var(--dashboard-action-bg,#055B65)]" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    Top Models by Discount Amount
                  </h3>
                </div>
                <span className="text-[10px] font-bold text-slate-400 uppercase">Top 5 Models</span>
              </div>

              {topModels.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-6 text-center">No model data available yet.</p>
              ) : (
                <div className="space-y-3 pt-1">
                  {topModels.map(({ model, count, totalDiscount }) => {
                    const pct = totalDiscountVal > 0 ? Math.round((totalDiscount / totalDiscountVal) * 100) : 0
                    return (
                      <div key={model} className="space-y-1">
                        <div className="flex items-center justify-between text-xs font-bold">
                          <span className="text-slate-800 dark:text-slate-200">{model} ({count} bookings)</span>
                          <span className="text-[var(--dashboard-action-bg,#055B65)] font-extrabold">{formatCurrency(totalDiscount)} ({pct}%)</span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: 'var(--dashboard-action-bg, #055B65)' }}
                            className="h-full rounded-full transition-all"
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter Toolbar: All Filters & Apply Button in ONE Single Inline Row */}
      <div className="bg-white dark:bg-slate-950 p-4 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_10px_30px_rgba(15,23,42,0.03)] mb-6">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-3">
          {/* 1. Search Input */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search Customer, VIN, Executive..."
              value={stagedSearchTerm}
              onChange={(e) => setStagedSearchTerm(e.target.value)}
              className="w-full h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-4 text-xs font-bold text-slate-900 dark:text-white placeholder-slate-400 outline-hidden transition-all focus:border-[var(--dashboard-action-bg,#055B65)] focus:bg-white dark:focus:bg-slate-950"
            />
          </div>

          {/* 2. Month-Wise Tele Date Filter (No start and end) */}
          <div className="relative flex-1 min-w-[170px]">
            <CalendarIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--dashboard-action-bg,#055B65)] pointer-events-none" />
            <select
              value={stagedSelectedMonth}
              onChange={(e) => setStagedSelectedMonth(e.target.value)}
              className="w-full h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-8 text-xs font-bold text-slate-900 dark:text-white outline-hidden appearance-none cursor-pointer"
            >
              <option value="all">All Tele Months</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonthLabel(m)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          {/* 3. Insurance Type Filter */}
          <div className="relative flex-1 min-w-[160px]">
            <ShieldCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={stagedInsuranceFilter}
              onChange={(e) => setStagedInsuranceFilter(e.target.value as any)}
              className="w-full h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-8 text-xs font-bold text-slate-900 dark:text-white outline-hidden appearance-none cursor-pointer"
            >
              <option value="all">All Insurance Types</option>
              <option value="In House">In House</option>
              <option value="Out House">Out House</option>
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>

          {/* 4. Dealership Branch Filter */}
          {!branch && (
            <div className="relative flex-1 min-w-[160px]">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <select
                value={stagedBranchFilter}
                onChange={(e) => setStagedBranchFilter(e.target.value as any)}
                className="w-full h-11 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl pl-9 pr-8 text-xs font-bold text-slate-900 dark:text-white outline-hidden appearance-none cursor-pointer"
              >
                <option value="all">All Dealerships</option>
                <option value="hyundai">AM Hyundai</option>
                <option value="platinum">AM Platinum</option>
              </select>
              <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            </div>
          )}

          {/* 5. Apply Filters Button in ONE SINGLE LINE - Uses Tropical Teal active theme variable */}
          <button
            type="button"
            onClick={handleApplyFilters}
            style={{ backgroundColor: 'var(--dashboard-action-bg, #055B65)', color: 'var(--dashboard-action-fg, #ffffff)' }}
            className={`h-11 px-5 text-xs font-extrabold uppercase tracking-wider rounded-2xl transition-all cursor-pointer flex items-center gap-2 shrink-0 active:scale-95 shadow-md hover:opacity-90 ${
              hasFilterChanges ? 'ring-2 ring-[var(--dashboard-action-bg,#055B65)]/50' : ''
            }`}
          >
            <Filter className="h-4 w-4 text-white" />
            Apply Filters
          </button>

          {/* 6. Reset Filters Button */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="h-11 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-2xl transition-all cursor-pointer flex items-center gap-1.5 shrink-0 active:scale-95"
              title="Reset Filters"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}

          {/* 7. Refresh Button */}
          <button
            type="button"
            onClick={fetchSubmissions}
            className="h-11 w-11 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-center text-slate-650 dark:text-slate-300 transition-all cursor-pointer shrink-0 active:scale-95"
            title="Refresh submissions"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white dark:bg-slate-950 rounded-[2rem] border border-slate-100 dark:border-slate-800/80 shadow-[0_20px_50px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Tabbed Navigation */}
        <div className="flex border-b border-slate-100 dark:border-slate-850 bg-slate-50/50 dark:bg-slate-900/10 px-5 pt-3 gap-6">
          <TabButton active={activeSection === 'pending'} onClick={() => setActiveSection('pending')} count={pendingCount}>
            Pending
          </TabButton>
          <TabButton active={activeSection === 'approved'} onClick={() => setActiveSection('approved')} count={approvedCount}>
            Approved
          </TabButton>
          <TabButton active={activeSection === 'rejected'} onClick={() => setActiveSection('rejected')} count={rejectedCount}>
            Rejected
          </TabButton>
          <TabButton active={activeSection === 'all'} onClick={() => setActiveSection('all')} count={totalCount}>
            All
          </TabButton>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-950">
            <Loader2 className="h-8 w-8 text-[var(--dashboard-action-bg,#055B65)] animate-spin" />
            <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Loading Requests...</span>
          </div>
        ) : error ? (
          <div className="py-20 flex flex-col items-center justify-center text-rose-500 gap-2">
            <XCircle className="h-8 w-8" />
            <span className="text-xs font-black uppercase tracking-widest">{error}</span>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="py-20 text-center text-slate-400 bg-white dark:bg-slate-950 space-y-2">
            <FileText className="h-8 w-8 mx-auto text-slate-300" />
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">No Requests Found</h3>
            <p className="text-[10px] text-slate-400 font-semibold max-w-xs mx-auto">There are no discount approvals matching your filter criteria.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800/80 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50 dark:bg-slate-900/30">
                  <th className="py-4 px-5">Tele Date</th>
                  <th className="py-4 px-5">Requester</th>
                  <th className="py-4 px-5">Branch</th>
                  <th className="py-4 px-5">Customer ID</th>
                  <th className="py-4 px-5">Customer</th>
                  <th className="py-4 px-5">Insurance</th>
                  <th className="py-4 px-5">Vehicle Specs</th>
                  <th className="py-4 px-5 text-right">Discount</th>
                  <th className="py-4 px-5 text-right">Accessories</th>
                  <th className="py-4 px-5">TL / Manager</th>
                  <th className="py-4 px-5 text-center">Status</th>
                  <th className="py-4 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-850/80">
                {filteredData.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors cursor-pointer"
                    onClick={() => openDrawer(item)}
                  >
                    <td className="py-4 px-5 whitespace-nowrap text-slate-600 dark:text-slate-300 font-bold text-xs">
                      {item.teleDate ? formatDate(item.teleDate) : formatDate(item.createdAt)}
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className="text-xs font-bold text-slate-900 dark:text-white block">{item.requesterName}</span>
                      <span className="text-[10px] text-slate-400 block font-medium">Sales Exec</span>
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className="inline-block px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_10%,transparent)] text-[var(--dashboard-action-bg,#055B65)]">
                        {item.branch === 'hyundai' ? 'AM Hyundai' : 'AM Platinum'}
                      </span>
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap font-mono text-xs font-bold text-[var(--dashboard-action-bg,#055B65)]">
                      {item.customerId}
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">{item.customerName || '—'}</span>
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase ${
                        item.insuranceType === 'In House'
                          ? 'bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_10%,transparent)] text-[var(--dashboard-action-bg,#055B65)] border border-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_25%,transparent)]'
                          : item.insuranceType === 'Out House'
                          ? 'bg-slate-100 text-slate-700 border border-slate-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        <ShieldCheck className="h-3 w-3" />
                        {item.insuranceType || '—'}
                      </span>
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">{item.model || '—'}</span>
                      <span className="text-[10px] text-slate-400 block">{item.variant || '—'} {item.color ? `(${item.color})` : ''}</span>
                    </td>
                    <td className="py-4 px-5 text-right whitespace-nowrap font-black text-xs text-[var(--dashboard-action-bg,#055B65)]">
                      {formatCurrency(item.discountAmount)}
                    </td>
                    <td className="py-4 px-5 text-right whitespace-nowrap font-bold text-xs text-slate-700 dark:text-slate-300">
                      {formatCurrency(item.accessoriesAmount)}
                    </td>
                    <td className="py-4 px-5 whitespace-nowrap text-xs font-bold text-slate-700 dark:text-slate-300">
                      {item.tlManager || '—'}
                    </td>
                    <td className="py-4 px-5 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                          item.status === 'PENDING_GSM' || item.status === 'PENDING_VP' || item.status === 'PENDING_SM'
                            ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                            : item.status === 'PENDING_MD'
                            ? 'bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_12%,transparent)] text-[var(--dashboard-action-bg,#055B65)] border border-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_30%,transparent)]'
                            : item.status === 'APPROVED'
                            ? 'bg-[var(--dashboard-action-bg,#055B65)] text-white'
                            : 'bg-rose-500 text-white'
                        }`}>
                          {item.status === 'PENDING_GSM' || item.status === 'PENDING_VP' || item.status === 'PENDING_SM' ? 'Pending General Manager / VP' :
                           item.status === 'PENDING_MD' ? 'Pending MD' :
                           item.status}
                        </span>
                        {item.remarks && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 max-w-[140px] truncate" title={item.remarks}>
                            <MessageSquare className="h-3 w-3 shrink-0 text-slate-350" />
                            {item.remarks}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {canUserApprove(item) ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={inlineSubmittingId !== null}
                            onClick={() => handleDirectApprove(item)}
                            style={{ backgroundColor: 'var(--dashboard-action-bg, #055B65)', color: 'var(--dashboard-action-fg, #ffffff)' }}
                            className="w-9 h-9 active:scale-95 hover:opacity-90 rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-md disabled:opacity-50"
                            title="Approve Request"
                          >
                            {inlineSubmittingId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-white" />
                            ) : (
                              <Check className="h-4 w-4 stroke-[3] text-white" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={inlineSubmittingId !== null}
                            onClick={() => {
                              setSelectedRequest(item)
                              setActionStatus('REJECTED')
                            }}
                            className="w-9 h-9 active:scale-95 bg-rose-600 hover:bg-rose-700 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-md disabled:opacity-50"
                            title="Reject Request"
                          >
                            <X className="h-4 w-4 stroke-[3] text-white" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          {item.status === 'APPROVED' || item.status === 'REJECTED' ? (
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-650 block pr-2">Reviewed</span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block pr-2">
                              Awaiting {['PENDING_GSM', 'PENDING_VP', 'PENDING_SM'].includes(item.status) ? 'General Manager / VP' : 'MD'}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Action Dialog Modal for Rejection / Remarks */}
      {selectedRequest && actionStatus && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              {actionStatus === 'APPROVED' ? (
                <CheckCircle className="h-5 w-5 text-[var(--dashboard-action-bg,#055B65)]" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-500" />
              )}
              {actionStatus === 'APPROVED' ? 'Approve Discount Request' : 'Reject Discount Request'}
            </h3>

            <div className="bg-slate-50 dark:bg-slate-850 p-4 rounded-2xl space-y-1 text-xs font-bold text-slate-700 dark:text-slate-300">
              <p>Customer: <span className="text-slate-900 dark:text-white">{selectedRequest.customerName || selectedRequest.customerId}</span></p>
              <p>Requested Discount: <span className="text-[var(--dashboard-action-bg,#055B65)] font-extrabold">{formatCurrency(selectedRequest.discountAmount)}</span></p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase text-slate-400 block">
                {actionStatus === 'REJECTED' ? 'Reason / Remarks *' : 'Optional Remarks'}
              </label>
              <textarea
                rows={3}
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                placeholder={actionStatus === 'REJECTED' ? 'Please specify reason for rejection...' : 'Enter any notes...'}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 rounded-2xl p-3 text-xs text-slate-900 dark:text-white outline-hidden focus:border-[var(--dashboard-action-bg,#055B65)] font-medium"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedRequest(null)
                  setActionStatus(null)
                }}
                className="px-4 h-10 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingAction || (actionStatus === 'REJECTED' && !remarksInput.trim())}
                onClick={handleActionSubmit}
                style={actionStatus === 'APPROVED' ? { backgroundColor: 'var(--dashboard-action-bg, #055B65)', color: 'var(--dashboard-action-fg, #ffffff)' } : undefined}
                className={`px-5 h-10 text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md ${
                  actionStatus === 'REJECTED' ? 'bg-rose-600 hover:bg-rose-700' : 'hover:opacity-90'
                }`}
              >
                {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin text-white" />}
                Confirm {actionStatus === 'APPROVED' ? 'Approval' : 'Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Full Details & Activity Log Drawer */}
      {drawerItem && (
        <>
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 animate-in fade-in duration-200"
            onClick={closeDrawer}
          />
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-white dark:bg-slate-950 border-l border-slate-100 dark:border-slate-800 z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-250">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  Discount Approval Details
                </h2>
                <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                  VIN / Customer ID: {drawerItem.customerId}
                </p>
              </div>
              <button
                onClick={closeDrawer}
                className="h-8 w-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Discount Summary Card */}
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/80">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Discount Request Summary</p>
                <div className="space-y-2.5">
                  <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Requester" value={drawerItem.requesterName} />
                  <DrawerRow icon={<Building2 className="h-3.5 w-3.5" />} label="Branch" value={drawerItem.branch === 'hyundai' ? 'AM Hyundai' : 'AM Platinum'} />
                  <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Tele Date" value={drawerItem.teleDate ? formatDate(drawerItem.teleDate) : formatDate(drawerItem.createdAt)} />
                  <DrawerRow icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Insurance Type" value={drawerItem.insuranceType || '—'} highlight />
                  <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Discount" value={formatCurrency(drawerItem.discountAmount)} highlight />
                  {drawerItem.accessoriesAmount && (
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Accessories" value={formatCurrency(drawerItem.accessoriesAmount)} />
                  )}
                  <DrawerRow icon={<Hash className="h-3.5 w-3.5" />} label="Reference" value={drawerItem.reference || '—'} />
                  
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Approval Status</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                      drawerItem.status === 'APPROVED' ? 'bg-[var(--dashboard-action-bg,#055B65)] text-white' :
                      drawerItem.status === 'REJECTED' ? 'bg-rose-600 text-white' :
                      drawerItem.status === 'PENDING_GSM' || drawerItem.status === 'PENDING_VP' || drawerItem.status === 'PENDING_SM' ? 'bg-slate-100 text-slate-700' :
                      'bg-[color-mix(in_srgb,var(--dashboard-action-bg,#055B65)_12%,transparent)] text-[var(--dashboard-action-bg,#055B65)]'
                    }`}>
                      {drawerItem.status === 'PENDING_GSM' || drawerItem.status === 'PENDING_VP' || drawerItem.status === 'PENDING_SM' ? 'Pending General Manager / VP' :
                       drawerItem.status === 'PENDING_MD' ? 'Pending MD' :
                       drawerItem.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Requirement 5: Activity Log & Audit Trail Timeline */}
              <div className="px-5 space-y-3">
                <DrawerSection title="Activity Log & Approval History">
                  {(!drawerItem.history || drawerItem.history.length === 0) ? (
                    <div className="text-center py-4 space-y-1">
                      <History className="h-5 w-5 text-slate-300 mx-auto" />
                      <p className="text-xs text-slate-400 font-medium">Request submitted — Awaiting Stage 1 review</p>
                    </div>
                  ) : (
                    <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                      {drawerItem.history.map((log, index) => (
                        <div key={index} className="relative space-y-1">
                          <div className={`absolute -left-6 top-0.5 h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                            log.action === 'APPROVED' ? 'bg-[var(--dashboard-action-bg,#055B65)] text-white' :
                            log.action === 'REJECTED' ? 'bg-rose-600 text-white' :
                            'bg-slate-700 text-white'
                          }`}>
                            {log.action === 'APPROVED' ? '✓' : log.action === 'REJECTED' ? '✕' : '•'}
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-bold">
                            <span className="text-slate-900 dark:text-white">{log.actorName} ({log.actorRole})</span>
                            <span className="text-[10px] text-slate-400 font-mono">{formatDate(log.timestamp)}</span>
                          </div>

                          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--dashboard-action-bg,#055B65)]">
                            Action: {log.action} {log.newStatus ? `(New Status: ${log.newStatus})` : ''}
                          </p>

                          {log.remarks && (
                            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800 mt-1">
                              "{log.remarks}"
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </DrawerSection>
              </div>

              {/* Booking Record from DB */}
              {isLoadingDrawer ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--dashboard-action-bg,#055B65)]" />
                  <p className="text-xs font-semibold">Fetching booking record...</p>
                </div>
              ) : drawerBooking ? (
                <div className="p-5 space-y-6">

                  {/* Customer Info */}
                  <DrawerSection title="Customer Information">
                    <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Full Name" value={drawerBooking.name_of_the_customer} />
                    <DrawerRow icon={<Phone className="h-3.5 w-3.5" />} label="Contact" value={drawerBooking.contact_number} />
                    <DrawerRow icon={<Hash className="h-3.5 w-3.5" />} label="Customer ID" value={drawerBooking.customer_id} mono />
                    <DrawerRow icon={<MapPin className="h-3.5 w-3.5" />} label="Location" value={drawerBooking.location} />
                    <DrawerRow icon={<Hash className="h-3.5 w-3.5" />} label="PAN Number" value={drawerBooking.pan_number} mono />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Customer Segment" value={drawerBooking.customer_block} />
                  </DrawerSection>

                  {/* Vehicle Info */}
                  <DrawerSection title="Vehicle Specification">
                    <DrawerRow icon={<Car className="h-3.5 w-3.5" />} label="Model" value={drawerBooking.model} />
                    <DrawerRow icon={<Car className="h-3.5 w-3.5" />} label="Variant" value={drawerBooking.variant} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Color" value={drawerBooking.color} />
                    <DrawerRow icon={<RefreshCw className="h-3.5 w-3.5" />} label="Exchange" value={drawerBooking.exchange} />
                  </DrawerSection>

                  {/* Booking Info */}
                  <DrawerSection title="Booking Details">
                    <DrawerRow icon={<Hash className="h-3.5 w-3.5" />} label="Order Ref No" value={drawerBooking.order_ref_no} mono />
                    <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Booking Date" value={formatDate(drawerBooking.booking_date ?? null)} />
                    <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Enquiry Date" value={formatDate(drawerBooking.enquiry_date ?? null)} />
                    <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Committed Delivery" value={formatDate(drawerBooking.committed_delivery_date ?? null)} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Main Source" value={drawerBooking.main_source} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Sub Source" value={drawerBooking.sub_source} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Activity" value={drawerBooking.activity} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Booking Age" value={drawerBooking.booking_age} />
                  </DrawerSection>

                  {/* Finance Info */}
                  <DrawerSection title="Finance & Payment">
                    <DrawerRow icon={<CreditCard className="h-3.5 w-3.5" />} label="Mode of Purchase" value={drawerBooking.mode_of_purchase} />
                    <DrawerRow icon={<Banknote className="h-3.5 w-3.5" />} label="Amount Received" value={drawerBooking.amount_received != null ? formatCurrency(String(drawerBooking.amount_received)) : null} highlight />
                    <DrawerRow icon={<Banknote className="h-3.5 w-3.5" />} label="Balance Payment" value={drawerBooking.balance_payment} />
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="DSA / Financier" value={drawerBooking.dsa_financier} />
                    <DrawerRow icon={<Banknote className="h-3.5 w-3.5" />} label="Loan Amount" value={drawerBooking.loan_amount != null ? formatCurrency(String(drawerBooking.loan_amount)) : null} />
                    <DrawerRow icon={<Banknote className="h-3.5 w-3.5" />} label="Approved Loan" value={drawerBooking.approved_loan_amount != null ? formatCurrency(String(drawerBooking.approved_loan_amount)) : null} />
                    <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="File Login Date" value={formatDate(drawerBooking.file_login_date ?? null)} />
                    <DrawerRow icon={<CalendarIcon className="h-3.5 w-3.5" />} label="Approval Date" value={formatDate(drawerBooking.approval_date ?? null)} />
                  </DrawerSection>

                  {/* Team Info */}
                  <DrawerSection title="Sales Team">
                    <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Team Leader" value={drawerBooking.team_leader} />
                    <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Consultant" value={drawerBooking.consultant_name} />
                    <DrawerRow icon={<Building2 className="h-3.5 w-3.5" />} label="Dealer Code" value={drawerBooking.dealer_code} mono />
                  </DrawerSection>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <FileText className="h-8 w-8 text-slate-300 dark:text-slate-700" />
                  <p className="text-xs font-semibold">No booking record found</p>
                  <p className="text-[10px] text-slate-350 dark:text-slate-600">Customer ID may not match any booking</p>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
              <button
                onClick={closeDrawer}
                className="w-full h-10 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </MainLayout>
  )
}

function Phone({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  )
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={active ? { borderColor: 'var(--dashboard-action-bg, #055B65)', color: 'var(--dashboard-action-bg, #055B65)' } : undefined}
      className={`pb-3 px-1 text-xs font-black uppercase tracking-wider transition-all relative flex items-center gap-2 cursor-pointer ${
        active
          ? 'border-b-2 font-black'
          : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
      }`}
    >
      {children}
      <span
        style={active ? { backgroundColor: 'color-mix(in srgb, var(--dashboard-action-bg, #055B65) 15%, transparent)', color: 'var(--dashboard-action-bg, #055B65)' } : undefined}
        className={`px-2 py-0.5 rounded-full text-[9px] font-black ${
          active ? '' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {title}
      </h3>
      <div className="bg-slate-50/50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-4.5 space-y-2.5">
        {children}
      </div>
    </div>
  )
}

function DrawerRow({
  icon,
  label,
  value,
  mono,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string | null | undefined
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <span
        style={highlight ? { color: 'var(--dashboard-action-bg, #055B65)' } : undefined}
        className={`font-bold ${
          highlight
            ? 'font-extrabold'
            : mono
            ? 'font-mono text-slate-800 dark:text-slate-200'
            : 'text-slate-800 dark:text-slate-200'
        }`}
      >
        {value || '—'}
      </span>
    </div>
  )
}
