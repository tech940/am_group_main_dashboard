import { db } from '../lib/db'
import { sql } from 'drizzle-orm'

function upperText(val: any): string {
  return String(val || '').trim().toUpperCase()
}

function displayDate(val: any): string {
  if (!val) return ''
  const d = new Date(val)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

function safeText(val: any): string {
  return String(val || '').trim()
}

function getFirstText(row: any, keys: string[]): string {
  for (const k of keys) {
    if (row[k]) return String(row[k])
  }
  return ''
}

function buildDeduplicationKey(row: any) {
  const invoiceNo = upperText(row.invoice_no)
  if (invoiceNo) return `sales:${invoiceNo}`
  return [
    'sales',
    upperText(getFirstText(row, ['vin_number', 'vin_no'])),
    displayDate(row.delivery_date) || displayDate(row.invoice_date) || safeText(row.delivery_date) || safeText(row.invoice_date),
    upperText(row.customerid),
    upperText(row.registration_name),
    upperText(row.model),
  ].join('|')
}

async function run() {
  const rows = await db.execute(sql`
    SELECT * FROM kia_sales_report
    WHERE delivery_date >= '2026-06-01'
      AND delivery_date < '2026-07-01'
  `)
  
  const unique = new Map<string, any>()
  for (const row of rows) {
    const key = buildDeduplicationKey(row)
    unique.set(key, row)
  }
  
  console.log('June raw count:', rows.length)
  console.log('June deduped count:', unique.size)
  
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
