/**
 * H Promise money: price with GST, gross profit, carrying interest and net profit. Client-safe and pure.
 *
 * ── Where these rules come from ─────────────────────────────────────────────────────────────────
 * The Google Sheet computed them as ARRAYFORMULAs in the VEHICLE MASTER tab (read from the owner's workbook
 * on 2026-09-17 and re-computed for all 62 rows with zero mismatches):
 *
 *   J  Purchase price with GST  = H × (1 + GST%)                 (the purchase form rounded it to the rupee)
 *   BK Gross profit             = X − (H + Z)                    selling − (purchase + refurbishment)
 *   BL Gross profit with GST    = X − (J + Z)                    selling − (purchase with GST + refurbishment)
 *   BM Interest days            = TODAY() − F                    today − purchase date
 *   BN Interest                 = ROUND(BM × 0.0003287671233 × H, 0)   i.e. 12 % a year ÷ 365, on H (no GST)
 *   BO Net profit               = BL − BN
 *
 * ⚠️ ONE DELIBERATE CORRECTION. The sheet counted interest days to TODAY for every row, sold cars included,
 * so a car sold a year ago kept "losing" ₹650 a day of net profit forever and last year's MIS changed every
 * morning. Here interest stops on the sale date (`interestRunsTo: 'sale_date'`). The sheet's behaviour is
 * still available as `'as_of'` — scripts/verify-h-promise.ts uses it to prove the formulas match the
 * workbook row for row.
 *
 * ⚠️ The sheet showed a negative "profit" for unsold cars (a blank selling price counts as 0). A car that has
 * not been sold has no profit yet: gross and net profit are null until there is a selling price. Interest
 * accrued so far IS shown for stock — it is the cost of holding the car.
 *
 * Money is handled in whole PAISE (integers) so sums never drift by fractions of a paisa.
 */

export const ECONOMICS_FORMULA_VERSION: string = 'workbook-2026-09-17'

export function economicsConfirmed(): boolean {
  return ECONOMICS_FORMULA_VERSION !== 'pending-xlsx'
}

/** The sheet's constant: 0.0003287671233 a day = 12 % ÷ 365. */
export const DEFAULT_INTEREST_RATE_ANNUAL_PCT = 12
export const INTEREST_DAY_BASIS = 365
export const INTEREST_RATE_SETTING_KEY = 'interest_rate_annual_pct'

/** `numeric` columns arrive from Drizzle as strings. Null for anything that is not a finite number. */
export function toPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[₹,\s]/g, ''))
  if (!Number.isFinite(n)) return null
  return roundHalfAwayFromZero(n * 100)
}

export function paiseToRupees(paise: number): number {
  return paise / 100
}

export function paiseToRupeesOrNull(paise: number | null | undefined): number | null {
  return paise === null || paise === undefined ? null : paise / 100
}

/** Excel's ROUND: halves go away from zero (JavaScript's Math.round sends -2.5 to -2). */
export function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/**
 * Purchase price including GST, rounded to whole rupees — exactly what the sheet's purchase form computed
 * (`Math.round(price * (1 + gst / 100))`) and stored.
 */
export function priceWithGstPaise(pricePaise: number | null, gstPct: string | number | null | undefined): number | null {
  if (pricePaise === null) return null
  const pct = Number(gstPct ?? 0)
  if (!Number.isFinite(pct)) return null
  const rupees = roundHalfAwayFromZero((pricePaise / 100) * (1 + pct / 100))
  return rupees * 100
}

/** One interest rate and the first day it applies. Rows come from tata_h_promise_settings. */
export type InterestRatePeriod = { effectiveFrom: string; ratePct: number }

export type EconomicsSettings = {
  /** Sorted or not — computeEconomics sorts. Empty means the sheet's 12 %. */
  interestRates: ReadonlyArray<InterestRatePeriod>
  /** `sale_date` (the app) or `as_of` (the sheet — used only to prove the formulas match the workbook). */
  interestRunsTo?: 'sale_date' | 'as_of'
}

export const DEFAULT_ECONOMICS_SETTINGS: EconomicsSettings = {
  interestRates: [{ effectiveFrom: '2000-01-01', ratePct: DEFAULT_INTEREST_RATE_ANNUAL_PCT }],
  interestRunsTo: 'sale_date',
}

export type EconomicsInput = {
  purchasePrice: string | number | null
  purchaseGstPct: string | number | null
  sellingPrice: string | number | null
  otherCost: string | number | null
  /** YYYY-MM-DD */
  purchaseDate: string | null
  /** YYYY-MM-DD — only for a recorded sale. */
  saleDate: string | null
  /** For unsold vehicles, interest runs to this date (IST today). */
  asOfYmd: string
}

export type Economics = {
  purchasePricePaise: number | null
  priceWithGstPaise: number | null
  sellingPricePaise: number | null
  otherCostPaise: number | null
  /** Null until the car has a selling price. */
  grossProfitPaise: number | null
  grossProfitWithGstPaise: number | null
  interestDays: number | null
  /** Carrying cost: to the sale date once sold, to today while in stock. */
  interestPaise: number | null
  netProfitPaise: number | null
  confirmed: boolean
  /** Net profit below zero. Null while unsold. */
  isLoss: boolean | null
  formulaVersion: string
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function ymdToDayNumber(ymd: string | null | undefined): number | null {
  if (!ymd) return null
  const match = YMD.exec(ymd.slice(0, 10))
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null
}

/**
 * Interest on `pricePaise` from `fromYmd` (day 0) to `toYmd`, applying each rate to the days it covered.
 * With one rate this is exactly the sheet's ROUND(days × rate ÷ 365 × price, 0).
 */
export function interestPaiseFor(
  pricePaise: number,
  fromYmd: string,
  toYmd: string,
  rates: ReadonlyArray<InterestRatePeriod>,
): { days: number; paise: number } | null {
  const from = ymdToDayNumber(fromYmd)
  const to = ymdToDayNumber(toYmd)
  if (from === null || to === null) return null
  const days = to - from
  if (days <= 0) return { days: Math.max(0, days), paise: 0 }

  const periods = (rates.length > 0 ? rates : DEFAULT_ECONOMICS_SETTINGS.interestRates)
    .map((rate) => ({ start: ymdToDayNumber(rate.effectiveFrom), ratePct: rate.ratePct }))
    .filter((rate): rate is { start: number; ratePct: number } => rate.start !== null && Number.isFinite(rate.ratePct))
    .sort((a, b) => a.start - b.start)

  // rate-weighted days, in "percent-days"
  let weighted = 0
  for (let index = 0; index < periods.length; index += 1) {
    const period = periods[index]
    const nextStart = periods[index + 1]?.start ?? Number.POSITIVE_INFINITY
    // Day d (from < d ≤ to) accrues at the rate in force on day d − 1, as TODAY() − F counts nights held.
    const segmentFrom = Math.max(from, period.start)
    const segmentTo = Math.min(to, nextStart)
    if (segmentTo > segmentFrom) weighted += (segmentTo - segmentFrom) * period.ratePct
  }
  // Days before the first configured rate accrue at the earliest rate (a rate is never "missing").
  const first = periods[0]
  if (first && from < first.start) {
    weighted += (Math.min(to, first.start) - from) * first.ratePct
  }

  const rupees = roundHalfAwayFromZero(((weighted / 100) / INTEREST_DAY_BASIS) * (pricePaise / 100))
  return { days, paise: rupees * 100 }
}

export function computeEconomics(input: EconomicsInput, settings: EconomicsSettings = DEFAULT_ECONOMICS_SETTINGS): Economics {
  const purchase = toPaise(input.purchasePrice)
  const withGst = priceWithGstPaise(purchase, input.purchaseGstPct)
  const selling = toPaise(input.sellingPrice)
  const other = toPaise(input.otherCost) ?? 0

  const runsTo = settings.interestRunsTo ?? 'sale_date'
  const interestEnd = runsTo === 'sale_date' && input.saleDate ? input.saleDate : input.asOfYmd
  const interest = purchase !== null && input.purchaseDate
    ? interestPaiseFor(purchase, input.purchaseDate, interestEnd, settings.interestRates)
    : null

  const gross = selling !== null && purchase !== null ? selling - (purchase + other) : null
  const grossGst = selling !== null && withGst !== null ? selling - (withGst + other) : null
  const net = grossGst !== null && interest !== null ? grossGst - interest.paise : null

  return {
    purchasePricePaise: purchase,
    priceWithGstPaise: withGst,
    sellingPricePaise: selling,
    otherCostPaise: toPaise(input.otherCost),
    grossProfitPaise: gross,
    grossProfitWithGstPaise: grossGst,
    interestDays: interest?.days ?? null,
    interestPaise: interest?.paise ?? null,
    netProfitPaise: net,
    confirmed: economicsConfirmed(),
    isLoss: net === null ? null : net < 0,
    formulaVersion: ECONOMICS_FORMULA_VERSION,
  }
}

/** Settings rows (jsonb value) → rate periods. Anything unreadable is skipped, never guessed. */
export function ratesFromSettings(rows: ReadonlyArray<{ key: string; effectiveFrom: string; value: unknown }>): InterestRatePeriod[] {
  const periods: InterestRatePeriod[] = []
  for (const row of rows) {
    if (row.key !== INTEREST_RATE_SETTING_KEY) continue
    const raw = typeof row.value === 'object' && row.value !== null && 'ratePct' in row.value
      ? (row.value as { ratePct: unknown }).ratePct
      : row.value
    const ratePct = Number(raw)
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) continue
    periods.push({ effectiveFrom: String(row.effectiveFrom).slice(0, 10), ratePct })
  }
  return periods.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}
