import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'
import {
  kiaOpenRoActiveStateSql,
  kiaOpenRoPromiseDateSql,
  kiaServiceCategoryExpression,
} from '../lib/kia/business-excellence-contract'

/**
 * Post-fix verification: rebuild open-ro's `enriched` CTE the way the route now emits it and
 * CONSUME every derived column (a COUNT(*) wrapper would let Postgres prune the projection and
 * report a false pass — that is exactly how the first check on this bug came back green).
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

const enriched = (endDate: string | null) => sql`
  WITH active AS (
    SELECT * FROM kia_open_ro_yearly WHERE ${kiaOpenRoActiveStateSql()}
  ),
  enriched AS (
    SELECT
      ro_date,
      service_adv,
      status,
      ${kiaOpenRoPromiseDateSql()} AS promise_date,
      CASE
        WHEN ro_date IS NULL THEN '0-4D'
        WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 4 THEN '0-4D'
        WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 7 THEN '5-7D'
        WHEN (COALESCE(${endDate}::date, CURRENT_DATE) - ro_date)::int <= 15 THEN '8-15D'
        ELSE '>15D'
      END AS aging_bucket,
      ${kiaServiceCategoryExpression('work_type')} AS service_category,
      CASE
        WHEN ${kiaOpenRoPromiseDateSql()} IS NOT NULL
          AND COALESCE(${endDate}::date, CURRENT_DATE) > ${kiaOpenRoPromiseDateSql()}
          THEN 'Delayed'
        ELSE 'On Track'
      END AS delay_status
    FROM active
  )
  SELECT aging_bucket, delay_status, service_category,
         COUNT(*)::int AS n,
         COUNT(promise_date)::int AS with_promise
  FROM enriched
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3`

async function main() {
  for (const [label, endDate] of [
    ['no date filter', null],
    ['default view (today)', '2026-08-13'],
    ['Aug 1-13 window', '2026-08-13'],
    ['Jul 1-31 window', '2026-07-31'],
  ] as const) {
    try {
      const r = rows(await analyticsDb.execute(enriched(endDate)))
      const total = r.reduce((s, x) => s + Number(x.n), 0)
      const delayed = r.filter((x) => x.delay_status === 'Delayed').reduce((s, x) => s + Number(x.n), 0)
      const withPromise = r.reduce((s, x) => s + Number(x.with_promise), 0)
      console.log(`  ✅ ${label.padEnd(22)} → ${total} open ROs, ${delayed} delayed, ${withPromise} promise dates parsed`)
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } })?.cause
      console.log(`  ❌ ${label.padEnd(22)} → ${cause?.code ?? 'ERR'}: ${cause?.message ?? (e as Error).message}`)
    }
  }

  // The buckets an executive actually reads
  const detail = rows(await analyticsDb.execute(enriched('2026-08-13')))
  console.log('\naging buckets (today):')
  const byBucket = new Map<string, number>()
  for (const r of detail) byBucket.set(String(r.aging_bucket), (byBucket.get(String(r.aging_bucket)) ?? 0) + Number(r.n))
  for (const [b, n] of [...byBucket.entries()].sort()) console.log(`  ${b.padEnd(6)} ${n}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
