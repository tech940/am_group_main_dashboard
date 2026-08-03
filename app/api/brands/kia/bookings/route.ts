import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { requirePermission } from '@/lib/permissions/service'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { createKiaBooking, getKiaBookingsList } from '@/lib/kia/bookings'
import { ensureKiaUserProfile } from '@/lib/kia-proforma/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function rowPayload(row: Record<string, unknown>) {
  return {
    ...row,
    proformaNumber: row.proformaId ? String(row.proformaId).slice(0, 8).toUpperCase() : null,
    financeOrderNumber: row.financeOrderId ? String(row.financeOrderId).slice(0, 8).toUpperCase() : null,
  }
}

export async function GET(request: Request) {
  const timer = createApiTimer('kia-bookings-list')
  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.bookings.view'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    // ⚠️ The expired-allocation sweep used to run HERE, on every list load. Measured 2026-08-02: it
    // opened a transaction and cost 514 ms of the request, every time, for work that is almost always
    // a no-op — a transaction is BEGIN + statements + COMMIT, and each round trip to the pooler is
    // ~168 ms, so the wrapper alone dominates. It also made a read endpoint write.
    //
    // The sweep is owned by POST /api/brands/kia/maintenance (app/api/brands/kia/maintenance/route.ts:64),
    // run by npm run kia:maintenance:scheduler. Doing it again per request bought nothing but latency.

    const profile = await timer.time('profile', () => ensureKiaUserProfile(appUser))
    const consultantName = profile?.consultantName || appUser?.fullName

    const url = new URL(request.url)
    const data = await timer.time('list', () => getKiaBookingsList({
      search: url.searchParams.get('search'),
      dealerCode: url.searchParams.get('dealer_code'),
      model: url.searchParams.get('model'),
      status: url.searchParams.get('status'),
      consultant: url.searchParams.get('consultant'),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
      page: Number(url.searchParams.get('page') || 1),
      pageSize: Number(url.searchParams.get('pageSize') || 15),
      sortOrder: url.searchParams.get('sort'),
      unallocated: url.searchParams.get('unallocated'),
      viewer: appUser ? {
        id: appUser.id,
        email: appUser.email,
        role: appUser.role,
        fullName: appUser.fullName,
        consultantName: consultantName,
      } : null,
      // Branch boundary: MD/Developer/global see all; a pinned user only sees their dealer(s).
      allowedDealers: getUserDealerScope(appUser, 'kia'),
    }))

    const payload = {
      rows: data.rows.map((row) => rowPayload(row as unknown as Record<string, unknown>)),
      total: data.pagination.total,
      page: data.pagination.page,
      pageSize: data.pagination.pageSize,
      totalPages: data.pagination.totalPages,
      kpis: data.kpis,
      summary: data.summary,
      filters: data.filters,
    }

    const timing = timer.finish()
    return withServerTiming(NextResponse.json(payload), timing.serverTiming)
  } catch (error) {
    console.error('Failed to load KIA bookings:', error)
    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load KIA bookings' }, { status: 500 }), timing.serverTiming)
  }
}

export async function POST(request: Request) {
  const timer = createApiTimer('kia-bookings-create')
  try {
    const accessResponse = await timer.time('auth', () => requireBrandApiAccess('kia'))
    if (accessResponse) return accessResponse

    const appUser = await getAuthenticatedAppUser()
    const permission = await timer.time('permission', () => requirePermission(appUser, 'kia.bookings.create'))
    if (!permission.allowed) {
      const timing = timer.finish()
      return withServerTiming(NextResponse.json({ error: permission.reason }, { status: 403 }), timing.serverTiming)
    }

    const body = await request.json()
    const booking = await timer.time('create', () => createKiaBooking({
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail || body.customerEmailId,
      customerAddress: body.customerAddress,
      deliveryTargetDate: body.expectedDeliveryDate || body.promiseDate,
      dealerCode: body.dealerCode || 'AM KIA',
      model: body.model,
      variant: body.variant,
      consultantName: body.consultantName,
      color: body.color || body.colorPreference,
      fuelType: body.fuelType,
      source: body.leadSource,
      bankName: body.bankFinance,
      financeRequired: body.bankFinance && body.bankFinance !== 'CASH',
      loanAmount: body.bookingAmount || '0',
      notes: body.notes || body.anyCommitmentWithCustomer,
      requestDiscount: Boolean(body.requestDiscount),
      discountRequestedAmount: body.discountRequestedAmount,
      discountReason: body.discountReason,
      metadata: body,
    }, appUser!))

    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ ...booking, id: booking.id }), timing.serverTiming)
  } catch (error) {
    console.error('Failed to create KIA booking:', error)
    const timing = timer.finish()
    return withServerTiming(NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create KIA booking' }, { status: 400 }), timing.serverTiming)
  }
}
