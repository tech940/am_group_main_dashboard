'use client'

import { useEffect, useState } from 'react'
import {
  Check,
  X,
  Search,
  Building2,
  Sparkles,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquare,
  RefreshCw,
  FileText,
  ChevronRight,
  Phone,
  Calendar,
  CreditCard,
  MapPin,
  User,
  Car,
  Banknote,
  Tag,
  Hash,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Badge } from '@/components/ui/badge'

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
  deliveryDate: string | null
  reference: string | null
  status: 'PENDING_SM' | 'PENDING_VP' | 'PENDING_GSM' | 'PENDING_MD' | 'APPROVED' | 'REJECTED'
  remarks: string | null
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
  [key: string]: unknown
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

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('')
  const [branchFilter, setBranchFilter] = useState<'all' | 'hyundai' | 'platinum'>('all')
  const [activeSection, setActiveSection] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [showAllPending, setShowAllPending] = useState(false)

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

  // Handle direct approve (without dialog modal)
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

  // Stage check helper (Strict stage clearing: no approval button until previous stage is cleared)
  const canUserApprove = (item: DiscountApproval) => {
    const role = (currentUser.role || '').toLowerCase()
    
    // Stage 1: Sales Manager
    if (item.status === 'PENDING_SM') {
      return role === 'sales_manager' || role === 'admin' || role === 'developer'
    }
    
    // Stage 2: General Sales Manager (or legacy VP)
    if (item.status === 'PENDING_GSM' || item.status === 'PENDING_VP') {
      return role === 'general_manager' || role === 'vp' || role === 'admin' || role === 'developer'
    }

    // Stage 3: MD
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
      // Fetch all discount approvals authorized for the user
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

  // Handle action (Approve/Reject)
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
      
      // Close dialog
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

  // Filtered entries
  const filteredData = data.filter((item) => {
    const matchesSearch =
      (item.customerName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.customerId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.requesterName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.tlManager || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.model || '').toLowerCase().includes(searchTerm.toLowerCase())

    const matchesBranch = branchFilter === 'all' || item.branch === branchFilter

    let matchesSection = true
    if (activeSection === 'pending') {
      const isPending = ['PENDING_SM', 'PENDING_VP', 'PENDING_GSM', 'PENDING_MD'].includes(item.status)
      if (!isPending) return false

      if (!showAllPending) {
        const role = (currentUser.role || '').toLowerCase()
        if (role === 'sales_manager') {
          matchesSection = item.status === 'PENDING_SM'
        } else if (role === 'general_manager' || role === 'vp') {
          matchesSection = item.status === 'PENDING_GSM' || item.status === 'PENDING_VP'
        } else if (['md', 'admin', 'developer'].includes(role)) {
          matchesSection = item.status === 'PENDING_MD'
        }
      }
    } else if (activeSection === 'approved') {
      matchesSection = item.status === 'APPROVED'
    } else if (activeSection === 'rejected') {
      matchesSection = item.status === 'REJECTED'
    }

    return matchesSearch && matchesBranch && matchesSection
  })

  // Aggregated Stats
  const totalCount = data.length
  const pendingCount = data.filter((item) => ['PENDING_SM', 'PENDING_VP', 'PENDING_GSM', 'PENDING_MD'].includes(item.status)).length
  const approvedCount = data.filter((item) => item.status === 'APPROVED').length
  const rejectedCount = data.filter((item) => item.status === 'REJECTED').length

  // Currency formatting
  const formatCurrency = (val: string | null) => {
    if (!val) return '—'
    const num = Number(val)
    if (isNaN(num)) return '—'
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num)
  }

  // Date formatting
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  return (
    <MainLayout
      title="Discount Approvals"
      subtitle="Review and process discount authorization requests submitted by Sales Consultants"
    >
      <div className="space-y-6">
        
        {/* Stats Row */}
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          
          {/* Total Requests Card */}
          <div className="bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Requests</span>
              <span className="text-2xl font-black text-slate-900 dark:text-white">{totalCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">All time</span>
            </div>
          </div>

          {/* Pending Reviews Card */}
          <div className="bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-500/10 text-amber-500 dark:text-amber-400">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-550 block">Pending Review</span>
              <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{pendingCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">Awaiting action</span>
            </div>
          </div>

          {/* Approved Card */}
          <div className="bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-450">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-555 block">Approved Requests</span>
              <span className="text-2xl font-black text-emerald-700 dark:text-emerald-450">{approvedCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">Authorized</span>
            </div>
          </div>

          {/* Rejected Card */}
          <div className="bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800/80 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-450">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 block">Rejected Requests</span>
              <span className="text-2xl font-black text-rose-600 dark:text-rose-550">{rejectedCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5 font-medium">Declined</span>
            </div>
          </div>

        </div>

        {/* Filter Controls Bar */}
        <div className="bg-white dark:bg-slate-950 rounded-3xl border border-slate-100 dark:border-slate-800/80 p-4 flex flex-wrap items-center gap-3 shadow-[0_10px_30px_rgba(15,23,42,0.02)]">
          
          {/* Search bar */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by customer, VIN, requester, manager..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-9 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl pl-9 pr-4 text-xs font-bold placeholder-slate-450 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* Branch selector filter */}
          {(!branch || ['developer', 'admin', 'md', 'vp', 'general_manager', 'sales_manager'].includes(currentUser.role) || (currentUser.brand && currentUser.brand.includes(','))) && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Branch:</span>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value as any)}
                className="h-9 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl px-3 text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-indigo-500"
              >
                <option value="all">All Branches</option>
                <option value="hyundai">AM Hyundai</option>
                <option value="platinum">AM Platinum</option>
              </select>
            </div>
          )}

          {/* Show all pending stages checkbox (Awaiting others) */}
          {activeSection === 'pending' && ['sales_manager', 'vp', 'md', 'admin', 'developer'].includes(currentUser.role) && (
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl h-9 px-3 transition-colors hover:bg-slate-100/50">
              <input
                type="checkbox"
                checked={showAllPending}
                onChange={(e) => setShowAllPending(e.target.checked)}
                className="h-3.5 w-3.5 rounded-md border-slate-350 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span>Show all pending stages (Awaiting others)</span>
            </label>
          )}

          {/* Refresh Action */}
          <button
            type="button"
            onClick={fetchSubmissions}
            className="h-9 w-9 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-650 dark:text-slate-300 transition-all cursor-pointer shadow-xs active:scale-95"
            title="Refresh submissions"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

        </div>

        {/* Dashboard table view */}
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
              <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
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
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800/80 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50 dark:bg-slate-900/30">
                    <th className="py-4 px-5">Date</th>
                    <th className="py-4 px-5">Requester</th>
                    <th className="py-4 px-5">Branch</th>
                    <th className="py-4 px-5">Customer ID</th>
                    <th className="py-4 px-5">Customer</th>
                    <th className="py-4 px-5">Vehicle Specifications</th>
                    <th className="py-4 px-5 text-right">Discount</th>
                    <th className="py-4 px-5 text-right">Accessories</th>
                    <th className="py-4 px-5">Manager</th>
                    <th className="py-4 px-5">Delivery</th>
                    <th className="py-4 px-5">Reference</th>
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
                      <td className="py-4 px-5 whitespace-nowrap text-slate-400 dark:text-slate-500 font-bold">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="py-4 px-5 font-black text-slate-800 dark:text-slate-100">
                        {item.requesterName}
                      </td>
                      <td className="py-4 px-5">
                        <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                          item.branch === 'hyundai'
                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                        }`}>
                          {item.branch === 'hyundai' ? 'Hyundai' : 'Platinum'}
                        </span>
                      </td>
                      <td className="py-4 px-5 font-mono text-slate-800 dark:text-slate-200 font-bold select-all">
                        {item.customerId}
                      </td>
                      <td className="py-4 px-5 font-bold text-slate-800 dark:text-slate-100">
                        {item.customerName || '—'}
                      </td>
                      <td className="py-4 px-5 max-w-[200px]">
                        <div className="font-black text-slate-800 dark:text-slate-200 truncate">{item.model || '—'}</div>
                        <div className="text-[10px] text-slate-400 font-semibold truncate mt-0.5">
                          {item.variant || '—'} {item.color ? `· ${item.color}` : ''}
                        </div>
                      </td>
                      <td className="py-4 px-5 text-right font-black text-rose-500 dark:text-rose-450 whitespace-nowrap">
                        {formatCurrency(item.discountAmount)}
                      </td>
                      <td className="py-4 px-5 text-right font-bold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatCurrency(item.accessoriesAmount)}
                      </td>
                      <td className="py-4 px-5 text-slate-650 dark:text-slate-300 font-bold">
                        {item.tlManager || '—'}
                      </td>
                      <td className="py-4 px-5 text-slate-500 dark:text-slate-400 font-bold whitespace-nowrap">
                        {formatDate(item.deliveryDate)}
                      </td>
                      <td className="py-4 px-5 text-slate-500 dark:text-slate-450 font-bold max-w-[120px] truncate">
                        {item.reference || '—'}
                      </td>
                      <td className="py-4 px-5 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                            item.status === 'PENDING_SM'
                              ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-450 border border-amber-200 dark:border-amber-900/30'
                              : item.status === 'PENDING_VP' || item.status === 'PENDING_GSM'
                              ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/30'
                              : item.status === 'PENDING_MD'
                              ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/30'
                              : item.status === 'APPROVED'
                              ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 border border-emerald-250 dark:border-emerald-900/30'
                              : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-450 border border-rose-250 dark:border-rose-900/30'
                          }`}>
                            {item.status === 'PENDING_SM' ? 'Pending Sales Manager' :
                             item.status === 'PENDING_VP' || item.status === 'PENDING_GSM' ? 'Pending General Sales Manager' :
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
                              style={{ backgroundColor: '#10b981' }}
                              className="w-9 h-9 active:scale-95 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-md shadow-emerald-600/10 disabled:opacity-50"
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
                              style={{ backgroundColor: '#ef4444' }}
                              className="w-9 h-9 active:scale-95 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-md shadow-rose-600/10 disabled:opacity-50"
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
                                Awaiting {item.status === 'PENDING_SM' ? 'Sales Manager' : (item.status === 'PENDING_VP' || item.status === 'PENDING_GSM') ? 'General Sales Manager' : 'MD'}
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

      </div>

      {/* Confirmation Remarks Modal (for Rejection only) */}
      {selectedRequest && actionStatus === 'REJECTED' && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-white dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRequest(null)
                    setActionStatus(null)
                    setRemarksInput('')
                  }}
                  className="w-10 h-10 rounded-xl flex items-center justify-center border bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 border-rose-200 text-rose-600 dark:text-rose-500 cursor-pointer transition-all active:scale-95"
                  title="Cancel rejection"
                >
                  <X className="h-5 w-5" />
                </button>
                <div>
                  <h3 className="text-sm font-black uppercase text-slate-800 dark:text-white">
                    Confirm Discount Rejection
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                    Request by {selectedRequest.requesterName} for {selectedRequest.customerName || 'Unknown Customer'}
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => {
                  setSelectedRequest(null)
                  setActionStatus(null)
                  setRemarksInput('')
                }}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 transition-all cursor-pointer"
                title="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Request Summary Box */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-850 rounded-2xl p-4.5 space-y-2 text-xs font-bold text-slate-700 dark:text-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-400 dark:text-slate-500 font-medium">Customer ID:</span>
                <span className="font-mono select-all text-slate-800 dark:text-slate-100">{selectedRequest.customerId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 dark:text-slate-500 font-medium">Vehicle:</span>
                <span className="text-slate-800 dark:text-slate-100 truncate max-w-[200px]">{selectedRequest.model || '—'} {selectedRequest.variant ? `(${selectedRequest.variant})` : ''}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 dark:border-slate-850 pt-2 mt-2">
                <span className="text-slate-400 dark:text-slate-500 font-medium">Proposed Discount:</span>
                <span className="text-rose-600 dark:text-rose-450 font-black">{formatCurrency(selectedRequest.discountAmount)}</span>
              </div>
            </div>

            {/* Reviewer Remarks */}
            <div className="space-y-2">
              <label htmlFor="remarks" className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Add Rejection Remarks / Reason (Optional)
              </label>
              <textarea
                id="remarks"
                placeholder="Enter rejection reason or remarks..."
                value={remarksInput}
                onChange={(e) => setRemarksInput(e.target.value)}
                className="w-full h-20 p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 focus:border-indigo-500 rounded-xl text-xs font-semibold text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-600 outline-hidden resize-none transition-all"
              />
            </div>

            {/* Modal Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedRequest(null)
                  setActionStatus(null)
                  setRemarksInput('')
                }}
                className="flex-1 h-10 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-850 border border-slate-150 dark:border-slate-800 text-slate-650 dark:text-slate-300 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleActionSubmit}
                disabled={isSubmittingAction}
                className="flex-1 h-10 text-white text-xs font-extrabold tracking-wide uppercase flex items-center justify-center gap-1.5 rounded-xl cursor-pointer transition-all bg-rose-600 hover:bg-rose-500 disabled:opacity-50 shadow-md shadow-rose-600/10"
              >
                {isSubmittingAction ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <span>Confirm Rejection</span>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Booking Detail Drawer ─────────────────────────────────────────────── */}
      {drawerItem && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] z-[200] transition-opacity"
            onClick={closeDrawer}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 h-full w-full sm:w-[440px] bg-white dark:bg-slate-950 border-l border-slate-100 dark:border-slate-800 shadow-2xl z-[201] flex flex-col animate-in slide-in-from-right duration-300">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">
                  Booking Details
                </h2>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                  Customer ID: <span className="font-mono text-indigo-600 dark:text-indigo-400">{drawerItem.customerId}</span>
                </p>
              </div>
              <button
                onClick={closeDrawer}
                className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-400 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">

              {/* Approval Request Summary */}
              <div className="p-5 border-b border-slate-100 dark:border-slate-800/80">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Discount Request</p>
                <div className="space-y-2.5">
                  <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Requester" value={drawerItem.requesterName} />
                  <DrawerRow icon={<Building2 className="h-3.5 w-3.5" />} label="Branch" value={drawerItem.branch === 'hyundai' ? 'AM Hyundai' : 'AM Platinum'} />
                  <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Discount" value={formatCurrency(drawerItem.discountAmount)} highlight />
                  {drawerItem.accessoriesAmount && (
                    <DrawerRow icon={<Tag className="h-3.5 w-3.5" />} label="Accessories" value={formatCurrency(drawerItem.accessoriesAmount)} />
                  )}
                  <DrawerRow icon={<Hash className="h-3.5 w-3.5" />} label="Reference" value={drawerItem.reference || '—'} />
                  <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="Delivery Date" value={formatDate(drawerItem.deliveryDate)} />
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">Approval Status</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                      drawerItem.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      drawerItem.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                      drawerItem.status === 'PENDING_SM' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      drawerItem.status === 'PENDING_VP' || drawerItem.status === 'PENDING_GSM' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                      'bg-blue-50 text-blue-700 border border-blue-200'
                    }`}>
                      {drawerItem.status === 'PENDING_SM' ? 'Pending Sales Manager' :
                       drawerItem.status === 'PENDING_VP' || drawerItem.status === 'PENDING_GSM' ? 'Pending General Sales Manager' :
                       drawerItem.status === 'PENDING_MD' ? 'Pending MD' :
                       drawerItem.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Booking Record from DB */}
              {isLoadingDrawer ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
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
                    <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="Booking Date" value={formatDate(drawerBooking.booking_date ?? null)} />
                    <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="Enquiry Date" value={formatDate(drawerBooking.enquiry_date ?? null)} />
                    <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="Committed Delivery" value={formatDate(drawerBooking.committed_delivery_date ?? null)} />
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
                    <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="File Login Date" value={formatDate(drawerBooking.file_login_date ?? null)} />
                    <DrawerRow icon={<Calendar className="h-3.5 w-3.5" />} label="Approval Date" value={formatDate(drawerBooking.approval_date ?? null)} />
                  </DrawerSection>

                  {/* Team Info */}
                  <DrawerSection title="Sales Team">
                    <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Team Leader" value={drawerBooking.team_leader} />
                    <DrawerRow icon={<User className="h-3.5 w-3.5" />} label="Consultant" value={drawerBooking.consultant_name} />
                    <DrawerRow icon={<Building2 className="h-3.5 w-3.5" />} label="Dealer Code" value={drawerBooking.dealer_code} mono />
                  </DrawerSection>

                  {/* Follow-Up Remarks */}
                  {drawerBooking.last_follow_up_remarks && (
                    <DrawerSection title="Last Follow-Up Remarks">
                      <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl p-3">
                        {drawerBooking.last_follow_up_remarks}
                      </p>
                    </DrawerSection>
                  )}

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
  mono = false,
  highlight = false,
}: {
  icon: React.ReactNode
  label: string
  value: string | number | null | undefined
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs font-bold">
      <span className="text-slate-450 dark:text-slate-500 font-medium flex items-center gap-1.5 shrink-0">
        <span className="text-slate-400 dark:text-slate-600">{icon}</span>
        {label}:
      </span>
      <span className={`text-right break-all ${
        highlight ? 'text-indigo-650 dark:text-indigo-400 font-black' : 'text-slate-800 dark:text-slate-200'
      } ${mono ? 'font-mono select-all' : ''}`}>
        {value || '—'}
      </span>
    </div>
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
      className={`pb-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
        active
          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-650 dark:hover:text-slate-355'
      }`}
    >
      <span>{children}</span>
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
        active
          ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
      }`}>
        {count}
      </span>
    </button>
  )
}


