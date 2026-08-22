/**
 * Indian fiscal year (April → March). The ONE shared implementation.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────────────────────
 * `getFinancialYearStart` was copy-pasted into four places and exported from none of them:
 *   app/api/brands/{kia,hyundai,platinum}/business-excellence/ro-billing-analysis/route.ts
 *   lib/hyundai/business-excellence.ts  (as `firstOfYear`)
 * and `startOfFinancialYear` in lib/business-excellence/comparison.ts is module-private. All four
 * carry the same postmortem comment: the original `new Date(year, 0, 1)` started YTD three months
 * early and overstated the base by ~61%.
 *
 * ⚠️ Do NOT reach for `getBusinessYearRange` (lib/business-excellence/comparison.ts) as a fiscal
 * helper — despite sitting next to `current_fy`, it returns a CALENDAR year (Jan 1 → Dec 31). The
 * two live side by side in that file and are easy to mistake for each other.
 *
 * Pure and client-safe: no DB, no env, no server-only import, so the targets grid can import it
 * directly and the server can share the identical maths.
 *
 * Convention used throughout: a fiscal year is named by its START year. FY 2026-27 => 2026, and it
 * covers 2026-04 … 2027-03.
 */

/** Months are 1-based everywhere in this codebase (kia_sales_targets, every reader `{year, month}`). */
const APRIL = 4

function asInt(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`[fiscal-year] ${label} must be a finite number, got ${value}`)
  return Math.floor(value)
}

/**
 * Which fiscal year does this calendar month belong to?
 *
 *   (2026, 3)  -> 2025   (March 2026 is the LAST month of FY 2025-26)
 *   (2026, 4)  -> 2026   (April 2026 opens FY 2026-27)
 */
export function fiscalYearOf(year: number, month: number): number {
  const y = asInt(year, 'year')
  const m = asInt(month, 'month')
  if (m < 1 || m > 12) throw new Error(`[fiscal-year] month must be 1..12, got ${month}`)
  return m >= APRIL ? y : y - 1
}

/**
 * The 12 calendar (year, month) pairs of a fiscal year, in fiscal order: Apr → Mar.
 *
 * Returning calendar pairs rather than a fiscal 1..12 index is deliberate: every reader in this repo
 * takes `{ year, month }` as calendar values, and md_branch_targets stores them that way too. Nothing
 * has to translate, so there is no second convention to get wrong.
 */
export function fiscalYearMonths(fiscalYear: number): { year: number; month: number }[] {
  const fy = asInt(fiscalYear, 'fiscalYear')
  const months: { year: number; month: number }[] = []
  for (let offset = 0; offset < 12; offset += 1) {
    const monthIndex = APRIL + offset // 4..15
    months.push(monthIndex <= 12 ? { year: fy, month: monthIndex } : { year: fy + 1, month: monthIndex - 12 })
  }
  return months
}

/** Inclusive date bounds of a fiscal year as `YYYY-MM-DD`, for SQL BETWEEN. */
export function fiscalYearRange(fiscalYear: number): { startDate: string; endDate: string } {
  const fy = asInt(fiscalYear, 'fiscalYear')
  return { startDate: `${fy}-04-01`, endDate: `${fy + 1}-03-31` }
}

/** "FY 2026-27" — the form used on Indian dealership reporting. */
export function fiscalYearLabel(fiscalYear: number): string {
  const fy = asInt(fiscalYear, 'fiscalYear')
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`
}

/** "Apr 2026" — the row label in the targets grid. */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(Date.UTC(asInt(year, 'year'), asInt(month, 'month') - 1, 15)))
}

/**
 * The fiscal year containing `today`.
 *
 * Uses IST, not the server's zone: between 18:30 and 24:00 UTC on 31 March the server is already in
 * the new fiscal year while the dealership is not, and the MD would open a blank grid for a year
 * that has not started. Every other date helper in this repo anchors on Asia/Kolkata for the same
 * reason (see lib/date-time.ts INDIA_TIME_ZONE).
 */
export function currentFiscalYear(today: Date = new Date()): number {
  const ist = new Date(today.getTime() + 330 * 60_000)
  return fiscalYearOf(ist.getUTCFullYear(), ist.getUTCMonth() + 1)
}

/**
 * Fiscal years the MD may pick, newest first. Includes NEXT year so targets can be set in advance —
 * which is the normal case: a dealership agrees next year's numbers before April.
 */
export function availableFiscalYears(minFiscalYear: number, today: Date = new Date()): number[] {
  const min = asInt(minFiscalYear, 'minFiscalYear')
  const max = currentFiscalYear(today) + 1
  const years: number[] = []
  for (let fy = max; fy >= min; fy -= 1) years.push(fy)
  return years
}
