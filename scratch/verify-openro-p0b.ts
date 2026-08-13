import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'
import { kiaOpenRoPromiseDateSql } from '../lib/kia/business-excellence-contract'

/**
 * The P0 as filed ("open-ro 500s") did NOT reproduce: Postgres infers day-first when the first
 * field is > 12. The real question is the AMBIGUOUS case (day <= 12), where MDY silently reads
 * 03/08/2026 as 8 March instead of 3 August — a wrong date, not an error.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const cmp = rows(await analyticsDb.execute(sql`
    SELECT
      COUNT(*) AS slash_rows,
      COUNT(*) FILTER (WHERE raw_cast::date <> helper::date) AS disagree,
      COUNT(*) FILTER (WHERE raw_cast::date <> helper::date AND status ILIKE 'open') AS disagree_open
    FROM (
      SELECT
        COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp AS raw_cast,
        ${kiaOpenRoPromiseDateSql()} AS helper,
        status
      FROM kia_open_ro_yearly
      WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^[0-9]{2}/'
    ) x`))
  console.log('slash-format rows compared:', JSON.stringify(cmp[0]))

  const samples = rows(await analyticsDb.execute(sql`
    SELECT src, raw_cast::date::text AS open_ro_reads, helper::date::text AS overview_reads, status
    FROM (
      SELECT
        COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) AS src,
        COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp AS raw_cast,
        ${kiaOpenRoPromiseDateSql()} AS helper,
        status
      FROM kia_open_ro_yearly
      WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^(0[1-9]|1[0-2])/'
    ) x
    WHERE raw_cast::date <> helper::date
    LIMIT 6`))
  console.log('\ndisagreements (same row, two endpoints):')
  for (const s of samples) console.log(`  feed "${s.src}"  → open-ro reads ${s.open_ro_reads} | overview reads ${s.overview_reads}  [${s.status}]`)

  // Does the misread flip the Delayed/On-Track verdict?
  const flip = rows(await analyticsDb.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE (CURRENT_DATE > raw_cast) <> (CURRENT_DATE > helper)) AS delay_verdict_flips
    FROM (
      SELECT
        COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp AS raw_cast,
        ${kiaOpenRoPromiseDateSql()} AS helper
      FROM kia_open_ro_yearly
      WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^[0-9]{2}/'
    ) x`))
  console.log('\nrows whose Delayed/On-Track verdict flips between the two readings:', flip[0]?.delay_verdict_flips)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
