import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { buildRetailBaseline, type RetailBaseline } from '@/lib/retail-review/baseline'

/**
 * AM Hyundai retail review — the same analysis the KIA MD deck runs, on the Hyundai feed.
 *
 * Deliberately mirrors lib/kia/retail-review.ts, with three differences forced by the data:
 *
 * 1. ⚠️ NO OUTLET SPLIT. KIA reports a column per outlet. The Hyundai sales feed cannot support
 *    that: 776 of 782 delivered rows in the last 18 months carry the single code N5216, and the
 *    other five outlets carry 3, 2 and 1 rows between them. Six columns of which five read zero
 *    would look broken and say nothing, so this reports group totals only. If per-outlet attribution
 *    ever lands in the feed, add it here — the shape is otherwise identical.
 * 2. Its own model canonicalisation — Hyundai files the same car under "VENUE" and "NEW VENUE".
 * 3. RETAIL = delivery_date, never invoice_date, which on this feed is TEXT in DD/MM/YYYY.
 *
 * Everything is aggregated in SQL. Deduped by VIN first: 23,255 delivered rows collapse to 20,753
 * vehicles, so counting rows would overstate retail by about 12%.
 */

/**
 * Model rows, ordered by real volume in the feed.
 *
 * Hyundai ships the same car under several strings — "VENUE" and "NEW VENUE", "CRETA" and
 * "NEW CRETA", "I20" and "ALL NEW I20" — so the facelift prefix is merged away. N Line and the
 * electric Creta stay as their own rows: they are separate products at a different price, and
 * folding them into the base model would hide the mix.
 *
 * Order matters — the N Line and ELECTRIC patterns must be tested before the bare model name, or
 * "CRETA N LINE" would be swallowed by /CRETA/.
 */
const MODEL_ALIASES: { match: RegExp; canonical: string }[] = [
  { match: /CRETA\s*ELECTRIC/, canonical: 'CRETA ELECTRIC' },
  { match: /CRETA\s*N\s*LINE/, canonical: 'CRETA N LINE' },
  { match: /CRETA/, canonical: 'CRETA' },
  { match: /VENUE\s*N\s*LINE/, canonical: 'VENUE N LINE' },
  { match: /VENUE/, canonical: 'VENUE' },
  { match: /GRAND\s*I10/, canonical: 'GRAND I10 NIOS' },
  { match: /I20\s*N\s*LINE/, canonical: 'I20 N LINE' },
  { match: /I20/, canonical: 'I20' },
  { match: /EXTER/, canonical: 'EXTER' },
  { match: /VERNA/, canonical: 'VERNA' },
  { match: /ALCAZAR/, canonical: 'ALCAZAR' },
  { match: /TUCSON/, canonical: 'TUCSON' },
  { match: /AURA/, canonical: 'AURA' },
]

/** Row order on the review table. "Other" always exists so the column ties back to overall retail. */
export const HYUNDAI_REVIEW_MODEL_ROWS = [
  'CRETA', 'VENUE', 'GRAND I10 NIOS', 'I20', 'EXTER', 'VERNA', 'ALCAZAR',
  'CRETA ELECTRIC', 'CRETA N LINE', 'I20 N LINE', 'VENUE N LINE', 'AURA', 'TUCSON', 'Other',
] as const

export function canonicalHyundaiModel(model: unknown): string {
  const text = String(model ?? '').trim().toUpperCase()
  if (!text) return 'Other'
  for (const alias of MODEL_ALIASES) if (alias.match.test(text)) return alias.canonical
  return 'Other'
}

export type HyundaiRetailMonthRow = {
  /** 1-12 */
  month: number
  current: number
  previous: number
  /** current - previous. Positive means we are ahead of last year. */
  gap: number
}

export type HyundaiRetailSeries = {
  label: string
  months: HyundaiRetailMonthRow[]
  currentTotal: number
  previousTotal: number
  currentMonthlyAverage: number
  previousMonthlyAverage: number
  baseline: RetailBaseline
}

export type HyundaiModelMonthRow = {
  model: string
  months: number[]
  total: number
  monthlyAverage: number
}

export type HyundaiRetailReview = {
  currentYear: number
  previousYear: number
  series: HyundaiRetailSeries[]
  models: HyundaiModelMonthRow[]
  modelTotals: { months: number[]; total: number; monthlyAverage: number }
  notes: string[]
}

const toInt = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const rowsOf = (result: unknown) =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>

export async function getHyundaiRetailReview(options: {
  currentYear?: number | null
  previousYear?: number | null
} = {}): Promise<HyundaiRetailReview> {
  const now = new Date()
  const currentYear = Number(options.currentYear) || now.getUTCFullYear()
  const previousYear = Number(options.previousYear) || currentYear - 1

  return getCachedData(
    `hyundai:retail-review:v1:${currentYear}:${previousYear}`,
    async () => {
      const notes: string[] = []

      /*
       * One row per VEHICLE, not per feed row. The feed re-exports a car across uploads — 2,306 VINs
       * appear more than once — so the latest upload for each VIN wins.
       */
      const dedupe = sql`
        retail AS MATERIALIZED (
          SELECT
            EXTRACT(YEAR FROM d.retail_date)::int AS yr,
            EXTRACT(MONTH FROM d.retail_date)::int AS mo,
            d.model
          FROM (
            SELECT DISTINCT ON (UPPER(BTRIM(s.vin_number)))
              COALESCE(s.confirm_date, s.delivery_date) AS retail_date,
              UPPER(BTRIM(COALESCE(s.model, ''))) AS model
            FROM hyundai_sales_report s
            WHERE COALESCE(s.vin_number, '') <> ''
              AND (s.confirm_date IS NOT NULL OR s.delivery_date IS NOT NULL)
              AND EXTRACT(YEAR FROM COALESCE(s.confirm_date, s.delivery_date)) IN (${currentYear}, ${previousYear})
            ORDER BY UPPER(BTRIM(s.vin_number)), s.uploaded_at DESC NULLS LAST
          ) d
        )`

      const [monthRows, modelRows] = await Promise.all([
        analyticsDb.execute(sql`WITH ${dedupe}
          SELECT yr, mo, COUNT(*)::int AS units FROM retail GROUP BY yr, mo`),
        analyticsDb.execute(sql`WITH ${dedupe}
          SELECT mo, model, COUNT(*)::int AS units FROM retail WHERE yr = ${currentYear} GROUP BY mo, model`),
      ])

      const current = Array.from({ length: 12 }, () => 0)
      const previous = Array.from({ length: 12 }, () => 0)
      for (const row of rowsOf(monthRows)) {
        const year = toInt(row.yr)
        const monthIndex = toInt(row.mo) - 1
        if (monthIndex < 0 || monthIndex > 11) continue
        if (year === currentYear) current[monthIndex] = toInt(row.units)
        else if (year === previousYear) previous[monthIndex] = toInt(row.units)
      }

      const lastMonthWithData = current.reduce((last, units, index) => (units > 0 ? index + 1 : last), 0) || null
      // Complete calendar months only — August is not a data point until September starts.
      const completeMonths = currentYear === now.getUTCFullYear() ? now.getUTCMonth() : 12
      const baseline = buildRetailBaseline(current, previous, lastMonthWithData, completeMonths)

      const currentTotal = current.reduce((total, value) => total + value, 0)
      const previousTotal = previous.reduce((total, value) => total + value, 0)

      const series: HyundaiRetailSeries[] = [{
        label: 'All Outlets',
        months: current.map((units, index) => ({
          month: index + 1,
          current: units,
          previous: previous[index],
          gap: units - previous[index],
        })),
        currentTotal,
        previousTotal,
        currentMonthlyAverage: baseline.elapsedMonths > 0 ? currentTotal / baseline.elapsedMonths : 0,
        previousMonthlyAverage: previousTotal / 12,
        baseline,
      }]

      const buckets = new Map<string, number[]>()
      for (const model of HYUNDAI_REVIEW_MODEL_ROWS) buckets.set(model, Array.from({ length: 12 }, () => 0))
      for (const row of rowsOf(modelRows)) {
        const monthIndex = toInt(row.mo) - 1
        if (monthIndex < 0 || monthIndex > 11) continue
        const key = canonicalHyundaiModel(row.model)
        const bucket = buckets.get(key) ?? buckets.get('Other')!
        bucket[monthIndex] += toInt(row.units)
      }

      const models: HyundaiModelMonthRow[] = HYUNDAI_REVIEW_MODEL_ROWS.map((model) => {
        const months = buckets.get(model)!
        const total = months.reduce((sum, value) => sum + value, 0)
        return {
          model,
          months,
          total,
          monthlyAverage: baseline.elapsedMonths > 0 ? total / baseline.elapsedMonths : 0,
        }
      })

      const modelMonths = Array.from({ length: 12 }, (_unused, index) =>
        models.reduce((sum, row) => sum + row.months[index], 0))
      const modelTotal = modelMonths.reduce((sum, value) => sum + value, 0)

      // The model table must tie back to the headline, or one of them is wrong.
      if (modelTotal !== currentTotal) {
        notes.push(`Model rows total ${modelTotal} against ${currentTotal} retails overall — a model string is not being bucketed. Report this rather than trusting either figure.`)
      }
      notes.push('Retail counts a vehicle by its CONFIRM DATE, deduplicated by VIN.')
      notes.push('Group totals only: the Hyundai sales feed files 99% of deliveries under a single dealer code, so a per-outlet split would be meaningless.')

      return {
        currentYear,
        previousYear,
        series,
        models,
        modelTotals: {
          months: modelMonths,
          total: modelTotal,
          monthlyAverage: baseline.elapsedMonths > 0 ? modelTotal / baseline.elapsedMonths : 0,
        },
        notes,
      }
    },
    CACHE_TTL.SHORT,
  )
}
