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
  { brand: 'kia', label: 'AM KIA' },
  { brand: 'hyundai', label: 'AM Hyundai' },
  { brand: 'platinum', label: 'AM Platinum' },
] as const

export type CockpitServiceBrand = {
  brand: string
  brandLabel: string
  available: boolean
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
    totals: { revenue: number; labour: number; parts: number; roCount: number; lyRevenue: number; growthPct: number | null }
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
  freshness: { service: string | null }
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

// Newest MAX(uploaded_at) across the three RO-billing feeds → the "service data as of" ribbon. Any
// table that is missing/unreadable is skipped rather than failing the whole cockpit.
async function fetchServiceFreshness(): Promise<string | null> {
  const tables = ['ro_billing_report', 'hyundai_ro_billing_report', 'am_platinum_ro_billing_report']
  const stamps = await Promise.all(tables.map(async (table) => {
    try {
      const result = await analyticsDb.execute(sql`SELECT MAX(uploaded_at) AS ts FROM ${sql.raw(table)}`)
      const rows = Array.isArray(result) ? result as Record<string, unknown>[] : []
      const ts = rows[0]?.ts
      return ts ? new Date(String(ts)).getTime() : null
    } catch {
      return null
    }
  }))
  const valid = stamps.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null
}

async function buildCockpit(endDate?: string | null): Promise<CockpitPayload> {
  const win = monthWindows(endDate)
  const [ey, em] = win.end.split('-').map(Number)

  // Vehicle sales & stock, per brand that has a live feed + reader (KIA only today). The registry
  // decides the set, so a new brand joins automatically once it flips to available.
  const salesStockBrands = availableSalesStockBrands()
  const [kiaWs, hyundai, platinum, cash, serviceFreshness, salesSnaps, stockSnaps] = await Promise.all([
    getKiaWorkshopSummary({ endDate: win.end }).catch(() => null),
    fetchCanonicalHyundaiRoBillingMetrics({ cyStart: win.monthStart, cyEnd: win.end, lyStart: win.lyMonthStart, lyEnd: win.lyEnd }).catch(() => null),
    fetchCanonicalRoBillingMetrics({ cyStart: win.monthStart, cyEnd: win.end, lyStart: win.lyMonthStart, lyEnd: win.lyEnd }).catch(() => null),
    // Cash is the CUMULATIVE approved book (no date filter) — a running commitment/spend total that an
    // exec/CA wants in full, and unlike MTD it is always populated. Service revenue stays month-to-date.
    getCaBranchSummary({ from: null, to: null }).catch(() => null),
    fetchServiceFreshness().catch(() => null),
    Promise.all(salesStockBrands.map((s) => getBrandSalesSnapshot(s.brand, { year: ey, month: em }).catch(() => null))),
    Promise.all(salesStockBrands.map((s) => getBrandStockSnapshot(s.brand).catch(() => null))),
  ])

  // --- Service revenue per brand ---
  const serviceBrands: CockpitServiceBrand[] = []
  for (const { brand, label } of SERVICE_BRANDS) {
    if (brand === 'kia') {
      const available = Boolean(kiaWs?.meta.dataAvailable)
      const revenue = num(kiaWs?.total.billing)
      const lyRevenue = num(kiaWs?.lyTotal.billing)
      serviceBrands.push({
        brand, brandLabel: label, available,
        revenue, labour: num(kiaWs?.total.labour), parts: num(kiaWs?.total.parts), roCount: num(kiaWs?.total.roCount),
        lyRevenue, growthPct: growth(revenue, lyRevenue),
      })
    } else {
      const metrics = brand === 'hyundai' ? hyundai : platinum
      const available = Boolean(metrics?.sourceAvailable)
      const revenue = num(metrics?.cy.revenue)
      const lyRevenue = num(metrics?.ly.revenue)
      serviceBrands.push({
        brand, brandLabel: label, available,
        revenue, labour: num(metrics?.cy.labour), parts: num(metrics?.cy.parts), roCount: num(metrics?.cy.dedupedJc),
        lyRevenue, growthPct: growth(revenue, lyRevenue),
      })
    }
  }
  const serviceTotals = serviceBrands.filter((b) => b.available).reduce(
    (acc, b) => {
      acc.revenue += b.revenue; acc.labour += b.labour; acc.parts += b.parts
      acc.roCount += b.roCount; acc.lyRevenue += b.lyRevenue
      return acc
    },
    { revenue: 0, labour: 0, parts: 0, roCount: 0, lyRevenue: 0 },
  )

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
  const salesBrands = salesSnaps.filter((s): s is BrandSalesSnapshot => Boolean(s))
  const stockBrands = stockSnaps.filter((s): s is BrandStockSnapshot => Boolean(s))
  const salesTotals = salesBrands.reduce(
    (a, b) => ({ deliveries: a.deliveries + b.deliveries, bookings: a.bookings + b.bookings }),
    { deliveries: 0, bookings: 0 },
  )
  const stockTotals = stockBrands.reduce(
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
      totals: { ...serviceTotals, growthPct: growth(serviceTotals.revenue, serviceTotals.lyRevenue) },
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
    freshness: { service: serviceFreshness },
  }
}

export async function getGroupCockpit(input?: { endDate?: string | null }): Promise<CockpitPayload> {
  const win = monthWindows(input?.endDate)
  // Cache-key on the anchor month so a new day/month busts it; short TTL keeps it lively for exec use.
  return getCachedData(`cockpit:group:v3:${win.monthStart}:${win.end}`, () => buildCockpit(input?.endDate), CACHE_TTL.SHORT)
}
