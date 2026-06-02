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
    const { id, approvalType, action, remarks } = body

    if (!id || !approvalType || !action) {
      return NextResponse.json(
        { error: 'Purchase order ID, approval type, and action are required' },
        { status: 400 }
      )
    }

    if (!['ea', 'management'].includes(approvalType)) {
      return NextResponse.json({ error: 'Invalid approval type' }, { status: 400 })
    }

    if (!['approved', 'rejected'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    // Get user details to check role
    const { data: userData } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('supabase_id', user.id)
      .single()

    // Check if user has permission to approve
    if (userData?.role !== 'admin' && userData?.role !== 'manager') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Prepare update data based on approval type
    const updateData: Record<string, string | null> = {
      updated_at: new Date().toISOString()
    }

    if (approvalType === 'ea') {
      updateData.ea_approval = action
      updateData.ea_approved_by = user.id
      updateData.ea_approved_at = new Date().toISOString()
      updateData.ea_remarks = remarks || null
      
      // Update status
      if (action === 'approved') {
        updateData.status = 'pending_management_approval'
      } else {
        updateData.status = 'rejected'
      }
    } else if (approvalType === 'management') {
      updateData.management_approval = action
      updateData.management_approved_by = user.id
      updateData.management_approved_at = new Date().toISOString()
      updateData.management_remarks = remarks || null
      
      // Update status
      if (action === 'approved') {
        updateData.status = 'approved'
      } else {
        updateData.status = 'rejected'
      }
    }

    // Update purchase order
    const { data, error } = await supabase
      .from('purchase_orders')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating approval:', error)
      return NextResponse.json({ error: 'Failed to update approval' }, { status: 500 })
    }

    return NextResponse.json({
      message: `Purchase order ${action} successfully`,
      data
    })
  } catch (error) {
    console.error('Error in POST /api/purchase-orders/approve:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Made with Bob
