import 'server-only'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { CROSS_CHECKS, DATA_FEEDS, type CrossCheck, type FeedDefinition } from '@/lib/data-health/feeds'

/**
 * Computes the health of every external feed.
 *
 * Deliberately READ-ONLY and deliberately cheap: one aggregate per feed, each hitting only indexed
 * date columns or a single grouped scan. It must never become the thing that makes the dashboard
 * slow, because nobody keeps a monitoring page that costs more than the problem it reports.
 *
 * Every query is wrapped so ONE broken feed reports as `error` instead of failing the whole page —
 * a monitoring screen that goes blank when something is wrong is worse than none.
 */

export type FeedHealth = {
  id: string
  label: string
  brand: FeedDefinition['brand']
  table: string
  status: 'ok' | 'stale' | 'duplicates' | 'empty' | 'error'
  /** Most recent BUSINESS date present. */
  latestDate: string | null
  /** Days between the latest business date and today. */
  daysBehind: number | null
  /** When rows physically last landed. */
  lastLoadedAt: string | null
  totalRows: number
  rowsLast7Days: number
  /** Rows beyond the first for a repeated natural key — i.e. how many are surplus. */
  duplicateRows: number | null
  duplicateKeys: number | null
  staleAfterDays: number
  impact: string
  error: string | null
}

export type CrossCheckResult = {
  id: string
  label: string
  brand: CrossCheck['brand']
  description: string
  /** Records present in both feeds whose classification DISAGREES. */
  mismatches: number
  compared: number
  status: 'ok' | 'mismatch' | 'error'
  error: string | null
}

export type DataHealthReport = {
  generatedAt: string
  feeds: FeedHealth[]
  crossChecks: CrossCheckResult[]
  summary: { ok: number; stale: number; duplicates: number; empty: number; error: number; mismatches: number }
}

function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

function num(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Postgres DATE/TIMESTAMP columns come back as JS Date objects through this driver — a raw
 *  String() on one yields "Thu Jul 30", a weekday with no year. Always normalise. */
function iso(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null
}

function daysBetween(fromIso: string, toIso: string) {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)))
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

async function readFeed(feed: FeedDefinition, todayIso: string): Promise<FeedHealth> {
  const base: FeedHealth = {
    id: feed.id, label: feed.label, brand: feed.brand, table: feed.table,
    status: 'ok', latestDate: null, daysBehind: null, lastLoadedAt: null,
    totalRows: 0, rowsLast7Days: 0, duplicateRows: null, duplicateKeys: null,
    staleAfterDays: feed.staleAfterDays, impact: feed.impact, error: null,
  }

  try {
    const loadedExpr = feed.loadedColumn
      ? sql`MAX(${sql.raw(feed.loadedColumn)})::text`
      : sql`NULL::text`

    // ⚠️ EVERYTHING here is bounded or approximate ON PURPOSE. The first version ran COUNT(*) and an
    // unbounded GROUP BY over each feed's whole history; across 18 multi-year tables that did not
    // finish in seven minutes. A monitoring page that is expensive to load is a monitoring page
    // nobody opens.
    //   - total rows come from the planner's estimate (pg_class.reltuples): instant, and "roughly
    //     how big is this feed" never needed to be exact.
    //   - freshness and the 7-day delta hit the indexed date column only.
    const [head] = rows(await db.execute(sql`
      SELECT
        MAX(${sql.raw(feed.dateColumn)})::text AS latest_date,
        ${loadedExpr} AS last_loaded,
        COUNT(*) FILTER (
          WHERE ${sql.raw(feed.dateColumn)} >= (${todayIso}::date - INTERVAL '7 days')
        )::int AS rows_last_7
      FROM ${sql.raw(feed.table)}
      WHERE ${sql.raw(feed.dateColumn)} >= (${todayIso}::date - INTERVAL '400 days')
    `))

    // ⚠️ reltuples is -1 for a VIEW and for any table never ANALYZEd — three KIA feeds are views, so
    // treating the estimate as a row count reported them as EMPTY when they hold live data. The
    // estimate is for DISPLAY only; emptiness is decided by an actual probe below.
    const [est] = rows(await db.execute(sql`
      SELECT c.reltuples::bigint::int AS total_rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${feed.table}
    `))
    const estimate = num(est?.total_rows)
    base.totalRows = estimate > 0 ? estimate : 0

    // Emptiness is derived from the BOUNDED head query above — no extra round-trip, and crucially no
    // unbounded scan. An `EXISTS (SELECT 1 FROM t LIMIT 1)` looks cheap but hangs on the three KIA
    // feeds, which are VIEWS whose definitions materialise in full before LIMIT applies.
    // "No business date in 400 days" is the right test anyway: a feed that quiet is dead regardless
    // of what sits in its archive.
    const hasRows = Boolean(head?.latest_date)
    base.latestDate = iso(head?.latest_date)
    base.lastLoadedAt = head?.last_loaded ? String(head.last_loaded).slice(0, 19) : null
    base.rowsLast7Days = num(head?.rows_last_7)

    if (!hasRows) {
      base.status = 'empty'
      return base
    }

    if (base.latestDate) base.daysBehind = daysBetween(base.latestDate, todayIso)

    if (feed.duplicateKey) {
      // Bounded to the last 90 days: the question is "is the feed duplicating RIGHT NOW", not a
      // historical census. Unbounded, this grouped scan was the single slowest query on the page.
      const [dupes] = rows(await db.execute(sql`
        SELECT
          COUNT(*)::int AS keys,
          COALESCE(SUM(n) - COUNT(*), 0)::int AS surplus
        FROM (
          SELECT ${sql.raw(feed.duplicateKey)} AS k, COUNT(*)::int AS n
          FROM ${sql.raw(feed.table)}
          WHERE NULLIF(TRIM(${sql.raw(feed.duplicateKey)}::text), '') IS NOT NULL
            AND ${sql.raw(feed.dateColumn)} >= (${todayIso}::date - INTERVAL '90 days')
          GROUP BY 1
          HAVING COUNT(*) > 1
        ) x
      `))
      base.duplicateKeys = num(dupes?.keys)
      base.duplicateRows = num(dupes?.surplus)
    }

    // Duplicates outrank staleness: a stale feed under-reports, but a duplicated one reports
    // numbers that are confidently WRONG, which is the more dangerous of the two.
    if ((base.duplicateRows ?? 0) > 0) base.status = 'duplicates'
    else if (base.daysBehind !== null && base.daysBehind > feed.staleAfterDays) base.status = 'stale'
    else base.status = 'ok'

    return base
  } catch (error) {
    base.status = 'error'
    base.error = error instanceof Error ? error.message : String(error)
    return base
  }
}

async function readCrossCheck(check: CrossCheck, todayIso: string): Promise<CrossCheckResult> {
  const base: CrossCheckResult = {
    id: check.id, label: check.label, brand: check.brand, description: check.description,
    mismatches: 0, compared: 0, status: 'ok', error: null,
  }
  try {
    // Bounded to the last 90 days — the point is to catch drift as it happens, not to re-litigate
    // history, and an unbounded join across two multi-year tables is exactly the kind of query that
    // gets a monitoring page switched off.
    const [row] = rows(await db.execute(sql`
      WITH l AS (
        SELECT DISTINCT NULLIF(TRIM(${sql.raw(check.leftKey)}::text), '') AS k,
               TRIM(COALESCE(${sql.raw(check.leftField)}::text, '')) AS v
        FROM ${sql.raw(check.leftTable)}
        WHERE ${sql.raw(check.leftDateColumn)} >= (${todayIso}::date - INTERVAL '90 days')
          AND NULLIF(TRIM(${sql.raw(check.leftKey)}::text), '') IS NOT NULL
      ),
      r AS (
        SELECT DISTINCT NULLIF(TRIM(${sql.raw(check.rightKey)}::text), '') AS k,
               TRIM(COALESCE(${sql.raw(check.rightField)}::text, '')) AS v
        FROM ${sql.raw(check.rightTable)}
        WHERE NULLIF(TRIM(${sql.raw(check.rightKey)}::text), '') IS NOT NULL
          AND ${sql.raw(check.rightDateColumn)} >= (${todayIso}::date - INTERVAL '120 days')
      )
      SELECT
        COUNT(*)::int AS compared,
        COUNT(*) FILTER (WHERE l.v <> r.v AND l.v <> '' AND r.v <> '')::int AS mismatches
      FROM l JOIN r ON r.k = l.k
    `))
    base.compared = num(row?.compared)
    base.mismatches = num(row?.mismatches)
    base.status = base.mismatches > 0 ? 'mismatch' : 'ok'
    return base
  } catch (error) {
    base.status = 'error'
    base.error = error instanceof Error ? error.message : String(error)
    return base
  }
}

export async function getDataHealthReport(todayIso: string): Promise<DataHealthReport> {
  const [feeds, crossChecks] = await Promise.all([
    Promise.all(DATA_FEEDS.map((feed) => readFeed(feed, todayIso))),
    Promise.all(CROSS_CHECKS.map((check) => readCrossCheck(check, todayIso))),
  ])

  return {
    generatedAt: new Date().toISOString(),
    feeds,
    crossChecks,
    summary: {
      ok: feeds.filter((f) => f.status === 'ok').length,
      stale: feeds.filter((f) => f.status === 'stale').length,
      duplicates: feeds.filter((f) => f.status === 'duplicates').length,
      empty: feeds.filter((f) => f.status === 'empty').length,
      error: feeds.filter((f) => f.status === 'error').length,
      mismatches: crossChecks.filter((c) => c.status === 'mismatch').length,
    },
  }
}
