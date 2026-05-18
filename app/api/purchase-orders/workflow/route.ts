import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { purchaseOrders, workflowHistory } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { orderId, action, stage, data: formData } = body

    // Get user details - need to use supabase_id to find the user
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, role, brand')
      .eq('supabase_id', user.id)
      .single()

    if (userError || !userData) {
      console.error('Error fetching user data:', userError)
      return NextResponse.json({
        error: 'User not found in database. Please contact administrator.',
        details: 'Your account needs to be set up in the users table first.'
      }, { status: 400 })
    }

    const userRole = userData.role

    // Handle initial submission (create new order)
    if (stage === 'initial_submission' && !orderId) {
      // Generate order number
      let orderNumber: string
      try {
        const { data: orderNumberData, error: orderNumberError } = await supabase
          .rpc('generate_order_number')

        if (orderNumberError) {
          console.warn('RPC generate_order_number failed, using fallback:', orderNumberError)
          const datepart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
          orderNumber = `PO-${datepart}-${random}`
        } else {
          orderNumber = orderNumberData
        }
      } catch (rpcError) {
        console.warn('RPC call failed, using fallback order number:', rpcError)
        const datepart = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
        orderNumber = `PO-${datepart}-${random}`
      }

      // Create new purchase order
      const [newOrder] = await db.insert(purchaseOrders).values({
        orderNumber: orderNumber,
        createdBy: userData.id,
        brand: userData.brand || null,
        currentStage: 'vendor_information',
        status: 'vendor_info_pending',
        department: formData.department,
        subDepartment: formData.subDepartment,
        specifyOther: formData.specifyOther || null,
        requestedBy: formData.requestedBy,
        specialInstructions: formData.specialInstructions,
        quantityRequired: formData.quantityRequired,
        estimateIfAny: formData.estimateIfAny || null,
        supportingImages: formData.supportingImages || [],
      }).returning()

      // Log workflow history
      await db.insert(workflowHistory).values({
        purchaseOrderId: newOrder.id,
        performedBy: userData.id,
        userRole: userRole,
        action: 'submit',
        stage: 'vendor_information',
        previousStatus: null,
        newStatus: 'vendor_info_pending',
        remarks: formData.specialInstructions || null,
        metadata: formData
      })

      return NextResponse.json({
        success: true,
        message: 'Purchase order created successfully',
        orderId: newOrder.id,
        orderNumber: newOrder.orderNumber,
        newStage: 'vendor_information',
        newStatus: 'vendor_info_pending'
      })
    }

    // For all other stages, orderId is required
    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required for this stage' }, { status: 400 })
    }

    // Get current order
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    let updateData: any = {}
    let newStatus = order.status
    let newStage = order.currentStage

    // Handle different actions based on stage
    switch (stage) {
      case 'initial_submission':
        // Stage 1: Initial submission by regular user
        updateData = {
          itemName: formData.itemName,
          department: formData.department,
          subDepartment: formData.subDepartment,
          quantity: formData.quantity,
          estimatedCost: formData.estimatedCost,
          specialInstructions: formData.specialInstructions,
          supportingImages: formData.supportingImages || [],
          currentStage: 'vendor_information',
          status: 'vendor_info_pending'
        }
        newStage = 'vendor_information'
        newStatus = 'vendor_info_pending'
        break

      case 'vendor_information':
        // Stage 2: Vendor info by Purchase Manager
        if (userRole !== 'purchase_manager' && userRole !== 'admin') {
          return NextResponse.json({ error: 'Unauthorized for this stage' }, { status: 403 })
        }
        updateData = {
          vendorName: formData.vendorName,
          vendorImages: formData.vendorImages || [],
          currentStage: 'ea_approval',
          status: 'awaiting_ea_approval'
        }
        newStage = 'ea_approval'
        newStatus = 'awaiting_ea_approval'
        break

      case 'ea_approval':
        // Stage 3a: EA Approval
        if (userRole !== 'ea' && userRole !== 'admin') {
          return NextResponse.json({ error: 'Unauthorized for this stage' }, { status: 403 })
        }
        if (action === 'approve') {
          updateData = {
            eaApprovalStatus: 'approved',
            eaApprovedBy: userData.id,
            eaApprovedAt: new Date(),
            eaApprovalRemarks: formData.remarks || null,
            currentStage: 'md_approval',
            status: 'awaiting_md_approval'
          }
          newStage = 'md_approval'
          newStatus = 'awaiting_md_approval'
        } else if (action === 'deny') {
          updateData = {
            eaApprovalStatus: 'denied',
            eaApprovedBy: userData.id,
            eaApprovedAt: new Date(),
            eaApprovalRemarks: formData.remarks || null,
            currentStage: 'initial_submission',
            status: 'ea_denied'
          }
          newStage = 'initial_submission'
          newStatus = 'ea_denied'
        }
        break

      case 'md_approval':
        // Stage 3b: MD Approval
        if (userRole !== 'md' && userRole !== 'admin') {
          return NextResponse.json({ error: 'Unauthorized for this stage' }, { status: 403 })
        }
        if (action === 'approve') {
          updateData = {
            mdApprovalStatus: 'approved',
            mdApprovedBy: userData.id,
            mdApprovedAt: new Date(),
            mdApprovalRemarks: formData.remarks || null,
            currentStage: 'grn',
            status: 'awaiting_grn'
          }
          newStage = 'grn'
          newStatus = 'awaiting_grn'
        } else if (action === 'deny') {
          updateData = {
            mdApprovalStatus: 'denied',
            mdApprovedBy: userData.id,
            mdApprovedAt: new Date(),
            mdApprovalRemarks: formData.remarks || null,
            currentStage: 'initial_submission',
            status: 'md_denied'
          }
          newStage = 'initial_submission'
          newStatus = 'md_denied'
        }
        break

      case 'grn':
        // Stage 4: GRN by Purchase Manager
        if (userRole !== 'purchase_manager' && userRole !== 'admin') {
          return NextResponse.json({ error: 'Unauthorized for this stage' }, { status: 403 })
        }
        updateData = {
          receivedDateTime: formData.receivedDateTime && formData.receivedTime 
            ? new Date(`${formData.receivedDateTime}T${formData.receivedTime}`)
            : null,
          handoverTo: formData.handoverTo,
          remarksIfAny: formData.remarksIfAny,
          amount: formData.amount,
          grnImages: formData.grnImages || [],
          currentStage: 'accounts',
          status: 'awaiting_accounts'
        }
        newStage = 'accounts'
        newStatus = 'awaiting_accounts'
        break

      case 'accounts':
        // Stage 5: Accounts processing
        if (userRole !== 'accounts' && userRole !== 'admin') {
          return NextResponse.json({ error: 'Unauthorized for this stage' }, { status: 403 })
        }
        updateData = {
          invoiceNumber: formData.invoiceNumber,
          invoiceDate: formData.invoiceDate,
          actualAmount: formData.actualAmount,
          paymentStatus: formData.paymentStatus,
          paymentMode: formData.paymentMode,
          paymentDate: formData.paymentDate,
          transactionReference: formData.transactionReference,
          accountsRemarks: formData.accountsRemarks,
          accountsImages: formData.accountsImages || [],
          status: 'completed',
          completedAt: new Date()
        }
        newStatus = 'completed'
        break

      default:
        return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
    }

    // Update the order
    await db
      .update(purchaseOrders)
      .set(updateData)
      .where(eq(purchaseOrders.id, orderId))

    // Log workflow history
    await db.insert(workflowHistory).values({
      purchaseOrderId: orderId,
      performedBy: userData.id,
      userRole: userRole,
      action: action || 'submit',
      stage: newStage,
      previousStatus: order.status,
      newStatus: newStatus,
      remarks: formData.remarks || formData.specialInstructions || null,
      metadata: formData
    })

    return NextResponse.json({
      success: true,
      message: 'Workflow updated successfully',
      orderId,
      newStage,
      newStatus
    })
  } catch (error) {
    console.error('Workflow error:', error)
    return NextResponse.json(
      { error: 'Failed to update workflow', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET endpoint to fetch order details with workflow history
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const orderId = searchParams.get('orderId')

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID required' }, { status: 400 })
    }

    // Get order details
    const [order] = await db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Get workflow history
    const history = await db
      .select()
      .from(workflowHistory)
      .where(eq(workflowHistory.purchaseOrderId, orderId))
      .orderBy(asc(workflowHistory.createdAt))

    // Fetch user names for all involved users
    const userIds = new Set<string>()
    
    // Add creator
    if (order.createdBy) userIds.add(order.createdBy)
    
    // Add EA approver
    if (order.eaApprovedBy) userIds.add(order.eaApprovedBy)
    
    // Add MD approver
    if (order.mdApprovedBy) userIds.add(order.mdApprovedBy)
    
    // Add users from history
    history.forEach(item => {
      if (item.performedBy) userIds.add(item.performedBy)
    })

    // Fetch user details from Supabase
    const { data: usersData, error: usersError } = await supabase
      .from('users')
      .select('id, full_name, email, role')
      .in('id', Array.from(userIds))

    if (usersError) {
      console.error('Error fetching users:', usersError)
    }

    // Create a map of user IDs to user details
    const userMap = new Map()
    if (usersData) {
      usersData.forEach(u => {
        userMap.set(u.id, {
          name: u.full_name || u.email,
          email: u.email,
          role: u.role
        })
      })
    }

    // Enrich history with user names
    const enrichedHistory = history.map(item => ({
      ...item,
      performedBy: userMap.get(item.performedBy)?.name || item.performedBy || 'Unknown',
      performedByEmail: userMap.get(item.performedBy)?.email || null
    }))

    // Find purchase manager from history (who added vendor information)
    const vendorInfoHistory = history.find(item =>
      item.stage === 'vendor_information' || item.action?.includes('vendor')
    )
    const purchaseManagerId = vendorInfoHistory?.performedBy

    // Create personnel summary
    const personnel = {
      createdBy: userMap.get(order.createdBy)?.name || 'Unknown',
      createdByEmail: userMap.get(order.createdBy)?.email || null,
      purchaseManager: purchaseManagerId ? userMap.get(purchaseManagerId)?.name || 'Unknown' : null,
      purchaseManagerEmail: purchaseManagerId ? userMap.get(purchaseManagerId)?.email || null : null,
      eaApprover: order.eaApprovedBy ? userMap.get(order.eaApprovedBy)?.name || 'Unknown' : null,
      eaApproverEmail: order.eaApprovedBy ? userMap.get(order.eaApprovedBy)?.email || null : null,
      mdApprover: order.mdApprovedBy ? userMap.get(order.mdApprovedBy)?.name || 'Unknown' : null,
      mdApproverEmail: order.mdApprovedBy ? userMap.get(order.mdApprovedBy)?.email || null : null,
    }

    return NextResponse.json({
      order,
      history: enrichedHistory,
      personnel
    })
  } catch (error) {
    console.error('Get order error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// Made with Bob
