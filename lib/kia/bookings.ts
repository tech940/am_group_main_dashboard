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
  kiaStockLocalStatuses,
  kiaVehicleAllocations,
  kiaVehicleTransfers,
  kiaPriceDetails,
} from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import {
  canAllotKiaVehicle,
  canConfirmKiaPayment,
  canDeliverKiaBooking,
  canTransferKiaVehicle,
  canVerifyKiaAccounts,
  canViewAllKiaBookings,
} from '@/lib/kia/workflow-access'

type JsonRecord = Record<string, unknown>
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
const TEMPORARY_ALLOCATION_HOURS = 72
const CSD_ALLOCATION_HOURS = 120 // CSD customers get a 5-day payment window

// The temporary-allocation payment window depends on the customer type captured
// on the booking form: CSD → 5 days, everyone else → 72 hours.
function allocationHoursForBooking(booking: { metadata?: unknown } | null | undefined): number {
  const meta = (booking?.metadata || {}) as Record<string, unknown>
  const type = String(meta.customerType || '').trim().toLowerCase()
  return type === 'csd' ? CSD_ALLOCATION_HOURS : TEMPORARY_ALLOCATION_HOURS
}

export const KIA_BOOKING_STATUSES = [
  'draft',
  'booking_created',
  'proforma_generated',
  'on_hold',
  'vehicle_allocated',
  'transfer_requested',
  'finance_pending',
  'payment_confirmed',
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
  // The requesting user — used to scope Sales Executives to their own bookings.
  viewer?: { id?: string | null; email?: string | null; role?: string | null } | null
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

async function nextBookingNumber(tx: DbTx, dealerCode: string) {
  const result = await tx.execute(sql<{ seq: string }>`SELECT nextval('public.kia_booking_number_seq')::text AS seq`)
  const seq = text(rows<{ seq: string }>(result)[0]?.seq || '0').padStart(6, '0')
  const cleanDealer = String(dealerCode || 'JK402').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `KIA_${cleanDealer}_${new Date().getFullYear()}_${seq}`
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
          status = 'on_hold',
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

  // Sales Executives (and any non-privileged role) only ever see their own
  // bookings — matched by creator id OR the consultant email stamped at creation.
  const viewer = input.viewer
  if (viewer && !canViewAllKiaBookings(viewer.role)) {
    const ownFilters = []
    if (viewer.id) ownFilters.push(eq(kiaBookings.createdBy, viewer.id))
    if (viewer.email) ownFilters.push(ilike(kiaBookings.consultantEmail, viewer.email))
    // If we can't identify the viewer at all, fail closed to no rows.
    filters.push(ownFilters.length ? or(...ownFilters)! : sql`false`)
  }

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
  const { page, pageSize, offset } = pageParams(input)
  const where = listFilters(input)

  // Page load is dominated by pooler round-trip latency (~225ms/query), not the
  // queries themselves. The status counts, filter option lists and today count
  // are all over the same unfiltered table, so fold them into ONE round trip via
  // scalar sub-selects. That drops the list from 7 queries to 3 (count + page +
  // aggregates) — one RTT wave instead of two under the dev pool.
  const [totalRows, bookingRows, aggRows] = await Promise.all([
    db.select({ value: count() }).from(kiaBookings).where(where),
    db.select().from(kiaBookings).where(where).orderBy(desc(kiaBookings.updatedAt), desc(kiaBookings.createdAt)).limit(pageSize).offset(offset),
    db.execute(sql`
      SELECT
        COALESCE((SELECT jsonb_object_agg(status, cnt) FROM (
          SELECT status, count(*)::int AS cnt FROM kia_bookings WHERE deleted_at IS NULL GROUP BY status
        ) s), '{}'::jsonb) AS status_counts,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT dealer_code AS value FROM kia_bookings WHERE deleted_at IS NULL AND dealer_code IS NOT NULL
        ) d), '[]'::jsonb) AS dealers,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT model AS value FROM kia_bookings WHERE deleted_at IS NULL AND model IS NOT NULL
        ) m), '[]'::jsonb) AS models,
        COALESCE((SELECT jsonb_agg(value ORDER BY value) FROM (
          SELECT DISTINCT consultant_name AS value FROM kia_bookings WHERE deleted_at IS NULL AND consultant_name IS NOT NULL
        ) c), '[]'::jsonb) AS consultants,
        (SELECT count(*)::int FROM kia_bookings WHERE deleted_at IS NULL AND created_at >= (CURRENT_DATE AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC') AS today_count
    `),
  ])

  const agg = rows<{
    status_counts: Record<string, number> | null
    dealers: string[] | null
    models: string[] | null
    consultants: string[] | null
    today_count: number
  }>(aggRows)[0]
  const statusCounts = agg?.status_counts || {}
  const todayCount = Number(agg?.today_count || 0)

  return {
    rows: bookingRows,
    pagination: {
      page,
      pageSize,
      total: Number(totalRows[0]?.value || 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRows[0]?.value || 0) / pageSize)),
    },
    kpis: {
      today: todayCount,
      pendingProforma: statusCounts.booking_created || 0,
      waitingAllocation: statusCounts.proforma_generated || 0,
      financePending: statusCounts.vehicle_allocated || 0,
      readyDelivery: statusCounts.ready_delivery || 0,
      delivered: statusCounts.delivered || 0,
      cancelled: statusCounts.cancelled || 0,
    },
    filters: {
      dealers: (agg?.dealers || []).map((value) => text(value)).filter(Boolean),
      models: (agg?.models || []).map((value) => text(value)).filter(Boolean),
      consultants: (agg?.consultants || []).map((value) => text(value)).filter(Boolean),
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
    const bookingNumber = await nextBookingNumber(tx, required.dealerCode)
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
      // Delivery is the Sales Executive's final step (after Accounts verification).
      if (!canDeliverKiaBooking(appUser.role)) {
        throw new Error('Only the Sales Executive can mark the vehicle delivered.')
      }
      if (before.status !== 'ready_delivery') {
        throw new Error('Delivery is available only after Accounts completes verification.')
      }
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

    const priceDetails = await tx
      .select()
      .from(kiaPriceDetails)
      .where(and(eq(kiaPriceDetails.model, booking.model), eq(kiaPriceDetails.trimDescription, booking.variant)))
      .limit(1)
      .then((rows) => rows[0] || null)

    const isCash = (booking.bankName || '').toUpperCase() === 'CASH'
    const registration = priceDetails
      ? isCash
        ? Number(priceDetails.registrationCharges)
        : Number(priceDetails.registrationCharges) + Number(priceDetails.statutoryCharges)
      : 0

    const exShowroom = priceDetails ? Number(priceDetails.exShowroomPrice) : 0
    const tcsValue = priceDetails ? Number(priceDetails.tcs) : 0
    const insuranceValue = priceDetails ? Number(priceDetails.insurance) : 0
    const fastagValue = priceDetails ? Number(priceDetails.fastag) : 0
    const accessoriesKit = priceDetails ? Number(priceDetails.accessoriesKit) : 0
    const extWarranty = priceDetails ? Number(priceDetails.extendedWarranty4thYear) : 0
    const insuranceCompany = priceDetails ? priceDetails.insuranceCompany || '' : ''

    const meta = (booking.metadata || {}) as Record<string, unknown>
    const bookingAmountVal = String(meta.bookingAmount || '0')

    const totalCustomerCost = exShowroom + tcsValue + registration + insuranceValue + fastagValue + accessoriesKit + extWarranty
    const grandTotalCost = totalCustomerCost - Number(bookingAmountVal)

    const [proforma] = await tx.insert(kiaProformas).values({
      proformaDate: new Date(),
      customerType: String(meta.customerType || 'Individual'),
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
      insuranceCompany: insuranceCompany,
      exShowroom: exShowroom.toFixed(2),
      tcsValue: tcsValue.toFixed(2),
      registrationCharges: registration.toFixed(2),
      insuranceValue: insuranceValue.toFixed(2),
      fastagValue: fastagValue.toFixed(2),
      accessoriesKit: accessoriesKit.toFixed(2),
      extWarranty: extWarranty.toFixed(2),
      totalCustomerCost: totalCustomerCost.toFixed(2),
      grandTotalCost: grandTotalCost.toFixed(2),
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
  // Availability MUST use the exact same source + rule as the stock list, the
  // "N BOOKINGS MATCH" badge and check-stock: a row in kia_stock_management with
  // no active (unreleased) allocation is allottable — regardless of the raw DMS
  // stock_status text. Previously this read kia_stock_report and only accepted
  // 'free stock'/'in transit', so vehicles that showed a badge + Allot button
  // failed with "Vehicle is not available for allocation". Same logic → no gap.
  const result = await analyticsDb.execute(sql`
    SELECT
      sm.vin_number,
      sm.order_dealer AS dealer_code,
      sm.model,
      sm.variant,
      sm.exterior_color_name AS color,
      sm.engine_no,
      sm.stock_status,
      to_jsonb(sm) AS snapshot,
      'dms'::text AS source
    FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va
      ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    WHERE upper(sm.vin_number) = ${vinNumber}
      AND va.id IS NULL
    ORDER BY sm.id DESC
    LIMIT 1
  `)
  return rows(result)[0] || null
}

export async function getKiaBookingMatchingVehicles(id: string) {
  await expireKiaTemporaryAllocations()
  const [booking] = await db.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
  if (!booking) throw new Error('Booking not found')
  if (!booking.proformaId) return []
  const [proforma] = await db.select({ approvalStatus: kiaProformas.approvalStatus }).from(kiaProformas).where(eq(kiaProformas.id, booking.proformaId)).limit(1)
  if (text(proforma?.approvalStatus).toUpperCase() !== 'APPROVED') return []

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
  if (!canAllotKiaVehicle(appUser.role)) {
    throw new Error('The Sales Executive cannot allot vehicles. Allotment is done by an approving/finance/accounts role.')
  }
  const normalizedVin = text(vinNumber).toUpperCase()
  if (!normalizedVin) throw new Error('VIN is required')

  const vehicle = await readMatchingVehicle(normalizedVin)
  if (!vehicle) throw new Error('Vehicle is not available for allocation')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (!booking.proformaId) throw new Error('Generate and approve the proforma before vehicle allocation.')
    const [proforma] = await tx.select({ approvalStatus: kiaProformas.approvalStatus }).from(kiaProformas).where(eq(kiaProformas.id, booking.proformaId)).limit(1)
    if (text(proforma?.approvalStatus).toUpperCase() !== 'APPROVED') {
      throw new Error('Vehicle allocation opens only after Sales Manager / Manager approval.')
    }

    const [activeVin] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.vinNumber, normalizedVin), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeVin) throw new Error('This VIN is already allocated to another active booking')

    const [activeBooking] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (activeBooking) throw new Error('This booking already has an active VIN allocation')

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
      expiresAt: new Date(Date.now() + allocationHoursForBooking(booking) * 60 * 60 * 1000),
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

export async function confirmKiaBookingPayment(
  id: string,
  input: {
    reference?: string | null
  },
  appUser: AppUser,
) {
  // Payment confirmation (Stock dashboard "Payment received"): Accounts / admin.
  // This advances the vehicle to Paid · To Deliver; the invoice number / PDF are
  // captured separately in the Accounts verification step in the Bookings CRM.
  if (!canConfirmKiaPayment(appUser.role)) {
    throw new Error('Only Accounts or an admin can confirm payment received.')
  }

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

    if (allocation.vinNumber) {
      await tx.insert(kiaStockLocalStatuses).values({
        vinNumber: allocation.vinNumber,
        localStatus: 'retail',
        dealerCode: allocation.dealerCode,
        model: allocation.model,
        variant: allocation.variant,
        color: allocation.color,
        engineNo: allocation.engineNo,
        stockStatusAtMark: 'Retail after accounts payment confirmation',
        bookingNo: booking.bookingNumber,
        customerName: booking.customerName,
        vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
        notes: input.reference ? `Payment confirmed: ${input.reference}` : 'Payment confirmed by Accounts',
        markedBy: appUser.id,
        markedByName: appUser.fullName,
        markedByRole: appUser.role,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: kiaStockLocalStatuses.vinNumber,
        set: {
          localStatus: 'retail',
          dealerCode: allocation.dealerCode,
          model: allocation.model,
          variant: allocation.variant,
          color: allocation.color,
          engineNo: allocation.engineNo,
          stockStatusAtMark: 'Retail after accounts payment confirmation',
          bookingNo: booking.bookingNumber,
          customerName: booking.customerName,
          vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
          notes: input.reference ? `Payment confirmed: ${input.reference}` : 'Payment confirmed by Accounts',
          markedBy: appUser.id,
          markedByName: appUser.fullName,
          markedByRole: appUser.role,
          markedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }

    const [updated] = await tx.update(kiaBookings).set({
      // Payment confirmed -> vehicle is Paid · To Deliver. Advancing straight to
      // ready_delivery is what makes the stock row leave the "N h to pay" window
      // and show "Paid · To Deliver" (the legacy 'payment_confirmed' status was
      // not recognised by the stock list, so the row appeared stuck as ALLOTTED).
      status: 'ready_delivery',
      metadata: {
        ...((booking.metadata || {}) as JsonRecord),
        paymentConfirmation: {
          reference: nullableText(input.reference),
          confirmedAt: new Date().toISOString(),
          confirmedBy: appUser.fullName,
          confirmedByRole: appUser.role,
        },
      },
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

export async function verifyKiaAccountsPayment(
  id: string,
  input: {
    reference?: string | null
    invoiceNumber?: string | null
    invoiceDocumentUrl?: string | null
    invoiceDocumentPath?: string | null
    invoiceDocumentName?: string | null
    notes?: string | null
  },
  appUser: AppUser,
) {
  // Single ACCOUNTS stage (Finance removed): confirm payment release, record the
  // invoice number + PDF, then advance the booking straight to ready_delivery.
  if (!canVerifyKiaAccounts(appUser.role)) {
    throw new Error('Only the Accounts team can confirm payment and verify documentation.')
  }
  const invoiceNumber = text(input.invoiceNumber).trim()
  if (!invoiceNumber) throw new Error('Invoice number is required.')

  return db.transaction(async (tx) => {
    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'vehicle_allocated' && booking.status !== 'transfer_requested' && booking.status !== 'payment_confirmed') {
      throw new Error('Payment & invoice verification is available after the vehicle is allotted.')
    }

    const [allocation] = await tx.select().from(kiaVehicleAllocations).where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt))).limit(1)
    if (!allocation) throw new Error('No active allocation found')

    await tx.update(kiaVehicleAllocations).set({
      allocationStatus: 'final',
      paymentConfirmedAt: new Date(),
      paymentConfirmedBy: appUser.id,
      paymentReference: nullableText(input.reference),
      updatedAt: new Date(),
    }).where(eq(kiaVehicleAllocations.id, allocation.id))

    if (allocation.vinNumber) {
      await tx.insert(kiaStockLocalStatuses).values({
        vinNumber: allocation.vinNumber,
        localStatus: 'retail',
        dealerCode: allocation.dealerCode,
        model: allocation.model,
        variant: allocation.variant,
        color: allocation.color,
        engineNo: allocation.engineNo,
        stockStatusAtMark: 'Retail after accounts payment confirmation',
        bookingNo: booking.bookingNumber,
        customerName: booking.customerName,
        vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
        notes: `Invoice ${invoiceNumber} verified by Accounts`,
        markedBy: appUser.id,
        markedByName: appUser.fullName,
        markedByRole: appUser.role,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: kiaStockLocalStatuses.vinNumber,
        set: {
          localStatus: 'retail',
          dealerCode: allocation.dealerCode,
          model: allocation.model,
          variant: allocation.variant,
          color: allocation.color,
          engineNo: allocation.engineNo,
          stockStatusAtMark: 'Retail after accounts payment confirmation',
          bookingNo: booking.bookingNumber,
          customerName: booking.customerName,
          vehicleSnapshot: (allocation.vehicleSnapshot || {}) as JsonRecord,
          notes: `Invoice ${invoiceNumber} verified by Accounts`,
          markedBy: appUser.id,
          markedByName: appUser.fullName,
          markedByRole: appUser.role,
          markedAt: new Date(),
          updatedAt: new Date(),
        },
      })
    }

    const [updated] = await tx.update(kiaBookings).set({
      // Payment released + invoice recorded -> ready for the Sales Executive to deliver.
      status: 'ready_delivery',
      metadata: {
        ...((booking.metadata || {}) as JsonRecord),
        paymentConfirmation: {
          reference: nullableText(input.reference),
          confirmedAt: new Date().toISOString(),
          confirmedBy: appUser.fullName,
          confirmedByRole: appUser.role,
        },
        accountsVerification: {
          invoiceNumber,
          invoiceDocumentUrl: nullableText(input.invoiceDocumentUrl),
          invoiceDocumentPath: nullableText(input.invoiceDocumentPath),
          invoiceDocumentName: nullableText(input.invoiceDocumentName),
          notes: nullableText(input.notes),
          verifiedAt: new Date().toISOString(),
          verifiedBy: appUser.fullName,
          verifiedByRole: appUser.role,
        },
      },
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    if (!updated) throw new Error('Booking already moved to another stage')

    await addActivity(tx, {
      bookingId: id,
      type: 'accounts',
      title: 'Payment released & invoice verified',
      description: `Invoice ${invoiceNumber} recorded by Accounts`,
      after: updated as unknown as JsonRecord,
      appUser,
    })

    return updated
  })
}

export async function requestKiaVehicleTransfer(
  id: string,
  input: { toDealerCode?: string | null; notes?: string | null; vinNumber?: string | null },
  appUser: AppUser,
) {
  if (!canTransferKiaVehicle(appUser.role)) {
    throw new Error('The Sales Executive cannot request transfers.')
  }
  const normalizedVin = text(input.vinNumber).toUpperCase()
  const vehicle = normalizedVin ? await readMatchingVehicle(normalizedVin) : null

  return db.transaction(async (tx) => {
    const isDirectStockTransfer = !id || id === 'none' || id === 'system' || id === 'undefined' || id === 'null'

    const toDealerCode = normalizeKiaDealerCode(input.toDealerCode) || text(input.toDealerCode).toUpperCase()
    if (!toDealerCode) throw new Error('Target dealer is required')

    if (isDirectStockTransfer) {
      if (!normalizedVin) throw new Error('Pick a VIN before requesting a transfer.')
      if (!vehicle) throw new Error('Vehicle not found for transfer')

      // Insert transfer record. booking_id is nullable at the DB level for
      // direct (booking-less) stock transfers, though the schema types it as
      // required — cast through unknown rather than `any`.
      const [transfer] = await tx.insert(kiaVehicleTransfers).values({
        bookingId: null as unknown as string,
        vinNumber: normalizedVin,
        fromDealerCode: nullableText(vehicle.dealer_code),
        toDealerCode,
        transferStatus: 'Transferred',
        notes: nullableText(input.notes),
        requestedBy: appUser.id,
        metadata: { source: 'direct_stock_transfer' },
      }).returning()

      // Update vehicle's dealer code in kia_stock_management table
      await tx.execute(sql.raw(`
        UPDATE kia_stock_management 
        SET order_dealer = '${toDealerCode.replace(/'/g, "''")}' 
        WHERE UPPER(vin_number) = '${normalizedVin.replace(/'/g, "''")}'
      `))

      // NOTE: we intentionally do NOT write a kia_stock_local_statuses row here.
      // That table has a CHECK constraint permitting only local_status IN
      // ('bbnd','retail'); 'transferred' violated it and crashed the transfer.
      // Since no stock query ever reads local_status = 'transferred', this row
      // was write-only — the transfer is fully recorded in kia_vehicle_transfers
      // above. (To surface transferred vehicles in stock later, widen the CHECK
      // constraint to include 'transferred' and add read logic for it.)

      return { id: transfer.id, toDealerCode, vinNumber: normalizedVin }
    }

    const [booking] = await tx.select().from(kiaBookings).where(and(eq(kiaBookings.id, id), isNull(kiaBookings.deletedAt))).limit(1)
    if (!booking) throw new Error('Booking not found')
    if (!booking.proformaId) throw new Error('Generate the proforma before requesting a transfer.')

    const [proforma] = await tx
      .select({ approvalStatus: kiaProformas.approvalStatus })
      .from(kiaProformas)
      .where(eq(kiaProformas.id, booking.proformaId))
      .limit(1)
    if (text(proforma?.approvalStatus).toUpperCase() !== 'APPROVED') {
      throw new Error('Transfer opens only after Sales Manager / Manager approval.')
    }

    let [allocation] = await tx
      .select()
      .from(kiaVehicleAllocations)
      .where(and(eq(kiaVehicleAllocations.bookingId, id), isNull(kiaVehicleAllocations.releasedAt)))
      .limit(1)

    if (!allocation) {
      if (!normalizedVin) throw new Error('Pick a VIN before requesting a transfer.')

      const [activeVin] = await tx
        .select()
        .from(kiaVehicleAllocations)
        .where(and(eq(kiaVehicleAllocations.vinNumber, normalizedVin), isNull(kiaVehicleAllocations.releasedAt)))
        .limit(1)
      if (activeVin) throw new Error('This VIN is already allocated to another active booking')

      if (!vehicle) throw new Error('Vehicle is not available for transfer')

      const [createdAllocation] = await tx
        .insert(kiaVehicleAllocations)
        .values({
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
          expiresAt: new Date(Date.now() + allocationHoursForBooking(booking) * 60 * 60 * 1000),
          allocatedBy: appUser.id,
        })
        .returning()

      allocation = createdAllocation

      await tx
        .update(kiaBookings)
        .set({
          allocatedVin: normalizedVin,
          status: 'vehicle_allocated',
          updatedBy: appUser.id,
          updatedAt: new Date(),
        })
        .where(eq(kiaBookings.id, id))

      await addActivity(tx, {
        bookingId: id,
        type: 'allocation',
        title: 'VIN reserved for transfer',
        description: normalizedVin,
        after: createdAllocation as unknown as JsonRecord,
        appUser,
      })
    }

    const [transfer] = await tx.insert(kiaVehicleTransfers).values({
      bookingId: id,
      vinNumber: allocation?.vinNumber || booking.allocatedVin,
      fromDealerCode: allocation?.dealerCode || booking.dealerCode,
      toDealerCode,
      notes: nullableText(input.notes),
      requestedBy: appUser.id,
      metadata: {
        source: allocation?.stockSource || 'booking',
        requestedFromStatus: booking.status,
      },
    }).returning()

    const [updated] = await tx.update(kiaBookings).set({
      status: 'transfer_requested',
      allocatedVin: allocation?.vinNumber || booking.allocatedVin,
      updatedBy: appUser.id,
      updatedAt: new Date(),
    }).where(eq(kiaBookings.id, id)).returning()

    await addActivity(tx, {
      bookingId: id,
      type: 'transfer',
      title: 'Transfer requested',
      description: `${allocation?.dealerCode || booking.dealerCode || 'Current outlet'} to ${toDealerCode}`,
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
