import 'dotenv/config'
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } })

function med(xs: number[]) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

async function bench(label: string, fn: () => Promise<unknown>, n = 7) {
  await fn() // warm
  const ts: number[] = []
  let rowsOut = 0
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    const r = await fn() as unknown[]
    ts.push(performance.now() - t)
    rowsOut = Array.isArray(r) ? r.length : 0
  }
  const m = med(ts)
  console.log(`${label.padEnd(52)} med=${m.toFixed(1)}ms min=${Math.min(...ts).toFixed(1)} max=${Math.max(...ts).toFixed(1)} rows=${rowsOut}`)
  return m
}

async function main() {
  // ---- baseline RTT
  await bench('RTT: SELECT 1 (no params)', () => sql`SELECT 1`, 10)

  // ---- column count + snapshot size
  const cols = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='kia_stock_management'`
  console.log('kia_stock_management column count:', cols[0].n)

  const sz = await sql`
    SELECT
      count(*)::int AS rows,
      avg(octet_length(to_jsonb(sm)::text))::int AS avg_snapshot_bytes,
      sum(octet_length(to_jsonb(sm)::text))::int AS total_snapshot_bytes,
      avg(octet_length(coalesce(sm.vin_number,'') || coalesce(sm.order_dealer,'') || coalesce(sm.model,'')
          || coalesce(sm.variant,'') || coalesce(sm.exterior_color_name,'') || coalesce(sm.stock_status::text,'')))::int AS avg_used_bytes
    FROM kia_stock_management sm`
  console.log('stock size:', sz[0])

  // ---- APPROVED bookings + how many rows each match query returns
  const approved = await sql`
    SELECT b.id, b.model, b.variant, b.dealer_code
    FROM kia_bookings b
    JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status) = 'APPROVED'`
  console.log(`\nAPPROVED bookings: ${approved.length}`)

  for (const b of approved) {
    const modelPattern = `%${b.model}%`
    const variantPattern = `%${b.variant}%`
    // single-sided model ILIKE, exactly as shipped (bookings.ts:1354)
    const shipped = await sql`
      SELECT count(*)::int AS n FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND sm.model ILIKE ${modelPattern}
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${variantPattern} OR ${String(b.variant ?? '')} ILIKE '%' || sm.variant || '%')`
    // double-sided model (what the fix would be)
    const dbl = await sql`
      SELECT count(*)::int AS n FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND (sm.model ILIKE ${modelPattern} OR ${String(b.model ?? '')} ILIKE '%' || sm.model || '%')
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${variantPattern} OR ${String(b.variant ?? '')} ILIKE '%' || sm.variant || '%')`
    console.log(`  model=${String(b.model).padEnd(18)} variant=${String(b.variant).slice(0, 22).padEnd(24)} shipped=${shipped[0].n} doubleSided=${dbl[0].n}`)
  }

  // ---- THE MEASUREMENT: full query WITH vs WITHOUT to_jsonb, forced to 50 rows
  // Use a permissive model pattern ('%') to get the max candidate set, LIMIT 50.
  const bigModel = '%'
  const bigVariant = '%'

  const withJson = () => sql`
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations
      WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.engine_no, sm.stock_status, sm.stock_location,
        sm.uploaded_at, to_jsonb(sm) AS snapshot, 'dms'::text AS source
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        AND sm.model ILIKE ${bigModel}
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${bigVariant} OR ${''} ILIKE '%' || sm.variant || '%')
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    )
    SELECT * FROM dms
    ORDER BY CASE WHEN variant ILIKE ${bigVariant} THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
    LIMIT 50`

  const withoutJson = () => sql`
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations
      WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.stock_status, sm.uploaded_at, 'dms'::text AS source
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        AND sm.model ILIKE ${bigModel}
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${bigVariant} OR ${''} ILIKE '%' || sm.variant || '%')
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    )
    SELECT vin_number, dealer_code, model, variant, color, stock_status, source FROM dms
    ORDER BY CASE WHEN variant ILIKE ${bigVariant} THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
    LIMIT 50`

  console.log('\n--- 50-row payload: WITH vs WITHOUT to_jsonb ---')
  const a = await bench('50 rows WITH to_jsonb(sm)', withJson)
  const b = await bench('50 rows WITHOUT to_jsonb (7 cols)', withoutJson)
  console.log(`delta = ${(a - b).toFixed(1)} ms`)

  // payload sizes
  const pw = await sql`SELECT sum(octet_length(t::text))::int AS b FROM (${withJson()}) t` .catch(() => null)
  console.log('payload WITH (bytes):', pw ? pw[0].b : 'n/a')

  // ---- server-side execution time only
  const ex1 = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT ON (sm.vin_number) sm.vin_number, to_jsonb(sm) AS snapshot FROM kia_stock_management sm ORDER BY sm.vin_number, sm.id DESC LIMIT 50`)
  const ex2 = await sql.unsafe(`EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT ON (sm.vin_number) sm.vin_number, sm.model, sm.variant FROM kia_stock_management sm ORDER BY sm.vin_number, sm.id DESC LIMIT 50`)
  console.log('\nEXPLAIN with to_jsonb :', ex1.map((r: Record<string, unknown>) => r['QUERY PLAN']).filter((l) => String(l).includes('Time')).join(' | '))
  console.log('EXPLAIN without      :', ex2.map((r: Record<string, unknown>) => r['QUERY PLAN']).filter((l) => String(l).includes('Time')).join(' | '))

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
