import 'server-only'

import { and, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsDb } from '@/lib/analytics/db'
import {
  financeOrderWorkflow,
  financeOrders,
  kiaBookingActivity,
  kiaBookings,
  kiaProformas,
  kiaVehicleAllocations,
  kiaVehicleTransfers,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'

type JsonRecord = Record<string, unknown>
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
const TEMPORARY_ALLOCATION_HOURS = 72

export const KIA_BOOKING_STATUSES = [
  'draft',
  'booking_created',
  'proforma_generated',
  'vehicle_allocated',
  'transfer_requested',
  'finance_pending',
  'ready_delivery',
  'delivered',
  'cancelled',
] as const

export type KiaBookingStatus = typeof KIA_BOOKING_STATUSES[number]

export type BookingListInput = {
  search?: string | null
  dealerCode?: string | null
  model?: string | null
  status?: string | null
  consultant?: string | null
  page?: number | null
  pageSize?: number | null
}

export type CreateBookingInput = {
  customerName?: string
  customerPhone?: string
  dealerCode?: string
  model?: string
  variant?: string
  consultantName?: string
  customerEmail?: string | null
  customerAddress?: string | null
  color?: string | null
  fuelType?: string | null
  source?: string | null
  financeRequired?: boolean
  bankName?: string | null
  loanAmount?: string | number | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
}

export type UpdateBookingInput = Partial<CreateBookingInput> & {
  status?: string | null
  deliveryTargetDate?: string | null
  delivered?: boolean
}

function rows<T extends JsonRecord = JsonRecord>(result: unknown): T[] {
  return Array.isArray(result) ? result as T[] : []
}

function text(value: unknown) {
  return String(value ?? '').trim()
}

function nullableText(value: unknown) {
  const normalized = text(value)
  return normalized || null
}

function normalizeStatus(value: unknown): KiaBookingStatus {
  const normalized = text(value).toLowerCase()
  return KIA_BOOKING_STATUSES.includes(normalized as KiaBookingStatus) ? normalized as KiaBookingStatus : 'booking_created'
}

function numericText(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0'
}

function pageParams(input: BookingListInput) {
  const page = Math.max(1, Math.floor(Number(input.page || 1)))
  const pageSize = Math.min(50, Math.max(10, Math.floor(Number(input.pageSize || 10))))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function actor(appUser: AppUser) {
  return {
    actorUserId: appUser.id,
    actorName: appUser.fullName,
    actorRole: appUser.role,
  }
}

async function addActivity(tx: DbTx, params: {
  bookingId: string
  type: string
  title: string
  description?: string | null
  before?: JsonRecord | null
  after?: JsonRecord | null
  appUser: AppUser
}) {
  await tx.insert(kiaBookingActivity).values({
    bookingId: params.bookingId,
    activityType: params.type,
    title: params.title,
    description: params.description || null,
    beforeValue: params.before || null,
    afterValue: params.after || null,
    ...actor(params.appUser),
  })
}

async function nextBookingNumber(tx: DbTx) {
  const result = await tx.execute(sql<{ seq: string }>`SELECT nextval('public.kia_booking_number_seq')::text AS seq`)
  const seq = text(rows<{ seq: string }>(result)[0]?.seq || '0').padStart(5, '0')
  return `KIB-${new Date().getFullYear()}-${seq}`
}

export async function expireKiaTemporaryAllocations() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      WITH expired AS (
        UPDATE kia_vehicle_allocations
        SET
          released_at = now(),
          release_reason = 'Temporary allocation expired after 72 hours without payment confirmation',
          allocation_status = 'expired',
          updated_at = now()
        WHERE released_at IS NULL
          AND payment_confirmed_at IS NULL
          AND allocation_status = 'temporary'
          AND expires_at IS NOT NULL
          AND expires_at <= now()
        RETURNING booking_id, vin_number
      ),
      updated_bookings AS (
        UPDATE kia_bookings kb
        SET
          allocated_vin = NULL,
          status = CASE WHEN kb.proforma_id IS NULL THEN 'booking_created' ELSE 'proforma_generated' END,
          updated_at = now()
        FROM expired e
        WHERE kb.id = e.booking_id
        RETURNING kb.id, e.vin_number
      )
      INSERT INTO kia_booking_activity (
        booking_id,
        activity_type,
        title,
        description,
        actor_name,
        actor_role,
        after_value
      )
      SELECT
        id,
        'allocation_expired',
        'Temporary allocation expired',
        'VIN ' || vin_number || ' released after 72 hours without payment confirmation',
        'System',
        'system',
        jsonb_build_object('vinNumber', vin_number, 'reason', '72-hour payment window expired')
      FROM updated_bookings
    `)
  })
}

function listFilters(input: BookingListInput) {
  const filters = [isNull(kiaBookings.deletedAt)]
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  if (dealerCode) filters.push(eq(kiaBookings.dealerCode, dealerCode))
  if (text(input.model) && text(input.model).toLowerCase() !== 'all') filters.push(ilike(kiaBookings.model, text(input.model)))
  if (text(input.status) && text(input.status).toLowerCase() !== 'all') filters.push(eq(kiaBookings.status, normalizeStatus(input.status)))
  if (text(input.consultant) && text(input.consultant).toLowerCase() !== 'all') filters.push(ilike(kiaBookings.consultantName, text(input.consultant)))

  const search = text(input.search)
  if (search) {
    const like = `%${search}%`
    filters.push(or(
      ilike(kiaBookings.bookingNumber, like),
      ilike(kiaBookings.customerName, like),
      ilike(kiaBookings.customerPhone, like),
      ilike(kiaBookings.model, like),
      ilike(kiaBookings.variant, like),
      ilike(kiaBookings.allocatedVin, like),
    )!)
  }

  return and(...filters)!
}

export async function getKiaBookingsList(input: BookingListInput) {
  await expireKiaTemporaryAllocations()
  const { page, pageSize, offset } = pageParams(input)
  const where = listFilters(input)

  const [totalRows, bookingRows, statusRows, dealerRows, modelRows, consultantRows] = await Promise.all([
    db.select({ value: count() }).from(kiaBookings).where(where),
    db.select().from(kiaBookings).where(where).orderBy(desc(kiaBookings.updatedAt), desc(kiaBookings.createdAt)).limit(pageSize).offset(offset),
    db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM kia_bookings
      WHERE deleted_at IS NULL
      GROUP BY status
      ORDER BY status
    `),
    db.execute(sql`SELECT DISTINCT dealer_code AS value FROM kia_bookings WHERE deleted_at IS NULL AND dealer_code IS NOT NULL ORDER BY dealer_code`),
    db.execute(sql`SELECT DISTINCT model AS value FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL ORDER BY model`),
    db.execute(sql`SELECT DISTINCT consultant_name AS value FROM kia_bookings WHERE deleted_at IS NULL AND consultant_name IS NOT NULL ORDER BY consultant_name`),
  ])

  const statusCounts = rows<{ status: string; count: number }>(statusRows).reduce<Record<string, number>>((acc, row) => {
    acc[text(row.status) || 'new'] = Number(row.count) || 0
    return acc
  }, {})

  return {
    rows: bookingRows,
    pagination: {
      page,
      pageSize,
      total: Number(totalRows[0]?.value || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRows[0]?.value || 0) / pageSize)),
    },
    kpis: {
      total: Object.values(statusCounts).reduce((sum, value) => sum + value, 0),
      open: Object.entries(statusCounts).filter(([key]) => !['delivered', 'cancelled'].includes(key)).reduce((sum, [, value]) => sum + value, 0),
      proformaGenerated: statusCounts.proforma_generated || 0,
      vehicleAllocated: statusCounts.vehicle_allocated || 0,
      delivered: statusCounts.delivered || 0,
      cancelled: statusCounts.cancelled || 0,
    },
    filters: {
      dealers: rows<{ value: string }>(dealerRows).map((row) => text(row.value)).filter(Boolean),
      models: rows<{ value: string }>(modelRows).map((row) => text(row.value)).filter(Boolean),
      consultants: rows<{ value: string }>(consultantRows).map((row) => text(row.value)).filter(Boolean),
      statuses: KIA_BOOKING_STATUSES,
    },
  }
}

export async function createKiaBooking(input: CreateBookingInput, appUser: AppUser) {
  const required = {
    customerName: text(input.customerName),
    customerPhone: text(input.customerPhone),
    dealerCode: normalizeKiaDealerCode(input.dealerCode) || text(input.dealerCode).toUpperCase(),
    model: text(input.model).toUpperCase(),
    variant: text(input.variant),
    consultantName: text(input.consultantName) || appUser.fullName,
  }

  for (const [key, value] of Object.entries(required)) {
    if (!value) throw new Error(`${key} is required`)
  }

  return db.transaction(async (tx) => {
    const bookingNumber = await nextBookingNumber(tx)
    const [booking] = await tx.insert(kiaBookings).values({
      bookingNumber,
      status: 'booking_created',
      dealerCode: required.dealerCode,
      customerName: required.customerName,
      customerPhone: required.customerPhone,
      customerEmail: nullableText(input.customerEmail),
      customerAddress: nullableText(input.customerAddress),
      model: required.model,
      variant: required.variant,
      color: nullableText(input.color),
      fuelType: nullableText(input.fuelType),
      consultantName: required.consultantName,
      consultantEmail: appUser.email,
      source: nullableText(input.source),
      financeRequired: Boolean(input.financeRequired),
      bankName: nullableText(input.bankName),
      loanAmount: numericText(input.loanAmount),
      notes: nullableText(input.notes),
      metadata: (input.metadata || {}) as JsonRecord,
      createdBy: appUser.id,
      updatedBy: appUser.id,
    }).returning()

    await addActivity(tx, {
      bookingId: booking.id,
      type: 'created',
      title: 'Booking created',
      description: `${booking.customerName} booked ${booking.model} ${booking.variant}`,
      after: booking as unknown as JsonRecord,
      appUser,
    })

    return booking
  })
}

export async function getKiaBookingDetail(id: string) {
  await expireKiaTemporaryAllocations()
  const [booking] = await db.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) return null

  const [activeAllocationRows, activity, transfers, proformaRows, financeRows] = await Promise.all([
    db.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1),
    db.select().from(kiaBookingActivity).where(eq(kiaBookingActivity.bookingId, id)).orderBy(desc(kiaBookingActivity.createdAt)).limit(100),
    db.select().from(kiaVehicleTransfers).where(eq(kiaVehicleTransfers.bookingId, id)).orderBy(desc(kiaVehicleTransfers.createdAt)).limit(50),
    booking.proformaId ? db.select().from(kiaProformas).where(eq(kiaProformas.id, booking.proformaId)).limit(1) : Promise.resolve([]),
    booking.financeOrderId ? db.select().from(financeOrders).where(eq(financeOrders.id, booking.financeOrderId)).limit(1) : Promise.resolve([]),
  ])

  return {
    booking,
    activeAllocation: activeAllocationRows[0] || null,
    proforma: proformaRows[0] || null,
    financeOrder: financeRows[0] || null,
    transfers,
    activity,
  }
}

export async function updateKiaBooking(id: string, input: UpdateBookingInput, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!before) throw new Error('Booking not found')

    const updates: Partial<typeof kiaBookings.$inferInsert> = {
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }

    if (input.customerName !== undefined) updates.customerName = text(input.customerName)
    if (input.customerPhone !== undefined) updates.customerPhone = text(input.customerPhone)
    if (input.customerEmail !== undefined) updates.customerEmail = nullableText(input.customerEmail)
    if (input.customerAddress !== undefined) updates.customerAddress = nullableText(input.customerAddress)
    if (input.dealerCode !== undefined) updates.dealerCode = normalizeKiaDealerCode(input.dealerCode) || text(input.dealerCode).toUpperCase()
    if (input.model !== undefined) updates.model = text(input.model).toUpperCase()
    if (input.variant !== undefined) updates.variant = text(input.variant)
    if (input.color !== undefined) updates.color = nullableText(input.color)
    if (input.fuelType !== undefined) updates.fuelType = nullableText(input.fuelType)
    if (input.consultantName !== undefined) updates.consultantName = text(input.consultantName)
    if (input.source !== undefined) updates.source = nullableText(input.source)
    if (input.financeRequired !== undefined) updates.financeRequired = Boolean(input.financeRequired)
    if (input.bankName !== undefined) updates.bankName = nullableText(input.bankName)
    if (input.loanAmount !== undefined) updates.loanAmount = numericText(input.loanAmount)
    if (input.notes !== undefined) updates.notes = nullableText(input.notes)
    if (input.deliveryTargetDate !== undefined) updates.deliveryTargetDate = input.deliveryTargetDate ? input.deliveryTargetDate : null
    if (input.status !== undefined) updates.status = normalizeStatus(input.status)
    if (input.delivered) {
      updates.status = 'delivered'
      updates.deliveredAt = new Date()
    }

    const [booking] = await tx.update(kiaBookings).set(updates).where(eq(kiaBookings.id, id)).returning()
    await addActivity(tx, {
      bookingId: id,
      type: input.delivered ? 'delivered' : 'updated',
      title: input.delivered ? 'Vehicle delivered' : 'Booking updated',
      before: before as unknown as JsonRecord,
      after: booking as unknown as JsonRecord,
      appUser,
    })
    return booking
  })
}

export async function generateKiaBookingProforma(id: string, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.proformaId) return booking

    const [proforma] = await tx.insert(kiaProformas).values({
      proformaDate: new Date(),
      customerType: 'Individual',
      customerName: booking.customerName,
      mobileNumber: booking.customerPhone,
      customerAddress: booking.customerAddress || 'Pending',
      customerEmail: booking.customerEmail || `${booking.bookingNumber.toLowerCase()}@example.invalid`,
      modelName: booking.model,
      trimDescription: booking.variant,
      fuelType: booking.fuelType || 'Pending',
      vehicleColor: booking.color || 'Pending',
      bankName: booking.bankName || 'Pending',
      vehicleStatus: booking.allocatedVin ? 'Allocated' : 'Pending',
      loanAmount: booking.loanAmount || '0',
      loginEmail: appUser.email,
      consultant: booking.consultantName,
      location: booking.dealerCode,
      empCode: '',
      approvalStatus: 'PENDING',
      financeStatus: booking.financeRequired ? 'Pending' : 'Not Required',
      createdBy: appUser.id,
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      proformaId: proforma.id,
      status: 'proforma_generated',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'proforma',
      title: 'Proforma generated',
      description: `Linked proforma ${proforma.id}`,
      after: { proformaId: proforma.id },
      appUser,
    })

    return updated
  })
}

async function readMatchingVehicle(vinNumber: string) {
  const result = await analyticsDb.execute(sql`
    WITH dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number,
        sm.order_dealer AS dealer_code,
        sm.model,
        sm.variant,
        sm.exterior_color_name AS color,
        sm.engine_no,
        sm.stock_status,
        sm.stock_location,
        sm.uploaded_at,
        to_jsonb(sm) AS snapshot,
        'dms'::text AS source
      FROM kia_stock_report sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE sm.vin_number = ${vinNumber}
        AND lower(trim(coalesce(sm.stock_status::text, ''))) IN ('free stock', 'in transit')
        AND coalesce(ls.local_status, '') <> 'retail'
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT
        ls.vin_number,
        ls.dealer_code,
        ls.model,
        ls.variant,
        ls.color,
        ls.engine_no,
        coalesce(ls.stock_status_at_mark, 'BBND') AS stock_status,
        ls.stock_location,
        ls.source_uploaded_at AS uploaded_at,
        ls.vehicle_snapshot AS snapshot,
        'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.vin_number = ${vinNumber}
        AND ls.local_status = 'bbnd'
        AND NOT EXISTS (SELECT 1 FROM dms)
    )
    SELECT * FROM dms
    UNION ALL
    SELECT * FROM bbnd
    LIMIT 1
  `)
  return rows(result)[0] || null
}

export async function getKiaBookingMatchingVehicles(id: string) {
  await expireKiaTemporaryAllocations()
  const [booking] = await db.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) throw new Error('Booking not found')

  const modelPattern = `%${booking.model}%`
  const variantPattern = `%${booking.variant}%`

  return rows(await analyticsDb.execute(sql`
    WITH active_allocations AS (
      SELECT vin_number
      FROM kia_vehicle_allocations
      WHERE released_at IS NULL
        AND (payment_confirmed_at IS NOT NULL OR expires_at IS NULL OR expires_at > now())
    ),
    dms AS (
      SELECT DISTINCT ON (sm.vin_number)
        sm.vin_number,
        sm.order_dealer AS dealer_code,
        sm.model,
        sm.variant,
        sm.exterior_color_name AS color,
        sm.engine_no,
        sm.stock_status,
        sm.stock_location,
        sm.uploaded_at,
        to_jsonb(sm) AS snapshot,
        'dms'::text AS source
      FROM kia_stock_report sm
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE lower(trim(coalesce(sm.stock_status::text, ''))) IN ('free stock', 'in transit')
        AND coalesce(ls.local_status, '') <> 'retail'
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = sm.vin_number)
        AND sm.model ILIKE ${modelPattern}
      ORDER BY sm.vin_number, sm.uploaded_at DESC NULLS LAST, sm.id DESC
    ),
    bbnd AS (
      SELECT
        ls.vin_number,
        ls.dealer_code,
        ls.model,
        ls.variant,
        ls.color,
        ls.engine_no,
        coalesce(ls.stock_status_at_mark, 'BBND') AS stock_status,
        ls.stock_location,
        ls.source_uploaded_at AS uploaded_at,
        ls.vehicle_snapshot AS snapshot,
        'bbnd'::text AS source
      FROM kia_stock_local_statuses ls
      WHERE ls.local_status = 'bbnd'
        AND NOT EXISTS (SELECT 1 FROM active_allocations aa WHERE aa.vin_number = ls.vin_number)
        AND NOT EXISTS (SELECT 1 FROM dms d WHERE d.vin_number = ls.vin_number)
        AND ls.model ILIKE ${modelPattern}
    )
    SELECT *
    FROM (
      SELECT * FROM dms
      UNION ALL
      SELECT * FROM bbnd
    ) vehicles
    ORDER BY
      CASE WHEN variant ILIKE ${variantPattern} THEN 0 ELSE 1 END,
      uploaded_at DESC NULLS LAST
    LIMIT 50
  `))
}

export async function allotKiaBookingVehicle(id: string, vinNumber: string, appUser: AppUser) {
  const normalizedVin = text(vinNumber).toUpperCase()
  if (!normalizedVin) throw new Error('VIN is required')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')

    const [activeVin] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.vinNumber, normalizedVin), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeVin) throw new Error('This VIN is already allocated to another active booking')

    const [activeBooking] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeBooking) throw new Error('This booking already has an active VIN allocation')

    const vehicle = await readMatchingVehicle(normalizedVin)
    if (!vehicle) throw new Error('Vehicle is not available for allocation')

    const [allocation] = await tx.insert(kiaVehicleAllocations).values({
      bookingId: id,
      vinNumber: normalizedVin,
      dealerCode: nullableText(vehicle.dealer_code),
      model: nullableText(vehicle.model),
      variant: nullableText(vehicle.variant),
      color: nullableText(vehicle.color),
      engineNo: nullableText(vehicle.engine_no),
      stockSource: text(vehicle.source) || 'dms',
      vehicleSnapshot: (vehicle.snapshot || {}) as JsonRecord,
      allocationStatus: 'temporary',
      expiresAt: new Date(Date.now() + TEMPORARY_ALLOCATION_HOURS * 60 * 60 * 1000),
      allocatedBy: appUser.id,
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      allocatedVin: normalizedVin,
      status: 'vehicle_allocated',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'allocation',
      title: 'VIN allocated',
      description: normalizedVin,
      after: allocation as unknown as JsonRecord,
      appUser,
    })
    return updated
  })
}

export async function releaseKiaBookingVehicle(id: string, reason: string | null, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    const [released] = await tx.update(kiaVehicleAllocations).set({
      releasedAt: new Date(),
      releasedBy: appUser.id,
      releaseReason: nullableText(reason),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id)).returning()

    const [updated] = await tx.update(kiaBookings).set({
      allocatedVin: null,
      status: booking.proformaId ? 'proforma_generated' : 'booking_created',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'release',
      title: 'VIN released',
      description: reason || allocation.vinNumber,
      after: released as unknown as JsonRecord,
      appUser,
    })
    return updated
  })
}

export async function confirmKiaBookingPayment(id: string, input: { reference?: string | null }, appUser: AppUser) {
  const role = text(appUser.role).toLowerCase()
  const department = text((appUser as AppUser & { department?: string | null }).department).toLowerCase()
  const canConfirm = role === 'accounts' || role === 'super_admin' || department.includes('account')
  if (!canConfirm) throw new Error('Only Accounts Department users can confirm booking payment.')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    const [confirmed] = await tx.update(kiaVehicleAllocations).set({
      allocationStatus: 'final',
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: appUser.id,
      paymentReference: nullableText(input.reference),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id)).returning()

    const [updated] = await tx.update(kiaBookings).set({
      status: 'ready_delivery',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'payment',
      title: 'Payment confirmed',
      description: input.reference ? `Reference: ${input.reference}` : 'Payment confirmed by Accounts',
      after: confirmed as unknown as JsonRecord,
      appUser,
    })

    return updated
  })
}

export async function requestKiaVehicleTransfer(id: string, input: { toDealerCode?: string | null; notes?: string | null }, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    const toDealerCode = normalizeKiaDealerCode(input.toDealerCode) || text(input.toDealerCode).toUpperCase()
    if (!toDealerCode) throw new Error('Target dealer is required')

    const [transfer] = await tx.insert(kiaVehicleTransfers).values({
      bookingId: id,
      vinNumber: booking.allocatedVin,
      fromDealerCode: booking.dealerCode,
      toDealerCode,
      notes: nullableText(input.notes),
      requestedBy: appUser.id,
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      status: 'transfer_requested',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'transfer',
      title: 'Transfer requested',
      description: `${booking.dealerCode} to ${toDealerCode}`,
      after: transfer as unknown as JsonRecord,
      appUser,
    })
    return updated
  })
}

export async function createKiaBookingFinanceDraft(id: string, appUser: AppUser) {
  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.financeOrderId) return booking

    const orderNumber = `KIA-FIN-${booking.bookingNumber}`
    const [order] = await tx.insert(financeOrders).values({
      orderNumber,
      currentStage: 'finance_head_submission',
      status: 'draft',
      totalPayoutReceived: '0',
      invoiceNumber: booking.bookingNumber,
      paymentReceivedDate: new Date(),
      dsePayout: '0',
      hypBankName: booking.bankName || 'Pending',
      dseName: booking.consultantName,
      dealer: booking.dealerCode,
      createdBy: appUser.id,
    }).onConflictDoNothing().returning()

    const [existingOrder] = order ? [order] : await tx.select().from(financeOrders).where(eq(financeOrders.orderNumber, orderNumber)).limit(1)

    if (existingOrder) {
      await tx.insert(financeOrderWorkflow).values({
        financeOrderId: existingOrder.id,
        action: 'draft_created',
        stage: 'finance_head_submission',
        performedBy: appUser.id,
        userRole: appUser.role,
        remarks: `Created from booking ${booking.bookingNumber}`,
        newStatus: 'draft',
        metadata: { bookingId: booking.id, bookingNumber: booking.bookingNumber },
      }).onConflictDoNothing()
    }

    const [updated] = await tx.update(kiaBookings).set({
      financeOrderId: existingOrder?.id || null,
      status: 'finance_pending',
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'finance',
      title: 'Finance draft created',
      description: existingOrder?.orderNumber || orderNumber,
      after: { financeOrderId: existingOrder?.id || null },
      appUser,
    })

    return updated
  })
}
