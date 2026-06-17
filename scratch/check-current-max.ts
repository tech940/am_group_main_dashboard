import 'dotenv/config'
import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function main() {
  try {
    console.log('=== Checking Current Database Stats ===\n')

    const maxBillDate = await db.execute(sql`
      SELECT MAX(bill_date)::text as max_date FROM ro_billing_report
    `)
    console.log('Max bill_date in ro_billing_report:', maxBillDate[0]?.max_date)

    const todayCountRaw = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM ro_billing_report WHERE bill_date = '2026-06-17'::date
    `)
    console.log('Raw row count for 2026-06-17:', todayCountRaw[0]?.count)

    // Let's also check am_platinum_ro_billing_report
    const platMaxDate = await db.execute(sql`
      SELECT MAX(bill_date)::text as max_date FROM am_platinum_ro_billing_report
    `)
    console.log('Max bill_date in am_platinum_ro_billing_report:', platMaxDate[0]?.max_date)

    const platTodayCount = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM am_platinum_ro_billing_report WHERE bill_date = '2026-06-17'::date
    `)
    console.log('Raw row count for am_platinum_ro_billing_report on 2026-06-17:', platTodayCount[0]?.count)

    // Let's check open_ro_yearly (Open ROs)
    const openRoCount = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM open_ro_yearly WHERE ro_date = '2026-06-17'::date
    `)
    console.log('Row count for open_ro_yearly on 2026-06-17:', openRoCount[0]?.count)

  } catch (err) {
    console.error(err)
  } finally {
    process.exit(0)
  }
}

main()
