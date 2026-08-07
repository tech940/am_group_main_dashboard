import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { kiaProformas, kiaFinanceProcessing } from '@/lib/db/schema'

const vins = [
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
  'MZBEA812LTN077367',
  'MZBEA812LTN068883',
  'MZBEA812LTN077310',
]

async function run() {
  console.log('=== PROCESSING 21 VINS FOR FINANCE TRANSFER & STOCK PURGE ===\n')

  let createdProformas = 0
  let createdFinance = 0

  for (const vin of vins) {
    console.log(`Processing VIN: ${vin}...`)

    // 1. Fetch details from sales or booking report
    const salesRows = await db.execute(
      sql`SELECT * FROM kia_sales_report WHERE vin_number ILIKE ${vin} OR vin_no ILIKE ${vin} ORDER BY id DESC LIMIT 1`
    )
    const bookingRows = await db.execute(
      sql`SELECT * FROM kia_booking_report WHERE booking_no IN (SELECT booking_no FROM kia_sales_report WHERE vin_number ILIKE ${vin} OR vin_no ILIKE ${vin}) ORDER BY id DESC LIMIT 1`
    )

    const s = (salesRows[0] || {}) as any
    const b = (bookingRows[0] || {}) as any

    const customerName = s.registration_name || s.customer_name || b.name_of_the_customer || 'Customer - ' + vin.slice(-6)
    const mobileNumber = s.contact_num1 || b.contact_number || '9999999999'
    const modelName = s.model || b.model || 'Sonet/Seltos/Carens'
    const trimDescription = s.variant || b.variant || 'Standard'
    const consultant = s.consultant_name || b.consultant_name || 'Sales Consultant'
    const location = s.location || b.location || s.dealer_code || b.dealer_code || 'JK402'
    const bankName = s.dsa_financier || b.dsa_financier || 'Bank/Self'
    const bookingNo = s.booking_no || b.booking_no || ''
    const color = s.color || b.color || 'Standard'

    // 2. Check if proforma already exists
    let existingProformas = await db.execute(
      sql`SELECT * FROM kia_proformas WHERE import_metadata->>'vin_number' = ${vin} OR (booking_amount = ${bookingNo} AND ${bookingNo} != '')`
    ).catch(() => [])

    let proformaId: string

    if (existingProformas.length > 0) {
      proformaId = (existingProformas[0] as any).id
      console.log(`  Proforma already exists (ID: ${proformaId})`)
    } else {
      const inserted = await db.insert(kiaProformas).values({
        proformaDate: new Date(),
        customerType: 'Individual',
        customerName,
        mobileNumber,
        customerAddress: s.address || 'Jammu & Kashmir',
        customerEmail: 'customer@amgroup.in',
        modelName,
        trimDescription,
        fuelType: 'Petrol',
        vehicleColor: color,
        bankName,
        vehicleStatus: 'Allocated',
        loanAmount: '0',
        exShowroom: String(s.ex_showroom_price || '0'),
        consultant,
        location,
        loginEmail: 'system@amgroup.in',
        approvalStatus: 'APPROVED',
        financeStatus: 'Pending',
        importMetadata: { vin_number: vin, booking_number: bookingNo },
      }).returning({ id: kiaProformas.id })

      proformaId = inserted[0].id
      createdProformas++
      console.log(`  Created Proforma record (ID: ${proformaId})`)
    }

    // 3. Check if finance processing record exists
    const existingFinance = await db.execute(
      sql`SELECT * FROM kia_finance_processing WHERE proforma_id = ${proformaId}::uuid`
    )

    if (existingFinance.length === 0) {
      const now = new Date()
      const expComp = new Date(now.getTime() + 72 * 60 * 60 * 1000)

      await db.insert(kiaFinanceProcessing).values({
        proformaId,
        financeStatus: 'pending',
        startedAt: now,
        expectedCompletionDate: expComp,
        baseHours: 72,
        currentBankName: bankName,
      })

      createdFinance++
      console.log(`  Created Finance Processing record (Status: pending)`)
    } else {
      console.log(`  Finance Processing record already exists.`)
    }
  }

  console.log(`\n=== REMOVING VINS FROM STOCK MANAGEMENT AND STOCK REPORT ===`)
  for (const vin of vins) {
    await db.execute(sql`DELETE FROM kia_stock_management WHERE vin_number ILIKE ${vin}`)
    await db.execute(sql`DELETE FROM kia_stock_report WHERE vin_number ILIKE ${vin}`)
    console.log(`VIN ${vin}: Deleted from kia_stock_management & kia_stock_report`)
  }

  console.log(`\nSummary:`)
  console.log(`- Created ${createdProformas} Proforma records`)
  console.log(`- Created ${createdFinance} Finance Processing records`)
  console.log(`- Purged ${vins.length} VINs from stock management and stock report tables`)

  process.exit(0)
}

run().catch((err) => {
  console.error('Error executing script:', err)
  process.exit(1)
})
