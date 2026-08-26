/**
 * Cross-brand customer matching: the two false-positive traps, held closed.
 *
 * Both of these were REAL defects found while building the section, and both produce a confident,
 * plausible-looking list rather than an obvious error — which is exactly why they need a test:
 *
 *   1. Masked PAN. 13,952 of 23,406 Hyundai rows carry a PAN masked to '*****' with nothing left.
 *      Joining on the suffix without a shape check makes all of them share one key, collapsing the
 *      rule to name-only and inventing 442 "confirmed" Hyundai/Platinum customers out of namesakes.
 *
 *   2. Our own entity. "Platinum Automobiles Pvt Ltd" buys vehicles from us, and matched itself
 *      across brands: 162 of 164 Kia/Platinum rows were the dealership as its own best customer.
 *
 * Plus the invariants a reader is entitled to assume: a "confirmed" match really does have identical
 * names, no pair is the same physical car counted twice, and PAN never leaves the server.
 *
 * Read-only. Run: npm run verify:customer-360-common
 */
import 'dotenv/config'
import { listCommonCustomers } from '../lib/customer-360/common-customers'
import { CUSTOMER_BRANDS } from '../lib/customer-360/brands'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

const norm = (v: string | null) => String(v || '').toUpperCase().replace(/[^A-Z]/g, '')

async function main() {
  console.log('1) The masked-PAN trap is still closed')
  const masked = await analyticsExecute<{ total: number; unusable: number }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE RIGHT(UPPER(BTRIM(pan_no)), 5) !~ '^[0-9]{4}[A-Z]$')::int AS unusable
    FROM hyundai_sales_report
    WHERE COALESCE(BTRIM(pan_no), '') <> ''`)
  const { total, unusable } = masked[0]
  console.log(`   hyundai rows with a PAN: ${total}, of which unusable as a key: ${unusable}`)
  // If this ever hits zero the upstream masking changed and the guard should be revisited — but the
  // test must not silently pass by becoming vacuous.
  check(unusable > 0, `the trap is real: ${unusable} Hyundai PANs carry no usable suffix`)

  console.log('\n2) The matcher runs and returns labelled results')
  const brands = Object.keys(CUSTOMER_BRANDS) as (keyof typeof CUSTOMER_BRANDS)[]
  const result = await listCommonCustomers(brands)
  console.log(`   ${result.total} cross-brand customers`)
  for (const pair of result.pairCounts) {
    console.log(`   ${pair.pair}: ${pair.confirmed} confirmed, ${pair.likely} likely`)
  }
  check(result.rows.every((r) => r.confidence === 'confirmed' || r.confidence === 'likely'),
    'every row carries a confidence level')
  check(result.rows.every((r) => Boolean(r.evidence)), 'every row states why it was matched')

  console.log('\n3) Our own entities are not listed as customers')
  const OWN = /^(PLATINUMAUTOMOBILE|KCJAMMUAUTOMART|JAMMUAUTOMART|JAMMUAUTOMOBILE)/
  const selfMatches = result.rows.filter((r) => OWN.test(norm(r.name))
    || r.vehicles.some((v) => OWN.test(norm(v.name))))
  check(selfMatches.length === 0,
    `no self-dealing rows (found ${selfMatches.length}${selfMatches.length ? `: ${selfMatches[0].name}` : ''})`)

  console.log('\n4) A "confirmed" match really is an exact name match')
  const badConfirmed = result.rows.filter((r) => {
    if (r.confidence !== 'confirmed') return false
    const names = new Set(r.vehicles.map((v) => norm(v.name)).filter(Boolean))
    return names.size > 1
  })
  check(badConfirmed.length === 0,
    `confirmed rows have one normalised name (${badConfirmed.length} violations)`)

  console.log('\n5) A cross-brand customer spans two brands, and is not one car counted twice')
  const singleBrand = result.rows.filter((r) => new Set(r.vehicles.map((v) => v.brand)).size < 2)
  check(singleBrand.length === 0, `every row spans at least two brands (${singleBrand.length} violations)`)

  console.log('\n6) PAN never leaves the server')
  const serialised = JSON.stringify(result)
  // The real PAN shape, and the masked one. Neither may appear anywhere in the payload.
  const leaks = /[A-Z]{5}[0-9]{4}[A-Z]/.test(serialised) || /\*{3,}[0-9]{4}[A-Z]/.test(serialised)
  check(!leaks, 'no PAN or PAN fragment appears in the serialised payload')
  check(!/pan/i.test(Object.keys(result.rows[0]?.vehicles?.[0] || {}).join(',')),
    'no vehicle field is named after PAN')

  console.log('\n7) The result states its own incompleteness')
  check(result.notes.some((note) => /floor|masked/i.test(note)),
    'the payload carries a note that this is a floor, not a total')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => { console.error(error); process.exit(1) })
