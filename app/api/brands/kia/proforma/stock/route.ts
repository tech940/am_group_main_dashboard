import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { requirePermission } from '@/lib/permissions/service'

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
      } else if (status === 'ALLOTTED') {
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
        (SELECT COUNT(*)::int FROM kia_vehicle_transfers WHERE LOWER(transfer_status) IN ('transferred', 'requested')) AS transfers
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
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
      LEFT JOIN kia_vehicle_transfers vt ON vt.vin_number = sm.vin_number AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
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
        vt.to_dealer_code
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON vt.vin_number = sm.vin_number AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
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

    return NextResponse.json({
      metrics: { ...metrics, sold_missing: soldMissing.length },
      rows,
      soldMissing,
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
