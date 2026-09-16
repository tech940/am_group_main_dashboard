/**
 * Proves the KIA Sales Target Plan counts what it claims to count.
 *
 * Every check exists because the thing it checks was wrong in the code this replaced, or in the
 * 36-sheet workbook it replaces:
 *   - Sales Performance read `dealer_code` first, so after the 2026-07-22 feed change it credited
 *     every Udhampur booking and delivery to Jammu and showed Udhampur as empty;
 *   - `kia_enquiry_report` re-exports the whole book on every upload — 56,925 rows are 10,328
 *     enquiries — so COUNT(*) counted uploads and inflated September 9.6×;
 *   - the workbook's own TOTAL row is #REF! from column AA onward, and its test-drive percentage
 *     totals to 286% because it sums percentages.
 *
 * Run:  npm run verify:kia-target-plan
 *
 * Sections 1-3 read source and exercise pure functions. Section 4 is READ-ONLY against the live feed.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

let passes = 0
let failures = 0

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { passes += 1; console.log(`  [PASS] ${label}`) }
  else { failures += 1; console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`) }
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** Assertions must read CODE, not the comments that explain it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

console.log('\n1) The outlet is resolved the same way everywhere:')
{
  const plan = stripComments(read('lib/kia/sales-target-plan.ts'))
  const perf = stripComments(read('lib/kia/sales-performance.ts'))

  /*
   * ⚠️ `dealer_code_2` BEFORE `dealer_code`. `dealer_code` is never empty, so a COALESCE that reads
   * it first never reaches the real outlet. Order is the whole fix.
   */
  for (const [name, src] of [['the plan reader', plan], ['sales performance', perf]] as const) {
    const idx2 = src.indexOf('dealer_code_2')
    // The plan reader builds the expression with an alias prefix (`${p}dealer_code`), so the bare
    // spelling is not what is in the file — match either.
    const m = /NULLIF\(BTRIM\((?:\$\{p\})?dealer_code\)/.exec(src)
    assert(`${name} reads dealer_code_2 before dealer_code`,
      idx2 > 0 && m !== null && m.index > idx2, `dealer_code_2@${idx2} dealer_code@${m?.index ?? -1}`)
  }
  assert('sales performance no longer filters on the bare dealer_code',
    !/UPPER\(TRIM\(dealer_code\)\)/.test(perf))

  /*
   * ⚠️ NO main_dealer_code IN THE COALESCE. It is unreachable, and it does not exist under that name
   * on kia_booking_report (which has `main_dealer`) — naming it 42703s the whole query.
   */
  assert('the plan reader does not name a third dealer column', !/main_dealer/.test(plan))
}

console.log('\n2) One enquiry is one enquiry:')
{
  const plan = stripComments(read('lib/kia/sales-target-plan.ts'))

  /*
   * ⚠️ THE KEY IS (OUTLET, ENQUIRY NUMBER). KIA's DMS issues enquiry numbers PER DEALER — 1,821 are
   * in use at BOTH outlets as different customers. Partitioning on the number alone collapsed those
   * pairs and dropped the loser: September Jammu read 229 enquiries against a true 255.
   */
  assert('a canonical row is picked per OUTLET + enquiry_no before anything is counted',
    /PARTITION BY \$\{outletE\}, UPPER\(BTRIM\(c\.enquiry_no\)\)/.test(plan))
  assert('the canonical pick breaks ties on the newest upload',
    /ORDER BY c\.uploaded_at DESC, c\.id DESC/.test(plan))
  assert('it counts the canonical rows only', /WHERE rn = 1/.test(plan))
  // COUNT(DISTINCT …) fixes a total and breaks every breakdown — duplicates that disagree about
  // consultant count once in each group.
  assert('it never reaches for COUNT(DISTINCT) instead', !/COUNT\(DISTINCT/.test(plan))

  /*
   * ⚠️ The date filter must sit OUTSIDE the window. Duplicates can disagree about enquiry_date, and
   * filtering inside would let a stale copy win the ROW_NUMBER and move an enquiry between months.
   */
  const cte = plan.slice(plan.indexOf('WITH canon AS'), plan.indexOf('BTRIM(consultant_name) AS name'))
  assert('the canonical window is not narrowed by the month being asked for',
    !/enquiry_date\s*>=/.test(cte), 'a date filter inside the window can pick a stale duplicate')

  /*
   * ⚠️ Bookings and retails come from the booking and sales feeds, NOT from this table's own
   * booking_date/retail_date columns — those keep their date on a cancelled booking, and a planning
   * screen that disagrees with Sales Report is a screen nobody trusts twice.
   */
  assert('bookings come from the booking feed', /FROM kia_booking_report/.test(plan))
  assert('cancelled bookings are excluded',
    /NOT IN \('BOOKING CANCEL', 'INVOICE CANCEL'\)/.test(plan))
  assert('retails are delivery_date, never invoice_date',
    /c\.delivery_date >= /.test(plan) && !/invoice_date/.test(plan))
  // KIA reuses invoice numbers — 16 numbers across 32 VINs — so an invoice-keyed dedupe drops retails.
  assert('retails dedupe on VIN first', /DISTINCT ON \(COALESCE\(NULLIF\(UPPER\(BTRIM\(c\.vin_number\)\)/.test(plan))
}

console.log('\n3) The screen cannot lie about pace or freshness:')
{
  const plan = stripComments(read('lib/kia/sales-target-plan.ts'))
  const page = stripComments(read('features/kia/sales-target-plan-page.tsx'))

  /*
   * ⚠️ THREE STATES, NOT TWO. "Committed to zero" (a decision — no stock today) and "nobody has
   * committed" both carry a 0, and must not share a colour: only the first can be behind.
   */
  assert('nothing committed yields null, never a zero achievement',
    /if \(!hasCommitment\) \{[\s\S]{0,160}achievement: null, gap: null/.test(plan))
  /* A month commitment is also "having a plan", so the test is the derived flag, not the day count. */
  assert('committing zero — for a day or for the month — still counts as having a plan',
    /const committed = dayDays > 0 \|\| Boolean\(monthly\)/.test(plan) && /hasAnyTarget: committed/.test(plan))
  assert('a day with no row is distinguishable from a day committed as zero',
    /hasCommitment: c !== undefined/.test(plan))
  assert('the screen treats a null gap as "no target", not as behind',
    /if \(gap === null\) return INK\.none/.test(page))

  /*
   * ⚠️ "BEHIND" IS MEASURED AGAINST WHAT WAS COMMITTED FOR THE DAYS THAT HAVE HAPPENED — a number
   * somebody wrote down — not against a straight-line share of a monthly figure. That is the point of
   * daily commitments, and it is what lets Sundays need no special case: nobody commits to one.
   */
  assert('the gap is actual minus committed-to-date, not a straight-line pace estimate',
    /gap: Math\.round\(\(actual - committedToDate\) \* 10\) \/ 10/.test(plan))
  assert('only days that have happened enter the baseline', /if \(dayNo <= daysElapsed\)/.test(plan))

  // ⚠️ The feed is uploaded once a morning. A figure without its age invites a decision it cannot support.
  assert('the payload carries the feed\'s as-of time', /MAX\(uploaded_at\) AS as_of/.test(plan))
  assert('the screen renders it', /DMS feed as of/.test(page))

  // The cache key must move when the shape does, or a change looks like it did not happen.
  assert('the cache key is versioned', /kia:sales-target-plan:v\d+[\w-]*:/.test(plan))

  // ⚠️ globals.css retints emerald/amber/rose with !important, so utility classes do not render
  // the colour they name. State colours must be inline hex.
  assert('state colours are inline hex, not retinted utilities',
    /const INK = \{/.test(page) && !/text-(emerald|rose|amber)-\d00/.test(page))

  // ⚠️ A full-height Sunday band is read as a bar — it towered over every real value.
  assert('Sundays are marked on the axis, not as a full-height band',
    !/height=\{innerH\} fill="#f1f5f9"/.test(page))

  // Two scales in one chart are fine; an unlabelled second scale is not.
  assert('both chart scales are labelled', /Left scale: running total/.test(page))
}

console.log('\n3b) One person is one row, and team leaders are people:')
{
  const plan = stripComments(read('lib/kia/sales-target-plan.ts'))
  const page = stripComments(read('features/kia/sales-target-plan-page.tsx'))

  /*
   * ⚠️ THE DMS SPELLS ONE PERSON SEVERAL WAYS. EJK4020138 files as both "NEERAJ" and "NEERAJS",
   * EJK4020022 as both "AKASH BHAT" and "AKASH BHATS". Keyed on the name, one person becomes two rows
   * — September showed NEERAJS with 31 enquiries and NEERAJ with 0 beside it, and neither number was
   * that person's month. `kec_employee_id` is the identity; measured, NO name maps to more than one
   * id, so collapsing onto it can never merge two real people.
   */
  assert('consultants are keyed on the employee id, not the spelling',
    /const idOf = new Map<string, string>\(\)/.test(plan) && /idOf\.get\(nk\) \|\| nk/.test(plan))
  // ⚠️ Only kia_enquiry_report carries the id, so it doubles as the alias map for the other two feeds.
  assert('the identity map is read from the one feed that has the id',
    /BTRIM\(c\.kec_employee_id\) AS employee_id/.test(plan))
  assert('every metric resolves through it', (plan.match(/resolve\(/g) || []).length >= 4)

  /*
   * ⚠️ THE DISPLAY NAME IS THE MOST-USED SPELLING, NOT THE NEWEST. Most-recent elevates a typo:
   * EJK4020022 filed 626 as "AKASH BHAT" then 30 as "AKASH BHATS", so the newest spelling put
   * "AKASH BHATS" beside a team headed "AKASH BHAT" — one person looking like two.
   */
  assert('the display name is the spelling used most', /rows > current\.rows/.test(plan))
  assert('a typed team-leader name overrides the feed spelling', /display\.set\(key, leader\)/.test(plan))

  /*
   * ⚠️ TEAM LEADERS GET THEIR OWN ROW. Three of Jammu's four have never filed an enquiry — nothing in
   * the feeds would put them on screen — while Akash Bhat sold 626 before moving up. Their achieved
   * numbers are read from the feeds like anyone else's, and nil is the honest answer for a leader who
   * does not sell.
   */
  assert('every named team leader becomes a row',
    /for \(const leader of new Set\(\[\.\.\.teamOf\.values\(\)\]/.test(plan))
  assert('a leader is counted inside their own team',
    /if \(!teamOf\.has\(key\)\) teamOf\.set\(key, leader\)/.test(plan))
  assert('the payload says who leads', /isTeamLeader: leaderKeys\.has\(key\)/.test(plan))
  assert('the screen marks them', /row\.isTeamLeader &&/.test(page))
}

console.log('\n4) The write path keeps every column, and the guards match the page:')
{
  const perf = stripComments(read('lib/kia/sales-performance.ts'))
  const daily = stripComments(read('lib/kia/commitments.ts'))
  const planRoute = stripComments(read('app/api/brands/kia/sales-performance/plan/route.ts'))
  const writeRoute = stripComments(read('app/api/brands/kia/sales-performance/targets/route.ts'))
  const page = stripComments(read('app/brands/kia/sales-performance/page.tsx'))
  const planPage = stripComments(read('features/kia/sales-target-plan-page.tsx'))

  /*
   * ⚠️ EVERY EDITABLE COLUMN IN THE onConflict SET. A SET that names a subset writes the row, reports
   * success, and silently drops the rest — the defect that hit MD Targets when labour was added, and
   * it presents to the user as "the form did not save".
   */
  const setBlock = daily.slice(daily.indexOf('onConflictDoUpdate'))
  for (const column of ['enquiries', 'test_drives', 'bookings', 'retails', 'note']) {
    assert(`the conflict update writes ${column}`, setBlock.includes(`excluded.${column}`))
  }
  // Whoever first committed a day keeps the credit for it.
  assert('the conflict update does not overwrite created_by', !setBlock.includes('excluded.created_by'))

  /*
   * ⚠️ THE ACHIEVEMENT SIDE IS NEVER WRITTEN. It is read from the DMS report feeds. The moment any of
   * these accepts an "achieved" number, the section starts disagreeing with Sales Report.
   */
  for (const [name, src] of [['the commitments module', daily], ['the write route', writeRoute], ['the screen', planPage]] as const) {
    assert(`${name} has no achieved/actual input`, !/achieved\s*[:=]/i.test(src))
  }

  // A commitment lands on the day it was made for; a JS Date here shifts it through UTC.
  assert('the commitment date is validated as YYYY-MM-DD, never coerced',
    daily.includes('const ISO_DATE =') && (daily.match(/ISO_DATE\.test\(/g) || []).length >= 3)

  // Clearing is its own action because a saved zero is a real commitment.
  assert('clearing a day is separate from committing zero',
    /export async function clearDailyCommitment/.test(daily) && /export async function DELETE/.test(writeRoute))

  // The month is derived, never stored twice.
  /*
   * ⚠️ STILL DERIVED. The month figure is now "the month commitment if one was made, else the sum of
   * the days" — but it is computed from the commitment rows every time and never read back from the
   * superseded monthly columns on kia_sales_targets.
   */
  assert('the month total is derived from the commitment rows, never a stored monthly column',
    /SUM\(\$\{kiaSalesCommitments\.bookings\}\) FILTER \(WHERE \$\{kiaSalesCommitments\.scope\} = 'day'\)/.test(daily)
    && !/kiaSalesTargets\.bookingTarget/.test(daily))
  assert('the superseded monthly writer is gone', !/export async function upsertKiaSalesTargets/.test(perf))
  assert('the team writer touches only team_leader',
    /set: \{ teamLeader: sql`excluded\.team_leader`/.test(daily))

  // Guard/API desync is this codebase's recurring defect class: the route and the page state the
  // same rule, in the same order.
  assert('the plan route gates on the same permission as the page',
    /kia\.sales_performance\.view/.test(planRoute) && /kia\.sales_performance\.view/.test(page))
  assert('the plan route checks brand scope too', /requireBrandApiAccess\('kia'\)/.test(planRoute))
  assert('the plan route never returns a raw driver message', !/details:/.test(planRoute))

  // The page was registered everywhere but the sidebar, which is why nobody could find it.
  const sidebar = read('components/layout/sidebar.tsx')
  assert('the section is in the KIA Sales submenu',
    /\{ name: 'Sales Target Plan', href: '\/brands\/kia\/sales-performance' \}/.test(sidebar))
  const nav = read('lib/navigation/sections.ts')
  assert('search and the guard both know the route',
    nav.includes("href: '/brands/kia/sales-performance'") && nav.includes("'/brands/kia/sales-performance',"))
}

console.log('\n4b) Nothing a person typed can be lost, and an empty save is not a success:')
{
  const page = stripComments(read('features/kia/sales-target-plan-page.tsx'))

  /*
   * ⚠️ THE COMMITMENTS FORM'S STATE LIVES IN THE PAGE, NOT IN THE TAB. The tab unmounts the instant
   * somebody clicks "This Month", so state held inside it was discarded without a word — type a
   * morning's commitments, glance at the plan, come back to empty boxes and a database that never
   * heard about any of it. This is the most likely reason the first real attempt to use the screen
   * saved nothing.
   */
  assert('the commitment date and drafts are owned by the page, not the tab',
    /const \[commitDate, setCommitDate\] = useState/.test(page)
    && /const \[commitDrafts, setCommitDrafts\] = useState/.test(page))
  assert('the tab receives them as props rather than declaring its own',
    /drafts: Record<string, Draft>/.test(page) && /setDrafts: React\.Dispatch/.test(page))

  /*
   * ⚠️ THE LOADER MUST NOT DEPEND ON `data.consultants`. That array is parsed fresh out of JSON on
   * every refetch, so its identity changes even when the people are identical — depending on it threw
   * away whatever was half-typed every time the plan refreshed.
   */
  /* ⚠️ Scope is a dependency now, or switching to the month form would show the day's numbers. */
  assert('the loader depends on the day, the outlet and the scope — and nothing unstable',
    /\}, \[date, outlet, scope\]\)/.test(page))
  assert('the roster is watched through a stable signature, not an array identity',
    /const rosterKey = useMemo\(/.test(page))

  /*
   * ⚠️ AN EMPTY SAVE IS NOT A SUCCESS. It used to POST zero entries, write nothing, and toast
   * "0 consultants saved" in the same green as a real save — a day that never reached the database
   * looked exactly like one that did.
   */
  assert('a save with nothing typed is refused and says so',
    /if \(pending\.length === 0\)/.test(page) && /Nothing to save yet/.test(page))
  assert('typed-but-unsaved rows are counted and shown',
    /const unsavedCount = /.test(page) && /not saved yet/.test(page))
  assert('typing marks a row unsaved and a successful save marks it saved',
    /present: true, saved: false/.test(page) && /\{ \.\.\.d, saved: true \}/.test(page))
}

console.log('\n4c) A commitment is made for a DAY or for a MONTH, and only one scores:')
{
  const commitments = stripComments(read('lib/kia/commitments.ts'))
  const plan = stripComments(read('lib/kia/sales-target-plan.ts'))
  const route = stripComments(read('app/api/brands/kia/sales-performance/targets/route.ts'))
  const page = stripComments(read('features/kia/sales-target-plan-page.tsx'))

  /*
   * ⚠️ TWO PROMISES, NOT ONE. A month commitment ("10 retails in September") and the day commitments
   * that deliver it are different statements and staff make both — the workbook carried a monthly
   * target column AND a day-wise sheet. They share one table, separated by `scope`.
   */
  assert('the scope is part of the row, and validated', /export type CommitmentScope = 'day' \| 'month'/.test(commitments)
    && /export function isCommitmentScope/.test(commitments))
  assert('the screen ASKS which one is being recorded rather than inferring it',
    /aria-label="Commitment scope"/.test(page) && /For the month/.test(page) && /For a day/.test(page))
  assert('the API carries the scope on read, write and clear',
    (route.match(/isCommitmentScope\(/g) || []).length >= 3)

  /*
   * ⚠️ A MONTH COMMITMENT IS ANCHORED TO THE 1st, and snapped there rather than refused. The database
   * rejects it anywhere else, and a 500 from a check constraint is a worse way to learn that than
   * simply putting it where it belongs — the caller asked for "September", not for "the 14th".
   */
  assert('a monthly commitment is snapped to the 1st of its month',
    /export function monthAnchor/.test(commitments)
    && /scope === 'month' \? monthAnchor\(input\.date\) : input\.date/.test(commitments))

  /*
   * ⚠️ SCOPE JOINS THE UNIQUE KEY. Without it a month commitment and a 1st-of-the-month day
   * commitment fight over one slot and the upsert overwrites one with the other.
   */
  const conflict = commitments.slice(commitments.indexOf('onConflictDoUpdate'))
  assert('the upsert conflicts on the scope too', /kiaSalesCommitments\.scope,/.test(conflict))
  assert('clearing is scoped, so removing a day cannot delete the month',
    /eq\(kiaSalesCommitments\.scope, scope\)/.test(commitments))

  /*
   * ⚠️ THE PRECEDENCE RULE LIVES IN ONE PLACE. A month figure is what somebody signed up to; the days
   * are a plan for reaching it and part-way through a month will always add to less, so scoring
   * against the day sum would quietly flatter anyone behind on their planning.
   */
  assert('a month commitment wins over the sum of days, in the reader',
    /basis: monthly \? 'month' : days \? 'days' : 'none'/.test(plan))
  assert('and in the monthly totals the cockpit reads',
    /FILTER \(WHERE \$\{kiaSalesCommitments\.scope\} = 'month'\)/.test(commitments))
  assert('a month commitment is never added into the day sum',
    /if \(c\.scope === 'month'\)/.test(plan) && /continue/.test(plan))

  /*
   * ⚠️ THE BASELINE FOR "BEHIND BY" IS DIFFERENT AGAIN: committed days when they exist (exact), else
   * a working-day pro-rata of the month figure (an estimate). A month figure alone cannot say what
   * today was supposed to look like.
   */
  assert('days are the baseline when they exist, the month pro-rata otherwise',
    /const td = dayDays > 0/.test(plan) && /monthly\.retails \* monthShare/.test(plan))
  assert('the payload says which basis was used', /commitmentBasis: t\.basis/.test(plan))
  assert('the screen tells the user the month overrides the day sum',
    /overrides the day-by-day sum/.test(page))
}

console.log('\n5) Live feed (read-only):')
async function liveChecks() {
  const url = process.env.DATABASE_URL
  if (!url) { console.log('  [SKIP] DATABASE_URL not set — static checks only.'); return }
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
  try {
    await sql.begin('read only', async (tx) => {
      // The three columns 0066 adds. Without them every read of this section 42703s.
      /* ⚠️ The old table name must be gone, or two readers disagree about where commitments live. */
      const [{ old_name, new_name }] = await tx<{ old_name: string | null; new_name: string | null }[]>`
        SELECT to_regclass('public.kia_sales_daily_commitments')::text AS old_name,
               to_regclass('public.kia_sales_commitments')::text AS new_name`
      assert('the commitments table is renamed and the old name is gone',
        new_name !== null && old_name === null, `old=${old_name} new=${new_name}`)

      const scopeCons = await tx<{ conname: string }[]>`
        SELECT conname FROM pg_constraint WHERE conrelid = 'public.kia_sales_commitments'::regclass`
      for (const needed of ['kia_sales_commitments_scope_check', 'kia_sales_commitments_month_anchor_check']) {
        assert(`${needed} is enforced by the database`, scopeCons.some((c) => c.conname === needed))
      }

      const uniq = await tx<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'kia_sales_commitments'
          AND indexname = 'kia_sales_commitments_unique_idx'`
      assert('the unique index includes the scope',
        uniq.length === 1 && /scope/.test(uniq[0].indexdef), uniq[0]?.indexdef ?? 'index missing')

      const cols = await tx<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kia_sales_targets'
          AND column_name IN ('enquiry_target', 'test_drive_target', 'team_leader')`
      assert('migration 0066 is applied', cols.length === 3, `${cols.length} of 3 columns`)

      // ⚠️ The public browser key held SELECT/INSERT/UPDATE/DELETE on the targets table.
      const anon = await tx<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'kia_sales_targets' AND grantee = 'anon'`
      assert('anon holds ZERO grants on kia_sales_targets', anon.length === 0,
        anon.map((a) => a.privilege_type).join(', '))

      /*
       * ⚠️ THE INFLATION IS REAL AND MUST STAY VISIBLE. If this ever reads 1.0, the feed has changed
       * shape and the dedupe may have become a no-op that nobody notices.
       */
      const [dupes] = await tx<{ rows: string; enquiries: string }[]>`
        SELECT COUNT(*)::text AS rows, COUNT(DISTINCT enquiry_no)::text AS enquiries FROM kia_enquiry_report`
      const ratio = Number(dupes.rows) / Math.max(1, Number(dupes.enquiries))
      assert('the enquiry feed really does re-export (dedupe is not decorative)', ratio > 1.5,
        `${dupes.rows} rows / ${dupes.enquiries} enquiries = ${ratio.toFixed(1)}×`)
      console.log(`  [INFO] ${dupes.rows} rows carry ${dupes.enquiries} enquiries (${ratio.toFixed(1)}× re-export)`)

      /*
       * ⚠️ THE NAME-VARIANT PROBLEM IS REAL AND MUST STAY VISIBLE. If this reads zero, either the DMS
       * was cleaned up or the query stopped finding the ids — and the second would mean every
       * consultant silently fell back to name-keying again.
       */
      const variants = await tx<{ employee_id: string; names: string }[]>`
        SELECT BTRIM(kec_employee_id) AS employee_id, string_agg(DISTINCT BTRIM(consultant_name), ' | ') AS names
        FROM kia_enquiry_report
        WHERE consultant_name IS NOT NULL AND BTRIM(consultant_name) <> ''
          AND kec_employee_id IS NOT NULL AND BTRIM(kec_employee_id) <> ''
        GROUP BY 1 HAVING COUNT(DISTINCT UPPER(BTRIM(consultant_name))) > 1`
      console.log(`  [INFO] ${variants.length} employee id(s) file under more than one spelling`
        + (variants.length ? `: ${variants.map((v) => v.names).join(' ; ')}` : ''))

      /*
       * ⚠️ AND NO NAME MAY MAP TO TWO IDS. If one ever does, collapsing onto the id would merge two
       * real people — a worse error than splitting one — and the resolver must be reconsidered.
       */
      const ambiguous = await tx<{ name: string }[]>`
        SELECT UPPER(BTRIM(consultant_name)) AS name
        FROM kia_enquiry_report
        WHERE consultant_name IS NOT NULL AND BTRIM(consultant_name) <> ''
          AND kec_employee_id IS NOT NULL AND BTRIM(kec_employee_id) <> ''
        GROUP BY 1 HAVING COUNT(DISTINCT BTRIM(kec_employee_id)) > 1`
      assert('no consultant name maps to two employee ids (merging would join two real people)',
        ambiguous.length === 0, ambiguous.map((a) => a.name).join(', '))

      /*
       * ⚠️ BOTH OUTLETS MUST BE NON-EMPTY once the outlet is resolved correctly. This is the exact
       * check that would have caught the bug: read dealer_code first and JK501 comes back zero.
       */
      const outlets = await tx<{ outlet: string; n: number }[]>`
        SELECT UPPER(BTRIM(COALESCE(NULLIF(BTRIM(dealer_code_2), ''), NULLIF(BTRIM(dealer_code), ''), ''))) AS outlet,
               COUNT(*)::int AS n
        FROM kia_booking_report
        WHERE booking_date >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '2 months')
        GROUP BY 1`
      const byOutlet = new Map(outlets.map((o) => [o.outlet, o.n]))
      assert('Jammu has bookings in the last 3 months', (byOutlet.get('JK402') ?? 0) > 0)
      assert('Udhampur has bookings in the last 3 months — it is not being credited to Jammu',
        (byOutlet.get('JK501') ?? 0) > 0, `JK501 = ${byOutlet.get('JK501') ?? 0}`)
      console.log(`  [INFO] last 3 months of bookings by outlet: ${outlets.map((o) => `${o.outlet} ${o.n}`).join(' · ')}`)
    })

    /*
     * The reader's own output: the daily series must sum to the totals. They are built from the same
     * rows in one pass, so a mismatch means the fold dropped something.
     */
    const { getSalesTargetPlan } = await import('../lib/kia/sales-target-plan')
    for (const outlet of ['JK402', 'JK501'] as const) {
      const plan = await getSalesTargetPlan({ outlet })
      const summed = plan.daily.reduce((acc, d) => ({
        enquiries: acc.enquiries + d.enquiries, testDrives: acc.testDrives + d.testDrives,
        bookings: acc.bookings + d.bookings, retails: acc.retails + d.retails,
      }), { enquiries: 0, testDrives: 0, bookings: 0, retails: 0 })
      const ties = (['enquiries', 'testDrives', 'bookings', 'retails'] as const)
        .every((k) => summed[k] === plan.totals[k].actual)
      assert(`${outlet}: the day-by-day series sums to the month's totals`, ties,
        `daily ${JSON.stringify(summed)} vs totals ${JSON.stringify({
          enquiries: plan.totals.enquiries.actual, testDrives: plan.totals.testDrives.actual,
          bookings: plan.totals.bookings.actual, retails: plan.totals.retails.actual })}`)
      assert(`${outlet}: every day of the month is present`, plan.daily.length === plan.context.monthDays)
      // ⚠️ Pace must never exceed 1, or a consultant is judged against more month than exists.
      assert(`${outlet}: the elapsed share is within 0..1`,
        plan.context.elapsedShare >= 0 && plan.context.elapsedShare <= 1, String(plan.context.elapsedShare))
      console.log(`  [INFO] ${outlet} ${plan.context.label}: ${plan.consultants.length} consultant(s), `
        + `enq ${plan.totals.enquiries.actual} · td ${plan.totals.testDrives.actual} · `
        + `bkg ${plan.totals.bookings.actual} · retail ${plan.totals.retails.actual}`)
    }
  } finally {
    await sql.end()
  }
}

liveChecks()
  .catch((error) => {
    failures += 1
    console.log(`  [FAIL] live checks errored — ${error instanceof Error ? error.message : String(error)}`)
  })
  .then(() => {
    console.log(failures === 0
      ? `\n=== ALL CHECKS PASSED (${passes}) ===\n`
      : `\n=== ${failures} FAILURE(S), ${passes} passed ===\n`)
    process.exit(failures === 0 ? 0 : 1)
  })
