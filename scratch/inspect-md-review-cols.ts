import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '../lib/db'

const rows = (r: unknown) => (Array.isArray(r) ? (r as Record<string, unknown>[]) : [])
const show = async (label: string, q: ReturnType<typeof sql>) => {
  const r = rows(await db.execute(q))
  console.log(`\n${label}:`)
  for (const row of r) console.log(' ', JSON.stringify(row))
}

async function main() {
  await show('booking status values (deduped rows not needed for a domain probe)', sql`
    SELECT COALESCE(NULLIF(BTRIM(status), ''), '(blank)') AS v, COUNT(*) AS n
    FROM kia_booking_report GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)

  await show('enquiry_status values', sql`
    SELECT COALESCE(NULLIF(BTRIM(enquiry_status), ''), '(blank)') AS v, COUNT(*) AS n
    FROM kia_enquiry_report GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)

  await show('lost_reason top values (rows with lost_date)', sql`
    SELECT COALESCE(NULLIF(BTRIM(lost_reason), ''), '(blank)') AS v, COUNT(*) AS n
    FROM kia_enquiry_report WHERE lost_date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 12`)

  await show('enquiry model top values', sql`
    SELECT COALESCE(NULLIF(BTRIM(model), ''), '(blank)') AS v, COUNT(*) AS n
    FROM kia_enquiry_report GROUP BY 1 ORDER BY 2 DESC LIMIT 14`)

  await show('booking dedupe check: 2026 distinct (customer_id, booking_no) vs raw', sql`
    SELECT COUNT(*) AS raw, COUNT(DISTINCT (UPPER(BTRIM(COALESCE(customer_id,''))) || ':' || UPPER(BTRIM(COALESCE(booking_no,''))))) AS distinct_bookings
    FROM kia_booking_report WHERE booking_date IS NOT NULL AND EXTRACT(YEAR FROM booking_date) = 2026`)

  await show('accessories: top descriptions 2026 by value', sql`
    SELECT COALESCE(NULLIF(BTRIM(accessories_description), ''), '(blank)') AS v,
           SUM(accessories_qty)::int AS qty, ROUND(SUM(accessories_list_price_unit))::bigint AS ndp
    FROM kia_accessories_counter_sales_report
    WHERE csr_date IS NOT NULL AND EXTRACT(YEAR FROM csr_date) = 2026
    GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 8`)

  await show('bookings: undelivered backlog probe (latest snapshot rows, status not cancelled/delivered)', sql`
    SELECT COALESCE(NULLIF(BTRIM(d.status), ''), '(blank)') AS v, COUNT(*) AS n
    FROM (
      SELECT DISTINCT ON (UPPER(BTRIM(COALESCE(b.customer_id,''))), UPPER(BTRIM(COALESCE(b.booking_no,''))))
        b.status
      FROM kia_booking_report b
      WHERE COALESCE(b.booking_no, '') <> ''
      ORDER BY UPPER(BTRIM(COALESCE(b.customer_id,''))), UPPER(BTRIM(COALESCE(b.booking_no,''))), b.uploaded_at DESC NULLS LAST
    ) d GROUP BY 1 ORDER BY 2 DESC`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
