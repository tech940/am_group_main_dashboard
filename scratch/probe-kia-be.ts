import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/**
 * Empirical companion to the KIA Business Excellence code audit: does the DATA behind the
 * section behave the way the section assumes? Code review cannot answer these.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])
const t = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  const start = Date.now()
  try {
    const out = await fn()
    console.log(`  [${((Date.now() - start) / 1000).toFixed(2)}s] ${label}`)
    return out
  } catch (e) {
    console.log(`  [FAIL] ${label} — ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function main() {
  console.log('=== ro_billing_report shape ===')
  const cols = rows(await analyticsDb.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ro_billing_report'
      AND column_name IN ('dealer_code','dealer_code_2','main_dealer_code','bill_date','uploaded_at','labour_amt','part_amt','ro_no','bill_no','bill_type')
    ORDER BY column_name`))
  console.log('  relevant columns:', cols.map((c) => c.column_name).join(', ') || '(none)')

  // Trap 1 — did the dealer_code changeover hit THIS feed too?
  console.log('\n=== outlet split (trap 1: dealer_code vs dealer_code_2) ===')
  const hasD2 = cols.some((c) => c.column_name === 'dealer_code_2')
  if (hasD2) {
    const split = rows(await analyticsDb.execute(sql`
      SELECT to_char(bill_date, 'YYYY-MM') AS month,
             COUNT(DISTINCT dealer_code) AS distinct_dc,
             COUNT(DISTINCT dealer_code_2) AS distinct_dc2,
             COUNT(*) FILTER (WHERE COALESCE(BTRIM(dealer_code_2),'') <> '') AS dc2_filled,
             COUNT(*) AS n
      FROM ro_billing_report
      WHERE bill_date >= '2026-05-01'
      GROUP BY 1 ORDER BY 1`))
    for (const r of split) {
      console.log(`  ${r.month}: rows=${r.n} distinct(dealer_code)=${r.distinct_dc} distinct(dealer_code_2)=${r.distinct_dc2} dc2_filled=${r.dc2_filled}`)
    }
    console.log('  ⚠ signature of the changeover = distinct(dealer_code) collapses to 1 while dc2 has more')
  } else {
    console.log('  no dealer_code_2 on this feed — trap 1 does not apply here')
  }

  // Trap 2 — is this feed cumulative (does it need dedupe)?
  console.log('\n=== duplication (trap 2: cumulative snapshot?) ===')
  const dupes = rows(await analyticsDb.execute(sql`
    SELECT COUNT(*) AS raw_rows,
           COUNT(DISTINCT COALESCE(NULLIF(BTRIM(bill_no),''), id::text)) AS distinct_bills,
           COUNT(DISTINCT COALESCE(NULLIF(BTRIM(ro_no),''), id::text)) AS distinct_ros
    FROM ro_billing_report
    WHERE bill_date >= '2026-04-01'`))
  console.log(' ', JSON.stringify(dupes[0]))

  // Trap 3 — how far does the feed actually reach? (LY windows must truncate to this)
  console.log('\n=== feed coverage (trap 3: comparison windows) ===')
  const cov = rows(await analyticsDb.execute(sql`
    SELECT MIN(bill_date)::text AS first_bill, MAX(bill_date)::text AS last_bill,
           MAX(uploaded_at)::text AS last_upload,
           COUNT(*) FILTER (WHERE bill_date > CURRENT_DATE) AS future_dated
    FROM ro_billing_report`))
  console.log(' ', JSON.stringify(cov[0]))

  // Monthly volume — a collapse here means the section is reporting on a hollow feed
  console.log('\n=== monthly volume (is the feed healthy?) ===')
  const monthly = rows(await analyticsDb.execute(sql`
    SELECT to_char(bill_date, 'YYYY-MM') AS month, COUNT(*) AS n,
           ROUND(SUM(COALESCE(labour_amt,0) + COALESCE(part_amt,0)))::bigint AS revenue
    FROM ro_billing_report
    WHERE bill_date >= '2026-01-01'
    GROUP BY 1 ORDER BY 1`))
  for (const r of monthly) console.log(`  ${r.month}: ${r.n} rows, revenue ${r.revenue}`)

  // Timing the canonical aggregations the section actually calls
  console.log('\n=== timings of the section\'s own readers ===')
  const { getKiaWorkshopSummary } = await import('../lib/kia/workshop-summary')
  await t('getKiaWorkshopSummary (cold)', () => getKiaWorkshopSummary({ endDate: '2026-08-10' }))
  await t('getKiaWorkshopSummary (warm)', () => getKiaWorkshopSummary({ endDate: '2026-08-10' }))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
