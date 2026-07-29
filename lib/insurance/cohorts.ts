import {
  INSURANCE_BRANDS,
  activeRowsPredicate,
  col,
  isOdExpr,
  type InsuranceBrandId,
} from '@/lib/insurance/brands'

/**
 * COHORT RETENTION — "of the vehicles that started with us in period X, how many came back?"
 *
 * Deliberately NOT `server-only`: this builds SQL strings and maps rows — no db, no env, no fetch —
 * so the query can be exercised outside Next. The route that executes it is the server boundary.
 *
 * A cohort is keyed on the VEHICLE (chassis), not the customer name — see the vehicles route for why
 * name grouping is wrong in both directions. A vehicle joins exactly one cohort: the period of its
 * FIRST own-damage policy, tagged with that policy's type (New / Renewal / Rollover).
 *
 * ── WHY ANNIVERSARY WINDOWS, NOT CALENDAR YEARS ──────────────────────────────
 * Motor insurance is an annual product. A policy starting Nov 2023 renews Nov 2024, so the real
 * question is "did they come back within 12 months of THEIR start", not "did they appear in calendar
 * 2024". Calendar bucketing splits identical customers differently depending on the month they
 * bought, and — worse — it divides by the whole cohort including vehicles whose renewal date has not
 * arrived yet.
 *
 * That distortion is not academic. Measured on the 2025 NEW cohort (Hyundai):
 *     calendar-year method   306 / 1,169 = 26%
 *     anniversary method     265 /   455 = 58%
 * The calendar figure more than halves real retention, purely because 714 of those vehicles are not
 * yet due. An MD reading 26% would conclude the business is losing customers when it is not.
 *
 * ── THE ELIGIBILITY RULE ─────────────────────────────────────────────────────
 * A vehicle counts in the denominator for window N only once N months PLUS a grace period have
 * elapsed since its first policy. Cohorts with nothing eligible report `null`, and the UI renders
 * "window still open" rather than 0% — a zero here would read as total churn.
 */

/** 93.8% of renewals start within a day of the previous expiry, so 60 days is generous headroom. */
const GRACE_DAYS = 60

export type CohortGrain = 'year' | 'month'

export type CohortWindow = {
  /** Vehicles whose window has fully elapsed — the honest denominator. */
  eligible: number
  returned: number
  /** null when no vehicle in the cohort is due yet. */
  rate: number | null
}

export type CohortRow = {
  period: string
  cohortType: string
  size: number
  windows: CohortWindow[]
}

/**
 * @param filters the page's existing WHERE, already brand-resolved. It scopes which POLICIES form
 *   the cohort; the return-visit lookup deliberately spans all policies for that vehicle, for the
 *   same reason the vehicles route does — a filter must not be able to hide a customer's return.
 */
export function buildCohortSql(
  brandId: InsuranceBrandId,
  scopeWhere: string,
  grain: CohortGrain,
  windowCount = 3,
): string {
  const brand = INSURANCE_BRANDS[brandId]
  const chassis = col(brand, 'chassisNo')
  const start = col(brand, 'policyStartDate')
  const type = col(brand, 'policyType')
  const periodExpr = grain === 'year' ? `to_char(f.first_d,'YYYY')` : `to_char(f.first_d,'YYYY-MM')`

  // One eligibility flag and one "did they return" flag per window.
  const windows = Array.from({ length: windowCount }, (_, i) => i + 1)
  const closedCols = windows
    .map((n) => `bool_or(f.first_d + INTERVAL '${n * 12} months' + INTERVAL '${GRACE_DAYS} days' <= CURRENT_DATE) AS w${n}_closed`)
    .join(',\n    ')
  // ONE join + bool_or per window, NOT a correlated EXISTS per window. The EXISTS form is the
  // obvious way to write this and is ~40x slower: measured 54,457ms vs 1,300ms on Hyundai, because
  // it re-scans `ev` once per vehicle per window (12,563 x 3).
  const returnCols = windows
    .map(
      (n) => `bool_or(e.d >  f.first_d + INTERVAL '${(n - 1) * 12} months'
             AND e.d <= f.first_d + INTERVAL '${n * 12} months' + INTERVAL '${GRACE_DAYS} days') AS r${n}`,
    )
    .join(',\n    ')
  const aggCols = windows
    .map(
      (n) =>
        `count(*) FILTER (WHERE w${n}_closed)::int AS w${n}_eligible,\n  ` +
        `count(*) FILTER (WHERE w${n}_closed AND r${n})::int AS w${n}_returned`,
    )
    .join(',\n  ')

  return `
WITH ev AS (
  -- Own-damage policies only: they are the renewal events. A third-party companion rides alongside
  -- the OD policy in the same year and would double-count the customer as "returning".
  SELECT UPPER(TRIM(t.${chassis})) AS c, t.${start} AS d, t.${type} AS ptype, t.id
  FROM ${brand.table} t
  WHERE ${isOdExpr(brand, 't')} AND ${activeRowsPredicate(brand, 't')} AND t.${start} IS NOT NULL
),
scoped AS (
  -- The page filters decide which policies can OPEN a cohort.
  SELECT UPPER(TRIM(t.${chassis})) AS c, t.${start} AS d, t.${type} AS ptype, t.id
  FROM ${brand.table} t
  WHERE ${scopeWhere} AND ${isOdExpr(brand, 't')} AND ${activeRowsPredicate(brand, 't')} AND t.${start} IS NOT NULL
),
first_ev AS (
  SELECT DISTINCT ON (c) c, d AS first_d, ptype AS first_t
  FROM scoped ORDER BY c, d, id
),
returns AS (
  -- LEFT JOIN so a vehicle that never came back still appears, with every rN false.
  SELECT f.c, f.first_d, f.first_t, ${periodExpr} AS period,
    ${closedCols},
    ${returnCols}
  FROM first_ev f
  LEFT JOIN ev e ON e.c = f.c AND e.d > f.first_d
  GROUP BY f.c, f.first_d, f.first_t
)
SELECT period, COALESCE(first_t, 'Unspecified') AS cohort_type, count(*)::int AS size,
  ${aggCols}
FROM returns
GROUP BY 1, 2
ORDER BY 1 DESC, 2`
}

export function mapCohortRows(rows: Record<string, unknown>[], windowCount = 3): CohortRow[] {
  const n = (v: unknown) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  return rows.map((r) => ({
    period: String(r.period || ''),
    cohortType: String(r.cohort_type || 'Unspecified'),
    size: n(r.size),
    windows: Array.from({ length: windowCount }, (_, i) => {
      const eligible = n(r[`w${i + 1}_eligible`])
      const returned = n(r[`w${i + 1}_returned`])
      return {
        eligible,
        returned,
        // null, never 0, when nothing is due yet — the UI must say "still open", not "0% retained".
        rate: eligible > 0 ? Math.round((returned / eligible) * 1000) / 10 : null,
      }
    }),
  }))
}

export { GRACE_DAYS }
