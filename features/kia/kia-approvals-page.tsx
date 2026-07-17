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
  Plus
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

  // Filter Scope: 'pending' (Pending My Approval), 'all' (All requests), or 'vendors' (Vendor Ledgers)
  const [filterScope, setFilterScope] = useState<'pending' | 'all' | 'vendors'>('pending')

  // Bulk selection states
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([])

  // Vendor Ledgers states
  const [selectedVendorName, setSelectedVendorName] = useState<string | null>(null)
  const [vendorStartDate, setVendorStartDate] = useState<string>('')
  const [vendorEndDate, setVendorEndDate] = useState<string>('')

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // Details & Action Modal states
  const [detailRow, setDetailRow] = useState<ApprovalRequest | null>(null)
  const [actionRemarks, setActionRemarks] = useState('')
  const [actionStage, setActionStage] = useState<'sales_manager' | 'accounts' | 'ea' | 'md' | null>(null)
  const [actionDecision, setActionDecision] = useState<'APPROVE' | 'HOLD' | 'REJECT' | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('All')

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

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, stage, remarks }: { id: string; action: 'APPROVE' | 'REJECT' | 'HOLD'; stage: string; remarks: string }) => {
      const res = await fetch(`/api/brands/kia/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, stage, remarks })
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
      // Close detail view or update the open detailRow with the new matching data if query invalidates
      setDetailRow(null)
      queryClient.invalidateQueries({ queryKey: ['kia-approval-requests'] })
    },
    onError: (err) => {
      toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please check your role permissions.', variant: 'error' })
    }
  })

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
          <td style="padding: 10px 0; font-size: 11px; font-weight: bold; color: #1e293b;">${hist.user} (${hist.role})</td>
          <td style="padding: 10px 0; font-size: 11px; font-weight: bold; text-transform: uppercase;"><span style="padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 900; background: ${hist.action === 'APPROVED' ? '#ecfdf5; color: #065f46; border: 1px solid #a7f3d0' : hist.action === 'HELD' ? '#fffbeb; color: #92400e; border: 1px solid #fde68a' : '#fef2f2; color: #991b1b; border: 1px solid #fecaca'}">${hist.action}</span></td>
          <td style="padding: 10px 0; font-size: 11px; color: #64748b; font-style: italic;">"${hist.remarks || 'No comment'}"</td>
          <td style="padding: 10px 0; font-size: 11px; color: #64748b; text-align: right;">${new Date(hist.timestamp).toLocaleString('en-IN')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="4" style="padding: 15px 0; text-align: center; color: #94a3b8; font-size: 12px;">No approval history recorded.</td></tr>'

    const htmlContent = `
      <html>
        <head>
          <title>Voucher - ${row.id.substring(0, 8)}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; margin: 0; background: #ffffff; }
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 30px; }
            .logo { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #0f172a; }
            .title { text-align: right; }
            .title h1 { margin: 0; font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; color: #4338ca; }
            .title p { margin: 3px 0 0 0; font-size: 11px; color: #64748b; font-weight: bold; }
            .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 35px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
            .meta-item { font-size: 12px; }
            .meta-label { color: #64748b; text-transform: uppercase; font-size: 9px; font-weight: bold; letter-spacing: 0.5px; display: block; margin-bottom: 2px; }
            .meta-val { font-weight: bold; color: #0f172a; }
            .remarks-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px; padding: 15px 20px; margin-bottom: 35px; }
            .remarks-box h3 { margin: 0 0 5px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #b45309; }
            .remarks-box p { margin: 0; font-size: 12px; font-weight: 600; color: #78350f; line-height: 1.5; }
            .section-title { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 15px; }
            .history-table { width: 100%; border-collapse: collapse; margin-bottom: 45px; }
            .history-table th { text-align: left; font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
            .sig-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-top: 50px; page-break-inside: avoid; }
            .sig-box { border-top: 1px solid #cbd5e1; text-align: center; padding-top: 10px; font-size: 11px; font-weight: bold; color: #64748b; }
            .sig-box span { display: block; font-size: 9px; font-weight: normal; color: #94a3b8; margin-top: 3px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">AM GROUP <span style="font-weight: 300;">| KIA</span></div>
            <div class="title">
              <h1>Payment Approval Voucher</h1>
              <p>ID: ${row.id.toUpperCase()}</p>
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item"><span class="meta-label">Requester Name</span><span class="meta-val">${row.name}</span></div>
            <div class="meta-item"><span class="meta-label">Amount (₹)</span><span class="meta-val" style="color: #4338ca; font-size: 14px;">₹${Number(row.amount).toLocaleString('en-IN')}</span></div>
            <div class="meta-item"><span class="meta-label">Email Address</span><span class="meta-val">${row.email}</span></div>
            <div class="meta-item"><span class="meta-label">Dealer Name</span><span class="meta-val">${row.dealerName || '—'}</span></div>
            ${row.dealerCode ? `<div class="meta-item"><span class="meta-label">Dealer Code</span><span class="meta-val">${row.dealerCode}</span></div>` : ''}
            <div class="meta-item"><span class="meta-label">Vendor Name</span><span class="meta-val">${row.vendorName || '—'}</span></div>
            <div class="meta-item"><span class="meta-label">Payment Type</span><span class="meta-val">${row.typeOfPayment || '—'}</span></div>
            <div class="meta-item"><span class="meta-label">Workflow Status</span><span class="meta-val" style="color: #4338ca;">${pendingLabel}</span></div>
            <div class="meta-item" style="grid-column: span 2;"><span class="meta-label">Submitted On</span><span class="meta-val">${new Date(row.createdAt).toLocaleString('en-IN')}</span></div>
          </div>

          ${row.remarks ? `
          <div class="remarks-box">
            <h3>Submitter's Note / Remarks</h3>
            <p>${row.remarks}</p>
          </div>
          ` : ''}

          <div class="section-title">Approval Flow Verification Logs</div>
          <table class="history-table">
            <thead>
              <tr>
                <th style="width: 25%;">User & Role</th>
                <th style="width: 15%;">Decision</th>
                <th style="width: 40%;">Remarks</th>
                <th style="text-align: right; width: 20%;">Date/Time</th>
              </tr>
            </thead>
            <tbody>
              ${historyHTML}
            </tbody>
          </table>

          <div class="sig-grid">
            <div class="sig-box">Sales Manager Approval<span>Sign & Date</span></div>
            <div class="sig-box">Accounts Approval<span>Sign & Date</span></div>
            <div class="sig-box">EA Approval<span>Sign & Date</span></div>
            <div class="sig-box">MD Approval<span>Sign & Date</span></div>
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
    const tableRowsHTML = rows.map((row) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 10px 0; font-size: 11px; font-weight: bold;">${new Date(row.createdAt).toLocaleDateString('en-IN')}</td>
        <td style="padding: 10px 0; font-size: 11px;">${row.name} (${row.email})</td>
        <td style="padding: 10px 0; font-size: 11px;">${row.typeOfPayment || '—'}</td>
        <td style="padding: 10px 0; font-size: 11px; font-weight: bold; color: #4338ca;">₹${Number(row.amount).toLocaleString('en-IN')}</td>
        <td style="padding: 10px 0; font-size: 11px; font-weight: bold; text-align: right;">${getPendingStageLabel(row)}</td>
      </tr>
    `).join('')

    const htmlContent = `
      <html>
        <head>
          <title>Ledger - ${vendorName}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #0f172a; margin: 0; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 30px; }
            .logo { font-size: 20px; font-weight: 950; color: #0f172a; }
            .meta-info { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 12px; }
            .ledger-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .ledger-table th { text-align: left; font-size: 10px; font-weight: bold; text-transform: uppercase; color: #64748b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
            .total-row { border-top: 2px solid #0f172a; font-weight: 900; font-size: 13px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="logo">AM GROUP <span style="font-weight: 300;">| VENDOR STATEMENT</span></div>
            <h1 style="margin: 15px 0 0 0; font-size: 18px; font-weight: 900; text-transform: uppercase; color: #4338ca;">Vendor Ledger: ${vendorName}</h1>
          </div>

          <div class="meta-info">
            <div>Statement Date: ${new Date().toLocaleDateString('en-IN')}</div>
            <div>Total Transactions: ${rows.length}</div>
          </div>

          <table class="ledger-table">
            <thead>
              <tr>
                <th style="width: 15%;">Date</th>
                <th style="width: 35%;">Requester</th>
                <th style="width: 15%;">Payment Type</th>
                <th style="width: 15%;">Amount (₹)</th>
                <th style="text-align: right; width: 20%;">Workflow Status</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHTML}
              <tr class="total-row">
                <td colspan="3" style="padding: 12px 0;">TOTAL SPEND</td>
                <td style="padding: 12px 0; color: #4338ca;">₹${totalSpend.toLocaleString('en-IN')}</td>
                <td></td>
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

  const getActiveStageKey = (req: ApprovalRequest) => {
    // MD can approve any order any time, and their action always corresponds to the MD stage
    if (['md', 'ceo'].includes(effectiveRole)) {
      return 'md'
    }
    const pendingLabel = getPendingStageLabel(req)
    if (pendingLabel === 'Pending Sales Manager') return 'sales_manager'
    if (pendingLabel === 'Pending Accounts') return 'accounts'
    if (pendingLabel === 'Pending EA') return 'ea'
    if (pendingLabel === 'Pending MD') return 'md'
    return null
  }

  const isUserAuthorizedForStage = (stage: string) => {
    if (stage === 'sales_manager') return ['sales_manager', 'manager'].includes(effectiveRole)
    if (stage === 'accounts') return ['accounts', 'finance_head'].includes(effectiveRole)
    if (stage === 'ea') return ['ea'].includes(effectiveRole)
    if (stage === 'md') return ['md', 'ceo'].includes(effectiveRole)
    return false
  }

  // Correlate whether a request is pending action specifically for the current logged-in user
  const getIsPendingForUser = (row: ApprovalRequest) => {
    const pendingLabel = getPendingStageLabel(row)
    if (pendingLabel === 'Fully Approved' || pendingLabel.startsWith('Rejected')) {
      return false
    }

    // MD can approve any order any time no matter the stage
    if (['md', 'ceo'].includes(effectiveRole)) {
      return true
    }

    if (pendingLabel === 'Pending Sales Manager' && ['sales_manager', 'manager'].includes(effectiveRole)) {
      return true
    }
    if (pendingLabel === 'Pending Accounts' && ['accounts', 'finance_head'].includes(effectiveRole)) {
      return true
    }
    if (pendingLabel === 'Pending EA' && effectiveRole === 'ea') {
      return true
    }
    if (pendingLabel === 'Pending MD' && ['md', 'ceo'].includes(effectiveRole)) {
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
        row.amount.includes(search)

      if (!matchesSearch) return false

      // 3. Location filter
      const matchesLocation = selectedLocation === 'All' || row.location === selectedLocation
      if (!matchesLocation) return false

      // 4. Department filter
      const matchesDepartment = selectedDepartment === 'All' || 
        (row.department && row.department.trim().toUpperCase() === selectedDepartment.trim().toUpperCase())
      if (!matchesDepartment) return false

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
        (selectedStage === 'pending_sales_manager' && pendingLabel === 'Pending Sales Manager') ||
        (selectedStage === 'pending_accounts' && pendingLabel === 'Pending Accounts') ||
        (selectedStage === 'pending_ea' && pendingLabel === 'Pending EA') ||
        (selectedStage === 'pending_md' && pendingLabel === 'Pending MD') ||
        (selectedStage === 'completed' && pendingLabel === 'Fully Approved') ||
        (selectedStage === 'rejected' && pendingLabel.startsWith('Rejected'))
      if (!matchesStage) return false

      return true
    })
  }, [data?.rows, filterScope, search, selectedLocation, selectedDepartment, startDate, endDate, selectedStage, effectiveRole])

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
      { key: 'sales_manager', label: 'Sales Manager', status: req.vpApproval },
      { key: 'accounts', label: 'Accounts', status: req.accountApproval },
      { key: 'ea', label: 'EA', status: req.eaApproval },
      { key: 'md', label: 'MD Approval', status: req.managementApproval },
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
            if (pendingLabel === 'Pending Sales Manager' && stg.key === 'sales_manager') isActive = true
            else if (pendingLabel === 'Pending Accounts' && stg.key === 'accounts') isActive = true
            else if (pendingLabel === 'Pending EA' && stg.key === 'ea') isActive = true
            else if (pendingLabel === 'Pending MD' && stg.key === 'md') isActive = true

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
    <MainLayout title="Payment Approvals" subtitle="Manage payment requests and multi-stage approval workflows">
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

        {/* Department Allocation Analytics Widget */}
        {filteredRows.length > 0 && (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-[0_15px_40px_rgba(15,23,42,0.02)] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Department-wise Spend Allocation</span>
              <span className="text-xs font-bold text-slate-500">Filtered Spend Breakdown</span>
            </div>
            
            {/* Color Segmented Allocation Progress Bar */}
            <div className="h-3 w-full rounded-full bg-slate-100 flex overflow-hidden">
              {departmentAllocation.slice(0, 5).map((item, idx) => {
                const colors = [
                  'bg-indigo-600',
                  'bg-emerald-500',
                  'bg-amber-500',
                  'bg-rose-500',
                  'bg-cyan-500'
                ]
                return (
                  <div
                    key={item.dept}
                    style={{ width: `${item.pct}%` }}
                    className={`h-full ${colors[idx % colors.length]}`}
                    title={`${item.dept}: ${item.pct.toFixed(1)}%`}
                  />
                )
              })}
            </div>

            {/* Allocation Details Chips */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              {departmentAllocation.slice(0, 5).map((item, idx) => {
                const textColors = [
                  'text-indigo-600',
                  'text-emerald-600',
                  'text-amber-600',
                  'text-rose-600',
                  'text-cyan-600'
                ]
                const dotColors = [
                  'bg-indigo-600',
                  'bg-emerald-500',
                  'bg-amber-500',
                  'bg-rose-500',
                  'bg-cyan-500'
                ]
                return (
                  <div key={item.dept} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${dotColors[idx % dotColors.length]}`} />
                    <span className="text-slate-500 font-semibold">{item.dept}</span>
                    <span className={`font-black ${textColors[idx % textColors.length]}`}>
                      ₹{item.amt.toLocaleString('en-IN')} ({item.pct.toFixed(1)}%)
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

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
              <option value="pending_sales_manager">Pending Sales Manager</option>
              <option value="pending_accounts">Pending Accounts</option>
              <option value="pending_ea">Pending EA</option>
              <option value="pending_md">Pending MD</option>
              <option value="completed">Completed (Approved)</option>
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

            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading || isFetching} className="h-10 w-10 rounded-2xl border-slate-200 flex-shrink-0">
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin text-slate-500" /> : <RefreshCw className="w-4 h-4 text-slate-500" />}
            </Button>
          </div>
        </div>

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
        ) : totalRows === 0 ? (
          <div className="bg-white border border-slate-100 rounded-[2rem] p-12 text-center space-y-3 shadow-[0_10px_30px_rgba(15,23,42,0.01)]">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">No Requests Found</h3>
            <p className="text-xs text-slate-400 font-semibold max-w-sm mx-auto">There are no payment approval requests matching your active filter criteria.</p>
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
                      if (pendingLabel === 'Fully Approved') {
                        stageDisplay = (
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              Fully Approved
                            </span>
                            <span className="text-emerald-600 text-[11px] font-bold pl-3">Approved</span>
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
                      if (pendingLabel === 'Fully Approved') {
                        statusBadge = (
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full text-[10px] font-black tracking-wider uppercase">
                            APPROVED
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
                            <div className="flex flex-col">
                              <span className="text-slate-950 font-bold block">{row.name}</span>
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
                            <div className="flex flex-col">
                              <span className="text-slate-900 font-bold block">
                                {new Date(row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                              <span className="text-slate-400 text-xs font-semibold">
                                {new Date(row.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </span>
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
                        <div>
                          <span className="text-slate-950 font-black block text-sm">{row.name}</span>
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
                    </div>

                    {/* Grid Details: Vendor, Amount, Current Stage */}
                    <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/60 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Vendor</span>
                        <span className="font-bold text-slate-900 mt-0.5 block truncate">{row.vendorName || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Amount</span>
                        <span className="font-black text-slate-900 mt-0.5 block text-sm">₹{Number(row.amount || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="col-span-2 border-t border-slate-200/60 pt-2 mt-1">
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
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-2xl bg-white p-0 overflow-hidden shadow-2xl border border-slate-100 max-h-[85vh] flex flex-col">
          {detailRow && (() => {
            const pendingLabel = getPendingStageLabel(detailRow)
            const isApproved = pendingLabel === 'Fully Approved'
            const isRejected = pendingLabel.startsWith('Rejected')
            const isMD = ['md', 'ceo'].includes(effectiveRole)

            return (
              <>
                <DialogHeader className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="rounded-full bg-slate-950 text-white font-black text-[9px] uppercase tracking-wider py-0.5 px-2.5">{detailRow.location}</Badge>
                    <Badge variant="outline" className="rounded-full bg-slate-100 border-slate-200 text-slate-700 font-extrabold text-[9px] uppercase tracking-wider py-0.5 px-2">{detailRow.department}</Badge>
                    <Badge variant="outline" className="rounded-full bg-indigo-50 border-indigo-100 text-indigo-700 font-black text-[9px] uppercase tracking-wider py-0.5 px-2">{detailRow.approvalType}</Badge>
                  </div>
                  <DialogTitle className="text-xl font-black tracking-tight text-slate-950 flex justify-between items-center pr-6">
                    <span>Payment Approval Request Details</span>
                    <span className="text-indigo-600 text-lg font-black font-mono">₹{Number(detailRow.amount || 0).toLocaleString('en-IN')}</span>
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-400 font-semibold">
                    Payment request identification and approval timeline tracking.
                  </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Workflow Progress Stepper */}
                  {renderWorkflowStepper(detailRow)}

                  {/* Request Details Block */}
                  <div className="bg-slate-50/50 border border-slate-100 rounded-3xl p-6 space-y-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Request Specifications</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5 text-xs font-semibold">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Name</span>
                        <span className="text-slate-900 font-black">{detailRow.name}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Email</span>
                        <span className="text-slate-900 font-black">{detailRow.email}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Dealer Name</span>
                        <span className="text-slate-900 font-black">{detailRow.dealerName || '—'}</span>
                      </div>
                      {detailRow.dealerCode && (
                        <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Dealer Code</span>
                          <span className="text-slate-900 font-black">{detailRow.dealerCode}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Vendor Name</span>
                        <span className="text-slate-900 font-black">{detailRow.vendorName || '—'}</span>
                      </div>
                      {detailRow.previousAdvance && (
                        <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Prev. Advance</span>
                          <span className="text-slate-900 font-black">{detailRow.previousAdvance}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Payment Type</span>
                        <span className="text-slate-900 font-black">{detailRow.typeOfPayment || '—'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Workflow Status</span>
                        <span className="text-indigo-600 font-black">{pendingLabel}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2 col-span-1 sm:col-span-2">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px]">Submitted On</span>
                        <span className="text-slate-900 font-black">
                          {new Date(detailRow.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} at{' '}
                          {new Date(detailRow.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Remarks note */}
                  {detailRow.remarks && (
                    <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-200">
                      <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 block mb-1">Submitter's Note / टिप्पणी</span>
                      <p className="text-sm font-semibold text-amber-900 leading-relaxed">{detailRow.remarks}</p>
                    </div>
                  )}

                  {/* Stage stepper indicators */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Approval Stage Checklist</span>
                    <div className="grid grid-cols-4 gap-2">
                      {renderStepChip('SM Approval', detailRow.vpApproval)}
                      {renderStepChip('Accounts', detailRow.accountApproval)}
                      {renderStepChip('EA Approval', detailRow.eaApproval)}
                      {renderStepChip('MD Approval', detailRow.managementApproval)}
                    </div>
                  </div>

                  {/* Attachments */}
                  {(detailRow.uploadBillUrl1 || detailRow.uploadBillUrl2 || detailRow.uploadDocUrl) && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Attached Documents</span>
                      <div className="flex flex-wrap gap-2">
                        {detailRow.uploadBillUrl1 && (
                          <a href={detailRow.uploadBillUrl1} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                            <FileText className="w-4 h-4 text-slate-500" /> Bill 1 <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          </a>
                        )}
                        {detailRow.uploadBillUrl2 && (
                          <a href={detailRow.uploadBillUrl2} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                            <FileText className="w-4 h-4 text-slate-500" /> Bill 2 <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          </a>
                        )}
                        {detailRow.uploadDocUrl && (
                          <a href={detailRow.uploadDocUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-white border-2 border-slate-200 hover:border-slate-400 text-xs font-bold text-slate-700 transition-all shadow-sm">
                            <FileText className="w-4 h-4 text-slate-500" /> Support Doc <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action Center Trigger */}
                  {!isApproved && !isRejected && (() => {
                    const authStages = [
                      { key: 'sales_manager', label: 'Sales Manager Stage', currentStatus: detailRow.vpApproval },
                      { key: 'accounts', label: 'Accounts Stage', currentStatus: detailRow.accountApproval },
                      { key: 'ea', label: 'EA Stage', currentStatus: detailRow.eaApproval },
                      { key: 'md', label: 'MD Approval Stage', currentStatus: detailRow.managementApproval }
                    ].filter(stg => isUserAuthorizedForStage(stg.key))

                    if (authStages.length === 0) return null

                    return (
                      <div className="rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-5 space-y-3">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-indigo-600" />
                          <span className="text-sm font-black text-indigo-900 tracking-tight">Act on this request</span>
                          {isMD && (
                            <span className="ml-auto text-[10px] font-bold text-violet-700 bg-violet-100 border border-violet-200 px-2.5 py-0.5 rounded-full">MD Override Active</span>
                          )}
                        </div>
                        <div className="grid gap-2 grid-cols-1">
                          {authStages.map(stg => {
                            const isEligible = isUserAuthorizedForStage(stg.key)
                            const isStepPending = !stg.currentStatus || stg.currentStatus === ''
                            let canClick = isEligible && isStepPending
                            if (isMD) canClick = isStepPending // MD can approve anytime if not already approved/rejected
                            if (stg.key === 'accounts' && detailRow.vpApproval !== 'APPROVED' && !isMD) canClick = false
                            if (stg.key === 'ea' && (detailRow.vpApproval !== 'APPROVED' || detailRow.accountApproval !== 'APPROVED') && !isMD) canClick = false
                            if (stg.key === 'md' && (detailRow.vpApproval !== 'APPROVED' || detailRow.accountApproval !== 'APPROVED' || detailRow.eaApproval !== 'APPROVED') && !isMD) canClick = false

                            if (isMD) {
                              return (
                                <div key={stg.key} className="space-y-3 p-1">
                                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 block">{stg.label}</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      disabled={!canClick || actionMutation.isPending}
                                      onClick={() => {
                                        actionMutation.mutate({
                                          id: detailRow.id,
                                          action: 'APPROVE',
                                          stage: 'md',
                                          remarks: ''
                                        })
                                      }}
                                      className="flex-1 py-3 px-4 rounded-2xl font-black text-xs text-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-emerald-500/10 cursor-pointer border border-emerald-600 hover:opacity-90"
                                      style={{ backgroundColor: '#10b981', color: '#ffffff' }}
                                    >
                                      {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' && actionMutation.variables?.id === detailRow.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                                      ) : (
                                        'Approve Order'
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!canClick || actionMutation.isPending}
                                      onClick={() => {
                                        setActionStage('md')
                                        setActionDecision('HOLD')
                                        setActionRemarks('')
                                      }}
                                      className="py-3 px-4 rounded-2xl font-black text-xs text-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-amber-500/10 cursor-pointer border border-amber-600 hover:opacity-90"
                                      style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}
                                    >
                                      Hold
                                    </button>

                                    <button
                                      type="button"
                                      disabled={!canClick || actionMutation.isPending}
                                      onClick={() => {
                                        setActionStage('md')
                                        setActionDecision('REJECT')
                                        setActionRemarks('')
                                      }}
                                      className="py-3 px-4 rounded-2xl font-black text-xs text-center transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-rose-500/10 cursor-pointer border border-rose-600 hover:opacity-90"
                                      style={{ backgroundColor: '#ef4444', color: '#ffffff' }}
                                    >
                                      Deny
                                    </button>
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <button
                                key={stg.key}
                                type="button"
                                disabled={!canClick}
                                onClick={() => {
                                  setActionStage(stg.key as any)
                                  setActionDecision(null)
                                  setActionRemarks('')
                                }}
                                className={`p-3.5 rounded-2xl border-2 text-left flex flex-col justify-between transition-all min-h-[75px] ${
                                  canClick
                                    ? 'border-indigo-300 bg-white hover:border-indigo-500 cursor-pointer hover:shadow-md'
                                    : 'border-slate-200 bg-white/60 opacity-50 cursor-not-allowed'
                                }`}
                              >
                                <span className="text-[11px] font-black uppercase tracking-wider text-slate-700">{stg.label}</span>
                                <div className="mt-1">
                                  {stg.currentStatus === 'APPROVED' ? (
                                    <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 text-[9px] font-black uppercase">Approved</Badge>
                                  ) : stg.currentStatus === 'NOT APPROVED' ? (
                                    <Badge className="bg-rose-100 text-rose-800 border border-rose-200 text-[9px] font-black uppercase">Rejected</Badge>
                                  ) : stg.currentStatus === 'HELD' ? (
                                    <Badge className="bg-amber-100 text-amber-800 border border-amber-200 text-[9px] font-black uppercase">Held</Badge>
                                  ) : canClick ? (
                                    <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-200 text-[9px] font-black uppercase animate-pulse">Tap to action ›</Badge>
                                  ) : (
                                    <Badge className="bg-slate-100 text-slate-400 border border-slate-200 text-[9px] font-semibold uppercase">Locked</Badge>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Activity log / timeline history */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Activity Log & History Remarks</span>
                    <div className="space-y-2">
                      <div className="p-3.5 rounded-2xl border border-slate-100 bg-slate-50 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-slate-950 text-white">Initiated</span>
                          <span className="text-[9px] font-bold text-slate-400">{new Date(detailRow.createdAt).toLocaleString('en-IN')}</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-700">{detailRow.remarks || 'No remarks provided during submission.'}</p>
                      </div>

                      {detailRow.history.map(entry => (
                        <div key={entry.id} className={`p-3.5 rounded-2xl border space-y-1 ${getRoleRemarksStyles(entry.roleKey)}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${getRoleBadgeColor(entry.roleKey)}`}>{entry.role}</span>
                              <span className="text-xs font-black text-slate-900">{entry.user}</span>
                              <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                                entry.action === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                                entry.action === 'HELD' ? 'bg-amber-100 text-amber-800' :
                                'bg-rose-100 text-rose-800'
                              }`}>
                                {entry.action === 'APPROVED' ? '✓ Approved' : entry.action === 'HELD' ? '‖ Held' : '✗ Rejected'}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold opacity-60">{new Date(entry.timestamp).toLocaleString('en-IN')}</span>
                          </div>
                          <p className="text-xs font-semibold leading-relaxed">{entry.remarks || 'No remarks left.'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-2">
                  <Button
                    onClick={() => handlePrintVoucher(detailRow, pendingLabel)}
                    className="h-10 rounded-2xl text-xs font-black border-slate-200 hover:bg-slate-50"
                    variant="outline"
                  >
                    Export Voucher
                  </Button>
                  <Button variant="outline" onClick={() => setDetailRow(null)} className="h-10 rounded-2xl text-xs font-black border-slate-200">
                    Close Details
                  </Button>
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
                  <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
                    {(vendorStartDate || vendorEndDate) && (
                      <Button
                        onClick={() => {
                          setVendorStartDate('')
                          setVendorEndDate('')
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

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="border border-slate-100 rounded-3xl overflow-hidden">
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
                          {vendorFilteredRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="py-12 text-center text-slate-400 font-bold uppercase tracking-wider">
                                No purchases matching filter criteria.
                              </td>
                            </tr>
                          ) : (
                            vendorFilteredRows.map((row, idx) => (
                              <tr key={row.id} className="hover:bg-slate-50/20 transition-colors">
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
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
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
      <Dialog open={Boolean(actionStage && detailRow)} onOpenChange={(open) => { if (!open) { setActionStage(null); setActionDecision(null); setActionRemarks(''); } }}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100">
          <DialogHeader>
            <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
              Submit Action Confirmation
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-semibold mt-1">
              {actionDecision === 'HOLD' ? 'Provide a reason for putting this request on HOLD.' : actionDecision === 'REJECT' ? 'Provide a reason for DENYING this request.' : 'Select your decision for the request.'}
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
                placeholder={actionDecision === 'HOLD' ? 'Reason for Hold...' : actionDecision === 'REJECT' ? 'Reason for Denial...' : 'Notes...'}
                className="min-h-[100px] rounded-2xl border-slate-200 focus:ring-slate-950 font-semibold text-slate-800 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end mt-2">
            <Button
              variant="outline"
              onClick={() => { setActionStage(null); setActionDecision(null); setActionRemarks(''); }}
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
                      remarks: actionRemarks
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
                      remarks: actionRemarks
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

            {(!actionDecision || actionDecision === 'APPROVE') && (
              <Button
                onClick={() => {
                  if (detailRow && actionStage) {
                    actionMutation.mutate({
                      id: detailRow.id,
                      action: 'APPROVE',
                      stage: actionStage,
                      remarks: actionRemarks
                    })
                  }
                }}
                disabled={actionMutation.isPending}
                className="h-10 rounded-2xl text-xs font-black shadow-md shadow-emerald-600/10 hover:opacity-90"
                style={{ backgroundColor: '#059669', color: '#ffffff' }}
              >
                {actionMutation.isPending && actionMutation.variables?.action === 'APPROVE' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Approve
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
