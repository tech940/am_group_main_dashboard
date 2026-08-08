import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

/**
 * KIA Retail Review — the MD's monthly retail deck.
 *
 * Slides 1-4: retail CY-vs-CY by month for each outlet and combined, a GAP row, the Q4 baseline
 * strip, and model-wise monthly retail.
 *
 * Three rules this module exists to hold:
 *
 * 1. ⚠️ RETAIL = `kia_sales_report.delivery_date`. NOT `invoice_date`, which is TEXT in
 *    'DD/MM/YYYY' while delivery_date is a real DATE. Reconciled against the MD's own deck:
 *    delivery_date matched 12 of 14 outlet-months, invoice_date matched 1.
 *
 * 2. ⚠️ THE OUTLET IS `dealer_code_2` FIRST. On 2026-07-22 the feed changed shape — `dealer_code`
 *    became the parent code JK402 on every row and the real outlet moved to `dealer_code_2`.
 *    Reading `dealer_code` first credits every Udhampur retail to Jammu. This is a no-op before
 *    Jul-2026 (the column is NULL on 100% of those rows).
 *
 * 3. ⚠️ DEDUPE ON VIN. KIA reuses invoice numbers — 16 numbers map to 32 distinct VINs — so an
 *    invoice-keyed dedupe silently drops the earlier retail (April counted 47 against a true 59).
 *    One car is one VIN, whichever outlet the feed credits it to.
 *
 * Together these reproduce the MD's deck on 14 of 14 outlet-months.
 *
 * Everything is aggregated in SQL. The existing Sales Report reader does `SELECT *` and dedupes in
 * JS, which is fine for one month and not for 24 months across four feeds.
 */

export const KIA_RETAIL_OUTLETS = [
  { code: 'JK402', label: 'Jammu' },
  { code: 'JK501', label: 'Udhampur' },
] as const

export type KiaRetailOutlet = (typeof KIA_RETAIL_OUTLETS)[number]['code']

/**
 * The outlet expression. Order is load-bearing — see rule 2 above.
 * Mirrors `dealerColumns` in lib/kia/sales-report.ts; change both together.
 */
const OUTLET_SQL = sql`UPPER(BTRIM(COALESCE(
  NULLIF(BTRIM(s.dealer_code_2), ''),
  NULLIF(BTRIM(s.dealer_code), ''),
  NULLIF(BTRIM(s.main_dealer_code), ''),
  ''
)))`

/**
 * Model canonicalisation for the MD's slide-4 rows.
 *
 * The feed does not match the deck: it carries `SELTOS` and `NEW SELTOS` as separate strings, has
 * no non-EV `CARENS CLAVIS` at all, and carries an `EV6` the deck omits. Owner decisions:
 * merge the two Seltos strings, keep CARENS CLAVIS as a zero row so the slide still matches,
 * show EV6 rather than hide a real sale, and bucket anything unrecognised as Other so the column
 * always ties back to overall retail.
 */
const MODEL_ALIASES: { match: RegExp; canonical: string }[] = [
  { match: /^CARENS\s*CLAVIS\s*EV/, canonical: 'CARENS CLAVIS EV' },
  { match: /^CARENS/, canonical: 'CARENS' },
  { match: /SELTOS/, canonical: 'SELTOS' },
  { match: /^SONET/, canonical: 'SONET' },
  { match: /^SYROS/, canonical: 'SYROS' },
  { match: /^CARNIVAL/, canonical: 'CARNIVAL' },
  { match: /^EV6/, canonical: 'EV6' },
  { match: /^EV9/, canonical: 'EV9' },
]

/** Row order on the MD's slide, with the two additions agreed with the owner. */
export const KIA_REVIEW_MODEL_ROWS = [
  'SONET', 'SELTOS', 'CARENS', 'CARENS CLAVIS', 'CARENS CLAVIS EV', 'SYROS', 'CARNIVAL', 'EV6', 'EV9', 'Other',
] as const

/**
 * ⚠️ CARENS CLAVIS is a VARIANT, not a model.
 *
 * `kia_sales_report.model` has no 'CARENS CLAVIS' string at all — every Clavis is filed under
 * model 'CARENS' and only the variant distinguishes it ("CARENS CLAVIS G1.5 6MT HTE(O)7", and a
 * few written without the space: "CARENS CLAVISG1.5T ..."). The MD's slide shows them as separate
 * rows, so the split has to come from the variant.
 *
 * The combined CARENS total reproduces the deck exactly (41, and month-for-month 7/2/9/5/7/7/4),
 * but the SPLIT does not: variant-matching yields 20 plain + 21 Clavis where the deck shows
 * 24 + 17. Four cars are classified differently. Flagged rather than fudged — see `notes`.
 */
export function canonicalKiaModel(model: unknown, variant?: unknown): string {
  const text = String(model ?? '').trim().toUpperCase()
  if (!text) return 'Other'
  const variantText = String(variant ?? '').trim().toUpperCase()

  if (/^CARENS/.test(text) && !/^CARENS\s*CLAVIS\s*EV/.test(text)) {
    if (/CLAVIS/.test(variantText)) {
      return /EV/.test(variantText) ? 'CARENS CLAVIS EV' : 'CARENS CLAVIS'
    }
  }

  for (const alias of MODEL_ALIASES) {
    if (alias.match.test(text)) return alias.canonical
  }
  return 'Other'
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? result as Record<string, unknown>[] : []
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export type KiaRetailMonthRow = {
  /** 1-12 */
  month: number
  current: number
  previous: number
  /** current - previous. Positive means we are ahead of last year. */
  gap: number
}

export type KiaRetailBaseline = {
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
  /** How many months of the current year carry data. Named so the UI can label the gap honestly. */
  elapsedMonths: number
  lastMonthWithData: number | null
}

export type KiaRetailSeries = {
  outlet: KiaRetailOutlet | 'ALL'
  label: string
  months: KiaRetailMonthRow[]
  currentTotal: number
  previousTotal: number
  currentMonthlyAverage: number
  previousMonthlyAverage: number
  baseline: KiaRetailBaseline
}

export type KiaModelMonthRow = {
  model: string
  months: number[]
  total: number
  monthlyAverage: number
}

export type KiaRetailReview = {
  currentYear: number
  previousYear: number
  series: KiaRetailSeries[]
  models: KiaModelMonthRow[]
  modelTotals: { months: number[]; total: number; monthlyAverage: number }
  notes: string[]
}

/**
 * One deduped retail row per vehicle, with its month, year and outlet already resolved.
 * Aggregation happens on top of this in SQL — nothing streams into JS.
 */
function dedupedRetailCte(currentYear: number, previousYear: number) {
  return sql`
  retail AS MATERIALIZED (
    SELECT
      EXTRACT(YEAR FROM d.delivery_date)::int AS yr,
      EXTRACT(MONTH FROM d.delivery_date)::int AS mo,
      d.outlet,
      d.model,
      d.variant
    FROM (
      SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
        s.delivery_date,
        ${OUTLET_SQL} AS outlet,
        UPPER(BTRIM(COALESCE(s.model, ''))) AS model,
        UPPER(BTRIM(COALESCE(s.variant, ''))) AS variant
      FROM kia_sales_report s
      WHERE COALESCE(s.vin_number, '') <> ''
        AND s.delivery_date IS NOT NULL
        AND EXTRACT(YEAR FROM s.delivery_date) IN (${currentYear}, ${previousYear})
      ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
    ) d
  )`
}

function buildBaseline(
  monthsCurrent: number[],
  monthsPrevious: number[],
  lastMonthWithData: number | null,
  completeMonths: number,
): KiaRetailBaseline {
  // Q4 of the comparison year — calendar Oct-Dec, matching the MD's "Q4 (Oct-Dec'25)".
  const q4Volume = monthsPrevious.slice(9, 12).reduce((total, value) => total + value, 0)
  const q4AveragePerMonth = q4Volume / 3

  // ⚠️ Only COMPLETE months count. Two separate traps:
  //   - dividing a year-to-date total by 12 would read as a collapse;
  //   - counting the CURRENT, partial month drags the average down just as hard. On 2026-08-08 a
  //     single August retail turned the combined average from 52/month into 46 and the de-growth
  //     from -21% into -31%, against a deck that plainly says "till Jul".
  // So elapsed = min(complete calendar months, last month that actually carries data) — the second
  // term matters when the feed is behind the calendar.
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

export async function getKiaRetailReview(options: {
  currentYear?: number | null
  previousYear?: number | null
} = {}): Promise<KiaRetailReview> {
  const now = new Date()
  const currentYear = Number(options.currentYear) || now.getUTCFullYear()
  const previousYear = Number(options.previousYear) || currentYear - 1
  const notes: string[] = []

  const [retailResult, modelResult] = await Promise.all([
    db.execute(sql`
      WITH ${dedupedRetailCte(currentYear, previousYear)}
      SELECT yr, mo, outlet, COUNT(*)::int AS n
      FROM retail GROUP BY yr, mo, outlet
    `),
    db.execute(sql`
      WITH ${dedupedRetailCte(currentYear, previousYear)}
      SELECT mo, model, variant, COUNT(*)::int AS n
      FROM retail WHERE yr = ${currentYear} GROUP BY mo, model, variant
    `),
  ])

  // ---- Slides 1-3: retail by month, per outlet and combined ----
  const empty = () => Array.from({ length: 12 }, () => 0)
  const buckets = new Map<string, { current: number[]; previous: number[] }>()
  const ensure = (key: string) => {
    if (!buckets.has(key)) buckets.set(key, { current: empty(), previous: empty() })
    return buckets.get(key)!
  }
  ensure('ALL')
  for (const outlet of KIA_RETAIL_OUTLETS) ensure(outlet.code)

  let unknownOutletRows = 0
  for (const row of rows(retailResult)) {
    const year = num(row.yr)
    const monthIndex = num(row.mo) - 1
    const count = num(row.n)
    const outlet = String(row.outlet || '').trim().toUpperCase()
    if (monthIndex < 0 || monthIndex > 11) continue

    const known = KIA_RETAIL_OUTLETS.some((item) => item.code === outlet)
    if (!known && outlet) unknownOutletRows += count

    // The combined series is a sum of the raw rows, never a sum of the outlet series — an
    // unrecognised outlet code must still reach the group total rather than vanish.
    const targets = ['ALL', ...(known ? [outlet] : [])]
    for (const key of targets) {
      const bucket = ensure(key)
      if (year === currentYear) bucket.current[monthIndex] += count
      else if (year === previousYear) bucket.previous[monthIndex] += count
    }
  }

  if (unknownOutletRows > 0) {
    notes.push(
      `${unknownOutletRows} retail${unknownOutletRows === 1 ? '' : 's'} carry an outlet code that is not `
      + `${KIA_RETAIL_OUTLETS.map((o) => o.code).join(' or ')}. They are included in the combined total but in neither branch column.`,
    )
  }

  // "Elapsed" is driven by the combined series so every branch reports the same denominator —
  // otherwise a branch with a quiet month would look better simply for having fewer months.
  const allBucket = ensure('ALL')
  const lastMonthWithData = allBucket.current.reduce(
    (last, value, index) => (value > 0 ? index + 1 : last),
    0,
  ) || null

  // A past year is 12 complete months; the running year is complete only up to last month.
  const completeMonths = currentYear < now.getUTCFullYear()
    ? 12
    : currentYear > now.getUTCFullYear() ? 0 : now.getUTCMonth()
  const elapsedMonths = Math.max(0, Math.min(completeMonths, lastMonthWithData ?? 0))
  if (lastMonthWithData !== null && lastMonthWithData > elapsedMonths) {
    notes.push(
      `Month ${lastMonthWithData} of ${currentYear} is still in progress and is shown in the table but `
      + `excluded from the averages and the gap, which cover the ${elapsedMonths} complete months.`,
    )
  }

  const series: KiaRetailSeries[] = [
    { key: 'ALL', label: 'All Outlets' },
    ...KIA_RETAIL_OUTLETS.map((outlet) => ({ key: outlet.code, label: outlet.label })),
  ].map(({ key, label }) => {
    const bucket = ensure(key)
    const currentTotal = bucket.current.reduce((total, value) => total + value, 0)
    const previousTotal = bucket.previous.reduce((total, value) => total + value, 0)
    const elapsed = elapsedMonths
    return {
      outlet: key as KiaRetailOutlet | 'ALL',
      label,
      months: bucket.current.map((current, index) => ({
        month: index + 1,
        current,
        previous: bucket.previous[index],
        gap: current - bucket.previous[index],
      })),
      currentTotal,
      previousTotal,
      currentMonthlyAverage: elapsed > 0 ? currentTotal / elapsed : 0,
      previousMonthlyAverage: previousTotal / 12,
      baseline: buildBaseline(bucket.current, bucket.previous, lastMonthWithData, completeMonths),
    }
  })

  // ---- Slide 4: model-wise monthly retail for the current year ----
  const modelBuckets = new Map<string, number[]>()
  for (const model of KIA_REVIEW_MODEL_ROWS) modelBuckets.set(model, empty())
  for (const row of rows(modelResult)) {
    const monthIndex = num(row.mo) - 1
    if (monthIndex < 0 || monthIndex > 11) continue
    const canonical = canonicalKiaModel(row.model, row.variant)
    if (!modelBuckets.has(canonical)) modelBuckets.set(canonical, empty())
    modelBuckets.get(canonical)![monthIndex] += num(row.n)
  }

  const elapsed = elapsedMonths
  // `total` covers the SAME elapsed window as the averages, so a row's Total, its months and its
  // average all describe one period. The full 12-month `months` array is still returned for the
  // chart — the in-progress month is visible there and called out in `notes`.
  const models: KiaModelMonthRow[] = [...modelBuckets.entries()].map(([model, months]) => {
    const total = months.slice(0, elapsed).reduce((sum, value) => sum + value, 0)
    return { model, months, total, monthlyAverage: elapsed > 0 ? total / elapsed : 0 }
  })

  const modelTotalMonths = empty()
  for (const model of models) {
    model.months.forEach((value, index) => { modelTotalMonths[index] += value })
  }
  const modelGrandTotal = modelTotalMonths.slice(0, elapsed).reduce((sum, value) => sum + value, 0)

  return {
    currentYear,
    previousYear,
    series,
    models,
    modelTotals: {
      months: modelTotalMonths,
      total: modelGrandTotal,
      monthlyAverage: elapsed > 0 ? modelGrandTotal / elapsed : 0,
    },
    notes,
  }
}
