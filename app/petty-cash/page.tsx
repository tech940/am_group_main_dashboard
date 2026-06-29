'use client'

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Banknote,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  PauseCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { RemarksDialog } from '@/components/purchase-orders/remarks-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getBranchLabel } from '@/lib/branches'
import {
  PETTY_CASH_DEPARTMENT_OPTIONS,
  PETTY_CASH_KIA_LOCATION_OPTIONS,
  PETTY_CASH_PAYMENT_TYPES,
  getPettyCashStatusLabel,
} from '@/lib/petty-cash/constants'

type PettyCashUser = {
  id: string
  role: string
  brand: string | null
  fullName: string
  email: string
}

type PettyCashCategory = {
  id: string
  name: string
  slug: string
}

type PettyCashAllocation = {
  id: string
  allocationNumber: string
  allocation_number?: string
  branchId: string
  branch_id?: string
  allocatedAmount: string
  allocated_amount?: string
  spentAmount: string
  spent_amount?: string
  remainingAmount?: string
  status: string
  allocatedAt: string
  allocated_at?: string
}

type PettyCashRequest = {
  id: string
  requestNumber: string
  request_number?: string
  branchId: string
  branch_id?: string
  status: string
  currentStage: string
  current_stage?: string
  requestedByName: string
  requested_by_name?: string
  requestedAmount: string
  requested_amount?: string
  purpose: string
  department?: string | null
  createdAt: string
  created_at?: string
}

type PettyCashExpense = {
  id: string
  expenseNumber: string
  expense_number?: string
  allocationId: string
  allocation_id?: string
  branchId: string
  branch_id?: string
  status: string
  currentStage: string
  current_stage?: string
  expenseDate: string
  expense_date?: string
  particulars: string
  amount: string
  vendorName?: string | null
  vendor_name?: string | null
  receivedBy?: string | null
  received_by?: string | null
  purpose: string
  createdAt: string
  created_at?: string
}

type PettyCashLedgerEntry = {
  id: string
  entryType: string
  entry_type?: string
  amount: string
  balanceAfter: string
  balance_after?: string
  description: string
  createdAt: string
  created_at?: string
}

type DashboardPayload = {
  user: PettyCashUser
  categories: PettyCashCategory[]
  currentAllocation: PettyCashAllocation | null
  requests: PettyCashRequest[]
  expenses: PettyCashExpense[]
  summary: {
    allocationAmount: number
    spentAmount: number
    remainingAmount: number
    canRequestTopUp: boolean
    canSubmitExpense: boolean
    topUpThreshold: number
    topUpReason: string
    pendingRequestCount: number
    pendingExpenseCount: number
    requestCount: number
    expenseCount: number
  }
}

type RequestFormState = {
  location: string
  department: string
  advanceType: string
  requestedAmount: string
  typeOfPayment: string
  purpose: string
}

type ExpenseFormState = {
  allocationId: string
  expenseDate: string
  categoryId: string
  amount: string
  vendorName: string
  receivedBy: string
  purpose: string
}

type RequestWorkflowDialogState = {
  request: PettyCashRequest
  action: 'reject' | 'hold'
} | null

const EMPTY_REQUEST_FORM: RequestFormState = {
  location: '',
  department: '',
  advanceType: '',
  requestedAmount: '',
  typeOfPayment: '',
  purpose: '',
}

const EMPTY_EXPENSE_FORM: ExpenseFormState = {
  allocationId: '',
  expenseDate: new Date().toLocaleDateString('en-CA'),
  categoryId: '',
  amount: '',
  vendorName: '',
  receivedBy: '',
  purpose: '',
}

const PETTY_CASH_FETCH_TIMEOUT_MS = process.env.NODE_ENV === 'development' ? 60000 : 25000
const PETTY_CASH_FETCH_RETRY_ATTEMPTS = process.env.NODE_ENV === 'development' ? 2 : 1

function isCreatorRole(role: string) {
  return role === 'admin' || role === 'branch_admin'
}

function isApproverRole(role: string) {
  return role === 'ea' || role === 'md' || role === 'accounts'
}

function isExpenseFeedRole(role: string) {
  return role === 'ea' || role === 'md' || role === 'accounts' || role === 'super_admin'
}

async function fetchJsonWithTimeout<T>(url: string, label: string) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= PETTY_CASH_FETCH_RETRY_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), PETTY_CASH_FETCH_TIMEOUT_MS)

    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
      const result = await response.json().catch(() => null)

      if (!response.ok) {
        const errorMessage = result && typeof result === 'object' && 'error' in result
          ? String(result.error)
          : `Unable to load ${label}`
        throw new Error(errorMessage)
      }

      return result as T
    } catch (fetchError) {
      lastError = fetchError
      const aborted = fetchError instanceof DOMException && fetchError.name === 'AbortError'

      if (!aborted || attempt >= PETTY_CASH_FETCH_RETRY_ATTEMPTS) {
        if (aborted) {
          throw new Error(`${label} timed out after ${Math.round(PETTY_CASH_FETCH_TIMEOUT_MS / 1000)} seconds`)
        }

        throw fetchError
      }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Unable to load ${label}`)
}

function formatCurrency(value: string | number | null | undefined) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date)
}

function normalizeRequestNumber(request: PettyCashRequest) {
  return request.requestNumber || request.request_number || 'PCR'
}

function normalizeExpenseNumber(expense: PettyCashExpense) {
  return expense.expenseNumber || expense.expense_number || 'PCE'
}

function normalizeBranchId(item: { branchId?: string; branch_id?: string }) {
  return item.branchId || item.branch_id || ''
}

function normalizeAllocatedAmount(allocation: PettyCashAllocation | null) {
  return allocation?.allocatedAmount || allocation?.allocated_amount || '0'
}

function normalizeSpentAmount(allocation: PettyCashAllocation | null) {
  return allocation?.spentAmount || allocation?.spent_amount || '0'
}

function getStatusVariant(status: string) {
  if (status.includes('rejected') || status === 'rejected') return 'destructive'
  if (status === 'approved' || status === 'active') return 'success'
  if (status.includes('pending') || status.includes('on_hold') || status === 'pending') return 'warning'
  return 'secondary'
}

function canActOnRequest(userRole: string, request: PettyCashRequest) {
  return (userRole === 'ea' && ['ea_pending', 'ea_on_hold'].includes(request.status))
    || (userRole === 'md' && ['md_pending', 'md_on_hold'].includes(request.status))
    || (userRole === 'accounts' && ['accounts_pending', 'accounts_on_hold'].includes(request.status))
}

function stageForRequest(request: PettyCashRequest) {
  if (['ea_pending', 'ea_on_hold'].includes(request.status)) return 'ea_approval'
  if (['md_pending', 'md_on_hold'].includes(request.status)) return 'md_approval'
  return 'accounts'
}

function getUploadedFileName(fileUrl: string) {
  try {
    const pathname = new URL(fileUrl).pathname
    return decodeURIComponent(pathname.split('/').pop() || 'Uploaded file')
  } catch {
    return fileUrl.split('/').pop() || 'Uploaded file'
  }
}

function isPreviewableImage(fileUrl: string) {
  return /\.(png|jpe?g|webp|gif|heic|heif)(\?|$)/i.test(fileUrl)
}

function PettyCashPageContent() {
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [ledger, setLedger] = useState<PettyCashLedgerEntry[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'expenses' | 'ledger'>('overview')
  const [requestForm, setRequestForm] = useState<RequestFormState>(EMPTY_REQUEST_FORM)
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(EMPTY_EXPENSE_FORM)
  const [expenseFiles, setExpenseFiles] = useState<string[]>([])
  const [requestDialogOpen, setRequestDialogOpen] = useState(false)
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false)
  const [requestWorkflowDialog, setRequestWorkflowDialog] = useState<RequestWorkflowDialogState>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const dashboard = await fetchJsonWithTimeout<DashboardPayload>('/api/petty-cash', 'Petty Cash dashboard')
      setPayload(dashboard)

      void fetchJsonWithTimeout<{ ledger: PettyCashLedgerEntry[] }>('/api/petty-cash/reports', 'Petty Cash ledger')
        .then((ledgerPayload) => setLedger(ledgerPayload.ledger || []))
        .catch((ledgerError) => {
          console.warn('Petty Cash ledger load failed', ledgerError)
          setLedger([])
        })

      setExpenseForm((current) => ({
        ...current,
        allocationId: dashboard.currentAllocation?.id || '',
      }))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load Petty Cash')
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshLedger = useCallback(async () => {
    try {
      const ledgerPayload = await fetchJsonWithTimeout<{ ledger: PettyCashLedgerEntry[] }>('/api/petty-cash/reports', 'Petty Cash ledger')
      setLedger(ledgerPayload.ledger || [])
    } catch (ledgerError) {
      console.warn('Petty Cash ledger refresh failed', ledgerError)
      setLedger([])
    }
  }, [])

  const refreshDashboardAfterMutation = useCallback(async () => {
    setError(null)

    try {
      const dashboard = await fetchJsonWithTimeout<DashboardPayload>('/api/petty-cash', 'Petty Cash dashboard')
      setPayload(dashboard)
      setExpenseForm((current) => ({
        ...current,
        allocationId: dashboard.currentAllocation?.id || '',
      }))
      void refreshLedger()
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to refresh Petty Cash')
    }
  }, [refreshLedger])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadDashboard])

  const currentAllocation = payload?.currentAllocation || null
  const allocationAmount = Number(normalizeAllocatedAmount(currentAllocation))
  const spentAmount = Number(normalizeSpentAmount(currentAllocation))
  const remainingAmount = payload?.summary.remainingAmount ?? Math.max(0, allocationAmount - spentAmount)
  const spendPercentage = allocationAmount > 0 ? Math.min(100, Math.round((spentAmount / allocationAmount) * 100)) : 0
  const userRole = payload?.user.role || ''
  const canCreate = isCreatorRole(userRole)
  const canRequestTopUp = payload?.summary.canRequestTopUp ?? true
  const canSubmitExpense = payload?.summary.canSubmitExpense ?? false
  const topUpReason = payload?.summary.topUpReason || ''
  const categoryOptions = payload?.categories || []
  const visibleRequests = useMemo(() => payload?.requests || [], [payload?.requests])
  const visibleExpenses = useMemo(() => payload?.expenses || [], [payload?.expenses])
  const expenseFeedTitle = userRole === 'accounts' ? 'Branch Expense Ledger Feed' : 'Recent Branch Expenses'

  const uploadExpenseFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const uploaded: string[] = []
    for (const file of Array.from(files)) {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entity', 'expense')
      const response = await fetch('/api/petty-cash/upload', {
        method: 'POST',
        body: formData,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Upload failed for ${file.name}`)
      uploaded.push(result.url)
    }

    setExpenseFiles((current) => [...current, ...uploaded])
  }, [])

  async function submitRequest() {
    if (!canRequestTopUp) {
      setError(topUpReason || 'Petty cash top-up is not available yet')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/petty-cash/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedAmount: requestForm.requestedAmount,
          purpose: requestForm.purpose,
          department: requestForm.department || null,
          requestForm: {
            location: requestForm.location || null,
            department: requestForm.department || null,
            advanceType: requestForm.advanceType || null,
            typeOfPayment: requestForm.typeOfPayment || null,
          },
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Request submission failed')

      setRequestForm(EMPTY_REQUEST_FORM)
      setRequestDialogOpen(false)
      await refreshDashboardAfterMutation()
      setActiveTab('requests')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Request submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitExpense() {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/petty-cash/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationId: expenseForm.allocationId || currentAllocation?.id,
          expenseDate: expenseForm.expenseDate,
          categoryId: expenseForm.categoryId || null,
          amount: expenseForm.amount,
          vendorName: expenseForm.vendorName || null,
          receivedBy: expenseForm.receivedBy || null,
          purpose: expenseForm.purpose,
          expenseForm: {
            date: expenseForm.expenseDate,
            vendorName: expenseForm.vendorName || null,
            receivedBy: expenseForm.receivedBy || null,
            purposeOfExpense: expenseForm.purpose,
            uploadBillUrls: expenseFiles,
          },
          billFiles: expenseFiles,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Expense submission failed')

      setExpenseForm({
        ...EMPTY_EXPENSE_FORM,
        allocationId: currentAllocation?.id || '',
      })
      setExpenseFiles([])
      setExpenseDialogOpen(false)
      await refreshDashboardAfterMutation()
      setActiveTab('expenses')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Expense submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function applyRequestWorkflow(id: string, stage: string, action: 'approve' | 'reject' | 'hold', remarks = '') {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch(`/api/petty-cash/requests/${id}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, action, remarks }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Workflow update failed')
      await refreshDashboardAfterMutation()
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : 'Workflow update failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex min-h-[70vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
        </div>
      </MainLayout>
    )
  }

  if (!payload) {
    return (
      <MainLayout>
        <div className="mx-auto max-w-3xl rounded-[32px] border border-red-100 bg-red-50 p-8 text-red-700">
          {error || 'Petty Cash could not be loaded.'}
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="min-h-screen space-y-6 bg-[radial-gradient(circle_at_top_left,#ecfeff,transparent_32%),linear-gradient(135deg,#f8fafc,#eef2ff)] p-4 md:p-8">
        <div className="flex flex-col gap-4 rounded-[36px] border border-white/80 bg-white/85 p-6 shadow-2xl shadow-slate-200/70 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-3xl bg-slate-950 p-4 text-white shadow-xl">
              <Banknote className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-teal-700">Branch finance control</p>
              <h1 className="mt-1 text-4xl font-black tracking-tight text-slate-950">Petty Cash</h1>
              <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-500">
                Branch-scoped request approval, live allocation tracking, direct expense posting, and an immutable ledger.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['overview', 'requests', 'expenses', 'ledger'] as const).map((tab) => (
              <Button
                key={tab}
                type="button"
                variant={activeTab === tab ? 'default' : 'outline'}
                onClick={() => setActiveTab(tab)}
                className={`rounded-2xl font-black capitalize ${activeTab === tab ? 'bg-slate-950 text-white hover:bg-slate-800' : 'bg-white/70'}`}
              >
                {tab}
              </Button>
            ))}
            <Button type="button" variant="outline" onClick={loadDashboard} className="rounded-2xl bg-white/70 font-black">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        )}

        <RemarksDialog
          open={Boolean(requestWorkflowDialog)}
          onOpenChange={(open) => {
            if (!open) setRequestWorkflowDialog(null)
          }}
          title={requestWorkflowDialog?.action === 'hold' ? 'Hold Petty Cash Request' : 'Reject Petty Cash Request'}
          description={requestWorkflowDialog?.action === 'hold'
            ? 'Add an optional reason so the requester understands what needs attention.'
            : 'Add optional rejection remarks for the requester.'}
          actionLabel={requestWorkflowDialog?.action === 'hold' ? 'Put On Hold' : 'Reject Request'}
          actionVariant={requestWorkflowDialog?.action === 'reject' ? 'destructive' : 'default'}
          loading={submitting}
          remarksRequired={false}
          onConfirm={async (remarks) => {
            if (!requestWorkflowDialog) return
            await applyRequestWorkflow(
              requestWorkflowDialog.request.id,
              stageForRequest(requestWorkflowDialog.request),
              requestWorkflowDialog.action,
              remarks,
            )
            setRequestWorkflowDialog(null)
          }}
        />

        <RequestFormDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
          requestForm={requestForm}
          setRequestForm={setRequestForm}
          submitting={submitting}
          onSubmit={submitRequest}
        />

        <ExpenseFormDialog
          open={expenseDialogOpen}
          onOpenChange={setExpenseDialogOpen}
          currentAllocation={currentAllocation}
          categoryOptions={categoryOptions}
          expenseForm={expenseForm}
          setExpenseForm={setExpenseForm}
          expenseFiles={expenseFiles}
          setExpenseFiles={setExpenseFiles}
          uploadExpenseFiles={uploadExpenseFiles}
          setError={setError}
          submitting={submitting}
          onSubmit={submitExpense}
        />

        {canCreate && !canRequestTopUp && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50/95 px-5 py-4 text-sm font-bold text-amber-900 shadow-sm">
            {topUpReason}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="Current Allocation"
            value={formatCurrency(allocationAmount)}
            meta={currentAllocation ? getBranchLabel(normalizeBranchId(currentAllocation)) : 'No active allocation'}
            icon={<ShieldCheck className="h-5 w-5 text-teal-600" />}
          />
          <SummaryCard
            title="Remaining"
            value={formatCurrency(remainingAmount)}
            meta={`${spendPercentage}% of allocation used`}
            icon={<Banknote className="h-5 w-5 text-emerald-600" />}
            accentValueClass="text-emerald-700"
          />
          <SummaryCard
            title="Spent"
            value={formatCurrency(spentAmount)}
            meta="Live deducted from active allocation"
            icon={<TrendingDown className="h-5 w-5 text-orange-600" />}
          />
          <SummaryCard
            title="Pending Requests"
            value={String(payload.summary.pendingRequestCount)}
            meta={isApproverRole(userRole) ? 'Awaiting your stage action' : 'Your live request queue'}
            icon={<Clock3 className="h-5 w-5 text-blue-600" />}
          />
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {canCreate && (
              <Card className="rounded-[32px] border-white/80 bg-white/92 shadow-xl shadow-slate-200/60">
                <CardHeader>
                  <CardTitle className="text-2xl font-black text-slate-950">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 md:flex-row">
                  <Button
                    type="button"
                    disabled={submitting || !canRequestTopUp}
                    onClick={() => setRequestDialogOpen(true)}
                    className="rounded-2xl bg-slate-950 px-6 py-6 font-black text-white hover:bg-slate-800"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Petty Cash Request
                  </Button>
                  <Button
                    type="button"
                    disabled={submitting || !canSubmitExpense}
                    onClick={() => setExpenseDialogOpen(true)}
                    className="rounded-2xl bg-teal-700 px-6 py-6 font-black text-white hover:bg-teal-800"
                  >
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Submit Expense
                  </Button>
                </CardContent>
              </Card>
            )}

            {canCreate && (
              <RecordTable
                title="Your Pending Requests"
                emptyText="No pending petty cash requests found."
                headers={['Request #', 'Branch', 'Requested By', 'Purpose', 'Amount', 'Status', 'Created']}
                rows={visibleRequests}
                renderRow={(request) => (
                  <tr key={request.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-black text-slate-950">{normalizeRequestNumber(request)}</td>
                    <td className="px-4 py-3">{getBranchLabel(normalizeBranchId(request))}</td>
                    <td className="px-4 py-3">{request.requestedByName || request.requested_by_name}</td>
                    <td className="px-4 py-3">{request.purpose}</td>
                    <td className="px-4 py-3 font-black">{formatCurrency(request.requestedAmount || request.requested_amount)}</td>
                    <td className="px-4 py-3"><Badge variant={getStatusVariant(request.status)}>{getPettyCashStatusLabel(request.status)}</Badge></td>
                    <td className="px-4 py-3">{formatDateTime(request.createdAt || request.created_at)}</td>
                  </tr>
                )}
              />
            )}

            {canCreate && (
              <RecordTable
                title="Your Expense History"
                emptyText="No petty cash expenses posted yet."
                headers={['Expense #', 'Date', 'Description', 'Vendor', 'Amount', 'Posted At']}
                rows={visibleExpenses}
                renderRow={(expense) => (
                  <tr key={expense.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-black text-slate-950">{normalizeExpenseNumber(expense)}</td>
                    <td className="px-4 py-3">{expense.expenseDate || expense.expense_date}</td>
                    <td className="px-4 py-3">{expense.particulars || expense.purpose}</td>
                    <td className="px-4 py-3">{expense.vendorName || expense.vendor_name || 'N/A'}</td>
                    <td className="px-4 py-3 font-black">{formatCurrency(expense.amount)}</td>
                    <td className="px-4 py-3">{formatDateTime(expense.createdAt || expense.created_at)}</td>
                  </tr>
                )}
              />
            )}

            {isApproverRole(userRole) && (
              <RecordTable
                title="Pending Approval Queue"
                emptyText="No petty cash requests are waiting for your approval."
                headers={['Request #', 'Branch', 'Requested By', 'Purpose', 'Amount', 'Status', 'Actions']}
                rows={visibleRequests}
                renderRow={(request) => (
                  <tr key={request.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-black text-slate-950">{normalizeRequestNumber(request)}</td>
                    <td className="px-4 py-3">{getBranchLabel(normalizeBranchId(request))}</td>
                    <td className="px-4 py-3">{request.requestedByName || request.requested_by_name}</td>
                    <td className="px-4 py-3">{request.purpose}</td>
                    <td className="px-4 py-3 font-black">{formatCurrency(request.requestedAmount || request.requested_amount)}</td>
                    <td className="px-4 py-3"><Badge variant={getStatusVariant(request.status)}>{getPettyCashStatusLabel(request.status)}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      {canActOnRequest(userRole, request) && (
                        <ActionButtons
                          onApprove={() => applyRequestWorkflow(request.id, stageForRequest(request), 'approve')}
                          onHold={() => setRequestWorkflowDialog({ request, action: 'hold' })}
                          onReject={() => setRequestWorkflowDialog({ request, action: 'reject' })}
                          disabled={submitting}
                        />
                      )}
                    </td>
                  </tr>
                )}
              />
            )}

            {isExpenseFeedRole(userRole) && (
              <RecordTable
                title={expenseFeedTitle}
                emptyText="No petty cash expenses found for this feed."
                headers={['Expense #', 'Branch', 'Date', 'Description', 'Vendor', 'Amount', 'Status']}
                rows={visibleExpenses}
                renderRow={(expense) => (
                  <tr key={expense.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-black text-slate-950">{normalizeExpenseNumber(expense)}</td>
                    <td className="px-4 py-3">{getBranchLabel(normalizeBranchId(expense))}</td>
                    <td className="px-4 py-3">{expense.expenseDate || expense.expense_date}</td>
                    <td className="px-4 py-3">{expense.particulars || expense.purpose}</td>
                    <td className="px-4 py-3">{expense.vendorName || expense.vendor_name || 'N/A'}</td>
                    <td className="px-4 py-3 font-black">{formatCurrency(expense.amount)}</td>
                    <td className="px-4 py-3"><Badge variant={getStatusVariant(expense.status)}>{getPettyCashStatusLabel(expense.status)}</Badge></td>
                  </tr>
                )}
              />
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <RecordTable
            title={isApproverRole(userRole) ? 'Pending Approval Queue' : 'Petty Cash Requests'}
            emptyText={isApproverRole(userRole)
              ? 'No petty cash requests are waiting for your approval.'
              : 'No petty cash requests found.'}
            headers={['Request #', 'Branch', 'Requested By', 'Purpose', 'Amount', 'Status', 'Actions']}
            rows={visibleRequests}
            renderRow={(request) => (
              <tr key={request.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-black text-slate-950">{normalizeRequestNumber(request)}</td>
                <td className="px-4 py-3">{getBranchLabel(normalizeBranchId(request))}</td>
                <td className="px-4 py-3">{request.requestedByName || request.requested_by_name}</td>
                <td className="px-4 py-3">{request.purpose}</td>
                <td className="px-4 py-3 font-black">{formatCurrency(request.requestedAmount || request.requested_amount)}</td>
                <td className="px-4 py-3"><Badge variant={getStatusVariant(request.status)}>{getPettyCashStatusLabel(request.status)}</Badge></td>
                <td className="px-4 py-3 text-right">
                  {canActOnRequest(userRole, request) && (
                    <ActionButtons
                      onApprove={() => applyRequestWorkflow(request.id, stageForRequest(request), 'approve')}
                      onHold={() => setRequestWorkflowDialog({ request, action: 'hold' })}
                      onReject={() => setRequestWorkflowDialog({ request, action: 'reject' })}
                      disabled={submitting}
                    />
                  )}
                </td>
              </tr>
            )}
          />
        )}

        {activeTab === 'expenses' && (
          <RecordTable
            title={canCreate ? 'Your Expense History' : expenseFeedTitle}
            emptyText="No petty cash expenses found."
            headers={['Expense #', 'Branch', 'Date', 'Description', 'Vendor', 'Amount', 'Status']}
            rows={visibleExpenses}
            renderRow={(expense) => (
              <tr key={expense.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-black text-slate-950">{normalizeExpenseNumber(expense)}</td>
                <td className="px-4 py-3">{getBranchLabel(normalizeBranchId(expense))}</td>
                <td className="px-4 py-3">{expense.expenseDate || expense.expense_date}</td>
                <td className="px-4 py-3">{expense.particulars || expense.purpose}</td>
                <td className="px-4 py-3">{expense.vendorName || expense.vendor_name || 'N/A'}</td>
                <td className="px-4 py-3 font-black">{formatCurrency(expense.amount)}</td>
                <td className="px-4 py-3"><Badge variant={getStatusVariant(expense.status)}>{getPettyCashStatusLabel(expense.status)}</Badge></td>
              </tr>
            )}
          />
        )}

        {activeTab === 'ledger' && (
          <RecordTable
            title="Allocation Ledger"
            emptyText="No ledger entries found."
            headers={['Type', 'Description', 'Amount', 'Balance After', 'Posted At']}
            rows={ledger}
            renderRow={(entry) => (
              <tr key={entry.id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-black capitalize">{(entry.entryType || entry.entry_type || '').replace(/_/g, ' ')}</td>
                <td className="px-4 py-3">{entry.description}</td>
                <td className="px-4 py-3 font-black">{formatCurrency(entry.amount)}</td>
                <td className="px-4 py-3 font-black text-emerald-700">{formatCurrency(entry.balanceAfter || entry.balance_after)}</td>
                <td className="px-4 py-3">{formatDateTime(entry.createdAt || entry.created_at)}</td>
              </tr>
            )}
          />
        )}
      </div>
    </MainLayout>
  )
}

function SummaryCard({
  title,
  value,
  meta,
  icon,
  accentValueClass,
}: {
  title: string
  value: string
  meta: string
  icon: ReactNode
  accentValueClass?: string
}) {
  return (
    <Card className="rounded-[28px] border-white/80 bg-white/90 shadow-xl shadow-slate-200/60">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{title}</p>
          {icon}
        </div>
        <p className={`mt-4 text-3xl font-black text-slate-950 ${accentValueClass || ''}`}>{value}</p>
        <p className="mt-1 text-sm font-semibold text-slate-500">{meta}</p>
      </CardContent>
    </Card>
  )
}

function RequestFormDialog({
  open,
  onOpenChange,
  requestForm,
  setRequestForm,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  requestForm: RequestFormState
  setRequestForm: React.Dispatch<React.SetStateAction<RequestFormState>>
  submitting: boolean
  onSubmit: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[32px] border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[760px]">
        <div className="bg-gradient-to-r from-slate-950 to-slate-800 px-6 py-5 text-white">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-2xl font-black text-white">New Petty Cash Request</DialogTitle>
            <DialogDescription className="text-sm text-slate-200">
              Request petty cash for your logged-in branch. Branch and requester identity are pulled automatically from your login.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
          <Field label="Location">
            <Select value={requestForm.location} onValueChange={(location) => setRequestForm((current) => ({ ...current, location }))}>
              <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {PETTY_CASH_KIA_LOCATION_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Department">
            <Select value={requestForm.department} onValueChange={(department) => setRequestForm((current) => ({ ...current, department }))}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {PETTY_CASH_DEPARTMENT_OPTIONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Advance Type">
            <Input
              value={requestForm.advanceType}
              onChange={(event) => setRequestForm((current) => ({ ...current, advanceType: event.target.value }))}
              placeholder="Enter advance type"
            />
          </Field>
          <Field label="Payment Type">
            <Select value={requestForm.typeOfPayment} onValueChange={(typeOfPayment) => setRequestForm((current) => ({ ...current, typeOfPayment }))}>
              <SelectTrigger><SelectValue placeholder="Select payment type" /></SelectTrigger>
              <SelectContent>
                {PETTY_CASH_PAYMENT_TYPES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              value={requestForm.requestedAmount}
              onChange={(event) => setRequestForm((current) => ({ ...current, requestedAmount: event.target.value }))}
            />
          </Field>
          <Field label="Purpose" className="md:col-span-2">
            <Textarea
              value={requestForm.purpose}
              onChange={(event) => setRequestForm((current) => ({ ...current, purpose: event.target.value }))}
              rows={5}
            />
          </Field>
        </div>
        <DialogFooter className="gap-2 border-t border-slate-200 px-6 py-5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-2xl" disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()} className="rounded-2xl bg-slate-950 font-black text-white hover:bg-slate-800" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExpenseFormDialog({
  open,
  onOpenChange,
  currentAllocation,
  categoryOptions,
  expenseForm,
  setExpenseForm,
  expenseFiles,
  setExpenseFiles,
  uploadExpenseFiles,
  setError,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAllocation: PettyCashAllocation | null
  categoryOptions: PettyCashCategory[]
  expenseForm: ExpenseFormState
  setExpenseForm: React.Dispatch<React.SetStateAction<ExpenseFormState>>
  expenseFiles: string[]
  setExpenseFiles: React.Dispatch<React.SetStateAction<string[]>>
  uploadExpenseFiles: (files: FileList | null) => Promise<void>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  submitting: boolean
  onSubmit: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-[32px] border border-slate-200 bg-white p-0 shadow-2xl sm:max-w-[760px]">
        <div className="bg-gradient-to-r from-teal-700 to-teal-800 px-6 py-5 text-white">
          <DialogHeader className="space-y-2 text-left">
            <DialogTitle className="text-2xl font-black text-white">Submit Expense</DialogTitle>
            <DialogDescription className="text-sm text-teal-50">
              Post a petty-cash expense directly against your active allocation. The amount is deducted immediately and visible to EA and MD.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="grid gap-4 px-6 py-6 md:grid-cols-2">
          <Field label="Active Allocation">
            <Input value={currentAllocation?.allocationNumber || 'No active allocation'} disabled />
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              value={expenseForm.amount}
              onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))}
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={expenseForm.expenseDate}
              onChange={(event) => setExpenseForm((current) => ({ ...current, expenseDate: event.target.value }))}
            />
          </Field>
          <Field label="Category">
            <Select
              disabled={categoryOptions.length === 0}
              value={expenseForm.categoryId || undefined}
              onValueChange={(categoryId) => setExpenseForm((current) => ({ ...current, categoryId }))}
            >
              <SelectTrigger><SelectValue placeholder={categoryOptions.length === 0 ? 'No categories available' : 'Optional category'} /></SelectTrigger>
              <SelectContent>
                {categoryOptions.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Vendor Name">
            <Input
              value={expenseForm.vendorName}
              onChange={(event) => setExpenseForm((current) => ({ ...current, vendorName: event.target.value }))}
            />
          </Field>
          <Field label="Received By">
            <Input
              value={expenseForm.receivedBy}
              onChange={(event) => setExpenseForm((current) => ({ ...current, receivedBy: event.target.value }))}
            />
          </Field>
          <Field label="Purpose of Expense" className="md:col-span-2">
            <Textarea
              value={expenseForm.purpose}
              onChange={(event) => setExpenseForm((current) => ({ ...current, purpose: event.target.value }))}
              rows={5}
            />
          </Field>
          <Field label="Upload Bill" className="md:col-span-2">
            <Input
              type="file"
              multiple
              onChange={(event) => uploadExpenseFiles(event.target.files).catch((uploadError) => setError(uploadError.message))}
            />
            <UploadedFileList files={expenseFiles} onRemove={(index) => setExpenseFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
          </Field>
        </div>
        <DialogFooter className="gap-2 border-t border-slate-200 px-6 py-5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-2xl" disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSubmit()} className="rounded-2xl bg-teal-700 font-black text-white hover:bg-teal-800" disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
            Submit Expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</Label>
      {children}
    </div>
  )
}

function UploadedFileList({ files, onRemove }: { files: string[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {files.map((fileUrl, index) => (
        <div key={`${fileUrl}-${index}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
          {isPreviewableImage(fileUrl) ? (
            <div className="h-14 w-14 rounded-xl bg-cover bg-center ring-1 ring-slate-200" style={{ backgroundImage: `url(${fileUrl})` }} aria-label="Uploaded image preview" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
              <FileText className="h-5 w-5" />
            </div>
          )}
          <a href={fileUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs font-black text-slate-700 underline-offset-4 hover:underline">
            {getUploadedFileName(fileUrl)}
          </a>
          <Button type="button" variant="outline" size="sm" onClick={() => onRemove(index)} className="rounded-xl border-red-200 px-3 text-red-700 hover:bg-red-50">
            Remove
          </Button>
        </div>
      ))}
    </div>
  )
}

function ActionButtons({
  onApprove,
  onHold,
  onReject,
  disabled,
}: {
  onApprove: () => void
  onHold: () => void
  onReject: () => void
  disabled: boolean
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" size="sm" disabled={disabled} onClick={onApprove} className="rounded-xl bg-emerald-600 font-black text-white hover:bg-emerald-700">
        <CheckCircle2 className="mr-1 h-4 w-4" />
        Approve
      </Button>
      <Button type="button" size="sm" disabled={disabled} variant="outline" onClick={onHold} className="rounded-xl border-amber-200 font-black text-amber-700 hover:bg-amber-50">
        <PauseCircle className="mr-1 h-4 w-4" />
        Hold
      </Button>
      <Button type="button" size="sm" disabled={disabled} variant="outline" onClick={onReject} className="rounded-xl border-red-200 font-black text-red-700 hover:bg-red-50">
        <XCircle className="mr-1 h-4 w-4" />
        Reject
      </Button>
    </div>
  )
}

function RecordTable<T>({
  title,
  emptyText,
  headers,
  rows,
  renderRow,
}: {
  title: string
  emptyText: string
  headers: string[]
  rows: T[]
  renderRow: (row: T) => ReactNode
}) {
  return (
    <Card className="rounded-[32px] border-white/80 bg-white/92 shadow-xl shadow-slate-200/60">
      <CardHeader>
        <CardTitle className="text-2xl font-black text-slate-950">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
            {emptyText}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {headers.map((header) => (
                    <th key={header} className="px-4 py-3">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows.map(renderRow)}</tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function PettyCashPage() {
  return (
    <Suspense fallback={<MainLayout><div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div></MainLayout>}>
      <PettyCashPageContent />
    </Suspense>
  )
}
