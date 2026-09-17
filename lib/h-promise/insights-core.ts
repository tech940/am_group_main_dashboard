/**
 * The H Promise MIS, computed from the register rows. Client-safe and pure: the MIS page, the Excel export
 * and the printed monthly summary all call these functions, so they cannot disagree.
 *
 * ── Definitions (shown on the page under each ⓘ) ────────────────────────────────────────────────
 *   Purchased      a vehicle counts in the month of its PURCHASE DATE. Rejected purchases are left out until
 *                  they are corrected and approved — the sheet's rejections were duplicate entries.
 *   Sold           a vehicle counts in the month of its SALE DATE once a sale is recorded (awaiting approval or
 *                  approved). A rejected or withdrawn sale is not a sale.
 *   Stock          every vehicle not sold and not deleted, today — whatever filters are set for the period.
 *   Stock value    purchase price without GST (cost), with the GST figure beside it.
 *   Profit         gross profit = selling − (purchase + other cost); with GST uses the purchase price with GST;
 *                  net profit = gross profit with GST − interest (12 % a year on the purchase price, to the
 *                  sale date). See lib/h-promise/economics.ts.
 *   Year           the calendar year, as the sheet's MIS used.
 */

import { AGING_BUCKETS, type AgingBucket } from './stage'
import type { HpBookingLite, HpVehicleRow } from './types'

export type InsightFilters = {
  /** Calendar year, or 'all'. */
  year: number | 'all'
  /** 1–12, or 'all'. */
  month: number | 'all'
  location: string
  soldBy: string
  soldTo: string
  /** Sold vehicles that had a booking, or not. */
  booking: 'all' | 'booked' | 'direct'
}

export const DEFAULT_INSIGHT_FILTERS = (todayYmd: string): InsightFilters => ({
  year: Number(todayYmd.slice(0, 4)),
  month: 'all',
  location: '',
  soldBy: '',
  soldTo: '',
  booking: 'all',
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`
}

export function isSaleRecorded(row: Pick<HpVehicleRow, 'saleStatus'>): boolean {
  return row.saleStatus === 'pending' || row.saleStatus === 'approved'
}

export function countsAsPurchase(row: Pick<HpVehicleRow, 'purchaseStatus' | 'deletedAt'>): boolean {
  return !row.deletedAt && row.purchaseStatus !== 'rejected'
}

function inPeriod(ymd: string | null, filters: Pick<InsightFilters, 'year' | 'month'>): boolean {
  if (!ymd) return false
  if (filters.year !== 'all' && Number(ymd.slice(0, 4)) !== filters.year) return false
  if (filters.month !== 'all' && Number(ymd.slice(5, 7)) !== filters.month) return false
  return true
}

function matchesDimensions(row: HpVehicleRow, filters: InsightFilters, bookedVehicleIds: ReadonlySet<string>): boolean {
  if (filters.location && row.location !== filters.location) return false
  if (filters.soldBy && row.soldBy !== filters.soldBy) return false
  if (filters.soldTo && row.soldTo !== filters.soldTo) return false
  if (filters.booking === 'booked' && !bookedVehicleIds.has(row.id)) return false
  if (filters.booking === 'direct' && bookedVehicleIds.has(row.id)) return false
  return true
}

function sum(values: Array<number | null | undefined>): number {
  let total = 0
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) total += value
  return Math.round(total * 100) / 100
}

function average(values: Array<number | null | undefined>): number | null {
  const real = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (real.length === 0) return null
  return real.reduce((a, b) => a + b, 0) / real.length
}

export type PeriodTotals = {
  purchasedCount: number
  purchasedValue: number
  soldCount: number
  soldPendingApproval: number
  saleValue: number
  purchaseValueOfSold: number
  otherCost: number
  grossProfit: number
  grossProfitWithGst: number
  interest: number
  netProfit: number
  lossCount: number
  lossValue: number
  avgDaysToSell: number | null
  /** Net profit ÷ sale value. */
  netMarginPct: number | null
  bookedCount: number
  bookingValue: number
  refundedCount: number
}

export type StockTotals = {
  count: number
  bookedCount: number
  valueAtCost: number
  valueWithGst: number
  interestAccrued: number
  avgAge: number | null
  over60: number
  buckets: Record<AgingBucket, number>
  awaitingPurchaseApproval: number
}

export type MonthRow = PeriodTotals & { key: string; label: string }

export type MixRow = { key: string; count: number; value: number; netProfit: number }

export type InsightResult = {
  period: PeriodTotals
  stock: StockTotals
  months: MonthRow[]
  purchasedRows: HpVehicleRow[]
  soldRows: HpVehicleRow[]
  stockRows: HpVehicleRow[]
  mix: {
    soldByLocation: MixRow[]
    soldBy: MixRow[]
    soldTo: MixRow[]
    purchasedByLocation: MixRow[]
    stockByModel: MixRow[]
  }
  compliance: {
    docsMissing: number
    ledgerPending: number
    brokerRcPending: number
    paperworkPending: number
    insuranceExpired: number
    insuranceDueSoon: number
    purchasePending: number
    salePending: number
  }
  insights: Insight[]
  years: number[]
}

export type Insight = { id: string; tone: 'good' | 'watch' | 'risk' | 'info'; title: string; detail: string }

function periodTotals(purchased: HpVehicleRow[], sold: HpVehicleRow[], bookings: HpBookingLite[], refunds: HpBookingLite[]): PeriodTotals {
  const saleValue = sum(sold.map((row) => row.sellingPrice))
  const netProfit = sum(sold.map((row) => row.economics.netProfit))
  const losses = sold.filter((row) => (row.economics.netProfit ?? 0) < 0)
  return {
    purchasedCount: purchased.length,
    purchasedValue: sum(purchased.map((row) => row.purchasePrice)),
    soldCount: sold.length,
    soldPendingApproval: sold.filter((row) => row.saleStatus === 'pending').length,
    saleValue,
    purchaseValueOfSold: sum(sold.map((row) => row.purchasePrice)),
    otherCost: sum(sold.map((row) => row.otherCost)),
    grossProfit: sum(sold.map((row) => row.economics.grossProfit)),
    grossProfitWithGst: sum(sold.map((row) => row.economics.grossProfitWithGst)),
    interest: sum(sold.map((row) => row.economics.interest)),
    netProfit,
    lossCount: losses.length,
    lossValue: sum(losses.map((row) => row.economics.netProfit)),
    avgDaysToSell: average(sold.map((row) => row.flags.daysInStock)),
    netMarginPct: saleValue > 0 ? (netProfit / saleValue) * 100 : null,
    bookedCount: bookings.length,
    bookingValue: sum(bookings.map((booking) => booking.amount)),
    refundedCount: refunds.length,
  }
}

function mixBy(rows: HpVehicleRow[], key: (row: HpVehicleRow) => string | null, value: (row: HpVehicleRow) => number | null): MixRow[] {
  const groups = new Map<string, MixRow>()
  for (const row of rows) {
    const name = key(row) || 'Not recorded'
    const group = groups.get(name) ?? { key: name, count: 0, value: 0, netProfit: 0 }
    group.count += 1
    group.value += value(row) ?? 0
    group.netProfit += row.economics.netProfit ?? 0
    groups.set(name, group)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, value: Math.round(group.value), netProfit: Math.round(group.netProfit) }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
}

function monthKey(ymd: string): string {
  return ymd.slice(0, 7)
}

/** Every month from the first to the last one that has activity, inside the chosen year. */
function monthKeysFor(filters: InsightFilters, keys: string[], todayYmd: string): string[] {
  if (filters.year !== 'all') {
    const lastMonth = filters.year === Number(todayYmd.slice(0, 4)) ? Number(todayYmd.slice(5, 7)) : 12
    const months = filters.month === 'all'
      ? Array.from({ length: lastMonth }, (_, index) => index + 1)
      : [filters.month]
    return months.map((m) => `${filters.year}-${String(m).padStart(2, '0')}`)
  }
  const sorted = [...new Set(keys)].sort()
  if (sorted.length === 0) return []
  const out: string[] = []
  let [y, m] = sorted[0].split('-').map(Number)
  const [endY, endM] = sorted[sorted.length - 1].split('-').map(Number)
  while (y < endY || (y === endY && m <= endM)) {
    if (filters.month === 'all' || m === filters.month) out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}

export function computeInsights(
  rows: HpVehicleRow[],
  bookings: HpBookingLite[],
  filters: InsightFilters,
  todayYmd: string,
  /** Shows a stored value ("SHUBHAM SALATHIA") by its list label ("Shubham Salathia") in the insight text. */
  label: (value: string) => string = (value) => value,
): InsightResult {
  const live = rows.filter((row) => !row.deletedAt)
  const liveIds = new Set(live.map((row) => row.id))
  const liveBookings = bookings.filter((booking) => liveIds.has(booking.vehicleId))
  const bookedVehicleIds = new Set(liveBookings.map((booking) => booking.vehicleId))
  const rowById = new Map(live.map((row) => [row.id, row]))

  const dimensional = live.filter((row) => matchesDimensions(row, filters, bookedVehicleIds))
  const purchasedAll = dimensional.filter(countsAsPurchase)
  const soldAll = dimensional.filter(isSaleRecorded)
  const bookingInDims = (booking: HpBookingLite) => {
    const row = rowById.get(booking.vehicleId)
    return Boolean(row && matchesDimensions(row, { ...filters, booking: 'all' }, bookedVehicleIds))
  }

  const purchasedRows = purchasedAll.filter((row) => inPeriod(row.purchaseDate, filters))
  const soldRows = soldAll.filter((row) => inPeriod(row.saleDate, filters)).sort((a, b) => (b.saleDate ?? '').localeCompare(a.saleDate ?? ''))
  const periodBookings = liveBookings.filter((booking) => bookingInDims(booking) && inPeriod(booking.bookingDate, filters))
  const periodRefunds = liveBookings.filter((booking) => booking.status === 'refunded' && bookingInDims(booking) && inPeriod(booking.refundDate, filters))

  // Stock is "now": the period filters do not apply, the location filter does.
  const stockRows = live
    .filter((row) => (row.stage === 'in_stock' || row.stage === 'booked') && row.purchaseStatus !== 'rejected')
    .filter((row) => !filters.location || row.location === filters.location)
    .sort((a, b) => (b.flags.daysInStock ?? 0) - (a.flags.daysInStock ?? 0))
  const buckets = Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, 0])) as Record<AgingBucket, number>
  for (const row of stockRows) if (row.flags.agingBucket) buckets[row.flags.agingBucket] += 1

  const allKeys = [
    ...purchasedAll.map((row) => monthKey(row.purchaseDate)),
    ...soldAll.map((row) => monthKey(row.saleDate as string)),
  ]
  const months = monthKeysFor(filters, allKeys, todayYmd).map((key) => {
    const inMonth = (ymd: string | null) => Boolean(ymd && ymd.startsWith(key))
    return {
      key,
      label: monthLabel(key),
      ...periodTotals(
        purchasedAll.filter((row) => inMonth(row.purchaseDate)),
        soldAll.filter((row) => inMonth(row.saleDate)),
        liveBookings.filter((booking) => bookingInDims(booking) && inMonth(booking.bookingDate)),
        liveBookings.filter((booking) => booking.status === 'refunded' && bookingInDims(booking) && inMonth(booking.refundDate)),
      ),
    }
  })

  const period = periodTotals(purchasedRows, soldRows, periodBookings, periodRefunds)
  const stock: StockTotals = {
    count: stockRows.length,
    bookedCount: stockRows.filter((row) => row.stage === 'booked').length,
    valueAtCost: sum(stockRows.map((row) => row.purchasePrice)),
    valueWithGst: sum(stockRows.map((row) => row.economics.priceWithGst)),
    interestAccrued: sum(stockRows.map((row) => row.economics.interest)),
    avgAge: average(stockRows.map((row) => row.flags.daysInStock)),
    over60: stockRows.filter((row) => row.flags.longAging).length,
    buckets,
    awaitingPurchaseApproval: stockRows.filter((row) => row.purchaseStatus === 'pending').length,
  }

  const scoped = live.filter((row) => !filters.location || row.location === filters.location)
  const compliance = {
    docsMissing: scoped.filter((row) => row.flags.docsMissing).length,
    ledgerPending: scoped.filter((row) => row.flags.ledgerPending).length,
    brokerRcPending: scoped.filter((row) => row.flags.brokerRcPending).length,
    paperworkPending: scoped.filter((row) => row.flags.paperworkPending).length,
    insuranceExpired: scoped.filter((row) => row.flags.insurance === 'expired').length,
    insuranceDueSoon: scoped.filter((row) => row.flags.insurance === 'due7' || row.flags.insurance === 'due15').length,
    purchasePending: scoped.filter((row) => row.flags.purchasePending).length,
    salePending: scoped.filter((row) => row.flags.salePending).length,
  }

  const mix = {
    soldByLocation: mixBy(soldRows, (row) => row.location, (row) => row.sellingPrice),
    soldBy: mixBy(soldRows, (row) => row.soldBy, (row) => row.sellingPrice),
    soldTo: mixBy(soldRows, (row) => row.soldTo, (row) => row.sellingPrice),
    purchasedByLocation: mixBy(purchasedRows, (row) => row.location, (row) => row.purchasePrice),
    stockByModel: mixBy(stockRows, (row) => row.model, (row) => row.purchasePrice),
  }

  const years = [...new Set(live.flatMap((row) => [row.purchaseDate, row.saleDate]).filter(Boolean).map((ymd) => Number((ymd as string).slice(0, 4))))]
    .sort((a, b) => b - a)

  return {
    period,
    stock,
    months,
    purchasedRows,
    soldRows,
    stockRows,
    mix,
    compliance,
    insights: buildInsights({ period, stock, months, soldRows, stockRows, mix, compliance }, label),
    years,
  }
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

function buildInsights(input: Pick<InsightResult, 'period' | 'stock' | 'months' | 'soldRows' | 'stockRows' | 'mix' | 'compliance'>, label: (value: string) => string): Insight[] {
  const out: Insight[] = []
  const { period, stock, months, soldRows, stockRows, mix, compliance } = input

  const withSales = months.filter((month) => month.soldCount > 0)
  if (withSales.length > 1) {
    const best = [...withSales].sort((a, b) => b.netProfit - a.netProfit)[0]
    out.push({ id: 'best-month', tone: 'good', title: `${best.label} was the best month`, detail: `${best.soldCount} sold for a net profit of ${INR.format(best.netProfit)}.` })
  }
  if (period.soldCount > 0 && period.netMarginPct !== null) {
    out.push({
      id: 'margin',
      tone: period.netMarginPct >= 5 ? 'good' : period.netMarginPct >= 0 ? 'watch' : 'risk',
      title: `Net margin ${period.netMarginPct < 0 ? '−' : ''}${Math.abs(period.netMarginPct).toFixed(1)} %`,
      detail: `${INR.format(period.netProfit).replace('-', '−')} net profit on ${INR.format(period.saleValue)} of sales, after ${INR.format(period.interest)} interest.`,
    })
  }
  if (period.lossCount > 0) {
    out.push({ id: 'losses', tone: 'risk', title: `${period.lossCount} sale${period.lossCount === 1 ? '' : 's'} made a loss`, detail: `Together ${INR.format(Math.abs(period.lossValue))} below cost after GST and interest.` })
  }
  const topSeller = mix.soldBy[0]
  if (topSeller && soldRows.length > 1) {
    out.push({ id: 'top-seller', tone: 'info', title: `${label(topSeller.key)} sold the most`, detail: `${topSeller.count} of ${soldRows.length} vehicles, ${INR.format(topSeller.netProfit)} net profit.` })
  }
  const broker = mix.soldTo.find((row) => row.key === 'BROKER')
  if (broker && soldRows.length > 0) {
    const share = Math.round((broker.count / soldRows.length) * 100)
    out.push({ id: 'broker-share', tone: share > 50 ? 'watch' : 'info', title: `${share} % of sales went to brokers`, detail: `${broker.count} broker sale${broker.count === 1 ? '' : 's'}; each needs RC transfer proof.` })
  }
  if (stock.over60 > 0) {
    const oldest = stockRows[0]
    out.push({
      id: 'aging',
      tone: 'risk',
      title: `${stock.over60} vehicle${stock.over60 === 1 ? '' : 's'} in stock over 60 days`,
      detail: oldest ? `Oldest: ${oldest.model} (${oldest.regNo}), ${oldest.flags.daysInStock} days, ${INR.format(oldest.economics.interest ?? 0)} interest so far.` : '',
    })
  }
  if (stock.count > 0) {
    out.push({ id: 'carrying', tone: 'watch', title: `Stock is costing ${INR.format(stock.interestAccrued)} in interest`, detail: `${stock.count} vehicles worth ${INR.format(stock.valueAtCost)} at cost, on average ${Math.round(stock.avgAge ?? 0)} days old.` })
  }
  const open = compliance.docsMissing + compliance.ledgerPending + compliance.brokerRcPending
  if (open > 0) {
    out.push({
      id: 'compliance',
      tone: 'watch',
      title: `${open} paperwork item${open === 1 ? '' : 's'} open on sold vehicles`,
      detail: [
        compliance.docsMissing ? `${compliance.docsMissing} missing documents` : null,
        compliance.ledgerPending ? `${compliance.ledgerPending} ledgers not uploaded` : null,
        compliance.brokerRcPending ? `${compliance.brokerRcPending} broker RC transfers` : null,
      ].filter(Boolean).join(' · '),
    })
  }
  if (period.avgDaysToSell !== null && period.soldCount > 0) {
    out.push({ id: 'days-to-sell', tone: 'info', title: `${Math.round(period.avgDaysToSell)} days to sell, on average`, detail: `From purchase date to sale date, over ${period.soldCount} sale${period.soldCount === 1 ? '' : 's'}.` })
  }
  return out
}
