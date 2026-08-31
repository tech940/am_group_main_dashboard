/**
 * The odometer-based next-service forecast.
 *
 * ── What this guards ──────────────────────────────────────────────────────────────────────────
 * A forecast is worse than no forecast when it is confidently wrong, and every failure mode here is
 * silent — a bad rate still renders as a neat date. The live feed contains all three hazards:
 *
 *   - SAME-DAY VISITS. One vehicle reads 39,328 km and 39,326 km both on 2026-04-22. Ordered by date
 *     alone that is a -2 km step over 0 days: a negative distance divided by zero.
 *   - DECREASING READINGS. 26 of 1,686 consecutive pairs go backwards (cluster swap, typo, re-used
 *     registration).
 *   - SINGLE-READING VEHICLES. 1,311 of 2,274 VINs have exactly one reading, which supports a total
 *     but no rate at all.
 *
 * Run: npm run verify:service-cadence
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import {
  buildServiceCadence, cleanReadings, toIsoDate, isScheduledService,
  FLEET_MEDIAN_SERVICE_INTERVAL_KM, type ServiceReading,
} from '../lib/customer-360/service-cadence'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }
const TODAY = new Date('2026-08-30T00:00:00Z')

async function main() {
  console.log('1) Dates: a Postgres DATE arrives as a Date object, not a string')
  /*
   * The exact bug this repo shipped once: String(aDate).slice(0,10) yields "Thu Jul 30".
   */
  check(toIsoDate(new Date('2026-07-30T00:00:00Z')) === '2026-07-30', 'a JS Date becomes an ISO date')
  check(toIsoDate('2026-07-30') === '2026-07-30', 'an ISO string passes through')
  check(toIsoDate('2026-07-30T11:22:33Z') === '2026-07-30', 'an ISO timestamp is truncated')
  // Day-first, because these are Indian DMS feeds — month-first would move an event by up to a month.
  check(toIsoDate('30/01/2026') === '2026-01-30', 'DD/MM/YYYY is read day-first')
  check(toIsoDate('01/02/2026') === '2026-02-01', 'an ambiguous DD/MM is still day-first')
  check(toIsoDate('') === null && toIsoDate(null) === null, 'blank and null yield null')
  check(toIsoDate('not a date') === null, 'unparseable yields null rather than a guess')

  console.log('\n2) Work type decides what counts as a scheduled visit')
  for (const t of ['Free Service', 'Paid Service', 'PAID SERVICE']) {
    check(isScheduledService(t), `"${t}" is scheduled`)
  }
  for (const t of ['Running Repair', 'Accidental Repair', '', null]) {
    check(!isScheduledService(t), `${JSON.stringify(t)} is NOT scheduled`)
  }

  console.log('\n3) Same-day visits collapse to one point')
  const sameDay = cleanReadings([
    { date: '2026-04-22', km: 39328, workType: 'Accidental Repair' },
    { date: '2026-04-22', km: 39326, workType: 'Paid Service' },
  ])
  check(sameDay.length === 1, 'two readings on one day become one')
  check(sameDay[0]?.km === 39328, 'the higher reading wins — an odometer does not run backwards')
  check(sameDay[0]?.scheduled === true, 'the day still counts as scheduled if any visit that day was')

  console.log('\n4) A decreasing pair is dropped, not clamped')
  const backwards = buildServiceCadence([
    { date: '2025-01-01', km: 50000, workType: 'Paid Service' },
    { date: '2025-06-01', km: 20000, workType: 'Running Repair' },
  ], TODAY)
  check(backwards.kmPerDay === null, 'no rate is invented from a backwards step')
  check(backwards.confidence === 'none', 'confidence is none')
  check(/do not increase/i.test(backwards.basis), `the basis says why: "${backwards.basis}"`)

  console.log('\n5) One reading supports no forecast at all')
  const single = buildServiceCadence([{ date: '2026-01-01', km: 10000, workType: 'Free Service' }], TODAY)
  check(single.lastReading?.km === 10000, 'the reading itself is still reported')
  check(single.nextDueDate === null && single.kmPerDay === null, 'no date and no rate are produced')
  check(/second visit/i.test(single.basis), 'the basis explains what is missing')

  console.log('\n6) A zero odometer means NOT RECORDED, not a brand-new car')
  /*
   * The live feed has 3,960 readings and not one of them is 0 (the minimum is 46 km), so a 0 is a
   * blank the DMS wrote as a number. Treating it as a real reading would invent a step from 0 and
   * halve the apparent usage rate.
   */
  const withZero = cleanReadings([
    { date: '2024-01-01', km: 0, workType: 'Free Service' },
    { date: '2024-07-01', km: 5000, workType: 'Free Service' },
  ])
  check(withZero.length === 1 && withZero[0].km === 5000, 'a 0 km reading is discarded as missing')

  console.log('\n7) A clean history forecasts arithmetically')
  const clean = buildServiceCadence([
    { date: '2024-01-01', km: 100, workType: 'Free Service' },
    { date: '2024-07-01', km: 5000, workType: 'Free Service' },
    { date: '2025-01-01', km: 10000, workType: 'Paid Service' },
    { date: '2025-07-01', km: 15000, workType: 'Paid Service' },
  ], TODAY)
  console.log(`   rate=${clean.kmPerDay?.toFixed(2)} km/day  interval=${clean.intervalKm} (${clean.intervalSource})  dueKm=${clean.nextDueKm}  dueDate=${clean.nextDueDate}`)
  check(clean.intervalSource === 'own-history', "the customer's own interval is used")
  check(clean.intervalKm === 5000, 'the interval is the median of their scheduled gaps (4,900 / 5,000 / 5,000)')
  check(clean.nextDueKm === 20000, 'next due at 20,000 km — last scheduled reading + interval')
  check(Math.abs((clean.kmPerDay ?? 0) - 14900 / 547) < 0.01, 'rate is total km over total days')
  check(clean.confidence === 'good', 'confidence is good with a repeated own interval and 3+ readings')

  console.log('\n7b) The interval is read across the SCHEDULED subsequence, through the repairs')
  /*
   * The fix that matters most. Repairs sit between scheduled services, so a consecutive-pair reading
   * of the history finds almost no scheduled-to-scheduled gap at all — measured, 23 vehicles instead
   * of the 409 that really have two or more scheduled visits.
   */
  const interleaved = buildServiceCadence([
    { date: '2024-01-01', km: 1000, workType: 'Free Service' },
    { date: '2024-03-01', km: 3000, workType: 'Running Repair' },
    { date: '2024-05-01', km: 6000, workType: 'Accidental Repair' },
    { date: '2024-07-01', km: 9000, workType: 'Paid Service' },
  ], TODAY)
  check(interleaved.intervalSource === 'own-history',
    'two scheduled visits separated by repairs still yield the customer\'s own interval')
  check(interleaved.intervalKm === 8000, 'the gap spans the repairs: 9,000 - 1,000 = 8,000 km')

  console.log('\n7c) An impossible step is dropped, and the rest of the history survives')
  /*
   * From the live feed: 8,903 km to 21,096 km in three days — 4,064 km/day. The vehicle still has a
   * usable history either side of it.
   */
  const spike = buildServiceCadence([
    { date: '2025-01-01', km: 8000, workType: 'Free Service' },
    { date: '2025-01-04', km: 21000, workType: 'Running Repair' },
    { date: '2025-07-01', km: 26000, workType: 'Paid Service' },
  ], TODAY)
  check((spike.kmPerDay ?? 0) <= 400, `the 4,064 km/day step is excluded (rate ${spike.kmPerDay?.toFixed(1)})`)
  check(spike.kmPerDay !== null, 'but the vehicle still gets a rate from its remaining steps')

  console.log('\n7) Without two scheduled services the fleet median is used AND declared')
  const repairsOnly = buildServiceCadence([
    { date: '2025-01-01', km: 1000, workType: 'Running Repair' },
    { date: '2025-07-01', km: 6000, workType: 'Running Repair' },
  ], TODAY)
  check(repairsOnly.intervalSource === 'fleet-median', 'falls back to the fleet median')
  check(repairsOnly.intervalKm === FLEET_MEDIAN_SERVICE_INTERVAL_KM, `which is ${FLEET_MEDIAN_SERVICE_INTERVAL_KM} km`)
  /*
   * The fallback must NEVER be presented as this customer's own behaviour. An employee ringing the
   * customer needs to know which claim they are holding.
   */
  check(/median across all/i.test(repairsOnly.basis), 'the basis says the interval is borrowed, not observed')
  check(repairsOnly.confidence === 'low', 'and confidence drops to low')

  console.log('\n8) An overdue vehicle reports a NEGATIVE days-until-due, not a hidden one')
  const overdue = buildServiceCadence([
    { date: '2024-01-01', km: 100, workType: 'Free Service' },
    { date: '2024-12-31', km: 20000, workType: 'Paid Service' },
  ], TODAY)
  console.log(`   dueDate=${overdue.nextDueDate}  daysUntilDue=${overdue.daysUntilDue}`)
  check((overdue.daysUntilDue ?? 0) < 0, 'a past due date yields a negative day count')

  console.log('\n9) Against the LIVE feed')
  const rows = await analyticsExecute<{ vin: string; ro_date: Date | string; mileage: string; work_type: string | null }>(sql`
    SELECT vin, ro_date, mileage::text AS mileage, work_type
    FROM kia_psf_yearly
    WHERE mileage > 0 AND ro_date IS NOT NULL AND vin IS NOT NULL AND BTRIM(vin) <> ''`)
  const byVin = new Map<string, ServiceReading[]>()
  for (const r of rows) {
    const key = String(r.vin).trim().toUpperCase()
    byVin.set(key, [...(byVin.get(key) || []), { date: r.ro_date, km: r.mileage, workType: r.work_type }])
  }
  console.log(`   ${rows.length} readings across ${byVin.size} vehicles`)

  let forecast = 0; let ownHistory = 0; let noneCount = 0; let negativeRate = 0; let absurdRate = 0
  const dues: number[] = []
  for (const [, readings] of byVin) {
    const c = buildServiceCadence(readings, TODAY)
    if (c.nextDueDate) { forecast += 1; if (c.daysUntilDue !== null) dues.push(c.daysUntilDue) }
    if (c.intervalSource === 'own-history') ownHistory += 1
    if (c.confidence === 'none') noneCount += 1
    if (c.kmPerDay !== null && c.kmPerDay <= 0) negativeRate += 1
    // 800 km/day is ~2x a long-haul taxi; anything past it means the guards leaked.
    if (c.kmPerDay !== null && c.kmPerDay > 800) absurdRate += 1
  }
  console.log(`   ${forecast} vehicles get a forecast, ${ownHistory} from their own interval, ${noneCount} get none`)
  check(negativeRate === 0, 'no vehicle produces a zero or negative km/day')
  check(absurdRate === 0, `no vehicle produces an absurd rate (>800 km/day) — ${absurdRate} found`)
  /*
   * Locks in the scheduled-subsequence reading. Before it, 23 of 943 forecasts used the customer's
   * own interval and every other one silently borrowed the fleet median.
   */
  console.log(`   own-interval share: ${ownHistory}/${forecast}`)
  check(ownHistory > 300, `most forecasts use the customer's OWN interval (${ownHistory}), not the fleet median`)
  check(forecast > 400, `a useful number of vehicles get a forecast (${forecast})`)
  /*
   * Not vacuous: the guards must reject the unusable vehicles rather than silently forecasting them.
   * 1,311 of 2,274 VINs have a single reading, so 'none' must be the majority.
   */
  check(noneCount > 0 && noneCount < byVin.size, `some vehicles are refused a forecast (${noneCount}) but not all`)
  check(dues.every((d) => Number.isFinite(d)), 'every day-count is finite')

  console.log('\n10) The worked example from the feed')
  const [{ vin: topVin }] = await analyticsExecute<{ vin: string }>(sql`
    SELECT vin FROM kia_psf_yearly WHERE mileage > 0 AND ro_date IS NOT NULL
    GROUP BY vin ORDER BY COUNT(*) DESC LIMIT 1`)
  const c = buildServiceCadence(byVin.get(String(topVin).trim().toUpperCase()) || [], TODAY)
  console.log(`   ${topVin}`)
  for (const r of c.readings) console.log(`      ${r.date}  ${String(r.km).padStart(7)} km  ${r.scheduled ? 'scheduled' : 'repair'}`)
  console.log(`   -> ${c.kmPerDay?.toFixed(1)} km/day, interval ${c.intervalKm} km (${c.intervalSource})`)
  console.log(`   -> next due ~${c.nextDueKm?.toLocaleString('en-IN')} km on ${c.nextDueDate} (${c.daysUntilDue} days), confidence ${c.confidence}`)
  console.log(`   -> basis: ${c.basis}`)
  check(c.readings.length > 5 && c.nextDueDate !== null, 'the busiest vehicle gets a full forecast')
  check(c.basis.length > 0, 'the basis is never empty — every forecast states its evidence')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
