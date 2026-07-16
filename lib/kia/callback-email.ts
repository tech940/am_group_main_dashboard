import 'server-only'

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { env } from '@/config/env-config'
import { ALL_BRANCH_OPTION, hasAllBranchAccess } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { parseUserDealers } from '@/lib/dealers/registry'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { buildCallbackRequestEmail } from '@/lib/email/templates/callback-request'

const KIA_BRAND = 'kia'
// Emailed besides the booking's assigned Sales Executive. `general_manager` is the "Sales General
// Manager" (service_general_manager is deliberately NOT included). DEALER-SCOPED to the booking's dealer.
const MANAGER_ROLES = ['sales_manager', 'general_manager', 'md'] as const
// Always copied on every callback request, any dealer.
const TECH_EMAIL = 'tech@amgroupind.com'

export type KiaCallbackBooking = {
  id: string
  createdBy: string | null
  dealerCode: string | null
  bookingNumber: string
  customerName: string
  model: string
}

// Mirrors lib/auth/dealer-scope.ts `canAccessDealer`, but works off a plain user row
// (role/brand/dealers) so we can filter recipients without constructing an AppUser.
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

/** The booking's assigned Sales Executive (whoever created it). */
async function getSalesPersonEmail(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)
  return cleanEmail(user?.email) || null
}

/** Sales Manager / Sales General Manager / MD for the booking's dealer. */
async function getDealerScopedManagerEmails(dealerCode: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email, role: users.role, brand: users.brand, dealers: users.dealers })
    .from(users)
    .where(and(
      inArray(users.role, [...MANAGER_ROLES]),
      eq(users.isActive, true),
      isNull(users.deletedAt),
      or(eq(users.brand, KIA_BRAND), eq(users.brand, ALL_BRANCH_OPTION.value), isNull(users.brand))!,
    ))
  return rows
    .filter((row) => userCanAccessDealer(row, dealerCode))
    .map((row) => cleanEmail(row.email))
    .filter(Boolean)
}

/**
 * Email the booking's Sales Executive + the dealer's Sales Manager / Sales GM / MD + tech@ that a
 * customer requested a callback. Content is BASIC ONLY (customer name + booking number + model) —
 * never the customer's phone / email / address; staff open the booking for those.
 * Never throws: the caller must not fail the customer's request because an email failed.
 */
export async function sendKiaCallbackRequestEmail(params: {
  booking: KiaCallbackBooking
  preferredTime?: string | null
  note?: string | null
}): Promise<{ ok: boolean; recipients: number }> {
  const { booking, preferredTime, note } = params
  const dealerCode = String(booking.dealerCode || '').trim()

  const [salesPersonEmail, managerEmails] = await Promise.all([
    getSalesPersonEmail(booking.createdBy),
    dealerCode ? getDealerScopedManagerEmails(dealerCode) : Promise.resolve([] as string[]),
  ])

  // Dedupe — one person may hold several of these roles.
  const recipients = Array.from(new Set([
    ...(salesPersonEmail ? [salesPersonEmail] : []),
    ...managerEmails,
    TECH_EMAIL,
  ].filter(Boolean)))

  if (!recipients.length) return { ok: false, recipients: 0 }

  const base = String(env.app.url || '').replace(/\/$/, '')
  const email = buildCallbackRequestEmail({
    customerName: booking.customerName,
    bookingNumber: booking.bookingNumber,
    model: booking.model,
    preferredTime,
    note,
    dealerCode: booking.dealerCode,
    bookingUrl: base ? `${base}/brands/kia/proforma?bookingId=${booking.id}` : null,
  })

  const result = await sendTrackedEmail({
    to: recipients,
    subject: email.subject,
    html: email.html,
    text: email.text,
    bookingId: booking.id,
    emailType: 'callback_request',
  })

  return { ok: result.ok, recipients: recipients.length }
}
