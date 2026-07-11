import 'server-only'

import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookings, kiaCallAgentPhones, kiaCallLogs, kiaCallbackRequests } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { activeTelephonyProviderName, placeMaskedCall, telephonyConfigStatus } from '@/lib/telephony'
import { createFollowup } from '@/lib/kia/lead-followups'

// Who may see the telephony setup diagnostics (env-config readiness — no secrets, no PII).
function canSeeTelephonyDiagnostics(role?: string | null): boolean {
  const r = String(role || '').trim().toLowerCase()
  return r === 'md' || r === 'developer' || r === 'admin' || r === 'super_admin'
}

// The KIA Call Center. CRITICAL INVARIANT: the customer's phone number is read from the booking
// server-side ONLY (to hand to the telephony provider) and is NEVER included in anything returned
// to a client. Every function here returns names/models/status — never a number.

const DISPOSITIONS = new Set(['interested', 'not_interested', 'callback_later', 'no_answer', 'wrong_number', 'done'])

async function agentPhoneValue(userId: string): Promise<string | null> {
  const [row] = await db.select({ phone: kiaCallAgentPhones.agentPhone }).from(kiaCallAgentPhones).where(eq(kiaCallAgentPhones.userId, userId)).limit(1)
  return row?.phone || null
}

export async function getAgentPhone(appUser: AppUser): Promise<string | null> {
  return agentPhoneValue(appUser.id)
}

export async function setAgentPhone(appUser: AppUser, phone: string) {
  const clean = String(phone || '').replace(/[^\d+]/g, '').trim()
  if (clean.replace(/\D/g, '').length < 10) throw new Error('Enter a valid phone number (at least 10 digits).')
  await db.insert(kiaCallAgentPhones)
    .values({ userId: appUser.id, agentPhone: clean })
    .onConflictDoUpdate({ target: kiaCallAgentPhones.userId, set: { agentPhone: clean, updatedAt: new Date() } })
  return { ok: true }
}

export async function getCallQueue(appUser: AppUser, input: { search?: string | null }) {
  const search = String(input.search || '').trim()

  const bookingWhere = [isNull(kiaBookings.deletedAt)]
  if (search) {
    bookingWhere.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
    )!)
  }

  // Fire all four reads concurrently — they're independent, so sequential awaits just stacked the
  // per-query round-trip 4× (~1.4s → ~1 round-trip).
  const [callbacks, bookings, history, agentPhone] = await Promise.all([
    // Pending callbacks (priority), joined to the booking for name/model — NO phone selected.
    db.select({
      id: kiaCallbackRequests.id,
      bookingId: kiaCallbackRequests.bookingId,
      customerName: kiaCallbackRequests.customerName,
      preferredTime: kiaCallbackRequests.preferredTime,
      note: kiaCallbackRequests.note,
      createdAt: kiaCallbackRequests.createdAt,
      model: kiaBookings.model,
      variant: kiaBookings.variant,
      dealer: kiaBookings.dealerCode,
      bookingNumber: kiaBookings.bookingNumber,
    })
      .from(kiaCallbackRequests)
      .leftJoin(kiaBookings, eq(kiaBookings.id, kiaCallbackRequests.bookingId))
      .where(eq(kiaCallbackRequests.status, 'pending'))
      .orderBy(desc(kiaCallbackRequests.createdAt))
      .limit(100),
    // Recent bookings (searchable by name / model / booking number — NEVER by phone). NO phone selected.
    db.select({
      id: kiaBookings.id,
      customerName: kiaBookings.customerName,
      model: kiaBookings.model,
      variant: kiaBookings.variant,
      color: kiaBookings.color,
      dealer: kiaBookings.dealerCode,
      status: kiaBookings.status,
      bookingNumber: kiaBookings.bookingNumber,
      createdAt: kiaBookings.createdAt,
    })
      .from(kiaBookings)
      .where(and(...bookingWhere))
      .orderBy(desc(kiaBookings.createdAt))
      .limit(50),
    // Recent call history (masked — no number ever). Join booking only for the customer NAME.
    db.select({
      id: kiaCallLogs.id,
      bookingId: kiaCallLogs.bookingId,
      status: kiaCallLogs.status,
      disposition: kiaCallLogs.disposition,
      durationSec: kiaCallLogs.durationSec,
      provider: kiaCallLogs.provider,
      startedAt: kiaCallLogs.startedAt,
      customerName: kiaBookings.customerName,
      model: kiaBookings.model,
    })
      .from(kiaCallLogs)
      .leftJoin(kiaBookings, eq(kiaBookings.id, kiaCallLogs.bookingId))
      .orderBy(desc(kiaCallLogs.startedAt))
      .limit(40),
    agentPhoneValue(appUser.id),
  ])

  return {
    callbacks,
    bookings,
    history,
    agentPhoneSet: Boolean(agentPhone),
    provider: activeTelephonyProviderName(),
    // Setup readiness (booleans only — no secrets), shown to admins so they can go live.
    telephonyStatus: canSeeTelephonyDiagnostics(appUser.role) ? telephonyConfigStatus() : null,
  }
}

// Places a masked call. Looks up the customer number server-side, hands it to the provider, and
// returns ONLY a call id + status — never the number.
export async function initiateCustomerCall(appUser: AppUser, input: { bookingId?: string | null; callbackRequestId?: string | null }) {
  let bookingId = input.bookingId || null
  const callbackRequestId = input.callbackRequestId || null
  if (!bookingId && callbackRequestId) {
    const [cb] = await db.select({ bookingId: kiaCallbackRequests.bookingId }).from(kiaCallbackRequests).where(eq(kiaCallbackRequests.id, callbackRequestId)).limit(1)
    bookingId = cb?.bookingId || null
  }
  if (!bookingId) throw new Error('No customer selected to call.')

  const [booking] = await db
    .select({ id: kiaBookings.id, phone: kiaBookings.customerPhone })
    .from(kiaBookings)
    .where(and(eq(kiaBookings.id, bookingId), isNull(kiaBookings.deletedAt)))
    .limit(1)
  if (!booking) throw new Error('Customer not found.')
  const customerPhone = String(booking.phone || '').trim()
  if (!customerPhone) throw new Error('This customer has no phone number on file.')

  const agentPhone = await agentPhoneValue(appUser.id)
  if (!agentPhone) throw new Error('Set your call-back phone number before placing calls.')

  const provider = activeTelephonyProviderName()
  const [log] = await db.insert(kiaCallLogs)
    .values({ bookingId, callbackRequestId, agentId: appUser.id, provider, status: 'initiated' })
    .returning()

  const result = await placeMaskedCall({ agentPhone, customerPhone, callId: log.id })
  await db.update(kiaCallLogs)
    .set({ providerCallId: result.providerCallId, status: result.ok ? result.status : 'failed', updatedAt: new Date() })
    .where(eq(kiaCallLogs.id, log.id))

  if (!result.ok) throw new Error(result.error || 'The call could not be placed.')
  // Deliberately returns NO phone number.
  return { callId: log.id, status: result.status, provider }
}

export async function saveCallDisposition(appUser: AppUser, input: { callId: string; disposition?: string | null; notes?: string | null; markCallbackContacted?: boolean; followUpAt?: string | null }) {
  const disposition = input.disposition && DISPOSITIONS.has(input.disposition) ? input.disposition : null
  const [log] = await db.update(kiaCallLogs)
    .set({ disposition, notes: input.notes ? String(input.notes).slice(0, 2000) : null, updatedAt: new Date() })
    .where(and(eq(kiaCallLogs.id, input.callId), eq(kiaCallLogs.agentId, appUser.id)))
    .returning()
  if (!log) throw new Error('Call not found.')

  // If this was a callback and the agent reached the customer, close the callback out.
  if (log.callbackRequestId && input.markCallbackContacted) {
    await db.update(kiaCallbackRequests)
      .set({ status: 'contacted', contactedBy: appUser.id, contactedAt: new Date(), updatedAt: new Date() })
      .where(eq(kiaCallbackRequests.id, log.callbackRequestId))
  }

  // "Call back later" → schedule a follow-up on the lead so it doesn't go cold. Assigned to the
  // booking's consultant by default (createFollowup resolves it). Non-fatal if it fails.
  let followupId: string | null = null
  if (input.followUpAt && log.bookingId) {
    try {
      const followup = await createFollowup(appUser, {
        bookingId: log.bookingId,
        dueAt: input.followUpAt,
        reason: 'callback',
        source: 'call',
        sourceCallId: log.id,
        notes: input.notes || null,
      })
      followupId = followup.id
    } catch (error) {
      console.error('Failed to schedule follow-up from call disposition:', error)
    }
  }
  return { ok: true, followupId }
}

// Provider status callback (webhook). Correlated by our internal call id (echoed back via the
// provider's CustomField) or the provider call id; never carries a number to us.
export async function updateCallStatusFromWebhook(input: { providerCallId?: string | null; internalCallId?: string | null; status?: string | null; durationSec?: number | null }) {
  const providerCallId = String(input.providerCallId || '').trim()
  const internalCallId = String(input.internalCallId || '').trim()
  if (!providerCallId && !internalCallId) return { updated: 0 }
  const status = String(input.status || '').trim().toLowerCase()
  const known = ['initiated', 'ringing', 'connected', 'completed', 'failed', 'no_answer']
  // Prefer our own id (exact, provider-agnostic); fall back to the provider's call id.
  const match = internalCallId ? eq(kiaCallLogs.id, internalCallId) : eq(kiaCallLogs.providerCallId, providerCallId)
  const rows = await db.update(kiaCallLogs)
    .set({
      // Backfill the provider call id if we learned it from a callback keyed on our internal id.
      providerCallId: providerCallId || undefined,
      status: known.includes(status) ? status : undefined,
      durationSec: Number.isFinite(Number(input.durationSec)) ? Math.max(0, Math.floor(Number(input.durationSec))) : undefined,
      endedAt: status === 'completed' || status === 'failed' || status === 'no_answer' ? new Date() : undefined,
      connectedAt: status === 'connected' ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(match)
    .returning({ id: kiaCallLogs.id })
  return { updated: rows.length }
}
