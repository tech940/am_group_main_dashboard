import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branch = url.searchParams.get('branch') || ''
    const vin = (url.searchParams.get('vin') || '').trim()

    if (!vin) {
      return NextResponse.json({ error: 'VIN / Customer ID is required' }, { status: 400 })
    }

    const normalizedBranch = branch.toLowerCase()
    let bookingTable = ''
    let salesTable = ''

    if (normalizedBranch === 'hyundai') {
      bookingTable = 'hyundai_booking_report'
      salesTable = 'hyundai_sales_report'
    } else if (normalizedBranch === 'platinum') {
      bookingTable = 'am_platinum_booking_report'
      salesTable = 'am_platinum_sales_report'
    } else {
      return NextResponse.json({ error: 'Invalid branch selection' }, { status: 400 })
    }

    const escapedVin = vin.toUpperCase().replace(/'/g, "''")

    // 1. Query booking table directly
    const bookingQuery = sql.raw(`
      SELECT *
      FROM ${bookingTable}
      WHERE (
        UPPER(customer_id) = '${escapedVin}' 
        OR UPPER(order_ref_no) = '${escapedVin}'
        OR UPPER(contact_number) = '${escapedVin}'
      )
      LIMIT 1
    `)
    const bookingResult = await db.execute(bookingQuery)
    let booking = (bookingResult[0] as Record<string, any>) || null

    // 2. Query sales table directly
    const salesQuery = sql.raw(`
      SELECT *
      FROM ${salesTable}
      WHERE (
        UPPER(customerid) = '${escapedVin}'
        OR UPPER(vin_number) = '${escapedVin}'
        OR UPPER(order_ref_no) = '${escapedVin}'
        OR UPPER(invoice_no) = '${escapedVin}'
        OR UPPER(hmi_invoice_no) = '${escapedVin}'
      )
      LIMIT 1
    `)
    const salesResult = await db.execute(salesQuery)
    let sales = (salesResult[0] as Record<string, any>) || null

    // 3. If booking found but sales not found, try cross-referencing sales table using booking keys
    if (booking && !sales) {
      const bOrderRef = (booking.order_ref_no || '').toString().trim().toUpperCase().replace(/'/g, "''")
      const bCustId = (booking.customer_id || '').toString().trim().toUpperCase().replace(/'/g, "''")
      const conditions: string[] = []
      if (bOrderRef) conditions.push(`UPPER(order_ref_no) = '${bOrderRef}'`)
      if (bCustId) {
        conditions.push(`UPPER(customerid) = '${bCustId}'`)
        conditions.push(`UPPER(vin_number) = '${bCustId}'`)
      }
      if (conditions.length > 0) {
        const crossSales = await db.execute(sql.raw(`
          SELECT * FROM ${salesTable}
          WHERE (${conditions.join(' OR ')})
          LIMIT 1
        `))
        if (crossSales.length > 0) {
          sales = crossSales[0] as Record<string, any>
        }
      }
    }

    // 4. If sales found but booking not found, try cross-referencing booking table using sales keys
    if (sales && !booking) {
      const sOrderRef = (sales.order_ref_no || '').toString().trim().toUpperCase().replace(/'/g, "''")
      const sCustId = (sales.customerid || '').toString().trim().toUpperCase().replace(/'/g, "''")
      const conditions: string[] = []
      if (sOrderRef) conditions.push(`UPPER(order_ref_no) = '${sOrderRef}'`)
      if (sCustId) conditions.push(`UPPER(customer_id) = '${sCustId}'`)
      if (conditions.length > 0) {
        const crossBooking = await db.execute(sql.raw(`
          SELECT * FROM ${bookingTable}
          WHERE (${conditions.join(' OR ')})
          LIMIT 1
        `))
        if (crossBooking.length > 0) {
          booking = crossBooking[0] as Record<string, any>
        }
      }
    }

    // If neither record exists
    if (!booking && !sales) {
      return NextResponse.json({ error: 'No matching booking or sales record found' }, { status: 404 })
    }

    // Extract delivery date
    let deliveryDate: string | null = null
    const rawDeliveryDate = sales?.delivery_date || sales?.confirm_date || booking?.committed_delivery_date
    if (rawDeliveryDate) {
      try {
        deliveryDate = new Date(rawDeliveryDate).toISOString().slice(0, 10)
      } catch {
        deliveryDate = null
      }
    }

    // Extract insurance type
    let insuranceType: 'In House' | 'Out House' | '' = ''
    if (sales?.insurance_in_house_y_n) {
      const val = sales.insurance_in_house_y_n.toString().trim().toUpperCase()
      if (val === 'Y' || val === 'YES' || val === 'IN HOUSE') insuranceType = 'In House'
      else if (val === 'N' || val === 'NO' || val === 'OUT HOUSE') insuranceType = 'Out House'
    }

    // Extract discount amount
    let discountAmount: number | undefined
    if (sales?.dealer_cash_discount && !isNaN(Number(sales.dealer_cash_discount))) {
      discountAmount = Number(sales.dealer_cash_discount)
    }

    // Extract amount received
    const amountReceived = booking?.amount_received 
      ? Number(booking.amount_received) 
      : (sales?.basic_amount ? Number(sales.basic_amount) : 0)

    const customerName = booking?.name_of_the_customer || sales?.registration_name || ''
    const model = booking?.model || sales?.model || ''
    const variant = booking?.variant || sales?.variant || ''
    const color = booking?.color || sales?.color || ''
    const consultantName = sales?.consultant_name || booking?.consultant_name || ''
    const tlManager = booking?.team_leader || ''

    return NextResponse.json({
      customerName,
      model,
      variant,
      color,
      consultantName,
      tlManager,
      insuranceType,
      discountAmount,
      amountReceived,
      deliveryDate,
      rawData: { ...booking, ...sales },
    })
  } catch (error) {
    console.error('Error during discount approvals lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

