'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import { ArrowLeft, ChevronLeft, ChevronRight, Edit3, Loader2, Plus, RefreshCw, LayoutGrid, Table, TableProperties } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ImageGallery } from '@/components/purchase-orders/image-gallery'
import { MDGridView } from '@/components/purchase-orders/md-grid-view'
import { MDTableView } from '@/components/purchase-orders/md-table-view'
import { POTableView } from '@/components/purchase-orders/po-table-view'
import { Stage1InitialSubmission } from '@/components/purchase-orders/stage1-initial-submission'
import { usePurchaseOrdersViewPreference } from '@/lib/hooks/use-user-preferences'
import {
  Stage2VendorInformation,
  VendorInformationSummary,
  type VendorSectionData,
} from '@/components/purchase-orders/stage2-vendor-information'
import { Stage3EAApproval } from '@/components/purchase-orders/stage3-ea-approval'
import { Stage3MDApproval } from '@/components/purchase-orders/stage3-md-approval'
import { Stage4GRN } from '@/components/purchase-orders/stage4-grn'
import { Stage5Accounts } from '@/components/purchase-orders/stage5-accounts'
import { WorkflowTimeline } from '@/components/purchase-orders/workflow-timeline'
import { formatWorkflowStageLabel, getWorkflowStatusPresentation } from '@/components/purchase-orders/workflow-card-theme'
import { WorkflowStatusCard, WorkflowStatusCardSkeleton } from '@/components/purchase-orders/workflow-status-card'
import { formatIndiaDateTime } from '@/lib/date-time'
import { BRANCH_OPTIONS, getBranchLabel } from '@/lib/branches'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { DASHBOARD_STALE_TIME_MS } from '@/components/providers/query-provider'

interface PurchaseOrder {
  id: string
  orderNumber: string
  order_number?: string
  department: string
  subDepartment: string
  sub_department?: string
  requestedBy: string
  requested_by?: string
  specialInstructions: string
  special_instructions?: string
  quantityRequired: string
  quantity_required?: string
  estimateIfAny?: string
  estimate_if_any?: string
  vendorName?: string
  vendor_name?: string
  vendorDetails?: VendorSectionData[]
  vendor_details?: VendorSectionData[]
  currentStage: string
  current_stage?: string
  status: string
  createdAt: string
  created_at?: string
  completedAt?: string
  completed_at?: string
  eaApprovalRemarks?: string
  mdApprovalRemarks?: string
  amount?: string
  brand?: string
  specifyOther?: string
  specify_other?: string
  supportingImages?: string[]
  vendorImages?: string[]
  billImages?: string[]
  bill_images?: string[]
  grnImages?: string[]
  received_date_time?: string
  accountsImages?: string[]
  receivedDateTime?: string
  handoverTo?: string
  remarksIfAny?: string
  paymentStatus?: string
  paymentMode?: string
  accountRemarks?: string
  payment_status?: string
  payment_mode?: string
  account_remarks?: string
  eaApprovalStatus?: string
  mdApprovalStatus?: string
  ea_approval_status?: string
  md_approval_status?: string
}

type PurchaseOrderListMode = 'today' | 'all'

interface PurchaseOrderPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
  mode: PurchaseOrderListMode
}

const PURCHASE_ORDER_PAGE_SIZE = 12

const DEFAULT_PURCHASE_ORDER_PAGINATION: PurchaseOrderPagination = {
  page: 1,
  pageSize: PURCHASE_ORDER_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  mode: 'today',
}
const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/

interface WorkflowHistoryItem {
  id: string
  action: string
  stage: string
  performedBy: string
  performedByEmail?: string | null
  userRole: string
  remarks?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  createdAt: string
  metadata?: Record<string, unknown>
}

interface Personnel {
  createdBy: string
  createdByEmail: string | null
  purchaseManager: string | null
  purchaseManagerEmail: string | null
  eaApprover: string | null
  eaApproverEmail: string | null
  mdApprover: string | null
  mdApproverEmail: string | null
}

interface PurchaseOrderStagePayload {
  action?: string
  vendorImages?: Array<File | string>
  vendorOptions?: VendorSectionData[]
  billImages?: Array<File | string>
  grnImages?: Array<File | string>
  accountsImages?: Array<File | string>
}

type ApprovalFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'hold' | 'completed'
type ApprovalFilterCounts = Record<ApprovalFilter, number>
type WorkflowStageFilter =
  | 'all'
  | 'vendor_info_pending'
  | 'ea_pending'
  | 'md_pending'
  | 'grn_pending'
  | 'grn_completed'
  | 'accounts_pending'
  | 'completed'
  | 'rejected'
  | 'hold'

const APPROVAL_FILTER_OPTIONS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: 'all', label: 'All Orders' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'Hold' },
  { value: 'completed', label: 'Completed' },
]

const EMPTY_APPROVAL_FILTER_COUNTS: ApprovalFilterCounts = {
  all: 0,
  pending: 0,
  approved: 0,
  rejected: 0,
  hold: 0,
  completed: 0,
}

const WORKFLOW_STAGE_FILTER_OPTIONS: Array<{ value: WorkflowStageFilter; label: string }> = [
  { value: 'all', label: 'All Stages' },
  { value: 'vendor_info_pending', label: 'Vendor Info Pending' },
  { value: 'ea_pending', label: 'EA Approval Pending' },
  { value: 'md_pending', label: 'MD Approval Pending' },
  { value: 'grn_pending', label: 'GRN Pending' },
  { value: 'grn_completed', label: 'GRN Completed' },
  { value: 'accounts_pending', label: 'Accounts Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'Hold' },
]

function normalizeOrderNumber(order: PurchaseOrder) {
  return order.order_number || order.orderNumber || 'N/A'
}

function normalizeStage(order: PurchaseOrder) {
  if (order.current_stage || order.currentStage) {
    return order.current_stage || order.currentStage
  }

  if (order.status === 'vendor_info_pending') {
    return 'vendor_information'
  }

  return 'ea_approval'
}

function normalizeDescription(order: PurchaseOrder) {
  return order.special_instructions || order.specialInstructions || 'No description provided'
}

function normalizeBranch(order: PurchaseOrder) {
  return order.brand || ''
}

function getApprovalStatusValue(order: PurchaseOrder, role: 'ea' | 'md') {
  return role === 'ea'
    ? order.eaApprovalStatus || order.ea_approval_status || ''
    : order.mdApprovalStatus || order.md_approval_status || ''
}

function normalizeSpecifyOther(order: PurchaseOrder) {
  return order.specify_other || order.specifyOther || ''
}

function normalizeDepartmentLine(order: PurchaseOrder) {
  const subDepartment = order.sub_department || order.subDepartment
  return `${order.department || 'Department'}${subDepartment ? ` - ${subDepartment}` : ''}`
}

function normalizeRequestedBy(order: PurchaseOrder) {
  return order.requested_by || order.requestedBy || 'Not specified'
}

function normalizeQuantity(order: PurchaseOrder) {
  return order.quantity_required || order.quantityRequired || 'N/A'
}

function normalizeEstimate(order: PurchaseOrder) {
  return order.estimate_if_any || order.estimateIfAny || '0'
}

function normalizeVendorName(order: PurchaseOrder) {
  return order.vendor_name || order.vendorName || 'Awaiting vendor details'
}

function normalizeVendorDetails(order: PurchaseOrder) {
  return order.vendor_details || order.vendorDetails || []
}

function normalizeBillImages(order: PurchaseOrder) {
  return order.bill_images || order.billImages || []
}

function normalizeOrderAmount(order: PurchaseOrder) {
  const rawAmount = order.amount || normalizeEstimate(order)
  const numericAmount = Number.parseFloat(String(rawAmount || '0').replace(/[^0-9.-]/g, ''))

  return Number.isFinite(numericAmount) ? numericAmount : 0
}

function getOrderReceivedDate(order: PurchaseOrder) {
  return order.received_date_time || order.receivedDateTime || ''
}

function getDateInputValue(value: string | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value.split('T')[0] || ''
  }

  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function getTimeInputValue(value: string | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value.includes('T') ? value.split('T')[1]?.slice(0, 5) || '' : ''
  }

  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  })
}

function getSpendRecognitionDate(order: PurchaseOrder) {
  const rawDate = order.received_date_time
    || order.receivedDateTime
    || order.completed_at
    || order.completedAt
    || order.created_at
    || order.createdAt
  const parsedDate = rawDate ? new Date(rawDate) : null

  return parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null
}

function isSpendRecognizedOrder(order: PurchaseOrder) {
  return order.status === 'awaiting_accounts' || order.status === 'completed'
}

function isSpendRecognizedInDateRange(order: PurchaseOrder, startDate: string, endDate: string) {
  if (!isSpendRecognizedOrder(order)) {
    return false
  }

  const completedDate = getSpendRecognitionDate(order)
  if (!completedDate) {
    return false
  }

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`)
    if (completedDate < start) {
      return false
    }
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59`)
    if (completedDate > end) {
      return false
    }
  }

  return true
}

function isCompletedInDateRange(order: PurchaseOrder, startDate: string, endDate: string) {
  return order.status === 'completed' && isSpendRecognizedInDateRange(order, startDate, endDate)
}

function getOptimizedImageName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  return `${baseName || 'upload'}.webp`
}

async function compressImageBeforeUpload(file: File) {
  if (
    !file.type.startsWith('image/')
    || file.type === 'image/svg+xml'
    || file.type === 'image/gif'
    || file.size < 60 * 1024
  ) {
    return file
  }

  const imageUrl = URL.createObjectURL(file)

  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = imageUrl
    await image.decode()

    const maxDimension = 1400
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      return file
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const webpBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.58)
    })
    const jpegBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.62)
    })
    const candidates = [webpBlob, jpegBlob]
      .filter((blob): blob is Blob => Boolean(blob))
      .sort((a, b) => a.size - b.size)
    const blob = candidates[0]

    if (!blob || blob.size >= file.size) {
      return file
    }

    return new File([blob], getOptimizedImageName(file.name), {
      type: blob.type || 'image/webp',
      lastModified: Date.now(),
    })
  } catch (error) {
    console.error('Image compression failed, uploading original file:', error)
    return file
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

function hasVendorInformation(order: PurchaseOrder) {
  return normalizeVendorName(order) !== 'Awaiting vendor details'
    || normalizeVendorDetails(order).some((vendor) => vendor.name || vendor.images?.length)
    || (order.vendorImages?.length || 0) > 0
}

function getApprovalStatusSet(role: string) {
  if (role === 'ea') {
    return {
      pending: 'awaiting_ea_approval',
      rejected: 'ea_denied',
      extraRejected: 'md_denied',
      hold: 'ea_on_hold',
      extraHold: 'md_on_hold',
    }
  }

  return {
    pending: 'awaiting_md_approval',
    rejected: 'md_denied',
    extraRejected: '',
    hold: 'md_on_hold',
    extraHold: '',
  }
}

function isApprovalRole(role: string) {
  return role === 'ea' || role === 'md'
}

function isRejectedWorkflowStatus(status: string) {
  return status === 'ea_denied' || status === 'md_denied'
}

function isHoldWorkflowStatus(status: string) {
  return status === 'on_hold' || status === 'ea_on_hold' || status === 'md_on_hold'
}

function matchesWorkflowStageFilter(order: PurchaseOrder, filter: WorkflowStageFilter) {
  switch (filter) {
    case 'all':
      return true
    case 'vendor_info_pending':
      return order.status === 'vendor_info_pending' || normalizeStage(order) === 'vendor_information'
    case 'ea_pending':
      return order.status === 'awaiting_ea_approval'
    case 'md_pending':
      return order.status === 'awaiting_md_approval'
    case 'grn_pending':
      return order.status === 'awaiting_grn'
    case 'grn_completed':
      return order.status === 'awaiting_accounts'
    case 'accounts_pending':
      return order.status === 'awaiting_accounts'
    case 'completed':
      return order.status === 'completed'
    case 'rejected':
      return isRejectedWorkflowStatus(order.status)
    case 'hold':
      return isHoldWorkflowStatus(order.status)
    default:
      return true
  }
}

function isActionableApprovalOrder(order: Pick<PurchaseOrder, 'status'>, role: string) {
  if (!isApprovalRole(role)) {
    return false
  }

  const statusSet = getApprovalStatusSet(role)
  if (role === 'ea') {
    return order.status === statusSet.pending
      || order.status === statusSet.rejected
      || order.status === statusSet.extraRejected
      || order.status === statusSet.hold
      || order.status === statusSet.extraHold
  }

  return order.status === statusSet.pending || order.status === statusSet.hold
}

function getAssignedStageLabel(order: PurchaseOrder, people?: Personnel | null) {
  switch (order.status) {
    case 'awaiting_ea_approval':
      return 'Executive Assistant'
    case 'awaiting_md_approval':
      return 'Managing Director'
    case 'awaiting_grn':
      return people?.purchaseManager || 'Purchase Manager'
    case 'awaiting_accounts':
    case 'completed':
      return 'Accounts Department'
    case 'ea_denied':
      return 'Returned after EA review'
    case 'md_denied':
      return 'Returned after MD review'
    case 'ea_on_hold':
      return 'On hold with EA'
    case 'md_on_hold':
      return 'On hold with MD'
    default:
      return people?.purchaseManager || 'Workflow queue'
  }
}

function PurchaseOrdersPageContent() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const topLoader = useTopLoader()
  const topLoaderRef = useRef(topLoader)
  const activeOrderRequestRef = useRef<AbortController | null>(null)
  const viewSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempUploadCounterRef = useRef(0)
  const hasLoadedOrdersRef = useRef(false)
  const approvalViewInitializedRef = useRef(false)
  const selectedOrderId = searchParams.get('orderId')

  const [userRole, setUserRole] = useState('')
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryItem[]>([])
  const [personnel, setPersonnel] = useState<Personnel | null>(null)
  const [allPersonnel, setAllPersonnel] = useState<Map<string, Personnel>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [isListRefreshing, setIsListRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNewOrderForm, setShowNewOrderForm] = useState(false)
  const [isNewOrderDirty, setIsNewOrderDirty] = useState(false)
  const [isEditingOrder, setIsEditingOrder] = useState(false)
  const [isEditOrderDirty, setIsEditOrderDirty] = useState(false)
  const [isEditingVendorInfo, setIsEditingVendorInfo] = useState(false)
  const [isEditingGrn, setIsEditingGrn] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [isSwitchingView, setIsSwitchingView] = useState(false)
  const [showPOTableView, setShowPOTableView] = useState(false)
  const [workflowStageFilter, setWorkflowStageFilter] = useState<WorkflowStageFilter>('all')
  const [approvalBranchFilter, setApprovalBranchFilter] = useState<string>('all')
  const [approvalViewReady, setApprovalViewReady] = useState(false)
  const [approvalFilterCounts, setApprovalFilterCounts] = useState<ApprovalFilterCounts>(EMPTY_APPROVAL_FILTER_COUNTS)
  const [purchaseOrderListMode, setPurchaseOrderListMode] = useState<PurchaseOrderListMode>('today')
  const [purchaseOrderPage, setPurchaseOrderPage] = useState(1)
  const [purchaseOrderPagination, setPurchaseOrderPagination] = useState<PurchaseOrderPagination>(DEFAULT_PURCHASE_ORDER_PAGINATION)

  // View mode preference for MD/EA users
  const { value: viewMode, loading: viewPreferenceLoading, savePreference: saveViewMode, setValue: setViewModePreference } = usePurchaseOrdersViewPreference()
  const activeViewMode = viewMode.viewMode || 'table'
  const approvalFilter: ApprovalFilter = viewMode.approvalFilter || 'pending'
  const completedDateStart = viewMode.completedDateStart || ''
  const completedDateEnd = viewMode.completedDateEnd || ''

  const canCreateOrders = userRole === 'admin' || userRole === 'purchase_manager'
  const canViewPurchaseOrderTable = userRole === 'purchase_manager'
  const usesPurchaseOrderPagination = userRole !== ''
  const canManageVendorInfo = canCreateOrders
  const canApproveEA = userRole === 'admin' || userRole === 'ea'
  const canApproveMD = userRole === 'admin' || userRole === 'md'
  const canSubmitGRN = canCreateOrders
  const canProcessAccounts = userRole === 'admin' || userRole === 'accounts'
  const canEditInitialOrder = Boolean(canCreateOrders && selectedOrder && !['completed', 'cancelled'].includes(selectedOrder.status))
  const effectivePurchaseOrderListMode: PurchaseOrderListMode = isApprovalRole(userRole) ? 'all' : purchaseOrderListMode

  const queueTitle = useMemo(() => {
    switch (userRole) {
      case 'purchase_manager':
        return 'My Purchase Orders'
      case 'ea':
        return 'Awaiting EA Approval'
      case 'md':
        return 'Pending MD Approval'
      case 'accounts':
        return 'Accounts Processing'
      case 'admin':
        return 'All Purchase Orders'
      default:
        return 'Tracked Purchase Orders'
    }
  }, [userRole])

  const isCompletionTrackingView = showCompleted

  const listedOrders = useMemo(() => {
    const spendMatchesRange = (order: PurchaseOrder) =>
      isSpendRecognizedInDateRange(order, completedDateStart, completedDateEnd)
    const applyWorkflowStageFilter = (candidateOrders: PurchaseOrder[]) =>
      workflowStageFilter === 'all'
        ? candidateOrders
        : candidateOrders.filter((order) => matchesWorkflowStageFilter(order, workflowStageFilter))

    if (isApprovalRole(userRole)) {
      const statusSet = getApprovalStatusSet(userRole)

      switch (approvalFilter) {
        case 'all':
          return applyWorkflowStageFilter(orders)
        case 'pending':
          return applyWorkflowStageFilter(orders.filter((order) => order.status === statusSet.pending))
        case 'approved':
          return applyWorkflowStageFilter(orders.filter((order) => getApprovalStatusValue(order, userRole === 'ea' ? 'ea' : 'md') === 'approved'))
        case 'rejected':
          return applyWorkflowStageFilter(orders.filter((order) => order.status === statusSet.rejected || order.status === statusSet.extraRejected))
        case 'hold':
          return applyWorkflowStageFilter(orders.filter((order) => order.status === statusSet.hold || order.status === statusSet.extraHold))
        case 'completed':
          return applyWorkflowStageFilter(orders.filter((order) => isCompletedInDateRange(order, completedDateStart, completedDateEnd)))
        default:
          return applyWorkflowStageFilter(orders.filter((order) => order.status === statusSet.pending))
      }
    }

    if (isCompletionTrackingView) {
      return applyWorkflowStageFilter(orders.filter(spendMatchesRange))
    }

    if (workflowStageFilter !== 'all') {
      return applyWorkflowStageFilter(orders)
    }

    switch (userRole) {
      case 'accounts':
        return orders.filter((order) => order.status === 'awaiting_accounts')
      case 'admin':
        return orders.filter((order) => order.status !== 'completed')
      default:
        return orders.filter((order) => order.status !== 'completed')
    }
  }, [approvalFilter, completedDateEnd, completedDateStart, isCompletionTrackingView, orders, userRole, workflowStageFilter])

  const listedCompletedOrders = useMemo(
    () => listedOrders.filter((order) => order.status === 'completed'),
    [listedOrders]
  )

  const listedGrnCompletedOrders = useMemo(
    () => listedOrders.filter((order) => order.status === 'awaiting_accounts'),
    [listedOrders]
  )

  const listedSpendOrders = useMemo(
    () => listedOrders.filter(isSpendRecognizedOrder),
    [listedOrders]
  )

  const listedCompletedSpend = useMemo(
    () => listedSpendOrders.reduce((total, order) => total + normalizeOrderAmount(order), 0),
    [listedSpendOrders]
  )

  const poTableOrders = useMemo(() => listedOrders, [listedOrders])

  const fetchUserRole = useCallback(async () => {
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['auth', 'user'],
        queryFn: async () => {
          const response = await fetch('/api/auth/user')
          if (!response.ok) return null
          return await response.json()
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      if (!data) {
        setIsLoading(false)
        return
      }
      setUserRole(data.role || '')
      if (data.role === 'md') {
        setApprovalBranchFilter(data.brand || 'all')
      }
    } catch (error) {
      console.error('Error fetching user role:', error)
      setIsLoading(false)
    }
  }, [queryClient])

  const buildOrdersQuery = useCallback(() => {
    const params = new URLSearchParams()

    if (usesPurchaseOrderPagination) {
      params.set('paginate', 'true')
      params.set('mode', effectivePurchaseOrderListMode)
      params.set('page', String(purchaseOrderPage))
      params.set('pageSize', String(PURCHASE_ORDER_PAGE_SIZE))
      params.set('scope', isApprovalRole(userRole) && approvalFilter === 'all' ? 'all' : isCompletionTrackingView ? 'spending' : 'active')

      if (userRole === 'purchase_manager') {
        params.set('view', 'table')
      }

      if (isApprovalRole(userRole)) {
        params.set('approvalFilter', approvalFilter)
        if (userRole === 'md' && approvalBranchFilter !== 'all') {
          params.set('branchFilter', approvalBranchFilter)
        }
      }

      if (workflowStageFilter !== 'all') {
        params.set('workflowFilter', workflowStageFilter)
      }

      if (isCompletionTrackingView) {
        if (DATE_INPUT_PATTERN.test(completedDateStart)) params.set('spendStartDate', completedDateStart)
        if (DATE_INPUT_PATTERN.test(completedDateEnd)) params.set('spendEndDate', completedDateEnd)
      }
    }

    return params.toString()
  }, [approvalBranchFilter, approvalFilter, completedDateEnd, completedDateStart, effectivePurchaseOrderListMode, isCompletionTrackingView, purchaseOrderPage, userRole, usesPurchaseOrderPagination, workflowStageFilter])

  const fetchOrders = useCallback(async (showSpinner = true, force = false) => {
    if (!userRole || (isApprovalRole(userRole) && !approvalViewReady)) {
      return
    }

    try {
      if (showSpinner) {
        if (hasLoadedOrdersRef.current) {
          setIsListRefreshing(true)
        } else {
          setIsLoading(true)
        }
      }
      const query = buildOrdersQuery()
      const queryKey = ['purchase-orders', query || 'default']
      if (force) {
        await queryClient.invalidateQueries({ queryKey })
      }
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await fetch(`/api/purchase-orders${query ? `?${query}` : ''}`, {
            cache: 'no-store',
          })
          if (!response.ok) {
            const errorPayload = await response.json().catch(() => null)
            const errorMessage = errorPayload?.error || `Failed to fetch purchase orders (${response.status})`
            throw new Error(errorMessage)
          }
          return await response.json()
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setOrders(data.orders || [])
      if (data.approvalCounts) {
        setApprovalFilterCounts({
          ...EMPTY_APPROVAL_FILTER_COUNTS,
          ...data.approvalCounts,
        })
      } else if (!isApprovalRole(userRole)) {
        setApprovalFilterCounts(EMPTY_APPROVAL_FILTER_COUNTS)
      }
      if (data.pagination) {
        setPurchaseOrderPagination({
          page: data.pagination.page || 1,
          pageSize: data.pagination.pageSize || PURCHASE_ORDER_PAGE_SIZE,
          total: data.pagination.total || 0,
          totalPages: data.pagination.totalPages || 1,
          mode: data.pagination.mode === 'all' ? 'all' : 'today',
        })
      } else {
        setPurchaseOrderPagination({
          ...DEFAULT_PURCHASE_ORDER_PAGINATION,
          mode: effectivePurchaseOrderListMode,
          total: Array.isArray(data.orders) ? data.orders.length : 0,
        })
      }
      setAllPersonnel(new Map())
    } catch (error) {
      console.error('Error fetching orders:', error)
    } finally {
      hasLoadedOrdersRef.current = true
      if (showSpinner) {
        setIsLoading(false)
        setIsListRefreshing(false)
      }
    }
  }, [approvalViewReady, buildOrdersQuery, effectivePurchaseOrderListMode, queryClient, userRole])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUserRole()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchUserRole])

  useEffect(() => {
    if (!userRole || (isApprovalRole(userRole) && !approvalViewReady)) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      void fetchOrders()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [approvalViewReady, fetchOrders, userRole])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!userRole) {
        setApprovalViewReady(false)
        return
      }

      if (!isApprovalRole(userRole)) {
        setApprovalViewReady(true)
        return
      }

      if (viewPreferenceLoading || approvalViewInitializedRef.current) {
        return
      }

      approvalViewInitializedRef.current = true

      const nextApprovalFilter: ApprovalFilter = userRole === 'md' ? 'pending' : viewMode.approvalFilter || 'pending'
      const nextPreference = {
        ...viewMode,
        viewMode: 'table' as const,
        approvalFilter: nextApprovalFilter,
      }
      const needsPreferenceUpdate = viewMode.viewMode !== 'table' || viewMode.approvalFilter !== nextApprovalFilter

      if (needsPreferenceUpdate) {
        setViewModePreference(nextPreference)
        void saveViewMode(nextPreference).catch((error) => {
          console.error('Error restoring approval table view preference:', error)
        })
      }

      setApprovalViewReady(true)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [saveViewMode, setViewModePreference, userRole, viewMode, viewPreferenceLoading])

  useEffect(() => {
    topLoaderRef.current = topLoader
  }, [topLoader])

  useEffect(() => {
    if ((!showNewOrderForm || !isNewOrderDirty) && (!isEditingOrder || !isEditOrderDirty)) {
      return undefined
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [isEditOrderDirty, isEditingOrder, isNewOrderDirty, showNewOrderForm])

  const fetchOrderDetails = useCallback(async (orderId: string): Promise<void> => {
    activeOrderRequestRef.current?.abort()
    const controller = new AbortController()
    activeOrderRequestRef.current = controller

    try {
      topLoaderRef.current.start()
      setIsLoadingDetails(true)
      setLoadingOrderId(orderId)
      const data = await queryClient.fetchQuery({
        queryKey: ['purchase-orders', 'workflow', orderId],
        queryFn: async () => {
          const response = await fetch(`/api/purchase-orders/workflow?orderId=${orderId}`, {
            signal: controller.signal,
          })

          if (!response.ok) {
            if (response.status === 404) {
              router.push('/purchase-orders')
            }
            throw new Error('Failed to fetch order details')
          }

          return await response.json()
        },
        staleTime: DASHBOARD_STALE_TIME_MS,
      })
      setSelectedOrder(data.order)
      setWorkflowHistory(data.history || [])
      setPersonnel(data.personnel || null)
      setIsEditingOrder(false)
      setIsEditOrderDirty(false)
      setIsEditingVendorInfo(false)
      setIsEditingGrn(false)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }

      console.error('Error fetching order details:', error)
    } finally {
      if (activeOrderRequestRef.current === controller) {
        activeOrderRequestRef.current = null
      }
      setIsLoadingDetails(false)
      setLoadingOrderId((current) => (current === orderId ? null : current))
      topLoaderRef.current.done()
    }
  }, [queryClient, router])

  useEffect(() => {
    if (selectedOrderId) {
      const timer = window.setTimeout(() => {
        void fetchOrderDetails(selectedOrderId)
      }, 0)

      return () => window.clearTimeout(timer)
    }

    const timer = window.setTimeout(() => {
      activeOrderRequestRef.current?.abort()
      setSelectedOrder(null)
      setWorkflowHistory([])
      setPersonnel(null)
      setIsEditingOrder(false)
      setIsEditOrderDirty(false)
      setIsEditingVendorInfo(false)
      setIsEditingGrn(false)
      setIsLoadingDetails(false)
      setLoadingOrderId(null)
      topLoaderRef.current.done()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchOrderDetails, selectedOrderId])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('purchase-orders-workflow')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'purchase_orders',
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
          void queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'workflow'] })
          void fetchOrders(false, true)
          if (selectedOrderId) {
            void fetchOrderDetails(selectedOrderId)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchOrderDetails, fetchOrders, queryClient, selectedOrderId])

  useEffect(() => {
    return () => {
      activeOrderRequestRef.current?.abort()
      if (viewSwitchTimerRef.current) {
        clearTimeout(viewSwitchTimerRef.current)
      }
    }
  }, [])

  const openOrderDetails = async (orderId: string) => {
    setLoadingOrderId(orderId)
    topLoaderRef.current.start()

    if (selectedOrderId === orderId) {
      void fetchOrderDetails(orderId)
      return
    }

    router.push(`/purchase-orders?orderId=${orderId}`)
  }

  const closeOrderDetails = () => {
    if (isEditingOrder && isEditOrderDirty && !window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
      return
    }

    setSelectedOrder(null)
    setWorkflowHistory([])
    setPersonnel(null)
    setIsEditingOrder(false)
    setIsEditOrderDirty(false)
    setIsEditingVendorInfo(false)
    setIsEditingGrn(false)
    router.push('/purchase-orders')
  }

  const openFreshNewOrderForm = () => {
    if (isNewOrderDirty && !window.confirm('You have unsaved changes. Start a fresh new order?')) {
      return
    }

    if (isEditingOrder && isEditOrderDirty && !window.confirm('You have unsaved edit changes. Start a fresh new order?')) {
      return
    }

    activeOrderRequestRef.current?.abort()
    setSelectedOrder(null)
    setWorkflowHistory([])
    setPersonnel(null)
    setIsEditingOrder(false)
    setIsEditOrderDirty(false)
    setIsEditingVendorInfo(false)
    setIsEditingGrn(false)
    setIsLoadingDetails(false)
    setLoadingOrderId(null)
    setShowCompleted(false)
    setShowPOTableView(false)
    setIsNewOrderDirty(false)
    setShowNewOrderForm(true)
    router.push('/purchase-orders')
  }

  const closeNewOrderForm = () => {
    if (isNewOrderDirty && !window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
      return
    }

    setShowNewOrderForm(false)
    setIsNewOrderDirty(false)
  }

  const closeEditOrderForm = () => {
    if (isEditOrderDirty && !window.confirm('You have unsaved changes. Are you sure you want to close the edit form?')) {
      return
    }

    setIsEditingOrder(false)
    setIsEditOrderDirty(false)
  }

  const closeVendorInfoEditor = () => {
    setIsEditingVendorInfo(false)
  }

  const closeGrnEditor = () => {
    setIsEditingGrn(false)
  }

  const uploadFiles = async (
    files: Array<File | string> | undefined,
    folder: string,
    orderId: string
  ) => {
    if (!files || files.length === 0) {
      return []
    }

    const urls: string[] = []

    for (const file of files) {
      if (typeof file === 'string') {
        urls.push(file)
        continue
      }

      const uploadFile = await compressImageBeforeUpload(file)
      if (uploadFile !== file) {
        console.info('Purchase order image compressed before upload', {
          file: file.name,
          originalKB: Math.round(file.size / 1024),
          compressedKB: Math.round(uploadFile.size / 1024),
          reduction: `${Math.round((1 - uploadFile.size / file.size) * 100)}%`,
          type: uploadFile.type,
        })
      }
      const uploadFormData = new FormData()
      uploadFormData.append('file', uploadFile)
      uploadFormData.append('folder', folder)
      uploadFormData.append('orderId', orderId)

      const uploadResponse = await fetch('/api/purchase-orders/upload', {
        method: 'POST',
        body: uploadFormData,
      })

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text()
        throw new Error(errorText || `Failed to upload ${folder}`)
      }

      const uploadResult = await uploadResponse.json()
      if (uploadResult.uploadedSizeBytes) {
        console.info('Purchase order file uploaded to storage', {
          folder,
          path: uploadResult.path || uploadResult.url,
          uploadedKB: Math.round(uploadResult.uploadedSizeBytes / 1024),
        })
      }
      urls.push(uploadResult.path || uploadResult.url)
    }

    return urls
  }

  const handleStageSubmit = async (stage: string, formData: object, orderId?: string) => {
    try {
      setIsSubmitting(true)
      const stagePayload = { ...(formData as PurchaseOrderStagePayload) }
      const isEditingInitialSubmission = stage === 'initial_submission' && Boolean(orderId)
      if (isEditingInitialSubmission) {
        stagePayload.action = 'edit'
      }
      tempUploadCounterRef.current += 1
      const fallbackSelectedOrderId = stage === 'initial_submission' ? undefined : selectedOrder?.id
      const currentOrderId = orderId || fallbackSelectedOrderId || `temp-${tempUploadCounterRef.current}`

      if (stagePayload.vendorOptions?.length) {
        const uploadedVendorOptions = []

        for (const vendor of stagePayload.vendorOptions) {
          uploadedVendorOptions.push({
            ...vendor,
            images: await uploadFiles(vendor.images, 'vendor-images', currentOrderId),
          })
        }

        stagePayload.vendorOptions = uploadedVendorOptions
        stagePayload.vendorImages = uploadedVendorOptions.flatMap((vendor) => vendor.images)
      }

      if (stagePayload.vendorImages?.length) {
        stagePayload.vendorImages = await uploadFiles(stagePayload.vendorImages, 'vendor-images', currentOrderId)
      }

      if (stagePayload.billImages?.length) {
        stagePayload.billImages = await uploadFiles(stagePayload.billImages, 'bill-images', currentOrderId)
      }

      if (stagePayload.grnImages?.length) {
        stagePayload.grnImages = await uploadFiles(stagePayload.grnImages, 'grn-images', currentOrderId)
      }

      if (stagePayload.accountsImages?.length) {
        stagePayload.accountsImages = await uploadFiles(stagePayload.accountsImages, 'accounts-images', currentOrderId)
      }

      const response = await fetch('/api/purchase-orders/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderId || fallbackSelectedOrderId,
          stage,
          action: stagePayload.action,
          data: stagePayload,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        alert(`Error: ${error.error}`)
        return
      }

      const workflowResult = await response.json()
      if (workflowResult.orderId && workflowResult.updatedOrder) {
        setOrders((currentOrders) => currentOrders.map((order) => (
          order.id === workflowResult.orderId
            ? { ...order, ...workflowResult.updatedOrder }
            : order
        )))
        setSelectedOrder((currentOrder) => (
          currentOrder?.id === workflowResult.orderId
            ? { ...currentOrder, ...workflowResult.updatedOrder }
            : currentOrder
        ))
      }

      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'workflow'] })
      await fetchOrders(stage !== 'ea_approval' && stage !== 'md_approval', true)
      if (isEditingInitialSubmission && orderId) {
        setIsEditingOrder(false)
        setIsEditOrderDirty(false)
        await fetchOrderDetails(orderId)
        alert('Purchase order updated successfully!')
        return
      }

      if (orderId && (stage === 'vendor_information' || stage === 'grn')) {
        setIsEditingVendorInfo(false)
        setIsEditingGrn(false)
        await fetchOrderDetails(orderId)
        alert(
          stagePayload.action === 'push_to_grn_images'
            ? 'Vendor images pushed to GRN successfully!'
            : stage === 'vendor_information'
              ? 'Vendor information updated successfully!'
              : 'GRN details updated successfully!'
        )
        return
      }

      setShowNewOrderForm(false)
      setIsNewOrderDirty(false)
      setSelectedOrder(null)
      setWorkflowHistory([])
      setPersonnel(null)
      router.push('/purchase-orders')
      if (stage !== 'ea_approval' && stage !== 'md_approval') {
        alert('Successfully submitted!')
      }
    } catch (error) {
      console.error('Error submitting:', error)
      alert(error instanceof Error ? error.message : 'Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Handler for HOLD action (for table view)
  const handleHold = async (orderId: string, remarks?: string) => {
    const stage = userRole === 'ea' ? 'ea_approval' : 'md_approval'
    await handleStageSubmit(stage, { action: 'hold', remarks: remarks || '' }, orderId)
  }

  const handleBulkActionSelected = async (
    action: 'approve' | 'deny' | 'hold',
    orderIds: string[],
    remarks = ''
  ) => {
    if (orderIds.length === 0) {
      alert(`Please select at least one order to ${action}`)
      return
    }

    const actionLabel = action === 'approve' ? 'approve' : action === 'deny' ? 'deny' : 'hold'
    const confirmed = window.confirm(
      `Are you sure you want to ${actionLabel} ${orderIds.length} selected order${orderIds.length !== 1 ? 's' : ''}?`
    )
    if (!confirmed) {
      return
    }

    try {
      setIsBulkProcessing(true)
      const stage = userRole === 'ea' ? 'ea_approval' : 'md_approval'
      const response = await fetch('/api/purchase-orders/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds,
          stage,
          action,
          remarks,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        alert(`Error: ${error.error}`)
        return
      }

      const result = await response.json()
      if (Array.isArray(result.data)) {
        const updatedOrders = new Map<string, PurchaseOrder>(
          result.data.map((order: PurchaseOrder) => [order.id, order])
        )
        setOrders((currentOrders) => currentOrders.map((order) => (
          updatedOrders.get(order.id)
            ? { ...order, ...updatedOrders.get(order.id)! }
            : order
        )))
      }
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', 'workflow'] })
      await fetchOrders(false, true)
    } catch (error) {
      console.error(`Error in bulk ${action}:`, error)
      alert(`Failed to ${actionLabel} orders`)
    } finally {
      setIsBulkProcessing(false)
    }
  }

  // Toggle view mode
  const toggleViewMode = () => {
    const newMode: 'card' | 'table' = activeViewMode === 'table' ? 'card' : 'table'
    const nextPreference = {
      ...viewMode,
      viewMode: newMode,
    }
    setIsSwitchingView(true)
    setViewModePreference(nextPreference)
    if (viewSwitchTimerRef.current) {
      clearTimeout(viewSwitchTimerRef.current)
    }
    void saveViewMode(nextPreference).catch((error) => {
      console.error('Failed to save view mode preference:', error)
      setViewModePreference(viewMode)
    })
    viewSwitchTimerRef.current = setTimeout(() => {
      setIsSwitchingView(false)
    }, 180)
  }

  const setApprovalFilterPreference = (filter: ApprovalFilter) => {
    setPurchaseOrderPage(1)
    if (userRole === 'md' && filter === 'all') {
      setApprovalBranchFilter('all')
    }
    void saveViewMode({
      ...viewMode,
      approvalFilter: filter,
    })
  }

  const setWorkflowStageFilterPreference = (filter: WorkflowStageFilter) => {
    setPurchaseOrderPage(1)
    setWorkflowStageFilter(filter)

    if (filter === 'completed' || filter === 'grn_completed') {
      setShowCompleted(true)
      setShowPOTableView(false)
      setPurchaseOrderListMode('all')
    } else if (filter !== 'all') {
      setShowCompleted(false)
    }

    if (isApprovalRole(userRole) && filter !== 'all') {
      void saveViewMode({
        ...viewMode,
        approvalFilter: 'all',
      })
    }
  }

  const getWorkflowStageFilterCount = (filter: WorkflowStageFilter) => (
    orders.filter((order) => matchesWorkflowStageFilter(order, filter)).length
  )

  const renderWorkflowStageFilters = () => (
    <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      {WORKFLOW_STAGE_FILTER_OPTIONS.map((option) => {
        const isActive = workflowStageFilter === option.value

        return (
          <Button
            key={option.value}
            type="button"
            variant={isActive ? 'default' : 'outline'}
            onClick={() => setWorkflowStageFilterPreference(option.value)}
            className={`rounded-xl font-bold ${isActive ? 'app-primary-action' : 'app-outline-action'}`}
          >
            {option.label}
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {getWorkflowStageFilterCount(option.value)}
            </span>
          </Button>
        )
      })}
    </div>
  )

  const renderCompletionStateFilters = () => {
    const options: Array<{ value: WorkflowStageFilter; label: string; helper: string }> = [
      { value: 'all', label: 'All Spending', helper: 'GRN completed + fully completed' },
      { value: 'grn_completed', label: 'GRN Completed', helper: 'Spend counted, Accounts pending' },
      { value: 'completed', label: 'Completed', helper: 'Accounts closed' },
    ]

    return (
      <div className="flex flex-wrap gap-2 rounded-2xl border border-amber-100 bg-white p-3 shadow-sm">
        {options.map((option) => {
          const isActive = workflowStageFilter === option.value
          const count = option.value === 'all'
            ? orders.filter((order) => isSpendRecognizedInDateRange(order, completedDateStart, completedDateEnd)).length
            : orders.filter((order) => matchesWorkflowStageFilter(order, option.value) && isSpendRecognizedInDateRange(order, completedDateStart, completedDateEnd)).length

          return (
            <Button
              key={option.value}
              type="button"
              variant={isActive ? 'default' : 'outline'}
              onClick={() => setWorkflowStageFilterPreference(option.value)}
              className={`h-auto rounded-xl px-4 py-3 text-left ${isActive ? 'app-primary-action' : 'app-outline-action'}`}
            >
              <span className="grid gap-0.5">
                <span className="flex items-center gap-2 font-bold">
                  {option.label}
                  <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>
                    {count}
                  </span>
                </span>
                <span className={`text-[10px] font-medium ${isActive ? 'text-white/80' : 'text-slate-600'}`}>
                  {option.helper}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
    )
  }

  const setApprovalBranchFilterPreference = (branch: string) => {
    setPurchaseOrderPage(1)
    setApprovalBranchFilter(branch)
  }

  const setPurchaseOrderMode = (mode: PurchaseOrderListMode) => {
    setPurchaseOrderListMode(mode)
    setPurchaseOrderPage(1)
  }

  const renderPurchaseOrderPaginationControls = () => {
    if (!usesPurchaseOrderPagination) {
      return null
    }

    const page = purchaseOrderPagination.page
    const totalPages = Math.max(1, purchaseOrderPagination.totalPages)
    const total = purchaseOrderPagination.total
    const pageSize = purchaseOrderPagination.pageSize || PURCHASE_ORDER_PAGE_SIZE
    const firstItem = total === 0 ? 0 : ((page - 1) * pageSize) + 1
    const lastItem = Math.min(total, page * pageSize)
    const isFirstPage = page <= 1
    const isLastPage = page >= totalPages
    const isApprovalQueue = isApprovalRole(userRole)

    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {!isApprovalQueue && !isCompletionTrackingView && (['today', 'all'] as const).map((mode) => {
              const isActive = purchaseOrderListMode === mode

              return (
                <Button
                  key={mode}
                  type="button"
                  variant={isActive ? 'default' : 'outline'}
                  onClick={() => setPurchaseOrderMode(mode)}
                  className={`rounded-xl font-bold ${isActive ? 'app-primary-action' : 'app-outline-action'}`}
                >
                  {mode === 'today' ? 'Today' : 'All Orders'}
                </Button>
              )
            })}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {isApprovalQueue
              ? approvalFilter === 'all'
                ? userRole === 'md' && approvalBranchFilter !== 'all'
                  ? `${getBranchLabel(approvalBranchFilter)} orders`
                  : 'All readable orders'
                : `${APPROVAL_FILTER_OPTIONS.find((option) => option.value === approvalFilter)?.label || 'Approval'} queue`
              : effectivePurchaseOrderListMode === 'today'
                ? 'Current day orders'
                : 'All orders'} · {total} total
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-slate-600">
            Showing {firstItem}-{lastItem} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFirstPage || isLoading || isListRefreshing}
              onClick={() => setPurchaseOrderPage((current) => Math.max(1, current - 1))}
              className="app-outline-action rounded-xl"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Prev
            </Button>
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
              Page {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLastPage || isLoading || isListRefreshing}
              onClick={() => setPurchaseOrderPage((current) => Math.min(totalPages, current + 1))}
              className="app-outline-action rounded-xl"
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const setCompletedDatePreference = (field: 'completedDateStart' | 'completedDateEnd', value: string) => {
    void saveViewMode({
      ...viewMode,
      [field]: value,
    })
  }

  const clearCompletedDatePreference = () => {
    void saveViewMode({
      ...viewMode,
      completedDateStart: '',
      completedDateEnd: '',
    })
  }

  const renderCompletedAnalyticsControls = () => (
    <div className="flex flex-col gap-4 rounded-2xl border border-[#d7e4ef] bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-[#023468]">Recognized Spend</p>
        <p className="text-2xl font-black text-slate-900">
          Rs. {listedCompletedSpend.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
            {listedGrnCompletedOrders.length} GRN completed
          </span>
          <span className="rounded-full bg-[#edf4fb] px-3 py-1 text-[#023468]">
            {listedCompletedOrders.length} fully completed
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {listedSpendOrders.length} spending order{listedSpendOrders.length !== 1 ? 's' : ''} in view
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Start Date
          <input
            type="date"
            value={completedDateStart}
            onChange={(event) => setCompletedDatePreference('completedDateStart', event.target.value)}
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#023468]"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          End Date
          <input
            type="date"
            value={completedDateEnd}
            onChange={(event) => setCompletedDatePreference('completedDateEnd', event.target.value)}
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#023468]"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={clearCompletedDatePreference}
          disabled={!completedDateStart && !completedDateEnd}
          className="rounded-xl border-slate-300"
        >
          Clear Dates
        </Button>
      </div>
    </div>
  )

  const getApprovalFilterCount = (filter: ApprovalFilter) => {
    if (!isApprovalRole(userRole)) {
      return 0
    }

    return approvalFilterCounts[filter] || 0
  }

  const renderReadOnlyPanel = (title: string, message: string) => (
    <Card className="rounded-[28px] border-none shadow-xl">
      <CardHeader className="bg-gradient-to-r from-slate-900 to-slate-700 text-white">
        <CardTitle className="text-2xl font-black">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <p className="text-sm text-slate-600">{message}</p>
      </CardContent>
    </Card>
  )

  const renderApprovalListSkeleton = () => (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-5">
        <div className="h-4 w-36 animate-pulse rounded-full bg-[#dbeafe]" />
        <div className="mt-3 h-7 w-72 animate-pulse rounded-xl bg-slate-200" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={`approval-filter-skeleton-${index}`}
            className="grid grid-cols-[1.2fr_1fr_1.6fr_0.8fr_0.8fr] items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4"
          >
            <div className="space-y-2">
              <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
              <div className="h-3 w-40 animate-pulse rounded-full bg-slate-100" />
            </div>
            <div className="h-4 w-32 animate-pulse rounded-full bg-slate-200" />
            <div className="h-4 w-full animate-pulse rounded-full bg-slate-200" />
            <div className="h-7 w-24 animate-pulse rounded-full bg-slate-200" />
            <div className="ml-auto h-9 w-28 animate-pulse rounded-xl bg-slate-200" />
          </div>
        ))}
      </div>
    </div>
  )

  const renderCompletedSummary = (order: PurchaseOrder) => (
    <Card className="rounded-[28px] border-none shadow-xl">
      <CardHeader className="bg-gradient-to-r from-[#023468] to-[#034b82] text-white">
        <CardTitle className="text-2xl font-black">Order Completed</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 p-6 md:grid-cols-2">
        <div>
          <p className="text-sm text-slate-500">Payment Status</p>
          <p className="font-semibold text-slate-900">
            {(order.payment_status || order.paymentStatus || 'N/A').replace(/_/g, ' ')}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Payment Mode</p>
          <p className="font-semibold text-slate-900">
            {(order.payment_mode || order.paymentMode || 'N/A').replace(/_/g, ' ')}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Completed At</p>
          <p className="font-semibold text-slate-900">
            {formatIndiaDateTime(order.completed_at || order.completedAt || order.created_at || order.createdAt)}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-500">Final Amount</p>
          <p className="font-semibold text-slate-900">Rs. {order.amount || 'N/A'}</p>
        </div>
        {(order.account_remarks || order.accountRemarks) && (
          <div className="md:col-span-2">
            <p className="text-sm text-slate-500">Accounts Remarks</p>
            <p className="font-medium text-slate-900">{order.account_remarks || order.accountRemarks}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )

  const renderVendorInfoSection = (order: PurchaseOrder) => {
    if (!canManageVendorInfo || order.status === 'completed' || order.status === 'cancelled') {
      return null
    }

    const hasSubmittedVendorInfo = hasVendorInformation(order) || normalizeBillImages(order).length > 0

    if (hasSubmittedVendorInfo && !isEditingVendorInfo) {
      return (
        <Card className="rounded-[28px] border-none shadow-xl">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-black text-slate-900">Vendor Information</p>
              <p className="text-sm text-slate-500">Update vendor details, quotation images, or bill images if a correction is needed.</p>
            </div>
            <Button
              type="button"
              onClick={() => setIsEditingVendorInfo(true)}
              className="rounded-2xl bg-blue-600 text-white hover:bg-blue-700"
            >
              <Edit3 className="mr-2 h-4 w-4" />
              Edit Vendor Information
            </Button>
          </CardContent>
        </Card>
      )
    }

    return (
      <Stage2VendorInformation
        key={`vendor-${order.id}-${isEditingVendorInfo ? 'edit' : 'new'}`}
        orderId={order.id}
        initialData={{
          vendorName: normalizeVendorName(order) === 'Awaiting vendor details' ? '' : normalizeVendorName(order),
          vendorImages: order.vendorImages || [],
          vendorOptions: normalizeVendorDetails(order),
          billImages: normalizeBillImages(order),
        }}
        onSubmit={(data) => handleStageSubmit('vendor_information', data, order.id)}
        isLoading={isSubmitting}
        onCancel={hasSubmittedVendorInfo ? closeVendorInfoEditor : undefined}
      />
    )
  }

  const renderGrnEditSection = (order: PurchaseOrder) => {
    if (!canSubmitGRN || !['awaiting_accounts', 'completed'].includes(order.status)) {
      return null
    }

    if (!isEditingGrn) {
      return (
        <Card className="rounded-[28px] border-none shadow-xl">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-black text-slate-900">GRN Details</p>
              <p className="text-sm text-slate-500">Edit goods receipt details or upload additional GRN documents after submission.</p>
            </div>
            <Button
              type="button"
              onClick={() => setIsEditingGrn(true)}
              className="rounded-2xl bg-[#023468] text-white hover:bg-[#023468]"
            >
              <Edit3 className="mr-2 h-4 w-4" />
              Edit GRN
            </Button>
          </CardContent>
        </Card>
      )
    }

    const receivedDate = getOrderReceivedDate(order)

    return (
      <Stage4GRN
        key={`grn-edit-${order.id}`}
        orderId={order.id}
        isLoading={isSubmitting}
        orderDetails={{
          itemName: normalizeDescription(order),
          quantity: parseInt(normalizeQuantity(order), 10) || 0,
          vendorName: normalizeVendorName(order),
        }}
        initialData={{
          receivedDateTime: getDateInputValue(receivedDate),
          receivedTime: getTimeInputValue(receivedDate),
          grnImages: order.grnImages || [],
          amount: order.amount || '',
          handoverTo: order.handoverTo || '',
          remarksIfAny: order.remarksIfAny || '',
        }}
        onSubmit={(data) => handleStageSubmit('grn', data, order.id)}
        onCancel={closeGrnEditor}
      />
    )
  }

  const renderActionPanel = (order: PurchaseOrder) => {
    if (order.status === 'completed') {
      return renderCompletedSummary(order)
    }

    if (order.status === 'ea_denied' && !canApproveEA) {
      return renderReadOnlyPanel(
        'EA Denied This Request',
        order.eaApprovalRemarks || 'This order was denied during EA approval.'
      )
    }

    if (order.status === 'md_denied' && !canApproveEA && !canApproveMD) {
      return renderReadOnlyPanel(
        'MD Denied This Request',
        order.mdApprovalRemarks || 'This order was denied during MD approval.'
      )
    }

    if (order.status === 'ea_on_hold' && !canApproveEA) {
      return renderReadOnlyPanel(
        'EA Put This Request On Hold',
        'This order remains visible in workflow tracking and is waiting for EA action.'
      )
    }

    if (order.status === 'md_on_hold' && !canApproveMD && !canApproveEA) {
      return renderReadOnlyPanel(
        'MD Put This Request On Hold',
        'This order remains visible in workflow tracking and is waiting for MD action.'
      )
    }

    const currentStage = normalizeStage(order)

    if (canApproveEA && order.status === 'md_on_hold') {
      return (
        <Stage3EAApproval
          orderId={order.id}
          isLoading={isSubmitting}
          orderDetails={{
            itemName: normalizeDescription(order),
            department: order.department,
            subDepartment: order.subDepartment,
            quantity: parseInt(normalizeQuantity(order), 10) || 0,
            estimatedCost: parseFloat(normalizeEstimate(order)) || 0,
            vendorName: normalizeVendorName(order),
          }}
          onSubmit={(data) => handleStageSubmit('ea_approval', data, order.id)}
        />
      )
    }

    if (currentStage === 'ea_approval') {
      if (canApproveEA && ['awaiting_ea_approval', 'ea_denied', 'md_denied', 'ea_on_hold', 'md_on_hold'].includes(order.status)) {
        return (
          <Stage3EAApproval
            orderId={order.id}
            isLoading={isSubmitting}
            orderDetails={{
              itemName: normalizeDescription(order),
              department: order.department,
              subDepartment: order.subDepartment,
              quantity: parseInt(normalizeQuantity(order), 10) || 0,
              estimatedCost: parseFloat(normalizeEstimate(order)) || 0,
              vendorName: normalizeVendorName(order),
            }}
            onSubmit={(data) => handleStageSubmit('ea_approval', data, order.id)}
          />
        )
      }

      return renderReadOnlyPanel(
        'Awaiting EA Approval',
        'This purchase order is currently waiting in the EA approval queue.'
      )
    }

    if (currentStage === 'md_approval') {
      if (canApproveMD && ['awaiting_md_approval', 'md_denied', 'md_on_hold'].includes(order.status)) {
        return (
          <Stage3MDApproval
            orderId={order.id}
            isLoading={isSubmitting}
            orderDetails={{
              itemName: normalizeDescription(order),
              department: order.department,
              subDepartment: order.subDepartment,
              quantity: parseInt(normalizeQuantity(order), 10) || 0,
              estimatedCost: parseFloat(normalizeEstimate(order)) || 0,
              vendorName: normalizeVendorName(order),
              eaRemarks: order.eaApprovalRemarks,
            }}
            onSubmit={(data) => handleStageSubmit('md_approval', data, order.id)}
          />
        )
      }

      return renderReadOnlyPanel(
        'Awaiting MD Approval',
        'This purchase order is currently waiting for final MD approval.'
      )
    }

    if (currentStage === 'grn') {
      if (canSubmitGRN && order.status === 'awaiting_grn') {
        return (
          <Stage4GRN
            orderId={order.id}
            isLoading={isSubmitting}
            orderDetails={{
              itemName: normalizeDescription(order),
              quantity: parseInt(normalizeQuantity(order), 10) || 0,
              vendorName: normalizeVendorName(order),
            }}
            initialData={{
              grnImages: order.grnImages || [],
              amount: order.amount || '',
              remarksIfAny: order.remarksIfAny || '',
            }}
            onSubmit={(data) => handleStageSubmit('grn', data, order.id)}
          />
        )
      }

      return renderReadOnlyPanel(
        'GRN Pending',
        'This purchase order is ready for GRN submission by the Purchase Manager.'
      )
    }

    if (currentStage === 'accounts') {
      if (canProcessAccounts && order.status === 'awaiting_accounts') {
        return (
          <Stage5Accounts
            orderId={order.id}
            isLoading={isSubmitting}
            orderDetails={{
              itemName: normalizeDescription(order),
              quantity: parseInt(normalizeQuantity(order), 10) || 0,
              estimatedCost: parseFloat(order.amount || normalizeEstimate(order)) || 0,
              vendorName: normalizeVendorName(order),
              grnNumber: normalizeOrderNumber(order),
              receivedQuantity: parseInt(normalizeQuantity(order), 10) || 0,
            }}
            initialData={{
              accountsImages: order.accountsImages || [],
              actualAmount: order.amount || '',
              paymentStatus: order.paymentStatus || order.payment_status || '',
              paymentMode: order.paymentMode || order.payment_mode || '',
              accountsRemarks: order.accountRemarks || order.account_remarks || '',
            }}
            onSubmit={(data) => handleStageSubmit('accounts', data, order.id)}
          />
        )
      }

      return renderReadOnlyPanel(
        'Accounts Processing',
        'This purchase order is currently with the Accounts team for final processing.'
      )
    }

    return renderReadOnlyPanel(
      'Workflow Tracking',
      'This purchase order can be tracked here, but no workflow action is available for your role right now.'
    )
  }

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-6 py-2">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
              <div className="h-4 w-72 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <WorkflowStatusCardSkeleton key={`po-skeleton-${index}`} />
            ))}
          </div>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {userRole !== 'md' && userRole !== 'ea' && (
          <div className="flex flex-col gap-4 rounded-[28px] bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-black text-slate-900">Purchase Orders</h1>
              <p className="mt-1 text-sm text-slate-500">
                {canCreateOrders
                  ? 'Create, track, and move purchase orders through the workflow.'
                  : 'Track the purchase orders relevant to you with full read-only visibility.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {canViewPurchaseOrderTable && !isCompletionTrackingView && (
                <Button
                  onClick={() => {
                    setShowPOTableView((value) => {
                      const nextValue = !value
                      if (nextValue) {
                        setShowCompleted(false)
                        setWorkflowStageFilter('all')
                      }
                      return nextValue
                    })
                  }}
                  variant="outline"
                  className="rounded-2xl border-[#b9ccde] text-[#023468] hover:bg-[#edf4fb]"
                >
                  {showPOTableView ? (
                    <>
                      <LayoutGrid className="mr-2 h-4 w-4" />
                      Card View
                    </>
                  ) : (
                    <>
                      <TableProperties className="mr-2 h-4 w-4" />
                      PO Table View
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={() => {
                  setPurchaseOrderPage(1)
                  setShowCompleted((value) => {
                    const nextValue = !value
                    if (nextValue) {
                      setShowPOTableView(false)
                      setWorkflowStageFilter('all')
                      setPurchaseOrderListMode('all')
                    } else {
                      setWorkflowStageFilter('all')
                      setPurchaseOrderListMode('today')
                    }
                    return nextValue
                  })
                }}
                variant="outline"
                className="app-outline-action rounded-2xl"
              >
                {showCompleted ? 'Show Active' : 'Show Completed'}
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="app-outline-action rounded-2xl"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              {canCreateOrders && !isCompletionTrackingView && (
                <Button
                  onClick={openFreshNewOrderForm}
                  className="app-primary-action rounded-2xl shadow-lg"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Order
                </Button>
              )}
            </div>
          </div>
        )}

        {userRole !== 'md' && userRole !== 'ea' && !showNewOrderForm && !selectedOrder && (
          isCompletionTrackingView ? renderCompletionStateFilters() : renderWorkflowStageFilters()
        )}

        {userRole !== 'md' && userRole !== 'ea' && !showNewOrderForm && !selectedOrder && renderPurchaseOrderPaginationControls()}

        {userRole !== 'md' && userRole !== 'ea' && isCompletionTrackingView && renderCompletedAnalyticsControls()}

        {showNewOrderForm && canCreateOrders && (
          <Stage1InitialSubmission
            onSubmit={(data) => handleStageSubmit('initial_submission', data)}
            isLoading={isSubmitting}
            onCancel={closeNewOrderForm}
            onDirtyChange={setIsNewOrderDirty}
          />
        )}

        {selectedOrder && (
          <div className="space-y-6">
            <Button
              onClick={closeOrderDetails}
              variant="outline"
              className="rounded-2xl border-slate-300 hover:bg-slate-50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to List
            </Button>

            {isLoadingDetails ? (
              <Card className="rounded-[28px]">
                <CardContent className="p-12">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin text-[#023468]" />
                    <p className="font-medium text-gray-600">Loading purchase order details...</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {isEditingOrder && (
                  <Stage1InitialSubmission
                    key={`edit-${selectedOrder.id}`}
                    mode="edit"
                    initialData={{
                      branch: normalizeBranch(selectedOrder),
                      department: selectedOrder.department || '',
                      subDepartment: selectedOrder.sub_department || selectedOrder.subDepartment || '',
                      specifyOther: normalizeSpecifyOther(selectedOrder),
                      requestedBy: normalizeRequestedBy(selectedOrder),
                      specialInstructions: normalizeDescription(selectedOrder) === 'No description provided' ? '' : normalizeDescription(selectedOrder),
                      quantityRequired: normalizeQuantity(selectedOrder) === 'N/A' ? '' : normalizeQuantity(selectedOrder),
                      estimateIfAny: normalizeEstimate(selectedOrder) === '0' ? '' : normalizeEstimate(selectedOrder),
                    }}
                    onSubmit={(data) => handleStageSubmit('initial_submission', data, selectedOrder.id)}
                    isLoading={isSubmitting}
                    onCancel={closeEditOrderForm}
                    onDirtyChange={setIsEditOrderDirty}
                  />
                )}

                <Card className="rounded-[28px] border-none shadow-xl">
                  <CardHeader className="bg-gradient-to-r from-slate-900 to-[#012348] text-white">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <CardTitle className="text-2xl font-black">
                        Purchase Order Details - {normalizeOrderNumber(selectedOrder)}
                      </CardTitle>
                      {canEditInitialOrder && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            if (isEditingOrder) {
                              closeEditOrderForm()
                              return
                            }

                            setShowNewOrderForm(false)
                            setIsNewOrderDirty(false)
                            setIsEditingOrder(true)
                          }}
                          className="rounded-2xl border border-white/20 bg-white/10 text-white hover:bg-white/20"
                        >
                          <Edit3 className="mr-2 h-4 w-4" />
                          {isEditingOrder ? 'Hide Edit Form' : 'Edit Order'}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <p className="text-sm text-slate-500">Branch</p>
                      <p className="font-semibold text-slate-900">{getBranchLabel(normalizeBranch(selectedOrder))}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Department</p>
                      <p className="font-semibold text-slate-900">{selectedOrder.department || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Sub Department</p>
                      <p className="font-semibold text-slate-900">{selectedOrder.subDepartment || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Requested By</p>
                      <p className="font-semibold text-slate-900">{normalizeRequestedBy(selectedOrder)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Quantity Required</p>
                      <p className="font-semibold text-slate-900">{normalizeQuantity(selectedOrder)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Estimate</p>
                      <p className="font-semibold text-slate-900">Rs. {normalizeEstimate(selectedOrder)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Current Workflow Stage</p>
                      <p className="font-semibold text-slate-900">
                        {formatWorkflowStageLabel(normalizeStage(selectedOrder))}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Current Status</p>
                      <p className="font-semibold text-slate-900">
                        {getWorkflowStatusPresentation(selectedOrder.status).label}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Created</p>
                      <p className="font-semibold text-slate-900">
                        {formatIndiaDateTime(selectedOrder.created_at || selectedOrder.createdAt)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Vendor</p>
                      <p className="font-semibold text-slate-900">{normalizeVendorName(selectedOrder)}</p>
                    </div>
                    <div className="md:col-span-2 xl:col-span-3">
                      <p className="text-sm text-slate-500">Description</p>
                      <p className="font-medium text-slate-900">{normalizeDescription(selectedOrder)}</p>
                    </div>
                  </CardContent>
                </Card>

                {personnel && (
                  <Card className="rounded-[28px] border-none bg-gradient-to-r from-sky-50 to-cyan-50 shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-xl font-black text-slate-900">Workflow People</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-white p-4 shadow-sm">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted By</p>
                        <p className="mt-1 font-semibold text-slate-900">{personnel.createdBy}</p>
                        {personnel.createdByEmail && <p className="text-xs text-slate-500">{personnel.createdByEmail}</p>}
                      </div>
                      {personnel.purchaseManager && (
                        <div className="rounded-2xl bg-white p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase Manager</p>
                          <p className="mt-1 font-semibold text-slate-900">{personnel.purchaseManager}</p>
                          {personnel.purchaseManagerEmail && <p className="text-xs text-slate-500">{personnel.purchaseManagerEmail}</p>}
                        </div>
                      )}
                      {personnel.eaApprover && (
                        <div className="rounded-2xl bg-white p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">EA Review</p>
                          <p className="mt-1 font-semibold text-slate-900">{personnel.eaApprover}</p>
                          {personnel.eaApproverEmail && <p className="text-xs text-slate-500">{personnel.eaApproverEmail}</p>}
                        </div>
                      )}
                      {personnel.mdApprover && (
                        <div className="rounded-2xl bg-white p-4 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MD Review</p>
                          <p className="mt-1 font-semibold text-slate-900">{personnel.mdApprover}</p>
                          {personnel.mdApproverEmail && <p className="text-xs text-slate-500">{personnel.mdApproverEmail}</p>}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {selectedOrder.supportingImages && selectedOrder.supportingImages.length > 0 && (
                  <ImageGallery images={selectedOrder.supportingImages} title="Initial Request Images" orderId={selectedOrder.id} />
                )}
                <VendorInformationSummary
                  orderId={selectedOrder.id}
                  vendorName={normalizeVendorName(selectedOrder) === 'Awaiting vendor details' ? '' : normalizeVendorName(selectedOrder)}
                  vendorImages={selectedOrder.vendorImages || []}
                  vendorOptions={normalizeVendorDetails(selectedOrder)}
                  billImages={normalizeBillImages(selectedOrder)}
                />
                {normalizeVendorDetails(selectedOrder).length === 0 && selectedOrder.vendorImages && selectedOrder.vendorImages.length > 0 && (
                  <ImageGallery images={selectedOrder.vendorImages} title="Vendor Quotations" orderId={selectedOrder.id} />
                )}
                {selectedOrder.grnImages && selectedOrder.grnImages.length > 0 && (
                  <ImageGallery images={selectedOrder.grnImages} title="GRN Documents" orderId={selectedOrder.id} />
                )}
                {selectedOrder.accountsImages && selectedOrder.accountsImages.length > 0 && (
                  <ImageGallery images={selectedOrder.accountsImages} title="Accounts Documents" orderId={selectedOrder.id} />
                )}

                <WorkflowTimeline history={workflowHistory} currentStatus={selectedOrder.status} />

                {renderVendorInfoSection(selectedOrder)}
                {renderGrnEditSection(selectedOrder)}
                {renderActionPanel(selectedOrder)}
              </>
            )}
          </div>
        )}

        {!showNewOrderForm && !selectedOrder && (
          <>
            {(userRole === 'ea' || userRole === 'md') ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 rounded-[28px] border border-[var(--dashboard-primary-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--dashboard-primary)_10%,white),color-mix(in_srgb,var(--dashboard-primary-light)_18%,white))] p-6 shadow-xl shadow-[color-mix(in_srgb,var(--dashboard-primary)_12%,transparent)] lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl font-black text-[var(--dashboard-action-bg)]">
                      {userRole === 'ea' ? 'EA Approval Dashboard' : 'MD Approval Dashboard'}
                    </h1>
                    <p className="mt-1 font-semibold text-slate-600">
                      {listedOrders.length} purchase order{listedOrders.length !== 1 ? 's' : ''} in {approvalFilter} view
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => window.location.reload()}
                      variant="outline"
                      className="app-outline-action rounded-2xl"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                    <Button
                      onClick={toggleViewMode}
                      variant="outline"
                      className="app-primary-action rounded-2xl px-5 font-black shadow-lg"
                    >
                      {isSwitchingView ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Switching...
                        </>
                      ) : activeViewMode === 'table' ? (
                        <>
                          <LayoutGrid className="mr-2 h-4 w-4" />
                          Card View
                        </>
                      ) : (
                        <>
                          <Table className="mr-2 h-4 w-4" />
                          Table View
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 rounded-2xl border border-[var(--dashboard-primary-border)] bg-white/80 p-3 shadow-sm backdrop-blur-xl">
                  {userRole === 'md' && (
                    <div className="mr-1 flex min-w-[220px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Branch</span>
                      <Select value={approvalBranchFilter} onValueChange={setApprovalBranchFilterPreference}>
                        <SelectTrigger className="h-9 flex-1 rounded-lg border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-none">
                          <SelectValue placeholder="All Branches" />
                        </SelectTrigger>
                        <SelectContent className="z-[100] rounded-xl border-slate-100 bg-white shadow-2xl">
                          <SelectItem value="all" className="text-xs font-bold">All Branches</SelectItem>
                          {BRANCH_OPTIONS.map((branch) => (
                            <SelectItem key={branch.value} value={branch.value} className="text-xs font-bold">
                              {branch.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {APPROVAL_FILTER_OPTIONS.map((option) => {
                    const isActive = approvalFilter === option.value
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={isActive ? 'default' : 'outline'}
                        onClick={() => setApprovalFilterPreference(option.value)}
                        className={`rounded-xl font-bold ${isActive ? 'app-primary-action' : 'app-outline-action'}`}
                      >
                        {option.label}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-[var(--dashboard-action-fg)]' : 'bg-[var(--dashboard-primary-soft)] text-[var(--dashboard-action-bg)]'}`}>
                          {getApprovalFilterCount(option.value)}
                        </span>
                      </Button>
                    )
                  })}
                </div>

                {renderPurchaseOrderPaginationControls()}

                {(approvalFilter === 'completed' || workflowStageFilter === 'completed' || workflowStageFilter === 'grn_completed') && renderCompletedAnalyticsControls()}

                <div className="animate-in fade-in duration-200">
                {isListRefreshing ? (
                  renderApprovalListSkeleton()
                ) : activeViewMode === 'table' ? (
                  <MDTableView
                    orders={listedOrders}
                    onApprove={async (orderId, remarks) => {
                      await handleStageSubmit(
                        userRole === 'ea' ? 'ea_approval' : 'md_approval',
                        { action: 'approve', remarks: remarks || '' },
                        orderId
                      )
                    }}
                    onDeny={async (orderId, remarks) => {
                      await handleStageSubmit(
                        userRole === 'ea' ? 'ea_approval' : 'md_approval',
                        { action: 'deny', remarks },
                        orderId
                      )
                    }}
                    onHold={handleHold}
                    onBulkAction={handleBulkActionSelected}
                    onOrderClick={async (order) => openOrderDetails(order.id)}
                    canActOnOrder={(order) => isActionableApprovalOrder(order, userRole)}
                    loading={isBulkProcessing || isListRefreshing}
                  />
                ) : (
                  <MDGridView
                    orders={listedOrders}
                    personnel={allPersonnel}
                    onApprove={(orderId) =>
                      handleStageSubmit(userRole === 'ea' ? 'ea_approval' : 'md_approval', { action: 'approve', remarks: '' }, orderId)
                    }
                    onDeny={(orderId, remarks) =>
                      handleStageSubmit(userRole === 'ea' ? 'ea_approval' : 'md_approval', { action: 'deny', remarks }, orderId)
                    }
                    onHold={(orderId, remarks) =>
                      handleStageSubmit(userRole === 'ea' ? 'ea_approval' : 'md_approval', { action: 'hold', remarks }, orderId)
                    }
                    onBulkAction={handleBulkActionSelected}
                    onViewDetails={async (order) => openOrderDetails(order.id)}
                    canActOnOrder={(order) => isActionableApprovalOrder(order, userRole)}
                    dashboardTitle={userRole === 'ea' ? 'EA Approval Dashboard' : 'MD Approval Dashboard'}
                    dashboardSubtitle={
                      `${listedOrders.length} purchase order${listedOrders.length !== 1 ? 's' : ''} in ${approvalFilter} view`
                    }
                    pendingStatus={userRole === 'ea' ? 'awaiting_ea_approval' : 'awaiting_md_approval'}
                    holdStatus={userRole === 'ea' ? 'ea_on_hold' : 'md_on_hold'}
                    rejectedStatus={userRole === 'ea' ? 'ea_denied' : 'md_denied'}
                    showHeader={false}
                    reviewerLabel={userRole === 'ea' ? 'Purchase Manager' : 'EA Review'}
                    emptyMessage={userRole === 'ea' ? 'No purchase orders found for this EA filter' : 'No purchase orders found for this MD filter'}
                    isLoading={isBulkProcessing || isListRefreshing}
                  />
                )}
                </div>
              </div>
            ) : showPOTableView && canViewPurchaseOrderTable ? (
              <POTableView
                orders={poTableOrders}
                totalOrders={purchaseOrderPagination.total}
                listMode={purchaseOrderListMode}
                isLoading={isListRefreshing}
                onOrderClick={async (order) => openOrderDetails(order.id)}
              />
            ) : (
              <Card className="rounded-[28px] border-none shadow-sm">
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <CardTitle className="text-2xl font-black text-slate-900">
                    {isCompletionTrackingView ? 'Spending & Completion Tracking' : queueTitle}
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    {isCompletionTrackingView
                      ? 'GRN completed orders count toward spend while Accounts can still finish closure.'
                      : 'Only purchase orders relevant to your role are shown here.'}
                  </p>
                </CardHeader>
                <CardContent>
                  {isListRefreshing ? (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                      {Array.from({ length: PURCHASE_ORDER_PAGE_SIZE }).map((_, index) => (
                        <WorkflowStatusCardSkeleton key={`po-list-refresh-skeleton-${index}`} />
                      ))}
                    </div>
                  ) : listedOrders.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">
                      {isCompletionTrackingView ? 'No spending records found' : 'No purchase orders found in your queue'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                      {listedOrders.map((order) => {
                        const isLoadingThisOrder = loadingOrderId === order.id
                        const orderPersonnel = allPersonnel.get(order.id)
                        const normalizedStage = formatWorkflowStageLabel(normalizeStage(order))
                        const statusPresentation = getWorkflowStatusPresentation(order.status || '')

                        return (
                          <div key={order.id} className="relative">
                            {isLoadingThisOrder && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[24px] bg-white/15 backdrop-blur-md">
                                <div className="flex flex-col items-center gap-2">
                                  <Loader2 className="h-10 w-10 animate-spin text-white" />
                                  <p className="text-sm font-semibold text-white">Loading details...</p>
                                </div>
                              </div>
                            )}
                            <WorkflowStatusCard
                              orderNumber={normalizeOrderNumber(order)}
                              statusLabel={statusPresentation.label}
                              stageLabel={normalizedStage}
                              description={normalizeDescription(order)}
                              departmentLine={normalizeDepartmentLine(order)}
                              timestampLabel={formatIndiaDateTime(order.created_at || order.createdAt)}
                              tone={statusPresentation.tone}
                              onClick={() => {
                                if (!isLoadingThisOrder) {
                                  void openOrderDetails(order.id)
                                }
                              }}
                              metrics={[
                                {
                                  label: 'Requested By',
                                  value: normalizeRequestedBy(order),
                                  icon: 'requester',
                                },
                                {
                                  label: 'Assigned To',
                                  value: getAssignedStageLabel(order, orderPersonnel),
                                  icon: 'assignee',
                                },
                                {
                                  label: 'Quantity',
                                  value: normalizeQuantity(order),
                                  icon: 'quantity',
                                },
                                {
                                  label: 'Workflow',
                                  value: normalizedStage,
                                  icon: 'time',
                                },
                              ]}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </MainLayout>
  )
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense
      fallback={(
        <MainLayout>
          <div className="flex h-96 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        </MainLayout>
      )}
    >
      <PurchaseOrdersPageContent />
    </Suspense>
  )
}

