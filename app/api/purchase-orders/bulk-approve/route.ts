import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { orderIds, action, remarks } = body

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: 'Order IDs array is required' },
        { status: 400 }
      )
    }

    if (!['approve', 'deny'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if (action === 'deny' && !remarks) {
      return NextResponse.json(
        { error: 'Remarks are required for denial' },
        { status: 400 }
      )
    }

    // Get user details
    const { data: userData } = await supabase
      .from('users')
      .select('id, role, full_name')
      .eq('supabase_id', user.id)
      .single()

    if (!userData || (userData.role !== 'admin' && userData.role !== 'md')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Prepare update data
    const updateData: any = {
      updated_at: new Date().toISOString(),
      md_approval_status: action === 'approve' ? 'approved' : 'denied',
      md_approved_by: userData.id,
      md_approved_at: new Date().toISOString(),
      md_approval_remarks: remarks || null,
    }

    // Update status based on action
    if (action === 'approve') {
      updateData.status = 'awaiting_grn'
      updateData.current_stage = 'grn'
    } else {
      updateData.status = 'md_denied'
    }

    // Bulk update all orders
    const { data, error } = await supabase
      .from('purchase_orders')
      .update(updateData)
      .in('id', orderIds)
      .select()

    if (error) {
      console.error('Error bulk updating orders:', error)
      return NextResponse.json({ error: 'Failed to update orders' }, { status: 500 })
    }

    // Create workflow history entries for each order
    const historyEntries = orderIds.map(orderId => ({
      purchase_order_id: orderId,
      action: action === 'approve' ? 'md_approved' : 'md_denied',
      stage: 'md_approval',
      performed_by: userData.id,
      user_role: userData.role,
      remarks: remarks || null,
      previous_status: 'awaiting_md_approval',
      new_status: action === 'approve' ? 'awaiting_grn' : 'md_denied',
      metadata: {
        bulk_action: true,
        total_orders: orderIds.length
      }
    }))

    const { error: historyError } = await supabase
      .from('workflow_history')
      .insert(historyEntries)

    if (historyError) {
      console.error('Error creating workflow history:', historyError)
      // Don't fail the request if history creation fails
    }

    return NextResponse.json({
      message: `Successfully ${action === 'approve' ? 'approved' : 'denied'} ${orderIds.length} orders`,
      data,
      count: orderIds.length
    })
  } catch (error) {
    console.error('Error in POST /api/purchase-orders/bulk-approve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Made with Bob