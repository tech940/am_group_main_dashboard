/**
 * verify:kia-dms-reconciliation — proves the DMS Exceptions section end to end.
 *
 *  1. ENGINE (pure fixtures): every match tier, the guards against false links (prior purchase, two
 *     sold cars, one DMS booking claimed twice), every exception type, the ₹7L line, and that aligned
 *     bookings produce NOTHING.
 *  2. WIRING: permission key, restricted-by-default, route, search, tier, role grants, tab gating,
 *     API guards, and that nothing in the feature writes a booking or a DMS feed or serves a PAN.
 *  3. LIVE (real data, inside ONE transaction that is always rolled back — tsconfig.hp-flow.json maps
 *     @/lib/db to the rollback shim): the real run, idempotence, a fix resolving its exception, the
 *     month / branch / PII rules of the list, and the detail view.
 *
 *   npm run verify:kia-dms-reconciliation
 */
import { readFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { classify, reconcile, type DmsBookingInput, type OurBookingInput } from '../lib/kia/dms-reconciliation/engine'
import { modelFamily, namesAgree, panKey, phone10 } from '../lib/kia/dms-reconciliation/normalize'
import { DMS_PAID_THRESHOLD } from '../lib/kia/dms-reconciliation/types'
import { DEFAULT_VISIBLE_SECTIONS, PERMISSION_GROUPS, PERMISSIONS, ROLE_PERMISSION_TEMPLATES, SECTION_ROUTES } from '../lib/permissions/registry'
import { resolveEffectiveSnapshotV2 } from '../lib/permissions/service'
import { ALL_SECTIONS } from '../lib/navigation/sections'
import { SECTION_MIN_TIER } from '../lib/permissions/tiers'

class Rollback extends Error {}
let failures = 0
let passes = 0
function assert(label: string, condition: boolean, detail = '') {
  if (condition) { passes++; console.log(`  [PASS] ${label}`) }
  else { failures++; console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`) }
}

const ours = (over: Partial<OurBookingInput> = {}): OurBookingInput => ({
  id: over.id ?? crypto.randomUUID(), bookingNumber: 'KIA_TEST_1', status: 'proforma_generated', heldFromStatus: null,
  dealerCode: 'JK402', customerName: 'Rakesh Kumar Gupta', phone: '9000000001', pan: '', vin: '', dmsBookingNo: null,
  model: 'SONET', variant: 'Sonet HTK', bookingDate: '2026-09-01', deliveredOn: null, paymentProgressed: false, ...over,
})
const dms = (over: Partial<DmsBookingInput> = {}): DmsBookingInput => {
  const bookingNo = over.bookingNo ?? 'B202600001'
  const customerId = over.customerId ?? 'C2026090001'
  return {
    key: `${bookingNo}|${customerId}`, bookingNo, customerId, status: 'Booking', outletDealer: 'JK402',
    customerName: 'RAKESH KUMAR GUPTA', registrationName: null, phones: ['9000000001'], pans: [], vins: [],
    model: 'SONET', variant: 'Sonet HTK', bookingDate: '2026-09-01', deliveryDate: null, invoiceNo: null, invoiceDate: null,
    firstRetailSeen: null, firstInvoiceSeen: null, firstCancelSeen: null, received: 25000, receiptCount: 1,
    lastReceiptDate: '2026-09-01', paidCrossedOn: null, latestActivity: '2026-09-01', ...over,
  }
}
const one = (o: OurBookingInput[], d: DmsBookingInput[]) => reconcile(o, d)

function engine() {
  console.log('\n1) Engine — normalisation')
  assert('phones reduce to the last 10 digits', phone10('+91 90000-00001') === '9000000001' && phone10('12345') === '')
  assert('PAN must be well-formed', panKey('abcde1234f') === 'ABCDE1234F' && panKey('ABCDE12345') === '')
  assert('a first name agreeing is a name match', namesAgree('Rakesh Gupta', 'RAKESH KUMAR GUPTA'))
  assert('sharing only "SINGH" is NOT a name match', !namesAgree('Harpreet Singh', 'Gurdeep Singh'))
  assert('the canteen registration never matches a person', !namesAgree('Tahar Mohd', 'THE AREA MANAGER CANTEEN STORES DEPARTMENT'))
  assert('models compare by family (CLAVIS = CARENS, NEW SELTOS PETROL = SELTOS)', modelFamily('CLAVIS') === modelFamily('CARENS CLAVIS EV') && modelFamily('NEW SELTOS PETROL') === modelFamily('SELTOS'))

  console.log('\n2) Engine — match tiers')
  const tierOf = (o: OurBookingInput, d: DmsBookingInput) => {
    const r = one([o], [d])
    return { tier: r.stats.byTier, matched: r.stats.matched, review: r.stats.review }
  }
  assert('DMS booking no. + mobile → tier 1', tierOf(ours({ dmsBookingNo: 'B202600001' }), dms()).tier['1'] === 1)
  assert('chassis + mobile → tier 2', tierOf(ours({ vin: 'MZBTEST0000000001' }), dms({ vins: ['MZBTEST0000000001'] })).tier['2'] === 1)
  assert('PAN alone → tier 3 (exact)', tierOf(ours({ phone: '9111111111', pan: 'ABCDE1234F' }), dms({ pans: ['ABCDE1234F'] })).tier['3'] === 1)
  assert('mobile + name → tier 4 (exact)', tierOf(ours(), dms()).tier['4'] === 1)
  const phoneOnly = tierOf(ours({ customerName: 'Somebody Else' }), dms())
  assert('mobile only → tier 5, NOT linked (review)', phoneOnly.tier['5'] === 1 && phoneOnly.matched === 0 && phoneOnly.review === 1)
  const vinOnly = tierOf(ours({ phone: '', vin: 'MZBTEST0000000001' }), dms({ vins: ['MZBTEST0000000001'] }))
  assert('chassis only → tier 6, NOT linked (a stale chassis pointer is not proof)', vinOnly.tier['6'] === 1 && vinOnly.matched === 0)
  const modelDiff = tierOf(ours({ model: 'CARENS' }), dms())
  assert('mobile + name but a different model → review, not linked', modelDiff.matched === 0 && modelDiff.review === 1)

  console.log('\n3) Engine — guards against false links')
  const prior = one([ours({ bookingDate: '2026-09-01' })], [dms({ status: 'Retail', bookingDate: '2025-03-01', deliveryDate: '2025-03-20' })])
  assert('a car this customer took in 2025 is a previous purchase, not this booking', prior.stats.matched === 0 && !prior.items.some((i) => i.bookingId))
  const rebook = one([ours()], [
    dms({ bookingNo: 'B202600339', bookingDate: '2026-09-01', status: 'Booking' }),
    dms({ bookingNo: 'B202600941', bookingDate: '2026-09-20', status: 'Retail', deliveryDate: '2026-09-25' }),
  ])
  assert('re-booked in DMS: the booking that went to Retail is the one', rebook.items[0]?.dms?.bookingNo === 'B202600941' && rebook.items[0]?.type === 'dms_delivered')
  const twoSold = one([ours()], [
    dms({ bookingNo: 'B1', status: 'Retail', deliveryDate: '2026-09-10', vins: ['V1XXXXXXXXXXX'] }),
    dms({ bookingNo: 'B2', status: 'Retail', deliveryDate: '2026-09-12', vins: ['V2XXXXXXXXXXX'] }),
  ])
  assert('two sold cars fit equally → review, never a guess', twoSold.items[0]?.kind === 'review' && twoSold.stats.matched === 0)
  const shared = dms({ status: 'Retail', deliveryDate: '2026-09-10' })
  const dup = one([ours({ id: 'a', bookingNumber: 'A' }), ours({ id: 'b', bookingNumber: 'B' })], [shared])
  assert('two live bookings on one DMS booking → both to review', dup.items.length === 2 && dup.items.every((i) => i.kind === 'review'))
  const dupClosed = one([ours({ id: 'a', bookingNumber: 'A' }), ours({ id: 'b', bookingNumber: 'B', status: 'cancelled' })], [shared])
  assert('…a cancelled duplicate gives way silently', dupClosed.items.length === 1 && dupClosed.items[0].bookingNumber === 'A' && dupClosed.items[0].kind === 'exception')

  console.log('\n4) Engine — classification')
  const verdict = (o: Partial<OurBookingInput>, d: Partial<DmsBookingInput> | null) => classify(ours(o), d ? dms(d) : null)?.type ?? null
  assert('DMS delivered, here at Proforma → dms_delivered (critical)', classify(ours(), dms({ status: 'Retail', deliveryDate: '2026-09-10' }))?.severity === 'critical')
  assert('DMS delivered, here at Paid → still dms_delivered', verdict({ status: 'ready_delivery', paymentProgressed: true }, { status: 'Retail', deliveryDate: '2026-09-10' }) === 'dms_delivered')
  assert('DMS delivered, here delivered → aligned, nothing', verdict({ status: 'delivered', deliveredOn: '2026-09-11' }, { status: 'Retail', deliveryDate: '2026-09-10' }) === null)
  assert('DMS invoiced, here at Booking → dms_invoiced', verdict({ status: 'booking_created' }, { status: 'Invoice', invoiceNo: 'K1' }) === 'dms_invoiced')
  assert('DMS invoiced, here Paid → aligned', verdict({ status: 'ready_delivery', paymentProgressed: true }, { status: 'Invoice', invoiceNo: 'K1' }) === null)
  assert(`DMS receipts of exactly ₹${DMS_PAID_THRESHOLD.toLocaleString('en-IN')} are NOT "paid"`, verdict({}, { received: DMS_PAID_THRESHOLD }) === null)
  assert('one rupee more is, and here it is unconfirmed → dms_paid', verdict({}, { received: DMS_PAID_THRESHOLD + 1, paidCrossedOn: '2026-09-05' }) === 'dms_paid')
  assert('…unless Accounts confirmed it here', verdict({ paymentProgressed: true, status: 'vehicle_allocated' }, { received: DMS_PAID_THRESHOLD + 1 }) === null)
  assert('booking amount only in DMS, Proforma here → aligned', verdict({}, { received: 25000 }) === null)
  assert('cancelled in DMS, live here → dms_cancelled', verdict({}, { status: 'Booking Cancel', firstCancelSeen: '2026-09-16' }) === 'dms_cancelled')
  assert('cancelled in DMS, DELIVERED here → dms_cancelled, high', classify(ours({ status: 'delivered', deliveredOn: '2026-09-07' }), dms({ status: 'Booking Cancel' }))?.severity === 'high')
  assert('cancelled in both → aligned', verdict({ status: 'cancelled' }, { status: 'Booking Cancel' }) === null)
  assert('delivered here, DMS still Booking → internal_ahead', verdict({ status: 'delivered', deliveredOn: '2026-09-18' }, { status: 'Booking' }) === 'internal_ahead')
  assert('delivered here, no DMS booking at all → internal_ahead', verdict({ status: 'delivered', deliveredOn: '2026-09-18' }, null) === 'internal_ahead')
  assert('proforma here, no DMS booking → nothing (not an exception yet)', verdict({}, null) === null)
  assert('the event date is when DMS moved', classify(ours(), dms({ status: 'Retail', deliveryDate: '2026-09-10' }))?.eventDate === '2026-09-10')

  console.log('\n5) Engine — unmatched DMS')
  const lone = one([], [dms({ bookingNo: 'B9', phones: ['9999999999'] }), dms({ bookingNo: 'B10', status: 'Booking Cancel', phones: ['9888888888'] })])
  assert('a DMS booking nobody here has is listed once', lone.items.length === 1 && lone.items[0].type === 'unmatched_dms')
  assert('a cancelled one is not (nothing to do)', !lone.items.some((i) => i.dms?.bookingNo === 'B10'))
  const claimed = one([ours({ customerName: 'Other Person' })], [dms()])
  assert('a DMS booking under review is not ALSO listed as unmatched', !claimed.items.some((i) => i.type === 'unmatched_dms'))
}

function wiring() {
  console.log('\n6) Wiring')
  const KEY = 'kia.dms_reconciliation'
  const HREF = '/brands/kia/proforma/dms-exceptions'
  const group = PERMISSION_GROUPS.find((g) => g.key === KEY)
  assert('section registered under kia.sales, view-only, integer sortOrder', group?.parentKey === 'kia.sales' && JSON.stringify(group?.actions) === '["view"]' && Number.isInteger(group?.sortOrder))
  assert('permission key exists', PERMISSIONS.some((p) => p.key === `${KEY}.view`))
  assert('restricted-by-default', !DEFAULT_VISIBLE_SECTIONS.has(KEY))
  assert('route mapped to the tab', SECTION_ROUTES[KEY]?.href === HREF)
  assert('searchable under the same name', ALL_SECTIONS.some((s) => s.href === HREF && s.name === group?.name))
  assert('tier assigned', Boolean(SECTION_MIN_TIER[KEY]))
  const granted = Object.entries(ROLE_PERMISSION_TEMPLATES).filter(([, keys]) => (keys as string[]).includes(`${KEY}.view`)).map(([r]) => r)
  for (const role of ['md', 'general_manager', 'sales_manager', 'sales_head', 'accounts', 'cxm', 'ccm']) {
    assert(`granted by default to ${role}`, granted.includes(role))
  }
  const allFalse = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>
  for (const role of ['cxm', 'ccm', 'accounts', 'general_manager']) {
    assert(`${role} resolves to view`, resolveEffectiveSnapshotV2(allFalse, {}, role as never, 'kia').effective[`${KEY}.view`] === true)
  }
  for (const role of ['sales_executive', 'cre', 'idt', 'hr']) {
    assert(`${role} does NOT see it until ticked`, resolveEffectiveSnapshotV2(allFalse, {}, role as never, 'kia').effective[`${KEY}.view`] !== true)
  }

  const shell = readFileSync('features/kia/kia-proforma-page.tsx', 'utf8')
  assert('tab sits in the Bookings shell nav', shell.includes(`href: '${HREF}'`))
  assert('tab is permission-gated, not role-gated', shell.includes("item.section !== 'dms-exceptions' || canViewDmsReconciliation"))
  assert('tab renders without the proforma options (CXM/CCM lack kia.proforma.view)', shell.includes("section === 'dms-exceptions' && canViewDmsReconciliation"))
  const sectionRoute = readFileSync('app/brands/kia/proforma/[section]/page.tsx', 'utf8')
  assert('route maps the segment and guards on the narrow key', sectionRoute.includes("'dms-exceptions': 'dms-exceptions'") && sectionRoute.includes(`'${KEY}.view'`))
  assert('Bookings landing page resolves the tab flag', readFileSync('app/brands/kia/proforma/page.tsx', 'utf8').includes(`'${KEY}.view'`))

  for (const f of ['app/api/brands/kia/dms-reconciliation/route.ts', 'app/api/brands/kia/dms-reconciliation/[id]/route.ts', 'app/api/brands/kia/dms-reconciliation/details/route.ts', 'app/api/brands/kia/dms-reconciliation/run/route.ts']) {
    const src = readFileSync(f, 'utf8')
    assert(`${f.replace('app/api/brands/kia/', '')} goes through requireDmsReconApi`, src.includes('requireDmsReconApi()') && !/export async function (PATCH|PUT|DELETE)/.test(src))
  }
  const feature = ['engine.ts', 'load.ts', 'read.ts', 'run.ts'].map((f) => readFileSync(`lib/kia/dms-reconciliation/${f}`, 'utf8')).join('\n')
  assert('nothing in the feature writes a booking', !/(UPDATE|INSERT INTO|DELETE FROM)\s+kia_bookings\b/i.test(feature))
  assert('nothing writes a DMS feed', !/(UPDATE|INSERT INTO|DELETE FROM)\s+kia_(sales|receipt|booking)_report/i.test(feature))
  // Code only — the file's own comments say PAN/Aadhaar are never selected.
  const read = readFileSync('lib/kia/dms-reconciliation/read.ts', 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  assert('the read side never selects PAN or Aadhaar', !/pan_no|panNumber|aadhaar/i.test(read))
  const migration = readFileSync('lib/db/migrations/kia-recon/0001_add_kia_dms_reconciliation.sql', 'utf8')
  assert('the stored table has no phone / PAN column', !/\b(phone|pan|aadhaar|contact)\w*\s+text/i.test(migration))
  const cron = readFileSync('app/api/brands/kia/maintenance/route.ts', 'utf8')
  assert('the maintenance cron rebuilds it only when an input moved', cron.includes('runKiaDmsReconciliation({ onlyIfStale: true })'))
}

async function live() {
  console.log('\n7) Live data, rolled back')
  const { runKiaDmsReconciliation } = await import('../lib/kia/dms-reconciliation/run')
  const { listReconItems, parseReconFilters, getReconDetail, getReconDetails, countOpenRecon } = await import('../lib/kia/dms-reconciliation/read')
  const [before] = (await realDb.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE state = 'open')::int AS open FROM kia_dms_recon_items`)) as unknown as Array<{ n: number; open: number }>
  try {
    await realDb.transaction(async (tx) => {
      useOuterTransaction(tx as unknown as typeof realDb)
      const first = await runKiaDmsReconciliation()
      assert('the real run completes', first.ran === true, JSON.stringify(first))
      const again = await runKiaDmsReconciliation()
      assert('a second run changes nothing (idempotent)', again.ran && again.opened === 0 && again.resolved === 0, JSON.stringify(again))
      const skip = await runKiaDmsReconciliation({ onlyIfStale: true })
      assert('with no input moved, the cron skips', !skip.ran && skip.reason === 'fresh')

      const byBooking = async (bn: string) => (await tx.execute(sql`
        SELECT exception_type, kind, state FROM kia_dms_recon_items WHERE booking_number = ${bn} AND state = 'open'`)) as unknown as Array<{ exception_type: string; kind: string }>
      for (const bn of ['KIA_JK501_2026_120187', 'KIA_JK501_2026_120116', 'KIA_JK501_2026_120130']) {
        assert(`${bn} (chassis attached from DMS) is aligned — no open exception`, (await byBooking(bn)).length === 0)
      }
      const udhay = await byBooking('KIA_JK501_2026_120124')
      assert('Udhay Partap (delivered here, DMS still Booking) is flagged internal_ahead', udhay.some((r) => r.exception_type === 'internal_ahead'))

      // A fix: one DMS-delivered booking brought up to date here must resolve on the next run.
      const [target] = (await tx.execute(sql`
        SELECT i.booking_id::text AS id, i.item_key FROM kia_dms_recon_items i
        JOIN kia_bookings kb ON kb.id = i.booking_id
        WHERE i.state = 'open' AND i.kind = 'exception' AND i.exception_type = 'dms_delivered'
          AND COALESCE(BTRIM(kb.allocated_vin), '') <> ''
        LIMIT 1`)) as unknown as Array<{ id: string; item_key: string }>
      if (target) {
        await tx.execute(sql`UPDATE kia_bookings SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = ${target.id}::uuid`)
        const fixed = await runKiaDmsReconciliation()
        const [row] = (await tx.execute(sql`SELECT state, resolved_at IS NOT NULL AS stamped FROM kia_dms_recon_items WHERE item_key = ${target.item_key}`)) as unknown as Array<{ state: string; stamped: boolean }>
        assert('marking it delivered here resolves the exception on the next run', fixed.ran && fixed.resolved >= 1 && row?.state === 'resolved' && row.stamped)
      } else {
        assert('found an open DMS-delivered exception to fix', false)
      }

      const md = { dealerScope: null, canViewPii: true }
      const sales = { dealerScope: null, canViewPii: false }
      const current = await listReconItems(parseReconFilters(new URLSearchParams('')), sales)
      assert('the current month lists only open items for bookings MADE this month', current.isCurrentMonth && current.rows.length > 0 && current.rows.every((r) => r.state === 'open' && String(r.bookingMonth).startsWith(current.currentMonth)))
      // Vinod kumar raina: booked 18 Aug, DMS delivered 14 Sep — an AUGUST exception (owner's example).
      const [vinod] = (await tx.execute(sql`
        SELECT booking_date::text AS booked, event_date::text AS dms FROM kia_dms_recon_items
        WHERE booking_number = 'KIA_JK402_2026_120172' AND state = 'open' LIMIT 1`)) as unknown as Array<{ booked: string; dms: string }>
      const august = await listReconItems(parseReconFilters(new URLSearchParams('month=2026-08&pageSize=100')), sales)
      assert('an August booking DMS moved in September is filed under August, not September', Boolean(vinod) && vinod.booked.startsWith('2026-08') && vinod.dms.startsWith('2026-09')
        && august.rows.some((r) => r.bookingNumber === 'KIA_JK402_2026_120172') && !current.rows.some((r) => r.bookingNumber === 'KIA_JK402_2026_120172'))
      assert('every August row is an August booking', august.rows.every((r) => String(r.bookingMonth).startsWith('2026-08')))
      assert('summary reconciles: types + review = total', current.summary.total === (['dms_delivered', 'dms_invoiced', 'dms_paid', 'dms_cancelled', 'internal_ahead'] as const).reduce((n, t) => n + current.summary.byType[t], 0) + current.summary.review)
      assert('mobiles are masked for a non-PII viewer', current.rows.every((r) => !r.mobile || r.mobile === '••••••' || r.mobile === '—'))
      const unmasked = await listReconItems(parseReconFilters(new URLSearchParams('')), md)
      assert('…and shown to the MD', unmasked.rows.some((r) => /^[0-9]{10}$/.test(String(r.mobile))))
      const past = await listReconItems(parseReconFilters(new URLSearchParams('month=2026-08')), sales)
      assert('a past month shows only bookings made in it', !past.isCurrentMonth && past.rows.every((r) => String(r.bookingMonth).startsWith('2026-08')))
      const future = parseReconFilters(new URLSearchParams('month=2099-01'))
      assert('a future month is clamped to the current one', future.month === current.currentMonth)
      const udhampur = await listReconItems(parseReconFilters(new URLSearchParams('')), { dealerScope: ['JK501'], canViewPii: false })
      assert('a user pinned to Udhampur sees only JK501', udhampur.rows.length > 0 && udhampur.rows.every((r) => r.dealerCode === 'JK501'))
      assert('the tab badge counts what the current view shows', (await countOpenRecon(sales)) === current.summary.total)

      const paid = current.rows.find((r) => r.type === 'dms_paid') ?? current.rows.find((r) => r.dmsBookingNo)
      if (paid) {
        const detail = await getReconDetail(paid.id, sales)
        assert('the detail carries our booking and the DMS receipts', Boolean(detail?.booking) && Array.isArray(detail?.dms.receipts) && detail!.dms.receipts.length > 0)
        assert('…with no PAN anywhere in it', !/[A-Z]{5}[0-9]{4}[A-Z]/.test(JSON.stringify(detail)))
        assert('…and the mobile masked', detail?.booking?.customer_phone === '••••••')
        const otherBranch = paid.dealerCode === 'JK402' ? 'JK501' : 'JK402'
        assert('a user of the other branch gets nothing', (await getReconDetail(paid.id, { dealerScope: [otherBranch], canViewPii: false })) === null)
      }

      // The page prefetch: one batch must equal the records fetched one by one, and keep the branch rule.
      const pageIds = current.rows.map((r) => r.id)
      const batch = await getReconDetails(pageIds, sales)
      const singles = await Promise.all(pageIds.slice(0, 6).map((id) => getReconDetail(id, sales)))
      assert('the page prefetch returns every row on the page, in order', batch.length === pageIds.length && batch.every((d, i) => d.item.id === pageIds[i]))
      assert('…each identical to the record fetched on its own', singles.every((one, i) => JSON.stringify(one) === JSON.stringify(batch[i])))
      const jk501 = await getReconDetails(pageIds, { dealerScope: ['JK501'], canViewPii: false })
      assert('…and a branch-pinned user gets only their branch', jk501.every((d) => d.item.dealerCode === 'JK501') && jk501.length === current.rows.filter((r) => r.dealerCode === 'JK501').length)
      assert('…with no PAN in it', !/[A-Z]{5}[0-9]{4}[A-Z]/.test(JSON.stringify(batch)))
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) { failures++; console.error('\n[FAIL] the live flow stopped:', error) }
  } finally {
    useOuterTransaction(null)
  }
  const [after] = (await realDb.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE state = 'open')::int AS open FROM kia_dms_recon_items`)) as unknown as Array<{ n: number; open: number }>
  assert('nothing the test wrote survived', after.n === before.n && after.open === before.open, `${before.n}/${before.open} → ${after.n}/${after.open}`)
}

async function main() {
  engine()
  wiring()
  await live()
  await testClient.end({ timeout: 5 })
  console.log(failures ? `\n${failures} check(s) FAILED, ${passes} passed` : `\nAll ${passes} checks passed.`)
  process.exit(failures ? 1 : 0)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end({ timeout: 5 }).catch(() => {})
  process.exit(1)
})
