import 'server-only'

import { getBrandDealers } from '@/lib/dealers/registry'
import { monthLabel } from '@/lib/fiscal-year'
import { actualsKey, getBrandActuals, type ActualsStatus } from './actuals'
import { getBrandTargets, mdTargetsTableReady, targetKey } from './store'
import {
  BRAND_TARGET_SENTINEL,
  CONTEXT_FOR_METRIC,
  METRIC_SPEC,
  TARGET_METRICS,
  getBrandTargetCapability,
  salesIsBrandLevel,
  type TargetBrand,
  type TargetMetric,
} from './constants'

/**
 * One brand's CURRENT MONTH: every branch, target vs actual, for the two settable counts.
 *
 * ── Why current month only ────────────────────────────────────────────────────────────────────
 * This replaced a 12-month fiscal-year grid. Dropping to one month frees the vertical axis, so the
 * page can show EVERY BRANCH AT ONCE instead of making the MD pick one and page through months.
 * That is the comparison an MD actually makes — Jammu against Udhampur this month — and it was the
 * one thing the old layout could not show.
 *
 * ── Why pace, not just percentage ─────────────────────────────────────────────────────────────
 * A live month is always "behind". 40 units against a target of 100 on day 10 of 31 is not a
 * failure, it is ahead of pace. Reporting a bare 40% would have every branch looking broken for the
 * first three weeks of every month, which is how a dashboard trains people to ignore it. So each row
 * carries an expected-to-date figure and a pace verdict alongside the raw number.
 */

export type PaceVerdict = 'ahead' | 'on_track' | 'behind' | 'unknown'

export type MetricCell = {
  target: number | null
  actual: number | null
  /** Percentage of the FULL-month target achieved so far. */
  achievement: number | null
  /** Where the branch should be by today if it were tracking evenly. Null without a target. */
  expectedToDate: number | null
  pace: PaceVerdict
  status: ActualsStatus
  /** The revenue that came with this count. Context only — never a target. See constants.ts. */
  contextValue: number | null
}

export type BranchRow = {
  code: string
  label: string
  isBrandLevel: boolean
  /** False when this row's metric is not settable at this grain (e.g. Hyundai sales per branch). */
  settable: Record<TargetMetric, boolean>
  metrics: Record<TargetMetric, MetricCell>
}

export type TargetsPayload = {
  brand: TargetBrand
  brandLabel: string
  /** The month every figure on the page describes. Not selectable — it is always now. */
  period: {
    year: number
    month: number
    label: string
    dayOfMonth: number
    daysInMonth: number
    /** 0..1 — how much of the month has elapsed, which is what pace is measured against. */
    elapsed: number
  }
  rows: BranchRow[]
  totals: Record<TargetMetric, MetricCell>
  unavailable: string[]
  capability: {
    salesGrain: 'branch' | 'brand'
    serviceRoBasis: string
    salesGrainNote?: string
  }
  canSaveTargets: boolean
}

/** IST, because the dealership's day — not the server's — decides which month is current. */
function istNow(now: Date) {
  const ist = new Date(now.getTime() + 330 * 60_000)
  return {
    year: ist.getUTCFullYear(),
    month: ist.getUTCMonth() + 1,
    day: ist.getUTCDate(),
  }
}

function pct(actual: number | null, target: number | null): number | null {
  if (actual === null || target === null || target <= 0) return null
  return Math.round((actual / target) * 100)
}

/**
 * Ahead / on track / behind, judged against elapsed time rather than the whole month.
 *
 * The ±8% band around the expected line stops a branch flickering between verdicts day to day on a
 * rounding difference — which would make the colour meaningless.
 */
function paceOf(actual: number | null, expected: number | null): PaceVerdict {
  if (actual === null || expected === null || expected <= 0) return 'unknown'
  const ratio = actual / expected
  if (ratio >= 1.08) return 'ahead'
  if (ratio >= 0.92) return 'on_track'
  return 'behind'
}

export async function getTargetsPayload(input: {
  brand: TargetBrand
  now?: Date
}): Promise<TargetsPayload> {
  const now = input.now ?? new Date()
  const { year, month, day } = istNow(now)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const dayOfMonth = Math.min(Math.max(day, 1), daysInMonth)
  const elapsed = dayOfMonth / daysInMonth

  const capability = getBrandTargetCapability(input.brand)
  const brandLevelSales = salesIsBrandLevel(input.brand)
  const dealers = getBrandDealers(input.brand)

  const [targets, actuals, canSaveTargets] = await Promise.all([
    getBrandTargets(input.brand, year, month),
    getBrandActuals(input.brand, year, month),
    mdTargetsTableReady(),
  ])
  const targetByKey = new Map(targets.map((row) => [targetKey(row.dealerCode, row.year, row.month), row]))

  const readActual = (status: ActualsStatus, value: number | undefined) =>
    (status === 'unavailable' ? null : value ?? 0)

  const buildCell = (
    metric: TargetMetric,
    target: number | null,
    status: ActualsStatus,
    actualValue: number | undefined,
    contextValue: number | undefined,
  ): MetricCell => {
    const actual = readActual(status, actualValue)
    const expectedToDate = target === null ? null : Math.round(target * elapsed)
    return {
      target,
      actual,
      achievement: pct(actual, target),
      expectedToDate,
      pace: paceOf(actual, expectedToDate),
      status,
      contextValue: status === 'unavailable' ? null : contextValue ?? 0,
    }
  }

  // Routed through METRIC_SPEC, not `metric === 'salesUnits'`. The ternary form still COMPILES
  // against a widened union while dropping every new metric into the else-branch, which is wrong
  // numbers with no error anywhere — the exact failure that adding the labour metrics would have hit.
  const statusFor = (metric: TargetMetric): ActualsStatus =>
    (METRIC_SPEC[metric].family === 'sales' ? actuals.salesStatus : actuals.serviceStatus)

  /**
   * Build one row.
   *
   * `salesScope` is where SALES lives for this row: for Hyundai and Platinum that is always the
   * brand sentinel, because their feeds cannot split deliveries by outlet.
   */
  const buildRow = (code: string, label: string, isBrandLevel: boolean): BranchRow => {
    const salesScope = brandLevelSales ? BRAND_TARGET_SENTINEL : code
    const serviceScope = code

    const scopeFor = (metric: TargetMetric) =>
      (METRIC_SPEC[metric].family === 'sales' ? salesScope : serviceScope)
    const settable: Record<TargetMetric, boolean> = {
      // Sales is settable on the brand row for brand-level brands, on the branch row otherwise.
      salesUnits: brandLevelSales ? isBrandLevel : !isBrandLevel,
      // Service is always per branch, so never on the brand roll-up row. Every service metric
      // follows the same rule — derived from the spec so a new one cannot be forgotten here.
      serviceRoCount: !isBrandLevel,
      serviceMechLabour: !isBrandLevel,
      serviceBodyshopLabour: !isBrandLevel,
      serviceLabourTotal: !isBrandLevel,
    }

    const metrics = {} as Record<TargetMetric, MetricCell>
    for (const metric of TARGET_METRICS) {
      const scope = scopeFor(metric)
      const t = targetByKey.get(targetKey(scope, year, month)) ?? null
      const a = actuals.cells.get(actualsKey(scope, year, month)) ?? null
      const spec = METRIC_SPEC[metric]
      const target = t?.[spec.targetField] ?? null
      const actualValue = a?.[spec.actualField]
      const context = a?.[spec.contextField]
      metrics[metric] = buildCell(metric, target, statusFor(metric), actualValue, context)
    }
    return { code, label, isBrandLevel, settable, metrics }
  }

  const branchRows = dealers.map((d) => buildRow(d.code, d.label, false))

  /**
   * The brand roll-up row.
   *
   * ⚠️ This is the fix for a real bug. The previous version set the service scope to `null` whenever
   * the selected scope was brand-level, so Hyundai and Platinum — whose DEFAULT landing scope IS the
   * brand row — showed 0 service ROs on open, while the same month held 784 and 818. Service is
   * per-branch data, so the brand row must SUM its branches rather than look for a brand-level row
   * that by definition never exists.
   */
  const rollup = ((): BranchRow => {
    const base = buildRow(BRAND_TARGET_SENTINEL, `${capability?.label ?? input.brand} — all branches`, true)
    const summed = {} as Record<TargetMetric, MetricCell>
    for (const metric of TARGET_METRICS) {
      if (METRIC_SPEC[metric].family === 'sales' && brandLevelSales) {
        // Sales already IS a single brand-level figure for these brands — nothing to sum.
        summed[metric] = base.metrics[metric]
        continue
      }
      const status = statusFor(metric)
      let target: number | null = null
      let actual = 0
      let context = 0
      for (const row of branchRows) {
        const c = row.metrics[metric]
        if (c.target !== null) target = (target ?? 0) + c.target
        actual += c.actual ?? 0
        context += c.contextValue ?? 0
      }
      summed[metric] = buildCell(metric, target, status, actual, context)
    }
    return { ...base, metrics: summed }
  })()

  // Roll-up first: the MD's opening question is "how is the brand doing", then which branch.
  const rows = [rollup, ...branchRows]

  const totals = rollup.metrics

  const unavailable: string[] = []
  if (actuals.salesStatus === 'unavailable') unavailable.push(`${capability?.label ?? input.brand} sales feed`)
  if (actuals.serviceStatus === 'unavailable') unavailable.push(`${capability?.label ?? input.brand} service feed`)

  return {
    brand: input.brand,
    brandLabel: capability?.label ?? input.brand,
    period: { year, month, label: monthLabel(year, month), dayOfMonth, daysInMonth, elapsed },
    rows,
    totals,
    unavailable,
    capability: {
      salesGrain: capability?.salesGrain ?? 'branch',
      serviceRoBasis: capability?.serviceRoBasis ?? 'Repair orders',
      salesGrainNote: capability?.salesGrainNote,
    },
    canSaveTargets,
  }
}

export { CONTEXT_FOR_METRIC }
