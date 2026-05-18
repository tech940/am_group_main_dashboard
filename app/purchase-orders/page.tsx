'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import { ArrowLeft, Loader2, Plus, RefreshCw, LayoutGrid, Table } from 'lucide-react'
import { MainLayout } from '@/components/layout/main-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageGallery } from '@/components/purchase-orders/image-gallery'
import { MDGridView } from '@/components/purchase-orders/md-grid-view'
import { MDTableView } from '@/components/purchase-orders/md-table-view'
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
import { createClient } from '@/lib/supabase/client'

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
  supportingImages?: string[]
  vendorImages?: string[]
  grnImages?: string[]
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
}

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
  grnImages?: Array<File | string>
  accountsImages?: Array<File | string>
}

type ApprovalFilter = 'all' | 'pending' | 'rejected' | 'hold' | 'completed'

const APPROVAL_FILTER_OPTIONS: Array<{ value: ApprovalFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'hold', label: 'Hold' },
  { value: 'completed', label: 'Completed' },
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

function normalizeOrderAmount(order: PurchaseOrder) {
  const rawAmount = order.amount || normalizeEstimate(order)
  const numericAmount = Number.parseFloat(String(rawAmount || '0').replace(/[^0-9.-]/g, ''))

  return Number.isFinite(numericAmount) ? numericAmount : 0
}

function getCompletedDate(order: PurchaseOrder) {
  const rawDate = order.completed_at || order.completedAt || order.created_at || order.createdAt
  const parsedDate = rawDate ? new Date(rawDate) : null

  return parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null
}

function isCompletedInDateRange(order: PurchaseOrder, startDate: string, endDate: string) {
  if (order.status !== 'completed') {
    return false
  }

  const completedDate = getCompletedDate(order)
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
  const router = useRouter()
  const searchParams = useSearchParams()
  const topLoader = useTopLoader()
  const topLoaderRef = useRef(topLoader)
  const activeOrderRequestRef = useRef<AbortController | null>(null)
  const viewSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempUploadCounterRef = useRef(0)
  const selectedOrderId = searchParams.get('orderId')

  const [userRole, setUserRole] = useState('')
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryItem[]>([])
  const [personnel, setPersonnel] = useState<Personnel | null>(null)
  const [allPersonnel, setAllPersonnel] = useState<Map<string, Personnel>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNewOrderForm, setShowNewOrderForm] = useState(false)
  const [isNewOrderDirty, setIsNewOrderDirty] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [isSwitchingView, setIsSwitchingView] = useState(false)

  // View mode preference for MD/EA users
  const { value: viewMode, savePreference: saveViewMode, setValue: setViewModePreference } = usePurchaseOrdersViewPreference()
  const activeViewMode = viewMode.viewMode || 'table'
  const approvalFilter: ApprovalFilter = viewMode.approvalFilter || 'pending'
  const completedDateStart = viewMode.completedDateStart || ''
  const completedDateEnd = viewMode.completedDateEnd || ''

  const canCreateOrders = userRole === 'admin' || userRole === 'purchase_manager'
  const canManageVendorInfo = canCreateOrders
  const canApproveEA = userRole === 'admin' || userRole === 'ea'
  const canApproveMD = userRole === 'admin' || userRole === 'md'
  const canSubmitGRN = canCreateOrders
  const canProcessAccounts = userRole === 'admin' || userRole === 'accounts'

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

  const listedOrders = useMemo(() => {
    const completedMatchesRange = (order: PurchaseOrder) =>
      isCompletedInDateRange(order, completedDateStart, completedDateEnd)

    if (isApprovalRole(userRole)) {
      const statusSet = getApprovalStatusSet(userRole)

      switch (approvalFilter) {
        case 'all':
          return orders.filter((order) => !isRejectedWorkflowStatus(order.status) && order.status !== 'cancelled')
        case 'pending':
          return orders.filter((order) => order.status === statusSet.pending)
        case 'rejected':
          return orders.filter((order) => order.status === statusSet.rejected || order.status === statusSet.extraRejected)
        case 'hold':
          return orders.filter((order) => order.status === statusSet.hold || order.status === statusSet.extraHold)
        case 'completed':
          return orders.filter(completedMatchesRange)
        default:
          return orders.filter((order) => order.status === statusSet.pending)
      }
    }

    if (showCompleted) {
      return orders.filter(completedMatchesRange)
    }

    switch (userRole) {
      case 'accounts':
        return orders.filter((order) => order.status === 'awaiting_accounts')
      case 'admin':
        return orders.filter((order) => order.status !== 'completed')
      default:
        return orders.filter((order) => order.status !== 'completed')
    }
  }, [approvalFilter, completedDateEnd, completedDateStart, orders, showCompleted, userRole])

  const listedCompletedOrders = useMemo(
    () => listedOrders.filter((order) => order.status === 'completed'),
    [listedOrders]
  )

  const listedCompletedSpend = useMemo(
    () => listedCompletedOrders.reduce((total, order) => total + normalizeOrderAmount(order), 0),
    [listedCompletedOrders]
  )

  const fetchUserRole = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/user')
      if (!response.ok) {
        return
      }

      const data = await response.json()
      setUserRole(data.role || '')
    } catch (error) {
      console.error('Error fetching user role:', error)
    }
  }, [])

  const fetchOrders = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) {
        setIsLoading(true)
      }
      const response = await fetch('/api/purchase-orders')
      if (!response.ok) {
        return
      }

      const data = await response.json()
      setOrders(data.orders || [])
      setAllPersonnel(new Map())
    } catch (error) {
      console.error('Error fetching orders:', error)
    } finally {
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchUserRole()
      void fetchOrders()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [fetchOrders, fetchUserRole])

  useEffect(() => {
    topLoaderRef.current = topLoader
  }, [topLoader])

  useEffect(() => {
    if (!showNewOrderForm || !isNewOrderDirty) {
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
  }, [isNewOrderDirty, showNewOrderForm])

  const fetchOrderDetails = useCallback(async (orderId: string): Promise<void> => {
    activeOrderRequestRef.current?.abort()
    const controller = new AbortController()
    activeOrderRequestRef.current = controller

    try {
      topLoaderRef.current.start()
      setIsLoadingDetails(true)
      setLoadingOrderId(orderId)
      const response = await fetch(`/api/purchase-orders/workflow?orderId=${orderId}`, {
        signal: controller.signal,
      })

      if (!response.ok) {
        if (response.status === 404) {
          router.push('/purchase-orders')
        }
        return
      }

      const data = await response.json()
      setSelectedOrder(data.order)
      setWorkflowHistory(data.history || [])
      setPersonnel(data.personnel || null)
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
  }, [router])

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
          void fetchOrders(false)
          if (selectedOrderId) {
            void fetchOrderDetails(selectedOrderId)
          }
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchOrderDetails, fetchOrders, selectedOrderId])

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
    setSelectedOrder(null)
    setWorkflowHistory([])
    setPersonnel(null)
    router.push('/purchase-orders')
  }

  const closeNewOrderForm = () => {
    if (isNewOrderDirty && !window.confirm('You have unsaved changes. Are you sure you want to leave?')) {
      return
    }

    setShowNewOrderForm(false)
    setIsNewOrderDirty(false)
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

      const uploadFormData = new FormData()
      uploadFormData.append('file', file)
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
      urls.push(uploadResult.path || uploadResult.url)
    }

    return urls
  }

  const handleStageSubmit = async (stage: string, formData: object, orderId?: string) => {
    try {
      setIsSubmitting(true)
      const stagePayload = { ...(formData as PurchaseOrderStagePayload) }
      tempUploadCounterRef.current += 1
      const currentOrderId = orderId || selectedOrder?.id || `temp-${tempUploadCounterRef.current}`

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
          orderId: orderId || selectedOrder?.id,
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

      await fetchOrders()
      setShowNewOrderForm(false)
      setIsNewOrderDirty(false)
      setSelectedOrder(null)
      setWorkflowHistory([])
      setPersonnel(null)
      router.push('/purchase-orders')
      alert('Successfully submitted!')
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
      await fetchOrders()
      const doneLabel = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'held'
      alert(`Successfully ${doneLabel} ${result.count} order${result.count !== 1 ? 's' : ''}!`)
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
    void saveViewMode({
      ...viewMode,
      approvalFilter: filter,
    })
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
    <div className="flex flex-col gap-4 rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm xl:flex-row xl:items-center xl:justify-between">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Completed Spend</p>
        <p className="text-2xl font-black text-slate-900">
          Rs. {listedCompletedSpend.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </p>
        <p className="text-xs text-slate-500">
          {listedCompletedOrders.length} completed order{listedCompletedOrders.length !== 1 ? 's' : ''} in view
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Start Date
          <input
            type="date"
            value={completedDateStart}
            onChange={(event) => setCompletedDatePreference('completedDateStart', event.target.value)}
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          End Date
          <input
            type="date"
            value={completedDateEnd}
            onChange={(event) => setCompletedDatePreference('completedDateEnd', event.target.value)}
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-500"
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

    const statusSet = getApprovalStatusSet(userRole)
    switch (filter) {
      case 'all':
        return orders.filter((order) => !isRejectedWorkflowStatus(order.status) && order.status !== 'cancelled').length
      case 'pending':
        return orders.filter((order) => order.status === statusSet.pending).length
      case 'rejected':
        return orders.filter((order) => order.status === statusSet.rejected || order.status === statusSet.extraRejected).length
      case 'hold':
        return orders.filter((order) => order.status === statusSet.hold || order.status === statusSet.extraHold).length
      case 'completed':
        return orders.filter((order) => isCompletedInDateRange(order, completedDateStart, completedDateEnd)).length
      default:
        return 0
    }
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

  const renderCompletedSummary = (order: PurchaseOrder) => (
    <Card className="rounded-[28px] border-none shadow-xl">
      <CardHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
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
    if (!canManageVendorInfo || hasVendorInformation(order) || order.status === 'completed' || order.status === 'cancelled') {
      return null
    }

    return (
      <Stage2VendorInformation
        orderId={order.id}
        initialData={{
          vendorName: normalizeVendorName(order) === 'Awaiting vendor details' ? '' : normalizeVendorName(order),
          vendorImages: order.vendorImages || [],
          vendorOptions: normalizeVendorDetails(order),
        }}
        onSubmit={(data) => handleStageSubmit('vendor_information', data, order.id)}
        isLoading={isSubmitting}
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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
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
              <Button
                onClick={() => setShowCompleted((value) => !value)}
                variant="outline"
                className="rounded-2xl border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                {showCompleted ? 'Show Active' : 'Show Completed'}
              </Button>
              <Button
                onClick={() => void fetchOrders()}
                variant="outline"
                className="rounded-2xl border-slate-300 hover:bg-slate-50"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              {canCreateOrders && (
                <Button
                  onClick={() => setShowNewOrderForm(true)}
                  className="rounded-2xl border border-teal-300 bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-lg shadow-emerald-100 hover:from-teal-700 hover:to-emerald-700"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  New Order
                </Button>
              )}
            </div>
          </div>
        )}

        {userRole !== 'md' && userRole !== 'ea' && showCompleted && renderCompletedAnalyticsControls()}

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
                    <Loader2 className="h-12 w-12 animate-spin text-teal-500" />
                    <p className="font-medium text-gray-600">Loading purchase order details...</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card className="rounded-[28px] border-none shadow-xl">
                  <CardHeader className="bg-gradient-to-r from-slate-900 to-teal-800 text-white">
                    <CardTitle className="text-2xl font-black">
                      Purchase Order Details - {normalizeOrderNumber(selectedOrder)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
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
                {renderActionPanel(selectedOrder)}
              </>
            )}
          </div>
        )}

        {!showNewOrderForm && !selectedOrder && (
          <>
            {(userRole === 'ea' || userRole === 'md') ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-4 rounded-[28px] bg-gradient-to-r from-teal-700 to-emerald-700 p-6 text-white shadow-xl lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl font-black">
                      {userRole === 'ea' ? 'EA Approval Dashboard' : 'MD Approval Dashboard'}
                    </h1>
                    <p className="mt-1 text-teal-50">
                      {listedOrders.length} purchase order{listedOrders.length !== 1 ? 's' : ''} in {approvalFilter} view
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => void fetchOrders()}
                      variant="outline"
                      className="rounded-2xl border-white/50 bg-white/10 text-white hover:bg-white/20"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                    <Button
                      onClick={toggleViewMode}
                      variant="outline"
                      className="rounded-2xl border-white/50 bg-white text-emerald-800 hover:bg-emerald-50"
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

                <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {APPROVAL_FILTER_OPTIONS.map((option) => {
                    const isActive = approvalFilter === option.value
                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={isActive ? 'default' : 'outline'}
                        onClick={() => setApprovalFilterPreference(option.value)}
                        className={`rounded-xl ${isActive ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                      >
                        {option.label}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {getApprovalFilterCount(option.value)}
                        </span>
                      </Button>
                    )
                  })}
                </div>

                {approvalFilter === 'completed' && renderCompletedAnalyticsControls()}

                <div className="animate-in fade-in duration-200">
                {activeViewMode === 'table' ? (
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
                    loading={isBulkProcessing}
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
                    isLoading={isBulkProcessing}
                  />
                )}
                </div>
              </div>
            ) : (
              <Card className="rounded-[28px] border-none shadow-sm">
                <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <CardTitle className="text-2xl font-black text-slate-900">
                    {showCompleted ? 'Completed Orders' : queueTitle}
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    {showCompleted
                      ? 'Historical purchase orders that have completed the workflow.'
                      : 'Only purchase orders relevant to your role are shown here.'}
                  </p>
                </CardHeader>
                <CardContent>
                  {listedOrders.length === 0 ? (
                    <p className="py-8 text-center text-gray-500">
                      {showCompleted ? 'No completed orders found' : 'No purchase orders found in your queue'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
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
