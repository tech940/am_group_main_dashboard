import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { allotKiaBbndVehicle } from '@/lib/kia/bookings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, 'kia.bookings.edit')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

// #8 Allot a BBND (Booked-But-Not-in-DMS) vehicle: a manually-entered VIN that isn't in the DMS feed,
// allotted to the given booking and persisted durably (kia_stock_local_statuses + allocation snapshot).
export async function POST(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => ({}))
    const bookingId = String(body?.bookingId || '')
    if (!bookingId) return NextResponse.json({ error: 'A booking is required to allot a BBND vehicle.' }, { status: 400 })

    const booking = await allotKiaBbndVehicle(bookingId, {
      vinNumber: String(body?.vinNumber || ''),
      model: body?.model ?? null,
      variant: body?.variant ?? null,
      color: body?.color ?? null,
      engineNo: body?.engineNo ?? null,
      dealerCode: body?.dealerCode ?? null,
    }, auth.appUser!)
    return NextResponse.json({ ok: true, booking })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to allot BBND vehicle' }, { status: 400 })
  }
}
