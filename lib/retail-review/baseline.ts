/**
 * Baseline maths for a brand's MD retail review — shared, because the rules below were argued out
 * against a real deck and must not drift between brands.
 *
 * Extracted verbatim from lib/kia/retail-review.ts so KIA and Hyundai compute the same thing. If you
 * change an assumption here, you change it for every brand, which is the point.
 */

export type RetailBaseline = {
  /** Oct-Dec of the comparison year. */
  q4Volume: number
  q4AveragePerMonth: number
  /** Average per month across the elapsed months of the current year only. */
  currentAveragePerMonth: number
  volumeGapPerMonth: number
  /** (currentAvg - q4Avg) / q4Avg, as a percentage. Negative is de-growth. */
  deGrowthPercent: number | null
  /** volumeGapPerMonth x elapsed months — the deck's "Total Vol gap till <month>". */
  totalVolumeGap: number
  /** How many months of the current year carry data, so the UI can label the gap honestly. */
  elapsedMonths: number
  lastMonthWithData: number | null
}

export function buildRetailBaseline(
  monthsCurrent: number[],
  monthsPrevious: number[],
  lastMonthWithData: number | null,
  completeMonths: number,
): RetailBaseline {
  // Q4 of the comparison year — calendar Oct-Dec, matching the MD's "Q4 (Oct-Dec'25)".
  const q4Volume = monthsPrevious.slice(9, 12).reduce((total, value) => total + value, 0)
  const q4AveragePerMonth = q4Volume / 3

  // ⚠️ Only COMPLETE months count. Two separate traps:
  //   - dividing a year-to-date total by 12 would read as a collapse;
  //   - counting the CURRENT, partial month drags the average down just as hard. On 2026-08-08 a
  //     single August retail turned KIA's combined average from 52/month into 46 and the de-growth
  //     from -21% into -31%, against a deck that plainly says "till Jul".
  // So elapsed = min(complete calendar months, last month that actually carries data) — the second
  // term matters when the feed is behind the calendar, which it routinely is.
  const elapsedMonths = Math.max(0, Math.min(completeMonths, lastMonthWithData ?? 0))
  // Sum only the elapsed months too, so the average and its numerator describe the same window.
  const currentTotal = monthsCurrent.slice(0, elapsedMonths).reduce((total, value) => total + value, 0)
  const currentAveragePerMonth = elapsedMonths > 0 ? currentTotal / elapsedMonths : 0

  const volumeGapPerMonth = q4AveragePerMonth - currentAveragePerMonth
  const deGrowthPercent = q4AveragePerMonth > 0
    ? ((currentAveragePerMonth - q4AveragePerMonth) / q4AveragePerMonth) * 100
    : null

  return {
    q4Volume,
    q4AveragePerMonth,
    currentAveragePerMonth,
    volumeGapPerMonth,
    deGrowthPercent,
    totalVolumeGap: volumeGapPerMonth * elapsedMonths,
    elapsedMonths,
    lastMonthWithData,
  }
}
