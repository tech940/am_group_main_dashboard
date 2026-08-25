/**
 * Shared vocabulary for MD Targets. Pure data — client-safe, imported by both the grid and the
 * server routes so the two cannot disagree about what is settable.
 */

/**
 * Stands in for "the whole brand" in md_branch_targets.dealer_code.
 *
 * ⚠️ Cannot collide with a real dealer code: KIA and Platinum use DMS codes (JK402, JK501, N5211,
 * N6250, N6828) and Hyundai uses synthetic uppercase branch keys (JAMMU, AKHNOOR, KATHUA, RS_PURA,
 * VIJAYPUR, BILLAWAR). The __…__ form already means "not a real dealer" in this codebase —
 * see DEALER_SCOPE_NONE = ['__no_dealer__'] in lib/auth/dealer-scope.ts.
 *
 * scripts/verify-md-targets.ts asserts this against the live registry rather than trusting the
 * paragraph above.
 */
export const BRAND_TARGET_SENTINEL = '__brand__'

/** Brands with both a live DMS feed and a reader — the only ones a target can be scored against. */
export const TARGET_BRANDS = ['kia', 'hyundai', 'platinum'] as const
export type TargetBrand = typeof TARGET_BRANDS[number]

export function isTargetBrand(value: unknown): value is TargetBrand {
  return (TARGET_BRANDS as readonly string[]).includes(String(value || '').trim().toLowerCase())
}

/**
 * What the MD can set: two counts, and three workshop LABOUR values.
 *
 * ⚠️ TOTAL-REVENUE targets are still deliberately EXCLUDED, and that original decision stands. Per-
 * unit price is not something the dealership can predict — an RO's total value depends on what the
 * vehicle turns out to need, and a month's sales revenue moves with model mix and discounting.
 * Setting a rupee target against that produces a number that is missed or beaten for reasons nobody
 * controls, which teaches everyone to ignore it. So `salesRevenue` and `serviceRevenue` stay
 * context-only: read and shown beside the count, never scored.
 *
 * LABOUR is the deliberate exception (migration 0047), and it is a different kind of number rather
 * than a change of mind. Labour value is hours sold at a published rate: the workshop controls bay
 * capacity, technician headcount and the menu price, so a service manager can genuinely commit to
 * it. PARTS value cannot be committed to — it is whatever the vehicle needed — which is exactly why
 * the three labour targets are `labour_amt` ONLY and never include `part_amt`.
 *
 * ⚠️ Consequence worth stating plainly: a labour target is NOT a slice of `serviceRevenue`
 * (labour + parts). The two must never be presented as summing.
 */
export const TARGET_METRICS = [
  'salesUnits',
  'serviceRoCount',
  'serviceMechLabour',
  'serviceBodyshopLabour',
  'serviceLabourTotal',
] as const
export type TargetMetric = typeof TARGET_METRICS[number]

/** Revenue is shown as context beside its count, never as a target. */
export const CONTEXT_METRICS = ['salesRevenue', 'serviceRevenue'] as const
export type ContextMetric = typeof CONTEXT_METRICS[number]

/** Which figures are money — drives the ₹ formatting AND the wider input mask on the grid. */
export const CURRENCY_METRICS: ReadonlySet<string> = new Set<string>([
  'salesRevenue',
  'serviceRevenue',
  'serviceMechLabour',
  'serviceBodyshopLabour',
  'serviceLabourTotal',
])

/** The revenue figure that sits beside each settable metric as unscored context. */
export const CONTEXT_FOR_METRIC: Record<TargetMetric, ContextMetric> = {
  salesUnits: 'salesRevenue',
  serviceRoCount: 'serviceRevenue',
  serviceMechLabour: 'serviceRevenue',
  serviceBodyshopLabour: 'serviceRevenue',
  serviceLabourTotal: 'serviceRevenue',
}

/**
 * One row per metric, replacing the `metric === 'salesUnits' ? … : …` ternaries that used to decide
 * this at six separate sites.
 *
 * ⚠️ Those ternaries were not merely untidy — they were a live trap. Each one still COMPILES against
 * a widened union while silently routing every new metric into the else-branch, so adding a metric
 * produced wrong numbers with no type error and no runtime error. Route every per-metric decision
 * through this table; `scripts/verify-md-targets.ts` asserts it stays exhaustive, because a
 * `Record<TargetMetric, …>` is a compile-time guarantee only and tsx/esbuild strips types unchecked.
 */
export type MetricSpec = {
  /** Which half of the grid it belongs to, and therefore which actuals fetch backs it. */
  family: 'sales' | 'service'
  kind: 'count' | 'money'
  /** Key on TargetRow / TargetEntryInput (lib/targets/store.ts) — equal to the metric key. */
  targetField: TargetMetric
  /** Key on ActualCell (lib/targets/actuals.ts). Deliberately NOT the same names. */
  actualField: 'salesUnits' | 'serviceRoCount' | 'mechLabour' | 'bodyshopLabour' | 'labourTotal'
  contextField: ContextMetric
}

export const METRIC_SPEC: Record<TargetMetric, MetricSpec> = {
  salesUnits: {
    family: 'sales', kind: 'count',
    targetField: 'salesUnits', actualField: 'salesUnits', contextField: 'salesRevenue',
  },
  serviceRoCount: {
    family: 'service', kind: 'count',
    targetField: 'serviceRoCount', actualField: 'serviceRoCount', contextField: 'serviceRevenue',
  },
  serviceMechLabour: {
    family: 'service', kind: 'money',
    targetField: 'serviceMechLabour', actualField: 'mechLabour', contextField: 'serviceRevenue',
  },
  serviceBodyshopLabour: {
    family: 'service', kind: 'money',
    targetField: 'serviceBodyshopLabour', actualField: 'bodyshopLabour', contextField: 'serviceRevenue',
  },
  serviceLabourTotal: {
    family: 'service', kind: 'money',
    targetField: 'serviceLabourTotal', actualField: 'labourTotal', contextField: 'serviceRevenue',
  },
}

/**
 * The three labour metrics, in display order.
 *
 * ⚠️ In the ACTUALS, mech + bodyshop === total to the rupee (both sides are filtered to the same
 * four canonical work_type buckets). In the TARGETS they need not: the MD sets the total
 * independently and may deliberately commit to more than the two parts. The grid warns on a
 * mismatch rather than blocking it — a refused save would be the tool arguing with the person
 * setting the goal.
 */
export const LABOUR_METRICS = ['serviceMechLabour', 'serviceBodyshopLabour', 'serviceLabourTotal'] as const

/**
 * Per-brand capability. This is NOT a preference — it records what each DMS feed can actually
 * support, and the write route rejects anything that contradicts it.
 *
 * ⚠️ ALL THREE brands split sales per branch. An earlier version of this file claimed Hyundai and
 * Platinum could not, on the strength of lib/hyundai/retail-review.ts's "NO OUTLET SPLIT … the feed
 * cannot support it". That comment is true of `main_dealer_code` — which really is 100% N5216 for
 * Hyundai — but NOT of `dealer_code` / `source_dealer_code`, which carry a clean per-branch split.
 *
 * Measured on VIN-deduped deliveries for Aug 2026:
 *   Hyundai  31 = Jammu 14 · Kathua 9 · Akhnoor 3 · Billawar 3 · RS Pura 2
 *   Platinum 34 = Jammu 19 · Rajouri 12 · Poonch 3
 * Both sum exactly to the brand totals, so nothing is lost or double counted by splitting.
 *
 * Service is per-branch for all three too: every workshop reader already accepts a dealerCode.
 *
 * ⚠️ `serviceRoBasis` differs by brand and the difference is REAL, not cosmetic. KIA counts repair
 * orders (roCount); Hyundai and Platinum count DEDUPED JOB CARDS (dedupedJc). Presenting them as
 * one number would be a quiet lie, so the UI shows the basis next to the figure.
 */
export type BrandTargetCapability = {
  brand: TargetBrand
  label: string
  salesGrain: 'branch' | 'brand'
  serviceGrain: 'branch'
  serviceRoBasis: string
  /** Shown in the UI wherever sales is brand-level, so the MD knows why there is no branch split. */
  salesGrainNote?: string
}

export const BRAND_TARGET_CAPABILITIES: Record<TargetBrand, BrandTargetCapability> = {
  kia: {
    brand: 'kia',
    label: 'AM KIA',
    salesGrain: 'branch',
    serviceGrain: 'branch',
    serviceRoBasis: 'Repair orders',
  },
  hyundai: {
    brand: 'hyundai',
    label: 'AM Hyundai',
    salesGrain: 'branch',
    serviceGrain: 'branch',
    serviceRoBasis: 'Deduped job cards',
  },
  platinum: {
    brand: 'platinum',
    label: 'AM Platinum',
    salesGrain: 'branch',
    serviceGrain: 'branch',
    serviceRoBasis: 'Deduped job cards',
  },
}

export function getBrandTargetCapability(brand: string): BrandTargetCapability | null {
  const key = String(brand || '').trim().toLowerCase()
  return isTargetBrand(key) ? BRAND_TARGET_CAPABILITIES[key] : null
}

/** Does this brand keep its SALES target against the sentinel rather than per branch? */
export function salesIsBrandLevel(brand: string): boolean {
  return getBrandTargetCapability(brand)?.salesGrain === 'brand'
}

/** Row identity in the grid and in the upsert payload. */
export function targetRowKey(brand: string, dealerCode: string, year: number, month: number): string {
  return `${brand}|${dealerCode}|${year}-${String(month).padStart(2, '0')}`
}
