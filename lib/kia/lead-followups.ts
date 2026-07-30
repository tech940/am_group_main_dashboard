import 'server-only'

import { and, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaBookingActivity, kiaBookings, kiaLeadFollowups, users } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { canRevealKiaFollowupPhone } from '@/lib/kia/pii'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'

// The KIA lead follow-up pipeline. A follow-up is a scheduled "next touch" on a booking.
//
// PII — READ THIS BEFORE TOUCHING displaySelection/toRow:
// The customer's phone number IS included in the list payload, but ONLY for roles that pass
// canRevealKiaFollowupPhone (CRE / MD / Developer / Finance Head — see lib/kia/pii.ts for why that
// exception exists at all). For every other role it is nulled out in toRow() and never serialised.
//
// It is redacted in the MAPPER, not the query: the SQL always selects it so there's one code path,
// and toRow is the single choke point that decides who gets it. If you add another way to build a
// FollowupRow, it must go through toRow or it will leak.
//
// This was previously an on-click reveal endpoint that audited every lookup. That was traded away
// (user decision) for a prefetch: clicking Call now costs no request, and in exchange we can no
// longer say WHICH customer's number someone looked at — only that they loaded the list.
// Assignment defaults to the booking's sales consultant.

const REASONS = new Set([
  'callback', 'payment_pending', 'document_pending', 'delivery', 'general',
  'fake_booking', 'demo_vehicle', 'repeated_booking', 'pending',
  'followup_call', 'customer_request', 'no_answer', 'payment_delay', 'customer_concern', '__custom__'
])
const PRIORITIES = new Set(['low', 'normal', 'high'])
const OUTCOMES = new Set(['reached', 'no_answer', 'rescheduled', 'not_interested', 'converted', 'done'])

/** Outcomes that mean the customer was actually spoken to, so the next touch is due in 7 days. */
const CONTACTED_OUTCOMES = new Set(['reached', 'done'])

/** Why the customer declined. Preset so the analytics dashboard can rank reasons. */
export const NOT_INTERESTED_REASONS = [
  'price',
  'bought_elsewhere',
  'finance_declined',
  'postponed',
  'model_unavailable',
  'other',
] as const
const NOT_INTERESTED_REASON_SET = new Set<string>(NOT_INTERESTED_REASONS)

/** Days between a successful contact and the next scheduled follow-up. */
export const FOLLOWUP_REPEAT_DAYS = 7

/** Remarks are mandatory on every submission; this is what stops "ok" counting as detail. */
export const MIN_REMARK_LENGTH = 10

/**
 * Remarks are mandatory on every submission. The pipeline IS the customer's communication history —
 * a follow-up with no note is a call nobody can audit, and the next CRE to pick the booking up has
 * no idea what was said. The minimum length is what stops "ok" / "done" passing as detail.
 */
function parseIstDate(value: string | Date): Date {
  if (value instanceof Date) return value
  const str = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
    return new Date(`${str}:00+05:30`)
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) {
    return new Date(`${str}+05:30`)
  }
  return new Date(str)
}

function requireRemarks(value: unknown, bypass = false): string {
  const notes = String(value ?? '').trim()
  if (!notes) {
    if (bypass) return 'System status update'
    throw new Error('Remarks are required — record what was discussed with the customer.')
  }
  if (bypass) {
    return notes.slice(0, 2000)
  }
  const words = notes.split(/\s+/).filter(Boolean).length
  if (words < 10) {
    throw new Error('Remarks must be at least 10 words — record what was discussed with the customer.')
  }
  return notes.slice(0, 2000)
}

const IST_OFFSET_MIN = 330 // Asia/Kolkata, no DST

function istDayBoundaries(base = new Date()) {
  const ist = new Date(base.getTime() + IST_OFFSET_MIN * 60_000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth()
  const d = ist.getUTCDate()
  const startOfTodayUtc = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MIN * 60_000)
  const endOfTodayUtc = new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - IST_OFFSET_MIN * 60_000)
  const endOfTomorrowUtc = new Date(Date.UTC(y, m, d + 1, 23, 59, 59, 999) - IST_OFFSET_MIN * 60_000)
  return { startOfTodayUtc, endOfTodayUtc, endOfTomorrowUtc }
}

/**
 * The three categories. Between them they show EVERY open follow-up — nothing is hidden.
 *
 * An earlier cut treated this as a due-now work queue, so anything scheduled past tomorrow was in no
 * bucket at all. Combined with the 7-day repeat that left the page looking empty even when bookings
 * were mid-journey. "Pending Follow-ups" means everything still open, which is both the plain
 * reading and what's actually useful.
 *
 * Mutually exclusive, so a booking appears exactly once:
 * - `not_connected` — the last attempt didn't reach anyone (latest completed follow-up had outcome
 *   'no_answer') and nothing is scheduled. Needs a retry. NOTE this is a per-BOOKING fact, not a
 *   per-row one, which is why it needs its own query rather than row-level bucketing.
 * - `next_day` — open and due tomorrow (IST). Tomorrow's call list, pulled out as a heads-up.
 * - `pending` — every other open follow-up, overdue first. The `overdue` flag on each row drives the
 *   red indicator.
 */
export type FollowupBucket = 'not_connected' | 'customer_concerns' | 'pending' | 'next_day' | 'scheduled' | 'cancelled' | 'rescheduled' | 'delivered'

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
  consultantName: string | null
  dueAt: string
  status: string
  reason: string
  priority: string
  notes: string | null
  source: string
  outcome: string | null
  notInterestedReason: string | null
  completedAt: string | null
  createdAt: string
  bucket: FollowupBucket
  overdue: boolean
  /** Null unless the viewer passes canRevealKiaFollowupPhone. Nulled in toRow(), never in the SQL. */
  customerPhone: string | null
  remarksCount: number
}

/** The follow-up's due time has passed — drives the overdue indicator inside the Pending bucket. */
function isOverdue(dueAtIso: string, now: Date) {
  return new Date(dueAtIso).getTime() < now.getTime()
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
  notInterestedReason: kiaLeadFollowups.notInterestedReason,
  completedAt: kiaLeadFollowups.completedAt,
  createdAt: kiaLeadFollowups.createdAt,
  customerName: kiaBookings.customerName,
  consultantName: kiaBookings.consultantName,
  // Selected for everyone, released to almost nobody — toRow() nulls it unless the viewer passes
  // canRevealKiaFollowupPhone. Keep the redaction there, not here: one choke point, not two.
  customerPhone: kiaBookings.customerPhone,
  model: kiaBookings.model,
  variant: kiaBookings.variant,
  bookingNumber: kiaBookings.bookingNumber,
  bookingStatus: kiaBookings.status,
  dealer: kiaBookings.dealerCode,
  remarksCount: sql<number>`(select count(*)::int from ${kiaBookingActivity} where ${kiaBookingActivity.bookingId} = ${kiaBookings.id})`.as('remarks_count'),
} as const

function toRow(r: Record<string, unknown>, now: Date, bucket: FollowupBucket, canSeePhone: boolean): FollowupRow {
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
    consultantName: (r.consultantName as string) ?? null,
    dueAt,
    status: r.status as string,
    reason: r.reason as string,
    priority: r.priority as string,
    notes: (r.notes as string) ?? null,
    source: r.source as string,
    outcome: (r.outcome as string) ?? null,
    notInterestedReason: (r.notInterestedReason as string) ?? null,
    completedAt: r.completedAt ? (r.completedAt as Date).toISOString() : null,
    createdAt: (r.createdAt as Date).toISOString(),
    bucket,
    overdue: (bucket === 'pending' || bucket === 'rescheduled') && isOverdue(dueAt, now),
    // THE redaction. Everything below this line reaches the browser, so a role that can't reveal
    // numbers must get null — not a masked string, not the value with a flag: null.
    customerPhone: canSeePhone ? ((r.customerPhone as string) || null) : null,
    remarksCount: Number(r.remarksCount || 0),
  }
}

export async function listFollowups(appUser: AppUser, input: { 
  mine?: boolean; 
  search?: string | null; 
  reason?: string | null; 
  rescheduleReason?: string | null;
  dealer?: string | null;
  allowedDealers?: string[] | null;
  startDate?: string | null;
  endDate?: string | null;
  dateField?: 'due_date' | 'booking_date' | 'completed_date' | null;
  model?: string | null;
  bookingStatus?: string | null;
  priority?: string | null;
  assignedTo?: string | null;
}) {
  const now = new Date()
  const { startOfTodayUtc, endOfTodayUtc, endOfTomorrowUtc } = istDayBoundaries(now)
  const search = String(input.search || '').trim()

  const where = [
    isNull(kiaBookings.deletedAt),
    // Follow-ups stop at delivery.
    ne(kiaBookings.status, 'delivered'),
    // Exclude cancelled bookings from the active work queue buckets.
    ne(kiaBookings.status, 'cancelled'),
  ]

  if (input.mine) {
    where.push(eq(kiaLeadFollowups.assignedTo, appUser.id))
  } else if (input.assignedTo && input.assignedTo !== 'all') {
    where.push(eq(kiaLeadFollowups.assignedTo, input.assignedTo))
  }

  if (input.reason && input.reason !== 'all' && REASONS.has(input.reason)) {
    where.push(eq(kiaLeadFollowups.reason, input.reason))
  }

  if (input.rescheduleReason && input.rescheduleReason !== 'all') {
    const rVal = input.rescheduleReason.trim()
    where.push(or(
      eq(kiaLeadFollowups.reason, rVal),
      eq(kiaLeadFollowups.outcome, rVal),
      ilike(kiaLeadFollowups.notes, `%${rVal}%`),
    )!)
  }

  if (input.priority && input.priority !== 'all' && PRIORITIES.has(input.priority)) {
    where.push(eq(kiaLeadFollowups.priority, input.priority))
  }

  if (input.model && input.model !== 'all') {
    where.push(ilike(kiaBookings.model, `%${input.model}%`))
  }

  if (input.bookingStatus && input.bookingStatus !== 'all') {
    where.push(eq(kiaBookings.status, input.bookingStatus))
  }

  const allowedDealers = input.allowedDealers !== undefined ? input.allowedDealers : getUserDealerScope(appUser, 'kia')
  if (allowedDealers && allowedDealers.length) {
    where.push(or(inArray(kiaLeadFollowups.dealerCode, allowedDealers), inArray(kiaBookings.dealerCode, allowedDealers))!)
  } else if (input.dealer && input.dealer !== 'all') {
    where.push(or(eq(kiaLeadFollowups.dealerCode, input.dealer), eq(kiaBookings.dealerCode, input.dealer))!)
  }

  if (search) {
    where.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.customerPhone, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
      ilike(kiaBookings.consultantName, `%${search}%`),
      ilike(kiaLeadFollowups.assignedName, `%${search}%`),
      ilike(kiaLeadFollowups.notes, `%${search}%`),
    )!)
  }

  // Cancelled where clause: bookings that are cancelled.
  const cancelledWhere = [
    isNull(kiaBookings.deletedAt),
    ne(kiaBookings.status, 'delivered'),
    eq(kiaBookings.status, 'cancelled'),
  ]
  if (input.mine) {
    cancelledWhere.push(eq(kiaLeadFollowups.assignedTo, appUser.id))
  } else if (input.assignedTo && input.assignedTo !== 'all') {
    cancelledWhere.push(eq(kiaLeadFollowups.assignedTo, input.assignedTo))
  }
  if (input.reason && input.reason !== 'all' && REASONS.has(input.reason)) {
    cancelledWhere.push(eq(kiaLeadFollowups.reason, input.reason))
  }
  if (input.rescheduleReason && input.rescheduleReason !== 'all') {
    const rVal = input.rescheduleReason.trim()
    cancelledWhere.push(or(
      eq(kiaLeadFollowups.reason, rVal),
      eq(kiaLeadFollowups.outcome, rVal),
      ilike(kiaLeadFollowups.notes, `%${rVal}%`),
    )!)
  }
  if (input.priority && input.priority !== 'all' && PRIORITIES.has(input.priority)) {
    cancelledWhere.push(eq(kiaLeadFollowups.priority, input.priority))
  }
  if (input.model && input.model !== 'all') {
    cancelledWhere.push(ilike(kiaBookings.model, `%${input.model}%`))
  }
  if (allowedDealers && allowedDealers.length) {
    cancelledWhere.push(or(inArray(kiaLeadFollowups.dealerCode, allowedDealers), inArray(kiaBookings.dealerCode, allowedDealers))!)
  } else if (input.dealer && input.dealer !== 'all') {
    cancelledWhere.push(or(eq(kiaLeadFollowups.dealerCode, input.dealer), eq(kiaBookings.dealerCode, input.dealer))!)
  }
  if (search) {
    cancelledWhere.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.customerPhone, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
      ilike(kiaBookings.consultantName, `%${search}%`),
      ilike(kiaLeadFollowups.assignedName, `%${search}%`),
      ilike(kiaLeadFollowups.notes, `%${search}%`),
    )!)
  }

  // Delivered where clause: bookings that are delivered.
  const deliveredWhere = [
    isNull(kiaBookings.deletedAt),
    eq(kiaBookings.status, 'delivered'),
  ]
  if (input.mine) {
    deliveredWhere.push(eq(kiaLeadFollowups.assignedTo, appUser.id))
  } else if (input.assignedTo && input.assignedTo !== 'all') {
    deliveredWhere.push(eq(kiaLeadFollowups.assignedTo, input.assignedTo))
  }
  if (input.reason && input.reason !== 'all' && REASONS.has(input.reason)) {
    deliveredWhere.push(eq(kiaLeadFollowups.reason, input.reason))
  }
  if (input.rescheduleReason && input.rescheduleReason !== 'all') {
    const rVal = input.rescheduleReason.trim()
    deliveredWhere.push(or(
      eq(kiaLeadFollowups.reason, rVal),
      eq(kiaLeadFollowups.outcome, rVal),
      ilike(kiaLeadFollowups.notes, `%${rVal}%`),
    )!)
  }
  if (input.priority && input.priority !== 'all' && PRIORITIES.has(input.priority)) {
    deliveredWhere.push(eq(kiaLeadFollowups.priority, input.priority))
  }
  if (input.model && input.model !== 'all') {
    deliveredWhere.push(ilike(kiaBookings.model, `%${input.model}%`))
  }
  if (allowedDealers && allowedDealers.length) {
    deliveredWhere.push(or(inArray(kiaLeadFollowups.dealerCode, allowedDealers), inArray(kiaBookings.dealerCode, allowedDealers))!)
  } else if (input.dealer && input.dealer !== 'all') {
    deliveredWhere.push(or(eq(kiaLeadFollowups.dealerCode, input.dealer), eq(kiaBookings.dealerCode, input.dealer))!)
  }
  if (search) {
    deliveredWhere.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.customerPhone, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
      ilike(kiaBookings.consultantName, `%${search}%`),
      ilike(kiaLeadFollowups.assignedName, `%${search}%`),
      ilike(kiaLeadFollowups.notes, `%${search}%`),
    )!)
  }

  // Date range filters logic
  const dateField = input.dateField || 'due_date'
  const dateColumn = dateField === 'booking_date'
    ? kiaBookings.createdAt
    : dateField === 'completed_date'
    ? kiaLeadFollowups.completedAt
    : kiaLeadFollowups.dueAt

  const hasDateFilter = Boolean(input.startDate || input.endDate)

  if (input.startDate) {
    const start = new Date(input.startDate)
    start.setHours(0, 0, 0, 0)
    where.push(gte(dateColumn, start))
    cancelledWhere.push(gte(dateColumn, start))
    deliveredWhere.push(gte(dateColumn, start))
  }
  if (input.endDate) {
    const end = new Date(new Date(input.endDate).setHours(23, 59, 59, 999))
    where.push(lte(dateColumn, end))
    cancelledWhere.push(lte(dateColumn, end))
    deliveredWhere.push(lte(dateColumn, end))
  }

  const [pending, nextDay, scheduled, notConnected, cancelled, rescheduled, noAnswerRetry, customerConcerns, delivered] = await Promise.all([
    // Open follow-ups due today and overdue, excluding explicitly rescheduled ones.
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        ne(kiaLeadFollowups.source, 'rescheduled'),
        ...(hasDateFilter && dateField === 'due_date' ? [] : [lte(kiaLeadFollowups.dueAt, endOfTodayUtc)]),
      ))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(500),
    // Due tomorrow (IST) — pulled out as the heads-up for tomorrow's call list, excluding rescheduled.
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        ne(kiaLeadFollowups.source, 'rescheduled'),
        ...(hasDateFilter && dateField === 'due_date'
          ? []
          : [gt(kiaLeadFollowups.dueAt, endOfTodayUtc), lte(kiaLeadFollowups.dueAt, endOfTomorrowUtc)]),
      ))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(300),
    // Scheduled in the future (due after tomorrow), excluding rescheduled.
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        ne(kiaLeadFollowups.source, 'rescheduled'),
        ...(hasDateFilter && dateField === 'due_date' ? [] : [gt(kiaLeadFollowups.dueAt, endOfTomorrowUtc)]),
      ))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(300),
    // Not Connected: matches any follow-up where outcome/reason = 'no_answer' OR notes contain 'no answer' / 'not answer' / 'not reachable' / 'did not answer'
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        or(
          eq(kiaLeadFollowups.outcome, 'no_answer'),
          eq(kiaLeadFollowups.reason, 'no_answer'),
          ilike(kiaLeadFollowups.notes, '%no answer%'),
          ilike(kiaLeadFollowups.notes, '%not answer%'),
          ilike(kiaLeadFollowups.notes, '%not reachable%'),
          ilike(kiaLeadFollowups.notes, '%did not answer%'),
        ),
      ))
      .orderBy(desc(kiaLeadFollowups.completedAt), desc(kiaLeadFollowups.createdAt))
      .limit(500),
    // Cancelled: follow-ups for bookings that are cancelled
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...cancelledWhere,
      ))
      .orderBy(desc(kiaLeadFollowups.dueAt))
      .limit(300),
    // Dedicated bucket for rescheduled followups — EXCLUDING retries-after-no_answer
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        eq(kiaLeadFollowups.source, 'rescheduled'),
        sql`NOT EXISTS (
          SELECT 1 FROM kia_lead_followups last_done
          WHERE last_done.booking_id = kia_lead_followups.booking_id
            AND last_done.status = 'done'
            AND last_done.outcome = 'no_answer'
            AND last_done.completed_at = (
              SELECT max(latest2.completed_at) FROM kia_lead_followups latest2
              WHERE latest2.booking_id = kia_lead_followups.booking_id AND latest2.status = 'done'
            )
        )`,
      ))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(500),
    // Retry-after-no-answer: pending rescheduled rows where the booking's latest completed attempt was 'no_answer'.
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        eq(kiaLeadFollowups.source, 'rescheduled'),
        sql`EXISTS (
          SELECT 1 FROM kia_lead_followups last_done
          WHERE last_done.booking_id = kia_lead_followups.booking_id
            AND last_done.status = 'done'
            AND last_done.outcome = 'no_answer'
            AND last_done.completed_at = (
              SELECT max(latest2.completed_at) FROM kia_lead_followups latest2
              WHERE latest2.booking_id = kia_lead_followups.booking_id AND latest2.status = 'done'
            )
        )`,
      ))
      .orderBy(kiaLeadFollowups.dueAt)
      .limit(300),
    // Customer Concerns: follow-ups with reason/outcome = 'customer_concern' OR notes ILIKE '%concern%'
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...where,
        eq(kiaLeadFollowups.status, 'pending'),
        or(
          eq(kiaLeadFollowups.reason, 'customer_concern'),
          eq(kiaLeadFollowups.outcome, 'customer_concern'),
          ilike(kiaLeadFollowups.notes, '%[CUSTOMER CONCERN]%'),
        ),
      ))
      .orderBy(desc(kiaLeadFollowups.updatedAt), desc(kiaLeadFollowups.createdAt))
      .limit(500),
    // Delivered: follow-ups for bookings that are delivered
    db.select(displaySelection)
      .from(kiaLeadFollowups)
      .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
      .where(and(
        ...deliveredWhere,
      ))
      .orderBy(desc(kiaLeadFollowups.dueAt))
      .limit(300),
  ])

  // Decided ONCE, here, from the viewer's role — then every row goes through toRow with it.
  const canSeePhone = canRevealKiaFollowupPhone(appUser.role)
  const rows = [
    ...customerConcerns.map((r) => toRow(r as Record<string, unknown>, now, 'customer_concerns', canSeePhone)),
    ...notConnected.map((r) => toRow(r as Record<string, unknown>, now, 'not_connected', canSeePhone)),
    ...noAnswerRetry.map((r) => toRow(r as Record<string, unknown>, now, 'not_connected', canSeePhone)),
    ...pending.map((r) => toRow(r as Record<string, unknown>, now, 'pending', canSeePhone)),
    ...nextDay.map((r) => toRow(r as Record<string, unknown>, now, 'next_day', canSeePhone)),
    ...scheduled.map((r) => toRow(r as Record<string, unknown>, now, 'scheduled', canSeePhone)),
    ...cancelled.map((r) => toRow(r as Record<string, unknown>, now, 'cancelled', canSeePhone)),
    ...rescheduled.map((r) => toRow(r as Record<string, unknown>, now, 'rescheduled', canSeePhone)),
    ...delivered.map((r) => toRow(r as Record<string, unknown>, now, 'delivered', canSeePhone)),
  ]
  const counts = {
    customer_concerns: customerConcerns.length,
    not_connected: notConnected.length + noAnswerRetry.length,
    pending: pending.length,
    next_day: nextDay.length,
    scheduled: scheduled.length,
    cancelled: cancelled.length,
    delivered: delivered.length,
    rescheduled: rescheduled.length,
    overdue: rows.filter((r) => r.overdue && r.bucket !== 'cancelled' && r.bucket !== 'delivered').length,
  }

  return { rows, counts, now: now.toISOString() }
}

/**
 * Flat, spreadsheet-shaped dump of EVERY follow-up (all statuses, all buckets) joined to its booking,
 * honouring the same optional filters as listFollowups (mine / reason / dealer / search / date range).
 *
 * PII — the customer phone number is DELIBERATELY not selected here. Unlike listFollowups (which
 * selects the phone and redacts it per-role in toRow), an export leaves the building as a file, so
 * there is no safe reader to gate on: the number must never be in the sheet for anyone. The selection
 * below is the guarantee — keep customerPhone out of it. See the top-of-file PII note.
 */
export type FollowupExportRow = {
  bookingNumber: string | null
  customerName: string | null
  model: string | null
  variant: string | null
  dealer: string | null
  consultantName: string | null
  assignedName: string | null
  reason: string
  priority: string
  status: string
  bookingStatus: string
  dueAt: Date | null
  outcome: string | null
  notInterestedReason: string | null
  notes: string | null
  source: string
  completedAt: Date | null
  createdAt: Date
}

export async function exportFollowups(appUser: AppUser, input: {
  mine?: boolean
  search?: string | null
  reason?: string | null
  dealer?: string | null
  startDate?: string | null
  endDate?: string | null
  dateField?: 'due_date' | 'booking_date' | 'completed_date' | null
  model?: string | null
  bookingStatus?: string | null
  priority?: string | null
}): Promise<FollowupExportRow[]> {
  const search = String(input.search || '').trim()

  // Every non-deleted booking's follow-ups — no delivered/cancelled exclusion: an export is a
  // complete record, not the live work queue.
  const where = [isNull(kiaBookings.deletedAt)]
  if (input.mine) where.push(eq(kiaLeadFollowups.assignedTo, appUser.id))
  if (input.reason && input.reason !== 'all' && REASONS.has(input.reason)) where.push(eq(kiaLeadFollowups.reason, input.reason))
  if (input.dealer && input.dealer !== 'all') where.push(eq(kiaLeadFollowups.dealerCode, input.dealer))
  if (input.priority && input.priority !== 'all' && PRIORITIES.has(input.priority)) where.push(eq(kiaLeadFollowups.priority, input.priority))
  if (input.model && input.model !== 'all') where.push(ilike(kiaBookings.model, `%${input.model}%`))
  if (input.bookingStatus && input.bookingStatus !== 'all') where.push(eq(kiaBookings.status, input.bookingStatus))
  if (search) {
    where.push(or(
      ilike(kiaBookings.customerName, `%${search}%`),
      ilike(kiaBookings.model, `%${search}%`),
      ilike(kiaBookings.bookingNumber, `%${search}%`),
      ilike(kiaBookings.consultantName, `%${search}%`),
      ilike(kiaLeadFollowups.assignedName, `%${search}%`),
    )!)
  }

  const dateField = input.dateField || 'due_date'
  const dateColumn = dateField === 'booking_date'
    ? kiaBookings.createdAt
    : dateField === 'completed_date'
    ? kiaLeadFollowups.completedAt
    : kiaLeadFollowups.dueAt

  if (input.startDate) {
    const start = new Date(input.startDate)
    start.setHours(0, 0, 0, 0)
    where.push(gte(dateColumn, start))
  }
  if (input.endDate) {
    where.push(lte(dateColumn, new Date(new Date(input.endDate).setHours(23, 59, 59, 999))))
  }

  // NOTE: customerPhone is intentionally ABSENT from this selection — do not add it.
  const rows = await db.select({
    bookingNumber: kiaBookings.bookingNumber,
    customerName: kiaBookings.customerName,
    model: kiaBookings.model,
    variant: kiaBookings.variant,
    dealer: kiaBookings.dealerCode,
    consultantName: kiaBookings.consultantName,
    assignedName: kiaLeadFollowups.assignedName,
    reason: kiaLeadFollowups.reason,
    priority: kiaLeadFollowups.priority,
    status: kiaLeadFollowups.status,
    bookingStatus: kiaBookings.status,
    dueAt: kiaLeadFollowups.dueAt,
    outcome: kiaLeadFollowups.outcome,
    notInterestedReason: kiaLeadFollowups.notInterestedReason,
    notes: kiaLeadFollowups.notes,
    source: kiaLeadFollowups.source,
    completedAt: kiaLeadFollowups.completedAt,
    createdAt: kiaLeadFollowups.createdAt,
  })
    .from(kiaLeadFollowups)
    .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
    .where(and(...where))
    .orderBy(desc(kiaLeadFollowups.createdAt))
    .limit(10000)

  return rows
}

export async function createFollowup(appUser: AppUser, input: {
  bookingId: string
  dueAt: string
  reason?: string
  priority?: string
  notes?: string | null
  source?: 'manual' | 'call' | 'callback_request' | 'rescheduled'
  sourceCallId?: string | null
  assignedTo?: string | null
}): Promise<FollowupRow> {
  const bookingId = String(input.bookingId || '').trim()
  if (!bookingId) throw new Error('Select a customer to follow up with.')
  const due = parseIstDate(input.dueAt)
  if (Number.isNaN(due.getTime())) throw new Error('Enter a valid follow-up date and time.')
  const notes = requireRemarks(input.notes)

  const [booking] = await db.select({
    id: kiaBookings.id,
    status: kiaBookings.status,
    consultantName: kiaBookings.consultantName,
    consultantEmail: kiaBookings.consultantEmail,
    dealerCode: kiaBookings.dealerCode,
    createdBy: kiaBookings.createdBy,
  }).from(kiaBookings).where(and(eq(kiaBookings.id, bookingId), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) throw new Error('Booking not found.')
  // The journey ends at delivery — never open a new follow-up on a delivered booking.
  if (booking.status === 'delivered') {
    throw new Error('This vehicle has been delivered — follow-ups are closed for this booking.')
  }

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
    notes,
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
  const { endOfTodayUtc } = istDayBoundaries(now)
  const [row] = await db.select(displaySelection)
    .from(kiaLeadFollowups)
    .innerJoin(kiaBookings, eq(kiaBookings.id, kiaLeadFollowups.bookingId))
    .where(eq(kiaLeadFollowups.id, created.id)).limit(1)

  // A new follow-up is always pending, so it's either due now (Pending) or scheduled ahead. The
  // list query is what decides the on-screen queue; this bucket just labels the row we hand back.
  const bucket: FollowupBucket = due.getTime() <= endOfTodayUtc.getTime() ? 'pending' : 'next_day'
  return toRow(row as Record<string, unknown>, now, bucket, canRevealKiaFollowupPhone(appUser.role))
}

export async function updateFollowup(appUser: AppUser, id: string, patch: {
  dueAt?: string; reason?: string; priority?: string; notes?: string | null; assignedTo?: string | null
}) {
  const [existing] = await db.select().from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')
  if (existing.status !== 'pending') throw new Error('Only open follow-ups can be edited.')

  // A reschedule/reassign is a submission too — say why. Without this the communication history has
  // gaps exactly where someone moved the goalposts.
  const notes = requireRemarks(patch.notes, Boolean(patch.reason))

  const updates: Record<string, unknown> = { updatedAt: new Date(), notes }
  const activityBits: string[] = []

  if (patch.dueAt) {
    const due = parseIstDate(patch.dueAt)
    if (Number.isNaN(due.getTime())) throw new Error('Enter a valid follow-up date and time.')
    updates.dueAt = due
    updates.reminderSentAt = null // rescheduling re-arms the reminder
    updates.source = 'rescheduled' // mark as rescheduled
    activityBits.push(`rescheduled to ${due.toISOString()}`)
  }
  if (patch.reason && REASONS.has(patch.reason)) updates.reason = patch.reason
  if (patch.priority && PRIORITIES.has(patch.priority)) updates.priority = patch.priority
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

  if (notes) {
    activityBits.push(`Remark: ${notes}`)
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

export async function completeFollowup(appUser: AppUser, id: string, input: {
  outcome?: string | null
  notes?: string | null
  notInterestedReason?: string | null
  nextDueAt?: string | null
}) {
  const [existing] = await db.select().from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')

  // Reject an unknown outcome rather than silently coercing it to null — a typo used to record a
  // completed follow-up with no outcome at all, which is invisible in both the pipeline and analytics.
  const outcome = String(input.outcome || '').trim()
  if (!outcome) throw new Error('Select the outcome of this follow-up.')
  if (!OUTCOMES.has(outcome)) throw new Error(`Unknown follow-up outcome "${outcome}".`)

  const notes = requireRemarks(input.notes, outcome === 'converted')

  // "Not Interested" must capture WHY, as a preset (so the analytics dashboard can rank reasons)
  // plus the mandatory detail already in notes.
  let notInterestedReason: string | null = null
  if (outcome === 'not_interested') {
    notInterestedReason = String(input.notInterestedReason || '').trim()
    if (!notInterestedReason) throw new Error('Select the customer\'s reason for not proceeding.')
    if (!NOT_INTERESTED_REASON_SET.has(notInterestedReason)) {
      throw new Error(`Unknown reason "${notInterestedReason}".`)
    }
  }

  await db.update(kiaLeadFollowups).set({
    status: 'done',
    outcome,
    notInterestedReason,
    notes,
    completedBy: appUser.id,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(kiaLeadFollowups.id, id))

  await db.insert(kiaBookingActivity).values({
    bookingId: existing.bookingId,
    activityType: 'followup_completed',
    title: 'Follow-up completed',
    description: notInterestedReason
      ? `Outcome: not interested — ${notInterestedReason.replace(/_/g, ' ')}`
      : `Outcome: ${outcome.replace(/_/g, ' ')}`,
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
  })

  // The customer was actually spoken to → keep the journey going: schedule the next touch 7 days
  // out automatically. An explicit nextDueAt still wins, so a CRE can override the cadence.
  //
  // Deliberately NOT for no_answer (that lands in the Not Connected queue for a retry instead),
  // nor for not_interested / converted (which end the cadence until someone re-engages by hand).
  // And never past delivery — a delivered booking is done with follow-ups.
  let next: FollowupRow | null = null
  const bookingDelivered = await isBookingDelivered(existing.bookingId)
  const shouldRepeat = !bookingDelivered && (Boolean(input.nextDueAt) || CONTACTED_OUTCOMES.has(outcome))

  if (shouldRepeat) {
    const dueAt = input.nextDueAt
      ? parseIstDate(input.nextDueAt)
      : new Date(Date.now() + FOLLOWUP_REPEAT_DAYS * 24 * 60 * 60 * 1000)
    next = await createFollowup(appUser, {
      bookingId: existing.bookingId,
      dueAt: dueAt.toISOString(),
      reason: existing.reason,
      priority: existing.priority,
      source: outcome === 'rescheduled' ? 'rescheduled' : 'manual',
      assignedTo: existing.assignedTo,
      notes: input.nextDueAt
        ? `Next touch scheduled by ${appUser.fullName} after: ${notes}`.slice(0, 2000)
        : `Auto-scheduled ${FOLLOWUP_REPEAT_DAYS} days after contact on ${new Date().toISOString().slice(0, 10)}.`,
    })
  }
  return { ok: true, next }
}

/** Follow-ups stop at delivery — see cancelKiaBookingFollowups. */
async function isBookingDelivered(bookingId: string) {
  const [booking] = await db.select({ status: kiaBookings.status })
    .from(kiaBookings).where(eq(kiaBookings.id, bookingId)).limit(1)
  return booking?.status === 'delivered'
}

/**
 * Cancels every pending follow-up for a booking. Called when the vehicle is delivered — the journey
 * is over, so nobody should be called again and no reminder email should go out.
 * Takes a tx so it can run inside the delivery transaction and roll back with it.
 */
export async function cancelKiaBookingFollowups(tx: {
  update: typeof db.update
  insert: typeof db.insert
}, bookingId: string, reason: string) {
  const cancelled = await tx.update(kiaLeadFollowups)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(kiaLeadFollowups.bookingId, bookingId), eq(kiaLeadFollowups.status, 'pending')))
    .returning({ id: kiaLeadFollowups.id })

  if (cancelled.length) {
    await tx.insert(kiaBookingActivity).values({
      bookingId,
      activityType: 'followup_cancelled',
      title: 'Follow-ups closed',
      description: `${cancelled.length} pending follow-up${cancelled.length === 1 ? '' : 's'} cancelled — ${reason}`,
      actorName: 'System',
      actorRole: 'system',
    })
  }
  return cancelled.length
}

export async function cancelFollowup(appUser: AppUser, id: string) {
  const [existing] = await db.select({ bookingId: kiaLeadFollowups.bookingId, status: kiaLeadFollowups.status })
    .from(kiaLeadFollowups).where(eq(kiaLeadFollowups.id, id)).limit(1)
  if (!existing) throw new Error('Follow-up not found.')

  await db.transaction(async (tx) => {
    // 1. Cancel the follow-up
    await tx.update(kiaLeadFollowups).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(kiaLeadFollowups.id, id))
    
    // 2. Cancel the booking
    await tx.update(kiaBookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(kiaBookings.id, existing.bookingId))

    // 3. Log activity
    await tx.insert(kiaBookingActivity).values({
      bookingId: existing.bookingId,
      activityType: 'followup_cancelled',
      title: 'Booking & Follow-up cancelled',
      actorUserId: appUser.id,
      actorName: appUser.fullName,
      actorRole: appUser.role,
    })
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
      // Never chase a customer whose vehicle is already handed over. Delivery cancels pending
      // follow-ups, but this is the guard that matters — the reminder emails read this table
      // directly, so a row cancelled by any other path must still never trigger a send.
      ne(kiaBookings.status, 'delivered'),
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
