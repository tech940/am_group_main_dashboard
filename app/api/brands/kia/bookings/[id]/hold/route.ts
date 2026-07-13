import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { holdKiaBookingVehicle, resumeKiaBookingVehicle } from '@/lib/kia/bookings'

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

// Put a booking on hold (action: 'hold') or resume it (action: 'resume'). Gated by kia.bookings.edit,
// same as allotment — so the roles that manage bookings (Sales Manager / GM / Accounts / admins) can
// pause and resume the workflow.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || 'hold').toLowerCase()
    const booking = action === 'resume'
      ? await resumeKiaBookingVehicle(id, auth.appUser!)
      : await holdKiaBookingVehicle(id, body?.reason ?? null, auth.appUser!)
    return NextResponse.json({ ok: true, booking })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update hold status' }, { status: 400 })
  }
}
