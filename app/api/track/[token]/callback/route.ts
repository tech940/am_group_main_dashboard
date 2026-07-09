import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookings, kiaCallbackRequests } from '@/lib/db/schema'
import { verifyTrackingToken } from '@/lib/kia/tracking'
import { getRecentPendingCallbackRequest } from '@/lib/kia/callback-requests'
import { createKiaCallbackNotifications } from '@/lib/notifications/kia-callback'

export const dynamic = 'force-dynamic'

const PREFERRED_TIMES = new Set(['morning', 'afternoon', 'evening', 'anytime'])

function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const stripped = value.replace(/<[^>]*>/g, '').trim().slice(0, 500)
  return stripped || null
}

function cleanPreferredTime(value: unknown): string | null {
  const text = String(value || '').trim().toLowerCase()
  return PREFERRED_TIMES.has(text) ? text : null
}

// PUBLIC endpoint — no login. Protected by the HMAC tracking token, which resolves to exactly
// one booking id and cannot be forged or enumerated.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const bookingId = verifyTrackingToken(token)
    if (!bookingId) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
    }

    const [booking] = await db
      .select({
        id: kiaBookings.id,
        createdBy: kiaBookings.createdBy,
        dealerCode: kiaBookings.dealerCode,
        bookingNumber: kiaBookings.bookingNumber,
        customerName: kiaBookings.customerName,
        model: kiaBookings.model,
      })
      .from(kiaBookings)
      .where(and(eq(kiaBookings.id, bookingId), isNull(kiaBookings.deletedAt)))
      .limit(1)

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const preferredTime = cleanPreferredTime(body.preferredTime)
    const note = cleanNote(body.note)

    // Dedupe / rate-limit: if a pending request already exists for this booking within the
    // window, treat this as an idempotent success — don't create a duplicate or re-notify staff.
    const existing = await getRecentPendingCallbackRequest(booking.id)
    if (existing) {
      return NextResponse.json({ ok: true, alreadyRequested: true })
    }

    const [created] = await db
      .insert(kiaCallbackRequests)
      .values({
        bookingId: booking.id,
        customerName: booking.customerName,
        preferredTime,
        note,
        source: 'proforma_email',
      })
      .returning({ id: kiaCallbackRequests.id })

    // Fire-and-forget notifications — never let a notification failure fail the customer's request.
    try {
      await createKiaCallbackNotifications({
        booking,
        callbackRequestId: created.id,
        preferredTime,
      })
    } catch (notifyError) {
      console.error('Failed to create KIA callback notifications:', notifyError)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/track/[token]/callback failed:', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
