/**
 * Branch scoping for the customer section.
 *
 * Two properties, and the second is the one that matters: a pinned user must SEE their own branch
 * (they used to get a hard 403), and must NOT be able to reach another branch's customer by pasting
 * a key into the URL.
 *
 * Read-only. Run: npx tsx --tsconfig ./tsconfig.verify.json scripts/verify-customer-360-scope.ts
 */
import 'dotenv/config'
import { listKiaCustomers, getKiaCustomerProfile } from '../lib/kia/customer-profile/reader'
import { parseCustomerKey } from '../lib/kia/customer-profile/identity'

let failures = 0
const ok = (m: string) => console.log(`  [PASS] ${m}`)
const fail = (m: string) => { failures++; console.log(`  [FAIL] ${m}`) }
const check = (c: boolean, m: string) => (c ? ok(m) : fail(m))

async function main() {
  console.log('1) An unrestricted user sees everything')
  const all = await listKiaCustomers({ pageSize: 25 })
  console.log(`   total ${all.totalCustomers}`)
  check(all.totalCustomers > 500, `unrestricted directory is populated (${all.totalCustomers})`)
  /*
   * BUYERS ONLY. This previously asserted > 9,000, which was the old prospect list — the directory
   * unioned enquiry-only customers and service-only VINs. It is now the people who actually bought
   * one of our vehicles, so the invariant to hold is the RULE, not the volume: every row is a party
   * key and every row owns at least one car.
   */
  check(all.rows.every((r) => r.vehicleCount > 0), 'every listed customer owns at least one vehicle')
  check(all.rows.every((r) => r.kind === 'customer'), 'no service-only VINs — every row is a real party key')

  console.log('\n2) A user pinned to one branch sees that branch, not an error')
  const jk402 = await listKiaCustomers({ dealerScope: ['JK402'], pageSize: 5 })
  const jk501 = await listKiaCustomers({ dealerScope: ['JK501'], pageSize: 5 })
  console.log(`   JK402 ${jk402.totalCustomers} · JK501 ${jk501.totalCustomers}`)
  check(jk402.totalCustomers > 0, `JK402 user sees ${jk402.totalCustomers} customers (was a 403)`)
  check(jk501.totalCustomers > 0, `JK501 user sees ${jk501.totalCustomers} customers (was a 403)`)
  check(jk402.totalCustomers < all.totalCustomers, 'a pinned user sees FEWER than an unrestricted one')
  check(jk501.totalCustomers < all.totalCustomers, 'and so does the other branch')

  console.log('\n3) A multi-branch pin sees the union')
  const both = await listKiaCustomers({ dealerScope: ['JK402', 'JK501'], pageSize: 5 })
  console.log(`   JK402+JK501 ${both.totalCustomers}`)
  check(both.totalCustomers >= Math.max(jk402.totalCustomers, jk501.totalCustomers),
    'a two-branch pin sees at least as many as either branch alone')

  console.log('\n4) A pinned user CANNOT open another branch\'s customer')
  const other = jk501.rows.find((r) => r.kind === 'customer')
  if (!other) { fail('no JK501 customer to test with'); }
  else {
    const key = parseCustomerKey(other.key)!
    const asOwner = await getKiaCustomerProfile(key, { dealerScope: ['JK501'] })
    const asOutsider = await getKiaCustomerProfile(key, { dealerScope: ['JK402'] })
    console.log(`   ${other.key}: own branch -> ${asOwner ? 'visible' : 'null'}, other branch -> ${asOutsider ? 'VISIBLE' : 'null'}`)
    check(Boolean(asOwner), 'their own branch can open the profile')
    check(!asOutsider, 'the other branch gets nothing, even with the exact key')
  }

  console.log('\n5) A stale pin matching no real branch returns nothing, not everything')
  const bogus = await listKiaCustomers({ dealerScope: ['__no_dealer__'], pageSize: 5 })
  check(bogus.totalCustomers === 0, `an unmatchable pin yields 0, not ${all.totalCustomers} (fails closed)`)

  console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===\n' : `\n=== ${failures} FAILURE(S) ===\n`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
