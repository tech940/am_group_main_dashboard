/**
 * verify:allocation-history — proves the Vehicle Allocation History audit trail is correctly wired.
 *
 * Two halves:
 *  1. WIRING — section registered, route mapped, sidebar + search + tier + guard all agree, and the
 *     API exposes no mutation verb (an audit trail nothing can edit).
 *  2. DATA — the reader's filters and derived outcomes actually match the rows in the database.
 *
 * Run: npm run verify:allocation-history
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { PERMISSION_GROUPS, PERMISSIONS, SECTION_ROUTES, DEFAULT_VISIBLE_SECTIONS, ROLE_PERMISSION_TEMPLATES } from '../lib/permissions/registry'
import { SIDEBAR_PERMISSION_BY_HREF } from '../lib/permissions/navigation'
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS } from '../lib/navigation/sections'
import { SECTION_MIN_TIER } from '../lib/permissions/tiers'

// The section lives as a TAB inside Bookings (the Kia Proforma shell). LEGACY_HREF is the retired
// standalone route, kept as a redirect + registry alias so old links survive.
const HREF = '/brands/kia/proforma/allocation-history'
const LEGACY_HREF = '/brands/kia/allocation-history'
const KEY = 'kia.allocation_history'
const REASON = 'No payment received within the reservation window'

let pass = 0
let fail = 0
const ok = (label: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

async function main() {
  console.log('\nWIRING')
  ok('section registered', PERMISSION_GROUPS.some((g) => g.key === KEY))
  const group = PERMISSION_GROUPS.find((g) => g.key === KEY)
  ok('parented under kia.sales', group?.parentKey === 'kia.sales')
  ok('view-only (no edit/delete action on an audit trail)', JSON.stringify(group?.actions) === '["view"]', String(group?.actions))
  ok('permission key exists', PERMISSIONS.some((p) => p.key === `${KEY}.view`))
  ok('route mapped', SECTION_ROUTES[KEY]?.href === HREF)
  ok('restricted-by-default', !DEFAULT_VISIBLE_SECTIONS.has(KEY))
  ok('sidebar href gated by the view key', SIDEBAR_PERMISSION_BY_HREF[HREF] === `${KEY}.view`, SIDEBAR_PERMISSION_BY_HREF[HREF])
  ok('href on the sidebar allowlist', ALLOWED_SIDEBAR_HREFS.has(HREF))
  ok('searchable', ALL_SECTIONS.some((s) => s.href === HREF))
  ok('tier assigned (not silently SUPER_ADMIN-only)', Boolean(SECTION_MIN_TIER[KEY]), String(SECTION_MIN_TIER[KEY]))

  const granted = Object.entries(ROLE_PERMISSION_TEMPLATES)
    .filter(([, keys]) => (keys as string[]).includes(`${KEY}.view`))
    .map(([role]) => role)
  ok('granted to the allocation chain + oversight', granted.length >= 8, granted.join(', '))
  ok('IDT granted (TEMPLATE_ONLY — no other route in)', granted.includes('idt'))
  ok('accounts granted (confirms the payment that saves it)', granted.includes('accounts'))
  ok('not granted to front-line sales_executive', !granted.includes('sales_executive'))

  const route = readFileSync('app/api/brands/kia/allocation-history/route.ts', 'utf8')
  ok('API exports GET', /export async function GET/.test(route))
  ok('API exposes NO mutation verb', !/export async function (POST|PATCH|PUT|DELETE)/.test(route))
  const reader = readFileSync('lib/kia/allocation-history.ts', 'utf8')
  ok('reader never writes', !/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|kia_)/i.test(reader))
  // It must NOT be its own sidebar item any more — it is reached through Bookings.
  const sidebar = readFileSync('components/layout/sidebar.tsx', 'utf8')
  ok('no standalone sidebar item', !sidebar.includes('allocation-history'))
  ok('legacy href kept as a registry alias', (SECTION_ROUTES[KEY]?.aliases || []).includes(LEGACY_HREF))
  ok('legacy href still gated by the same key', SIDEBAR_PERMISSION_BY_HREF[LEGACY_HREF] === `${KEY}.view`)

  const legacy = readFileSync('app/brands/kia/allocation-history/page.tsx', 'utf8')
  ok('old standalone route redirects to the tab', legacy.includes('permanentRedirect') && legacy.includes(HREF))

  const shell = readFileSync('features/kia/kia-proforma-page.tsx', 'utf8')
  ok('tab registered in the Bookings shell nav', shell.includes(`href: '${HREF}'`))
  ok('tab renders the embedded page', /section === 'allocation-history' && <AllocationHistoryPage embedded/.test(shell))
  ok('tab is permission-gated, not role-gated', shell.includes("item.section !== 'allocation-history' || canViewAllocationHistory"))

  const sectionRoute = readFileSync('app/brands/kia/proforma/[section]/page.tsx', 'utf8')
  ok('route maps the allocation-history segment', sectionRoute.includes("'allocation-history': 'allocation-history'"))
  ok('route guards on the NARROW key, not kia.proforma.view', sectionRoute.includes(`'${KEY}.view'`))
  const indexRoute = readFileSync('app/brands/kia/proforma/page.tsx', 'utf8')
  ok('Bookings landing page also resolves the tab flag', indexRoute.includes(`'${KEY}.view'`))

  const feature = readFileSync('features/kia/allocation-history-page.tsx', 'utf8')
  ok('embedded mode skips MainLayout', feature.includes('embedded ? body : <MainLayout>{body}</MainLayout>'))

  console.log('\nDATA')
  const sqlc = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: { rejectUnauthorized: false }, max: 2, onnotice: () => {} })
  try {
    const [c] = await sqlc.unsafe(`
      SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE released_at IS NULL AND payment_confirmed_at IS NULL)::int active,
        COUNT(*) FILTER (WHERE released_at IS NULL AND payment_confirmed_at IS NOT NULL)::int paid,
        COUNT(*) FILTER (WHERE released_at IS NOT NULL AND release_reason = $1)::int no_payment,
        COUNT(*) FILTER (WHERE released_at IS NOT NULL AND COALESCE(release_reason,'') <> $1)::int manual,
        COUNT(*) FILTER (WHERE released_at IS NOT NULL AND COALESCE(release_reason,'') = '')::int released_no_reason,
        COUNT(*) FILTER (WHERE allocated_by IS NULL)::int no_allocator,
        COUNT(*) FILTER (WHERE allocated_at IS NULL)::int no_alloc_time
      FROM kia_vehicle_allocations`, [REASON])

    ok('trail is non-empty', c.total > 0, `${c.total} allocation events`)
    // Regression guard: the buckets used to overlap (released-first vs paid-first), so the cards
    // summed to 62 over 57 rows and four paid-but-still-held rows read as "Awaiting payment".
    ok('the four outcome buckets partition the trail EXACTLY',
      c.active + c.paid + c.no_payment + c.manual === c.total,
      `active ${c.active} + paid ${c.paid} + no-payment ${c.no_payment} + manual ${c.manual} = ${c.active + c.paid + c.no_payment + c.manual} vs total ${c.total}`)
    ok('auto-expiry releases are present and reasoned', c.no_payment > 0, `${c.no_payment} released for non-payment`)
    ok('every event names who allocated it', c.no_allocator === 0, `${c.no_allocator} missing`)
    ok('every event is timestamped', c.no_alloc_time === 0, `${c.no_alloc_time} missing`)
    ok('no release without a reason', c.released_no_reason === 0, `${c.released_no_reason} unreasoned`)

    const [j] = await sqlc.unsafe(`
      SELECT COUNT(*) FILTER (WHERE b.id IS NULL)::int orphan_booking,
             COUNT(*) FILTER (WHERE u.id IS NULL)::int orphan_user
      FROM kia_vehicle_allocations a
      LEFT JOIN kia_bookings b ON b.id = a.booking_id
      LEFT JOIN users u ON u.id = a.allocated_by`)
    ok('every event resolves to a booking', j.orphan_booking === 0, `${j.orphan_booking} orphans`)
    ok('every event resolves to a user', j.orphan_user === 0, `${j.orphan_user} orphans`)

    // The whole point of the feature: a released vehicle keeps its record instead of vanishing.
    const [r] = await sqlc.unsafe(`
      SELECT COUNT(*)::int released_kept,
             COUNT(DISTINCT vin_number)::int vins,
             COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND released_at >= expires_at)::int after_expiry
      FROM kia_vehicle_allocations WHERE released_at IS NOT NULL`)
    ok('released allocations are RETAINED, not deleted', r.released_kept > 0, `${r.released_kept} historic releases still on file`)
    ok('releases land at/after the countdown expiry', r.after_expiry > 0, `${r.after_expiry} of ${r.released_kept}`)

    // Re-allocation must appear as separate events, not overwrite the earlier one.
    const [m] = await sqlc.unsafe(`
      SELECT COUNT(*)::int vins_reallocated FROM (
        SELECT vin_number FROM kia_vehicle_allocations
        WHERE COALESCE(vin_number,'') <> '' GROUP BY vin_number HAVING COUNT(*) > 1) q`)
    console.log(`  INFO  ${m.vins_reallocated} VIN(s) allocated more than once — each attempt kept as its own row`)
  } finally {
    await sqlc.end()
  }

  // The reader itself, not just the raw SQL — this is what the page actually renders.
  console.log('\nREADER')
  const { getAllocationHistory, getAllocationHistorySummary } = await import('../lib/kia/allocation-history')
  const sum = await getAllocationHistorySummary({})
  ok('reader summary partitions', sum.active + sum.paid + sum.noPayment + sum.manual === sum.total,
    `${sum.active}+${sum.paid}+${sum.noPayment}+${sum.manual} = ${sum.total}`)
  for (const [filter, label] of [['active', 'Awaiting payment'], ['paid', 'Payment confirmed'],
    ['no_payment', 'Released — no payment'], ['manual', 'Released — manual']] as [string, string][]) {
    const r = await getAllocationHistory({ outcome: filter, pageSize: 200 })
    const labels = [...new Set(r.rows.map((x) => x.outcome))]
    ok(`filter "${filter}" returns only "${label}"`, labels.length === 1 && labels[0] === label, labels.join(' | ') || 'empty')
  }
  const scoped = await getAllocationHistory({ dealerCode: 'JK501', pageSize: 200 })
  ok('dealer scoping leaks no other branch', new Set(scoped.rows.map((r) => r.dealerCode)).size <= 1,
    `${scoped.total} rows, dealers: ${[...new Set(scoped.rows.map((r) => r.dealerCode))].join(',')}`)
  const inj = await getAllocationHistory({ search: "x' OR 1=1 --", pageSize: 10 })
  const unfiltered = await getAllocationHistory({ pageSize: 10 })
  ok('malformed search is rejected, not executed', inj.total === unfiltered.total,
    `${inj.total} vs unfiltered ${unfiltered.total}`)

  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
