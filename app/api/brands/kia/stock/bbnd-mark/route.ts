import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { markKiaStockBbnd, clearKiaStockBbnd } from '@/lib/kia/bookings'

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

/**
 * Mark a free-stock vehicle BBND ("Build But Not Delivered"), or clear the marker.
 *
 * ⚠️ NOT the same endpoint as /api/brands/kia/stock/bbnd-allot. That one allots a hand-entered VIN
 * that the DMS feed does not carry yet (local_status 'bbnd'). This one labels a vehicle that IS in
 * the DMS free-stock list (local_status 'bbnd_marked') and deliberately LEAVES IT IN FREE STOCK.
 *
 * Gated on kia.bookings.edit — identical to hold/allot/transfer.
 */
export async function POST(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'mark').toLowerCase()
    const vinNumber = String(body?.vinNumber || '')

    if (action === 'clear') {
      const result = await clearKiaStockBbnd(vinNumber, auth.appUser!)
      return NextResponse.json({ ok: true, ...result })
    }

    const result = await markKiaStockBbnd(vinNumber, { notes: body?.notes ?? null }, auth.appUser!)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update BBND status' }, { status: 400 })
  }
}
