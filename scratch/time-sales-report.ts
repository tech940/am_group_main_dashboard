import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

/** Where does the Sales Report time actually go? Measure, don't guess. */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])
const t = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  const s = Date.now()
  try {
    const out = await fn()
    console.log(`  ${String(Date.now() - s).padStart(6)}ms  ${label}`)
    return out
  } catch (e) {
    console.log(`  FAILED       ${label} — ${e instanceof Error ? e.message.slice(0, 90) : e}`)
    return null
  }
}

async function main() {
  // Baseline: pooler round-trip cost, so we can separate transport from work.
  await t('SELECT 1 (round-trip baseline)', () => db.execute(sql`SELECT 1`))
  await t('SELECT 1 (warm)', () => db.execute(sql`SELECT 1`))

  console.log('\n--- table sizes the report reads ---')
  for (const tbl of ['kia_sales_report', 'kia_booking_report', 'kia_enquiry_report']) {
    const r = rows(await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${tbl}`)))
    console.log(`  ${tbl.padEnd(22)} ${String(r[0]?.n ?? '?').padStart(8)} rows`)
  }

  console.log('\n--- the summary loader, cold then warm ---')
  const { getKiaSalesReportSummary } = await import('../lib/kia/sales-report')
  await t('getKiaSalesReportSummary COLD', () => getKiaSalesReportSummary({ year: 2026, month: 7 }))
  await t('getKiaSalesReportSummary WARM', () => getKiaSalesReportSummary({ year: 2026, month: 7 }))
  await t('…different month (cache miss)', () => getKiaSalesReportSummary({ year: 2026, month: 6 }))

  console.log('\n--- do the dedupe scans use an index? ---')
  for (const [label, q] of [
    ['sales DISTINCT ON vin', `SELECT COUNT(*) FROM (SELECT DISTINCT ON (UPPER(BTRIM(vin_number))) id FROM kia_sales_report WHERE vin_number IS NOT NULL ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC) x`],
    ['booking dedupe', `SELECT COUNT(*) FROM (SELECT DISTINCT ON (customer_id, booking_no) id FROM kia_booking_report ORDER BY customer_id, booking_no, uploaded_at DESC) x`],
    ['enquiry dedupe', `SELECT COUNT(*) FROM (SELECT DISTINCT ON (customer_id, enquiry_no) id FROM kia_enquiry_report ORDER BY customer_id, enquiry_no, uploaded_at DESC) x`],
  ] as const) {
    await t(label, () => db.execute(sql.raw(q)))
  }

  console.log('\n--- EXPLAIN: is the sales dedupe seq-scanning + sorting? ---')
  const plan = rows(await db.execute(sql.raw(
    `EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT ON (UPPER(BTRIM(vin_number))) id
     FROM kia_sales_report WHERE vin_number IS NOT NULL
     ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC`)))
  for (const p of plan.slice(0, 8)) console.log('   ', Object.values(p)[0])
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
