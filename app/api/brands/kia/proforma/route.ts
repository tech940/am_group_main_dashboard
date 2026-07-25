import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { kiaProformas, kiaBookings, kiaBookingActivity } from '@/lib/db/schema'
import { canApproveKiaProformaForUser, getKiaProformaPendingApprovalFilter, getKiaProformaVisibilityFilter } from '@/lib/kia-proforma/access'
import { ensureKiaUserProfile, touchKiaUserProfile } from '@/lib/kia-proforma/server'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { serializeUtcTimestampFields } from '@/lib/date-time'
import { requirePermission } from '@/lib/permissions/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATE_FIELDS = ['entryTime', 'proformaDate', 'financeUpdatedTime', 'createdAt', 'updatedAt', 'deletedAt'] as const

function serialize(row: Record<string, unknown>) {
  return serializeUtcTimestampFields(row, [...DATE_FIELDS])
}

function readText(body: Record<string, unknown>, key: string) {
  return String(body[key] ?? '').trim()
}

function readAmount(body: Record<string, unknown>, key: string) {
  const parsed = Number(String(body[key] ?? '0').replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00'
}

function readDate(body: Record<string, unknown>, key: string) {
  const value = readText(body, key)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00+05:30`)
  return Number.isNaN(date.getTime()) ? null : date
}

function validatePayload(body: Record<string, unknown>) {
  const required: string[] = [
    'customerType',
    'proformaDate',
    'customerName',
    'mobileNumber',
    'customerAddress',
    'customerEmail',
    'modelName',
    'trimDescription',
    'fuelType',
    'vehicleColor',
    'vehicleStatus',
  ]
  // Bank (and branch) are only mandatory for finance bookings. A CASH payment — flagged by the client
  // via `paymentMode`, or an explicit CASH bank name — leaves them optional.
  const isCash = readText(body, 'paymentMode').toLowerCase() === 'cash'
    || readText(body, 'bankName').toUpperCase() === 'CASH'
  if (!isCash) required.push('bankName')
  const errors: Record<string, string> = {}
  required.forEach((key) => {
    if (!readText(body, key)) errors[key] = 'Required'
  })
  if (!/^\d{10}$/.test(readText(body, 'mobileNumber'))) errors.mobileNumber = 'Mobile number must be 10 digits'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(readText(body, 'customerEmail'))) errors.customerEmail = 'Enter a valid email'
  if (!readDate(body, 'proformaDate')) errors.proformaDate = 'Select a valid proforma date'
  return errors
}

function buildValues(
  body: Record<string, unknown>,
  appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>,
  profile: NonNullable<Awaited<ReturnType<typeof ensureKiaUserProfile>>>,
  dealerCodeFromBooking: string | null = null
) {
  const values: typeof kiaProformas.$inferInsert = {
    proformaDate: readDate(body, 'proformaDate')!,
    customerType: readText(body, 'customerType'),
    customerName: readText(body, 'customerName'),
    mobileNumber: readText(body, 'mobileNumber'),
    customerAddress: readText(body, 'customerAddress'),
    customerEmail: readText(body, 'customerEmail'),
    modelName: readText(body, 'modelName'),
    trimDescription: readText(body, 'trimDescription'),
    fuelType: readText(body, 'fuelType'),
    vehicleColor: readText(body, 'vehicleColor'),
    bankName: readText(body, 'bankName'),
    bankBranch: readText(body, 'bankBranch'),
    vehicleStatus: readText(body, 'vehicleStatus'),
    insuranceCompany: readText(body, 'insuranceCompany'),
    loginEmail: appUser.email,
    consultant: profile.consultantName || appUser.fullName,
    location: dealerCodeFromBooking || (profile.dealerLocation && profile.dealerLocation !== 'all' ? profile.dealerLocation : null) || 'JK402',
    empCode: profile.employeeCode || '',
    createdBy: appUser.id,
    approvalStatus: 'PENDING',
    financeStatus: 'Pending',
    updatedAt: new Date(),
  }
  return {
    ...values,
    loanAmount: readAmount(body, 'loanAmount'),
    exShowroom: readAmount(body, 'exShowroom'),
    tcsValue: readAmount(body, 'tcsValue'),
    registrationCharges: readAmount(body, 'registrationCharges'),
    insuranceValue: readAmount(body, 'insuranceValue'),
    fastagValue: readAmount(body, 'fastagValue'),
    accessoriesKit: readAmount(body, 'accessoriesKit'),
    extWarranty: readAmount(body, 'extWarranty'),
    cashDiscount: readAmount(body, 'cashDiscount'),
    exchangeValue: readAmount(body, 'exchangeValue'),
    bookingAmount: readAmount(body, 'bookingAmount'),
    govtEmployeeDiscount: readAmount(body, 'govtEmployeeDiscount'),
    additionalDiscount: readAmount(body, 'additionalDiscount'),
    totalCustomerCost: readAmount(body, 'totalCustomerCost'),
    grandTotalCost: readAmount(body, 'grandTotalCost'),
  }
}

export async function GET(request: NextRequest) {
  const timer = createApiTimer('kia-proforma')
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await timer.time('permission:view', () => requirePermission(appUser, 'kia.proforma.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await timer.time('profile', () => ensureKiaUserProfile(appUser))
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isApprover = await timer.time('permissions', () => canApproveKiaProformaForUser(appUser, profile.approver))

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || 1) || 1)
    const pageSize = Math.min(1000, Math.max(10, Number(searchParams.get('pageSize') || 50) || 50))
    const search = String(searchParams.get('search') || '').trim()
    const mode = String(searchParams.get('mode') || 'all')
    const financeStatus = String(searchParams.get('financeStatus') || 'all')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const filters = [getKiaProformaVisibilityFilter(appUser, isApprover)]
    if (mode === 'pending-approval') {
      if (!isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      filters.push(getKiaProformaPendingApprovalFilter())
    }
    if (financeStatus !== 'all') filters.push(eq(kiaProformas.financeStatus, financeStatus))
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) filters.push(gte(kiaProformas.proformaDate, new Date(`${startDate}T00:00:00+05:30`)))
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) filters.push(lte(kiaProformas.proformaDate, new Date(`${endDate}T23:59:59+05:30`)))
    if (search) {
      const like = `%${search}%`
      filters.push(or(
        ilike(kiaProformas.customerName, like),
        ilike(kiaProformas.mobileNumber, like),
        ilike(kiaProformas.bankName, like),
        ilike(kiaProformas.insuranceCompany, like),
        ilike(kiaProformas.bankBranch, like),
        ilike(kiaProformas.modelName, like),
        ilike(kiaProformas.customerEmail, like),
        sql`${kiaProformas.id}::text ILIKE ${like}`
      )!)
    }

    const whereExpression = and(...filters)
    const offset = (page - 1) * pageSize
    const [[total], rows] = await timer.time('query', () => Promise.all([
      db.select({ value: count() }).from(kiaProformas).where(whereExpression),
      db.select().from(kiaProformas).where(whereExpression).orderBy(desc(kiaProformas.proformaDate), desc(kiaProformas.entryTime)).limit(pageSize).offset(offset),
    ]))
    const proformaIds = rows.map((row) => row.id)
    const linkedBookings = proformaIds.length
      ? await db
        .select({
          proformaId: kiaBookings.proformaId,
          bookingId: kiaBookings.id,
          bookingNumber: kiaBookings.bookingNumber,
          bookingStatus: kiaBookings.status,
        })
        .from(kiaBookings)
        .where(and(
          isNull(kiaBookings.deletedAt),
          inArray(kiaBookings.proformaId, proformaIds),
        ))
      : []
    const linkedBookingMap = new Map(
      linkedBookings.map((row) => [row.proformaId, row]),
    )

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json({
      currentUser: {
        id: appUser.id,
        email: appUser.email,
        fullName: appUser.fullName,
        role: appUser.role,
        isApprover,
      },
      profile,
      rows: rows.map((row) => serialize({
        ...(row as Record<string, unknown>),
        linkedBookingId: linkedBookingMap.get(row.id)?.bookingId || null,
        linkedBookingNumber: linkedBookingMap.get(row.id)?.bookingNumber || null,
        linkedBookingStatus: linkedBookingMap.get(row.id)?.bookingStatus || null,
      })),
      pagination: {
        page,
        pageSize,
        totalRows: Number(total?.value || 0),
        totalPages: Math.max(1, Math.ceil(Number(total?.value || 0) / pageSize)),
      },
    }), serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/kia/proforma:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessResponse = await requireBrandApiAccess('kia')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'kia.proforma.create')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await ensureKiaUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const errors = validatePayload(body)
    if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 400 })

    const bookingId = readText(body, 'bookingId')
    const forceSave = body.forceSave === true

    // ── Strict Booking Duplicate Guard ───────────────────────────────────────
    // If a proforma is already generated/linked to this booking, reject duplicate creation.
    if (bookingId) {
      const [existingBooking] = await db
        .select({
          proformaId: kiaBookings.proformaId,
          bookingNumber: kiaBookings.bookingNumber,
        })
        .from(kiaBookings)
        .where(eq(kiaBookings.id, bookingId))
        .limit(1)
      if (existingBooking?.proformaId) {
        return NextResponse.json({
          error: `A Proforma Invoice is already generated and linked to booking #${existingBooking.bookingNumber}. Duplicate proformas are not allowed.`,
          existingProformaId: existingBooking.proformaId,
        }, { status: 409 })
      }
    }

    // ── Customer Details Duplicate Guard ─────────────────────────────────────
    // Check for any existing non-deleted proforma with the same mobile, email,
    // or customer name. Allow override with forceSave=true only if bookingId is not linked.
    if (!forceSave) {
      const mobile = readText(body, 'mobileNumber')
      const email = readText(body, 'customerEmail').toLowerCase()
      const name = readText(body, 'customerName').toLowerCase()
      const [existing] = await db
        .select({
          id: kiaProformas.id,
          proformaDate: kiaProformas.proformaDate,
          customerName: kiaProformas.customerName,
          mobileNumber: kiaProformas.mobileNumber,
          customerEmail: kiaProformas.customerEmail,
        })
        .from(kiaProformas)
        .where(
          and(
            isNull(kiaProformas.deletedAt),
            or(
              eq(kiaProformas.mobileNumber, mobile),
              ilike(kiaProformas.customerEmail, email),
              ilike(kiaProformas.customerName, name),
            )!,
          ),
        )
        .orderBy(desc(kiaProformas.proformaDate))
        .limit(1)
      if (existing) {
        return NextResponse.json({
          duplicate: true,
          existingId: existing.id,
          existingDate: existing.proformaDate,
          customerName: existing.customerName,
          matchedOn: mobile === existing.mobileNumber ? 'mobile' : existing.customerEmail?.toLowerCase() === email ? 'email' : 'name',
        }, { status: 409 })
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    const created = await db.transaction(async (tx) => {
      let dealerCodeFromBooking: string | null = null
      if (bookingId) {
        const [booking] = await tx
          .select({ dealerCode: kiaBookings.dealerCode })
          .from(kiaBookings)
          .where(eq(kiaBookings.id, bookingId))
          .limit(1)
        if (booking) {
          dealerCodeFromBooking = booking.dealerCode
        }
      }

      const [proforma] = await tx
        .insert(kiaProformas)
        .values(buildValues(body, appUser, profile, dealerCodeFromBooking))
        .returning()

      if (bookingId) {
        // Link to booking. The status will update to proforma_generated when approved.
        await tx
          .update(kiaBookings)
          .set({
            proformaId: proforma.id,
            updatedAt: new Date(),
            updatedBy: appUser.id,
          })
          .where(eq(kiaBookings.id, bookingId))

        // Create booking timeline activity
        await tx.insert(kiaBookingActivity).values({
          bookingId,
          activityType: 'proforma',
          title: 'Proforma generated & linked',
          description: `Linked proforma ${proforma.id.slice(0, 8).toUpperCase()} (pending manager approval)`,
          actorUserId: appUser.id,
          actorName: appUser.fullName,
          actorRole: appUser.role,
        })
      }
      return proforma
    })

    await touchKiaUserProfile(appUser.email)
    return NextResponse.json({ row: serialize(created as Record<string, unknown>) }, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/brands/kia/proforma:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
