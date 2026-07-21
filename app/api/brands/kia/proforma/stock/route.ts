import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { requirePermission } from '@/lib/permissions/service'
import { KIA_HOLD_WINDOW_HOURS } from '@/lib/kia/bookings'

export const dynamic = 'force-dynamic'

async function authorize() {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return { response: accessResponse, appUser: null }
  const appUser = await getAuthenticatedAppUser()
  const permission = await requirePermission(appUser, 'kia.proforma.view')
  if (!permission.allowed) return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
  return { response: null, appUser }
}

export async function GET(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response

    // Branch boundary: a dealer-scoped user only ever sees their own branch's vehicles (#10c).
    // MD/Developer/global users are unrestricted (getUserDealerScope returns null). Dealer codes
    // are validated against the registry, so they are safe to inline.
    const dealerScope = getUserDealerScope(auth.appUser, 'kia')
    const dealerScopeClause = dealerScope && dealerScope.length
      ? `sm.order_dealer IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})`
      : null

    const url = new URL(request.url)
    const search = url.searchParams.get('search') || ''
    const dealerCode = url.searchParams.get('dealer_code') || 'All'
    const model = url.searchParams.get('model') || 'All'
    const status = url.searchParams.get('status') || 'All'
    const page = Number(url.searchParams.get('page') || 1)
    const pageSize = Number(url.searchParams.get('pageSize') || 10)
    const offset = (page - 1) * pageSize
    const limitOffsetClause = pageSize === 9999 ? '' : `LIMIT ${pageSize} OFFSET ${offset}`

    // Build filters
    const filters: string[] = ['TRUE']
    if (dealerScopeClause) filters.push(dealerScopeClause)
    if (dealerCode !== 'All') {
      filters.push(`sm.order_dealer = '${dealerCode.replace(/'/g, "''")}'`)
    }
    if (model !== 'All') {
      filters.push(`sm.model ILIKE '%${model.replace(/'/g, "''")}%'`)
    }

    if (status !== 'All') {
      if (status === 'AVAILABLE') {
        filters.push('va.id IS NULL')
      } else if (status === 'ALLOTTED' || status === 'PAYMENT_PENDING') {
        filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')")
      } else if (status === 'PAYMENT_OVERDUE') {
        filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW()")
      } else if (status === 'PAID_TO_DELIVER') {
        filters.push("va.id IS NOT NULL AND kb.status = 'ready_delivery'")
      } else if (status === 'DELIVERED') {
        filters.push("va.id IS NOT NULL AND kb.status = 'delivered'")
      } else if (status === 'TRANSFERRED') {
        filters.push("vt.id IS NOT NULL")
      }
    }

    if (search) {
      const escaped = search.replace(/'/g, "''")
      filters.push(`(
        sm.vin_number ILIKE '%${escaped}%' OR
        kb.customer_name ILIKE '%${escaped}%' OR
        kb.customer_phone ILIKE '%${escaped}%' OR
        kb.booking_number ILIKE '%${escaped}%' OR
        kb.consultant_name ILIKE '%${escaped}%'
      )`)
    }

    // Delivered vehicles have left inventory: hide them from the default stock
    // list + Total Inventory. They remain reachable only via the explicit
    // "Delivered" status filter.
    const deliveredExpr = "(va.id IS NOT NULL AND kb.status = 'delivered')"
    if (status !== 'DELIVERED') {
      filters.push(`NOT ${deliveredExpr}`)
    }

    const whereClause = filters.join(' AND ')

    // Scope-only filters for the KPI metrics. The metrics break down BY status (available,
    // payment pending, delivered, …), so they must apply the current dealer/model/search scope
    // but NOT the status or delivered filters — otherwise the cards wouldn't reflect the
    // selected dealer/model at all (the previous bug: metrics ran with no WHERE).
    const scopeFilters: string[] = ['TRUE']
    if (dealerScopeClause) scopeFilters.push(dealerScopeClause)
    if (dealerCode !== 'All') scopeFilters.push(`sm.order_dealer = '${dealerCode.replace(/'/g, "''")}'`)
    if (model !== 'All') scopeFilters.push(`sm.model ILIKE '%${model.replace(/'/g, "''")}%'`)
    if (search) {
      const escaped = search.replace(/'/g, "''")
      scopeFilters.push(`(
        sm.vin_number ILIKE '%${escaped}%' OR
        kb.customer_name ILIKE '%${escaped}%' OR
        kb.customer_phone ILIKE '%${escaped}%' OR
        kb.booking_number ILIKE '%${escaped}%' OR
        kb.consultant_name ILIKE '%${escaped}%'
      )`)
    }
    const scopeWhereClause = scopeFilters.join(' AND ')

    // 1. Fetch metrics (Total Inventory excludes delivered units)
    const metricsResult = await db.execute(sql.raw(`
      SELECT
        COUNT(CASE WHEN NOT ${deliveredExpr} THEN 1 END)::int AS total_vins,
        COUNT(CASE WHEN va.id IS NULL THEN 1 END)::int AS available,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') THEN 1 END)::int AS payment_pending,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'delivered' THEN 1 END)::int AS delivered,
        COUNT(CASE WHEN vt.id IS NOT NULL THEN 1 END)::int AS transfers
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      WHERE ${scopeWhereClause}
    `))

    const metrics = metricsResult[0] || {
      total_vins: 0,
      available: 0,
      payment_pending: 0,
      payment_overdue: 0,
      paid_to_deliver: 0,
      delivered: 0,
      transfers: 0,
    }

    // 2. Fetch total count for pagination (join transfers too, since the
    // TRANSFERRED filter references vt.id in the WHERE clause)
    const totalCountResult = await db.execute(sql.raw(`
      SELECT COUNT(*)::int as count
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      WHERE ${whereClause}
    `))
    const totalRows = Number(totalCountResult[0]?.count || 0)
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

    // 3. Fetch data rows
    const rows = await db.execute(sql.raw(`
      SELECT 
        sm.id,
        sm.vin_number,
        sm.model,
        sm.variant,
        sm.exterior_color_name as color,
        sm.stock_age,
        sm.stock_status,
        sm.order_dealer as dealer_code,
        sm.engine_no,
        va.id as allocation_id,
        va.allocation_status,
        va.expires_at,
        va.created_at as allocated_at,
        kb.id as booking_id,
        kb.booking_number,
        kb.customer_name,
        kb.customer_phone,
        kb.consultant_name,
        kb.status as booking_status,
        kb.bank_name,
        kb.delivery_target_date as raw_delivery_target_date,
        COALESCE(kb.delivery_target_date::text, kb.metadata->>'expectedDeliveryDate') as booking_delivery_date,
        kb.metadata,
        vt.id as transfer_id,
        vt.transfer_status,
        vt.to_dealer_code,
        vt.requested_at as transfer_requested_at,
        u.full_name as transfer_requester_name
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN users u ON u.id = vt.requested_by
      WHERE ${whereClause}
      ORDER BY sm.stock_age::int DESC NULLS LAST, sm.id DESC
      ${limitOffsetClause}
    `))

    // 4. Fetch activities
    const activities = await db.execute(sql.raw(`
      SELECT id, title, description, actor_name, created_at
      FROM kia_booking_activity
      ORDER BY created_at DESC
      LIMIT 20
    `))

    // 5. Fetch distinct filters
    const filtersResult = await db.execute(sql.raw(`
      SELECT DISTINCT order_dealer as dealer FROM kia_stock_management WHERE order_dealer IS NOT NULL ORDER BY order_dealer
    `))
    const modelsResult = await db.execute(sql.raw(`
      SELECT DISTINCT model FROM kia_stock_management WHERE model IS NOT NULL ORDER BY model
    `))

    // 6. Sold / missing-from-DMS: allotted vehicles flagged by the sweep because their VIN has
    // disappeared from kia_stock_management. These CANNOT appear in the queries above (which start
    // FROM kia_stock_management) — the allocation's vehicle_snapshot is our only remaining record.
    const soldDealerClause = dealerScope && dealerScope.length
      ? `AND va.dealer_code IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})`
      : ''
    const soldMissing = await db.execute(sql.raw(`
      SELECT
        va.id AS allocation_id, va.vin_number, va.model, va.variant, va.color, va.engine_no,
        va.dealer_code, va.stock_missing_at, va.allocated_at, va.vehicle_snapshot,
        kb.id AS booking_id, kb.booking_number, kb.customer_name, kb.consultant_name, kb.status AS booking_status
      FROM kia_vehicle_allocations va
      JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      WHERE va.released_at IS NULL
        AND va.stock_status = 'sold'
        AND kb.status NOT IN ('delivered', 'cancelled')
        ${soldDealerClause}
      ORDER BY va.stock_missing_at DESC NULLS LAST
      LIMIT 200
    `))

    // 6b. #13 No Payment Received: allocations held after the reservation window lapsed without
    // payment. Kept (not released) so the vehicle stays visible from its snapshot even once the VIN
    // leaves the DMS feed. Same shape as soldMissing so the dashboard can render it identically.
    const noPayment = await db.execute(sql.raw(`
      SELECT
        va.id AS allocation_id, va.vin_number, va.model, va.variant, va.color, va.engine_no,
        va.dealer_code, va.expires_at, va.allocated_at, va.vehicle_snapshot,
        kb.id AS booking_id, kb.booking_number, kb.customer_name, kb.consultant_name, kb.status AS booking_status
      FROM kia_vehicle_allocations va
      JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      WHERE va.released_at IS NULL
        AND va.allocation_status = 'no_payment'
        AND kb.status NOT IN ('delivered', 'cancelled')
        ${soldDealerClause}
      ORDER BY va.expires_at DESC NULLS LAST
      LIMIT 200
    `))

    // 6c. #9 Transferred vehicles whose VIN has left the DMS feed — retained via the transfer's
    // vehicle_snapshot and shown under the DESTINATION dealer (to_dealer_code). Guarded: degrades to
    // an empty list if migration 0013 (the transfer retention columns) has not been applied yet.
    let transferMissing: unknown[] = []
    try {
      const transferDealerClause = dealerScope && dealerScope.length
        ? `AND vt.to_dealer_code IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})`
        : ''
      transferMissing = await db.execute(sql.raw(`
        SELECT
          vt.id AS transfer_id, vt.vin_number, vt.to_dealer_code AS dealer_code, vt.from_dealer_code,
          vt.stock_missing_at, vt.requested_at, vt.vehicle_snapshot,
          vt.requested_at as transfer_requested_at,
          u.full_name as transfer_requester_name,
          kb.id AS booking_id, kb.booking_number, kb.customer_name, kb.status AS booking_status
        FROM kia_vehicle_transfers vt
        LEFT JOIN kia_bookings kb ON kb.id = vt.booking_id AND kb.deleted_at IS NULL
        LEFT JOIN users u ON u.id = vt.requested_by
        WHERE vt.stock_missing_at IS NOT NULL
          AND LOWER(coalesce(vt.transfer_status, '')) IN ('transferred', 'requested')
          ${transferDealerClause}
        ORDER BY vt.stock_missing_at DESC NULLS LAST
        LIMIT 200
      `)) as unknown[]
    } catch (err) {
      console.error('transferMissing overlay skipped (migration 0013 may be pending):', err)
    }

    // 6d. #12 Dealer holds recorded in kia_stock_local_statuses, shown with a 48h countdown + Payment
    // Received / Release controls. First auto-release any unpaid holds past their window (returns the
    // VIN to stock). hold_expires_at = marked_at + 48h; paid = stock_status_at_mark 'PAID'.
    let heldVehicles: unknown[] = []
    try {
      // (Hold expiry moved off this read path — it now runs on the scheduled maintenance job,
      // POST /api/brands/kia/maintenance. This route just reads the current hold rows.)
      const heldDealerClause = dealerScope && dealerScope.length
        ? `AND ls.dealer_code IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''")}'`).join(', ')})`
        : ''
      heldVehicles = await db.execute(sql.raw(`
        SELECT ls.vin_number, ls.local_status, ls.dealer_code, ls.model, ls.variant, ls.color,
               ls.customer_name, ls.booking_no, ls.notes, ls.marked_by_name, ls.marked_at,
               (ls.marked_at + interval '${KIA_HOLD_WINDOW_HOURS} hours') AS hold_expires_at,
               (coalesce(ls.stock_status_at_mark, '') = 'PAID') AS paid,
               ls.vehicle_snapshot
        FROM kia_stock_local_statuses ls
        WHERE ls.local_status IN ('hold_customer', 'hold_dealer')
          ${heldDealerClause}
        ORDER BY ls.marked_at DESC NULLS LAST
        LIMIT 200
      `)) as unknown[]
    } catch (err) {
      console.error('heldVehicles overlay skipped (migration 0013 may be pending):', err)
    }

    return NextResponse.json({
      metrics: { ...metrics, sold_missing: soldMissing.length, no_payment: noPayment.length, transfer_missing: transferMissing.length, held: heldVehicles.length },
      rows,
      soldMissing,
      noPayment,
      transferMissing,
      heldVehicles,
      activities,
      filters: {
        dealers: filtersResult.map((r) => (r as { dealer: string }).dealer),
        models: modelsResult.map((r) => (r as { model: string }).model),
      },
      pagination: {
        page,
        pageSize,
        total: totalRows,
        totalPages,
      },
    })
  } catch (error) {
    console.error('Failed to fetch stock management data:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch stock management data' }, { status: 500 })
  }
}
