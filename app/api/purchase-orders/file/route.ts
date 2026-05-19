import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { purchaseOrders } from '@/lib/db/schema'
import { canReadPurchaseOrder } from '@/lib/purchase-orders/access'
import { getSignedUrl } from '@/lib/supabase/storage'

const ALLOWED_FOLDERS = new Set([
  'supporting-images',
  'vendor-images',
  'grn-images',
  'accounts-images',
])

function getStoragePath(value: string) {
  const decodedValue = decodeURIComponent(value).trim()

  try {
    const url = new URL(decodedValue)
    const decodedPath = decodeURIComponent(url.pathname)
    const marker = '/purchase-orders/'
    const markerIndex = decodedPath.indexOf(marker)

    if (markerIndex >= 0) {
      return decodedPath.slice(markerIndex + marker.length)
    }
  } catch {
    // Plain storage paths are handled below.
  }

  return decodedValue.replace(/^\/+/, '').replace(/^purchase-orders\//, '')
}

function getOrderIdFromPath(filePath: string) {
  const filename = filePath.split('/').pop() || ''
  const [orderId] = filename.split('_')

  return orderId || null
}

function isAllowedStoragePath(filePath: string) {
  if (!filePath || filePath.includes('..')) {
    return false
  }

  const [folder] = filePath.split('/')
  return ALLOWED_FOLDERS.has(folder)
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()

    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const file = request.nextUrl.searchParams.get('file')
    const requestedOrderId = request.nextUrl.searchParams.get('orderId')

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    const filePath = getStoragePath(file)

    if (!isAllowedStoragePath(filePath)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }

    const pathOrderId = getOrderIdFromPath(filePath)
    const orderId = requestedOrderId || pathOrderId

    if (!orderId || orderId.startsWith('temp-')) {
      return NextResponse.json({ error: 'Purchase order is required' }, { status: 400 })
    }

    if (pathOrderId && pathOrderId !== orderId) {
      return NextResponse.json({ error: 'File does not belong to this purchase order' }, { status: 403 })
    }

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

    const signedUrl = await getSignedUrl(filePath, 900)

    if (!signedUrl) {
      return NextResponse.json({ error: 'Unable to create preview link' }, { status: 500 })
    }

    return NextResponse.redirect(signedUrl)
  } catch (error) {
    console.error('Error in GET /api/purchase-orders/file:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
