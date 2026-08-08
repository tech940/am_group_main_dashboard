import 'server-only'

import { getSalesStockSource } from '@/lib/brands/sales-stock-sources'
import { getKiaSalesPerformance } from '@/lib/kia/sales-performance'
import { getKiaStockReportSummary } from '@/lib/kia/stock-report'

// Brand-parameterized read layer for vehicle Sales & Stock. This is the seam the cockpit (and any
// future cross-brand rollup) calls instead of the KIA-specific readers directly. Today only KIA has a
// feed + reader, so every other brand resolves to an `available: false` snapshot with zeroed figures.
// Adding a brand = give it a live feed (external cron), flip readerImplemented in the registry, and
// wire its case below (or generalize the KIA readers to take the registry table names).

export type BrandSalesSnapshot = {
  brand: string
  label: string
  available: boolean
  monthLabel: string | null
  bookings: number
  deliveries: number
  conversion: number
  bookingTarget: number
  deliveryTarget: number
  bookingAchievement: number | null
  deliveryAchievement: number | null
  consultants: number
  /** 'auto' = no configured target for the month, so it was derived as last month's actual + 10%. */
  targetBasis: 'configured' | 'auto' | null
}

export type BrandStockSnapshot = {
  brand: string
  label: string
  available: boolean
  availableStock: number
  stockValue: number
  avgStockAge: number
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }

function emptySales(brand: string, label: string): BrandSalesSnapshot {
  return { brand, label, available: false, monthLabel: null, bookings: 0, deliveries: 0, conversion: 0, bookingTarget: 0, deliveryTarget: 0, bookingAchievement: null, deliveryAchievement: null, consultants: 0, targetBasis: null }
}

/** Previous calendar month, wrapping the year. */
function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

const pctOf = (value: number, target: number) => (target > 0 ? Math.round((value / target) * 100) : null)
function emptyStock(brand: string, label: string): BrandStockSnapshot {
  return { brand, label, available: false, availableStock: 0, stockValue: 0, avgStockAge: 0 }
}

function stockKpi(overview: { kpis: { label: string; value: number }[] } | undefined, label: string): number {
  return num(overview?.kpis.find((k) => k.label === label)?.value)
}

export async function getBrandSalesSnapshot(
  brand: string,
  input?: { year?: number | null; month?: number | null }
): Promise<BrandSalesSnapshot> {
  const src = getSalesStockSource(brand)
  if (!src) return emptySales(brand, brand)
  if (src.brand === 'kia' && src.readerImplemented) {
    const p = await getKiaSalesPerformance({
      year: input?.year,
      month: input?.month,
    })

    // Configured targets (kia_sales_targets) win. When a month has none — which was every month so
    // far, so the card read "target 0 · —" — derive each missing target as LAST MONTH'S ACTUAL
    // + 10% (rounded up), per the MD's rule. Derived targets are labelled `auto` so the card can
    // say where the number came from.
    let { bookingTarget, deliveryTarget, bookingAchievement, deliveryAchievement } = p.summary
    let targetBasis: BrandSalesSnapshot['targetBasis'] = 'configured'
    if (bookingTarget <= 0 || deliveryTarget <= 0) {
      const prev = previousMonth(p.context.year, p.context.month)
      const lm = await getKiaSalesPerformance({ year: prev.year, month: prev.month }).catch(() => null)
      if (lm) {
        if (bookingTarget <= 0 && lm.summary.bookings > 0) {
          bookingTarget = Math.ceil(lm.summary.bookings * 1.1)
          bookingAchievement = pctOf(p.summary.bookings, bookingTarget)
          targetBasis = 'auto'
        }
        if (deliveryTarget <= 0 && lm.summary.deliveries > 0) {
          deliveryTarget = Math.ceil(lm.summary.deliveries * 1.1)
          deliveryAchievement = pctOf(p.summary.deliveries, deliveryTarget)
          targetBasis = 'auto'
        }
      }
    }

    return {
      brand: src.brand, label: src.label, available: true,
      monthLabel: p.context.label,
      bookings: p.summary.bookings,
      deliveries: p.summary.deliveries,
      conversion: p.summary.conversion,
      bookingTarget,
      deliveryTarget,
      bookingAchievement,
      deliveryAchievement,
      consultants: p.leaderboard.filter(row => row.bookings > 0 || row.deliveries > 0).length,
      targetBasis,
    }
  }
  // No feed / no reader yet for this brand — a declared-but-inactive source.
  return emptySales(src.brand, src.label)
}

export async function getBrandStockSnapshot(brand: string): Promise<BrandStockSnapshot> {
  const src = getSalesStockSource(brand)
  if (!src) return emptyStock(brand, brand)
  if (src.brand === 'kia' && src.readerImplemented) {
    const s = await getKiaStockReportSummary({})
    return {
      brand: src.brand, label: src.label, available: true,
      availableStock: stockKpi(s.overview, 'Available Stock'),
      stockValue: stockKpi(s.overview, 'Stock Value'),
      avgStockAge: stockKpi(s.overview, 'Avg Stock Age'),
    }
  }
  return emptyStock(src.brand, src.label)
}
