import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

async function bench(label: string, fn: () => Promise<unknown>, n = 7) {
  await fn(); await fn() // warm
  const t: number[] = []
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s) }
  console.log(`${label.padEnd(46)} med=${median(t).toFixed(1)}ms  min=${Math.min(...t).toFixed(1)}  max=${Math.max(...t).toFixed(1)}`)
  return median(t)
}

async function main() {
  // 0. RTT baseline
  const rtt = await bench('RTT  SELECT 1', () => sql`SELECT 1`)

  // 1. column count + widths
  const cols = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'kia_stock_management'`
  console.log('\nkia_stock_management columns =', cols[0].n)

  const w = await sql`
    SELECT count(*)::int AS rows,
           avg(pg_column_size(to_jsonb(sm)))::int AS avg_tojsonb_bytes,
           avg(pg_column_size(sm.vin_number) + pg_column_size(sm.order_dealer) + pg_column_size(sm.model)
             + pg_column_size(sm.variant) + pg_column_size(sm.exterior_color_name)
             + pg_column_size(sm.stock_status::text))::int AS avg_used_bytes
    FROM kia_stock_management sm`
  console.log('stock rows =', w[0].rows, ' avg to_jsonb =', w[0].avg_tojsonb_bytes, 'B  avg 6 used cols =', w[0].avg_used_bytes, 'B')

  // 2. Does the shipped query actually return rows today? Reproduce the gate + query per booking.
  const approved = await sql`
    SELECT b.id, b.model, b.variant, b.dealer_code
    FROM kia_bookings b JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status) = 'APPROVED'`
  console.log('\nAPPROVED bookings (the only ones that reach the query):', approved.length)

  for (const b of approved) {
    const r = await sql`
      WITH active_allocations AS (
        SELECT vin_number FROM kia_vehicle_allocations
        WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
      ), dms AS (
        SELECT DISTINCT ON (sm.vin_number) sm.vin_number
        FROM kia_stock_management sm
        LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
        WHERE lower(trim(coalesce(sm.stock_status::text, ''))) IN ('free stock', 'in transit')
          AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
          AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
          AND sm.model ILIKE ${'%' + b.model + '%'}
          AND (coalesce(sm.variant, '') = '' OR sm.variant ILIKE ${'%' + b.variant + '%'}
               OR ${String(b.variant ?? '')} ILIKE '%' || sm.variant || '%')
        ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
      ) SELECT count(*)::int AS n FROM dms`
    console.log(`  model=${String(b.model).padEnd(16)} variant=${String(b.variant).slice(0, 24).padEnd(26)} -> dms rows=${r[0].n}`)
  }

  // 3. The A/B that matters: force 50 rows, WITH vs WITHOUT to_jsonb.
  //    Use a model pattern that matches everything so the LIMIT 50 is actually reached.
  console.log('\n--- A/B at the full LIMIT 50 (pattern "%" to force 50 rows) ---')
  const withJ = () => sql`
    SELECT * FROM (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.engine_no, sm.stock_status,
        sm.stock_location, sm.uploaded_at, to_jsonb(sm) AS snapshot, 'dms'::text AS source
      FROM kia_stock_management sm
      WHERE sm.model ILIKE '%'
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ) v ORDER BY v.uploaded_at DESC NULLS LAST LIMIT 50`
  const noJ = () => sql`
    SELECT v.vin_number, v.dealer_code, v.model, v.variant, v.color, v.stock_status, v.source FROM (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.stock_status, sm.uploaded_at, 'dms'::text AS source
      FROM kia_stock_management sm
      WHERE sm.model ILIKE '%'
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ) v ORDER BY v.uploaded_at DESC NULLS LAST LIMIT 50`

  const a = await bench('50 rows WITH to_jsonb', withJ)
  const b = await bench('50 rows WITHOUT to_jsonb (7 cols)', noJ)
  console.log(`delta = ${(a - b).toFixed(1)} ms  (= ${((a - b) / rtt).toFixed(2)} RTT)`)

  // payload sizes
  const pw = await sql`SELECT sum(pg_column_size(x))::int AS b FROM (SELECT to_jsonb(sm) AS x FROM kia_stock_management sm LIMIT 50) q`
  console.log('50 x to_jsonb materialized bytes =', pw[0].b)

  // 4. server-side execution time, isolated from transport
  const ew = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM (SELECT DISTINCT ON (sm.vin_number) sm.vin_number, to_jsonb(sm) AS snapshot, sm.uploaded_at FROM kia_stock_management sm WHERE sm.model ILIKE '%' ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC) v ORDER BY v.uploaded_at DESC NULLS LAST LIMIT 50`)
  const en = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) SELECT v.vin_number FROM (SELECT DISTINCT ON (sm.vin_number) sm.vin_number, sm.uploaded_at FROM kia_stock_management sm WHERE sm.model ILIKE '%' ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC) v ORDER BY v.uploaded_at DESC NULLS LAST LIMIT 50`)
  console.log('\nEXPLAIN WITH to_jsonb :', ew.map((r: Record<string, string>) => r['QUERY PLAN']).filter((l) => /Execution Time|Planning Time/.test(l)).join(' | '))
  console.log('EXPLAIN WITHOUT      :', en.map((r: Record<string, string>) => r['QUERY PLAN']).filter((l) => /Execution Time|Planning Time/.test(l)).join(' | '))

  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
