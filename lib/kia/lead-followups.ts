import 'server-only'

import { and, desc, eq, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookingActivity, kiaBookings, kiaLeadFollowups, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'

// The KIA lead follow-up pipeline. A follow-up is a scheduled "next touch" on a booking. Customer
// phone numbers are NEVER selected or returned here — the pipeline shows names/models/status only,
// matching the masked Call Center. Assignment defaults to the booking's sales consultant.

const REASONS = new Set(['callback', 'payment_pending', 'document_pending', 'delivery', 'general'])
const PRIORITIES = new Set(['low', 'normal', 'high'])
const OUTCOMES = new Set(['reached', 'no_answer', 'rescheduled', 'not_interested', 'converted', 'done'])

const IST_OFFSET_MIN = 330 // Asia/Kolkata, no DST

function istDayBoundaries(base = new Date()) {
  const ist = new Date(base.getTime() + IST_OFFSET_MIN * 60_000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth()
  const d = ist.getUTCDate()
  const endOfTodayUtc = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MIN * 60_000)
  const endOfWeekUtc = new Date(Date.UTC(y, m, d + 7, 23, 59, 59, 999) - IST_OFFSET_MIN * 60_000)
  return { endOfTodayUtc, endOfWeekUtc }
}

export type FollowupBucket = 'overdue' | 'today' | 'upcoming' | 'later' | 'done'

export type FollowupRow = {
  id: string
  bookingId: string
  customerName: string
  model: string | null
  variant: string | null
  bookingNumber: string | null
  bookingStatus: string
  dealer: string | null
  assignedTo: string | null
  assignedName: string | null
  dueAt: string
  status: string
  reason: string
  priority: string
  notes: string | null
  source: string
  outcome: string | null
  completedAt: string | null
  createdAt: string
  bucket: FollowupBucket
}

function bucketFor(status: string, dueAtIso: string, now: Date, endOfTodayUtc: Date, endOfWeekUtc: Date): FollowupBucket {
  if (status === 'done') return 'done'
  const due = new Date(dueAtIso)
  if (due.getTime() < now.getTime()) return 'overdue'
  if (due.getTime() <= endOfTodayUtc.getTime()) return 'today'
  if (due.getTime() <= endOfWeekUtc.getTime()) return 'upcoming'
  return 'later'
}

// Resolve the sales person for a booking: prefer the consultant email → active user; fall back to
// the booking creator. Always returns a display name + email (for the reminder digest).
async function resolveAssignee(booking: { consultantName: string | null; consultantEmail: string | null; createdBy: string }) {
  const email = String(booking.consultantEmail || '').trim().toLowerCase()
  if (email) {
    const [byEmail] = await db.select({ id: users.id, name: users.fullName, email: users.email })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email}`, eq(users.isActive, true), isNull(users.deletedAt)))
      .limit(1)
    if (byEmail) return { id: byEmail.id, name: booking.consultantName || byEmail.name, email: byEmail.email }
  }
  const [creator] = await db.select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.id, booking.createdBy), isNull(users.deletedAt)))
    .limit(1)
  return {
    id: creator?.id || null,
    name: booking.consultantName || creator?.name || null,
    email: booking.consultantEmail || creator?.email || null,
  }
}

const displaySelection = {
  id: kiaLeadFollowups.id,
  bookingId: kiaLeadFollowups.bookingId,
  assignedTo: kiaLeadFollowups.assignedTo,
  assignedName: kiaLeadFollowups.assignedName,
  dueAt: kiaLeadFollowups.dueAt,
  status: kiaLeadFollowups.status,
  reason: kiaLeadFollowups.reason,
  priority: kiaLeadFollowups.priority,
  notes: kiaLeadFollowups.notes,
  source: kiaLeadFollowups.source,
  outcome: kiaLeadFollowups.outcome,
  completedAt: kiaLeadFollowups.completedAt,
  createdAt: kiaLeadFollowups.createdAt,
  customerName: kiaBookings.customerName,
  model: kiaBookings.model,
  variant: kiaBookings.variant,
  bookingNumber: kiaBookings.bookingNumber,
  bookingStatus: kiaBookings.status,
  dealer: kiaBookings.dealerCode,
} as const

function toRow(r: Record<string, unknown>, now: Date, endOfTodayUtc: Date, endOfWeekUtc: Date): FollowupRow {
  const dueAt = (r.dueAt as Date).toISOString()
  return {
    id: r.id as string,
    bookingId: r.bookingId as string,
    customerName: (r.customerName as string) || 'Customer',
    model: (r.model as string) ?? null,
    variant: (r.variant as string) ?? null,
    bookingNumber: (r.bookingNumber as string) ?? null,
    bookingStatus: (r.bookingStatus as string) ?? '',
    dealer: (r.dealer as string) ?? null,
    assignedTo: (r.assignedTo as string) ?? null,
    assignedName: (r.assignedName as string) ?? null,
    dueAt,
    status: r.status as string,
    reason: r.reason as string,
    priority: r.priority as string,
    notes: (r.notes as string) ?? null,
    source: r.source as string,
    outcome: (r.outcome as string) ?? null,
    completedAt: r.completedAt ? (r.completedAt as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
    bucket: bucketFor(r.status as string, dueAt, now, endOfTodayUtc, endOfWeekUtc),
  }
}

export async function listFollowups(appUser: AppUser, input: { mine?: boolean; search?: string | null; reason?: string | null; dealer?: string | null }) {
  const now = new Date()
  const { endOfTodayUtc, endOfWeekUtc } = istDayBoundaries(now)
  const search = String(input.search || '').trim()

  const where = [isNull(kiaBookings.deletedAt)]
  if (input.mine) where.push(eq(kiaLeadFollowups.assignedTo, appUser.id))
  if (input.reason && REASONS.has(input.reason)) where.push(eq(kiaLeadFollowups.reason, input.reason))
  if (input.dealer) where.push(eq(kiaLeadFollowups.dealerCode, input.dealer))
  if (search) {
    where.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
    )!)
  }

  // Open (pending) follow-ups + recently completed/cancelled for context — independent, so run
  // both concurrently rather than stacking two round-trips.
  const [open, doneRecent] = await Promise.all([
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(...where, eq(kiaLeadFollowups.status, 'pending')))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(300),
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(...where, inArray(kiaLeadFollowups.status, ['done', 'cancelled'])))
      .orderBy(desc(kiaLeadFollowups.updatedAt))
      .limit(50),
  ])

  const rows = [...open, ...doneRecent].map((r) => toRow(r as Record<string, unknown>, now, endOfTodayUtc, endOfWeekUtc))
  const counts = { overdue: 0, today: 0, upcoming: 0, later: 0, done: 0 }
  for (const r of rows) counts[r.bucket]++

  return { rows, counts, now: now.toISOString() }
}

export async function createFollowup(appUser: AppUser, input: {
  bookingId: string
  dueAt: string
  reason?: string
  priority?: string
  notes?: string | null
  source?: 'manual' | 'call' | 'callback_request'
  sourceCallId?: string | null
  assignedTo?: string | null
}): Promise<FollowupRow> {
  const bookingId = String(input.bookingId || '').trim()
  if (!bookingId) throw new Error('Select a customer to follow up with.')
  const due = new Date(input.dueAt)
  if (Number.isNaN(due.getTime())) throw new Error('Enter a valid follow-up date and time.')

  const [booking] = await db.select({
    id: kiaBookings.id,
    consultantName: kiaBookings.consultantName,
    consultantEmail: kiaBookings.consultantEmail,
    dealerCode: kiaBookings.dealerCode,
    createdBy: kiaBookings.createdBy,
  }).from(kiaBookings).where(and(eq(kiaBookings.id, bookingId), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) throw new Error('Booking not found.')

  let assignee: { id: string | null; name: string | null; email: string | null }
  if (input.assignedTo) {
    const [u] = await db.select({ id: users.id, name: users.fullName, email: users.email })
      .from(users).where(and(eq(users.id, input.assignedTo), isNull(users.deletedAt))).limit(1)
    assignee = { id: u?.id || null, name: u?.name || null, email: u?.email || null }
  } else {
    assignee = await resolveAssignee(booking)
  }

  const reason = input.reason && REASONS.has(input.reason) ? input.reason : 'general'
  const priority = input.priority && PRIORITIES.has(input.priority) ? input.priority : 'normal'

  const [created] = await db.insert(kiaLeadFollowups).values({
    bookingId,
    assignedTo: assignee.id,
    assignedName: assignee.name,
    assignedEmail: assignee.email,
    dealerCode: booking.dealerCode,
    dueAt: due,
    status: 'pending',
    reason,
    priority,
    notes: input.notes ? String(input.notes).slice(0, 2000) : null,
    source: input.source || 'manual',
    sourceCallId: input.sourceCallId || null,
    createdBy: appUser.id,
  }).returning()

  await db.insert(kiaBookingActivity).values({
    bookingId,
    activityType: 'followup_scheduled',
    title: 'Follow-up scheduled',
    description: `Due ${due.toISOString()}${assignee.name ? ` · ${assignee.name}` : ''}${reason !== 'general' ? ` · ${reason.replace(/_/g, ' ')}` : ''}`,
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
    afterValue: { followupId: created.id, dueAt: due.toISOString(), reason, priority },
  })

  const now = new Date()
  const { endOfTodayUtc, endOfWeekUtc } = istDayBoundaries(now)
  const [row] = await db.select(displaySelection)
    .from(kiaLeadFollowups)
    .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
    .where(eq(kiaLeadFollowups.id, created.id)).limit(1)
  return toRow(row as Record<string, unknown>, now, endOfTodayUtc, endOfWeekUtc)
}

export async function updateFollowup(appUser: AppUser, id: string, patch: {
  dueAt?: string; reason?: string; priority?: string; notes?: string | null; assignedTo?: string | null
}) {
  const [existing] = await db.select().from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')
  if (existing.status !== 'pending') throw new Error('Only open follow-ups can be edited.')

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  const activityBits: string[] = []

  if (patch.dueAt) {
    const due = new Date(patch.dueAt)
    if (Number.isNaN(due.getTime())) throw new Error('Enter a valid follow-up date and time.')
    updates.dueAt = due
    updates.reminderSentAt = null // rescheduling re-arms the reminder
    activityBits.push(`rescheduled to ${due.toISOString()}`)
  }
  if (patch.reason && REASONS.has(patch.reason)) updates.reason = patch.reason
  if (patch.priority && PRIORITIES.has(patch.priority)) updates.priority = patch.priority
  if (patch.notes !== undefined) updates.notes = patch.notes ? String(patch.notes).slice(0, 2000) : null
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo) {
      const [u] = await db.select({ id: users.id, name: users.fullName, email: users.email })
        .from(users).where(and(eq(users.id, patch.assignedTo), isNull(users.deletedAt))).limit(1)
      if (!u) throw new Error('Assignee not found.')
      updates.assignedTo = u.id
      updates.assignedName = u.name
      updates.assignedEmail = u.email
      activityBits.push(`reassigned to ${u.name}`)
    } else {
      updates.assignedTo = null
    }
  }

  await db.update(kiaLeadFollowups).set(updates).where(eq(kiaLeadFollowups.id, id))
  if (activityBits.length) {
    await db.insert(kiaBookingActivity).values({
      bookingId: existing.bookingId,
      activityType: 'followup_updated',
      title: 'Follow-up updated',
      description: activityBits.join(' · '),
      actorUserId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
    })
  }
  return { ok: true }
}

export async function completeFollowup(appUser: AppUser, id: string, input: { outcome?: string | null; notes?: string | null; nextDueAt?: string | null }) {
  const [existing] = await db.select().from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')

  const outcome = input.outcome && OUTCOMES.has(input.outcome) ? input.outcome : null
  await db.update(kiaLeadFollowups).set({
    status: 'done',
    outcome,
    notes: input.notes ? String(input.notes).slice(0, 2000) : existing.notes,
    completedBy: appUser.id,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(kiaLeadFollowups.id, id))

  await db.insert(kiaBookingActivity).values({
    bookingId: existing.bookingId,
    activityType: 'followup_completed',
    title: 'Follow-up completed',
    description: outcome ? `Outcome: ${outcome.replace(/_/g, ' ')}` : 'Marked done',
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
  })

  // Chain a next follow-up (e.g. "reached, call again next week") without leaving the pipeline.
  let next: FollowupRow | null = null
  if (input.nextDueAt) {
    next = await createFollowup(appUser, {
      bookingId: existing.bookingId,
      dueAt: input.nextDueAt,
      reason: existing.reason,
      priority: existing.priority,
      source: 'manual',
      assignedTo: existing.assignedTo,
    })
  }
  return { ok: true, next }
}

export async function cancelFollowup(appUser: AppUser, id: string) {
  const [existing] = await db.select({ bookingId: kiaLeadFollowups.bookingId, status: kiaLeadFollowups.status })
    .from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')
  await db.update(kiaLeadFollowups).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(kiaLeadFollowups.id, id))
  await db.insert(kiaBookingActivity).values({
    bookingId: existing.bookingId,
    activityType: 'followup_cancelled',
    title: 'Follow-up cancelled',
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
  })
  return { ok: true }
}

// --- Reminders (used by the scheduler script — server-side, no client exposure) ---

export type DueFollowup = {
  id: string
  bookingId: string
  assignedTo: string | null
  assignedName: string | null
  assignedEmail: string | null
  dueAt: string
  reason: string
  priority: string
  customerName: string
  model: string | null
  bookingNumber: string | null
  dealer: string | null
}

export async function getDueFollowupsForReminders(): Promise<DueFollowup[]> {
  const rows = await db.select({
    id: kiaLeadFollowups.id,
    bookingId: kiaLeadFollowups.bookingId,
    assignedTo: kiaLeadFollowups.assignedTo,
    assignedName: kiaLeadFollowups.assignedName,
    assignedEmail: kiaLeadFollowups.assignedEmail,
    dueAt: kiaLeadFollowups.dueAt,
    reason: kiaLeadFollowups.reason,
    priority: kiaLeadFollowups.priority,
    customerName: kiaBookings.customerName,
    model: kiaBookings.model,
    bookingNumber: kiaBookings.bookingNumber,
    dealer: kiaBookings.dealerCode,
  })
    .from(kiaLeadFollowups)
    .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
    .where(and(
      eq(kiaLeadFollowups.status, 'pending'),
      isNull(kiaLeadFollowups.reminderSentAt),
      lte(kiaLeadFollowups.dueAt, new Date()),
      isNull(kiaBookings.deletedAt),
    ))
    .orderBy(kiaLeadFollowups.dueAt)
    .limit(500)

  return rows.map((r) => ({ ...r, dueAt: r.dueAt.toISOString() }))
}

export async function markReminderSent(ids: string[]) {
  if (!ids.length) return
  await db.update(kiaLeadFollowups).set({ reminderSentAt: new Date() }).where(inArray(kiaLeadFollowups.id, ids))
}

// Booking lookup for the "Add follow-up" dialog — searchable by name/model/booking number only, NO
// phone selected. Available to anyone with follow-up access (incl. call agents who lack Bookings).
export async function searchBookingsForFollowup(search: string) {
  const q = String(search || '').trim()
  const where = [isNull(kiaBookings.deletedAt)]
  if (q) {
    where.push(or(
      ilike(kiaBookings.customerName, `%${q}%`),
      ilike(kiaBookings.model, `%${q}%`),
      ilike(kiaBookings.bookingNumber, `%${q}%`),
    )!)
  }
  return db.select({
    id: kiaBookings.id,
    customerName: kiaBookings.customerName,
    model: kiaBookings.model,
    variant: kiaBookings.variant,
    bookingNumber: kiaBookings.bookingNumber,
    dealer: kiaBookings.dealerCode,
    status: kiaBookings.status,
    consultantName: kiaBookings.consultantName,
  })
    .from(kiaBookings)
    .where(and(...where))
    .orderBy(desc(kiaBookings.createdAt))
    .limit(25)
}
