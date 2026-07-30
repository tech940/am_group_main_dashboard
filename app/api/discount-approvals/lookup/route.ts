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
      return NextResponse.json({ error: 'VIN/Chassis number is required' }, { status: 400 })
    }

    const normalizedBranch = branch.toLowerCase()
    const upperVin = vin.toUpperCase()

    if (normalizedBranch === 'hyundai') {
      // 1. Search in hyundai_sales_report for order_ref_no associated with this vin_number or order_ref_no
      const salesResult = await db.execute(sql.raw(`
        SELECT order_ref_no 
        FROM hyundai_sales_report 
        WHERE (UPPER(vin_number) = '${upperVin.replace(/'/g, "''")}' OR UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}')
          AND order_ref_no IS NOT NULL 
        LIMIT 1
      `))

      let orderRefNo = (salesResult[0] as { order_ref_no?: string })?.order_ref_no

      // 2. Query hyundai_booking_report by order_ref_no (either resolved or directly matching vin as order_ref_no or customer_id)
      let queryStr = ''
      if (orderRefNo) {
        queryStr = `SELECT *
                   FROM hyundai_booking_report 
                   WHERE order_ref_no = '${orderRefNo.replace(/'/g, "''")}' 
                   LIMIT 1`
      } else {
        queryStr = `SELECT *
                   FROM hyundai_booking_report 
                   WHERE (UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}' OR UPPER(customer_id) = '${upperVin.replace(/'/g, "''")}') 
                   LIMIT 1`
      }

      const bookingResult = await db.execute(sql.raw(queryStr))
      const booking = bookingResult[0] as Record<string, any> | undefined

      if (!booking) {
        return NextResponse.json({ error: 'No matching booking record found' }, { status: 404 })
      }

      // 3. Search delivery_date & consultant_name in hyundai_sales_report
      let deliveryDate: string | null = null
      let salesConsultantName: string | null = null
      const targetOrderRef = booking.order_ref_no || ''
      const targetCustomerId = booking.customer_id || ''
      const salesQueryStr = `
        SELECT delivery_date, consultant_name 
        FROM hyundai_sales_report 
        WHERE (
          UPPER(vin_number) = '${upperVin.replace(/'/g, "''")}' OR 
          UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}' OR
          UPPER(customerid) = '${upperVin.replace(/'/g, "''")}'
          ${targetOrderRef ? `OR UPPER(order_ref_no) = '${targetOrderRef.toUpperCase().replace(/'/g, "''")}'` : ''}
          ${targetCustomerId ? `OR UPPER(customerid) = '${targetCustomerId.toUpperCase().replace(/'/g, "''")}'` : ''}
          ${targetCustomerId ? `OR UPPER(vin_number) = '${targetCustomerId.toUpperCase().replace(/'/g, "''")}'` : ''}
        ) AND delivery_date IS NOT NULL
        LIMIT 1
      `
      const salesRowResult = await db.execute(sql.raw(salesQueryStr))
      if (salesRowResult.length > 0) {
        const row = salesRowResult[0] as { delivery_date?: any; consultant_name?: string }
        const rawDate = row.delivery_date
        salesConsultantName = row.consultant_name || null
        if (rawDate) {
          try {
            deliveryDate = new Date(rawDate).toISOString().slice(0, 10)
          } catch {
            deliveryDate = null
          }
        }
      }

      return NextResponse.json({
        customerName: booking.name_of_the_customer || '',
        model: booking.model || '',
        variant: booking.variant || '',
        color: booking.color || '',
        consultantName: salesConsultantName || booking.consultant_name || '',
        tlManager: booking.team_leader || '',
        amountReceived: booking.amount_received ? Number(booking.amount_received) : 0,
        deliveryDate,
        rawData: booking,
      })
    } else if (normalizedBranch === 'platinum') {
      // Query am_platinum_booking_report directly (by customer_id or order_ref_no)
      const bookingResult = await db.execute(sql.raw(`
        SELECT *
        FROM am_platinum_booking_report 
        WHERE (UPPER(customer_id) = '${upperVin.replace(/'/g, "''")}' OR UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}') 
        LIMIT 1
      `))
      const booking = bookingResult[0] as Record<string, any> | undefined

      if (!booking) {
        return NextResponse.json({ error: 'No matching booking record found' }, { status: 404 })
      }

      // Search delivery_date & consultant_name in am_platinum_sales_report
      let deliveryDate: string | null = null
      let salesConsultantName: string | null = null
      const targetOrderRef = booking.order_ref_no || ''
      const targetCustomerId = booking.customer_id || ''
      const salesQueryStr = `
        SELECT delivery_date, consultant_name 
        FROM am_platinum_sales_report 
        WHERE (
          UPPER(vin_number) = '${upperVin.replace(/'/g, "''")}' OR 
          UPPER(order_ref_no) = '${upperVin.replace(/'/g, "''")}' OR
          UPPER(customerid) = '${upperVin.replace(/'/g, "''")}'
          ${targetOrderRef ? `OR UPPER(order_ref_no) = '${targetOrderRef.toUpperCase().replace(/'/g, "''")}'` : ''}
          ${targetCustomerId ? `OR UPPER(customerid) = '${targetCustomerId.toUpperCase().replace(/'/g, "''")}'` : ''}
          ${targetCustomerId ? `OR UPPER(vin_number) = '${targetCustomerId.toUpperCase().replace(/'/g, "''")}'` : ''}
        ) AND delivery_date IS NOT NULL
        LIMIT 1
      `
      const salesRowResult = await db.execute(sql.raw(salesQueryStr))
      if (salesRowResult.length > 0) {
        const row = salesRowResult[0] as { delivery_date?: any; consultant_name?: string }
        const rawDate = row.delivery_date
        salesConsultantName = row.consultant_name || null
        if (rawDate) {
          try {
            deliveryDate = new Date(rawDate).toISOString().slice(0, 10)
          } catch {
            deliveryDate = null
          }
        }
      }

      return NextResponse.json({
        customerName: booking.name_of_the_customer || '',
        model: booking.model || '',
        variant: booking.variant || '',
        color: booking.color || '',
        consultantName: salesConsultantName || booking.consultant_name || '',
        tlManager: booking.team_leader || '',
        amountReceived: booking.amount_received ? Number(booking.amount_received) : 0,
        deliveryDate,
        rawData: booking,
      })
    } else {
      return NextResponse.json({ error: 'Invalid branch selection' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error during discount approvals lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
