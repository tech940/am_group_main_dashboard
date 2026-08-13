import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'
import { kiaOpenRoPromiseDateSql } from '../lib/kia/business-excellence-contract'

/** Independent verification of the audit's P0: does open-ro's raw ::timestamp cast actually throw? */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  console.log('session DateStyle:', JSON.stringify(rows(await analyticsDb.execute(sql`SHOW DateStyle`))[0]))

  const shapes = rows(await analyticsDb.execute(sql`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^[0-9]{4}-') AS iso_shape,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^[0-9]{2}/') AS slash_shape,
      COUNT(*) FILTER (WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^(1[3-9]|2[0-9]|3[01])/') AS day_over_12
    FROM kia_open_ro_yearly`))
  console.log('promise-date shapes:', JSON.stringify(shapes[0]))

  // 1. The route's own expression, verbatim (open-ro/route.ts:71)
  try {
    const r = rows(await analyticsDb.execute(sql`
      SELECT COUNT(*) AS n FROM (
        SELECT COALESCE(NULLIF(revised_promise_date_time, ''), NULLIF(promise_date_time, ''))::timestamp AS promise_date
        FROM kia_open_ro_yearly
      ) x`))
    console.log(`RAW CAST (route.ts:71)      : OK — ${r[0]?.n} rows  → P0 NOT reproduced`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause
    console.log(`RAW CAST (route.ts:71)      : THROWS ${cause?.code ?? ''} ${cause?.message ?? msg.slice(0, 90)}  → P0 CONFIRMED`)
  }

  // 2. The contract helper the overview route uses instead
  try {
    const r = rows(await analyticsDb.execute(sql`
      SELECT COUNT(*) AS n, COUNT(promise_date) AS parsed FROM (
        SELECT ${kiaOpenRoPromiseDateSql()} AS promise_date FROM kia_open_ro_yearly
      ) x`))
    console.log(`CONTRACT HELPER (overview)  : OK — ${r[0]?.n} rows, ${r[0]?.parsed} promise dates parsed`)
  } catch (e) {
    console.log(`CONTRACT HELPER (overview)  : THROWS — ${e instanceof Error ? e.message.slice(0, 90) : e}`)
  }

  // 3. Does it throw on the DEFAULT view (first-of-month → today)?
  try {
    await analyticsDb.execute(sql`
      SELECT COUNT(*) FROM (
        SELECT COALESCE(NULLIF(revised_promise_date_time, ''), NULLIF(promise_date_time, ''))::timestamp AS promise_date, ro_date
        FROM kia_open_ro_yearly
      ) x WHERE ro_date BETWEEN '2026-08-01' AND '2026-08-13'`)
    console.log('DEFAULT WINDOW (1 Aug→today): OK')
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause
    console.log(`DEFAULT WINDOW (1 Aug→today): THROWS ${cause?.code ?? ''} → the tab users land on is dead`)
  }

  // 4. Sample the offending values
  const bad = rows(await analyticsDb.execute(sql`
    SELECT COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) AS v, status
    FROM kia_open_ro_yearly
    WHERE COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) ~ '^(1[3-9]|2[0-9]|3[01])/'
    LIMIT 4`))
  console.log('offending values:', bad.map((b) => `${b.v} (${b.status})`).join(' | ') || '(none)')
}

main().then(() => process.exit(0)).catch((e) => { console.error('probe failed:', e); process.exit(1) })
