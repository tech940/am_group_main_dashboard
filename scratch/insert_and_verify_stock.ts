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

const missingVinsData = [
  {
    vin_number: 'MZBFB812LTN661701',
    model: 'SONET',
    variant: 'Sonet G1.2 5MT HTK Plus',
    exterior_color_name: 'AURORA BLACK PEARL',
    order_dealer: 'JK501',
    stock_status: 'Free Stock',
    kin_invoice_no: 'K202600029',
    cust_name: 'JARNAIL SINGH',
    source_file: 'Manual Allocation Fix',
  },
  {
    vin_number: 'MZBFB812LTN657401',
    model: 'SONET',
    variant: 'Sonet G1.2 5MT HTK+(O)',
    exterior_color_name: 'AURORA BLACK PEARL',
    order_dealer: 'JK402',
    stock_status: 'Free Stock',
    kin_invoice_no: 'K202600058',
    cust_name: 'THE AREA MANAGER CANTEEN STORES DEPARTMENT',
    source_file: 'Manual Allocation Fix',
  },
]

async function run() {
  console.log('--- 1. Inserting missing VINs into kia_stock_report ---')
  for (const item of missingVinsData) {
    const existing: any = await db.execute(sql`
      SELECT id FROM kia_stock_report WHERE vin_number = ${item.vin_number}
    `)
    const rows = Array.isArray(existing) ? existing : (existing.rows || [])
    if (rows.length === 0) {
      await db.execute(sql`
        INSERT INTO kia_stock_report (
          vin_number, model, variant, exterior_color_name, order_dealer, stock_status, kin_invoice_no, cust_name, source_file, created_at, uploaded_at
        ) VALUES (
          ${item.vin_number}, ${item.model}, ${item.variant}, ${item.exterior_color_name}, ${item.order_dealer}, ${item.stock_status}, ${item.kin_invoice_no}, ${item.cust_name}, ${item.source_file}, NOW(), NOW()
        )
      `)
      console.log(`✓ Successfully inserted VIN ${item.vin_number} into kia_stock_report`)
    } else {
      console.log(`ℹ VIN ${item.vin_number} already exists in kia_stock_report`)
    }
  }

  console.log('\n--- 2. Verifying all 16 VINs in kia_stock_report ---')
  const vinSqls = vins.map(v => sql`${v}`)
  const stockCheck: any = await db.execute(sql`
    SELECT vin_number, model, variant, exterior_color_name, order_dealer, stock_status 
    FROM kia_stock_report 
    WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const stockRows = Array.isArray(stockCheck) ? stockCheck : (stockCheck.rows || [])
  console.log(`Total 16 VINs in kia_stock_report: ${stockRows.length} / 16`)

  console.log('\n--- 3. Testing Proforma Stock API Query for these 16 VINs ---')
  const proformaQuery: any = await db.execute(sql`
    SELECT 
      sm.vin_number,
      sm.model,
      sm.variant,
      sm.exterior_color_name AS color,
      sm.order_dealer AS dealer_code,
      sm.stock_status,
      va.id AS allocation_id,
      kb.booking_number
    FROM kia_stock_report sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id
    WHERE sm.vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const queryRows = Array.isArray(proformaQuery) ? proformaQuery : (proformaQuery.rows || [])
  console.table(queryRows)

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
