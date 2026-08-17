import 'server-only'

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookings, kiaVehicleAllocations, users } from '@/lib/db/schema'
import { env } from '@/config/env-config'
import { ALL_BRANCH_OPTION, hasAllBranchAccess } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { parseUserDealers } from '@/lib/dealers/registry'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { buildPaymentWindowRequestEmail } from '@/lib/email/templates/payment-window-request'
import { buildPaymentWindowDecisionEmail } from '@/lib/email/templates/payment-window-decision'
import { findCompetingBookings, policyWindowHours } from '@/lib/kia/payment-window-requests'

const KIA_BRAND = 'kia'
// The MD decides these. `developer` is included because isSuperAdminRole treats the two as
// equivalent everywhere else in the permission layer, and on a quiet dealer the developer is often
// the only account that can unblock a consultant.
const APPROVER_ROLES = ['md', 'developer'] as const
// Fallback so a request is never silently unseen when no MD row resolves for the dealer.
const TECH_EMAIL = 'tech@amgroupind.com'

/** Mirrors lib/auth/dealer-scope.ts canAccessDealer against a plain user row. */
function userCanAccessDealer(user: { role: string; brand: string | null; dealers: string | null }, dealerCode: string) {
  if (isSuperAdminRole(user.role) || hasGlobalAccessRole(user.role) || hasAllBranchAccess(user.brand)) return true
  const scoped = parseUserDealers(KIA_BRAND, user.dealers)
  if (!scoped.length) return true // unrestricted within the brand
  const target = dealerCode.trim().toUpperCase()
  return Boolean(target) && scoped.some((code) => code.toUpperCase() === target)
}

function cleanEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

async function getApproverEmails(dealerCode: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email, role: users.role, brand: users.brand, dealers: users.dealers })
    .from(users)
    .where(and(
      inArray(users.role, [...APPROVER_ROLES]),
      eq(users.isActive, true),
      isNull(users.deletedAt),
      or(eq(users.brand, KIA_BRAND), eq(users.brand, ALL_BRANCH_OPTION.value), isNull(users.brand))!,
    ))
  return rows
    .filter((row) => userCanAccessDealer(row, dealerCode))
    .map((row) => cleanEmail(row.email))
    .filter(Boolean)
}

function reviewUrl() {
  const base = String(env.app.url || '').replace(/\/$/, '')
  return base ? `${base}/brands/kia/proforma/payment-window-requests` : null
}

function bookingUrl(bookingId: string) {
  const base = String(env.app.url || '').replace(/\/$/, '')
  return base ? `${base}/brands/kia/proforma?booking=${encodeURIComponent(bookingId)}` : null
}

/**
 * Tell the MD a consultant wants extra payment time.
 *
 * NEVER THROWS — the allotment has already succeeded by the time this runs, and a mail problem must
 * not turn a completed allotment into an error the consultant sees.
 */
export async function notifyMdOfPaymentWindowRequest(params: {
  bookingId: string
  requestedDays: number
  reason: string
  requestedByName: string
}): Promise<{ ok: boolean; recipients: string[] }> {
  try {
    const [booking] = await db.select().from(kiaBookings)
      .where(eq(kiaBookings.id, params.bookingId)).limit(1)
    if (!booking) return { ok: false, recipients: [] }

    const [allocation] = await db.select().from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, params.bookingId), isNull(kiaVehicleAllocations.releasedAt)))
      .limit(1)

    const dealerCode = String(booking.dealerCode || '')
    const approvers = await getApproverEmails(dealerCode)
    const recipients = Array.from(new Set([...approvers, TECH_EMAIL])).filter(Boolean)
    if (!approvers.length) {
      console.warn(`[payment-window-email] no MD/developer resolved for dealer "${dealerCode}" — falling back to ${TECH_EMAIL}. Check the MD user's dealers value.`)
    }

    // A count only: naming other customers belongs on the permission-gated review screen, not in an
    // inbox. Guarded so a matcher problem cannot block the notification.
    let competing = 0
    if (allocation) {
      try {
        competing = (await findCompetingBookings([allocation.id])).get(allocation.id)?.length ?? 0
      } catch (error) {
        console.error('[payment-window-email] competing-booking count failed', error)
      }
    }

    const { subject, html, text } = buildPaymentWindowRequestEmail({
      bookingNumber: booking.bookingNumber,
      customerName: booking.customerName,
      model: booking.model,
      variant: booking.variant,
      vinNumber: allocation?.vinNumber || String(booking.allocatedVin || '—'),
      dealerCode: booking.dealerCode,
      currentWindowHours: allocation?.paymentWindowHours ?? policyWindowHours(booking),
      requestedDays: params.requestedDays,
      reason: params.reason,
      requestedByName: params.requestedByName,
      competingBookings: competing,
      reviewUrl: reviewUrl(),
    })

    const result = await sendTrackedEmail({
      to: recipients,
      subject,
      html,
      text,
      bookingId: params.bookingId,
      emailType: 'payment_window_request',
    })
    return { ok: result.ok, recipients }
  } catch (error) {
    console.error('[payment-window-email] MD notification failed', error)
    return { ok: false, recipients: [] }
  }
}

/**
 * Tell the requesting consultant what the MD decided. Never throws — the decision is already
 * committed by the time this runs.
 */
export async function notifyRequesterOfPaymentWindowDecision(params: {
  bookingId: string
  decision: 'APPROVED' | 'REJECTED'
  requesterEmail: string | null
  bookingNumber: string | null
  customerName: string | null
  vinNumber: string
  requestedDays: number
  approvedDays?: number | null
  newDeadline?: Date | null
  startsOnArrival?: boolean
  decidedByName: string
  remarks?: string | null
}): Promise<{ ok: boolean; recipients: string[] }> {
  try {
    const to = cleanEmail(params.requesterEmail)
    if (!to) {
      console.warn('[payment-window-email] no requester email on file; decision not emailed')
      return { ok: false, recipients: [] }
    }

    const { subject, html, text } = buildPaymentWindowDecisionEmail({
      decision: params.decision,
      bookingNumber: params.bookingNumber || '—',
      customerName: params.customerName || '—',
      vinNumber: params.vinNumber,
      requestedDays: params.requestedDays,
      approvedDays: params.approvedDays ?? null,
      newDeadline: params.newDeadline ?? null,
      startsOnArrival: params.startsOnArrival,
      decidedByName: params.decidedByName,
      remarks: params.remarks ?? null,
      bookingUrl: bookingUrl(params.bookingId),
    })

    const result = await sendTrackedEmail({
      to,
      subject,
      html,
      text,
      bookingId: params.bookingId,
      emailType: 'payment_window_decision',
    })
    return { ok: result.ok, recipients: [to] }
  } catch (error) {
    console.error('[payment-window-email] decision notification failed', error)
    return { ok: false, recipients: [] }
  }
}
