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

    // Rows arrive oldest-first (FIFO). The longest-standing vehicle is flagged so the UI can nudge
    // toward it and warn when something newer is picked instead — advisory only, never a block.
    const ages = rows
      .map((row) => Number(row.age_days ?? 0))
      .filter((n) => Number.isFinite(n))
    const oldestAge = ages.length ? Math.max(...ages) : 0

    return NextResponse.json({
      oldestAgeDays: oldestAge,
      rows: rows.map((row) => {
        const ageDays = Number(row.age_days ?? 0) || 0
        return {
          vinNumber: text(row.vin_number),
          dealerCode: text(row.dealer_code),
          model: text(row.model),
          variant: text(row.variant),
          color: text(row.color),
          stockStatus: text(row.stock_status),
          source: text(row.source) === 'bbnd' ? 'bbnd' : 'dms',
          // Named `stockAge` because the client already reads that field ("… days on lot") — the
          // API simply never sent it, so that figure has always rendered as 0.
          stockAge: ageDays,
          // True for the longest-standing vehicle in this list — the FIFO-correct pick.
          isOldest: ageDays > 0 && ageDays === oldestAge,
        }
      }),
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load matching vehicles' }, { status: 400 })
  }
}
