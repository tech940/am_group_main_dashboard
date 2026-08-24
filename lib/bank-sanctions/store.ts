import 'server-only'

import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bankSanctionHistory, bankSanctionLimits } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'

/**
 * Reads and writes the bank sanction register. The ONLY module that touches these tables.
 *
 * Ported behaviour from the Apps Script, kept deliberately:
 *   - the last-number duplicate rule for loan types
 *   - a full history snapshot on every create / update / delete
 *   - the two expiry buckets ("Old Expired" / "Current Month Expiry"), IST-anchored
 * What the sheet could not do and this can: clear a field (the sheet's save treated empty as
 * "keep the old value", so a wrong guarantor could never be blanked), and say WHO changed a row.
 */

/** Thrown for payloads the UI should never produce — surfaced as a 400 with the message intact. */
export class BankSanctionValidationError extends Error {}

/**
 * The sheet's duplicate identity: the LAST number in the name ("CC A/c 4501" ≡ "OD 4501" — the
 * account number is the identity and the wording drifts), else the lower-cased text.
 * ⚠️ MUST stay in lockstep with bank_sanction_limits_loan_key_idx in migration 0045, which encodes
 * the same rule as `substring(lower(btrim(x)) FROM '([0-9]+)[^0-9]*$')`. If the two disagree, this
 * check passes and the database then rejects with a raw 23505.
 */
export function loanTypeKey(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  const numbers = text.match(/\d+/g)
  if (numbers && numbers.length) return numbers[numbers.length - 1]
  return text.toLowerCase()
}

export type ExpiryStatus = 'old_expired' | 'current_month' | null

export type BankSanctionRecord = {
  id: string
  loanType: string
  location: string
  creditLimit: number | null
  instalment: number | null
  roiPct: number | null
  interestAmount: number | null
  outstandingAmount: number | null
  dateOfSanction: string | null
  installmentDueOn: string | null
  installmentPaidOn: string | null
  expiryDate: string | null
  guarantor: string | null
  collateral: string | null
  primarySecurity: string | null
  corporateGuarantee: string | null
  documentUrl1: string | null
  documentUrl2: string | null
  alertEmail: string | null
  expiryStatus: ExpiryStatus
  updatedAt: string | null
}

export type BankSanctionInput = Partial<Record<
  | 'loanType' | 'location' | 'creditLimit' | 'instalment' | 'roiPct' | 'interestAmount'
  | 'outstandingAmount' | 'dateOfSanction' | 'installmentDueOn' | 'installmentPaidOn'
  | 'expiryDate' | 'guarantor' | 'collateral' | 'primarySecurity' | 'corporateGuarantee'
  | 'documentUrl1' | 'documentUrl2' | 'alertEmail',
  unknown
>>

/**
 * A Postgres DATE, whatever shape the driver hands back, as plain 'YYYY-MM-DD'.
 * ⚠️ Never String(date).slice or toISOString on a driver Date — the scrap module shipped
 * "Thu Jul 30" into date fields exactly that way. UTC parts only.
 */
function dateOnly(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

function moneyOf(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Expiry bucketing, IST-anchored — the dealership's month decides, not the server's (UTC on
 * Vercel) and not the viewer's browser. Same two buckets as the sheet:
 *   before the current IST month  -> 'old_expired'
 *   inside the current IST month  -> 'current_month'
 *   anything later / no date      -> null
 */
export function expiryStatusOf(expiry: string | null, now: Date = new Date()): ExpiryStatus {
  if (!expiry) return null
  const ist = new Date(now.getTime() + 330 * 60_000)
  const y = ist.getUTCFullYear()
  const m = ist.getUTCMonth() + 1
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
  if (expiry < monthStart) return 'old_expired'
  if (expiry <= monthEnd) return 'current_month'
  return null
}

function toRecord(row: typeof bankSanctionLimits.$inferSelect, now: Date): BankSanctionRecord {
  const expiryDate = dateOnly(row.expiryDate)
  return {
    id: row.id,
    loanType: row.loanType,
    location: row.location,
    creditLimit: moneyOf(row.creditLimit),
    instalment: moneyOf(row.instalment),
    roiPct: moneyOf(row.roiPct),
    interestAmount: moneyOf(row.interestAmount),
    outstandingAmount: moneyOf(row.outstandingAmount),
    dateOfSanction: dateOnly(row.dateOfSanction),
    installmentDueOn: dateOnly(row.installmentDueOn),
    installmentPaidOn: dateOnly(row.installmentPaidOn),
    expiryDate,
    guarantor: row.guarantor,
    collateral: row.collateral,
    primarySecurity: row.primarySecurity,
    corporateGuarantee: row.corporateGuarantee,
    documentUrl1: row.documentUrl1,
    documentUrl2: row.documentUrl2,
    alertEmail: row.alertEmail,
    expiryStatus: expiryStatusOf(expiryDate, now),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  }
}

/**
 * The whole register in one read. Deliberately NOT paginated or server-filtered: this is a bank
 * facility register (the sheet held a few dozen rows), the connection is latency-bound (~350ms per
 * statement), and this session's purchase-orders incident proved what happens when a server page
 * and a client filter describe different lists. One query, the client filters the full truth.
 */
export async function listBankSanctions(): Promise<BankSanctionRecord[]> {
  const now = new Date()
  const rows = await db.select().from(bankSanctionLimits).orderBy(desc(bankSanctionLimits.updatedAt))
  return rows.map((row) => toRecord(row, now))
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text ? text : null
}

function cleanMoney(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new BankSanctionValidationError(`${label} must be a number`)
  if (n < 0) throw new BankSanctionValidationError(`${label} cannot be negative`)
  return n.toFixed(2)
}

/** ROI arrives as "12", "12.5" or the sheet's "12%" — all become the number. */
function cleanRoi(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/%/g, '').trim())
  if (!Number.isFinite(n)) throw new BankSanctionValidationError('ROI must be a number')
  if (n < 0 || n > 100) throw new BankSanctionValidationError('ROI must be between 0 and 100')
  return n.toFixed(3)
}

function cleanDate(value: unknown, label: string): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new BankSanctionValidationError(`${label} must be a YYYY-MM-DD date`)
  return text
}

function cleanEmail(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new BankSanctionValidationError('Alert email is not a valid address')
  return text
}

function buildValues(input: BankSanctionInput) {
  const loanType = cleanText(input.loanType)
  const location = cleanText(input.location)
  if (!loanType) throw new BankSanctionValidationError('Loan Type is required')
  if (!location) throw new BankSanctionValidationError('Location is required')

  return {
    loanType,
    location,
    creditLimit: cleanMoney(input.creditLimit, 'Credit Limit'),
    instalment: cleanMoney(input.instalment, 'Instalment'),
    roiPct: cleanRoi(input.roiPct),
    interestAmount: cleanMoney(input.interestAmount, 'Interest Amount'),
    outstandingAmount: cleanMoney(input.outstandingAmount, 'Outstanding Amount'),
    dateOfSanction: cleanDate(input.dateOfSanction, 'Date of Sanction'),
    installmentDueOn: cleanDate(input.installmentDueOn, 'Installment Due On'),
    installmentPaidOn: cleanDate(input.installmentPaidOn, 'Installment Paid On'),
    expiryDate: cleanDate(input.expiryDate, 'Expiry Date'),
    guarantor: cleanText(input.guarantor),
    collateral: cleanText(input.collateral),
    primarySecurity: cleanText(input.primarySecurity),
    corporateGuarantee: cleanText(input.corporateGuarantee),
    documentUrl1: cleanText(input.documentUrl1),
    documentUrl2: cleanText(input.documentUrl2),
    alertEmail: cleanEmail(input.alertEmail),
  }
}

/**
 * The friendly duplicate check. The register is small, so reading every (id, loan_type) pair and
 * comparing keys in JS is one cheap statement — and it reproduces the sheet's loop exactly. The
 * expression index remains the atomic backstop for anything that bypasses this.
 */
async function findDuplicateLoanType(loanType: string, excludeId?: string) {
  const rows = await db
    .select({ id: bankSanctionLimits.id, loanType: bankSanctionLimits.loanType })
    .from(bankSanctionLimits)
  const key = loanTypeKey(loanType)
  return rows.find((row) => row.id !== excludeId && loanTypeKey(row.loanType) === key) || null
}

function historySnapshot(values: Record<string, unknown>) {
  // jsonb snapshot of exactly what the row now holds — the audit answer to "what did it say then".
  return values
}

export async function createBankSanction(appUser: AppUser, input: BankSanctionInput): Promise<BankSanctionRecord> {
  const values = buildValues(input)

  const duplicate = await findDuplicateLoanType(values.loanType)
  if (duplicate) {
    throw new BankSanctionValidationError(
      `Loan Type already exists as "${duplicate.loanType}". The last number in the name identifies the facility, so two entries for it are the same account.`,
    )
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.insert(bankSanctionLimits).values({
      ...values,
      createdBy: appUser.id,
      updatedBy: appUser.id,
    }).returning()

    await tx.insert(bankSanctionHistory).values({
      recordId: row.id,
      action: 'created',
      loanType: row.loanType,
      location: row.location,
      snapshot: historySnapshot(values),
      changedBy: appUser.id,
      changedByEmail: appUser.email,
    })

    return toRecord(row, new Date())
  })
}

export async function updateBankSanction(appUser: AppUser, id: string, input: BankSanctionInput): Promise<BankSanctionRecord> {
  const values = buildValues(input)

  const duplicate = await findDuplicateLoanType(values.loanType, id)
  if (duplicate) {
    throw new BankSanctionValidationError(
      `Loan Type already exists as "${duplicate.loanType}". The last number in the name identifies the facility.`,
    )
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.update(bankSanctionLimits)
      .set({ ...values, updatedBy: appUser.id, updatedAt: new Date() })
      .where(eq(bankSanctionLimits.id, id))
      .returning()
    if (!row) throw new BankSanctionValidationError('Record not found')

    await tx.insert(bankSanctionHistory).values({
      recordId: row.id,
      action: 'updated',
      loanType: row.loanType,
      location: row.location,
      snapshot: historySnapshot(values),
      changedBy: appUser.id,
      changedByEmail: appUser.email,
    })

    return toRecord(row, new Date())
  })
}

/**
 * Delete — the final snapshot lands in history FIRST, inside the same transaction, so unlike the
 * sheet (where a deleted row simply vanished) the register never forgets what it once held.
 */
export async function deleteBankSanction(appUser: AppUser, id: string): Promise<{ deleted: true; loanType: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(bankSanctionLimits).where(eq(bankSanctionLimits.id, id)).limit(1)
    if (!row) throw new BankSanctionValidationError('Record not found')

    await tx.insert(bankSanctionHistory).values({
      recordId: row.id,
      action: 'deleted',
      loanType: row.loanType,
      location: row.location,
      snapshot: historySnapshot({
        loanType: row.loanType,
        location: row.location,
        creditLimit: row.creditLimit,
        instalment: row.instalment,
        roiPct: row.roiPct,
        interestAmount: row.interestAmount,
        outstandingAmount: row.outstandingAmount,
        dateOfSanction: dateOnly(row.dateOfSanction),
        installmentDueOn: dateOnly(row.installmentDueOn),
        installmentPaidOn: dateOnly(row.installmentPaidOn),
        expiryDate: dateOnly(row.expiryDate),
        guarantor: row.guarantor,
        collateral: row.collateral,
        primarySecurity: row.primarySecurity,
        corporateGuarantee: row.corporateGuarantee,
        documentUrl1: row.documentUrl1,
        documentUrl2: row.documentUrl2,
        alertEmail: row.alertEmail,
      }),
      changedBy: appUser.id,
      changedByEmail: appUser.email,
    })

    await tx.delete(bankSanctionLimits).where(eq(bankSanctionLimits.id, id))
    return { deleted: true as const, loanType: row.loanType }
  })
}

export type BankSanctionHistoryEntry = {
  id: string
  action: string
  loanType: string
  location: string
  snapshot: Record<string, unknown>
  changedByEmail: string | null
  createdAt: string
}

export async function getBankSanctionHistory(recordId: string): Promise<BankSanctionHistoryEntry[]> {
  const rows = await db
    .select()
    .from(bankSanctionHistory)
    .where(eq(bankSanctionHistory.recordId, recordId))
    .orderBy(desc(bankSanctionHistory.createdAt))
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    loanType: row.loanType,
    location: row.location,
    snapshot: (row.snapshot || {}) as Record<string, unknown>,
    changedByEmail: row.changedByEmail,
    createdAt: new Date(row.createdAt).toISOString(),
  }))
}
