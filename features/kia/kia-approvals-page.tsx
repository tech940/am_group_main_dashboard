'use client'

import { useState, useMemo, useEffect } from 'react'
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
  CornerUpLeft
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  invoiceNumber: string | null
  invoiceDocUrl: string | null
  glAccountId: string | null
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

  // Filter Scope: 'pending' (Pending My Approval), 'all' (All requests), 'vendors' (Vendor Ledgers), or 'gl_categories' (GL Category Ledgers)
  const [filterScope, setFilterScope] = useState<'pending' | 'all' | 'vendors' | 'gl_categories'>('pending')

  // Bulk selection states
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])

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
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // Details & Action Modal states
  const [detailRow, setDetailRow] = useState<ApprovalRequest | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  const [actionStage, setActionStage] = useState<'sales_manager' | 'accounts' | 'ea' | 'md' | 'payment_done' | null>(null)
  const [actionDecision, setActionDecision] = useState<'APPROVE' | 'HOLD' | 'REJECT' | 'SEND_BACK' | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDocUrl, setInvoiceDocUrl] = useState('')
  const [invoiceFileName, setInvoiceFileName] = useState('')
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [utrNumberVal, setUtrNumberVal] = useState('')
  const [paymentProofUrl, setPaymentProofUrl] = useState('')
  const [paymentProofFileName, setPaymentProofFileName] = useState('')
  const [uploadingPaymentProof, setUploadingPaymentProof] = useState(false)
  const [activeTab, setActiveTab] = useState<'timeline' | 'remarks'>('timeline')
  const [showTimeline, setShowTimeline] = useState(false)
  const [remarkText, setRemarkText] = useState('')
  const [addRemarkPending, setAddRemarkPending] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState('All')
  const [selectedGlFilter, setSelectedGlFilter] = useState('All')
  const [selectedBrand, setSelectedBrand] = useState('All')
  const [selectedGlId, setSelectedGlId] = useState('')
  const [glAccounts, setGlAccounts] = useState<any[]>([])

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

  const queryResult = useQuery<{ rows: ApprovalRequest[] }>({
    queryKey: ['kia-approval-requests'],
    queryFn: async () => {
      const res = await fetch('/api/brands/kia/approvals/list')
      if (!res.ok) throw new Error('Failed to load approvals list')
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
    mutationFn: async ({ ids, action, remarks }: { ids: string[]; action: 'APPROVE' | 'REJECT' | 'HOLD'; remarks: string }) => {
      const res = await fetch(`/api/brands/kia/approvals/bulk-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, remarks })
      })
      const resData = await res.json()
      if (!res.ok || resData.error) throw new Error(resData.error || 'Failed to complete bulk approval action')
      return resData
    },
    onSuccess: (resData) => {
      toast({ 
        title: 'Bulk Action completed', 
        description: resData.message || `Successfully processed ${resData.processedCount} approvals.`, 
        variant: 'success' 
      })
      setSelectedRequestIds([])
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
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
          <td style="padding: 12px 0; font-size: 11px; color: #64748b; text-align: right; font-weight: bold;">${new Date(hist.timestamp).toLocaleString('en-IN')}</td>
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
                <span class="meta-val">${new Date(row.createdAt).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })}</span>
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
                <th style="width: 20%;">User</th>
                <th style="width: 15%;">Role</th>
                <th style="width: 15%;">Decision</th>
                <th style="width: 35%;">Remarks</th>
                <th style="text-align: right; width: 15%;">Date/Time</th>
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
        <td style="padding: 12px 10px; font-size: 11px; font-weight: bold; color: #0f172a;">${new Date(row.createdAt).toLocaleDateString('en-IN')}</td>
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
              <span class="kpi-value">${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}</span>
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
                <th style="width: 12%; padding-left: 10px;">Date</th>
                <th style="width: 25%;">Requester</th>
                <th style="width: 15%;">Department</th>
                <th style="width: 20%;">Description</th>
                <th style="width: 12%;">Payment Type</th>
                <th style="width: 13%;">Workflow Status</th>
                <th style="text-align: right; width: 13%; padding-right: 10px;">Amount (₹)</th>
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


  const getPendingStageLabel = (req: ApprovalRequest): string => {
    if (req.vpApproval === 'NOT APPROVED') return 'Rejected by ED'
    if (req.vpApproval === 'HELD') return 'Held by ED'

    if (req.eaApproval === 'NOT APPROVED') return 'Rejected by EA'
    if (req.eaApproval === 'HELD') return 'Held by EA'

    if (req.managementApproval === 'NOT APPROVED') return 'Rejected by MD'
    if (req.managementApproval === 'HELD') return 'Held by MD'

    if (req.accountApproval === 'NOT APPROVED') return 'Rejected by Accounts'
    if (req.accountApproval === 'HELD') return 'Held by Accounts'

    if (req.emailSendStatus === 'SentBack') return 'Sent Back / Clarification'

    if (!req.vpApproval || req.vpApproval === '') return 'Pending ED'

    // ED approved — EA must see it first (non-blocking: MD can also act)
    if (req.vpApproval === 'APPROVED' && (!req.eaApproval || req.eaApproval === '')) {
      return 'Pending EA'
    }

    // EA approved (or EA was bypassed by MD) — now it's MD's turn
    if (req.vpApproval === 'APPROVED' && (!req.managementApproval || req.managementApproval === '')) {
      return 'Pending MD'
    }

    if (req.managementApproval === 'APPROVED' && (!req.accountApproval || req.accountApproval === '' || req.paymentStatus !== 'PAID')) {
      if (req.paymentStatus === 'PAID') return 'Paid'
      return 'Pending Accounts'
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

    if (pendingLabel === 'Pending ED') return 'sales_manager'
    // EA gets action button when it's EA's turn
    if (effectiveRole === 'ea' && pendingLabel === 'Pending EA') return 'ea'
    // MD/CEO can act on both Pending EA (non-blocking) and Pending MD
    if (['md', 'ceo'].includes(effectiveRole) && (pendingLabel === 'Pending EA' || pendingLabel === 'Pending MD')) return 'md'
    if (pendingLabel === 'Pending Accounts') return 'accounts'
    return null
  }

  const isUserAuthorizedForStage = (stage: string) => {
    if (['developer', 'admin'].includes(currentUser.role)) return true

    if (stage === 'sales_manager') return effectiveRole === 'ed'
    if (stage === 'ea') return ['ea'].includes(effectiveRole)
    if (stage === 'md') return ['md', 'ceo'].includes(effectiveRole)
    if (stage === 'accounts' || stage === 'payment_done') return ['accounts', 'finance_head', 'md', 'ceo'].includes(effectiveRole)
    return false
  }

  // Correlate whether a request is pending action specifically for the current logged-in user
  const getIsPendingForUser = (row: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(row)
    if (pendingLabel === 'Paid' || pendingLabel.startsWith('Rejected') || pendingLabel === 'Sent Back / Clarification') {
      return false
    }

    // MD/CEO: see both Pending EA (non-blocking) and Pending MD items
    if (['md', 'ceo'].includes(effectiveRole)) {
      return row.vpApproval === 'APPROVED' && (!row.managementApproval || row.managementApproval === '')
    }

    if (pendingLabel === 'Pending ED' && effectiveRole === 'ed') {
      return true
    }
    // EA sees items where ED approved but EA hasn't acted yet (and MD hasn't bypassed)
    if (effectiveRole === 'ea' && pendingLabel === 'Pending EA') {
      return true
    }
    if (pendingLabel === 'Pending Accounts' && ['accounts', 'finance_head'].includes(effectiveRole)) {
      return true
    }

    return false
  }

  // Compute metrics counts for top strip
  const totalCount = data?.rows.length || 0
  const pendingForMeCount = useMemo(() => {
    if (!data?.rows) return 0
    return data.rows.filter(getIsPendingForUser).length
  }, [data?.rows, effectiveRole])

  const approvedVolume = useMemo(() => {
    if (!data?.rows) return 0
    return data.rows
      .filter(r => r.managementApproval === 'APPROVED')
      .reduce((sum, r) => sum + Number(r.amount || 0), 0)
  }, [data?.rows])

  const rejectedCount = useMemo(() => {
    if (!data?.rows) return 0
    return data.rows.filter(r => getPendingStageLabel(r).startsWith('Rejected')).length
  }, [data?.rows])

  // Filter logic
  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(row => {
      // 1. Pending for me vs All filter
      if (filterScope === 'pending' && !getIsPendingForUser(row)) {
        return false
      }

      // 2. Search query filter
      const matchesSearch =
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
      const pendingLabel = getPendingStageLabel(row)
      const matchesStage = selectedStage === 'All' ||
        (selectedStage === 'pending_sales_manager' && pendingLabel === 'Pending ED') ||
        (selectedStage === 'pending_accounts' && pendingLabel === 'Pending Accounts') ||
        (selectedStage === 'pending_ea' && pendingLabel === 'Pending EA') ||
        (selectedStage === 'pending_md' && pendingLabel === 'Pending MD') ||
        (selectedStage === 'pending_payment' && pendingLabel === 'Pending Payment') ||
        (selectedStage === 'paid' && pendingLabel === 'Paid') ||
        (selectedStage === 'completed' && (pendingLabel === 'Fully Approved' || pendingLabel === 'Paid' || pendingLabel === 'Pending Payment')) ||
        (selectedStage === 'sent_back' && pendingLabel === 'Sent Back / Clarification') ||
        (selectedStage === 'rejected' && pendingLabel.startsWith('Rejected'))
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
    if (!data?.rows) return []
    const summaryMap: Record<string, { name: string; count: number; total: number; rows: ApprovalRequest[] }> = {}
    data.rows.forEach(row => {
      const vName = (row.vendorName || 'Unknown Vendor').trim()
      if (!summaryMap[vName]) {
        summaryMap[vName] = { name: vName, count: 0, total: 0, rows: [] }
      }
      summaryMap[vName].count += 1
      summaryMap[vName].total += Number(row.amount || 0)
      summaryMap[vName].rows.push(row)
    })
    return Object.values(summaryMap).sort((a, b) => b.total - a.total)
  }, [data?.rows])

  const glSummary = useMemo(() => {
    if (!data?.rows) return []
    const summaryMap: Record<string, { id: string; name: string; code: string; count: number; total: number; rows: ApprovalRequest[] }> = {}
    data.rows.forEach(row => {
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
  }, [data?.rows, glAccounts])

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
    return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  }

  const analyticsData = useMemo(() => {
    if (!data?.rows) {
      return { 
        totalApproved: 0, 
        totalPending: 0, 
        avgTxSize: 0, 
        topVendors: [], 
        topGlAccounts: [], 
        spendHighlights: {
          adSpend: 0,
          repairSpend: 0,
          fuelSpend: 0,
          salarySpend: 0,
          securitySpend: 0,
          vehiclePurchase: 0,
          partsPurchase: 0,
          travelSpend: 0,
          softwareSpend: 0,
          professionalSpend: 0
        }
      }
    }
    
    let totalApproved = 0
    let totalPending = 0
    let approvedCount = 0
    let pendingCount = 0
    const vendorMap: Record<string, number> = {}
    const glMap: Record<string, number> = {}
    
    let adSpend = 0
    let repairSpend = 0
    let fuelSpend = 0
    let salarySpend = 0
    let securitySpend = 0
    let vehiclePurchase = 0
    let partsPurchase = 0
    let travelSpend = 0
    let softwareSpend = 0
    let professionalSpend = 0

    data.rows.forEach(row => {
      const amount = Number(row.amount || 0)
      const stage = getPendingStageLabel(row)
      
      if (stage === 'Fully Approved') {
        totalApproved += amount
        approvedCount++
      } else if (!stage.startsWith('Rejected')) {
        totalPending += amount
        pendingCount++
      }
      
      const vName = (row.vendorName || 'Unknown Vendor').trim()
      vendorMap[vName] = (vendorMap[vName] || 0) + amount

      const glName = row.glName || 'Unclassified GL'
      glMap[glName] = (glMap[glName] || 0) + amount

      const glCode = row.glCode || ''
      if (['GL-032', 'GL-033', 'GL-034'].includes(glCode)) adSpend += amount
      else if (['GL-039', 'GL-040', 'GL-041', 'GL-042'].includes(glCode)) repairSpend += amount
      else if (['GL-047', 'GL-048'].includes(glCode)) fuelSpend += amount
      else if (['GL-024'].includes(glCode)) salarySpend += amount
      else if (['GL-045'].includes(glCode)) securitySpend += amount
      else if (['GL-011', 'GL-012', 'GL-013', 'GL-014'].includes(glCode)) vehiclePurchase += amount
      else if (['GL-015', 'GL-016'].includes(glCode)) partsPurchase += amount
      else if (['GL-052'].includes(glCode)) travelSpend += amount
      else if (['GL-056'].includes(glCode)) softwareSpend += amount
      else if (['GL-057', 'GL-059'].includes(glCode)) professionalSpend += amount
    })
    
    const topVendors = Object.entries(vendorMap)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)

    const topGlAccounts = Object.entries(glMap)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      
    const totalTransactions = approvedCount + pendingCount
    const avgTxSize = totalTransactions > 0 ? (totalApproved + totalPending) / totalTransactions : 0
    
    return {
      totalApproved,
      totalPending,
      avgTxSize,
      topVendors,
      topGlAccounts,
      spendHighlights: {
        adSpend,
        repairSpend,
        fuelSpend,
        salarySpend,
        securitySpend,
        vehiclePurchase,
        partsPurchase,
        travelSpend,
        softwareSpend,
        professionalSpend
      }
    }
  }, [data?.rows])

  function getSlaBadge(createdAt: string) {
    const hours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
    if (hours >= 120) {
      return (
        <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider animate-pulse">
          <Clock className="w-2.5 h-2.5" />
          Aging {Math.floor(hours / 24)}d
        </span>
      )
    }
    if (hours >= 48) {
      return (
        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
          <Clock className="w-2.5 h-2.5" />
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
      alerts.push(`Possible duplicate request detected (matches request by ${duplicate.name} for ₹${Number(duplicate.amount).toLocaleString('en-IN')} on ${new Date(duplicate.createdAt).toLocaleDateString('en-IN')})`)
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
    
    const stages = [
      { key: 'sales_manager', label: 'ED', status: req.vpApproval },
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
    if (d.includes('PURCHASE')) return 'bg-purple-100 text-purple-700 border-purple-200'
    if (d.includes('ACCESSORIES')) return 'bg-indigo-100 text-indigo-700 border-indigo-200'
    if (d.includes('TRAVEL')) return 'bg-sky-100 text-sky-700 border-sky-200'
    if (d.includes('MARKETING')) return 'bg-rose-100 text-rose-700 border-rose-200'
    if (d.includes('REPAIRS')) return 'bg-blue-100 text-blue-700 border-blue-200'
    if (d.includes('ADMIN')) return 'bg-teal-100 text-teal-700 border-teal-200'
    if (d.includes('HR')) return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    if (d.includes('SYSTEM') || d.includes('IT')) return 'bg-blue-100 text-blue-700 border-blue-200'
    if (d.includes('SALES')) return 'bg-pink-100 text-pink-700 border-pink-200'
    return 'bg-slate-100 text-slate-700 border-slate-200'
  }

  // Payment type badge coloring
  const getPaymentTypeBadgeClass = (type: string) => {
    const t = (type || '').trim().toUpperCase()
    if (t.includes('ONLINE') || t.includes('TRANSFER')) return 'border-blue-200 text-blue-600 bg-blue-50/20'
    if (t.includes('NEFT')) return 'border-emerald-200 text-emerald-600 bg-emerald-50/20'
    if (t.includes('RTGS') || t.includes('CHEQUE')) return 'border-violet-200 text-violet-600 bg-violet-50/20'
    return 'border-slate-200 text-slate-600 bg-slate-50/20'
  }

  const getBrandBadgeClass = (brand: string) => {
    const b = (brand || '').trim().toLowerCase()
    if (b === 'kia') return 'bg-red-50 text-red-700 border-red-200'
    if (b === 'hyundai') return 'bg-blue-50 text-blue-700 border-blue-200'
    if (b === 'mg') return 'bg-teal-50 text-teal-700 border-teal-200'
    return 'bg-slate-50 text-slate-700 border-slate-200'
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
    <MainLayout title="Vendor Payments" subtitle="Manage payment requests and multi-stage approval workflows">
      <div className="space-y-6">

        {/* 1. TOP METRICS STRIP */}
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          {/* Card 1: Total Requests */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <FileText className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Total Requests</span>
              <span className="text-2xl font-black text-slate-900">{totalCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">All time</span>
            </div>
          </div>

          {/* Card 2: Pending Approvals */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-500 block">Pending Approvals</span>
              <span className="text-2xl font-black text-amber-600">{pendingForMeCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">Awaiting your action</span>
            </div>
          </div>

          {/* Card 3: Approved Volume */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <IndianRupee className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-500 block">Approved Volume</span>
              <span className="text-2xl font-black text-emerald-700">₹{approvedVolume.toLocaleString('en-IN')}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">This year</span>
            </div>
          </div>

          {/* Card 4: Rejected */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.04)] p-5 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <XCircle className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 block">Rejected</span>
              <span className="text-2xl font-black text-rose-600">{rejectedCount}</span>
              <span className="text-[10px] font-semibold text-slate-400 block -mt-0.5">All time</span>
            </div>
          </div>
        </div>



        {/* 2. FILTER BAR */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-4 flex flex-col lg:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-4 top-3 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search requests..."
              className="pl-11 h-10 w-full rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
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

                      let cellClass = "h-8 w-8 text-xs flex items-center justify-center rounded-xl transition-all cursor-pointer "
                      if (isSelectedStart) {
                        cellClass += "bg-slate-950 text-white font-black"
                      } else if (isSelectedEnd) {
                        cellClass += "bg-slate-950 text-white font-black"
                      } else if (isInRange) {
                        cellClass += "bg-slate-100 text-slate-900 font-bold"
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
              className="h-10 px-4 w-full sm:w-[180px] rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer appearance-none"
            >
              <option value="All">All Workflow States</option>
              <option value="pending_sales_manager">Pending ED</option>
              <option value="pending_accounts">Pending Accounts</option>
              <option value="pending_ea">Pending EA</option>
              <option value="pending_md">Pending MD</option>
              <option value="pending_payment">Pending Payment</option>
              <option value="paid">Paid Cases</option>
              <option value="completed">Completed (All Approved)</option>
              <option value="sent_back">Sent Back / Clarification</option>
              <option value="rejected">Rejected Cases</option>
            </select>

            {/* Active Filters count button */}
            <button
              type="button"
              className="h-10 px-4 rounded-2xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5"
            >
              <span>Filters</span>
              <span className="bg-slate-950 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">
                {activeFiltersCount}
              </span>
            </button>

            <Button
              variant="outline"
              onClick={() => {
                const approvedIds = (data?.rows || [])
                  .filter((r: any) => getPendingStageLabel(r) === 'Fully Approved')
                  .map((r: any) => r.id)
                if (approvedIds.length === 0) {
                  toast({ title: 'No approved requests', description: 'There are no fully approved requests to export.', variant: 'error' })
                  return
                }
                window.open(`/api/brands/kia/approvals/export-tally?ids=${approvedIds.join(',')}`, '_blank')
              }}
              className="h-10 px-4 rounded-2xl border-slate-200 bg-white hover:bg-slate-50 text-slate-700 flex items-center justify-center gap-1.5 text-xs font-bold"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>Export Tally CSV</span>
            </Button>

            <Button
              variant="outline"
              onClick={() => setShowAnalytics(!showAnalytics)}
              className={cn(
                "h-10 px-4 rounded-2xl border-slate-200 flex items-center justify-center gap-1.5 text-xs font-bold transition-all",
                showAnalytics ? "bg-slate-900 border-slate-900 text-white hover:bg-slate-800" : "bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{showAnalytics ? 'Hide Analytics' : 'Show Analytics'}</span>
            </Button>

            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading || isFetching} className="h-10 w-10 rounded-2xl border-slate-200 flex-shrink-0">
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
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Approved Spend</span>
                  <span className="text-2xl font-black text-slate-900 mt-2">₹{analyticsData.totalApproved.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-emerald-600 mt-2 flex items-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5" /> Approved transactions
                  </span>
                </div>
                <div className="bg-white rounded-3xl p-5 border border-slate-100/80 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Pending Approvals Value</span>
                  <span className="text-2xl font-black text-amber-600 mt-2">₹{analyticsData.totalPending.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-slate-400 mt-2">Awaiting decision</span>
                </div>
                <div className="bg-white rounded-3xl p-5 border border-slate-100/80 shadow-[0_4px_20px_rgba(15,23,42,0.02)] flex flex-col justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Avg Transaction Size</span>
                  <span className="text-2xl font-black text-indigo-600 mt-2">₹{Math.round(analyticsData.avgTxSize).toLocaleString('en-IN')}</span>
                  <span className="text-[10px] font-semibold text-slate-400 mt-2">Across all requests</span>
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
                        return analyticsData.topVendors.map((vendor) => {
                          const pct = Math.round((vendor.total / maxSpend) * 100)
                          return (
                            <div key={vendor.name} className="space-y-1">
                              <div className="flex justify-between text-xs font-bold text-slate-700">
                                <span className="truncate max-w-[120px]">{vendor.name}</span>
                                <span className="font-mono text-slate-900">₹{vendor.total.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
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
                        return gls.map((gl) => {
                          const pct = Math.round((gl.total / maxSpend) * 100)
                          return (
                            <div key={gl.name} className="space-y-1">
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

        {/* Tab switch bar for Pending My Approval vs All Requests */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-1">
          <div className="flex gap-6 text-sm font-bold">
            <button
              onClick={() => setFilterScope('pending')}
              className={`pb-3 relative transition-all ${
                filterScope === 'pending' ? 'text-indigo-600 font-black' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span>Pending My Approval ({pendingForMeCount})</span>
              {filterScope === 'pending' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setFilterScope('all')}
              className={`pb-3 relative transition-all ${
                filterScope === 'all' ? 'text-indigo-600 font-black' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span>All Requests ({totalCount})</span>
              {filterScope === 'all' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setFilterScope('vendors')}
              className={`pb-3 relative transition-all ${
                filterScope === 'vendors' ? 'text-indigo-600 font-black' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span>Vendors ({vendorSummary.length})</span>
              {filterScope === 'vendors' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setFilterScope('gl_categories')}
              className={`pb-3 relative transition-all ${
                filterScope === 'gl_categories' ? 'text-indigo-600 font-black' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <span>GL Categories ({glSummary.length})</span>
              {filterScope === 'gl_categories' && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
          </div>
        </div>

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
                  <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50">
                    <th className="py-4 px-6 w-16">#</th>
                    <th className="py-4 px-6">Vendor Name</th>
                    <th className="py-4 px-6 text-center">Transactions</th>
                    <th className="py-4 px-6 text-right">Total Spend (₹)</th>
                    <th className="py-4 px-6 text-right">Action</th>
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
                        key={v.name}
                        onClick={() => {
                          setVendorStartDate('')
                          setVendorEndDate('')
                          setSelectedVendorMonth('all')
                          setSelectedVendorName(v.name)
                        }}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-6 font-mono text-slate-400">
                          {(idx + 1).toString().padStart(2, '0')}
                        </td>
                        <td className="py-4 px-6 font-bold text-slate-900">
                          {v.name}
                        </td>
                        <td className="py-4 px-6 text-center font-bold text-slate-600">
                          {v.count}
                        </td>
                        <td className="py-4 px-6 text-right font-black text-slate-950 text-base">
                          {v.total.toLocaleString('en-IN')}
                        </td>
                        <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setVendorStartDate('')
                              setVendorEndDate('')
                              setSelectedVendorMonth('all')
                              setSelectedVendorName(v.name)
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
                  <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50">
                    <th className="py-4 px-6 w-16">#</th>
                    <th className="py-4 px-6">GL Code</th>
                    <th className="py-4 px-6">GL Category Name</th>
                    <th className="py-4 px-6 text-center">Transactions</th>
                    <th className="py-4 px-6 text-right">Total Spend (₹)</th>
                    <th className="py-4 px-6 text-right">Action</th>
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
                          {(idx + 1).toString().padStart(2, '0')}
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
                    <tr className="border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50/50">
                      <th className="py-4 px-5 w-10">
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
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="py-4 px-5">#</th>
                      <th className="py-4 px-5">Requester</th>
                      <th className="py-4 px-5">Department</th>
                      <th className="py-4 px-5">Vendor</th>
                      <th className="py-4 px-5">Purpose / Request Type</th>
                      <th className="py-4 px-5">Amount (₹)</th>
                      <th className="py-4 px-5">Payment Type</th>
                      <th className="py-4 px-5">Submitted On</th>
                      <th className="py-4 px-5">Current Stage</th>
                      <th className="py-4 px-5">Status</th>
                      <th className="py-4 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm font-semibold text-slate-700">
                    {paginatedRows.map((row, idx) => {
                      const globalIdx = (currentPage - 1) * rowsPerPage + idx + 1
                      const numberBadge = getNumberBadgeClass(globalIdx)
                      const pendingLabel = getPendingStageLabel(row)

                      // Current Stage Display
                      let stageDisplay = (
                        <div className="flex flex-col">
                          <span className="text-slate-900 font-bold flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            {pendingLabel.replace('Pending ', '')}
                          </span>
                          <span className="text-slate-400 text-[11px] font-bold pl-3">Pending</span>
                        </div>
                      )
                      if (pendingLabel === 'Paid') {
                        stageDisplay = (
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Paid / भुगतान किया
                            </span>
                            <span className="text-emerald-600 text-[11px] font-bold pl-3">Approved & Paid</span>
                          </div>
                        )
                      } else if (pendingLabel === 'Pending Payment') {
                        stageDisplay = (
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                              Pending Payment
                            </span>
                            <span className="text-indigo-600 text-[11px] font-bold pl-3">Approved (Unpaid)</span>
                          </div>
                        )
                      } else if (pendingLabel === 'Sent Back / Clarification') {
                        stageDisplay = (
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-bounce" />
                              Clarification Pending
                            </span>
                            <span className="text-amber-600 text-[11px] font-bold pl-3">Sent Back</span>
                          </div>
                        )
                      } else if (pendingLabel.startsWith('Rejected')) {
                        stageDisplay = (
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              Rejected
                            </span>
                            <span className="text-rose-600 text-[11px] font-bold pl-3">Rejected</span>
                          </div>
                        )
                      }

                      // Status Badge Display
                      let statusBadge = (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                          PENDING
                        </span>
                      )
                      if (pendingLabel === 'Paid') {
                        statusBadge = (
                          <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            PAID
                          </span>
                        )
                      } else if (pendingLabel === 'Pending Payment') {
                        statusBadge = (
                          <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            APPROVED
                          </span>
                        )
                      } else if (pendingLabel === 'Sent Back / Clarification') {
                        statusBadge = (
                          <span className="bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            SENT BACK
                          </span>
                        )
                      } else if (pendingLabel.startsWith('Rejected')) {
                        statusBadge = (
                          <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            REJECTED
                          </span>
                        )
                      } else if (pendingLabel.startsWith('Held')) {
                        statusBadge = (
                          <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            HELD
                          </span>
                        )
                      }

                      return (
                        <tr
                          key={row.id}
                          onClick={() => setDetailRow(row)}
                          className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                        >
                          <td className="py-4 px-5 w-10" onClick={(e) => e.stopPropagation()}>
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
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            />
                          </td>
                          <td className="py-4 px-5">
                            <span className={`inline-flex items-center justify-center h-7 w-7 rounded-full border text-xs font-black tabular-nums ${numberBadge}`}>
                              {globalIdx.toString().padStart(2, '0')}
                            </span>
                          </td>
                          <td className="py-4 px-5">
                            <div className="flex flex-col gap-1 items-start">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-slate-950 font-bold">{row.name}</span>
                                <span className={`inline-block border px-1.5 py-0.5 rounded-full text-[8px] font-black tracking-wider uppercase ${getBrandBadgeClass(row.brand || '')}`}>
                                  {row.brand || '—'}
                                </span>
                              </div>
                              <span className="text-slate-400 text-xs font-semibold">{row.email}</span>
                            </div>
                          </td>
                          <td className="py-4 px-5">
                            <span className={`inline-block border px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase ${getDeptBadgeClass(row.department || '')}`}>
                              {row.department || '—'}
                            </span>
                          </td>
                          <td className="py-4 px-5 font-bold text-slate-950">
                            {row.vendorName || '—'}
                          </td>
                          <td className="py-4 px-5 text-xs text-slate-500 font-semibold max-w-[200px] truncate">
                            {row.remarks || '—'}
                          </td>
                          <td className="py-4 px-5 font-black text-slate-950 text-base">
                            {Number(row.amount || 0).toLocaleString('en-IN')}
                          </td>
                          <td className="py-4 px-5">
                            <span className={`inline-block border px-2.5 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase ${getPaymentTypeBadgeClass(row.typeOfPayment || '')}`}>
                              {row.typeOfPayment || '—'}
                            </span>
                          </td>
                          <td className="py-4 px-5">
                            <div className="flex flex-col items-start gap-1">
                              <span className="text-slate-900 font-bold block">
                                {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                              <span className="text-slate-400 text-xs font-semibold">
                                {new Date(row.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
                              {getSlaBadge(row.createdAt)}
                            </div>
                          </td>
                          <td className="py-4 px-5">
                            {stageDisplay}
                          </td>
                          <td className="py-4 px-5">
                            {statusBadge}
                          </td>
                          <td className="py-4 px-5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {/* Quick Approve Button (only if pending for user) */}
                              {getIsPendingForUser(row) && (() => {
                                const stageKey = getActiveStageKey(row)
                                if (!stageKey) return null
                                return (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      actionMutation.mutate({
                                        id: row.id,
                                        action: 'APPROVE',
                                        stage: stageKey,
                                        remarks: 'Quick approved'
                                      })
                                    }}
                                    disabled={actionMutation.isPending}
                                    className="h-8 px-4 rounded-xl text-xs font-black flex items-center justify-center gap-1 shadow-sm transition-all border border-emerald-600 hover:opacity-90"
                                    style={{ backgroundColor: '#10b981', color: '#ffffff' }}
                                  >
                                    {actionMutation.isPending && actionMutation.variables?.id === row.id && actionMutation.variables?.action === 'APPROVE' ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      'Approve'
                                    )}
                                  </button>
                                )
                              })()}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailRow(row)
                                }}
                                className="h-8 w-8 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-sm"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDetailRow(row)
                                }}
                                className="h-8 w-8 rounded-xl border border-slate-200 hover:border-slate-400 bg-white hover:bg-slate-50 flex items-center justify-center transition-all shadow-sm"
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
                const globalIdx = (currentPage - 1) * rowsPerPage + idx + 1
                const numberBadge = getNumberBadgeClass(globalIdx)
                const pendingLabel = getPendingStageLabel(row)

                return (
                  <div
                    key={row.id}
                    onClick={() => setDetailRow(row)}
                    className="bg-white rounded-3xl border border-slate-100 shadow-[0_10px_30px_rgba(15,23,42,0.02)] p-5 space-y-4 cursor-pointer hover:border-slate-300 transition-all"
                  >
                    {/* Header: Number, Requester, and Action */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full border text-xs font-black tabular-nums ${numberBadge}`}>
                          {globalIdx.toString().padStart(2, '0')}
                        </span>
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-slate-950 font-black text-sm">{row.name}</span>
                            <span className={`inline-block border px-1.5 py-0.5 rounded-full text-[8px] font-black tracking-wider uppercase ${getBrandBadgeClass(row.brand || '')}`}>
                              {row.brand || '—'}
                            </span>
                          </div>
                          <span className="text-slate-400 text-xs font-semibold">{row.email}</span>
                        </div>
                      </div>
                      <div className="inline-flex items-center gap-1.5">
                        {/* Mobile Quick Approve Button */}
                        {getIsPendingForUser(row) && (() => {
                          const stageKey = getActiveStageKey(row)
                          if (!stageKey) return null
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                actionMutation.mutate({
                                  id: row.id,
                                  action: 'APPROVE',
                                  stage: stageKey,
                                  remarks: 'Quick approved'
                                })
                              }}
                              disabled={actionMutation.isPending}
                              className="h-8 px-4 rounded-xl text-[11px] font-black flex items-center justify-center gap-1 shadow-sm transition-all border border-emerald-600 hover:opacity-90"
                              style={{ backgroundColor: '#10b981', color: '#ffffff' }}
                            >
                              {actionMutation.isPending && actionMutation.variables?.id === row.id && actionMutation.variables?.action === 'APPROVE' ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'Approve'
                              )}
                            </button>
                          )
                        })()}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDetailRow(row)
                          }}
                          className="h-8 w-8 rounded-xl border border-slate-200 bg-white flex items-center justify-center shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      </div>
                    </div>

                    {/* Tags: Department, Payment Type, Status */}
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`border px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${getDeptBadgeClass(row.department || '')}`}>
                        {row.department || '—'}
                      </span>
                      <span className={`border px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${getPaymentTypeBadgeClass(row.typeOfPayment || '')}`}>
                        {row.typeOfPayment || '—'}
                      </span>
                      {pendingLabel === 'Fully Approved' ? (
                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
                          APPROVED
                        </span>
                      ) : pendingLabel.startsWith('Rejected') ? (
                        <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
                          REJECTED
                        </span>
                      ) : (
                        <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
                          PENDING
                        </span>
                      )}
                      {getSlaBadge(row.createdAt)}
                    </div>

                    {/* Grid Details: Vendor, GL Account, Amount, Current Stage */}
                    <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Vendor</span>
                        <span className="font-bold text-slate-900 mt-0.5 block truncate" title={row.vendorName || '—'}>{row.vendorName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">GL Account</span>
                        <span className="font-bold text-indigo-700 mt-0.5 block truncate" title={row.glName || '—'}>{row.glName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Amount</span>
                        <span className="font-black text-slate-900 mt-0.5 block text-sm">₹{Number(row.amount || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="col-span-3 border-t border-slate-200/60 pt-2 mt-1">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Current Stage</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {pendingLabel === 'Fully Approved' ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              <span className="text-slate-900 font-bold">Fully Approved</span>
                            </>
                          ) : pendingLabel.startsWith('Rejected') ? (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              <span className="text-slate-900 font-bold">Rejected</span>
                            </>
                          ) : (
                            <>
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              <span className="text-slate-900 font-bold">{pendingLabel.replace('Pending ', '')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Footer: Date Submitted */}
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 pt-1">
                      <span>Submitted On</span>
                      <span className="text-slate-600 font-bold">
                        {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at{' '}
                        {new Date(row.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
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
                    className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
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
                            className={`h-8 w-8 rounded-full text-xs font-bold transition-all flex items-center justify-center ${
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
                    className="h-8 w-8 rounded-full hover:bg-slate-100 flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
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
      </div>

      {/* 4. DETAIL & ACTION CENTER OVERLAY MODAL */}
      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => { if (!open) setDetailRow(null) }}>
        <DialogContent className="rounded-[2rem] sm:rounded-[2.5rem] w-[calc(100vw-1rem)] sm:w-[calc(100vw-2rem)] sm:max-w-6xl bg-[#f8fafc] p-0 overflow-y-auto sm:overflow-hidden shadow-2xl border border-slate-100 max-h-[98vh] sm:max-h-[95vh] flex flex-col">
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
              if (req.uploadBillUrl1) {
                events.push({
                  id: 'bill1',
                  title: 'Attachment Added',
                  description: (
                    <button
                      type="button"
                      onClick={() => setPreviewDocUrl(req.uploadBillUrl1!)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline text-left"
                    >
                      Bill 1
                    </button>
                  ),
                  user: req.name,
                  timestamp: new Date(req.createdAt),
                  iconType: 'clip'
                })
              }
              if (req.uploadBillUrl2) {
                events.push({
                  id: 'bill2',
                  title: 'Attachment Added',
                  description: (
                    <button
                      type="button"
                      onClick={() => setPreviewDocUrl(req.uploadBillUrl2!)}
                      className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline text-left"
                    >
                      Bill 2
                    </button>
                  ),
                  user: req.name,
                  timestamp: new Date(req.createdAt),
                  iconType: 'clip'
                })
              }
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
            const remarksCount = timelineEvents.filter(e => e.iconType === 'remark').length
            const displayedEvents = activeTab === 'remarks' 
              ? timelineEvents.filter(e => e.iconType === 'remark')
              : timelineEvents

            const pendingStageKey = (() => {
              if (pendingLabel === 'Pending ED') return 'sales_manager'
              if (pendingLabel === 'Pending Accounts') return 'accounts'
              if (pendingLabel === 'Pending EA') return 'ea'
              if (pendingLabel === 'Pending MD') return 'md'
              if (pendingLabel === 'Pending Payment') return 'payment_done'
              return null
            })()

            const isUserEligibleForPendingStage = pendingStageKey ? isUserAuthorizedForStage(pendingStageKey) : false

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

            const renderOverviewItem = (label: string, value: string | React.ReactNode, icon: any, className?: string) => {
              const Icon = icon
              return (
                <div className={cn("border border-slate-100 bg-[#f8fafc]/40 rounded-2xl p-4 flex gap-3 items-start", className)}>
                  <div className="h-8 w-8 rounded-xl bg-slate-100 border border-slate-200/80 text-slate-700 flex items-center justify-center shrink-0">
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
                    <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] font-black text-slate-600 shrink-0">
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
              const stages = [
                { key: 'created', label: 'Created', status: 'APPROVED' },
                { key: 'sales_manager', label: 'ED Approval', status: req.vpApproval },
                { key: 'ea', label: 'EA Review (Optional)', status: req.eaApproval },
                { key: 'md', label: 'MD Approval', status: req.managementApproval },
                { key: 'accounts', label: 'Accounts Processing', status: req.accountApproval },
                { key: 'paid', label: 'Paid', status: req.paymentStatus === 'PAID' ? 'APPROVED' : null },
              ]

              const getStageDate = (key: string) => {
                if (key === 'created') {
                  return new Date(req.createdAt).toLocaleDateString('en-CA') // YYYY-MM-DD
                }
                if (key === 'paid') {
                  if (req.paymentStatus === 'PAID' && req.paymentCompletedAt) {
                    return new Date(req.paymentCompletedAt).toLocaleDateString('en-CA')
                  }
                  if (req.managementApproval === 'APPROVED' && req.invoiceDocUrl) {
                    const mdEntry = (req.history || []).find((h: any) => h.roleKey === 'md' && h.action === 'APPROVED')
                    if (mdEntry) return new Date(mdEntry.timestamp).toLocaleDateString('en-CA')
                  }
                  return null
                }
                const entry = (req.history || []).find((h: any) => h.roleKey === key && h.action === 'APPROVED')
                if (entry) {
                  return new Date(entry.timestamp).toLocaleDateString('en-CA')
                }
                return null
              }

              return (
                <div className="bg-white border border-slate-100 rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full relative pb-1 gap-6 sm:gap-0">
                    {stages.map((stg, i) => {
                      const isApproved = stg.status === 'APPROVED'
                      const isRejected = stg.status === 'NOT APPROVED'
                      const isHeld = stg.status === 'HELD'
                      
                      let isActive = false
                      if (pendingLabel === 'Pending ED' && stg.key === 'sales_manager') isActive = true
                      else if (pendingLabel === 'Pending Accounts' && stg.key === 'accounts') isActive = true
                      else if (pendingLabel === 'Pending EA' && stg.key === 'ea') isActive = true
                      else if (pendingLabel === 'Pending MD' && stg.key === 'md') isActive = true
                      else if (pendingLabel === 'Pending Payment' && stg.key === 'paid') isActive = true

                      let circleColor = 'bg-slate-100 text-slate-400 border-slate-200'
                      let textColor = 'text-slate-400 font-semibold'

                      if (isApproved) {
                        circleColor = 'bg-slate-900 text-white border-slate-900 shadow-md shadow-slate-900/10'
                        textColor = 'text-slate-900 font-black'
                      } else if (isRejected) {
                        circleColor = 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/10'
                        textColor = 'text-rose-700 font-black'
                      } else if (isHeld) {
                        circleColor = 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/10'
                        textColor = 'text-amber-700 font-black'
                      } else if (isActive) {
                        circleColor = 'bg-blue-600 text-white border-blue-600 ring-4 ring-blue-100 shadow-md shadow-blue-600/10'
                        textColor = 'text-blue-600 font-black'
                      }

                      const stageDate = getStageDate(stg.key)

                      return (
                        <div key={stg.key} className="flex-1 flex flex-row sm:flex-col items-center relative z-10 gap-3 sm:gap-0">
                           {i < stages.length - 1 && (
                            <div 
                              className={cn(
                                "absolute transition-colors duration-300",
                                // Mobile vertical line:
                                "left-3 top-[24px] w-0.5 h-[24px] sm:left-auto",
                                // Desktop horizontal line:
                                "sm:top-4 sm:left-[50%] sm:w-[100%] sm:h-0.5",
                                stages[i].status === 'APPROVED' ? 'bg-slate-900' : 'bg-slate-200'
                              )}
                              style={{ zIndex: 1 }}
                            />
                          )}
                          
                          <div 
                            className={cn("h-6 w-6 sm:h-8 sm:w-8 rounded-full border border-slate-200 flex items-center justify-center text-[10px] sm:text-xs font-black transition-all shrink-0 relative", circleColor)}
                            style={{ zIndex: 2 }}
                          >
                            {isApproved ? '✓' : isRejected ? '✗' : isHeld ? '‖' : i + 1}
                          </div>
                          
                          <div className="flex flex-col sm:items-center">
                            <span className={cn("text-[9px] sm:text-[10px] uppercase tracking-wider text-left sm:text-center block", textColor)}>
                              {stg.label}
                            </span>

                            {stageDate ? (
                              <span className="text-[8px] sm:text-[9px] text-slate-400 font-semibold mt-0.5 text-left sm:text-center block">
                                {stageDate}
                              </span>
                            ) : (
                              <span className="text-[8px] sm:text-[9px] text-slate-300 font-medium mt-0.5 text-left sm:text-center block">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }

            return (
              <>
                {/* Dialog Header */}
                <DialogHeader className="p-5 sm:p-8 pb-4 bg-white border-b border-slate-100 flex flex-col gap-2 relative">
                  <div className="flex flex-wrap items-center gap-1.5 pr-8">
                    <Badge className="bg-slate-900 text-white hover:bg-slate-900 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full">{detailRow.location}</Badge>
                    <Badge className="bg-slate-100 hover:bg-slate-100 border border-slate-200 text-slate-800 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full">{detailRow.department}</Badge>
                    <Badge className="bg-blue-50 hover:bg-blue-50 border border-blue-100 text-blue-700 px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-full">{detailRow.approvalType}</Badge>
                  </div>
                  
                  <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mt-1 pr-10">
                    <div>
                      <DialogTitle className="text-xl sm:text-2xl font-black tracking-tight text-slate-950">
                        Vendor Payment Request Details
                      </DialogTitle>
                      <DialogDescription className="text-[11px] sm:text-xs text-slate-400 font-semibold mt-1">
                        Payment request identification and approval timeline tracking.
                      </DialogDescription>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                      <div className="text-left sm:text-right mr-1 sm:mr-3">
                        <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-slate-400 block mb-0.5">Request Amount</span>
                        <span className="text-xl sm:text-2xl font-black text-slate-900 font-sans tracking-tight">₹{Number(detailRow.amount || 0).toLocaleString('en-IN')}</span>
                      </div>

                      {/* Top Action Buttons: Show Remarks & Export Voucher */}
                      <Button
                        onClick={() => setShowTimeline(!showTimeline)}
                        className={cn(
                          "h-9 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 px-3.5 cursor-pointer transition-all border",
                          showTimeline
                            ? "bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200"
                            : "bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 shadow-xs"
                        )}
                        variant="outline"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{showTimeline ? 'Hide Remarks' : `Show Remarks (${remarksCount})`}</span>
                      </Button>
                      
                      <Button
                        onClick={() => handlePrintVoucher(detailRow, pendingLabel)}
                        className="h-9 rounded-xl text-xs font-black border-slate-200 hover:bg-slate-50 flex items-center justify-center gap-1.5 px-3.5 cursor-pointer"
                        variant="outline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export</span>
                      </Button>
                    </div>
                  </div>
                </DialogHeader>

                {/* Dialog Body */}
                <div className={cn(
                  "flex-1 overflow-visible sm:overflow-y-auto lg:overflow-hidden grid grid-cols-1 p-5 sm:p-8 gap-6 sm:gap-8 transition-all duration-300",
                  showTimeline ? "lg:grid-cols-3" : "lg:grid-cols-1"
                )}>
                  {/* Left Column - Details */}
                  <div className={cn(
                    "space-y-6 lg:overflow-y-auto pr-2 lg:max-h-[calc(95vh-15rem)] transition-all",
                    showTimeline ? "lg:col-span-2" : "lg:col-span-1"
                  )}>
                    {/* Stepper Card */}
                    {renderNewWorkflowStepper(detailRow)}

                    {/* Risk Warning Box */}
                    {(() => {
                      const alerts = getAnomalyAlerts(detailRow, data?.rows || [])
                      if (alerts.length === 0) return null
                      return (
                        <div className="bg-rose-50 border border-rose-200/80 rounded-3xl p-5 space-y-2 animate-in fade-in duration-200 shadow-sm">
                          <div className="flex items-center gap-2 text-rose-800 text-xs font-black uppercase tracking-wider">
                            <AlertTriangle className="w-4 h-4 text-rose-600 animate-bounce" />
                            <span>System Risk Alert ({alerts.length})</span>
                          </div>
                          <ul className="list-disc list-inside text-xs font-semibold text-rose-700 space-y-1.5 pl-1.5">
                            {alerts.map((alert, idx) => (
                              <li key={idx} className="leading-relaxed">{alert}</li>
                            ))}
                          </ul>
                        </div>
                      )
                    })()}

                    {/* Budget Warning Box */}
                    {(() => {
                      if (!detailRow.glAccountId) return null
                      const now = new Date()
                      const currentMonthRows = (data?.rows || []).filter((r: any) => {
                        if (!r.glAccountId || r.glAccountId !== detailRow.glAccountId) return false
                        const rowDate = new Date(r.createdAt)
                        return rowDate.getMonth() === now.getMonth() && rowDate.getFullYear() === now.getFullYear()
                      })
                      const approvedSpend = currentMonthRows
                        .filter((r: any) => getPendingStageLabel(r) === 'Fully Approved')
                        .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0)

                      const monthlyBudget = 1000000
                      const requestAmount = Number(detailRow.amount || 0)
                      const isExceedingBudget = (approvedSpend + requestAmount) > monthlyBudget

                      if (!isExceedingBudget) return null

                      return (
                        <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 space-y-2 animate-in fade-in duration-200 shadow-sm">
                          <div className="flex items-center gap-2 text-amber-800 text-xs font-black uppercase tracking-wider">
                            <AlertTriangle className="w-4 h-4 text-amber-600 animate-bounce" />
                            <span>Budget Alert / बजट चेतावनी</span>
                          </div>
                          <p className="text-xs font-semibold text-amber-700 leading-relaxed">
                            ⚠ This payment exceeds the approved monthly budget of ₹{monthlyBudget.toLocaleString('en-IN')}. (Current Month Spend: ₹{approvedSpend.toLocaleString('en-IN')}, Current Request: ₹{requestAmount.toLocaleString('en-IN')}).
                          </p>
                        </div>
                      )
                    })()}

                    {detailRow.emailSendStatus === 'SentBack' && detailRow.sendBackReason && (
                      <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 space-y-2 animate-in fade-in duration-200 shadow-sm">
                        <div className="flex items-center gap-2 text-amber-800 text-xs font-black uppercase tracking-wider">
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span>Clarification Required / स्पष्टीकरण आवश्यक</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-700 leading-relaxed">
                          This request was sent back to you with the following remarks:
                        </p>
                        <p className="text-sm font-bold text-amber-900 bg-white/70 p-3 rounded-2xl border border-amber-100 whitespace-pre-wrap">
                          {detailRow.sendBackReason}
                        </p>
                      </div>
                    )}

                    {/* Request Overview Card */}
                    <div className="bg-white border border-slate-100 rounded-3xl p-6 space-y-4 shadow-sm">
                      <div className="flex items-center gap-2 text-slate-800">
                        <ClipboardList className="w-4 h-4 text-slate-700" />
                        <span className="text-xs font-black uppercase tracking-wider">Request Overview</span>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        {renderOverviewItem('Requester', detailRow.name, User)}
                        {renderOverviewItem('Email', detailRow.email, Mail)}
                        {renderOverviewItem('Brand', <span className="uppercase font-black text-slate-900">{detailRow.brand || '—'}</span>, Store)}
                        {renderOverviewItem('Dealer Name', detailRow.dealerName || '—', Building2)}
                        {renderOverviewItem('Dealer Code', detailRow.dealerCode || '—', Key)}
                        {renderOverviewItem('Vendor Name', detailRow.vendorName || '—', User)}
                        {renderOverviewItem('Payment Type', detailRow.typeOfPayment || '—', CreditCard)}
                        {renderOverviewItem('Workflow Status', <span className="text-blue-700 font-bold">{pendingLabel}</span>, Clock)}
                        {renderOverviewItem('Submitted On', new Date(detailRow.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), Calendar)}
                        {renderOverviewItem('GL Account', detailRow.glName ? `${detailRow.glName} (${detailRow.glCode})` : '—', Database)}
                        {renderOverviewItem('GST Details', detailRow.gst || '—', Percent)}
                        {renderOverviewItem('Reference / Invoice No.', detailRow.invoiceNumber || '—', FileText)}
                        {detailRow.uploadBillUrl1 && renderOverviewItem('Primary Bill', <button type="button" onClick={() => setPreviewDocUrl(detailRow.uploadBillUrl1!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-sm hover:shadow-indigo-200/50 transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /><span>View Bill 1</span></button>, FileText)}
                        {detailRow.uploadBillUrl2 && renderOverviewItem('Secondary Bill', <button type="button" onClick={() => setPreviewDocUrl(detailRow.uploadBillUrl2!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-sm hover:shadow-indigo-200/50 transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /><span>View Bill 2</span></button>, FileText)}
                        {detailRow.uploadDocUrl && renderOverviewItem('Support Document', <button type="button" onClick={() => setPreviewDocUrl(detailRow.uploadDocUrl!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-sm hover:shadow-indigo-200/50 transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /><span>View Support Doc</span></button>, FileText)}
                        {detailRow.invoiceDocUrl && renderOverviewItem('Uploaded Invoice', <button type="button" onClick={() => setPreviewDocUrl(detailRow.invoiceDocUrl!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs shadow-sm hover:shadow-emerald-200/50 transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /><span>View Invoice</span></button>, FileText)}
                        {detailRow.paymentStatus === 'PAID' && renderOverviewItem('Payment Status', <span className="text-emerald-700 font-black">PAID / भुगतान किया</span>, CheckCircle2)}
                        {detailRow.paymentStatus === 'PAID' && renderOverviewItem('UTR / Txn ID', detailRow.utrNumber || '—', Key)}
                        {detailRow.paymentStatus === 'PAID' && detailRow.paymentProofUrl && renderOverviewItem('Payment Proof', <button type="button" onClick={() => setPreviewDocUrl(detailRow.paymentProofUrl!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-sm hover:shadow-indigo-200/50 transition-all cursor-pointer"><Eye className="w-3.5 h-3.5" /><span>View Proof</span></button>, FileText)}
                        {detailRow.paymentStatus === 'PAID' && detailRow.paymentCompletedAt && renderOverviewItem('Paid On / By', `${new Date(detailRow.paymentCompletedAt).toLocaleDateString('en-IN')} by ${detailRow.paymentCompletedBy || '—'}`, User)}
                        {renderOverviewItem('Remarks (Submitter)', detailRow.remarks || '—', MessageSquare, 'col-span-1 sm:col-span-2 md:col-span-4 bg-amber-50/40 border-amber-100/80')}
                      </div>
                    </div>

                    {/* Prominent Attached Bill & Documents Card Section */}
                    {(() => {
                      const docs = [
                        { label: 'Primary Bill / Invoice', url: detailRow.uploadBillUrl1 },
                        { label: 'Secondary Bill / Attachment', url: detailRow.uploadBillUrl2 },
                        { label: 'Support Document', url: detailRow.uploadDocUrl },
                        { label: 'Accounts Invoice', url: detailRow.invoiceDocUrl },
                        { label: 'Payment Proof', url: detailRow.paymentProofUrl },
                      ].filter((d) => Boolean(d.url))

                      if (docs.length === 0) return null

                      return (
                        <div className="bg-white border border-slate-200/80 rounded-3xl p-6 space-y-4 shadow-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-slate-900">
                              <FileText className="w-4.5 h-4.5 text-slate-800" />
                              <span className="text-xs font-black uppercase tracking-wider">Attached Bill & Documents ({docs.length})</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {docs.map((doc, idx) => {
                              const url = doc.url!
                              const isImage = /\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i.test(url) || !url.toLowerCase().endsWith('.pdf')
                              return (
                                <div key={idx} className="border border-slate-200 bg-slate-50/60 hover:bg-slate-50 rounded-2xl p-3.5 space-y-3 transition-all flex flex-col justify-between">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-800 truncate">{doc.label}</span>
                                    <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">{isImage ? 'Image' : 'File'}</span>
                                  </div>

                                  {isImage ? (
                                    <div 
                                      onClick={() => setPreviewDocUrl(url)}
                                      className="relative h-44 w-full rounded-xl overflow-hidden bg-slate-900/5 border border-slate-200 cursor-pointer group flex items-center justify-center"
                                    >
                                      <img 
                                        src={url} 
                                        alt={doc.label} 
                                        className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                                      />
                                      <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-bold">
                                        <Eye className="w-4 h-4" />
                                        <span>Click to Expand Bill</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div 
                                      onClick={() => setPreviewDocUrl(url)}
                                      className="h-36 w-full rounded-xl bg-slate-100 border border-slate-200 cursor-pointer group flex flex-col items-center justify-center p-4 gap-2 hover:bg-slate-200/70 transition-colors"
                                    >
                                      <FileText className="w-8 h-8 text-slate-600 group-hover:scale-110 transition-transform" />
                                      <span className="text-xs font-bold text-slate-700 text-center line-clamp-1">{doc.label}</span>
                                    </div>
                                  )}

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewDocUrl(url)}
                                      className="flex-1 text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 rounded-xl py-2.5 px-3 flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      <span>View Bill</span>
                                    </button>
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs font-bold bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl py-2.5 px-3 flex items-center justify-center gap-1 transition-colors"
                                      title="Open in new tab"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}


                  </div>

                  {/* Right Column - Activity Panel */}
                  {showTimeline && (
                    <div className="bg-white border border-slate-100 rounded-3xl flex flex-col overflow-hidden lg:max-h-[calc(95vh-12rem)] shadow-sm animate-in slide-in-from-right duration-300 w-full">
                    {/* Panel Tabs */}
                    <div className="flex border-b border-slate-100 shrink-0 bg-slate-50/20">
                      <button
                        onClick={() => setActiveTab('timeline')}
                        className={cn(
                          "flex-1 py-4 px-6 text-xs font-black flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer",
                          activeTab === 'timeline' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
                        )}
                      >
                        <Activity className="w-4 h-4" />
                        <span>Activity Timeline</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('remarks')}
                        className={cn(
                          "flex-1 py-4 px-6 text-xs font-black flex items-center justify-center gap-2 border-b-2 transition-all cursor-pointer",
                          activeTab === 'remarks' ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-400 hover:text-slate-600"
                        )}
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>Remarks</span>
                        <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0">
                          {remarksCount}
                        </span>
                      </button>
                    </div>

                    {/* Timeline List */}
                    <div className="flex-1 lg:overflow-y-auto p-6 space-y-6 lg:max-h-[calc(95vh-26rem)]">
                      {displayedEvents.length === 0 ? (
                        <p className="text-center text-xs text-slate-400 font-semibold py-8">No events to display.</p>
                      ) : (
                        displayedEvents.map((evt, idx) => {
                          let IconComponent = MessageSquare
                          let iconBgColor = 'bg-slate-50 text-slate-500 border-slate-100'
                          
                          if (evt.iconType === 'phone') {
                            IconComponent = Phone
                            iconBgColor = 'bg-emerald-50 text-emerald-600 border-emerald-100'
                          } else if (evt.iconType === 'create') {
                            IconComponent = FileText
                            iconBgColor = 'bg-indigo-50 text-indigo-600 border-indigo-100'
                          } else if (evt.iconType === 'clip') {
                            IconComponent = Paperclip
                            iconBgColor = 'bg-blue-50 text-blue-600 border-blue-100'
                          } else if (evt.iconType === 'remark') {
                            IconComponent = MessageSquare
                            iconBgColor = 'bg-amber-50 text-amber-600 border-amber-100'
                          } else if (evt.iconType === 'approve') {
                            IconComponent = Check
                            iconBgColor = 'bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/10'
                          } else if (evt.iconType === 'reject') {
                            IconComponent = X
                            iconBgColor = 'bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/10'
                          } else if (evt.iconType === 'hold') {
                            IconComponent = Clock
                            iconBgColor = 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/10'
                          } else if (evt.iconType === 'gl') {
                            IconComponent = RefreshCw
                            iconBgColor = 'bg-indigo-50 text-indigo-600 border-indigo-100'
                          }

                          return (
                            <div key={evt.id} className="flex gap-4 relative">
                              {idx < displayedEvents.length - 1 && (
                                <div className="absolute top-8 left-4 w-0.5 h-[calc(100%+1.5rem)] bg-slate-100" />
                              )}

                              <div className={cn("h-8 w-8 rounded-full border flex items-center justify-center shrink-0 z-10", iconBgColor)}>
                                <IconComponent className="w-3.5 h-3.5" />
                              </div>

                              <div className="space-y-1">
                                <span className="text-xs font-black text-slate-800 block leading-tight">{evt.title}</span>
                                <div className="text-xs font-semibold text-slate-500 leading-relaxed pr-2">{evt.description}</div>
                                <span className="text-[9px] font-bold text-slate-400 block mt-1">
                                  {evt.user} · {evt.timestamp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, {evt.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>

                    {/* Timeline Text Area Footer */}
                    <div className="p-4 border-t border-slate-100 bg-[#f8fafc]/30 space-y-3 shrink-0">
                      <div className="relative">
                        <textarea
                          placeholder="Add a remark..."
                          value={remarkText}
                          maxLength={500}
                          onChange={e => setRemarkText(e.target.value)}
                          className="w-full min-h-[80px] p-3 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-950 pr-4"
                        />
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-[9px] font-bold text-slate-400">
                            {remarkText.length} / 500
                          </span>
                          <Button
                            size="sm"
                            disabled={!remarkText.trim() || addRemarkPending}
                            onClick={handleAddRemark}
                            className="h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-[10px] font-black flex items-center gap-1.5 px-3 cursor-pointer"
                          >
                            {addRemarkPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Send className="w-3 h-3" />
                                <span>Add Remark</span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                  )}
                </div>

                {/* Dialog Footer */}
                <div className="p-4 sm:p-6 border-t border-slate-100 bg-white flex flex-col sm:flex-row justify-between items-center gap-4 w-full shrink-0">
                  <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-wider text-center sm:text-left">
                    <Info className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>Created by {detailRow.name} on {new Date(detailRow.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                    {isUserEligibleForPendingStage && !isApproved && !isRejected ? (
                      <>
                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            if (pendingStageKey === 'accounts' || pendingStageKey === 'payment_done') {
                              setActionStage(pendingStageKey)
                              setActionDecision('APPROVE')
                            } else {
                              actionMutation.mutate({
                                id: detailRow.id,
                                action: 'APPROVE',
                                stage: pendingStageKey!,
                                remarks: remarkText || ''
                              })
                            }
                          }}
                          className="text-white text-xs font-black rounded-xl h-10 px-5 flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                          style={{ backgroundColor: '#059669', color: '#ffffff' }}
                        >
                          {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
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
                          className="text-white text-xs font-black rounded-xl h-10 px-5 flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                          style={{ backgroundColor: '#d97706', color: '#ffffff' }}
                        >
                          <CornerUpLeft className="w-4 h-4" />
                          <span>Send Back</span>
                        </button>

                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionStage(pendingStageKey!)
                            setActionDecision('REJECT')
                          }}
                          className="text-white text-xs font-black rounded-xl h-10 px-5 flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                          style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
                        >
                          <X className="w-4 h-4" />
                          <span>Reject Request</span>
                        </button>

                        <button
                          type="button"
                          disabled={actionMutation.isPending}
                          onClick={() => {
                            setActionStage(pendingStageKey!)
                            setActionDecision('HOLD')
                          }}
                          className="text-white text-xs font-black rounded-xl h-10 px-5 flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none border-none"
                          style={{ backgroundColor: '#475569', color: '#ffffff' }}
                        >
                          <Clock className="w-4 h-4" />
                          <span>Hold Request</span>
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-extrabold text-slate-500 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
                        Status: {pendingLabel}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* 4.5 VENDOR LEDGER DETAILS DIALOG */}
      <Dialog open={Boolean(selectedVendorName)} onOpenChange={(open) => { if (!open) setSelectedVendorName(null) }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
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
                                  <th className="py-3 px-4 w-12">#</th>
                                  <th className="py-3 px-4">Date</th>
                                  <th className="py-3 px-4">Requester</th>
                                  <th className="py-3 px-4">Payment Type</th>
                                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                                  <th className="py-3 px-4 text-right">Workflow Status</th>
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
                                      {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
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
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100">
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
                style={{ backgroundColor: '#d97706', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'SEND_BACK' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Send Back
              </Button>
            )}

            {(!actionDecision || actionDecision === 'APPROVE') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    if (actionStage === 'accounts') {
                      if (!invoiceNumber.trim()) {
                        toast({ title: 'Invoice number required', description: 'Please enter the invoice number.', variant: 'error' })
                        return
                      }
                      if (!invoiceDocUrl) {
                        toast({ title: 'Invoice upload required', description: 'Please upload the invoice document (PDF or image).', variant: 'error' })
                        return
                      }
                    }
                    if (actionStage === 'payment_done') {
                      if (!utrNumberVal.trim()) {
                        toast({ title: 'UTR number required', description: 'Please enter the transaction UTR number.', variant: 'error' })
                        return
                      }
                      if (!paymentProofUrl) {
                        toast({ title: 'Payment proof required', description: 'Please upload the payment proof document.', variant: 'error' })
                        return
                      }
                    }
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'APPROVE',
                      stage: actionStage,
                      remarks: actionRemarks,
                      invoiceNumber: actionStage === 'accounts' ? invoiceNumber : undefined,
                      invoiceDocUrl: actionStage === 'accounts' ? invoiceDocUrl : undefined,
                      utrNumber: actionStage === 'payment_done' ? utrNumberVal : undefined,
                      paymentProofUrl: actionStage === 'payment_done' ? paymentProofUrl : undefined,
                      glAccountId: selectedGlId || undefined
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black shadow-md shadow-emerald-600/10 hover:opacity-90"
                style={{ backgroundColor: '#059669', color: '#ffffff' }}
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
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col">
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
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-4xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
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
                                  <th className="py-3 px-4 w-12">#</th>
                                  <th className="py-3 px-4">Date</th>
                                  <th className="py-3 px-4">Vendor</th>
                                  <th className="py-3 px-4">Requester</th>
                                  <th className="py-3 px-4 text-right">Amount (₹)</th>
                                  <th className="py-3 px-4 text-right">Workflow Status</th>
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
                                      {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
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

      {/* Floating Bulk Action Bar */}
      {selectedRequestIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white rounded-3xl px-6 py-4 flex items-center gap-6 shadow-2xl border border-slate-800 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <span className="text-xs font-black tracking-wider uppercase">
            {selectedRequestIds.length} Requests Selected
          </span>
          <div className="flex gap-2">
            <Button
              onClick={() => setSelectedRequestIds([])}
              variant="ghost"
              className="h-9 px-4 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-850"
            >
              Deselect
            </Button>
            <button
              type="button"
              onClick={() => {
                bulkActionMutation.mutate({
                  ids: selectedRequestIds,
                  action: 'APPROVE',
                  remarks: 'Bulk approved'
                })
              }}
              disabled={bulkActionMutation.isPending}
              className="h-9 px-4 rounded-xl text-xs font-black flex items-center gap-1 hover:opacity-90 transition-all border border-emerald-600"
              style={{ backgroundColor: '#10b981', color: '#ffffff' }}
            >
              {bulkActionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Bulk Approve'}
            </button>
          </div>
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
              GL Code / जीएल कोड
            </span>
            <span className="text-xs font-black text-indigo-600 font-mono">
              [ System Generated / सिस्टम द्वारा जनरेटेड ]
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              GL Category Name / जीएल श्रेणी का नाम
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
              Tally Group / टैली ग्रुप
            </label>
            <select
              value={tallyGroup}
              onChange={e => setTallyGroup(e.target.value)}
              className="w-full h-10 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-xs font-semibold text-slate-800 cursor-pointer"
            >
              <option value="Indirect Expenses">Indirect Expenses (अप्रत्यक्ष खर्च)</option>
              <option value="Direct Expenses">Direct Expenses (प्रत्यक्ष खर्च)</option>
              <option value="Administrative Expenses">Administrative Expenses (प्रशासनिक खर्च)</option>
              <option value="Selling & Distribution">Selling & Distribution (बिक्री और वितरण)</option>
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

