import 'dotenv/config'
import postgres from 'postgres'

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// The REAL shipped query for the one booking that returns rows (SELTOS / Seltos G1.5 6MT HTE),
// with to_jsonb toggled. Everything else identical to lib/kia/bookings.ts:1328-1407.
function realQuery(sql: postgres.Sql, model: string, variant: string, dealer: string, withJsonb: boolean) {
  const snap = withJsonb ? `to_jsonb(sm) AS snapshot,` : ``
  const bsnap = withJsonb ? `ls.vehicle_snapshot AS snapshot,` : ``
  const outer = withJsonb ? `SELECT *` : `SELECT vin_number, dealer_code, model, variant, color, stock_status, source`
  return sql.unsafe(`
    WITH active_allocations AS (
      SELECT vin_number FROM kia_vehicle_allocations
      WHERE released_at IS NULL AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number, sm.order_dealer AS dealer_code, sm.model, sm.variant,
        sm.exterior_color_name AS color, sm.engine_no, sm.stock_status,
        sm.stock_location, sm.uploaded_at, ${snap} 'dms'::text AS source
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text, ''))) IN ('free stock', 'in transit')
        AND coalesce(ls.local_status, '') NOT IN ('retail', 'hold_customer', 'hold_dealer')
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        AND sm.model ILIKE $1
        AND (coalesce(sm.variant, '') = '' OR sm.variant ILIKE $2 OR $3 ILIKE '%' || sm.variant || '%')
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT ls.vin_number, ls.dealer_code, ls.model, ls.variant, ls.color, ls.engine_no,
        coalesce(ls.stock_status_at_mark, 'BBND') AS stock_status, ls.stock_location,
        ls.source_uploaded_at AS uploaded_at, ${bsnap} 'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.local_status = 'bbnd'
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = ls.vin_number)
        AND NOT EXISTS (SELECT 1 FROM dms d WHERE d.vin_number = ls.vin_number)
        AND ls.model ILIKE $1
        AND (coalesce(ls.variant, '') = '' OR ls.variant ILIKE $2 OR $3 ILIKE '%' || ls.variant || '%')
    )
    ${outer}
    FROM (SELECT * FROM dms UNION ALL SELECT * FROM bbnd) vehicles
    WHERE NOT EXISTS (
      SELECT 1 FROM kia_vehicle_transfers vt
      WHERE vt.vin_number = vehicles.vin_number
        AND LOWER(coalesce(vt.transfer_status, '')) IN ('transferred', 'requested')
        AND coalesce(vt.to_dealer_code, '') <> $4
    )
    ORDER BY CASE WHEN variant ILIKE $2 THEN 0 ELSE 1 END, uploaded_at DESC NULLS LAST
    LIMIT 50
  `, [`%${model}%`, `%${variant}%`, variant, dealer])
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  const [b] = await sql`
    SELECT b.model, b.variant, b.dealer_code FROM kia_bookings b
    JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status) = 'APPROVED' AND b.model = 'SELTOS' LIMIT 1`
  console.log('real booking:', b.model, '/', b.variant)

  // --- WARM connection, real 13-row result ---
  const rw: number[] = [], rn: number[] = []
  for (let i = 0; i < 3; i++) { await realQuery(sql, b.model, b.variant, b.dealer_code, true); await realQuery(sql, b.model, b.variant, b.dealer_code, false) }
  for (let i = 0; i < 9; i++) {
    let s = performance.now(); const r1 = await realQuery(sql, b.model, b.variant, b.dealer_code, true); rw.push(performance.now() - s)
    s = performance.now(); const r2 = await realQuery(sql, b.model, b.variant, b.dealer_code, false); rn.push(performance.now() - s)
    if (i === 0) console.log(`rows: WITH=${r1.length} WITHOUT=${r2.length}  (identical row count: ${r1.length === r2.length})`)
  }
  console.log(`WARM real query  WITH to_jsonb   med=${median(rw).toFixed(1)}ms  min=${Math.min(...rw).toFixed(1)}`)
  console.log(`WARM real query  WITHOUT         med=${median(rn).toFixed(1)}ms  min=${Math.min(...rn).toFixed(1)}`)
  console.log(`WARM delta = ${(median(rw) - median(rn)).toFixed(1)} ms\n`)
  await sql.end()

  // --- COLD connection: brand-new pool per sample, query is the FIRST thing on the wire ---
  // This is the finding's own steel-man: does slow-start make 17kB cost an extra RTT?
  const coldW: number[] = [], coldN: number[] = []
  for (let i = 0; i < 6; i++) {
    for (const withJ of [true, false]) {
      const s2 = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
      await s2`SELECT 1` // connect + auth, exclude handshake from the timing
      const t = performance.now()
      await realQuery(s2, b.model, b.variant, b.dealer_code, withJ)
      const el = performance.now() - t
      ;(withJ ? coldW : coldN).push(el)
      await s2.end()
    }
  }
  console.log(`COLD conn  WITH to_jsonb   med=${median(coldW).toFixed(1)}ms  samples=[${coldW.map((x) => x.toFixed(0)).join(',')}]`)
  console.log(`COLD conn  WITHOUT        med=${median(coldN).toFixed(1)}ms  samples=[${coldN.map((x) => x.toFixed(0)).join(',')}]`)
  console.log(`COLD delta = ${(median(coldW) - median(coldN)).toFixed(1)} ms`)

  // --- payload actually on the wire for the REAL 13-row result ---
  const s3 = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })
  const sz = await s3`
    SELECT count(*)::int AS n,
           sum(pg_column_size(to_jsonb(sm)))::int AS snapshot_bytes
    FROM kia_stock_management sm
    WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
      AND sm.model ILIKE ${'%' + b.model + '%'}`
  console.log(`\nreal-case snapshot payload: ${sz[0].n} rows -> ${sz[0].snapshot_bytes} B of to_jsonb`)
  await s3.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
