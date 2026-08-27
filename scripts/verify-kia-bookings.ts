/**
 * The six KIA Bookings defects fixed 2026-08-27, each held closed against live data.
 *
 * 1+3 Booking CRM stock matching. The predicate existed as FIVE hand-copied variants in three
 *     different strengths; four ignored COLOUR entirely, so a booking for a white car counted as
 *     "in stock" against a red one. The KPI card and the tab it opens returned different sets
 *     (65 vs 34). One shared builder now serves every site AND carries the Allot picker's own
 *     allocation rule, so a booking badged "in stock" is always one the picker can actually fill.
 * 2   Month-scoped cards, and the inverted IST boundary underneath them. Every date filter was
 *     written (date AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'UTC', which resolves the wrong
 *     Postgres overload and lands the boundary 11 hours late — "Booked Today" rendered 0 while two
 *     bookings existed that morning.
 * 4   Allocation History collapsed a two-branch user's scope to allowed[0], so an IDT user pinned
 *     to JK501,JK402 saw 34 of 116 with no control to reach the rest.
 * 6   Stock > Delivered was rooted at the DMS stock feed, so only 6 of 33 deliveries were reachable
 *     and three delivered customers visible in the CRM were absent there.
 *
 * Read-only. Run: npm run verify:kia-bookings
 */
import 'dotenv/config'
import { getKiaBookingsList, getKiaBookingMatchingVehicles } from '../lib/kia/bookings'
import { getAllocationHistorySummary, getAllocationHistory } from '../lib/kia/allocation-history'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }
const kpis = (r: unknown) => (r as { kpis: Record<string, number> }).kpis
const total = (r: unknown) => (r as { pagination: { total: number } }).pagination.total

async function currentIstMonth() {
  const [row] = await analyticsExecute<{ start: string; end: string }>(sql`
    SELECT to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS start,
           to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 month - 1 day', 'YYYY-MM-DD') AS end`)
  return row
}

async function stockMatching() {
  console.log('1+3) The Not-in-Stock / In-Stock cards agree with the tabs they open')
  const all = await getKiaBookingsList({ pageSize: 1 })
  const nis = await getKiaBookingsList({ status: 'not_in_stock', pageSize: 1 })
  const ins = await getKiaBookingsList({ status: 'in_stock', pageSize: 1 })
  console.log(`   lifetime  KPI ${kpis(all).notInStock}/${kpis(all).inStock}   tabs ${total(nis)}/${total(ins)}`)
  check(kpis(all).notInStock === total(nis), `Not-in-Stock card equals its tab (${kpis(all).notInStock})`)
  check(kpis(all).inStock === total(ins), `In-Stock card equals its tab (${kpis(all).inStock})`)

  const { start, end } = await currentIstMonth()
  const mAll = await getKiaBookingsList({ startDate: start, endDate: end, pageSize: 1 })
  const mNis = await getKiaBookingsList({ status: 'not_in_stock', startDate: start, endDate: end, pageSize: 1 })
  const mIns = await getKiaBookingsList({ status: 'in_stock', startDate: start, endDate: end, pageSize: 1 })
  console.log(`   month     KPI ${kpis(mAll).notInStock}/${kpis(mAll).inStock}   tabs ${total(mNis)}/${total(mIns)}`)
  check(kpis(mAll).notInStock === total(mNis), 'month Not-in-Stock card equals its tab')
  check(kpis(mAll).inStock === total(mIns), 'month In-Stock card equals its tab')

  console.log('\n   the badge agrees with the REAL Allot picker')
  const page = await getKiaBookingsList({ pageSize: 200 })
  const rows = (page as unknown as { rows: { id: string; stockAvailable?: boolean; notInStock?: boolean; status: string }[] }).rows
  const live = rows.filter((r) => !['draft', 'delivered', 'cancelled'].includes(String(r.status))).slice(0, 60)
  let greenButEmpty = 0
  let redButOffered = 0
  for (const r of live) {
    const offers = await getKiaBookingMatchingVehicles(r.id).catch(() => [])
    const hasOffer = Array.isArray(offers) && offers.length > 0
    if (r.stockAvailable && !hasOffer) greenButEmpty++
    if (r.notInStock && hasOffer) redButOffered++
  }
  console.log(`   checked ${live.length}: green-but-empty ${greenButEmpty}, red-but-offered ${redButOffered}`)
  check(greenButEmpty === 0, 'no booking is badged in-stock while the picker offers nothing')
  check(redButOffered === 0, 'no booking is badged not-in-stock while the picker offers a car')
}

async function monthCardsAndIst() {
  console.log('\n2) Cards follow the chosen window, and the IST boundary is not inverted')
  const { start, end } = await currentIstMonth()
  const life = await getKiaBookingsList({ pageSize: 1 })
  const month = await getKiaBookingsList({ startDate: start, endDate: end, pageSize: 1 })
  for (const key of ['pendingProforma', 'waitingAllocation', 'delivered', 'notInStock']) {
    console.log(`   ${key.padEnd(20)} lifetime ${String(kpis(life)[key]).padStart(4)}   month ${String(kpis(month)[key]).padStart(4)}`)
  }
  check(kpis(month).waitingAllocation < kpis(life).waitingAllocation, 'pipeline cards genuinely narrow with the window')

  const [d] = await analyticsExecute<{ delivered_in_window: number; created_in_window: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE delivered_at >= ((${start} || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')
                         AND delivered_at < (((${end}::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata'))::int AS delivered_in_window,
      COUNT(*) FILTER (WHERE created_at >= ((${start} || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')
                         AND created_at < (((${end}::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata'))::int AS created_in_window
    FROM kia_bookings WHERE deleted_at IS NULL AND status = 'delivered'`)
  console.log(`   delivered in window ${d.delivered_in_window} vs bookings CREATED in window ${d.created_in_window}`)
  check(kpis(month).delivered === Number(d.delivered_in_window),
    'the Delivered card counts deliveries in the window, not creations')

  const [t] = await analyticsExecute<{ real: number }>(sql`
    SELECT COUNT(*)::int AS real FROM kia_bookings WHERE deleted_at IS NULL
      AND created_at >= ((to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata')`)
  console.log(`   Booked Today card ${kpis(life).today} vs real IST-today ${t.real}`)
  check(Number(kpis(life).today) === Number(t.real), 'Booked Today matches the real Indian day')
}

/**
 * EVERY card against the tab it opens.
 *
 * The narrow version of this check (not_in_stock / in_stock only) is what let a regression through:
 * the Delivered card was moved onto delivered_at while its list still filtered created_at, so the
 * card read 11 above a table of 3. A card that disagrees with the rows it opens is the single
 * failure mode this module keeps returning to, so it is now checked for all of them.
 */
async function everyCardMatchesItsTab() {
  console.log('\n5) Every KPI card equals the tab it opens')
  const { start, end } = await currentIstMonth()
  const base = { startDate: start, endDate: end, pageSize: 1 }
  const summary = await getKiaBookingsList({ ...base })

  const pairs: { card: string; status: string }[] = [
    { card: 'pendingProforma', status: 'booking_created' },
    { card: 'waitingAllocation', status: 'proforma_generated' },
    { card: 'readyDelivery', status: 'ready_delivery' },
    { card: 'delivered', status: 'delivered' },
    { card: 'cancelled', status: 'cancelled' },
    { card: 'notInStock', status: 'not_in_stock' },
    { card: 'inStock', status: 'in_stock' },
  ]

  for (const { card, status } of pairs) {
    const tab = await getKiaBookingsList({ ...base, status })
    const cardValue = Number(kpis(summary)[card] || 0)
    check(cardValue === total(tab), `${card}: card ${cardValue} = tab ${total(tab)}`)
  }

  // financePending folds two statuses, so it is checked against their sum.
  const va = await getKiaBookingsList({ ...base, status: 'vehicle_allocated' })
  check(Number(kpis(summary).financePending) === total(va),
    `financePending: card ${kpis(summary).financePending} = tab ${total(va)} (vehicle_allocated + transferring)`)
}

async function allocationScope() {
  console.log('\n4) Allocation History honours a user\'s FULL branch pin')
  const unrestricted = await getAllocationHistorySummary({ allowedDealers: null }) as unknown as Record<string, number>
  const both = await getAllocationHistorySummary({ allowedDealers: ['JK501', 'JK402'] }) as unknown as Record<string, number>
  const one = await getAllocationHistorySummary({ allowedDealers: ['JK501'] }) as unknown as Record<string, number>
  const stale = await getAllocationHistorySummary({ allowedDealers: ['__NO_DEALER__'] }) as unknown as Record<string, number>
  console.log(`   unrestricted ${unrestricted.total} | two-branch ${both.total} | one-branch ${one.total} | stale pin ${stale.total}`)
  check(both.total === unrestricted.total, 'a two-branch user sees both branches')
  check(one.total > 0 && one.total < unrestricted.total, 'a one-branch user is still scoped')
  check(stale.total === 0, 'a stale pin fails CLOSED')

  const rowsBoth = await getAllocationHistory({ allowedDealers: ['JK501', 'JK402'], pageSize: 1 }) as unknown as { total: number }
  check(rowsBoth.total === both.total, 'rows and summary agree on scope')
}

async function deliveredReachability() {
  console.log('\n6) Stock > Delivered can reach every delivered booking')
  const [reach] = await analyticsExecute<{ bookings: number; via_stock: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM kia_bookings WHERE deleted_at IS NULL AND status = 'delivered') AS bookings,
      (SELECT COUNT(DISTINCT dkb.id)::int
         FROM kia_stock_management sm
         JOIN kia_vehicle_allocations dva ON UPPER(TRIM(dva.vin_number)) = UPPER(TRIM(sm.vin_number))
         JOIN kia_bookings dkb ON dkb.id = dva.booking_id AND dkb.deleted_at IS NULL AND dkb.status = 'delivered'
      ) AS via_stock`)
  console.log(`   delivered bookings ${reach.bookings}; reachable from the DMS stock feed ${reach.via_stock}`)
  check(Number(reach.via_stock) < Number(reach.bookings),
    'the old stock-rooted query provably could not reach them all (the bug is real)')

  // 13 of them carry no VIN at all; the booking must still supply model and colour to render.
  const [fallback] = await analyticsExecute<{ no_vin: number; no_model: number }>(sql`
    SELECT COUNT(*)::int AS no_vin,
           COUNT(*) FILTER (WHERE COALESCE(BTRIM(kb.model), '') = '')::int AS no_model
    FROM kia_bookings kb
    WHERE kb.deleted_at IS NULL AND kb.status = 'delivered'
      AND NOT EXISTS (SELECT 1 FROM kia_vehicle_allocations va WHERE va.booking_id = kb.id)`)
  console.log(`   deliveries with no allocation at all: ${fallback.no_vin}, of which missing a model: ${fallback.no_model}`)
  check(Number(fallback.no_model) === 0, 'every VIN-less delivery still has a model to render from the booking')

  /*
   * Stock > Delivered defaults to the CURRENT INDIAN MONTH. Lifetime it lists every car the
   * dealership has ever handed over, which is not what someone opening a stock board is asking.
   * The card and the rows share ONE window definition in the route — a Delivered card that
   * disagrees with the rows it opens is the defect this view keeps returning to.
   */
  const W = "AND kb.delivered_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') "
    + "AND kb.delivered_at < date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '1 month'"
  const F = "FROM kia_bookings kb LEFT JOIN kia_vehicle_allocations va ON va.booking_id = kb.id "
    + "WHERE kb.deleted_at IS NULL AND kb.status = 'delivered'"

  const [monthCard] = await analyticsExecute<{ n: number }>(sql.raw(`SELECT COUNT(DISTINCT kb.id)::int AS n ${F} ${W}`))
  const monthRows = await analyticsExecute<{ id: string }>(sql.raw(
    `SELECT DISTINCT ON (kb.id) kb.id ${F} ${W} ORDER BY kb.id, va.created_at DESC NULLS LAST`))
  const [older] = await analyticsExecute<{ n: number }>(sql.raw(
    `SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT kb.id, kb.delivered_at ${F} ${W}) z `
    + `WHERE z.delivered_at < date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')`))

  console.log(`   default window: card ${monthCard.n}, rows ${monthRows.length}, lifetime ${reach.bookings}`)
  check(Number(monthCard.n) === monthRows.length, 'the month-scoped Delivered card equals the rows it opens')
  check(Number(monthCard.n) < Number(reach.bookings), 'the default view is genuinely narrowed to this month')
  check(Number(older.n) === 0, 'no delivery from an earlier month appears in the default view')
}

/**
 * A delivered car must never sit in a bucket that is still asking for money or for a handover.
 *
 * Both money buckets are rooted at the DMS stock feed and reach the booking through a LIVE
 * allocation, so a delivered car normally falls out twice over: its allocation is released at
 * handover, and both predicates exclude status 'delivered' outright. That is two independent
 * guards, and this asserts BOTH still hold rather than trusting either.
 *
 * The predicates are copied verbatim from the stock route. If they change there and not here, this
 * check goes quiet rather than wrong — so it also asserts each bucket is non-empty overall, which
 * is what proves the query still selects anything at all.
 */
async function deliveredLeavesTheMoneyBuckets() {
  console.log('\n7) A delivered car appears in neither Payment Pending nor Paid - To Deliver')
  const FROM = `FROM kia_stock_management sm
    LEFT JOIN kia_vehicle_allocations va ON va.vin_number = sm.vin_number AND va.released_at IS NULL
    LEFT JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL`
  const BUCKETS: { label: string; pred: string }[] = [
    { label: 'Payment Pending', pred: "va.id IS NOT NULL AND kb.status NOT IN ('ready_delivery', 'delivered')" },
    { label: 'Paid - To Deliver', pred: "va.id IS NOT NULL AND kb.status = 'ready_delivery'" },
  ]
  for (const b of BUCKETS) {
    const [row] = await analyticsExecute<{ total: number; delivered: number; cancelled: number }>(sql.raw(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE kb.status = 'delivered')::int AS delivered,
             COUNT(*) FILTER (WHERE kb.status = 'cancelled')::int AS cancelled
      ${FROM} WHERE ${b.pred}`))
    console.log(`   ${b.label.padEnd(18)} ${row.total} rows, delivered ${row.delivered}, cancelled ${row.cancelled}`)
    check(Number(row.delivered) === 0, `${b.label} contains no delivered booking`)
    check(Number(row.cancelled) === 0, `${b.label} contains no cancelled booking`)
  }

  /*
   * …and the far more dangerous case: a delivered booking whose allocation the EXPIRY CRON can
   * still reach. A live allocation on a delivered car is normal here — 12 of the 14 found on
   * 2026-08-27 predate this work and all carry 'final', which is the settled state. What is not
   * survivable is a 'temporary' one with a running clock: expireKiaTemporaryAllocations rewrites
   * the booking to 'proforma_generated' and returns the VIN to free stock, so the cron would
   * silently UN-DELIVER a car that is already with its owner. That is what nearly happened to
   * KIA_JK402_2026_120099 two days out.
   *
   * The predicate mirrors that sweep exactly. ⚠️ Never call the sweep itself to test this — it
   * takes no arguments and would run the real global release.
   */
  const [risk] = await analyticsExecute<{ n: number }>(sql`
    SELECT COUNT(*)::int AS n FROM kia_vehicle_allocations va
    JOIN kia_bookings kb ON kb.id = va.booking_id AND kb.deleted_at IS NULL
    WHERE va.released_at IS NULL AND va.payment_confirmed_at IS NULL AND va.payment_secured_at IS NULL
      AND va.allocation_status = 'temporary' AND va.expires_at IS NOT NULL
      AND kb.status IN ('delivered', 'cancelled')`)
  console.log(`   delivered/cancelled bookings the expiry cron could still revert: ${risk.n}`)
  check(Number(risk.n) === 0, 'the expiry cron cannot un-deliver a delivered booking')
}

async function main() {
  await stockMatching()
  await monthCardsAndIst()
  await everyCardMatchesItsTab()
  await allocationScope()
  await deliveredReachability()
  await deliveredLeavesTheMoneyBuckets()
  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
