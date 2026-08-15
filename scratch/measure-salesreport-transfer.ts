import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/**
 * The summary does `SELECT *` over a two-period window per table, then filters, dedupes and
 * aggregates in JavaScript. Measure what that actually costs: how many ROWS and how many BYTES
 * cross the wire, and how much of the 8.8s cache-miss is transfer.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

// A July window compares against June — so the query spans ~2 months.
const START = '2026-06-01'
const END = '2026-08-01'

const TABLES = [
  ['kia_enquiry_report', 'enquiry_date'],
  ['kia_booking_report', 'booking_date'],
  ['kia_sales_report', 'delivery_date'],
  ['kia_accessories_counter_sales_report', 'csr_date'],
] as const

async function main() {
  let totalRows = 0, totalBytes = 0, totalMs = 0
  console.log('per-table cost of the summary\'s `SELECT *` two-period window:\n')
  for (const [table, dateCol] of TABLES) {
    const started = Date.now()
    const r = rows(await analyticsDb.execute(sql.raw(
      `SELECT * FROM ${table} WHERE ${dateCol} >= '${START}' AND ${dateCol} < '${END}'`)))
    const ms = Date.now() - started
    const bytes = Buffer.byteLength(JSON.stringify(r))
    const cols = r[0] ? Object.keys(r[0]).length : 0
    totalRows += r.length; totalBytes += bytes; totalMs += ms
    console.log(`  ${table.padEnd(38)} ${String(r.length).padStart(6)} rows × ${String(cols).padStart(3)} cols  ${(bytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${String(ms).padStart(5)}ms`)
  }
  console.log(`  ${''.padEnd(38)} ${String(totalRows).padStart(6)} rows${''.padStart(11)}${(totalBytes / 1024 / 1024).toFixed(2).padStart(6)} MB  ${String(totalMs).padStart(5)}ms  <-- crosses the wire EVERY cache miss`)

  // What the same answer costs if Postgres does the counting instead.
  console.log('\nsame window, aggregated IN POSTGRES (what it could be):')
  const started = Date.now()
  const agg = rows(await analyticsDb.execute(sql.raw(`
    SELECT
      (SELECT COUNT(DISTINCT (customer_id, enquiry_no)) FROM kia_enquiry_report
        WHERE enquiry_date >= '${START}' AND enquiry_date < '${END}') AS enquiries,
      (SELECT COUNT(DISTINCT (customer_id, booking_no)) FROM kia_booking_report
        WHERE booking_date >= '${START}' AND booking_date < '${END}') AS bookings,
      (SELECT COUNT(DISTINCT UPPER(BTRIM(vin_number))) FROM kia_sales_report
        WHERE delivery_date >= '${START}' AND delivery_date < '${END}') AS retails`)))
  const aggMs = Date.now() - started
  const aggBytes = Buffer.byteLength(JSON.stringify(agg))
  console.log(`  ${JSON.stringify(agg[0])}`)
  console.log(`  ${aggBytes} bytes, ${aggMs}ms  (one round-trip, no rows transferred)`)

  console.log(`\n=> transfer avoided: ${(totalBytes / 1024 / 1024).toFixed(2)} MB -> ${(aggBytes / 1024).toFixed(1)} KB`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
