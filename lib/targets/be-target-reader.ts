import 'server-only'

import { getBrandDealers } from '@/lib/dealers/registry'
import { BRAND_TARGET_SENTINEL, isTargetBrand, type TargetBrand } from './constants'
import { getBrandTargets, mdTargetsTableReady } from './store'

/**
 * The MD's workshop targets, shaped for the Business Excellence Workshop Summary.
 *
 * ── Why this exists rather than reusing lib/targets/reader.ts ─────────────────────────────────
 * That reader builds the whole /targets grid: every branch, every metric, actuals, pace, and the
 * MD-only guard around it. Business Excellence needs four numbers for ONE scope. Calling the grid
 * reader here would drag the actuals fetch (four aggregate statements) into a page that has already
 * computed those very figures itself.
 *
 * ── Why the Workshop Summary is the right host ────────────────────────────────────────────────
 * get{Brand}WorkshopSummary returns { total, mechanical, accidental } x { roCount, labour, parts }
 * plus the lyTotal/lyMechanical/lyAccidental twins — CY and LY for exactly these metrics — and it
 * computes them with the SAME work_type CASE and the SAME dedup that lib/targets/actuals.ts uses.
 * Verified for 2026-07: labour total / mech / bodyshop match that reader to the rupee on all three
 * brands. So a target rendered here sits beside a CY on its own basis.
 *
 * ⚠️ NULL, never 0. A branch with no target set must render an em-dash. Returning 0 would report
 * every unset branch as 0% achieved, which is the same class of lie as the cockpit incident where a
 * failed read was cached as a confident Rs0.
 */
export type BeServiceTarget = {
  roCount: number | null
  mechLabour: number | null
  bodyshopLabour: number | null
  labourTotal: number | null
  /**
   * How many branches contributed, out of how many were asked for. On an "All Locations" view with
   * only some branches set, a bare sum silently under-reports the group target — so the UI can say
   * "2 of 6 branches set" instead of showing a number that looks complete and is not.
   */
  branchesWithTarget: number
  branchesInScope: number
}

const METRIC_KEYS = ['roCount', 'mechLabour', 'bodyshopLabour', 'labourTotal'] as const

/**
 * Which calendar month a Workshop Summary request is describing.
 *
 * The summary is always month-to-date through `endDate`, so the month is taken straight from that
 * string. When no endDate is given the reader means "today", and today must be resolved in IST —
 * `new Date()` on a UTC server rolls the month over 5.5 hours early, which on the 1st of a month
 * would hand back the PREVIOUS month's target for the whole first morning.
 *
 * Parsed by string rather than `new Date(endDate)`: a bare YYYY-MM-DD is interpreted as UTC
 * midnight, which the +5:30 shift below would then push into the next day.
 */
export function resolveTargetPeriod(endDate: string | null | undefined): {
  year: number
  month: number
  daysInMonth: number
  throughDay: number
} {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(endDate || '').trim())
  let year: number
  let month: number
  let day: number

  if (matched) {
    year = Number(matched[1])
    month = Number(matched[2])
    day = Number(matched[3])
  } else {
    const ist = new Date(Date.now() + 330 * 60_000)
    year = ist.getUTCFullYear()
    month = ist.getUTCMonth() + 1
    day = ist.getUTCDate()
  }

  // Day 0 of the NEXT month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, daysInMonth, throughDay: Math.min(Math.max(day, 1), daysInMonth) }
}

/**
 * @param dealerCode a real branch code, or null for the whole brand (the "All Locations" view).
 *
 * ⚠️ The dealer code passed in must be the REGISTRY code — JK402/JK501, JAMMU/AKHNOOR/…,
 * N5211/N6250/N6828 — which is also exactly what md_branch_targets.dealer_code stores and what each
 * brand's normalize*DealerCode returns. No mapping layer is needed here, and none should be
 * hand-rolled: lib/platinum/dealer-branch.ts already folds N6848 into N6828, and there is a SECOND
 * function also called platinumSourceDealerSql (lib/platinum/dealer-filter.ts) that does not.
 */
export async function getServiceTargetsForBe(
  brand: string,
  year: number,
  month: number,
  dealerCode: string | null,
): Promise<BeServiceTarget | null> {
  if (!isTargetBrand(brand)) return null
  // Degrade silently rather than throwing: a Business Excellence page must never go down because an
  // unrelated migration has not been applied yet.
  if (!(await mdTargetsTableReady())) return null

  let rows
  try {
    rows = await getBrandTargets(brand as TargetBrand, year, month)
  } catch (error) {
    console.error('[targets] BE target read failed for %s %s-%s:', brand, year, month, error)
    return null
  }

  // The sentinel row only ever carries brand-level SALES. Including it here would add a phantom
  // branch to the workshop roll-up.
  const wanted = dealerCode
    ? new Set([dealerCode.toUpperCase()])
    : new Set(getBrandDealers(brand as TargetBrand).map((d) => d.code.toUpperCase()))

  const scoped = rows.filter(
    (row) => row.dealerCode !== BRAND_TARGET_SENTINEL && wanted.has(row.dealerCode.toUpperCase()),
  )

  const totals: Record<(typeof METRIC_KEYS)[number], number | null> = {
    roCount: null, mechLabour: null, bodyshopLabour: null, labourTotal: null,
  }
  const contributing = new Set<string>()

  for (const row of scoped) {
    const values = {
      roCount: row.serviceRoCount,
      mechLabour: row.serviceMechLabour,
      bodyshopLabour: row.serviceBodyshopLabour,
      labourTotal: row.serviceLabourTotal,
    }
    for (const key of METRIC_KEYS) {
      const value = values[key]
      if (value === null) continue
      // Stays null until at least one branch has actually set this metric — so "nobody set it" and
      // "everybody set zero" remain distinguishable all the way to the screen.
      totals[key] = (totals[key] ?? 0) + value
      contributing.add(row.dealerCode)
    }
  }

  return { ...totals, branchesWithTarget: contributing.size, branchesInScope: wanted.size }
}
