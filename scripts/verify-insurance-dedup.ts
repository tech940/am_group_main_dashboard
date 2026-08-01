/**
 * verify:insurance-dedup — proves the Insurance section counts each policy ONCE.
 *
 *   npm run verify:insurance-dedup
 *
 * Read-only. Runs the REAL `insuranceSource()` expression from lib/insurance/brands.ts against the
 * live tables, so a change to that helper is checked against real data rather than restated.
 *
 * ⚠️ WHAT IS AND IS NOT A DUPLICATE HERE — the distinction this whole check exists to protect:
 *  - The Hyundai and Platinum feeds APPEND a new row each time a policy is re-uploaded instead of
 *    updating it, so one policy accumulates snapshot VERSIONS that differ only in payment progress
 *    (payment_generated, payinslip_no, cheque_no, cheque_amt, column_64vb_status). Those inflate
 *    policy counts and premium sums, and are what `insuranceSource()` collapses.
 *  - A vehicle carrying several policies is NOT a duplicate. Each year a car takes an own-damage
 *    policy AND a fixed-premium third-party companion, so a 4-year-old car legitimately shows ~7
 *    rows. 7,144 Hyundai chassis repeat for this reason. Collapsing by chassis would delete real
 *    policies and understate premium — asserted below so nobody "optimises" it later.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { INSURANCE_BRANDS, insuranceSource, type InsuranceBrandId } from '../lib/insurance/brands'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, prepare: false, ssl: { rejectUnauthorized: false }, onnotice: () => {} })
  try {
    for (const id of Object.keys(INSURANCE_BRANDS) as InsuranceBrandId[]) {
      const brand = INSURANCE_BRANDS[id]
      console.log(`\n${brand.label}  (${brand.table})`)

      const [raw] = await sql.unsafe(`SELECT COUNT(*)::int n FROM ${brand.table}`) as unknown as { n: number }[]
      const [dedup] = await sql.unsafe(`SELECT COUNT(*)::int n FROM ${insuranceSource(brand)}`) as unknown as { n: number }[]
      console.log(`   raw rows ${String(raw.n).padStart(7)}   through insuranceSource() ${String(dedup.n).padStart(7)}   collapsed ${raw.n - dedup.n}`)

      ok('the source expression is valid SQL and returns rows', dedup.n > 0)
      ok('dedup never INVENTS rows', dedup.n <= raw.n)

      if (!brand.versionedByPolicyNo) {
        ok('brand is not policy-versioned, so nothing is collapsed', dedup.n === raw.n)
        continue
      }

      // Every surviving policy number must now be unique.
      const [dupes] = await sql.unsafe(`
        SELECT COALESCE(SUM(n) - COUNT(*), 0)::int AS extra FROM (
          SELECT policy_no, COUNT(*)::int n FROM ${insuranceSource(brand)}
          WHERE NULLIF(TRIM(policy_no), '') IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
        ) x`) as unknown as { extra: number }[]
      ok('no policy number survives more than once', dupes.extra === 0, `${dupes.extra} surplus`)

      // The row kept must be the NEWEST version, not an arbitrary one.
      const [stale] = await sql.unsafe(`
        SELECT COUNT(*)::int n FROM ${insuranceSource(brand, 'kept')}
        JOIN ${brand.table} other
          ON COALESCE(NULLIF(TRIM(other.policy_no), ''), 'row:' || other.id::text)
           = COALESCE(NULLIF(TRIM(kept.policy_no), ''), 'row:' || kept.id::text)
         AND other.uploaded_at > kept.uploaded_at`) as unknown as { n: number }[]
      ok('the row kept is the LATEST upload of that policy', stale.n === 0, `${stale.n} stale winners`)

      // Rows with no policy number must all survive — they cannot be version-matched.
      const [blank] = await sql.unsafe(`SELECT COUNT(*)::int n FROM ${brand.table} WHERE NULLIF(TRIM(policy_no), '') IS NULL`) as unknown as { n: number }[]
      const [blankKept] = await sql.unsafe(`SELECT COUNT(*)::int n FROM ${insuranceSource(brand)} WHERE NULLIF(TRIM(policy_no), '') IS NULL`) as unknown as { n: number }[]
      ok('policies with no policy number are all retained', blank.n === blankKept.n, `${blankKept.n}/${blank.n}`)

      // The renewal structure must be untouched: multi-policy vehicles are real.
      const [chassis] = await sql.unsafe(`
        SELECT COUNT(*)::int n FROM (
          SELECT chassis_no FROM ${insuranceSource(brand)}
          WHERE NULLIF(TRIM(chassis_no), '') IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
        ) x`) as unknown as { n: number }[]
      ok('vehicles still hold multiple policies (OD + TP + renewals kept)', chassis.n > 0,
        `${chassis.n} chassis with >1 policy — must NOT be collapsed`)
    }

    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed\n`)
    process.exit(fail === 0 ? 0 : 1)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('\nVERIFY FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
