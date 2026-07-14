import 'server-only'

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  kiaProformas,
  kiaBookings,
  kiaPriceDetails,
  kiaProformaLookupOptions,
  kiaFinanceProcessing,
  kiaFinanceRemarks,
  kiaFinanceBankAttempts,
  kiaFinanceActivity,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { canViewKiaCustomerPii, maskKiaPii } from '@/lib/kia/pii'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

// ── Finance status model ────────────────────────────────────────────────────────────────────────
export type KiaFinanceStatus = 'pending' | 'in_progress' | 'delayed' | 'completed'

function text(value: unknown) {
  return String(value ?? '').trim()
}

function actorName(appUser: AppUser) {
  return appUser.fullName || appUser.email || appUser.id
}

// Mirrors allocationHoursForBooking (lib/kia/bookings.ts): CSD bookings get a 120h (5-day) window,
// everyone else 72h. The booking type lives in kia_bookings.metadata.customerType.
function financeHoursForBooking(booking: { metadata?: unknown } | null | undefined): number {
  const meta = (booking?.metadata ?? {}) as Record<string, unknown>
  return text(meta.customerType).toLowerCase() === 'csd' ? 120 : 72
}

// ── Bank/branch master list (same source as the proforma options route) ──────────────────────────
// The finance section is cross-brand and finance roles lack kia.proforma.view, so it can't call the
// kia-gated /proforma/options route — this reads the same two tables directly for the bank cascade.
export type FinanceBankRow = { bank_name: string; bank_branch: string }

export async function loadFinanceBankOptions(): Promise<{ banks: FinanceBankRow[] }> {
  return getCachedData('finance:bank-options', async () => {
    const [priceRows, branchRows] = await Promise.all([
      db.select({ bankName: kiaPriceDetails.bankName, hyp: kiaPriceDetails.hyp, bankBranch: kiaPriceDetails.bankBranch })
        .from(kiaPriceDetails).where(sql`LEFT(model, 2) <> '__'`),
      db.select({ value: kiaProformaLookupOptions.value, label: kiaProformaLookupOptions.label })
        .from(kiaProformaLookupOptions).where(eq(kiaProformaLookupOptions.category, 'bank_branch')),
    ])
    const banks: FinanceBankRow[] = [
      ...priceRows.map((r) => ({ bank_name: text(r.bankName) || text(r.hyp), bank_branch: text(r.bankBranch) })),
      ...branchRows.map((r) => ({ bank_name: text(r.label), bank_branch: text(r.value) })),
    ]
      .filter((r) => r.bank_name)
      .filter((r, i, s) => s.findIndex((c) => c.bank_name === r.bank_name && c.bank_branch === r.bank_branch) === i)
      .sort((a, b) => a.bank_name.localeCompare(b.bank_name) || a.bank_branch.localeCompare(b.bank_branch))
    return { banks }
  }, CACHE_TTL.DASHBOARD)
}

// ── Immutable activity writer (append-only; a DB trigger also blocks UPDATE/DELETE) ──────────────
async function addFinanceActivity(params: {
  financeProcessingId: string
  proformaId: string
  type: string
  title: string
  description?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  appUser: AppUser
}) {
  await db.insert(kiaFinanceActivity).values({
    financeProcessingId: params.financeProcessingId,
    proformaId: params.proformaId,
    activityType: params.type,
    title: params.title,
    description: params.description ?? null,
    beforeValue: params.before ?? null,
    afterValue: params.after ?? null,
    actorUserId: params.appUser.id,
    actorName: actorName(params.appUser),
    actorRole: params.appUser.role,
  })
}

// ── Creation (called from the proforma finalize path, when approvalStatus becomes 'APPROVED') ────
// Idempotent (one row per proforma). Best-effort: the caller must not let a failure here break the
// approval response, so it swallows/logs there.
export async function createKiaFinanceProcessing(
  proforma: { id: string; bankName?: string | null; bankBranch?: string | null },
  booking: { id: string; metadata?: unknown } | null,
  appUser: AppUser,
): Promise<string | null> {
  const [existing] = await db.select({ id: kiaFinanceProcessing.id })
    .from(kiaFinanceProcessing).where(eq(kiaFinanceProcessing.proformaId, proforma.id)).limit(1)
  if (existing) return existing.id

  const hours = financeHoursForBooking(booking)
  const startedAt = new Date()
  const expected = new Date(startedAt.getTime() + hours * 60 * 60 * 1000)
  const bankName = text(proforma.bankName) || null
  const bankBranch = text(proforma.bankBranch) || null

  const inserted = await db.insert(kiaFinanceProcessing).values({
    proformaId: proforma.id,
    bookingId: booking?.id ?? null,
    financeStatus: 'pending',
    startedAt,
    expectedCompletionDate: expected,
    baseHours: hours,
    currentBankName: bankName,
    currentBankBranch: bankBranch,
    currentBankStatus: bankName && bankBranch ? 'Pending' : null,
  }).onConflictDoNothing({ target: kiaFinanceProcessing.proformaId }).returning({ id: kiaFinanceProcessing.id })

  const processingId = inserted[0]?.id
  if (!processingId) {
    const [row] = await db.select({ id: kiaFinanceProcessing.id })
      .from(kiaFinanceProcessing).where(eq(kiaFinanceProcessing.proformaId, proforma.id)).limit(1)
    return row?.id ?? null // lost a race; the other insert also seeded the rest
  }

  // Seed bank attempt #1 from the proforma's chosen bank/branch (the first bank approached).
  if (bankName && bankBranch) {
    await db.insert(kiaFinanceBankAttempts).values({
      financeProcessingId: processingId, attemptNo: 1, bankName, bankBranch, status: 'Pending',
      createdBy: appUser.id, createdByName: actorName(appUser), createdByRole: appUser.role,
    })
  }
  await addFinanceActivity({
    financeProcessingId: processingId, proformaId: proforma.id, type: 'finance_started',
    title: 'Finance processing started',
    description: `Expected completion in ${hours}h (${hours === 120 ? 'CSD 5-day' : 'standard 72h'} window)`,
    after: { financeStatus: 'pending', expectedCompletionDate: expected.toISOString(), bank: bankName, branch: bankBranch },
    appUser,
  })
  return processingId
}

export async function getKiaFinanceApprovalQueue() {
  const rows = await db.select({
    id: kiaProformas.id,
    proformaDate: kiaProformas.proformaDate,
    customerName: kiaProformas.customerName,
    mobileNumber: kiaProformas.mobileNumber,
    customerEmail: kiaProformas.customerEmail,
    customerAddress: kiaProformas.customerAddress,
    customerType: kiaProformas.customerType,
    modelName: kiaProformas.modelName,
    trimDescription: kiaProformas.trimDescription,
    fuelType: kiaProformas.fuelType,
    vehicleColor: kiaProformas.vehicleColor,
    vehicleStatus: kiaProformas.vehicleStatus,
    bankName: kiaProformas.bankName,
    bankBranch: kiaProformas.bankBranch,
    loanAmount: kiaProformas.loanAmount,
    exShowroom: kiaProformas.exShowroom,
    tcsValue: kiaProformas.tcsValue,
    registrationCharges: kiaProformas.registrationCharges,
    insuranceValue: kiaProformas.insuranceValue,
    fastagValue: kiaProformas.fastagValue,
    accessoriesKit: kiaProformas.accessoriesKit,
    extWarranty: kiaProformas.extWarranty,
    cashDiscount: kiaProformas.cashDiscount,
    exchangeValue: kiaProformas.exchangeValue,
    bookingAmount: kiaProformas.bookingAmount,
    govtEmployeeDiscount: kiaProformas.govtEmployeeDiscount,
    additionalDiscount: kiaProformas.additionalDiscount,
    totalCustomerCost: kiaProformas.totalCustomerCost,
    grandTotalCost: kiaProformas.grandTotalCost,
    consultant: kiaProformas.consultant,
    location: kiaProformas.location,
    approvalStatus: kiaProformas.approvalStatus,
    financeStatus: kiaProformas.financeStatus,
    insuranceCompany: kiaProformas.insuranceCompany,
    importMetadata: kiaProformas.importMetadata,
    // Booking fallbacks
    bookingId: kiaBookings.id,
    bookingNumber: kiaBookings.bookingNumber,
    bookingStatus: kiaBookings.status,
    bookingCustomerName: kiaBookings.customerName,
    bookingCustomerPhone: kiaBookings.customerPhone,
    bookingCustomerEmail: kiaBookings.customerEmail,
    bookingCustomerAddress: kiaBookings.customerAddress,
    bookingModel: kiaBookings.model,
    bookingVariant: kiaBookings.variant,
    bookingColor: kiaBookings.color,
    bookingFuelType: kiaBookings.fuelType,
    bookingConsultant: kiaBookings.consultantName,
    bookingBankName: kiaBookings.bankName,
    bookingLoanAmount: kiaBookings.loanAmount,
    bookingMetadata: kiaBookings.metadata,
  })
    .from(kiaProformas)
    .leftJoin(kiaBookings, eq(kiaBookings.proformaId, kiaProformas.id))
    .where(and(eq(kiaProformas.approvalStatus, 'MANAGER_APPROVED'), isNull(kiaProformas.deletedAt)))
    .orderBy(desc(kiaProformas.proformaDate))
    .limit(200)
  return rows
}

// ── List: APPROVED proformas that are in Finance Processing (have a processing row) ──────────────
export async function getKiaFinanceProcessingList() {
  const rows = await db.select({
    processingId: kiaFinanceProcessing.id,
    proformaId: kiaFinanceProcessing.proformaId,
    financeStatus: kiaFinanceProcessing.financeStatus,
    startedAt: kiaFinanceProcessing.startedAt,
    expectedCompletionDate: kiaFinanceProcessing.expectedCompletionDate,
    completedAt: kiaFinanceProcessing.completedAt,
    currentBankName: kiaFinanceProcessing.currentBankName,
    currentBankBranch: kiaFinanceProcessing.currentBankBranch,
    currentBankStatus: kiaFinanceProcessing.currentBankStatus,
    delayCount: kiaFinanceProcessing.delayCount,
    customerName: kiaProformas.customerName,
    modelName: kiaProformas.modelName,
    trimDescription: kiaProformas.trimDescription,
    consultant: kiaProformas.consultant,
    location: kiaProformas.location,
  })
    .from(kiaFinanceProcessing)
    .innerJoin(kiaProformas, eq(kiaProformas.id, kiaFinanceProcessing.proformaId))
    .where(isNull(kiaProformas.deletedAt))
    .orderBy(desc(kiaFinanceProcessing.updatedAt))
    .limit(300)
  return rows
}

// ── Detail: full processing view (proforma + booking + remarks + bank attempts + activity) ───────
export async function getKiaFinanceProcessingDetail(proformaId: string, appUser: AppUser) {
  const [processing] = await db.select().from(kiaFinanceProcessing)
    .where(eq(kiaFinanceProcessing.proformaId, proformaId)).limit(1)
  if (!processing) return null

  const [proforma] = await db.select().from(kiaProformas).where(eq(kiaProformas.id, proformaId)).limit(1)
  if (!proforma) return null

  const [booking] = processing.bookingId
    ? await db.select().from(kiaBookings).where(eq(kiaBookings.id, processing.bookingId)).limit(1)
    : [null]

  const [remarks, bankAttempts, activity] = await Promise.all([
    db.select().from(kiaFinanceRemarks).where(eq(kiaFinanceRemarks.financeProcessingId, processing.id)).orderBy(kiaFinanceRemarks.createdAt),
    db.select().from(kiaFinanceBankAttempts).where(eq(kiaFinanceBankAttempts.financeProcessingId, processing.id)).orderBy(kiaFinanceBankAttempts.attemptNo),
    db.select().from(kiaFinanceActivity).where(eq(kiaFinanceActivity.financeProcessingId, processing.id)).orderBy(desc(kiaFinanceActivity.createdAt)),
  ])

  const canPii = canViewKiaCustomerPii(appUser.role)
  return {
    processing,
    proforma: {
      ...proforma,
      // PII masking: only finance_head + super admins see raw phone/email (lib/kia/pii.ts).
      mobileNumber: maskKiaPii(proforma.mobileNumber, canPii),
      customerEmail: maskKiaPii(proforma.customerEmail, canPii),
    },
    booking: booking ? { bookingNumber: booking.bookingNumber, status: booking.status, dealerCode: booking.dealerCode, financeRequired: booking.financeRequired } : null,
    remarks,
    bankAttempts,
    activity,
  }
}

async function requireProcessing(proformaId: string) {
  const [processing] = await db.select().from(kiaFinanceProcessing)
    .where(eq(kiaFinanceProcessing.proformaId, proformaId)).limit(1)
  if (!processing) throw new Error('Finance processing record not found for this proforma.')
  if (processing.financeStatus === 'completed') throw new Error('Financing is already marked complete.')
  return processing
}

function touch(processingId: string) {
  return db.update(kiaFinanceProcessing).set({ updatedAt: new Date() }).where(eq(kiaFinanceProcessing.id, processingId))
}

// ── Mutations ────────────────────────────────────────────────────────────────────────────────────

// B: append-only Finance Remark (never overwrites; every remark stored with user/role/time).
export async function addKiaFinanceRemark(proformaId: string, remark: string, appUser: AppUser) {
  const trimmed = text(remark)
  if (!trimmed) throw new Error('Remark is required.')
  const processing = await requireProcessing(proformaId)
  await db.insert(kiaFinanceRemarks).values({
    financeProcessingId: processing.id, remark: trimmed,
    createdBy: appUser.id, createdByName: actorName(appUser), createdByRole: appUser.role,
  })
  await db.update(kiaFinanceProcessing)
    .set({ financeStatus: processing.financeStatus === 'pending' ? 'in_progress' : processing.financeStatus, updatedAt: new Date() })
    .where(eq(kiaFinanceProcessing.id, processing.id))
  await addFinanceActivity({
    financeProcessingId: processing.id, proformaId, type: 'remark_added',
    title: 'Finance remark added', description: trimmed, appUser,
  })
  return { ok: true }
}

// A: Delay — new expected date + required reason (category + optional custom text).
export async function applyKiaFinanceDelay(
  proformaId: string,
  input: { newDate: string; reasonCategory: string; reason?: string | null },
  appUser: AppUser,
) {
  const processing = await requireProcessing(proformaId)
  const newDate = new Date(input.newDate)
  if (Number.isNaN(newDate.getTime())) throw new Error('A valid new expected completion date is required.')
  const category = text(input.reasonCategory)
  if (!category) throw new Error('A delay reason is required.')
  const reason = text(input.reason) || null
  const before = { expectedCompletionDate: processing.expectedCompletionDate, financeStatus: processing.financeStatus }

  await db.update(kiaFinanceProcessing).set({
    expectedCompletionDate: newDate,
    financeStatus: 'delayed',
    delayCount: (processing.delayCount ?? 0) + 1,
    lastDelayReasonCategory: category,
    lastDelayReason: reason,
    updatedAt: new Date(),
  }).where(eq(kiaFinanceProcessing.id, processing.id))

  await addFinanceActivity({
    financeProcessingId: processing.id, proformaId, type: 'delayed',
    title: 'Financing delayed',
    description: reason ? `${category} — ${reason}` : category,
    before,
    after: { expectedCompletionDate: newDate.toISOString(), financeStatus: 'delayed', delayReasonCategory: category, delayReason: reason },
    appUser,
  })
  return { ok: true }
}

// C: Mark financing complete.
export async function markKiaFinanceComplete(proformaId: string, appUser: AppUser) {
  const processing = await requireProcessing(proformaId)
  const completedAt = new Date()
  await db.update(kiaFinanceProcessing).set({
    financeStatus: 'completed',
    completedAt,
    completedBy: appUser.id,
    completedByName: actorName(appUser),
    completedByRole: appUser.role,
    updatedAt: completedAt,
  }).where(eq(kiaFinanceProcessing.id, processing.id))
  await addFinanceActivity({
    financeProcessingId: processing.id, proformaId, type: 'completed',
    title: 'Financing marked complete',
    description: 'Bank financing completed successfully — vehicle ready for delivery.',
    before: { financeStatus: processing.financeStatus },
    after: { financeStatus: 'completed', completedAt: completedAt.toISOString() },
    appUser,
  })
  return { ok: true }
}

// D: Bank management — add a new bank attempt (never overwrites; new attempt_no on each try).
export async function addKiaFinanceBankAttempt(
  proformaId: string,
  input: { bankName: string; bankBranch: string },
  appUser: AppUser,
) {
  const processing = await requireProcessing(proformaId)
  const bankName = text(input.bankName)
  const bankBranch = text(input.bankBranch)
  if (!bankName || !bankBranch) throw new Error('Bank and branch are required.')

  const [{ maxNo }] = await db.select({ maxNo: sql<number>`coalesce(max(${kiaFinanceBankAttempts.attemptNo}), 0)` })
    .from(kiaFinanceBankAttempts).where(eq(kiaFinanceBankAttempts.financeProcessingId, processing.id))
  const attemptNo = Number(maxNo || 0) + 1

  await db.insert(kiaFinanceBankAttempts).values({
    financeProcessingId: processing.id, attemptNo, bankName, bankBranch, status: 'Pending',
    createdBy: appUser.id, createdByName: actorName(appUser), createdByRole: appUser.role,
  })
  await db.update(kiaFinanceProcessing).set({
    currentBankName: bankName, currentBankBranch: bankBranch, currentBankStatus: 'Pending', updatedAt: new Date(),
  }).where(eq(kiaFinanceProcessing.id, processing.id))
  await addFinanceActivity({
    financeProcessingId: processing.id, proformaId, type: 'bank_attempt_added',
    title: `Bank attempt #${attemptNo} added`,
    description: `${bankName} · ${bankBranch}`,
    before: { bank: processing.currentBankName, branch: processing.currentBankBranch, status: processing.currentBankStatus },
    after: { bank: bankName, branch: bankBranch, status: 'Pending', attemptNo },
    appUser,
  })
  return { ok: true }
}

// D: resolve a bank attempt (Approved / Rejected + optional rejection reason). The single permitted
// UPDATE on an attempt row; adding a different bank on rejection is a NEW attempt (never an overwrite).
export async function resolveKiaFinanceBankAttempt(
  proformaId: string,
  input: { attemptId: string; status: 'Approved' | 'Rejected'; rejectionReason?: string | null },
  appUser: AppUser,
) {
  const processing = await requireProcessing(proformaId)
  const status = input.status === 'Approved' ? 'Approved' : 'Rejected'
  const [attempt] = await db.select().from(kiaFinanceBankAttempts)
    .where(and(eq(kiaFinanceBankAttempts.id, input.attemptId), eq(kiaFinanceBankAttempts.financeProcessingId, processing.id))).limit(1)
  if (!attempt) throw new Error('Bank attempt not found.')
  const rejectionReason = status === 'Rejected' ? (text(input.rejectionReason) || null) : null

  await db.update(kiaFinanceBankAttempts).set({
    status, rejectionReason, resolvedAt: new Date(),
  }).where(eq(kiaFinanceBankAttempts.id, attempt.id))

  // Keep the processing pointer in sync if this is the current bank.
  const isCurrent = text(attempt.bankName) === text(processing.currentBankName) && text(attempt.bankBranch) === text(processing.currentBankBranch)
  if (isCurrent) {
    await db.update(kiaFinanceProcessing).set({ currentBankStatus: status, updatedAt: new Date() }).where(eq(kiaFinanceProcessing.id, processing.id))
  } else {
    await touch(processing.id)
  }
  await addFinanceActivity({
    financeProcessingId: processing.id, proformaId, type: 'bank_resolved',
    title: `Bank attempt #${attempt.attemptNo} ${status.toLowerCase()}`,
    description: `${attempt.bankName} · ${attempt.bankBranch}${rejectionReason ? ` — ${rejectionReason}` : ''}`,
    before: { status: attempt.status },
    after: { status, rejectionReason },
    appUser,
  })
  return { ok: true }
}
