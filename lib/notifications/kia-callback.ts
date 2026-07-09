import 'server-only'

import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { notifications, users } from '@/lib/db/schema'
import { ALL_BRANCH_OPTION, hasAllBranchAccess } from '@/lib/branches'
import { hasGlobalAccessRole, isSuperAdminRole } from '@/lib/auth/roles'
import { parseUserDealers } from '@/lib/dealers/registry'

const KIA_BRAND = 'kia'
// Managers to notify besides the booking's assigned sales person. `general_manager` is the
// "Sales General Manager" (service_general_manager is deliberately NOT included). These are
// DEALER-SCOPED to the booking's dealer.
const MANAGER_ROLES = ['sales_manager', 'general_manager', 'md'] as const
// Oversight roles notified for EVERY callback regardless of dealer scope — the tech/admin team
// that monitors the whole system (and needs to see requests while testing).
const OVERSIGHT_ROLES = ['developer', 'admin'] as const

type UserRole = typeof users.$inferSelect['role']
type Recipient = { id: string; role: UserRole }

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

async function getSalesPerson(userId: string | null): Promise<Recipient | null> {
  if (!userId) return null
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)
  return user || null
}

async function getDealerScopedManagers(dealerCode: string): Promise<Recipient[]> {
  const rows = await db
    .select({ id: users.id, role: users.role, brand: users.brand, dealers: users.dealers })
    .from(users)
    .where(and(
      inArray(users.role, [...MANAGER_ROLES]),
      eq(users.isActive, true),
      isNull(users.deletedAt),
      or(eq(users.brand, KIA_BRAND), eq(users.brand, ALL_BRANCH_OPTION.value), isNull(users.brand))!,
    ))
  return rows
    .filter((row) => userCanAccessDealer(row, dealerCode))
    .map((row) => ({ id: row.id, role: row.role }))
}

// Global oversight recipients (developer / admin) — every callback, any dealer, any brand.
async function getOversightUsers(): Promise<Recipient[]> {
  return db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(
      inArray(users.role, [...OVERSIGHT_ROLES]),
      eq(users.isActive, true),
      isNull(users.deletedAt),
    ))
}

/**
 * Notify the booking's sales person + the dealer's Sales Manager / Sales GM / MD that a customer
 * requested a callback. Content is BASIC ONLY (customer name + booking number + model) — never
 * the customer's phone / email / address. Idempotent via (userId, dedupeKey) so repeat clicks
 * that reuse the same callback request don't spam.
 */
export async function createKiaCallbackNotifications(params: {
  booking: KiaCallbackBooking
  callbackRequestId: string
  preferredTime?: string | null
}) {
  const { booking, callbackRequestId, preferredTime } = params
  const dealerCode = String(booking.dealerCode || '').trim()

  const [salesPerson, managers, oversight] = await Promise.all([
    getSalesPerson(booking.createdBy),
    dealerCode ? getDealerScopedManagers(dealerCode) : Promise.resolve([] as Recipient[]),
    getOversightUsers(),
  ])

  const recipients = new Map<string, Recipient>()
  if (salesPerson) recipients.set(salesPerson.id, salesPerson)
  for (const manager of managers) recipients.set(manager.id, manager)
  for (const admin of oversight) recipients.set(admin.id, admin)

  if (recipients.size === 0) return

  const vehicle = String(booking.model || '').trim()
  const title = 'Callback requested'
  const message = `${booking.customerName} requested a callback · ${booking.bookingNumber}${vehicle ? ` (${vehicle})` : ''}`
  const actionUrl = `/brands/kia/bookings?bookingId=${booking.id}`
  const createdAt = new Date()

  await db
    .insert(notifications)
    .values(Array.from(recipients.values()).map((recipient) => ({
      userId: recipient.id,
      title,
      message,
      type: 'info' as const,
      actionUrl,
      entityType: 'kia_callback',
      entityId: booking.id,
      referenceNumber: booking.bookingNumber,
      targetRole: recipient.role,
      dedupeKey: `callback:${callbackRequestId}`,
      createdAt,
      metadata: {
        module: 'kia_bookings',
        event: 'callback_requested',
        callbackRequestId,
        bookingId: booking.id,
        model: booking.model,
        dealerCode: booking.dealerCode,
        preferredTime: preferredTime || null,
      },
    })))
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
}
