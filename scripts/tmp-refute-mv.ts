import 'dotenv/config'
import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false })

async function main() {
  // 1. Column count claim: 47
  const cols = await sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='kia_stock_management'`
  console.log('kia_stock_management column count:', cols[0].n)

  // 2. How many APPROVED bookings, and what the dms CTE filter yields BEFORE the LIMIT 50
  const approved = await sql`
    SELECT b.id, b.model, b.variant, b.dealer_code
    FROM kia_bookings b JOIN kia_proformas p ON p.id = b.proforma_id
    WHERE b.deleted_at IS NULL AND upper(p.approval_status)='APPROVED'`
  console.log('APPROVED bookings with proforma:', approved.length)

  // 3. THE MECHANISM TEST: how many rows does the dms CTE produce (pre-LIMIT)?
  for (const b of approved) {
    const mp = `%${b.model}%`
    const vp = `%${b.variant}%`
    const n = await sql`
      SELECT count(*)::int AS n
      FROM kia_stock_management sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text,''))) IN ('free stock','in transit')
        AND coalesce(ls.local_status,'') NOT IN ('retail','hold_customer','hold_dealer')
        AND sm.model ILIKE ${mp}
        AND (coalesce(sm.variant,'')='' OR sm.variant ILIKE ${vp} OR ${String(b.variant)} ILIKE '%'||sm.variant||'%')`
    console.log(`  booking model=${JSON.stringify(b.model)} variant=${JSON.stringify(b.variant)} -> dms CTE rows (pre-LIMIT): ${n[0].n}`)
  }

  // 4. Average width of to_jsonb(sm) vs used columns
  const w = await sql`
    SELECT round(avg(pg_column_size(to_jsonb(sm))))::int AS snap_bytes,
           round(avg(pg_column_size(sm.vin_number)+pg_column_size(sm.order_dealer)+pg_column_size(sm.model)
                +pg_column_size(sm.variant)+pg_column_size(sm.exterior_color_name)+pg_column_size(sm.stock_status)))::int AS used_bytes,
           count(*)::int AS n
    FROM kia_stock_management sm`
  console.log('avg to_jsonb(sm) bytes:', w[0].snap_bytes, '| avg used-cols bytes:', w[0].used_bytes, '| rows:', w[0].n)
  await sql.end()
}
main()
