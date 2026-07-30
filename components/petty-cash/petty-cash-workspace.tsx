'use client'

/* eslint-disable react-hooks/set-state-in-effect -- mount fetch sets loading state; standard data-loading pattern. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import {
  Banknote,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Layers,
  PauseCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Wallet,
  XCircle,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RemarksDialog } from '@/components/purchase-orders/remarks-dialog'
import { getBranchLabel } from '@/lib/branches'
import { getAllPettyCashLocationOptions, getPettyCashLocationOptions, PETTY_CASH_DEPARTMENT_OPTIONS } from '@/lib/petty-cash/constants'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { RequestFormDialog } from './pc-request-form'
import { ExpenseFormDialog } from './pc-expense-form'
import { PettyCashDetailDialog, type DetailTarget } from './pc-detail-dialog'
import { AllocationSpendDialog } from './pc-allocation-spend-dialog'
import { PettyCashStatusBoard } from './petty-cash-status-board'
import {
  BalanceMeter,
  EmptyState,
  RecordTable,
  SectionCard,
  StatusPill,
  SummaryCard,
  expenseDate,
  expenseVendor,
  formatCurrency,
  formatDateTime,
  ledgerBalanceAfter,
  ledgerEntryType,
  normalizeAllocatedAmount,
  normalizeBranchId,
  normalizeExpenseNumber,
  normalizeRequestNumber,
  normalizeSpentAmount,
  requestedAmount,
  requestedByName,
} from './pc-shared'
import {
  EMPTY_EXPENSE_FORM,
  EMPTY_REQUEST_FORM,
  type ApprovalStage,
  type DashboardPayload,
  type ExpenseFormState,
  type PettyCashLedgerEntry,
  type PettyCashRequest,
  type RequestFormState,
} from './types'

type TabKey = 'overview' | 'status' | 'requests' | 'expenses' | 'allocations' | 'ledger'
type WorkflowDialogState = { request: PettyCashRequest; action: 'reject' | 'hold' } | null

type PettyCashAllocationRow = {
  id: string
  allocationNumber?: string
  allocation_number?: string
  branchId?: string
  branch_id?: string
  status: string
  allocatedAmount?: string
  allocated_amount?: string
  spentAmount?: string
  spent_amount?: string
  remainingAmount?: string
  location?: string | null
  department?: string | null
  allocatedToName?: string | null
  /** Who released the money — joined server-side; before this it was a bare UUID and unusable. */
  allocatedByName?: string | null
  /** Spend window against this allocation, on expense_date (approved, non-deleted only). */
  firstSpendDate?: string | null
  lastSpendDate?: string | null
  spendCount?: number
  allocatedAt?: string
  allocated_at?: string
  createdAt?: string
  created_at?: string
}

// Only the Branch Admin (branch_admin) or Sales Manager (sales_manager) may submit petty cash requests / expenses.
/**
 * Renders a plain `expense_date` (YYYY-MM-DD, no time, no zone) as a short day.
 *
 * Deliberately NOT formatDateTime: that parses through `new Date()` and appends " IST", which on a
 * bare date string means midnight UTC and can render the previous day in India.
 */
const formatSpendDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date)
}

const isCreatorRole = (role: string) => role === 'branch_admin' || role === 'sales_manager'
const isApproverRole = (role: string) => role === 'ea' || role === 'md' || role === 'eba' || role === 'accounts' || role === 'ed'
const isExpenseFeedRole = (role: string) => isApproverRole(role) || role === 'developer' || role === 'manager' || role === 'general_manager'

const PENDING_STATUSES = ['submitted', 'ed_pending', 'ed_on_hold', 'ea_pending', 'ea_on_hold', 'md_pending', 'md_on_hold', 'accounts_pending', 'accounts_on_hold']
const OPEN_REQUEST_STATUSES = ['draft', 'submitted', ...PENDING_STATUSES]

function canActOnRequest(role: string, request: PettyCashRequest) {
  const status = request.status
  const r = String(role || '').trim().toLowerCase()
  const isSuperAdmin = r === 'developer' || r === 'admin' || r === 'manager' || r === 'general_manager'
  if (isSuperAdmin) return PENDING_STATUSES.includes(status)
  if (r === 'ed' || r === 'sales_manager') return status === 'submitted' || status === 'ed_pending' || status === 'ed_on_hold'
  if (r === 'ea') return status === 'ea_pending' || status === 'ea_on_hold' || status === 'ed_approved'
  if (r === 'md' || r === 'eba') {
    return status === 'md_pending' || status === 'md_on_hold' || status === 'ea_pending' || status === 'ea_on_hold' || status === 'ed_approved'
  }
  if (r === 'accounts') return status === 'accounts_pending' || status === 'accounts_on_hold'
  return false
}

function stageForRequest(request: PettyCashRequest, role?: string): ApprovalStage {
  const status = request.status
  const r = String(role || '').trim().toLowerCase()
  const isMdOrDev = r === 'md' || r === 'eba' || r === 'developer' || r === 'admin'
  if (status === 'submitted' || status === 'ed_pending' || status === 'ed_on_hold') return 'ed_approval'
  if (status === 'ea_pending' || status === 'ea_on_hold' || status === 'ed_approved') {
    if (isMdOrDev) return 'md_approval'
    return 'ea_approval'
  }
  if (status === 'md_pending' || status === 'md_on_hold') return 'md_approval'
  return 'accounts'
}

// Short, human "current stage" for the queue — makes it obvious at a glance where
// a request is sitting and who needs to act next.
function pettyCashStageLabel(status: string): { label: string; className: string } {
  if (status === 'submitted' || status.startsWith('ed_')) return { label: 'ED', className: 'bg-sky-50 text-sky-700 ring-sky-200' }
  if (status.startsWith('ea_')) return { label: 'EA', className: 'bg-amber-50 text-amber-700 ring-amber-200' }
  if (status.startsWith('md_')) return { label: 'MD', className: 'bg-blue-50 text-blue-700 ring-blue-200' }
  if (status.startsWith('accounts')) return { label: 'Accounts', className: 'bg-violet-50 text-violet-700 ring-violet-200' }
  if (status === 'approved') return { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
  if (status.includes('reject') || status === 'cancelled') return { label: 'Closed', className: 'bg-rose-50 text-rose-700 ring-rose-200' }
  return { label: 'Draft', className: 'bg-slate-100 text-slate-600 ring-slate-200' }
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || `Unable to load ${label}`)
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

export function PettyCashWorkspace() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [ledger, setLedger] = useState<PettyCashLedgerEntry[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [expenseLocationFilter, setExpenseLocationFilter] = useState('all')
  const [expenseDepartmentFilter, setExpenseDepartmentFilter] = useState('all')
  const [requestForm, setRequestForm] = useState<RequestFormState>(EMPTY_REQUEST_FORM)
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(EMPTY_EXPENSE_FORM)
  const [expenseFiles, setExpenseFiles] = useState<string[]>([])
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false)
  const [workflowDialog, setWorkflowDialog] = useState<WorkflowDialogState>(null)
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null)
  const [loading, setLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mdQueueScope, setMdQueueScope] = useState<'all' | 'mine'>('mine')
  const [allocations, setAllocations] = useState<PettyCashAllocationRow[]>([])
  const [allocationsLoading, setAllocationsLoading] = useState(false)
  const [allocationLocationFilter, setAllocationLocationFilter] = useState('all')
  // 'active' = the single open float per person (the old, only behaviour). 'all' = full history,
  // which is the only way to see when someone PREVIOUSLY got money — past allocations are closed.
  const [allocationStatusFilter, setAllocationStatusFilter] = useState('active')
  const [spendAllocationId, setSpendAllocationId] = useState<string | null>(null)
  const [allocationDepartmentFilter, setAllocationDepartmentFilter] = useState('all')
  const [ledgerLocationFilter, setLedgerLocationFilter] = useState('all')

  const refreshLedger = useCallback(async (allocationId?: string | null) => {
    setLedgerLoading(true)
    try {
      const query = allocationId ? `?allocationId=${encodeURIComponent(allocationId)}` : ''
      const data = await fetchJson<{ ledger: PettyCashLedgerEntry[] }>(`/api/petty-cash/reports${query}`, 'ledger')
      setLedger(data.ledger || [])
    } catch {
      setLedger([])
    } finally {
      setLedgerLoading(false)
    }
  }, [])

  const loadAllocations = useCallback(async (status: string = 'active') => {
    setAllocationsLoading(true)
    try {
      const data = await fetchJson<{ allocations: PettyCashAllocationRow[] }>(
        `/api/petty-cash/allocations?status=${encodeURIComponent(status)}`,
        'allocations',
      )
      setAllocations(data.allocations || [])
    } catch {
      setAllocations([])
    } finally {
      setAllocationsLoading(false)
    }
  }, [])

  const loadDashboard = useCallback(async (options?: { branchId?: string | null; preserveData?: boolean }) => {
    if (options?.preserveData) setDashboardLoading(true)
    else setLoading(true)
    try {
      const query = options?.branchId ? `?branchId=${encodeURIComponent(options.branchId)}` : ''
      const dashboard = await fetchJson<DashboardPayload>(`/api/petty-cash${query}`, 'petty cash dashboard')
      setPayload(dashboard)
      setError(null)
      void refreshLedger(dashboard.currentAllocation?.id || null)
      setExpenseForm((form) => ({ ...form, allocationId: dashboard.currentAllocation?.id || '' }))
      return dashboard
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load petty cash dashboard')
      return null
    } finally {
      setLoading(false)
      setDashboardLoading(false)
    }
  }, [refreshLedger])

  const refreshAfterMutation = useCallback(async () => {
    try {
      return await loadDashboard({ preserveData: true })
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to refresh')
      return null
    }
  }, [loadDashboard])

function compressImage(file: File, maxWidth = 1200, quality = 0.75): Promise<File> {
  if (!file.type.startsWith('image/')) {
    return Promise.resolve(file)
  }

  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width)
          width = maxWidth
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(file)
          return
        }

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file)
              return
            }
            const lastDotIndex = file.name.lastIndexOf('.')
            const baseName = lastDotIndex !== -1 ? file.name.substring(0, lastDotIndex) : file.name
            const newName = `${baseName}.jpg`
            const compressedFile = new File([blob], newName, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
            resolve(compressedFile)
          },
          'image/jpeg',
          quality
        )
      }
      img.onerror = () => resolve(file)
      img.src = event.target?.result as string
    }
    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}

  const uploadExpenseFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    try {
      for (const file of Array.from(files)) {
        const compressedFile = await compressImage(file)
        const body = new FormData()
        body.append('file', compressedFile)
        body.append('entity', 'expense')
        const res = await fetch('/api/petty-cash/upload', { method: 'POST', body })
        const result = await res.json().catch(() => null)
        if (!res.ok) throw new Error(result?.error || `Upload failed for ${file.name}`)
        if (result?.url) setExpenseFiles((prev) => [...prev, result.url])
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed')
      toast({ title: 'Upload failed', description: uploadError instanceof Error ? uploadError.message : 'Please try again.', variant: 'error' })
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => { void loadDashboard() }, 0)
    return () => clearTimeout(timer)
  }, [loadDashboard])


  /* ---- derived values ---- */
  const summary = payload?.summary
  const currentAllocation = payload?.currentAllocation || null
  const allocationAmount = Number(normalizeAllocatedAmount(currentAllocation))
  const spentAmount = Number(normalizeSpentAmount(currentAllocation))
  const remainingAmount = summary?.remainingAmount ?? (allocationAmount - spentAmount)
  const spendPercentage = allocationAmount > 0 ? Math.min(100, Math.round((spentAmount / allocationAmount) * 100)) : 0
  const userRole = payload?.user.role || ''
  const currentBranchId = payload?.user.brand || ''
  const isSuperAdmin = userRole === 'developer' || userRole === 'manager' || userRole === 'general_manager'
  // Creation is a branch action driven by the user's own login branch.
  // Super admins have no single branch (brand = 'all'), so they review/approve
  // across every branch instead of creating.
  const canCreate = isCreatorRole(userRole)
  const canReviewQueue = isApproverRole(userRole) || isSuperAdmin
  const canRequestTopUp = summary?.canRequestTopUp ?? true
  const canSubmitExpense = summary?.canSubmitExpense ?? false
  const topUpReason = summary?.topUpReason || ''
  const categoryOptions = payload?.categories || []
  const allRequests = payload?.requests || []
  const allExpenses = payload?.expenses || []
  const showMdScopeToggle = userRole === 'md'
  // EA / MD / EBA / Developer supervise every branch & dealership; 'all' users too.
  const isAllBranchViewer = ['ea', 'md', 'eba', 'developer'].includes(userRole) || currentBranchId === 'all'
  // Back-office reviewers can filter the cross-branch expense feed location-wise.
  const canFilterExpensesByLocation = ['admin', 'md', 'ea', 'eba', 'developer', 'manager', 'general_manager'].includes(userRole)
  // Seed with the full cross-branch location list (incl. Banihal) so every location is always
  // selectable in the filter, then add any ad-hoc locations that appear in the data.
  const expenseLocationOptions = useMemo(
    () => Array.from(new Set([...getAllPettyCashLocationOptions(), ...allExpenses.map((expense) => (expense.location || '').trim()).filter(Boolean)])).sort(),
    [allExpenses],
  )
  const expenseDepartmentOptions = useMemo(
    () => Array.from(new Set(allExpenses.map((expense) => (expense.department || '').trim()).filter(Boolean))).sort(),
    [allExpenses],
  )
  const visibleExpenses = useMemo(() => {
    if (!canFilterExpensesByLocation) return allExpenses
    return allExpenses.filter((expense) =>
      (expenseLocationFilter === 'all' || (expense.location || '').trim() === expenseLocationFilter)
      && (expenseDepartmentFilter === 'all' || (expense.department || '').trim() === expenseDepartmentFilter))
  }, [allExpenses, canFilterExpensesByLocation, expenseLocationFilter, expenseDepartmentFilter])
  const allocationLocationOptions = useMemo(
    () => Array.from(new Set([...getAllPettyCashLocationOptions(), ...allocations.map((allocation) => (allocation.location || '').trim()).filter(Boolean)])).sort(),
    [allocations],
  )
  const allocationDepartmentOptions = useMemo(
    () => Array.from(new Set(allocations.map((allocation) => (allocation.department || '').trim()).filter(Boolean))).sort(),
    [allocations],
  )
  const visibleAllocations = useMemo(() => {
    return allocations.filter((allocation) =>
      (allocationLocationFilter === 'all' || (allocation.location || '').trim() === allocationLocationFilter)
      && (allocationDepartmentFilter === 'all' || (allocation.department || '').trim() === allocationDepartmentFilter))
  }, [allocations, allocationLocationFilter, allocationDepartmentFilter])
  // Ledger location filter — seed with all locations (incl. Banihal) + any ad-hoc ones present.
  const ledgerLocationOptions = useMemo(
    () => Array.from(new Set([...getAllPettyCashLocationOptions(), ...ledger.map((entry) => (entry.location || '').trim()).filter(Boolean)])).sort(),
    [ledger],
  )
  const visibleLedger = useMemo(
    () => ledger.filter((entry) => ledgerLocationFilter === 'all' || (entry.location || '').trim() === ledgerLocationFilter),
    [ledger, ledgerLocationFilter],
  )
  const allocationTotals = useMemo(() => allocations.reduce((acc, allocation) => {
    acc.allocated += Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
    acc.spent += Number(allocation.spentAmount || allocation.spent_amount || 0)
    acc.remaining += Number(allocation.remainingAmount ?? (Number(allocation.allocatedAmount || allocation.allocated_amount || 0) - Number(allocation.spentAmount || allocation.spent_amount || 0)))
    return acc
  }, { allocated: 0, spent: 0, remaining: 0 }), [allocations])
  const contentLoading = dashboardLoading || ledgerLoading
  const requestLocationOptions = useMemo(() => getPettyCashLocationOptions(currentBranchId), [currentBranchId])
  const expenseFeedTitle = userRole === 'accounts'
    ? 'Branch Expense Ledger Feed'
    : isAllBranchViewer ? 'Recent Expenses · All Branches' : 'Recent Branch Expenses'

  const approvalRequests = useMemo(() => {
    if (userRole !== 'md' || mdQueueScope === 'all') return allRequests
    return allRequests.filter((request) => normalizeBranchId(request) === currentBranchId)
  }, [allRequests, userRole, mdQueueScope, currentBranchId])

  // Only in-flight requests belong in the "pending" sections — approved /
  // rejected / cancelled ones must drop out immediately after a decision.
  const myOpenRequests = useMemo(() => allRequests.filter((request) => OPEN_REQUEST_STATUSES.includes(request.status)), [allRequests])
  const pendingQueue = useMemo(() => approvalRequests.filter((request) => PENDING_STATUSES.includes(request.status)), [approvalRequests])

  // Reviewers (EA/MD/EBA/Developer) get the cross-branch allocations feed — powers
  // both the Allocations tab and the overview aggregate KPIs.
  useEffect(() => {
    if (canReviewQueue) void loadAllocations(allocationStatusFilter)
  }, [canReviewQueue, loadAllocations, allocationStatusFilter])

  /* ---- mutations ---- */
  const submitRequest = useCallback(async () => {
    if (!canRequestTopUp) { setError(topUpReason || 'Top-up not available right now.'); return }
    const location = requestForm.location.trim()
    const department = requestForm.department.trim()
    const amount = Number(requestForm.requestedAmount)
    const purpose = requestForm.purpose.trim()
    if (!location || !requestLocationOptions.includes(location)) { setError('Please select a valid location.'); return }
    if (!department || !PETTY_CASH_DEPARTMENT_OPTIONS.includes(department as typeof PETTY_CASH_DEPARTMENT_OPTIONS[number])) { setError('Please select a department (Sales or Service).'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid amount greater than 0.'); return }
    if (purpose.length < 5) { setError('Purpose must be at least 5 characters.'); return }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/petty-cash/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedAmount: requestForm.requestedAmount,
          purpose,
          department: requestForm.department || null,
          requestForm: {
            location: location || null,
            department: requestForm.department || null,
            typeOfPayment: requestForm.typeOfPayment || null,
          },
        }),
      })
      const result = await res.json().catch(() => null)
      if (!res.ok) throw new Error(result?.error || 'Failed to submit request')
      setRequestForm(EMPTY_REQUEST_FORM)
      setRequestDialogOpen(false)
      toast({ title: 'Request submitted', description: 'Your petty cash request is now in the approval queue.', variant: 'success' })
      await refreshAfterMutation()
      setActiveTab('requests')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit request')
      toast({ title: 'Could not submit', description: submitError instanceof Error ? submitError.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [canRequestTopUp, topUpReason, requestForm, requestLocationOptions, refreshAfterMutation])

  const submitExpense = useCallback(async () => {
    const amount = Number(expenseForm.amount)
    const purpose = expenseForm.purpose.trim()
    const location = expenseForm.location.trim()
    if (!currentAllocation) { setError('No active allocation to post against.'); return }
    if (!location || !requestLocationOptions.includes(location)) { setError('Please select the location where the money was spent.'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter a valid amount greater than 0.'); return }
    if (purpose.length < 5) { setError('Purpose must be at least 5 characters.'); return }
    if (expenseFiles.length === 0) { setError('Please upload at least one bill image or PDF.'); return }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/petty-cash/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId: expenseForm.allocationId || currentAllocation?.id,
          expenseDate: expenseForm.expenseDate,
          categoryId: expenseForm.categoryId || null,
          amount: expenseForm.amount,
          vendorName: expenseForm.vendorName || null,
          receivedBy: expenseForm.receivedBy || null,
          purpose,
          location,
          expenseForm: {
            date: expenseForm.expenseDate,
            vendorName: expenseForm.vendorName || null,
            receivedBy: expenseForm.receivedBy || null,
            purposeOfExpense: purpose,
            location,
            uploadBillUrls: expenseFiles,
          },
          billFiles: expenseFiles,
        }),
      })
      const result = await res.json().catch(() => null)
      if (!res.ok) throw new Error(result?.error || 'Failed to post expense')
      setExpenseForm((form) => ({ ...EMPTY_EXPENSE_FORM, allocationId: form.allocationId }))
      setExpenseFiles([])
      setExpenseDialogOpen(false)
      toast({ title: 'Expense posted', description: 'The spend was deducted from your allocation.', variant: 'success' })
      await refreshAfterMutation()
      setActiveTab('expenses')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to post expense')
      toast({ title: 'Could not post expense', description: submitError instanceof Error ? submitError.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [expenseForm, currentAllocation, remainingAmount, expenseFiles, requestLocationOptions, refreshAfterMutation])

  const applyRequestWorkflow = useCallback(async (id: string, stage: ApprovalStage, action: 'approve' | 'reject' | 'hold', remarks = '') => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/petty-cash/requests/${encodeURIComponent(id)}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, action, remarks }),
      })
      const result = await res.json().catch(() => null)
      if (!res.ok) throw new Error(result?.error || `Failed to ${action} request`)
      toast({
        title: action === 'approve' ? 'Request approved' : action === 'hold' ? 'Request held' : 'Request rejected',
        description: 'The petty cash request was updated.',
        variant: action === 'reject' ? 'error' : 'success',
      })
      const dashboard = await refreshAfterMutation()
      if (stage === 'accounts' && action === 'approve' && dashboard?.currentAllocation) {
        setActiveTab('overview')
        setExpenseForm((form) => ({ ...form, allocationId: dashboard.currentAllocation?.id || '' }))
        setExpenseDialogOpen(true)
      }
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : 'Workflow action failed')
      toast({ title: 'Action failed', description: workflowError instanceof Error ? workflowError.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [refreshAfterMutation])

  const updateRequestForm = useCallback(<K extends keyof RequestFormState>(field: K, value: RequestFormState[K]) => {
    setRequestForm((form) => ({ ...form, [field]: value }))
  }, [])
  const updateExpenseForm = useCallback(<K extends keyof ExpenseFormState>(field: K, value: ExpenseFormState[K]) => {
    setExpenseForm((form) => ({ ...form, [field]: value }))
  }, [])

  /* ---- loading / error gates ---- */
  if (loading && !payload) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-3xl bg-slate-100" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={`kpi-skeleton-${index}`} className="h-36 animate-pulse rounded-3xl bg-slate-100" />)}
        </div>
        <div className="h-80 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    )
  }
  if (!payload) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm font-bold text-rose-700">
        {error || 'Unable to load the petty cash dashboard.'}
      </div>
    )
  }

  const tabs: Array<{ key: TabKey; label: string; icon: typeof Wallet }> = [
    { key: 'overview', label: 'Overview', icon: Layers },
    { key: 'status', label: 'Status', icon: Clock3 },
    { key: 'requests', label: 'Requests', icon: ClipboardList },
    { key: 'expenses', label: 'Expenses', icon: ReceiptText },
    // Allocations is a cross-branch supervisor view — only reviewers see it.
    ...(canReviewQueue ? [{ key: 'allocations' as const, label: 'Allocations', icon: Banknote }] : []),
    { key: 'ledger', label: 'Ledger', icon: Wallet },
  ]

  const branchLabel = currentAllocation ? getBranchLabel(normalizeBranchId(currentAllocation)) : 'No active allocation'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Petty Cash</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">Allocations, spends, approvals, and an immutable ledger — in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void refreshAfterMutation()} disabled={contentLoading} className="h-11 gap-2 rounded-2xl border-slate-200 font-bold">
            <RefreshCw className={cn('h-4 w-4', contentLoading && 'animate-spin')} /> Refresh
          </Button>
          {canCreate && (
            <>
              <Button variant="outline" onClick={() => setExpenseDialogOpen(true)} disabled={!canSubmitExpense} className="h-11 gap-2 rounded-2xl border-slate-200 font-bold">
                <ReceiptText className="h-4 w-4" /> Submit Expense
              </Button>
              <Button onClick={() => setRequestDialogOpen(true)} disabled={!canRequestTopUp} className="app-primary-action h-11 gap-2 rounded-2xl font-bold shadow-sm">
                <Plus className="h-4 w-4" /> New Request
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
      )}

      {canCreate && !canRequestTopUp && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{topUpReason || 'A new request unlocks only when the remaining balance is Rs 1000 or lower.'}</span>
        </div>
      )}

      {/* KPI row — reviewers see cross-branch aggregates (they own no single
          allocation); creators see their own allocation health. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canReviewQueue && !canCreate ? (
          <>
            <SummaryCard
              label="Pending Requests"
              value={String(summary?.pendingRequestCount ?? 0)}
              meta="Awaiting your approval"
              icon={ShieldCheck}
              tone="amber"
              onClick={() => setActiveTab('requests')}
              active={activeTab === 'requests'}
            />
            <SummaryCard
              label="Active Allocations"
              value={allocationsLoading ? '…' : String(allocations.length)}
              meta="Across all branches"
              icon={Banknote}
              tone="blue"
              onClick={() => setActiveTab('allocations')}
              active={activeTab === 'allocations'}
            />
            <SummaryCard label="Total Remaining" value={formatCurrency(allocationTotals.remaining)} meta="Unspent across allocations" icon={Wallet} tone="emerald" />
            <SummaryCard label="Total Spent" value={formatCurrency(allocationTotals.spent)} meta="Spent across allocations" icon={TrendingDown} tone="rose" />
          </>
        ) : (
          <>
            <SummaryCard label="Current Allocation" value={formatCurrency(allocationAmount)} meta={branchLabel} icon={Banknote} tone="blue" />
            <SummaryCard label="Remaining" value={formatCurrency(remainingAmount)} meta={`${spendPercentage}% of allocation used`} icon={Wallet} tone="emerald" />
            <SummaryCard label="Spent" value={formatCurrency(spentAmount)} meta="Live deducted from active allocation" icon={TrendingDown} tone="rose" />
            <SummaryCard
              label="Pending Requests"
              value={String(summary?.pendingRequestCount ?? 0)}
              meta={canReviewQueue ? 'Awaiting your approval' : 'Your requests in review'}
              icon={ShieldCheck}
              tone="amber"
              onClick={() => setActiveTab('requests')}
              active={activeTab === 'requests'}
            />
          </>
        )}
      </div>

      {/* Segmented tabs */}
      <div className="w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-x">
        <div className="inline-flex min-w-max sm:min-w-0 sm:w-full max-w-2xl items-center gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1 shadow-sm">
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn('relative flex flex-1 shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors', isActive ? 'text-white' : 'text-slate-600 hover:text-slate-900')}
              >
                {isActive && <motion.span layoutId="pc-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="absolute inset-0 rounded-xl bg-[var(--dashboard-action-bg)] shadow-sm" />}
                <span className="relative z-10 flex items-center gap-2"><Icon className="h-4 w-4" /> {tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {canCreate && currentAllocation && (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <BalanceMeter allocation={allocationAmount} spent={spentAmount} remaining={remainingAmount} percentage={spendPercentage} />
              <SectionCard title="Your Pending Requests" subtitle="Requests you have raised that are still in review" icon={ClipboardList} iconTone="amber">
                {renderRequestTable(myOpenRequests, false)}
              </SectionCard>
            </div>
          )}
          {canReviewQueue && (
            <SectionCard
              title="Balances by Branch"
              subtitle="Remaining petty cash for each active allocation, per branch & dealership"
              icon={Banknote}
              iconTone="blue"
            >
              {allocationsLoading ? (
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => <div key={`bal-skeleton-${index}`} className="h-28 animate-pulse rounded-2xl bg-slate-50" />)}
                </div>
              ) : allocations.length === 0 ? (
                <EmptyState icon={Banknote} title="No active allocations" description="Funded allocations across branches will appear here once approved." />
              ) : (
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
                  {allocations.map((allocation) => {
                    const allocated = Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
                    const spent = Number(allocation.spentAmount || allocation.spent_amount || 0)
                    const remaining = Number(allocation.remainingAmount ?? (allocated - spent))
                    return (
                      <button
                        key={allocation.id}
                        type="button"
                        onClick={() => setActiveTab('allocations')}
                        className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-black text-slate-800">{allocation.location || getBranchLabel(normalizeBranchId(allocation))}</span>
                          <StatusPill status={allocation.status} />
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-xs font-semibold text-slate-500">{getBranchLabel(normalizeBranchId(allocation))}</p>
                          <DepartmentBadge department={allocation.department} />
                        </div>
                        <p className="mt-3 text-2xl font-black tracking-tight text-emerald-600">{formatCurrency(remaining)}</p>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Remaining</p>
                        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs font-semibold text-slate-500">
                          <span>Allocated {formatCurrency(allocated)}</span>
                          <span className="text-rose-600">Spent {formatCurrency(spent)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </SectionCard>
          )}
          {canReviewQueue && (
            <SectionCard
              title="Pending Approval Queue"
              subtitle="Petty cash requests awaiting your decision"
              icon={ShieldCheck}
              iconTone="violet"
              toolbar={showMdScopeToggle ? <ScopeToggle scope={mdQueueScope} onChange={setMdQueueScope} /> : undefined}
            >
              {renderRequestTable(pendingQueue, true)}
            </SectionCard>
          )}
          {isExpenseFeedRole(userRole) && (
            <SectionCard title={expenseFeedTitle} subtitle={isAllBranchViewer ? 'Recent spends across all branches & dealerships' : 'Recent spends across your branch'} icon={ReceiptText} iconTone="slate">
              {renderExpenseTable(allExpenses)}
            </SectionCard>
          )}
        </div>
      )}

      {activeTab === 'status' && <PettyCashStatusBoard embedded />}

      {activeTab === 'requests' && (
        <SectionCard
          title={canReviewQueue ? 'Pending Approval Queue' : 'Your Requests'}
          subtitle={canReviewQueue ? 'Requests awaiting your decision' : 'All petty cash requests you have raised'}
          icon={ClipboardList}
          iconTone="amber"
          toolbar={showMdScopeToggle && canReviewQueue ? <ScopeToggle scope={mdQueueScope} onChange={setMdQueueScope} /> : undefined}
        >
          {renderRequestTable(canReviewQueue ? pendingQueue : allRequests, canReviewQueue)}
        </SectionCard>
      )}

      {activeTab === 'expenses' && (
        <SectionCard
          title={canCreate ? 'Your Expense History' : expenseFeedTitle}
          subtitle="Spends posted against allocations"
          icon={ReceiptText}
          iconTone="emerald"
          toolbar={canFilterExpensesByLocation ? (
            <div className="flex flex-wrap items-center gap-2">
              <PillFilter label="Location" allLabel="All Locations" value={expenseLocationFilter} options={expenseLocationOptions} onChange={setExpenseLocationFilter} />
              <PillFilter label="Department" allLabel="All Departments" value={expenseDepartmentFilter} options={expenseDepartmentOptions} onChange={setExpenseDepartmentFilter} />
            </div>
          ) : undefined}
        >
          {renderExpenseTable(visibleExpenses)}
        </SectionCard>
      )}

      {activeTab === 'allocations' && (
        <SectionCard
          title="Allocations"
          subtitle={allocationStatusFilter === 'all'
            ? 'Every allocation ever made — newest first. Click a row for its day-by-day spend.'
            : 'Currently open allocations. Switch to All to see past allocations and when they were made.'}
          icon={Banknote}
          iconTone="blue"
          toolbar={(
            <div className="flex flex-wrap items-center gap-2">
              {/* Binary toggle rather than a PillFilter: that component always injects its own
                  "all" option and takes plain strings, which cannot express two named modes. */}
              <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
                {([['active', 'Open only'], ['all', 'All (incl. past)']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAllocationStatusFilter(key)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                      allocationStatusFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <PillFilter label="Location" allLabel="All Locations" value={allocationLocationFilter} options={allocationLocationOptions} onChange={setAllocationLocationFilter} />
              <PillFilter label="Department" allLabel="All Departments" value={allocationDepartmentFilter} options={allocationDepartmentOptions} onChange={setAllocationDepartmentFilter} />
            </div>
          )}
        >
          <RecordTable
            rows={visibleAllocations}
            loading={allocationsLoading}
            rowKey={(allocation) => allocation.id}
            onRowClick={(allocation) => setSpendAllocationId(allocation.id)}
            empty={<EmptyState icon={Banknote} title="No allocations" description="Allocations across branches and dealerships will appear here." />}
            columns={[
              { header: 'Allocated To', cell: (allocation) => <span className="font-bold text-slate-800">{allocation.allocatedToName || '—'}</span> },
              { header: 'Allocated On', cell: (allocation) => (
                <span className="whitespace-nowrap text-xs font-semibold text-slate-600">
                  {formatDateTime(allocation.allocatedAt || allocation.allocated_at || allocation.createdAt || allocation.created_at)}
                </span>
              ) },
              { header: 'Allocated By', cell: (allocation) => <span className="text-slate-600">{allocation.allocatedByName || '—'}</span> },
              { header: 'Branch', cell: (allocation) => <span className="font-bold text-slate-800">{getBranchLabel(normalizeBranchId(allocation))}</span> },
              { header: 'Location', cell: (allocation) => <span className="font-semibold text-slate-700">{allocation.location || '—'}</span> },
              { header: 'Department', cell: (allocation) => <DepartmentBadge department={allocation.department} /> },
              { header: 'Allocation #', cell: (allocation) => <span className="font-mono text-xs font-bold text-slate-500">{allocation.allocationNumber || allocation.allocation_number || '—'}</span> },
              { header: 'Allocated', align: 'right', cell: (allocation) => <span className="font-black tabular-nums text-slate-900">{formatCurrency(allocation.allocatedAmount || allocation.allocated_amount)}</span> },
              { header: 'Spent', align: 'right', cell: (allocation) => <span className="font-black tabular-nums text-rose-600">{formatCurrency(allocation.spentAmount || allocation.spent_amount)}</span> },
              { header: 'Remaining', align: 'right', cell: (allocation) => {
                const rem = Number(allocation.remainingAmount ?? (Number(allocation.allocatedAmount || allocation.allocated_amount || 0) - Number(allocation.spentAmount || allocation.spent_amount || 0)))
                return (
                  <span className={cn('font-black tabular-nums', rem < 0 ? 'text-rose-600 font-extrabold' : 'text-emerald-600')}>
                    {formatCurrency(rem)}
                  </span>
                )
              }},
              { header: 'Spending', cell: (allocation) => {
                const count = Number(allocation.spendCount || 0)
                if (!count) return <span className="text-xs font-semibold text-slate-400">not spent yet</span>
                const first = formatSpendDate(allocation.firstSpendDate)
                const last = formatSpendDate(allocation.lastSpendDate)
                return (
                  <span className="whitespace-nowrap text-xs font-semibold text-slate-600">
                    {count} {count === 1 ? 'entry' : 'entries'}
                    <span className="block text-[10px] font-medium text-slate-400">
                      {first === last ? last : first + ' → ' + last}
                    </span>
                  </span>
                )
              } },
              { header: 'Status', cell: (allocation) => <StatusPill status={allocation.status} /> },
            ]}
          />
        </SectionCard>
      )}

      {activeTab === 'ledger' && (
        <SectionCard
          title="Allocation Ledger"
          subtitle={isAllBranchViewer ? 'Immutable running record of every movement, across all branches' : 'Immutable running record of every movement'}
          icon={Wallet}
          iconTone="blue"
          toolbar={<PillFilter label="Location" allLabel="All Locations" value={ledgerLocationFilter} options={ledgerLocationOptions} onChange={setLedgerLocationFilter} />}
        >
          <RecordTable
            rows={visibleLedger}
            loading={ledgerLoading}
            rowKey={(entry) => entry.id}
            empty={<EmptyState icon={Wallet} title="No ledger entries" description="Ledger movements appear here once an allocation is created or spent." />}
            columns={[
              ...(isAllBranchViewer
                ? [{ header: 'Branch', cell: (entry: PettyCashLedgerEntry) => <span className="font-bold text-slate-800">{getBranchLabel(normalizeBranchId(entry))}</span> }]
                : []),
              { header: 'Type', cell: (entry) => <span className="font-bold capitalize text-slate-800">{ledgerEntryType(entry).replace(/_/g, ' ')}</span> },
              { header: 'Location', cell: (entry) => <span className="font-semibold text-slate-700">{entry.location || '—'}</span> },
              { header: 'Description', cell: (entry) => <span className="line-clamp-1 block max-w-[280px] text-slate-600">{entry.description || '—'}</span> },
              { header: 'Amount', align: 'right', cell: (entry) => <span className={cn('font-black tabular-nums', Number(entry.amount) < 0 ? 'text-rose-600' : 'text-slate-900')}>{formatCurrency(entry.amount)}</span> },
              { header: 'Balance After', align: 'right', cell: (entry) => <span className="font-black tabular-nums text-emerald-600">{formatCurrency(ledgerBalanceAfter(entry))}</span> },
              { header: 'Posted At', align: 'right', cell: (entry) => <span className="text-xs font-semibold text-slate-500">{formatDateTime(entry.createdAt || entry.created_at)}</span> },
            ]}
          />
        </SectionCard>
      )}

      {/* Dialogs */}
      <AllocationSpendDialog allocationId={spendAllocationId} onClose={() => setSpendAllocationId(null)} />
      <RequestFormDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        form={requestForm}
        onChange={updateRequestForm}
        onSubmit={submitRequest}
        submitting={submitting}
        locationOptions={requestLocationOptions}
      />
      <ExpenseFormDialog
        open={expenseDialogOpen}
        onOpenChange={setExpenseDialogOpen}
        form={expenseForm}
        onChange={updateExpenseForm}
        onSubmit={submitExpense}
        submitting={submitting}
        categories={categoryOptions}
        locationOptions={requestLocationOptions}
        allocationNumber={currentAllocation?.allocationNumber || currentAllocation?.allocation_number || ''}
        remainingAmount={remainingAmount}
        expenseFiles={expenseFiles}
        onUpload={uploadExpenseFiles}
        onRemoveFile={(index) => setExpenseFiles((prev) => prev.filter((_, i) => i !== index))}
      />
      <RemarksDialog
        open={workflowDialog !== null}
        onOpenChange={(open) => { if (!open) setWorkflowDialog(null) }}
        title={workflowDialog?.action === 'reject' ? 'Reject Request' : 'Hold Request'}
        description={workflowDialog?.action === 'reject' ? 'Add a reason for rejecting this petty cash request.' : 'Add a note explaining why this request is on hold.'}
        actionLabel={workflowDialog?.action === 'reject' ? 'Reject' : 'Hold'}
        actionVariant={workflowDialog?.action === 'reject' ? 'destructive' : 'default'}
        remarksRequired
        loading={submitting}
        onConfirm={async (remarks) => {
          if (!workflowDialog) return
          const { request, action } = workflowDialog
          setWorkflowDialog(null)
          await applyRequestWorkflow(request.id, stageForRequest(request, userRole), action, remarks)
        }}
      />
      <PettyCashDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} categories={categoryOptions} />
    </div>
  )

  async function handleDeleteRequest(requestId: string) {
    if (!confirm('Are you sure you want to delete this petty cash request?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/petty-cash/requests/${requestId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete request')
      toast({ title: 'Request deleted', variant: 'success' })
      await refreshAfterMutation()
    } catch (err) {
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : 'Try again', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!confirm('Are you sure you want to delete this expense?')) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/petty-cash/expenses/${expenseId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete expense')
      toast({ title: 'Expense deleted', variant: 'success' })
      await refreshAfterMutation()
    } catch (err) {
      toast({ title: 'Could not delete', description: err instanceof Error ? err.message : 'Try again', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  /* ---- table renderers (closures over state/handlers) ---- */
  function renderRequestTable(rows: PettyCashRequest[], withActions: boolean) {
    return (
      <RecordTable
        rows={rows}
        loading={contentLoading}
        rowKey={(request) => request.id}
        onRowClick={(request) => setDetailTarget({ type: 'request', id: request.id, row: request })}
        empty={<EmptyState icon={ClipboardList} title={withActions ? 'Nothing to approve' : 'No requests yet'} description={withActions ? 'Petty cash requests awaiting your approval will appear here.' : 'Raise a request to get a fresh allocation for your branch.'} />}
        columns={[
          { header: 'Request #', cell: (request) => <span className="font-mono text-xs font-bold text-slate-500">{normalizeRequestNumber(request)}</span> },
          { header: 'Requested By', cell: (request) => <span className="font-bold text-slate-800">{requestedByName(request)}</span> },
          { header: 'Department', cell: (request) => <DepartmentBadge department={request.department} /> },
          { header: 'Purpose', cell: (request) => <span className="line-clamp-1 max-w-[220px] text-slate-600">{request.purpose || '—'}</span> },
          { header: 'Amount', align: 'right', cell: (request) => <span className="font-black tabular-nums text-slate-900">{formatCurrency(requestedAmount(request))}</span> },
          ...(withActions
            ? [{
                header: 'Stage',
                cell: (request: PettyCashRequest) => {
                  const stage = pettyCashStageLabel(request.status)
                  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset', stage.className)}>{stage.label}</span>
                },
              }]
            : []),
          { header: 'Status', cell: (request) => <StatusPill status={request.status} /> },
          {
            header: 'Actions',
            align: 'right' as const,
            cell: (request: PettyCashRequest) => (
              <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                {withActions && canActOnRequest(userRole, request) && (
                  <>
                    <button type="button" onClick={() => void applyRequestWorkflow(request.id, stageForRequest(request, userRole), 'approve')} disabled={submitting} className="flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                    <button type="button" onClick={() => setWorkflowDialog({ request, action: 'hold' })} disabled={submitting} className="flex h-8 items-center gap-1 rounded-lg border border-amber-200 px-2.5 text-xs font-bold text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-50">
                      <PauseCircle className="h-3.5 w-3.5" /> Hold
                    </button>
                    <button type="button" onClick={() => setWorkflowDialog({ request, action: 'reject' })} disabled={submitting} className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-50">
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteRequest(request.id)}
                  disabled={submitting}
                  title="Delete request"
                  className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            ),
          },
        ]}
      />
    )
  }

  function renderExpenseTable(rows: import('./types').PettyCashExpense[]) {
    return (
      <RecordTable
        rows={rows}
        loading={contentLoading}
        rowKey={(expense) => expense.id}
        onRowClick={(expense) => setDetailTarget({ type: 'expense', id: expense.id, row: expense })}
        empty={<EmptyState icon={ReceiptText} title="No expenses yet" description="Posted spends will appear here with their running status." />}
        columns={[
          { header: 'Expense #', cell: (expense) => <span className="font-mono text-xs font-bold text-slate-500">{normalizeExpenseNumber(expense)}</span> },
          { header: 'Date', cell: (expense) => <span className="text-slate-600">{formatDateTime(expenseDate(expense))}</span> },
          ...(canFilterExpensesByLocation ? [{ header: 'Location', cell: (expense: import('./types').PettyCashExpense) => <span className="font-semibold text-slate-700">{expense.location || '—'}</span> }] : []),
          { header: 'Department', cell: (expense) => <DepartmentBadge department={expense.department} /> },
          { header: 'Description', cell: (expense) => <span className="line-clamp-1 max-w-[220px] text-slate-600">{expense.particulars || expense.purpose || '—'}</span> },
          { header: 'Vendor', cell: (expense) => <span className="text-slate-600">{expenseVendor(expense)}</span> },
          { header: 'Amount', align: 'right', cell: (expense) => <span className="font-black tabular-nums text-slate-900">{formatCurrency(expense.amount)}</span> },
          { header: 'Status', cell: (expense) => <StatusPill status={expense.status} /> },
        ]}
      />
    )
  }
}

function PillFilter({ label, allLabel, value, options, onChange }: { label: string; allLabel: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none focus:border-slate-400"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  )
}

// Department badge — Sales / Service colour-coded so the department reads at a glance in tables.
function DepartmentBadge({ department }: { department?: string | null }) {
  const value = (department || '').trim()
  if (!value) return <span className="text-slate-400">—</span>
  const tone = /service/i.test(value)
    ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : /sales/i.test(value)
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : 'bg-slate-100 text-slate-600 ring-slate-200'
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ring-inset', tone)}>{value}</span>
}

function ScopeToggle({ scope, onChange }: { scope: 'all' | 'mine'; onChange: (scope: 'all' | 'mine') => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-0.5">
      {(['all', 'mine'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors', scope === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          {value === 'all' ? 'All Branches' : 'My Branch'}
        </button>
      ))}
    </div>
  )
}
