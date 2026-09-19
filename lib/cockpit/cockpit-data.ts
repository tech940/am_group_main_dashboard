import 'server-only'

import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData, setCachedData } from '@/lib/redis/cache-utils'
import { createDbGate } from '@/lib/db/concurrency'
import { getCaBranchSummary } from '@/lib/ca/ca-data'
import { getKiaWorkshopSummary } from '@/lib/kia/workshop-summary'
import { getBrandSalesSnapshot, getBrandStockSnapshot, type BrandSalesSnapshot, type BrandStockSnapshot } from '@/lib/brands/sales-stock'
import { availableSalesStockBrands } from '@/lib/brands/sales-stock-sources'
import { fetchCanonicalHyundaiRoBillingMetrics } from '@/lib/hyundai/business-excellence-metrics'
import { fetchCanonicalRoBillingMetrics } from '@/lib/platinum/business-excellence-metrics'
import { MD_APPROVAL_SOURCE_IDS, MD_APPROVAL_SOURCES } from '@/lib/md-approvals/sources'
import { listAllBankSanctionsForAlerts } from '@/lib/bank-sanctions/store'
import { currentReconMonth, listReconItems, readReconFreshness } from '@/lib/kia/dms-reconciliation/read'
import { RECON_EXCEPTION_TYPES, RECON_TYPE_META, type ReconSeverity } from '@/lib/kia/dms-reconciliation/types'

// Executive Group Cockpit — a single cross-brand, month-to-date rollup for leadership. It reuses the
// EXACT canonical aggregations that power each brand's own screens, so every figure ties back to the
// source report to the rupee:
//   Service revenue (labour + parts, deduped JC count, MTD vs same-period-last-year):
//     · KIA      → getKiaWorkshopSummary            (ro_billing_report)
//     · Hyundai  → fetchCanonicalHyundaiRoBillingMetrics (hyundai_ro_billing_report)
//     · Platinum → fetchCanonicalRoBillingMetrics        (am_platinum_ro_billing_report)
//     (MG + the two-wheeler brands have NO service data — omitted, not zero-padded.)
//   Approved cash (branch-wise, all brands) → getCaBranchSummary (vendor payments, POs, petty cash).
//   Vehicle sales & stock → lib/brands/sales-stock (KIA). Hyundai/Platinum retail is NOT read here: the
//     dashboard takes it from the India snapshot query the page already runs (useIndiaSnapshot), so it is
//     read once and can never disagree with the India table below (owner, 2026-09-19: retail = delivery date).
//   Waiting on the MD → the MD Approvals section's own readers (lib/md-approvals/sources).
//   Bank facilities expiring → lib/bank-sanctions/store.   KIA DMS exceptions → lib/kia/dms-reconciliation.
//
// ⚠️ analyticsDb and db are the SAME client and pool (ANALYTICS_READ_SOURCE=postgres).

const SERVICE_BRANDS = [
  { brand: 'kia', label: 'AM KIA', table: 'ro_billing_report' },
  { brand: 'hyundai', label: 'AM Hyundai', table: 'hyundai_ro_billing_report' },
  { brand: 'platinum', label: 'AM Platinum', table: 'am_platinum_ro_billing_report' },
] as const

// Why a brand's figures are or aren't in the group total:
//   ok        — real data; counted.
//   no_data   — the feed has no bills at all this month; shown as "no data", NOT as ₹0, and excluded.
//   unavailable — the read failed / the table is missing. Excluded and named, never silently zeroed.
export type CockpitServiceStatus = 'ok' | 'no_data' | 'unavailable'

export type CockpitServiceBrand = {
  brand: string
  brandLabel: string
  available: boolean
  status: CockpitServiceStatus
  /** Last bill_date this feed actually has in the month — the honest "data through" for this brand. */
  coverageThrough: string | null
  /** This feed's own MAX(uploaded_at). Per-brand: a group-wide max would hide the laggard. */
  lastUploadedAt: string | null
  /** True when the feed stops short of the anchor day, so CY/LY were narrowed to match. */
  lagging: boolean
  revenue: number
  labour: number
  parts: number
  roCount: number
  lyRevenue: number
  growthPct: number | null
}

export type CockpitCashBrand = {
  brand: string
  brandLabel: string
  /** Approved vendor payments (kia_approval_requests — every brand, despite the table name). */
  vendorPaymentAmount: number
  vendorPaymentCount: number
  poAmount: number
  poCount: number
  fundingAmount: number
  /** Approved petty-cash expenses — spent out of `fundingAmount`, so never added to a cash total. */
  spendAmount: number
}

export type CockpitMdQueue = {
  total: number
  sources: Array<{
    id: string
    label: string
    href: string
    count: number
    /** Sum of the waiting rows that carry a number. POs have none at the MD stage. */
    amount: number
    /** Waiting rows with no amount yet (shown as "value n/a", never as ₹0). */
    withoutAmount: number
    oldestDays: number | null
  }>
  byBranch: Array<{ branchLabel: string; count: number }>
}

export type CockpitBankFacilities = {
  total: number
  expired: { count: number; creditLimit: number }
  expiringSoon: { count: number; creditLimit: number; withinDays: number }
  /** The soonest expired-or-expiring facilities, oldest expiry first. */
  items: Array<{ loanType: string; location: string; expiryDate: string; creditLimit: number | null; expired: boolean }>
}

export type CockpitDmsExceptions = {
  month: string
  /** Exceptions + reviews — the DMS Exceptions tab's own badge (summary.total). */
  open: number
  review: number
  /** Open exceptions by type. Excludes unmatched DMS bookings, which the tab counts separately. */
  byType: Array<{ type: string; label: string; severity: ReconSeverity; count: number }>
  /** DMS bookings with no booking here — not in `open`, same as the tab. */
  unmatchedDms: number
  lastRunAt: string | null
  stale: boolean
}

export type CockpitPayload = {
  meta: { monthLabel: string; startDate: string; endDate: string; throughDay: number; generatedAt: string }
  service: {
    brands: CockpitServiceBrand[]
    totals: {
      revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null
      /** Labels of brands NOT in the total. Rendered — a silently short total is the bug we fixed. */
      excluded: string[]
    }
  }
  cash: {
    brands: CockpitCashBrand[]
    unassignedPresent: boolean
    available: boolean
    totals: {
      vendorPaymentAmount: number; vendorPaymentCount: number
      poAmount: number; poCount: number; fundingAmount: number; spendAmount: number
    }
  }
  sales: {
    brands: BrandSalesSnapshot[]
    totals: { deliveries: number; bookings: number }
  }
  stock: {
    brands: BrandStockSnapshot[]
    totals: { availableStock: number; stockValue: number }
  }
  /** MD / Developer only — stripped by the API for anyone else (see app/api/cockpit/route.ts). */
  mdQueue: CockpitMdQueue | null
  /** MD / Developer only — group-level facilities are theirs alone (lib/auth/bank-sanctions-access.ts). */
  bankFacilities: CockpitBankFacilities | null
  dmsExceptions: CockpitDmsExceptions | null
  freshness: {
    /** Newest upload across the feeds. Kept for compatibility — read `brands` for the honest picture. */
    service: string | null
    /** Per-feed, because the group max hides a laggard: one fresh feed made all three look current. */
    brands: { brand: string; brandLabel: string; lastUploadedAt: string | null; coverageThrough: string | null }[]
  }
  /**
   * Sections that could not be read this time (failed or over their deadline). A payload with any entry
   * is cached for ~1 minute only and never replaces the last complete one — see getGroupCockpit.
   */
  degraded: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function growth(cy: number, ly: number): number | null {
  return ly > 0 ? Math.round(((cy - ly) / ly) * 1000) / 10 : null
}
function addDaysYmd(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return ymd(d)
}

// MTD windows anchored on "today" in IST (so the day matches the dealership's calendar). LY uses the
// same month last year through the same day-of-month, mirroring getKiaWorkshopSummary exactly.
function monthWindows(endDate?: string | null) {
  const nowIst = new Date(Date.now() + 330 * 60_000)
  const end = endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : ymd(nowIst)
  const [ey, em, ed] = end.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate()
  const throughDay = Math.min(Math.max(ed, 1), daysInMonth)
  const monthStart = `${ey}-${pad(em)}-01`
  const lyDaysInMonth = new Date(Date.UTC(ey - 1, em, 0)).getUTCDate()
  const lyMonthStart = `${ey - 1}-${pad(em)}-01`
  const lyEnd = `${ey - 1}-${pad(em)}-${pad(Math.min(throughDay, lyDaysInMonth))}`
  const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
    .format(new Date(Date.UTC(ey, em - 1, 1)))
  return { end, monthStart, monthLabel, throughDay, lyMonthStart, lyEnd }
}

type FeedCoverage = {
  /** MAX(bill_date) inside the anchor month, clamped to the anchor day. Null = no bills this month. */
  lastBillDate: string | null
  lastUploadedAt: string | null
  /** The read itself failed — distinct from "no bills", which is a real business answer. */
  failed: boolean
}

// Per-feed coverage: how far into the month each RO-billing table ACTUALLY has bills, plus its own
// upload stamp. This one cheap probe underpins all three fixes:
//   · the "data through" shown per brand (the old ribbon took MAX across feeds, so one current feed
//     made a two-day-stale one look current);
//   · the like-for-like LY window (see brandWindows);
//   · telling "no bills this month" apart from "the read failed" — the latter must never render as ₹0.
// bill_date is clamped to the anchor day so a future-dated bill can't widen the window.
async function fetchFeedCoverage(monthStart: string, end: string): Promise<Record<string, FeedCoverage>> {
  // One feed at a time: this runs inside a cockpit gate slot, and the whole point of the gate is to keep
  // the number of simultaneous queries below what the pooler can serve (see COCKPIT_DB_CONCURRENCY).
  const entries: Array<readonly [string, FeedCoverage]> = []
  for (const { brand, table } of SERVICE_BRANDS) {
    try {
      const result = await analyticsDb.execute(sql`
        SELECT MAX(uploaded_at)::text AS last_upload,
               MAX(bill_date) FILTER (
                 WHERE bill_date >= ${monthStart}::date AND bill_date <= ${end}::date
               )::text AS last_bill
        FROM ${sql.raw(table)}`)
      const rows = Array.isArray(result) ? result as Record<string, unknown>[] : []
      // Aggregate-only SELECT: exactly one row is guaranteed. None => the read failed, and a null
      // coverage would wrongly read as "no bills this month".
      if (rows.length === 0) {
        entries.push([brand, { lastBillDate: null, lastUploadedAt: null, failed: true }])
        continue
      }
      const r = rows[0]
      entries.push([brand, {
        lastBillDate: r.last_bill ? String(r.last_bill).slice(0, 10) : null,
        lastUploadedAt: r.last_upload ? new Date(String(r.last_upload)).toISOString() : null,
        failed: false,
      }])
    } catch {
      entries.push([brand, { lastBillDate: null, lastUploadedAt: null, failed: true }])
    }
  }
  return Object.fromEntries(entries)
}

// Windows for ONE brand, narrowed to what that brand's feed actually covers.
//
// The bug this fixes: the cockpit asked every brand for 01..anchorDay of BOTH years. Hyundai's feed
// stops on the 14th, so its current-year revenue froze while last-year's kept accruing through the
// 16th — comparing 14 days against 16 and reporting +15.4% real growth as a -0.9% DECLINE. Any brand
// whose feed lags is structurally guaranteed to look like it is shrinking.
//
// So each brand compares only the days it actually has: CY 01..coverage vs LY 01..same day-of-month.
// Revenue is unaffected (there are no bills after coverage to include) — only the comparison is made
// honest, and `lagging` lets the UI say which days a brand is reporting on.
function brandWindows(win: ReturnType<typeof monthWindows>, coverageThrough: string | null) {
  const [ey, em] = win.end.split('-').map(Number)
  const coverageDay = coverageThrough ? Number(coverageThrough.slice(8, 10)) : win.throughDay
  const day = Math.min(Math.max(coverageDay, 1), win.throughDay)
  const lyDaysInMonth = new Date(Date.UTC(ey - 1, em, 0)).getUTCDate()
  return {
    cyStart: win.monthStart,
    cyEnd: `${ey}-${pad(em)}-${pad(day)}`,
    lyStart: win.lyMonthStart,
    lyEnd: `${ey - 1}-${pad(em)}-${pad(Math.min(day, lyDaysInMonth))}`,
    lagging: day < win.throughDay,
  }
}

// ── New blocks (2026-09-19) ─────────────────────────────────────────────────────────────────────────

/** Everything waiting on the MD right now, by source — the MD Approvals section's own definition. */
async function readMdQueue(): Promise<CockpitMdQueue> {
  const now = Date.now()
  const sources: CockpitMdQueue['sources'] = []
  const byBranch = new Map<string, number>()
  // Sequential on purpose: three small reads inside one gate slot (see COCKPIT_DB_CONCURRENCY).
  for (const id of MD_APPROVAL_SOURCE_IDS) {
    const source = MD_APPROVAL_SOURCES[id]
    const waiting = (await source.read()).filter((row) => row.awaitingMd)
    let amount = 0
    let withoutAmount = 0
    let oldest: number | null = null
    for (const row of waiting) {
      if (row.amount === null) withoutAmount += 1
      else amount += row.amount
      const created = row.createdAt ? Date.parse(row.createdAt) : NaN
      if (Number.isFinite(created)) oldest = oldest === null ? created : Math.min(oldest, created)
      const label = row.branchLabel || 'Unassigned'
      byBranch.set(label, (byBranch.get(label) ?? 0) + 1)
    }
    sources.push({
      id, label: source.label, href: source.href, count: waiting.length, amount, withoutAmount,
      oldestDays: oldest === null ? null : Math.max(0, Math.floor((now - oldest) / 86_400_000)),
    })
  }
  return {
    total: sources.reduce((a, s) => a + s.count, 0),
    sources,
    byBranch: [...byBranch.entries()].map(([branchLabel, count]) => ({ branchLabel, count })).sort((a, b) => b.count - a.count),
  }
}

const EXPIRING_WITHIN_DAYS = 30

/** Bank credit facilities that have expired or expire within 30 days (IST calendar days). */
async function readBankFacilities(today: string): Promise<CockpitBankFacilities> {
  const records = await listAllBankSanctionsForAlerts()
  const horizon = addDaysYmd(today, EXPIRING_WITHIN_DAYS)
  const expired = records.filter((r) => r.expiryDate && r.expiryDate < today)
  const soon = records.filter((r) => r.expiryDate && r.expiryDate >= today && r.expiryDate <= horizon)
  const sum = (list: typeof records) => list.reduce((a, r) => a + (r.creditLimit ?? 0), 0)
  // What is about to lapse first (soonest first), then what already has (most recent first): a facility that
  // expired two years ago and was never renewed matters less than one expiring next week.
  const byDate = (a: typeof records[number], b: typeof records[number]) => String(a.expiryDate).localeCompare(String(b.expiryDate))
  const items = [...[...soon].sort(byDate), ...[...expired].sort(byDate).reverse()]
    .slice(0, 8)
    .map((r) => ({
      loanType: r.loanType, location: r.location, expiryDate: String(r.expiryDate),
      creditLimit: r.creditLimit, expired: String(r.expiryDate) < today,
    }))
  return {
    total: records.length,
    expired: { count: expired.length, creditLimit: sum(expired) },
    expiringSoon: { count: soon.length, creditLimit: sum(soon), withinDays: EXPIRING_WITHIN_DAYS },
    items,
  }
}

/** Open KIA DMS exceptions for the current booking month — the DMS Exceptions tab's own summary. */
async function readDmsExceptions(): Promise<CockpitDmsExceptions> {
  const month = currentReconMonth()
  // Aggregates only, all branches, no PII: the viewer shape the tab uses for a group-wide count.
  const viewer = { dealerScope: null, canViewPii: false }
  const list = await listReconItems({ month, type: 'all', q: '', page: 1, pageSize: 1 }, viewer)
  const fresh = await readReconFreshness()
  const byType = RECON_EXCEPTION_TYPES.filter((type) => type !== 'unmatched_dms').map((type) => ({
    type, label: RECON_TYPE_META[type].label, severity: RECON_TYPE_META[type].severity, count: num(list.summary.byType[type]),
  })).filter((t) => t.count > 0)
  return {
    month,
    open: num(list.summary.total),
    review: num(list.summary.review),
    byType,
    unmatchedDms: num(list.summary.byType.unmatched_dms),
    lastRunAt: fresh.freshness.lastRunAt,
    stale: fresh.stale,
  }
}

/*
 * ============================================================================
 * CONCURRENCY — why the sources run two at a time
 * ============================================================================
 *
 * Production reads through Supabase's TRANSACTION pooler, which serves this project with only about six
 * server connections (measured; see lib/db/concurrency.ts). Fire more queries than that at once and they do
 * not queue — they STALL until something times out.
 *
 * The cockpit used to start every source together, and each source fans out several queries of its own. On
 * 2026-09-19, three cold builds in a row took 25–33s and each DROPPED a section (KIA sales, and KIA service
 * revenue — rendered "unavailable" and left out of the group total). Measured with the same sources:
 *     all at once → 25–33s, sections missing          two at a time → 7.1–7.4s, complete
 *     one at a time → ~11s, complete
 * So every source goes through one gate of two. The order they are queued in is the order they run: the
 * figures an executive quotes (service revenue, cash) first, then the rest.
 */
const COCKPIT_DB_CONCURRENCY = 2

async function buildCockpit(endDate?: string | null): Promise<CockpitPayload> {
  const win = monthWindows(endDate)
  const [ey, em] = win.end.split('-').map(Number)
  const gate = createDbGate(COCKPIT_DB_CONCURRENCY)
  const run = <T,>(label: string, work: () => Promise<T>, ms: number) => withDeadline(label, gate(work), ms)

  // Vehicle sales & stock, per brand that has a live feed + reader (KIA only today). The registry
  // decides the set, so a new brand joins automatically once it flips to available.
  const salesStockBrands = availableSalesStockBrands()

  // Coverage first (every brand's service window depends on it), cash beside it.
  const coveragePromise = run('feed coverage', () => fetchFeedCoverage(win.monthStart, win.end), BUDGET.coverage)
  const cashPromise = run('approved cash', () => getCaBranchSummary({ from: null, to: null }), BUDGET.headline)
  const coverage = (await coveragePromise) ?? ({} as Awaited<ReturnType<typeof fetchFeedCoverage>>)
  const kiaWin = brandWindows(win, coverage.kia?.lastBillDate ?? null)
  const hyWin = brandWindows(win, coverage.hyundai?.lastBillDate ?? null)
  const plWin = brandWindows(win, coverage.platinum?.lastBillDate ?? null)

  // Queued in priority order — the gate is first-in, first-out.
  const kiaWsP = run('kia workshop', () => getKiaWorkshopSummary({ endDate: kiaWin.cyEnd }), BUDGET.headline)
  const hyundaiP = run('hyundai ro billing', () => fetchCanonicalHyundaiRoBillingMetrics({ cyStart: hyWin.cyStart, cyEnd: hyWin.cyEnd, lyStart: hyWin.lyStart, lyEnd: hyWin.lyEnd }), BUDGET.headline)
  const platinumP = run('platinum ro billing', () => fetchCanonicalRoBillingMetrics({ cyStart: plWin.cyStart, cyEnd: plWin.cyEnd, lyStart: plWin.lyStart, lyEnd: plWin.lyEnd }), BUDGET.headline)
  // Per brand, not per batch: one slow brand must not take the others' cards with it.
  const salesP = Promise.all(salesStockBrands.map((s) => run(`${s.brand} sales`, () => getBrandSalesSnapshot(s.brand, { year: ey, month: em }), BUDGET.secondary)))
  const stockP = Promise.all(salesStockBrands.map((s) => run(`${s.brand} stock`, () => getBrandStockSnapshot(s.brand), BUDGET.secondary)))
  const mdQueueP = run('md queue', readMdQueue, BUDGET.secondary)
  const bankP = run('bank facilities', () => readBankFacilities(win.end), BUDGET.secondary)
  const dmsP = run('dms exceptions', readDmsExceptions, BUDGET.secondary)

  const [kiaWs, hyundai, platinum, cash, salesSnapsRaw, stockSnapsRaw, mdQueue, bankFacilities, dmsExceptions] = await Promise.all([
    kiaWsP, hyundaiP, platinumP, cashPromise, salesP, stockP, mdQueueP, bankP, dmsP,
  ])
  const salesSnaps = salesSnapsRaw ?? []
  const stockSnaps = stockSnapsRaw ?? []

  // --- Service revenue per brand ---
  //
  // The rule: NEVER present a figure we did not actually read. `metrics === null` means the query
  // threw (or the source is missing); coverage.failed means even the probe could not read the table.
  // Both are `unavailable` — excluded from the total and named, not rendered as ₹0. Only a feed that
  // demonstrably has no bills this month is `no_data`. This is the whole point: the cockpit reported
  // Hyundai as a confident "₹0.00" off a cached failed read, understating group revenue by ~53%.
  // Each brand's reader has its own shape (KIA reports total/lyTotal + roCount; Hyundai/Platinum
  // report cy/ly + dedupedJc), so flatten to one shape first and keep the status rules below readable.
  // `null` here means "did not read it" — never "zero".
  type Figures = { revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number } | null
  const figuresFor = (brand: string): Figures => {
    if (brand === 'kia') {
      if (!kiaWs) return null
      return {
        revenue: num(kiaWs.total.billing), labour: num(kiaWs.total.labour), parts: num(kiaWs.total.parts),
        roCount: num(kiaWs.total.roCount), lyRevenue: num(kiaWs.lyTotal.billing),
      }
    }
    const m = brand === 'hyundai' ? hyundai : platinum
    if (!m || !m.sourceAvailable) return null
    return {
      revenue: num(m.cy.revenue), labour: num(m.cy.labour), parts: num(m.cy.parts),
      roCount: num(m.cy.dedupedJc), lyRevenue: num(m.ly.revenue),
    }
  }

  const ZERO = { revenue: 0, labour: 0, parts: 0, roCount: 0, lyRevenue: 0 }
  const serviceBrands: CockpitServiceBrand[] = SERVICE_BRANDS.map(({ brand, label }) => {
    const cov = coverage[brand] ?? { lastBillDate: null, lastUploadedAt: null, failed: true }
    const w = brand === 'kia' ? kiaWin : brand === 'hyundai' ? hyWin : plWin
    const fig = figuresFor(brand)

    // cov.failed or fig === null => we could not read it. cov.lastBillDate === null => read fine, this
    // feed simply has no bills this month. Only the latter is a real business answer.
    const status: CockpitServiceStatus = cov.failed || !fig ? 'unavailable' : cov.lastBillDate ? 'ok' : 'no_data'
    const f = status === 'ok' && fig ? fig : ZERO

    return {
      brand, brandLabel: label,
      available: status === 'ok',
      status,
      coverageThrough: cov.lastBillDate,
      lastUploadedAt: cov.lastUploadedAt,
      lagging: status === 'ok' && w.lagging,
      ...f,
      growthPct: status === 'ok' ? growth(f.revenue, f.lyRevenue) : null,
    }
  })
  const counted = serviceBrands.filter((b) => b.status === 'ok')
  const serviceTotals = counted.reduce(
    (acc, b) => {
      acc.revenue += b.revenue; acc.labour += b.labour; acc.parts += b.parts
      acc.roCount += b.roCount; acc.lyRevenue += b.lyRevenue
      return acc
    },
    { revenue: 0, labour: 0, parts: 0, roCount: 0, lyRevenue: 0 },
  )
  const excluded = serviceBrands.filter((b) => b.status !== 'ok').map((b) => b.brandLabel)

  // --- Approved cash per branch (all brands with activity) ---
  // Vendor payments were fetched here all along and thrown away — the largest cash category (₹2.74 Cr on
  // 2026-09-19 against ₹4.6L of petty-cash funding). Spend used to be a hard-coded 0.
  const cashRows: CockpitCashBrand[] = []
  if (cash) {
    for (const b of [...cash.branches, ...(cash.unassigned ? [cash.unassigned] : [])]) {
      cashRows.push({
        brand: b.branch, brandLabel: b.branchLabel,
        vendorPaymentAmount: b.approvals.approvedAmount, vendorPaymentCount: b.approvals.approvedCount,
        poAmount: b.po.approvedAmount, poCount: b.po.approvedCount,
        fundingAmount: b.pettyCashFunding.approvedAmount, spendAmount: b.pettyCashSpend.approvedAmount,
      })
    }
  }

  // --- Vehicle sales & stock per available brand (KIA only today) ---
  //
  // A source that timed out is kept as `available: false`, NOT dropped. Filtering it out made the UI
  // fall through to "No vehicle stock feed is connected yet" — telling an executive the feed does not
  // exist when it exists and merely did not answer in time. That is the same class of lie as printing
  // ₹0 for a failed read, which is the thing this whole file was written to stop.
  const salesBrands = salesSnaps.map((snap, i) => snap ?? ({
    brand: salesStockBrands[i]?.brand ?? 'unknown',
    label: salesStockBrands[i]?.label ?? 'Unknown',
    available: false,
    monthLabel: null, bookings: 0, deliveries: 0, conversion: 0,
    bookingTarget: 0, deliveryTarget: 0, bookingAchievement: null, deliveryAchievement: null,
    consultants: 0, targetBasis: null,
  } as unknown as BrandSalesSnapshot))
  const stockBrands = stockSnaps.map((snap, i) => snap ?? ({
    brand: salesStockBrands[i]?.brand ?? 'unknown',
    label: salesStockBrands[i]?.label ?? 'Unknown',
    available: false,
    availableStock: 0, stockValue: 0, avgStockAge: 0, aged61To90: 0, agedOver90: 0,
  } as unknown as BrandStockSnapshot))
  // Placeholders are excluded from totals — an unread feed must not contribute a real zero.
  const salesTotals = salesBrands.filter((b) => b.available !== false).reduce(
    (a, b) => ({ deliveries: a.deliveries + b.deliveries, bookings: a.bookings + b.bookings }),
    { deliveries: 0, bookings: 0 },
  )
  const stockTotals = stockBrands.filter((b) => b.available !== false).reduce(
    (a, b) => ({ availableStock: a.availableStock + b.availableStock, stockValue: a.stockValue + b.stockValue }),
    { availableStock: 0, stockValue: 0 },
  )

  // Every section that did not come back, named — drives the short cache life (see getGroupCockpit).
  const degraded = [
    ...excluded.filter((label) => serviceBrands.find((b) => b.brandLabel === label)?.status === 'unavailable').map((l) => `${l} service`),
    ...(cash ? [] : ['approved cash']),
    ...salesBrands.filter((b) => b.available === false).map((b) => `${b.label} sales`),
    ...stockBrands.filter((b) => b.available === false).map((b) => `${b.label} stock`),
    ...(mdQueue ? [] : ['waiting on MD']),
    ...(bankFacilities ? [] : ['bank facilities']),
    ...(dmsExceptions ? [] : ['DMS exceptions']),
  ]

  return {
    meta: {
      monthLabel: win.monthLabel, startDate: win.monthStart, endDate: win.end,
      throughDay: win.throughDay, generatedAt: new Date().toISOString(),
    },
    service: {
      brands: serviceBrands,
      totals: { ...serviceTotals, growthPct: growth(serviceTotals.revenue, serviceTotals.lyRevenue), excluded },
    },
    cash: {
      brands: cashRows,
      unassignedPresent: Boolean(cash?.unassigned),
      available: Boolean(cash),
      totals: {
        vendorPaymentAmount: num(cash?.totals.approvals.approvedAmount), vendorPaymentCount: num(cash?.totals.approvals.approvedCount),
        poAmount: num(cash?.totals.po.approvedAmount), poCount: num(cash?.totals.po.approvedCount),
        fundingAmount: num(cash?.totals.pettyCashFunding.approvedAmount), spendAmount: num(cash?.totals.pettyCashSpend.approvedAmount),
      },
    },
    sales: { brands: salesBrands, totals: salesTotals },
    stock: { brands: stockBrands, totals: stockTotals },
    mdQueue,
    bankFacilities,
    dmsExceptions,
    freshness: {
      service: serviceBrands.map((b) => b.lastUploadedAt).filter(Boolean).sort().pop() ?? null,
      brands: serviceBrands.map((b) => ({
        brand: b.brand, brandLabel: b.brandLabel, lastUploadedAt: b.lastUploadedAt, coverageThrough: b.coverageThrough,
      })),
    },
    degraded,
  }
}

/*
 * ============================================================================
 * REQUEST BUDGET — why every source has a deadline
 * ============================================================================
 *
 * Every source below already carried `.catch(() => null)`, which covers a source that THROWS. It
 * does nothing for a source that simply does not come back — which is exactly what a stalled pooler
 * does (see CONCURRENCY above). A stalled build used to run past this route's `maxDuration = 60` and
 * the platform killed it mid-flight, which the browser reported as a bare "Failed to fetch".
 *
 * So each source races a deadline and degrades to `null` — the SAME value `.catch()` already
 * produced, travelling the same path, which the UI renders honestly as "could not be read — not
 * counted" rather than a confident ₹0. A deadline counts from when the source is QUEUED, not when it
 * starts, so the budgets include the wait for a gate slot. Two at a time, the whole build measured
 * 7–9s cold, far inside these.
 *
 * The underlying query is not cancelled — it runs on and populates its own cache, so the NEXT
 * request is fast. What changes is that it can no longer hold the whole response hostage.
 */
const BUDGET = {
  /** Blocks the fan-out: every brand's window depends on it, so it must be quick or absent. */
  coverage: 8_000,
  /** Service revenue + approved cash — the figures an executive actually quotes. */
  headline: 30_000,
  /** Everything else. Runs after the headline sources in the same gate; ceiling stays inside maxDuration. */
  secondary: 40_000,
} as const

function withDeadline<T>(label: string, work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[cockpit] ${label} exceeded ${ms}ms — omitted from this response, not shown as zero`)
      resolve(null)
    }, ms)
  })
  return Promise.race([work.catch(() => null), guard]).finally(() => { if (timer) clearTimeout(timer) })
}

/**
 * 15 minutes, refreshed every 10 by the scheduled warmer (app/api/cockpit/refresh), so the MD opens a
 * built cockpit instead of paying for a cold build.
 */
const COCKPIT_TTL_SECONDS = 15 * 60
/** A payload with a section missing: kept briefly so the next viewer retries, never as the stale fallback. */
const DEGRADED_TTL_SECONDS = 60

function cockpitKey(endDate?: string | null) {
  const win = monthWindows(endDate)
  // Cache-key on the anchor day so a new day/month busts it. v7: vendor payments, real petty-cash spend,
  // stock ageing, MD queue, bank facilities, DMS exceptions and `degraded` — the key MUST be
  // bumped with a shape change, or a v6 payload (no `degraded`, spend 0) would be served until it expired.
  return `cockpit:group:v7:${win.monthStart}:${win.end}`
}

export async function getGroupCockpit(input?: { endDate?: string | null }): Promise<CockpitPayload> {
  return getCachedData(cockpitKey(input?.endDate), () => buildCockpit(input?.endDate), COCKPIT_TTL_SECONDS, {
    ttlFor: (payload) => (payload.degraded.length > 0 ? DEGRADED_TTL_SECONDS : null),
  })
}

/**
 * Build today's cockpit off the request path and store it — for the scheduled warmer. A build with any
 * section missing is NOT stored: the last complete cockpit keeps being served instead.
 */
export async function refreshGroupCockpit(): Promise<{ stored: boolean; degraded: string[]; ms: number }> {
  const started = Date.now()
  const payload = await buildCockpit(null)
  if (payload.degraded.length === 0) await setCachedData(cockpitKey(null), payload, COCKPIT_TTL_SECONDS)
  return { stored: payload.degraded.length === 0, degraded: payload.degraded, ms: Date.now() - started }
}
