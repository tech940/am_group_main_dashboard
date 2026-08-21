import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { buildRetailBaseline, type RetailBaseline } from '@/lib/retail-review/baseline'

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

export const PLATINUM_REVIEW_MODEL_ROWS = [
  'CRETA', 'VENUE', 'GRAND I10 NIOS', 'I20', 'EXTER', 'VERNA', 'ALCAZAR',
  'CRETA ELECTRIC', 'CRETA N LINE', 'I20 N LINE', 'VENUE N LINE', 'AURA', 'TUCSON', 'Other',
] as const

export function canonicalPlatinumModel(model: unknown): string {
  const text = String(model ?? '').trim().toUpperCase()
  if (!text) return 'Other'
  for (const alias of MODEL_ALIASES) if (alias.match.test(text)) return alias.canonical
  return 'Other'
}

export type PlatinumRetailMonthRow = {
  month: number
  current: number
  previous: number
  gap: number
}

export type PlatinumRetailSeries = {
  label: string
  months: PlatinumRetailMonthRow[]
  currentTotal: number
  previousTotal: number
  currentMonthlyAverage: number
  previousMonthlyAverage: number
  baseline: RetailBaseline
}

export type PlatinumModelMonthRow = {
  model: string
  months: number[]
  total: number
  monthlyAverage: number
}

export type PlatinumRetailReview = {
  currentYear: number
  previousYear: number
  series: PlatinumRetailSeries[]
  models: PlatinumModelMonthRow[]
  modelTotals: { months: number[]; total: number; monthlyAverage: number }
  notes: string[]
}

const toInt = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const rowsOf = (result: unknown) =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>

export async function getPlatinumRetailReview(options: {
  currentYear?: number | null
  previousYear?: number | null
} = {}): Promise<PlatinumRetailReview> {
  const now = new Date()
  const currentYear = Number(options.currentYear) || now.getUTCFullYear()
  const previousYear = Number(options.previousYear) || currentYear - 1

  return getCachedData(
    `platinum:retail-review:v1:${currentYear}:${previousYear}`,
    async () => {
      const notes: string[] = []

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
            FROM am_platinum_sales_report s
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
      const completeMonths = currentYear === now.getUTCFullYear() ? now.getUTCMonth() : 12
      const baseline = buildRetailBaseline(current, previous, lastMonthWithData, completeMonths)

      const currentTotal = current.reduce((total, value) => total + value, 0)
      const previousTotal = previous.reduce((total, value) => total + value, 0)

      const series: PlatinumRetailSeries[] = [{
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
      for (const model of PLATINUM_REVIEW_MODEL_ROWS) buckets.set(model, Array.from({ length: 12 }, () => 0))
      for (const row of rowsOf(modelRows)) {
        const monthIndex = toInt(row.mo) - 1
        if (monthIndex < 0 || monthIndex > 11) continue
        const key = canonicalPlatinumModel(row.model)
        const bucket = buckets.get(key) ?? buckets.get('Other')!
        bucket[monthIndex] += toInt(row.units)
      }

      const models: PlatinumModelMonthRow[] = PLATINUM_REVIEW_MODEL_ROWS.map((model) => {
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

      if (modelTotal !== currentTotal) {
        notes.push(`Model rows total ${modelTotal} against ${currentTotal} retails overall — a model string is not being bucketed.`)
      }
      notes.push('Retail counts a vehicle by its CONFIRM DATE, deduplicated by VIN.')
      notes.push('Group totals: based on am_platinum_sales_report data feed.')

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
