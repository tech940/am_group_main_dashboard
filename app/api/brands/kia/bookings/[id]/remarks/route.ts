import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { db } from '@/lib/db'
import { kiaBookingActivity, kiaBookings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permission = await requirePermission(appUser, 'kia.bookings.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  const { id: bookingId } = await params

  try {
    const { remark } = await request.json().catch(() => ({})) as { remark?: string }
    const cleanRemark = String(remark || '').trim()
    if (!cleanRemark) {
      return NextResponse.json({ error: 'Remark cannot be empty' }, { status: 400 })
    }

    const [booking] = await db
      .select({ id: kiaBookings.id })
      .from(kiaBookings)
      .where(eq(kiaBookings.id, bookingId))
      .limit(1)

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    await db.insert(kiaBookingActivity).values({
      bookingId,
      activityType: 'remark_added',
      title: 'Remark added',
      description: cleanRemark,
      actorUserId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to add remark:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add remark' },
      { status: 500 }
    )
  }
}
