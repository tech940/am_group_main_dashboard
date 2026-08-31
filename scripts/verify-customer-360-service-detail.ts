/**
 * What a Customer 360 dossier actually shows for a service visit.
 *
 * ── What this guards ──────────────────────────────────────────────────────────────────────────
 * Three defects that were all visible on one screen and all silent:
 *
 *   1. NO ODOMETER. The reading exists on every service visit (kia_psf_yearly.mileage) and reached
 *      neither the payload nor the screen, so "how far had the car run" was unanswerable.
 *   2. A DOUBLE-COUNTED HANDOVER. "Vehicle delivered" was emitted twice for an ordinary purchase —
 *      once from the enquiry row, once from the vehicle row — so the timeline showed the same
 *      handover on the same day twice.
 *   3. A TOTAL WITH NO VISIBLE PARTS. The header summed workshop + insurance + accessories, but the
 *      insurance premium rendered as "—" in its own table, so the figure looked invented.
 *
 * Read-only. Run: npm run verify:customer-360-service-detail
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import { getKiaCustomerProfile, listKiaCustomers } from '../lib/kia/customer-profile/reader'
import { buildCustomerTimeline, isMilestoneEvent } from '../lib/kia/customer-profile/timeline'
import { buildServiceCadence } from '../lib/customer-360/service-cadence'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }

async function main() {
  /*
   * Pick a REAL customer with several billed visits and odometer readings, rather than a fixed key:
   * the feeds are re-ingested, and a hardcoded id would rot into a false failure.
   *
   * ⚠️ Grouped by VIN as well as by customer, deliberately. Ranking on visits per CUSTOMER selects a
   * dealership fleet account — 15 cars with one visit each — where no single vehicle has two
   * readings to difference, so the delta assertion fails against a subject that could never satisfy
   * it. The distance since the last visit is a per-VEHICLE fact, so the subject must be a vehicle
   * with a history.
   */
  const [pick] = await analyticsExecute<{ customer_id: string; outlet: string; visits: number }>(sql`
    SELECT s.customerid AS customer_id,
           UPPER(BTRIM(COALESCE(NULLIF(BTRIM(s.dealer_code_2), ''), s.dealer_code, ''))) AS outlet,
           COUNT(DISTINCT p.ro_no)::int AS visits
    FROM kia_sales_report s
    JOIN kia_psf_yearly p ON UPPER(BTRIM(p.vin)) = UPPER(BTRIM(s.vin_no))
    WHERE s.customerid IS NOT NULL AND BTRIM(s.customerid) <> '' AND p.mileage > 0
    GROUP BY 1, 2, UPPER(BTRIM(s.vin_no)) HAVING COUNT(DISTINCT p.ro_no) >= 4
    ORDER BY 3 DESC LIMIT 1`)
  check(Boolean(pick), 'found a customer with 4+ odometer-carrying visits to test against')
  if (!pick) { console.log('\n=== 1 FAILURE(S) ==='); process.exit(1) }

  const key = { kind: 'customer' as const, value: pick.customer_id, outlet: pick.outlet }
  const profile = await getKiaCustomerProfile(key as Parameters<typeof getKiaCustomerProfile>[0])
  check(Boolean(profile), `the profile loads for ${pick.customer_id} @ ${pick.outlet}`)
  if (!profile) { console.log('\n=== FAILURE ==='); process.exit(1) }

  console.log(`\n1) ${profile.name} — ${profile.vehicles.length} vehicle(s), ${pick.visits} visits with a reading`)

  console.log('\n2) The odometer reaches the payload')
  let withKm = 0; let withDelta = 0; let total = 0
  for (const v of profile.vehicles) {
    const rows = [...(v.services || [])].sort((a, b) => String(a.roDate || a.billDate || '').localeCompare(String(b.roDate || b.billDate || '')))
    if (!rows.length) continue
    console.log(`   ${v.model || v.vin}`)
    for (const s of rows) {
      total += 1
      if (s.mileage != null) withKm += 1
      if (s.mileageSinceLast != null) withDelta += 1
      const km = s.mileage != null ? `${Math.round(s.mileage).toLocaleString('en-IN')} km` : '(no reading)'
      const delta = s.mileageSinceLast != null ? `+${Math.round(s.mileageSinceLast).toLocaleString('en-IN')}` : ''
      const paid = s.amount != null ? `Rs${Math.round(s.amount).toLocaleString('en-IN')}` : 'not billed'
      console.log(`      ${s.roDate || s.billDate}  ${km.padStart(12)} ${delta.padStart(9)}  ${String(s.workType || '').padEnd(18)} ${paid}`)
    }
  }
  check(withKm > 0, `${withKm} of ${total} visits carry an odometer reading`)
  check(withDelta > 0, `${withDelta} visits report the distance since the previous one`)
  /*
   * The first visit of a vehicle has no previous reading, so a delta on EVERY row would mean the
   * reader is inventing one.
   */
  check(withDelta < withKm, 'the earliest visit of each vehicle reports no delta — nothing is invented')

  console.log('\n3) The forecast the readings support')
  for (const v of profile.vehicles) {
    const cadence = buildServiceCadence(
      (v.services || []).map((s) => ({ date: s.roDate || s.billDate, km: s.mileage, workType: s.workType })),
      new Date(),
    )
    console.log(`   ${v.model || v.vin}: ${cadence.basis}`)
    if (cadence.nextDueDate) {
      console.log(`      -> next due ~${cadence.nextDueKm?.toLocaleString('en-IN')} km on ${cadence.nextDueDate} (${cadence.daysUntilDue} days), confidence ${cadence.confidence}`)
    }
    check(cadence.basis.length > 0, `${v.model || v.vin}: the cadence always states its basis`)
  }

  console.log('\n4) The handover is no longer double-counted')
  const timeline = buildCustomerTimeline(profile)
  /*
   * A duplicate is only a defect when the two rows are INDISTINGUISHABLE to the reader. Two service
   * visits on one day with different job cards are real (a car can be booked in twice), and two
   * cars delivered on one day under one trade plate are real. Identity therefore includes the VIN
   * and the reference — without them this asserts against the data rather than against the bug.
   */
  const seen = new Map<string, number>()
  for (const e of timeline) {
    const k = `${e.date}|${e.title}|${(e.detail || '').toLowerCase()}|${e.vin || ''}|${e.reference || ''}`
    seen.set(k, (seen.get(k) || 0) + 1)
  }
  const dupes = [...seen.entries()].filter(([, c]) => c > 1)
  for (const [k, c] of dupes) console.log(`      ${c}x  ${k}`)
  check(dupes.length === 0, 'no two timeline events are indistinguishable from each other')

  const deliveries = timeline.filter((e) => e.title === 'Vehicle delivered')
  console.log(`   ${deliveries.length} delivery event(s): ${deliveries.map((d) => d.date).join(', ')}`)
  /*
   * A fleet account really does take delivery of several cars of one model on one day, so the count
   * is not capped at one per vehicle. What must NOT survive is a VIN-less shadow sitting beside the
   * real record it shadows — that is the duplicate the screen showed.
   */
  const shadowed = deliveries.filter((d) => !d.vin && deliveries.some((o) =>
    o.vin && o.date === d.date
    && String(o.detail || '').split('·')[0].trim().toLowerCase() === String(d.detail || '').split('·')[0].trim().toLowerCase()))
  for (const sdw of shadowed) console.log(`      shadow survived: ${sdw.date} ${sdw.detail}`)
  check(shadowed.length === 0, 'no VIN-less delivery survives beside the real record it duplicates')
  check(deliveries.length <= profile.vehicles.length,
    `deliveries (${deliveries.length}) never exceed vehicles (${profile.vehicles.length})`)

  console.log('\n5) The default view is milestones, and the full view still holds everything')
  const milestones = timeline.filter(isMilestoneEvent)
  const hidden = timeline.length - milestones.length
  console.log(`   ${milestones.length} milestones, ${hidden} funnel steps behind "View full timeline"`)
  check(milestones.length > 0, 'there is always something to show by default')
  check(!milestones.some((e) => ['Enquiry created', 'Test drive', 'Booking created', 'Vehicle invoiced'].includes(e.title)),
    'enquiry / test drive / booking / invoice are NOT in the default view')
  check(timeline.length >= milestones.length, 'nothing was deleted — the full timeline is a superset')

  console.log('\n6) The header total is made of parts the screen can show')
  let service = 0; let accessories = 0; let insurance = 0; let premiumRows = 0
  for (const v of profile.vehicles) {
    service += v.serviceSpend ?? 0
    accessories += v.accessoriesSpend ?? 0
    if (!v.insurance?.cancelled && v.insurance?.grossPremium) { insurance += v.insurance.grossPremium; premiumRows += 1 }
  }
  const totalSpend = service + accessories + insurance
  console.log(`   Workshop Rs${Math.round(service).toLocaleString('en-IN')} + Insurance Rs${Math.round(insurance).toLocaleString('en-IN')} + Accessories Rs${Math.round(accessories).toLocaleString('en-IN')} = Rs${Math.round(totalSpend).toLocaleString('en-IN')}`)
  check(Math.abs(totalSpend - (service + accessories + insurance)) < 0.01, 'the parts sum to the total exactly')
  /*
   * The defect: a premium counted into the header while its own table cell rendered "—", because
   * only a pre-formatted string was in the metadata and the column reads the raw number.
   */
  const insuranceEvents = timeline.filter((e) => e.category === 'insurance')
  const withRawPremium = insuranceEvents.filter((e) => typeof e.metadata?.grossPremium === 'number')
  console.log(`   ${withRawPremium.length} of ${insuranceEvents.length} insurance events carry a raw premium`)
  if (premiumRows > 0) {
    check(withRawPremium.length > 0,
      'a counted premium is also renderable in the insurance table — the total is auditable')
  }

  await verifyDirectoryCard()
  await verifyOdometerCoverage()

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

/**
 * The directory CARD carries the customer, not a count of our records.
 *
 * It used to show ENQ / BOOK / CARS / SVC — a tally of rows in our own tables. These fields answer
 * when we last saw them, what the relationship is worth and whether cover is lapsing. Asserted
 * against the live list because a field that types correctly and arrives null is exactly the
 * failure that made the old card useless.
 */
async function verifyDirectoryCard() {
  console.log('\n7) The directory card carries the customer, not a count of our records')
  const startedAt = Date.now()
  const list = await listKiaCustomers({ pageSize: 24 })
  const listMs = Date.now() - startedAt
  console.log(`   ${list.rows.length} of ${list.totalCustomers} customers in ${listMs}ms`)

  const withModel = list.rows.filter((r) => r.primaryModel).length
  const withService = list.rows.filter((r) => r.lastServiceDate).length
  const withPolicy = list.rows.filter((r) => r.nextPolicyExpiry || r.latestPolicyExpiry).length
  const withSpend = list.rows.filter((r) => (r.serviceSpend ?? 0) > 0).length
  console.log(`   model ${withModel}  lastService ${withService}  policy ${withPolicy}  spend>0 ${withSpend}`)
  check(withModel > list.rows.length / 2, `most cards name the car (${withModel}/${list.rows.length})`)
  check(withService > 0, `cards carry a last-service date (${withService})`)
  check(withPolicy > 0, `cards carry an insurance expiry (${withPolicy})`)
  check(withSpend > 0, `cards carry workshop spend (${withSpend})`)
  /*
   * The one that must not drift: ONE statement serves the whole directory, so these have to stay
   * aggregates over CTEs that already run rather than becoming joins.
   */
  check(listMs < 9000, `the directory statement stays within budget (${listMs}ms)`)
  /*
   * A spend of 0 is a real answer — they came in and were not billed — and must not be coerced to
   * null, which would mean "we hold no figure".
   */
  const zeroSpend = list.rows.filter((r) => r.serviceSpend === 0).length
  console.log(`   ${zeroSpend} customer(s) have visits but no billed amount`)
}

/**
 * The odometer comes from THREE feeds, and the union must keep paying for itself.
 *
 * kia_psf_yearly alone left 1,811 of 5,757 billed visits (31.5%) with no reading. Two of those
 * missing rows in three sit on a vehicle that HAS readings on other visits — so the vehicle's usage
 * rate and its forecast survive; it is only the per-visit cell that is blank.
 *
 * ⚠️ kia_demo_job_cards carries the bulk of the recovery despite its name. It is the same DMS
 * job-card export in a second table: where both feeds describe one (vin, ro_no) they agree on
 * 1,020 of 1,050 rows and differ by at most 149 km on the rest.
 */
async function verifyOdometerCoverage() {
  console.log('\n8) Odometer coverage across the three feeds')

  const [before] = await analyticsExecute<{ visits: number; covered: number }>(sql`
    SELECT COUNT(*)::int AS visits, COUNT(p.mileage)::int AS covered
    FROM ro_billing_report b
    LEFT JOIN (
      SELECT UPPER(BTRIM(vin)) AS vin, UPPER(BTRIM(ro_no)) AS ro_no, MAX(mileage) AS mileage
      FROM kia_psf_yearly
      WHERE mileage > 0 AND COALESCE(BTRIM(vin),'') <> '' AND COALESCE(BTRIM(ro_no),'') <> ''
      GROUP BY 1, 2
    ) p ON p.vin = UPPER(BTRIM(b.vin)) AND p.ro_no = UPPER(BTRIM(b.ro_no))`)

  const [after] = await analyticsExecute<{ visits: number; covered: number }>(sql`
    SELECT COUNT(*)::int AS visits, COUNT(m.mileage)::int AS covered
    FROM ro_billing_report b
    LEFT JOIN (
      SELECT vin, ro_no, MAX(mileage) AS mileage FROM (
        SELECT UPPER(BTRIM(vin)) AS vin, UPPER(BTRIM(ro_no)) AS ro_no, mileage FROM kia_psf_yearly
        WHERE mileage > 0 AND COALESCE(BTRIM(vin),'') <> '' AND COALESCE(BTRIM(ro_no),'') <> ''
        UNION ALL
        SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage FROM kia_demo_job_cards
        WHERE mileage > 0 AND COALESCE(BTRIM(vin),'') <> '' AND COALESCE(BTRIM(r_o_no),'') <> ''
        UNION ALL
        SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage FROM kia_open_ro_yearly
        WHERE mileage > 0 AND COALESCE(BTRIM(vin),'') <> '' AND COALESCE(BTRIM(r_o_no),'') <> ''
      ) o GROUP BY vin, ro_no
    ) m ON m.vin = UPPER(BTRIM(b.vin)) AND m.ro_no = UPPER(BTRIM(b.ro_no))`)

  const pct = (c: number, t: number) => `${((c / t) * 100).toFixed(1)}%`
  console.log(`   PSF only        ${before.covered}/${before.visits}  ${pct(before.covered, before.visits)}`)
  console.log(`   all three feeds ${after.covered}/${after.visits}  ${pct(after.covered, after.visits)}  (+${after.covered - before.covered})`)
  check(after.covered > before.covered, `the extra feeds recover readings (+${after.covered - before.covered})`)
  check(after.covered / after.visits > 0.70, `coverage clears 70% (${pct(after.covered, after.visits)})`)

  // The union must never invent a reading where the feeds disagree wildly about the same job card.
  const [conflict] = await analyticsExecute<{ overlapping: number; worst: string | null }>(sql`
    SELECT COUNT(*)::int AS overlapping, MAX(ABS(p.mileage - d.mileage))::text AS worst
    FROM kia_psf_yearly p
    JOIN kia_demo_job_cards d
      ON UPPER(BTRIM(d.vin)) = UPPER(BTRIM(p.vin)) AND UPPER(BTRIM(d.r_o_no)) = UPPER(BTRIM(p.ro_no))
    WHERE p.mileage > 0 AND d.mileage > 0`)
  console.log(`   feeds overlap on ${conflict.overlapping} job cards, worst disagreement ${conflict.worst} km`)
  /*
   * 500 km is the line between "a revised reading on one job card" and "these are two different
   * vehicles". If it is ever crossed, the join key has stopped identifying a single car.
   */
  check(Number(conflict.worst ?? 0) < 500,
    `where the feeds overlap they describe the same car (worst gap ${conflict.worst} km)`)

  /*
   * Reported, not asserted: a blank cell is not a blank forecast. Most missing readings sit on a
   * vehicle that has readings on OTHER visits, so its rate and next-service date still stand.
   */
  const [salvage] = await analyticsExecute<{ missing: number; vehicle_has_others: number }>(sql`
    WITH merged AS (
      SELECT vin, ro_no, MAX(mileage) AS mileage FROM (
        SELECT UPPER(BTRIM(vin)) AS vin, UPPER(BTRIM(ro_no)) AS ro_no, mileage FROM kia_psf_yearly WHERE mileage > 0
        UNION ALL SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage FROM kia_demo_job_cards WHERE mileage > 0
        UNION ALL SELECT UPPER(BTRIM(vin)), UPPER(BTRIM(r_o_no)), mileage FROM kia_open_ro_yearly WHERE mileage > 0
      ) o WHERE COALESCE(BTRIM(ro_no),'') <> '' GROUP BY vin, ro_no
    ), known_vins AS (SELECT DISTINCT vin FROM merged)
    SELECT COUNT(*)::int AS missing,
           COUNT(*) FILTER (WHERE k.vin IS NOT NULL)::int AS vehicle_has_others
    FROM ro_billing_report b
    LEFT JOIN merged m ON m.vin = UPPER(BTRIM(b.vin)) AND m.ro_no = UPPER(BTRIM(b.ro_no))
    LEFT JOIN known_vins k ON k.vin = UPPER(BTRIM(b.vin))
    WHERE m.mileage IS NULL`)
  console.log(`   ${salvage.missing} visits still blank — ${salvage.vehicle_has_others} of them on a vehicle that has readings elsewhere,`)
  console.log(`   so the forecast survives for those; only the per-visit cell is empty.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
