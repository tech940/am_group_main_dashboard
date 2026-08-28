import 'server-only'

// Force-reload cockpit data module to clear stale cache
import { sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import { getCaBranchSummary } from '@/lib/ca/ca-data'
import { getKiaWorkshopSummary } from '@/lib/kia/workshop-summary'
import { getBrandSalesSnapshot, getBrandStockSnapshot, type BrandSalesSnapshot, type BrandStockSnapshot } from '@/lib/brands/sales-stock'
import { availableSalesStockBrands } from '@/lib/brands/sales-stock-sources'
import { fetchCanonicalHyundaiRoBillingMetrics } from '@/lib/hyundai/business-excellence-metrics'
import { fetchCanonicalRoBillingMetrics } from '@/lib/platinum/business-excellence-metrics'

// Executive Group Cockpit — a single cross-brand, month-to-date rollup for leadership. It reuses the
// EXACT canonical aggregations that power each brand's own screens, so every figure ties back to the
// source report to the rupee:
//   Service revenue (labour + parts, deduped JC count, MTD vs same-period-last-year):
//     · KIA      → getKiaWorkshopSummary            (ro_billing_report)
//     · Hyundai  → fetchCanonicalHyundaiRoBillingMetrics (hyundai_ro_billing_report)
//     · Platinum → fetchCanonicalRoBillingMetrics        (am_platinum_ro_billing_report)
//     (MG + the two-wheeler brands have NO service data — omitted, not zero-padded.)
//   Approved cash (branch-wise, all brands) → getCaBranchSummary (approved POs + petty cash).
//   Vehicle sales & stock (per available brand — KIA only today) → lib/brands/sales-stock dispatcher.
//
// Service data lives in analyticsDb; cash/sales/stock helpers hit the app db + analyticsDb. They are
// independent, so the loader fans them out in parallel and the whole payload is short-cached.

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
  poAmount: number
  poCount: number
  fundingAmount: number
  spendAmount: number
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
    totals: { poAmount: number; poCount: number; fundingAmount: number; spendAmount: number }
  }
  sales: {
    brands: BrandSalesSnapshot[]
    totals: { deliveries: number; bookings: number }
  }
  stock: {
    brands: BrandStockSnapshot[]
    totals: { availableStock: number; stockValue: number }
  }
  freshness: {
    /** Newest upload across the feeds. Kept for compatibility — read `brands` for the honest picture. */
    service: string | null
    /** Per-feed, because the group max hides a laggard: one fresh feed made all three look current. */
    brands: { brand: string; brandLabel: string; lastUploadedAt: string | null; coverageThrough: string | null }[]
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
function num(v: unknown) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function growth(cy: number, ly: number): number | null {
  return ly > 0 ? Math.round(((cy - ly) / ly) * 1000) / 10 : null
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
  const entries = await Promise.all(SERVICE_BRANDS.map(async ({ brand, table }) => {
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
      if (rows.length === 0) return [brand, { lastBillDate: null, lastUploadedAt: null, failed: true }] as const
      const r = rows[0]
      return [brand, {
        lastBillDate: r.last_bill ? String(r.last_bill).slice(0, 10) : null,
        lastUploadedAt: r.last_upload ? new Date(String(r.last_upload)).toISOString() : null,
        failed: false,
      }] as const
    } catch {
      return [brand, { lastBillDate: null, lastUploadedAt: null, failed: true }] as const
    }
  }))
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

async function buildCockpit(endDate?: string | null): Promise<CockpitPayload> {
  const win = monthWindows(endDate)
  const [ey, em] = win.end.split('-').map(Number)

  // Vehicle sales & stock, per brand that has a live feed + reader (KIA only today). The registry
  // decides the set, so a new brand joins automatically once it flips to available.
  const salesStockBrands = availableSalesStockBrands()

  /*
   * ── EVERYTHING THAT DOES NOT NEED COVERAGE STARTS NOW ──────────────────────────────────────
   *
   * Coverage used to be awaited BEFORE the whole fan-out, so cash, sales and stock — none of which
   * look at it — sat idle behind a probe they have no relationship with. Measured: the probe costs
   * ~2.5s in-request (three MAX() aggregates over the RO feeds; each is only ~35ms of real work and
   * ~200ms of pooler round trip, the rest is first-connection setup), and the cold build was 7.8s.
   *
   * Only the three SERVICE queries consume the windows coverage produces. So those three wait; the
   * rest are kicked off first and overlap the probe entirely.
   *
   * ⚠️ Starting a promise before awaiting it is safe here ONLY because withDeadline already swallows
   * rejections (`work.catch(() => null)`). A bare promise started early and awaited late would be an
   * unhandled rejection in between. Do not remove that catch.
   */
  const cashPromise = withDeadline('approved cash', getCaBranchSummary({ from: null, to: null }), BUDGET.headline)
  // Per brand, not per batch: one slow brand must not take the others' cards with it.
  const salesPromise = Promise.all(salesStockBrands.map((s) => withDeadline(`${s.brand} sales`, getBrandSalesSnapshot(s.brand, { year: ey, month: em }), BUDGET.secondary)))
  const stockPromise = Promise.all(salesStockBrands.map((s) => withDeadline(`${s.brand} stock`, getBrandStockSnapshot(s.brand), BUDGET.secondary)))

  // Coverage: each brand's service window depends on how far its own feed reaches, so this probe has
  // to land before the per-brand billing queries fan out. Deadline-guarded: if it stalls, every brand
  // simply loses its lagging-window refinement rather than the whole page failing. `?? {}` keeps the
  // existing "no coverage" shape.
  const coverage = (await withDeadline('feed coverage', fetchFeedCoverage(win.monthStart, win.end), BUDGET.coverage)) ?? ({} as Awaited<ReturnType<typeof fetchFeedCoverage>>)
  const kiaWin = brandWindows(win, coverage.kia?.lastBillDate ?? null)
  const hyWin = brandWindows(win, coverage.hyundai?.lastBillDate ?? null)
  const plWin = brandWindows(win, coverage.platinum?.lastBillDate ?? null)

  const [kiaWs, hyundai, platinum, cash, salesSnapsRaw, stockSnapsRaw] = await Promise.all([
    withDeadline('kia workshop', getKiaWorkshopSummary({ endDate: kiaWin.cyEnd }), BUDGET.headline),
    withDeadline('hyundai ro billing', fetchCanonicalHyundaiRoBillingMetrics({ cyStart: hyWin.cyStart, cyEnd: hyWin.cyEnd, lyStart: hyWin.lyStart, lyEnd: hyWin.lyEnd }), BUDGET.headline),
    withDeadline('platinum ro billing', fetchCanonicalRoBillingMetrics({ cyStart: plWin.cyStart, cyEnd: plWin.cyEnd, lyStart: plWin.lyStart, lyEnd: plWin.lyEnd }), BUDGET.headline),
    // Cash is the CUMULATIVE approved book (no date filter) — a running commitment/spend total that an
    // exec/CA wants in full, and unlike MTD it is always populated. Service revenue stays month-to-date.
    cashPromise,
    salesPromise,
    stockPromise,
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

  // --- Approved cash per brand (all brands with activity) ---
  const cashRows: CockpitCashBrand[] = []
  if (cash) {
    for (const b of cash.branches) {
      cashRows.push({
        brand: b.branch, brandLabel: b.branchLabel,
        poAmount: b.po.approvedAmount, poCount: b.po.approvedCount,
        fundingAmount: b.pettyCashFunding.approvedAmount, spendAmount: b.pettyCashSpend.approvedAmount,
      })
    }
    if (cash.unassigned) {
      const u = cash.unassigned
      cashRows.push({
        brand: u.branch, brandLabel: u.branchLabel,
        poAmount: u.po.approvedAmount, poCount: u.po.approvedCount,
        fundingAmount: u.pettyCashFunding.approvedAmount, spendAmount: u.pettyCashSpend.approvedAmount,
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
    availableStock: 0, stockValue: 0, avgStockAge: 0,
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
      totals: {
        poAmount: num(cash?.totals.po.approvedAmount), poCount: num(cash?.totals.po.approvedCount),
        fundingAmount: num(cash?.totals.pettyCashFunding.approvedAmount), spendAmount: num(cash?.totals.pettyCashSpend.approvedAmount),
      },
    },
    sales: { brands: salesBrands, totals: salesTotals },
    stock: { brands: stockBrands, totals: stockTotals },
    freshness: {
      service: serviceBrands.map((b) => b.lastUploadedAt).filter(Boolean).sort().pop() ?? null,
      brands: serviceBrands.map((b) => ({
        brand: b.brand, brandLabel: b.brandLabel, lastUploadedAt: b.lastUploadedAt, coverageThrough: b.coverageThrough,
      })),
    },
  }
}

/*
 * ============================================================================
 * REQUEST BUDGET — why every source has a deadline
 * ============================================================================
 *
 * Every source below already carried `.catch(() => null)`, which covers a source that THROWS. It
 * does nothing for a source that simply does not come back, and that is what was happening: a cold
 * build (no cached key) was measured at over 240s against this route's `maxDuration = 60`, so the
 * platform killed the request mid-flight and the browser reported a bare "Failed to fetch". The
 * page was not slow — it was dead on every cache miss.
 *
 * The offender is the sales/stock fan-out (kia_sales_report, 90-day window grouped by model and
 * variant), which is also the least important thing on the page.
 *
 * So each source now races a deadline and degrades to `null` — the SAME value `.catch()` already
 * produced, travelling the same path, which the UI already renders honestly as "Data unavailable —
 * not counted in the group total" rather than a confident ₹0. The headline numbers (service revenue
 * and cash) get the large budget; the secondary cards get a small one and drop out first.
 *
 * The underlying query is not cancelled — it runs on and populates its own cache, so the NEXT
 * request is fast. What changes is that it can no longer hold the whole response hostage.
 */
const BUDGET = {
  /** Blocks the fan-out: every brand's window depends on it, so it must be quick or absent. */
  coverage: 8_000,
  /** Service revenue + approved cash — the figures an executive actually quotes. */
  headline: 30_000,
  /**
   * Sales & stock cards. Measured at 12-20s cold (the kia_sales_report 90-day model/variant
   * aggregate), so 12s dropped them almost every cold load. This runs CONCURRENTLY with the
   * headline budget, so raising it costs nothing in worst case — the ceiling stays
   * coverage + headline = 38s, comfortably inside maxDuration = 60.
   */
  secondary: 25_000,
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


export async function getGroupCockpit(input?: { endDate?: string | null }): Promise<CockpitPayload> {
  const win = monthWindows(input?.endDate)
  // Cache-key on the anchor month so a new day/month busts it; short TTL keeps it lively for exec use.
  // v5: sales targets fall back to last-month-actual + 10% (`targetBasis`). The key MUST be bumped
  // with a shape or semantics change — e.g. a v3 payload has no `status`, so every brand would fall
  // through as not-ok, and a v4 one would keep showing "target 0" until it expired.
  return getCachedData(`cockpit:group:v5:${win.monthStart}:${win.end}`, () => buildCockpit(input?.endDate), CACHE_TTL.SHORT)
}
