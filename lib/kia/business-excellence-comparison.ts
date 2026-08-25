import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { kiaRoBillingDealerFilter } from '@/lib/kia/business-excellence-contract'
import { normalizeKiaDealerCode, type KiaDealerCode } from '@/lib/kia/dealer-branch'

/**
 * Which period a KIA Business Excellence figure is compared against.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 * Every comparison on this section was Last Year, which assumes the branch existed last year.
 * Udhampur (JK501) does not satisfy that: verified in the data, it has ZERO RO-billing rows for
 * Sep–Dec 2025, one stray row in Oct, and effectively opens in Jan 2026. So its LY comparison is
 * against nothing, and every growth number, target and shortfall derived from it is meaningless.
 *
 * When the selected branch has no data in the last-year window, comparisons fall back to LAST
 * MONTH of the same year.
 *
 * ⚠️ DATA-DRIVEN, NOT A HARDCODED BRANCH. The trigger is "this dealer has no history that far
 * back", not "this dealer is JK501". Two consequences that are the whole point: from January 2027
 * Udhampur will have a real last-year and silently goes back to LY without anyone remembering to
 * change code, and any branch opened in future gets the same treatment for free.
 *
 * ⚠️ THE BASIS MUST REACH THE CAPTION. A last-month figure rendered under a heading that says
 * "LY" is worse than the broken comparison it replaces — it is simply wrong, and nothing on screen
 * admits it. Callers get `label` / `longLabel` back and are expected to render them; that is why
 * this returns a descriptor rather than just a pair of dates.
 */
export type KiaComparisonBasis = 'ly' | 'lm'

export type KiaComparisonWindow = {
  basis: KiaComparisonBasis
  startDate: string
  endDate: string
  /** Short caption for column headers and pills — 'LY' or 'LM'. */
  label: string
  /** Long caption for tooltips and sentences — 'Last Year' or 'Last Month'. */
  longLabel: string
  /** Why the fallback fired, for a tooltip. Null on the normal LY path. */
  reason: string | null
}

const ISO = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseIso(value: string): Date | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/**
 * Shift a date back by whole months, clamping the day to the target month's length.
 *
 * ⚠️ Naive `setMonth(m - 1)` OVERFLOWS: 31 March minus one month is 31 February, which JavaScript
 * silently rolls forward to 2 or 3 March — so a month-end window would compare against the wrong
 * month entirely. Clamping keeps 31 March → 28/29 February.
 */
export function shiftMonths(date: Date, months: number): Date {
  const year = date.getFullYear()
  const month = date.getMonth() + months
  const targetLastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(date.getDate(), targetLastDay))
}

/** Same window, one year earlier — the existing default, kept identical to the private copies. */
export function lastYearWindow(startDate: string, endDate: string) {
  const start = parseIso(startDate)
  const end = parseIso(endDate)
  if (!start || !end) return { startDate, endDate }
  return {
    startDate: ISO(new Date(start.getFullYear() - 1, start.getMonth(), start.getDate())),
    endDate: ISO(new Date(end.getFullYear() - 1, end.getMonth(), end.getDate())),
  }
}

/** Same window, one month earlier. */
export function lastMonthWindow(startDate: string, endDate: string) {
  const start = parseIso(startDate)
  const end = parseIso(endDate)
  if (!start || !end) return { startDate, endDate }
  return { startDate: ISO(shiftMonths(start, -1)), endDate: ISO(shiftMonths(end, -1)) }
}

/**
 * The earliest RO-billing date on record for a dealer — how far back a comparison can honestly go.
 *
 * Cached for a day: it is a MIN over an append-mostly table and only moves when a genuinely older
 * row is backfilled. One query per dealer per day, rather than a probe per window per tab.
 * Returns null when the dealer has no rows at all, which callers treat as "no history".
 */
export async function getKiaDealerFirstDataDate(
  dealerCode: KiaDealerCode | null | undefined,
): Promise<string | null> {
  const normalized = normalizeKiaDealerCode(dealerCode) || 'all'
  return getCachedData(
    `kia:be:first-data-date:v1:${normalized}`,
    async () => {
      const rows = await analyticsDb.execute(sql`
        SELECT MIN(bill_date)::text AS first_date
        FROM kia_ro_billing_report
        WHERE bill_date IS NOT NULL
          ${kiaRoBillingDealerFilter(normalizeKiaDealerCode(dealerCode))}
      `)
      const list = Array.isArray(rows) ? rows as Record<string, unknown>[] : []
      const value = list[0]?.first_date
      return value ? String(value).slice(0, 10) : null
    },
    CACHE_TTL.DAY,
  )
}

/**
 * How many RO-billing rows a dealer actually has inside a window.
 *
 * ⚠️ This probes THE WINDOW, not the dealer's first-record date, and the difference is not
 * theoretical: JK501's earliest row is a single stray on 2025-10-31, with nothing either side of
 * it until January 2026. A "first record is before the LY window" test therefore passes for a
 * November 2026 view while November 2025 holds zero rows — the exact empty comparison this is
 * meant to catch. Asking the window directly cannot be fooled that way.
 *
 * Cached per dealer+window; the table is small and these windows repeat across every tab.
 */
async function countKiaRoRowsInWindow(
  dealerCode: KiaDealerCode | null,
  startDate: string,
  endDate: string,
): Promise<number> {
  return getCachedData(
    `kia:be:ly-probe:v1:${dealerCode || 'all'}:${startDate}:${endDate}`,
    async () => {
      const rows = await analyticsDb.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM kia_ro_billing_report
        WHERE bill_date IS NOT NULL
          AND bill_date >= ${startDate}::date
          AND bill_date <= ${endDate}::date
          ${kiaRoBillingDealerFilter(dealerCode)}
      `)
      const list = Array.isArray(rows) ? rows as Record<string, unknown>[] : []
      return Number(list[0]?.n ?? 0)
    },
    CACHE_TTL.DAY,
  )
}

/**
 * Resolve what this window should be compared against for this dealer.
 *
 * Falls back to last month only when the last-year window is genuinely EMPTY for this dealer. A
 * sparse-but-real LY window still uses LY: comparing against thin real trading is more meaningful
 * than switching period, and a basis that flipped on volume would be unpredictable.
 */
export async function resolveKiaComparisonWindow(input: {
  startDate: string
  endDate: string
  dealerCode: KiaDealerCode | null | undefined
}): Promise<KiaComparisonWindow> {
  const ly = lastYearWindow(input.startDate, input.endDate)
  const asLy = (): KiaComparisonWindow => ({
    basis: 'ly', startDate: ly.startDate, endDate: ly.endDate,
    label: 'LY', longLabel: 'Last Year', reason: null,
  })

  // No dealer selected means the group as a whole, which has full history — nothing to fall back for.
  const normalized = normalizeKiaDealerCode(input.dealerCode)
  if (!normalized) return asLy()

  let lyRows = 0
  let firstDate: string | null = null
  try {
    lyRows = await countKiaRoRowsInWindow(normalized, ly.startDate, ly.endDate)
    if (lyRows > 0) return asLy()
    firstDate = await getKiaDealerFirstDataDate(normalized)
  } catch {
    // A failed probe must not change what the page reports. Keep the established basis.
    return asLy()
  }

  const lm = lastMonthWindow(input.startDate, input.endDate)
  return {
    basis: 'lm',
    startDate: lm.startDate,
    endDate: lm.endDate,
    label: 'LM',
    longLabel: 'Last Month',
    reason: firstDate
      ? `${normalized} has no records in ${ly.startDate} to ${ly.endDate} (earliest on file is ${firstDate}), so last year is empty — comparing against last month instead.`
      : `${normalized} has no records in ${ly.startDate} to ${ly.endDate}, so last year is empty — comparing against last month instead.`,
  }
}

/**
 * Growth percentage with ONE agreed meaning for "there is nothing to compare against".
 *
 * ⚠️ The section currently answers that four different ways — overview and complaints return +100,
 * workshop-performance returns null, ro-billing-analysis emits the string 'N/A' — so the same branch
 * reads differently on every tab. `null` is the honest one: "+100% growth" against a branch that did
 * not exist is a fabricated number, and a card showing it looks like performance.
 */
export function kiaGrowthPercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

/** Caption for a resolved basis — 'LY' / 'LM'. Keep captions and numbers derived from one source. */
export function periodBasisLabel(basis: KiaComparisonBasis): string {
  return basis === 'lm' ? 'LM' : 'LY'
}

/** Long caption for tooltips and sentences. */
export function periodBasisLongLabel(basis: KiaComparisonBasis): string {
  return basis === 'lm' ? 'Last Month' : 'Last Year'
}
