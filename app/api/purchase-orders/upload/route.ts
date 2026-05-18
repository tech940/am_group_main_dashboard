import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { purchaseOrders } from '@/lib/db/schema'
import {
  canManagePurchaseOrderUploads,
  canReadPurchaseOrder,
} from '@/lib/purchase-orders/access'
import { uploadFile } from '@/lib/supabase/storage'

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const folder = String(formData.get('folder') || '')
    const orderId = String(formData.get('orderId') || '')

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!folder || !orderId) {
      return NextResponse.json({ error: 'Missing folder or orderId' }, { status: 400 })
    }

    if (!canManagePurchaseOrderUploads(appUser.role, folder)) {
      return NextResponse.json({ error: 'Unauthorized to upload files for this section' }, { status: 403 })
    }

    if (!orderId.startsWith('temp-')) {
      const [order] = await db
        .select({
          id: purchaseOrders.id,
          brand: purchaseOrders.brand,
          createdBy: purchaseOrders.createdBy,
          assignedTo: purchaseOrders.assignedTo,
          requestedBy: purchaseOrders.requestedBy,
          status: purchaseOrders.status,
          eaApprovedBy: purchaseOrders.eaApprovedBy,
        })
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, orderId), isNull(purchaseOrders.deletedAt)))
        .limit(1)

      if (!order || !canReadPurchaseOrder(appUser, order)) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
      }
    } else if (folder !== 'supporting-images') {
      return NextResponse.json({ error: 'Temporary uploads are only allowed for initial supporting images' }, { status: 400 })
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
    }

    const result = await uploadFile(file, folder, orderId)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      url: result.url,
      path: result.path,
      message: 'File uploaded successfully',
    })
  } catch (error) {
    console.error('Error in POST /api/purchase-orders/upload:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
