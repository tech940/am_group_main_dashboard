import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'
import { kiaOpenRoPromiseDateSql } from '../lib/kia/business-excellence-contract'

/**
 * Definitive P0 check. ⚠️ A COUNT(*) wrapper is NOT a valid test — Postgres prunes the unused
 * projection and the cast never executes, which produced a false "OK" on the first attempt.
 * These queries consume the cast result, exactly as the route does.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

const run = async (label: string, q: ReturnType<typeof sql>) => {
  try {
    const r = rows(await analyticsDb.execute(q))
    console.log(`  ✅ ${label} → OK (${r.length} rows)`)
    return r
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause
    console.log(`  ❌ ${label} → ${cause?.code ?? 'ERR'}: ${cause?.message ?? ''}`)
    return null
  }
}

async function main() {
  console.log('RAW CAST — the expression at open-ro/route.ts:71, result consumed:')
  await run('SELECT the cast value',
    sql`SELECT COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp AS promise_date
        FROM kia_open_ro_yearly LIMIT 200`)
  await run('ORDER BY the cast (delayed list)',
    sql`SELECT ro_no FROM kia_open_ro_yearly
        ORDER BY COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp DESC NULLS LAST LIMIT 20`)
  await run('delay_status CASE (route.ts:118-119)',
    sql`SELECT CASE WHEN COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,'')) IS NOT NULL
              AND CURRENT_DATE > COALESCE(NULLIF(revised_promise_date_time,''), NULLIF(promise_date_time,''))::timestamp
              THEN 'Delayed' ELSE 'On Track' END AS delay_status
        FROM kia_open_ro_yearly LIMIT 200`)

  console.log('\nCONTRACT HELPER — what /overview uses, same consumption:')
  await run('SELECT the helper value',
    sql`SELECT ${kiaOpenRoPromiseDateSql()} AS promise_date FROM kia_open_ro_yearly LIMIT 200`)
  const parsed = await run('delay_status via helper',
    sql`SELECT CASE WHEN CURRENT_DATE > ${kiaOpenRoPromiseDateSql()} THEN 'Delayed' ELSE 'On Track' END AS s
        FROM kia_open_ro_yearly LIMIT 200`)
  if (parsed) {
    const delayed = parsed.filter((r) => r.s === 'Delayed').length
    console.log(`     → helper resolves cleanly: ${delayed} delayed / ${parsed.length} rows`)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
