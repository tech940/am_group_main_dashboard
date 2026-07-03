import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { updateKiaBooking } from '@/lib/kia/bookings'

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

export async function POST(_request: Request, context: RouteContext<'/api/brands/kia/bookings/[id]/deliver'>) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response
    const { id } = await context.params
    const booking = await updateKiaBooking(id, { delivered: true }, auth.appUser!)
    return NextResponse.json({ ok: true, booking })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to mark delivered' }, { status: 400 })
  }
}
