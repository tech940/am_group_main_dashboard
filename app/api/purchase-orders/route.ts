import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')
    const status = searchParams.get('status')
    const stage = searchParams.get('stage')
    const brand = searchParams.get('brand')

    // If ID is provided, fetch single purchase order
    if (id) {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .single()

      if (error) {
        console.error('Error fetching purchase order:', error)
        return NextResponse.json({ error: 'Failed to fetch purchase order' }, { status: 500 })
      }

      return NextResponse.json(data)
    }

    // Build query for listing purchase orders
    let query = supabase
      .from('purchase_orders')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    // Apply filters
    if (status) {
      query = query.eq('status', status)
    }
    if (stage) {
      query = query.eq('current_stage', stage)
    }
    if (brand) {
      query = query.eq('brand', brand)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching purchase orders:', error)
      return NextResponse.json({ error: 'Failed to fetch purchase orders' }, { status: 500 })
    }

    return NextResponse.json({ orders: data })
  } catch (error) {
    console.error('Error in GET /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    console.log('Received purchase order data:', body)

    // Get user details - need the users table ID, not supabase auth ID
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, brand')
      .eq('supabase_id', user.id)
      .single()

    if (userError || !userData) {
      console.error('Error fetching user data:', userError)
      return NextResponse.json({
        error: 'User not found in database. Please contact administrator.',
        details: 'Your account needs to be set up in the users table first.'
      }, { status: 400 })
    }

    // Generate order number using a simple approach if RPC fails
    let orderNumber: string
    try {
      const { data: orderNumberData, error: orderNumberError } = await supabase
        .rpc('generate_order_number')

      if (orderNumberError) {
        console.warn('RPC generate_order_number failed, using fallback:', orderNumberError)
        // Fallback: generate order number manually
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

    console.log('Generated order number:', orderNumber)

    // Prepare insert data - use users table ID, not auth ID
    const insertData = {
      order_number: orderNumber,
      created_by: userData.id, // Use users.id instead of auth.uid
      brand: userData.brand || body.brand || null,
      current_stage: body.current_stage || 'order_request',
      status: body.status || 'draft',
      req_type: body.req_type || null,
      department: body.department || null,
      sub_department: body.sub_department || null,
      specify_other: body.specify_other || null,
      requested_by: body.requested_by || null,
      special_instructions: body.special_instructions || null,
      quantity_required: body.quantity_required || null,
      estimate_if_any: body.estimate_if_any || null,
      vendor_name: body.vendor_name || null,
      quotation_1_url: body.quotation_1_url || null,
      quotation_2_url: body.quotation_2_url || null,
      quotation_3_url: body.quotation_3_url || null,
      received_date_time: body.received_date_time || null,
      handover_to: body.handover_to || null,
      remarks_if_any: body.remarks_if_any || null,
      amount: body.amount || null,
      invoice_1_url: body.invoice_1_url || null,
      invoice_2_url: body.invoice_2_url || null,
      invoice_3_url: body.invoice_3_url || null,
      invoice_4_url: body.invoice_4_url || null,
      payment_status: body.payment_status || null,
      payment_mode: body.payment_mode || null,
      account_remarks: body.account_remarks || null,
      payment_screenshot_url: body.payment_screenshot_url || null,
    }

    console.log('Inserting purchase order:', insertData)

    // Create purchase order
    const { data, error } = await supabase
      .from('purchase_orders')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('Error creating purchase order:', error)
      return NextResponse.json({
        error: 'Failed to create purchase order',
        details: error.message,
        hint: error.hint
      }, { status: 500 })
    }

    console.log('Purchase order created successfully:', data)
    return NextResponse.json(data, { status: 201 })
  } catch (error: any) {
    console.error('Error in POST /api/purchase-orders:', error)
    return NextResponse.json({
      error: 'Internal server error',
      details: error.message
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updateData } = body

    if (!id) {
      return NextResponse.json({ error: 'Purchase order ID is required' }, { status: 400 })
    }

    // Update purchase order
    const { data, error } = await supabase
      .from('purchase_orders')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating purchase order:', error)
      return NextResponse.json({ error: 'Failed to update purchase order' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in PUT /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Purchase order ID is required' }, { status: 400 })
    }

    // Soft delete by setting deleted_at
    const { error } = await supabase
      .from('purchase_orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('Error deleting purchase order:', error)
      return NextResponse.json({ error: 'Failed to delete purchase order' }, { status: 500 })
    }

    return NextResponse.json({ message: 'Purchase order deleted successfully' })
  } catch (error) {
    console.error('Error in DELETE /api/purchase-orders:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Made with Bob
