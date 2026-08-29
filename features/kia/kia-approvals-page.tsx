'use client'

import React, { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
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
  Clock,
  ArrowLeft,
  User2,
  Building2,
  CreditCard,
  Store,
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Eye,
  MoreVertical,
  Plus,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  Check,
  Upload,
  Download,
  Mail,
  Key,
  Percent,
  Phone,
  Paperclip,
  Pencil,
  Send,
  User,
  Users,
  ClipboardList,
  Database,
  Activity,
  CornerUpLeft,
  Printer,
  Trash2,
  Layers,
  PieChart
} from 'lucide-react'
import { KpiCard } from '@/components/ui/kpi-card'
import { printPaymentOrder } from '@/lib/kia/print-payment-order'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'
import { brandHasEd, firstStageApproverRolesForTrack, isServiceApproval, usesGroupServiceManager } from '@/lib/approvals/first-stage-approver'
import { INDIA_TIME_ZONE } from '@/lib/date-time'

/*
 * ── EVERY timestamp on this screen is IST, wherever the viewer is ─────────────────────────────
 *
 * `toLocaleDateString('en-IN')` sets the LOCALE, not the timezone. It renders Indian *formatting*
 * using the viewer's own clock — so the same approval read one date for a user in Jammu and another
 * for a user in New York, and during SSR it rendered in the server's zone (UTC on Vercel) instead of
 * either. For a payment approval trail, "when was this submitted" has to be one answer.
 *
 * These wrappers pin timeZone to Asia/Kolkata and are the ONLY way dates should be formatted in this
 * file. Adding `timeZone` to 25 individual call sites would have worked exactly once — the next
 * person adding a column would reach for toLocaleDateString again.
 *
 * ⚠️ istDayKey uses en-CA deliberately: it yields YYYY-MM-DD, and it is used for GROUPING and CSV
 * export keys, not display. Grouping on a browser-local day silently mis-buckets every row created
 * after 18:30 UTC, which is early evening in India — i.e. exactly when a dealership is busiest.
 */
const IST = INDIA_TIME_ZONE

/** "22 Aug 2026" */
function istDate(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' })
}

/** "10:50 am" */
function istTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true })
}

/** "22 Aug 2026, 10:50 am IST" — the suffix is deliberate on an audit trail. */
function istDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${istDate(value)}, ${istTime(value)} IST`
}

/** "August 2026" — month/year label. */
function istMonthYear(value: Date | string | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { timeZone: IST, month: 'long', year: 'numeric' })
}

/** "2026-08-22" in IST — for grouping keys, CSV columns and <input type="date"> values. */
function istDayKey(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-CA', { timeZone: IST })
}

/** "22 Aug" in IST — short display date */
function istShortDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { timeZone: IST, day: 'numeric', month: 'short' })
}

const LOCATION_OPTIONS = ['JAMMU', 'UDHAMPUR', 'BANIHAL']
const BRAND_OPTIONS = ['KIA', 'HYUNDAI', 'MG', 'TATA', 'PLATINUM']

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
  /** Per-brand request number, e.g. KIA_0001 (migration 0039). Null only on rows predating it. */
  requestNo: string | null
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
  /** Full bill list (migration 0034). Older rows have it empty and carry the two columns below. */
  billUrls: string[] | null
  uploadBillUrl1: string | null
  uploadBillUrl2: string | null
  uploadDocUrl: string | null
  emailSendStatus: string | null
  invoiceNumber: string | null
  invoiceDocUrl: string | null
  glAccountId: string | null
  vehicleNumber: string | null
  gst: string | null
  glCode: string | null
  glName: string | null
  tallyGroup: string | null
  accountNature: string | null
  accountType: string | null
  monthlyBudget: string | null
  quarterlyBudget: string | null
  annualBudget: string | null
  history: ApprovalHistoryEntry[]
  brand: string | null
  paymentStatus: string
  utrNumber: string | null
  paymentProofUrl: string | null
  paymentRemarks: string | null
  paymentCompletedAt: string | null
  paymentCompletedBy: string | null
  sendBackReason: string | null
  createdAt: string
  updatedAt: string
}

interface CurrentUser {
  id: string
  role: string
  fullName: string
  email: string
}

/**
 * Every bill on a request, oldest storage shape first.
 *
 * Requests submitted before migration 0034 have only `uploadBillUrl1/2`; newer ones carry the full
 * `billUrls` array (whose first two entries are mirrored back into those columns). Reading the
 * array when present and falling back otherwise means one render path covers both.
 */
const getBillUrls = (req: { billUrls?: string[] | null; uploadBillUrl1?: string | null; uploadBillUrl2?: string | null }): string[] => {
  if (Array.isArray(req.billUrls) && req.billUrls.length) {
    return req.billUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
  }
  return [req.uploadBillUrl1, req.uploadBillUrl2].filter((u): u is string => Boolean(u && u.trim()))
}

const isRealRemarkText = (text: string | null | undefined): boolean => {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  const genericStrings = [
    'quick approved',
    'approved',
    'approve',
    'not approved',
    'rejected',
    'held',
    'sent back',
    'quick approved by md',
    'no remarks provided',
    'no comment',
    'no notes left.',
    'quick approved by developer'
  ]
  return !genericStrings.includes(lower)
}

const isMdOrDevUser = (roleKey?: string | null, role?: string | null): boolean => {
  const rKey = (roleKey || '').toLowerCase()
  const rName = (role || '').toLowerCase()
  return rKey === 'md' || rKey === 'management' || rKey === 'developer' ||
         rName.includes('md') || rName.includes('management') || rName.includes('developer') || rName.includes('ceo')
}

const getMdRemarksList = (req: ApprovalRequest | null | undefined): { user: string; role: string; remark: string; date?: string }[] => {
  if (!req) return []
  const list: { user: string; role: string; remark: string; date?: string }[] = []
  const seen = new Set<string>()

  // 1. Direct managementRemarks column if present and real
  if (req.managementRemarks && isRealRemarkText(req.managementRemarks)) {
    const trimmed = req.managementRemarks.trim()
    if (!seen.has(trimmed)) {
      seen.add(trimmed)
      list.push({
        user: 'MD / Management',
        role: 'MD',
        remark: trimmed
      })
    }
  }

  // 2. Check history entries for MD / Management / Developer
  if (Array.isArray(req.history)) {
    req.history.forEach((h: any) => {
      const isMd = isMdOrDevUser(h.roleKey, h.role)
      if (isMd) {
        if (h.action === 'REMARK_ADD' && h.remarks && h.remarks.trim().length > 0) {
          const trimmed = h.remarks.trim()
          if (!seen.has(trimmed)) {
            seen.add(trimmed)
            list.push({
              user: h.user || 'MD',
              role: h.role || 'MD',
              remark: trimmed,
              date: h.timestamp ? istDate(h.timestamp) : undefined
            })
          }
        } else if (isRealRemarkText(h.remarks)) {
          const trimmed = h.remarks.trim()
          if (!seen.has(trimmed)) {
            seen.add(trimmed)
            list.push({
              user: h.user || 'MD',
              role: h.role || 'MD',
              remark: trimmed,
              date: h.timestamp ? istDate(h.timestamp) : undefined
            })
          }
        }
      }
    })
  }

  return list
}

const BRANCH_CHIP_PALETTE = [
  'bg-indigo-100 border-indigo-300 text-indigo-900',
  'bg-emerald-100 border-emerald-300 text-emerald-900',
  'bg-amber-100 border-amber-300 text-amber-900',
  'bg-sky-100 border-sky-300 text-sky-900',
  'bg-rose-100 border-rose-300 text-rose-900',
  'bg-violet-100 border-violet-300 text-violet-900',
  'bg-teal-100 border-teal-300 text-teal-900',
  'bg-orange-100 border-orange-300 text-orange-900',
  'bg-cyan-100 border-cyan-300 text-cyan-900',
  'bg-lime-100 border-lime-300 text-lime-900',
  'bg-fuchsia-100 border-fuchsia-300 text-fuchsia-900',
  'bg-blue-100 border-blue-300 text-blue-900',
]
const BRANCH_CHIP_FALLBACK = 'bg-slate-100 border-slate-300 text-slate-800'

/**
 * What counts as one branch.
 *
 * `dealerCode` first — it is the outlet's real identity (JK402, N5211, KATHUA) and survives the
 * dealer NAME being typed differently. Falls back to the name, then the location, for the old rows
 * that predate the dealer fields. A row with none of the three gets '' and takes the neutral
 * fallback colour rather than borrowing another branch's.
 */
const branchKeyOf = (row: Pick<ApprovalRequest, 'dealerCode' | 'dealerName' | 'location'>) =>
  String(row.dealerCode || row.dealerName || row.location || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

export function KiaApprovalsClient({ currentUser }: { currentUser: CurrentUser }) {
  const queryClient = useQueryClient()
  const effectiveRole = ['developer', 'admin'].includes(currentUser.role) ? 'md' : currentUser.role
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

  // Filter Scope: 'pending' (Pending My Approval), 'all' (All Active Requests), 'sent_back' (Sent Back Orders), 'md_remarks' (MD Remarks), 'rejected' (Rejected Orders), 'vendors' (Vendor Ledgers), or 'gl_categories' (GL Category Ledgers)
  const [filterScope, setFilterScope] = useState<'pending' | 'all' | 'sent_back' | 'md_remarks' | 'rejected' | 'vendors' | 'gl_categories'>('pending')

  // Bulk selection & popup modal states
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])
  /** Which bulk verb is collecting a reason, or null while the four buttons are showing. */
  const [bulkReasonFor, setBulkReasonFor] = useState<'SEND_BACK' | 'REJECT' | 'HOLD' | null>(null)
  const [bulkReason, setBulkReason] = useState('')
  const [bulkSuccessModal, setBulkSuccessModal] = useState<{
    open: boolean
    count: number
    totalAmount: number
    action: string
  }>({
    open: false,
    count: 0,
    totalAmount: 0,
    action: 'APPROVED'
  })

  // Vendor Ledgers states
  const [selectedVendorName, setSelectedVendorName] = useState<string | null>(null)
  const [vendorStartDate, setVendorStartDate] = useState<string>('')
  const [vendorEndDate, setVendorEndDate] = useState<string>('')
  const [selectedVendorMonth, setSelectedVendorMonth] = useState<string>('all')
  const [showAnalytics, setShowAnalytics] = useState<boolean>(false)
  const [previewDocUrl, setPreviewDocUrl] = useState<string | null>(null)

  // GL Ledgers states
  const [selectedGlName, setSelectedGlName] = useState<string | null>(null)
  const [glStartDate, setGlStartDate] = useState<string>('')
  const [glEndDate, setGlEndDate] = useState<string>('')
  const [selectedGlMonth, setSelectedGlMonth] = useState<string>('all')
  const [showAddGlDialog, setShowAddGlDialog] = useState<boolean>(false)

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  // Details & Action Modal states
  const [detailRow, setDetailRow] = useState<ApprovalRequest | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  const [actionStage, setActionStage] = useState<'sales_manager' | 'hr' | 'accounts' | 'ea' | 'md' | 'payment_done' | null>(null)
  const [actionDecision, setActionDecision] = useState<'APPROVE' | 'HOLD' | 'REJECT' | 'SEND_BACK' | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDocUrl, setInvoiceDocUrl] = useState('')
  const [invoiceFileName, setInvoiceFileName] = useState('')
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [utrNumberVal, setUtrNumberVal] = useState('')
  const [paymentProofUrl, setPaymentProofUrl] = useState('')
  const [paymentProofFileName, setPaymentProofFileName] = useState('')
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false)
  const [isMigratingEA, setIsMigratingEA] = useState(false)
  const [activeTab, setActiveTab] = useState<'timeline' | 'remarks'>('timeline')
  const [showTimeline, setShowTimeline] = useState(false)
  const [remarkText, setRemarkText] = useState('')
  const [addRemarkPending, setAddRemarkPending] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState('All')
  const [selectedGlFilter, setSelectedGlFilter] = useState('All')
  const [selectedBrand, setSelectedBrand] = useState('All')
  const [selectedGlId, setSelectedGlId] = useState('')
  const [glAccounts, setGlAccounts] = useState<any[]>([])

  // Main Sub-view tab & Completed Spend filters state
  const [mainSubView, setMainSubView] = useState<'requests' | 'completed_spend'>('requests')
  const [completedDatePreset, setCompletedDatePreset] = useState<'all' | 'today' | 'this_week' | 'this_month' | 'this_quarter' | 'custom'>('this_month')
  const [completedStartDate, setCompletedStartDate] = useState<Date | null>(null)
  const [completedEndDate, setCompletedEndDate] = useState<Date | null>(null)
  const [completedSearch, setCompletedSearch] = useState('')
  const [completedDeptFilter, setCompletedDeptFilter] = useState('All')
  const [completedLocationFilter, setCompletedLocationFilter] = useState('All')
  const [completedTypeFilter, setCompletedTypeFilter] = useState('All')
  const [completedPage, setCompletedPage] = useState(1)
  const [completedRowsPerPage, setCompletedRowsPerPage] = useState(25)
  const [showSpendBreakdown, setShowSpendBreakdown] = useState(false)

  useEffect(() => {
    fetch('/api/brands/kia/gl-accounts')
      .then(res => res.json())
      .then(data => setGlAccounts(data.rows || []))
      .catch(err => console.error('Error fetching GL accounts:', err))
  }, [])

  useEffect(() => {
    if (detailRow) {
      setSelectedGlId(detailRow.glAccountId || '')
      setShowTimeline(false)
    } else {
      setSelectedGlId('')
      setShowTimeline(false)
    }
  }, [detailRow])

  const dateRangeLabel = useMemo(() => {
    if (!startDate) return 'Filter by Date'
    const startStr = istDate(startDate)
    if (!endDate) return `${startStr}`
    const endStr = istDate(endDate)
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

  const queryResult = useQuery<{ rows: ApprovalRequest[] }>({
    queryKey: ['kia-approval-requests'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/approvals/list')
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let errMessage = 'Failed to load approvals list'
        try {
          const json = JSON.parse(text)
          if (json?.error) errMessage = json.error
        } catch {}
        throw new Error(errMessage)
      }
      return res.json()
    }
  })
  const { data, isLoading, isFetching, refetch, error } = queryResult

  useEffect(() => {
    console.log('Payment approvals query result data:', data)
    if (error) console.error('Payment approvals query error:', error)
  }, [data, error])

  // Reset pagination to first page when search/filters/scope changes
  useEffect(() => {
    setCurrentPage(1)
  }, [search, selectedLocation, selectedDepartment, startDate, endDate, selectedStage, filterScope, rowsPerPage])

  const uniqueDepartments = useMemo(() => {
    if (!data?.rows) return []
    const depts = new Set<string>()
    data.rows.forEach(r => {
      if (r.department) depts.add(r.department.trim().toUpperCase())
    })
    return Array.from(depts).sort()
  }, [data?.rows])

  const uniqueLocations = useMemo(() => {
    const locs = new Set<string>(['JAMMU', 'UDHAMPUR', 'BANIHAL'])
    if (data?.rows) {
      data.rows.forEach(r => {
        if (r.location) {
          locs.add(r.location.trim().toUpperCase())
        }
      })
    }
    return Array.from(locs).sort()
  }, [data?.rows])

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, stage, remarks, invoiceNumber, invoiceDocUrl, glAccountId, utrNumber, paymentProofUrl }: { id: string; action: 'APPROVE' | 'REJECT' | 'HOLD' | 'SEND_BACK'; stage: string; remarks: string; invoiceNumber?: string; invoiceDocUrl?: string; glAccountId?: string; utrNumber?: string; paymentProofUrl?: string }) => {
      const res = await fetch(`/api/brands/kia/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stage, remarks, invoiceNumber, invoiceDocUrl, glAccountId, utrNumber, paymentProofUrl })
      })
      const resData = await res.json()
      if (!res.ok || resData.error) throw new Error(resData.error || 'Failed to complete approval action')
      return resData
    },
    onSuccess: (resData) => {
      toast({ title: 'Action recorded', description: resData.message || 'Successfully updated the request status.', variant: 'success' })
      setActionRemarks('')
      setActionStage(null)
      setActionDecision(null)
      setInvoiceNumber('')
      setInvoiceDocUrl('')
      setInvoiceFileName('')
      // Close detail view or update the open detailRow with the new matching data if query invalidates
      setDetailRow(null)
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
    },
    onError: (err) => {
      toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please check your role permissions.', variant: 'error' })
    }
  })

  /*
   * DEVELOPER-ONLY hard delete.
   *
   * ⚠️ Checked against `developer` alone — NOT the usual ['developer','admin'] pair used elsewhere in
   * this file, and NOT effectiveRole (which maps developer/admin onto 'md' for approval purposes).
   * The MD is the business approver on this screen; letting the approver erase approvals removes the
   * only independent record that one happened. The server enforces the identical single-role check.
   */
  const isDeveloper = (currentUser.role || '').trim().toLowerCase() === 'developer'

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/brands/kia/approvals/${id}`, { method: 'DELETE' })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok || resData.error) throw new Error(resData.error || 'Failed to delete payment order')
      return resData as { requestNo?: string | null }
    },
    onSuccess: (resData) => {
      toast({
        title: 'Payment order deleted',
        description: `${resData.requestNo || 'The request'} has been permanently removed.`,
        variant: 'success',
      })
      // The row is gone — close any drawer pointing at it before refetching.
      setDetailRow(null)
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
    },
    onError: (err) => {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Only a developer can delete a payment order.',
        variant: 'error',
      })
    },
  })

  const handleDeleteOrder = (row: ApprovalRequest) => {
    const label = row.requestNo || row.name
    const amount = Number(row.amount || 0).toLocaleString('en-IN')
    // Irreversible and unarchived, so the confirm names the row and its amount rather than asking
    // 'are you sure?' about something unidentified in a dense list of similar requests.
    const paidWarning = row.paymentStatus === 'PAID'
      ? '\n\nThis order is already marked PAID.'
      : ''
    const message = [
      `Permanently delete ${label}?`,
      `${row.name} — ₹${amount}`,
      `This cannot be undone. The request and its full approval history will be erased.${paidWarning}`,
    ].join('\n\n')
    if (!window.confirm(message)) return
    deleteMutation.mutate(row.id)
  }

  const handleInvoiceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingInvoice(true)
    setInvoiceFileName(file.name)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'approvals')

      const res = await fetch(`/api/brands/kia/approvals/upload`, {
        method: 'POST',
        body: fd
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Upload failed')
      }

      setInvoiceDocUrl(data.url)
      toast({ title: 'Invoice uploaded', variant: 'success' })
    } catch (err) {
      console.error(err)
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'error' })
      setInvoiceFileName('')
      setInvoiceDocUrl('')
    } finally {
      setUploadingInvoice(false)
    }
  }

  const handlePaymentProofUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingPaymentProof(true)
    setPaymentProofFileName(file.name)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'approvals')

      const res = await fetch(`/api/brands/kia/approvals/upload`, {
        method: 'POST',
        body: fd
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Upload failed')
      }

      setPaymentProofUrl(data.url)
      toast({ title: 'Payment proof uploaded', variant: 'success' })
    } catch (err) {
      console.error(err)
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'error' })
      setPaymentProofFileName('')
      setPaymentProofUrl('')
    } finally {
      setUploadingPaymentProof(false)
    }
  }

  const bulkActionMutation = useMutation({
    mutationFn: async ({ ids, action, remarks }: { ids: string[]; action: 'APPROVE' | 'REJECT' | 'HOLD' | 'SEND_BACK'; remarks: string }) => {
      const res = await fetch(`/api/brands/kia/approvals/bulk-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, remarks })
      })
      const resData = await res.json()
      if (!res.ok || resData.error) throw new Error(resData.error || 'Failed to complete bulk approval action')
      return resData
    },
    onSuccess: (resData, variables) => {
      const approvedRows = (data?.rows || []).filter(r => variables.ids.includes(r.id))
      const totalAmount = approvedRows.reduce((sum, r) => sum + Number(r.amount || 0), 0)

      setBulkSuccessModal({
        open: true,
        count: resData.processedCount || variables.ids.length,
        totalAmount,
        action: variables.action
      })

      toast({ 
        title: 'Bulk Approval Done!', 
        description: resData.message || `Successfully processed ${resData.processedCount || variables.ids.length} approvals.`, 
        variant: 'success' 
      })
      setSelectedRequestIds([])
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
      queryClient.invalidateQueries({ queryKey: ['kia', 'approvals'] })
    },
    onError: (err) => {
      toast({ 
        title: 'Bulk Action failed', 
        description: err instanceof Error ? err.message : 'Please check your role permissions.', 
        variant: 'error' 
      })
    }
  })

  const handlePrintVoucher = (row: ApprovalRequest, pendingLabel: string) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast({ title: 'Popup blocked', description: 'Please allow popups to export the voucher.', variant: 'error' })
      return
    }

    const historyHTML = Array.isArray(row.history) && row.history.length > 0
      ? row.history.map((hist: any) => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 0; font-size: 11px; font-weight: bold; color: #0f172a;">${hist.user}</td>
          <td style="padding: 12px 0; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569;">${hist.role}</td>
          <td style="padding: 12px 0; font-size: 11px; font-weight: bold; text-transform: uppercase;"><span style="display: inline-block; padding: 3px 10px; border-radius: 9999px; font-size: 9px; font-weight: 900; background: ${hist.action === 'APPROVED' ? '#ecfdf5; color: #065f46; border: 1px solid #a7f3d0' : hist.action === 'HELD' ? '#fffbeb; color: #92400e; border: 1px solid #fde68a' : '#fef2f2; color: #991b1b; border: 1px solid #fecaca'}">${hist.action}</span></td>
          <td style="padding: 12px 0; font-size: 11px; color: #475569; font-style: italic; font-weight: 600;">"${hist.remarks || 'No comment'}"</td>
          <td style="padding: 12px 0; font-size: 11px; color: #64748b; text-align: right; font-weight: bold;">${istDateTime(hist.timestamp)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" style="padding: 20px 0; text-align: center; color: #94a3b8; font-size: 12px; font-weight: 600;">No approval history recorded.</td></tr>'

    const htmlContent = `
      <html>
        <head>
          <title>Voucher - ${row.id.substring(0, 8)}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
            body { 
              font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
              padding: 40px; 
              color: #0f172a; 
              margin: 0; 
              background: #ffffff; 
              -webkit-print-color-adjust: exact; 
              print-color-adjust: exact; 
            }
            .header { 
              display: flex; 
              justify-content: space-between; 
              align-items: center; 
              border-bottom: 3px solid #4f46e5; 
              padding-bottom: 20px; 
              margin-bottom: 30px; 
            }
            .logo-area {
              display: flex;
              flex-direction: column;
            }
            .logo-main {
              font-size: 24px;
              font-weight: 900;
              color: #1e1b4b;
              letter-spacing: -0.5px;
            }
            .logo-sub {
              font-size: 11px;
              font-weight: 800;
              color: #4f46e5;
              text-transform: uppercase;
              letter-spacing: 2px;
            }
            .title-area {
              text-align: right;
            }
            .title-area h1 {
              margin: 0;
              font-size: 20px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #4f46e5;
            }
            .title-area p {
              margin: 5px 0 0 0;
              font-size: 10px;
              font-family: monospace;
              color: #64748b;
              font-weight: bold;
            }
            .meta-card {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 24px;
              margin-bottom: 35px;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 20px 24px;
            }
            .meta-item {
              display: flex;
              flex-direction: column;
            }
            .meta-label {
              color: #64748b;
              text-transform: uppercase;
              font-size: 9px;
              font-weight: 800;
              letter-spacing: 1px;
              margin-bottom: 4px;
            }
            .meta-val {
              font-size: 13px;
              font-weight: 700;
              color: #0f172a;
            }
            .meta-val.amount {
              font-size: 18px;
              color: #4f46e5;
              font-weight: 900;
            }
            .meta-val.status {
              color: #4f46e5;
              text-transform: uppercase;
            }
            .remarks-box {
              background: #fffbeb;
              border: 1px solid #fef3c7;
              border-radius: 16px;
              padding: 20px;
              margin-bottom: 35px;
            }
            .remarks-box h3 {
              margin: 0 0 8px 0;
              font-size: 10px;
              text-transform: uppercase;
              letter-spacing: 1px;
              color: #b45309;
            }
            .remarks-box p {
              margin: 0;
              font-size: 12px;
              font-weight: 600;
              color: #78350f;
              line-height: 1.6;
            }
            .section-header {
              font-size: 12px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 2px;
              color: #1e1b4b;
              border-bottom: 2px solid #f1f5f9;
              padding-bottom: 8px;
              margin-bottom: 20px;
            }
            .history-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 45px;
            }
            .history-table th {
              text-align: left;
              font-size: 10px;
              font-weight: 800;
              text-transform: uppercase;
              color: #64748b;
              border-bottom: 2px solid #e2e8f0;
              padding-bottom: 10px;
            }
            .sig-section {
              margin-top: 60px;
              page-break-inside: avoid;
            }
            .sig-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 24px;
            }
            .sig-box {
              border-top: 2px dashed #cbd5e1;
              text-align: center;
              padding-top: 12px;
              font-size: 11px;
              font-weight: bold;
              color: #475569;
            }
            .sig-box span {
              display: block;
              font-size: 9px;
              font-weight: bold;
              color: #94a3b8;
              margin-top: 4px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-area">
              <img src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg" style="height: 40px; width: auto;" alt="AM Kia Logo" />
            </div>
            <div class="title-area">
              <h1>Vendor Payment Voucher</h1>
              <p>ID: ${row.id.toUpperCase()}</p>
            </div>
          </div>

          <div class="meta-card">
            <div class="meta-grid">
              <div class="meta-item">
                <span class="meta-label">Request No.</span>
                <span class="meta-val">${row.requestNo || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Requester Name</span>
                <span class="meta-val">${row.name}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Employee ID</span>
                <span class="meta-val">${row.employeeId || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Amount (₹)</span>
                <span class="meta-val amount">₹${Number(row.amount).toLocaleString('en-IN')}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Email Address</span>
                <span class="meta-val">${row.email}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Dealer Branch</span>
                <span class="meta-val">${row.dealerName || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Dealer Code</span>
                <span class="meta-val">${row.dealerCode || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Department</span>
                <span class="meta-val">${row.department || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Vendor Name</span>
                <span class="meta-val">${row.vendorName || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Payment Method</span>
                <span class="meta-val">${row.typeOfPayment || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Approval Type</span>
                <span class="meta-val">${row.approvalType || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Previous Advance</span>
                <span class="meta-val">${row.previousAdvance ? `₹${Number(row.previousAdvance).toLocaleString('en-IN')}` : '₹0'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Workflow Status</span>
                <span class="meta-val status">${pendingLabel}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">GL Account</span>
                <span class="meta-val" style="color: #4f46e5; font-weight: 800;">${row.glName ? `${row.glName} (${row.glCode})` : '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">GST Details</span>
                <span class="meta-val" style="text-transform: uppercase;">${row.gst || '—'}</span>
              </div>
              <div class="meta-item">
                <span class="meta-label">Tally Group / Account Nature</span>
                <span class="meta-val">${row.tallyGroup ? `${row.tallyGroup} (${row.accountNature || '—'})` : '—'}</span>
              </div>
              <div class="meta-item" style="grid-column: span 2;">
                <span class="meta-label">Submitted Date & Time</span>
                <span class="meta-val">${istDateTime(row.createdAt)}</span>
              </div>
            </div>
          </div>

          ${row.remarks ? `
          <div class="remarks-box">
            <h3>Submitter's Note / Remarks</h3>
            <p>${row.remarks}</p>
          </div>
          ` : ''}

          <div class="section-header">Approval Flow Verification Logs</div>
          <table class="history-table">
            <thead>
              <tr>
                <th scope="col" style="width: 20%;">User</th>
                <th scope="col" style="width: 15%;">Role</th>
                <th scope="col" style="width: 15%;">Decision</th>
                <th scope="col" style="width: 35%;">Remarks</th>
                <th scope="col" style="text-align: right; width: 15%;">Date/Time</th>
              </tr>
            </thead>
            <tbody>
              ${historyHTML}
            </tbody>
          </table>

          <div class="sig-section">
            <div class="sig-grid">
              <div class="sig-box">Sales Manager Approval<span>Sign & Date</span></div>
              <div class="sig-box">Accounts Approval<span>Sign & Date</span></div>
              <div class="sig-box">EA Approval<span>Sign & Date</span></div>
              <div class="sig-box">MD Approval<span>Sign & Date</span></div>
            </div>
          </div>

          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `
    printWindow.document.open()
    printWindow.document.write(htmlContent)
    printWindow.document.close()
  }

  const handlePrintLedger = (vendorName: string, rows: ApprovalRequest[]) => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast({ title: 'Popup blocked', description: 'Please allow popups to export the ledger.', variant: 'error' })
      return
    }

    const totalSpend = rows.reduce((sum, r) => sum + Number(r.amount), 0)
    const avgSpend = rows.length > 0 ? totalSpend / rows.length : 0

    const tableRowsHTML = rows.map((row) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px 10px; font-size: 11px; font-weight: bold; color: #0f172a;">${istDate(row.createdAt)}</td>
        <td style="padding: 12px 10px; font-size: 11px;">
          <div style="font-weight: bold; color: #0f172a;">${row.name}</div>
          <div style="font-size: 9px; color: #64748b; font-weight: bold;">${row.email}</div>
        </td>
        <td style="padding: 12px 10px; font-size: 11px; font-weight: bold; color: #475569; text-transform: uppercase;">${row.department || '—'}</td>
        <td style="padding: 12px 10px; font-size: 11px; color: #475569; font-weight: 500; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${row.remarks || '—'}</td>
        <td style="padding: 12px 10px; font-size: 11px; font-weight: bold; text-transform: uppercase; color: #475569;">${row.typeOfPayment || '—'}</td>
        <td style="padding: 12px 10px; font-size: 11px;">
          <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 8px; font-weight: 900; text-transform: uppercase; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0">${getPendingStageLabel(row)}</span>
        </td>
        <td style="padding: 12px 10px; font-size: 11px; font-weight: 900; color: #4f46e5; text-align: right;">₹${Number(row.amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('')

    const htmlContent = `
      <html>
        <head>
          <title>Ledger - ${vendorName}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
            body { 
              font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
              padding: 40px; 
              color: #0f172a; 
              margin: 0; 
              background: #ffffff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header { 
              border-bottom: 3px solid #4f46e5; 
              padding-bottom: 20px; 
              margin-bottom: 30px; 
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            .logo-area {
              display: flex;
              flex-direction: column;
            }
            .logo-main {
              font-size: 24px;
              font-weight: 900;
              color: #1e1b4b;
              letter-spacing: -0.5px;
            }
            .logo-sub {
              font-size: 11px;
              font-weight: 800;
              color: #4f46e5;
              text-transform: uppercase;
              letter-spacing: 2px;
            }
            .header h1 { 
              margin: 0; 
              font-size: 18px; 
              font-weight: 900; 
              text-transform: uppercase; 
              color: #4f46e5; 
            }
            .kpi-cards {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 15px;
              margin-bottom: 35px;
            }
            .kpi-card {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 15px 20px;
            }
            .kpi-label {
              font-size: 9px;
              font-weight: 800;
              text-transform: uppercase;
              color: #64748b;
              letter-spacing: 1px;
              display: block;
              margin-bottom: 4px;
            }
            .kpi-value {
              font-size: 16px;
              font-weight: 900;
              color: #1e1b4b;
            }
            .kpi-value.highlight {
              color: #4f46e5;
            }
            .ledger-table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-bottom: 30px; 
            }
            .ledger-table th { 
              text-align: left; 
              font-size: 10px; 
              font-weight: 800; 
              text-transform: uppercase; 
              color: #64748b; 
              border-bottom: 2px solid #e2e8f0; 
              padding: 10px;
            }
            .total-row { 
              border-top: 3px solid #1e1b4b; 
              font-weight: 900; 
              font-size: 13px; 
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo-area">
              <img src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg" style="height: 40px; width: auto;" alt="AM Kia Logo" />
            </div>
            <h1>Vendor Ledger: ${vendorName}</h1>
          </div>

          <div class="kpi-cards">
            <div class="kpi-card">
              <span class="kpi-label">Statement Date</span>
              <span class="kpi-value">${istDate(new Date())}</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Total Transactions</span>
              <span class="kpi-value">${rows.length} requests</span>
            </div>
            <div class="kpi-card">
              <span class="kpi-label">Average Spend Size</span>
              <span class="kpi-value highlight">₹${Math.round(avgSpend).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <table class="ledger-table">
            <thead>
              <tr>
                <th scope="col" style="width: 12%; padding-left: 10px;">Date</th>
                <th scope="col" style="width: 25%;">Requester</th>
                <th scope="col" style="width: 15%;">Department</th>
                <th scope="col" style="width: 20%;">Description</th>
                <th scope="col" style="width: 12%;">Payment Type</th>
                <th scope="col" style="width: 13%;">Workflow Status</th>
                <th scope="col" style="text-align: right; width: 13%; padding-right: 10px;">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHTML}
              <tr class="total-row">
                <td colspan="5" style="padding: 14px 10px; font-weight: 900;">TOTAL APPROVED/PENDING SPEND</td>
                <td></td>
                <td style="padding: 14px 10px; color: #4f46e5; font-size: 15px; font-weight: 900; text-align: right; padding-right: 10px;">₹${totalSpend.toLocaleString('en-IN')}</td>
              </tr>
            </tbody>
          </table>

          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `
    printWindow.document.open()
    printWindow.document.write(htmlContent)
    printWindow.document.close()
  }



  /*
   * ⚠️ This USED to be a local copy, and it had already drifted from the server's: it tested the
   * department for 'SPARE' where both approvals routes tested for 'PARTS'. Whichever way a
   * department fell through that gap, the screen and the API disagreed about who the approver was —
   * a button offered and then 403'd, or an approver shown nothing they were authorised for. It now
   * comes from the shared module the routes use.
   */
  const isServiceCategory = (department?: string | null, approvalType?: string | null) =>
    isServiceApproval(department, approvalType)

  const isGeneralSalesManagerRole = (role?: string | null) => {
    if (!role) return false
    const r = role.toLowerCase().trim()
    return (
      ['gsm', 'general_sales_manager', 'sales_manager', 'sales_head', 'general_manager'].includes(r) ||
      r.includes('sales_manager') ||
      r.includes('general_sales')
    )
  }

  const isVpRole = (role?: string | null) => {
    if (!role) return false
    const r = role.toLowerCase().trim()
    return (
      ['vp', 'vice_president', 'vice_pres', 'vp_service', 'service_vp'].includes(r) ||
      r.includes('vp') ||
      r.includes('vice_president')
    )
  }

  /*
   * ── Who owns the FIRST approval stage, on screen ──────────────────────────────────────────────
   *
   * Only KIA has an Executive Director, and only KIA has a VP on the service side. Every other
   * brand routes this same stage to the GSM for the relevant department — General SALES Manager for
   * sales work, General SERVICE Manager for service work.
   *
   *   KIA        sales   -> ED / GSM (Sales)          KIA        service -> VP
   *   all others sales   -> GSM (Sales)               all others service -> GSM (Service)
   *
   * ⚠️ Built here rather than taken from lib/approvals/first-stage-approver's `firstStageLabel`,
   * because that helper models KIA as a single 'ED Approval' and this screen shows KIA's two
   * department variants separately. The ROLE rule still comes from the shared module, so the part
   * that decides authority cannot drift from the server.
   */
  const firstStageDisplayLabel = (req?: ApprovalRequest | null): string => {
    const isService = req ? isServiceCategory(req.department, req.approvalType) : false
    if (req && !brandHasEd(req.brand)) {
      // Hyundai and Platinum service is owned by ONE person across both brands, so naming the
      // brand's own "GSM (Service)" would point the submitter at the wrong desk.
      if (isService) return usesGroupServiceManager(req.brand) ? 'Group Service Manager' : 'GSM (Service)'
      return 'GSM (Sales)'
    }
    return isService ? 'VP' : 'ED / GSM (Sales)'
  }

  const getPendingStageLabel = (req: ApprovalRequest): string => {
    const firstStage = firstStageDisplayLabel(req)

    if (req.vpApproval === 'NOT APPROVED') {
      return `Rejected by ${firstStage}`
    }
    if (req.vpApproval === 'HELD') {
      return `Held by ${firstStage}`
    }

    if (req.hrApproval === 'NOT APPROVED') return 'Rejected by HR'
    if (req.hrApproval === 'HELD') return 'Held by HR'

    if (req.eaApproval === 'NOT APPROVED') return 'Rejected by EA'
    if (req.eaApproval === 'HELD') return 'Held by EA'

    if (req.managementApproval === 'NOT APPROVED') return 'Rejected by MD'
    if (req.managementApproval === 'HELD') return 'Held by MD'

    if (req.accountApproval === 'NOT APPROVED') return 'Rejected by Accounts'
    if (req.accountApproval === 'HELD') return 'Held by Accounts'

    if (req.emailSendStatus === 'SentBack') return 'Sent Back / Clarification'

    if (req.managementApproval === 'APPROVED') {
      if (req.accountApproval === 'APPROVED' || req.paymentStatus === 'PAID') return 'Paid'
      return 'Pending Accounts'
    }

    if (!req.vpApproval || req.vpApproval === '') {
      return `Pending ${firstStage}`
    }

    // Stage 1 approved — check if HR approval is required
    const requiresHr = isHrApprovalRequired(req.approvalType)
    if (requiresHr && (!req.hrApproval || req.hrApproval === '')) {
      return 'Pending HR'
    }

    // Stage 1 (and HR if required) approved — EA stage
    if (req.vpApproval === 'APPROVED' && (!req.eaApproval || req.eaApproval === '')) {
      return 'Pending EA'
    }

    // Pending MD
    if (req.vpApproval === 'APPROVED' && (!req.managementApproval || req.managementApproval === '')) {
      return 'Pending MD'
    }

    if (req.accountApproval === 'APPROVED' || req.paymentStatus === 'PAID') {
      return 'Paid'
    }

    return 'Unknown'
  }

  const getActiveStageKey = (req: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(req)
    if (pendingLabel === 'Sent Back / Clarification' || pendingLabel === 'Paid' || pendingLabel.startsWith('Rejected')) {
      return null
    }

    if (pendingLabel === 'Pending Accounts' || pendingLabel === 'Held by Accounts') return 'accounts'
    if (pendingLabel === 'Pending Payment') return 'payment_done'
    if (pendingLabel === 'Pending MD' || pendingLabel === 'Held by MD') return 'md'
    if (pendingLabel === 'Pending EA' || pendingLabel === 'Held by EA') return 'ea'
    if (pendingLabel === 'Pending HR' || pendingLabel === 'Held by HR') return 'hr'
    /*
     * The first stage, matched against THIS request's own label rather than a hand-kept list of
     * prefixes ('Pending ED' / 'Pending VP' / 'Pending General Service Manager' / …). That list had
     * already gone stale once and silently emptied the stage filter; adding the GSM wordings to it
     * would only set the same trap again. Both strings come from getPendingStageLabel, so an exact
     * comparison cannot drift from it.
     */
    const firstStage = firstStageDisplayLabel(req)
    if (pendingLabel === `Pending ${firstStage}` || pendingLabel === `Held by ${firstStage}`) return 'sales_manager'

    return null
  }

  const userRoleLower = (currentUser.role || '').toLowerCase()
  const effectiveRoleLower = (effectiveRole || '').toLowerCase()

  const isAccountsRole = 
    ['accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team', 'assistant_manager', 'manager', 'admin', 'developer'].includes(currentUser.role) || 
    ['accounts', 'finance_head'].includes(effectiveRole) ||
    userRoleLower.includes('account') ||
    userRoleLower.includes('finance') ||
    effectiveRoleLower.includes('account') ||
    effectiveRoleLower.includes('finance')

  const isHrRole =
    ['hr', 'hr_head', 'hr_team', 'hr_manager', 'admin', 'developer'].includes(currentUser.role) ||
    ['hr'].includes(effectiveRole) ||
    userRoleLower.includes('hr') ||
    effectiveRoleLower.includes('hr')

  // ── SEPARATION OF DUTIES ────────────────────────────────────────────────────────
  // A stage's action buttons belong ONLY to that stage's intended approver. There is no
  // seniority bypass: md/ceo do NOT inherit ED, HR, EA or Accounts rights, so
  // ['md','ceo'] appears on the `md` stage ONLY.
  //
  // WHY: while md/ceo were eligible on every stage, an MD could approve at `md` and then —
  // with the same quick-approve button, which silently re-targeted the next stage once the
  // row re-rendered — mark the request Accounts-approved and PAID. That recorded vendor
  // payments as PAID which Accounts never approved (13 requests in production).
  //
  // Mirrors the server guards in app/api/brands/kia/approvals/[id]/action/route.ts and
  // .../bulk-action/route.ts. developer/admin keep blanket access (line below) as the
  // support escape hatch only.
  /*
   * May this user act on the FIRST approval stage of THIS request?
   *
   * ⚠️ Brand-aware, and that is the whole point. The rule for every brand except KIA is the GSM for
   * the department — **not the VP**. VP is a KIA-service role; on a Hyundai or Platinum request it
   * has no standing at all, and before this the screen offered a VP the buttons and showed a
   * Service GSM none, while the server said the exact opposite (403 for the VP, allowed for the
   * GSM). The role list comes from firstStageApproverRolesForTrack — the SAME function both
   * approvals routes call — so the buttons and the API can no longer disagree.
   *
   * `effectiveRole` is checked alongside the real role because this screen supports acting under an
   * assumed role; both must satisfy the same rule.
   *
   * KIA is deliberately untouched: ED or General Sales Manager on sales, VP on service.
   */
  const canActOnFirstStage = (req?: ApprovalRequest | null) => {
    const isService = req ? isServiceCategory(req.department, req.approvalType) : false

    if (req && !brandHasEd(req.brand)) {
      const allowed = firstStageApproverRolesForTrack(req.brand, isService ? 'service' : 'sales')
      return allowed.includes(userRoleLower) || allowed.includes(effectiveRoleLower)
    }

    // ── KIA, unchanged ──
    if (isService) {
      if (effectiveRole === 'ed' || currentUser.role === 'ed') return false // ED strictly excluded
      return isVpRole(currentUser.role) || isVpRole(effectiveRole)
    }
    return (
      effectiveRole === 'ed' ||
      currentUser.role === 'ed' ||
      isGeneralSalesManagerRole(currentUser.role) ||
      isGeneralSalesManagerRole(effectiveRole)
    )
  }

  const isUserAuthorizedForStage = (stage: string, req?: ApprovalRequest | null) => {
    if (['developer', 'admin'].includes(currentUser.role)) return true

    const isSuperUser = ['md', 'ceo'].includes(effectiveRole) || ['md', 'ceo'].includes(currentUser.role)

    if (stage === 'sales_manager') {
      return canActOnFirstStage(req) || isSuperUser
    }
    if (stage === 'hr') return isHrRole || isSuperUser
    if (stage === 'ea') return ['ea', 'eba'].includes(effectiveRole) || ['ea', 'eba'].includes(currentUser.role) || isSuperUser
    if (stage === 'md') return isSuperUser
    // SEPARATION OF DUTIES — md/ceo are DELIBERATELY EXCLUDED from the Accounts stages.
    // These stages mark the vendor payment PAID and capture the UTR / payment proof; letting the
    // MD act here is what caused payments Accounts never approved to be recorded as PAID.
    // Only Accounts (plus developer/admin, handled above) may act. Mirrors the server checks in
    // app/api/brands/kia/approvals/[id]/action/route.ts and .../bulk-action/route.ts.
    if (stage === 'accounts' || stage === 'payment_done') return isAccountsRole
    return false
  }

  // Correlate whether a request is pending action specifically for the current logged-in user
  const getIsPendingForUser = (row: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(row)
    if (pendingLabel === 'Paid' || pendingLabel.startsWith('Rejected') || pendingLabel === 'Sent Back / Clarification') {
      return false
    }

    if (pendingLabel === 'Pending Accounts' || pendingLabel === 'Held by Accounts') {
      // SEPARATION OF DUTIES — md/ceo excluded. This is the flag that renders the row-level
      // quick Approve button (it is checked BEFORE getActiveStageKey), so leaving md/ceo here
      // would keep handing the MD a one-click "Approve" on the Accounts stage even with the
      // other guards fixed. `isAccountsRole` already covers developer/admin.
      return isAccountsRole
    }

    // SEPARATION OF DUTIES — md/ceo excluded from every stage below except their own ('Pending
    // MD'). This flag renders the row-level quick Approve button and is evaluated BEFORE
    // getActiveStageKey, so leaving md/ceo here would keep offering the MD a one-click approve
    // on someone else's stage — which the server now rejects, producing a button that 403s.
    if (pendingLabel === 'Pending HR' || pendingLabel === 'Held by HR') {
      return isHrRole || ['developer', 'admin'].includes(currentUser.role)
    }

    /*
     * The first stage. This used to be two blocks that sniffed the label for 'VP' / 'ED' / 'GSM
     * (Sales)' and then re-derived the authority rule inline — which is how a Service GSM at a
     * non-KIA brand ended up with an EMPTY "Pending My Approval" queue for requests the server was
     * perfectly willing to let them approve. One check now, against the stage key, using the same
     * brand-aware rule as the buttons. md/ceo stay excluded — this stage is not theirs.
     */
    if (getActiveStageKey(row) === 'sales_manager') {
      return canActOnFirstStage(row) || ['developer', 'admin'].includes(currentUser.role)
    }

    // Pending EA stage is ONLY pending for EA / EBA / Admin roles. MD/CEO must NOT see it in Pending My Approval.
    if (pendingLabel === 'Pending EA' || pendingLabel === 'Held by EA') {
      return ['ea', 'eba'].includes(effectiveRole) || ['ea', 'eba'].includes(currentUser.role) || ['developer', 'admin'].includes(currentUser.role)
    }

    if (pendingLabel === 'Pending MD' || pendingLabel === 'Held by MD') {
      return ['md', 'ceo'].includes(effectiveRole) || ['md', 'ceo'].includes(currentUser.role) || ['developer', 'admin'].includes(currentUser.role)
    }

    // Also check if MD approved and Accounts approval is still pending.
    // SEPARATION OF DUTIES — md/ceo excluded: once the MD has approved, the request is waiting on
    // Accounts, not on them. Showing it as "pending for me" is what surfaced the quick-approve
    // button that let an MD mark payments PAID without Accounts. `isAccountsRole` covers
    // developer/admin.
    if (row.managementApproval === 'APPROVED' && row.accountApproval !== 'APPROVED' && row.paymentStatus !== 'PAID') {
      return isAccountsRole
    }

    return false
  }

  /*
   * ── The rows every headline number describes ──────────────────────────────────────────────────
   *
   * The KPI cards and the tab counts used to read `data.rows` — EVERY request in the system — so
   * selecting HYUNDAI narrowed the table to one row while the cards still read "132 requests" and
   * "Rs91,90,061 approved". The numbers described a different population than the list underneath
   * them.
   *
   * ⚠️ Scoped by the BRAND (and location) selector ONLY. Deliberately NOT by the tab, the search
   * box, the department / GL selects, the date range or the workflow-state select:
   *   - those answer "what am I looking at right now"; the cards answer "how much is there";
   *   - and a tab count that obeyed its own tab would be circular — "Rejected Orders" would read 0
   *     for as long as you stood on the Pending tab, because no pending row is rejected.
   * Brand/location is the one axis that means "whose numbers are these", which is what was asked
   * for. The card subtitles name the active scope so a drop from 132 to 1 reads as a filter rather
   * than as missing data.
   */
  const scopedRows = useMemo(() => {
    const rows = data?.rows || []
    return rows.filter((row) => {
      const matchesBrand =
        selectedBrand === 'All' ||
        (row.brand && row.brand.trim().toUpperCase() === selectedBrand.trim().toUpperCase())
      if (!matchesBrand) return false
      // selectedLocation has no control in the filter bar today, so this is always 'All' — kept so
      // that adding one automatically carries the headline numbers with it.
      return selectedLocation === 'All' || row.location === selectedLocation
    })
  }, [data?.rows, selectedBrand, selectedLocation])

  /** Names the active scope for the KPI subtitles, e.g. "All time · HYUNDAI". */
  const scopeSuffix =
    selectedBrand !== 'All' ? ` · ${selectedBrand}`
    : selectedLocation !== 'All' ? ` · ${selectedLocation}`
    : ''

  // Compute metrics counts for top strip
  const totalCount = scopedRows.length
  const pendingForMeCount = useMemo(() => {
    return scopedRows.filter(getIsPendingForUser).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows, effectiveRole])

  const approvedVolume = useMemo(() => {
    return scopedRows
      .filter(r => r.managementApproval === 'APPROVED' && !getPendingStageLabel(r).startsWith('Rejected'))
      .reduce((sum, r) => sum + Number(r.amount || 0), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRows])

  const isPaidOrder = useCallback((req: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(req)
    return pendingLabel === 'Paid' || req.paymentStatus === 'PAID'
  }, [])

  const isSentBackOrder = useCallback((req: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(req)
    return pendingLabel === 'Sent Back / Clarification' || req.emailSendStatus === 'SentBack'
  }, [])

  const isRejectedOrder = useCallback((req: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(req)
    return pendingLabel.startsWith('Rejected')
  }, [])

  const rejectedCount = useMemo(() => {
    return scopedRows.filter(isRejectedOrder).length
  }, [scopedRows, isRejectedOrder])

  // Persistent master database row sequence map (so serial numbers stay fixed when items get approved/removed)
  const dbRowIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!data?.rows) return map
    data.rows.forEach((req, idx) => {
      map.set(req.id, idx + 1)
    })
    return map
  }, [data?.rows])

  // MD Remarks Helper & Counter
  const hasMdRemarks = useCallback((req: ApprovalRequest) => {
    return getMdRemarksList(req).length > 0
  }, [])

  const mdRemarksCount = useMemo(() => {
    return scopedRows.filter(hasMdRemarks).length
  }, [scopedRows, hasMdRemarks])

  const sentBackCount = useMemo(() => {
    return scopedRows.filter(isSentBackOrder).length
  }, [scopedRows, isSentBackOrder])

  const activeRequestsCount = useMemo(() => {
    return scopedRows.filter(r => !isPaidOrder(r) && !isSentBackOrder(r) && !isRejectedOrder(r)).length
  }, [scopedRows, isPaidOrder, isSentBackOrder, isRejectedOrder])

  // Filter logic
  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(row => {
      // 1. Pending for me vs All vs Sent Back vs MD Remarks vs Rejected filter
      const stageSelected = selectedStage !== 'All'
      if (filterScope === 'pending' && !stageSelected && !getIsPendingForUser(row)) {
        return false
      }
      if (filterScope === 'all' && !stageSelected) {
        if (isPaidOrder(row) || isSentBackOrder(row) || isRejectedOrder(row)) {
          return false
        }
      }
      if (filterScope === 'sent_back') {
        if (!isSentBackOrder(row)) {
          return false
        }
      }
      if (filterScope === 'rejected') {
        if (!isRejectedOrder(row)) {
          return false
        }
      }
      if (filterScope === 'md_remarks' && !hasMdRemarks(row)) {
        return false
      }

      // 2. Search query filter
      const matchesSearch =
        // The request number first: it is the one term someone types when they already know which
        // payment they want. Matched loosely so "kia 0001", "KIA_0001" and "0001" all land.
        (row.requestNo && row.requestNo.toLowerCase().replace(/[^a-z0-9]/g, '')
          .includes(search.toLowerCase().replace(/[^a-z0-9]/g, ''))) ||
        row.name.toLowerCase().includes(search.toLowerCase()) ||
        row.email.toLowerCase().includes(search.toLowerCase()) ||
        (row.vendorName && row.vendorName.toLowerCase().includes(search.toLowerCase())) ||
        (row.department && row.department.toLowerCase().includes(search.toLowerCase())) ||
        (row.approvalType && row.approvalType.toLowerCase().includes(search.toLowerCase())) ||
        (row.glName && row.glName.toLowerCase().includes(search.toLowerCase())) ||
        (row.glCode && row.glCode.toLowerCase().includes(search.toLowerCase())) ||
        (row.tallyGroup && row.tallyGroup.toLowerCase().includes(search.toLowerCase())) ||
        (row.accountNature && row.accountNature.toLowerCase().includes(search.toLowerCase())) ||
        (row.brand && row.brand.toLowerCase().includes(search.toLowerCase())) ||
        row.amount.includes(search)

      if (!matchesSearch) return false

      // 3. Location filter
      const matchesLocation = selectedLocation === 'All' || row.location === selectedLocation
      if (!matchesLocation) return false

      // 4. Department filter
      const matchesDepartment = selectedDepartment === 'All' || 
        (row.department && row.department.trim().toUpperCase() === selectedDepartment.trim().toUpperCase())
      if (!matchesDepartment) return false

      // 4.5. GL Account filter
      const matchesGl = selectedGlFilter === 'All' || row.glAccountId === selectedGlFilter
      if (!matchesGl) return false

      // 4.6. Brand filter
      const matchesBrand = selectedBrand === 'All' || 
        (row.brand && row.brand.trim().toUpperCase() === selectedBrand.trim().toUpperCase())
      if (!matchesBrand) return false

      // 5. Date filter
      if (startDate) {
        const createdDate = new Date(row.createdAt)
        const rowDay = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate())
        const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
        
        if (endDate) {
          const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
          if (rowDay < startDay || rowDay > endDay) return false
        } else {
          if (rowDay.getTime() !== startDay.getTime()) return false
        }
      }

      // 6. Workflow stage filter
      //
      // Matched on getActiveStageKey, NOT on the display label. Label equality is what broke this:
      // getPendingStageLabel returns 'Pending ED / GSM (Sales)' (or 'Pending VP' for service work),
      // never the bare 'Pending ED' this compared against, so the first stage in the dropdown could
      // not match a single row. getActiveStageKey already folds those variants — plus 'Pending
      // General Service Manager' — into one key, so this cannot drift again.
      const pendingLabel = getPendingStageLabel(row)
      const stageKey = getActiveStageKey(row)
      // Accounts has approved but the money has not left yet. Read from the FIELDS, not the label:
      // getPendingStageLabel collapses this state into 'Paid' (line ~1124), and 'Pending Payment' is
      // a label it never returns — which is why that option could never match either.
      const isAwaitingPayment = row.accountApproval === 'APPROVED' && row.paymentStatus !== 'PAID'
      const matchesStage =
        selectedStage === 'All' ? true
        : selectedStage === 'pending_sales_manager' ? stageKey === 'sales_manager'
        : selectedStage === 'pending_hr' ? stageKey === 'hr'
        : selectedStage === 'pending_ea' ? stageKey === 'ea'
        : selectedStage === 'pending_md' ? stageKey === 'md'
        : selectedStage === 'pending_accounts' ? stageKey === 'accounts'
        : selectedStage === 'pending_payment' ? isAwaitingPayment
        : selectedStage === 'paid' ? isPaidOrder(row)
        // "All Approved" = past the approval chain. Deliberately excludes 'Pending Accounts', which
        // is still awaiting a decision — matching the original intent of this option.
        : selectedStage === 'completed' ? (pendingLabel === 'Paid' || isAwaitingPayment)
        : selectedStage === 'sent_back' ? isSentBackOrder(row)
        : selectedStage === 'rejected' ? pendingLabel.startsWith('Rejected')
        // Held rows were unreachable from this dropdown entirely — no option matched them, so they
        // could only be found by scrolling the unfiltered list.
        : selectedStage === 'on_hold' ? pendingLabel.startsWith('Held')
        : true
      if (!matchesStage) return false

      return true
    })
  }, [data?.rows, filterScope, search, selectedLocation, selectedDepartment, selectedGlFilter, selectedBrand, startDate, endDate, selectedStage, effectiveRole])

  const departmentAllocation = useMemo(() => {
    const map: Record<string, number> = {}
    let total = 0
    filteredRows.forEach(r => {
      const d = r.department || 'Other'
      const amt = Number(r.amount || 0)
      map[d] = (map[d] || 0) + amt
      total += amt
    })
    return Object.entries(map).map(([dept, amt]) => ({
      dept,
      amt,
      pct: total > 0 ? (amt / total) * 100 : 0
    })).sort((a, b) => b.amt - a.amt)
  }, [filteredRows])

  const vendorSummary = useMemo(() => {
    const summaryMap: Record<string, { name: string; count: number; total: number; rows: ApprovalRequest[] }> = {}
    scopedRows.forEach(row => {
      const vName = (row.vendorName || 'Unknown Vendor').trim()
      if (!summaryMap[vName]) {
        summaryMap[vName] = { name: vName, count: 0, total: 0, rows: [] }
      }
      summaryMap[vName].count += 1
      summaryMap[vName].total += Number(row.amount || 0)
      summaryMap[vName].rows.push(row)
    })
    return Object.values(summaryMap).sort((a, b) => b.total - a.total)
  }, [scopedRows])

  const glSummary = useMemo(() => {
    const summaryMap: Record<string, { id: string; name: string; code: string; count: number; total: number; rows: ApprovalRequest[] }> = {}
    scopedRows.forEach(row => {
      const glAcc = glAccounts.find(g => g.id === row.glAccountId)
      const glName = glAcc ? glAcc.glName : 'Unknown GL Category'
      const glCode = glAcc ? glAcc.glCode : '—'
      const key = row.glAccountId || 'unknown'
      if (!summaryMap[key]) {
        summaryMap[key] = { id: key, name: glName, code: glCode, count: 0, total: 0, rows: [] }
      }
      summaryMap[key].count += 1
      summaryMap[key].total += Number(row.amount || 0)
      summaryMap[key].rows.push(row)
    })
    return Object.values(summaryMap).sort((a, b) => b.total - a.total)
  }, [scopedRows, glAccounts])

  const glFilteredRows = useMemo(() => {
    if (!selectedGlName || !data?.rows) return []
    const glItem = glSummary.find(g => g.name === selectedGlName)
    if (!glItem) return []
    return glItem.rows.filter(row => {
      const rowDate = new Date(row.createdAt)
      rowDate.setHours(0, 0, 0, 0)
      
      if (glStartDate) {
        const start = new Date(glStartDate)
        start.setHours(0, 0, 0, 0)
        if (rowDate < start) return false
      }
      if (glEndDate) {
        const end = new Date(glEndDate)
        end.setHours(0, 0, 0, 0)
        if (rowDate > end) return false
      }
      return true
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [selectedGlName, glSummary, glStartDate, glEndDate])

  const glTransactions = useMemo(() => {
    if (!selectedGlName || !data?.rows) return []
    const glItem = glSummary.find(g => g.name === selectedGlName)
    return glItem ? glItem.rows : []
  }, [selectedGlName, glSummary, data?.rows])

  const glUniqueMonths = useMemo(() => {
    const monthsSet = new Set<string>()
    glTransactions.forEach(row => {
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      monthsSet.add(`${year}-${month}`)
    })
    return Array.from(monthsSet).sort((a, b) => b.localeCompare(a))
  }, [glTransactions])

  const glMonthFilteredRows = useMemo(() => {
    return glFilteredRows.filter(row => {
      if (selectedGlMonth === 'all') return true
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      return `${year}-${month}` === selectedGlMonth
    })
  }, [glFilteredRows, selectedGlMonth])

  const glGroupedByMonth = useMemo(() => {
    const groups: Record<string, { yearMonth: string; totalAmount: number; rows: ApprovalRequest[] }> = {}
    glMonthFilteredRows.forEach(row => {
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const key = `${year}-${month}`
      if (!groups[key]) {
        groups[key] = { yearMonth: key, totalAmount: 0, rows: [] }
      }
      groups[key].totalAmount += Number(row.amount || 0)
      groups[key].rows.push(row)
    })
    return Object.values(groups).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  }, [glMonthFilteredRows])

  const vendorFilteredRows = useMemo(() => {
    if (!selectedVendorName || !data?.rows) return []
    const vend = vendorSummary.find(v => v.name === selectedVendorName)
    if (!vend) return []
    return vend.rows.filter(row => {
      const rowDate = new Date(row.createdAt)
      rowDate.setHours(0, 0, 0, 0)
      
      if (vendorStartDate) {
        const start = new Date(vendorStartDate)
        start.setHours(0, 0, 0, 0)
        if (rowDate < start) return false
      }
      if (vendorEndDate) {
        const end = new Date(vendorEndDate)
        end.setHours(0, 0, 0, 0)
        if (rowDate > end) return false
      }
      return true
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [selectedVendorName, vendorSummary, vendorStartDate, vendorEndDate])

  const vendorTransactions = useMemo(() => {
    if (!selectedVendorName || !data?.rows) return []
    const vend = vendorSummary.find(v => v.name === selectedVendorName)
    return vend ? vend.rows : []
  }, [selectedVendorName, vendorSummary, data?.rows])

  const uniqueMonths = useMemo(() => {
    const monthsSet = new Set<string>()
    vendorTransactions.forEach(row => {
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      monthsSet.add(`${year}-${month}`)
    })
    return Array.from(monthsSet).sort((a, b) => b.localeCompare(a))
  }, [vendorTransactions])

  const monthFilteredRows = useMemo(() => {
    return vendorFilteredRows.filter(row => {
      if (selectedVendorMonth === 'all') return true
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      return `${year}-${month}` === selectedVendorMonth
    })
  }, [vendorFilteredRows, selectedVendorMonth])

  const groupedByMonth = useMemo(() => {
    const groups: Record<string, { yearMonth: string; totalAmount: number; rows: ApprovalRequest[] }> = {}
    monthFilteredRows.forEach(row => {
      const date = new Date(row.createdAt)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const key = `${year}-${month}`
      if (!groups[key]) {
        groups[key] = { yearMonth: key, totalAmount: 0, rows: [] }
      }
      groups[key].totalAmount += Number(row.amount || 0)
      groups[key].rows.push(row)
    })
    return Object.values(groups).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
  }, [monthFilteredRows])

  function formatYearMonth(yearMonth: string) {
    const [year, month] = yearMonth.split('-')
    const d = new Date(Number(year), Number(month) - 1, 1)
    return istMonthYear(d)
  }

  // Utility to clean and normalize vendor names (merging duplicates like "VICKY ADVERTISER" and "Vicky Advertisers")
  const normalizeVendorName = (rawName: string): string => {
    let name = (rawName || '').trim()
    if (!name || name === '-' || name === '—' || name.toLowerCase() === 'unknown vendor' || name.toLowerCase() === 'n/a') {
      return 'Unspecified Vendor'
    }
    let cleaned = name.replace(/\s+/g, ' ')
    if (cleaned.toLowerCase().endsWith('advertisers')) {
      cleaned = cleaned.substring(0, cleaned.length - 1)
    }
    return cleaned.replace(/\b\w+/g, txt => {
      const lower = txt.toLowerCase()
      if (['pvt', 'ltd', 'ca', 'jk', 'ed', 'hr', 'ea', 'md', 'oem', 'am'].includes(lower)) return txt.toUpperCase()
      return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
    })
  }

  const analyticsData = useMemo(() => {
    const empty = { 
      totalApproved: 0, 
      totalPending: 0, 
      totalAll: 0,
      totalCount: 0,
      approvedCount: 0,
      pendingCount: 0,
      avgTxSize: 0, 
      topVendors: [] as { name: string; total: number }[], 
      topGlAccounts: [] as { name: string; total: number }[], 
      spendHighlights: {
        adSpend: 0, repairSpend: 0, fuelSpend: 0, salarySpend: 0,
        securitySpend: 0, vehiclePurchase: 0, partsPurchase: 0,
        travelSpend: 0, softwareSpend: 0, professionalSpend: 0
      }
    }
    if (scopedRows.length === 0) return empty
    
    let totalApproved = 0   // MD approved or fully paid
    let totalPending = 0    // still in workflow (not rejected)
    let totalAll = 0        // all requests combined
    let approvedCount = 0
    let pendingCount = 0

    const approvedVendorMap: Record<string, number> = {}
    const approvedGlMap: Record<string, number> = {}
    const allVendorMap: Record<string, number> = {}
    const allGlMap: Record<string, number> = {}
    
    let adSpend = 0, repairSpend = 0, fuelSpend = 0, salarySpend = 0
    let securitySpend = 0, vehiclePurchase = 0, partsPurchase = 0
    let travelSpend = 0, softwareSpend = 0, professionalSpend = 0

    scopedRows.forEach(row => {
      const amount = Number(row.amount || 0)
      totalAll += amount

      const mdApproved = row.managementApproval === 'APPROVED'
      const rejected = row.vpApproval === 'NOT APPROVED' ||
                       row.hrApproval === 'NOT APPROVED' ||
                       row.eaApproval === 'NOT APPROVED' ||
                       row.managementApproval === 'NOT APPROVED' ||
                       row.accountApproval === 'NOT APPROVED'

      const normVendor = normalizeVendorName(row.vendorName || '')
      const normGl = (row.glName || 'Unclassified GL').trim()

      const stageLabel = getPendingStageLabel(row)
      const isActivelyPending = stageLabel.startsWith('Pending ')

      if (mdApproved && !rejected) {
        totalApproved += amount
        approvedCount++
        approvedVendorMap[normVendor] = (approvedVendorMap[normVendor] || 0) + amount
        approvedGlMap[normGl] = (approvedGlMap[normGl] || 0) + amount
      } else if (isActivelyPending) {
        totalPending += amount
        pendingCount++
      }

      if (!rejected) {
        allVendorMap[normVendor] = (allVendorMap[normVendor] || 0) + amount
        allGlMap[normGl] = (allGlMap[normGl] || 0) + amount
      }

      // Category spend classification — use GL name for matching since glCodes may vary
      const glNameNorm = (row.glName || '').toLowerCase()
      const typeNorm = (row.approvalType || row.typeOfPayment || '').toLowerCase()
      const glCode = row.glCode || ''
      const combined = `${glNameNorm} ${typeNorm}`

      if (
        ['GL-032','GL-033','GL-034'].includes(glCode) ||
        combined.includes('advertisement') || combined.includes('advertis') ||
        combined.includes('marketing') || combined.includes('promotion')
      ) {
        adSpend += amount
      } else if (
        ['GL-039','GL-040','GL-041','GL-042'].includes(glCode) ||
        combined.includes('repair') || combined.includes('maintenance') ||
        combined.includes('amc') || combined.includes('service charge')
      ) {
        repairSpend += amount
      } else if (
        ['GL-047','GL-048'].includes(glCode) ||
        combined.includes('fuel') || combined.includes('petrol') ||
        combined.includes('diesel') || combined.includes('running')
      ) {
        fuelSpend += amount
      } else if (
        ['GL-024'].includes(glCode) ||
        combined.includes('salary') || combined.includes('salaries') ||
        combined.includes('wage') || combined.includes('payroll') ||
        typeNorm === 'salary' || typeNorm === 'pf' || typeNorm === 'esi' ||
        typeNorm === 'incentive' || typeNorm === 'uniform'
      ) {
        salarySpend += amount
      } else if (
        ['GL-045'].includes(glCode) ||
        combined.includes('security') || combined.includes('guard')
      ) {
        securitySpend += amount
      } else if (
        ['GL-011','GL-012','GL-013','GL-014'].includes(glCode) ||
        combined.includes('vehicle purchase') || combined.includes('car purchase') ||
        combined.includes('vehicle sale')
      ) {
        vehiclePurchase += amount
      } else if (
        ['GL-015','GL-016'].includes(glCode) ||
        combined.includes('spare') || combined.includes('part') ||
        combined.includes('accessory') || combined.includes('accessories')
      ) {
        partsPurchase += amount
      } else if (
        ['GL-052'].includes(glCode) ||
        combined.includes('travel') || combined.includes('conveyance') ||
        combined.includes('lodging') || combined.includes('hotel')
      ) {
        travelSpend += amount
      } else if (
        ['GL-056'].includes(glCode) ||
        combined.includes('software') || combined.includes('subscription') ||
        combined.includes('saas') || combined.includes('license')
      ) {
        softwareSpend += amount
      } else if (
        ['GL-057','GL-059'].includes(glCode) ||
        combined.includes('professional') || combined.includes('legal') ||
        combined.includes('audit') || combined.includes('consultant') ||
        combined.includes('training')
      ) {
        professionalSpend += amount
      }
    })
    
    // Prefer approved vendor/GL map if approved spend exists, otherwise fall back to active map
    const activeVendorMap = totalApproved > 0 && Object.keys(approvedVendorMap).length > 0 ? approvedVendorMap : allVendorMap
    const activeGlMap = totalApproved > 0 && Object.keys(approvedGlMap).length > 0 ? approvedGlMap : allGlMap

    const topVendors = Object.entries(activeVendorMap)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    const topGlAccounts = Object.entries(activeGlMap)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      
    const totalCount = scopedRows.length
    const avgTxSize = totalCount > 0 ? totalAll / totalCount : 0
    
    return {
      totalApproved,
      totalPending,
      totalAll,
      totalCount,
      approvedCount,
      pendingCount,
      avgTxSize,
      topVendors,
      topGlAccounts,
      spendHighlights: {
        adSpend, repairSpend, fuelSpend, salarySpend,
        securitySpend, vehiclePurchase, partsPurchase,
        travelSpend, softwareSpend, professionalSpend
      }
    }
  }, [scopedRows])

  const completedPaymentsList = useMemo(() => {
    return scopedRows.filter((req) => {
      // Strictly ONLY completed and paid orders!
      const isCompleted = isPaidOrder(req)
      if (!isCompleted) return false

      const dateToUse = req.paymentCompletedAt ? new Date(req.paymentCompletedAt) : new Date(req.updatedAt || req.createdAt)
      const now = new Date()

      if (completedDatePreset === 'today') {
        if (dateToUse.toDateString() !== now.toDateString()) return false
      } else if (completedDatePreset === 'this_week') {
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() - now.getDay())
        startOfWeek.setHours(0, 0, 0, 0)
        if (dateToUse < startOfWeek) return false
      } else if (completedDatePreset === 'this_month') {
        if (dateToUse.getMonth() !== now.getMonth() || dateToUse.getFullYear() !== now.getFullYear()) return false
      } else if (completedDatePreset === 'this_quarter') {
        const currentQuarter = Math.floor(now.getMonth() / 3)
        const itemQuarter = Math.floor(dateToUse.getMonth() / 3)
        if (itemQuarter !== currentQuarter || dateToUse.getFullYear() !== now.getFullYear()) return false
      } else if (completedDatePreset === 'custom') {
        if (completedStartDate) {
          const start = new Date(completedStartDate)
          start.setHours(0, 0, 0, 0)
          if (dateToUse < start) return false
        }
        if (completedEndDate) {
          const end = new Date(completedEndDate)
          end.setHours(23, 59, 59, 999)
          if (dateToUse > end) return false
        }
      }

      if (completedDeptFilter !== 'All' && (req.department || '').trim().toUpperCase() !== completedDeptFilter.trim().toUpperCase()) {
        return false
      }

      if (completedLocationFilter !== 'All' && (req.location || '').trim().toUpperCase() !== completedLocationFilter.trim().toUpperCase()) {
        return false
      }

      if (completedTypeFilter !== 'All' && (req.approvalType || '').trim().toUpperCase() !== completedTypeFilter.trim().toUpperCase()) {
        return false
      }

      if (completedSearch.trim()) {
        const q = completedSearch.trim().toLowerCase()
        const cleanQ = q.replace(/[^a-z0-9]/g, '')
        const match =
          (req.requestNo && req.requestNo.toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanQ)) ||
          req.name.toLowerCase().includes(q) ||
          req.email.toLowerCase().includes(q) ||
          (req.vendorName && req.vendorName.toLowerCase().includes(q)) ||
          (req.dealerName && req.dealerName.toLowerCase().includes(q)) ||
          (req.dealerCode && req.dealerCode.toLowerCase().includes(q)) ||
          (req.location && req.location.toLowerCase().includes(q)) ||
          (req.department && req.department.toLowerCase().includes(q)) ||
          (req.approvalType && req.approvalType.toLowerCase().includes(q)) ||
          (req.invoiceNumber && req.invoiceNumber.toLowerCase().includes(q)) ||
          (req.utrNumber && req.utrNumber.toLowerCase().includes(q)) ||
          (req.remarks && req.remarks.toLowerCase().includes(q)) ||
          req.amount.includes(q)
        if (!match) return false
      }

      return true
    }).sort((a, b) => new Date(b.paymentCompletedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.paymentCompletedAt || a.updatedAt || a.createdAt).getTime())
  }, [scopedRows, isPaidOrder, completedDatePreset, completedStartDate, completedEndDate, completedDeptFilter, completedLocationFilter, completedTypeFilter, completedSearch])

  const totalCompletedSpend = useMemo(() => {
    return completedPaymentsList.reduce((sum, r) => sum + Number(r.amount || 0), 0)
  }, [completedPaymentsList])

  const avgCompletedSpend = useMemo(() => {
    if (completedPaymentsList.length === 0) return 0
    return totalCompletedSpend / completedPaymentsList.length
  }, [completedPaymentsList, totalCompletedSpend])

  const paginatedCompletedRows = useMemo(() => {
    const start = (completedPage - 1) * completedRowsPerPage
    return completedPaymentsList.slice(start, start + completedRowsPerPage)
  }, [completedPaymentsList, completedPage, completedRowsPerPage])

  const totalCompletedPages = useMemo(() => {
    return Math.ceil(completedPaymentsList.length / completedRowsPerPage) || 1
  }, [completedPaymentsList.length, completedRowsPerPage])

  const spendByApprovalType = useMemo(() => {
    const map: Record<string, { type: string; total: number; count: number }> = {}
    completedPaymentsList.forEach((r) => {
      const typeKey = r.approvalType || 'General Vendor Payment'
      if (!map[typeKey]) {
        map[typeKey] = { type: typeKey, total: 0, count: 0 }
      }
      map[typeKey].total += Number(r.amount || 0)
      map[typeKey].count += 1
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [completedPaymentsList])

  const completedApprovalTypes = useMemo(() => {
    if (!data?.rows) return []
    const types = new Set<string>()
    data.rows.forEach(r => {
      if (r.approvalType && r.approvalType.trim()) types.add(r.approvalType.trim())
    })
    return Array.from(types).sort()
  }, [data?.rows])

  function getSlaBadge(createdAt: string) {
    const hours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
    if (hours >= 120) {
      return (
        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shadow-2xs animate-pulse">
          <Clock className="w-2.5 h-2.5 text-rose-700" />
          Aging {Math.floor(hours / 24)}d
        </span>
      )
    }
    if (hours >= 48) {
      return (
        <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider shadow-2xs">
          <Clock className="w-2.5 h-2.5 text-amber-700" />
          Aging {Math.floor(hours / 24)}d
        </span>
      )
    }
    return null
  }

  function getAnomalyAlerts(row: ApprovalRequest, allRows: ApprovalRequest[]) {
    const alerts: string[] = []
    const currentAmount = Number(row.amount || 0)
    const currentVendor = (row.vendorName || '').trim().toLowerCase()
    const currentRequester = (row.name || '').trim().toLowerCase()
    const currentCreatedAt = new Date(row.createdAt).getTime()
    
    const duplicate = allRows.find(other => {
      if (other.id === row.id) return false
      const otherVendor = (other.vendorName || '').trim().toLowerCase()
      const otherRequester = (other.name || '').trim().toLowerCase()
      const otherAmount = Number(other.amount || 0)
      const otherCreatedAt = new Date(other.createdAt).getTime()
      
      return (
        otherVendor === currentVendor &&
         otherAmount === currentAmount &&
        otherRequester === currentRequester &&
        Math.abs(currentCreatedAt - otherCreatedAt) <= 48 * 60 * 60 * 1000
      )
    })
    if (duplicate) {
      alerts.push(`Possible duplicate request detected (matches request by ${duplicate.name} for ₹${Number(duplicate.amount).toLocaleString('en-IN')} on ${istDate(duplicate.createdAt)})`)
    }
    
    const vendorPayments = allRows.filter(other => {
      if (other.id === row.id) return false
      const otherVendor = (other.vendorName || '').trim().toLowerCase()
      return otherVendor === currentVendor
    })
    if (vendorPayments.length >= 2) {
      const avgSpend = vendorPayments.reduce((sum, r) => sum + Number(r.amount || 0), 0) / vendorPayments.length
      if (avgSpend > 0 && currentAmount >= avgSpend * 1.5) {
        const percentage = Math.round(((currentAmount - avgSpend) / avgSpend) * 100)
        alerts.push(`High spend variance: Amount is ${percentage}% higher than this vendor's historical average of ₹${Math.round(avgSpend).toLocaleString('en-IN')}`)
      }
    }
    
    return alerts
  }

  // Paginated Rows
  const totalRows = filteredRows.length
  const totalPages = Math.ceil(totalRows / rowsPerPage)
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return filteredRows.slice(start, start + rowsPerPage)
  }, [filteredRows, currentPage, rowsPerPage])

  // Count active filters (for the badge)
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (selectedLocation !== 'All') count++
    if (selectedDepartment !== 'All') count++
    if (startDate) count++
    if (selectedStage !== 'All') count++
    return count
  }, [selectedLocation, selectedDepartment, startDate, selectedStage])

  const renderWorkflowStepper = (req: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(req)
    const requiresHr = isHrApprovalRequired(req.approvalType)
    
    const stages = [
      { key: 'sales_manager', label: 'ED', status: req.vpApproval },
      ...(requiresHr ? [{ key: 'hr', label: 'HR', status: req.hrApproval }] : []),
      { key: 'accounts', label: 'Accounts (Invoice)', status: req.accountApproval },
      { key: 'ea', label: 'EA', status: req.eaApproval },
      { key: 'md', label: 'MD', status: req.managementApproval },
      { key: 'payment_done', label: 'Payment', status: req.paymentStatus === 'PAID' ? 'APPROVED' : null },
    ]

    return (
      <div className="bg-slate-50/50 border border-slate-100 rounded-3xl p-5 space-y-4">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Workflow Progress</span>
        <div className="flex items-center justify-between w-full relative">
          {stages.map((stg, i) => {
            const isApproved = stg.status === 'APPROVED'
            const isRejected = stg.status === 'NOT APPROVED'
            const isHeld = stg.status === 'HELD'
            
            // Check if this is the active stage
            let isActive = false
            if (pendingLabel === 'Pending ED' && stg.key === 'sales_manager') isActive = true
            else if (pendingLabel === 'Pending HR' && stg.key === 'hr') isActive = true
            else if (pendingLabel === 'Pending Accounts' && stg.key === 'accounts') isActive = true
            else if (pendingLabel === 'Pending EA' && stg.key === 'ea') isActive = true
            else if (pendingLabel === 'Pending MD' && stg.key === 'md') isActive = true
            else if (pendingLabel === 'Pending Payment' && stg.key === 'payment_done') isActive = true

            let circleColor = 'bg-slate-100 text-slate-400 border-slate-200'
            let textColor = 'text-slate-400 font-semibold'
            let statusLabel = 'Locked'

            if (isApproved) {
              circleColor = 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/10'
              textColor = 'text-emerald-700 font-black'
              statusLabel = 'Approved'
            } else if (isRejected) {
              circleColor = 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/10'
              textColor = 'text-rose-700 font-black'
              statusLabel = 'Rejected'
            } else if (isHeld) {
              circleColor = 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/10'
              textColor = 'text-amber-700 font-black'
              statusLabel = 'Held'
            } else if (isActive) {
              circleColor = 'bg-indigo-600 text-white border-indigo-600 ring-4 ring-indigo-100 animate-pulse shadow-md shadow-indigo-600/10'
              textColor = 'text-indigo-600 font-black'
              statusLabel = 'Active'
            }

            return (
              <div key={stg.key} className="flex-1 flex flex-col items-center relative z-10">
                {/* Connecting line between stages */}
                {i > 0 && (
                  <div className={`absolute top-4 right-[50%] w-[100%] h-0.5 -z-10 ${
                    stages[i - 1].status === 'APPROVED' ? 'bg-emerald-500' : 'bg-slate-200'
                  }`} />
                )}
                
                {/* Circle badge */}
                <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center text-xs font-black transition-all ${circleColor}`}>
                  {isApproved ? '✓' : isRejected ? '✗' : isHeld ? '‖' : i + 1}
                </div>
                
                {/* Text Labels */}
                <span className={`text-[10px] uppercase tracking-wider mt-2.5 text-center block ${textColor}`}>
                  {stg.label}
                </span>
                <span className="text-[9px] font-bold text-slate-400 text-center block mt-0.5">
                  {statusLabel}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Number circle coloring
  /*
   * Amount, banded by magnitude — the one place in this row where colour carries DATA rather than
   * just lifting a value off the white.
   *
   * The bands come from the live distribution, not from round numbers that felt right: median
   * ₹10,000, p75 ₹28,213, p90 ₹2.97L, max ₹1.2 Cr. 91 of 124 requests sit under ₹25k, so tinting
   * those would tint almost the whole table and signal nothing. They stay plain and the 33 that are
   * genuinely large escalate — rarity is what gives the top band its force.
   *
   * Indigo, deliberately: emerald means paid, amber means pending, rose means rejected and teal is
   * the primary action in this table. A large amount is none of those things — it is heavy, not
   * good or bad — so it borrows the dashboard's neutral accent instead of a status hue.
   */
  const getAmountBandClass = (value: number) => {
    if (!Number.isFinite(value) || value < 25_000) return 'text-slate-900 bg-slate-100/80 border-slate-200 dark:text-slate-100 dark:bg-slate-800 dark:border-slate-700'
    if (value < 100_000) return 'text-indigo-900 bg-indigo-50 border-indigo-200 dark:text-indigo-200 dark:bg-indigo-950 dark:border-indigo-800'
    if (value < 500_000) return 'text-violet-950 bg-violet-100 border-violet-300 dark:text-violet-100 dark:bg-violet-900 dark:border-violet-700'
    return 'text-rose-950 bg-rose-100 border-rose-300 dark:text-rose-100 dark:bg-rose-950 dark:border-rose-800 font-extrabold'
  }

  const getNumberBadgeClass = (index: number) => {
    const schemes = [
      'bg-indigo-50 border-indigo-200 text-indigo-700',
      'bg-emerald-50 border-emerald-200 text-emerald-700',
      'bg-sky-50 border-sky-200 text-sky-700',
      'bg-amber-50 border-amber-200 text-amber-700',
      'bg-rose-50 border-rose-200 text-rose-700',
      'bg-violet-50 border-violet-200 text-violet-700',
      'bg-teal-50 border-teal-200 text-teal-700',
    ]
    return schemes[index % schemes.length]
  }

  // Department Badge coloring
  const getDeptBadgeClass = (dept: string) => {
    const d = (dept || '').trim().toUpperCase()
    if (d.includes('SERVICE') || d.includes('WORKSHOP') || d.includes('BODYSIGN') || d.includes('BODYSHOP')) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 font-extrabold'
    }
    if (d.includes('SALES')) {
      return 'bg-blue-100 text-blue-800 border-blue-300 font-extrabold'
    }
    if (d.includes('PURCHASE')) {
      return 'bg-purple-100 text-purple-800 border-purple-300 font-extrabold'
    }
    if (d.includes('ACCESSORIES')) {
      return 'bg-indigo-100 text-indigo-800 border-indigo-300 font-extrabold'
    }
    if (d.includes('TRAVEL')) {
      return 'bg-sky-100 text-sky-800 border-sky-300 font-extrabold'
    }
    if (d.includes('MARKETING') || d.includes('DIGITAL')) {
      return 'bg-pink-100 text-pink-800 border-pink-300 font-extrabold'
    }
    if (d.includes('REPAIRS') || d.includes('MAINTENANCE')) {
      return 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold'
    }
    if (d.includes('ADMIN')) {
      return 'bg-teal-100 text-teal-800 border-teal-300 font-extrabold'
    }
    if (d.includes('HR')) {
      return 'bg-emerald-100 text-emerald-800 border-emerald-300 font-extrabold'
    }
    if (d.includes('SYSTEM') || d.includes('IT') || d.includes('EDP')) {
      return 'bg-cyan-100 text-cyan-800 border-cyan-300 font-extrabold'
    }
    if (d.includes('ACCOUNTS') || d.includes('FINANCE')) {
      return 'bg-purple-100 text-purple-800 border-purple-300 font-extrabold'
    }
    return 'bg-slate-200 text-slate-800 border-slate-300 font-extrabold'
  }

  // Payment type badge coloring
  const getPaymentTypeBadgeClass = (type: string) => {
    const t = (type || '').trim().toUpperCase()
    if (t.includes('ONLINE') || t.includes('TRANSFER')) return 'border-blue-300 text-blue-800 bg-blue-100 font-extrabold'
    if (t.includes('NEFT')) return 'border-emerald-300 text-emerald-800 bg-emerald-100 font-extrabold'
    if (t.includes('RTGS') || t.includes('CHEQUE')) return 'border-violet-300 text-violet-800 bg-violet-100 font-extrabold'
    return 'border-slate-300 text-slate-800 bg-slate-100 font-extrabold'
  }

  /*
   * ── Per-branch colour for the Request No. and Dealer Name chips ───────────────────────────────
   *
   * The list mixes every brand and every outlet, and both of those chips used to be one flat colour
   * (indigo for the request number, slate for the dealer), so a Kia Jammu row and a Kia Udhampur row
   * were indistinguishable until you read them. Each BRANCH now carries its own colour, and both
   * chips in a row share it, so a row reads as a single colour block you can scan for.
   *
   * ⚠️ Assigned by INDEX over the sorted branches actually present — deliberately not by hashing the
   * branch name into the palette. With ~7 branches and a 12-colour palette a hash collides better
   * than half the time (birthday problem), and two branches sharing a colour defeats the entire
   * point of the feature. Indexing guarantees every branch is distinct up to the palette size.
   *
   * Built from ALL loaded rows, not the filtered ones, so a branch keeps its colour when you filter.
   * Sorted by key so the same data always produces the same colours; adding a NEW branch can shift
   * the colours of branches that sort after it, which is the accepted cost of collision-freedom.
   */
  const branchChipClassByKey = useMemo(() => {
    const keys = Array.from(
      new Set((data?.rows || []).map((row) => branchKeyOf(row)).filter(Boolean)),
    ).sort()
    const map = new Map<string, string>()
    keys.forEach((key, index) => {
      // Wrap rather than run out of colours. Past the palette size two branches DO repeat a colour;
      // at 12 slots against the outlets this group runs, that is not reachable today.
      map.set(key, BRANCH_CHIP_PALETTE[index % BRANCH_CHIP_PALETTE.length])
    })
    return map
  }, [data?.rows])

  /** The branch colour for one row's Request No. / Dealer Name chips. */
  const getBranchChipClass = (row: Pick<ApprovalRequest, 'dealerCode' | 'dealerName' | 'location'>) =>
    branchChipClassByKey.get(branchKeyOf(row)) || BRANCH_CHIP_FALLBACK

  const getBrandBadgeClass = (brand: string) => {
    const b = (brand || '').trim().toLowerCase()
    if (b === 'kia') return 'bg-rose-100 text-rose-800 border-rose-300 font-black'
    if (b === 'hyundai') return 'bg-sky-100 text-sky-800 border-sky-300 font-black'
    if (b === 'mg') return 'bg-teal-100 text-teal-800 border-teal-300 font-black'
    return 'bg-slate-100 text-slate-800 border-slate-300 font-black'
  }

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
      <div className="flex flex-col items-center justify-center py-1.5 px-2.5 rounded-xl border bg-emerald-50 border-emerald-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-emerald-700">✓ OK</span>
      </div>
    )
    if (status === 'NOT APPROVED') return (
      <div className="flex flex-col items-center justify-center py-1.5 px-2.5 rounded-xl border bg-rose-50 border-rose-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-rose-400 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-rose-700">✗ No</span>
      </div>
    )
    if (status === 'HELD') return (
      <div className="flex flex-col items-center justify-center py-1.5 px-2.5 rounded-xl border bg-amber-50 border-amber-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-amber-500 mb-0.5">{label}</span>
        <span className="text-[9px] font-black text-amber-700">‖ Hold</span>
      </div>
    )
    return (
      <div className="flex flex-col items-center justify-center py-1.5 px-2.5 rounded-xl border bg-slate-100 border-slate-200 text-center">
        <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mb-0.5">{label}</span>
        <span className="text-[9px] font-semibold text-slate-400">—</span>
      </div>
    )
  }

  return (
    <MainLayout title="Approvals" subtitle="Manage payment requests and multi-stage approval workflows">
      <div className="space-y-6 max-w-full overflow-x-hidden">



        {/* Clean, modern single navigation tab bar */}
        <div className="border-b border-slate-100 pb-1">
          <div className="flex items-center gap-6 text-sm font-bold overflow-x-auto whitespace-nowrap scrollbar-none pb-2 w-full">
            <button
              onClick={() => {
                setFilterScope('pending')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'pending' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>Pending My Approval ({pendingForMeCount})</span>
              {mainSubView === 'requests' && filterScope === 'pending' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('all')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'all' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>All Requests ({activeRequestsCount})</span>
              {mainSubView === 'requests' && filterScope === 'all' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('sent_back')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 flex items-center gap-1.5 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'sent_back' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>Sent Back Orders</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold shadow-2xs transition-all ${
                sentBackCount > 0 
                  ? 'bg-amber-600 text-white shadow-amber-500/30' 
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {sentBackCount}
              </span>
              {mainSubView === 'requests' && filterScope === 'sent_back' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('md_remarks')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 flex items-center gap-1.5 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'md_remarks' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>MD Remarks</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold shadow-2xs transition-all ${
                mdRemarksCount > 0 
                  ? 'bg-rose-600 text-white shadow-rose-500/30 animate-pulse' 
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {mdRemarksCount}
              </span>
              {mainSubView === 'requests' && filterScope === 'md_remarks' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('rejected')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 flex items-center gap-1.5 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'rejected' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>Rejected Orders</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold shadow-2xs transition-all ${
                rejectedCount > 0 
                  ? 'bg-rose-600 text-white shadow-rose-500/30' 
                  : 'bg-slate-200 text-slate-600'
              }`}>
                {rejectedCount}
              </span>
              {mainSubView === 'requests' && filterScope === 'rejected' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => setMainSubView('completed_spend')}
              className={`pb-2.5 relative transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0 ${
                mainSubView === 'completed_spend' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>Completed &amp; Paid Orders ({completedPaymentsList.length})</span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black px-1.5 py-0.5 rounded-full">
                ₹{totalCompletedSpend.toLocaleString('en-IN')}
              </span>
              {mainSubView === 'completed_spend' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('vendors')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'vendors' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>Vendors ({vendorSummary.length})</span>
              {mainSubView === 'requests' && filterScope === 'vendors' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
            <button
              onClick={() => {
                setFilterScope('gl_categories')
                setMainSubView('requests')
              }}
              className={`pb-2.5 relative transition-all flex-shrink-0 cursor-pointer ${
                mainSubView === 'requests' && filterScope === 'gl_categories' ? 'text-teal-700 font-black' : 'text-slate-400 hover:text-slate-600 font-bold'
              }`}
            >
              <span>GL Categories ({glSummary.length})</span>
              {mainSubView === 'requests' && filterScope === 'gl_categories' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--dashboard-action-bg)] rounded-full" />
              )}
            </button>
          </div>
        </div>

        {mainSubView === 'completed_spend' ? (
          <div className="space-y-6">
            {/* Header: Back & Export Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setMainSubView('requests')}
                className="h-9 px-4 rounded-xl border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-extrabold flex items-center gap-2 shadow-2xs cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4 text-slate-600" />
                <span>← Back to Active Workflow Requests</span>
              </Button>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold font-sans">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Total Paid: <span className="font-black tabular-nums">₹{totalCompletedSpend.toLocaleString('en-IN')}</span> ({completedPaymentsList.length} Orders)
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    const ids = completedPaymentsList.map(r => r.id)
                    if (ids.length === 0) {
                      toast({ title: 'No completed requests', description: 'There are no completed requests to export.', variant: 'error' })
                      return
                    }
                    window.open(`/api/brands/kia/approvals/export-tally?ids=${ids.join(',')}`, '_blank')
                  }}
                  className="h-9 px-3.5 rounded-xl border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-extrabold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  <span>Export Paid CSV</span>
                </Button>
              </div>
            </div>

            {/* 1. Executive Summary Cards (4 Cards) */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Approved &amp; Paid Spend</span>
                  <div className="h-8 w-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <IndianRupee className="w-4 h-4" />
                  </div>
                </div>
                <span className="text-2xl font-black text-emerald-700 mt-2 block tracking-tight font-sans tabular-nums">₹{totalCompletedSpend.toLocaleString('en-IN')}</span>
                <span className="text-[11px] font-semibold text-slate-400 block mt-0.5">Sum of all completed payments</span>
              </div>

              <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Completed Transactions</span>
                  <div className="h-8 w-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                </div>
                <span className="text-2xl font-black text-slate-900 mt-2 block tracking-tight font-sans tabular-nums">{completedPaymentsList.length}</span>
                <span className="text-[11px] font-semibold text-slate-400 block mt-0.5">Disbursed &amp; verified orders</span>
              </div>

              <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Average Payment Value</span>
                  <div className="h-8 w-8 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <Layers className="w-4 h-4" />
                  </div>
                </div>
                <span className="text-2xl font-black text-indigo-600 mt-2 block tracking-tight font-sans tabular-nums">₹{Math.round(avgCompletedSpend).toLocaleString('en-IN')}</span>
                <span className="text-[11px] font-semibold text-slate-400 block mt-0.5">Per transaction average</span>
              </div>

              <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Top Spend Category</span>
                  <div className="h-8 w-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                </div>
                <span className="text-lg font-black text-slate-900 mt-2 block truncate">{spendByApprovalType[0]?.type || 'N/A'}</span>
                <span className="text-[11px] font-bold text-emerald-600 block mt-0.5 font-sans">
                  {spendByApprovalType[0] ? `₹${spendByApprovalType[0].total.toLocaleString('en-IN')} (${spendByApprovalType[0].count} orders)` : 'No transactions'}
                </span>
              </div>
            </div>

            {/* 2. Toolbar: Filters & Date presets */}
            <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-4 space-y-3">
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                {/* Date presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-1.5">Date Presets:</span>
                  {[
                    { id: 'this_month', label: 'This Month' },
                    { id: 'today', label: 'Today' },
                    { id: 'this_week', label: 'This Week' },
                    { id: 'this_quarter', label: 'This Quarter' },
                    { id: 'all', label: 'All Time' },
                    { id: 'custom', label: 'Custom Range' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setCompletedDatePreset(preset.id as any)
                        setCompletedPage(1)
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer',
                        completedDatePreset === preset.id
                          ? 'bg-[var(--dashboard-action-bg)] text-white shadow-2xs font-extrabold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Search & dropdown filters */}
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <div className="relative flex-1 sm:w-[240px]">
                    <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      value={completedSearch}
                      onChange={(e) => {
                        setCompletedSearch(e.target.value)
                        setCompletedPage(1)
                      }}
                      placeholder="Search by ID, Requester, Vendor, UTR..."
                      className="pl-9 h-9 text-xs rounded-xl border-slate-200"
                    />
                  </div>
                  <select
                    value={completedTypeFilter}
                    onChange={(e) => {
                      setCompletedTypeFilter(e.target.value)
                      setCompletedPage(1)
                    }}
                    className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="All">All Payment Types</option>
                    {completedApprovalTypes.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    value={completedDeptFilter}
                    onChange={(e) => {
                      setCompletedDeptFilter(e.target.value)
                      setCompletedPage(1)
                    }}
                    className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="All">All Departments</option>
                    {uniqueDepartments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={completedLocationFilter}
                    onChange={(e) => {
                      setCompletedLocationFilter(e.target.value)
                      setCompletedPage(1)
                    }}
                    className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    <option value="All">All Branches</option>
                    {uniqueLocations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowSpendBreakdown(prev => !prev)}
                    className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all"
                  >
                    <PieChart className="w-3.5 h-3.5 text-slate-500" />
                    <span>Categories ({spendByApprovalType.length})</span>
                    <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", showSpendBreakdown && "rotate-180")} />
                  </button>
                </div>
              </div>

              {/* Custom Date Pickers */}
              {completedDatePreset === 'custom' && (
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-3 flex flex-wrap items-center gap-4">
                  <span className="text-xs font-bold text-slate-700">Custom Date Range:</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">From:</span>
                    <input
                      type="date"
                      value={istDayKey(completedStartDate)}
                      onChange={(e) => {
                        setCompletedStartDate(e.target.value ? new Date(e.target.value) : null)
                        setCompletedPage(1)
                      }}
                      className="h-8 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">To:</span>
                    <input
                      type="date"
                      value={istDayKey(completedEndDate)}
                      onChange={(e) => {
                        setCompletedEndDate(e.target.value ? new Date(e.target.value) : null)
                        setCompletedPage(1)
                      }}
                      className="h-8 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold"
                    />
                  </div>
                  {(completedStartDate || completedEndDate) && (
                    <button
                      type="button"
                      onClick={() => { setCompletedStartDate(null); setCompletedEndDate(null); setCompletedPage(1); }}
                      className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear dates
                    </button>
                  )}
                </div>
              )}

              {/* Collapsible Spend Breakdown */}
              {showSpendBreakdown && (
                <div className="pt-2 border-t border-slate-100">
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {spendByApprovalType.map((item) => (
                      <div key={item.type} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <p className="text-xs font-bold text-slate-900 truncate">{item.type}</p>
                          <p className="text-[10px] font-semibold text-slate-400">{item.count} order{item.count !== 1 ? 's' : ''}</p>
                        </div>
                        <p className="text-xs font-black text-emerald-700 font-sans tabular-nums whitespace-nowrap">₹{item.total.toLocaleString('en-IN')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Completed Payments Table */}
            <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="bg-[#004e5a] text-white border-b border-[#003c46] text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                      <th scope="col" className="py-3 px-3.5 w-10 text-center">#</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Request No.</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Requester</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Department</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Dealer Name</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Vendor &amp; Purpose</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Amount (₹)</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Branch</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Paid Date</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">UTR / Txn Ref</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Status</th>
                      <th scope="col" className="py-3 px-3.5 text-right text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                    {paginatedCompletedRows.map((row, idx) => {
                      const displaySeqNo = (completedPage - 1) * completedRowsPerPage + idx + 1
                      const numberBadge = getNumberBadgeClass(displaySeqNo)
                      const paymentDate = row.paymentCompletedAt || row.updatedAt || row.createdAt

                      return (
                        <tr
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open completed request from ${row.name} for ₹${Number(row.amount || 0).toLocaleString('en-IN')}`}
                          onClick={() => setDetailRow(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setDetailRow(row)
                            }
                          }}
                          className="odd:bg-white even:bg-slate-50/80 hover:bg-teal-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full border text-[10px] font-black tabular-nums ${numberBadge}`}>
                              {displaySeqNo}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            {row.requestNo ? (
                              <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 font-sans text-xs font-bold tracking-wide shadow-2xs ${getBranchChipClass(row)}`}>
                                {row.requestNo}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-medium">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5 items-start">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-950 font-black text-xs">{row.name}</span>
                                <span className={`inline-block border px-1.5 py-0.2 rounded text-[8.5px] font-black tracking-wider uppercase ${getBrandBadgeClass(row.brand || '')}`}>
                                  {row.brand || '—'}
                                </span>
                              </div>
                              <span className="text-slate-500 font-semibold text-[10.5px]">{row.email}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <span className={`inline-block border px-2.5 py-1 rounded-full text-[9px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs ${getDeptBadgeClass(row.department || '')}`}>
                              {row.department || '—'}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap max-w-[160px]" title={row.dealerName || '—'}>
                            <span className={`inline-flex items-center max-w-full truncate rounded-lg border px-2.5 py-1 text-xs font-black shadow-2xs ${getBranchChipClass(row)}`}>
                              {row.dealerName || '—'}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-xs text-slate-800 max-w-[220px]" title={row.vendorName || row.remarks || '—'}>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-black text-slate-900 truncate">{row.vendorName || row.name}</span>
                              <span className="text-[10.5px] font-semibold text-slate-500 truncate">{row.approvalType || row.remarks || 'General Payment'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-lg px-2.5 py-1 font-black text-xs sm:text-sm font-sans tracking-tight tabular-nums border shadow-2xs ${getAmountBandClass(Number(row.amount || 0))}`}>
                              ₹{Number(row.amount || 0).toLocaleString('en-IN')}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="text-xs font-black leading-tight text-slate-900">
                                {row.location || '—'}
                              </span>
                              {row.dealerCode ? (
                                <span className="inline-block rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-sans font-bold text-slate-600">
                                  {row.dealerCode}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="text-slate-900 font-black text-xs block">
                                {istDate(paymentDate)}
                              </span>
                              <span className="text-slate-500 text-[10.5px] font-semibold">
                                {istTime(paymentDate)}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap max-w-[160px]">
                            {row.utrNumber ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold font-sans tabular-nums" title={`UTR: ${row.utrNumber}`}>
                                UTR: {row.utrNumber}
                              </span>
                            ) : row.invoiceNumber ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-xs font-bold" title={`Invoice: ${row.invoiceNumber}`}>
                                Inv: {row.invoiceNumber}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-medium">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <span data-status="paid" className="bg-emerald-100 text-emerald-900 border border-emerald-300 approval-status-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                              <Check className="w-3 h-3 text-emerald-700" />
                              PAID
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1 justify-end">
                              <button
                                type="button"
                                title="Print payment order voucher"
                                onClick={() => printPaymentOrder(row)}
                                className="h-7 w-7 rounded-lg border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-2xs cursor-pointer"
                              >
                                <Printer className="w-3.5 h-3.5 text-slate-600" />
                              </button>
                              <button
                                type="button"
                                title="View payment request details"
                                onClick={() => setDetailRow(row)}
                                className="h-7 w-7 rounded-lg border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-2xs cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-600" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {completedPaymentsList.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-12 text-center text-slate-400 font-semibold space-y-2">
                          <FileSpreadsheet className="w-8 h-8 mx-auto text-slate-300" />
                          <p className="text-sm font-bold text-slate-700">No completed payments found</p>
                          <p className="text-xs text-slate-400">There are no completed &amp; paid vendor payments matching the selected filters.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              {completedPaymentsList.length > 0 && (
                <div className="bg-slate-50/80 px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-600 font-semibold">
                    <span>
                      Showing <span className="font-black text-slate-900 font-sans">{(completedPage - 1) * completedRowsPerPage + 1}</span> to <span className="font-black text-slate-900 font-sans">{Math.min(completedPage * completedRowsPerPage, completedPaymentsList.length)}</span> of <span className="font-black text-slate-900 font-sans">{completedPaymentsList.length}</span> completed orders
                    </span>
                    <span className="text-slate-300">|</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">Rows per page:</span>
                      <select
                        value={completedRowsPerPage}
                        onChange={(e) => {
                          setCompletedRowsPerPage(Number(e.target.value))
                          setCompletedPage(1)
                        }}
                        className="h-7 px-2 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 cursor-pointer"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={completedPage <= 1}
                      onClick={() => setCompletedPage(p => Math.max(1, p - 1))}
                      className="h-8 px-3 rounded-lg border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold disabled:opacity-40 cursor-pointer shadow-2xs"
                    >
                      Previous
                    </Button>
                    <span className="px-2.5 font-bold text-slate-700">
                      Page {completedPage} of {totalCompletedPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={completedPage >= totalCompletedPages}
                      onClick={() => setCompletedPage(p => Math.min(totalCompletedPages, p + 1))}
                      className="h-8 px-3 rounded-lg border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold disabled:opacity-40 cursor-pointer shadow-2xs"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <React.Fragment>
        {/* 1. TOP METRICS STRIP */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div 
            onClick={() => {
              setFilterScope('all')
              setMainSubView('requests')
            }}
            className="hidden sm:block cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
            title="View All Active Requests"
          >
            <KpiCard
              title="TOTAL REQUESTS"
              value={totalCount}
              subtitle={`All time${scopeSuffix}`}
              icon={FileText}
              colorScheme="purple"
              chartType="area"
              chartData={[10, 25, 20, 45, 30, 65, 55, 80]}
              trend={{ value: '+18%', isPositive: true, label: 'vs last month' }}
            />
          </div>
          <div
            onClick={() => {
              setFilterScope('pending')
              setMainSubView('requests')
            }}
            className="cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
            title="View Pending Approvals"
          >
            <KpiCard
              title="PENDING APPROVALS"
              value={pendingForMeCount}
              subtitle={`Awaiting your action${scopeSuffix}`}
              icon={Clock}
              colorScheme="amber"
              chartType="bar"
              chartData={[15, 30, 20, 50, 35, 75, 40, 20]}
              trend={{ value: '+12%', isPositive: true, label: 'vs last month' }}
            />
          </div>
          <div
            onClick={() => setMainSubView('completed_spend')}
            className="hidden sm:block cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
            title="View Completed & Paid Orders"
          >
            <KpiCard
              title="APPROVED VOLUME"
              value={`₹${approvedVolume.toLocaleString('en-IN')}`}
              subtitle={`This year${scopeSuffix}`}
              icon={IndianRupee}
              colorScheme="emerald"
              chartType="area"
              chartData={[20, 35, 50, 40, 60, 55, 75, 90]}
              trend={{ value: '+24%', isPositive: true, label: 'vs last month' }}
            />
          </div>
          <div
            onClick={() => {
              setFilterScope('rejected')
              setMainSubView('requests')
            }}
            className="hidden sm:block cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
            title="View Rejected Orders"
          >
            <KpiCard
              title="REJECTED"
              value={rejectedCount}
              subtitle={`All time${scopeSuffix}`}
              icon={XCircle}
              colorScheme="rose"
              chartType="area"
              chartData={[15, 55, 25, 70, 30, 85, 45, 90]}
              trend={{ value: '0%', isPositive: true, label: 'vs last month' }}
            />
          </div>
        </div>



        {/* 2. FILTER BAR */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search requests..."
              className="pl-11 h-10 w-full rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedBrand}
              onChange={e => setSelectedBrand(e.target.value)}
              className="h-10 px-4 w-full sm:w-[150px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Brands</option>
              {BRAND_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select
              value={selectedDepartment}
              onChange={e => setSelectedDepartment(e.target.value)}
              className="h-10 px-4 w-full sm:w-[150px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Departments</option>
              {uniqueDepartments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select
              value={selectedGlFilter}
              onChange={e => setSelectedGlFilter(e.target.value)}
              className="h-10 px-4 w-full sm:w-[180px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All GL Accounts</option>
              {glAccounts.map(g => (
                <option key={g.id} value={g.id}>
                  {g.glName} ({g.glCode})
                </option>
              ))}
            </select>

            {/* Custom Date Range Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setCalendarOpen(prev => !prev)}
                className={`h-10 px-4 w-full sm:w-auto rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer flex items-center justify-between gap-2 transition-all ${
                  startDate ? 'border-[var(--dashboard-primary)] bg-teal-50/50 text-[var(--dashboard-primary)]' : ''
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
                    className="hover:bg-teal-100 p-0.5 rounded-full"
                  >
                    <X className="w-3 h-3 text-[var(--dashboard-primary)]" />
                  </span>
                )}
              </button>

              {calendarOpen && (
                <div className="absolute left-0 sm:left-auto sm:right-0 top-12 z-50 w-[320px] bg-white border border-slate-200 rounded-3xl shadow-[0_20px_50px_rgba(15,23,42,0.15)] p-4 space-y-4">
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
                      {istMonthYear(currentMonth)}
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

                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <span>Mo</span>
                    <span>Tu</span>
                    <span>We</span>
                    <span>Th</span>
                    <span>Fr</span>
                    <span>Sa</span>
                    <span>Su</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {daysInMonth.map((day, idx) => {
                      const isSelectedStart = startDate && day.date.toDateString() === startDate.toDateString()
                      const isSelectedEnd = endDate && day.date.toDateString() === endDate.toDateString()
                      const isInRange = startDate && endDate && day.date > startDate && day.date < endDate

                      let cellClass = "h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 text-xs flex items-center justify-center rounded-xl transition-all cursor-pointer "
                      if (isSelectedStart) {
                        cellClass += "bg-[var(--dashboard-action-bg)] text-white font-black"
                      } else if (isSelectedEnd) {
                        cellClass += "bg-[var(--dashboard-action-bg)] text-white font-black"
                      } else if (isInRange) {
                        cellClass += "bg-teal-50 text-teal-900 font-bold"
                      } else if (day.isCurrentMonth) {
                        cellClass += "text-slate-800 hover:bg-slate-50 font-semibold"
                      } else {
                        cellClass += "text-slate-300 hover:bg-slate-50/50"
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
                                setCalendarOpen(false)
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

                  <div className="flex justify-between items-center border-t border-slate-100 pt-3">
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
                      className="text-[10px] font-black uppercase tracking-wider px-3.5 py-1.5 bg-[var(--dashboard-action-bg)] text-white rounded-xl hover:bg-teal-800"
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
              className="h-10 px-4 w-full sm:w-[180px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--dashboard-primary)] bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Workflow States</option>
              {/* Ordered to follow the real chain: Stage 1 → HR → EA → MD → Accounts → Payment.
                  Accounts used to sit above EA/MD, which read as though it came first.
                  Stage 1 is relabelled because this option matches ED, VP and GSM alike — that is
                  what getActiveStageKey('sales_manager') covers. */}
              <option value="pending_sales_manager">Pending ED / VP / GSM</option>
              <option value="pending_hr">Pending HR</option>
              <option value="pending_ea">Pending EA</option>
              <option value="pending_md">Pending MD</option>
              <option value="pending_accounts">Pending Accounts</option>
              <option value="pending_payment">Pending Payment</option>
              <option value="paid">Paid Cases</option>
              <option value="completed">Completed (All Approved)</option>
              <option value="on_hold">On Hold</option>
              <option value="sent_back">Sent Back / Clarification</option>
              <option value="rejected">Rejected Cases</option>
            </select>

            {/* Active Filters count button */}
            <button
              type="button"
              className="h-10 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5"
            >
              <span>Filters</span>
              <span className="bg-[var(--dashboard-action-bg)] text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {activeFiltersCount}
              </span>
            </button>

          </div>
          </div>

          {/* Row 2: Action buttons */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 w-full">
            <Button
              variant="outline"
              onClick={() => {
                const approvedIds = (data?.rows || [])
                  .filter((r: any) => r.managementApproval === 'APPROVED' || getPendingStageLabel(r) === 'Paid' || getPendingStageLabel(r) === 'Pending Payment')
                  .map((r: any) => r.id)
                if (approvedIds.length === 0) {
                  toast({ title: 'No approved requests', description: 'There are no fully approved requests to export.', variant: 'error' })
                  return
                }
                window.open(`/api/brands/kia/approvals/export-tally?ids=${approvedIds.join(',')}`, '_blank')
              }}
              className="h-9 px-4 rounded-2xl border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center gap-1.5 text-xs font-bold"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export Tally CSV</span>
            </Button>

            <Button
              variant="outline"
              onClick={() => setShowAnalytics(!showAnalytics)}
              className={cn(
                "h-9 px-4 rounded-2xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-all",
                showAnalytics
                  ? "bg-[var(--dashboard-action-bg)] border-[var(--dashboard-primary)] text-white hover:bg-teal-800"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{showAnalytics ? 'Hide Analytics' : 'Show Analytics'}</span>
            </Button>

            <div className="flex-1" />

            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading || isFetching} className="h-9 w-9 rounded-2xl border-slate-200 flex-shrink-0">
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <RefreshCw className="w-4 h-4 text-slate-500" />}
            </Button>
          </div>
        </div>

        {/* Analytics Dashboard */}
        {showAnalytics && (
          <div className="space-y-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 border border-slate-100 rounded-[2rem] p-6 shadow-sm animate-in fade-in duration-300">
              {/* Left Column (KPI Cards) */}
              <div className="md:col-span-1 space-y-4">
                <div className="bg-white rounded-3xl p-5 border border-slate-100/80 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">MD Approved Spend</span>
                  <span className="text-2xl font-black text-slate-900 mt-2">₹{analyticsData.totalApproved.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-emerald-600 mt-2 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> {analyticsData.approvedCount} request{analyticsData.approvedCount !== 1 ? 's' : ''} approved by MD
                  </span>
                </div>
                <div className="bg-white rounded-3xl p-5 border border-slate-100/80 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Still In Workflow</span>
                  <span className="text-2xl font-black text-amber-600 mt-2">₹{analyticsData.totalPending.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-slate-400 mt-2">{analyticsData.pendingCount} request{analyticsData.pendingCount !== 1 ? 's' : ''} awaiting approval</span>
                </div>
                <div className="bg-white rounded-3xl p-5 border border-slate-100/80 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg Transaction Size</span>
                  <span className="text-2xl font-black text-teal-700 mt-2">₹{Math.round(analyticsData.avgTxSize).toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-slate-400 mt-2">Across all {analyticsData.totalCount} requests</span>
                </div>
              </div>

              {/* Middle Column (Top 5 Vendors Chart) */}
              <div className="md:col-span-1 bg-white rounded-[2rem] p-6 border border-slate-150 shadow-[0_10px_30px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 mb-4">Top 5 Vendors Spend</h4>
                  <div className="space-y-4">
                    {analyticsData.topVendors.length === 0 ? (
                      <p className="text-xs text-slate-400 font-semibold text-center py-10">No vendor spend data.</p>
                    ) : (
                      (() => {
                        const maxSpend = Math.max(...analyticsData.topVendors.map(v => v.total), 1)
                        return analyticsData.topVendors.map((vendor, idx) => {
                          const pct = Math.round((vendor.total / maxSpend) * 100)
                          return (
                            <div key={`${vendor.name}-${idx}`} className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-700">
                                <span className="truncate max-w-[140px]" title={vendor.name}>{vendor.name}</span>
                                <span className="font-mono text-slate-900">₹{vendor.total.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[var(--dashboard-action-bg)] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })
                      })()
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column (Top 5 GL Accounts Chart) */}
              <div className="md:col-span-1 bg-white rounded-[2rem] p-6 border border-slate-150 shadow-[0_10px_30px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-900 mb-4">Top 5 GL Accounts Spend</h4>
                  <div className="space-y-4">
                    {analyticsData.topGlAccounts.length === 0 ? (
                      <p className="text-xs text-slate-400 font-semibold text-center py-10">No GL spend data.</p>
                    ) : (
                      (() => {
                        const gls = analyticsData.topGlAccounts.slice(0, 5)
                        const maxSpend = Math.max(...gls.map(g => g.total), 1)
                        return gls.map((gl, idx) => {
                          const pct = Math.round((gl.total / maxSpend) * 100)
                          return (
                            <div key={`${gl.name}-${idx}`} className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-700">
                                <span className="truncate max-w-[120px]">{gl.name}</span>
                                <span className="font-mono text-slate-900">₹{gl.total.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          )
                        })
                      })()
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Key GL Categories Spend Highlights Row */}
            <div className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm grid grid-cols-2 sm:grid-cols-5 gap-4">
              {[
                { name: 'Advertisement Spend', value: analyticsData.spendHighlights.adSpend, color: 'bg-rose-50 border-rose-100 text-rose-700' },
                { name: 'Repairs & Maintenance', value: analyticsData.spendHighlights.repairSpend, color: 'bg-blue-50 border-blue-100 text-blue-700' },
                { name: 'Fuel & Running', value: analyticsData.spendHighlights.fuelSpend, color: 'bg-amber-50 border-amber-100 text-amber-700' },
                { name: 'Salaries & Wages', value: analyticsData.spendHighlights.salarySpend, color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                { name: 'Security Charges', value: analyticsData.spendHighlights.securitySpend, color: 'bg-indigo-50 border-indigo-100 text-indigo-700' },
                { name: 'Vehicle Purchases', value: analyticsData.spendHighlights.vehiclePurchase, color: 'bg-purple-50 border-purple-100 text-purple-700' },
                { name: 'Spare Parts Purchase', value: analyticsData.spendHighlights.partsPurchase, color: 'bg-pink-50 border-pink-100 text-pink-700' },
                { name: 'Travel & Conveyance', value: analyticsData.spendHighlights.travelSpend, color: 'bg-sky-50 border-sky-100 text-sky-700' },
                { name: 'Software Subscriptions', value: analyticsData.spendHighlights.softwareSpend, color: 'bg-teal-50 border-teal-100 text-teal-700' },
                { name: 'Professional Charges', value: analyticsData.spendHighlights.professionalSpend, color: 'bg-violet-50 border-violet-100 text-violet-700' },
              ].map(cat => (
                <div key={cat.name} className={`border rounded-2xl p-4 flex flex-col justify-between ${cat.color}`}>
                  <span className="text-[9px] font-black uppercase tracking-wider opacity-80">{cat.name}</span>
                  <span className="text-sm font-black mt-1 font-mono">₹{cat.value.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          </div>
        )}



        {/* 3. APPROVALS TABLE LIST */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-slate-900" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Requests Queue...</span>
          </div>
        ) : filterScope === 'vendors' ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#004e5a] text-white border-b border-[#003c46] text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                    <th scope="col" className="py-3.5 px-6 w-16 text-white font-black">#</th>
                    <th scope="col" className="py-3.5 px-6 text-white font-black">Vendor Name</th>
                    <th scope="col" className="py-3.5 px-6 text-center text-white font-black">Transactions</th>
                    <th scope="col" className="py-3.5 px-6 text-right text-white font-black">Total Spend (₹)</th>
                    <th scope="col" className="py-3.5 px-6 text-right text-white font-black">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorSummary.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 text-xs font-semibold">
                        No vendors found.
                      </td>
                    </tr>
                  ) : (
                    vendorSummary.map((v, idx) => (
                      <tr
                        key={`${v.name}-${idx}`}
                        onClick={() => {
                          setVendorStartDate('')
                          setVendorEndDate('')
                          setSelectedVendorMonth('all')
                          setSelectedVendorName(v.name)
                        }}
                        className="border-b border-slate-100 last:border-0 hover:bg-teal-50/50 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-6 font-mono font-bold text-slate-600">
                          {idx + 1}
                        </td>
                        <td className="py-4 px-6 font-black text-slate-900">
                          {v.name}
                        </td>
                        <td className="py-4 px-6 text-center font-bold text-slate-700">
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-black">
                            {v.count}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right font-mono font-black text-sm text-slate-900">
                          ₹{v.total.toLocaleString('en-IN')}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            type="button"
                            className="text-xs font-black text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg border border-teal-200 transition-colors cursor-pointer"
                          >
                            View Ledger
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : filterScope === 'gl_categories' ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-slate-400">GL Categories Summary</span>
              <button
                type="button"
                onClick={() => setShowAddGlDialog(true)}
                className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                Add GL Category
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#004e5a] text-white border-b border-[#003c46] text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                    <th scope="col" className="py-3.5 px-6 w-16 text-white font-black">#</th>
                    <th scope="col" className="py-3.5 px-6 text-white font-black">GL Code</th>
                    <th scope="col" className="py-3.5 px-6 text-white font-black">GL Category Name</th>
                    <th scope="col" className="py-3.5 px-6 text-center text-white font-black">Transactions</th>
                    <th scope="col" className="py-3.5 px-6 text-right text-white font-black">Total Spend (₹)</th>
                    <th scope="col" className="py-3.5 px-6 text-right text-white font-black">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {glSummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400 text-xs font-semibold">
                        No GL categories found.
                      </td>
                    </tr>
                  ) : (
                    glSummary.map((g, idx) => (
                      <tr
                        key={g.id || idx}
                        onClick={() => {
                          setGlStartDate('')
                          setGlEndDate('')
                          setSelectedGlMonth('all')
                          setSelectedGlName(g.name)
                        }}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {idx + 1}
                        </td>
                        <td className="py-4 px-6 font-mono text-xs font-bold text-slate-500">
                          {g.code}
                        </td>
                        <td className="py-4 px-6 font-bold text-slate-900">
                          {g.name}
                        </td>
                        <td className="py-4 px-6 text-center font-bold text-slate-600">
                          {g.count}
                        </td>
                        <td className="py-4 px-6 text-right font-black text-slate-950 text-base">
                          {g.total.toLocaleString('en-IN')}
                        </td>
                        <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setGlStartDate('')
                              setGlEndDate('')
                              setSelectedGlMonth('all')
                              setSelectedGlName(g.name)
                            }}
                            className="h-8 px-3.5 rounded-xl border border-slate-200 hover:border-slate-400 bg-white text-xs font-bold text-slate-700 transition-all shadow-sm"
                          >
                            View Ledger
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : totalRows === 0 ? (
          <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center space-y-3 shadow-[0_10px_30px_rgba(15,23,42,0.01)]">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">No Requests Found</h3>
            <p className="text-xs text-slate-400 font-semibold max-w-sm mx-auto">There are no vendor payment requests matching your active filter criteria.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Desktop View: Table Layout (visible sm and up) */}
            <div className="hidden sm:block bg-white rounded-[2rem] border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="bg-[#004e5a] text-white border-b border-[#003c46] text-[10px] font-black uppercase tracking-wider whitespace-nowrap">
                      <th scope="col" className="py-3 px-3.5 w-8">
                        <input
                          type="checkbox"
                          checked={selectedRequestIds.length > 0 && paginatedRows.filter(r => getIsPendingForUser(r)).length > 0 && selectedRequestIds.length === paginatedRows.filter(r => getIsPendingForUser(r)).length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const approvableIds = paginatedRows
                                .filter(r => getIsPendingForUser(r))
                                .map(r => r.id)
                              setSelectedRequestIds(approvableIds)
                            } else {
                              setSelectedRequestIds([])
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer accent-teal-600"
                        />
                      </th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Request No.</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Requester</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Department</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Dealer Name</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Purpose / Request Type</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Amount (₹)</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Branch</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Submitted On</th>
                      <th scope="col" className="py-3 px-3.5 text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Status</th>
                      <th scope="col" className="py-3 px-3.5 text-right text-white font-black text-[10px] tracking-wider uppercase whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                    {paginatedRows.map((row, idx) => {
                      const displaySeqNo = dbRowIndexMap.get(row.id) ?? ((currentPage - 1) * rowsPerPage + idx + 1)
                      const numberBadge = getNumberBadgeClass(displaySeqNo)
                      const pendingLabel = getPendingStageLabel(row)

                      // Current Stage Display
                      const awaitingDesk = pendingLabel.startsWith('Pending ')
                        && pendingLabel !== 'Pending Payment'
                        ? pendingLabel.replace('Pending ', '')
                        : null

                      // Status Badge Display
                      let statusBadge = (
                        <span data-status="pending" className="bg-amber-100 text-amber-900 border border-amber-300 approval-status-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          PENDING
                        </span>
                      )
                      if (pendingLabel === 'Paid') {
                        statusBadge = (
                          <span data-status="paid" className="bg-emerald-100 text-emerald-900 border border-emerald-300 approval-status-pill inline-block px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                            PAID
                          </span>
                        )
                      } else if (pendingLabel === 'Pending Payment') {
                        statusBadge = (
                          <span data-status="approved" className="bg-teal-100 text-teal-900 border border-teal-300 approval-status-pill inline-block px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                            APPROVED
                          </span>
                        )
                      } else if (pendingLabel === 'Sent Back / Clarification') {
                        statusBadge = (
                          <span data-status="sentback" className="bg-orange-100 text-orange-900 border border-orange-300 approval-status-pill inline-block px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                            SENT BACK
                          </span>
                        )
                      } else if (pendingLabel.startsWith('Rejected')) {
                        statusBadge = (
                          <span data-status="rejected" className="bg-rose-100 text-rose-900 border border-rose-300 approval-status-pill inline-block px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                            REJECTED
                          </span>
                        )
                      } else if (pendingLabel.startsWith('Held')) {
                        statusBadge = (
                          <span data-status="pending" className="bg-slate-200 text-slate-900 border border-slate-300 approval-status-pill inline-block px-2.5 py-1 rounded-full text-[9.5px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs">
                            HELD
                          </span>
                        )
                      }

                      return (
                        <tr
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Open request from ${row.name} for ₹${Number(row.amount || 0).toLocaleString('en-IN')}`}
                          onClick={() => setDetailRow(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setDetailRow(row)
                            }
                          }}
                          className="odd:bg-white even:bg-slate-50/80 dark:odd:bg-transparent dark:even:bg-white/[0.04] hover:bg-teal-50/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-600 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-3.5 w-8" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              disabled={!getIsPendingForUser(row)}
                              checked={selectedRequestIds.includes(row.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedRequestIds(prev => [...prev, row.id])
                                } else {
                                  setSelectedRequestIds(prev => prev.filter(id => id !== row.id))
                                }
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer accent-teal-600"
                            />
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            {row.requestNo ? (
                              <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 font-mono text-xs font-black tracking-wide shadow-2xs ${getBranchChipClass(row)}`}>
                                {row.requestNo}
                              </span>
                            ) : (
                              <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full border text-[10px] font-black tabular-nums ${numberBadge}`}>
                                {displaySeqNo}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5 items-start">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-950 font-black text-xs">{row.name}</span>
                                <span className={`inline-block border px-1.5 py-0.2 rounded text-[8.5px] font-black tracking-wider uppercase ${getBrandBadgeClass(row.brand || '')}`}>
                                  {row.brand || '—'}
                                </span>
                              </div>
                              <span className="text-slate-500 font-semibold text-[10.5px]">{row.email}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <span className={`inline-block border px-2.5 py-1 rounded-full text-[9px] font-black tracking-wider uppercase whitespace-nowrap shadow-2xs ${getDeptBadgeClass(row.department || '')}`}>
                              {row.department || '—'}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap max-w-[170px]" title={row.dealerName || '—'}>
                            <span className={`inline-flex items-center max-w-full truncate rounded-lg border px-2.5 py-1 text-xs font-black shadow-2xs ${getBranchChipClass(row)}`}>
                              {row.dealerName || '—'}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-xs text-slate-800 font-bold max-w-[200px] truncate" title={row.remarks || '—'}>
                            {row.remarks || '—'}
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <span className={`inline-flex items-center rounded-lg px-2.5 py-1 font-black text-xs sm:text-sm font-mono tracking-tight tabular-nums border shadow-2xs ${getAmountBandClass(Number(row.amount || 0))}`}>
                              ₹{Number(row.amount || 0).toLocaleString('en-IN')}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="text-xs font-black leading-tight text-slate-900">
                                {row.location || '—'}
                              </span>
                              {row.dealerCode ? (
                                <span className="inline-block rounded bg-slate-100 border border-slate-200 px-1.5 py-0.2 text-[10px] font-mono font-bold text-slate-600">
                                  {row.dealerCode}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="text-slate-900 font-black text-xs block">
                                {istDate(row.createdAt)}
                              </span>
                              <span className="text-slate-500 text-[10.5px] font-semibold">
                                {istTime(row.createdAt)}
                              </span>
                              {getSlaBadge(row.createdAt)}
                            </div>
                          </td>
                          <td className="py-3 px-3.5 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-1">
                              {statusBadge}
                              {awaitingDesk ? (
                                <span className="flex items-center gap-1.5 pl-0.5 text-[10.5px] font-black text-amber-900">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  with {awaitingDesk}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {/* Complete Action Buttons Group for Approver */}
                              {getIsPendingForUser(row) && (() => {
                                const stageKey = getActiveStageKey(row)
                                if (!stageKey) return null
                                return (
                                  <div className="inline-flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/80 mr-1">
                                    <button
                                      type="button"
                                      title="Approve & Forward Request"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        if (stageKey === 'accounts' || stageKey === 'payment_done') {
                                          setDetailRow(row)
                                          setActionStage(stageKey)
                                          setActionDecision('APPROVE')
                                        } else {
                                          actionMutation.mutate({
                                            id: row.id,
                                            action: 'APPROVE',
                                            stage: stageKey,
                                            remarks: 'Quick approved'
                                          })
                                        }
                                      }}
                                      disabled={actionMutation.isPending}
                                      className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-hover)] text-white cursor-pointer border-none"
                                    >
                                      {actionMutation.isPending && actionMutation.variables?.id === row.id && actionMutation.variables?.action === 'APPROVE' ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <>
                                          <Check className="w-3 h-3" />
                                          <span>Approve</span>
                                        </>
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      title="Send Back to Submitter for Clarification"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDetailRow(row)
                                        setActionStage(stageKey)
                                        setActionDecision('SEND_BACK')
                                      }}
                                      disabled={actionMutation.isPending}
                                      className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all bg-amber-600 hover:bg-amber-700 text-white cursor-pointer border-none"
                                    >
                                      <CornerUpLeft className="w-3 h-3" />
                                      <span>Send Back</span>
                                    </button>

                                    <button
                                      type="button"
                                      title="Reject / Deny Request"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDetailRow(row)
                                        setActionStage(stageKey)
                                        setActionDecision('REJECT')
                                      }}
                                      disabled={actionMutation.isPending}
                                      className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all bg-rose-600 hover:bg-rose-700 text-white cursor-pointer border-none"
                                    >
                                      <X className="w-3 h-3" />
                                      <span>Reject</span>
                                    </button>

                                    <button
                                      type="button"
                                      title="Put Request on Hold"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setDetailRow(row)
                                        setActionStage(stageKey)
                                        setActionDecision('HOLD')
                                      }}
                                      disabled={actionMutation.isPending}
                                      className="h-7 px-2.5 rounded-lg text-[10px] font-black flex items-center justify-center gap-1 shadow-2xs transition-all bg-slate-600 hover:bg-slate-700 text-white cursor-pointer border-none"
                                    >
                                      <Clock className="w-3 h-3" />
                                      <span>Hold</span>
                                    </button>
                                  </div>
                                )
                              })()}

                              <button
                                type="button"
                                title="Print payment order"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  printPaymentOrder(row)
                                }}
                                className="h-7 w-7 rounded-lg border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-sm"
                              >
                                <Printer className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                              {isDeveloper && (
                                <button
                                  type="button"
                                  title="Delete payment order permanently (developer only)"
                                  aria-label={`Delete payment order ${row.requestNo || row.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteOrder(row)
                                  }}
                                  disabled={deleteMutation.isPending}
                                  className="h-7 w-7 rounded-lg border border-rose-200 hover:border-rose-400 bg-white hover:bg-rose-50 flex items-center justify-center transition-all shadow-sm disabled:opacity-40"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailRow(row)
                                }}
                                className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-sm"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailRow(row)
                                }}
                                className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-sm"
                              >
                                <MoreVertical className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile View: Stacked Cards (visible below sm) */}
            <div className="space-y-4 sm:hidden">
              {paginatedRows.map((row, idx) => {
                const displaySeqNo = dbRowIndexMap.get(row.id) ?? ((currentPage - 1) * rowsPerPage + idx + 1)
                const numberBadge = getNumberBadgeClass(displaySeqNo)
                const pendingLabel = getPendingStageLabel(row)
                const isPendingForUser = getIsPendingForUser(row)

                return (
                  <div
                    key={row.id}
                    onClick={() => setDetailRow(row)}
                    className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-4 space-y-3 cursor-pointer hover:border-slate-400 transition-all"
                  >
                    {/* Top Row: Requester Name, Email & Amount */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2.5">
                        {/*
                          * The stable request number, exactly as the desktop table and the detail
                          * drawer show it. This card was still rendering `displaySeqNo` — the
                          * POSITIONAL index — so a request read as "3" on a phone and "KIA_0042" on
                          * a laptop, and the number changed with sorting, filtering and paging.
                          * The seq badge remains only as a fallback for a row with no request_no.
                          */}
                        {row.requestNo ? (
                          <span className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 font-mono text-[11px] font-black tracking-wide text-indigo-900 shrink-0">
                            {row.requestNo}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full border text-[11px] font-black tabular-nums shrink-0 ${numberBadge}`}>
                            {displaySeqNo}
                          </span>
                        )}
                        <div className="flex flex-col items-start gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-950 font-black text-sm">{row.name}</span>
                            <span className={`inline-block border px-1.5 py-0.2 rounded-full text-[8px] font-black tracking-wider uppercase ${getBrandBadgeClass(row.brand || '')}`}>
                              {row.brand || '—'}
                            </span>
                          </div>
                          <span className="text-slate-400 text-[11px] font-semibold">{row.email}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-base font-black text-slate-950 block font-mono">₹{Number(row.amount || 0).toLocaleString('en-IN')}</span>
                        <span className="text-[10px] font-bold text-slate-400 block">{istDate(row.createdAt)}</span>
                      </div>
                    </div>

                    {/* Tags: Department, Payment Type, Approval Type, Status */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`border px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${getDeptBadgeClass(row.department || '')}`}>
                        {row.department || '—'}
                      </span>
                      <span className={`border px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${getPaymentTypeBadgeClass(row.typeOfPayment || '')}`}>
                        {row.typeOfPayment || '—'}
                      </span>
                      <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
                        {row.approvalType || 'General'}
                      </span>
                      {pendingLabel === 'Paid' ? (
                        <span className="bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 rounded-full text-[9.5px] font-black tracking-wider uppercase shadow-2xs">
                          PAID
                        </span>
                      ) : pendingLabel === 'Pending Payment' ? (
                        <span className="bg-teal-100 text-teal-900 border border-teal-300 px-2.5 py-0.5 rounded-full text-[9.5px] font-black tracking-wider uppercase shadow-2xs">
                          APPROVED
                        </span>
                      ) : pendingLabel === 'Sent Back / Clarification' ? (
                        <span className="bg-orange-100 text-orange-900 border border-orange-300 px-2.5 py-0.5 rounded-full text-[9.5px] font-black tracking-wider uppercase shadow-2xs">
                          SENT BACK
                        </span>
                      ) : pendingLabel.startsWith('Rejected') ? (
                        <span className="bg-rose-100 text-rose-900 border border-rose-300 px-2.5 py-0.5 rounded-full text-[9.5px] font-black tracking-wider uppercase shadow-2xs">
                          REJECTED
                        </span>
                      ) : (
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full text-[9.5px] font-black tracking-wider uppercase shadow-2xs">
                          PENDING
                        </span>
                      )}
                      {getSlaBadge(row.createdAt)}
                    </div>

                    {/* Vendor & GL Account Grid */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-50/90 p-3 rounded-2xl border border-slate-200/60 text-xs">
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Vendor / Beneficiary</span>
                        <span className="font-bold text-slate-900 mt-0.5 block truncate" title={row.vendorName || '—'}>{row.vendorName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">GL Account</span>
                        <span className="font-bold text-indigo-700 mt-0.5 block truncate" title={row.glName || '—'}>{row.glName || '—'}</span>
                      </div>
                    </div>

                    {/* Direct Remarks Callout Box on Mobile View (ABOVE Buttons) */}
                    <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-amber-600" />
                          <span>Remarks:</span>
                        </span>
                        <span className="text-[10px] font-bold text-amber-700">Tap card for detail</span>
                      </div>
                      <p className="font-semibold text-slate-800 italic leading-relaxed">
                        "{row.remarks || 'No remarks provided'}"
                      </p>
                      {row.vehicleNumber && (
                        <div className="flex items-center justify-between pt-1 border-t border-amber-200/50 text-[11px]">
                          <span className="font-bold text-amber-900">🚗 Vehicle No:</span>
                          <span className="font-mono font-black text-teal-950 bg-teal-100/80 px-2 py-0.5 rounded-md border border-teal-300">{row.vehicleNumber}</span>
                        </div>
                      )}
                      {Array.isArray(row.history) && row.history.length > 0 && (
                        <div className="pt-1.5 border-t border-amber-200/50 text-[10px] space-y-0.5">
                          <span className="font-black text-slate-500 uppercase tracking-wider">Latest Action Comment:</span>
                          <p className="font-medium text-slate-700">
                            <span className="font-bold text-slate-900">{row.history[row.history.length - 1].user} ({row.history[row.history.length - 1].role}):</span> "{row.history[row.history.length - 1].remarks || 'No comment'}"
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action Bar for Approvers (4-button 2x2 grid on mobile - BELOW Remarks) */}
                    {isPendingForUser && (() => {
                      const stageKey = getActiveStageKey(row)
                      if (!stageKey) return null
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-slate-50 p-2 rounded-2xl border border-slate-200/80" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => {
                              if (stageKey === 'accounts' || stageKey === 'payment_done') {
                                setDetailRow(row)
                                setActionStage(stageKey)
                                setActionDecision('APPROVE')
                              } else {
                                actionMutation.mutate({
                                  id: row.id,
                                  action: 'APPROVE',
                                  stage: stageKey,
                                  remarks: 'Quick approved'
                                })
                              }
                            }}
                            disabled={actionMutation.isPending}
                            className="h-8 px-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 bg-[var(--dashboard-action-bg)] text-white shadow-2xs hover:bg-[var(--dashboard-action-hover)]"
                          >
                            {actionMutation.isPending && actionMutation.variables?.id === row.id && actionMutation.variables?.action === 'APPROVE' ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDetailRow(row)
                              setActionStage(stageKey)
                              setActionDecision('SEND_BACK')
                            }}
                            disabled={actionMutation.isPending}
                            className="h-8 px-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 bg-amber-600 text-white shadow-2xs hover:bg-amber-700"
                          >
                            <CornerUpLeft className="w-3.5 h-3.5" />
                            <span>Send Back</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDetailRow(row)
                              setActionStage(stageKey)
                              setActionDecision('REJECT')
                            }}
                            disabled={actionMutation.isPending}
                            className="h-8 px-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 bg-rose-600 text-white shadow-2xs hover:bg-rose-700"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setDetailRow(row)
                              setActionStage(stageKey)
                              setActionDecision('HOLD')
                            }}
                            disabled={actionMutation.isPending}
                            className="h-8 px-2 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 bg-slate-600 text-white shadow-2xs hover:bg-slate-700"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Hold</span>
                          </button>
                        </div>
                      )
                    })()}

                    {/* Footer: Date Submitted */}
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 pt-1">
                      <span>Submitted On</span>
                      <span className="text-slate-600 font-bold">
                        {istDate(row.createdAt)} at{' '}
                        {istTime(row.createdAt)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white rounded-3xl border border-slate-100 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.02)]">
              <span className="text-xs font-semibold text-slate-500">
                Showing {Math.min((currentPage - 1) * rowsPerPage + 1, totalRows)} to {Math.min(currentPage * rowsPerPage, totalRows)} of {totalRows} requests
              </span>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-full hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-600" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1)
                    .map((page, idx, arr) => {
                      const prevPage = arr[idx - 1]
                      const showEllipsis = prevPage && page - prevPage > 1
                      return (
                        <div key={page} className="flex items-center">
                          {showEllipsis && <span className="text-xs font-bold text-slate-400 px-1">...</span>}
                          <button
                            onClick={() => setCurrentPage(page)}
                            className={`h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-full text-xs font-bold transition-all flex items-center justify-center ${
                              currentPage === page
                                ? 'bg-indigo-600 text-white font-black shadow-md shadow-indigo-600/10'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {page}
                          </button>
                        </div>
                      )
                    })}
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-full hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500 border-l border-slate-100 pl-4">
                  <span>Rows per page</span>
                  <select
                    value={rowsPerPage}
                    onChange={e => setRowsPerPage(Number(e.target.value))}
                    className="h-8 px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-black text-slate-800 cursor-pointer focus:outline-none"
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}
      </React.Fragment>
    )}
    </div>

      {/* 4. DETAIL & ACTION CENTER OVERLAY MODAL */}
      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => { if (!open) setDetailRow(null) }}>
        <DialogContent className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl sm:rounded-[2.5rem] w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] sm:max-w-6xl bg-slate-50 p-0 overflow-hidden shadow-2xl border border-slate-200/80 max-h-[calc(100dvh-1.5rem)] sm:max-h-[92vh] flex flex-col z-50">
          {detailRow && (() => {
            const pendingLabel = getPendingStageLabel(detailRow)
            const isApproved = pendingLabel === 'Fully Approved'
            const isRejected = pendingLabel.startsWith('Rejected')
            const isMD = ['md', 'ceo'].includes(currentUser.role)

            const getTimelineEvents = (req: ApprovalRequest) => {
              const events: Array<{
                id: string
                title: string
                description: string | React.ReactNode
                user: string
                timestamp: Date
                iconType: 'phone' | 'create' | 'clip' | 'remark' | 'approve' | 'reject' | 'hold' | 'gl'
              }> = []

              // 1. Initial Submission
              events.push({
                id: 'create',
                title: 'Request Created',
                description: 'Vendor payment request has been created.',
                user: req.name,
                timestamp: new Date(req.createdAt),
                iconType: 'create'
              })

              // 2. Initial Remarks
              if (req.remarks) {
                events.push({
                  id: 'initial_remark',
                  title: 'Remark Added',
                  description: req.remarks,
                  user: req.name,
                  timestamp: new Date(req.createdAt),
                  iconType: 'remark'
                })
              }

              // 3. Attachments
              // Every bill, not just the first two — submitters can now attach any number.
              getBillUrls(req).forEach((billUrl, billIndex) => {
                events.push({
                  id: `bill-${billIndex}`,
                  title: 'Attachment Added',
                  description: (
                    <button
                      type="button"
                      onClick={() => setPreviewDocUrl(billUrl)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline text-left"
                    >
                      Bill {billIndex + 1}
                    </button>
                  ),
                  user: req.name,
                  timestamp: new Date(req.createdAt),
                  iconType: 'clip'
                })
              })
              if (req.uploadDocUrl) {
                events.push({
                  id: 'doc',
                  title: 'Attachment Added',
                  description: (
                    <button
                      type="button"
                      onClick={() => setPreviewDocUrl(req.uploadDocUrl!)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline text-left"
                    >
                      Support Doc
                    </button>
                  ),
                  user: req.name,
                  timestamp: new Date(req.createdAt),
                  iconType: 'clip'
                })
              }

              if (req.invoiceDocUrl) {
                events.push({
                  id: 'invoice_doc',
                  title: 'Invoice Added',
                  description: (
                    <div className="space-y-1 flex flex-col">
                      <span className="text-[10px] font-bold text-slate-500">Invoice No: {req.invoiceNumber}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewDocUrl(req.invoiceDocUrl!)}
                        className="text-emerald-600 hover:text-emerald-800 font-bold hover:underline text-left text-xs self-start"
                      >
                        View Uploaded Invoice
                      </button>
                    </div>
                  ),
                  user: 'Accounts',
                  timestamp: new Date(req.updatedAt),
                  iconType: 'clip'
                })
              }

              if (req.paymentProofUrl) {
                events.push({
                  id: 'payment_proof_doc',
                  title: 'Payment Proof Added',
                  description: (
                    <div className="space-y-1 flex flex-col">
                      <span className="text-[10px] font-bold text-slate-500">UTR No: {req.utrNumber}</span>
                      <button
                        type="button"
                        onClick={() => setPreviewDocUrl(req.paymentProofUrl!)}
                        className="text-emerald-600 hover:text-emerald-800 font-bold hover:underline text-left text-xs self-start"
                      >
                        View Payment Proof
                      </button>
                    </div>
                  ),
                  user: req.paymentCompletedBy || 'Accounts',
                  timestamp: new Date(req.paymentCompletedAt || req.updatedAt),
                  iconType: 'clip'
                })
              }

              // 4. History Entries
              ;(req.history || []).forEach((entry: any) => {
                let iconType: 'remark' | 'approve' | 'reject' | 'hold' | 'gl' = 'remark'
                let title = 'Remark Added'
                
                if (entry.action === 'APPROVED') {
                  iconType = 'approve'
                  title = `${entry.role} Approved`
                } else if (entry.action === 'NOT APPROVED') {
                  iconType = 'reject'
                  title = `${entry.role} Rejected`
                } else if (entry.action === 'HELD') {
                  iconType = 'hold'
                  title = `${entry.role} Held`
                } else if (entry.action === 'SENT BACK') {
                  iconType = 'reject'
                  title = `${entry.role} Sent Back`
                } else if (entry.action === 'PAID') {
                  iconType = 'approve'
                  title = 'Payment Recorded'
                } else if (entry.action === 'GL_UPDATE') {
                  iconType = 'gl'
                  title = 'GL Account Updated'
                } else if (entry.action === 'REMARK_ADD') {
                  iconType = 'remark'
                  title = 'Remark Added'
                }

                events.push({
                  id: entry.id,
                  title,
                  description: entry.remarks || 'No notes left.',
                  user: entry.user,
                  timestamp: new Date(entry.timestamp),
                  iconType
                })
              })

              return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            }

            const timelineEvents = getTimelineEvents(detailRow)
            const isRemarkEvent = (e: any) => e.iconType === 'remark' || (typeof e.description === 'string' && isRealRemarkText(e.description))
            const remarksCount = timelineEvents.filter(isRemarkEvent).length
            const displayedEvents = activeTab === 'remarks' 
              ? timelineEvents.filter(isRemarkEvent)
              : timelineEvents

            const pendingStageKey = getActiveStageKey(detailRow)

            const isUserEligibleForPendingStage = pendingStageKey ? isUserAuthorizedForStage(pendingStageKey, detailRow) : false

            const handleAddRemark = async () => {
              if (!detailRow || !remarkText.trim()) return
              setAddRemarkPending(true)
              try {
                const response = await fetch(`/api/brands/kia/approvals/${detailRow.id}/remark`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ remarks: remarkText })
                })
                const result = await response.json()
                if (response.ok && result.success) {
                  toast({
                    title: 'Success',
                    description: 'Remark added successfully.',
                    variant: 'success'
                  })
                  setDetailRow(result.row)
                  setRemarkText('')
                  queryClient.invalidateQueries({ queryKey: ['kia', 'approvals'] })
                } else {
                  toast({
                    title: 'Error',
                    description: result.error || 'Failed to add remark.',
                    variant: 'error'
                  })
                }
              } catch (error) {
                console.error(error)
                toast({
                  title: 'Error',
                  description: 'Failed to connect to the server.',
                  variant: 'error'
                })
              } finally {
                setAddRemarkPending(false)
              }
            }

            const renderOverviewItem = (label: string, value: string | React.ReactNode, icon: any, className?: string, key?: string | number) => {
              const Icon = icon
              return (
                <div key={key ?? label} className={cn("border border-slate-100 bg-slate-50/40 rounded-2xl p-4 flex gap-3 items-start", className)}>
                  <div className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-700 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 overflow-hidden flex-1">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">{label}</span>
                    <span className="text-xs font-black text-slate-900 block break-words" title={typeof value === 'string' ? value : undefined}>{value}</span>
                  </div>
                </div>
              )
            }

            const renderChecklistCard = (
              label: string,
              status: string | null,
              stageKey: string,
              roleLabel: string
            ) => {
              const isApproved = status === 'APPROVED'
              const isRejected = status === 'NOT APPROVED'
              const isHeld = status === 'HELD'

              let isActive = false
              if (pendingLabel === 'Pending ED' && stageKey === 'sales_manager') isActive = true
              else if (pendingLabel === 'Pending EA' && stageKey === 'ea') isActive = true
              else if (pendingLabel === 'Pending MD' && stageKey === 'md') isActive = true
              else if (pendingLabel === 'Pending Accounts' && stageKey === 'accounts') isActive = true

              let borderStyle = 'border-slate-100 bg-white opacity-60'
              let badgeText = 'Locked'
              let badgeStyle = 'bg-slate-50 text-slate-400 border-slate-200'
              let nameText = '—'

              if (isApproved) {
                if (stageKey === 'accounts' && detailRow?.invoiceDocUrl) {
                  borderStyle = 'border-slate-200 bg-slate-50/50 shadow-sm'
                  badgeText = 'Paid'
                  badgeStyle = 'bg-slate-900 text-white border-slate-900 font-black shadow-sm'
                } else {
                  borderStyle = 'border-emerald-100 bg-emerald-50/10'
                  badgeText = 'Approved'
                  badgeStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }
              } else if (isRejected) {
                borderStyle = 'border-rose-100 bg-rose-50/10'
                badgeText = 'Rejected'
                badgeStyle = 'bg-rose-50 text-rose-700 border-rose-200'
              } else if (isHeld) {
                borderStyle = 'border-amber-100 bg-amber-50/10'
                badgeText = 'Held'
                badgeStyle = 'bg-amber-50 text-amber-700 border-amber-200'
              } else if (isActive) {
                borderStyle = 'border-blue-100 bg-blue-50/10 ring-2 ring-blue-50'
                badgeText = 'Pending'
                badgeStyle = 'bg-blue-50 text-blue-700 border-blue-200 animate-pulse'
              }

              // Find user name from history
              if (isApproved || isRejected || isHeld) {
                const entry = (detailRow!.history || []).find((h: any) => h.roleKey === stageKey)
                if (entry) nameText = entry.user
              }

              const initials = nameText !== '—'
                ? nameText.split(' ').map((n: string) => n[0]).join('').substring(0, 2).toUpperCase()
                : '—'

              return (
                <div className={cn("border rounded-2xl p-4 space-y-3 flex flex-col justify-between min-h-[110px] transition-all bg-white", borderStyle)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-800">{label}</span>
                    <span className={cn("text-[8px] font-black uppercase px-2 py-0.5 rounded border", badgeStyle)}>{badgeText}</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
                      {initials}
                    </div>
                    <div className="overflow-hidden">
                      <span className="text-[10px] font-black text-slate-800 block truncate" title={nameText}>{nameText}</span>
                      <span className="text-[9px] font-semibold text-slate-400 block">{roleLabel}</span>
                    </div>
                  </div>
                </div>
              )
            }

            const renderNewWorkflowStepper = (req: ApprovalRequest) => {
              const isService = isServiceCategory(req.department, req.approvalType)
              /*
               * Brand-aware: VP is a KIA-service role, every other brand signs off at the GSM — and
               * Hyundai/Platinum service at the ONE Group Service Manager who covers both. Must
               * agree with firstStageDisplayLabel above; the same drawer previously called this desk
               * 'GSM (Service)' here and named it correctly a few lines away.
               */
              const firstStageLabel = brandHasEd(req.brand)
                ? (isService ? 'VP Approval' : 'ED / GSM')
                : (isService
                  ? (usesGroupServiceManager(req.brand) ? 'Group Service Mgr' : 'GSM (Service)')
                  : 'GSM (Sales)')
              const requiresHrStage = isHrApprovalRequired(req.approvalType)
              const stages = [
                { key: 'created', label: 'Created', status: 'APPROVED' },
                { key: 'sales_manager', label: firstStageLabel, status: req.vpApproval },
                ...(requiresHrStage ? [{ key: 'hr', label: 'HR', status: req.hrApproval }] : []),
                { key: 'ea', label: 'EA Review', status: req.eaApproval },
                { key: 'md', label: 'MD Approval', status: req.managementApproval },
                { key: 'accounts', label: 'Accounts', status: req.accountApproval },
                { key: 'paid', label: 'Paid', status: (req.paymentStatus === 'PAID' || req.accountApproval === 'APPROVED') ? 'APPROVED' : null },
              ]

              const getStageInfo = (key: string) => {
                if (key === 'created') {
                  return { date: istShortDate(req.createdAt), time: istTime(req.createdAt), user: req.name || null }
                }
                if (key === 'paid') {
                  if (req.paymentStatus === 'PAID' && req.paymentCompletedAt) {
                    return { date: istShortDate(req.paymentCompletedAt), time: istTime(req.paymentCompletedAt), user: req.paymentCompletedBy || 'Accounts' }
                  }
                  if (req.accountApproval === 'APPROVED') {
                    const accEntry = (req.history || []).find((h: any) => (h.roleKey === 'accounts' || h.role?.toLowerCase()?.includes('account')) && (h.action === 'APPROVED' || h.action === 'APPROVE' || h.action === 'PAID'))
                    const ts = accEntry?.timestamp || req.updatedAt
                    return { date: istShortDate(ts), time: istTime(ts), user: accEntry?.user || 'Accounts' }
                  }
                  return { date: null, time: null, user: null }
                }

                const entry = (req.history || []).find((h: any) => (h.roleKey === key || h.role?.toLowerCase()?.includes(key)) && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                if (entry) {
                  return { date: istShortDate(entry.timestamp), time: istTime(entry.timestamp), user: entry.user || null }
                }
                if (key === 'sales_manager' && req.vpApproval === 'APPROVED') {
                  const smEntry = (req.history || []).find((h: any) => (h.role?.toLowerCase()?.includes('vp') || h.role?.toLowerCase()?.includes('ed') || h.role?.toLowerCase()?.includes('gsm') || h.roleKey === 'sales_manager') && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                  return { date: istShortDate(smEntry?.timestamp || req.updatedAt), time: istTime(smEntry?.timestamp || req.updatedAt), user: smEntry?.user || 'Sales Mgr' }
                }
                if (key === 'hr' && req.hrApproval === 'APPROVED') {
                  const hrEntry = (req.history || []).find((h: any) => (h.role?.toLowerCase()?.includes('hr') || h.roleKey === 'hr') && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                  return { date: istShortDate(hrEntry?.timestamp || req.updatedAt), time: istTime(hrEntry?.timestamp || req.updatedAt), user: hrEntry?.user || 'HR Team' }
                }
                if (key === 'ea' && req.eaApproval === 'APPROVED') {
                  const eaEntry = (req.history || []).find((h: any) => (h.role?.toLowerCase()?.includes('ea') || h.roleKey === 'ea') && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                  return { date: istShortDate(eaEntry?.timestamp || req.updatedAt), time: istTime(eaEntry?.timestamp || req.updatedAt), user: eaEntry?.user || 'EA Team' }
                }
                if (key === 'md' && req.managementApproval === 'APPROVED') {
                  const mdEntry = (req.history || []).find((h: any) => (h.role?.toLowerCase()?.includes('md') || h.role?.toLowerCase()?.includes('management') || h.roleKey === 'md') && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                  return { date: istShortDate(mdEntry?.timestamp || req.updatedAt), time: istTime(mdEntry?.timestamp || req.updatedAt), user: mdEntry?.user || 'Management' }
                }
                if (key === 'accounts' && req.accountApproval === 'APPROVED') {
                  const accEntry = (req.history || []).find((h: any) => (h.role?.toLowerCase()?.includes('account') || h.roleKey === 'accounts') && (h.action === 'APPROVED' || h.action === 'APPROVE'))
                  return { date: istShortDate(accEntry?.timestamp || req.updatedAt), time: istTime(accEntry?.timestamp || req.updatedAt), user: accEntry?.user || 'Accounts' }
                }

                return { date: null, time: null, user: null }
              }

              return (
                <div className="bg-white border border-slate-200/80 rounded-2xl px-3.5 py-2 sm:px-4 sm:py-2.5 shadow-2xs overflow-hidden">
                  <div className="flex items-center justify-between gap-1.5 sm:gap-2.5 overflow-x-auto no-scrollbar py-0.5">
                    {stages.map((stg, i) => {
                      const isApproved = stg.status === 'APPROVED'
                      const isRejected = stg.status === 'NOT APPROVED'
                      const isHeld = stg.status === 'HELD'
                      
                      let isActive = false
                      // Keyed off getActiveStageKey, not a list of label prefixes — see the note there.
                      if (getActiveStageKey(req) === 'sales_manager' && stg.key === 'sales_manager') isActive = true
                      else if (pendingLabel === 'Pending Accounts' && stg.key === 'accounts') isActive = true
                      else if (pendingLabel === 'Pending EA' && stg.key === 'ea') isActive = true
                      else if (pendingLabel === 'Pending MD' && stg.key === 'md') isActive = true
                      else if (pendingLabel === 'Pending Payment' && stg.key === 'paid') isActive = true

                      let circleColor = 'bg-slate-100 text-slate-400 border-slate-200'
                      let textColor = 'text-slate-500 font-semibold'

                      if (isApproved) {
                        circleColor = 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        textColor = 'text-blue-700 font-bold'
                      } else if (isRejected) {
                        circleColor = 'bg-rose-500 text-white border-rose-500 shadow-xs'
                        textColor = 'text-rose-700 font-bold'
                      } else if (isHeld) {
                        circleColor = 'bg-amber-500 text-white border-amber-500 shadow-xs'
                        textColor = 'text-amber-700 font-bold'
                      } else if (isActive) {
                        circleColor = 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-100 shadow-xs'
                        textColor = 'text-blue-700 font-black'
                      }

                      const stageInfo = getStageInfo(stg.key)

                      return (
                        <div key={stg.key} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          <div className={cn("h-5 w-5 rounded-full border flex items-center justify-center text-[10px] font-black shrink-0 transition-all", circleColor)}>
                            {isApproved ? '✓' : isRejected ? '✗' : isHeld ? '‖' : i + 1}
                          </div>
                          
                          <div className="flex flex-col text-left justify-center min-w-[75px]">
                            <div className="flex items-center gap-1">
                              <span className={cn("text-[10px] uppercase font-bold tracking-tight leading-tight", textColor)}>
                                {stg.label}
                              </span>
                              {stageInfo.date && (
                                <span className="text-[8px] sm:text-[9px] font-semibold text-slate-500 font-sans tabular-nums whitespace-nowrap">
                                  ({stageInfo.date})
                                </span>
                              )}
                            </div>

                            {stageInfo.user ? (
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-[9px] sm:text-[10px] font-medium text-slate-700 leading-none truncate max-w-[100px]" title={`${stageInfo.user} · ${stageInfo.date || ''} ${stageInfo.time || ''}`}>
                                  {stageInfo.user}
                                </span>
                                {stageInfo.time && (
                                  <span className="text-[8px] text-slate-400 font-normal leading-none whitespace-nowrap hidden sm:inline">
                                    {stageInfo.time}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[9px] text-slate-300 font-medium leading-none mt-0.5">—</span>
                            )}
                          </div>

                          {i < stages.length - 1 && (
                            <div className={cn(
                              "w-2 sm:w-4 h-[1.5px] shrink-0 mx-0.5",
                              isApproved ? "bg-blue-500" : "bg-slate-200"
                            )} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }

            const billList = getBillUrls(detailRow)
            const allDocs = [
              ...billList.map((url, i) => ({
                label: billList.length > 1 ? `Bill ${i + 1}` : 'Bill / Invoice',
                url,
                type: 'bill'
              })),
              { label: 'Support Document', url: detailRow.uploadDocUrl, type: 'support' },
              { label: 'Accounts Invoice', url: detailRow.invoiceDocUrl, type: 'invoice' },
              { label: 'Payment Proof', url: detailRow.paymentProofUrl, type: 'proof' },
            ].filter((d) => Boolean(d.url))

            return (
              <>
                {/* ── COMPACT DIALOG HEADER ── */}
                <DialogHeader className="px-4 py-3 sm:px-6 sm:py-3.5 bg-white border-b border-slate-200/80 flex flex-col gap-1.5 shrink-0 sticky top-0 z-30 shadow-2xs relative">
                  {/* Sticky Close Button */}
                  <button
                    type="button"
                    onClick={() => setDetailRow(null)}
                    className="absolute right-3 top-3 sm:right-5 sm:top-3.5 z-40 flex h-8 w-8 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-all cursor-pointer shadow-2xs border border-slate-200/80"
                    aria-label="Close modal"
                    title="Close"
                  >
                    <X className="h-4 w-4 stroke-[2.5]" />
                  </button>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pr-10 sm:pr-12">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-slate-900 text-white hover:bg-slate-900 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full">{detailRow.location}</Badge>
                      <Badge className="bg-slate-100 hover:bg-slate-100 border border-slate-200 text-slate-800 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full">{detailRow.department}</Badge>
                      <Badge className="bg-blue-50 hover:bg-blue-50 border border-blue-100 text-blue-700 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-full">{detailRow.approvalType}</Badge>
                      
                      <div className="flex items-center gap-1.5 pl-1">
                        <DialogTitle className="text-sm sm:text-base font-black tracking-tight text-slate-950">
                          Payment Details
                        </DialogTitle>
                        <DialogDescription className="sr-only">
                          Vendor payment request details, attached invoices, and workflow timeline tracking.
                        </DialogDescription>
                        {detailRow.requestNo && (
                          <span className="text-xs font-bold text-slate-500 font-sans tabular-nums">· {detailRow.requestNo}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      <div className="flex items-baseline gap-1 mr-1">
                        <span className="text-[10px] font-bold uppercase text-slate-400">Total:</span>
                        <span className="text-lg sm:text-xl font-black text-slate-900 font-sans tabular-nums">
                          ₹{Number(detailRow.amount || 0).toLocaleString('en-IN')}
                        </span>
                      </div>

                      {/* Top Action Buttons */}
                      <Button
                        onClick={() => printPaymentOrder(detailRow)}
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-xl text-xs font-bold flex items-center gap-1.5 px-3 cursor-pointer border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Print</span>
                      </Button>

                      <Button
                        onClick={() => setShowTimeline(!showTimeline)}
                        size="sm"
                        className={cn(
                          "h-8 rounded-xl text-xs font-bold flex items-center gap-1.5 px-3 cursor-pointer border shadow-2xs",
                          showTimeline
                            ? "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200"
                            : "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                        )}
                        variant="outline"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{showTimeline ? 'Hide' : `Remarks (${remarksCount})`}</span>
                      </Button>
                      
                      <Button
                        onClick={() => handlePrintVoucher(detailRow, pendingLabel)}
                        size="sm"
                        className="h-8 rounded-xl text-xs font-bold border-slate-200 hover:bg-slate-50 flex items-center gap-1.5 px-3 cursor-pointer shadow-2xs"
                        variant="outline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Export</span>
                      </Button>
                    </div>
                  </div>
                </DialogHeader>

                {/* ── DIALOG BODY (ZERO-SCROLL DESKTOP GRID) ── */}
                <div className="flex-1 overflow-y-auto lg:overflow-hidden p-3.5 sm:p-5 flex flex-col gap-3 min-h-0 bg-slate-50/50">
                  {/* Stepper Ribbon */}
                  {renderNewWorkflowStepper(detailRow)}

                  {/* Split Content on Desktop */}
                  <div className={cn(
                    "flex-1 min-h-0 grid gap-3.5",
                    showTimeline 
                      ? "grid-cols-1 lg:grid-cols-12" 
                      : "grid-cols-1 lg:grid-cols-12"
                  )}>
                    {/* Left Column (Metadata & Remarks) */}
                    <div className={cn(
                      "flex flex-col gap-3 h-full overflow-y-auto pr-0.5",
                      showTimeline ? "lg:col-span-7" : "lg:col-span-7 xl:col-span-7"
                    )}>
                      {/* ── SUBMITTER REMARKS (PROMINENT AT TOP) ── */}
                      {detailRow.remarks && (
                        <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3.5 space-y-1.5 shadow-2xs shrink-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold uppercase tracking-wider">
                              <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                              <span>Submitter Remarks & Justification</span>
                            </div>
                            <span className="text-[10px] font-semibold text-amber-800/80">
                              {detailRow.name} · {istDate(detailRow.createdAt)}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-800 leading-relaxed whitespace-pre-wrap bg-white p-2.5 rounded-xl border border-amber-100/90 shadow-2xs">
                            “{detailRow.remarks}”
                          </p>
                        </div>
                      )}

                      {/* ── UNIFIED 2-COLUMN OVERVIEW CARD ── */}
                      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex-1">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                          {/* Column A: Payment Details */}
                          <div className="space-y-2 pb-2 sm:pb-0 sm:border-r sm:border-slate-100 sm:pr-4">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block pb-1 border-b border-slate-100">
                              Transaction Info
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Vendor Name</span>
                              <span className="font-semibold text-slate-800 text-right truncate max-w-[170px]" title={detailRow.vendorName || '—'}>{detailRow.vendorName || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Payment Type</span>
                              <span className="font-semibold text-slate-800 text-right">{detailRow.typeOfPayment || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Invoice / Ref</span>
                              <span className="font-semibold text-slate-800 text-right">{detailRow.invoiceNumber || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">GST Details</span>
                              <span className="font-semibold text-slate-800 text-right">{detailRow.gst || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">GL Account</span>
                              <span className="font-semibold text-slate-800 text-right text-[11px] truncate max-w-[170px]" title={detailRow.glName ? `${detailRow.glName} (${detailRow.glCode})` : '—'}>
                                {detailRow.glName ? `${detailRow.glName} (${detailRow.glCode})` : '—'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">Workflow</span>
                              <span className="text-blue-700 font-bold text-xs">{pendingLabel}</span>
                            </div>
                          </div>

                          {/* Column B: Dealership & Requester */}
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block pb-1 border-b border-slate-100">
                              Dealership & Requester
                            </span>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Requester</span>
                              <span className="font-semibold text-slate-800 text-right">{detailRow.name}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Email</span>
                              <span className="font-medium text-slate-700 text-right text-[11px] truncate max-w-[170px]">{detailRow.email}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Dealer Name</span>
                              <span className="font-semibold text-slate-800 text-right truncate max-w-[170px]">{detailRow.dealerName || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Dealer Code</span>
                              <span className="font-semibold text-slate-800 text-right">{detailRow.dealerCode || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-500 font-medium">Brand</span>
                              <span className="font-bold text-slate-900 uppercase text-right">{detailRow.brand || '—'}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                              <span className="text-slate-500 font-medium">Submitted</span>
                              <span className="font-semibold text-slate-800 text-right">{istDate(detailRow.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* If Paid: UTR info banner */}
                        {detailRow.paymentStatus === 'PAID' && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100">
                            <span className="text-emerald-800 font-bold">Paid via UTR: {detailRow.utrNumber || '—'}</span>
                            {detailRow.paymentCompletedAt && (
                              <span className="text-emerald-700 text-[11px]">
                                {istDate(detailRow.paymentCompletedAt)} by {detailRow.paymentCompletedBy || '—'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Warnings / Alerts (if any) */}
                      {(() => {
                        const mdRemarks = getMdRemarksList(detailRow)
                        const alerts = getAnomalyAlerts(detailRow, data?.rows || [])
                        if (mdRemarks.length === 0 && alerts.length === 0 && !(detailRow.emailSendStatus === 'SentBack' && detailRow.sendBackReason)) return null

                        return (
                          <div className="space-y-2 shrink-0">
                            {mdRemarks.length > 0 && (
                              <div className="bg-rose-50/80 border border-rose-200 rounded-2xl p-3 space-y-1.5 shadow-2xs">
                                <div className="flex items-center gap-1.5 text-rose-900 text-[11px] font-bold uppercase tracking-wider">
                                  <MessageSquare className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                                  <span>MD Remarks ({mdRemarks.length})</span>
                                </div>
                                <div className="space-y-1">
                                  {mdRemarks.map((item, i) => (
                                    <div key={i} className="bg-white p-2.5 rounded-xl border border-rose-100 text-xs">
                                      <span className="font-bold text-slate-900">{item.user}: </span>
                                      <span className="text-rose-950 font-medium italic">"{item.remark}"</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {alerts.length > 0 && (
                              <div className="bg-rose-50 border border-rose-200/80 rounded-2xl p-2.5 space-y-1 shadow-2xs text-xs">
                                <div className="flex items-center gap-1.5 text-rose-800 font-bold uppercase tracking-wider text-[10px]">
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                                  <span>Risk Alert ({alerts.length})</span>
                                </div>
                                <ul className="list-disc list-inside font-medium text-rose-700 pl-1 text-[11px]">
                                  {alerts.map((alert, idx) => (
                                    <li key={idx}>{alert}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {detailRow.emailSendStatus === 'SentBack' && detailRow.sendBackReason && (
                              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-2.5 space-y-1 shadow-2xs text-xs">
                                <div className="flex items-center gap-1.5 text-amber-800 font-bold uppercase tracking-wider text-[10px]">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Clarification Remarks</span>
                                </div>
                                <p className="text-amber-900 font-semibold bg-white p-2 rounded-lg border border-amber-100 text-[11px] whitespace-pre-wrap">
                                  {detailRow.sendBackReason}
                                </p>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Right Column: Attached Documents or Activity Timeline */}
                    {!showTimeline ? (
                      <div className="flex flex-col gap-3 h-full overflow-y-auto pl-0.5 lg:col-span-5">
                        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col gap-3 h-full">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-1.5 text-slate-800 text-xs font-bold uppercase tracking-wider">
                              <FileText className="w-4 h-4 text-slate-600" />
                              <span>Attached Documents ({allDocs.length})</span>
                            </div>
                            <span className="text-[10px] font-semibold text-slate-400">Click to preview</span>
                          </div>

                          {allDocs.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 text-xs font-medium">
                              <FileText className="w-8 h-8 text-slate-300 mb-1" />
                              <span>No documents attached</span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 gap-2.5 overflow-y-auto pr-1">
                              {allDocs.map((doc, idx) => {
                                const url = doc.url!
                                const isImage = /\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i.test(url) || !url.toLowerCase().endsWith('.pdf')
                                return (
                                  <div key={idx} className="border border-slate-200/90 bg-slate-50/60 hover:bg-slate-50 rounded-xl p-2.5 transition-all flex flex-col gap-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-slate-800 truncate">{doc.label}</span>
                                      <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">{isImage ? 'Image' : 'PDF'}</span>
                                    </div>

                                    {isImage ? (
                                      <div 
                                        onClick={() => setPreviewDocUrl(url)}
                                        className="relative h-28 sm:h-32 w-full rounded-lg overflow-hidden bg-slate-900/5 border border-slate-200 cursor-pointer group flex items-center justify-center"
                                      >
                                        <img 
                                          src={url} 
                                          alt={doc.label} 
                                          loading="lazy"
                                          decoding="async"
                                          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-bold">
                                          <Eye className="w-3.5 h-3.5" />
                                          <span>Click to Expand</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div 
                                        onClick={() => setPreviewDocUrl(url)}
                                        className="h-20 w-full rounded-lg bg-slate-100 border border-slate-200 cursor-pointer group flex flex-col items-center justify-center p-2 gap-1 hover:bg-slate-200/70 transition-colors"
                                      >
                                        <FileText className="w-6 h-6 text-slate-600 group-hover:scale-110 transition-transform" />
                                        <span className="text-[11px] font-bold text-slate-700 truncate">{doc.label}</span>
                                      </div>
                                    )}

                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setPreviewDocUrl(url)}
                                        className="flex-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-1.5 px-2.5 flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                        <span>View Document</span>
                                      </button>
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs font-bold bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg py-1.5 px-2.5 flex items-center justify-center gap-1 transition-colors"
                                        title="Open in new tab"
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </a>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Right Column - Activity Timeline Panel */
                      <div className="bg-white border border-slate-200/90 rounded-2xl flex flex-col overflow-hidden shadow-2xs w-full lg:col-span-5 h-full animate-in slide-in-from-right duration-200">
                        {/* Panel Tabs */}
                        <div className="flex border-b border-slate-100 shrink-0 bg-slate-50/40">
                          <button
                            onClick={() => setActiveTab('timeline')}
                            className={cn(
                              "flex-1 py-2.5 px-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-all cursor-pointer",
                              activeTab === 'timeline' ? "border-blue-600 text-blue-700 bg-white" : "border-transparent text-slate-400 hover:text-slate-600"
                            )}
                          >
                            <Activity className="w-3.5 h-3.5" />
                            <span>Timeline</span>
                          </button>
                          <button
                            onClick={() => setActiveTab('remarks')}
                            className={cn(
                              "flex-1 py-2.5 px-3 text-xs font-bold flex items-center justify-center gap-1.5 border-b-2 transition-all cursor-pointer",
                              activeTab === 'remarks' ? "border-blue-600 text-blue-700 bg-white" : "border-transparent text-slate-400 hover:text-slate-600"
                            )}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Remarks</span>
                            <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.2 rounded-full shrink-0">
                              {remarksCount}
                            </span>
                          </button>
                        </div>

                        {/* Timeline List */}
                        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                          {displayedEvents.length === 0 ? (
                            <p className="text-center text-xs text-slate-400 font-medium py-6">No events to display.</p>
                          ) : (
                            displayedEvents.map((evt, idx) => {
                              let IconComponent = MessageSquare
                              let iconBgColor = 'bg-slate-50 text-slate-500 border-slate-100'
                              
                              if (evt.iconType === 'phone') {
                                IconComponent = Phone
                                iconBgColor = 'bg-emerald-50 text-emerald-600 border-emerald-100'
                              } else if (evt.iconType === 'create') {
                                IconComponent = FileText
                                iconBgColor = 'bg-blue-50 text-blue-600 border-blue-100'
                              } else if (evt.iconType === 'clip') {
                                IconComponent = Paperclip
                                iconBgColor = 'bg-blue-50 text-blue-600 border-blue-100'
                              } else if (evt.iconType === 'remark') {
                                IconComponent = MessageSquare
                                iconBgColor = 'bg-amber-50 text-amber-600 border-amber-100'
                              } else if (evt.iconType === 'approve') {
                                IconComponent = Check
                                iconBgColor = 'bg-emerald-500 text-white border-emerald-500 shadow-xs'
                              } else if (evt.iconType === 'reject') {
                                IconComponent = X
                                iconBgColor = 'bg-rose-500 text-white border-rose-500 shadow-xs'
                              } else if (evt.iconType === 'hold') {
                                IconComponent = Clock
                                iconBgColor = 'bg-amber-500 text-white border-amber-500 shadow-xs'
                              } else if (evt.iconType === 'gl') {
                                IconComponent = RefreshCw
                                iconBgColor = 'bg-indigo-50 text-indigo-600 border-indigo-100'
                              }

                              return (
                                <div key={evt.id} className="flex gap-2.5 relative">
                                  {idx < displayedEvents.length - 1 && (
                                    <div className="absolute top-6 left-3 w-0.5 h-[calc(100%+0.75rem)] bg-slate-100" />
                                  )}

                                  <div className={cn("h-6 w-6 rounded-full border flex items-center justify-center shrink-0 z-10", iconBgColor)}>
                                    <IconComponent className="w-3 h-3" />
                                  </div>

                                  <div className="space-y-0.5 text-xs">
                                    <span className="font-bold text-slate-800 block leading-tight">{evt.title}</span>
                                    <div className="font-medium text-slate-600 leading-relaxed text-[11px]">{evt.description}</div>
                                    <span className="text-[9px] font-semibold text-slate-400 block">
                                      {evt.user} · {istDate(evt.timestamp)}
                                    </span>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>

                        {/* Timeline Text Area Footer */}
                        <div className="p-3 border-t border-slate-100 bg-slate-50/40 space-y-2 shrink-0">
                          <textarea
                            placeholder="Add a remark..."
                            value={remarkText}
                            maxLength={500}
                            onChange={e => setRemarkText(e.target.value)}
                            className="w-full min-h-[60px] p-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-[9px] font-medium text-slate-400">
                              {remarkText.length} / 500
                            </span>
                            <Button
                              size="sm"
                              disabled={!remarkText.trim() || addRemarkPending}
                              onClick={handleAddRemark}
                              className="h-7 rounded-lg bg-blue-600 hover:bg-blue-700 text-[10px] font-bold flex items-center gap-1.5 px-2.5 cursor-pointer"
                            >
                              {addRemarkPending ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <>
                                  <Send className="w-3 h-3" />
                                  <span>Send Remark</span>
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dialog Footer */}
                <div className="px-4 py-2.5 sm:px-6 sm:py-3 border-t border-slate-200/90 bg-white flex flex-col sm:flex-row justify-between items-center gap-2.5 w-full shrink-0">
                  <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center sm:text-left">
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Created by {detailRow.name} on {istDateTime(detailRow.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                    {isUserEligibleForPendingStage && !isApproved && !isRejected ? (
                      <>
                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            actionMutation.mutate({
                              id: detailRow.id,
                              action: 'APPROVE',
                              stage: pendingStageKey!,
                              remarks: remarkText || ''
                            })
                          }}
                          className="text-white text-xs font-bold rounded-xl h-9 px-4 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                          style={{ backgroundColor: 'var(--dashboard-action-bg)', color: '#ffffff' }}
                        >
                          {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>{pendingStageKey === 'payment_done' ? 'Record Payment' : 'Approve & Forward'}</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionStage(pendingStageKey!)
                            setActionDecision('SEND_BACK')
                          }}
                          className="text-white text-xs font-bold rounded-xl h-9 px-3.5 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                          style={{ backgroundColor: 'var(--dashboard-warning-text)', color: '#ffffff' }}
                        >
                          <CornerUpLeft className="w-3.5 h-3.5" />
                          <span>Send Back</span>
                        </button>

                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionStage(pendingStageKey!)
                            setActionDecision('REJECT')
                          }}
                          className="text-white text-xs font-bold rounded-xl h-9 px-3.5 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                          style={{ backgroundColor: 'var(--dashboard-danger)', color: '#ffffff' }}
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>

                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionStage(pendingStageKey!)
                            setActionDecision('HOLD')
                          }}
                          className="bg-slate-600 hover:bg-slate-700 text-white text-xs font-bold rounded-xl h-9 px-3.5 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Hold</span>
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                        Status: {pendingLabel}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setDetailRow(null)}
                      className="text-slate-700 bg-slate-100 hover:bg-slate-200 text-xs font-bold rounded-xl h-9 px-3.5 flex items-center justify-center gap-1.5 cursor-pointer transition-all border border-slate-200 shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Close</span>
                    </button>
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 4.5 VENDOR LEDGER DETAILS DIALOG */}
      <Dialog open={Boolean(selectedVendorName)} onOpenChange={(open) => { if (!open) setSelectedVendorName(null) }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[calc(100dvh-1.5rem)] sm:max-h-[85vh] flex flex-col">
          {selectedVendorName && (() => {
            const totalSpend = vendorFilteredRows.reduce((sum, r) => sum + Number(r.amount), 0)
            return (
              <>
                <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle className="text-xl font-black tracking-tight text-slate-950">
                        Vendor Ledger: {selectedVendorName}
                      </DialogTitle>
                      <DialogDescription className="text-xs text-slate-400 font-semibold mt-1">
                        Track all historical transaction statements and date-filtered ledgers.
                      </DialogDescription>
                    </div>
                    <span className="text-indigo-600 text-lg font-black font-mono">Total Spend: ₹{totalSpend.toLocaleString('en-IN')}</span>
                  </div>
                </DialogHeader>

                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row items-center gap-3 bg-slate-50/20">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">From</span>
                    <input
                      type="date"
                      value={vendorStartDate}
                      onChange={e => setVendorStartDate(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">To</span>
                    <input
                      type="date"
                      value={vendorEndDate}
                      onChange={e => setVendorEndDate(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">Month</span>
                    <select
                      value={selectedVendorMonth}
                      onChange={e => setSelectedVendorMonth(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    >
                      <option value="all">All Months</option>
                      {uniqueMonths.map(m => (
                        <option key={m} value={m}>{formatYearMonth(m)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
                    {(vendorStartDate || vendorEndDate || selectedVendorMonth !== 'all') && (
                      <Button
                        onClick={() => {
                          setVendorStartDate('')
                          setVendorEndDate('')
                          setSelectedVendorMonth('all')
                        }}
                        variant="ghost"
                        className="h-10 px-4 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-900"
                      >
                        Reset Filters
                      </Button>
                    )}
                    <Button
                      onClick={() => handlePrintLedger(selectedVendorName, vendorFilteredRows)}
                      className="h-10 px-4 rounded-2xl text-xs font-black border-slate-200 hover:bg-slate-50"
                      variant="outline"
                    >
                      Export Ledger
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/10">
                  {groupedByMonth.length === 0 ? (
                    <div className="border border-slate-100 rounded-3xl bg-white py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs">
                      No purchases matching filter criteria.
                    </div>
                  ) : (
                    groupedByMonth.map((group) => (
                      <div key={group.yearMonth} className="space-y-3">
                        <div className="flex justify-between items-center bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-xs font-black text-slate-800 uppercase tracking-wider">
                          <span>{formatYearMonth(group.yearMonth)}</span>
                          <span className="text-indigo-600 font-mono">Monthly Spend: ₹{group.totalAmount.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="border border-slate-100 rounded-3xl overflow-hidden bg-white shadow-sm">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50">
                                  <th scope="col" className="py-3 px-4 w-12">#</th>
                                  <th scope="col" className="py-3 px-4">Date</th>
                                  <th scope="col" className="py-3 px-4">Requester</th>
                                  <th scope="col" className="py-3 px-4">Payment Type</th>
                                  <th scope="col" className="py-3 px-4 text-right">Amount (₹)</th>
                                  <th scope="col" className="py-3 px-4 text-right">Workflow Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                {group.rows.map((row, idx) => (
                                  <tr 
                                    key={row.id} 
                                    onClick={() => setDetailRow(row)}
                                    className="hover:bg-indigo-50/45 cursor-pointer transition-colors"
                                  >
                                    <td className="py-3 px-4 font-mono text-slate-400">
                                      {(idx + 1).toString().padStart(2, '0')}
                                    </td>
                                    <td className="py-3 px-4 font-bold text-slate-900">
                                      {istDate(row.createdAt)}
                                    </td>
                                    <td className="py-3 px-4">
                                      <div className="flex flex-col">
                                        <span className="font-bold text-slate-800">{row.name}</span>
                                        <span className="text-[10px] text-slate-400 font-medium">{row.email}</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4">
                                      <span className={`inline-block border px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase ${getPaymentTypeBadgeClass(row.typeOfPayment || '')}`}>
                                        {row.typeOfPayment || '—'}
                                      </span>
                                    </td>
                                    <td className="py-3 px-4 text-right font-black text-slate-950">
                                      {Number(row.amount).toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4 text-right font-black">
                                      {getPendingStageLabel(row)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                  <Button variant="outline" onClick={() => setSelectedVendorName(null)} className="h-10 rounded-2xl text-xs font-black border-slate-200">
                    Close Ledger
                  </Button>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 5. TAKE ACTION CONFIRMATION MODAL */}
      <Dialog open={Boolean(actionStage && detailRow)} onOpenChange={(open) => { if (!open) { setActionStage(null); setActionDecision(null); setActionRemarks(''); setInvoiceNumber(''); setInvoiceDocUrl(''); setInvoiceFileName(''); setUtrNumberVal(''); setPaymentProofUrl(''); setPaymentProofFileName(''); } }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100 max-h-[calc(100dvh-1.5rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
              Submit Action Confirmation
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
              {actionDecision === 'HOLD' ? 'Provide a reason for putting this request on HOLD.' : actionDecision === 'REJECT' ? 'Provide a reason for DENYING this request.' : actionDecision === 'SEND_BACK' ? 'Provide comments explaining why the request is being sent back to the submitter.' : 'Select your decision for the request.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Remarks / Notes {actionDecision ? '(Required)' : '(Optional)'}
              </label>
              <Textarea
                value={actionRemarks}
                onChange={e => setActionRemarks(e.target.value)}
                placeholder={actionDecision === 'HOLD' ? 'Reason for Hold...' : actionDecision === 'REJECT' ? 'Reason for Denial...' : actionDecision === 'SEND_BACK' ? 'Feedback / instructions for submitter...' : 'Notes...'}
                className="min-h-[100px] rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold text-slate-800 text-sm"
              />
            </div>

            {actionStage === 'accounts' && (actionDecision === 'APPROVE' || !actionDecision) && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Invoice Number *
                  </label>
                  <Input
                    type="text"
                    value={invoiceNumber}
                    onChange={e => setInvoiceNumber(e.target.value)}
                    placeholder="Enter Invoice Number..."
                    className="rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold text-slate-800 text-sm"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Invoice Document (PDF/Image) *
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handleInvoiceUpload}
                      disabled={uploadingInvoice}
                      className="hidden"
                      id="invoice-file-upload"
                    />
                    <label
                      htmlFor="invoice-file-upload"
                      className="flex items-center gap-2 px-4 py-2 border border-slate-200 hover:border-slate-300 rounded-2xl cursor-pointer text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-slate-500" />
                      {uploadingInvoice ? 'Uploading...' : invoiceDocUrl ? 'Change File' : 'Upload Invoice'}
                    </label>
                    {invoiceDocUrl && (
                      <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Uploaded!
                      </span>
                    )}
                  </div>
                  {invoiceFileName && (
                    <p className="text-[10px] text-slate-400 font-semibold truncate max-w-xs">{invoiceFileName}</p>
                  )}
                </div>
              </div>
            )}

            {actionStage === 'payment_done' && (actionDecision === 'APPROVE' || !actionDecision) && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    UTR / Transaction Number *
                  </label>
                  <Input
                    type="text"
                    value={utrNumberVal}
                    onChange={e => setUtrNumberVal(e.target.value)}
                    placeholder="Enter UTR Number..."
                    className="rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold text-slate-800 text-sm"
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Payment Proof Document *
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={handlePaymentProofUpload}
                      disabled={uploadingPaymentProof}
                      className="hidden"
                      id="payment-proof-file-upload"
                    />
                    <label
                      htmlFor="payment-proof-file-upload"
                      className="flex items-center gap-2 px-4 py-2 border border-slate-200 hover:border-slate-300 rounded-2xl cursor-pointer text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 transition-colors"
                    >
                      <Upload className="w-4 h-4 text-slate-500" />
                      {uploadingPaymentProof ? 'Uploading...' : paymentProofUrl ? 'Change File' : 'Upload Proof'}
                    </label>
                    {paymentProofUrl && (
                      <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Uploaded!
                      </span>
                    )}
                  </div>
                  {paymentProofFileName && (
                    <p className="text-[10px] text-slate-400 font-semibold truncate max-w-xs">{paymentProofFileName}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2">
            <Button
              variant="outline"
              onClick={() => { setActionStage(null); setActionDecision(null); setActionRemarks(''); setInvoiceNumber(''); setInvoiceDocUrl(''); setInvoiceFileName(''); setUtrNumberVal(''); setPaymentProofUrl(''); setPaymentProofFileName(''); }}
              disabled={actionMutation.isPending}
              className="h-10 rounded-2xl text-xs font-bold border-slate-200 order-last sm:order-none"
            >
              Cancel
            </Button>
            
            {(!actionDecision || actionDecision === 'REJECT') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    if (actionDecision && !actionRemarks.trim()) {
                      toast({ title: 'Remarks required', description: 'Please provide a reason for rejection.', variant: 'error' })
                      return
                    }
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'REJECT',
                      stage: actionStage,
                      remarks: actionRemarks,
                      glAccountId: selectedGlId || undefined
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black hover:opacity-90"
                style={{ backgroundColor: '#dc2626', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'REJECT' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Deny
              </Button>
            )}

            {(!actionDecision || actionDecision === 'HOLD') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    if (actionDecision && !actionRemarks.trim()) {
                      toast({ title: 'Remarks required', description: 'Please provide a reason for hold.', variant: 'error' })
                      return
                    }
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'HOLD',
                      stage: actionStage,
                      remarks: actionRemarks,
                      glAccountId: selectedGlId || undefined
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black hover:opacity-90"
                style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'HOLD' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Hold
              </Button>
            )}

            {(!actionDecision || actionDecision === 'SEND_BACK') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    if (!actionRemarks.trim()) {
                      toast({ title: 'Remarks required', description: 'Please explain why the request is sent back (e.g. missing invoice/bill).', variant: 'error' })
                      return
                    }
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'SEND_BACK',
                      stage: actionStage,
                      remarks: actionRemarks,
                      glAccountId: undefined
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black hover:opacity-90"
                style={{ backgroundColor: 'var(--dashboard-warning-text)', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'SEND_BACK' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Send Back
              </Button>
            )}

            {(!actionDecision || actionDecision === 'APPROVE') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'APPROVE',
                      stage: actionStage,
                      remarks: actionRemarks,
                      invoiceNumber: actionStage === 'accounts' && invoiceNumber ? invoiceNumber : undefined,
                      invoiceDocUrl: actionStage === 'accounts' && invoiceDocUrl ? invoiceDocUrl : undefined,
                      utrNumber: actionStage === 'payment_done' && utrNumberVal ? utrNumberVal : undefined,
                      paymentProofUrl: actionStage === 'payment_done' && paymentProofUrl ? paymentProofUrl : undefined,
                      glAccountId: selectedGlId || undefined
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black shadow-md hover:opacity-90"
                style={{ backgroundColor: 'var(--dashboard-action-bg)', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                {actionStage === 'payment_done' ? 'Record Payment' : 'Approve'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 6. INLINE DOCUMENT PREVIEW DIALOG */}
      <Dialog open={Boolean(previewDocUrl)} onOpenChange={(open) => { if (!open) setPreviewDocUrl(null) }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[calc(100dvh-1.5rem)] sm:max-h-[90vh] flex flex-col">
          {previewDocUrl && (() => {
            const isPdf = previewDocUrl.toLowerCase().endsWith('.pdf') || previewDocUrl.includes('/pdf') || previewDocUrl.includes('response-content-type=application/pdf') || previewDocUrl.includes('.output');
            const isImage = previewDocUrl.toLowerCase().match(/\.(jpeg|jpg|gif|png|webp|svg)/) || previewDocUrl.includes('image/');
            
            return (
              <>
                <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle className="text-xl font-black tracking-tight text-slate-950">
                        Document Preview
                      </DialogTitle>
                      <DialogDescription className="text-xs text-slate-400 font-semibold mt-1">
                        Fast inline viewer for payment request attachments.
                      </DialogDescription>
                    </div>
                    <a
                      href={previewDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-xs font-black text-white transition-all shadow-md shadow-indigo-100"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Open Original</span>
                    </a>
                  </div>
                </DialogHeader>

                <div className="flex-1 overflow-auto p-6 bg-slate-100/50 flex items-center justify-center min-h-[50vh]">
                  {isPdf ? (
                    <iframe
                      src={`${previewDocUrl}#toolbar=1`}
                      className="w-full h-[65vh] rounded-2xl border border-slate-200 bg-white"
                      title="PDF Document Preview"
                    />
                  ) : isImage || !isPdf ? (
                    <div className="relative max-w-full max-h-[65vh] rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm flex items-center justify-center p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewDocUrl}
                        alt="Document attachment preview"
                        className="max-w-full max-h-[60vh] object-contain rounded-xl"
                        onError={(e) => {
                          const target = e.currentTarget;
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `<iframe src="${previewDocUrl}" class="w-[75vw] h-[65vh] rounded-2xl border border-slate-200 bg-white" title="Document Preview fallback" />`;
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className="text-center space-y-4 py-12">
                      <FileText className="w-16 h-16 text-slate-300 mx-auto" />
                      <p className="text-sm font-semibold text-slate-500">Preview not supported for this file type.</p>
                      <a
                        href={previewDocUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-bold text-white transition-all"
                      >
                        Download Document
                      </a>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                  <Button variant="outline" onClick={() => setPreviewDocUrl(null)} className="h-10 rounded-2xl text-xs font-black border-slate-200">
                    Close Preview
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* 4.6 GL CATEGORY LEDGER DETAILS DIALOG */}
      <Dialog open={Boolean(selectedGlName)} onOpenChange={(open) => { if (!open) setSelectedGlName(null) }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[calc(100dvh-1.5rem)] sm:max-h-[85vh] flex flex-col">
          {selectedGlName && (() => {
            const totalSpend = glFilteredRows.reduce((sum, r) => sum + Number(r.amount), 0)
            const glItem = glSummary.find(g => g.name === selectedGlName)
            const glCode = glItem ? glItem.code : ''
            return (
              <>
                <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle className="text-xl font-black tracking-tight text-slate-950">
                        GL Category Ledger: {selectedGlName} ({glCode})
                      </DialogTitle>
                      <DialogDescription className="text-xs text-slate-400 font-semibold mt-1">
                        Track historical expenditures categorized under this GL code.
                      </DialogDescription>
                    </div>
                    <span className="text-indigo-600 text-lg font-black font-mono">Total Spend: ₹{totalSpend.toLocaleString('en-IN')}</span>
                  </div>
                </DialogHeader>

                <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row items-center gap-3 bg-slate-50/20">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">From</span>
                    <input
                      type="date"
                      value={glStartDate}
                      onChange={e => setGlStartDate(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">To</span>
                    <input
                      type="date"
                      value={glEndDate}
                      onChange={e => setGlEndDate(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0">Month</span>
                    <select
                      value={selectedGlMonth}
                      onChange={e => setSelectedGlMonth(e.target.value)}
                      className="h-10 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-white text-xs font-bold text-slate-700 w-full sm:w-auto cursor-pointer"
                    >
                      <option value="all">All Months</option>
                      {glUniqueMonths.map(m => (
                        <option key={m} value={m}>{formatYearMonth(m)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
                    {(glStartDate || glEndDate || selectedGlMonth !== 'all') && (
                      <Button
                        onClick={() => {
                          setGlStartDate('')
                          setGlEndDate('')
                          setSelectedGlMonth('all')
                        }}
                        variant="ghost"
                        className="h-10 px-4 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-900"
                      >
                        Reset Filters
                      </Button>
                    )}
                    <Button
                      onClick={() => handlePrintLedger(`GL-${selectedGlName}`, glFilteredRows)}
                      className="h-10 px-4 rounded-2xl text-xs font-black border-slate-200 hover:bg-slate-50"
                      variant="outline"
                    >
                      Export Ledger
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/10">
                  {glGroupedByMonth.length === 0 ? (
                    <div className="border border-slate-100 rounded-3xl bg-white py-12 text-center text-slate-400 font-bold uppercase tracking-wider text-xs">
                      No purchases matching filter criteria.
                    </div>
                  ) : (
                    glGroupedByMonth.map((group) => (
                      <div key={group.yearMonth} className="space-y-3">
                        <div className="flex justify-between items-center bg-slate-50 border border-slate-100 rounded-2xl px-4 py-2.5 text-xs font-black text-slate-800 uppercase tracking-wider">
                          <span>{formatYearMonth(group.yearMonth)}</span>
                          <span className="text-indigo-600 font-mono">Monthly Spend: ₹{group.totalAmount.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="border border-slate-100 rounded-3xl overflow-hidden bg-white shadow-sm">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50">
                                  <th scope="col" className="py-3 px-4 w-12">#</th>
                                  <th scope="col" className="py-3 px-4">Date</th>
                                  <th scope="col" className="py-3 px-4">Vendor</th>
                                  <th scope="col" className="py-3 px-4">Requester</th>
                                  <th scope="col" className="py-3 px-4 text-right">Amount (₹)</th>
                                  <th scope="col" className="py-3 px-4 text-right">Workflow Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                {group.rows.map((row, idx) => (
                                  <tr 
                                    key={row.id} 
                                    onClick={() => setDetailRow(row)}
                                    className="hover:bg-indigo-50/45 cursor-pointer transition-colors"
                                  >
                                    <td className="py-3 px-4 font-mono text-slate-400">
                                      {(idx + 1).toString().padStart(2, '0')}
                                    </td>
                                    <td className="py-3 px-4 font-bold text-slate-900">
                                      {istDate(row.createdAt)}
                                    </td>
                                    <td className="py-3 px-4 font-bold text-slate-800">
                                      {row.vendorName || '—'}
                                    </td>
                                    <td className="py-3 px-4">
                                      <div className="flex flex-col">
                                        <span className="font-bold text-slate-800">{row.name}</span>
                                        <span className="text-[10px] text-slate-400 font-medium">{row.email}</span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-4 text-right font-black text-slate-950">
                                      {Number(row.amount).toLocaleString('en-IN')}
                                    </td>
                                    <td className="py-3 px-4 text-right font-black">
                                      {getPendingStageLabel(row)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
                  <Button variant="outline" onClick={() => setSelectedGlName(null)} className="h-10 rounded-2xl text-xs font-black border-slate-200">
                    Close Ledger
                  </Button>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 4.7 ADD GL CATEGORY DIALOG */}
      <AddGlDialog
        open={showAddGlDialog}
        onOpenChange={setShowAddGlDialog}
        onSuccess={() => {
          fetch('/api/brands/kia/gl-accounts')
            .then(res => res.json())
            .then(data => setGlAccounts(data.rows || []))
            .catch(err => console.error('Error fetching GL accounts:', err))
          toast({ title: 'GL Category added', description: 'New GL category saved successfully.', variant: 'success' })
        }}
      />

      {/* BULK APPROVAL SUCCESS POPUP TOAST DIALOG */}
      <Dialog open={bulkSuccessModal.open} onOpenChange={(open) => setBulkSuccessModal(prev => ({ ...prev, open }))}>
        <DialogContent className="rounded-[2.5rem] max-w-md bg-white p-7 shadow-2xl border border-emerald-100 text-center flex flex-col items-center z-50">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 animate-in zoom-in-50 duration-300">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight">
            Bulk Approval Done!
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-semibold mt-1 max-w-xs">
            Successfully processed {bulkSuccessModal.count} vendor payment {bulkSuccessModal.count === 1 ? 'request' : 'requests'}.
          </DialogDescription>

          <div className="my-4 w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 flex justify-around items-center">
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Approved</p>
              <p className="text-lg font-black text-emerald-600">{bulkSuccessModal.count} Requests</p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-center">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Amount</p>
              <p className="text-lg font-black text-slate-900">₹{bulkSuccessModal.totalAmount.toLocaleString('en-IN')}</p>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 font-medium mb-5 leading-relaxed">
            The payment requests have been approved and forwarded to the Accounts department for invoice verification & payment execution.
          </p>

          <Button
            onClick={() => setBulkSuccessModal(prev => ({ ...prev, open: false }))}
            className="w-full h-11 rounded-2xl font-bold bg-[var(--dashboard-action-bg)] hover:bg-[var(--dashboard-action-hover)] text-white shadow-lg text-xs uppercase tracking-wider"
          >
            Got it
          </Button>
        </DialogContent>
      </Dialog>

      {/*
        Floating bulk action bar.

        It was a slate-900 slab carrying a single teal "Bulk Approve" — a dark component floating
        over a light table, in a colour used nowhere else at that weight, offering one of the four
        things an approver can do. It now mirrors the per-row actions exactly: same four verbs, same
        four colours, on a light surface that belongs to the same page.

        Send Back, Reject and Hold all collect a reason first. The server REQUIRES one for
        SEND_BACK — a send-back email whose "what do I change?" line is blank is useless to the
        submitter — and rejecting somebody's payment silently is worse. Approve is the only verb
        that goes straight through, because "approved" needs no explanation.
      */}
      {selectedRequestIds.length > 0 && (
        <div
          role="region"
          aria-label={`${selectedRequestIds.length} requests selected`}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-[0_16px_40px_-12px_rgba(15,23,42,0.28)] animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          {bulkReasonFor ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="bulk-reason" className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                {bulkReasonFor === 'SEND_BACK' ? 'What needs changing?' : bulkReasonFor === 'REJECT' ? 'Reason for rejection' : 'Note for the hold'}
              </label>
              <input
                id="bulk-reason"
                autoFocus
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setBulkReasonFor(null); setBulkReason('') } }}
                placeholder={bulkReasonFor === 'SEND_BACK' ? 'Tell them what to fix — this is the email they receive' : 'Visible to the submitter'}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:border-slate-400 focus:outline-none sm:w-[22rem]"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setBulkReasonFor(null); setBulkReason('') }}
                  className="h-10 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={bulkActionMutation.isPending || !bulkReason.trim()}
                  onClick={() => {
                    bulkActionMutation.mutate({ ids: selectedRequestIds, action: bulkReasonFor, remarks: bulkReason.trim() })
                    setBulkReasonFor(null)
                    setBulkReason('')
                  }}
                  className={`h-10 rounded-xl px-4 text-xs font-black text-white transition-colors disabled:opacity-40 ${
                    bulkReasonFor === 'REJECT' ? 'bg-rose-600 hover:bg-rose-700'
                      : bulkReasonFor === 'SEND_BACK' ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-slate-600 hover:bg-slate-700'
                  }`}
                >
                  {bulkActionMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : `Confirm for ${selectedRequestIds.length}`}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-700">
                {selectedRequestIds.length} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedRequestIds([])}
                className="h-9 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                Deselect
              </button>
              <div className="h-5 w-px bg-slate-200" aria-hidden="true" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={bulkActionMutation.isPending}
                  onClick={() => bulkActionMutation.mutate({ ids: selectedRequestIds, action: 'APPROVE', remarks: 'Bulk approved' })}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-[var(--dashboard-action-bg)] px-4 text-xs font-black text-white transition-colors hover:bg-[var(--dashboard-action-hover)] disabled:opacity-40"
                >
                  {bulkActionMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5" /> Approve</>}
                </button>
                <button
                  type="button"
                  disabled={bulkActionMutation.isPending}
                  onClick={() => setBulkReasonFor('SEND_BACK')}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-black text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
                >
                  <CornerUpLeft className="h-3.5 w-3.5" /> Send Back
                </button>
                <button
                  type="button"
                  disabled={bulkActionMutation.isPending}
                  onClick={() => setBulkReasonFor('REJECT')}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-4 text-xs font-black text-white transition-colors hover:bg-rose-700 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" /> Reject
                </button>
                <button
                  type="button"
                  disabled={bulkActionMutation.isPending}
                  onClick={() => setBulkReasonFor('HOLD')}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-slate-600 px-4 text-xs font-black text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
                >
                  <Clock className="h-3.5 w-3.5" /> Hold
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </MainLayout>
  )
}

interface AddGlDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

function AddGlDialog({ open, onOpenChange, onSuccess }: AddGlDialogProps) {
  const [glName, setGlName] = useState('')
  const [tallyGroup, setTallyGroup] = useState('Indirect Expenses')
  const [isPending, setIsPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!glName.trim()) {
      toast({ title: 'Required Fields', description: 'Please fill GL Name.', variant: 'error' })
      return
    }

    setIsPending(true)
    try {
      const res = await fetch('/api/brands/kia/gl-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          glName: glName.trim(),
          tallyGroup: tallyGroup.trim(),
          accountNature: 'Expense',
          accountType: 'Indirect',
          monthlyBudget: '0.00'
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to create GL category')
      }
      onSuccess()
      setGlName('')
      onOpenChange(false)
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Something went wrong.', variant: 'error' })
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100">
        <DialogHeader>
          <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
            Create GL Category
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
            Add a new General Ledger account category to the system.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-1.5 bg-slate-50 border border-slate-100 rounded-2xl p-3">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
              GL Code
            </span>
            <span className="text-xs font-black text-indigo-600 font-mono">
              [ System Generated ]
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              GL Category Name
            </label>
            <Input
              value={glName}
              onChange={e => setGlName(e.target.value)}
              placeholder="e.g. Office Stationery"
              required
              className="rounded-2xl bg-slate-50/50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Tally Group
            </label>
            <select
              value={tallyGroup}
              onChange={e => setTallyGroup(e.target.value)}
              className="w-full h-10 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <option value="Indirect Expenses">Indirect Expenses</option>
              <option value="Direct Expenses">Direct Expenses</option>
              <option value="Administrative Expenses">Administrative Expenses</option>
              <option value="Selling & Distribution">Selling & Distribution</option>
            </select>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
              className="h-11 px-5 rounded-2xl text-xs font-black border-slate-200"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="h-11 px-5 rounded-2xl text-xs font-black text-white hover:opacity-90 bg-indigo-600"
            >
              {isPending ? 'Creating...' : 'Create Category'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

