import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function run() {
  const enquiryMonths = await db.execute(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', enquiry_date), 'YYYY-MM') AS month, COUNT(*)
    FROM kia_enquiry_report
    GROUP BY 1 ORDER BY 1 DESC;
  `)
  console.log('ENQUIRY MONTHS:', enquiryMonths)

  const bookingMonths = await db.execute(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', booking_date), 'YYYY-MM') AS month, COUNT(*)
    FROM kia_booking_report
    GROUP BY 1 ORDER BY 1 DESC;
  `)
  console.log('BOOKING MONTHS:', bookingMonths)

  const salesMonths = await db.execute(sql`
    SELECT DISTINCT TO_CHAR(DATE_TRUNC('month', delivery_date), 'YYYY-MM') AS month, COUNT(*)
    FROM kia_sales_report
    GROUP BY 1 ORDER BY 1 DESC;
  `)
  console.log('SALES MONTHS:', salesMonths)

  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
