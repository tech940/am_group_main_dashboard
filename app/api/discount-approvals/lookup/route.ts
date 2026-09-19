import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql, type SQL } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import {
  canAccessDiscountBranch,
  canViewDiscountApprovals,
  isDiscountApprovalBranch,
  NEVER_SERIALISED_FEED_FIELDS,
} from '@/lib/discount-approvals/access'

export const dynamic = 'force-dynamic'

/*
 * Customer lookup behind the Hyundai / Platinum discount forms. Two callers, two answers:
 *
 *  - the PUBLIC submit forms (/brands/<brand>/discount-approvals/submit — no login, by design) get only
 *    what they prefill: name, car, consultant, team leader, insurance type, delivery date. Matched on the
 *    customer ID / order ref / VIN / invoice numbers the form asks for — NOT on a phone number.
 *  - a logged-in approver (section permission + that brand) also gets the full booking + sales rows for
 *    the dashboard's detail drawer, minus PAN and GST number, and may search by phone.
 *
 * ⚠️ Until 2026-09-19 every caller, anonymous included, got `rawData`: the complete DMS rows — PAN,
 * every contact number, home address and PIN, GST number — for any phone number, VIN or customer ID they
 * typed. And every query was assembled with sql.raw. Both are fixed here; keep the two tiers.
 */

const FEEDS = {
  hyundai: { booking: 'hyundai_booking_report', sales: 'hyundai_sales_report' },
  platinum: { booking: 'am_platinum_booking_report', sales: 'am_platinum_sales_report' },
} as const

type Row = Record<string, unknown>

const up = (v: unknown) => String(v ?? '').trim().toUpperCase()

function firstRow(result: unknown): Row | null {
  return Array.isArray(result) && result.length > 0 ? (result[0] as Row) : null
}

/** `col = value OR …`, parameterised; empty values are skipped so '' can never match a blank column. */
function anyEquals(pairs: Array<[column: string, value: string]>): SQL | null {
  const parts = pairs.filter(([, value]) => value !== '').map(([column, value]) => sql`UPPER(${sql.raw(column)}) = ${value}`)
  return parts.length ? sql.join(parts, sql` OR `) : null
}

async function findOne(table: string, where: SQL | null): Promise<Row | null> {
  if (!where) return null
  return firstRow(await db.execute(sql`SELECT * FROM ${sql.raw(table)} WHERE (${where}) LIMIT 1`))
}

function withoutNeverSerialised(row: Row): Row {
  const copy = { ...row }
  for (const key of NEVER_SERIALISED_FEED_FIELDS) delete copy[key]
  return copy
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const branch = (url.searchParams.get('branch') || '').trim().toLowerCase()
    const key = up(url.searchParams.get('vin'))

    if (!key) {
      return NextResponse.json({ error: 'VIN / Customer ID is required' }, { status: 400 })
    }
    if (key.length > 64) {
      return NextResponse.json({ error: 'That Customer ID is too long' }, { status: 400 })
    }
    if (!isDiscountApprovalBranch(branch)) {
      return NextResponse.json({ error: 'Invalid branch selection' }, { status: 400 })
    }
    const feed = FEEDS[branch]

    // The full tier needs the section permission AND this brand. Anyone else — including a logged-in
    // employee without them — gets the public tier.
    const appUser = await getAuthenticatedAppUser().catch(() => null)
    const full = Boolean(appUser) && (await canViewDiscountApprovals(appUser)) && (await canAccessDiscountBranch(appUser, branch))

    // 1 + 2. Direct matches. A phone number is a search key for approvers only.
    let booking = await findOne(feed.booking, anyEquals([
      ['customer_id', key],
      ['order_ref_no', key],
      ...(full ? ([['contact_number', key]] as Array<[string, string]>) : []),
    ]))
    let sales = await findOne(feed.sales, anyEquals([
      ['customerid', key],
      ['vin_number', key],
      ['order_ref_no', key],
      ['invoice_no', key],
      ['hmi_invoice_no', key],
    ]))

    // 3. Booking found, sales not: cross-reference the sales feed by the booking's own keys.
    if (booking && !sales) {
      const orderRef = up(booking.order_ref_no)
      const custId = up(booking.customer_id)
      sales = await findOne(feed.sales, anyEquals([['order_ref_no', orderRef], ['customerid', custId], ['vin_number', custId]]))
    }

    // 4. Sales found, booking not: the reverse.
    if (sales && !booking) {
      booking = await findOne(feed.booking, anyEquals([['order_ref_no', up(sales.order_ref_no)], ['customer_id', up(sales.customerid)]]))
    }

    if (!booking && !sales) {
      return NextResponse.json({ error: 'No matching booking or sales record found' }, { status: 404 })
    }

    let deliveryDate: string | null = null
    const rawDeliveryDate = sales?.delivery_date || sales?.confirm_date || booking?.committed_delivery_date
    if (rawDeliveryDate) {
      const parsed = new Date(String(rawDeliveryDate instanceof Date ? rawDeliveryDate.toISOString() : rawDeliveryDate))
      deliveryDate = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
    }

    let insuranceType: 'In House' | 'Out House' | '' = ''
    if (sales?.insurance_in_house_y_n) {
      const val = up(sales.insurance_in_house_y_n)
      if (val === 'Y' || val === 'YES' || val === 'IN HOUSE') insuranceType = 'In House'
      else if (val === 'N' || val === 'NO' || val === 'OUT HOUSE') insuranceType = 'Out House'
    }

    // What the public form prefills — nothing more.
    const prefill = {
      customerName: text(booking?.name_of_the_customer || sales?.registration_name),
      model: text(booking?.model || sales?.model),
      variant: text(booking?.variant || sales?.variant),
      color: text(booking?.color || sales?.color),
      consultantName: text(sales?.consultant_name || booking?.consultant_name),
      tlManager: text(booking?.team_leader),
      insuranceType,
      deliveryDate,
    }
    if (!full) return NextResponse.json(prefill)

    const discountAmount = sales?.dealer_cash_discount && !Number.isNaN(Number(sales.dealer_cash_discount))
      ? Number(sales.dealer_cash_discount)
      : undefined
    const amountReceived = booking?.amount_received
      ? Number(booking.amount_received)
      : (sales?.basic_amount ? Number(sales.basic_amount) : 0)

    return NextResponse.json({
      ...prefill,
      discountAmount,
      amountReceived,
      rawData: withoutNeverSerialised({ ...(booking ?? {}), ...(sales ?? {}) }),
    })
  } catch (error) {
    console.error('Error during discount approvals lookup:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
