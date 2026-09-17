/**
 * AM Kia · Walk-in Leads — proves the no-login form, the section and their safeguards.
 *
 *   npm run verify:kia-walk-in
 *
 * 1–4 are pure (no network). 5 runs the REAL server code against the live database inside ONE transaction that
 * is always rolled back (tsconfig.hp-flow.json maps @/lib/db to the rollback shim), so nothing it writes
 * survives. It borrows one existing user id and prints no customer data.
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { createWalkInToken, verifyWalkInToken, walkInFormPath } from '../lib/kia/walk-in-leads/link'
import { normalizeMobile, remarksMeanBooked, titleCaseName } from '../lib/kia/walk-in-leads/constants'
import { walkInDeleteSchema, walkInSubmitSchema } from '../lib/kia/walk-in-leads/schemas'
import { walkInScope, type WalkInViewer } from '../lib/kia/walk-in-leads/access'
import { WALK_IN_BRANCHES } from '../lib/kia/walk-in-leads/constants'
import {
  WalkInError,
  createWalkInLead,
  deleteWalkInLead,
  exportWalkInLeads,
  listWalkInLeads,
  parseWalkInFilters,
  updateWalkInLead,
} from '../lib/kia/walk-in-leads/server'
import { getIndiaYmd } from '../lib/date-time'
import { DEFAULT_VISIBLE_SECTIONS, PERMISSION_GROUPS, PERMISSIONS, SECTION_ROUTES, type PermissionRole } from '../lib/permissions/registry'
import { resolveEffectiveSnapshotV2 } from '../lib/permissions/service'
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS, canUserAccessSection } from '../lib/navigation/sections'
import { SIDEBAR_PERMISSION_BY_HREF } from '../lib/permissions/navigation'
import { GROUPS_REPLACED_BY_LOCKED_SECTIONS } from '../lib/permissions/locked-sections'

class Rollback extends Error {}
let failures = 0
let passes = 0
function assert(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passes += 1
    console.log(`  [PASS] ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}
const read = (path: string) => readFileSync(path, 'utf8')
const HREF = '/brands/kia/walk-in-leads'
const KEY = 'kia.walk_in_leads'

function daysAgo(n: number): string {
  const date = new Date(`${getIndiaYmd()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - n)
  return date.toISOString().slice(0, 10)
}

const sample = (overrides: Record<string, unknown> = {}) => ({
  enquiryDate: getIndiaYmd(),
  customerName: '  flow   TEST visitor ',
  mobile: '+91 90000 00001',
  email: '',
  address: '',
  model: 'SELTOS',
  consultantName: 'rahul  gautam',
  testDrive: 'yes',
  enquirySource: 'WALK IN',
  customerType: 'NEW',
  exchange: 'no',
  exchangeDetails: '',
  additionalInfo: '',
  expectedBookingDate: '',
  remarks: 'WILL PLAN',
  website: '',
  ...overrides,
})

async function main() {
  console.log('\n1) The signed form link')
  {
    const jammu = createWalkInToken('JK402')
    const udhampur = createWalkInToken('JK501')
    const ok = verifyWalkInToken(jammu)
    assert('a Jammu link verifies as Jammu', ok.ok && ok.dealerCode === 'JK402')
    assert('each branch has its own link', jammu !== udhampur && verifyWalkInToken(udhampur).ok)
    const [v, , sig] = jammu.split('.')
    assert('switching the branch in a link breaks it', !verifyWalkInToken(`${v}.JK501.${sig}`).ok)
    assert('a changed signature is refused', !verifyWalkInToken(`${jammu.slice(0, -2)}xx`).ok)
    assert('an unknown branch is refused', !verifyWalkInToken(`${v}.JK999.${sig}`).ok)
    assert('garbage is refused', !verifyWalkInToken('hello').ok && !verifyWalkInToken('').ok && !verifyWalkInToken(null).ok)
    assert('the path is /walk-in/<token>', walkInFormPath('JK402') === `/walk-in/${jammu}`)
    assert('the showrooms are Jammu, Udhampur and Banihal', JSON.stringify(WALK_IN_BRANCHES.map((b) => `${b.code}:${b.label}`)) === JSON.stringify(['JK402:Jammu', 'JK501:Udhampur', 'JK502:Banihal']))
    const banihal = createWalkInToken('JK502')
    const bOk = verifyWalkInToken(banihal)
    assert('a Banihal link verifies as Banihal (JK502)', bOk.ok && bOk.dealerCode === 'JK502' && banihal !== jammu && banihal !== udhampur)
    assert('a Jammu signature does not open Banihal', !verifyWalkInToken(`${v}.JK502.${sig}`).ok)
    let refusedCode = false
    try { createWalkInToken('JK999') } catch { refusedCode = true }
    assert('no link can be made for a showroom that does not exist', refusedCode)
    const before = process.env.WALK_IN_LINK_GENERATION
    process.env.WALK_IN_LINK_GENERATION = 'rotated-for-test'
    assert('changing WALK_IN_LINK_GENERATION retires every old link', !verifyWalkInToken(jammu).ok)
    if (before === undefined) delete process.env.WALK_IN_LINK_GENERATION
    else process.env.WALK_IN_LINK_GENERATION = before
    assert('…and restoring it brings them back', verifyWalkInToken(jammu).ok)
  }

  console.log('\n2) What the form accepts')
  {
    const parsed = walkInSubmitSchema.safeParse(sample())
    assert('a complete walk-in is accepted', parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues))
    if (parsed.success) {
      assert('names are tidied and title-cased', parsed.data.customerName === 'Flow Test Visitor' && parsed.data.consultantName === 'Rahul Gautam')
      assert('the mobile keeps only its ten digits', parsed.data.mobile === '9000000001')
      assert('Yes/No answers become booleans', parsed.data.testDrive === true && parsed.data.exchange === false)
      assert('empty optional fields become null', parsed.data.email === null && parsed.data.expectedBookingDate === null)
    }
    const bad = (label: string, overrides: Record<string, unknown>, field: string) => {
      const result = walkInSubmitSchema.safeParse(sample(overrides))
      assert(label, !result.success && result.error.issues.some((issue) => issue.path[0] === field), result.success ? 'accepted' : JSON.stringify(result.error.issues.map((i) => i.path[0])))
    }
    bad('a 9-digit mobile is refused', { mobile: '900000001' }, 'mobile')
    bad('a mobile starting with 5 is refused', { mobile: '5000000001' }, 'mobile')
    bad('a visit in the future is refused', { enquiryDate: '2099-01-01' }, 'enquiryDate')
    bad('a visit more than 60 days ago is refused', { enquiryDate: daysAgo(61) }, 'enquiryDate')
    bad('an unknown model is refused', { model: 'TESLA' }, 'model')
    bad('an unknown source is refused', { enquirySource: 'BILLBOARD' }, 'enquirySource')
    bad('test drive must be answered', { testDrive: '' }, 'testDrive')
    bad('an exchange needs the car', { exchange: 'yes', exchangeDetails: '' }, 'exchangeDetails')
    bad('a booking date before the visit is refused', { expectedBookingDate: daysAgo(3), enquiryDate: getIndiaYmd() }, 'expectedBookingDate')
    bad('a bad e-mail is refused', { email: 'not-an-email' }, 'email')
    bad('the honeypot must stay empty', { website: 'http://spam' }, 'website')
    bad('new or existing must be chosen', { customerType: '' }, 'customerType')
    assert('a 12-digit +91 number and a leading 0 are normalised', normalizeMobile('919876543210') === '9876543210' && normalizeMobile('09876543210') === '9876543210')
    assert('"BOOKED" remarks mean booked', remarksMeanBooked('Booked') && remarksMeanBooked('BOOKED SELTOS') && !remarksMeanBooked('will book soon'))
    assert('title case handles odd spacing and case', titleCaseName('shiv dev  SINGH') === 'Shiv Dev Singh')
    assert('removing a lead needs a reason', !walkInDeleteSchema.safeParse({ reason: 'no' }).success)
  }

  console.log('\n3) Wiring')
  {
    const group = PERMISSION_GROUPS.find((g) => g.key === KEY)
    assert('the permission group sits under AM Kia · Sales with view/create/edit/delete', group?.parentKey === 'kia.sales'
      && JSON.stringify(group?.actions) === JSON.stringify(['view', 'create', 'edit', 'delete']) && Number.isInteger(group?.sortOrder))
    assert('its route is the section page', SECTION_ROUTES[KEY]?.href === HREF)
    assert('it is restricted by default (tick people in the Access Map)', !DEFAULT_VISIBLE_SECTIONS.has(KEY))
    const sidebar = read('components/layout/sidebar.tsx')
    assert('the sidebar lists it under AM Kia › Sales with the registry name', sidebar.includes(`{ name: '${group?.name}', href: '${HREF}' }`))
    assert('search finds it, filed under KIA', ALL_SECTIONS.filter((s) => s.href === HREF && s.brand === 'kia').length === 1 && ALLOWED_SIDEBAR_HREFS.has(HREF))
    const cache = read('lib/permissions/service.ts').match(/const PERMISSION_CACHE_VERSION = 'v(\d+)'/)
    assert('the permission cache version was bumped (v48+)', Boolean(cache && Number(cache[1]) >= 48))
    const page = read('app/brands/kia/walk-in-leads/page.tsx')
    assert('the section page checks the brand and kia.walk_in_leads.view', page.includes("getBrandAccess('kia')") && page.includes(`'${KEY}.view'`))
    for (const route of ['app/api/brands/kia/walk-in-leads/route.ts', 'app/api/brands/kia/walk-in-leads/[id]/route.ts', 'app/api/brands/kia/walk-in-leads/links/route.ts', 'app/api/brands/kia/walk-in-leads/export/route.ts']) {
      assert(`${route.replace('app/api/brands/kia/walk-in-leads', '…')} requires a signed-in, permitted user`, /requireWalkInApi\('(view|create|edit|delete)'\)/.test(read(route)))
    }
    const links = read('app/api/brands/kia/walk-in-leads/links/route.ts')
    assert('only the create right hands out form links', links.includes("requireWalkInApi('create')"))
    const publicRoute = read('app/api/walk-in/[token]/route.ts')
    assert('the public submit route verifies the signed link', publicRoute.includes('verifyWalkInToken(token)'))
    assert('…and deliberately has no session check', !/getAuthenticatedAppUser|requireBrand|requireWalkInApi/.test(publicRoute.replace(/\/\*[\s\S]*?\*\//g, '')))
    const publicPage = read('app/walk-in/[token]/page.tsx')
    assert('the public page 404s a bad link and is not indexed', publicPage.includes('notFound()') && publicPage.includes('index: false'))
    const middleware = read('lib/supabase/middleware.ts')
    const protectedLine = middleware.match(/const protectedPaths = \[([^\]]*)\]/)?.[1] ?? ''
    assert('/walk-in is not a login-protected path', protectedLine.length > 0 && !protectedLine.includes('/walk'))
    const migration = read('lib/db/migrations/0074_add_kia_walk_in_leads.sql')
    assert('the table is RLS-locked and revoked from anon/authenticated', migration.includes('ENABLE ROW LEVEL SECURITY') && migration.includes('REVOKE ALL ON public.kia_walk_in_leads FROM anon, authenticated, PUBLIC'))
  }

  console.log('\n3b) Admin › Access Map and search')
  {
    // The Access Map offers one tick per SECTION_ROUTES group (app/api/admin/access-matrix/route.ts) and files
    // it under its key's brand (features/admin/access-map.tsx), so this is the column an admin ticks.
    assert('the Access Map offers a Walk-in Leads tick', Boolean(SECTION_ROUTES[KEY]) && !GROUPS_REPLACED_BY_LOCKED_SECTIONS.has(KEY) && KEY.split('.')[0] === 'kia')
    assert('…named as the sidebar names it', PERMISSION_GROUPS.find((g) => g.key === KEY)?.name === 'Walk-in Leads')
    assert('search maps the page to kia.walk_in_leads.view', SIDEBAR_PERMISSION_BY_HREF[HREF] === `${KEY}.view`)
    const entry = ALL_SECTIONS.find((s) => s.href === HREF)!
    const map = (on: boolean) => ({ [`${KEY}.view`]: on }) as Record<string, boolean>
    assert('search shows it to the MD and the developer', canUserAccessSection(entry, 'md', 'all', map(false)) && canUserAccessSection(entry, 'developer', 'all', map(false)))
    assert('search hides it from a KIA sales manager who is not ticked', !canUserAccessSection(entry, 'sales_manager', 'kia', map(false)))
    assert('search shows it once the Access Map tick is saved', canUserAccessSection(entry, 'sales_manager', 'kia', map(true)))
    assert('search hides it while access is still loading', !canUserAccessSection(entry, 'sales_manager', 'kia', null))
    assert('a Hyundai user ticked for it finds it too', canUserAccessSection(entry, 'sales_manager', 'hyundai', map(true)) && !canUserAccessSection(entry, 'sales_manager', 'hyundai', map(false)))
    assert('search words find it', /walk/i.test(`${entry.name} ${entry.description}`) && /test drive/i.test(entry.description))
  }

  console.log('\n3c) Branch pins, including Banihal')
  {
    const user = (role: string, dealers: string | null) => ({ id: 'u', supabaseId: 'u', email: 'u@t', fullName: 'U', role, brand: 'kia', dealers, department: null, isActive: true }) as unknown as WalkInViewer['appUser']
    const scopeOf = (role: string, dealers: string | null) => JSON.stringify(walkInScope(user(role, dealers)))
    assert('an unpinned sales manager sees every showroom', walkInScope(user('sales_manager', null)) === null)
    assert('the MD is never pinned', walkInScope(user('md', 'JK502')) === null)
    assert('a Banihal pin (JK502) opens Banihal only', scopeOf('sales_manager', 'JK502') === JSON.stringify(['JK502']))
    assert('the BANIHAL spelling works as a pin too', scopeOf('sales_manager', 'banihal') === JSON.stringify(['JK502']))
    assert('Jammu + Banihal pins open both', JSON.stringify([...(walkInScope(user('sales_manager', 'JK402,JK502')) ?? [])].sort()) === JSON.stringify(['JK402', 'JK502']))
    assert('a Jammu pin does not open Banihal', scopeOf('sales_manager', 'JK402') === JSON.stringify(['JK402']))
    assert('a pin naming no real showroom still sees nothing', scopeOf('sales_manager', 'XYZ') === JSON.stringify(['__no_dealer__']))
  }

  console.log('\n4) Who gets the section by default')
  {
    const allFalse = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>
    for (const [role, brand] of [['sales_manager', 'kia'], ['general_manager', 'kia'], ['sales_executive', 'kia'], ['ceo', 'all'], ['ea', 'all']] as Array<[PermissionRole, string]>) {
      const effective = resolveEffectiveSnapshotV2(allFalse, {}, role, brand).effective
      assert(`${role} @ ${brand} does not see it until ticked`, effective[`${KEY}.view`] !== true)
    }
    // The legacy `admin` role inherits every restricted section; walk-ins must behave like the other KIA Sales ones.
    const admin = resolveEffectiveSnapshotV2(allFalse, {}, 'admin', 'all').effective
    assert('admin sees it exactly as it sees Booking Follow-ups', admin[`${KEY}.view`] === admin['kia.lead_followups.view'])
    for (const role of ['md', 'developer'] as PermissionRole[]) {
      assert(`${role} sees it`, resolveEffectiveSnapshotV2(allFalse, {}, role, 'all').effective[`${KEY}.view`] === true)
    }
    const ticked = resolveEffectiveSnapshotV2(allFalse, { [`${KEY}.view`]: true }, 'sales_manager', 'kia').effective
    assert('a tick opens it for a sales manager', ticked[`${KEY}.view`] === true && ticked[`${KEY}.edit`] !== true)
  }

  console.log('\n5) The real server code, against the database, rolled back')
  const [user] = (await realDb.execute(sql`SELECT id FROM public.users WHERE is_active ORDER BY created_at LIMIT 1`)) as unknown as Array<{ id: string }>
  const baseUser = { id: user.id, supabaseId: user.id, email: 'flow@test', fullName: 'Flow Tester', brand: 'kia', dealers: null, department: null, isActive: true }
  const allCan = { create: true, edit: true, delete: true }
  const md: WalkInViewer = { appUser: { ...baseUser, role: 'md' } as WalkInViewer['appUser'], scope: null, canViewPii: true, can: allCan }
  const sales: WalkInViewer = { appUser: { ...baseUser, role: 'sales_manager' } as WalkInViewer['appUser'], scope: null, canViewPii: false, can: allCan }
  const udhampur: WalkInViewer = { appUser: { ...baseUser, role: 'sales_manager', dealers: 'JK501' } as WalkInViewer['appUser'], scope: ['JK501'], canViewPii: false, can: allCan }
  const todayFilters = (extra: Record<string, string> = {}) => parseWalkInFilters(new URLSearchParams({ from: daysAgo(5), to: getIndiaYmd(), q: 'Flow Test Visitor', ...extra }))

  const [before] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM kia_walk_in_leads`)) as unknown as Array<{ n: number }>
  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)

      const first = await createWalkInLead('JK402', walkInSubmitSchema.parse(sample({ enquiryDate: daysAgo(2) })))
      assert('a form entry is stored', !first.duplicate && /^[0-9a-f-]{36}$/.test(first.id))
      const again = await createWalkInLead('JK402', walkInSubmitSchema.parse(sample({ enquiryDate: daysAgo(2) })))
      assert('a double tap returns the same lead instead of a second row', again.duplicate && again.id === first.id)
      const second = await createWalkInLead('JK402', walkInSubmitSchema.parse(sample({ testDrive: 'no', remarks: 'booked', exchange: 'yes', exchangeDetails: 'Swift 2018' })))
      assert('the same customer on another day is a new visit', !second.duplicate && second.id !== first.id)

      let list = await listWalkInLeads(md, todayFilters())
      const mine = list.rows.filter((row) => row.id === first.id || row.id === second.id)
      assert('both visits are listed, newest first', mine.length === 2 && list.rows.findIndex((r) => r.id === second.id) < list.rows.findIndex((r) => r.id === first.id))
      const newer = mine.find((row) => row.id === second.id)!
      const older = mine.find((row) => row.id === first.id)!
      assert('the later visit is flagged "came back"; the first is not', newer.repeatVisit && !older.repeatVisit)
      assert('"booked" in the remarks books the lead', newer.booked && !older.booked)
      assert('the MD sees the real mobile', newer.mobile === '9000000001')
      assert('the summary counts match the rows', list.summary.total === list.total && list.summary.testDrives >= 1 && list.summary.booked >= 1 && list.summary.exchange >= 1)
      assert('the breakdowns include the model and consultant', list.summary.byModel.some((b) => b.key === 'SELTOS') && list.summary.byConsultant.some((b) => b.key === 'Rahul Gautam'))

      const masked = await listWalkInLeads(sales, todayFilters())
      const maskedRow = masked.rows.find((row) => row.id === second.id)
      assert('a sales manager sees the lead with the mobile masked', maskedRow?.mobile === '••••••' && !masked.canViewPii)
      assert('…and nothing in the payload carries the number', !JSON.stringify(masked).includes('9000000001'))
      const byPhone = await listWalkInLeads(sales, parseWalkInFilters(new URLSearchParams({ from: daysAgo(5), to: getIndiaYmd(), q: '90000 00001' })))
      assert('a masked viewer cannot find a lead by its phone number', !byPhone.rows.some((row) => row.id === second.id))
      const mdByPhone = await listWalkInLeads(md, parseWalkInFilters(new URLSearchParams({ from: daysAgo(5), to: getIndiaYmd(), q: '90000 00001' })))
      assert('the MD can', mdByPhone.rows.some((row) => row.id === second.id))

      const scoped = await listWalkInLeads(udhampur, todayFilters())
      assert('an Udhampur-pinned user does not see Jammu walk-ins', !scoped.rows.some((row) => row.id === second.id) && scoped.branches.length === 1)
      let refused = false
      try { await listWalkInLeads(udhampur, todayFilters({ dealer: 'JK402' })) } catch (error) { refused = error instanceof WalkInError && error.status === 403 }
      assert('…and asking for Jammu is refused', refused)
      let hidden = false
      try { await updateWalkInLead(udhampur, second.id, { remarks: 'x', expectedUpdatedAt: newer.updatedAt }) } catch (error) { hidden = error instanceof WalkInError && error.status === 404 }
      assert('…and cannot edit a Jammu lead', hidden)

      const updated = await updateWalkInLead(sales, first.id, { remarks: 'NEXT MONTH', expectedBookingDate: getIndiaYmd(), expectedUpdatedAt: older.updatedAt })
      assert('a follow-up is saved and stamped with who did it', updated.remarks === 'NEXT MONTH' && updated.expectedBookingDate === getIndiaYmd() && updated.updatedByName === 'Flow Tester')
      assert('the saved lead comes back masked for the sales manager', updated.mobile === '••••••')
      let stale = false
      try { await updateWalkInLead(sales, first.id, { remarks: 'OLD FORM', expectedUpdatedAt: older.updatedAt }) } catch (error) { stale = error instanceof WalkInError && error.status === 409 }
      assert('an edit from an out-of-date screen is refused (409)', stale)
      const bookedByRemark = await updateWalkInLead(sales, first.id, { remarks: 'BOOKED', expectedUpdatedAt: updated.updatedAt })
      assert('typing BOOKED books it', bookedByRemark.booked)
      const unbooked = await updateWalkInLead(sales, first.id, { booked: false, expectedUpdatedAt: bookedByRemark.updatedAt })
      assert('the Booked switch can still say otherwise', !unbooked.booked)

      const file = await exportWalkInLeads(sales, todayFilters())
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(file as unknown as ArrayBuffer)
      const sheet = workbook.worksheets[0]
      const cells: string[] = []
      sheet.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.text))))
      assert('the Excel export has the rows, with mobiles masked for a sales manager', sheet.rowCount >= 3 && cells.includes('••••••') && !cells.some((c) => c.includes('9000000001')))

      await deleteWalkInLead(sales, first.id, { reason: 'Duplicate test entry' })
      list = await listWalkInLeads(md, todayFilters())
      assert('a removed walk-in leaves the list', !list.rows.some((row) => row.id === first.id) && list.rows.some((row) => row.id === second.id))

      await tx.execute(sql`
        INSERT INTO kia_walk_in_leads (enquiry_date, dealer_code, customer_name, mobile, model, consultant_name, enquiry_source, source)
        SELECT current_date, 'JK501', 'Flood ' || g, lpad(g::text, 10, '9'), 'SONET', 'Flood', 'WALK IN', 'form'
        FROM generate_series(1, 60) g`)
      let flooded = false
      try { await createWalkInLead('JK501', walkInSubmitSchema.parse(sample({ mobile: '9123400000' }))) } catch (error) { flooded = error instanceof WalkInError && error.status === 429 }
      assert('a link that sent 60 entries in 10 minutes is paused (429)', flooded)
      const other = await createWalkInLead('JK402', walkInSubmitSchema.parse(sample({ mobile: '9123400001' })))
      assert('…while the other branch still works', !other.duplicate)

      const bLead = await createWalkInLead('JK502', walkInSubmitSchema.parse(sample({ mobile: '9123400002' })))
      const pinned = (dealers: string): WalkInViewer => {
        const appUser = { ...udhampur.appUser, dealers } as WalkInViewer['appUser']
        return { ...udhampur, appUser, scope: walkInScope(appUser) }
      }
      const bList = await listWalkInLeads(pinned('BANIHAL'), todayFilters())
      const bRow = bList.rows.find((row) => row.id === bLead.id)
      assert('a Banihal form entry is stored as Banihal', bRow?.dealerCode === 'JK502' && bRow.branch === 'Banihal')
      assert('Banihal staff see Banihal walk-ins only', Boolean(bRow) && bList.rows.every((row) => row.dealerCode === 'JK502') && JSON.stringify(bList.branches.map((b) => b.code)) === JSON.stringify(['JK502']))
      const jList = await listWalkInLeads(pinned('JK402'), todayFilters())
      assert('Jammu staff do not see Banihal walk-ins', !jList.rows.some((row) => row.id === bLead.id))
      const mdBanihal = await listWalkInLeads(md, todayFilters({ dealer: 'JK502' }))
      assert('the MD can filter to Banihal and picks from three showrooms', mdBanihal.rows.some((row) => row.id === bLead.id) && mdBanihal.rows.every((row) => row.dealerCode === 'JK502') && mdBanihal.branches.length === 3)

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) {
      failures += 1
      console.error('\n[FAIL] the flow stopped:', error)
    }
  } finally {
    useOuterTransaction(null)
  }
  const [after] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM kia_walk_in_leads`)) as unknown as Array<{ n: number }>
  assert('nothing the test wrote survived', after.n === before.n, `${before.n} → ${after.n}`)
  const [imported] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM kia_walk_in_leads WHERE import_batch = 'walk-in-sheet-2026-09-17'`)) as unknown as Array<{ n: number }>
  assert('the Google Form history is in (1,713 rows)', imported.n === 1713, String(imported.n))

  await testClient.end({ timeout: 5 })
  console.log(failures === 0 ? `\n=== ALL ${passes} WALK-IN CHECKS PASSED ===` : `\n=== ${failures} FAILURE(S), ${passes} passed ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
