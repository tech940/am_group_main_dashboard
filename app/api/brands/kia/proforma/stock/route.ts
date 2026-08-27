import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { getUserDealerScope } from '@/lib/auth/dealer-scope'
import { kiaDeliveredByUsSql } from '@/lib/kia/bookings'
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
    /*
     * ── THE DELIVERED WINDOW ──────────────────────────────────────────────────────────────────
     *
     * Delivered defaults to the CURRENT INDIAN MONTH. Every other view on this board describes
     * stock as it stands today, so it needs no window; Delivered is a historical record that only
     * grows, and lifetime it is a list of every car the dealership has ever handed over — 33 rows
     * reaching back months, which is not what someone opening the stock board is asking.
     *
     * An explicit range from the filter bar overrides it, so the history is still reachable.
     *
     * ⚠️ Built as a SQL fragment used by the card count AND the row query. They must never be
     * allowed to drift: a Delivered card that disagrees with the rows it opens is precisely the
     * defect this view was just rebuilt to fix.
     *
     * ⚠️ The month boundary is computed in Asia/Kolkata, not on the server clock — the server is
     * UTC in production, so a UTC month boundary is 5h30m adrift and would misfile deliveries on
     * the first and last day of every month.
     */
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

    /*
     * "Show me everything, whatever its status."
     *
     * True for an explicit dms_status pick, and for status='All' — which is what the TOTAL VINS card
     * selects. Both are the user asking to stop bucketing, so the two implicit workflow guards
     * (in-transit, delivered/sold) are dropped for them. Without this, Total VINs opened a list of 73
     * of the 88 vehicles: 7 in-transit cars with no allocation and 8 delivered/sold ones were filtered
     * out, so 'Invoice' and 'From Other Dealer' vehicles could not be seen from that card at all.
     */
    const showEveryStatus = dmsStatusSelected || status === 'All'
    const startDate = url.searchParams.get('start_date') || ''
    const endDate = url.searchParams.get('end_date') || ''

    /**
     * @param alias the kia_bookings alias in the query being built.
     */
    const deliveredWindowSql = (alias: string) => {
      if (startDate || endDate) {
        return `
        ${startDate ? `AND ${alias}.delivered_at >= '${startDate.replace(/'/g, "''")}'::date` : ''}
        ${endDate ? `AND ${alias}.delivered_at < ('${endDate.replace(/'/g, "''")}'::date + 1)` : ''}`
      }
      // No explicit range: the current Indian month.
      return `
        AND ${alias}.delivered_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')
        AND ${alias}.delivered_at < date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 month'`
    }


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
    const deliveredByUsExpr = kiaDeliveredByUsSql('sm')

    /*
     * A vehicle that has left inventory. THREE independent signals, because no one of them catches
     * everything: our own booking marked delivered, a local 'retail' status, or the DMS having sold
     * it. Hoisted above the filter block on purpose — the DELIVERED view used to apply only the
     * FIRST disjunct while the default list hid all three, so 2 cars were hidden from the list as
     * delivered AND unreachable from the Delivered card. They existed in the data and appeared
     * nowhere in the UI.
     */
    /*
     * DELIVERED, as this dealership means it: a booking OUR people (CXM/CCM) marked delivered.
     * No DMS signal — a car the DMS invoiced or shows as 'Allocated' is somebody else's commitment
     * and is counted on the DMS Allocated card instead. Explicitly per the MD: "we have nothing to
     * do with DMS".
     */
    const oursDeliveredExpr = 'dlv.id IS NOT NULL'

    const deliveredExpr = `((va.id IS NOT NULL AND kb.status = 'delivered') OR (COALESCE(ls.local_status, '') = 'retail' AND COALESCE(kb.status, '') != 'ready_delivery') OR ${dmsSoldExpr})`

    // `stock_age` is a TEXT column straight from the DMS feed, so every comparison has to strip
    // non-digits before casting — a stray "d" or blank would abort the whole query on ::int.
    const ageInt = (alias: string) => `COALESCE(NULLIF(regexp_replace(COALESCE(${alias}.stock_age, ''), '[^0-9]', '', 'g'), ''), '0')::int`

    /*
     * In-transit vehicles ARE part of this surface.
     *
     * They used to be excluded from the list, every KPI and the ageing comparison on the grounds
     * that "the car is still on a truck". That contradicted the rest of the system: the Allot
     * picker offers in-transit cars (they are in KIA_ALLOTTABLE_STOCK_STATUSES), and the allot flow
     * models them explicitly — booking status 'transferring', payment clock deliberately deferred
     * until the car lands. So the dashboard was hiding 13 of 90 VINs that it would happily allot,
     * and those 13 belonged to no KPI card at all: the six cards summed to 77 of 90.
     *
     * ⚠️ DMS 'Allocated' is a DIFFERENT case and stays OUT of Available. In this feed it means sold
     * in the DMS by someone outside this dashboard — 10 rows, every one carrying a DMS cust_name
     * and booking_no, and 9 of the 10 matching no booking in this system. They keep their own
     * "Allocated (DMS)" card. Folding them into Available would offer other people's sold cars to
     * new customers.
     */
    if (dmsStatusClause) filters.push(dmsStatusClause)

    if (status !== 'All') {
      if (status === 'AVAILABLE') {
        filters.push(`va.id IS NULL AND vt.id IS NULL AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail') AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED') AND NOT ${dmsSoldExpr} AND NOT ${deliveredByUsExpr}`)
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
      } else if (status === 'ON_HOLD') {
        /*
         * #12 Vehicles held for a dealer or a customer, reserved outside the allocation workflow.
         *
         * The hold itself always worked -- kia_stock_local_statuses gets its 'hold_dealer' row -- but
         * a held car had nowhere to BE. It drops out of Available (that filter excludes both hold
         * statuses) and matched no other bucket, so from the user's seat holding a vehicle made it
         * vanish rather than marking it held. The only surface showing holds was a separate overlay
         * panel far down the page, which is not where someone who just pressed Hold looks.
         *
         * Rooted at kia_stock_management like AVAILABLE and PAYMENT_PENDING, NOT at the local-status
         * table the way TRANSFERRED reads the transfers table. That is safe because a held car is by
         * definition still in stock -- holdKiaStockVehicle refuses a VIN with a live allocation and
         * refuses one already retailed, and the DMS feed still carries it. Measured: 2 of 2 current
         * holds are present in the feed. The metrics count below uses this identical predicate, so
         * the card can never disagree with the tab it opens.
         */
        filters.push("COALESCE(ls.local_status, '') IN ('hold_customer', 'hold_dealer')")
      } else if (status === 'PAID_TO_DELIVER') {
        filters.push("va.id IS NOT NULL AND kb.status = 'ready_delivery'")
      } else if (status === 'DELIVERED') {
        // Lists exactly what the card counts, so the two can never disagree. The DMS-only rows that
        // `deliveredExpr` would add are NOT orphaned by this: a DMS-'Allocated' car with no booking
        // sits on the DMS Allocated card, and one still awaiting payment sits on Payment Pending.
        filters.push(oursDeliveredExpr)
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

    // Delivered vehicles have left inventory: hide them from the default stock list + Total
    // Inventory. They remain reachable via the explicit "Delivered" status filter, which uses this
    // same expression. (Defined above, next to dmsSoldExpr.)
    // Skipped for an explicit dms_status: this guard contains dmsSoldExpr, which excludes every
    // stock_status='Invoice' row, so leaving it on made that option match 0 of its 2 rows.
    if (status !== 'DELIVERED' && !showEveryStatus) {
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
    // The dms_status clause is mirrored here so the cards describe exactly the set the table shows.
    //
    // The in-transit exclusion is gone entirely (see the note where it used to be defined): those
    // cars are allottable and now belong to Available, so nothing caps total_vins below the real
    // inventory and the six bucket counts finally sum to it.
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
    /*
     * ⚠️ dealerScope is the user's PINNED branches; dealerCode is the dropdown they picked. Every
     * other bucket in this file scopes by the former, and this count did not -- so a branch-pinned
     * user (an IDT on JK501,JK402) was counting inter-outlet moves belonging to outlets they cannot
     * otherwise see. It happens to read the same today because every live transfer originates at
     * JK402, which is exactly why it went unnoticed; the first transfer between two other outlets
     * would have exposed it.
     */
    if (dealerScope && dealerScope.length) {
      const scoped = dealerScope.map((d) => `'${d.replace(/'/g, "''").toUpperCase()}'`).join(', ')
      transferFilters.push(`(UPPER(TRIM(COALESCE(t.from_dealer_code, ''))) IN (${scoped}) OR UPPER(TRIM(COALESCE(t.to_dealer_code, ''))) IN (${scoped}))`)
    }
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


    // 1. Fetch metrics
    //
    // TOTAL VINS is now literally every vehicle in scope — it is the card that means "whole
    // inventory", and clicking it selects status='All', which shows every row. It used to re-apply
    // the delivered guard inside this CASE while scopeFilters applied the in-transit one, so the card
    // read 73 against a real 88 and the 15 it omitted were unreachable from it.
    //
    // Only `available` inherits the in-transit guard, because only `available` can be fooled by it:
    // every other bucket requires va.id IS NOT NULL (or stock_status='ALLOCATED'), which makes
    // `NOT (in-transit AND va.id IS NULL)` vacuously true. So all six bucket counts are unchanged.
    const metricsResult = await db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total_vins,
        COUNT(
          CASE WHEN va.id IS NULL
                AND vt.id IS NULL
                AND COALESCE(ls.local_status, '') NOT IN ('hold_customer', 'hold_dealer', 'retail')
                AND UPPER(COALESCE(sm.stock_status, '')) NOT IN ('DELIVERED', 'TRANSFERRED', 'SOLD', 'ALLOCATED', 'ALLOTTED')
                AND NOT ${dmsSoldExpr}
                -- A car WE handed over is not available, whatever the DMS feed still says. Without
                -- this, 7 delivered vehicles were counted here and offered with an Allot button.
                AND NOT ${deliveredByUsExpr}
          THEN 1 END
        )::int AS available,
        -- #12 Holds. The SAME predicate the ON_HOLD filter uses, so card and tab cannot drift.
        COUNT(CASE WHEN COALESCE(ls.local_status, '') IN ('hold_customer', 'hold_dealer') THEN 1 END)::int AS on_hold,
        -- Waiting on a customer's money against an allocation WE made. Requires va.id — see the
        -- PAYMENT_PENDING filter above for why the DMS-'ALLOCATED' disjunct was removed (it inflated
        -- this from a true 1 to 8).
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') THEN 1 END)::int AS payment_pending,
        -- Committed inside the DMS with no allocation of ours. Its own bucket rather than folded into
        -- Available (someone else has claimed the car, so it is not free to offer) or Payment Pending
        -- (nothing is owed to us). It IS still allottable — readMatchingVehicle ignores stock_status.
        -- Allocation/transfer-disjoint so the buckets never double-count.
        COUNT(CASE WHEN UPPER(TRIM(COALESCE(sm.stock_status, ''))) = 'ALLOCATED'
                    AND va.id IS NULL AND vt.id IS NULL
                    AND NOT ${deliveredExpr} THEN 1 END)::int AS dms_allocated,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered') AND va.expires_at <= NOW() THEN 1 END)::int AS payment_overdue,
        COUNT(CASE WHEN va.id IS NOT NULL AND kb.status = 'ready_delivery' THEN 1 END)::int AS paid_to_deliver,
        /*
         * Counts the same set the Delivered VIEW lists, so card and list always agree — and that
         * view is rooted at kia_bookings, not here. A CASE over kia_stock_management can only ever
         * see the delivered cars still present in today's DMS snapshot (6 of 33 measured), which is
         * why the card and the Booking CRM disagreed. Scoped on kb.dealer_code to match the view.
         */
        (SELECT COUNT(DISTINCT dkb.id)::int FROM kia_bookings dkb
          WHERE dkb.deleted_at IS NULL AND dkb.status = 'delivered'
          ${dealerScope && dealerScope.length
            ? `AND UPPER(TRIM(COALESCE(dkb.dealer_code, ''))) IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''").toUpperCase()}'`).join(', ')})`
            : ''}
          ${deliveredWindowSql('dkb')}) AS delivered,
        ${transfersCountSql} AS transfers
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      /*
       * "Did WE hand this car over?" -- deliberately SEPARATE from the va join above.
       *
       * va requires released_at IS NULL because every other bucket (Available, Payment Pending,
       * DMS Allocated) means "live allocation". But an allocation is RELEASED once the car goes out,
       * so asking the delivered question through va finds only 5 of the 12 delivered cars still in
       * stock -- being released is a consequence of delivery, not evidence against it.
       *
       * NOTE: backticks are banned inside these SQL comments -- they terminate the template literal.
       *
       * LIMIT 1 keeps this one-row-per-vehicle: a VIN can carry several allocation rows for the same
       * booking, which would otherwise duplicate the stock row and inflate every count on the page.
       */
      LEFT JOIN LATERAL (
        SELECT dkb.id, dkb.delivered_at, dkb.booking_number, dkb.customer_name,
               dkb.customer_phone, dkb.consultant_name, dkb.bank_name, dkb.status,
               dkb.amount_received
        FROM kia_vehicle_allocations dva
        JOIN kia_bookings dkb ON dkb.id = dva.booking_id
         AND dkb.deleted_at IS NULL
         AND dkb.status = 'delivered'
        WHERE UPPER(TRIM(dva.vin_number)) = UPPER(TRIM(sm.vin_number))
        ORDER BY dkb.delivered_at DESC NULLS LAST
        LIMIT 1
      ) dlv ON TRUE
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
      -- The delivered-booking fallback the row projection COALESCEs onto. The projection references
      -- dlv.* , and this fragment is the ONLY FROM it ever runs against - omitting the lateral here
      -- is exactly the bug that took the whole Transferred tab down with
      -- 'missing FROM-clause entry for table dlv'. The count query shares this fragment; a
      -- LEFT JOIN LATERAL with LIMIT 1 cannot change its row count.
      LEFT JOIN LATERAL (
        SELECT dkb.id, dkb.delivered_at, dkb.booking_number, dkb.customer_name,
               dkb.customer_phone, dkb.consultant_name, dkb.bank_name, dkb.status,
               dkb.amount_received
        FROM kia_vehicle_allocations dva
        JOIN kia_bookings dkb ON dkb.id = dva.booking_id
         AND dkb.deleted_at IS NULL
         AND dkb.status = 'delivered'
        WHERE UPPER(TRIM(dva.vin_number)) = UPPER(TRIM(vt.vin_number))
        ORDER BY dkb.delivered_at DESC NULLS LAST
        LIMIT 1
      ) dlv ON TRUE
      WHERE ${transferredWhere}`
    /*
     * ── DELIVERED, ROOTED AT THE BOOKING ─────────────────────────────────────────────────────
     *
     * Every other view on this page is rooted at kia_stock_management, and for stock that is right.
     * Delivered is not a stock question — it is a BOOKING outcome, and a delivered car has usually
     * left the DMS feed. Measured: of 33 delivered bookings only 6 were reachable from the stock
     * table (13 have no allocation row at all, 14 had their VIN leave the feed), so the tab showed
     * 6 and the Booking CRM showed the rest. That is the exact complaint: three delivered customers
     * visible in the CRM and absent here.
     *
     * TRANSFERRED already had this treatment; DELIVERED never did. Same shape, same reasoning.
     *
     * Notes on the joins:
     *  - the allocation join deliberately does NOT require released_at IS NULL: an allocation is
     *    released at handover, so requiring it live would hide every delivered car;
     *  - DISTINCT ON (kb.id) is required, not cosmetic — 33 bookings produce 43 join rows and one
     *    booking carries 4 allocation rows;
     *  - vehicle fields fall back sm -> allocation snapshot -> the booking itself, because for the
     *    13 VIN-less deliveries the booking is the only source (measured: model and colour are
     *    populated on 13 of 13);
     *  - branch scoping moves to kb.dealer_code, since there may be no sm row to scope on.
     */
    const isDeliveredView = status === 'DELIVERED'
    const deliveredScope = dealerScope && dealerScope.length
      ? `AND UPPER(TRIM(COALESCE(kb.dealer_code, ''))) IN (${dealerScope.map((d) => `'${d.replace(/'/g, "''").toUpperCase()}'`).join(', ')})`
      : ''
    const deliveredSearch = search
      ? `AND (kb.customer_name ILIKE '%${search.replace(/'/g, "''")}%'
             OR kb.booking_number ILIKE '%${search.replace(/'/g, "''")}%'
             OR COALESCE(NULLIF(BTRIM(kb.allocated_vin), ''), CASE WHEN va.released_at IS NULL THEN va.vin_number END, '') ILIKE '%${search.replace(/'/g, "''")}%')`
      : ''
    const deliveredFrom = `
      FROM kia_bookings kb
      LEFT JOIN kia_vehicle_allocations va ON va.booking_id = kb.id
      LEFT JOIN kia_stock_management sm ON UPPER(TRIM(sm.vin_number)) = UPPER(TRIM(va.vin_number))
      LEFT JOIN users u ON u.id = kb.updated_by
      WHERE kb.deleted_at IS NULL
        AND kb.status = 'delivered'
        ${deliveredScope}
        ${deliveredSearch}
        /*
         * The window applies to WHEN THE CAR WAS DELIVERED — the only date that means anything for
         * this view, and the one the dashboard's own on-screen note already promises. Filtering
         * here, server-side, is also what keeps the client's date memo out of it: that memo
         * re-filters a single PAGINATED page, so a row the server counted could vanish from the
         * table while the pager still counted it.
         */
        ${deliveredWindowSql('kb')}`

    const isTransferredView = status === 'TRANSFERRED'

    // 2. Fetch total count for pagination (join transfers and local statuses too)
    const totalCountResult = isDeliveredView
      ? await db.execute(sql.raw(`SELECT COUNT(DISTINCT kb.id)::int as count ${deliveredFrom}`))
      : isTransferredView
      ? await db.execute(sql.raw(`SELECT COUNT(*)::int as count ${transferredFrom}`))
      : await db.execute(sql.raw(`
      SELECT COUNT(*)::int as count
      FROM kia_stock_management sm
      LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
      LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
      LEFT JOIN kia_vehicle_transfers vt ON UPPER(vt.vin_number) = UPPER(sm.vin_number) AND LOWER(vt.transfer_status) IN ('transferred', 'requested')
      LEFT JOIN kia_stock_local_statuses ls ON ls.vin_number = sm.vin_number
      /*
       * "Did WE hand this car over?" -- deliberately SEPARATE from the va join above.
       *
       * va requires released_at IS NULL because every other bucket (Available, Payment Pending,
       * DMS Allocated) means "live allocation". But an allocation is RELEASED once the car goes out,
       * so asking the delivered question through va finds only 5 of the 12 delivered cars still in
       * stock -- being released is a consequence of delivery, not evidence against it.
       *
       * NOTE: backticks are banned inside these SQL comments -- they terminate the template literal.
       *
       * LIMIT 1 keeps this one-row-per-vehicle: a VIN can carry several allocation rows for the same
       * booking, which would otherwise duplicate the stock row and inflate every count on the page.
       */
      LEFT JOIN LATERAL (
        SELECT dkb.id, dkb.delivered_at, dkb.booking_number, dkb.customer_name,
               dkb.customer_phone, dkb.consultant_name, dkb.bank_name, dkb.status,
               dkb.amount_received
        FROM kia_vehicle_allocations dva
        JOIN kia_bookings dkb ON dkb.id = dva.booking_id
         AND dkb.deleted_at IS NULL
         AND dkb.status = 'delivered'
        WHERE UPPER(TRIM(dva.vin_number)) = UPPER(TRIM(sm.vin_number))
        ORDER BY dkb.delivered_at DESC NULLS LAST
        LIMIT 1
      ) dlv ON TRUE
      WHERE ${whereClause}
    `))
    const totalRows = Number(totalCountResult[0]?.count || 0)
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))

    // 3. Fetch data rows
    const rows = isDeliveredView
      ? await db.execute(sql.raw(`
      /*
       * DISTINCT ON forces its own ORDER BY (kb.id first), which is not a useful display order, so
       * the de-duplication happens in the inner query and the presentation order + pagination are
       * applied outside it. Without the outer LIMIT the tab returned every delivered booking on one
       * page while the pager still claimed to be paginating.
       */
      SELECT * FROM (
      SELECT DISTINCT ON (kb.id)
        kb.id::text AS id,
        /*
         * ⚠️ allocated_vin FIRST, the allocation only as a fallback.
         *
         * The join above deliberately does not filter released_at IS NULL (a delivered car's
         * reservation is released at handover, so filtering would lose the VIN entirely). But that
         * also means a booking whose allocation LAPSED — the customer never paid, the car went to
         * someone else — still drags that stranger's chassis along.
         *
         * Reading the allocation first put ONE chassis on TWO delivered customers: Atul saini's row
         * showed the car that was actually sold to Sahil Choudhary, and Amarjit Singh's the one sold
         * to Rakesh bhagat. allocated_vin is the reconciled, authoritative value, so it wins.
         *
         * A RELEASED allocation never speaks for a delivery. Measured over all 66 delivered
         * bookings: 56 carry their own chassis, 8 have no allocation at all and already render
         * blank, and the only 2 reaching this fallback were those same two rows — both released
         * because the car went to somebody else. The fallback had no legitimate user, so it is
         * narrowed to a LIVE reservation rather than removed, which keeps it correct for a delivery
         * recorded before its allocation is closed.
         */
        COALESCE(
          NULLIF(BTRIM(kb.allocated_vin), ''),
          CASE WHEN va.released_at IS NULL THEN va.vin_number END
        ) AS vin_number,
        COALESCE(sm.model, va.vehicle_snapshot->>'model', kb.model) AS model,
        COALESCE(sm.variant, va.vehicle_snapshot->>'variant', kb.variant) AS variant,
        COALESCE(sm.exterior_color_name, va.vehicle_snapshot->>'exterior_color_name', kb.color) AS color,
        COALESCE(sm.stock_age, va.vehicle_snapshot->>'stock_age') AS stock_age,
        'Delivered' AS stock_status,
        -- Shape parity with the main projection; a delivered car is not on hold.
        NULL AS local_status, NULL AS hold_notes, NULL AS hold_marked_at, NULL AS hold_by,
        NULL AS hold_expires_at, FALSE AS hold_paid,
        COALESCE(kb.dealer_code, sm.order_dealer) AS dealer_code,
        COALESCE(sm.engine_no, va.vehicle_snapshot->>'engine_no') AS engine_no,
        va.id AS allocation_id,
        va.allocation_status,
        va.expires_at,
        va.payment_secured_at,
        COALESCE(kb.amount_received, 0)::float8 AS amount_received,
        va.created_at AS allocated_at,
        kb.id AS booking_id,
        kb.booking_number,
        kb.customer_name,
        kb.customer_phone,
        kb.consultant_name,
        kb.status AS booking_status,
        kb.bank_name,
        kb.delivery_target_date AS raw_delivery_target_date,
        COALESCE(kb.delivered_at::text, kb.delivery_target_date::text) AS booking_delivery_date,
        kb.metadata,
        NULL AS transfer_id,
        NULL AS transfer_status,
        NULL AS to_dealer_code,
        NULL AS transfer_requested_at,
        u.full_name AS transfer_requester_name,
        -- A handed-over car is not allottable stock, so the FIFO ageing comparison is meaningless.
        0 AS older_count,
        NULL AS oldest_alternative_vin,
        NULL AS oldest_alternative_age
      ${deliveredFrom}
      ORDER BY kb.id, va.created_at DESC NULLS LAST
      ) d
      ORDER BY d.booking_delivery_date DESC NULLS LAST, d.booking_number DESC
      ${limitOffsetClause}
    `))
      : isTransferredView
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
        -- Shape parity with the main projection; a transferred car is not on hold.
        NULL AS local_status, NULL AS hold_notes, NULL AS hold_marked_at, NULL AS hold_by,
        NULL AS hold_expires_at, FALSE AS hold_paid,
        COALESCE(vt.from_dealer_code, sm.order_dealer, vt.vehicle_snapshot->>'order_dealer') AS dealer_code,
        COALESCE(sm.engine_no, vt.vehicle_snapshot->>'engine_no') AS engine_no,
        va.id as allocation_id,
        va.allocation_status,
        va.expires_at,
        -- Part-payment state (migration 0048). payment_secured_at non-NULL means the reservation
        -- clock is suspended and the expiry sweep will not release this vehicle.
        va.payment_secured_at,
        COALESCE(kb.amount_received, dlv.amount_received, 0)::float8 AS amount_received,
        va.created_at as allocated_at,
        -- COALESCE onto the delivered-booking lateral: a car handed over has its allocation
        -- RELEASED, so kb (joined through the LIVE allocation) is NULL for it and the row would
        -- otherwise render a delivered vehicle with a blank customer.
        COALESCE(kb.id, dlv.id) as booking_id,
        COALESCE(kb.booking_number, dlv.booking_number) as booking_number,
        COALESCE(kb.customer_name, dlv.customer_name) as customer_name,
        COALESCE(kb.customer_phone, dlv.customer_phone) as customer_phone,
        COALESCE(kb.consultant_name, dlv.consultant_name) as consultant_name,
        COALESCE(kb.status, dlv.status) as booking_status,
        COALESCE(kb.bank_name, dlv.bank_name) as bank_name,
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
        /*
         * #12 The hold, carried onto the ROW.
         *
         * ls was joined here only to be filtered against; local_status was never projected, so no
         * row could ever render an "ON HOLD" badge however correct the underlying data was. That is
         * why holding a vehicle appeared to do nothing.
         */
        ls.local_status,
        -- WHY the car is held. Captured by the dialog (which requires it) and stored all along, but
        -- never projected -- so the board showed a held vehicle with no way to see who it is for.
        ls.notes AS hold_notes,
        ls.marked_at AS hold_marked_at,
        ls.marked_by_name AS hold_by,
        (ls.marked_at + interval '${KIA_HOLD_WINDOW_HOURS} hours') AS hold_expires_at,
        (COALESCE(ls.stock_status_at_mark, '') = 'PAID') AS hold_paid,
        sm.order_dealer as dealer_code,
        sm.engine_no,
        va.id as allocation_id,
        va.allocation_status,
        va.expires_at,
        -- Part-payment state (migration 0048). payment_secured_at non-NULL means the reservation
        -- clock is suspended and the expiry sweep will not release this vehicle.
        va.payment_secured_at,
        COALESCE(kb.amount_received, dlv.amount_received, 0)::float8 AS amount_received,
        va.created_at as allocated_at,
        -- COALESCE onto the delivered-booking lateral: a car handed over has its allocation
        -- RELEASED, so kb (joined through the LIVE allocation) is NULL for it and the row would
        -- otherwise render a delivered vehicle with a blank customer.
        COALESCE(kb.id, dlv.id) as booking_id,
        COALESCE(kb.booking_number, dlv.booking_number) as booking_number,
        COALESCE(kb.customer_name, dlv.customer_name) as customer_name,
        COALESCE(kb.customer_phone, dlv.customer_phone) as customer_phone,
        COALESCE(kb.consultant_name, dlv.consultant_name) as consultant_name,
        COALESCE(kb.status, dlv.status) as booking_status,
        COALESCE(kb.bank_name, dlv.bank_name) as bank_name,
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
      /*
       * "Did WE hand this car over?" -- deliberately SEPARATE from the va join above.
       *
       * va requires released_at IS NULL because every other bucket (Available, Payment Pending,
       * DMS Allocated) means "live allocation". But an allocation is RELEASED once the car goes out,
       * so asking the delivered question through va finds only 5 of the 12 delivered cars still in
       * stock -- being released is a consequence of delivery, not evidence against it.
       *
       * NOTE: backticks are banned inside these SQL comments -- they terminate the template literal.
       *
       * LIMIT 1 keeps this one-row-per-vehicle: a VIN can carry several allocation rows for the same
       * booking, which would otherwise duplicate the stock row and inflate every count on the page.
       */
      LEFT JOIN LATERAL (
        SELECT dkb.id, dkb.delivered_at, dkb.booking_number, dkb.customer_name,
               dkb.customer_phone, dkb.consultant_name, dkb.bank_name, dkb.status,
               dkb.amount_received
        FROM kia_vehicle_allocations dva
        JOIN kia_bookings dkb ON dkb.id = dva.booking_id
         AND dkb.deleted_at IS NULL
         AND dkb.status = 'delivered'
        WHERE UPPER(TRIM(dva.vin_number)) = UPPER(TRIM(sm.vin_number))
        ORDER BY dkb.delivered_at DESC NULLS LAST
        LIMIT 1
      ) dlv ON TRUE
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
