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
  console.log('--- 1. Querying kia_sales_report for VINs ---')
  const vinSqls = vins.map(v => sql`${v}`)
  const salesResult: any = await db.execute(sql`
    SELECT * FROM kia_sales_report WHERE vin_no IN (${sql.join(vinSqls, sql`, `)})
  `)
  const rows = Array.isArray(salesResult) ? salesResult : (salesResult.rows || [])
  console.log(`Found ${rows.length} VINs in kia_sales_report out of ${vins.length} requested`)
  for (const r of rows) {
    console.log({
      vin: r.vin_no,
      model: r.model_name || r.model || r.model_code,
      variant: r.variant_name || r.variant || r.variant_code,
      color: r.color_name || r.color || r.ext_color,
      dealer: r.dealer_code || r.outlet_code || r.dealer_name,
      engine: r.engine_no,
      customer: r.customer_name,
    })
  }

  console.log('\n--- 2. Checking columns of kia_sales_report ---')
  const salesCols: any = await db.execute(sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'kia_sales_report'
  `)
  const colRows = Array.isArray(salesCols) ? salesCols : (salesCols.rows || [])
  console.log('kia_sales_report columns:', colRows.map((c: any) => c.column_name).join(', '))

  console.log('\n--- 3. Checking columns of kia_stock_report ---')
  const stockCols: any = await db.execute(sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'kia_stock_report'
  `)
  const stockColRows = Array.isArray(stockCols) ? stockCols : (stockCols.rows || [])
  console.log('kia_stock_report columns:', stockColRows.map((c: any) => c.column_name).join(', '))

  console.log('\n--- 4. Checking if any of these 16 VINs are in kia_stock_report ---')
  const inStock: any = await db.execute(sql`
    SELECT vin_number, order_dealer, stock_status, blocked FROM kia_stock_report WHERE vin_number IN (${sql.join(vinSqls, sql`, `)})
  `)
  const stockFoundRows = Array.isArray(inStock) ? inStock : (inStock.rows || [])
  console.log(`Currently in kia_stock_report: ${stockFoundRows.length} vehicles`)
  console.log(stockFoundRows)

  process.exit(0)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
