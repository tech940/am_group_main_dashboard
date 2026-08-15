import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { analyticsDb } from '../lib/analytics/db'

/**
 * The JS dedupe picks a winner by uploaded_at, then id, then a COMPLETENESS score over all columns.
 * Any optimisation (SQL dedupe, or projecting fewer columns) can only change the outcome if that
 * completeness tiebreaker actually fires — i.e. two rows share a key AND uploaded_at AND id.
 * If that never happens, `DISTINCT ON (... ) ORDER BY uploaded_at DESC, id DESC` is provably
 * equivalent and safe.
 */

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])

async function main() {
  const r = rows(await analyticsDb.execute(sql`
    WITH keyed AS (
      SELECT
        UPPER(BTRIM(COALESCE(NULLIF(BTRIM(dealer_code_2), ''), NULLIF(BTRIM(dealer_code), ''), ''))) AS dealer,
        UPPER(BTRIM(COALESCE(enquiry_no, ''))) AS enquiry_no,
        uploaded_at, id
      FROM kia_enquiry_report
      WHERE enquiry_date >= '2026-01-01' AND COALESCE(BTRIM(enquiry_no), '') <> ''
    )
    SELECT
      COUNT(*) AS rows_total,
      COUNT(DISTINCT (dealer, enquiry_no)) AS distinct_keys,
      (SELECT COUNT(*) FROM (
         SELECT dealer, enquiry_no FROM keyed
         GROUP BY dealer, enquiry_no, uploaded_at, id
         HAVING COUNT(*) > 1
       ) t) AS ties_on_key_uploaded_id
    FROM keyed`))

  const t = r[0]
  console.log('enquiry rows in 2026        :', t.rows_total)
  console.log('distinct (dealer, enquiry_no):', t.distinct_keys)
  console.log('inflation factor            :', (Number(t.rows_total) / Number(t.distinct_keys)).toFixed(1) + 'x')
  console.log('rows tying on key+uploaded_at+id:', t.ties_on_key_uploaded_id)
  console.log(
    Number(t.ties_on_key_uploaded_id) === 0
      ? '\n✅ NO TIES — the completeness tiebreaker never fires, so uploaded_at DESC, id DESC\n   fully determines the winner. SQL dedupe is provably equivalent to the JS dedupe.'
      : '\n⚠ TIES EXIST — the completeness tiebreaker decides some rows; SQL dedupe could pick differently.'
  )
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
