import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { getKiaBookingMatchingVehicles } from '@/lib/kia/bookings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function text(value: unknown) {
  return String(value ?? '').trim()
}

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, 'kia.bookings.view')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }) }
  return { response: null }
}

export async function GET(_request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/matching-vehicles'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const rows = await getKiaBookingMatchingVehicles(id)
    return NextResponse.json({
      rows: rows.map((row) => ({
        vinNumber: text(row.vin_number),
        dealerCode: text(row.dealer_code),
        model: text(row.model),
        variant: text(row.variant),
        color: text(row.color),
        stockStatus: text(row.stock_status),
        source: text(row.source) === 'bbnd' ? 'bbnd' : 'dms',
      })),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load matching vehicles' }, { status: 400 })
  }
}
