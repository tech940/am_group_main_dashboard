import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { searchBookingsForFollowup } from '@/lib/kia/lead-followups'

export const dynamic = 'force-dynamic'

// Booking picker for the "Add follow-up" dialog. Gated by the follow-up create permission (not
// kia.bookings) so call agents can schedule follow-ups. Returns names/models only — never a number.
export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.lead_followups.create')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
  try {
    const url = new URL(request.url)
    const bookings = await searchBookingsForFollowup(url.searchParams.get('search') || '')
    return NextResponse.json({ bookings })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Search failed' }, { status: 500 })
  }
}
