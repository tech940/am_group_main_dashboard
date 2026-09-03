/**
 * Date helpers for the Scrap section's filters.
 *
 * ⚠️ LOCAL CALENDAR, NEVER toISOString().
 *
 * `new Date(y, m, 1).toISOString()` builds LOCAL midnight and then converts to UTC, which in IST
 * (+05:30) rolls every boundary back a day: "This Month" resolved to 30 Jun .. 30 Jul instead of
 * 1 .. 31 Jul — silently pulling an extra June day in and dropping the last day of July — and
 * "Today" pointed at yesterday for anyone loading the page before 05:30 IST.
 *
 * This logic was written out twice, in ScrapExecutiveDashboardView and ScrapRecordGridView, each
 * with its own copy of the same warning comment. One home, so the two views cannot drift.
 */

/** Format a Date as YYYY-MM-DD in the VIEWER'S LOCAL calendar. */
export function toLocalIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Today, in the viewer's local calendar. */
export function localToday(): string {
  return toLocalIsoDate(new Date())
}

/** The first day of the month the viewer is currently in. */
export function currentMonthStart(): string {
  const d = new Date()
  return toLocalIsoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

/**
 * The last day of the current month.
 *
 * Day 0 of the NEXT month is the last day of this one, which is why this needs no leap-year or
 * 30/31 special-casing.
 */
export function currentMonthEnd(): string {
  const d = new Date()
  return toLocalIsoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))
}

/** A human label for the current month, e.g. "August 2026" — used to say what is on screen. */
export function currentMonthLabel(): string {
  return new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}
