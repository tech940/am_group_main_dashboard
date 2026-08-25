import 'server-only'

import { desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { bankSanctionHistory, bankSanctionLimits } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { BANK_SANCTION_BRANDS, bankSanctionBrandsFor, canSeeBankSanctionRow, canViewAllBankSanctionBranches } from '@/lib/auth/bank-sanctions-access'

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
 * Thrown when the caller may open the section but not touch THIS facility's branch.
 *
 * A subclass, so every existing `instanceof BankSanctionValidationError` catch still works and the
 * message still reaches the user — but routes can test for it first and answer 403 rather than 400.
 * A scoping refusal is not a malformed payload, and it should not read like one in the logs.
 */
export class BankSanctionBranchError extends BankSanctionValidationError {}

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
  /** Owning brand. NULL = group-level (MD & Developer only) — see lib/auth/bank-sanctions-access.ts. */
  branchCode: string | null
  expiryStatus: ExpiryStatus
  updatedAt: string | null
}

export type BankSanctionInput = Partial<Record<
  | 'loanType' | 'location' | 'creditLimit' | 'instalment' | 'roiPct' | 'interestAmount'
  | 'outstandingAmount' | 'dateOfSanction' | 'installmentDueOn' | 'installmentPaidOn'
  | 'expiryDate' | 'guarantor' | 'collateral' | 'primarySecurity' | 'corporateGuarantee'
  | 'documentUrl1' | 'documentUrl2' | 'alertEmail' | 'branchCode',
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
    branchCode: row.branchCode,
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
/**
 * The WHERE clause that decides which facilities a login may read.
 *
 * ⚠️ THE single enforcement point. The client mirrors this for labels, but the client is not a gate;
 * every read path (list, history, alerts) must go through this or a login could reach another
 * dealership's bank position by id.
 *
 * Three arms, and the NULL case is separate on purpose:
 *   - MD / Developer      -> undefined (no predicate): everything, group-level included
 *   - assignment 'all'    -> branch_code IS NOT NULL: every BRAND, but never the group's own rows
 *   - a brand list        -> branch_code IN (...): exactly their brands
 *   - nothing resolvable  -> `= ''`, which matches no row. Fails CLOSED rather than falling through
 *                            to "no predicate", which is the shape that turns a scoping bug into a
 *                            full disclosure.
 */
function bankSanctionVisibility(appUser: Pick<AppUser, 'role' | 'brand'>) {
  if (canViewAllBankSanctionBranches(appUser.role)) return undefined
  const brands = bankSanctionBrandsFor(appUser.brand)
  if (brands === 'all-brands') return isNotNull(bankSanctionLimits.branchCode)
  if (brands.length === 0) return eq(bankSanctionLimits.branchCode, '')
  if (brands.length === 1) return eq(bankSanctionLimits.branchCode, brands[0])
  return inArray(bankSanctionLimits.branchCode, brands)
}

/**
 * The register this login may see, in one read.
 *
 * Still not paginated or server-filtered beyond the brand scope — see the note on the transport
 * cost and the paginate-then-client-filter trap. What changed in 0046 is that "the whole register"
 * now means "the whole register YOU may read".
 */
export async function listBankSanctions(appUser: Pick<AppUser, 'role' | 'brand'>): Promise<BankSanctionRecord[]> {
  const now = new Date()
  const where = bankSanctionVisibility(appUser)
  const query = db.select().from(bankSanctionLimits)
  const rows = await (where ? query.where(where) : query).orderBy(desc(bankSanctionLimits.updatedAt))
  return rows.map((row) => toRecord(row, now))
}

/** Every facility, ignoring who is asking. Server-internal only — the expiry digest is not a user. */
export async function listAllBankSanctionsForAlerts(): Promise<BankSanctionRecord[]> {
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

/**
 * The owning brand, or NULL for group-level.
 *
 * Accepts '' / 'group' / null as "group-level" so the UI can offer it as an explicit choice rather
 * than the user having to leave a field mysteriously blank. Anything not in the canonical brand list
 * is REJECTED rather than silently stored — a typo'd code would otherwise create a facility no brand
 * user can see and no one notices is missing.
 */
function cleanBranchCode(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === 'group' || text === 'group-level') return null
  if (!(BANK_SANCTION_BRANDS as readonly string[]).includes(text)) {
    throw new BankSanctionValidationError(`Unknown branch "${text}". Pick one of: ${BANK_SANCTION_BRANDS.join(', ')} — or leave it as Group-level.`)
  }
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
    branchCode: cleanBranchCode(input.branchCode),
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

/**
 * May this login act on a facility carrying `branchCode`?
 *
 * Used on BOTH sides of an edit: the row as it stands, and the row as it would become. Checking only
 * the former lets a scoped user move a facility OUT of their brand (or into group-level) and lose
 * sight of it; checking only the latter lets them claim someone else's facility. Both, or neither.
 */
function assertBankSanctionBranchAllowed(appUser: AppUser, branchCode: string | null, what: string) {
  if (canSeeBankSanctionRow(appUser.role, appUser.brand, branchCode)) return
  throw new BankSanctionBranchError(
    branchCode
      ? `${what} belongs to another branch (${branchCode}) and is outside your access.`
      : `${what} is a group-level facility — only the MD and Developer can act on it.`,
  )
}

export async function createBankSanction(appUser: AppUser, input: BankSanctionInput): Promise<BankSanctionRecord> {
  const values = buildValues(input)
  assertBankSanctionBranchAllowed(appUser, values.branchCode, 'That branch')

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

  // The row as it stands...
  const [existing] = await db
    .select({ branchCode: bankSanctionLimits.branchCode })
    .from(bankSanctionLimits)
    .where(eq(bankSanctionLimits.id, id))
    .limit(1)
  if (!existing) throw new BankSanctionValidationError('Record not found')
  assertBankSanctionBranchAllowed(appUser, existing.branchCode, 'This facility')
  // ...and as it would become, so an edit cannot push it out of your own view.
  assertBankSanctionBranchAllowed(appUser, values.branchCode, 'That branch')

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
    assertBankSanctionBranchAllowed(appUser, row.branchCode, 'This facility')

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

/**
 * ⚠️ Takes the caller. A by-id history read must obey the SAME scope as the list, or a scoped login
 * that cannot see a facility could still read its full change history — limits, outstandings,
 * guarantors and all — by guessing the id.
 */
export async function getBankSanctionHistory(appUser: AppUser, recordId: string): Promise<BankSanctionHistoryEntry[]> {
  const [record] = await db
    .select({ branchCode: bankSanctionLimits.branchCode })
    .from(bankSanctionLimits)
    .where(eq(bankSanctionLimits.id, recordId))
    .limit(1)
  // A deleted facility leaves history behind with record_id nulled, so an unmatched id is simply
  // empty rather than an error — but a MATCHED one must pass the scope check.
  if (record) assertBankSanctionBranchAllowed(appUser, record.branchCode, 'This facility')

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
