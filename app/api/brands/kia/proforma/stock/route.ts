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

  const permission = await requirePermission(appUser, 'kia.bookings.view')
  if (!permission.allowed) {
    const fallback1 = await requirePermission(appUser, 'kia.proforma.view')
    if (!fallback1.allowed) {
      const fallback2 = await requirePermission(appUser, 'kia.stock_report.view')
      if (!fallback2.allowed) {
        return { response: NextResponse.json({ error: permission.reason }, { status: 403 }), appUser }
      }
    }
  }
  return { response: null, appUser }
}

export async function GET(request: Request) {
  try {
    const auth = await authorize()
    if (auth.response) return auth.response

    // ⚠️ The expired-allocation sweep used to run here. Removed with the one on the bookings list:
    // it is the maintenance cron's job (POST /api/brands/kia/maintenance), and repeating it per
    // request cost ~514 ms of transaction overhead on a read endpoint for work that is nearly always
    // a no-op.

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
    /*
     * Raw DMS vehicle status from kia_stock_management.stock_status ('Free Stock', 'In transit',
     * 'Allocated', 'Invoice', 'From Other Dealer'). A DIFFERENT axis from `status` above, which is our
     * own workflow bucket — this one asks "what does the DMS feed say about this car".
     *
     * Compared on UPPER(TRIM(...)). The feed currently has no casing variants, but normalising means a
     * future 'FREE STOCK' cannot silently split the bucket in two.
     */
    const dmsStatus = (url.searchParams.get('dms_status') || 'All').trim()
    const dmsStatusSelected = dmsStatus !== '' && dmsStatus !== 'All'
    const dmsStatusClause = dmsStatusSelected
      ? `UPPER(TRIM(COALESCE(sm.stock_status, ''))) = '${dmsStatus.toUpperCase().replace(/'/g, "''")}'`
      : null
    const startDate = url.searchParams.get('start_date') || ''
    const endDate = url.searchParams.get('end_date') || ''
    const page = Number(url.searchParams.get('page') || 1)
    const pageSize = Number(url.searchParams.get('pageSize') || 10)
    const offset = (page - 1) * pageSize
    const limitOffsetClause = pageSize === 9999 ? '' : `LIMIT ${pageSize} OFFSET ${offset}`

    // Build filters
    const filters: string[] = ['TRUE']
    if (dealerScopeClause) filters.push(dealerScopeClause)
    if (startDate) {
      const escaped = startDate.replace(/'/g, "''")
      filters.push(`COALESCE(sm.uploaded_at, sm.created_at)::date >= '${escaped}'::date`)
    }
    if (endDate) {
      const escaped = endDate.replace(/'/g, "''")
      filters.push(`COALESCE(sm.uploaded_at, sm.created_at)::date <= '${escaped}'::date`)
    }
    if (dealerCode !== 'All') {
      filters.push(`sm.order_dealer = '${dealerCode.replace(/'/g, "''")}'`)
    }
    if (model !== 'All') {
      const escapedModel = model.replace(/'/g, "''")
      const baseKeyword = escapedModel
        .replace(/^(new|all new|the new)\s+/i, '')
        .replace(/\s+(petrol|diesel|ev|hev|mhev)$/i, '')
        .trim()

      filters.push(`(
        sm.model ILIKE '%${escapedModel}%' OR 
        sm.model ILIKE '%${baseKeyword}%'
      )`)

      if (/petrol/i.test(escapedModel)) {
        filters.push(`(sm.variant ILIKE '%petrol%' OR sm.variant ILIKE '%g1.%')`)
      } else if (/diesel/i.test(escapedModel)) {
        filters.push(`(sm.variant ILIKE '%diesel%' OR sm.variant ILIKE '%d1.%')`)
      }
    }

    // A car sold by the DMS rather than through this app. Two independent signals, because neither
    // catches everything on its own:
    //   - stock_status = 'Invoice' → the DMS has invoiced it to a named customer (13 cars; all 13
    //     carry a DMS booking_no + cust_name + kin_invoice_date).
    //   - a delivery_date in kia_sales_report → the retail source of truth, which catches a further
    //     16 cars still sitting in the feed as 'Free Stock'.
    // This matters because ~10 of the 13 invoiced cars were sold with NO app booking, so there is no
    // kia_vehicle_allocations row to detect them by — the allocation-based checks are blind to them
    // and they stayed bookable. Mirrors STOCK_SOURCE_NOT_RETAILED in lib/kia/stock-report.ts, which
    // is what makes the two surfaces agree again.
    const dmsSoldFor = (alias: string) => `(
      UPPER(COALESCE(${alias}.stock_status, '')) = 'INVOICE'
      OR EXISTS (
        SELECT 1 FROM kia_sales_report sr
        WHERE UPPER(TRIM(sr.vin_number)) = UPPER(TRIM(${alias}.vin_number))
          AND sr.delivery_date IS NOT NULL
      )
    )`
    const dmsSoldExpr = dmsSoldFor('sm')

    // `stock_age` is a TEXT column straight from the DMS feed, so every comparison has to strip
    // non-digits before casting — a stray "d" or blank would abort the whole query on ::int.
    const ageInt = (alias: string) => `COALESCE(NULLIF(regexp_replace(COALESCE(${alias}.stock_age, ''), '[^0-9]', '', 'g'), ''), '0')::int`

    // In-transit vehicles are not sellable stock — the car is still on a truck — so they are kept
    // out of this surface: the list, every KPI, and the FIFO ageing comparison.
    //
    // The one exception is an in-transit car that ALREADY carries a live allocation. That vehicle
    // is committed to a real customer and is mid-workflow (booking status 'transferring', payment
    // clock deliberately deferred until it arrives). Dropping it unconditionally removed it from
    // Payment Pending — the count fell 8 → 7 — and hid an active booking's vehicle from the board.
    // It is not offerable stock, but it very much still needs watching.
    //
    // Applied to both `filters` (rows) and `scopeFilters` (metrics) so the cards can never disagree
    // with the table beneath them.
    //
    // ⚠️ An explicit `dms_status` choice OVERRIDES this guard. Asking for "In transit" and being shown
    // 1 of the 9 in-transit cars because a guard silently dropped the rest is worse than useless — the
    // whole point of that filter is to see them. Same reasoning applies to the delivered/sold guard
    // below, which hides both 'Invoice' cars and would have made that option permanently empty.
    const notInTransit = `NOT (UPPER(TRIM(COALESCE(sm.stock_status, ''))) = 'IN TRANSIT' AND va.id IS NULL)`
    if (!dmsStatusSelected) filters.push(notInTransit)
    if (dmsStatusClause) filters.push(dmsStatusClause)

    if (status !== 'All') {
      if (status === 'AVAILABLE') {
        filters.push(`va.id IS NULL AND vt.id IS NULL AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail') AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED') AND NOT ${dmsSoldExpr}`)
      } else if (status === 'ALLOTTED' || status === 'PAYMENT_PENDING') {
        // Payment Pending means OUR allocation is waiting on the customer's money — so it requires an
        // app allocation row, full stop.
        //
        // This used to also match `sm.stock_status = 'ALLOCATED' AND va.id IS NULL`, i.e. cars the DMS
        // had committed that nobody here ever allotted. Measured: of the 8 rows this returned, 7 had
        // NO allocation row, NO booking and NO customer — nothing was waiting on any payment, and
        // there was no payment window to be inside. The real number is 1.
        //
        // Those 7 are not homeless: they are counted as `dms_allocated` and reachable via the
        // ALLOCATED_DMS filter, which is what that status is for.
        filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')")
      } else if (status === 'PAYMENT_OVERDUE') {
        filters.push("va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW()")
      } else if (status === 'ALLOCATED_DMS') {
        // Cars the DMS has committed to a customer but which this app knows nothing about (no
        // allocation row of our own).
        //
        // They are NOT in the Available bucket because `available` excludes stock_status 'ALLOCATED'
        // — someone else has already claimed the car in the DMS, so counting it as free to offer
        // overstates what we can sell.
        //
        // ⚠️ That is a REPORTING boundary, not a capability one: these cars ARE still allottable.
        // readMatchingVehicle (lib/kia/bookings.ts:1653) deliberately ignores stock_status and admits
        // any VIN with no live allocation — it was changed to work that way precisely because rows
        // showing an Allot button used to fail. So do not "fix" the UI by disabling Allot here; the
        // row keeps its actions and only its label and its KPI bucket change.
        //
        // `va.id IS NULL AND vt.id IS NULL` keeps this bucket DISJOINT from Payment Pending and
        // Transfers. Without it, a car we allotted that the DMS feed later also reports as
        // 'Allocated' would be counted twice and the cards would stop summing to Total VINs.
        filters.push("UPPER(TRIM(COALESCE(sm.stock_status, ''))) = 'ALLOCATED' AND va.id IS NULL AND vt.id IS NULL")
      } else if (status === 'PAID_TO_DELIVER') {
        filters.push("va.id IS NOT NULL AND kb.status = 'ready_delivery'")
      } else if (status === 'DELIVERED') {
        filters.push("va.id IS NOT NULL AND kb.status = 'delivered'")
      } else if (status === 'TRANSFERRED') {
        // Kept only so `whereClause` stays valid if this branch is ever reused. The Transferred view
        // does NOT go through these filters — it reads kia_vehicle_transfers directly (see
        // `transferredFrom` below), because a transferred VIN has left kia_stock_management and this
        // predicate could only ever match nothing.
        filters.push('vt.id IS NOT NULL')
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
    const deliveredExpr = `((va.id IS NOT NULL AND kb.status = 'delivered') OR (COALESCE(ls.local_status, '') = 'retail' AND COALESCE(kb.status, '') != 'ready_delivery') OR ${dmsSoldExpr})`
    // Skipped for an explicit dms_status: this guard contains dmsSoldExpr, which excludes every
    // stock_status='Invoice' row, so leaving it on made that option match 0 of its 2 rows.
    if (status !== 'DELIVERED' && !dmsStatusSelected) {
      filters.push(`NOT ${deliveredExpr}`)
    }

    const whereClause = filters.join(' AND ')

    // Scope-only filters for the KPI metrics. The metrics break down BY status (available,
    // payment pending, delivered, …), so they must apply the current dealer/model/search scope
    // but NOT the status or delivered filters — otherwise the cards wouldn't reflect the
    // selected dealer/model at all (the previous bug: metrics ran with no WHERE).
    const scopeFilters: string[] = ['TRUE']
    // Same in-transit exclusion as the row list — a KPI that counted cars the table refuses to show
    // would be the "sidebar says 205, page says 0" class of bug all over again.
    // Both the guard override and the dms_status clause are mirrored here, so the cards describe
    // exactly the set the table is showing.
    if (!dmsStatusSelected) scopeFilters.push(notInTransit)
    if (dmsStatusClause) scopeFilters.push(dmsStatusClause)
    if (dealerScopeClause) scopeFilters.push(dealerScopeClause)
    if (startDate) {
      const escaped = startDate.replace(/'/g, "''")
      scopeFilters.push(`COALESCE(sm.uploaded_at, sm.created_at)::date >= '${escaped}'::date`)
    }
    if (endDate) {
      const escaped = endDate.replace(/'/g, "''")
      scopeFilters.push(`COALESCE(sm.uploaded_at, sm.created_at)::date <= '${escaped}'::date`)
    }
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

    // Transfers are counted from kia_vehicle_transfers DIRECTLY, not by joining out of
    // kia_stock_management. A transferred vehicle leaves this dealer's DMS stock feed — the schema
    // says so on kia_vehicle_transfers.vehicle_snapshot ("the destination dealer keeps the vehicle
    // even after the VIN leaves the DMS feed") — so counting them through a join FROM the stock
    // table was structurally incapable of returning anything but 0: of 16 transfer records only 1
    // VIN still had a stock row, and that one was Cancelled.
    //
    // The date range must also use the transfer's OWN timestamp. The page's date filter applies to
    // sm.uploaded_at, which is when the stock feed last touched the row and says nothing about when
    // a transfer happened — which is why narrowing the dates never changed this number either.
    const transferFilters: string[] = ["LOWER(t.transfer_status) IN ('transferred', 'requested')"]
    if (dealerCode !== 'All') {
      const escapedDealer = dealerCode.replace(/'/g, "''")
      // Either direction: an inter-outlet move involves this dealer whether it sent or received.
      transferFilters.push(`(t.from_dealer_code = '${escapedDealer}' OR t.to_dealer_code = '${escapedDealer}')`)
    }
    if (startDate) {
      transferFilters.push(`t.requested_at::date >= '${startDate.replace(/'/g, "''")}'::date`)
    }
    if (endDate) {
      transferFilters.push(`t.requested_at::date <= '${endDate.replace(/'/g, "''")}'::date`)
    }
    const transfersCountSql = `(SELECT COUNT(*) FROM kia_vehicle_transfers t WHERE ${transferFilters.join(' AND ')})::int`

    // 1. Fetch metrics (Total Inventory excludes delivered units)
    //
    // Total VINs re-applies the delivered guard INSIDE the CASE, so overriding it in scopeFilters
    // alone was not enough: filtering to 'Invoice' would have shown 2 rows under a "0 TOTAL VINS"
    // card. With an explicit dms_status, Total VINs counts everything in scope instead.
    const totalVinsGuard = dmsStatusSelected ? 'TRUE' : `NOT ${deliveredExpr}`
    const metricsResult = await db.execute(sql.raw(`
      SELECT
        COUNT(CASE WHEN ${totalVinsGuard} THEN 1 END)::int AS total_vins,
        COUNT(
          CASE WHEN va.id IS NULL
                AND vt.id IS NULL
                AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail')
                AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')
                AND NOT ${dmsSoldExpr}
          THEN 1 END
        )::int AS available,
        -- Waiting on a customer's money against an allocation WE made. Requires va.id — see the
        -- PAYMENT_PENDING filter above for why the DMS-'ALLOCATED' disjunct was removed (it inflated
        -- this from a true 1 to 8).
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') THEN 1 END)::int AS payment_pending,
        -- Committed inside the DMS with no allocation of ours. Its own bucket rather than folded into
        -- Available (it cannot be allotted — readMatchingVehicle only admits Free Stock / In transit)
        -- or Payment Pending (nothing is owed to us). Delivered-guarded and allocation/transfer-
        -- disjoint so available + payment_pending + dms_allocated + paid + transfers still reconciles
        -- against total_vins.
        COUNT(CASE WHEN UPPER(TRIM(COALESCE(sm.stock_status, ''))) = 'ALLOCATED'
                    AND va.id IS NULL AND vt.id IS NULL
                    AND NOT ${deliveredExpr} THEN 1 END)::int AS dms_allocated,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'delivered' THEN 1 END)::int AS delivered,
        ${transfersCountSql} AS transfers
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE ${scopeWhereClause}
    `))

    const metrics = metricsResult[0] || {
      total_vins: 0,
      available: 0,
      payment_pending: 0,
      dms_allocated: 0,
      payment_overdue: 0,
      paid_to_deliver: 0,
      delivered: 0,
      transfers: 0,
    }

    /*
     * TRANSFERRED reads a DIFFERENT SOURCE, and has to.
     *
     * A transferred vehicle leaves this dealer's DMS stock feed, so it is gone from
     * kia_stock_management — measured: of 16 transfer records only 1 VIN was still in that table,
     * and that one was Cancelled. Filtering `vt.id IS NOT NULL` over the stock table therefore
     * returned an empty list ("no vehicles") no matter what, which is exactly what it did.
     *
     * kia_vehicle_transfers.vehicle_snapshot exists for this: it captures the car at transfer time
     * (all 16 rows have one populated). So the Transferred view is built FROM the transfers table,
     * with the snapshot supplying model/variant/colour/age, and a LEFT JOIN back to
     * kia_stock_management only to prefer live values for any VIN that happens to still be there.
     */
    const transferredScope: string[] = ["LOWER(COALESCE(vt.transfer_status, '')) IN ('transferred', 'requested')"]
    if (dealerCode !== 'All') {
      const escaped = dealerCode.replace(/'/g, "''")
      // Either direction — an inter-outlet move involves the sending and receiving outlet.
      transferredScope.push(`(vt.from_dealer_code = '${escaped}' OR vt.to_dealer_code = '${escaped}')`)
    }
    if (model !== 'All') {
      const escaped = model.replace(/'/g, "''")
      transferredScope.push(`COALESCE(sm.model, vt.vehicle_snapshot->>'model') ILIKE '%${escaped}%'`)
    }
    if (search) {
      const escaped = search.replace(/'/g, "''")
      transferredScope.push(`(
        vt.vin_number ILIKE '%${escaped}%' OR
        kb.customer_name ILIKE '%${escaped}%' OR
        kb.booking_number ILIKE '%${escaped}%' OR
        kb.consultant_name ILIKE '%${escaped}%'
      )`)
    }
    if (startDate) {
      transferredScope.push(`vt.requested_at::date >= '${startDate.replace(/'/g, "''")}'::date`)
    }
    if (endDate) {
      transferredScope.push(`vt.requested_at::date <= '${endDate.replace(/'/g, "''")}'::date`)
    }
    const transferredWhere = transferredScope.join(' AND ')
    const transferredFrom = `
      FROM kia_vehicle_transfers vt
      LEFT JOIN kia_stock_management sm ON UPPER(TRIM(sm.vin_number)) = UPPER(TRIM(vt.vin_number))
      LEFT JOIN kia_bookings kb ON kb.id = vt.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_allocations va ON va.booking_id = vt.booking_id AND va.released_at IS NULL
      LEFT JOIN users u ON u.id = vt.requested_by
      WHERE ${transferredWhere}`
    const isTransferredView = status === 'TRANSFERRED'

    // 2. Fetch total count for pagination (join transfers and local statuses too)
    const totalCountResult = isTransferredView
      ? await db.execute(sql.raw(`SELECT COUNT(*)::int as count ${transferredFrom}`))
      : await db.execute(sql.raw(`
      SELECT COUNT(*)::int as count
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      WHERE ${whereClause}
    `))
    const totalRows = Number(totalCountResult[0]?.count || 0)
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

    // 3. Fetch data rows
    const rows = isTransferredView
      ? await db.execute(sql.raw(`
      SELECT
        vt.id::text AS id,
        vt.vin_number,
        -- Prefer the live feed when the VIN is somehow still there, else the transfer-time snapshot.
        COALESCE(sm.model, vt.vehicle_snapshot->>'model') AS model,
        COALESCE(sm.variant, vt.vehicle_snapshot->>'variant') AS variant,
        COALESCE(sm.exterior_color_name, vt.vehicle_snapshot->>'exterior_color_name') AS color,
        COALESCE(sm.stock_age, vt.vehicle_snapshot->>'stock_age') AS stock_age,
        -- The row's own status IS the transfer state; the DMS status is meaningless once it's gone.
        COALESCE(vt.transfer_status, 'Transferred') AS stock_status,
        COALESCE(vt.from_dealer_code, sm.order_dealer, vt.vehicle_snapshot->>'order_dealer') AS dealer_code,
        COALESCE(sm.engine_no, vt.vehicle_snapshot->>'engine_no') AS engine_no,
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
        u.full_name as transfer_requester_name,
        -- The FIFO ageing comparison is about allottable stock; a transferred car is not that.
        0 AS older_count,
        NULL AS oldest_alternative_vin,
        NULL AS oldest_alternative_age
      ${transferredFrom}
      ORDER BY vt.requested_at DESC NULLS LAST, vt.id DESC
      ${limitOffsetClause}
    `))
      : await db.execute(sql.raw(`
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
        u.full_name as transfer_requester_name,
        older.older_count,
        older.oldest_vin as oldest_alternative_vin,
        older.oldest_age as oldest_alternative_age
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      LEFT JOIN users u ON u.id = vt.requested_by
      /*
       * FIFO guard. For each vehicle, find how many OTHER allottable vehicles of the same
       * model+variant at the same outlet have been sitting in stock longer, and which is the oldest.
       *
       * Deliberately computed over the WHOLE stock table, ignoring the page's dealer/model/status/
       * date filters — otherwise filtering the list to one model would hide the very cars the
       * warning exists to surface, and the alert would go quiet exactly when it is needed.
       *
       * Same outlet only (order_dealer): a car at the other branch cannot simply be allotted, it
       * would need a transfer, so warning about it would be noise rather than a usable alternative.
       */
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS older_count,
          (ARRAY_AGG(alt.vin_number ORDER BY ${ageInt('alt')} DESC, alt.id))[1] AS oldest_vin,
          MAX(${ageInt('alt')}) AS oldest_age
        FROM kia_stock_management alt
        LEFT JOIN kia_vehicle_allocations alt_va
          ON alt_va.vin_number = alt.vin_number AND alt_va.released_at IS NULL
        LEFT JOIN kia_vehicle_transfers alt_vt
          ON UPPER(alt_vt.vin_number) = UPPER(alt.vin_number)
         AND LOWER(alt_vt.transfer_status) IN ('transferred', 'requested')
        LEFT JOIN kia_stock_local_statuses alt_ls ON alt_ls.vin_number = alt.vin_number
        WHERE alt.id <> sm.id
          AND UPPER(TRIM(COALESCE(alt.model, ''))) = UPPER(TRIM(COALESCE(sm.model, '')))
          AND UPPER(TRIM(COALESCE(alt.variant, ''))) = UPPER(TRIM(COALESCE(sm.variant, '')))
          AND COALESCE(alt.order_dealer, '') = COALESCE(sm.order_dealer, '')
          AND ${ageInt('alt')} > ${ageInt('sm')}
          AND alt_va.id IS NULL
          AND alt_vt.id IS NULL
          AND COALESCE(alt_ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail')
          AND UPPER(COALESCE(alt.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')
          -- A car still on a truck is not a usable alternative to suggest.
          AND UPPER(TRIM(COALESCE(alt.stock_status, ''))) <> 'IN TRANSIT'
          AND NOT ${dmsSoldFor('alt')}
      ) older ON TRUE
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
    // DMS status options, driven by the feed rather than a hardcoded list — the DMS can introduce a
    // status at any time and a literal array would quietly stop offering it. Ordered by how many
    // vehicles carry it, so the statuses that matter sit at the top of the dropdown.
    const dmsStatusesResult = await db.execute(sql.raw(`
      SELECT TRIM(stock_status) AS status, COUNT(*)::int AS count
      FROM kia_stock_management
      WHERE stock_status IS NOT NULL AND TRIM(stock_status) <> ''
      GROUP BY TRIM(stock_status)
      ORDER BY count DESC, status
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
        // Counts ride along so the dropdown can show "In transit (9)" — without them a user picking a
        // status has no way to know whether an empty result means "none" or "filter broken", which is
        // the exact confusion this whole surface has produced before.
        dmsStatuses: dmsStatusesResult.map((r) => r as { status: string; count: number }),
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
