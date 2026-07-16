import 'server-only'

import { and, asc, count, desc, eq, gte, ilike, isNotNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaFinancePayouts, kiaFinancePayoutActivity } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { canViewFinancePayoutMobile, maskFinancePayoutMobile } from '@/lib/finance/payouts-access'

/**
 * The Finance Payouts ledger — post-delivery bank/dealer/DSE payout tracking.
 *
 * INDEPENDENT of the booking workflow by design: rows are CREATED when a vehicle is delivered, but
 * nothing in this file ever writes booking state. It is not a booking stage.
 *
 * The booking-sourced columns are a SNAPSHOT taken at delivery (see kia_finance_payouts in
 * lib/db/schema.ts for why), so everything here reads one table — no join to kia_bookings on the
 * hot list path.
 */

// ── Field model ─────────────────────────────────────────────────────────────────────────────────

/** Where the vehicle's finance was arranged. Values mirror the legacy sheet's PAYOUT_STATUS. */
export const PAYOUT_STATUSES = ['in_house', 'out_house', 'cash', 'staff'] as const
/** Whether the payout has actually landed. Mirrors the legacy sheet's STATUS column. */
export const PAYOUT_RECEIPT_STATUSES = ['pending', 'no_payout', 'received'] as const

const PAYOUT_STATUS_SET = new Set<string>(PAYOUT_STATUSES)
const RECEIPT_STATUS_SET = new Set<string>(PAYOUT_RECEIPT_STATUSES)

/**
 * The ONLY columns a user may edit, and how each is coerced. Everything not listed here — the
 * booking snapshot (customer, model, loan, dealer…) — is immutable through the API by construction:
 * an unknown key is rejected rather than ignored, so a typo can't silently no-op.
 */
const EDITABLE_FIELDS = {
  payoutStatus: 'enum:payout',
  reasonIfOuthouse: 'text',
  dealerPayoutPercent: 'numeric',
  dealerPayoutAmount: 'numeric',
  payoutReceiptStatus: 'enum:receipt',
  dsePayoutAmount: 'numeric',
  dsePayoutStatus: 'text',
  dealerPayoutStatus: 'text',
  paymentReceivedDate: 'date',
  amountReceived: 'numeric',
  invoiceNumber: 'text',
  bankVisitScheduled: 'bool',
  dateOfBankVisit: 'date',
  visitedBy: 'text',
  bankerRemarks: 'text',
  hypAsPerRc: 'text',
  loginUser: 'text',
  bankInterestRate: 'numeric',
  bankLogin: 'bool',
  bankInProforma: 'text',
  vehicleRegistrationNo: 'text', // finance-entered: the RC number arrives after delivery
} as const

export type EditableField = keyof typeof EDITABLE_FIELDS

function coerce(field: EditableField, raw: unknown): string | number | boolean | Date | null {
  const kind = EDITABLE_FIELDS[field]
  if (raw === null || raw === undefined || raw === '') return null

  switch (kind) {
    case 'text':
      return String(raw).trim().slice(0, 2000) || null
    case 'bool':
      return Boolean(raw)
    case 'numeric': {
      const n = Number(String(raw).replace(/[,%₹\s]/g, ''))
      if (!Number.isFinite(n)) throw new Error(`${field} must be a number.`)
      return String(n)
    }
    case 'date': {
      const d = new Date(String(raw))
      if (Number.isNaN(d.getTime())) throw new Error(`${field} must be a valid date.`)
      return d
    }
    case 'enum:payout': {
      const v = String(raw).trim().toLowerCase()
      if (!PAYOUT_STATUS_SET.has(v)) throw new Error(`Unknown payout status "${raw}".`)
      return v
    }
    case 'enum:receipt': {
      const v = String(raw).trim().toLowerCase()
      if (!RECEIPT_STATUS_SET.has(v)) throw new Error(`Unknown payout receipt status "${raw}".`)
      return v
    }
  }
}

// ── Row shape ───────────────────────────────────────────────────────────────────────────────────

export type PayoutRow = {
  id: string
  bookingId: string | null
  source: string
  deliveryDate: string | null
  customerName: string | null
  /** Already masked for the viewer — never the raw number unless md/developer. */
  customerPhone: string
  model: string | null
  salesExecutive: string | null
  dealerCode: string | null
  tlName: string | null
  hyp: string | null
  bankBranch: string | null
  loanAmount: string | null
  panNumber: string | null
  vehicleRegistrationNo: string | null
  payoutStatus: string | null
  reasonIfOuthouse: string | null
  dealerPayoutPercent: string | null
  dealerPayoutAmount: string | null
  payoutReceiptStatus: string | null
  dsePayoutAmount: string | null
  dsePayoutStatus: string | null
  dealerPayoutStatus: string | null
  paymentReceivedDate: string | null
  amountReceived: string | null
  invoiceNumber: string | null
  bankVisitScheduled: boolean
  dateOfBankVisit: string | null
  visitedBy: string | null
  bankerRemarks: string | null
  hypAsPerRc: string | null
  loginUser: string | null
  bankInterestRate: string | null
  bankLogin: boolean | null
  bankInProforma: string | null
  createdAt: string
  updatedAt: string
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/**
 * THE serialisation choke point. Every payout row reaching a client goes through here, and the
 * mobile number is masked according to the viewer's role. If you add another way to build a
 * PayoutRow, it must call this or the number leaks.
 */
function toRow(r: typeof kiaFinancePayouts.$inferSelect, canSeeMobile: boolean): PayoutRow {
  return {
    id: r.id,
    bookingId: r.bookingId,
    source: r.source,
    deliveryDate: iso(r.deliveryDate),
    customerName: r.customerName,
    customerPhone: maskFinancePayoutMobile(r.customerPhone, canSeeMobile),
    model: r.model,
    salesExecutive: r.salesExecutive,
    dealerCode: r.dealerCode,
    tlName: r.tlName,
    hyp: r.hyp,
    bankBranch: r.bankBranch,
    loanAmount: r.loanAmount,
    panNumber: r.panNumber,
    vehicleRegistrationNo: r.vehicleRegistrationNo,
    payoutStatus: r.payoutStatus,
    reasonIfOuthouse: r.reasonIfOuthouse,
    dealerPayoutPercent: r.dealerPayoutPercent,
    dealerPayoutAmount: r.dealerPayoutAmount,
    payoutReceiptStatus: r.payoutReceiptStatus,
    dsePayoutAmount: r.dsePayoutAmount,
    dsePayoutStatus: r.dsePayoutStatus,
    dealerPayoutStatus: r.dealerPayoutStatus,
    paymentReceivedDate: iso(r.paymentReceivedDate),
    amountReceived: r.amountReceived,
    invoiceNumber: r.invoiceNumber,
    bankVisitScheduled: r.bankVisitScheduled,
    dateOfBankVisit: iso(r.dateOfBankVisit),
    visitedBy: r.visitedBy,
    bankerRemarks: r.bankerRemarks,
    hypAsPerRc: r.hypAsPerRc,
    loginUser: r.loginUser,
    bankInterestRate: r.bankInterestRate,
    bankLogin: r.bankLogin,
    bankInProforma: r.bankInProforma,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

// ── List + KPIs ─────────────────────────────────────────────────────────────────────────────────

export type PayoutListInput = {
  search?: string | null
  payoutStatus?: string | null
  receiptStatus?: string | null
  dealer?: string | null
  bankVisit?: string | null // 'scheduled' | 'done' | 'none'
  from?: string | null
  to?: string | null
  page?: number
  pageSize?: number
  sort?: 'delivery_desc' | 'delivery_asc' | 'amount_desc'
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export async function listFinancePayouts(appUser: AppUser, input: PayoutListInput) {
  const page = Math.max(1, Number(input.page) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(5, Number(input.pageSize) || DEFAULT_PAGE_SIZE))
  const search = String(input.search || '').trim()

  const where = []
  if (search) {
    where.push(or(
      ilike(kiaFinancePayouts.customerName, `%${search}%`),
      ilike(kiaFinancePayouts.model, `%${search}%`),
      ilike(kiaFinancePayouts.invoiceNumber, `%${search}%`),
      ilike(kiaFinancePayouts.vehicleRegistrationNo, `%${search}%`),
      ilike(kiaFinancePayouts.salesExecutive, `%${search}%`),
      ilike(kiaFinancePayouts.hyp, `%${search}%`),
    )!)
  }
  if (input.payoutStatus && PAYOUT_STATUS_SET.has(input.payoutStatus)) {
    where.push(eq(kiaFinancePayouts.payoutStatus, input.payoutStatus))
  }
  if (input.receiptStatus && RECEIPT_STATUS_SET.has(input.receiptStatus)) {
    where.push(eq(kiaFinancePayouts.payoutReceiptStatus, input.receiptStatus))
  }
  if (input.dealer) where.push(eq(kiaFinancePayouts.dealerCode, input.dealer))
  if (input.bankVisit === 'scheduled') where.push(eq(kiaFinancePayouts.bankVisitScheduled, true))
  if (input.bankVisit === 'done') where.push(isNotNull(kiaFinancePayouts.dateOfBankVisit))
  if (input.from) where.push(gte(kiaFinancePayouts.deliveryDate, new Date(input.from)))
  if (input.to) where.push(lte(kiaFinancePayouts.deliveryDate, new Date(input.to)))

  const filter = where.length ? and(...where) : undefined
  const order = input.sort === 'delivery_asc'
    ? asc(kiaFinancePayouts.deliveryDate)
    : input.sort === 'amount_desc'
      ? desc(kiaFinancePayouts.dealerPayoutAmount)
      : desc(kiaFinancePayouts.deliveryDate)

  // The page, the count and the KPIs are independent — one round trip instead of three.
  // KPIs are deliberately computed over the FILTERED set, so they answer "what am I looking at?"
  // rather than a constant that ignores the filters.
  const [rows, [totals], [kpi]] = await Promise.all([
    db.select().from(kiaFinancePayouts).where(filter).orderBy(order).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(kiaFinancePayouts).where(filter),
    db.select({
      total: count(),
      pending: sql<number>`count(*) FILTER (WHERE ${kiaFinancePayouts.payoutReceiptStatus} = 'pending')::int`,
      received: sql<number>`count(*) FILTER (WHERE ${kiaFinancePayouts.payoutReceiptStatus} = 'received')::int`,
      noPayout: sql<number>`count(*) FILTER (WHERE ${kiaFinancePayouts.payoutReceiptStatus} = 'no_payout')::int`,
      bankVisitDue: sql<number>`count(*) FILTER (WHERE ${kiaFinancePayouts.bankVisitScheduled} AND ${kiaFinancePayouts.dateOfBankVisit} IS NULL)::int`,
      payoutTotal: sql<string>`coalesce(sum(${kiaFinancePayouts.dealerPayoutAmount}), 0)::text`,
      receivedTotal: sql<string>`coalesce(sum(${kiaFinancePayouts.amountReceived}), 0)::text`,
    }).from(kiaFinancePayouts).where(filter),
  ])

  const canSeeMobile = canViewFinancePayoutMobile(appUser.role)
  const total = Number(totals?.n || 0)

  return {
    rows: rows.map((r) => toRow(r, canSeeMobile)),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    kpis: {
      total: Number(kpi?.total || 0),
      pending: Number(kpi?.pending || 0),
      received: Number(kpi?.received || 0),
      noPayout: Number(kpi?.noPayout || 0),
      bankVisitDue: Number(kpi?.bankVisitDue || 0),
      payoutTotal: Number(kpi?.payoutTotal || 0),
      receivedTotal: Number(kpi?.receivedTotal || 0),
    },
    canSeeMobile,
    canEdit: false, // set by the route, which knows the finance.payouts result
  }
}

/** Distinct values for the filter dropdowns — small table, cheap. */
export async function getFinancePayoutFilterOptions() {
  const [dealers, banks] = await Promise.all([
    db.selectDistinct({ v: kiaFinancePayouts.dealerCode }).from(kiaFinancePayouts).orderBy(asc(kiaFinancePayouts.dealerCode)),
    db.selectDistinct({ v: kiaFinancePayouts.hyp }).from(kiaFinancePayouts).orderBy(asc(kiaFinancePayouts.hyp)),
  ])
  return {
    dealers: dealers.map((d) => d.v).filter((v): v is string => Boolean(v)),
    banks: banks.map((b) => b.v).filter((v): v is string => Boolean(v)),
  }
}

// ── Detail + activity ───────────────────────────────────────────────────────────────────────────

export type PayoutActivityEntry = {
  id: string
  field: string
  before: unknown
  after: unknown
  actorName: string
  actorRole: string
  createdAt: string
}

export async function getFinancePayoutDetail(appUser: AppUser, id: string) {
  const [row] = await db.select().from(kiaFinancePayouts).where(eq(kiaFinancePayouts.id, id)).limit(1)
  if (!row) throw new Error('Payout record not found.')

  const activity = await db.select()
    .from(kiaFinancePayoutActivity)
    .where(eq(kiaFinancePayoutActivity.payoutId, id))
    .orderBy(desc(kiaFinancePayoutActivity.createdAt))
    .limit(200)

  return {
    payout: toRow(row, canViewFinancePayoutMobile(appUser.role)),
    activity: activity.map((a): PayoutActivityEntry => ({
      id: a.id,
      field: a.field,
      before: a.beforeValue,
      after: a.afterValue,
      actorName: a.actorName,
      actorRole: a.actorRole,
      createdAt: a.createdAt.toISOString(),
    })),
  }
}

// ── Update (audited per field) ──────────────────────────────────────────────────────────────────

const normaliseForAudit = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null)

/**
 * Has this field actually changed?
 *
 * TYPE-AWARE on purpose. A naive string compare reports a phantom change on every numeric field,
 * because Postgres `numeric(14,2)` returns '7777.00' for a stored 7777 while the form posts '7777'
 * — so re-saving an untouched record would append a bogus audit row per numeric field, every time.
 * Dates have the same shape of problem ('2026-01-05' in, a full timestamptz back).
 */
function sameValue(kind: (typeof EDITABLE_FIELDS)[EditableField], prev: unknown, next: unknown) {
  const prevEmpty = prev === null || prev === undefined || prev === ''
  const nextEmpty = next === null || next === undefined || next === ''
  if (prevEmpty || nextEmpty) return prevEmpty && nextEmpty

  if (kind === 'numeric') return Number(prev) === Number(next)
  if (kind === 'date') {
    const a = prev instanceof Date ? prev : new Date(String(prev))
    const b = next instanceof Date ? next : new Date(String(next))
    // Compare the DAY: these are calendar fields (payment received, bank visit), and the stored
    // timestamptz carries a time the date input never sends.
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
  }
  if (kind === 'bool') return Boolean(prev) === Boolean(next)
  return String(prev) === String(next)
}

/**
 * Updates finance fields and records one immutable audit row PER CHANGED FIELD.
 *
 * Per-field (rather than one row per save) because the question the audit has to answer is "who
 * changed the dealer payout amount, and from what?" — a single blob of the whole record makes that
 * a diffing exercise. Fields whose value did not actually change are skipped, so a no-op save
 * doesn't pollute the trail.
 *
 * The caller is responsible for the finance.payouts permission check (the route does it).
 */
export async function updateFinancePayout(appUser: AppUser, id: string, patch: Record<string, unknown>) {
  const keys = Object.keys(patch)
  if (!keys.length) throw new Error('Nothing to update.')

  const unknown = keys.filter((k) => !(k in EDITABLE_FIELDS))
  if (unknown.length) {
    // Reject rather than ignore: silently dropping a field the caller believed it saved is worse
    // than an error, and it stops the booking snapshot being edited through this door.
    throw new Error(`These fields are not editable: ${unknown.join(', ')}.`)
  }

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(kiaFinancePayouts).where(eq(kiaFinancePayouts.id, id)).limit(1)
    if (!before) throw new Error('Payout record not found.')

    const updates: Record<string, unknown> = {}
    const changed: { field: string; before: unknown; after: unknown }[] = []

    for (const key of keys as EditableField[]) {
      const next = coerce(key, patch[key])
      const prev = (before as Record<string, unknown>)[key]
      if (sameValue(EDITABLE_FIELDS[key], prev, next)) continue // unchanged — no audit noise
      updates[key] = next
      changed.push({ field: key, before: normaliseForAudit(prev), after: normaliseForAudit(next) })
    }

    if (!changed.length) return { ok: true, changed: 0 }

    updates.updatedBy = appUser.id
    updates.updatedAt = new Date()
    await tx.update(kiaFinancePayouts).set(updates).where(eq(kiaFinancePayouts.id, id))

    await tx.insert(kiaFinancePayoutActivity).values(changed.map((c) => ({
      payoutId: id,
      field: c.field,
      beforeValue: { value: c.before } as Record<string, unknown>,
      afterValue: { value: c.after } as Record<string, unknown>,
      actorUserId: appUser.id,
      actorName: appUser.fullName || appUser.email || appUser.id,
      actorRole: appUser.role,
    })))

    return { ok: true, changed: changed.length }
  })
}
