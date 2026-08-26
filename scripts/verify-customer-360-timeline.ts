/**
 * The unified timeline and next-best-actions, against real customers.
 *
 * Pure derivation over the profile payload, so this asserts the SHAPE of the story rather than any
 * particular customer's history: events are dated, ordered, categorised, and every action names the
 * fact that produced it.
 *
 * Run: npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-customer-360-timeline.ts
 */
import 'dotenv/config'
import { listKiaCustomers, getKiaCustomerProfile } from '../lib/kia/customer-profile/reader'
import { parseCustomerKey } from '../lib/kia/customer-profile/identity'
import { availableCategories, buildCustomerTimeline, buildNextBestActions } from '../lib/kia/customer-profile/timeline'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

async function main() {
  // A customer with a vehicle gives the richest story — that is where sales, insurance and service
  // actually interleave.
  const list = await listKiaCustomers({ pageSize: 60 })
  const withVehicle = list.rows.filter((r) => r.vehicleCount > 0 && r.kind === 'customer').slice(0, 6)
  check(withVehicle.length > 0, `found ${withVehicle.length} customers with a vehicle to test`)

  let richest: { name: string; events: number; cats: string[]; actions: number } | null = null
  let totalEvents = 0

  for (const row of withVehicle) {
    const profile = await getKiaCustomerProfile(parseCustomerKey(row.key)!, {})
    if (!profile) { fail(`${row.key} did not resolve`); continue }

    const events = buildCustomerTimeline(profile)
    const cats = availableCategories(events)
    const actions = buildNextBestActions(profile, new Date('2026-08-26T00:00:00Z'))
    totalEvents += events.length

    if (!richest || events.length > richest.events) {
      richest = { name: row.name, events: events.length, cats, actions: actions.length }
    }

    // Every event must be placeable in a story.
    check(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), `${row.name}: every event has a real date`)
    check(events.every((e) => Boolean(e.title)), `${row.name}: every event has a title`)
    // Newest first.
    const dates = events.map((e) => e.date)
    check(dates.every((d, i) => i === 0 || dates[i - 1] >= d), `${row.name}: events are newest-first`)
    // Categories offered must be categories present — no filter that can never match.
    check(cats.every((c) => events.some((e) => e.category === c)), `${row.name}: every offered filter matches something`)
    // Every action must cite its evidence.
    check(actions.every((a) => a.reason.length > 10), `${row.name}: every action states why`)
  }

  console.log(`\n  richest story: ${richest?.name} — ${richest?.events} events across [${richest?.cats.join(', ')}], ${richest?.actions} action(s)`)
  check(totalEvents > 0, `${totalEvents} timeline events derived in total`)

  console.log('\nSample — the newest events for the richest customer:')
  const best = withVehicle.find((r) => r.name === richest?.name)!
  const p = await getKiaCustomerProfile(parseCustomerKey(best.key)!, {})
  for (const e of buildCustomerTimeline(p!).slice(0, 10)) {
    console.log(`  ${e.date}  ${e.category.padEnd(14)} ${e.title.padEnd(26)} ${e.detail ?? ''}`)
  }
  console.log('\nNext best actions:')
  for (const a of buildNextBestActions(p!, new Date('2026-08-26T00:00:00Z'))) {
    console.log(`  [${a.urgency.toUpperCase()}] ${a.title} — ${a.reason}`)
  }

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
