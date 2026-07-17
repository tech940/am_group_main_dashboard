/* TEMP perf probe — READ ONLY. Measures the real byte weight of what the bookings
   endpoints deserialize per request, and the JS cost of parsing/re-serializing it. */
import postgres from 'postgres'
import { config } from 'dotenv'
config()

const url = process.env.DATABASE_URL!
const sql = postgres(url, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2 })

function bench(label: string, iters: number, fn: () => unknown) {
  for (let i = 0; i < Math.min(iters, 50); i++) fn()
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  const t1 = process.hrtime.bigint()
  const ms = Number(t1 - t0) / 1e6
  console.log('  ' + label.padEnd(46) + (ms / iters).toFixed(4) + ' ms/op')
  return ms / iters
}

async function main() {
  console.log('=== kia_bookings column weight ===')
  const cols = await sql`
    SELECT
      count(*)::int AS rows,
      pg_size_pretty(sum(pg_column_size(metadata))::bigint) AS metadata_total,
      max(pg_column_size(metadata))::int AS metadata_max,
      round(avg(pg_column_size(metadata)))::int AS metadata_avg,
      round(avg(pg_column_size(kia_bookings.*)))::int AS row_avg,
      max(pg_column_size(kia_bookings.*))::int AS row_max
    FROM kia_bookings WHERE deleted_at IS NULL`
  console.table(cols)

  console.log('=== metadata as TEXT: what postgres.js must JSON.parse per row ===')
  const t = await sql`
    SELECT id::text AS id,
           length(metadata::text) AS meta_chars,
           (SELECT count(*) FROM jsonb_object_keys(metadata)) AS meta_keys
    FROM kia_bookings WHERE deleted_at IS NULL
    ORDER BY length(metadata::text) DESC NULLS LAST LIMIT 8`
  console.table(t)

  const totals = await sql`
    SELECT sum(length(metadata::text))::int AS all_meta_chars,
           round(avg(length(metadata::text)))::int AS avg_meta_chars
    FROM kia_bookings WHERE deleted_at IS NULL`
  console.log('metadata text totals:', totals[0])

  // ---- simulate ONE page of the list: bare `db.select().from(kiaBookings)` LIMIT 15 ----
  console.log()
  console.log('=== simulate the LIST page: bare SELECT * LIMIT 15 (what line 677 does) ===')
  const page = await sql`SELECT * FROM kia_bookings WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 15`
  const pageJson = JSON.stringify(page)
  console.log('rows:', page.length, ' payload JSON bytes:', Buffer.byteLength(pageJson))
  const metaOnly = JSON.stringify(page.map((r: Record<string, unknown>) => r.metadata))
  console.log('  of which metadata JSON bytes:', Buffer.byteLength(metaOnly),
    '(' + ((Buffer.byteLength(metaOnly) / Buffer.byteLength(pageJson)) * 100).toFixed(1) + '% of payload)')

  const metaTexts = page.map((r: Record<string, unknown>) => JSON.stringify(r.metadata))
  bench('JSON.parse metadata x15 (driver deserialize)', 2000, () => metaTexts.map((s: string) => JSON.parse(s)))
  bench('JSON.stringify(full 15-row payload)', 2000, () => JSON.stringify(page))

  // ---- what the ACTIVITY table looks like (detail endpoint) ----
  console.log()
  console.log('=== kia_booking_activity JSONB weight (the [id] endpoint) ===')
  const act = await sql`
    SELECT count(*)::int AS rows,
      pg_size_pretty(sum(pg_column_size(before_value))::bigint) AS before_total,
      pg_size_pretty(sum(pg_column_size(after_value))::bigint) AS after_total,
      round(avg(length(coalesce(before_value::text,''))))::int AS avg_before_chars,
      round(avg(length(coalesce(after_value::text,''))))::int AS avg_after_chars
    FROM kia_booking_activity`
  console.table(act)

  const perBooking = await sql`
    SELECT booking_id::text AS booking_id, count(*)::int AS activity_rows,
      sum(length(coalesce(before_value::text,'')) + length(coalesce(after_value::text,'')))::int AS jsonb_chars
    FROM kia_booking_activity GROUP BY booking_id ORDER BY jsonb_chars DESC LIMIT 5`
  console.table(perBooking)

  await sql.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
