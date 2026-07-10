import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

async function run() {
  const tables = [
    { key: 'enquiry', table: 'kia_enquiry_report', dateColumn: 'enquiry_date' },
    { key: 'booking', table: 'kia_booking_report', dateColumn: 'booking_date' },
    { key: 'sales', table: 'kia_sales_report', dateColumn: 'delivery_date' },
    { key: 'accessories', table: 'kia_accessories_counter_sales_report', dateColumn: 'csr_date' }
  ]

  const availableMonthMap = new Map<string, Set<string>>()

  for (const t of tables) {
    const rows = await db.execute(sql`
      SELECT
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT TO_CHAR(DATE_TRUNC('month', ${sql.raw(t.dateColumn)}), 'YYYY-MM')), NULL) AS available_months
      FROM ${sql.raw(t.table)}
      WHERE ${sql.raw(t.dateColumn)} IS NOT NULL
    `)
    const row = rows[0] || {}
    const months = Array.isArray(row.available_months) ? row.available_months : []
    console.log(t.key, 'months:', months)
    for (const m of months) {
      if (m) {
        if (!availableMonthMap.has(m)) availableMonthMap.set(m, new Set())
        availableMonthMap.get(m)?.add(t.key)
      }
    }
  }

  const sortedMonths = Array.from(availableMonthMap.keys()).sort((a, b) => b.localeCompare(a))
  console.log('SORTED MONTHS:', sortedMonths)

  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
