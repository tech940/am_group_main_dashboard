import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'
const rows = (r: unknown) => (Array.isArray(r) ? r : ((r as any)?.rows ?? [])) as any[]
async function main() {
  const tabs = rows(await db.execute(sql`
    SELECT c.relname t, c.reltuples::bigint n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='public' AND c.relkind='r' AND c.relname LIKE 'petty%' ORDER BY 1`))
  console.log(`RESULT petty cash tables: ${tabs.map((x) => `${x.t}(~${x.n})`).join('  ')}`)

  for (const t of tabs.map((x) => String(x.t))) {
    const cols = rows(await db.execute(sql`
      SELECT column_name c FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${t} AND column_name IN ('branch_id','brand','location')`))
    if (!cols.length) { console.log(`RESULT ${t}: no branch column`); continue }
    const col = String(cols[0].c)
    const d = rows(await db.execute(sql`
      SELECT COALESCE(NULLIF(BTRIM(${sql.raw(col)}::text),''),'(blank)') v, COUNT(*)::int n
      FROM ${sql.raw(t)} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`))
    console.log(`RESULT ${t.padEnd(28)} by ${col}: ${d.map((x) => `${x.v}=${x.n}`).join('  ') || '(empty)'}`)
  }
  process.exit(0)
}
main().catch((e) => { console.error('FAIL', e?.message || e); process.exit(1) })
