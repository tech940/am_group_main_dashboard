import { analyticsDb as db } from '@/lib/analytics/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    console.log('=== Checking ACTIVE rows in am_platinum_ro_billing_report ===\n')

    // What do dealer_code and main_dealer_code contain for ACTIVE rows?
    const activeRows = await db.execute(sql`
      SELECT
        source_dealer_code,
        dealer_code,
        main_dealer_code,
        COUNT(*)::int AS cnt,
        MIN(bill_date)::text AS min_date,
        MAX(bill_date)::text AS max_date
      FROM am_platinum_ro_billing_report
      WHERE UPPER(TRIM(COALESCE(source_dealer_code::text, ''))) = 'ACTIVE'
      GROUP BY source_dealer_code, dealer_code, main_dealer_code
      ORDER BY cnt DESC
      LIMIT 20
    `)
    console.log('ACTIVE rows breakdown (source/dealer/main_dealer):')
    console.log(JSON.stringify(activeRows, null, 2))

    // What does the resolved dealer code end up as after the CASE WHEN logic?
    const resolvedActive = await db.execute(sql`
      SELECT
        CASE
          WHEN COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
          ) = 'N6824' THEN 'N6250'
          ELSE COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
          )
        END AS resolved_dealer,
        COUNT(*)::int AS cnt,
        MIN(bill_date)::text AS min_date,
        MAX(bill_date)::text AS max_date
      FROM am_platinum_ro_billing_report
      WHERE UPPER(TRIM(COALESCE(source_dealer_code::text, ''))) = 'ACTIVE'
      GROUP BY resolved_dealer
      ORDER BY cnt DESC
    `)
    console.log('\nResolved dealer code for ACTIVE rows:')
    console.log(JSON.stringify(resolvedActive, null, 2))

    // Summary: total rows per resolved dealer across the whole table
    const fullSummary = await db.execute(sql`
      SELECT
        CASE
          WHEN COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
          ) = 'N6824' THEN 'N6250'
          ELSE COALESCE(
            NULLIF(NULLIF(UPPER(TRIM(COALESCE(source_dealer_code::text, ''))), ''), 'ACTIVE'),
            NULLIF(UPPER(TRIM(COALESCE(dealer_code::text, ''))), ''),
            NULLIF(UPPER(TRIM(COALESCE(main_dealer_code::text, ''))), '')
          )
        END AS resolved_dealer,
        EXTRACT(YEAR FROM bill_date::date)::int AS year,
        COUNT(*)::int AS rows_count,
        MIN(bill_date)::text AS min_date,
        MAX(bill_date)::text AS max_date
      FROM am_platinum_ro_billing_report
      GROUP BY resolved_dealer, year
      ORDER BY resolved_dealer, year
    `)
    console.log('\nFull table — rows per RESOLVED dealer per year:')
    console.log(JSON.stringify(fullSummary, null, 2))

  } catch (error) {
    console.error('Error:', error)
  }
  process.exit(0)
}

main()
