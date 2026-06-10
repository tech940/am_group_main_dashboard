import { NextRequest, NextResponse } from 'next/server'
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { mgProformas } from '@/lib/db/schema'
import { canApproveMgProformaForUser, getMgProformaVisibilityFilter } from '@/lib/mg-proforma/access'
import { ensureMgUserProfile, touchMgUserProfile } from '@/lib/mg-proforma/server'
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
  const required = [
    'proformaDate',
    'customerName',
    'mobileNumber',
    'customerAddress',
    'modelName',
    'trimDescription',
    'fuelType',
    'vehicleColor',
    'bankName',
  ] as const
  const errors: Record<string, string> = {}
  required.forEach((key) => {
    if (!readText(body, key)) errors[key] = 'Required'
  })
  if (!/^\d{10}$/.test(readText(body, 'mobileNumber'))) errors.mobileNumber = 'Mobile number must be 10 digits'
  const email = readText(body, 'customerEmail')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.customerEmail = 'Enter a valid email'
  if (!readDate(body, 'proformaDate')) errors.proformaDate = 'Select a valid proforma date'
  return errors
}

function buildValues(body: Record<string, unknown>, appUser: NonNullable<Awaited<ReturnType<typeof getAuthenticatedAppUser>>>, profile: NonNullable<Awaited<ReturnType<typeof ensureMgUserProfile>>>) {
  const values: typeof mgProformas.$inferInsert = {
    proformaDate: readDate(body, 'proformaDate')!,
    customerType: 'Customer',
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
    vehicleStatus: 'UNKNOWN',
    insuranceCompany: readText(body, 'insuranceCompany'),
    loginEmail: appUser.email,
    consultant: profile.consultantName || appUser.fullName,
    location: profile.dealerLocation || appUser.brand || 'mg',
    empCode: profile.employeeCode || '',
    createdBy: appUser.id,
    approvalStatus: 'PENDING',
    financeStatus: 'Pending',
    updatedAt: new Date(),
  }
  return {
    ...values,
    loanAmount: '0.00',
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
  const timer = createApiTimer('mg-proforma')
  try {
    const accessResponse = await requireBrandApiAccess('mg')
    if (accessResponse) return accessResponse

    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await timer.time('permission:view', () => requirePermission(appUser, 'mg.proforma.view'))
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await timer.time('profile', () => ensureMgUserProfile(appUser))
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const isApprover = await timer.time('permissions', () => canApproveMgProformaForUser(appUser, profile.approver))

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number(searchParams.get('page') || 1) || 1)
    const pageSize = Math.min(1000, Math.max(10, Number(searchParams.get('pageSize') || 50) || 50))
    const search = String(searchParams.get('search') || '').trim()
    const mode = String(searchParams.get('mode') || 'all')
    const financeStatus = String(searchParams.get('financeStatus') || 'all')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const filters = [getMgProformaVisibilityFilter(appUser, isApprover)]
    if (mode === 'pending-approval') {
      if (!isApprover) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      filters.push(sql`${mgProformas.approvalStatus} <> 'APPROVED'`)
    }
    if (financeStatus !== 'all') filters.push(eq(mgProformas.financeStatus, financeStatus))
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) filters.push(gte(mgProformas.proformaDate, new Date(`${startDate}T00:00:00+05:30`)))
    if (endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) filters.push(lte(mgProformas.proformaDate, new Date(`${endDate}T23:59:59+05:30`)))
    if (search) {
      const like = `%${search}%`
      filters.push(or(
        ilike(mgProformas.customerName, like),
        ilike(mgProformas.mobileNumber, like),
        ilike(mgProformas.bankName, like),
        ilike(mgProformas.insuranceCompany, like),
        ilike(mgProformas.bankBranch, like),
        ilike(mgProformas.modelName, like),
        ilike(mgProformas.customerEmail, like),
        ilike(mgProformas.location, like),
        ilike(mgProformas.checkedBy, like),
        ilike(mgProformas.emailSendStatus, like),
        ilike(mgProformas.approvalStatus, like)
      )!)
    }

    const whereExpression = and(...filters)
    const offset = (page - 1) * pageSize
    const [[total], rows] = await timer.time('query', () => Promise.all([
      db.select({ value: count() }).from(mgProformas).where(whereExpression),
      db.select().from(mgProformas).where(whereExpression).orderBy(desc(mgProformas.proformaDate), desc(mgProformas.entryTime)).limit(pageSize).offset(offset),
    ]))

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
      rows: rows.map((row) => serialize(row as Record<string, unknown>)),
      pagination: {
        page,
        pageSize,
        totalRows: Number(total?.value || 0),
        totalPages: Math.max(1, Math.ceil(Number(total?.value || 0) / pageSize)),
      },
    }), serverTiming)
  } catch (error) {
    console.error('Error in GET /api/brands/mg/proforma:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessResponse = await requireBrandApiAccess('mg')
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permission = await requirePermission(appUser, 'mg.proforma.create')
    if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })
    const profile = await ensureMgUserProfile(appUser)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const errors = validatePayload(body)
    if (Object.keys(errors).length > 0) return NextResponse.json({ errors }, { status: 400 })

    const [created] = await db
      .insert(mgProformas)
      .values(buildValues(body, appUser, profile))
      .returning()

    await touchMgUserProfile(appUser.email)
    return NextResponse.json({ row: serialize(created as Record<string, unknown>) }, { status: 201 })
  } catch (error) {
    console.error('Error in POST /api/brands/mg/proforma:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
