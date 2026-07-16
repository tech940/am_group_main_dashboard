import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })
function med(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

async function bench(label: string, fn: () => Promise<unknown>, n = 7) {
  await fn()
  const ts: number[] = []
  let rc = 0
  for (let i = 0; i < n; i++) {
    const t = performance.now(); const r = await fn() as unknown[]; ts.push(performance.now() - t); rc = Array.isArray(r) ? r.length : 0
  }
  console.log(`${label.padEnd(50)} med=${med(ts).toFixed(1)}ms min=${Math.min(...ts).toFixed(1)} rows=${rc}`)
  return med(ts)
}

// The REAL query, verbatim from bookings.ts:1328-1407, parameterised the same way.
function realQuery(model: string, variant: string, dealer: string, withSnapshot: boolean) {
  const modelPattern = `%${model}%`
  const variantPattern = `%${variant}%`
  const snap = withSnapshot ? sql`, to_jsonb(sm) AS snapshot` : sql``
  const bsnap = withSnapshot ? sql`, ls.vehicle_snapshot AS snapshot` : sql``
  const outer = withSnapshot ? sql`*` : sql`vin_number, dealer_code, model, variant, color, stock_status, source`
  return sql`
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations
      WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.engine_no, sm.stock_status, sm.stock_location,
        sm.uploaded_at ${snap}, 'dms'::text AS source
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        AND sm.model ILIKE ${modelPattern}
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${variantPattern} OR ${variant} ILIKE '%' || sm.variant || '%')
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT ls.vin_number, ls.dealer_code, ls.model, ls.variant, ls.color, ls.engine_no,
        coalesce(ls.stock_status_at_mark,'BBND') AS stock_status, ls.stock_location,
        ls.source_uploaded_at AS uploaded_at ${bsnap}, 'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.local_status = 'bbnd'
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = ls.vin_number)
        AND NOT EXISTS (SELECT 1 FROM dms d WHERE d.vin_number = ls.vin_number)
        AND ls.model ILIKE ${modelPattern}
        AND (coalesce(ls.variant,'')='' OR ls.variant ILIKE ${variantPattern} OR ${variant} ILIKE '%' || ls.variant || '%')
    )
    SELECT ${outer} FROM (SELECT * FROM dms UNION ALL SELECT * FROM bbnd) vehicles
    WHERE NOT EXISTS (
      SELECT 1 FROM kia_vehicle_transfers vt
      WHERE vt.vin_number = vehicles.vin_number
        AND LOWER(coalesce(vt.transfer_status,'')) IN ('transferred','requested')
        AND coalesce(vt.to_dealer_code,'') <> ${dealer}
    )
    ORDER BY CASE WHEN variant ILIKE ${variantPattern} THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
    LIMIT 50`
}

async function main() {
  await bench('RTT: SELECT 1', () => sql`SELECT 1`, 10)

  // The ONE booking that actually returns rows today (13 rows)
  const b = (await sql`
    SELECT b.id, b.model, b.variant, b.dealer_code FROM kia_bookings b
    JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status)='APPROVED' AND b.model = 'SELTOS' LIMIT 1`)[0]
  console.log(`\nReal booking: model=${b.model} variant=${b.variant} dealer=${b.dealer_code}`)

  console.log('\n--- REAL 13-row case (the only APPROVED booking that returns rows today) ---')
  const w = await bench('real query WITH to_jsonb', () => realQuery(String(b.model), String(b.variant), String(b.dealer_code), true))
  const wo = await bench('real query WITHOUT to_jsonb', () => realQuery(String(b.model), String(b.variant), String(b.dealer_code), false))
  console.log(`delta at real row count = ${(w - wo).toFixed(1)} ms`)

  // ---- Does the dms CTE materialise (to_jsonb computed for ALL matching rows, pre-LIMIT)?
  const plan = await sql.unsafe(`
    EXPLAIN (ANALYZE, BUFFERS)
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations WHERE released_at IS NULL
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number) sm.vin_number, sm.model, sm.variant, sm.uploaded_at,
        to_jsonb(sm) AS snapshot, 'dms'::text AS source
      FROM kia_stock_management sm
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT ls.vin_number, ls.model, ls.variant, ls.source_uploaded_at AS uploaded_at,
        ls.vehicle_snapshot AS snapshot, 'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.local_status='bbnd' AND NOT EXISTS (SELECT 1 FROM dms d WHERE d.vin_number = ls.vin_number)
    )
    SELECT * FROM (SELECT * FROM dms UNION ALL SELECT * FROM bbnd) vehicles
    ORDER BY uploaded_at DESC NULLS LAST LIMIT 50`)
  console.log('\n--- PLAN of the real shape (does dms materialise?) ---')
  for (const r of plan) console.log(String((r as Record<string, unknown>)['QUERY PLAN']))

  // ---- to_jsonb cost over the whole matching set, no LIMIT (the true SCALE mechanism)
  const t1 = await sql.unsafe(`EXPLAIN (ANALYZE) SELECT to_jsonb(sm) FROM kia_stock_management sm`)
  const t2 = await sql.unsafe(`EXPLAIN (ANALYZE) SELECT sm.vin_number, sm.model FROM kia_stock_management sm`)
  console.log('\nto_jsonb over all 94 rows :', t1.map((r: Record<string, unknown>) => r['QUERY PLAN']).filter((l) => String(l).includes('Execution')).join(''))
  console.log('2 cols over all 94 rows   :', t2.map((r: Record<string, unknown>) => r['QUERY PLAN']).filter((l) => String(l).includes('Execution')).join(''))

  await sql.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
