/**
 * verify:approval-history — the approval history entry says which stage acted, and the screen reads
 * that stage, not a display label.
 *
 * ⚠️ THE BUG THIS EXISTS FOR. `KIA_0203` showed "MD APPROVAL — Mohan Sharma, 06:04 pm". Mohan
 * Sharma is the CEO, and 06:04 pm is two minutes BEFORE the 06:06 pm EA step that precedes MD in
 * the chain, so the workflow strip was displaying a chain that ran backwards in time.
 *
 * Two independent defects, both required:
 *
 *   1. WRITE. `[id]/action/route.ts` built its history label from a chain of ternaries with no
 *      'ceo' branch, so a CEO action fell through to the trailing `: 'MD'` and was stored as
 *      `{ role: 'MD', roleKey: 'ceo' }`. The same map was hand-written in FOUR places and only this
 *      copy was wrong — the same "only one of the two routes was updated" failure that has already
 *      cost this module a decision-email outage.
 *
 *   2. READ. The strip matched a stage to its entry with `h.role.toLowerCase().includes(key)`.
 *      A substring test against a free-text display label: 'md' is inside 'management', and the
 *      mislabelled CEO entry sits earlier in the array than the real MD entry, so `.find()`
 *      returned the CEO for the MD step.
 *
 * Either fix alone leaves the other loaded. Both are asserted here.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import {
  VENDOR_PAYMENT_ACTIONABLE_STAGES,
  approvalStageHistoryLabel,
} from '../lib/md-approvals/vendor-payments-stage'

const ROOT = join(__dirname, '..')
let pass = 0
let fail = 0

function ok(name: string, condition: boolean, detail = '') {
  if (condition) {
    pass++
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/* ------------------------------------------------------------------ 1. the label itself */

console.log('\n1. approvalStageHistoryLabel — one definition, every stage named')

ok("'ceo' is labelled CEO, not MD", approvalStageHistoryLabel('ceo', {}) === 'CEO',
  `got "${approvalStageHistoryLabel('ceo', {})}"`)
ok("'md' is labelled MD", approvalStageHistoryLabel('md', {}) === 'MD')
ok("'ea' is labelled EA", approvalStageHistoryLabel('ea', {}) === 'EA')
ok("'hr' is labelled HR", approvalStageHistoryLabel('hr', {}) === 'HR')
ok("'accounts' and 'payment_done' stay distinguishable",
  approvalStageHistoryLabel('accounts', {}) !== approvalStageHistoryLabel('payment_done', {}),
  `${approvalStageHistoryLabel('accounts', {})} vs ${approvalStageHistoryLabel('payment_done', {})}`)

/*
 * No actionable stage may fall through to the `default: stage.toUpperCase()` arm.
 *
 * ⚠️ Testing that with `label !== stage.toUpperCase()` does NOT work, and my first version of this
 * file failed four true assertions on exactly that: 'ceo'.toUpperCase() is already 'CEO', so a
 * correct label is indistinguishable from the fallthrough. The only test that means anything is an
 * explicit expectation written out by hand, which is why the table below is spelled out rather than
 * derived from the function under test.
 */
const EXPECTED_LABEL: Record<(typeof VENDOR_PAYMENT_ACTIONABLE_STAGES)[number], string> = {
  sales_manager: 'GSM', // for brand kia + department SALES; brand-dependent, see firstStageShortLabel
  ceo: 'CEO',
  hr: 'HR',
  ea: 'EA',
  md: 'MD',
  accounts: 'Accounts (Invoice)',
  payment_done: 'Accounts (Payment)',
}
for (const stage of VENDOR_PAYMENT_ACTIONABLE_STAGES) {
  const label = approvalStageHistoryLabel(stage, { brand: 'kia', department: 'SALES' })
  ok(`'${stage}' is labelled '${EXPECTED_LABEL[stage]}'`, label === EXPECTED_LABEL[stage], `"${label}"`)
}

// And the fallthrough still has to behave for a stage nobody has taught it about.
ok('an unknown stage falls back rather than throwing',
  approvalStageHistoryLabel('some_future_stage', {}) === 'SOME_FUTURE_STAGE')

// Every stage must produce a label DISTINCT from every other stage's, or the reader's legacy
// fallback cannot tell them apart and two stages collapse onto one actor.
const labels = VENDOR_PAYMENT_ACTIONABLE_STAGES.map((s) =>
  approvalStageHistoryLabel(s, { brand: 'kia', department: 'SALES' }))
ok('no two stages share a label', new Set(labels).size === labels.length, labels.join(', '))

/* ------------------------------------------------------------------ 2. the write paths */

console.log('\n2. Write paths — no route keeps its own copy of the map')

const WRITE_ROUTES = [
  'app/api/brands/kia/approvals/[id]/action/route.ts',
  'app/api/brands/kia/approvals/bulk-action/route.ts',
]

for (const rel of WRITE_ROUTES) {
  const src = read(rel)
  ok(`${rel} imports the shared label`, src.includes('approvalStageHistoryLabel'))
  // The signature of the old hand-written copy: a ternary chain ending in a bare 'MD' default.
  const handRolled = /roleLabel\s*=\s*[\s\S]{0,600}?\?\s*['"]/.test(src)
  ok(`${rel} has no hand-written roleLabel ternary chain`, !handRolled)
  ok(`${rel} still stamps roleKey on every entry`, src.includes('roleKey:'))
}

/* ------------------------------------------------------------------ 3. the read path */

console.log('\n3. Read path — stages are matched by roleKey, never by label substring')

const PAGE = 'features/kia/kia-approvals-page.tsx'
const page = read(PAGE)

ok('the workflow strip resolves entries through findStageEntry', page.includes('findStageEntry('))

// The exact shape that caused the misattribution.
const substringMatch = page.match(/h\.role\?\.toLowerCase\(\)\?\.includes\(/g) ?? []
ok('no `h.role?.toLowerCase()?.includes(...)` stage matching remains',
  substringMatch.length === 0, `${substringMatch.length} occurrence(s)`)

const roleKeyOrLabel = page.match(/h\.roleKey === key \|\| h\.role/g) ?? []
ok('no `roleKey === key || role.includes(key)` fallback remains', roleKeyOrLabel.length === 0)

// The legacy label fallback must refuse any entry that already carries a roleKey — an entry with a
// stage of its own must never be borrowed by a different stage.
ok('legacy label fallback skips entries that carry a roleKey',
  /!h\?\.roleKey && legacy\(/.test(page))

/* ------------------------------------------------------------------ 3b. separation of duties */

console.log('\n3b. The MD stage is the MD\'s own desk — no CEO seniority bypass')

/*
 * ⚠️ THE RULE. A CEO holds the `ceo` stage and nothing further down the chain. He was reaching the
 * md stage through `isSuperUser = ['ceo','md']` and signing requests the MD never saw (KIA_0203,
 * KIA_0201 — ~20s after the EA cleared them), which also back-stamped his own ceo signature.
 *
 * ⚠️ SERVER AND CLIENT BOTH, and on the client BOTH the authorisation helper AND the button gate.
 * The previous separation-of-duties fix in this module found 4 sites where there were 9: the row
 * buttons are gated by `getIsPendingForUser`, which never consults the authorisation helper, so the
 * Approve button still rendered and merely 403'd. A rendered button the server refuses is a defect.
 */
for (const [rel, marker] of [
  ['app/api/brands/kia/approvals/[id]/action/route.ts', "stage === 'md'"],
  ['app/api/brands/kia/approvals/bulk-action/route.ts', "activeStageKey === 'md'"],
] as const) {
  const src = read(rel)
  const idx = src.indexOf(marker)
  ok(`${rel} has an md branch`, idx !== -1)
  const branch = src.slice(idx, idx + 1400)
  const grant = branch.match(/isAuthorized\s*=\s*([^\r\n]+)/)
  ok(`${rel} md stage does NOT grant isSuperUser`,
    Boolean(grant) && !/isSuperUser/.test(grant![1]), grant ? grant[1].trim() : 'no grant found')
  ok(`${rel} md stage grants isMd`, Boolean(grant) && /isMd/.test(grant![1]))
  ok(`${rel} md stage keeps developer/admin (isTester)`, Boolean(grant) && /isTester/.test(grant![1]))
  // The other stages must be untouched — a CEO still belongs on ceo/hr/ea/sales_manager.
  ok(`${rel} still defines isSuperUser for the other stages`,
    /const isSuperUser = \['ceo', 'md'\]/.test(src))
}

{
  const src = read(PAGE)
  ok('client isUserAuthorizedForStage: md stage is md-only',
    /if \(stage === 'md'\) return effectiveRole === 'md' \|\| currentUser\.role === 'md'/.test(src))
  // The button gate — the class of site missed last time.
  const gate = src.match(/pendingLabel === 'Pending MD'[\s\S]{0,400}?\n\s*\}/)
  ok('client getIsPendingForUser: the Pending MD branch exists', Boolean(gate))
  ok("client getIsPendingForUser: Pending MD does not admit 'ceo'",
    Boolean(gate) && !/'ceo'/.test(gate![0]), gate ? gate[0].replace(/\s+/g, ' ').slice(0, 160) : '')
  ok("client getIsPendingForUser: Pending MD still admits developer/admin",
    Boolean(gate) && /'developer', 'admin'/.test(gate![0]))
}

ok("migrate-ea-to-md no longer admits 'ceo' (it manufactures MD approvals in bulk)",
  /const allowedRoles = \['md', 'developer', 'admin'\]/.test(
    read('app/api/brands/kia/approvals/migrate-ea-to-md/route.ts')))

// A stage whose column is blank must render as Pending with NO name, or an undone approval still
// shows its old approver — which is what "I can still see CEO approval instead of MD" looked like.
ok('the workflow strip renders no actor for a stage whose column is blank',
  /if \(!columnValue\) return \{ date: null, time: null, user: null \}/.test(read(PAGE)))

/* ------------------------------------------------------------------ 4. live data */

async function live() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('\n4. Live data — SKIPPED (no DATABASE_URL)')
    return
  }
  console.log('\n4. Live data — stored labels agree with stored stage keys')
  const sql = postgres(url, { prepare: false, max: 2 })
  try {
    // Stages whose name is fixed. 'sales_manager' is excluded on purpose: its label is brand- and
    // department-dependent (ED / GSM / VP / DGM) and historical rows legitimately carry all four.
    const FIXED: Record<string, string> = {
      ceo: 'CEO',
      hr: 'HR',
      ea: 'EA',
      md: 'MD',
      accounts: 'Accounts (Invoice)',
    }

    for (const [key, expected] of Object.entries(FIXED)) {
      const rows = await sql<any[]>`
        SELECT r.request_no, h->>'role' AS label
        FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
        WHERE jsonb_typeof(r.history) = 'array'
          AND h->>'roleKey' = ${key}
          AND h->>'role' IS DISTINCT FROM ${expected}
        LIMIT 5`
      ok(`every roleKey='${key}' entry is labelled '${expected}'`, rows.length === 0,
        rows.length ? rows.map((r) => `${r.request_no}="${r.label}"`).join(', ') : 'clean')
    }

    // Double-encoding: a `role` that reads as "\"CEO\"" is the JSON.stringify(x)::jsonb trap.
    const [{ dbl }] = await sql<any[]>`
      SELECT COUNT(*)::int AS dbl
      FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
      WHERE jsonb_typeof(r.history) = 'array' AND h->>'role' LIKE '"%"'`
    ok('no double-encoded role values', dbl === 0, `${dbl} found`)

    // The rendered outcome: for every request the MD desk has approved, the entry the strip picks
    // must be the one the MD stage actually wrote.
    const crossed = await sql<any[]>`
      SELECT r.request_no,
             (SELECT h->>'user' FROM jsonb_array_elements(r.history) h
               WHERE h->>'roleKey' = 'md' AND h->>'action' IN ('APPROVED','APPROVE') LIMIT 1) AS md_actor,
             (SELECT h->>'user' FROM jsonb_array_elements(r.history) h
               WHERE lower(h->>'role') LIKE '%md%' AND h->>'roleKey' IS DISTINCT FROM 'md'
                 AND h->>'action' IN ('APPROVED','APPROVE') LIMIT 1) AS impostor
      FROM kia_approval_requests r
      WHERE jsonb_typeof(r.history) = 'array' AND r.management_approval = 'APPROVED'`
    const bad = crossed.filter((c) => c.impostor)
    ok('no non-MD entry is labelled so it could be read as the MD', bad.length === 0,
      bad.length ? bad.slice(0, 5).map((b) => b.request_no).join(', ') : `${crossed.length} MD-approved requests checked`)

    /*
     * ⚠️ THE ONE THAT MATTERS. No request may STAND as MD-approved on a CEO's signature.
     *
     * Note what this checks and what it does not: it keys on the CURRENT value of
     * management_approval, not on the presence of a history entry. The two rows this was found on
     * still carry the CEO's md entry — audit history is append-only and reverting an approval must
     * not erase the evidence that it happened — but their column is back to '' and they sit in the
     * MD's queue. A history entry is a record; the column is the state.
     */
    /*
     * ⚠️ THE **LATEST** md-stage approval, not any of them.
     *
     * My first version matched ANY md entry whose actor is a CEO — and history is APPEND-ONLY, so a
     * request the CEO signed, that was then reverted and properly re-approved by a real MD, still
     * carried the old entry and failed this check for ever. It fired on KIA_0201 and KIA_0203 after
     * MD Sanjay Mahajan approved both legitimately and Accounts paid them: the app was right and the
     * assertion was wrong. Same first-vs-last trap as findStageEntry.
     *
     * What matters is whose signature the CURRENT approval rests on — the most recent one.
     */
    const standing = await sql<any[]>`
      WITH latest_md AS (
        SELECT r.request_no,
               (SELECT h->>'user'
                  FROM jsonb_array_elements(r.history) h
                 WHERE h->>'roleKey' = 'md' AND h->>'action' IN ('APPROVED','APPROVE')
                 ORDER BY h->>'timestamp' DESC
                 LIMIT 1) AS actor
        FROM kia_approval_requests r
        WHERE jsonb_typeof(r.history) = 'array' AND r.management_approval = 'APPROVED'
      )
      SELECT l.request_no, l.actor
      FROM latest_md l
      JOIN users u ON lower(btrim(u.full_name)) = lower(btrim(l.actor))
      WHERE u.role::text = 'ceo'
      ORDER BY l.request_no DESC`
    ok('no request STANDS as MD-approved on a CEO signature', standing.length === 0,
      standing.length
        ? `${standing.length}: ${standing.map((s) => `${s.request_no} (${s.actor})`).join(', ')} — run scripts/revert-ceo-md-approvals.ts`
        : 'clean')

    // Historical record: reverted rows keep the CEO's entry plus a system_correction explaining it.
    const [{ reverted }] = await sql<any[]>`
      SELECT COUNT(DISTINCT r.id)::int AS reverted
      FROM kia_approval_requests r, jsonb_array_elements(r.history) AS h
      WHERE jsonb_typeof(r.history) = 'array' AND h->>'action' = 'REVERTED'`
    console.log(`  NOTE  ${reverted} request(s) carry a REVERTED entry — an MD stage returned to the queue.`)
  } finally {
    await sql.end()
  }
}

live()
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail === 0 ? 0 : 1)
  })
  .catch((e) => {
    console.error('verifier crashed:', e)
    process.exit(1)
  })
