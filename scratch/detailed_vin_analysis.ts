import 'dotenv/config'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

const vins = [
  'MZBFB813LTN668443',
  'MZBEA813LTN062279',
  'MZBFB812LTN670317',
  'MZBFB812LTN661701',
  'MZBEA812LTN068837',
  'MZBEA812LTN068528',
  'MZBFB812LTN666221',
  'MZBFB812LTN676691',
  'MZBEA812LTN068521',
  'MZBEA812LTN062243',
  'MZBEB812TTN072246',
  'MZBEB812LTN072817',
  'MZBGB814LTN321467',
  'MZBEA812LTN073365',
  'MZBFB812LTN657401',
  'MZBFB812LTN676731',
]

async function run() {
  const vinSqls = vins.map(v => sql`${v}`)
  
  // 1. Sales Report
  const salesResult: any = await db.execute(sql`
    SELECT vin_no, model, variant, color, dealer_code, status, booking_no, invoice_no, registration_name, invoice_date
    FROM kia_sales_report 
    WHERE vin_no IN (${sql.join(vinSqls, sql`, `)})
  `)
  const salesRows = Array.isArray(salesResult) ? salesResult : (salesResult.rows || [])
  const salesMap = new Map(salesRows.map((r: any) => [r.vin_no, r]))

  // 2. Stock Report
  const stockResult: any = await db.execute(sql`
    SELECT vin_number, model, variant, color_type, exterior_color_name, order_dealer, stock_status, blocked, booking_no
    FROM kia_stock_report 
    WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const stockRows = Array.isArray(stockResult) ? stockResult : (stockResult.rows || [])
  const stockMap = new Map(stockRows.map((r: any) => [r.vin_number, r]))

  // 3. Vehicle Allocations table (if any of these VINs are allocated in kia_vehicle_allocations)
  const allocResult: any = await db.execute(sql`
    SELECT * FROM kia_vehicle_allocations WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const allocRows = Array.isArray(allocResult) ? allocResult : (allocResult.rows || [])
  const allocMap = new Map(allocRows.map((r: any) => [r.vin_number, r]))

  console.log('VIN Analysis Summary:')
  console.log('--------------------------------------------------')
  for (let i = 0; i < vins.length; i++) {
    const v = vins[i]
    const s = salesMap.get(v)
    const st = stockMap.get(v)
    const al = allocMap.get(v)

    console.log(`[${i+1}] ${v}:`)
    if (s) {
      console.log(`  Sales: Model="${s.model}", Variant="${s.variant}", Color="${s.color}", Dealer="${s.dealer_code}", InvoiceNo="${s.invoice_no}", Cust="${s.registration_name}"`)
    } else {
      console.log(`  Sales: NOT FOUND`)
    }

    if (st) {
      console.log(`  Stock: Present in kia_stock_report (Dealer="${st.order_dealer}", Status="${st.stock_status}")`)
    } else {
      console.log(`  Stock: *** NOT IN kia_stock_report ***`)
    }

    if (al) {
      console.log(`  Allocation: Allocated to Booking ID ${al.booking_id} (Status="${al.status}")`)
    } else {
      console.log(`  Allocation: Not currently allocated in kia_vehicle_allocations`)
    }
    console.log('')
  }

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
