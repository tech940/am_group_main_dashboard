/**
 * `kia_stock_local_statuses.local_status` — the app-owned status on a KIA stock vehicle, as opposed
 * to `kia_stock_management.stock_status`, which is the DMS's.
 *
 * ── ⚠️ WHY THIS FILE EXISTS ───────────────────────────────────────────────────────────────────
 * The list of statuses that make a vehicle un-allottable was written out BY HAND in six places
 * across two files:
 *
 *   app/api/brands/kia/proforma/stock/route.ts  x3   (the free-stock filter, a COUNT, alt-stock)
 *   lib/kia/bookings.ts                        x3   (matching FROM/WHERE, readMatchingVehicle,
 *                                                    getKiaBookingMatchingVehicles)
 *
 * Six copies of one fact is how this module has already hurt itself: the stock surfaces DIVERGED to
 * three different notions of "sold", 20% apart, and "Payment Pending" counted DMS-`Allocated` cars
 * nobody here had allotted — 8 shown, 1 real. A list that a COUNT applies and a LIST does not is the
 * "Showing 1-12 of 42" bug in another costume.
 *
 * So the vocabulary lives here once, and both SQL dialects in this codebase are served from it.
 *
 * ── The values ───────────────────────────────────────────────────────────────────────────────
 * 'hold_customer' | 'hold_dealer' — reserved for someone, with a release clock.
 * 'retail'                        — sold and handed over.
 * 'bbnd_marked'                   — Build But Not Delivered.
 * 'bbnd'                          — ⚠️ A DIFFERENT FEATURE. Booked-But-Not-in-DMS: a VIN typed in by
 *                                   hand so a booking can be allotted before the DMS feed carries
 *                                   the car. It is NOT stock to hide; it exists precisely to be
 *                                   allotted, and the matching queries have their own arm for it.
 *                                   Never fold it into the list below.
 */

/** Reserved for a person, and released by a clock. */
export const KIA_HOLD_LOCAL_STATUSES = ['hold_customer', 'hold_dealer'] as const

/**
 * Statuses that take a vehicle OUT of free stock — it must not be offered, matched or counted as
 * available.
 *
 * ⚠️ 'bbnd_marked' is in this list BY OWNER DECISION (2026-09-10), reversing the earlier rule that
 * a BBND car stayed in free stock and remained sellable. The consequence is deliberate: a BBND car
 * can no longer be allotted until it is unmarked. The previous behaviour, and the reasoning for it,
 * is recorded in the header of `markKiaStockBbnd`.
 */
export const KIA_NON_ALLOTTABLE_LOCAL_STATUSES = [
  'retail',
  'hold_customer',
  'hold_dealer',
  'bbnd_marked',
] as const

export type KiaNonAllottableLocalStatus = (typeof KIA_NON_ALLOTTABLE_LOCAL_STATUSES)[number]

/**
 * The list as a SQL literal tuple: `'retail', 'hold_customer', …`
 *
 * Safe to interpolate because every element is a compile-time literal in this file — no caller
 * supplies a value. The `'` guard is a tripwire, not input validation: if somebody ever adds a
 * status containing a quote, this throws at module load rather than producing broken SQL.
 */
function sqlList(values: readonly string[]): string {
  for (const v of values) {
    if (v.includes("'")) throw new Error(`Invalid local_status literal: ${v}`)
  }
  return values.map((v) => `'${v}'`).join(', ')
}

/** For the raw-string filter builders (app/api/brands/kia/proforma/stock/route.ts). */
export const KIA_NON_ALLOTTABLE_SQL_LIST = sqlList(KIA_NON_ALLOTTABLE_LOCAL_STATUSES)
export const KIA_HOLD_SQL_LIST = sqlList(KIA_HOLD_LOCAL_STATUSES)

/** The whole predicate, so a caller cannot get the COALESCE or the NOT IN subtly different. */
export const KIA_ALLOTTABLE_LOCAL_STATUS_PREDICATE =
  `COALESCE(ls.local_status, '') NOT IN (${KIA_NON_ALLOTTABLE_SQL_LIST})`

/** Same predicate for a differently-aliased join (alt-stock uses `alt_ls`). */
export function kiaAllottableLocalStatusPredicate(alias: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`)
  return `COALESCE(${alias}.local_status, '') NOT IN (${KIA_NON_ALLOTTABLE_SQL_LIST})`
}

/** True when this status keeps a vehicle out of free stock. */
export function isNonAllottableLocalStatus(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase()
  return (KIA_NON_ALLOTTABLE_LOCAL_STATUSES as readonly string[]).includes(v)
}

/**
 * The BBND bucket predicate — used by BOTH the status filter and its KPI count.
 *
 * ⚠️ ONE STRING, TWO CALLERS, ON PURPOSE. The proforma stock route states the rule in its own
 * comment beside the ON_HOLD count: "The SAME predicate the ON_HOLD filter uses, so the card can
 * never disagree with the tab it opens." A card that counts 7 and opens a list of 0 is this module's
 * signature bug — it has shipped twice (the DMS-Allocated fall-through and the hold fall-through).
 */
export const KIA_BBND_MARKED_LOCAL_STATUS = 'bbnd_marked'
export const KIA_BBND_PREDICATE = `COALESCE(ls.local_status, '') = '${KIA_BBND_MARKED_LOCAL_STATUS}'`
