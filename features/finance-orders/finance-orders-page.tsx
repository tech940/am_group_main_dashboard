'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Download, FileText, Landmark, LayoutGrid, List, Loader2, PauseCircle, Plus, Search, ShieldCheck } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { FINANCE_BANK_OPTIONS, USER_BRANCH_OPTIONS, getUserBranchLabel } from '@/lib/dashboard-config'

type CurrentUser = {
  id: string
  role: string
  fullName: string
  email: string
}

type FinanceOrder = {
  id: string
  orderNumber: string
  currentStage: string
  status: string
  totalPayoutReceived: string | number
  invoiceNumber: string
  paymentReceivedDate: string
  dsePayout: string | number
  hypBankName: string
  dseName: string
  dealer: string
  holdRemarks?: string | null
  accountsVerificationStatus?: string | null
  accountsVerificationRemarks?: string | null
  eaApprovalStatus?: string | null
  eaApprovalRemarks?: string | null
  mdApprovalStatus?: string | null
  mdApprovalRemarks?: string | null
  createdBy: string
  completedAt?: string | null
  createdAt: string
  updatedAt: string
}

type WorkflowHistoryItem = {
  id: string
  action: string
  stage: string
  userRole: string
  remarks?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  createdAt: string
  actorName?: string | null
  actorEmail?: string | null
}

type FinanceFormState = {
  totalPayoutReceived: string
  invoiceNumber: string
  paymentReceivedDate: string
  dsePayout: string
  hypBankName: string
  dseName: string
  dealer: string
}

const EMPTY_FORM: FinanceFormState = {
  totalPayoutReceived: '',
  invoiceNumber: '',
  paymentReceivedDate: '',
  dsePayout: '',
  hypBankName: '',
  dseName: '',
  dealer: '',
}

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'awaiting_accounts_verification', label: 'Accounts Queue' },
  { value: 'awaiting_ea_approval', label: 'EA Queue' },
  { value: 'awaiting_md_approval', label: 'MD Queue' },
  { value: 'draft', label: 'Drafts' },
  { value: 'accounts_on_hold', label: 'Accounts Hold' },
  { value: 'ea_on_hold', label: 'EA Hold' },
  { value: 'md_on_hold', label: 'MD Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'accounts_denied', label: 'Accounts Denied' },
  { value: 'ea_denied', label: 'Denied' },
  { value: 'md_denied', label: 'MD Denied' },
]

const STATUS_GROUP_FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'hold', label: 'On Hold' },
]

function getCurrentIndiaDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const partMap = new Map(parts.map((part) => [part.type, part.value]))
  return `${partMap.get('year') || ''}-${partMap.get('month') || ''}-${partMap.get('day') || ''}`
}

const CURRENT_DATE = getCurrentIndiaDate()
const CURRENT_MONTH_START = `${CURRENT_DATE.slice(0, 8)}01`

function normalizeDealerValue(value: string | null | undefined) {
  const dealer = String(value || '').trim()
  const match = USER_BRANCH_OPTIONS.find((branch) => branch.value === dealer || branch.label === dealer)
  return match?.value || dealer
}

function formatDealer(value: string | null | undefined) {
  const normalized = normalizeDealerValue(value)
  return USER_BRANCH_OPTIONS.some((branch) => branch.value === normalized)
    ? getUserBranchLabel(normalized)
    : String(value || '-')
}

function formatCurrency(value: string | number) {
  const amount = Number(value || 0)
  return `Rs ${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN')}`
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusLabel(status: string) {
  return status
    .replace(/^awaiting_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusClass(status: string) {
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status.includes('denied')) return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status.includes('hold')) return 'border-amber-200 bg-amber-50 text-amber-700'
  if (status.includes('accounts')) return 'border-cyan-200 bg-cyan-50 text-cyan-800'
  if (status.includes('md')) return 'border-violet-200 bg-violet-50 text-violet-700'
  if (status.includes('ea')) return 'border-blue-200 bg-blue-50 text-blue-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function validateForm(form: FinanceFormState) {
  const errors: Partial<Record<keyof FinanceFormState, string>> = {}
  if (!form.invoiceNumber.trim()) errors.invoiceNumber = 'Invoice number is required'
  if (!form.paymentReceivedDate) errors.paymentReceivedDate = 'Payment date is required'
  if (!form.hypBankName.trim()) errors.hypBankName = 'Bank name is required'
  if (!form.dseName.trim()) errors.dseName = 'DSE name is required'
  if (!form.dealer.trim()) errors.dealer = 'Dealer is required'
  if (!(Number(form.totalPayoutReceived) > 0)) errors.totalPayoutReceived = 'Enter a valid payout amount'
  if (!(Number(form.dsePayout) >= 0)) errors.dsePayout = 'Enter a valid DSE payout'
  return errors
}

function FloatingField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="group block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
      {error && <span className="mt-2 block text-xs font-bold text-rose-600">{error}</span>}
    </label>
  )
}

function FinanceOrderSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-white/70" />)}
      </div>
      <div className="h-96 animate-pulse rounded-2xl bg-white/70" />
    </div>
  )
}

export function FinanceOrdersPageContent({ currentUser }: { currentUser: CurrentUser }) {
  const hasStageQueue = currentUser.role === 'accounts' || currentUser.role === 'ea' || currentUser.role === 'md'
  const [orders, setOrders] = useState<FinanceOrder[]>([])
  const [history, setHistory] = useState<WorkflowHistoryItem[]>([])
  const [selectedOrder, setSelectedOrder] = useState<FinanceOrder | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingOrder, setEditingOrder] = useState<FinanceOrder | null>(null)
  const [form, setForm] = useState<FinanceFormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FinanceFormState, string>>>({})
  const [remarks, setRemarks] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [statusGroup, setStatusGroup] = useState('pending')
  const [branchFilter, setBranchFilter] = useState('all')
  const [spendingStartDate, setSpendingStartDate] = useState(CURRENT_MONTH_START)
  const [spendingEndDate, setSpendingEndDate] = useState(CURRENT_DATE)
  const [spendingBranch, setSpendingBranch] = useState('all')
  const [viewMode, setViewMode] = useState<'queue' | 'all'>(hasStageQueue ? 'queue' : 'all')
  const [registerView, setRegisterView] = useState<'table' | 'card'>('table')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [summary, setSummary] = useState({
    payout: 0,
    pendingAccounts: 0,
    pendingEa: 0,
    pendingMd: 0,
    held: 0,
    completed: 0,
  })
  const [spending, setSpending] = useState({
    orders: 0,
    payout: 0,
    dsePayout: 0,
    completedOrders: 0,
    completedPayout: 0,
    pendingPayout: 0,
  })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [bulkActionLoading, setBulkActionLoading] = useState<'approve' | 'hold' | 'deny' | null>(null)
  const [exportingCompletedPdf, setExportingCompletedPdf] = useState(false)

  const isGlobalAdmin = currentUser.role === 'admin' || currentUser.role === 'super_admin'
  const canCreate = isGlobalAdmin || currentUser.role === 'finance_head'
  const canActAccounts = isGlobalAdmin || currentUser.role === 'accounts'
  const canActEa = isGlobalAdmin || currentUser.role === 'ea'
  const canActMd = isGlobalAdmin || currentUser.role === 'md'
  const canUseApprovalTableActions = isGlobalAdmin || currentUser.role === 'ea' || currentUser.role === 'md'
  const isCompletedView = viewMode === 'all' && (statusGroup === 'completed' || status === 'completed')

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: '24', search })
      params.set('scope', viewMode)
      params.set('branch', branchFilter)
      if (viewMode === 'all') {
        params.set('statusGroup', statusGroup)
        params.set('status', status)
      }
      const response = await fetch(`/api/finance-orders?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to load finance orders')
      const payload = await response.json()
      const nextOrders = payload.orders || []
      setOrders(nextOrders)
      setSelectedOrderIds((current) => {
        const visibleIds = new Set(nextOrders.map((order: FinanceOrder) => order.id))
        const next = new Set(Array.from(current).filter((orderId) => visibleIds.has(orderId)))
        return next.size === current.size ? current : next
      })
    } catch (error) {
      console.error(error)
      setOrders([])
    } finally {
      setLoading(false)
    }
  }, [branchFilter, search, status, statusGroup, viewMode])

  const fetchMetrics = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        metrics: 'true',
        branch: branchFilter,
        spendingBranch,
        spendingStartDate,
        spendingEndDate,
      })
      const response = await fetch(`/api/finance-orders?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to load finance metrics')
      const payload = await response.json()
      setSummary({
        payout: Number(payload.summary?.payout || 0),
        pendingAccounts: Number(payload.summary?.pendingAccounts || 0),
        pendingEa: Number(payload.summary?.pendingEa || 0),
        pendingMd: Number(payload.summary?.pendingMd || 0),
        held: Number(payload.summary?.held || 0),
        completed: Number(payload.summary?.completed || 0),
      })
      setSpending({
        orders: Number(payload.spending?.orders || 0),
        payout: Number(payload.spending?.payout || 0),
        dsePayout: Number(payload.spending?.dsePayout || 0),
        completedOrders: Number(payload.spending?.completedOrders || 0),
        completedPayout: Number(payload.spending?.completedPayout || 0),
        pendingPayout: Number(payload.spending?.pendingPayout || 0),
      })
    } catch (error) {
      console.error(error)
    }
  }, [branchFilter, spendingBranch, spendingEndDate, spendingStartDate])

  const fetchHistory = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`/api/finance-orders/workflow?orderId=${orderId}`)
      if (!response.ok) throw new Error('Failed to load workflow history')
      const payload = await response.json()
      setHistory(payload.history || [])
    } catch (error) {
      console.error(error)
      setHistory([])
    }
  }, [])

  const downloadCompletedPdf = async () => {
    setExportingCompletedPdf(true)
    try {
      const params = new URLSearchParams({
        export: 'completed',
        scope: 'all',
        status: 'completed',
        branch: branchFilter,
        search,
      })
      const response = await fetch(`/api/finance-orders?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to export completed finance orders')
      const payload = await response.json()
      const completedOrders = (payload.orders || []) as FinanceOrder[]
      const printWindow = window.open('', '_blank')
      if (!printWindow) return

      const totals = completedOrders.reduce((acc, order) => {
        acc.totalPayout += Number(order.totalPayoutReceived || 0)
        acc.dsePayout += Number(order.dsePayout || 0)
        return acc
      }, { totalPayout: 0, dsePayout: 0 })

      const rowsHtml = completedOrders.map((order, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(order.orderNumber)}</td>
          <td>${escapeHtml(order.invoiceNumber)}</td>
          <td>${escapeHtml(formatDealer(order.dealer))}</td>
          <td>${escapeHtml(order.hypBankName)}</td>
          <td>${escapeHtml(order.dseName)}</td>
          <td>${escapeHtml(formatDate(order.paymentReceivedDate))}</td>
          <td>${escapeHtml(formatCurrency(order.totalPayoutReceived))}</td>
          <td>${escapeHtml(formatCurrency(order.dsePayout))}</td>
          <td>${escapeHtml(formatDate(order.completedAt || order.updatedAt))}</td>
        </tr>
      `).join('')

      printWindow.document.write(`
        <html>
          <head>
            <title>Completed Finance Orders</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 16px; color: #0f172a; }
              h1 { font-size: 20px; margin: 0 0 4px; }
              p { margin: 0 0 12px; color: #475569; font-size: 11px; }
              .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
              .summary div { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px; }
              .summary span { display: block; color: #64748b; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; }
              .summary strong { display: block; margin-top: 4px; font-size: 13px; }
              table { width: 100%; border-collapse: collapse; font-size: 8px; }
              th { background: #0f172a; color: white; padding: 6px; text-align: left; }
              td { border-bottom: 1px solid #e2e8f0; padding: 5px; vertical-align: top; }
              tr:nth-child(even) { background: #f8fafc; }
              @page { size: landscape; margin: 10mm; }
            </style>
          </head>
          <body>
            <h1>Completed Finance Orders</h1>
            <p>Generated ${escapeHtml(formatDateTime(new Date().toISOString()))} · ${completedOrders.length.toLocaleString('en-IN')} completed records</p>
            <div class="summary">
              <div><span>Total Orders</span><strong>${completedOrders.length.toLocaleString('en-IN')}</strong></div>
              <div><span>Total Payout</span><strong>${escapeHtml(formatCurrency(totals.totalPayout))}</strong></div>
              <div><span>DSE Payout</span><strong>${escapeHtml(formatCurrency(totals.dsePayout))}</strong></div>
            </div>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Order</th>
                  <th>Invoice</th>
                  <th>Dealer</th>
                  <th>Bank</th>
                  <th>DSE</th>
                  <th>Payment Date</th>
                  <th>Total Payout</th>
                  <th>DSE Payout</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>${rowsHtml || '<tr><td colspan="10">No completed finance orders found.</td></tr>'}</tbody>
            </table>
          </body>
        </html>
      `)
      printWindow.document.close()
      printWindow.focus()
      printWindow.print()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to export completed finance orders')
    } finally {
      setExportingCompletedPdf(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOrders()
    }, 200)
    return () => window.clearTimeout(timer)
  }, [fetchOrders])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchMetrics()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchMetrics])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const orderId = params.get('orderId')
    if (!orderId) return

    fetch(`/api/finance-orders?id=${orderId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((order: FinanceOrder | null) => {
        if (order) {
          setSelectedOrder(order)
          setShowDetails(true)
          void fetchHistory(order.id)
        }
      })
      .catch(() => {})
  }, [fetchHistory])

  const tableActionableOrders = useMemo(() => {
    if (!canUseApprovalTableActions) return []

    return orders.filter((order) => {
      if (isGlobalAdmin) {
        return ['awaiting_ea_approval', 'ea_on_hold', 'awaiting_md_approval', 'md_on_hold'].includes(order.status)
      }

      if (currentUser.role === 'ea') {
        return ['awaiting_ea_approval', 'ea_on_hold'].includes(order.status)
      }

      if (currentUser.role === 'md') {
        return ['awaiting_md_approval', 'md_on_hold'].includes(order.status)
      }

      return false
    })
  }, [canUseApprovalTableActions, currentUser.role, isGlobalAdmin, orders])

  const tableActionableIds = useMemo(() => new Set(tableActionableOrders.map((order) => order.id)), [tableActionableOrders])
  const selectedActionableIds = useMemo(
    () => Array.from(selectedOrderIds).filter((orderId) => tableActionableIds.has(orderId)),
    [selectedOrderIds, tableActionableIds]
  )
  const allActionableSelected = tableActionableOrders.length > 0 && tableActionableOrders.every((order) => selectedOrderIds.has(order.id))
  const someActionableSelected = tableActionableOrders.some((order) => selectedOrderIds.has(order.id)) && !allActionableSelected

  const openCreateForm = () => {
    setEditingOrder(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setShowForm(true)
  }

  const openOrderDetails = (order: FinanceOrder) => {
    setSelectedOrder(order)
    setRemarks('')
    setShowDetails(true)
    void fetchHistory(order.id)
  }

  const openEditForm = (order: FinanceOrder) => {
    setEditingOrder(order)
    setShowDetails(false)
    setForm({
      totalPayoutReceived: String(order.totalPayoutReceived || ''),
      invoiceNumber: order.invoiceNumber || '',
      paymentReceivedDate: order.paymentReceivedDate ? order.paymentReceivedDate.slice(0, 10) : '',
      dsePayout: String(order.dsePayout || ''),
      hypBankName: order.hypBankName || '',
      dseName: order.dseName || '',
      dealer: normalizeDealerValue(order.dealer),
    })
    setErrors({})
    setShowForm(true)
  }

  const submitForm = async (mode: 'draft' | 'submit') => {
    const validationErrors = validateForm(form)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/finance-orders', {
        method: editingOrder ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: editingOrder?.id, mode }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to save finance order')
      setShowForm(false)
      setEditingOrder(null)
      setForm(EMPTY_FORM)
      await Promise.all([fetchOrders(), fetchMetrics()])
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save finance order')
    } finally {
      setSubmitting(false)
    }
  }

  const runWorkflowAction = async (orderId: string, action: 'approve' | 'hold' | 'deny', actionRemarks = '') => {
    const response = await fetch('/api/finance-orders/workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, action, remarks: actionRemarks }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || 'Workflow action failed')
    return payload
  }

  const performAction = async (action: 'approve' | 'hold' | 'deny') => {
    if (!selectedOrder) return
    if ((action === 'hold' || action === 'deny') && !remarks.trim()) {
      alert('Remarks are required for hold and deny actions.')
      return
    }

    setActionLoading(action)
    try {
      await runWorkflowAction(selectedOrder.id, action, remarks)
      const refreshed = await fetch(`/api/finance-orders?id=${selectedOrder.id}`).then((res) => res.json())
      setSelectedOrder(refreshed)
      setRemarks('')
      await Promise.all([fetchHistory(selectedOrder.id), fetchOrders(), fetchMetrics()])
      setShowDetails(false)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Workflow action failed')
    } finally {
      setActionLoading(null)
    }
  }

  const promptForActionRemarks = (action: 'approve' | 'hold' | 'deny', count: number) => {
    if (action === 'approve') {
      return window.confirm(`Approve ${count} finance order${count === 1 ? '' : 's'}?`) ? '' : null
    }

    const label = action === 'hold' ? 'hold' : 'deny'
    const input = window.prompt(`Enter remarks to ${label} ${count} finance order${count === 1 ? '' : 's'}:`)
    if (input === null) return null
    const trimmed = input.trim()
    if (!trimmed) {
      alert('Remarks are required for hold and deny actions.')
      return null
    }
    return trimmed
  }

  const performTableAction = async (orderId: string, action: 'approve' | 'hold' | 'deny') => {
    const actionRemarks = promptForActionRemarks(action, 1)
    if (actionRemarks === null) return

    setBulkActionLoading(action)
    try {
      await runWorkflowAction(orderId, action, actionRemarks)
      setSelectedOrderIds((current) => {
        const next = new Set(current)
        next.delete(orderId)
        return next
      })
      await Promise.all([fetchOrders(), fetchMetrics()])
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Workflow action failed')
    } finally {
      setBulkActionLoading(null)
    }
  }

  const performBulkAction = async (action: 'approve' | 'hold' | 'deny') => {
    const orderIds = selectedActionableIds
    if (orderIds.length === 0) {
      alert('Select at least one finance order first.')
      return
    }

    const actionRemarks = promptForActionRemarks(action, orderIds.length)
    if (actionRemarks === null) return

    setBulkActionLoading(action)
    try {
      for (const orderId of orderIds) {
        await runWorkflowAction(orderId, action, actionRemarks)
      }
      setSelectedOrderIds(new Set())
      await Promise.all([fetchOrders(), fetchMetrics()])
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Workflow action failed')
    } finally {
      setBulkActionLoading(null)
    }
  }

  const canEditSelected = selectedOrder
    && canCreate
    && (isGlobalAdmin || selectedOrder.createdBy === currentUser.id)
    && ['draft', 'accounts_on_hold', 'ea_on_hold', 'md_on_hold'].includes(selectedOrder.status)
  const selectedIsAccountsQueue = selectedOrder && ['awaiting_accounts_verification', 'accounts_on_hold'].includes(selectedOrder.status)
  const selectedIsEaQueue = selectedOrder && ['awaiting_ea_approval', 'ea_on_hold'].includes(selectedOrder.status)
  const selectedIsMdQueue = selectedOrder && ['awaiting_md_approval', 'md_on_hold'].includes(selectedOrder.status)
  const canApproveSelected = Boolean((selectedIsAccountsQueue && canActAccounts) || (selectedIsEaQueue && canActEa) || (selectedIsMdQueue && canActMd))
  const approveActionLabel = selectedIsAccountsQueue ? 'Payment Received' : 'Approve'
  const actionPanelLabel = selectedIsAccountsQueue ? 'Payment Verification' : 'Approval Action'
  const viewTitle = viewMode === 'queue' ? 'My pending stage' : 'All orders'

  return (
    <MainLayout title="Finance Orders" subtitle="Finance approval workflow">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/86 shadow-sm backdrop-blur-xl">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.15fr_0.85fr] lg:p-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--dashboard-primary)]">
                <Landmark className="h-3.5 w-3.5" />
                Finance Control
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950">Finance Orders</h1>
              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                Track payout receipts, let Accounts verify payment received, and keep EA and MD decisions auditable without the clutter of the purchase workflow.
              </p>
            </div>
            <div className="flex items-center justify-start gap-3 lg:justify-end">
              {canCreate && (
                <Button onClick={openCreateForm} className="app-primary-action h-12 rounded-2xl px-5 font-black">
                  <Plus className="mr-2 h-4 w-4" />
                  New Finance Order
                </Button>
              )}
            </div>
          </div>
        </section>

        {loading ? (
          <FinanceOrderSkeleton />
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              {[
                { label: 'Accounts Queue', value: String(summary.pendingAccounts), icon: Clock3 },
                { label: 'EA Queue', value: String(summary.pendingEa), icon: Clock3 },
                { label: 'MD Queue', value: String(summary.pendingMd), icon: ShieldCheck },
                { label: 'On Hold', value: String(summary.held), icon: PauseCircle },
                { label: 'Completed', value: String(summary.completed), icon: CheckCircle2 },
              ].map((card) => (
                <div key={card.label} className="min-h-[88px] rounded-2xl border border-white/70 bg-white/82 p-3.5 shadow-sm backdrop-blur-xl">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400">{card.label}</p>
                      <p className="mt-2 font-mono text-lg font-black leading-tight text-slate-950">{card.value}</p>
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-primary)]">
                      <card.icon className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-sm backdrop-blur-xl">
              <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-primary)]">Spending View</p>
                  <h2 className="mt-1 text-xl font-black text-slate-950">Payout spending</h2>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    type="date"
                    value={spendingStartDate}
                    max={spendingEndDate}
                    onChange={(event) => setSpendingStartDate(event.target.value || CURRENT_MONTH_START)}
                    className="h-10 rounded-2xl border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"
                  />
                  <Input
                    type="date"
                    value={spendingEndDate}
                    min={spendingStartDate}
                    onChange={(event) => setSpendingEndDate(event.target.value || CURRENT_DATE)}
                    className="h-10 rounded-2xl border-slate-200 bg-white px-4 text-sm font-bold text-slate-700"
                  />
                  <select
                    value={spendingBranch}
                    onChange={(event) => setSpendingBranch(event.target.value)}
                    className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 outline-none"
                  >
                    <option value="all">All branches</option>
                    {USER_BRANCH_OPTIONS.map((branch) => (
                      <option key={branch.value} value={branch.value}>{branch.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 p-5 md:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: 'Total Payout', value: formatCurrency(spending.payout) },
                  { label: 'DSE Payout', value: formatCurrency(spending.dsePayout) },
                  { label: 'Pending Payout', value: formatCurrency(spending.pendingPayout) },
                  { label: 'Completed Payout', value: formatCurrency(spending.completedPayout) },
                  { label: 'Orders', value: `${spending.orders} total / ${spending.completedOrders} done` },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-[var(--dashboard-primary-border)] bg-gradient-to-br from-white via-[var(--dashboard-primary-soft)] to-white p-4">
                    <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
                    <p className="mt-2 font-mono text-lg font-black text-slate-950">{item.value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-sm backdrop-blur-xl">
                <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--dashboard-primary)]">Order Register</p>
                    <h2 className="mt-1 text-xl font-black text-slate-950">Finance order queue</h2>
                  </div>
                  <div className="flex w-full flex-wrap items-center justify-end gap-3 lg:ml-auto">
                    <div className="grid w-[112px] grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1">
                      <button
                        type="button"
                        onClick={() => setRegisterView('table')}
                        className={cn(
                          'flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-black transition',
                          registerView === 'table' ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <List className="h-3.5 w-3.5" />
                        Table
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegisterView('card')}
                        className={cn(
                          'flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-black transition',
                          registerView === 'card' ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Cards
                      </button>
                    </div>
                    {hasStageQueue && (
                      <div className="grid w-[180px] grid-cols-2 rounded-2xl border border-slate-200 bg-white p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setStatus('all')
                            setViewMode('queue')
                          }}
                          className={cn(
                            'rounded-xl px-3 py-2 text-xs font-black transition',
                            viewMode === 'queue' ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          My Queue
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('all')}
                          className={cn(
                            'rounded-xl px-3 py-2 text-xs font-black transition',
                            viewMode === 'all' ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          All Orders
                        </button>
                      </div>
                    )}
                    <Select
                      value={statusGroup}
                      onValueChange={(value) => {
                        setStatus('all')
                        setStatusGroup(value)
                        if (hasStageQueue) setViewMode('all')
                      }}
                    >
                      <SelectTrigger className="h-11 w-[126px] rounded-2xl border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm">
                        <SelectValue placeholder="Order status" />
                      </SelectTrigger>
                      <SelectContent className="rounded-2xl border-slate-200 bg-white">
                        {STATUS_GROUP_FILTERS.map((item) => (
                          <SelectItem key={item.value} value={item.value} className="font-bold">
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <select
                      value={branchFilter}
                      onChange={(event) => setBranchFilter(event.target.value)}
                      className="h-11 w-[180px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm outline-none"
                    >
                      <option value="all">All branches</option>
                      {USER_BRANCH_OPTIONS.map((branch) => (
                        <option key={branch.value} value={branch.value}>{branch.label}</option>
                      ))}
                    </select>
                    <div className="relative w-[220px]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search invoice, dealer, DSE..."
                        className="h-11 w-full rounded-2xl border-slate-200 bg-white pl-10"
                      />
                    </div>
                    {viewMode === 'all' ? (
                      <select
                        value={status}
                        onChange={(event) => setStatus(event.target.value)}
                        className="h-11 w-[160px] rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm outline-none"
                      >
                        {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    ) : (
                      <div className="flex h-11 w-[160px] items-center rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] px-4 text-xs font-black uppercase tracking-wider text-[var(--dashboard-primary)] shadow-sm">
                        {viewTitle}
                      </div>
                    )}
                    {isCompletedView && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void downloadCompletedPdf()}
                        disabled={exportingCompletedPdf}
                        className="app-outline-action h-11 rounded-2xl px-4 text-xs font-black"
                      >
                        {exportingCompletedPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        PDF
                      </Button>
                    )}
                  </div>
                </div>

                {registerView === 'table' ? (
                <>
                {canUseApprovalTableActions && (
                  <div className="flex flex-col gap-3 border-b border-slate-100 bg-[var(--dashboard-primary-soft)] px-5 py-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--dashboard-primary)]">Approval Selection</p>
                      <p className="mt-1 text-sm font-bold text-slate-600">
                        {selectedActionableIds.length} selected from {tableActionableOrders.length} actionable orders
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => void performBulkAction('approve')}
                        disabled={selectedActionableIds.length === 0 || bulkActionLoading !== null}
                        className="finance-primary-action h-9 rounded-xl px-3 text-xs font-black"
                      >
                        {bulkActionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Approve Selected
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void performBulkAction('hold')}
                        disabled={selectedActionableIds.length === 0 || bulkActionLoading !== null}
                        className="finance-warning-action h-9 rounded-xl px-3 text-xs font-black"
                      >
                        {bulkActionLoading === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Hold Selected
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void performBulkAction('deny')}
                        disabled={selectedActionableIds.length === 0 || bulkActionLoading !== null}
                        className="finance-danger-action h-9 rounded-xl px-3 text-xs font-black"
                      >
                        {bulkActionLoading === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Deny Selected
                      </Button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1240px] text-left">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/80 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                        {canUseApprovalTableActions && (
                          <th className="w-14 px-5 py-4">
                            <Checkbox
                              checked={allActionableSelected ? true : someActionableSelected ? 'indeterminate' : false}
                              onCheckedChange={(checked) => {
                                setSelectedOrderIds((current) => {
                                  const next = new Set(current)
                                  tableActionableOrders.forEach((order) => {
                                    if (checked) {
                                      next.add(order.id)
                                    } else {
                                      next.delete(order.id)
                                    }
                                  })
                                  return next
                                })
                              }}
                              className="approval-table-checkbox finance-order-checkbox h-5 w-5 rounded-md border-2 shadow-sm data-[state=checked]:[&_svg]:stroke-white data-[state=indeterminate]:[&_svg]:stroke-white"
                            />
                          </th>
                        )}
                        <th className="px-5 py-4">Order</th>
                        <th className="px-5 py-4">Invoice</th>
                        <th className="px-5 py-4">Dealer</th>
                        <th className="px-5 py-4">Payout</th>
                        <th className="px-5 py-4">Stage</th>
                        <th className="px-5 py-4">Created</th>
                        {canUseApprovalTableActions && <th className="px-5 py-4">Approval</th>}
                        <th className="px-5 py-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {orders.map((order) => {
                        const isActionable = tableActionableIds.has(order.id)
                        const isSelected = selectedOrderIds.has(order.id)
                        return (
                        <tr
                          key={order.id}
                          className={cn('bg-white transition hover:bg-slate-50', (selectedOrder?.id === order.id && showDetails) || isSelected ? 'bg-[var(--dashboard-primary-soft)]' : '')}
                        >
                          {canUseApprovalTableActions && (
                            <td className="px-5 py-4">
                              <Checkbox
                                checked={isSelected}
                                disabled={!isActionable || bulkActionLoading !== null}
                                onCheckedChange={(checked) => {
                                  setSelectedOrderIds((current) => {
                                    const next = new Set(current)
                                    if (checked) {
                                      next.add(order.id)
                                    } else {
                                      next.delete(order.id)
                                    }
                                    return next
                                  })
                                }}
                                className="approval-table-checkbox finance-order-checkbox h-5 w-5 rounded-md border-2 shadow-sm data-[state=checked]:[&_svg]:stroke-white data-[state=indeterminate]:[&_svg]:stroke-white"
                              />
                            </td>
                          )}
                          <td className="px-5 py-4">
                            <p className="font-mono text-sm font-black text-slate-950">{order.orderNumber}</p>
                            <p className="mt-1 text-xs font-semibold text-slate-500">{order.dseName}</p>
                          </td>
                          <td className="px-5 py-4 font-black text-slate-800">{order.invoiceNumber}</td>
                          <td className="px-5 py-4 text-sm font-bold text-slate-700">{formatDealer(order.dealer)}</td>
                          <td className="px-5 py-4 font-mono text-sm font-black text-slate-950">{formatCurrency(order.totalPayoutReceived)}</td>
                          <td className="px-5 py-4">
                            <Badge className={cn('rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider shadow-none', statusClass(order.status))}>
                              {statusLabel(order.status)}
                            </Badge>
                          </td>
                          <td className="px-5 py-4 text-sm font-bold text-slate-500">{formatDate(order.createdAt)}</td>
                          {canUseApprovalTableActions && (
                            <td className="px-5 py-4">
                              {isActionable ? (
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    onClick={() => void performTableAction(order.id, 'approve')}
                                    disabled={bulkActionLoading !== null}
                                    className="finance-primary-action h-8 rounded-lg px-2.5 text-[11px] font-black"
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void performTableAction(order.id, 'hold')}
                                    disabled={bulkActionLoading !== null}
                                    className="finance-warning-action h-8 rounded-lg px-2.5 text-[11px] font-black"
                                  >
                                    Hold
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => void performTableAction(order.id, 'deny')}
                                    disabled={bulkActionLoading !== null}
                                    className="finance-danger-action h-8 rounded-lg px-2.5 text-[11px] font-black"
                                  >
                                    Deny
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-xs font-bold text-slate-400">Not in your queue</span>
                              )}
                            </td>
                          )}
                          <td className="px-5 py-4 text-right">
                            <Button
                              type="button"
                              onClick={() => openOrderDetails(order)}
                              className="finance-primary-action h-9 rounded-xl px-4 text-xs font-black shadow-sm"
                              style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                            >
                              Open
                            </Button>
                          </td>
                        </tr>
                      )})}
                      {orders.length === 0 && (
                        <tr>
                          <td colSpan={canUseApprovalTableActions ? 9 : 7} className="px-5 py-16 text-center">
                            <FileText className="mx-auto h-8 w-8 text-slate-300" />
                            <p className="mt-3 text-sm font-black text-slate-600">No finance orders match this view.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                </>
                ) : (
                  <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
                    {orders.map((order) => (
                      <article
                        key={order.id}
                        className={cn(
                          'group overflow-hidden rounded-2xl border border-[var(--dashboard-primary-border)] bg-gradient-to-br from-white via-[var(--dashboard-primary-soft)] to-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg',
                          selectedOrder?.id === order.id && showDetails && 'border-[var(--dashboard-primary-border)] ring-2 ring-[var(--dashboard-primary-soft)]'
                        )}
                      >
                        <div className="border-b border-slate-100 bg-gradient-to-br from-white to-slate-50 p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-sm font-black text-slate-950">{order.orderNumber}</p>
                              <p className="mt-1 truncate text-xs font-bold text-slate-500">{order.invoiceNumber}</p>
                            </div>
                            <Badge className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider shadow-none', statusClass(order.status))}>
                              {statusLabel(order.status)}
                            </Badge>
                          </div>
                          <div className="mt-5">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Payout</p>
                            <p className="mt-1 font-mono text-2xl font-black text-slate-950">{formatCurrency(order.totalPayoutReceived)}</p>
                          </div>
                        </div>
                        <div className="grid gap-3 p-5 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-bold text-slate-500">Dealer</span>
                            <span className="truncate font-black text-slate-900">{formatDealer(order.dealer)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-bold text-slate-500">DSE</span>
                            <span className="truncate font-black text-slate-900">{order.dseName}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="font-bold text-slate-500">Created</span>
                            <span className="font-black text-slate-900">{formatDate(order.createdAt)}</span>
                          </div>
                          <Button
                            type="button"
                            onClick={() => openOrderDetails(order)}
                            className="finance-primary-action mt-2 h-11 rounded-2xl text-sm font-black shadow-sm"
                            style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
                          >
                            Open
                          </Button>
                        </div>
                      </article>
                    ))}
                    {orders.length === 0 && (
                      <div className="col-span-full px-5 py-16 text-center">
                        <FileText className="mx-auto h-8 w-8 text-slate-300" />
                        <p className="mt-3 text-sm font-black text-slate-600">No finance orders match this view.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </section>
          </>
        )}

        <Dialog open={showDetails} onOpenChange={setShowDetails}>
          <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-[2rem] border-white/70 bg-white p-0 shadow-2xl [&>button]:bg-white/15 [&>button]:text-white [&>button]:shadow-none [&>button]:hover:bg-white/25">
            {selectedOrder && (
              <>
                <DialogHeader className="border-b border-[color-mix(in_srgb,var(--dashboard-primary)_70%,white)] bg-gradient-to-br from-[var(--dashboard-primary)] to-[var(--dashboard-primary-dark)] p-6 pr-16 text-white">
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Finance Order Details</p>
                      <DialogTitle className="mt-1 font-mono text-2xl font-black tracking-tight text-white">
                        {selectedOrder.orderNumber}
                      </DialogTitle>
                      <DialogDescription className="mt-2 font-semibold text-white/80">
                        Review payout details, approval state, remarks, and audit trail.
                      </DialogDescription>
                      <Badge className={cn('mt-4 w-fit rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider shadow-none', statusClass(selectedOrder.status))}>
                        {statusLabel(selectedOrder.status)}
                      </Badge>
                    </div>
                  </div>
                </DialogHeader>

                <div className="grid gap-5 p-6 lg:grid-cols-[1fr_360px]">
                  <div className="space-y-5">
                    <div className="grid gap-3 rounded-2xl border border-[var(--dashboard-primary-border)] bg-[var(--dashboard-primary-soft)] p-4 text-sm md:grid-cols-2">
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Invoice</span><span className="mt-1 block font-black text-slate-950">{selectedOrder.invoiceNumber}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Dealer</span><span className="mt-1 block font-black text-slate-950">{formatDealer(selectedOrder.dealer)}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Bank</span><span className="mt-1 block font-black text-slate-950">{selectedOrder.hypBankName}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">DSE</span><span className="mt-1 block font-black text-slate-950">{selectedOrder.dseName}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Payment Date</span><span className="mt-1 block font-black text-slate-950">{formatDate(selectedOrder.paymentReceivedDate)}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Created</span><span className="mt-1 block font-black text-slate-950">{formatDate(selectedOrder.createdAt)}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Total Payout</span><span className="mt-1 block font-mono text-lg font-black text-slate-950">{formatCurrency(selectedOrder.totalPayoutReceived)}</span></div>
                      <div className="rounded-xl border border-white/70 bg-white/78 p-3 shadow-sm"><span className="block text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">DSE Payout</span><span className="mt-1 block font-mono text-lg font-black text-slate-950">{formatCurrency(selectedOrder.dsePayout)}</span></div>
                    </div>

                    {selectedOrder.holdRemarks && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                        Hold remarks: {selectedOrder.holdRemarks}
                      </div>
                    )}

                    {canEditSelected && (
                      <Button variant="outline" onClick={() => openEditForm(selectedOrder)} className="w-full rounded-2xl border-slate-200 bg-white font-black">
                        Edit and resubmit
                      </Button>
                    )}

                    {canApproveSelected && (
                      <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{actionPanelLabel}</p>
                        <Textarea
                          value={remarks}
                          onChange={(event) => setRemarks(event.target.value)}
                          placeholder={selectedIsAccountsQueue ? 'Add payment verification remarks...' : 'Add remarks for the approval trail...'}
                          className="min-h-24 rounded-2xl border-slate-200 bg-white"
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.35fr_1fr_1fr]">
                          <Button onClick={() => performAction('approve')} disabled={Boolean(actionLoading)} className="app-primary-action rounded-xl px-2 text-xs font-black sm:text-sm">
                            {actionLoading === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : approveActionLabel}
                          </Button>
                          <Button onClick={() => performAction('hold')} disabled={Boolean(actionLoading)} variant="outline" className="rounded-xl border-amber-300 bg-amber-50 font-black text-amber-800 hover:bg-amber-100 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-600">
                            {actionLoading === 'hold' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Hold'}
                          </Button>
                          <Button onClick={() => performAction('deny')} disabled={Boolean(actionLoading)} variant="outline" className="rounded-xl border-rose-300 bg-rose-50 font-black text-rose-700 hover:bg-rose-100 disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-600">
                            {actionLoading === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deny'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Audit Trail</p>
                    <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                      {history.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-slate-950">{statusLabel(item.action)}</p>
                              <p className="mt-1 text-xs font-bold text-slate-500">{item.actorName || item.actorEmail || item.userRole}</p>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{formatDateTime(item.createdAt)}</span>
                          </div>
                          {item.remarks && <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{item.remarks}</p>}
                        </div>
                      ))}
                      {history.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">
                          No audit entries yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[2rem] border-white/70 bg-white p-0 shadow-2xl [&>button]:bg-white/15 [&>button]:text-white [&>button]:shadow-none [&>button]:hover:bg-white/25">
            <DialogHeader className="border-b border-[color-mix(in_srgb,var(--dashboard-primary)_70%,white)] bg-gradient-to-br from-[var(--dashboard-primary)] to-[var(--dashboard-primary-dark)] p-6 text-white">
              <DialogTitle className="text-2xl font-black tracking-tight text-white">
                {editingOrder ? 'Edit Finance Order' : 'New Finance Order'}
              </DialogTitle>
              <DialogDescription className="font-semibold text-white/80">
                Capture payout receipt details and route the order through Accounts, EA, and MD approval.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <FloatingField label="Total Payout Received" error={errors.totalPayoutReceived}>
                  <Input type="number" min="0" step="0.01" value={form.totalPayoutReceived} onChange={(event) => setForm({ ...form, totalPayoutReceived: event.target.value })} placeholder="125000" className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <FloatingField label="Invoice Number" error={errors.invoiceNumber}>
                  <Input value={form.invoiceNumber} onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })} placeholder="INV-2026-001" className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <FloatingField label="Payment Received Date" error={errors.paymentReceivedDate}>
                  <Input type="date" value={form.paymentReceivedDate} onChange={(event) => setForm({ ...form, paymentReceivedDate: event.target.value })} className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <FloatingField label="DSE Payout" error={errors.dsePayout}>
                  <Input type="number" min="0" step="0.01" value={form.dsePayout} onChange={(event) => setForm({ ...form, dsePayout: event.target.value })} placeholder="8000" className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <FloatingField label="Hyp / Bank Name" error={errors.hypBankName}>
                  <Input list="finance-bank-options" value={form.hypBankName} onChange={(event) => setForm({ ...form, hypBankName: event.target.value })} placeholder="Search bank..." className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <FloatingField label="DSE Name" error={errors.dseName}>
                  <Input value={form.dseName} onChange={(event) => setForm({ ...form, dseName: event.target.value })} placeholder="DSE name" className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold" />
                </FloatingField>
                <div className="md:col-span-2">
                  <FloatingField label="Dealer" error={errors.dealer}>
                    <Select value={form.dealer} onValueChange={(value) => setForm({ ...form, dealer: value })}>
                      <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-slate-50 font-bold">
                        <SelectValue placeholder="Select dealer branch" />
                      </SelectTrigger>
                      <SelectContent className="z-[200] rounded-2xl border border-slate-200 bg-white shadow-xl">
                        {USER_BRANCH_OPTIONS.map((branch) => (
                          <SelectItem key={branch.value} value={branch.value} className="bg-white hover:bg-slate-50">
                            {branch.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FloatingField>
                </div>
              </div>
              <datalist id="finance-bank-options">{FINANCE_BANK_OPTIONS.map((item) => <option key={item} value={item} />)}</datalist>
              <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="rounded-2xl border-slate-200 bg-white font-black">Cancel</Button>
                <Button type="button" variant="outline" onClick={() => submitForm('draft')} disabled={submitting} className="rounded-2xl border-slate-200 bg-slate-50 font-black">Save Draft</Button>
                <Button type="button" onClick={() => submitForm('submit')} disabled={submitting} className="app-primary-action rounded-2xl font-black">
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Submit for Accounts Check
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  )
}
