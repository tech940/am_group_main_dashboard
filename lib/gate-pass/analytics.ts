import 'server-only'

import { and, desc, eq, inArray, sql, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { demoGatePasses } from '@/lib/db/schema'
import type { AppUser } from '@/lib/auth/app-user'
import { visibleDealerCodes } from './access'
import { normalizeKiaDealerCode, KIA_BRANCH_DEALERS } from '@/lib/kia/dealer-branch'
import { gatePassMetrics } from './metrics'

export const gatePassAnalyticsSchema = z.object({
  dealerCode: z.string().trim().optional(),
  purpose: z.string().trim().optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
})

export type GatePassAnalyticsParams = z.infer<typeof gatePassAnalyticsSchema>

export type GatePassAnalyticsResult = {
  kpis: {
    totalPasses: number
    completedTrips: number
    activeOut: number
    pendingApproval: number
    readyForGateOut: number
    cancelledOrRejected: number
    totalDistanceKm: number
    avgDistancePerTrip: number
    onTimeRate: number | null
    onTimeCount: number
    lateCount: number
    medianTripMinutes: number | null
    medianApprovalMinutes: number | null
    medianDispatchMinutes: number | null
    totalFuelAmount: number
    totalFuelLitres: number
    fuelPassesCount: number
    avgFuelCostPerLitre: number | null
    evidenceComplianceRate: number | null
  }
  trend: Array<{
    date: string
    label: string
    total: number
    completed: number
    active: number
    testDrives: number
    fuelFilling: number
    other: number
    distanceKm: number
  }>
  purposes: Array<{
    purpose: string
    count: number
    percentage: number
    totalDistanceKm: number
    avgDistanceKm: number
    completedCount: number
  }>
  models: Array<{
    model: string
    tripCount: number
    percentage: number
    totalDistanceKm: number
    avgDistanceKm: number
    avgTripMinutes: number | null
  }>
  vehicles: Array<{
    vin: string
    regNo: string
    model: string
    variant: string
    color: string
    trips: number
    totalDistanceKm: number
    avgDistanceKm: number
    fuelSpend: number
    fuelLitres: number
  }>
  branches: Array<{
    dealerCode: string
    branchName: string
    totalPasses: number
    completedTrips: number
    totalDistanceKm: number
    onTimeRate: number | null
    fuelSpend: number
    fuelLitres: number
  }>
  hourly: Array<{
    hour: number
    label: string
    count: number
  }>
  drivers: Array<{
    name: string
    email: string
    kind: string
    totalTrips: number
    completedTrips: number
    totalDistanceKm: number
    testDrivesCount: number
    onTimeRate: number | null
  }>
  fuelSummary: {
    totalSpend: number
    totalLitres: number
    passesCount: number
    proofsAttachedCount: number
    proofsPendingCount: number
    byVehicle: Array<{
      regNo: string
      model: string
      passesCount: number
      litres: number
      amount: number
    }>
  }
}

function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? Math.round((clean[mid - 1] + clean[mid]) / 2) : clean[mid]
}

function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
  }).format(d)
}

function formatISODate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export async function getGatePassAnalytics(
  appUser: AppUser,
  rawFilters: unknown
): Promise<GatePassAnalyticsResult> {
  const filters = gatePassAnalyticsSchema.parse(rawFilters ?? {})
  const scope = visibleDealerCodes(appUser)

  const where = [inArray(demoGatePasses.dealerCode, scope)]

  if (filters.dealerCode && filters.dealerCode !== 'all') {
    const code = normalizeKiaDealerCode(filters.dealerCode)
    if (code) where.push(eq(demoGatePasses.dealerCode, code))
  }
  if (filters.purpose && filters.purpose !== 'all') {
    where.push(eq(demoGatePasses.purpose, filters.purpose))
  }
  if (filters.startDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.startDate.trim())
    const start = isIsoDateOnly
      ? new Date(`${filters.startDate.trim()}T00:00:00.000+05:30`)
      : new Date(filters.startDate)
    if (!Number.isNaN(start.getTime())) {
      where.push(gte(demoGatePasses.createdAt, start))
    }
  }
  if (filters.endDate) {
    const isIsoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.endDate.trim())
    const end = isIsoDateOnly
      ? new Date(`${filters.endDate.trim()}T23:59:59.999+05:30`)
      : new Date(filters.endDate)
    if (!Number.isNaN(end.getTime())) {
      where.push(lte(demoGatePasses.createdAt, end))
    }
  }
  if (filters.search) {
    const needle = `%${filters.search.toLowerCase()}%`
    where.push(sql`(
      LOWER(${demoGatePasses.passNo}) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.registrationNumber}, '')) LIKE ${needle}
      OR LOWER(COALESCE(${demoGatePasses.model}, '')) LIKE ${needle}
      OR LOWER(${demoGatePasses.driverName}) LIKE ${needle}
      OR LOWER(${demoGatePasses.requestedByName}) LIKE ${needle}
    )`)
  }

  const rows = await db
    .select()
    .from(demoGatePasses)
    .where(and(...where))
    .orderBy(desc(demoGatePasses.createdAt))

  const now = new Date()
  const evaluated = rows.map((r) => {
    const m = gatePassMetrics(r, now)
    return { row: r, m }
  })

  // 1. Core KPIs
  const totalPasses = evaluated.length
  const completed = evaluated.filter(({ row }) => row.status === 'returned')
  const completedTrips = completed.length
  const activeOut = evaluated.filter(({ row }) => row.status === 'out').length
  const pendingApproval = evaluated.filter(({ row }) => row.status === 'pending_approval').length
  const readyForGateOut = evaluated.filter(({ row }) => row.status === 'approved').length
  const cancelledOrRejected = evaluated.filter(({ row }) => ['rejected', 'cancelled', 'expired'].includes(row.status)).length

  const validDistances = evaluated
    .map(({ m }) => m.distanceKm)
    .filter((d): d is number => d !== null && d >= 0)
  const totalDistanceKm = validDistances.reduce((acc, v) => acc + v, 0)
  const avgDistancePerTrip = completedTrips > 0 ? Math.round((totalDistanceKm / completedTrips) * 10) / 10 : 0

  const onTimeRows = completed.filter(({ m }) => m.onTime === true)
  const lateRows = completed.filter(({ m }) => m.onTime === false)
  const onTimeRate = completedTrips > 0 ? Math.round((onTimeRows.length / completedTrips) * 100) : null

  const medianTripMinutes = median(completed.map(({ m }) => m.tripMinutes).filter((v): v is number => v !== null))
  const medianApprovalMinutes = median(evaluated.map(({ m }) => m.approvalMinutes).filter((v): v is number => v !== null))
  const medianDispatchMinutes = median(evaluated.map(({ m }) => m.dispatchMinutes).filter((v): v is number => v !== null))

  // Fuel KPIs
  const fuelRows = evaluated.filter(({ row }) => Boolean(row.fuelAmount || row.fuelLitres || row.purpose?.toLowerCase().includes('fuel')))
  let totalFuelAmount = 0
  let totalFuelLitres = 0
  let fuelProofsAttached = 0
  for (const { row } of fuelRows) {
    if (row.fuelAmount) totalFuelAmount += Number(row.fuelAmount) || 0
    if (row.fuelLitres) totalFuelLitres += Number(row.fuelLitres) || 0
    if (row.fuelSlipPath && row.pumpStartPath && row.pumpStopPath) fuelProofsAttached += 1
  }
  const avgFuelCostPerLitre = totalFuelLitres > 0 ? Math.round((totalFuelAmount / totalFuelLitres) * 100) / 100 : null

  // Evidence compliance rate
  const passesWithGateEvents = evaluated.filter(({ m }) => m.evidence.expected > 0)
  const evidenceComplianceRate = passesWithGateEvents.length > 0
    ? Math.round((passesWithGateEvents.filter(({ m }) => m.evidence.complete).length / passesWithGateEvents.length) * 100)
    : null

  // 2. Trend by Date
  const trendMap = new Map<string, {
    date: string
    label: string
    total: number
    completed: number
    active: number
    testDrives: number
    fuelFilling: number
    other: number
    distanceKm: number
  }>()

  for (const { row, m } of evaluated) {
    const d = new Date(row.createdAt)
    const isoKey = formatISODate(d)
    const label = formatShortDate(d)

    if (!trendMap.has(isoKey)) {
      trendMap.set(isoKey, {
        date: isoKey,
        label,
        total: 0,
        completed: 0,
        active: 0,
        testDrives: 0,
        fuelFilling: 0,
        other: 0,
        distanceKm: 0,
      })
    }

    const t = trendMap.get(isoKey)!
    t.total += 1
    if (row.status === 'returned') t.completed += 1
    if (row.status === 'out') t.active += 1

    const p = (row.purpose || '').toLowerCase()
    if (p.includes('test drive') || p.includes('home demo')) {
      t.testDrives += 1
    } else if (p.includes('fuel')) {
      t.fuelFilling += 1
    } else {
      t.other += 1
    }

    if (m.distanceKm && m.distanceKm > 0) {
      t.distanceKm += m.distanceKm
    }
  }

  const trend = Array.from(trendMap.values()).sort((a, b) => a.date.localeCompare(b.date))

  // 3. Purpose Breakdown
  const purposeMap = new Map<string, {
    purpose: string
    count: number
    totalDistanceKm: number
    completedCount: number
  }>()

  for (const { row, m } of evaluated) {
    const key = row.purpose || 'Other'
    if (!purposeMap.has(key)) {
      purposeMap.set(key, { purpose: key, count: 0, totalDistanceKm: 0, completedCount: 0 })
    }
    const p = purposeMap.get(key)!
    p.count += 1
    if (m.distanceKm && m.distanceKm > 0) p.totalDistanceKm += m.distanceKm
    if (row.status === 'returned') p.completedCount += 1
  }

  const purposes = Array.from(purposeMap.values())
    .map((p) => ({
      ...p,
      percentage: totalPasses > 0 ? Math.round((p.count / totalPasses) * 1000) / 10 : 0,
      avgDistanceKm: p.completedCount > 0 ? Math.round((p.totalDistanceKm / p.completedCount) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count)

  // 4. Model Utilization
  const modelMap = new Map<string, {
    model: string
    tripCount: number
    totalDistanceKm: number
    tripMinutesSum: number
    tripMinutesCount: number
  }>()

  for (const { row, m } of evaluated) {
    const key = row.model || 'Unknown Model'
    if (!modelMap.has(key)) {
      modelMap.set(key, {
        model: key,
        tripCount: 0,
        totalDistanceKm: 0,
        tripMinutesSum: 0,
        tripMinutesCount: 0,
      })
    }
    const item = modelMap.get(key)!
    item.tripCount += 1
    if (m.distanceKm && m.distanceKm > 0) item.totalDistanceKm += m.distanceKm
    if (m.tripMinutes !== null) {
      item.tripMinutesSum += m.tripMinutes
      item.tripMinutesCount += 1
    }
  }

  const models = Array.from(modelMap.values())
    .map((m) => ({
      model: m.model,
      tripCount: m.tripCount,
      percentage: totalPasses > 0 ? Math.round((m.tripCount / totalPasses) * 1000) / 10 : 0,
      totalDistanceKm: m.totalDistanceKm,
      avgDistanceKm: m.tripCount > 0 ? Math.round((m.totalDistanceKm / m.tripCount) * 10) / 10 : 0,
      avgTripMinutes: m.tripMinutesCount > 0 ? Math.round(m.tripMinutesSum / m.tripMinutesCount) : null,
    }))
    .sort((a, b) => b.tripCount - a.tripCount)

  // 5. Individual Vehicles Breakdown
  const vehicleMap = new Map<string, {
    vin: string
    regNo: string
    model: string
    variant: string
    color: string
    trips: number
    totalDistanceKm: number
    fuelSpend: number
    fuelLitres: number
  }>()

  for (const { row, m } of evaluated) {
    const key = row.vin
    if (!vehicleMap.has(key)) {
      vehicleMap.set(key, {
        vin: row.vin,
        regNo: row.registrationNumber || 'No Plate',
        model: row.model || '—',
        variant: row.variant || '',
        color: row.color || '',
        trips: 0,
        totalDistanceKm: 0,
        fuelSpend: 0,
        fuelLitres: 0,
      })
    }
    const item = vehicleMap.get(key)!
    item.trips += 1
    if (m.distanceKm && m.distanceKm > 0) item.totalDistanceKm += m.distanceKm
    if (row.fuelAmount) item.fuelSpend += Number(row.fuelAmount) || 0
    if (row.fuelLitres) item.fuelLitres += Number(row.fuelLitres) || 0
  }

  const vehicles = Array.from(vehicleMap.values())
    .map((v) => ({
      ...v,
      avgDistanceKm: v.trips > 0 ? Math.round((v.totalDistanceKm / v.trips) * 10) / 10 : 0,
    }))
    .sort((a, b) => b.trips - a.trips)

  // 6. Branch / Dealer Comparison
  const branchMap = new Map<string, {
    dealerCode: string
    branchName: string
    totalPasses: number
    completedTrips: number
    totalDistanceKm: number
    onTimeCount: number
    fuelSpend: number
    fuelLitres: number
  }>()

  const dealerNames = new Map(KIA_BRANCH_DEALERS.map((d) => [d.dealerCode.toUpperCase(), d.label]))

  for (const { row, m } of evaluated) {
    const code = (row.dealerCode || 'UNKNOWN').toUpperCase()
    if (!branchMap.has(code)) {
      branchMap.set(code, {
        dealerCode: code,
        branchName: dealerNames.get(code) || code,
        totalPasses: 0,
        completedTrips: 0,
        totalDistanceKm: 0,
        onTimeCount: 0,
        fuelSpend: 0,
        fuelLitres: 0,
      })
    }
    const b = branchMap.get(code)!
    b.totalPasses += 1
    if (row.status === 'returned') {
      b.completedTrips += 1
      if (m.onTime === true) b.onTimeCount += 1
    }
    if (m.distanceKm && m.distanceKm > 0) b.totalDistanceKm += m.distanceKm
    if (row.fuelAmount) b.fuelSpend += Number(row.fuelAmount) || 0
    if (row.fuelLitres) b.fuelLitres += Number(row.fuelLitres) || 0
  }

  const branches = Array.from(branchMap.values()).map((b) => ({
    dealerCode: b.dealerCode,
    branchName: b.branchName,
    totalPasses: b.totalPasses,
    completedTrips: b.completedTrips,
    totalDistanceKm: b.totalDistanceKm,
    onTimeRate: b.completedTrips > 0 ? Math.round((b.onTimeCount / b.completedTrips) * 100) : null,
    fuelSpend: b.fuelSpend,
    fuelLitres: Math.round(b.fuelLitres * 10) / 10,
  }))

  // 7. Hourly Checkout Pattern (Gate Out time or Created time)
  const hourlyCounts = new Array(24).fill(0)
  for (const { row } of evaluated) {
    const targetDate = row.gateOutAt ? new Date(row.gateOutAt) : new Date(row.createdAt)
    const hours = (targetDate.getUTCHours() + 5 + Math.floor((targetDate.getUTCMinutes() + 30) / 60)) % 24 // IST
    hourlyCounts[hours] += 1
  }

  const hourly = Array.from({ length: 15 }, (_, i) => {
    const hour = i + 7 // 7 AM to 9 PM
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour > 12 ? hour - 12 : hour
    return {
      hour,
      label: `${displayHour} ${ampm}`,
      count: hourlyCounts[hour] || 0,
    }
  })

  // 8. Drivers / Requesters
  const driverMap = new Map<string, {
    name: string
    email: string
    kind: string
    totalTrips: number
    completedTrips: number
    totalDistanceKm: number
    testDrivesCount: number
    onTimeCount: number
  }>()

  for (const { row, m } of evaluated) {
    const key = (row.driverName || row.requestedByName || 'Unknown').trim()
    if (!driverMap.has(key)) {
      driverMap.set(key, {
        name: key,
        email: row.requestedByEmail || '',
        kind: row.driverKind || 'staff',
        totalTrips: 0,
        completedTrips: 0,
        totalDistanceKm: 0,
        testDrivesCount: 0,
        onTimeCount: 0,
      })
    }
    const d = driverMap.get(key)!
    d.totalTrips += 1
    if (row.status === 'returned') {
      d.completedTrips += 1
      if (m.onTime === true) d.onTimeCount += 1
    }
    if (m.distanceKm && m.distanceKm > 0) d.totalDistanceKm += m.distanceKm
    const p = (row.purpose || '').toLowerCase()
    if (p.includes('test drive') || p.includes('home demo')) d.testDrivesCount += 1
  }

  const drivers = Array.from(driverMap.values())
    .map((d) => ({
      name: d.name,
      email: d.email,
      kind: d.kind,
      totalTrips: d.totalTrips,
      completedTrips: d.completedTrips,
      totalDistanceKm: d.totalDistanceKm,
      testDrivesCount: d.testDrivesCount,
      onTimeRate: d.completedTrips > 0 ? Math.round((d.onTimeCount / d.completedTrips) * 100) : null,
    }))
    .sort((a, b) => b.totalTrips - a.totalTrips)
    .slice(0, 20)

  // 9. Fuel Summary by Vehicle
  const fuelVehicleMap = new Map<string, {
    regNo: string
    model: string
    passesCount: number
    litres: number
    amount: number
  }>()

  for (const { row } of fuelRows) {
    const key = row.registrationNumber || row.vin.slice(-6)
    if (!fuelVehicleMap.has(key)) {
      fuelVehicleMap.set(key, {
        regNo: row.registrationNumber || `VIN …${row.vin.slice(-6)}`,
        model: row.model || '—',
        passesCount: 0,
        litres: 0,
        amount: 0,
      })
    }
    const item = fuelVehicleMap.get(key)!
    item.passesCount += 1
    if (row.fuelLitres) item.litres += Number(row.fuelLitres) || 0
    if (row.fuelAmount) item.amount += Number(row.fuelAmount) || 0
  }

  const fuelByVehicle = Array.from(fuelVehicleMap.values())
    .map((v) => ({
      ...v,
      litres: Math.round(v.litres * 10) / 10,
      amount: Math.round(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount)

  return {
    kpis: {
      totalPasses,
      completedTrips,
      activeOut,
      pendingApproval,
      readyForGateOut,
      cancelledOrRejected,
      totalDistanceKm,
      avgDistancePerTrip,
      onTimeRate,
      onTimeCount: onTimeRows.length,
      lateCount: lateRows.length,
      medianTripMinutes,
      medianApprovalMinutes,
      medianDispatchMinutes,
      totalFuelAmount,
      totalFuelLitres: Math.round(totalFuelLitres * 10) / 10,
      fuelPassesCount: fuelRows.length,
      avgFuelCostPerLitre,
      evidenceComplianceRate,
    },
    trend,
    purposes,
    models,
    vehicles,
    branches,
    hourly,
    drivers,
    fuelSummary: {
      totalSpend: totalFuelAmount,
      totalLitres: Math.round(totalFuelLitres * 10) / 10,
      passesCount: fuelRows.length,
      proofsAttachedCount: fuelProofsAttached,
      proofsPendingCount: fuelRows.length - fuelProofsAttached,
      byVehicle: fuelByVehicle,
    },
  }
}
