import 'dotenv/config'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

const imgVins = [
  'MZBEA812LTN062243',
  'MZBEA812LTN071847',
  'MZBFB812LTN675477',
  'MZBFB812LTN676731',
  'MZBEB812LTN040281',
  'MZBGB814LTN324331',
  'MZBEA812LTN073365',
  'MZBEB812LTN052773',
  'MZBGB815LTN334138',
  'MZBFB812LTN676691',
  'MZBFB812LTN668504',
  'MZBFB812LTN677286',
  'MZBEA812LTN068521',
  'MZBEB812TTN072246',
  'MZBFB812LTN666221',
  'MZBGB814LTN321467',
  'MZBEB812LTN072817',
  'MZBEA812LTN071889',
  'MZBEF812LTN077367',
  'MZBEA812LTN068883',
  'MZBEA812LTN077310',
  'MZBEA812LTN068539',
  'MZBB2811LTN028647',
  'MZBB2811LTN029932',
  'MZBFB813LTN681651',
  'MZBEA812LTN068528',
  'MZBEA812LTN071187',
  'MZBEB812TTN064136',
  'MZBEB812LTN068172',
  'MZBEA812LTN068522',
  'MZBFB813LTN668443',
  'MZBFB813LTN677799',
  'MZBEC813MTN061487',
  'MZBGE81BUTN005584',
  'MZBFB812LTN657401',
  'MZBFB813LTN670904',
  'MZBEA812LTN071864',
  'MZBEF812LTN060627',
  'MZBGB814LTN335911',
  'MZBEB813MTN065080',
  'MZBEB812TTN070365',
  'MZBEA812LTN068837',
  'MZBFB813LTN668410',
  'MZBEA813LTN062279',
  'MZBFB813LTN672224',
  'MZBFB812LTN670317',
  'MZBEB812LTN036645',
  'MZBEA812LTN062185',
  'MZBFB812LTN663573',
  'MZBFB813LTN683905',
  'MZBB2811LTN029331',
]

async function run() {
  console.log(`Input VIN list count: ${imgVins.length}`)

  const vinSqls = imgVins.map(v => sql`${v}`)

  // Query sales report for July 2026 sales or matching VINs
  const salesResult: any = await db.execute(sql`
    SELECT vin_no, model, variant, color, dealer_code, invoice_date, status, booking_no, invoice_no, registration_name
    FROM kia_sales_report
    WHERE vin_no IN (${sql.join(vinSqls, sql`, `)})
  `)
  const salesRows = Array.isArray(salesResult) ? salesResult : (salesResult.rows || [])
  const salesMap = new Map(salesRows.map((r: any) => [r.vin_no, r]))

  // Query stock management
  const stockResult: any = await db.execute(sql`
    SELECT vin_number, order_dealer, stock_status, blocked, model, variant, exterior_color_name
    FROM kia_stock_management
    WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const stockRows = Array.isArray(stockResult) ? stockResult : (stockResult.rows || [])
  const stockMap = new Map(stockRows.map((r: any) => [r.vin_number, r]))

  // Query allocations & booking statuses
  const allocResult: any = await db.execute(sql`
    SELECT va.vin_number, va.booking_id, kb.status AS booking_status, kb.booking_number, kb.customer_name
    FROM kia_vehicle_allocations va
    JOIN kia_bookings kb ON kb.id = va.booking_id
    WHERE va.vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const allocRows = Array.isArray(allocResult) ? allocResult : (allocResult.rows || [])
  const allocMap = new Map(allocRows.map((r: any) => [r.vin_number, r]))

  // Query local statuses
  const localResult: any = await db.execute(sql`
    SELECT vin_number, local_status FROM kia_stock_local_statuses WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const localRows = Array.isArray(localResult) ? localResult : (localResult.rows || [])
  const localMap = new Map(localRows.map((r: any) => [r.vin_number, r.local_status]))

  console.log('\n--- Analysis Breakdown ---')
  let countInStock = 0
  let countNotInStock = 0
  let countAllocatedDelivered = 0
  let countAllocatedPaidToDeliver = 0
  let countAllocatedPaymentPending = 0
  let countAllocatedOther = 0
  let countUnallocated = 0

  for (let i = 0; i < imgVins.length; i++) {
    const v = imgVins[i]
    const s = salesMap.get(v)
    const st = stockMap.get(v)
    const al = allocMap.get(v)
    const ls = localMap.get(v)

    if (st) countInStock++
    else countNotInStock++

    let category = ''
    if (al) {
      const bStatus = al.booking_status
      if (bStatus === 'delivered') {
        countAllocatedDelivered++
        category = 'DELIVERED (Booking status = delivered)'
      } else if (bStatus === 'ready_delivery') {
        countAllocatedPaidToDeliver++
        category = 'PAID TO DELIVER (Booking status = ready_delivery)'
      } else {
        countAllocatedPaymentPending++
        category = `ALLOCATED/PAYMENT PENDING (Booking status = ${bStatus})`
      }
    } else if (ls === 'retail') {
      countAllocatedDelivered++
      category = 'DELIVERED (local_status = retail)'
    } else {
      countUnallocated++
      category = 'NOT ALLOCATED (Free to retrieve into Stock)'
    }

    console.log(`[${i+1}] ${v}: SalesFound=${!!s} | StockFound=${!!st} | Category: ${category}`)
  }

  console.log('\n--- Summary Counts ---')
  console.log(`Total Input VINs: ${imgVins.length}`)
  console.log(`Found in kia_sales_report: ${salesRows.length}`)
  console.log(`Found in kia_stock_report: ${stockRows.length}`)
  console.log(`Missing from kia_stock_report: ${countNotInStock}`)
  console.log(`Already Delivered / Retailed: ${countAllocatedDelivered}`)
  console.log(`Paid to Deliver (ready_delivery): ${countAllocatedPaidToDeliver}`)
  console.log(`Allocated / Payment Pending / Active Booking: ${countAllocatedPaymentPending}`)
  console.log(`Unallocated (Needs to be in Available/Free Stock): ${countUnallocated}`)

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
