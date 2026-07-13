import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { holdKiaStockVehicle, releaseKiaStockHold } from '@/lib/kia/bookings'

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

// #12 Hold a stock vehicle (action 'hold', holdFor 'customer' | 'dealer') or release a hold
// (action 'release'). Gated by kia.bookings.edit — same roles that allot/transfer.
export async function POST(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'hold').toLowerCase()
    const vinNumber = String(body?.vinNumber || '')

    if (action === 'release') {
      const result = await releaseKiaStockHold(vinNumber, auth.appUser!)
      return NextResponse.json({ ok: true, ...result })
    }

    const holdFor = String(body?.holdFor || 'customer').toLowerCase() === 'dealer' ? 'dealer' : 'customer'
    const result = await holdKiaStockVehicle(
      vinNumber,
      { holdFor, bookingId: body?.bookingId ?? null, customerName: body?.customerName ?? null, notes: body?.notes ?? null },
      auth.appUser!,
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update hold' }, { status: 400 })
  }
}
