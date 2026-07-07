import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { buildTrackingUrl } from '@/lib/kia/tracking'

export const dynamic = 'force-dynamic'

// Returns the public, shareable customer tracking URL for a booking. Staff-only —
// the URL itself is safe to hand to the customer, but generating it requires
// booking-view permission so we never leak links for bookings a user can't see.
export async function GET(request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/tracking-link'>) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse
    const appUser = await getAuthenticatedAppUser()
    const permission = await requirePermission(appUser, 'kia.bookings.view')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

    const { id } = await context.params
    // Prefer the request's own origin so links work in any environment.
    const origin = new URL(request.url).origin
    const url = buildTrackingUrl(id, origin)
    return NextResponse.json({ url })
  } catch (error) {
    console.error('Failed to build KIA tracking link:', error)
    return NextResponse.json({ error: 'Failed to build tracking link' }, { status: 500 })
  }
}
