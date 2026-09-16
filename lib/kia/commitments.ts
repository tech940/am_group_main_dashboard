import 'server-only'

import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { kiaSalesCommitments, kiaSalesTargets } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

/**
 * Recording what consultants commit to — for a DAY, or for a MONTH.
 *
 * ── Two scopes, because staff make two different promises ────────────────────────────────────────
 * A MONTH commitment is what somebody signs up to for September, agreed once. A DAY commitment is how
 * they intend to get there, decided each morning. Neither substitutes for the other, and the workbook
 * this replaces carried both — a "Target / Month" column and a day-wise tracking sheet.
 *
 * ⚠️ WHICH ONE SCORES THE MONTH IS DECIDED IN ONE PLACE ONLY — lib/kia/sales-target-plan.ts. Nothing
 * in this module ranks them; it stores what it is told and reads it back. Two modules with an opinion
 * about precedence is how the same fact ends up with two answers.
 *
 * ── The rule that does not change ────────────────────────────────────────────────────────────────
 * ONLY COMMITMENTS ARE WRITTEN HERE. What was achieved is never typed anywhere — it is read from the
 * DMS report feeds. Nothing in this module has an "achieved" field, deliberately: the moment a screen
 * offers one, the numbers start disagreeing with Sales Report and the point of replacing the workbook
 * is lost.
 *
 * ── Why a `date` and not a timestamp ─────────────────────────────────────────────────────────────
 * ⚠️ `commitment_date` is a DATE, and the strings passed in must be 'YYYY-MM-DD' IST calendar days.
 * Handing a JS Date to this column converts through UTC and lands a 09:00 IST commitment on the
 * previous day — the trap [[kia-followups-ist]] already paid for once. A MONTH commitment is anchored
 * to the 1st, and the database refuses it anywhere else.
 */

export type CommitmentScope = 'day' | 'month'

export function isCommitmentScope(value: unknown): value is CommitmentScope {
  return value === 'day' || value === 'month'
}

/** The 1st of the month a date falls in — where a monthly commitment is anchored. */
export function monthAnchor(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** 'YYYY-MM-DD' only. Anything else is refused rather than silently coerced into the wrong day. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type DailyCommitmentInput = {
  consultantName: string
  enquiries?: number
  testDrives?: number
  bookings?: number
  retails?: number
  note?: string | null
}

function count(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  // A commitment is a count of things that will happen; negative is not a smaller commitment.
  return Math.max(0, Math.floor(n))
}

export async function upsertDailyCommitments(appUser: AppUser, input: {
  dealerCode: string
  date: string
  scope?: CommitmentScope
  entries: DailyCommitmentInput[]
}): Promise<{ saved: number; cleared: number }> {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || String(input.dealerCode || '').trim().toUpperCase()
  if (!dealerCode) throw new Error('A dealer code is required')
  if (!ISO_DATE.test(String(input.date || ''))) throw new Error('A commitment date must be YYYY-MM-DD')

  const scope: CommitmentScope = isCommitmentScope(input.scope) ? input.scope : 'day'
  /*
   * ⚠️ A MONTHLY COMMITMENT IS SNAPPED TO THE 1st HERE, not left to the caller. The database refuses
   * it anywhere else, and a 500 from a check constraint is a worse way to learn that than simply
   * putting it where it belongs — the caller asked for "September", not for "the 14th".
   */
  const commitmentDate = scope === 'month' ? monthAnchor(input.date) : input.date

  const rows = (input.entries || [])
    .map((e) => ({
      dealerCode,
      consultantName: String(e.consultantName || '').trim(),
      commitmentDate,
      scope,
      enquiries: count(e.enquiries),
      testDrives: count(e.testDrives),
      bookings: count(e.bookings),
      retails: count(e.retails),
      note: String(e.note ?? '').trim() || null,
      createdBy: appUser.id,
      updatedBy: appUser.id,
    }))
    .filter((e) => e.consultantName)

  if (!rows.length) return { saved: 0, cleared: 0 }

  await db.insert(kiaSalesCommitments).values(rows).onConflictDoUpdate({
    /* ⚠️ scope is part of the identity — see the unique index note in schema.ts. */
    target: [
      kiaSalesCommitments.dealerCode,
      kiaSalesCommitments.consultantName,
      kiaSalesCommitments.commitmentDate,
      kiaSalesCommitments.scope,
    ],
    /*
     * ⚠️ EVERY EDITABLE COLUMN. An onConflict SET that names a subset writes the row, reports success,
     * and drops the rest — the defect that hit MD Targets when the labour columns were added, and it
     * presents as "the form did not save".
     *
     * `createdBy` is deliberately absent: whoever first committed this day keeps the credit.
     */
    set: {
      enquiries: sql`excluded.enquiries`,
      testDrives: sql`excluded.test_drives`,
      bookings: sql`excluded.bookings`,
      retails: sql`excluded.retails`,
      note: sql`excluded.note`,
      updatedBy: sql`excluded.updated_by`,
      updatedAt: new Date(),
    },
  })

  return { saved: rows.length, cleared: 0 }
}

/**
 * Removes a consultant's commitment for one day entirely.
 *
 * ⚠️ NOT THE SAME AS SAVING ZEROS. A row of zeros says "I commit to nothing today" — a decision, and
 * one a delivery-less day genuinely needs. No row says nobody has been asked. The screen has to be
 * able to express both, so deleting is its own action.
 */
export async function clearDailyCommitment(input: {
  dealerCode: string
  date: string
  consultantName: string
  scope?: CommitmentScope
}): Promise<{ cleared: number }> {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || String(input.dealerCode || '').trim().toUpperCase()
  if (!dealerCode) throw new Error('A dealer code is required')
  if (!ISO_DATE.test(String(input.date || ''))) throw new Error('A commitment date must be YYYY-MM-DD')
  const name = String(input.consultantName || '').trim()
  if (!name) throw new Error('A consultant is required')

  const scope: CommitmentScope = isCommitmentScope(input.scope) ? input.scope : 'day'
  /* ⚠️ Scoped, or clearing one day would take the month's commitment with it. */
  const deleted = await db.delete(kiaSalesCommitments).where(and(
    eq(kiaSalesCommitments.dealerCode, dealerCode),
    eq(kiaSalesCommitments.commitmentDate, scope === 'month' ? monthAnchor(input.date) : input.date),
    eq(kiaSalesCommitments.consultantName, name),
    eq(kiaSalesCommitments.scope, scope),
  )).returning({ id: kiaSalesCommitments.id })

  return { cleared: deleted.length }
}

/** What is already committed for one outlet at one scope, so the form opens on what is there. */
export async function readDailyCommitments(dealerCode: string, date: string, scope: CommitmentScope = 'day') {
  const code = normalizeKiaDealerCode(dealerCode) || String(dealerCode || '').trim().toUpperCase()
  if (!ISO_DATE.test(String(date || ''))) throw new Error('A commitment date must be YYYY-MM-DD')
  return db.select().from(kiaSalesCommitments).where(and(
    eq(kiaSalesCommitments.dealerCode, code),
    eq(kiaSalesCommitments.commitmentDate, scope === 'month' ? monthAnchor(date) : date),
    eq(kiaSalesCommitments.scope, scope),
  ))
}

/**
 * The month's commitment per consultant — SUM of the days inside it.
 *
 * ⚠️ THE ONLY WAY A MONTHLY FIGURE IS PRODUCED. `kia_sales_targets` still has four monthly target
 * columns from before the model changed; they are no longer written and must not be read as the
 * month's commitment, or two numbers claim to be the same fact and drift the first time a day is
 * edited. That table now carries `team_leader` and nothing else that matters.
 */
export async function readMonthlyCommitmentTotals(input: {
  dealerCode?: string | null
  year: number
  month: number
}): Promise<Map<string, { enquiries: number; testDrives: number; bookings: number; retails: number }>> {
  const start = `${input.year}-${String(input.month).padStart(2, '0')}-01`
  const endExclusive = new Date(Date.UTC(input.year, input.month, 1)).toISOString().slice(0, 10)
  const code = normalizeKiaDealerCode(input.dealerCode ?? null) || null

  const where = code
    ? and(
        eq(kiaSalesCommitments.dealerCode, code),
        gte(kiaSalesCommitments.commitmentDate, start),
        lt(kiaSalesCommitments.commitmentDate, endExclusive),
      )
    : and(
        gte(kiaSalesCommitments.commitmentDate, start),
        lt(kiaSalesCommitments.commitmentDate, endExclusive),
      )

  /*
   * ⚠️ THE MONTH COMMITMENT WINS OVER THE SUM OF DAYS when both exist — the same precedence the plan
   * reader states. A month figure is what somebody signed up to; the days are a plan for reaching it,
   * and part-way through a month they will always add to less. Scoring against the days would flatter
   * anyone who simply has not filled the rest of the month in yet.
   *
   * MAX(...) FILTER picks the single monthly row (there is at most one per person per month, by the
   * unique index) and GREATEST is not needed: a NULL from the filter falls through to the day sum.
   */
  const rows = await db
    .select({
      dealerCode: kiaSalesCommitments.dealerCode,
      consultantName: kiaSalesCommitments.consultantName,
      enquiries: sql<number>`COALESCE(MAX(${kiaSalesCommitments.enquiries}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'month'), SUM(${kiaSalesCommitments.enquiries}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'day'), 0)::int`,
      testDrives: sql<number>`COALESCE(MAX(${kiaSalesCommitments.testDrives}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'month'), SUM(${kiaSalesCommitments.testDrives}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'day'), 0)::int`,
      bookings: sql<number>`COALESCE(MAX(${kiaSalesCommitments.bookings}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'month'), SUM(${kiaSalesCommitments.bookings}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'day'), 0)::int`,
      retails: sql<number>`COALESCE(MAX(${kiaSalesCommitments.retails}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'month'), SUM(${kiaSalesCommitments.retails}) FILTER (WHERE ${kiaSalesCommitments.scope} = 'day'), 0)::int`,
    })
    .from(kiaSalesCommitments)
    .where(where)
    .groupBy(kiaSalesCommitments.dealerCode, kiaSalesCommitments.consultantName)

  /* Keyed exactly as lib/kia/sales-performance.ts keys its leaderboard: `${dealer}|${UPPER(name)}`. */
  const out = new Map<string, { enquiries: number; testDrives: number; bookings: number; retails: number }>()
  for (const r of rows) {
    out.set(`${r.dealerCode.trim().toUpperCase()}|${r.consultantName.trim().toUpperCase()}`, {
      enquiries: Number(r.enquiries) || 0,
      testDrives: Number(r.testDrives) || 0,
      bookings: Number(r.bookings) || 0,
      retails: Number(r.retails) || 0,
    })
  }
  return out
}

/** Which team each consultant reports to, for a month. The one thing kia_sales_targets still owns. */
export async function upsertTeamAssignments(appUser: AppUser, input: {
  dealerCode: string
  year: number
  month: number
  entries: { consultantName: string; teamLeader: string | null }[]
}): Promise<{ updated: number }> {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || String(input.dealerCode || '').trim().toUpperCase()
  const year = Math.floor(input.year)
  const month = Math.floor(input.month)
  if (!dealerCode) throw new Error('A dealer code is required')
  if (!Number.isInteger(year) || !(month >= 1 && month <= 12)) throw new Error('Invalid period')

  const values = (input.entries || [])
    .map((e) => ({
      dealerCode,
      consultantName: String(e.consultantName || '').trim(),
      year,
      month,
      /* Empty string and "no team" are the same thing; both store NULL, never ''. */
      teamLeader: String(e.teamLeader ?? '').trim() || null,
      createdBy: appUser.id,
    }))
    .filter((e) => e.consultantName)

  if (!values.length) return { updated: 0 }

  await db.insert(kiaSalesTargets).values(values).onConflictDoUpdate({
    target: [kiaSalesTargets.dealerCode, kiaSalesTargets.consultantName, kiaSalesTargets.year, kiaSalesTargets.month],
    /*
     * ⚠️ ONLY team_leader. The four monthly target columns on this table are superseded by the daily
     * commitments and are deliberately left untouched — writing them here would recreate the second
     * source of truth that 0067 exists to remove.
     */
    set: { teamLeader: sql`excluded.team_leader`, updatedAt: new Date() },
  })

  return { updated: values.length }
}
