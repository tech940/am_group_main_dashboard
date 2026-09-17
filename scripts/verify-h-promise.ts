/**
 * Proves AM Tata · H Promise is wired the way the 2026-09-17 plan binds it.
 *
 *   npm run verify:h-promise              (`-- --release` also fails on warnings)
 *
 * Sections 1–9 are pure: no database, no network. Section 10 is READ-ONLY and skipped without DATABASE_URL —
 * its SQL runs inside a READ ONLY transaction and touches no H Promise rows.
 *
 * Every check exists because the thing it checks is easy to get silently wrong:
 *   - the registration key in TypeScript and the generated column in Postgres must agree, or the app's
 *     duplicate check and the database's unique index disagree about which cars are the same;
 *   - the six permission keys must be grant-only, or the legacy `admin` role (family 'super') and every
 *     Tata-brand user would receive them — including approve — without anyone ticking a box;
 *   - identity documents must only open for people who work the deal;
 *   - no H Promise code may reach a public bucket, a hardcoded theme colour, or the email sender.
 */
import 'dotenv/config'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import {
  DEFAULT_VISIBLE_SECTIONS,
  GRANT_ONLY_SECTIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  SECTION_ROUTES,
  type PermissionRole,
} from '../lib/permissions/registry'
import { resolveEffectiveSnapshot, resolveEffectiveSnapshotV2 } from '../lib/permissions/service'
import { COMPOSITE_SIDEBAR_SECTIONS } from '../lib/permissions/navigation'
import { ALL_SECTIONS, ALLOWED_SIDEBAR_HREFS, canUserAccessSection } from '../lib/navigation/sections'
import { displayRegNo, isValidPhone, looksLikeIndianReg, maskPhone, normalizePhone, normalizeRegNo } from '../lib/h-promise/registration'
import {
  canPurchaseTransition,
  canSaleTransition,
  getStatusInfo,
  isPurchasePriceEditable,
  isSalePriceEditable,
  isSelfDecision,
  reasonRequired,
  approvalLevelOf,
  approvalQueueOf,
  canDecideAt,
  finalDeciderLabel,
  getApprovalInfo,
  managerStageOf,
} from '../lib/h-promise/status'
import { agingBucket, daysBetweenYmd, deriveFlags, deriveStage, insuranceState } from '../lib/h-promise/stage'
import {
  ECONOMICS_FORMULA_VERSION,
  computeEconomics,
  economicsConfirmed,
  interestPaiseFor,
  priceWithGstPaise,
  ratesFromSettings,
  roundHalfAwayFromZero,
  toPaise,
} from '../lib/h-promise/economics'
import { sniffFileType } from '../lib/h-promise/file-sniff'
import { HP_AREAS, HP_PERMISSION_KEYS, canOpenFileKind, canUploadFileKind, deriveCapabilities } from '../lib/h-promise/access-shared'
import { FILE_KINDS, FILE_KIND_POLICY, formatStockNo, type FileKind } from '../lib/h-promise/constants'
import {
  calendarDate,
  canonicalNames,
  driveFileIds,
  legacyDecision,
  mapHeaders,
  matchLocation,
  number as sheetNumber,
  paperworkValue,
  parseSheetRow,
  sheetTimestamp,
} from '../lib/h-promise/import-core'
import { buildVehicleDetail, buildVehicleRow, type VehicleListRecord } from '../lib/h-promise/serialize'
import { computeInsights, DEFAULT_INSIGHT_FILTERS } from '../lib/h-promise/insights-core'

const RELEASE = process.argv.includes('--release')
const ROOT = process.cwd()
let failures = 0
let warnings = 0

function assert(label: string, condition: unknown, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}

function warn(label: string) {
  warnings += 1
  console.log(`  [WARN] ${label}`)
}

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const absolute = join(ROOT, dir)
  if (!existsSync(absolute)) return []
  const out: string[] = []
  for (const name of readdirSync(absolute)) {
    const relative = join(dir, name)
    if (statSync(join(ROOT, relative)).isDirectory()) out.push(...walk(relative, match))
    else if (match(name)) out.push(relative)
  }
  return out
}

const HP_KEY_PREFIX = 'tata.h_promise'
const HP_GROUPS = PERMISSION_GROUPS.filter((group) => group.key === HP_KEY_PREFIX || group.key.startsWith(`${HP_KEY_PREFIX}.`))
const HP_PERMISSION_LIST = PERMISSIONS.filter((permission) => permission.groupKey === HP_KEY_PREFIX || permission.groupKey.startsWith(`${HP_KEY_PREFIX}.`))

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n1) Registration and phone numbers')
{
  const cases: Array<[string, string]> = [
    ['JK02AB1234', 'JK02AB1234'],
    ['jk 02 ab 1234', 'JK02AB1234'],
    ['JK-02-AB-1234', 'JK02AB1234'],
    ['  jk02ab1234  ', 'JK02AB1234'],
    ['JK–02–AB–1234', 'JK02AB1234'], // en dashes
    ['22 BH 1234 AA', '22BH1234AA'],
    ['', ''],
  ]
  for (const [input, expected] of cases) {
    assert(`normalizeRegNo(${JSON.stringify(input)}) → ${expected || '(empty)'}`, normalizeRegNo(input) === expected)
  }
  assert('displayRegNo trims and upper-cases', displayRegNo('  jk 02  ab 1234 ') === 'JK 02 AB 1234')
  assert('looksLikeIndianReg accepts a state plate', looksLikeIndianReg('JK02AB1234'))
  assert('looksLikeIndianReg accepts a BH-series plate', looksLikeIndianReg('22BH1234AA'))
  assert('looksLikeIndianReg is only a warning for odd input', !looksLikeIndianReg('TEMP123'))
  assert('normalizePhone strips +91', normalizePhone('+91 98765 43210') === '9876543210')
  assert('normalizePhone strips a leading 0', normalizePhone('09876543210') === '9876543210')
  assert('isValidPhone needs ten digits', isValidPhone('9876543210') && !isValidPhone('98765'))
  assert('maskPhone shows only the last four digits', maskPhone('9876543210') === '••••••3210')
  assert('maskPhone of nothing is null', maskPhone('') === null)
  assert('formatStockNo pads to five digits', formatStockNo(42) === 'HP-00042')

  const migration = read('lib/db/migrations/0072_add_tata_h_promise.sql')
  const schema = read('lib/db/schema.ts')
  const expression = "upper(regexp_replace(reg_no, '[^A-Za-z0-9]', '', 'g'))"
  assert('the migration generates reg_no_key with the expression normalizeRegNo mirrors', migration.includes(expression))
  assert('the Drizzle model declares the same expression', schema.includes(expression))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n2) Lifecycle stage and attention flags')
{
  assert('deleted wins over everything', deriveStage({ deletedAt: '2026-09-01', saleStatus: 'approved', hasActiveBooking: true }) === 'deleted')
  assert('a pending sale counts as sold', deriveStage({ deletedAt: null, saleStatus: 'pending', hasActiveBooking: false }) === 'sold')
  assert('an approved sale counts as sold', deriveStage({ deletedAt: null, saleStatus: 'approved', hasActiveBooking: true }) === 'sold')
  assert('a rejected sale with a live booking is booked', deriveStage({ deletedAt: null, saleStatus: 'rejected', hasActiveBooking: true }) === 'booked')
  assert('a rejected sale without a booking is back in stock', deriveStage({ deletedAt: null, saleStatus: 'rejected', hasActiveBooking: false }) === 'in_stock')
  assert('daysBetweenYmd counts whole days', daysBetweenYmd('2026-09-01', '2026-09-17') === 16)
  assert('daysBetweenYmd refuses malformed dates', daysBetweenYmd('17/09/2026', '2026-09-17') === null)
  assert('aging buckets', agingBucket(15) === '0-15' && agingBucket(16) === '16-30' && agingBucket(60) === '31-60' && agingBucket(61) === '60+')
  const today = '2026-09-17'
  assert('insurance: yesterday is expired', insuranceState('2026-09-16', today) === 'expired')
  assert('insurance: today is due within 7 days', insuranceState('2026-09-17', today) === 'due7')
  assert('insurance: 12 days out is due within 15', insuranceState('2026-09-29', today) === 'due15')
  assert('insurance: 25 days out is due within 30', insuranceState('2026-10-12', today) === 'due30')
  assert('insurance: no date is unknown', insuranceState(null, today) === 'unknown')

  const soldBroker = deriveFlags({
    deletedAt: null,
    purchaseDate: '2026-07-01',
    purchaseStatus: 'approved',
    saleStatus: 'pending',
    saleDate: '2026-08-15',
    soldTo: 'BROKER',
    insuranceEndDate: '2026-09-01',
    hasActiveBooking: false,
    presentFiles: new Set<FileKind>(['rc', 'seller_pan']),
  }, today)
  assert('a sold car is flagged for its missing ledger', soldBroker.ledgerPending)
  assert('a sold car is flagged for missing documents (Aadhaar, insurance)', soldBroker.docsMissing && soldBroker.missingDocs.join() === 'seller_aadhaar,insurance_copy')
  assert('a broker sale without RC transfer proof is flagged', soldBroker.brokerRcPending)
  assert('insurance is NOT flagged on a sold car', soldBroker.insurance === null)
  assert('days in stock stop at the sale date', soldBroker.daysInStock === 45)

  const oldStock = deriveFlags({
    deletedAt: null,
    purchaseDate: '2026-06-01',
    purchaseStatus: 'pending',
    saleStatus: null,
    saleDate: null,
    soldTo: null,
    insuranceEndDate: '2026-09-10',
    hasActiveBooking: false,
    presentFiles: new Set<FileKind>(),
  }, today)
  assert('stock over 60 days is long-aging', oldStock.longAging && oldStock.daysInStock === 108)
  assert('unsold stock is flagged for expired insurance', oldStock.insurance === 'expired')
  assert('an unsold car is not flagged for documents or ledger', !oldStock.docsMissing && !oldStock.ledgerPending)
  assert('a pending purchase is flagged', oldStock.purchasePending)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n3) Approval transitions and safeguards')
{
  assert('purchase: pending → approve', canPurchaseTransition('approve', 'pending'))
  assert('purchase: approved cannot be approved again', !canPurchaseTransition('approve', 'approved'))
  assert('purchase: rejected cannot be approved without resubmitting', !canPurchaseTransition('approve', 'rejected'))
  assert('purchase: rejected → resubmit', canPurchaseTransition('resubmit', 'rejected'))
  assert('purchase: only an approved purchase can be reopened', canPurchaseTransition('reopen', 'approved') && !canPurchaseTransition('reopen', 'pending'))
  assert('purchase: an unknown status permits nothing', !canPurchaseTransition('approve', 'APPROVED'))
  assert('sale: record only when there is no sale', canSaleTransition('record', null) && !canSaleTransition('record', 'rejected'))
  assert('sale: withdraw a pending or rejected sale', canSaleTransition('withdraw', 'pending') && canSaleTransition('withdraw', 'rejected'))
  assert('sale: an approved sale cannot be withdrawn without reopening', !canSaleTransition('withdraw', 'approved'))
  assert('reject and reopen need a reason; approve does not', reasonRequired('reject') && reasonRequired('reopen') && !reasonRequired('approve'))
  assert('self-decision: the creator is refused', isSelfDecision('u1', ['u1', 'u2']))
  assert('self-decision: someone else is allowed', !isSelfDecision('u3', ['u1', 'u2']))
  assert('self-decision: unrecorded people never match', !isSelfDecision('u1', [null, undefined]))
  assert('self-decision: no actor never matches', !isSelfDecision(null, [null]))
  assert('prices lock only once approved', !isPurchasePriceEditable('approved') && isPurchasePriceEditable('pending') && isPurchasePriceEditable('rejected'))
  assert('selling price locks only once approved', !isSalePriceEditable('approved') && isSalePriceEditable(null))
  assert('status labels never throw on bad input', getStatusInfo('purchase', 'weird').label === 'weird' && getStatusInfo('sale', null).label === 'Not sold')

  const migration = read('lib/db/migrations/0072_add_tata_h_promise.sql')
  assert('the database refuses self-decisions (three CHECKs)', (migration.match(/_not_self_/g) ?? []).length >= 3)
  assert('the database locks approved prices (trigger, SQLSTATE HP001)', migration.includes("USING ERRCODE = 'HP001'") && migration.includes('tata_h_promise_price_lock'))
  assert('the history table is append-only', migration.includes('tata_h_promise_events_append_only') && migration.includes('BEFORE TRUNCATE'))

  // Two-stage approval (owner, 2026-09-17): GSM / SM first, then the MD, who may approve at any time.
  assert('a waiting record with no manager stage recorded waits for the GSM / SM', managerStageOf('pending', null) === 'pending' && approvalQueueOf('pending', null) === 'manager')
  assert('an imported decision reads as "skipped" at the GSM / SM stage', managerStageOf('approved', null) === 'skipped')
  assert('GSM / SM approved → waiting for the MD', approvalQueueOf('pending', 'approved') === 'md')
  assert('finally approved / rejected land in their own queues', approvalQueueOf('approved', 'approved') === 'approved' && approvalQueueOf('rejected', 'rejected') === 'rejected')
  assert('no sale means no queue', approvalQueueOf(null, null) === null)
  assert('the MD role decides finally; the tick decides the GSM / SM stage; nothing else decides',
    approvalLevelOf({ approve: true, final: true }) === 'md' && approvalLevelOf({ approve: true, final: false }) === 'manager' && approvalLevelOf({ approve: false, final: false }) === null)
  assert('the MD may approve while the GSM / SM stage waits', canDecideAt('md', 'pending', 'pending') && canDecideAt('md', 'pending', null))
  assert('the MD may approve after the GSM / SM', canDecideAt('md', 'pending', 'approved'))
  assert('a GSM / SM decides only a waiting first stage', canDecideAt('manager', 'pending', null) && !canDecideAt('manager', 'pending', 'approved'))
  assert('nobody decides a finished record', !canDecideAt('md', 'approved', 'approved') && !canDecideAt('md', 'rejected', 'rejected') && !canDecideAt('manager', 'approved', null))
  assert('the final decider is labelled by role, and imported approvals by the sheet',
    finalDeciderLabel('md', 'A').includes('(MD)') && finalDeciderLabel(null, null) === 'Google Sheet' && finalDeciderLabel('developer', 'B').includes('for the MD'))
  assert('waiting records say which stage they wait on', getApprovalInfo('sale', 'pending', 'approved').label === 'Waiting for MD' && getApprovalInfo('purchase', 'pending', null).label === 'Waiting for GSM / SM')
  const m73 = read('lib/db/migrations/0073_h_promise_two_stage_approval.sql')
  assert('0073 is additive (no UPDATE, DELETE or DROP)', !/(UPDATE|DELETE\s+FROM|DROP)/i.test(m73.replace(/--.*$/gm, '')))
  assert('0073 refuses a self-decision at the GSM / SM stage', m73.includes('purchase_manager_not_self') && m73.includes('sale_manager_not_self'))
  const server = read('lib/h-promise/server.ts')
  assert('reopening and deleting an approved record are MD-only', (server.match(/!caps\.approvals\.final\)/g) ?? []).length >= 3)
  for (const route of ['purchase-reopen', 'sale-reopen']) {
    assert(`${route} route requires the MD role`, read(`app/api/h-promise/vehicles/[id]/${route}/route.ts`).includes('requireHPromiseApi((caps) => caps.approvals.final)'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n4) Money')
{
  assert('Excel-style rounding sends halves away from zero', roundHalfAwayFromZero(2.5) === 3 && roundHalfAwayFromZero(-2.5) === -3)
  assert('toPaise reads numeric strings', toPaise('120000.50') === 12000050)
  assert('toPaise reads rupee-formatted input', toPaise('₹1,20,000') === 12000000)
  assert('toPaise refuses junk', toPaise('abc') === null && toPaise('') === null && toPaise(null) === null)
  assert('price with 6% GST, as the sheet computed it', priceWithGstPaise(10000000, '6') === 10600000)
  assert('price with GST rounds to whole rupees', priceWithGstPaise(9999900, 6) === 10599900)
  assert('no GST leaves the price unchanged', priceWithGstPaise(5000000, null) === 5000000)
  assert('the formulas are marked confirmed', ECONOMICS_FORMULA_VERSION !== 'pending-xlsx' && economicsConfirmed())

  // A worked example, by hand: bought 1 Aug for ₹1,00,000 at 6 % GST, ₹2,000 refurbishment, sold 1 Sep for ₹1,30,000.
  const worked = computeEconomics({
    purchasePrice: '100000', purchaseGstPct: '6', sellingPrice: '130000', otherCost: '2000',
    purchaseDate: '2026-08-01', saleDate: '2026-09-01', asOfYmd: '2026-09-17',
  })
  assert('gross profit = selling − (purchase + other cost)', worked.grossProfitPaise === 2800000)
  assert('gross profit with GST = selling − (purchase with GST + other cost)', worked.grossProfitWithGstPaise === 2200000)
  assert('interest stops on the sale date (31 days, not 47)', worked.interestDays === 31)
  assert('interest = ROUND(days × 12 % ÷ 365 × purchase price)', worked.interestPaise === 101900, String(worked.interestPaise))
  assert('net profit = gross profit with GST − interest', worked.netProfitPaise === 2098100)
  assert('a profitable sale is not a loss', worked.isLoss === false)

  const unsold = computeEconomics({
    purchasePrice: '100000', purchaseGstPct: '6', sellingPrice: null, otherCost: '0',
    purchaseDate: '2026-08-01', saleDate: null, asOfYmd: '2026-09-17',
  })
  assert('an unsold car has no profit yet (the sheet showed a negative one)', unsold.grossProfitPaise === null && unsold.netProfitPaise === null && unsold.isLoss === null)
  assert('an unsold car accrues interest to today', unsold.interestDays === 47 && unsold.interestPaise === 154500, `${unsold.interestDays} ${unsold.interestPaise}`)

  const stepped = interestPaiseFor(10000000, '2026-01-01', '2026-03-02', [
    { effectiveFrom: '2000-01-01', ratePct: 12 },
    { effectiveFrom: '2026-02-01', ratePct: 6 },
  ])
  // 31 nights at 12 % + 29 nights at 6 % on ₹1,00,000 = 1019.18 + 476.71 = 1495.89 → ₹1,496
  assert('a rate change applies only to the days after it', stepped?.days === 60 && stepped.paise === 149600, JSON.stringify(stepped))
  assert('ratesFromSettings reads {ratePct} and skips junk', ratesFromSettings([
    { key: 'interest_rate_annual_pct', effectiveFrom: '2026-01-01', value: { ratePct: 10 } },
    { key: 'interest_rate_annual_pct', effectiveFrom: '2025-01-01', value: 12 },
    { key: 'interest_rate_annual_pct', effectiveFrom: '2027-01-01', value: 'abc' },
    { key: 'other', effectiveFrom: '2026-01-01', value: 5 },
  ]).map((r) => `${r.effectiveFrom}:${r.ratePct}`).join() === '2025-01-01:12,2026-01-01:10')

  // Every row of the owner's workbook, re-computed the way the sheet did it (interest to "today").
  const fixturePath = 'scripts/fixtures/h-promise-economics.json'
  if (!existsSync(join(ROOT, fixturePath))) {
    assert(`the workbook fixture exists (${fixturePath})`, false)
  } else {
    type FixtureRow = {
      sheetRow: number; purchasePrice: number; purchaseGstPct: number; sheetPriceWithGst: number | null
      sellingPrice: number | null; otherCost: number; purchaseDate: string | null; saleDate: string | null
      expected: { grossProfit: number | null; grossProfitWithGst: number | null; interestDays: number | null; interest: number | null; netProfit: number | null }
    }
    const fixture = JSON.parse(read(fixturePath)) as { sheetToday: string; knownSheetErrors: Array<{ sheetRow: number }>; rows: FixtureRow[] }
    const knownBad = new Set(fixture.knownSheetErrors.map((e) => e.sheetRow))
    const sheetMode = { interestRates: [{ effectiveFrom: '2000-01-01', ratePct: 12 }], interestRunsTo: 'as_of' as const }
    const mismatches: string[] = []
    let compared = 0
    for (const row of fixture.rows) {
      const e = computeEconomics({
        purchasePrice: row.purchasePrice, purchaseGstPct: row.purchaseGstPct, sellingPrice: row.sellingPrice,
        otherCost: row.otherCost, purchaseDate: row.purchaseDate, saleDate: row.saleDate, asOfYmd: fixture.sheetToday,
      }, sheetMode)
      const rupees = (paise: number | null) => (paise === null ? null : paise / 100)
      const checks: Array<[string, number | null, number | null]> = [
        ['interest days', e.interestDays, row.expected.interestDays],
        ['interest', rupees(e.interestPaise), row.expected.interest],
      ]
      if (row.sellingPrice !== null) {
        checks.push(['gross profit', rupees(e.grossProfitPaise), row.expected.grossProfit])
        if (!knownBad.has(row.sheetRow)) {
          checks.push(['price with GST', rupees(e.priceWithGstPaise), row.sheetPriceWithGst])
          checks.push(['gross profit with GST', rupees(e.grossProfitWithGstPaise), row.expected.grossProfitWithGst])
          checks.push(['net profit', rupees(e.netProfitPaise), row.expected.netProfit])
        }
      }
      for (const [label, got, want] of checks) {
        compared += 1
        if (got !== want) mismatches.push(`row ${row.sheetRow} ${label}: ${got} vs sheet ${want}`)
      }
    }
    assert(`all ${fixture.rows.length} workbook rows match the sheet (${compared} figures compared)`, mismatches.length === 0, mismatches.slice(0, 5).join('; '))
    assert('the known sheet error (row 44) is still recorded for the owner', knownBad.has(44))
  }
  if (RELEASE && warnings > 0) assert('no warnings in a release run', false)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n5) File content, not file name')
{
  const bytes = (...values: number[]) => new Uint8Array(values)
  const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)))
  assert('JPEG', sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)) === 'image/jpeg')
  assert('PNG', sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)) === 'image/png')
  assert('WebP', sniffFileType(new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')])) === 'image/webp')
  assert('PDF', sniffFileType(ascii('%PDF-1.7\n')) === 'application/pdf')
  assert('HTML is refused', sniffFileType(ascii('<!doctype html><script>')) === null)
  assert('SVG is refused', sniffFileType(ascii('<svg xmlns="http://www.w3.org/2000/svg">')) === null)
  assert('a Windows executable is refused', sniffFileType(ascii('MZ\x90\x00')) === null)
  assert('a ZIP / xlsx is refused', sniffFileType(bytes(0x50, 0x4b, 0x03, 0x04)) === null)
  assert('an empty file is refused', sniffFileType(new Uint8Array()) === null)
  assert('RIFF that is not WebP (e.g. WAV) is refused', sniffFileType(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])) === null)
  assert('every file kind has a policy', FILE_KINDS.every((kind) => FILE_KIND_POLICY[kind]))
  assert('WhatsApp screenshots must be photos', !FILE_KIND_POLICY.purchase_approval_screenshot.acceptsPdf && !FILE_KIND_POLICY.sale_approval_screenshot.acceptsPdf)
  assert('PAN and Aadhaar are personal data', (['buyer_pan', 'buyer_aadhaar', 'seller_pan', 'seller_aadhaar'] as const).every((kind) => FILE_KIND_POLICY[kind].sensitivity === 'pii'))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n6) Who may do what (capabilities)')
{
  const user = { id: 'u1', name: 'Test' }
  const none = deriveCapabilities(user, {}, false)
  const viewOnly = deriveCapabilities(user, { [HP_PERMISSION_KEYS.registerView]: true }, false)
  const desk = deriveCapabilities(user, { [HP_PERMISSION_KEYS.registerView]: true, [HP_PERMISSION_KEYS.registerEdit]: true }, false)
  const accounts = deriveCapabilities(user, { [HP_PERMISSION_KEYS.paymentsView]: true }, false)
  const approver = deriveCapabilities(user, { [HP_PERMISSION_KEYS.approvalsView]: true, [HP_PERMISSION_KEYS.approvalsApprove]: true }, false)
  const md = deriveCapabilities(user, {}, true)

  assert('no grants → nothing, not even a vehicle detail', !none.anyView && !canOpenFileKind(none, 'rc'))
  assert('view-only → sees the register but not personal data', viewOnly.anyView && !viewOnly.canSeePii)
  assert('view-only cannot open PAN / Aadhaar / refund cheques', !canOpenFileKind(viewOnly, 'buyer_pan') && !canOpenFileKind(viewOnly, 'refund_cheque'))
  assert('view-only can open an RC and the gate pass', canOpenFileKind(viewOnly, 'rc') && canOpenFileKind(viewOnly, 'gate_pass_photo'))
  assert('view-only cannot open the payment ledger', !canOpenFileKind(viewOnly, 'payment_ledger'))
  assert('the entry desk (edit) sees personal data', desk.canSeePii && canOpenFileKind(desk, 'seller_aadhaar'))
  assert('an approver sees personal data', approver.canSeePii && canOpenFileKind(approver, 'buyer_pan'))
  assert('payment viewers open the ledger but not identity documents', canOpenFileKind(accounts, 'payment_ledger') && !canOpenFileKind(accounts, 'buyer_pan'))
  assert('only payments.edit may upload the ledger', !canUploadFileKind(desk, 'payment_ledger') && canUploadFileKind(deriveCapabilities(user, { [HP_PERMISSION_KEYS.paymentsEdit]: true }, false), 'payment_ledger'))
  assert('view-only may upload nothing', FILE_KINDS.every((kind) => !canUploadFileKind(viewOnly, kind)))
  assert('a super admin can do everything', md.canSeePii && md.approvals.approve && md.settings.edit && md.register.delete)
  assert('every area has a view key that exists in the registry', HP_AREAS.every((area) => PERMISSIONS.some((p) => p.key === area.viewKey)))
  assert('every capability key exists in the registry', Object.values(HP_PERMISSION_KEYS).every((key) => PERMISSIONS.some((p) => p.key === key)))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n7) Registry, sidebar and search')
{
  const expectedGroups = ['tata.h_promise', 'tata.h_promise.register', 'tata.h_promise.approvals', 'tata.h_promise.payments', 'tata.h_promise.insights', 'tata.h_promise.settings']
  assert('all six H Promise groups are registered', expectedGroups.every((key) => HP_GROUPS.some((g) => g.key === key)), `found: ${HP_GROUPS.map((g) => g.key).join(', ')}`)
  assert('every H Promise group is GRANT-ONLY', HP_GROUPS.every((g) => GRANT_ONLY_SECTIONS.has(g.key)))
  assert('no H Promise group is visible by default', HP_GROUPS.every((g) => !DEFAULT_VISIBLE_SECTIONS.has(g.key)))
  assert('sort orders are integers', HP_GROUPS.every((g) => Number.isInteger(g.sortOrder)))
  const HUB = '/brands/tata/h-promise'
  for (const area of HP_AREAS) {
    const groupKey = area.viewKey.replace(/\.view$/, '')
    assert(`${groupKey} keeps its Access Map column (routed to ${area.href})`, SECTION_ROUTES[groupKey]?.href === area.href)
    assert(`${area.href} is not a sidebar link of its own`, !ALLOWED_SIDEBAR_HREFS.has(area.href) && !ALL_SECTIONS.some((s) => s.href === area.href))
  }
  assert('the container and settings groups have no route (no Access Map column)', !SECTION_ROUTES['tata.h_promise'] && !SECTION_ROUTES['tata.h_promise.settings'])
  assert('ONE H Promise link opens all four areas', JSON.stringify(COMPOSITE_SIDEBAR_SECTIONS[HUB]) === JSON.stringify(HP_AREAS.map((area) => area.viewKey)))
  assert(`${HUB} is a sidebar href with exactly one search entry, filed under Tata`,
    ALLOWED_SIDEBAR_HREFS.has(HUB) && ALL_SECTIONS.filter((s) => s.href === HUB && s.brand === 'tata' && s.category === 'tata').length === 1)

  const sidebar = stripComments(read('components/layout/sidebar.tsx'))
  const hubLines = sidebar.split('\n').filter((l) => l.includes(`href: '${HUB}'`))
  assert('the sidebar has ONE H Promise row, named "H Promise"', hubLines.length === 1 && hubLines[0].includes("name: 'H Promise'"), hubLines.join(' | '))
  assert('the sidebar no longer lists the four areas', HP_AREAS.every((area) => !sidebar.includes(`href: '${area.href}'`)))
  assert('the sidebar gates the H Promise row on the composite keys', /compositeViewKeysForHref\(href\)/.test(sidebar))
  assert('Tata staff see the AM Tata card only once ticked (MD, Developer and EA see it by default)',
    /BRANDS_SHOWN_ONLY_WHEN_GRANTED = new Set\(\['tata'\]\)/.test(sidebar) && /!BRANDS_SHOWN_ONLY_WHEN_GRANTED\.has\(brand\.key\)/.test(sidebar)
    && /DISPLAY_ONLY_BRAND_ROLES = new Set\(\['developer', 'md', 'ea'\]\)/.test(sidebar))
  const accessMap = read('features/admin/access-map.tsx')
  for (const area of HP_AREAS) {
    const groupKey = area.viewKey.replace(/\.view$/, '')
    assert(`the Access Map names the ${area.id} column as H Promise`, accessMap.includes(`'${groupKey}': 'H Promise · `))
  }
  assert('the Access Map labels brand bands with the sidebar name ("AM Tata")', accessMap.includes('BRANCH_OPTIONS.find((option) => option.value === prefix)'))
  // 2026-09-17: the AM Tata card vanished for everyone — the brand pre-filter counted only sections WITH
  // submenus, and H Promise is a direct link (submenus: []).
  const brandFilter = sidebar.slice(sidebar.indexOf('const availableBrands'), sidebar.indexOf('const DISPLAY_ONLY_BRAND_KEYS'))
  assert('the brand pre-filter keeps a brand whose only section is a direct link (AM Tata)',
    brandFilter.includes('submenus.length > 0') && /'href' in section/.test(brandFilter), brandFilter.trim().slice(0, 200))

  const cache = read('lib/permissions/service.ts').match(/const PERMISSION_CACHE_VERSION = '(v\d+)'/)
  assert('the permission cache version was bumped past v45', Boolean(cache && Number(cache[1].slice(1)) >= 46))

  // Search: nobody sees the link without a tick; ANY one tick shows it; the MD always sees it.
  const hub = ALL_SECTIONS.find((s) => s.href === HUB)!
  assert('search hides H Promise from a Tata user with no grant', !canUserAccessSection(hub, 'sales_manager', 'tata', {}))
  for (const area of HP_AREAS) {
    assert(`search shows H Promise to a non-Tata user ticked only for ${area.label}`, canUserAccessSection(hub, 'viewer', 'kia', { [area.viewKey]: true }))
  }
  assert('an explicit deny on every area hides it', !canUserAccessSection(hub, 'viewer', 'tata', Object.fromEntries(HP_AREAS.map((area) => [area.viewKey, false]))))
  assert('search shows it to the MD', canUserAccessSection(hub, 'md', 'all', {}))
  assert('the settings key alone does not open it', !canUserAccessSection(hub, 'viewer', 'tata', { 'tata.h_promise.settings.view': true }))

  // The page: one screen, opened on a tab by the area links.
  const hubPage = stripComments(read('app/brands/tata/h-promise/page.tsx'))
  assert('the H Promise page opens for anyone holding any area', hubPage.includes('requireAnyHPromiseArea()'))
  for (const area of HP_AREAS) {
    const page = stripComments(read(`app${area.href}/page.tsx`))
    assert(`${area.href} renders the same single page`, page.includes('HPromisePage') && page.includes('initialTab='))
  }
  const home = read('features/h-promise/hp-home.tsx')
  for (const form of ['Purchase', 'Sale', 'Booking', 'Documents', 'RC status (broker)', 'Exchange bonus']) {
    assert(`the "${form}" form is on the H Promise screen`, home.includes(`label: '${form}'`))
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n8) Nobody but MD, Developer and EA receives H Promise by default (resolver)')
{
  const ALL_FALSE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, false])) as Record<string, boolean>
  const refused: Array<[PermissionRole, string | null]> = [
    ['admin', 'all'], ['admin', 'tata'], ['hr', 'all'], ['ceo', 'all'], ['eba', 'all'], ['ed', 'kia'],
    ['service_manager', 'tata'], ['general_manager', 'tata'], ['assistant_manager', 'tata'], ['sales_head', 'tata'],
    ['viewer', 'tata'], ['accounts', 'tata'], ['finance_head', 'all'], ['branch_admin', 'tata'], ['sales_manager', 'hyundai,tata'],
  ]
  for (const [role, brand] of refused) {
    const effective = resolveEffectiveSnapshotV2(ALL_FALSE, {}, role, brand).effective
    const leaked = HP_PERMISSION_LIST.filter((p) => effective[p.key] === true).map((p) => p.key)
    assert(`${role} @ ${brand ?? 'none'} gets no H Promise key by default`, leaked.length === 0, `leaked: ${leaked.join(', ')}`)
  }
  for (const role of ['md', 'developer'] as PermissionRole[]) {
    const effective = resolveEffectiveSnapshotV2(ALL_FALSE, {}, role, 'all').effective
    assert(`${role} (super admin) holds every H Promise key`, HP_PERMISSION_LIST.every((p) => effective[p.key] === true))
  }
  /*
   * EA (owner, 2026-09-17: "hidden by default for others except MD, DEVELOPER, EA"): VIEW of the four areas
   * and the container, whatever brands the EA is pinned to (the live EAs are pinned to non-Tata brands).
   * Nothing that writes, approves or opens identity documents; not Settings.
   */
  const EA_VIEW = ['tata.h_promise.view', 'tata.h_promise.register.view', 'tata.h_promise.approvals.view', 'tata.h_promise.payments.view', 'tata.h_promise.insights.view']
  for (const brand of ['all', 'platinum', 'honda,bajaj,ktm', 'hyundai,platinum,kia', null]) {
    for (const [name, resolve] of [['V2', resolveEffectiveSnapshotV2], ['V1', resolveEffectiveSnapshot]] as const) {
      const snapshot = resolve(ALL_FALSE, {}, 'ea', brand)
      const held = HP_PERMISSION_LIST.filter((p) => snapshot.effective[p.key] === true).map((p) => p.key).sort()
      assert(`ea @ ${brand ?? 'none'} (${name}) sees H Promise by default, view only`,
        JSON.stringify(held) === JSON.stringify([...EA_VIEW].sort()), `holds: ${held.join(', ')}`)
      assert(`ea @ ${brand ?? 'none'} (${name}) shows as a DEFAULT in the Access Map`, EA_VIEW.every((key) => snapshot.roleDefaults[key] === true))
    }
  }
  const eaCaps = deriveCapabilities({ id: 'ea', name: 'EA' }, resolveEffectiveSnapshotV2(ALL_FALSE, {}, 'ea', 'platinum').effective, false)
  assert('EA can open all four tabs', eaCaps.register.view && eaCaps.approvals.view && eaCaps.payments.view && eaCaps.insights.view)
  assert('…but cannot enter, edit, delete, approve, verify or change settings',
    !eaCaps.register.create && !eaCaps.register.edit && !eaCaps.register.delete && !eaCaps.approvals.approve && !eaCaps.payments.edit && !eaCaps.settings.view && !eaCaps.settings.edit)
  assert('…and sees masked phones and no identity scans', !eaCaps.canSeePii)
  const eaDenied = resolveEffectiveSnapshotV2(ALL_FALSE, { 'tata.h_promise.approvals.view': false }, 'ea', 'all').effective
  assert('an Access-Map Deny still takes a default tab away from an EA', eaDenied['tata.h_promise.approvals.view'] === false && eaDenied['tata.h_promise.register.view'] === true)
  const eaTicked = resolveEffectiveSnapshotV2(ALL_FALSE, { 'tata.h_promise.approvals.approve': true }, 'ea', 'all').effective
  assert('an Access-Map tick still adds a write action for an EA', eaTicked['tata.h_promise.approvals.approve'] === true)

  const ticked = resolveEffectiveSnapshotV2(ALL_FALSE, { 'tata.h_promise.approvals.view': true, 'tata.h_promise.approvals.approve': true }, 'viewer', 'kia').effective
  assert('an explicit tick is honoured, even for a non-Tata user', ticked['tata.h_promise.approvals.view'] === true && ticked['tata.h_promise.approvals.approve'] === true)
  assert('…and grants nothing else in H Promise', ticked['tata.h_promise.register.view'] !== true && ticked['tata.h_promise.settings.edit'] !== true)
  const denied = resolveEffectiveSnapshotV2(ALL_FALSE, { 'tata.h_promise.register.view': false }, 'admin', 'all').effective
  assert('an explicit deny stays a deny', denied['tata.h_promise.register.view'] === false)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n9) Static checks')
{
  for (const area of HP_AREAS) {
    const page = `app${area.href}/page.tsx`
    assert(`${page} exists and names '${area.viewKey}' in code`, existsSync(join(ROOT, page)) && stripComments(read(page)).includes(`'${area.viewKey}'`))
  }

  const routes = walk('app/api/h-promise', (name) => name === 'route.ts')
  if (routes.length === 0) console.log('  [INFO] no /api/h-promise routes yet')
  for (const route of routes) {
    const src = stripComments(read(route))
    const handlers = src.match(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g) ?? []
    const guards = src.match(/requireHPromiseApi\s*\(/g) ?? []
    assert(`${route} guards every handler (${handlers.length} handlers, ${guards.length} guards)`, handlers.length > 0 && guards.length >= handlers.length)
  }

  const moduleFiles = [
    ...walk('lib/h-promise', (name) => /\.(ts|tsx)$/.test(name)),
    ...walk('features/h-promise', (name) => /\.(ts|tsx)$/.test(name)),
    ...routes,
  ]
  const forbidden: Array<[RegExp, string]> = [
    [/#055B65/i, 'a hardcoded theme colour (use var(--dashboard-primary))'],
    [/getPublicUrl/, 'getPublicUrl (the bucket is private)'],
    [/lib\/supabase\/storage/, 'lib/supabase/storage (the public bucket)'],
    [/db\.query\./, 'db.query (the client has no schema)'],
    [/lib\/email\//, 'the email sender (H Promise sends no email)'],
    [/dark:text-slate-900/, 'dark:text-slate-900 (inverts under the dark-mode net)'],
  ]
  for (const [pattern, what] of forbidden) {
    const offenders = moduleFiles.filter((file) => pattern.test(stripComments(read(file))))
    assert(`no H Promise file uses ${what}`, offenders.length === 0, offenders.join(', '))
  }

  const migration = read('lib/db/migrations/0072_add_tata_h_promise.sql')
  const tables = ['vehicles', 'bookings', 'files', 'events', 'options', 'settings', 'exchange_bonuses']
  for (const table of tables) {
    const name = `public.tata_h_promise_${table}`
    assert(`${name}: RLS enabled and revoked from anon/authenticated/PUBLIC`,
      new RegExp(`ALTER TABLE ${name.replace('.', '\\.')}\\s+ENABLE ROW LEVEL SECURITY`).test(migration)
      && new RegExp(`REVOKE ALL ON ${name.replace('.', '\\.')}\\s+FROM anon, authenticated, PUBLIC`).test(migration))
  }
  assert('the stock-number sequence is revoked too', migration.includes('REVOKE ALL ON SEQUENCE public.tata_h_promise_vehicles_stock_no_seq FROM anon, authenticated, PUBLIC'))
  assert('a rollback exists', existsSync(join(ROOT, 'lib/db/migrations/0072_rollback_add_tata_h_promise.sql')))
  const apply = read('scripts/apply-migration-0072.ts')
  assert('the apply script refuses the pooler', apply.includes("Refusing to run DDL against the pgbouncer pooler"))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n9b) Reading the retired sheet (import-core)')
{
  const headers = ['UNIQUE ID', 'REG NO', 'VEHICLE', 'DATE PURCHASE', 'PURCHASE PRICE', 'GST % PURCHASE', 'PURCHASE BY',
    'PURCHASE LOCATION', 'APPROVAL GIVEN BY', 'SELLING PRICE', 'DATE OF SALE', 'SOLD TO', 'Approval Purchase ', 'Approval Sale',
    'RC Pics ', 'Booking Amount ', '2ND PARTY CONTACT', 'FIRST PARTY CONTACT', 'PURCHASE PRICE WITH GST']
  const mapped = mapHeaders(headers)
  assert('headers are matched by name, ignoring case and stray spaces', mapped.missing.length === 0 && mapped.columns.rc === 14, JSON.stringify(mapped.missing))
  assert('a missing required header is reported', mapHeaders(headers.filter((h) => h !== 'SOLD TO')).missing.includes('soldTo'))
  assert('booking columns are noticed (reported, not imported)', mapped.bookingColumns.includes(15))

  assert('a date cell (UTC midnight) is that calendar day', calendarDate(new Date(Date.UTC(2025, 8, 6))) === '2025-09-06')
  assert('DD/MM/YYYY text is read day first', calendarDate('03/11/2025') === '2025-11-03')
  assert('an impossible date is refused, not guessed', calendarDate('31/02/2025') === null && calendarDate('hello') === null)
  assert('DD-Mon-YYYY text is read', calendarDate('7-Mar-2026') === '2026-03-07')
  assert('an Excel serial is read', calendarDate(45901) === '2025-09-01')
  const ts = sheetTimestamp(new Date(Date.UTC(2026, 8, 17, 10, 30)))
  assert('a sheet timestamp is IST wall clock (10:30 IST = 05:00Z)', ts?.toISOString() === '2026-09-17T05:00:00.000Z', ts?.toISOString())
  assert('a text timestamp is IST wall clock too', sheetTimestamp('27/09/2025 12:35:39')?.toISOString() === '2025-09-27T07:05:39.000Z')
  assert('"000" in a number column is zero', sheetNumber('000') === 0 && sheetNumber('₹4,50,000') === 450000 && sheetNumber('') === null)
  assert('APPROVE and APPROVED mean approved', legacyDecision('APPROVE').status === 'approved' && legacyDecision(' approved ').status === 'approved')
  const rejected = legacyDecision('NOT APPROVED - DUPLICATE ENTRY')
  assert('"NOT APPROVED - reason" is a rejection with that reason', rejected.status === 'rejected' && rejected.reason === 'DUPLICATE ENTRY')
  assert('a blank decision is still pending', legacyDecision(null).status === 'pending' && legacyDecision('').recognised)
  assert('an unknown decision is flagged, not approved', legacyDecision('OK DONE').status === 'pending' && !legacyDecision('OK DONE').recognised)
  assert('paperwork statuses are read with spaces', paperworkValue('NOT REQUIRED') === 'NOT_REQUIRED' && paperworkValue('Document Uploaded') === 'DOCUMENT_UPLOADED' && paperworkValue('maybe') === null)

  const both = driveFileIds('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp https://lh3.googleusercontent.com/d/1ZyXwVuTsRqPoNmLk')
  assert('Drive ids come from open?id= and lh3 /d/ links', both.ids.join() === '1AbCdEfGhIjKlMnOp,1ZyXwVuTsRqPoNmLk')
  const foreign = driveFileIds('https://evil.example.com/d/1AbCdEfGhIjKlMnOp')
  assert('links outside Google Drive are never followed', foreign.ids.length === 0 && foreign.foreign[0] === 'evil.example.com')
  assert('a lookalike host is refused', driveFileIds('https://drive.google.com.evil.io/open?id=1AbCdEfGhIjKlMnOp').ids.length === 0)
  assert('a hyperlink cell is read by its target', driveFileIds({ text: 'photo', hyperlink: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view' }).ids[0] === '1AbCdEfGhIjKlMnOp')

  const names = canonicalNames(['MUZIM BHATT', 'MUZIM BHATT', 'MUZIM BHAT', 'GOURAV'])
  assert('near-identical spellings collapse to the most used one', names.map.get('MUZIM BHAT') === 'MUZIM BHATT' && names.merges.length === 1)
  assert('sheet locations match the list with or without "TATA"', matchLocation('LAMBERI', ['TATA LAMBERI']) === 'TATA LAMBERI' && matchLocation('TATA NARWAL', ['TATA NARWAL']) === 'TATA NARWAL' && matchLocation('JAMMU', ['TATA NARWAL']) === null)

  const row = new Array(headers.length).fill(null)
  row[1] = 'jk02ab1234'; row[2] = 'Nexon'; row[3] = new Date(Date.UTC(2025, 0, 5)); row[4] = 60000; row[5] = 6; row[6] = 'gourav'
  row[7] = 'lamberi'; row[8] = 'Tarun Malhotra'; row[9] = 70000; row[10] = '12/02/2025'; row[11] = 'broker'; row[12] = 'APPROVED'
  row[14] = { text: 'x', hyperlink: 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp' }; row[16] = 0; row[17] = '98765 43210'; row[18] = 636000
  const parsed = parseSheetRow(row, mapped.columns, 7)
  assert('a sheet row parses', parsed !== null && parsed.issues.every((i) => i.level !== 'error'), JSON.stringify(parsed?.issues))
  assert('its values are normalised', parsed?.regNo === 'JK02AB1234' && parsed.purchasedByRaw === 'GOURAV' && parsed.purchaseWhatsappApproverRaw === 'TARUN MALHOTRA')
  assert('its sale is read', parsed?.sale?.soldTo === 'BROKER' && parsed.sale.saleDate === '2025-02-12' && parsed.sale.buyerPhone === null)
  assert('its purchase is approved and its RC link is kept', parsed?.purchase.status === 'approved' && parsed.files[0]?.kind === 'rc')
  assert('a price-with-GST disagreement is reported for the owner', Boolean(parsed?.issues.some((i) => i.field === 'PURCHASE PRICE WITH GST')))
  assert('a placeholder zero phone is reported and dropped', Boolean(parsed?.issues.some((i) => i.field === '2ND PARTY CONTACT')))
  const empty = parseSheetRow(new Array(headers.length).fill(null), mapped.columns, 9)
  assert('an empty row is skipped', empty === null)
  const bad = [...row]; bad[10] = '31/02/2025'
  assert('a sale with an unreadable date blocks the row', Boolean(parseSheetRow(bad, mapped.columns, 8)?.issues.some((i) => i.level === 'error' && i.field === 'DATE OF SALE')))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n9c) Redaction and the MIS (serialize, insights-core)')
{
  const now = new Date('2026-09-10T06:00:00Z')
  const record = {
    id: '00000000-0000-4000-8000-000000000001', stockNo: 7, regNo: 'JK02AB1234', regNoKey: 'JK02AB1234', model: 'Nexon', colour: 'Red',
    manufacturingYear: 2021, odometerKm: 1000, engineNo: 'E1', chassisNo: 'C1', location: 'TATA NARWAL',
    purchaseDate: '2026-08-01', purchasePrice: '100000.00', purchaseGstPct: '6.00', expectedProfit: null, purchaseRemarks: null,
    purchaseFinanced: false, purchasedBy: 'GOURAV', salesConsultant: null, sellerPhone: '9876543210', purchaseWhatsappApprover: 'NOT_TAKEN',
    purchaseStatus: 'approved', purchaseSubmittedBy: null, purchaseSubmittedByName: null, purchaseSubmittedAt: null,
    purchaseDecidedBy: null, purchaseDecidedByName: 'X', purchaseDecidedAt: now, purchaseDecisionReason: null,
    saleStatus: 'pending', saleDate: '2026-09-01', sellingPrice: '130000.00', otherCost: '2000.00', isDemo: false, soldTo: 'BROKER',
    saleFinanced: false, soldBy: 'GOURAV', buyerName: 'B', buyerPhone: '9123456780', buyerAddress: 'Jammu', saleWhatsappApprover: 'NOT_TAKEN',
    saleSubmittedBy: null, saleSubmittedByName: null, saleSubmittedAt: now, saleDecidedBy: null, saleDecidedByName: null, saleDecidedAt: null,
    saleDecisionReason: null, insuranceEndDate: null, hypothecation: 'UNDER_PROCESS', rtoStatus: null, documentsRemarks: null,
    documentsUpdatedBy: null, documentsUpdatedByName: null, documentsUpdatedAt: null, brokerRcRemarks: null, brokerRcUpdatedBy: null,
    brokerRcUpdatedByName: null, brokerRcUpdatedAt: null, paymentVerifiedBy: null, paymentVerifiedByName: null, paymentVerifiedAt: null,
    createdBy: null, createdByName: 'T', createdAt: now, updatedBy: null, updatedByName: null, updatedAt: now, deletedAt: null,
    deletedBy: null, deletedByName: null, deleteReason: null, importBatch: null, importRow: null,
    activeBooking: null, presentFiles: ['rc', 'buyer_pan'], purchaseEditedAfterApproval: false, saleEditedAfterApproval: false,
  } as unknown as VehicleListRecord
  const row = buildVehicleRow(record, { today: '2026-09-17', rates: [{ effectiveFrom: '2000-01-01', ratePct: 12 }] })
  assert('a row carries no phone number or address', !JSON.stringify(row).includes('9876543210') && !JSON.stringify(row).includes('Jammu'))
  assert('a row computes the money', row.economics.grossProfit === 28000 && row.economics.interestDays === 31 && row.economics.netProfit === 20981)
  assert('a row flags the broker RC, the ledger and hypothecation', row.flags.brokerRcPending && row.flags.ledgerPending && row.flags.paperworkPending)
  const files = [{
    id: 'f1', vehicleId: record.id, bookingId: null, kind: 'buyer_pan', storagePath: 'x/buyer_pan/f1.jpg', contentType: 'image/jpeg',
    sizeBytes: 1, sha256: 'x', originalName: null, source: 'upload', legacyUrl: null, uploadedBy: null, uploadedByName: 'T',
    uploadedAt: now, attachedAt: now, supersededAt: null, supersededBy: null,
  }, {
    id: 'f2', vehicleId: record.id, bookingId: null, kind: 'rc', storagePath: 'x/rc/f2.jpg', contentType: 'image/jpeg',
    sizeBytes: 1, sha256: 'x', originalName: null, source: 'upload', legacyUrl: null, uploadedBy: null, uploadedByName: 'T',
    uploadedAt: now, attachedAt: now, supersededAt: null, supersededBy: null,
  }]
  const signed = { 'x/buyer_pan/f1.jpg': 'https://signed/pan', 'x/rc/f2.jpg': 'https://signed/rc' }
  const user = { id: 'u1', name: 'T' }
  const viewer = deriveCapabilities(user, { [HP_PERMISSION_KEYS.registerView]: true }, false)
  const desk = deriveCapabilities(user, { [HP_PERMISSION_KEYS.registerView]: true, [HP_PERMISSION_KEYS.registerEdit]: true }, false)
  const parts = { bookings: [], files: files as never, events: [], signed }
  const forViewer = buildVehicleDetail(row, record as never, viewer, parts)
  const forDesk = buildVehicleDetail(row, record as never, desk, parts)
  assert('a viewer gets masked phones and no address', forViewer.sellerPhone === '••••••3210' && forViewer.buyerPhone === '••••••6780' && forViewer.buyerAddress === null && forViewer.redacted)
  assert('a viewer sees the PAN exists but gets no link to it', forViewer.files.find((f) => f.kind === 'buyer_pan')?.canOpen === false && forViewer.files.find((f) => f.kind === 'buyer_pan')?.previewUrl === null)
  assert('a viewer gets the RC preview', forViewer.files.find((f) => f.kind === 'rc')?.previewUrl === 'https://signed/rc')
  assert('the desk gets full values', forDesk.sellerPhone === '9876543210' && forDesk.buyerAddress === 'Jammu' && !forDesk.redacted)
  assert('a PAN is never pre-signed, even for the desk', forDesk.files.find((f) => f.kind === 'buyer_pan')?.previewUrl === null && forDesk.files.find((f) => f.kind === 'buyer_pan')?.canOpen === true)

  const other = { ...row, id: 'r2', purchaseStatus: 'rejected', saleStatus: null, saleDate: null, sellingPrice: null, stage: 'in_stock' as const, purchaseDate: '2026-09-02' }
  const mis = computeInsights([row, other], [], { ...DEFAULT_INSIGHT_FILTERS('2026-09-17'), month: 9 }, '2026-09-17')
  assert('the MIS counts the sale in its sale month', mis.period.soldCount === 1 && mis.period.netProfit === 20981)
  assert('the MIS leaves rejected purchases out', mis.period.purchasedCount === 0 && mis.stock.count === 0)
  const august = computeInsights([row], [], { ...DEFAULT_INSIGHT_FILTERS('2026-09-17'), month: 8 }, '2026-09-17')
  assert('the purchase counts in its own month', august.period.purchasedCount === 1 && august.period.soldCount === 0)
  assert('the year runs month by month to today', computeInsights([row], [], DEFAULT_INSIGHT_FILTERS('2026-09-17'), '2026-09-17').months.length === 9)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
async function live() {
  console.log('\n10) Live database (read-only)')
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('  [SKIP] DATABASE_URL is not set')
    return
  }
  const sql = postgres(url, { prepare: false, max: 1, ssl: { rejectUnauthorized: false }, connect_timeout: 15 })
  try {
    await sql.begin('READ ONLY', async (tx) => {
      const samples = ['jk-02 ab 1234', 'JK–02–AB–1234', '22 bh 1234 aa', 'mh12ab0001']
      for (const sample of samples) {
        const [row] = await tx<{ k: string }[]>`SELECT upper(regexp_replace(${sample}, '[^A-Za-z0-9]', '', 'g')) AS k`
        assert(`Postgres and normalizeRegNo agree on ${JSON.stringify(sample)}`, row.k === normalizeRegNo(sample), `${row.k} vs ${normalizeRegNo(sample)}`)
      }

      const tables = await tx<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relkind = 'r' AND relname LIKE 'tata_h_promise_%'`
      if (tables.length === 0) {
        warn('migration 0072 is not applied yet — run scripts/apply-migration-0072.ts on port 5432')
        return
      }
      assert('all seven H Promise tables exist', tables.length === 7, tables.map((t) => t.relname).join(', '))
      assert('RLS is on for every table', tables.every((t) => t.relrowsecurity))
      const grants = await tx<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.role_table_grants
        WHERE table_name LIKE 'tata_h_promise_%' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`
      assert('anon/authenticated/PUBLIC hold no grants', grants.length === 0, grants.map((g) => g.table_name).join(', '))
      const triggers = await tx<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'tata_h_promise_%'`
      assert('the price-lock and append-only triggers exist', triggers.length === 3)
    })
  } catch (error) {
    failures += 1
    console.log(`  [FAIL] live checks could not run: ${error instanceof Error ? error.message : error}`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

live().then(() => {
  console.log(failures === 0
    ? `\n=== ALL CHECKS PASSED${warnings ? ` (${warnings} warning${warnings === 1 ? '' : 's'})` : ''} ===`
    : `\n=== ${failures} FAILURE(S) ===`)
  process.exit(failures === 0 ? 0 : 1)
})
