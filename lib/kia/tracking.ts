import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookings } from '@/lib/db/schema'
import { env } from '@/config/env-config'

/**
 * Customer self-service tracking links.
 *
 * A booking's public status page lives at `/track/<token>` where the token is an
 * HMAC-signed reference to the booking id. This needs NO database column: the
 * token is derived deterministically from the id + a server secret, and verified
 * the same way. The signature makes ids unguessable — a customer can only open the
 * exact link they were sent, and cannot enumerate other bookings.
 */

// A stable, server-only secret. These always exist in this deployment; the token
// stays valid across restarts because the key never changes.
function signingSecret(): string {
  return (
    process.env.TRACKING_LINK_SECRET ||
    env.supabase.serviceRoleKey ||
    env.database.url ||
    'am-kia-tracking-fallback-secret'
  )
}

function sign(bookingId: string): string {
  return createHmac('sha256', signingSecret()).update(bookingId).digest('base64url').slice(0, 32)
}

export function signTrackingToken(bookingId: string): string {
  const idPart = Buffer.from(bookingId).toString('base64url')
  return `${idPart}.${sign(bookingId)}`
}

export function verifyTrackingToken(token: string): string | null {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [idPart, providedSig] = token.split('.')
  if (!idPart || !providedSig) return null
  let bookingId: string
  try {
    bookingId = Buffer.from(idPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  // Basic UUID sanity check before touching the DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) return null
  const expected = sign(bookingId)
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return bookingId
}

export function buildTrackingUrl(bookingId: string, baseUrl?: string): string {
  const base = (baseUrl || env.app.url || '').replace(/\/$/, '')
  return `${base}/track/${signTrackingToken(bookingId)}`
}

// Customer-facing lifecycle. Deliberately friendlier than the internal statuses,
// and mapped 1:1 to booking.status so the "current step" is always honest.
export const KIA_TRACKING_STEPS = [
  { key: 'confirmed', label: 'Booking Confirmed', hint: 'We have received and confirmed your booking.' },
  { key: 'paperwork', label: 'Paperwork Prepared', hint: 'Your proforma and documents are ready.' },
  { key: 'assigned', label: 'Vehicle Assigned', hint: 'A specific vehicle has been reserved for you.' },
  { key: 'payment', label: 'Payment Received', hint: 'Your payment has been received and verified.' },
  { key: 'ready', label: 'Ready for Delivery', hint: 'Your vehicle is prepared and ready to hand over.' },
  { key: 'delivered', label: 'Delivered', hint: 'Your vehicle has been delivered. Congratulations!' },
] as const

// Which step index a given internal status has reached.
const STATUS_TO_STEP: Record<string, number> = {
  draft: 0,
  booking_created: 0,
  proforma_generated: 1,
  on_hold: 1,
  vehicle_allocated: 2,
  transfer_requested: 2,
  finance_pending: 2,
  payment_confirmed: 3,
  ready_delivery: 4,
  delivered: 5,
}

export type KiaTrackingView = {
  bookingNumber: string
  customerFirstName: string
  model: string
  variant: string | null
  color: string | null
  dealerCode: string | null
  consultantName: string | null
  status: string
  cancelled: boolean
  currentStep: number
  expectedDeliveryDate: string | null
  deliveredAt: string | null
  bookedAt: string | null
  updatedAt: string | null
  steps: Array<{ key: string; label: string; hint: string; state: 'done' | 'current' | 'pending' }>
}

function firstName(fullName: string): string {
  const trimmed = String(fullName || '').trim()
  return trimmed.split(/\s+/)[0] || 'there'
}

export async function getTrackingView(token: string): Promise<KiaTrackingView | null> {
  const bookingId = verifyTrackingToken(token)
  if (!bookingId) return null

  const [booking] = await db
    .select({
      bookingNumber: kiaBookings.bookingNumber,
      customerName: kiaBookings.customerName,
      model: kiaBookings.model,
      variant: kiaBookings.variant,
      color: kiaBookings.color,
      dealerCode: kiaBookings.dealerCode,
      consultantName: kiaBookings.consultantName,
      status: kiaBookings.status,
      deliveryTargetDate: kiaBookings.deliveryTargetDate,
      deliveredAt: kiaBookings.deliveredAt,
      createdAt: kiaBookings.createdAt,
      updatedAt: kiaBookings.updatedAt,
    })
    .from(kiaBookings)
    .where(and(eq(kiaBookings.id, bookingId), isNull(kiaBookings.deletedAt)))
    .limit(1)

  if (!booking) return null

  const cancelled = booking.status === 'cancelled'
  const delivered = booking.status === 'delivered'
  // When delivered, the journey is complete — push the frontier past the last step
  // so every step (including "Delivered") renders as done, not in-progress.
  const currentStep = cancelled
    ? -1
    : delivered
      ? KIA_TRACKING_STEPS.length
      : STATUS_TO_STEP[String(booking.status)] ?? 0

  const steps = KIA_TRACKING_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    hint: step.hint,
    state: (cancelled
      ? 'pending'
      : index < currentStep
        ? 'done'
        : index === currentStep
          ? 'current'
          : 'pending') as 'done' | 'current' | 'pending',
  }))

  return {
    bookingNumber: booking.bookingNumber,
    customerFirstName: firstName(booking.customerName),
    model: booking.model,
    variant: booking.variant,
    color: booking.color,
    dealerCode: booking.dealerCode,
    consultantName: booking.consultantName,
    status: String(booking.status),
    cancelled,
    currentStep,
    expectedDeliveryDate: booking.deliveryTargetDate || null,
    deliveredAt: booking.deliveredAt ? new Date(booking.deliveredAt).toISOString() : null,
    bookedAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
    updatedAt: booking.updatedAt ? new Date(booking.updatedAt).toISOString() : null,
    steps,
  }
}
