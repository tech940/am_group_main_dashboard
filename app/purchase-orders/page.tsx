'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MainLayout } from '@/components/layout/main-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Stage1InitialSubmission } from '@/components/purchase-orders/stage1-initial-submission'
import { Stage2VendorInformation } from '@/components/purchase-orders/stage2-vendor-information'
import { Stage3EAApproval } from '@/components/purchase-orders/stage3-ea-approval'
import { Stage3MDApproval } from '@/components/purchase-orders/stage3-md-approval'
import { Stage4GRN } from '@/components/purchase-orders/stage4-grn'
import { Stage5Accounts } from '@/components/purchase-orders/stage5-accounts'
import { WorkflowTimeline } from '@/components/purchase-orders/workflow-timeline'
import { ImageGallery } from '@/components/purchase-orders/image-gallery'
import { MDGridView } from '@/components/purchase-orders/md-grid-view'
import { Plus, Loader2, RefreshCw } from 'lucide-react'

interface PurchaseOrder {
  id: string
  orderNumber: string
  department: string
  subDepartment: string
  requestedBy: string
  specialInstructions: string
  quantityRequired: string
  estimateIfAny?: string
  vendorName?: string
  currentStage: string
  status: string
  createdAt: string
  eaApprovalRemarks?: string
  mdApprovalRemarks?: string
  amount?: string
  // Image arrays
  supportingImages?: string[]
  vendorImages?: string[]
  grnImages?: string[]
  accountsImages?: string[]
  // Additional fields
  reqType?: string
  specifyOther?: string
  imagesRequired?: boolean
  quotation1Url?: string
  quotation2Url?: string
  quotation3Url?: string
  invoice1Url?: string
  invoice2Url?: string
  invoice3Url?: string
  invoice4Url?: string
  paymentScreenshotUrl?: string
  receivedDateTime?: string
  handoverTo?: string
  remarksIfAny?: string
  paymentStatus?: string
  paymentMode?: string
  accountRemarks?: string
  eaApprovalStatus?: string
  mdApprovalStatus?: string
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
  metadata?: Record<string, any>
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

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [userRole, setUserRole] = useState<string>('')
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null)
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowHistoryItem[]>([])
  const [personnel, setPersonnel] = useState<Personnel | null>(null)
  const [allPersonnel, setAllPersonnel] = useState<Map<string, Personnel>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showNewOrderForm, setShowNewOrderForm] = useState(false)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  const [loadingOrderId, setLoadingOrderId] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    fetchUserRole()
    fetchOrders()
  }, [])

  const fetchUserRole = async () => {
    try {
      const response = await fetch('/api/auth/user')
      if (response.ok) {
        const data = await response.json()
        setUserRole(data.role)
      }
    } catch (error) {
      console.error('Error fetching user role:', error)
    }
  }

  const fetchOrders = async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/purchase-orders')
      if (response.ok) {
        const data = await response.json()
        const fetchedOrders = data.orders || []
        setOrders(fetchedOrders)
        
        // Fetch personnel data for all orders
        const personnelMap = new Map<string, Personnel>()
        for (const order of fetchedOrders) {
          try {
            const detailsResponse = await fetch(`/api/purchase-orders/workflow?orderId=${order.id}`)
            if (detailsResponse.ok) {
              const detailsData = await detailsResponse.json()
              if (detailsData.personnel) {
                personnelMap.set(order.id, detailsData.personnel)
              }
            }
          } catch (err) {
            console.error(`Error fetching personnel for order ${order.id}:`, err)
          }
        }
        setAllPersonnel(personnelMap)
      }
    } catch (error) {
      console.error('Error fetching orders:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchOrderDetails = async (orderId: string): Promise<void> => {
    try {
      setIsLoadingDetails(true)
      setLoadingOrderId(orderId)
      const response = await fetch(`/api/purchase-orders/workflow?orderId=${orderId}`)
      if (response.ok) {
        const data = await response.json()
        setSelectedOrder(data.order)
        setWorkflowHistory(data.history || [])
        setPersonnel(data.personnel || null)
      }
    } catch (error) {
      console.error('Error fetching order details:', error)
    } finally {
      setIsLoadingDetails(false)
      setLoadingOrderId(null)
    }
  }

  const handleStageSubmit = async (stage: string, formData: any, orderId?: string) => {
    try {
      setIsSubmitting(true)
      
      // Upload images if present
      const uploadedImageUrls: string[] = []
      const currentOrderId = orderId || selectedOrder?.id || 'temp-' + Date.now()
      
      // Handle supportingImages (Stage 1)
      if (formData.supportingImages && Array.isArray(formData.supportingImages) && formData.supportingImages.length > 0) {
        console.log('Uploading supporting images:', formData.supportingImages.length)
        for (const file of formData.supportingImages) {
          if (file instanceof File) {
            const uploadFormData = new FormData()
            uploadFormData.append('file', file)
            uploadFormData.append('folder', 'supporting-images')
            uploadFormData.append('orderId', currentOrderId)
            
            const uploadResponse = await fetch('/api/purchase-orders/upload', {
              method: 'POST',
              body: uploadFormData
            })
            
            if (uploadResponse.ok) {
              const uploadResult = await uploadResponse.json()
              uploadedImageUrls.push(uploadResult.url)
              console.log('Uploaded image:', uploadResult.url)
            } else {
              console.error('Failed to upload image:', await uploadResponse.text())
            }
          }
        }
        formData.supportingImages = uploadedImageUrls
      }
      
      // Handle vendorImages (Stage 2)
      if (formData.vendorImages && Array.isArray(formData.vendorImages) && formData.vendorImages.length > 0) {
        const vendorImageUrls: string[] = []
        for (const file of formData.vendorImages) {
          if (file instanceof File) {
            const uploadFormData = new FormData()
            uploadFormData.append('file', file)
            uploadFormData.append('folder', 'vendor-images')
            uploadFormData.append('orderId', currentOrderId)
            
            const uploadResponse = await fetch('/api/purchase-orders/upload', {
              method: 'POST',
              body: uploadFormData
            })
            
            if (uploadResponse.ok) {
              const uploadResult = await uploadResponse.json()
              vendorImageUrls.push(uploadResult.url)
            }
          }
        }
        formData.vendorImages = vendorImageUrls
      }
      
      // Handle grnImages (Stage 4)
      if (formData.grnImages && Array.isArray(formData.grnImages) && formData.grnImages.length > 0) {
        const grnImageUrls: string[] = []
        for (const file of formData.grnImages) {
          if (file instanceof File) {
            const uploadFormData = new FormData()
            uploadFormData.append('file', file)
            uploadFormData.append('folder', 'grn-images')
            uploadFormData.append('orderId', currentOrderId)
            
            const uploadResponse = await fetch('/api/purchase-orders/upload', {
              method: 'POST',
              body: uploadFormData
            })
            
            if (uploadResponse.ok) {
              const uploadResult = await uploadResponse.json()
              grnImageUrls.push(uploadResult.url)
            }
          }
        }
        formData.grnImages = grnImageUrls
      }
      
      // Handle accountsImages (Stage 5)
      if (formData.accountsImages && Array.isArray(formData.accountsImages) && formData.accountsImages.length > 0) {
        const accountsImageUrls: string[] = []
        for (const file of formData.accountsImages) {
          if (file instanceof File) {
            const uploadFormData = new FormData()
            uploadFormData.append('file', file)
            uploadFormData.append('folder', 'accounts-images')
            uploadFormData.append('orderId', currentOrderId)
            
            const uploadResponse = await fetch('/api/purchase-orders/upload', {
              method: 'POST',
              body: uploadFormData
            })
            
            if (uploadResponse.ok) {
              const uploadResult = await uploadResponse.json()
              accountsImageUrls.push(uploadResult.url)
            }
          }
        }
        formData.accountsImages = accountsImageUrls
      }
      
      console.log('Submitting with uploaded images:', formData)
      
      const response = await fetch('/api/purchase-orders/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderId || selectedOrder?.id,
          stage,
          action: formData.action,
          data: formData
        })
      })

      if (response.ok) {
        await fetchOrders()
        setShowNewOrderForm(false)
        setSelectedOrder(null)
        alert('Successfully submitted!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error submitting:', error)
      alert('Failed to submit')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMDApprove = async (orderId: string, remarks?: string) => {
    try {
      setIsSubmitting(true)
      const response = await fetch('/api/purchase-orders/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          stage: 'md_approval',
          action: 'approve',
          data: { action: 'approve', remarks: remarks || '' }
        })
      })

      if (response.ok) {
        await fetchOrders()
        alert('Order approved successfully!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error approving:', error)
      alert('Failed to approve')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMDDeny = async (orderId: string, remarks: string) => {
    try {
      setIsSubmitting(true)
      const response = await fetch('/api/purchase-orders/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          stage: 'md_approval',
          action: 'deny',
          data: { action: 'deny', remarks }
        })
      })

      if (response.ok) {
        await fetchOrders()
        alert('Order denied successfully!')
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error denying:', error)
      alert('Failed to deny')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleMDApproveAll = async () => {
    const pendingOrders = orders.filter(o => o.status === 'awaiting_md_approval')
    if (pendingOrders.length === 0) return

    const confirmed = confirm(`Are you sure you want to approve all ${pendingOrders.length} pending orders?`)
    if (!confirmed) return

    try {
      setIsBulkProcessing(true)
      const orderIds = pendingOrders.map(o => o.id)
      
      const response = await fetch('/api/purchase-orders/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds,
          action: 'approve',
          remarks: 'Bulk approved by MD'
        })
      })

      if (response.ok) {
        const result = await response.json()
        await fetchOrders()
        alert(`Successfully approved ${result.count} orders!`)
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error in bulk approve:', error)
      alert('Failed to approve orders')
    } finally {
      setIsBulkProcessing(false)
    }
  }

  const handleMDDenyAll = async () => {
    const pendingOrders = orders.filter(o => o.status === 'awaiting_md_approval')
    if (pendingOrders.length === 0) return

    const remarks = prompt('Please provide a reason for denying all orders:')
    if (!remarks) {
      alert('Remarks are required for denial')
      return
    }

    const confirmed = confirm(`Are you sure you want to deny all ${pendingOrders.length} pending orders?`)
    if (!confirmed) return

    try {
      setIsBulkProcessing(true)
      const orderIds = pendingOrders.map(o => o.id)
      
      const response = await fetch('/api/purchase-orders/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds,
          action: 'deny',
          remarks
        })
      })

      if (response.ok) {
        const result = await response.json()
        await fetchOrders()
        alert(`Successfully denied ${result.count} orders!`)
      } else {
        const error = await response.json()
        alert(`Error: ${error.error}`)
      }
    } catch (error) {
      console.error('Error in bulk deny:', error)
      alert('Failed to deny orders')
    } finally {
      setIsBulkProcessing(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      submitted: 'bg-blue-500 text-white',
      vendor_info_pending: 'bg-yellow-500 text-white',
      awaiting_ea_approval: 'bg-purple-500 text-white',
      awaiting_md_approval: 'bg-indigo-500 text-white',
      ea_denied: 'bg-red-500 text-white',
      md_denied: 'bg-red-500 text-white',
      awaiting_grn: 'bg-teal-500 text-white',
      awaiting_accounts: 'bg-emerald-500 text-white',
      completed: 'bg-green-500 text-white'
    }
    return colors[status] || 'bg-gray-500 text-white'
  }

  const canUserAccessStage = (order: PurchaseOrder): boolean => {
    const stage = order.currentStage
    const role = userRole

    if (role === 'admin') return true

    const stageRoleMap: Record<string, string[]> = {
      initial_submission: ['manager', 'technician', 'viewer'],
      vendor_information: ['purchase_manager'],
      ea_approval: ['ea'], // Only EA can access
      md_approval: ['md'], // Only MD can access
      grn: ['purchase_manager'],
      accounts: ['accounts']
    }

    // Explicitly prevent purchase_manager from accessing EA and MD approval stages
    if (role === 'purchase_manager' && (stage === 'ea_approval' || stage === 'md_approval')) {
      return false
    }

    return stageRoleMap[stage]?.includes(role) || false
  }

  const renderStageComponent = (order: PurchaseOrder) => {
    console.log('Full Order Data:', order)
    console.log('User Role:', userRole)
    console.log('Order Stage:', order.currentStage)
    console.log('Order Status:', order.status)

    const commonProps = {
      orderId: order.id,
      isLoading: isSubmitting
    }

    // Handle null/empty currentStage - check status to determine stage
    const currentStage = order.currentStage ||
      (order.status === 'vendor_info_pending' ? 'vendor_information' : null)

    switch (currentStage) {
      case 'initial_submission':
        // Show vendor information form for purchase managers to fill
        if (userRole === 'purchase_manager' || userRole === 'admin') {
          return (
            <Stage2VendorInformation
              {...commonProps}
              onSubmit={(data) => handleStageSubmit('vendor_information', data)}
            />
          )
        }
        // For other users, show a message that it's pending vendor information
        return (
          <Card>
            <CardContent className="p-6">
              <p className="text-center text-gray-600">
                This order is awaiting vendor information from the Purchase Manager.
              </p>
            </CardContent>
          </Card>
        )
      case 'vendor_information':
        return (
          <Stage2VendorInformation
            {...commonProps}
            onSubmit={(data) => handleStageSubmit('vendor_information', data)}
          />
        )
      case 'ea_approval':
        return (
          <Stage3EAApproval
            {...commonProps}
            orderDetails={{
              itemName: order.specialInstructions,
              department: order.department,
              subDepartment: order.subDepartment,
              quantity: parseInt(order.quantityRequired) || 0,
              estimatedCost: parseFloat(order.estimateIfAny || '0'),
              vendorName: order.vendorName || ''
            }}
            onSubmit={(data) => handleStageSubmit('ea_approval', data)}
          />
        )
      case 'md_approval':
        return (
          <Stage3MDApproval
            {...commonProps}
            orderDetails={{
              itemName: order.specialInstructions,
              department: order.department,
              subDepartment: order.subDepartment,
              quantity: parseInt(order.quantityRequired) || 0,
              estimatedCost: parseFloat(order.estimateIfAny || '0'),
              vendorName: order.vendorName || '',
              eaRemarks: order.eaApprovalRemarks
            }}
            onSubmit={(data) => handleStageSubmit('md_approval', data)}
          />
        )
      case 'grn':
        return (
          <Stage4GRN
            {...commonProps}
            orderDetails={{
              itemName: order.specialInstructions,
              quantity: parseInt(order.quantityRequired) || 0,
              vendorName: order.vendorName || ''
            }}
            onSubmit={(data) => handleStageSubmit('grn', data)}
          />
        )
      case 'accounts':
        // If order is completed, show read-only summary
        if (order.status === 'completed') {
          return (
            <Card>
              <CardHeader className="bg-gradient-to-r from-green-500 to-green-600 text-white">
                <CardTitle className="text-2xl font-black">
                  ✓ Order Completed
                </CardTitle>
                <p className="text-sm text-green-50 mt-1">
                  This purchase order has been completed and closed
                </p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6 mb-4">
                  <h3 className="font-bold text-lg text-green-800 mb-4">Completion Summary</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Payment Status</p>
                      <p className="font-semibold text-gray-800">
                        {((order as any).payment_status || order.paymentStatus)?.replace(/_/g, ' ') || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Payment Mode</p>
                      <p className="font-semibold text-gray-800">
                        {((order as any).payment_mode || order.paymentMode)?.replace(/_/g, ' ') || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Completed At</p>
                      <p className="font-semibold text-gray-800">
                        {((order as any).completed_at || order.createdAt) ?
                          new Date((order as any).completed_at || order.createdAt).toLocaleString() : 'N/A'}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Final Amount</p>
                      <p className="font-semibold text-gray-800">
                        ₹{order.amount || (order as any).amount || 'N/A'}
                      </p>
                    </div>
                  </div>
                  {((order as any).account_remarks || order.accountRemarks) && (
                    <div className="mt-4">
                      <p className="text-sm text-gray-600">Remarks</p>
                      <p className="font-medium text-gray-800">
                        {(order as any).account_remarks || order.accountRemarks}
                      </p>
                    </div>
                  )}
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-600">
                    <strong>Note:</strong> This order is closed and cannot be modified. All workflow stages have been completed.
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        }
        // Otherwise show the editable form
        return (
          <Stage5Accounts
            {...commonProps}
            orderDetails={{
              itemName: order.specialInstructions,
              quantity: parseInt(order.quantityRequired) || 0,
              estimatedCost: parseFloat(order.amount || '0'),
              vendorName: order.vendorName || '',
              grnNumber: order.orderNumber,
              receivedQuantity: parseInt(order.quantityRequired) || 0
            }}
            onSubmit={(data) => handleStageSubmit('accounts', data)}
          />
        )
      default:
        return (
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
              <p className="text-center text-gray-600">
                Order completed or in unknown stage
              </p>
              <div className="text-sm text-gray-500 bg-gray-50 p-4 rounded">
                <p><strong>Debug Info:</strong></p>
                <p>Current Stage: {order.currentStage}</p>
                <p>Status: {order.status}</p>
                <p>User Role: {userRole}</p>
              </div>
            </div>
            </CardContent>
          </Card>
        )
    }
  }

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        {userRole !== 'md' && (
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold">Purchase Orders</h1>
              <p className="text-gray-600 mt-1">Manage purchase order workflow</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowCompleted(!showCompleted)}
                variant={showCompleted ? "default" : "outline"}
                className={showCompleted ? "bg-green-600 hover:bg-green-700" : ""}
              >
                {showCompleted ? 'Show All' : 'Show Completed'}
              </Button>
              <Button onClick={fetchOrders} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button onClick={() => setShowNewOrderForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Order
              </Button>
            </div>
          </div>
        )}

        {showNewOrderForm && (
          <Stage1InitialSubmission
            onSubmit={(data) => handleStageSubmit('initial_submission', data)}
            isLoading={isSubmitting}
          />
        )}

        {selectedOrder && (
          <div className="space-y-6">
            <Button onClick={() => setSelectedOrder(null)} variant="outline">
              ← Back to List
            </Button>

            {isLoadingDetails ? (
              <Card>
                <CardContent className="p-12">
                  <div className="flex flex-col items-center justify-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin text-teal-500" />
                    <p className="text-gray-600 font-medium">Loading purchase order details...</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Order Details Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Purchase Order Details - {selectedOrder.orderNumber}</CardTitle>
                  </CardHeader>
                  <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Department</p>
                    <p className="font-medium">{selectedOrder.department || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Sub Department</p>
                    <p className="font-medium">{selectedOrder.subDepartment || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Requested By</p>
                    <p className="font-medium">{selectedOrder.requestedBy || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Quantity Required</p>
                    <p className="font-medium">{selectedOrder.quantityRequired || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Estimate</p>
                    <p className="font-medium">₹{selectedOrder.estimateIfAny || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Current Stage</p>
                    <p className="font-medium">{selectedOrder.currentStage?.replace(/_/g, ' ') || 'N/A'}</p>
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <p className="text-sm text-gray-600">Special Instructions</p>
                    <p className="font-medium">{selectedOrder.specialInstructions || 'N/A'}</p>
                  </div>
                  {selectedOrder.vendorName && (
                    <div>
                      <p className="text-sm text-gray-600">Vendor Name</p>
                      <p className="font-medium">{selectedOrder.vendorName}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Personnel Summary Card */}
            {personnel && (
              <Card className="border-blue-200 bg-blue-50">
                <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                  <CardTitle className="text-xl font-bold flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                    </svg>
                    Personnel Involved
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Submitted By */}
                    <div className="bg-white p-4 rounded-lg border-2 border-blue-200 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="bg-blue-500 text-white rounded-full p-2">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 font-medium">Submitted By</p>
                          <p className="font-semibold text-gray-800">{personnel.createdBy}</p>
                          {personnel.createdByEmail && (
                            <p className="text-xs text-gray-500">{personnel.createdByEmail}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Purchase Manager */}
                    {personnel.purchaseManager && (
                      <div className="bg-white p-4 rounded-lg border-2 border-purple-200 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="bg-purple-500 text-white rounded-full p-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 font-medium">Purchase Manager</p>
                            <p className="font-semibold text-gray-800">{personnel.purchaseManager}</p>
                            {personnel.purchaseManagerEmail && (
                              <p className="text-xs text-gray-500">{personnel.purchaseManagerEmail}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* EA Approver */}
                    {personnel.eaApprover && (
                      <div className="bg-white p-4 rounded-lg border-2 border-green-200 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="bg-green-500 text-white rounded-full p-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 font-medium">EA Approved By</p>
                            <p className="font-semibold text-gray-800">{personnel.eaApprover}</p>
                            {personnel.eaApproverEmail && (
                              <p className="text-xs text-gray-500">{personnel.eaApproverEmail}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* MD Approver */}
                    {personnel.mdApprover && (
                      <div className="bg-white p-4 rounded-lg border-2 border-orange-200 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="bg-orange-500 text-white rounded-full p-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 font-medium">MD Approved By</p>
                            <p className="font-semibold text-gray-800">{personnel.mdApprover}</p>
                            {personnel.mdApproverEmail && (
                              <p className="text-xs text-gray-500">{personnel.mdApproverEmail}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Status indicator */}
                  <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                    <p className="text-sm text-gray-600">
                      <span className="font-semibold">Total Personnel Involved:</span>{' '}
                      {[personnel.createdBy, personnel.purchaseManager, personnel.eaApprover, personnel.mdApprover].filter(Boolean).length} people
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Display all uploaded images */}
            {selectedOrder.supportingImages && selectedOrder.supportingImages.length > 0 && (
              <ImageGallery
                images={selectedOrder.supportingImages}
                title="Initial Request Images"
              />
            )}
            
            {selectedOrder.vendorImages && selectedOrder.vendorImages.length > 0 && (
              <ImageGallery
                images={selectedOrder.vendorImages}
                title="Vendor Quotations"
              />
            )}
            
            {selectedOrder.grnImages && selectedOrder.grnImages.length > 0 && (
              <ImageGallery
                images={selectedOrder.grnImages}
                title="GRN Documents"
              />
            )}
            
            <WorkflowTimeline history={workflowHistory} currentStatus={selectedOrder.status} />
            
                {renderStageComponent(selectedOrder)}
              </>
            )}
          </div>
        )}

        {!showNewOrderForm && !selectedOrder && (
          <>
            {/* MD-specific Grid View */}
            {userRole === 'md' ? (
              <MDGridView
                orders={orders}
                personnel={allPersonnel}
                onApprove={handleMDApprove}
                onDeny={handleMDDeny}
                onApproveAll={handleMDApproveAll}
                onDenyAll={handleMDDenyAll}
                onViewDetails={async (order) => await fetchOrderDetails(order.id)}
                isLoading={isBulkProcessing}
              />
            ) : (
              /* Default List View for other roles */
              <Card>
                <CardHeader>
                  <CardTitle>{showCompleted ? 'Completed Purchase Orders' : 'All Purchase Orders'}</CardTitle>
                </CardHeader>
                <CardContent>
                  {orders.filter(o => showCompleted ? o.status === 'completed' : o.status !== 'completed').length === 0 ? (
                    <p className="text-center text-gray-500 py-8">
                      {showCompleted ? 'No completed orders found' : 'No purchase orders found'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {orders.filter(o => showCompleted ? o.status === 'completed' : o.status !== 'completed').map((order) => {
                        const isLoadingThisOrder = loadingOrderId === order.id
                        return (
                        <Card
                          key={order.id}
                          className="cursor-pointer transition-all hover:shadow-xl border-2 hover:border-teal-300 relative overflow-hidden"
                          onClick={() => !isLoadingThisOrder && fetchOrderDetails(order.id)}
                        >
                          {isLoadingThisOrder && (
                            <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-10">
                              <div className="flex flex-col items-center gap-2">
                                <Loader2 className="h-10 w-10 animate-spin text-teal-600" />
                                <p className="text-sm font-semibold text-teal-600">Loading details...</p>
                              </div>
                            </div>
                          )}
                          <CardContent className="p-5">
                            {/* Header with Order Number and Status */}
                            <div className="flex justify-between items-start mb-3">
                              <h3 className="font-bold text-lg text-gray-800">
                                {(order as any).order_number || order.orderNumber}
                              </h3>
                              <Badge className={`${getStatusColor(order.status)} text-xs px-3 py-1`}>
                                {order.status?.replace(/_/g, ' ').toUpperCase() || 'UNKNOWN'}
                              </Badge>
                            </div>

                            {/* Description */}
                            <p className="text-sm text-gray-700 mb-3 line-clamp-2 min-h-[40px]">
                              {(order as any).special_instructions || order.specialInstructions || 'No description'}
                            </p>

                            {/* Department Info */}
                            <div className="bg-gray-50 rounded-md p-2 mb-3">
                              <p className="text-sm font-semibold text-gray-800">
                                {order.department}
                                {((order as any).sub_department || order.subDepartment) &&
                                  ` - ${(order as any).sub_department || order.subDepartment}`
                                }
                              </p>
                            </div>

                            {/* Quantity and Requested By */}
                            <div className="space-y-1 mb-3">
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">Qty:</span> {(order as any).quantity_required || order.quantityRequired || 'N/A'}
                              </p>
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">Requested by:</span> {(order as any).requested_by || order.requestedBy || 'N/A'}
                              </p>
                            </div>

                            {/* Stage Footer */}
                            <div className="pt-3 border-t border-gray-200">
                              <p className="text-xs text-gray-500">
                                <span className="font-medium">Stage:</span> {((order as any).current_stage || order.currentStage)?.replace(/_/g, ' ') || 'N/A'}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      )})}
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

// Made with Bob

