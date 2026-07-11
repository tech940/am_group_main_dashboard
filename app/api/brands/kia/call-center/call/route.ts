import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { initiateCustomerCall } from '@/lib/kia/call-center'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.call_center.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({})) as { bookingId?: string; callbackRequestId?: string }
    const result = await initiateCustomerCall(appUser, { bookingId: body.bookingId, callbackRequestId: body.callbackRequestId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not place the call' }, { status: 400 })
  }
}
