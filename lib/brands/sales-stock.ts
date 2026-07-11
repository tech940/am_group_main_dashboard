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
  return { brand, label, available: false, monthLabel: null, bookings: 0, deliveries: 0, conversion: 0, bookingTarget: 0, deliveryTarget: 0, bookingAchievement: null, deliveryAchievement: null, consultants: 0 }
}
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
    return {
      brand: src.brand, label: src.label, available: true,
      monthLabel: p.context.label,
      bookings: p.summary.bookings,
      deliveries: p.summary.deliveries,
      conversion: p.summary.conversion,
      bookingTarget: p.summary.bookingTarget,
      deliveryTarget: p.summary.deliveryTarget,
      bookingAchievement: p.summary.bookingAchievement,
      deliveryAchievement: p.summary.deliveryAchievement,
      consultants: p.leaderboard.filter(row => row.bookings > 0 || row.deliveries > 0).length,
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
