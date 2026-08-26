import 'dotenv/config'
import assert from 'node:assert/strict'
import postgres from 'postgres'
import { listKiaCustomers, getKiaCustomerProfile } from '../lib/kia/customer-profile/reader'
import { parseCustomerKey, phone10, isVinLike, classifySearchTerm } from '../lib/kia/customer-profile/identity'
import { redactKiaCustomerSummary } from '../lib/kia/customer-profile/redact'

/**
 * Guards the KIA Customer Profile section.
 *
 * ⚠️ These are STRUCTURAL invariants and floors, never fixed totals. The DMS feeds are live and
 * cumulative — during development the enquiry-without-booking count moved from 6,908 to 6,910
 * within twenty minutes as new bookings landed. Pinning exact numbers would produce a script
 * that fails for the wrong reason every morning, which is worse than no script at all.
 *
 * Run: npm run verify:kia-customer-profile
 */

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: 'require' })

function pct(part: number, whole: number) {
  return whole === 0 ? 0 : (part / whole) * 100
}

async function main() {
  const checks: string[] = []
  const ok = (label: string) => checks.push(`  [PASS] ${label}`)

  /* ---------------------------------------------------------------- *
   * 1. THE DEDUPE. If this breaks, every number in the section inflates.
   * ---------------------------------------------------------------- */
  const [dedupe] = await sql`
    WITH latest_enquiry AS (
      SELECT DISTINCT ON (customer_id, enquiry_no) customer_id FROM kia_enquiry_report
      WHERE COALESCE(customer_id,'') <> '' ORDER BY customer_id, enquiry_no, uploaded_at DESC NULLS LAST),
    latest_booking AS (
      SELECT DISTINCT ON (booking_no) booking_no FROM kia_booking_report
      WHERE COALESCE(booking_no,'') <> '' ORDER BY booking_no, uploaded_at DESC NULLS LAST)
    SELECT
      (SELECT COUNT(*) FROM kia_enquiry_report)::int AS enquiry_raw,
      (SELECT COUNT(DISTINCT customer_id) FROM latest_enquiry)::int AS enquiry_customers,
      (SELECT COUNT(*) FROM latest_enquiry)::int AS enquiry_deduped,
      (SELECT COUNT(*) FROM kia_booking_report)::int AS booking_raw,
      (SELECT COUNT(*) FROM latest_booking)::int AS bookings`

  /*
   * The invariant is that DEDUPE REMOVES ROWS - not how much snapshot history happens to have
   * accumulated.
   *
   * This previously asserted `enquiry_raw > enquiry_customers * 3`, which failed at 19,872 raw
   * against 8,371 customers (threshold 25,113) even though the feed is still a cumulative snapshot
   * and dedupe is still required (19,872 -> 11,700 distinct (customer_id, enquiry_no) = 1.70x).
   * That test measured accumulated history since the last re-base, so it went red after a re-base
   * and would have gone green again on its own - it could not tell anyone anything useful.
   */
  assert.ok(
    dedupe.enquiry_raw > dedupe.enquiry_deduped,
    `kia_enquiry_report should re-export rows (raw > deduped); got ${dedupe.enquiry_raw} raw vs ${dedupe.enquiry_deduped} deduped. `
    + 'If these are equal the feed is no longer a cumulative snapshot and the dedupe assumptions need rechecking.',
  )
  ok(`enquiry snapshot dedupes ${dedupe.enquiry_raw.toLocaleString('en-IN')} rows -> ${dedupe.enquiry_deduped.toLocaleString('en-IN')} enquiries `
    + `(${(dedupe.enquiry_raw / dedupe.enquiry_deduped).toFixed(2)}x) across ${dedupe.enquiry_customers.toLocaleString('en-IN')} customer ids`)
  assert.ok(dedupe.bookings < dedupe.booking_raw, 'booking feed should also be a cumulative snapshot')
  ok(`booking snapshot dedupes ${dedupe.booking_raw.toLocaleString('en-IN')} rows -> ${dedupe.bookings.toLocaleString('en-IN')} bookings`)

  /* ---------------------------------------------------------------- *
   * 2. IDENTITY COVERAGE — floors, so silent shrinkage fails the build.
   * ---------------------------------------------------------------- */
  const [cov] = await sql`
    WITH lb AS (SELECT DISTINCT ON (booking_no) customer_id FROM kia_booking_report
      WHERE COALESCE(booking_no,'') <> '' ORDER BY booking_no, uploaded_at DESC NULLS LAST),
    ls AS (SELECT DISTINCT ON (UPPER(BTRIM(vin_number))) UPPER(BTRIM(vin_number)) vin, customerid
      FROM kia_sales_report WHERE COALESCE(vin_number,'') <> ''
      ORDER BY UPPER(BTRIM(vin_number)), uploaded_at DESC NULLS LAST)
    SELECT
      (SELECT COUNT(*) FROM lb)::int AS bookings,
      (SELECT COUNT(*) FROM lb WHERE EXISTS (SELECT 1 FROM kia_enquiry_report e WHERE e.customer_id = lb.customer_id))::int AS booking_in_enquiry,
      (SELECT COUNT(*) FROM ls)::int AS sales_vins,
      (SELECT COUNT(*) FROM ls WHERE EXISTS (SELECT 1 FROM ro_billing_report r WHERE UPPER(BTRIM(r.vin)) = ls.vin))::int AS vin_in_ro,
      (SELECT COUNT(*) FROM ls WHERE EXISTS (SELECT 1 FROM kia_insurance i WHERE UPPER(BTRIM(i.vinno)) = ls.vin))::int AS vin_in_insurance`

  const bookingCoverage = pct(cov.booking_in_enquiry, cov.bookings)
  const roCoverage = pct(cov.vin_in_ro, cov.sales_vins)
  const insCoverage = pct(cov.vin_in_insurance, cov.sales_vins)

  assert.ok(bookingCoverage >= 95, `booking->enquiry customer_id coverage fell to ${bookingCoverage.toFixed(1)}% (floor 95%)`)
  ok(`booking -> enquiry party key: ${bookingCoverage.toFixed(1)}%`)
  assert.ok(roCoverage >= 90, `sales VIN -> repair order coverage fell to ${roCoverage.toFixed(1)}% (floor 90%)`)
  ok(`sales VIN -> repair orders: ${roCoverage.toFixed(1)}%`)
  assert.ok(insCoverage >= 85, `sales VIN -> insurance coverage fell to ${insCoverage.toFixed(1)}% (floor 85%)`)
  ok(`sales VIN -> insurance: ${insCoverage.toFixed(1)}%`)

  /* ---------------------------------------------------------------- *
   * 3. THE READER agrees with the raw feeds.
   * ---------------------------------------------------------------- */
  const list = await listKiaCustomers({ pageSize: 25 })
  assert.ok(list.totalCustomers > dedupe.enquiry_customers, 'directory must include service-only vehicles on top of sales customers')
  ok(`directory = ${list.totalCustomers.toLocaleString('en-IN')} (sales customers + service-only vehicles)`)

  /*
   * Bounded by the number of PROFILES, not by distinct customer_id.
   *
   * Since the party key became (customer_id, outlet), one customer_id can legitimately produce more
   * than one profile - 8,371 ids resolve to 10,775 people, because 2,411 of those ids were shared by
   * more than one person. Comparing a per-profile gap count against a per-id count made this
   * assertion fail for the right reason at the wrong place.
   */
  assert.ok(
    list.gapCounts.enquiryNoBooking > 0 && list.gapCounts.enquiryNoBooking <= list.totalCustomers,
    'enquiry-without-booking must be a strict subset of the directory',
  )
  ok(`gap counts present: ${JSON.stringify(list.gapCounts)}`)

  // A service-only vehicle can never carry a sales-side gap.
  const serviceOnly = list.rows.find((row) => row.kind === 'vehicle')
  if (serviceOnly) {
    assert.equal(serviceOnly.gaps.enquiryNoBooking, false, 'a service-only vehicle cannot have an enquiry gap')
    assert.equal(serviceOnly.gaps.bookingNoInsurance, false, 'a service-only vehicle cannot have a booking-insurance gap')
    ok('service-only vehicles carry no sales-side gaps')
  }

  /* ---------------------------------------------------------------- *
   * 4. PROFILE assembly, both key kinds.
   * ---------------------------------------------------------------- */
  const salesRow = list.rows.find((row) => row.kind === 'customer')
  assert.ok(salesRow, 'expected at least one sales customer in the directory')
  const salesProfile = await getKiaCustomerProfile(parseCustomerKey(salesRow!.key)!)
  assert.ok(salesProfile, 'sales customer profile should resolve')
  assert.equal(salesProfile!.key, salesRow!.key, 'profile key must round-trip')
  ok(`profile resolves for a sales customer (${salesProfile!.enquiries.length} enquiries, ${salesProfile!.vehicles.length} vehicles)`)

  if (serviceOnly) {
    const vehicleProfile = await getKiaCustomerProfile(parseCustomerKey(serviceOnly.key)!)
    assert.ok(vehicleProfile, 'service-only vehicle profile should resolve')
    assert.ok(vehicleProfile!.vehicles.length === 1, 'a vehicle-keyed profile holds exactly one vehicle')
    assert.ok(
      vehicleProfile!.notes.some((note) => note.includes('no sales record')),
      'a service-only profile must say purchase details are unavailable rather than implying none exist',
    )
    ok('profile resolves for a service-only vehicle, with the missing-sales-record note')
  }

  /* ---------------------------------------------------------------- *
   * 5. PII — redaction happens server-side, in the payload.
   * ---------------------------------------------------------------- */
  const withPhone = list.rows.find((row) => row.phone)
  if (withPhone) {
    const masked = redactKiaCustomerSummary(withPhone, 'service_manager')
    assert.notEqual(masked.phone, withPhone.phone, 'phone must be redacted for a non-PII role')
    assert.ok(!String(masked.phone).match(/\d{6,}/), 'no long digit run may survive redaction')
    const allowedRow = redactKiaCustomerSummary(withPhone, 'md')
    assert.equal(allowedRow.phone, withPhone.phone, 'MD must still see the real number')
    ok('PII redacted for a non-PII role, preserved for MD')
  }

  /* ---------------------------------------------------------------- *
   * 6. Identity helpers.
   * ---------------------------------------------------------------- */
  assert.equal(phone10('+91 91495-17648'), '9149517648')
  assert.equal(phone10('123'), '')
  assert.ok(isVinLike('MZBEB812LTN036625'))
  assert.ok(!isVinLike('MZBEB812LTN03662'), '16 characters is not a VIN')
  assert.ok(!isVinLike('MZBEB812LTNO36625'), 'the letter O is invalid in a VIN')
  assert.equal(classifySearchTerm('9149517648')?.phone, '9149517648')
  assert.equal(classifySearchTerm('JK02DU8842')?.registration, 'JK02DU8842')
  assert.equal(classifySearchTerm('Sharma')?.isExact, false)
  assert.equal(parseCustomerKey('cid:C2025010002')?.kind, 'customer')
  assert.equal(parseCustomerKey('vin:MZBEB812LTN036625')?.kind, 'vehicle')
  assert.equal(parseCustomerKey('nonsense'), null)
  ok('identity helpers behave (phone10, VIN validity, search classification, key parsing)')

  console.log(checks.join('\n'))
  console.log('\n=== KIA CUSTOMER PROFILE: ALL CHECKS PASSED ===')
}

main()
  .then(async () => { await sql.end(); process.exit(0) })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error)
    await sql.end()
    process.exit(1)
  })
