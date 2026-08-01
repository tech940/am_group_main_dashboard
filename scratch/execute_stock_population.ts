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
  console.log('--- 1. Fetching current allocations and statuses ---')
  const vinSqls = imgVins.map(v => sql`${v}`)

  // Sales report data
  const salesResult: any = await db.execute(sql`
    SELECT vin_no, model, variant, color, dealer_code, invoice_no, registration_name
    FROM kia_sales_report
    WHERE vin_no IN (${sql.join(vinSqls, sql`, `)})
  `)
  const salesRows = Array.isArray(salesResult) ? salesResult : (salesResult.rows || [])
  const salesMap = new Map(salesRows.map((r: any) => [r.vin_no, r]))

  // Active allocations
  const allocResult: any = await db.execute(sql`
    SELECT va.vin_number, va.booking_id, kb.status AS booking_status
    FROM kia_vehicle_allocations va
    JOIN kia_bookings kb ON kb.id = va.booking_id
    WHERE va.vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const allocRows = Array.isArray(allocResult) ? allocResult : (allocResult.rows || [])
  const allocMap = new Map(allocRows.map((r: any) => [r.vin_number, r]))

  // Local statuses
  const localResult: any = await db.execute(sql`
    SELECT vin_number, local_status FROM kia_stock_local_statuses WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const localRows = Array.isArray(localResult) ? localResult : (localResult.rows || [])
  const localMap = new Map(localRows.map((r: any) => [r.vin_number, r.local_status]))

  const unallocatedVins: string[] = []
  const activeVins: { vin: string; reason: string }[] = []

  for (const vin of imgVins) {
    const al = allocMap.get(vin)
    const ls = localMap.get(vin)
    if (al) {
      activeVins.push({ vin, reason: `Booking status = ${al.booking_status}` })
    } else if (ls === 'retail') {
      activeVins.push({ vin, reason: 'local_status = retail' })
    } else {
      unallocatedVins.push(vin)
    }
  }

  console.log(`Protected Active VINs (will NOT touch): ${activeVins.length}`)
  console.log(`Unallocated VINs to populate/update in Stock: ${unallocatedVins.length}`)

  console.log('\n--- 2. Populating/Updating Unallocated VINs into kia_stock_management and kia_stock_report ---')

  let insertedMgt = 0
  let updatedMgt = 0
  let insertedRep = 0
  let updatedRep = 0

  for (const vin of unallocatedVins) {
    const s = salesMap.get(vin) || {}
    const model = s.model || 'SONET'
    const variant = s.variant || ''
    const color = s.color || ''
    const dealer = s.dealer_code || 'JK402'
    const invoiceNo = s.invoice_no || null
    const custName = s.registration_name || null

    // 1. kia_stock_management
    const mgtCheck: any = await db.execute(sql`SELECT id FROM kia_stock_management WHERE vin_number = ${vin}`)
    const mgtRows = Array.isArray(mgtCheck) ? mgtCheck : (mgtCheck.rows || [])
    if (mgtRows.length === 0) {
      await db.execute(sql`
        INSERT INTO kia_stock_management (
          vin_number, model, variant, exterior_color_name, order_dealer, stock_status, kin_invoice_no, cust_name, source_file, created_at, uploaded_at
        ) VALUES (
          ${vin}, ${model}, ${variant}, ${color}, ${dealer}, 'Free Stock', ${invoiceNo}, ${custName}, 'July Retailed Recovery', NOW(), NOW()
        )
      `)
      insertedMgt++
    } else {
      await db.execute(sql`
        UPDATE kia_stock_management
        SET stock_status = 'Free Stock',
            model = COALESCE(NULLIF(model, ''), ${model}),
            variant = COALESCE(NULLIF(variant, ''), ${variant}),
            exterior_color_name = COALESCE(NULLIF(exterior_color_name, ''), ${color}),
            order_dealer = COALESCE(NULLIF(order_dealer, ''), ${dealer})
        WHERE vin_number = ${vin}
      `)
      updatedMgt++
    }

    // 2. kia_stock_report
    const repCheck: any = await db.execute(sql`SELECT id FROM kia_stock_report WHERE vin_number = ${vin}`)
    const repRows = Array.isArray(repCheck) ? repCheck : (repCheck.rows || [])
    if (repRows.length === 0) {
      await db.execute(sql`
        INSERT INTO kia_stock_report (
          vin_number, model, variant, exterior_color_name, order_dealer, stock_status, kin_invoice_no, cust_name, source_file, created_at, uploaded_at
        ) VALUES (
          ${vin}, ${model}, ${variant}, ${color}, ${dealer}, 'Free Stock', ${invoiceNo}, ${custName}, 'July Retailed Recovery', NOW(), NOW()
        )
      `)
      insertedRep++
    } else {
      await db.execute(sql`
        UPDATE kia_stock_report
        SET stock_status = 'Free Stock',
            model = COALESCE(NULLIF(model, ''), ${model}),
            variant = COALESCE(NULLIF(variant, ''), ${variant}),
            exterior_color_name = COALESCE(NULLIF(exterior_color_name, ''), ${color}),
            order_dealer = COALESCE(NULLIF(order_dealer, ''), ${dealer})
        WHERE vin_number = ${vin}
      `)
      updatedRep++
    }
  }

  console.log(`kia_stock_management: Inserted ${insertedMgt}, Updated ${updatedMgt}`)
  console.log(`kia_stock_report: Inserted ${insertedRep}, Updated ${updatedRep}`)

  console.log('\n--- 3. Verifying Available Stock for the 30 Unallocated VINs ---')
  const unallocSqls = unallocatedVins.map(v => sql`${v}`)
  const availQuery: any = await db.execute(sql`
    SELECT 
      sm.vin_number,
      sm.model,
      sm.variant,
      sm.exterior_color_name AS color,
      sm.order_dealer AS dealer_code,
      sm.stock_status,
      va.id AS allocation_id
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number
    LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
    LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
    WHERE sm.vin_number IN (${sql.join(unallocSqls, sql`, `)})
      AND va.id IS NULL 
      AND vt.id IS NULL 
      AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail') 
      AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')
  `)
  const availRows = Array.isArray(availQuery) ? availQuery : (availQuery.rows || [])
  console.log(`Total Unallocated VINs in Available Stock query: ${availRows.length} / ${unallocatedVins.length}`)
  console.table(availRows.map((r: any) => ({
    vin: r.vin_number,
    model: r.model,
    variant: r.variant,
    color: r.color,
    dealer: r.dealer_code,
    status: r.stock_status,
  })))

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
