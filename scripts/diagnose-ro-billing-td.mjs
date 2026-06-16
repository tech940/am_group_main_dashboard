import 'dotenv/config'
import postgres from 'postgres'
import { pickDatabaseUrl } from './bigquery/db-url.js'

const DEALER = process.argv[2] || 'JK402'
const END_DATE = process.argv[3] || '2026-06-16'
const url = await pickDatabaseUrl(postgres, '[td-verify]')
const db = postgres(url, { ssl: { rejectUnauthorized: false }, prepare: false, max: 1 })

const endDate = new Date(Number(END_DATE.slice(0, 4)), Number(END_DATE.slice(5, 7)) - 1, Number(END_DATE.slice(8, 10)))
const today = new Date()
today.setHours(0, 0, 0, 0)

const billCountRows = await db.unsafe(`
  SELECT COUNT(*)::int AS count
  FROM ro_billing_report
  WHERE bill_date = '${END_DATE}'::date
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
`)
const billCount = billCountRows[0]?.count ?? 0

const latestRows = await db.unsafe(`
  SELECT MAX(bill_date)::text AS max_date
  FROM ro_billing_report
  WHERE bill_date <= '${END_DATE}'::date
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
`)
const latestBillDate = latestRows[0]?.max_date

let tdDate = END_DATE
if (billCount === 0 && endDate.getTime() === today.getTime() && latestBillDate) {
  tdDate = latestBillDate
}

const tdRows = await db.unsafe(`
  SELECT COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS load
  FROM ro_billing_report
  WHERE bill_date = '${tdDate}'::date
    AND LOWER(TRIM(COALESCE(bill_status::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')
    AND UPPER(TRIM(COALESCE(NULLIF(dealer_code, ''), NULLIF(main_dealer_code, '')))) = '${DEALER}'
`)

console.log({ endDate: END_DATE, billCountOnEndDate: billCount, latestBillDate, tdDate, tdLoad: tdRows[0]?.load })

await db.end()
