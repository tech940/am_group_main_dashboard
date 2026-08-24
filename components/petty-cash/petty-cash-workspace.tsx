'use client'

/* eslint-disable react-hooks/set-state-in-effect -- mount fetch sets loading state; standard data-loading pattern. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MotionConfig } from 'motion/react'
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
  Building2,
  Eye,
  AlertCircle,
  Search,
  X,
  LayoutGrid,
  List,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { RemarksDialog } from '@/components/purchase-orders/remarks-dialog'
import { getBranchLabel } from '@/lib/branches'
import { getAllPettyCashLocationOptions, getPettyCashBrandStatus, getPettyCashConfiguredBranches, getPettyCashLocationOptions, getPettyCashUserBrands, PETTY_CASH_DEPARTMENT_OPTIONS, PETTY_CASH_TOP_UP_THRESHOLD, isPettyCashAllBranchRole, isPettyCashConfiguredForBranch } from '@/lib/petty-cash/constants'
import { toast } from '@/hooks/use-toast'
import { formatWaitingDuration } from '@/lib/petty-cash/status-tracking'
import { cn } from '@/lib/utils'
import { RequestFormDialog } from './pc-request-form'
import { ExpenseFormDialog } from './pc-expense-form'
import { PettyCashDetailDialog, type DetailTarget } from './pc-detail-dialog'
import { AllocationSpendDialog } from './pc-allocation-spend-dialog'
import { MdApprovalAmountDialog } from './pc-md-approval-dialog'
import {
  BalanceMeter,
  EmptyState,
  RecordTable,
  SectionCard,
  StatusPill,
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
  canDeletePettyCashRequestOnClient,
  getLocationBadge,
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

type TabKey = 'overview' | 'requests' | 'allocations' | 'history'
type HistoryView = 'expenses' | 'ledger'
type WorkflowDialogState = { request: PettyCashRequest; action: 'approve' | 'reject' | 'hold' } | null

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
  allocatedByName?: string | null
  firstSpendDate?: string | null
  lastSpendDate?: string | null
  spendCount?: number
  allocatedAt?: string
  allocated_at?: string
  createdAt?: string
  created_at?: string
  isPlaceholder?: boolean
}

const formatSpendDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(date)
}

const isCreatorRole = (role: string) => role === 'sales_manager'
const isApproverRole = (role: string) => role === 'ea' || role === 'md' || role === 'eba' || role === 'accounts' || role === 'ed' || role === 'admin' || role === 'branch_admin' || role === 'developer' || role === 'manager' || role === 'general_manager'

const PENDING_STATUSES = ['submitted', 'ed_pending', 'ed_on_hold', 'ea_pending', 'ea_on_hold', 'md_pending', 'md_on_hold', 'accounts_pending', 'accounts_on_hold']
const OPEN_REQUEST_STATUSES = ['draft', 'submitted', ...PENDING_STATUSES]

/*
 * (Removed: a hardcoded CANONICAL_TOPOLOGY listing all three dealerships' outlets.)
 *
 * It was a FOURTH copy of the branch list — exactly what the registry in lib/petty-cash/constants.ts
 * exists to prevent — and worse, it was rendered to EVERY viewer regardless of scope. A branch_admin
 * pinned to KIA landed on the "AM Hyundai" tab and saw all 12 Hyundai outlets, their Sales/Service
 * split and a Request Float button on each. The money was never exposed (those rows are synthesised
 * placeholders at ₹0, and the server rejects a cross-brand create with 'Forbidden branch'), but the
 * group's outlet topology was, and the UI implied actions the viewer cannot take.
 *
 * The replacement, `visibleTopology`, is derived from the one registry AND scoped to the viewer.
 */

function canApproveStageOnClient(role: string, stage: ApprovalStage): boolean {
  const r = String(role || '').trim().toLowerCase()
  if (r === 'developer' || r === 'admin') return true
  const isAccounts = r === 'accounts' || r === 'accounts_head' || r === 'accounts_team' || r === 'finance_head' || r === 'finance_team'
  switch (stage) {
    case 'ed_approval': return r === 'ed'
    case 'ea_approval': return r === 'ea'
    case 'md_approval': return r === 'md' || r === 'eba'
    case 'accounts': return isAccounts
    default: return false
  }
}

function canActOnRequest(role: string, request: PettyCashRequest) {
  if (!PENDING_STATUSES.includes(request.status)) return false
  return canApproveStageOnClient(role, stageForRequest(request, role))
}

function nextOwnerAfterApproval(stage: ApprovalStage): string {
  switch (stage) {
    case 'ed_approval': return 'EA'
    case 'ea_approval': return 'MD'
    case 'md_approval': return 'Accounts'
    case 'accounts': return 'funding — the allocation is created immediately'
    default: return 'the next approver'
  }
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
  const [historyView, setHistoryView] = useState<HistoryView>('expenses')
  const [workflowDialog, setWorkflowDialog] = useState<WorkflowDialogState>(null)
  const [mdApprovalDialog, setMdApprovalDialog] = useState<PettyCashRequest | null>(null)
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null)
  const [loading, setLoading] = useState(true)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [mdQueueScope, setMdQueueScope] = useState<'all' | 'mine'>('mine')
  /*
   * The brand an ALL-BRANCH viewer (MD / Developer / assigned-'all') is currently looking at.
   * '' = not yet initialised (first payload decides), 'all' = every branch, else one brand.
   *
   * Held in a REF as well as state, and the three loaders read the REF: adding it to their
   * useCallback deps would change loadDashboard's identity on every switch and re-fire the mount
   * effect — the exact effect-identity refetch loop this repo has been burned by before. The ref
   * also makes refreshAfterMutation carry the selected brand for free, so a save never silently
   * snaps the dashboard back to all-branch numbers under an unchanged chip.
   */
  const [brandView, setBrandView] = useState<string>('')
  const brandViewRef = useRef<string>('')

  const switchBrandView = useCallback((next: string) => {
    brandViewRef.current = next
    setBrandView(next)
  }, [])
  const [allocations, setAllocations] = useState<PettyCashAllocationRow[]>([])
  const [allocationsLoading, setAllocationsLoading] = useState(false)
  const [allocationLocationFilter, setAllocationLocationFilter] = useState('all')
  const [allocationStatusFilter, setAllocationStatusFilter] = useState('active')
  const [spendAllocationId, setSpendAllocationId] = useState<string | null>(null)
  const [allocationDepartmentFilter, setAllocationDepartmentFilter] = useState('all')
  const [ledgerLocationFilter, setLedgerLocationFilter] = useState('all')
  const [tableSearch, setTableSearch] = useState('')

  // Branch Selection State: User selects one branch (AM Hyundai, AM Platinum, or AM Kia)
  // '' until the first payload names a brand this viewer may actually see (see the effect below).
  // It used to default to 'hyundai' for everyone, which is why a KIA branch_admin opened on Hyundai.
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [overviewDeptFilter, setOverviewDeptFilter] = useState('all')
  const [overviewLowBalanceOnly, setOverviewLowBalanceOnly] = useState(false)
  const [overviewViewMode, setOverviewViewMode] = useState<'table' | 'cards'>('table')

  const refreshLedger = useCallback(async (allocationId?: string | null) => {
    setLedgerLoading(true)
    try {
      const params = new URLSearchParams()
      if (allocationId) params.set('allocationId', allocationId)
      const brand = brandViewRef.current
      if (brand && brand !== 'all') params.set('branchId', brand)
      const query = params.size ? `?${params.toString()}` : ''
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
      const params = new URLSearchParams({ status })
      const brand = brandViewRef.current
      if (brand && brand !== 'all') params.set('branchId', brand)
      const data = await fetchJson<{ allocations: PettyCashAllocationRow[] }>(
        `/api/petty-cash/allocations?${params.toString()}`,
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
      // An explicit option wins; otherwise the all-branch viewer's current selection applies. A
      // concrete-brand user's ref stays '', so nothing changes for them.
      const viewBrand = options?.branchId ?? (brandViewRef.current && brandViewRef.current !== 'all' ? brandViewRef.current : null)
      const query = viewBrand ? `?branchId=${encodeURIComponent(viewBrand)}` : ''
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
            quality,
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

  const summary = payload?.summary
  const currentAllocation = payload?.currentAllocation || null
  const allocationAmount = Number(normalizeAllocatedAmount(currentAllocation))
  const spentAmount = Number(normalizeSpentAmount(currentAllocation))
  const remainingAmount = summary?.remainingAmount ?? (allocationAmount - spentAmount)
  const spendPercentage = allocationAmount > 0 ? Math.min(100, Math.round((spentAmount / allocationAmount) * 100)) : 0
  const userRole = payload?.user.role || ''
  const currentBranchId = payload?.user.brand || ''
  const isSuperAdmin = userRole === 'developer' || userRole === 'admin' || userRole === 'branch_admin' || userRole === 'manager' || userRole === 'general_manager'
  const canCreate = isCreatorRole(userRole) || isSuperAdmin || userRole === 'md' || userRole === 'accounts'
  const canReviewQueue = isApproverRole(userRole) || isSuperAdmin
  const canRequestTopUp = summary?.canRequestTopUp ?? true
  const canSubmitExpense = summary?.canSubmitExpense ?? true
  const topUpReason = summary?.topUpReason || ''
  const categoryOptions = payload?.categories || []
  const allRequests = payload?.requests || []
  const allExpenses = payload?.expenses || []
  const showMdScopeToggle = userRole === 'md'
  /*
   * ⚠️ Same source as the server (lib/petty-cash/constants.ts). EA, EBA and ED are no longer
   * all-branch by role — their visibility follows the admin-panel assignment, so an EA pinned to
   * 'kia' is now a single-brand viewer here exactly as the server scopes them.
   */
  const isAllBranchViewer = isPettyCashAllBranchRole(userRole) || currentBranchId === 'all'
  /*
   * MD default: their ALLOTTED branch (the admin-panel assignment), not the whole group — they can
   * click over to any other branch or All. Initialised once from the first payload; an assignment
   * that is not a petty-cash brand (e.g. 'all', 'honda') falls back to All Branches.
   */
  const viewedBranchId = isAllBranchViewer && brandView && brandView !== 'all' ? brandView : currentBranchId
  const brandViewOptions = useMemo(() => getPettyCashConfiguredBranches(), [])

  useEffect(() => {
    // First payload decides the default view, once: the user's own admin-panel assignment when it
    // is a petty-cash brand, otherwise All Branches ('all' and non-petty brands have no single home).
    if (!isAllBranchViewer || brandView || !currentBranchId) return
    const fallback = isPettyCashConfiguredForBranch(currentBranchId) ? currentBranchId : 'all'
    brandViewRef.current = fallback
    setBrandView(fallback)
    /*
     * The mount fetch ran BEFORE the role was known, so it was unscoped. Landing on a concrete
     * default without refetching would show all-branch numbers under a single-brand chip — the
     * dishonest-chip failure this feature exists to avoid — so scope the data to match, quietly
     * (preserveData: no loading flash; one extra round trip, first load only, MD-shaped users only).
     */
    if (fallback !== 'all') {
      void loadDashboard({ preserveData: true })
      void loadAllocations(allocationStatusFilter)
    }
  }, [isAllBranchViewer, brandView, currentBranchId, loadDashboard, loadAllocations, allocationStatusFilter])
  const canFilterExpensesByLocation = ['admin', 'md', 'ea', 'eba', 'developer', 'manager', 'general_manager'].includes(userRole)

  const seededLocationOptions = useMemo(
    () => (isAllBranchViewer && (!brandView || brandView === 'all')
      ? getAllPettyCashLocationOptions()
      : getPettyCashLocationOptions(viewedBranchId)),
    [isAllBranchViewer, brandView, viewedBranchId],
  )
  const expenseLocationOptions = useMemo(
    () => Array.from(new Set([...seededLocationOptions, ...allExpenses.map((expense) => (expense.location || '').trim()).filter(Boolean)])).sort(),
    [allExpenses, seededLocationOptions],
  )
  const expenseDepartmentOptions = useMemo(
    () => Array.from(new Set(allExpenses.map((expense) => (expense.department || '').trim()).filter(Boolean))).sort(),
    [allExpenses],
  )
  const visibleExpenses = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    let list = allExpenses
    if (canFilterExpensesByLocation) {
      list = list.filter((expense) =>
        (expenseLocationFilter === 'all' || (expense.location || '').trim() === expenseLocationFilter)
        && (expenseDepartmentFilter === 'all' || (expense.department || '').trim() === expenseDepartmentFilter))
    }
    if (q) {
      list = list.filter((e) =>
        (e.expenseNumber || e.expense_number || '').toLowerCase().includes(q) ||
        (e.particulars || e.purpose || '').toLowerCase().includes(q) ||
        (e.vendorName || e.vendor_name || '').toLowerCase().includes(q) ||
        (e.location || '').toLowerCase().includes(q))
    }
    return list
  }, [allExpenses, canFilterExpensesByLocation, expenseLocationFilter, expenseDepartmentFilter, tableSearch])

  const allocationLocationOptions = useMemo(
    () => Array.from(new Set([...seededLocationOptions, ...allocations.map((allocation) => (allocation.location || '').trim()).filter(Boolean)])).sort(),
    [allocations, seededLocationOptions],
  )
  const allocationDepartmentOptions = useMemo(
    () => Array.from(new Set(allocations.map((allocation) => (allocation.department || '').trim()).filter(Boolean))).sort(),
    [allocations],
  )
  const visibleAllocations = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    return allocations.filter((allocation) => {
      const matchLoc = allocationLocationFilter === 'all' || (allocation.location || '').trim() === allocationLocationFilter
      const matchDept = allocationDepartmentFilter === 'all' || (allocation.department || '').trim() === allocationDepartmentFilter
      const matchQ = !q ||
        (allocation.allocationNumber || allocation.allocation_number || '').toLowerCase().includes(q) ||
        (allocation.allocatedToName || '').toLowerCase().includes(q) ||
        (allocation.location || '').toLowerCase().includes(q)
      return matchLoc && matchDept && matchQ
    })
  }, [allocations, allocationLocationFilter, allocationDepartmentFilter, tableSearch])

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-DEALERSHIP CANONICAL TOPOLOGY (Hyundai 6 locs, Platinum 3 locs, KIA 3 locs)
  // ═══════════════════════════════════════════════════════════════════════════
  /*
   * The dealerships and outlets THIS viewer may see, derived from the single branch registry.
   *
   * Scope rules, matching the server's visibility filters exactly:
   *   - all-branch viewer (MD / Developer / assigned 'all'): every configured brand, or just the one
   *     their brand switcher currently selects
   *   - everyone else: only the brands their admin-panel assignment grants
   * A branch_admin pinned to KIA therefore gets KIA and nothing else — no Hyundai tab, no Hyundai
   * outlet names, no Request Float buttons for branches the server would refuse anyway.
   */
  const visibleTopology = useMemo(() => {
    const allowed = isAllBranchViewer
      ? (brandView && brandView !== 'all' ? [brandView] : getPettyCashConfiguredBranches())
      : getPettyCashUserBrands(currentBranchId).filter((brand) => isPettyCashConfiguredForBranch(brand))
    return allowed.map((brand) => ({
      brand,
      label: getBranchLabel(brand),
      locations: getPettyCashLocationOptions(brand),
      departments: PETTY_CASH_DEPARTMENT_OPTIONS,
    }))
  }, [isAllBranchViewer, brandView, currentBranchId])

  useEffect(() => {
    // Land on a dealership this viewer actually has, and follow the brand switcher when it moves.
    if (!visibleTopology.length) return
    if (!selectedBranch || !visibleTopology.some((group) => group.brand === selectedBranch)) {
      setSelectedBranch(visibleTopology[0].brand)
    }
  }, [visibleTopology, selectedBranch])

  const multiDealershipFloats = useMemo(() => {
    const activeDbRows = allocations.filter((a) => String(a.status || '').toLowerCase() === 'active')
    const matchedDbIds = new Set<string>()
    const allTopologyRows: PettyCashAllocationRow[] = []

    for (const group of visibleTopology) {
      for (const loc of group.locations) {
        for (const dept of group.departments) {
          // Find matching live DB record
          const liveMatch = activeDbRows.find((dbRow) => {
            const b = normalizeBranchId(dbRow) || ''
            const dbLoc = (dbRow.location || '').toLowerCase()
            const dbDept = (dbRow.department || '').toLowerCase()
            return (
              (b === group.brand || b.includes(group.brand)) &&
              (dbLoc === loc.toLowerCase() || dbLoc.includes(loc.toLowerCase())) &&
              (dbDept === dept.toLowerCase() || dbDept.includes(dept.toLowerCase()))
            )
          })

          if (liveMatch) {
            matchedDbIds.add(liveMatch.id)
            allTopologyRows.push(liveMatch)
          } else {
            // Default configured outlet float
            allTopologyRows.push({
              id: `default-${group.brand}-${loc}-${dept}`,
              branchId: group.brand,
              location: loc,
              department: dept,
              status: 'unallocated',
              allocatedAmount: '0',
              spentAmount: '0',
              remainingAmount: '0',
              allocatedToName: 'Unassigned',
              spendCount: 0,
              isPlaceholder: true,
            })
          }
        }
      }
    }

    // Include any additional DB allocations not covered by the canonical template
    for (const extraRow of activeDbRows) {
      if (!matchedDbIds.has(extraRow.id)) {
        allTopologyRows.push(extraRow)
      }
    }

    return allTopologyRows
    // visibleTopology is load-bearing here, not incidental: it decides WHICH outlets get a row.
    // Omitting it froze the outlet list at whatever the first render produced, so switching brand
    // would have kept showing the previous dealership's outlets.
  }, [allocations, visibleTopology])

  const activeFloatGroups = useMemo(() => {
    const readMoney = (allocation: PettyCashAllocationRow) => {
      const allocated = Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
      const spent = Number(allocation.spentAmount || allocation.spent_amount || 0)
      const remaining = Number(allocation.remainingAmount ?? (allocated - spent))
      return { allocated, spent, remaining }
    }

    const byBrand = new Map<string, PettyCashAllocationRow[]>()
    for (const allocation of multiDealershipFloats) {
      const brand = normalizeBranchId(allocation) || 'other'
      const bucket = byBrand.get(brand)
      if (bucket) bucket.push(allocation)
      else byBrand.set(brand, [allocation])
    }

    return Array.from(byBrand.entries())
      .map(([brand, rows]) => {
        const totals = rows.reduce((acc, row) => {
          const { allocated, spent, remaining } = readMoney(row)
          return { allocated: acc.allocated + allocated, spent: acc.spent + spent, remaining: acc.remaining + remaining }
        }, { allocated: 0, spent: 0, remaining: 0 })
        const activeRows = rows.filter((r) => r.status === 'active')
        const needsTopUp = rows.filter((row) => row.status === 'active' && readMoney(row).remaining <= PETTY_CASH_TOP_UP_THRESHOLD).length
        return {
          brand,
          label: getBranchLabel(brand),
          rows,
          activeCount: activeRows.length,
          totals,
          needsTopUp,
        }
      })
      .sort((a, b) => {
        const order: Record<string, number> = { hyundai: 1, platinum: 2, kia: 3 }
        return (order[a.brand] || 99) - (order[b.brand] || 99)
      })
  }, [multiDealershipFloats])

  const activeFloatCount = multiDealershipFloats.length

  // Filtered Floats for the Selected Branch (AM Hyundai, AM Platinum, or AM Kia)
  const selectedBranchGroup = useMemo(() => {
    return activeFloatGroups.find((g) => g.brand === selectedBranch) || activeFloatGroups[0]
  }, [activeFloatGroups, selectedBranch])

  const filteredBranchFloats = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    const rows = selectedBranchGroup?.rows || []
    return rows.filter((allocation) => {
      const dept = (allocation.department || '').trim().toLowerCase()
      const allocated = Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
      const spent = Number(allocation.spentAmount || allocation.spent_amount || 0)
      const remaining = Number(allocation.remainingAmount ?? (allocated - spent))

      const matchDept = overviewDeptFilter === 'all' || dept === overviewDeptFilter.toLowerCase()
      const matchLow = !overviewLowBalanceOnly || (allocation.status === 'active' && remaining <= PETTY_CASH_TOP_UP_THRESHOLD)
      const matchQ = !q ||
        (allocation.location || '').toLowerCase().includes(q) ||
        (allocation.allocatedToName || '').toLowerCase().includes(q)

      return matchDept && matchLow && matchQ
    })
  }, [selectedBranchGroup, overviewDeptFilter, overviewLowBalanceOnly, tableSearch])

  const branchFilteredTotals = useMemo(() => {
    return filteredBranchFloats.reduce((acc, row) => {
      const allocated = Number(row.allocatedAmount || row.allocated_amount || 0)
      const spent = Number(row.spentAmount || row.spent_amount || 0)
      const remaining = Number(row.remainingAmount ?? (allocated - spent))
      return {
        allocated: acc.allocated + allocated,
        spent: acc.spent + spent,
        remaining: acc.remaining + remaining,
        lowCount: acc.lowCount + (row.status === 'active' && remaining <= PETTY_CASH_TOP_UP_THRESHOLD ? 1 : 0),
        activeCount: acc.activeCount + (row.status === 'active' ? 1 : 0),
      }
    }, { allocated: 0, spent: 0, remaining: 0, lowCount: 0, activeCount: 0 })
  }, [filteredBranchFloats])

  const ledgerLocationOptions = useMemo(
    () => Array.from(new Set([...seededLocationOptions, ...ledger.map((entry) => (entry.location || '').trim()).filter(Boolean)])).sort(),
    [ledger, seededLocationOptions],
  )
  const visibleLedger = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    return ledger.filter((entry) => {
      const matchLoc = ledgerLocationFilter === 'all' || (entry.location || '').trim() === ledgerLocationFilter
      const matchQ = !q ||
        (entry.description || '').toLowerCase().includes(q) ||
        (entry.location || '').toLowerCase().includes(q) ||
        ledgerEntryType(entry).toLowerCase().includes(q)
      return matchLoc && matchQ
    })
  }, [ledger, ledgerLocationFilter, tableSearch])

  const sinceLabel = useMemo(() => {
    const raw = summary?.since
    if (!raw) return 'No allocations yet'
    const d = new Date(raw)
    if (!Number.isFinite(d.getTime())) return 'Since petty cash began'
    return `Since ${d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`
  }, [summary?.since])

  const contentLoading = dashboardLoading || ledgerLoading
  /*
   * ⚠️ `currentBranchId` is the RAW assignment string, which is not always one brand — it can be
   * 'kia,hyundai' (a shared login), 'all', or a brand petty cash was never switched on for
   * ('honda', 'tata'). Asking isPettyCashConfiguredForBranch() the raw string got all three wrong:
   *   'all'          -> false -> MDs and developers were shown "not set up for Unassigned Branch"
   *   'kia,hyundai'  -> false -> a multi-brand creator was told their own brands were unconfigured
   *                              AND had their create buttons disabled
   * So: an all-branch viewer is never "unconfigured", and a multi-brand user counts as configured
   * when ANY of their brands is.
   */
  const brandStatus = getPettyCashBrandStatus(currentBranchId, isAllBranchViewer)
  const branchConfigured = brandStatus === 'configured'
  /** No assignment at all is a different admin fix from "assigned a brand we don't run". */
  const noBrandAssigned = brandStatus === 'unassigned'
  const unconfiguredBrandLabel = useMemo(
    () => getPettyCashUserBrands(currentBranchId).map((brand) => getBranchLabel(brand)).join(' and '),
    [currentBranchId],
  )

  const requestLocationOptions = useMemo(() => getPettyCashLocationOptions(currentBranchId), [currentBranchId])
  const expenseFeedTitle = userRole === 'accounts'
    ? 'Branch Expense Ledger Feed'
    : isAllBranchViewer ? 'Recent Expenses · All Branches' : 'Recent Branch Expenses'

  const approvalRequests = useMemo(() => {
    if (userRole !== 'md' || mdQueueScope === 'all' || currentBranchId === 'all') return allRequests
    return allRequests.filter((request) => normalizeBranchId(request) === currentBranchId)
  }, [allRequests, userRole, mdQueueScope, currentBranchId])

  const myOpenRequests = useMemo(() => allRequests.filter((request) => OPEN_REQUEST_STATUSES.includes(request.status)), [allRequests])
  const pendingQueue = useMemo(() => approvalRequests.filter((request) => PENDING_STATUSES.includes(request.status)), [approvalRequests])

  useEffect(() => {
    if (canReviewQueue) void loadAllocations(allocationStatusFilter)
  }, [canReviewQueue, loadAllocations, allocationStatusFilter])

  /* ---- mutations (ORIGINAL FORM SUBMISSION LOGIC PRESERVED) ---- */
  const submitRequest = useCallback(async () => {
    if (!canRequestTopUp) { setFormError(topUpReason || 'Top-up not available right now.'); return }
    const location = requestForm.location.trim()
    const department = requestForm.department.trim()
    const amount = Number(requestForm.requestedAmount)
    const purpose = requestForm.purpose.trim()
    if (!location) { setFormError('Please select a valid location.'); return }
    if (!department || !PETTY_CASH_DEPARTMENT_OPTIONS.includes(department as typeof PETTY_CASH_DEPARTMENT_OPTIONS[number])) { setFormError('Please select a department (Sales or Service).'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Enter a valid amount greater than 0.'); return }
    if (purpose.length < 5) { setFormError('Purpose must be at least 5 characters.'); return }

    setSubmitting(true)
    setError(null); setFormError(null)
    try {
      const res = await fetch('/api/petty-cash/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedAmount: requestForm.requestedAmount,
          purpose,
          branchId: selectedBranch || (currentBranchId !== 'all' ? currentBranchId : undefined),
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
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to submit request')
      toast({ title: 'Could not submit', description: submitError instanceof Error ? submitError.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [canRequestTopUp, topUpReason, requestForm, refreshAfterMutation])

  const submitExpense = useCallback(async () => {
    const amount = Number(expenseForm.amount)
    const purpose = expenseForm.purpose.trim()
    const location = expenseForm.location.trim()
    if (!currentAllocation) { setFormError('No active allocation to post against.'); return }
    if (!location) { setFormError('Please select the location where the money was spent.'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('Enter a valid amount greater than 0.'); return }
    if (purpose.length < 5) { setFormError('Purpose must be at least 5 characters.'); return }
    if (expenseFiles.length === 0) { setFormError('Please upload at least one bill image or PDF.'); return }

    setSubmitting(true)
    setError(null); setFormError(null)
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
      setHistoryView('expenses')
      setActiveTab('history')
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to post expense')
      toast({ title: 'Could not post expense', description: submitError instanceof Error ? submitError.message : 'Please try again.', variant: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [expenseForm, currentAllocation, expenseFiles, refreshAfterMutation])

  const applyRequestWorkflow = useCallback(async (id: string, stage: ApprovalStage, action: 'approve' | 'reject' | 'hold', remarks = '', allocatedAmount?: number) => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/petty-cash/requests/${encodeURIComponent(id)}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          action,
          remarks,
          allocatedAmount: allocatedAmount !== undefined && Number.isFinite(allocatedAmount) ? Number(allocatedAmount) : undefined,
        }),
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

  /*
   * (Removed: handleOpenNewRequestForOutlet — it prefilled a new float request from an outlet row.)
   *
   * Every caller is gone: the per-row "Request Float" buttons and the unfunded row/card click that
   * quietly did the same thing. Raising a float now happens only through "Request Float / Top-Up"
   * in the page header, so there is one create path instead of four. It also seeded a ₹10,000
   * amount and an auto-written purpose the submitter never typed.
   */

  if (loading && !payload) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={`kpi-sk-${index}`} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />)}
        </div>
        <div className="h-80 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/40" />
      </div>
    )
  }
  if (!payload) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-xs font-bold text-rose-700">
        {error || 'Unable to load the petty cash dashboard.'}
      </div>
    )
  }

  const tabs: Array<{ key: TabKey; label: string; icon: typeof Wallet; count?: number }> = [
    { key: 'overview', label: 'Overview', icon: Layers },
    {
      key: 'requests',
      label: canReviewQueue ? 'Approvals' : 'My Requests',
      icon: ClipboardList,
      count: canReviewQueue ? pendingQueue.length : myOpenRequests.length,
    },
    ...(canReviewQueue ? [{ key: 'allocations' as const, label: 'Branch Floats', icon: Banknote, count: activeFloatCount }] : []),
    { key: 'history', label: 'History', icon: ReceiptText },
  ]

  const branchLabel = currentAllocation ? getBranchLabel(normalizeBranchId(currentAllocation)) : 'No active allocation'

  return (
    <MotionConfig reducedMotion="user">
      <div className="space-y-6 pb-24 font-sans tracking-normal">
        {/* ── Top Executive Treasury Header Banner ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-[var(--dashboard-primary)] dark:text-slate-200 border border-slate-200 dark:border-slate-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {branchLabel}
                </h3>
                {currentAllocation && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 uppercase tracking-wider">
                    Live Float
                  </span>
                )}
              </div>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Petty Cash & Imprest Fund Management · Multi-Dealership Treasury
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/*
              * The MD's branch switcher. Defaults to their allotted branch (the effect above); every
              * click reloads all three feeds so the dashboard, floats and ledger always describe the
              * SAME branch — a switch that scoped one tab of three was rejected in review once
              * already, and for good reason.
              */}
            {isAllBranchViewer && brandView && (
              <div className="flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-1" role="group" aria-label="Branch view">
                {[...brandViewOptions, 'all'].map((option) => {
                  const active = brandView === option
                  const label = option === 'all' ? 'All Branches' : getBranchLabel(option)
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        if (brandView === option) return
                        switchBrandView(option)
                        void loadDashboard({ preserveData: true })
                        void loadAllocations(allocationStatusFilter)
                      }}
                      className={cn(
                        'h-9 rounded-xl px-3 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dashboard-action-bg)]',
                        active
                          ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)]'
                          : 'text-slate-600 dark:text-slate-300 hover:text-slate-900',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshAfterMutation()}
              disabled={contentLoading}
              className="h-9 gap-1.5 rounded-xl text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', contentLoading && 'animate-spin')} />
              <span>Refresh</span>
            </Button>

            {canCreate && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => { setFormError(null); setExpenseDialogOpen(true) }}
                  disabled={!canSubmitExpense || !branchConfigured}
                  className="h-9 px-3.5 rounded-xl font-bold text-xs gap-1.5 shadow-sm cursor-pointer"
                >
                  <ReceiptText className="h-3.5 w-3.5" />
                  <span>Submit Expense</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setFormError(null); setRequestDialogOpen(true) }}
                  disabled={!canRequestTopUp || !branchConfigured}
                  className="h-9 gap-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Request Float / Top-Up</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}

        {/*
          * Why this page is empty — shown to EVERY affected role, not just creators.
          *
          * It used to be gated on `canCreate`, so an EA or manager pinned to a brand petty cash
          * does not run (e.g. AM Diamond Honda) got a dashboard of zeros with NO explanation, and
          * no button anywhere to reveal the reason. A reader who cannot act on the problem needs
          * the explanation more than a creator does, not less.
          */}
        {!branchConfigured && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {noBrandAssigned ? (
                <>Your account is not assigned to a branch, so there is no petty cash to show. An administrator can set your branch in Admin → Users.</>
              ) : canCreate ? (
                <>Petty cash is not set up for {unconfiguredBrandLabel} yet — locations need to be added before requests can be raised.</>
              ) : (
                <>Petty cash is not set up for {unconfiguredBrandLabel}, so there is nothing to show here. It currently runs at {getPettyCashConfiguredBranches().map((brand) => getBranchLabel(brand)).join(', ')}.</>
              )}
            </span>
          </div>
        )}

        {canCreate && branchConfigured && !canRequestTopUp && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{topUpReason || 'A new request unlocks only when the remaining balance is ₹1,000 or lower.'}</span>
          </div>
        )}

        {/* ── Top Executive KPI Overview Cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canReviewQueue ? (
            <>
              {/* Pending Approvals */}
              <Card
                onClick={() => setActiveTab('requests')}
                className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Pending Requests
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                      {String(summary?.pendingRequestCount ?? 0)}
                    </div>
                    {Number(summary?.pendingRequestCount ?? 0) > 0 ? (
                      <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200">
                        Action Required
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Queue Clear
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">Awaiting your approval</p>
                </CardContent>
              </Card>

              {/* Active Allocations */}
              <Card
                onClick={() => setActiveTab('allocations')}
                className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Active Floats
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    <Banknote className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                    {String(summary?.openAllocationCount ?? 0)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">
                    {summary?.lifetimeAllocationCount ?? 0} allocated in total across outlets
                  </p>
                </CardContent>
              </Card>

              {/* Cash in Hand */}
              <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Cash in Hand
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                    <Wallet className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(summary?.remainingNow ?? 0)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">Unspent across all active floats</p>
                </CardContent>
              </Card>

              {/* Total Spent */}
              <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Total Spent
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                    <TrendingDown className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
                    {formatCurrency(summary?.lifetimeSpent ?? 0)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">{sinceLabel}</p>
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              {/* Current Allocation */}
              <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Current Allocation
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                    <Banknote className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                    {formatCurrency(allocationAmount)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">{branchLabel}</p>
                </CardContent>
              </Card>

              {/* Remaining */}
              <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Remaining
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300">
                    <Wallet className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-bold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(remainingAmount)}
                    </div>
                    <span className="px-2 py-0.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {spendPercentage}% used
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">Available to spend</p>
                </CardContent>
              </Card>

              {/* Spent */}
              <Card className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all">
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Spent
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                    <TrendingDown className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
                    {formatCurrency(summary?.lifetimeSpent ?? spentAmount)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">{sinceLabel}</p>
                </CardContent>
              </Card>

              {/* Pending Requests */}
              <Card
                onClick={() => setActiveTab('requests')}
                className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs hover:shadow-sm transition-all cursor-pointer"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-1.5 pt-4 px-5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Pending Requests
                  </span>
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent className="px-5 pb-4 pt-0">
                  <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
                    {String(summary?.pendingRequestCount ?? 0)}
                  </div>
                  <p className="text-xs font-medium text-slate-500 mt-1">
                    {canReviewQueue ? 'Awaiting your approval' : 'Your requests in review'}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* ── Segmented Navigation Tabs Bar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 shadow-xs">
          <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((tab) => {
              const isActive = tab.key === activeTab
              const Icon = tab.icon
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.key)
                    setTableSearch('')
                  }}
                  className={cn(
                    'relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition-all cursor-pointer whitespace-nowrap',
                    isActive
                      ? 'bg-[var(--dashboard-action-bg)] text-[var(--dashboard-action-fg)] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={cn(
                      'px-1.5 py-0.2 rounded-full text-[10px] font-bold tabular-nums',
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Quick Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search outlets, vendors, requests…"
              className="h-8 w-56 rounded-xl pl-8 pr-7 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 outline-none focus:border-indigo-400"
            />
            {tableSearch && (
              <button
                type="button"
                onClick={() => setTableSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* ── Tab Contents ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* ── HIGH PRIORITY ACTION ALERT: PENDING APPROVAL QUEUE BANNER ── */}
            {canReviewQueue && pendingQueue.length > 0 && (
              <div
                onClick={() => setActiveTab('requests')}
                className="relative overflow-hidden rounded-2xl border-2 border-amber-400/90 dark:border-amber-500/80 bg-gradient-to-r from-amber-50 via-amber-100/60 to-amber-50 dark:from-amber-950/70 dark:via-amber-900/40 dark:to-amber-950/60 p-4 sm:p-5 shadow-md shadow-amber-500/10 ring-4 ring-amber-400/15 transition-all hover:border-amber-500 hover:shadow-lg hover:shadow-amber-500/15 cursor-pointer group"
              >
                {/* Visual Glow Accent */}
                <div className="absolute top-0 right-0 -mt-8 -mr-8 w-40 h-40 rounded-full bg-amber-400/20 blur-2xl pointer-events-none" />

                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div className="relative flex h-12 w-12 flex-none items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/30 group-hover:scale-105 transition-transform">
                      <ShieldCheck className="h-6 w-6" />
                      <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-600 border-2 border-white dark:border-slate-900" />
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-200/80 dark:bg-amber-800 text-amber-900 dark:text-amber-100 border border-amber-300 dark:border-amber-700">
                          Action Required
                        </span>
                        <h3 className="text-base font-black tracking-tight text-slate-950 dark:text-white">
                          {pendingQueue.length} {pendingQueue.length === 1 ? 'Request' : 'Requests'} Waiting for Your Approval
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-amber-900/80 dark:text-amber-200/90 leading-relaxed">
                        There {pendingQueue.length === 1 ? 'is 1 petty cash request' : `are ${pendingQueue.length} petty cash requests`} requiring your review and sign-off. Open the approvals queue to decide.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto flex-none">
                    <span className="inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md shadow-amber-600/25 transition-all group-hover:shadow-amber-600/40">
                      <span>Review Queue</span>
                      <span className="bg-amber-700/80 px-1.5 py-0.2 rounded-md text-[10px] font-black">{pendingQueue.length}</span>
                      <ArrowRight className="h-4 w-4 ml-0.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!canReviewQueue && myOpenRequests.length > 0 && (
              <SectionCard title="Your Pending Requests" subtitle="Requests you have raised that are still in review" icon={ClipboardList} iconTone="slate">
                {renderRequestTable(myOpenRequests, false)}
              </SectionCard>
            )}

            {/* ── 3 MAIN BRANCH SELECTOR: AM HYUNDAI | AM PLATINUM | AM KIA (Reveals locations & Sales/Service on Click) ── */}
            {canReviewQueue && (
              <SectionCard
                title="Balances by Branch & Outlets"
                subtitle={`Select a dealership branch to inspect its outlet locations & Sales/Service allocations`}
                icon={Banknote}
                iconTone="blue"
                toolbar={(
                  <div className="flex flex-wrap items-center gap-2">
                    {/* View Switcher: Table vs Cards */}
                    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1">
                      <button
                        type="button"
                        onClick={() => setOverviewViewMode('table')}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                          overviewViewMode === 'table'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs font-bold'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        )}
                      >
                        <List className="h-3.5 w-3.5" />
                        <span>Matrix Table</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverviewViewMode('cards')}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer',
                          overviewViewMode === 'cards'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs font-bold'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        )}
                      >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        <span>Cards View</span>
                      </button>
                    </div>

                    {/* Needs Top-up Toggle Filter */}
                    <button
                      type="button"
                      onClick={() => setOverviewLowBalanceOnly(!overviewLowBalanceOnly)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors border cursor-pointer',
                        overviewLowBalanceOnly
                          ? 'bg-amber-500 text-white border-amber-600 font-bold shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>Needs Top-Up ({selectedBranchGroup?.needsTopUp || 0})</span>
                    </button>
                  </div>
                )}
              >
                {/* 3 Main Dealership Options Bar */}
                <div className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-3.5 flex flex-wrap items-center justify-between gap-3">
                  {/* Primary 3 Branch Selection Options */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                      Dealership:
                    </span>
                    {visibleTopology.map((branchItem) => {
                      const isSelected = selectedBranch === branchItem.brand
                      const count = branchItem.locations.length * branchItem.departments.length
                      return (
                        <button
                          key={branchItem.brand}
                          type="button"
                          onClick={() => {
                            setSelectedBranch(branchItem.brand)
                            setTableSearch('')
                          }}
                          className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer',
                            isSelected
                              ? 'bg-[var(--dashboard-action-bg)] text-white shadow-xs font-bold'
                              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                          )}
                        >
                          <Building2 className="h-3.5 w-3.5" />
                          <span>{branchItem.label}</span>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.2 rounded-full font-bold tabular-nums',
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          )}>
                            {count} Outlets
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Department Filter Sub-Pills */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                      Dept:
                    </span>
                    {(['all', 'Sales', 'Service'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setOverviewDeptFilter(d)}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                          overviewDeptFilter === d
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-bold'
                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100'
                        )}
                      >
                        {d === 'all' ? 'All' : d}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Filter Summary Metrics Banner for Selected Branch */}
                {selectedBranchGroup && (
                  <div className="px-5 py-3 bg-slate-100/50 dark:bg-slate-800/20 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      <strong>{selectedBranchGroup.label}</strong> · Showing {filteredBranchFloats.length} locations & departments
                      {branchFilteredTotals.activeCount < filteredBranchFloats.length && (
                        <span className="ml-1.5 text-slate-500">
                          ({branchFilteredTotals.activeCount} active · {filteredBranchFloats.length - branchFilteredTotals.activeCount} ready to allocate)
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-4 text-xs">
                      <span>Remaining: <strong className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(branchFilteredTotals.remaining)}</strong></span>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <span>Allocated: <strong className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{formatCurrency(branchFilteredTotals.allocated)}</strong></span>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <span>Spent: <strong className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatCurrency(branchFilteredTotals.spent)}</strong></span>
                    </div>
                  </div>
                )}

                {allocationsLoading ? (
                  <div className="space-y-2 p-5">
                    {Array.from({ length: 4 }).map((_, index) => <div key={`bal-sk-${index}`} className="h-12 animate-pulse rounded-2xl bg-slate-50 dark:bg-slate-800/40" />)}
                  </div>
                ) : filteredBranchFloats.length === 0 ? (
                  <EmptyState icon={Banknote} title="No matching outlet locations" description="Try adjusting your department or search filters." />
                ) : overviewViewMode === 'table' ? (
                  /* ── HIGH-DENSITY FINANCIAL MATRIX TABLE FOR THE SELECTED BRANCH ── */
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left text-xs font-sans">
                      <thead>
                        <tr className="bg-slate-950 text-white border-b border-slate-800">
                          <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[180px]">
                            Outlet / Location
                          </th>
                          <th className="py-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Dealership
                          </th>
                          <th className="py-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Department
                          </th>
                          <th className="py-3 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Custodian / In-Charge
                          </th>
                          <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Allocated Float
                          </th>
                          <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Spent to Date
                          </th>
                          <th className="py-3 px-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[140px]">
                            Current Balance
                          </th>
                          <th className="py-3 px-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-300 min-w-[140px]">
                            Float Health
                          </th>
                          <th className="py-3 px-4 text-center text-[11px] font-bold uppercase tracking-wider text-slate-300 whitespace-nowrap">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-normal">
                        {filteredBranchFloats.map((allocation) => {
                          const allocated = Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
                          const spent = Number(allocation.spentAmount || allocation.spent_amount || 0)
                          const remaining = Number(allocation.remainingAmount ?? (allocated - spent))
                          const spentPct = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0
                          const isActive = allocation.status === 'active'
                          const needsTopUp = isActive && remaining <= PETTY_CASH_TOP_UP_THRESHOLD
                          const branchBrand = normalizeBranchId(allocation)
                          const branchName = getBranchLabel(branchBrand)
                          const locBadge = getLocationBadge(allocation.location || branchName)

                          return (
                            <tr
                              key={allocation.id}
                              // Read-only, like the Actions cell: clicking a FUNDED row opens its spends.
                              // An unfunded row used to open the new-request dialog — the same create
                              // action as the removed button, just hidden — so it is now inert.
                              onClick={() => { if (isActive) setSpendAllocationId(allocation.id) }}
                              className={cn(
                                'transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 group',
                                isActive ? 'cursor-pointer' : 'cursor-default',
                                !isActive ? 'opacity-90 bg-slate-50/30 dark:bg-slate-900/30' : needsTopUp ? 'bg-amber-50/30 dark:bg-amber-950/20' : ''
                              )}
                            >
                              {/* Location Outlet */}
                              <td className="py-3 px-4 font-semibold text-xs text-slate-900 dark:text-slate-100">
                                <span className={cn('inline-block px-2.5 py-1 rounded-lg text-xs font-semibold border shadow-2xs', locBadge.bg, locBadge.text, locBadge.border)}>
                                  {allocation.location}
                                </span>
                              </td>

                              {/* Dealership Brand */}
                              <td className="py-3 px-3 whitespace-nowrap">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                  {branchName}
                                </span>
                              </td>

                              {/* Department Badge */}
                              <td className="py-3 px-3 whitespace-nowrap">
                                <DepartmentBadge department={allocation.department} />
                              </td>

                              {/* Custodian */}
                              <td className="py-3 px-3 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                {allocation.allocatedToName || '—'}
                              </td>

                              {/* Allocated Limit */}
                              <td className="py-3 px-3 text-right font-semibold text-xs tabular-nums text-slate-900 dark:text-slate-50 whitespace-nowrap">
                                {formatCurrency(allocated)}
                              </td>

                              {/* Spent to Date */}
                              <td className="py-3 px-3 text-right font-semibold text-xs tabular-nums text-rose-600 dark:text-rose-400 whitespace-nowrap">
                                {formatCurrency(spent)}
                              </td>

                              {/* Current Balance */}
                              <td className="py-3 px-3 text-right whitespace-nowrap">
                                <span className={cn(
                                  'font-bold text-sm tabular-nums tracking-tight',
                                  !isActive ? 'text-slate-400' : needsTopUp ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                                )}>
                                  {formatCurrency(remaining)}
                                </span>
                              </td>

                              {/* Float Health & Progress Gauge */}
                              <td className="py-3 px-3 text-center">
                                <div className="flex flex-col items-center gap-1">
                                  {!isActive ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                      Ready to Allocate
                                    </span>
                                  ) : needsTopUp ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300">
                                      <AlertCircle className="h-2.5 w-2.5" /> Needs top-up
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200">
                                      Healthy ({100 - spentPct}% left)
                                    </span>
                                  )}
                                  <div className="h-1.5 w-24 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                                    <div
                                      className={cn(
                                        'h-full rounded-full',
                                        !isActive ? 'bg-slate-300' : spentPct > 90 ? 'bg-amber-500' : spentPct > 70 ? 'bg-indigo-500' : 'bg-emerald-500'
                                      )}
                                      style={{ width: `${!isActive ? 0 : spentPct}%` }}
                                    />
                                  </div>
                                </div>
                              </td>

                              {/*
                                * Actions — READ ONLY.
                                *
                                * The per-row "Request Float" and "+ Entry" buttons were removed: creating money
                                * belongs to the two buttons in the page header ("Submit Expense" and
                                * "Request Float / Top-Up"), one place, not repeated on every outlet row. On an
                                * unfunded row the button was also misleading — it appeared on outlets the viewer
                                * has no float for, and the server refuses those anyway.
                                * "View Spends" stays: it reads, it does not create.
                                */}
                              <td className="py-3 px-4 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                {isActive ? (
                                  <button
                                    type="button"
                                    onClick={() => setSpendAllocationId(allocation.id)}
                                    className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-700 transition-colors"
                                  >
                                    <Eye className="h-3 w-3 mr-1" />
                                    View Spends
                                  </button>
                                ) : (
                                  <span className="text-xs font-medium text-slate-400 dark:text-slate-500">—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100/90 dark:bg-slate-800/90 border-t-2 border-slate-300 dark:border-slate-700 font-semibold">
                          <td colSpan={4} className="py-3 px-4 text-[11px] uppercase tracking-wider text-slate-900 dark:text-slate-100 font-bold">
                            Total · {selectedBranchGroup.label} ({branchFilteredTotals.activeCount} Funded)
                          </td>
                          <td className="py-3 px-3 text-right text-xs font-bold tabular-nums text-slate-900 dark:text-white">
                            {formatCurrency(branchFilteredTotals.allocated)}
                          </td>
                          <td className="py-3 px-3 text-right text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">
                            {formatCurrency(branchFilteredTotals.spent)}
                          </td>
                          <td className="py-3 px-3 text-right text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(branchFilteredTotals.remaining)}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  /* ── COMPACT CARDS GRID VIEW FOR SELECTED BRANCH ── */
                  <div className="p-5">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredBranchFloats.map((allocation) => {
                        const allocated = Number(allocation.allocatedAmount || allocation.allocated_amount || 0)
                        const spent = Number(allocation.spentAmount || allocation.spent_amount || 0)
                        const remaining = Number(allocation.remainingAmount ?? (allocated - spent))
                        const spentPct = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0
                        const isActive = allocation.status === 'active'
                        const needsTopUp = isActive && remaining <= PETTY_CASH_TOP_UP_THRESHOLD
                        const locBadge = getLocationBadge(allocation.location || getBranchLabel(normalizeBranchId(allocation)))

                        return (
                          <div
                            key={allocation.id}
                            // Same rule as the matrix row: funded opens spends, unfunded is inert.
                            onClick={() => { if (isActive) setSpendAllocationId(allocation.id) }}
                            className={cn(
                              'rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm space-y-2.5',
                              isActive ? 'cursor-pointer' : 'cursor-default',
                              !isActive ? 'opacity-90 bg-slate-50/40' : needsTopUp ? 'bg-amber-50/20' : ''
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={cn('truncate font-bold text-xs px-2 py-0.5 rounded-lg border', locBadge.bg, locBadge.text, locBadge.border)}>
                                {allocation.location}
                              </span>
                              <DepartmentBadge department={allocation.department} />
                            </div>

                            <div className="flex items-baseline justify-between pt-1">
                              <p className={cn('text-xl font-bold tabular-nums tracking-tight', !isActive ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                {formatCurrency(remaining)}
                              </p>
                              {!isActive ? (
                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                  Unallocated
                                </span>
                              ) : needsTopUp ? (
                                <span className="rounded-full bg-amber-50 dark:bg-amber-950 px-2 py-0.2 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-300">
                                  Needs top-up
                                </span>
                              ) : null}
                            </div>

                            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', !isActive ? 'bg-slate-200' : spentPct > 90 ? 'bg-amber-500' : 'bg-emerald-500')}
                                style={{ width: `${!isActive ? 0 : spentPct}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-[11px] font-medium text-slate-500">
                              <span>Spent: <strong className="font-semibold tabular-nums text-rose-600">{formatCurrency(spent)}</strong></span>
                              <span>Limit: <strong className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">{formatCurrency(allocated)}</strong></span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </SectionCard>
            )}
          </div>
        )}

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

        {activeTab === 'history' && (
          <div className="space-y-4">
            <div className="flex items-center gap-1 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 p-1 shadow-xs max-w-xs" role="tablist">
              {([['expenses', 'Expenses Feed'], ['ledger', 'Running Ledger']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={historyView === key}
                  onClick={() => setHistoryView(key)}
                  className={cn(
                    'flex-1 items-center justify-center rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer',
                    historyView === key
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {historyView === 'expenses' ? (
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
            ) : (
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
                      ? [{
                          header: 'Branch',
                          cell: (entry: PettyCashLedgerEntry) => {
                            const bLabel = getBranchLabel(normalizeBranchId(entry))
                            const bBadge = getLocationBadge(bLabel)
                            return (
                              <span className={cn('inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border', bBadge.bg, bBadge.text, bBadge.border)}>
                                {bLabel}
                              </span>
                            )
                          },
                        }]
                      : []),
                    {
                      header: 'Type',
                      cell: (entry) => (
                        <span className="font-semibold text-xs capitalize text-slate-800 dark:text-slate-200">
                          {ledgerEntryType(entry).replace(/_/g, ' ')}
                        </span>
                      ),
                    },
                    {
                      header: 'Location',
                      cell: (entry) => {
                        const locBadge = getLocationBadge(entry.location || '')
                        return (
                          <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-semibold border', locBadge.bg, locBadge.text, locBadge.border)}>
                            {entry.location || '—'}
                          </span>
                        )
                      },
                    },
                    { header: 'Description', cell: (entry) => <span className="line-clamp-1 max-w-[280px] text-xs font-medium text-slate-600 dark:text-slate-400">{entry.description || '—'}</span> },
                    { header: 'Amount', align: 'right', cell: (entry) => <span className={cn('font-semibold text-xs tabular-nums', Number(entry.amount) < 0 ? 'text-rose-600' : 'text-slate-900 dark:text-slate-50')}>{formatCurrency(entry.amount)}</span> },
                    { header: 'Balance After', align: 'right', cell: (entry) => <span className="font-semibold text-xs tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(ledgerBalanceAfter(entry))}</span> },
                    { header: 'Posted At', align: 'right', cell: (entry) => <span className="text-xs font-medium text-slate-500">{formatDateTime(entry.createdAt || entry.created_at)}</span> },
                  ]}
                />
              </SectionCard>
            )}
          </div>
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
                <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-1">
                  {([['active', 'Open only'], ['all', 'All (incl. past)']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAllocationStatusFilter(key)}
                      className={cn(
                        'rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer',
                        allocationStatusFilter === key ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-700',
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
                { header: 'Allocated To', cell: (allocation) => <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">{allocation.allocatedToName || '—'}</span> },
                { header: 'Allocated On', cell: (allocation) => (
                  <span className="whitespace-nowrap text-xs font-medium text-slate-600 dark:text-slate-400">
                    {formatDateTime(allocation.allocatedAt || allocation.allocated_at || allocation.createdAt || allocation.created_at)}
                  </span>
                ) },
                { header: 'Allocated By', cell: (allocation) => <span className="text-xs text-slate-600 dark:text-slate-400">{allocation.allocatedByName || '—'}</span> },
                {
                  header: 'Branch',
                  cell: (allocation) => {
                    const bLabel = getBranchLabel(normalizeBranchId(allocation))
                    const bBadge = getLocationBadge(bLabel)
                    return (
                      <span className={cn('inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border', bBadge.bg, bBadge.text, bBadge.border)}>
                        {bLabel}
                      </span>
                    )
                  },
                },
                {
                  header: 'Location',
                  cell: (allocation) => {
                    const locBadge = getLocationBadge(allocation.location || '')
                    return (
                      <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-semibold border', locBadge.bg, locBadge.text, locBadge.border)}>
                        {allocation.location || '—'}
                      </span>
                    )
                  },
                },
                { header: 'Department', cell: (allocation) => <DepartmentBadge department={allocation.department} /> },
                { header: 'Allocation #', cell: (allocation) => <span className="text-xs font-semibold text-slate-500">{allocation.allocationNumber || allocation.allocation_number || '—'}</span> },
                { header: 'Allocated', align: 'right', cell: (allocation) => <span className="font-semibold text-xs tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(allocation.allocatedAmount || allocation.allocated_amount)}</span> },
                { header: 'Spent', align: 'right', cell: (allocation) => <span className="font-semibold text-xs tabular-nums text-rose-600 dark:text-rose-400">{formatCurrency(allocation.spentAmount || allocation.spent_amount)}</span> },
                { header: 'Remaining', align: 'right', cell: (allocation) => {
                  const rem = Number(allocation.remainingAmount ?? (Number(allocation.allocatedAmount || allocation.allocated_amount || 0) - Number(allocation.spentAmount || allocation.spent_amount || 0)))
                  return (
                    <span className={cn('font-semibold text-xs tabular-nums', rem < 0 ? 'text-rose-600 font-bold' : 'text-emerald-600 dark:text-emerald-400')}>
                      {formatCurrency(rem)}
                    </span>
                  )
                }},
                { header: 'Spending', cell: (allocation) => {
                  const count = Number(allocation.spendCount || 0)
                  if (!count) return <span className="text-xs font-medium text-slate-400">not spent yet</span>
                  const first = formatSpendDate(allocation.firstSpendDate)
                  const last = formatSpendDate(allocation.lastSpendDate)
                  return (
                    <span className="whitespace-nowrap text-xs font-medium text-slate-600 dark:text-slate-400">
                      {count} {count === 1 ? 'entry' : 'entries'}
                      <span className="block text-[10px] text-slate-400">
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

        {/* Dialogs - ORIGINAL UNMODIFIED FORMS */}
        <AllocationSpendDialog allocationId={spendAllocationId} onClose={() => setSpendAllocationId(null)} />
        <RequestFormDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
          form={requestForm}
          onChange={updateRequestForm}
          onSubmit={submitRequest}
          submitting={submitting}
          locationOptions={seededLocationOptions}
          formError={formError}
        />
        <ExpenseFormDialog
          open={expenseDialogOpen}
          onOpenChange={setExpenseDialogOpen}
          form={expenseForm}
          onChange={updateExpenseForm}
          onSubmit={submitExpense}
          submitting={submitting}
          categories={categoryOptions}
          locationOptions={seededLocationOptions}
          formError={formError}
          allocationNumber={currentAllocation?.allocationNumber || currentAllocation?.allocation_number || ''}
          remainingAmount={remainingAmount}
          expenseFiles={expenseFiles}
          onUpload={uploadExpenseFiles}
          onRemoveFile={(index) => setExpenseFiles((prev) => prev.filter((_, i) => i !== index))}
        />
        <RemarksDialog
          open={workflowDialog !== null}
          onOpenChange={(open) => { if (!open) setWorkflowDialog(null) }}
          title={workflowDialog?.action === 'approve' ? 'Approve Request' : workflowDialog?.action === 'reject' ? 'Reject Request' : 'Hold Request'}
          description={workflowDialog?.action === 'approve'
            ? `Approve ${formatCurrency(requestedAmount(workflowDialog.request))} for ${requestedByName(workflowDialog.request)}. This moves it to ${nextOwnerAfterApproval(stageForRequest(workflowDialog.request, userRole))}. Remarks are optional.`
            : workflowDialog?.action === 'reject' ? 'Add a reason for rejecting this petty cash request.' : 'Add a note explaining why this request is on hold.'}
          actionLabel={workflowDialog?.action === 'approve' ? 'Approve' : workflowDialog?.action === 'reject' ? 'Reject' : 'Hold'}
          actionVariant={workflowDialog?.action === 'reject' ? 'destructive' : 'default'}
          remarksRequired={workflowDialog?.action !== 'approve'}
          loading={submitting}
          onConfirm={async (remarks) => {
            if (!workflowDialog) return
            const { request, action } = workflowDialog
            setWorkflowDialog(null)
            await applyRequestWorkflow(request.id, stageForRequest(request, userRole), action, remarks)
          }}
        />
        <MdApprovalAmountDialog
          open={mdApprovalDialog !== null}
          onOpenChange={(open) => { if (!open) setMdApprovalDialog(null) }}
          request={mdApprovalDialog}
          loading={submitting}
          onConfirm={async ({ remarks, approvedAmount }) => {
            if (!mdApprovalDialog) return
            const currentStage = stageForRequest(mdApprovalDialog, userRole)
            const targetStage = currentStage === 'md_approval' ? 'md_approval' : 'md_approval'
            await applyRequestWorkflow(mdApprovalDialog.id, targetStage, 'approve', remarks, approvedAmount)
            setMdApprovalDialog(null)
          }}
        />
        <PettyCashDetailDialog target={detailTarget} onClose={() => setDetailTarget(null)} categories={categoryOptions} />
      </div>
    </MotionConfig>
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
          { header: 'Request #', cell: (request) => <span className="font-semibold text-xs text-slate-500">{normalizeRequestNumber(request)}</span> },
          { header: 'Requested By', cell: (request) => <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">{requestedByName(request)}</span> },
          {
            header: 'Branch',
            cell: (request: PettyCashRequest) => {
              const bLabel = getBranchLabel(normalizeBranchId(request))
              const bBadge = getLocationBadge(bLabel)
              return (
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border shadow-2xs', bBadge.bg, bBadge.text, bBadge.border)}>
                  {bLabel}
                </span>
              )
            },
          },
          {
            header: 'Location',
            cell: (request: PettyCashRequest) => {
              const loc = request.location || ((request.requestForm as Record<string, unknown> | undefined)?.location as string) || ''
              const locBadge = getLocationBadge(loc || getBranchLabel(normalizeBranchId(request)))
              return (
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-semibold border shadow-2xs', locBadge.bg, locBadge.text, locBadge.border)}>
                  {loc || '—'}
                </span>
              )
            },
          },
          { header: 'Department', cell: (request) => <DepartmentBadge department={request.department} /> },
          { header: 'Purpose', cell: (request) => <span className="line-clamp-1 max-w-[220px] text-xs font-medium text-slate-600 dark:text-slate-400">{request.purpose || '—'}</span> },
          {
            header: 'Amount',
            align: 'right' as const,
            cell: (request: PettyCashRequest) => {
              const reqAmt = Number(requestedAmount(request))
              const allocAmt = Number(request.allocatedAmount || request.allocated_amount || 0)
              const isModified = allocAmt > 0 && allocAmt !== reqAmt

              return (
                <div className="flex flex-col items-end">
                  <span className={cn(
                    "font-semibold text-sm tabular-nums",
                    isModified ? "text-emerald-700 dark:text-emerald-300 font-bold" : "text-slate-900 dark:text-slate-50"
                  )}>
                    {formatCurrency(isModified ? allocAmt : reqAmt)}
                  </span>
                  {isModified && (
                    <span className="text-[10px] text-slate-400 line-through tabular-nums">
                      Req: {formatCurrency(reqAmt)}
                    </span>
                  )}
                </div>
              )
            },
          },
          { header: 'Status', cell: (request) => <StatusPill status={request.status} /> },
          ...(withActions
            ? [{
                header: 'Waiting',
                align: 'right' as const,
                cell: (request: PettyCashRequest) => {
                  const since = (request as unknown as Record<string, unknown>).updatedAt
                    ?? (request as unknown as Record<string, unknown>).updated_at
                    ?? request.createdAt
                  return <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-400">{formatWaitingDuration(since as string | null)}</span>
                },
              }]
            : []),
          {
            header: 'Actions',
            align: 'right' as const,
            cell: (request: PettyCashRequest) => (
              <div className="flex items-center justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
                {/* View Details Button (Soft Slate) */}
                <button
                  type="button"
                  onClick={() => setDetailTarget({ type: 'request', id: request.id, row: request })}
                  className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs bg-slate-50 hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </button>

                {withActions && canActOnRequest(userRole, request) && (
                  <>
                    {/* Approve Button (Soft Emerald) - Opens MD Amount Modal for MD/EBA */}
                    <button
                      type="button"
                      onClick={() => {
                        const stage = stageForRequest(request, userRole)
                        const isMd = userRole === 'md' || userRole === 'eba' || stage === 'md_approval'
                        if (isMd) {
                          setMdApprovalDialog(request)
                        } else {
                          setWorkflowDialog({ request, action: 'approve' })
                        }
                      }}
                      disabled={submitting}
                      className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-bold gap-1 cursor-pointer shadow-2xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Approve
                    </button>
                    {/* Hold Button (Soft Amber) */}
                    <button
                      type="button"
                      onClick={() => setWorkflowDialog({ request, action: 'hold' })}
                      disabled={submitting}
                      className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-bold gap-1 cursor-pointer shadow-2xs bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900 border border-amber-300 dark:border-amber-700 transition-colors disabled:opacity-50"
                    >
                      <PauseCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" /> Hold
                    </button>
                    {/* Reject Button (Soft Rose) */}
                    <button
                      type="button"
                      onClick={() => setWorkflowDialog({ request, action: 'reject' })}
                      disabled={submitting}
                      className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-bold gap-1 cursor-pointer shadow-2xs bg-rose-50 hover:bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-700 transition-colors disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400" /> Reject
                    </button>
                  </>
                )}
                {/* Delete Button (Soft Red) */}
                {canDeletePettyCashRequestOnClient(request as unknown as Record<string, unknown>, payload?.user, requestedByName(request)) && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteRequest(request.id)}
                    disabled={submitting}
                    title="Delete request"
                    className="inline-flex items-center justify-center h-7 px-2 rounded-lg text-xs font-bold gap-1 cursor-pointer shadow-2xs bg-red-50 hover:bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900 border border-red-200 dark:border-red-800 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3 text-red-600 dark:text-red-400" /> Delete
                  </button>
                )}
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
          { header: 'Expense #', cell: (expense) => <span className="font-semibold text-xs text-slate-500">{normalizeExpenseNumber(expense)}</span> },
          { header: 'Date', cell: (expense) => <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{formatDateTime(expenseDate(expense))}</span> },
          ...(canFilterExpensesByLocation ? [{
            header: 'Location',
            cell: (expense: import('./types').PettyCashExpense) => {
              const locBadge = getLocationBadge(expense.location || '')
              return (
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-semibold border', locBadge.bg, locBadge.text, locBadge.border)}>
                  {expense.location || '—'}
                </span>
              )
            },
          }] : []),
          { header: 'Department', cell: (expense) => <DepartmentBadge department={expense.department} /> },
          { header: 'Description', cell: (expense) => <span className="line-clamp-1 max-w-[220px] text-xs font-medium text-slate-600 dark:text-slate-400">{expense.particulars || expense.purpose || '—'}</span> },
          { header: 'Vendor', cell: (expense) => <span className="text-xs text-slate-600 dark:text-slate-400">{expenseVendor(expense)}</span> },
          { header: 'Amount', align: 'right', cell: (expense) => <span className="font-semibold text-sm tabular-nums text-slate-900 dark:text-slate-50">{formatCurrency(expense.amount)}</span> },
          { header: 'Status', cell: (expense) => <StatusPill status={expense.status} /> },
          {
            header: 'Actions',
            align: 'right' as const,
            cell: (expense: import('./types').PettyCashExpense) => (
              <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => setDetailTarget({ type: 'expense', id: expense.id, row: expense })}
                  className="inline-flex items-center justify-center h-7 px-2.5 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs bg-sky-100 hover:bg-sky-200 text-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-700 transition-colors"
                >
                  <Eye className="h-3 w-3 mr-1" />
                  View
                </button>
              </div>
            ),
          },
        ]}
      />
    )
  }
}

function PillFilter({ label, allLabel, value, options, onChange }: { label: string; allLabel: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1">
      <span className="text-[11px] font-bold text-slate-400">{label}:</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 cursor-pointer bg-transparent text-xs font-semibold text-slate-800 dark:text-slate-100 outline-none"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  )
}

function DepartmentBadge({ department }: { department?: string | null }) {
  const value = (department || '').trim()
  if (!value) return <span className="text-slate-400">—</span>
  const isService = /service/i.test(value)
  return (
    <span className={cn(
      'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border shadow-2xs',
      isService
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300'
        : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300',
    )}>
      {value}
    </span>
  )
}

function ScopeToggle({ scope, onChange }: { scope: 'all' | 'mine'; onChange: (scope: 'all' | 'mine') => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5">
      {(['all', 'mine'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer',
            scope === value ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {value === 'all' ? 'All Branches' : 'My Branch'}
        </button>
      ))}
    </div>
  )
}
