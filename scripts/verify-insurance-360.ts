/**
 * The Insurance 360 business rules.
 *
 * ── What this guards ──────────────────────────────────────────────────────────────────────────
 * Every rule here reclassifies real customers between RETAINED and LAPSED, or decides whether an
 * acquisition is counted. All of them fail SILENTLY — a wrong lapse window still renders a tidy
 * number. So each is asserted against both a constructed case and the live feed.
 *
 * The three that matter most:
 *   - A renewal event is an OWN-DAMAGE policy, not a row. Counting rows roughly doubles everything.
 *   - The lapse window is 30 days because 96.1% of real consecutive policies start within 1 day.
 *   - A chain whose FIRST policy is already a renewal is left-censored: the relationship began
 *     before our data. 5,737 Hyundai policies are in that position.
 *
 * Read-only. Run: npm run verify:insurance-360
 */
import 'dotenv/config'
import { analyticsExecute } from '../lib/analytics/db'
import { sql } from 'drizzle-orm'
import {
  buildRelationship, classifyPolicyType, segmentsFor, toIso,
  CONTINUOUS_COVER_WINDOW_DAYS, type PolicyInput,
} from '../lib/insurance-360/lifecycle'

let failures = 0
const check = (c: boolean, m: string) => { if (!c) failures++; console.log(`  [${c ? 'PASS' : 'FAIL'}] ${m}`) }
const TODAY = new Date('2026-08-31T00:00:00Z')

const p = (o: Partial<PolicyInput>): PolicyInput => ({
  policyNo: 'P', startDate: null, expiryDate: null, policyType: 'RENEWAL', isOwnDamage: true, ...o,
})

async function main() {
  console.log('1) Dates survive the driver')
  check(toIso(new Date('2026-07-30T00:00:00Z')) === '2026-07-30', 'a JS Date becomes ISO, not "Thu Jul 30"')
  check(toIso('30/01/2026') === '2026-01-30', 'DD/MM/YYYY is read day-first')
  check(toIso('bad') === null, 'unparseable yields null rather than a guess')

  console.log('\n2) The feed\'s own policy type, including KIA\'s Title Case')
  check(classifyPolicyType('ROLLOVER') === 'ROLLOVER', 'SCREAMING CASE (hyundai/platinum)')
  // The literal that scores a silent zero if compared uppercase — KIA writes 'New' / 'Renewal'.
  check(classifyPolicyType('New') === 'NEW', "KIA's Title Case 'New' is still NEW")
  check(classifyPolicyType('Renewal') === 'RENEWAL', "KIA's 'Renewal' is still RENEWAL")
  check(classifyPolicyType('') === 'UNKNOWN', 'blank is UNKNOWN, never silently NEW')

  console.log('\n3) A third-party companion row is not a renewal')
  /*
   * Every car carries an OD policy plus a fixed-premium TP companion. Counting rows would show two
   * policies where the customer bought one.
   */
  const withTp = buildRelationship([
    p({ startDate: '2025-01-01', expiryDate: '2026-01-01', policyType: 'NEW', isOwnDamage: true }),
    p({ startDate: '2025-01-01', expiryDate: '2028-01-01', policyType: 'NEW', isOwnDamage: false }),
  ], TODAY)
  check(withTp.policyCount === 1, 'one OD policy is counted, not two rows')
  check(withTp.rowCount === 2, 'the row count is still reported separately')

  console.log('\n4) Continuous cover: the 30-day window')
  const continuous = buildRelationship([
    p({ startDate: '2024-01-01', expiryDate: '2025-01-01', policyType: 'NEW' }),
    p({ startDate: '2025-01-02', expiryDate: '2026-01-02', policyType: 'RENEWAL' }),
    p({ startDate: '2026-01-03', expiryDate: '2027-01-03', policyType: 'RENEWAL' }),
  ], TODAY)
  console.log(`   gaps: ${continuous.journey.map((s) => s.gapDays).join(', ')}  status=${continuous.status}`)
  check(continuous.neverLapsed, 'a 1-day handover is continuous cover — the shape 96.1% of the book has')
  check(continuous.renewalCount === 2, 'two renewals counted')
  check(continuous.status === 'ACTIVE', 'cover to 2027 is ACTIVE')

  const broken = buildRelationship([
    p({ startDate: '2024-01-01', expiryDate: '2025-01-01', policyType: 'NEW' }),
    p({ startDate: '2025-04-01', expiryDate: '2026-04-01', policyType: 'ROLLOVER' }),
  ], TODAY)
  check(!broken.neverLapsed, 'a 90-day gap breaks cover')
  check(broken.longestGapDays === 90, `the gap is reported (${broken.longestGapDays} days)`)

  console.log('\n5) An OVERLAP is not a lapse')
  /*
   * Two policies covering the same window is a data problem, but treating it as a break would mark
   * the most continuously-covered customers as having lost cover.
   */
  const overlap = buildRelationship([
    p({ startDate: '2024-01-01', expiryDate: '2025-06-01', policyType: 'NEW' }),
    p({ startDate: '2025-01-01', expiryDate: '2026-01-01', policyType: 'RENEWAL' }),
  ], TODAY)
  check(overlap.neverLapsed, 'overlapping cover has never lapsed')
  check(overlap.reviewReasons.some((r) => /overlap/i.test(r)), 'but the overlap is flagged for review')

  console.log('\n6) One policy is not a retention record')
  const single = buildRelationship([p({ startDate: '2026-01-01', expiryDate: '2027-01-01', policyType: 'NEW' })], TODAY)
  check(!single.neverLapsed, 'a single policy is NOT "never lapsed" — there has been no chance to lapse')
  check(segmentsFor(single).includes('NEW'), 'it is NEW')
  check(!segmentsFor(single).includes('RETAINED'), 'and not RETAINED')

  console.log('\n7) Left-censoring: the relationship can predate our data')
  const censored = buildRelationship([
    p({ startDate: '2025-01-01', expiryDate: '2026-01-01', policyType: 'RENEWAL' }),
  ], TODAY)
  check(censored.leftCensored, 'a first-on-file RENEWAL is left-censored')
  check(!segmentsFor(censored).includes('NEW'), 'and must NOT be counted as a new customer')
  check(censored.reviewReasons.length > 0, 'the reason is stated, not hidden')

  console.log('\n8) Status boundaries')
  const mk = (expiry: string) => buildRelationship([p({ startDate: '2020-01-01', expiryDate: expiry, policyType: 'NEW' })], TODAY).status
  check(mk('2027-01-01') === 'ACTIVE', 'far future = ACTIVE')
  check(mk('2026-10-01') === 'DUE_FOR_RENEWAL', 'within 60 days = DUE_FOR_RENEWAL')
  check(mk('2026-08-20') === 'EXPIRED', 'just past = EXPIRED')
  check(mk('2026-06-01') === 'LAPSED', 'past the 30-day window = LAPSED')
  check(mk('2024-01-01') === 'LOST', 'over a year = LOST')

  console.log('\n9) Against the LIVE Hyundai feed')
  const rows = await analyticsExecute<{
    chassis_no: string; policy_no: string | null; policy_start_date: Date | string | null
    od_expiry_date: Date | string | null; policy_type: string | null; is_od: boolean
    insurance_company: string | null; gross_premium: string | null
  }>(sql`
    SELECT UPPER(BTRIM(chassis_no)) AS chassis_no, policy_no, policy_start_date, od_expiry_date,
           policy_type, insurance_company, gross_premium::text,
           (COALESCE(NULLIF(BTRIM(od_tenure),''),'0') <> '0') AS is_od
    FROM hyundai_insurance_policy_summary
    WHERE COALESCE(BTRIM(chassis_no),'') <> ''`)
  const byChassis = new Map<string, PolicyInput[]>()
  for (const r of rows) {
    byChassis.set(r.chassis_no, [...(byChassis.get(r.chassis_no) || []), {
      policyNo: r.policy_no, startDate: r.policy_start_date, expiryDate: r.od_expiry_date,
      policyType: r.policy_type, insurer: r.insurance_company, grossPremium: r.gross_premium,
      isOwnDamage: r.is_od,
    }])
  }
  console.log(`   ${rows.length} rows across ${byChassis.size} vehicles`)

  let neverLapsed = 0; let multi = 0; let censoredCount = 0; let negativeYears = 0
  const statusCount = new Map<string, number>()
  for (const [, ps] of byChassis) {
    const rel = buildRelationship(ps, TODAY)
    statusCount.set(rel.status, (statusCount.get(rel.status) || 0) + 1)
    if (rel.neverLapsed) neverLapsed += 1
    if (rel.policyCount > 1) multi += 1
    if (rel.leftCensored) censoredCount += 1
    if ((rel.yearsRetained ?? 0) < 0) negativeYears += 1
  }
  console.log(`   status: ${[...statusCount].map(([k, v]) => `${k}=${v}`).join('  ')}`)
  console.log(`   multi-policy ${multi}, never-lapsed ${neverLapsed}, left-censored ${censoredCount}`)

  check(negativeYears === 0, 'no vehicle reports negative years retained')
  check(multi > 1000, `the renewal chains are real (${multi} multi-policy vehicles)`)
  check(neverLapsed > 0 && neverLapsed <= multi, `never-lapsed is a subset of multi-policy (${neverLapsed}/${multi})`)
  /*
   * Not vacuous: if the window were wrong in either direction this would collapse. Every
   * multi-policy vehicle never-lapsing would mean the window is too generous to mean anything;
   * none of them would mean it is too strict to be reachable.
   */
  check(neverLapsed < multi, 'some multi-policy vehicles DID lapse — the window discriminates')
  check(censoredCount > 1000, `left-censoring is common and must be surfaced (${censoredCount})`)

  console.log('\n10) The row-vs-OD distinction actually bites')
  const totalRows = rows.length
  const totalOd = [...byChassis.values()].reduce((a, ps) => a + buildRelationship(ps, TODAY).policyCount, 0)
  console.log(`   ${totalRows} rows -> ${totalOd} own-damage policies`)
  check(totalOd < totalRows, `counting rows would overstate policies by ${totalRows - totalOd}`)

  console.log('\n11) A worked vehicle')
  const busiest = [...byChassis.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  const rel = buildRelationship(busiest[1], TODAY)
  console.log(`   ${busiest[0]} — ${rel.policyCount} policies, status ${rel.status}, never-lapsed ${rel.neverLapsed}`)
  for (const s of rel.journey) {
    console.log(`     ${s.sequence}. ${s.startDate} -> ${s.expiryDate}  ${String(s.eventType).padEnd(8)} gap=${s.gapDays ?? '-'}  ${s.insurer || ''}`)
  }
  check(rel.journey.length > 1, 'the busiest vehicle has a real chain')
  check(rel.journey.every((s, i) => s.sequence === i + 1), 'the journey is sequenced in order')

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
