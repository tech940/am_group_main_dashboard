/**
 * Add a bank / branch to the KIA financier lookup.
 *
 * ⚠️ DRY RUN BY DEFAULT. Pass --apply to write.
 *
 * ── Where the list actually lives ─────────────────────────────────────────────────────────────
 * There is no bank table. The financier list is stored as marker rows inside `kia_price_details`
 * under `model = '__BANK_OPTION__'` — 329 of them, imported from the PRICE DETAILS sheet — with
 * every price column zeroed. `/api/brands/kia/proforma/options` reads the WHOLE table and keeps any
 * row carrying both a bank name and a branch, which is why a priceless marker row works.
 *
 * ⚠️ The comment in that route calls the marker `__BANK_BRANCH__`. Nothing in the database uses
 * that string; the real one is `__BANK_OPTION__`. Trust the data.
 *
 * ── One row, both screens ─────────────────────────────────────────────────────────────────────
 * The booking form (kia-bookings-client.tsx) and the proforma (kia-proforma-page.tsx) both read
 * `/api/brands/kia/proforma/options`, so a single row appears in both. There is nothing else to
 * update — no enum, no hardcoded list.
 *
 * ⚠️ That endpoint is cached in Redis for 30 MINUTES under `kia:proforma:options:data`. Insert
 * without invalidating and the bank is simply absent for half an hour, which reads exactly like a
 * failed write. This script always invalidates after a successful insert.
 *
 * ── Names are normalised on read, not on write ────────────────────────────────────────────────
 * The route passes every name through `normalizeBankName`, so 'INDIAN BANK', 'Indian Bank' and
 * 'indian bank' all reach the UI as 'Indian Bank'. The branch string is NOT normalised — it is
 * shown verbatim, so type it the way it should appear.
 *
 * Run:  npx tsx --tsconfig ./tsconfig.verify.json scripts/kia-add-bank-branch.ts "<BANK>" "<BRANCH>"
 *       ... --apply
 */
import 'dotenv/config'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../lib/db'
import { kiaPriceDetails } from '../lib/db/schema'
import { normalizeBankName } from '../lib/kia/bank-utils'
import { invalidateCache } from '../lib/redis/cache-utils'

const APPLY = process.argv.includes('--apply')
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))

const BANK = String(args[0] || '').trim()
const BRANCH = String(args[1] || '').trim()

const rowsOf = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows || []))

async function main() {
  if (!BANK || !BRANCH) {
    console.error('usage: kia-add-bank-branch.ts "<BANK NAME>" "<BRANCH>" [--apply]')
    process.exit(1)
  }

  const display = normalizeBankName(BANK)
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — KIA financier lookup\n`)
  console.log(`  bank   : "${BANK}"  ->  renders as "${display}"`)
  console.log(`  branch : "${BRANCH}"  (shown verbatim)\n`)

  // Case-insensitive on both halves: the sheet import is inconsistent about case, and a duplicate
  // that differs only in case would show up twice in the dropdown.
  const existing = rowsOf<{ id: string; bank_name: string; bank_branch: string; model: string }>(
    await db.execute(sql`
      SELECT id::text, bank_name, bank_branch, model FROM kia_price_details
      WHERE UPPER(BTRIM(COALESCE(bank_name, ''))) = ${BANK.toUpperCase()}
        AND UPPER(BTRIM(COALESCE(bank_branch, ''))) = ${BRANCH.toUpperCase()}`))

  if (existing.length) {
    console.log(`already present (${existing.length} row):`)
    for (const e of existing) console.log(`   ${e.model} | ${e.bank_name} | ${e.bank_branch}`)
    console.log('\nNothing to add. Re-run with --apply to refresh the cache anyway.')
    if (!APPLY) process.exit(0)
    await invalidateCache('kia:proforma:options:data')
    console.log('Cache invalidated.')
    process.exit(0)
  }

  // Sibling branches of the same bank, so a typo in the bank name is obvious before writing.
  const siblings = rowsOf<{ bank_name: string; bank_branch: string }>(await db.execute(sql`
    SELECT bank_name, bank_branch FROM kia_price_details
    WHERE UPPER(BTRIM(COALESCE(bank_name, ''))) = ${BANK.toUpperCase()}
    ORDER BY bank_branch`))
  console.log(siblings.length
    ? `existing branches for this bank (${siblings.length}):\n${siblings.map((s) => `   ${s.bank_branch}`).join('\n')}\n`
    : 'this bank has no branches yet — it will be a NEW entry in the financier dropdown\n')

  if (!APPLY) {
    console.log('Nothing was written. Re-run with --apply.')
    process.exit(0)
  }

  await db.insert(kiaPriceDetails).values({
    model: '__BANK_OPTION__',
    // Matches the imported rows, which concatenate the two ("BOB BOB GANDHI NAGAR").
    trimDescription: `${BANK} ${BRANCH}`,
    hyp: BANK,
    bankName: BANK,
    bankBranch: BRANCH,
    metadata: { lookupType: 'bank_branch', sourceSheet: 'manual', addedAt: new Date().toISOString() },
  })

  await invalidateCache('kia:proforma:options:data')

  const [check] = rowsOf<{ n: number }>(await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM kia_price_details
    WHERE model = '__BANK_OPTION__' AND bank_name = ${BANK} AND bank_branch = ${BRANCH}`))
  console.log(`written: ${check.n} row. Cache invalidated — it is live on the booking form and the proforma.`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
