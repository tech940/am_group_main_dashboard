import 'server-only'

import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { analyticsDb } from '@/lib/analytics/db'
import { kiaSalesTargets } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { getSalesStockSource } from '@/lib/brands/sales-stock-sources'

// Sales actuals table from the brand sales/stock registry (single source of truth). KIA is guaranteed.
const SALES_TABLE = getSalesStockSource('kia')!.tables.sales

// Sales Performance / consultant leaderboard. Actuals (bookings + deliveries per consultant/month)
// come from kia_sales_report (the DMS export); targets from kia_sales_targets. Consultants are keyed
// by UPPER(TRIM(consultant_name)) so casing/spacing variance in the feed still matches a target.

function rows(result: unknown) { return Array.isArray(result) ? result as Record<string, unknown>[] : [] }
function num(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function pct(part: number, whole: number) { return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0 }
function consultantKey(name: string) { return name.trim().toUpperCase() }

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function salesDealerClause(dealerCode: string | null) {
  const normalized = normalizeKiaDealerCode(dealerCode) || null
  if (!normalized) return sql``
  return sql`AND UPPER(TRIM(dealer_code)) = ${normalized}`
}

export type KiaSalesConsultant = { consultant: string; dealer: string }
export type KiaSalesLeaderRow = {
  rank: number
  consultant: string
  dealer: string
  bookings: number
  deliveries: number
  conversion: number
  bookingTarget: number
  deliveryTarget: number
  bookingAchievement: number | null
  deliveryAchievement: number | null
}
export type KiaSalesPerformancePayload = {
  context: { year: number; month: number; label: string; dealerCode: string | null }
  availableMonths: { year: number; month: number; label: string }[]
  summary: { consultants: number; bookings: number; deliveries: number; conversion: number; bookingTarget: number; deliveryTarget: number; bookingAchievement: number | null; deliveryAchievement: number | null }
  leaderboard: KiaSalesLeaderRow[]
  consultants: KiaSalesConsultant[]
}

async function readAvailableMonths(): Promise<{ year: number; month: number; label: string }[]> {
  const result = rows(await analyticsDb.execute(sql`
    SELECT DISTINCT year, month FROM (
      SELECT EXTRACT(YEAR FROM booking_date)::int AS year, EXTRACT(MONTH FROM booking_date)::int AS month FROM ${sql.raw(SALES_TABLE)} WHERE booking_date IS NOT NULL
      UNION
      SELECT EXTRACT(YEAR FROM delivery_date)::int, EXTRACT(MONTH FROM delivery_date)::int FROM ${sql.raw(SALES_TABLE)} WHERE delivery_date IS NOT NULL
    ) t
    WHERE year IS NOT NULL AND month IS NOT NULL
    ORDER BY year DESC, month DESC
    LIMIT 24
  `))
  return result.map((r) => ({ year: num(r.year), month: num(r.month), label: monthLabel(num(r.year), num(r.month)) }))
}

export async function getKiaSalesPerformance(input: { year?: number | null; month?: number | null; dealerCode?: string | null }): Promise<KiaSalesPerformancePayload> {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const months = await readAvailableMonths()
  const fallback = months[0] || { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
  const year = input.year && Number.isFinite(input.year) ? Math.floor(input.year) : fallback.year
  const month = input.month && Number.isFinite(input.month) && input.month >= 1 && input.month <= 12 ? Math.floor(input.month) : fallback.month
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  // month is 1-based; Date.UTC month arg is 0-based, so (year, month, 1) is the first of the NEXT month.
  const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10)

  const [bookingsRes, deliveriesRes, consultantsRes, targets] = await Promise.all([
    analyticsDb.execute(sql`
      SELECT UPPER(TRIM(consultant_name)) AS key,
             TRIM(consultant_name) AS name,
             UPPER(TRIM(dealer_code)) AS dealer,
             booking_no,
             status
      FROM kia_booking_report
      WHERE consultant_name IS NOT NULL AND TRIM(consultant_name) <> '' AND dealer_code IS NOT NULL
        AND booking_date >= ${start}::date AND booking_date < ${endExclusive}::date
        AND UPPER(TRIM(status)) NOT IN ('BOOKING CANCEL', 'INVOICE CANCEL')
        ${salesDealerClause(dealerCode)}
    `),
    analyticsDb.execute(sql`
      SELECT UPPER(TRIM(consultant_name)) AS key,
             TRIM(consultant_name) AS name,
             UPPER(TRIM(dealer_code)) AS dealer,
             vin_number,
             invoice_no
      FROM ${sql.raw(SALES_TABLE)}
      WHERE consultant_name IS NOT NULL AND TRIM(consultant_name) <> '' AND dealer_code IS NOT NULL
        AND delivery_date >= ${start}::date AND delivery_date < ${endExclusive}::date
        ${salesDealerClause(dealerCode)}
    `),
    analyticsDb.execute(sql`
      SELECT MAX(TRIM(consultant_name)) AS name, UPPER(TRIM(dealer_code)) AS dealer
      FROM ${sql.raw(SALES_TABLE)}
      WHERE consultant_name IS NOT NULL AND TRIM(consultant_name) <> '' AND dealer_code IS NOT NULL
        ${salesDealerClause(dealerCode)}
      GROUP BY UPPER(TRIM(consultant_name)), UPPER(TRIM(dealer_code))
      ORDER BY name
    `),
    db.select().from(kiaSalesTargets).where(
      dealerCode
        ? and(eq(kiaSalesTargets.year, year), eq(kiaSalesTargets.month, month), eq(kiaSalesTargets.dealerCode, dealerCode))
        : and(eq(kiaSalesTargets.year, year), eq(kiaSalesTargets.month, month)),
    ),
  ])

  const targetMap = new Map<string, { bookingTarget: number; deliveryTarget: number }>()
  for (const t of targets) targetMap.set(`${t.dealerCode}|${consultantKey(t.consultantName)}`, { bookingTarget: t.bookingTarget, deliveryTarget: t.deliveryTarget })

  // Deduplicate bookings by booking_no (same logic as Sales Report page)
  const uniqueBookings = new Map<string, Record<string, unknown>>()
  for (const r of rows(bookingsRes)) {
    const bookingNo = String(r.booking_no || '').trim().toUpperCase()
    if (bookingNo) uniqueBookings.set(bookingNo, r)
  }

  // Group deduplicated bookings by consultant/dealer
  const bookingsMap = new Map<string, { bookings: number; bookedDelivered: number }>()
  for (const r of uniqueBookings.values()) {
    const dealer = String(r.dealer || '')
    const key = String(r.key || '')
    const id = `${dealer}|${key}`
    const current = bookingsMap.get(id) || { bookings: 0, bookedDelivered: 0 }
    current.bookings += 1
    if (String(r.status || '').trim().toUpperCase() === 'RETAIL') {
      current.bookedDelivered += 1
    }
    bookingsMap.set(id, current)
  }

  // Deduplicate deliveries by vin_number or invoice_no (same logic as Sales Report page)
  const uniqueDeliveries = new Map<string, Record<string, unknown>>()
  for (const r of rows(deliveriesRes)) {
    const vin = String(r.vin_number || '').trim().toUpperCase()
    if (vin) {
      uniqueDeliveries.set(vin, r)
    } else {
      const inv = String(r.invoice_no || '').trim().toUpperCase()
      if (inv) uniqueDeliveries.set(`inv:${inv}`, r)
    }
  }

  // Group deduplicated deliveries by consultant/dealer
  const deliveriesMap = new Map<string, number>()
  for (const r of uniqueDeliveries.values()) {
    const dealer = String(r.dealer || '')
    const key = String(r.key || '')
    const id = `${dealer}|${key}`
    deliveriesMap.set(id, (deliveriesMap.get(id) || 0) + 1)
  }

  const map = new Map<string, KiaSalesLeaderRow>()
  let totalBookedDelivered = 0

  for (const [id, val] of bookingsMap.entries()) {
    const [dealer, key] = id.split('|')
    const sampleRow = Array.from(uniqueBookings.values()).find((r) => String(r.dealer || '') === dealer && String(r.key || '') === key)
    const name = sampleRow ? String(sampleRow.name || key) : key

    const bookings = val.bookings
    const bookedDelivered = val.bookedDelivered
    totalBookedDelivered += bookedDelivered
    const tgt = targetMap.get(id) || { bookingTarget: 0, deliveryTarget: 0 }
    map.set(id, {
      rank: 0,
      consultant: name,
      dealer,
      bookings,
      deliveries: 0,
      conversion: pct(bookedDelivered, bookings),
      bookingTarget: tgt.bookingTarget,
      deliveryTarget: tgt.deliveryTarget,
      bookingAchievement: tgt.bookingTarget > 0 ? pct(bookings, tgt.bookingTarget) : null,
      deliveryAchievement: tgt.deliveryTarget > 0 ? 0 : null,
    })
  }

  for (const [id, deliveries] of deliveriesMap.entries()) {
    const [dealer, key] = id.split('|')
    const sampleRow = Array.from(uniqueDeliveries.values()).find((r) => String(r.dealer || '') === dealer && String(r.key || '') === key)
    const name = sampleRow ? String(sampleRow.name || key) : key

    const existing = map.get(id)
    if (existing) {
      existing.deliveries = deliveries
      const tgt = targetMap.get(id) || { bookingTarget: 0, deliveryTarget: 0 }
      existing.deliveryAchievement = tgt.deliveryTarget > 0 ? pct(deliveries, tgt.deliveryTarget) : null
    } else {
      const tgt = targetMap.get(id) || { bookingTarget: 0, deliveryTarget: 0 }
      map.set(id, {
        rank: 0,
        consultant: name,
        dealer,
        bookings: 0,
        deliveries,
        conversion: 0,
        bookingTarget: tgt.bookingTarget,
        deliveryTarget: tgt.deliveryTarget,
        bookingAchievement: tgt.bookingTarget > 0 ? 0 : null,
        deliveryAchievement: tgt.deliveryTarget > 0 ? pct(deliveries, tgt.deliveryTarget) : null,
      })
    }
  }
  // Include consultants who have a target this month but no actuals yet (so they still show, at 0).
  for (const t of targets) {
    const id = `${t.dealerCode}|${consultantKey(t.consultantName)}`
    if (map.has(id)) continue
    map.set(id, {
      rank: 0, consultant: t.consultantName, dealer: t.dealerCode,
      bookings: 0, deliveries: 0, conversion: 0,
      bookingTarget: t.bookingTarget, deliveryTarget: t.deliveryTarget,
      bookingAchievement: t.bookingTarget > 0 ? 0 : null,
      deliveryAchievement: t.deliveryTarget > 0 ? 0 : null,
    })
  }

  const leaderboard = Array.from(map.values())
    .sort((a, b) => b.deliveries - a.deliveries || b.bookings - a.bookings || a.consultant.localeCompare(b.consultant))
    .map((row, index) => ({ ...row, rank: index + 1 }))

  const summary = leaderboard.reduce((acc, row) => {
    acc.bookings += row.bookings
    acc.deliveries += row.deliveries
    acc.bookingTarget += row.bookingTarget
    acc.deliveryTarget += row.deliveryTarget
    return acc
  }, { consultants: leaderboard.length, bookings: 0, deliveries: 0, conversion: 0, bookingTarget: 0, deliveryTarget: 0, bookingAchievement: null as number | null, deliveryAchievement: null as number | null })
  summary.conversion = pct(totalBookedDelivered, summary.bookings)
  summary.bookingAchievement = summary.bookingTarget > 0 ? pct(summary.bookings, summary.bookingTarget) : null
  summary.deliveryAchievement = summary.deliveryTarget > 0 ? pct(summary.deliveries, summary.deliveryTarget) : null

  const consultants: KiaSalesConsultant[] = rows(consultantsRes)
    .map((r) => ({ consultant: String(r.name || ''), dealer: String(r.dealer || '') }))
    .filter((c) => c.consultant && c.dealer)

  return {
    context: { year, month, label: monthLabel(year, month), dealerCode },
    availableMonths: months,
    summary,
    leaderboard,
    consultants,
  }
}

export async function upsertKiaSalesTargets(appUser: AppUser, input: {
  year: number
  month: number
  entries: { dealerCode: string; consultantName: string; bookingTarget: number; deliveryTarget: number }[]
}) {
  const year = Math.floor(input.year)
  const month = Math.floor(input.month)
  if (!Number.isInteger(year) || !(month >= 1 && month <= 12)) throw new Error('Invalid period')
  const values = (input.entries || [])
    .map((e) => ({
      dealerCode: normalizeKiaDealerCode(e.dealerCode) || String(e.dealerCode || '').trim().toUpperCase(),
      consultantName: String(e.consultantName || '').trim(),
      year,
      month,
      bookingTarget: Math.max(0, Math.floor(num(e.bookingTarget))),
      deliveryTarget: Math.max(0, Math.floor(num(e.deliveryTarget))),
      createdBy: appUser.id,
    }))
    .filter((e) => e.dealerCode && e.consultantName)
  if (!values.length) return { updated: 0 }
  await db.insert(kiaSalesTargets).values(values).onConflictDoUpdate({
    target: [kiaSalesTargets.dealerCode, kiaSalesTargets.consultantName, kiaSalesTargets.year, kiaSalesTargets.month],
    set: { bookingTarget: sql`excluded.booking_target`, deliveryTarget: sql`excluded.delivery_target`, updatedAt: new Date() },
  })
  return { updated: values.length }
}
