import 'dotenv/config'
import { sql } from 'drizzle-orm'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const t0 = Date.now()
  const { db } = await import('../lib/db')
  const ping = await db.execute(sql`SELECT 1 AS ok`)
  console.log(`app db ping: ok in ${Date.now() - t0}ms`, rows(ping).length === 1 ? '' : '(unexpected shape)')

  const conns = rows(await db.execute(sql`
    SELECT state, COUNT(*) AS n
    FROM pg_stat_activity
    WHERE datname = current_database()
    GROUP BY 1 ORDER BY 2 DESC`))
  console.log('connections by state:', conns.map((r) => `${r.state ?? '(none)'}=${r.n}`).join(' '))

  const limits = rows(await db.execute(sql`
    SELECT setting::int AS max_conn FROM pg_settings WHERE name = 'max_connections'`))
  const total = rows(await db.execute(sql`SELECT COUNT(*) AS n FROM pg_stat_activity`))
  console.log(`total backends: ${total[0]?.n} / max_connections ${limits[0]?.max_conn}`)

  const waits = rows(await db.execute(sql`
    SELECT wait_event_type, wait_event, COUNT(*) AS n
    FROM pg_stat_activity
    WHERE state <> 'idle' AND pid <> pg_backend_pid()
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`))
  console.log('active waits:', JSON.stringify(waits))

  const locks = rows(await db.execute(sql`
    SELECT COUNT(*) AS blocked FROM pg_stat_activity WHERE wait_event_type = 'Lock'`))
  console.log('backends blocked on locks:', locks[0]?.blocked)

  const t1 = Date.now()
  const { analyticsDb } = await import('../lib/analytics/db')
  await analyticsDb.execute(sql`SELECT 1`)
  console.log(`analytics db ping: ok in ${Date.now() - t1}ms`)

  const t2 = Date.now()
  const { getCreSupabase } = await import('../lib/cre-calls/cre-supabase')
  const { error } = await getCreSupabase().from('call_log_entries').select('id', { count: 'exact', head: true }).limit(1)
  console.log(`cre supabase ping: ${error ? 'ERROR ' + error.message : 'ok'} in ${Date.now() - t2}ms`)

  // A read that many sections depend on
  const t3 = Date.now()
  const users = rows(await db.execute(sql`SELECT COUNT(*) AS n FROM app_users`))
  console.log(`app_users count: ${users[0]?.n} in ${Date.now() - t3}ms`)
}

main().then(() => process.exit(0)).catch((e) => { console.error('HEALTH CHECK FAILED:', e); process.exit(1) })
