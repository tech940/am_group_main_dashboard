import 'server-only'

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import {
  demoGatePasses,
  demoGatePassTrips,
  fuelApprovals,
  fuelBenchmarks,
  fuelExceptionReviews,
  fuelIntelligenceSettings,
  loconavSyncState,
} from '@/lib/db/schema'
import { getIndiaYmd, indiaDayBounds, serializeAppDate } from '@/lib/date-time'
import { isFuelFillingPurpose } from '@/lib/gate-pass/status'
import { listDemoVehiclesForGatePass } from '@/lib/gate-pass/vehicles'
import { getKiaBranchLabel, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { isTripDiscrepancy } from '@/lib/loconav/trips'
import { getCachedData } from '@/lib/redis/cache-utils'
import { resolveFuelSettings, type EnergyType, type EnergyUnit, type FuelBenchmark } from './engine'
import {
  buildLedger,
  ledgerWindow,
  type Ledger,
  type LedgerFleetCar,
  type LedgerPassInput,
  type LedgerReviewInput,
  type LedgerRowInput,
  type LedgerTrailEntry,
} from './ledger'
import { MAX_PERIOD_DAYS, resolveFuelManagementPeriod } from './metrics'
import type { FuelEnergy, FuelExceptionReview, FuelFilters } from './types'

/**
 * Fuel Management — the reads behind the ledger. Every figure is worked out by the pure ./ledger.ts and
 * ./engine.ts; this file only fetches, and caches the built ledger for a minute per period.
 *
 *  - Rows are read for the period, the previous period of the same length, and about 13 months of history, so a
 *    car's mileage and baselines are true whatever period is on screen. Everything is filtered by DATE in SQL.
 *  - ⚠️ People appear by NAME only. The approval trail is reduced to action, name, role and time before it leaves
 *    this file — its entries also carry email addresses, and those never reach the ledger or the browser.
 *  - ⚠️ No JS Date is interpolated into a raw sql`` template (the driver's timestamp serializer crashes on one);
 *    timestamps only pass through column-bound helpers.
 *  - A failure in an optional source (the analytics fleet list) degrades to "unknown"
 *    rather than failing the page: fuel records still show, and the affected figures say why they are missing.
 */

const LEDGER_TTL_SECONDS = 60
/** Bump when the Ledger shape changes, or a cached copy of the old shape is served for a minute. */
// v2 (2026-09-19): estimatedCost on events, costWithEstimates / implausible stretches on segments.
const LEDGER_CACHE_VERSION = 'v2'

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

type TrailSource = { action?: unknown; userName?: unknown; userRole?: unknown; timestamp?: unknown }

/** Action, name, role, time. Whatever else an entry carries — an email, a note — stops here. */
function toTrail(history: unknown): LedgerTrailEntry[] {
  if (!Array.isArray(history)) return []
  return (history as TrailSource[])
    .filter((entry) => entry && typeof entry === 'object' && entry.action)
    .map((entry) => ({
      action: String(entry.action),
      actorName: String(entry.userName ?? '').trim() || 'Unknown',
      actorRole: entry.userRole ? String(entry.userRole) : null,
      at: String(entry.timestamp ?? ''),
    }))
    .filter((entry) => entry.at)
}

function branchOfDealer(dealerCode: string): { key: string; label: string } {
  const code = normalizeKiaDealerCode(dealerCode)
  // getKiaBranchLabel falls back to "Jammu" for an unknown code, so an unknown code keeps its own name.
  if (!code) return { key: String(dealerCode || 'NOT RECORDED').trim().toUpperCase(), label: String(dealerCode || 'Branch not recorded') }
  const label = getKiaBranchLabel(code)
  return { key: label.toUpperCase(), label }
}

async function readRows(from: string, to: string): Promise<LedgerRowInput[]> {
  const rows = await db
    .select({
      id: fuelApprovals.id,
      requestNumber: fuelApprovals.requestNumber,
      brand: fuelApprovals.brand,
      location: fuelApprovals.location,
      purpose: fuelApprovals.fuelRequiredFor,
      vehRegNo: fuelApprovals.vehRegNo,
      vinNo: fuelApprovals.vinNo,
      vehicleVin: fuelApprovals.vehicleVin,
      assetCode: fuelApprovals.assetCode,
      fuelType: fuelApprovals.fuelType,
      energyType: fuelApprovals.energyType,
      quantityUnit: fuelApprovals.quantityUnit,
      requested: fuelApprovals.fuelFilledLtrs,
      approved: fuelApprovals.approvedQuantity,
      actual: fuelApprovals.actualQuantity,
      totalCost: fuelApprovals.totalCost,
      odometerKm: fuelApprovals.odometerKm,
      kmReadingText: fuelApprovals.currentKmReading,
      isFullTank: fuelApprovals.isFullTank,
      odometerOverride: fuelApprovals.odometerOverride,
      stationName: fuelApprovals.stationName,
      department: fuelApprovals.department,
      gatePassId: fuelApprovals.gatePassId,
      date: fuelApprovals.fuelFilledDate,
      createdAt: fuelApprovals.createdAt,
      status: fuelApprovals.status,
      requesterName: fuelApprovals.submittedByName,
      ceoApproverName: fuelApprovals.ceoApprovedByName,
      ceoApprovedAt: fuelApprovals.ceoApprovedAt,
      legacyApproverName: fuelApprovals.accountsApprovedByName,
      legacyApprovedAt: fuelApprovals.accountsApprovedAt,
      history: fuelApprovals.history,
    })
    .from(fuelApprovals)
    .where(and(
      sql`${fuelApprovals.fuelFilledDate} >= ${from}::date`,
      sql`${fuelApprovals.fuelFilledDate} <= ${to}::date`,
    ))
    .orderBy(asc(fuelApprovals.fuelFilledDate), asc(fuelApprovals.createdAt))

  return rows.map((row) => {
    const trail = toTrail(row.history)
    const lastApproval = [...trail].reverse().find((t) => t.action.toUpperCase() === 'APPROVE') ?? null
    return {
      id: row.id,
      requestNumber: row.requestNumber,
      brand: row.brand,
      location: row.location,
      purpose: row.purpose,
      vehRegNo: row.vehRegNo,
      vinNo: row.vinNo,
      vehicleVin: row.vehicleVin,
      assetCode: row.assetCode,
      fuelType: row.fuelType,
      energyType: row.energyType,
      quantityUnit: row.quantityUnit,
      requested: toNum(row.requested),
      approved: toNum(row.approved),
      actual: toNum(row.actual),
      totalCost: toNum(row.totalCost),
      odometerKm: toNum(row.odometerKm),
      kmReadingText: row.kmReadingText,
      isFullTank: row.isFullTank,
      odometerOverride: Boolean(row.odometerOverride),
      stationName: row.stationName,
      department: row.department,
      gatePassId: row.gatePassId,
      date: String(row.date).slice(0, 10),
      createdAt: serializeAppDate(row.createdAt) ?? '',
      status: String(row.status ?? '').trim().toLowerCase(),
      requesterName: row.requesterName,
      approverName: row.ceoApproverName ?? row.legacyApproverName ?? lastApproval?.actorName ?? null,
      approvedAt: serializeAppDate(row.ceoApprovedAt) ?? serializeAppDate(row.legacyApprovedAt) ?? lastApproval?.at ?? null,
      trail,
    }
  })
}

const PASS_COLUMNS = {
  id: demoGatePasses.id,
  passNo: demoGatePasses.passNo,
  vin: demoGatePasses.vin,
  registrationNumber: demoGatePasses.registrationNumber,
  model: demoGatePasses.model,
  dealerCode: demoGatePasses.dealerCode,
  purpose: demoGatePasses.purpose,
  status: demoGatePasses.status,
  driverKind: demoGatePasses.driverKind,
  driverName: demoGatePasses.driverName,
  raisedByName: demoGatePasses.requestedByName,
  gateOutAt: demoGatePasses.gateOutAt,
  gateInAt: demoGatePasses.gateInAt,
  gateOutOdo: demoGatePasses.gateOutOdo,
  gateInOdo: demoGatePasses.gateInOdo,
  fuelLitres: demoGatePasses.fuelLitres,
  fuelAmount: demoGatePasses.fuelAmount,
  tripStatus: demoGatePassTrips.status,
  gpsKm: demoGatePassTrips.providerDistanceKm,
  tripOdometerKm: demoGatePassTrips.odometerDistanceKm,
  deltaKm: demoGatePassTrips.deltaKm,
  movingSeconds: demoGatePassTrips.movingSeconds,
  stoppedSeconds: demoGatePassTrips.stoppedSeconds,
  stops: demoGatePassTrips.stopCount,
  alerts: demoGatePassTrips.alertCount,
}

type PassSelectRow = {
  [K in keyof typeof PASS_COLUMNS]: unknown
}

function toPass(row: PassSelectRow): LedgerPassInput {
  const gateOutAt = serializeAppDate(row.gateOutAt as Date | null)
  const gateInAt = serializeAppDate(row.gateInAt as Date | null)
  const branch = branchOfDealer(String(row.dealerCode ?? ''))
  const driverKind = String(row.driverKind ?? 'staff')
  const tripStatus = row.tripStatus ? String(row.tripStatus).trim().toLowerCase() : null
  const gpsKm = tripStatus === 'reconciled' ? toNum(row.gpsKm) : null
  const odoKm = toNum(row.tripOdometerKm)
  return {
    id: String(row.id),
    passNo: String(row.passNo),
    vin: String(row.vin ?? '').trim().toUpperCase(),
    registrationNumber: row.registrationNumber ? String(row.registrationNumber).trim() : null,
    model: row.model ? String(row.model).trim() : null,
    dealerCode: String(row.dealerCode ?? ''),
    branchKey: branch.key,
    branchLabel: branch.label,
    purpose: String(row.purpose ?? ''),
    isFuelFilling: isFuelFillingPurpose(String(row.purpose ?? '')),
    status: String(row.status ?? '').trim().toLowerCase(),
    driverKind,
    // ⚠️ A customer who test-drove a car is never named on this screen.
    staffDriverName: driverKind === 'staff' && row.driverName ? String(row.driverName) : null,
    raisedByName: String(row.raisedByName ?? ''),
    gateOutAt,
    gateOutYmd: gateOutAt ? getIndiaYmd(gateOutAt) : null,
    gateInAt,
    gateInYmd: gateInAt ? getIndiaYmd(gateInAt) : null,
    gateOutOdo: toNum(row.gateOutOdo),
    gateInOdo: toNum(row.gateInOdo),
    fuelLitres: toNum(row.fuelLitres),
    fuelAmount: toNum(row.fuelAmount),
    trip: tripStatus
      ? {
          status: tripStatus,
          gpsKm,
          deltaKm: toNum(row.deltaKm),
          movingSeconds: toNum(row.movingSeconds),
          stoppedSeconds: toNum(row.stoppedSeconds),
          stops: toNum(row.stops),
          alerts: toNum(row.alerts),
          discrepancy: tripStatus === 'reconciled' && isTripDiscrepancy(gpsKm, odoKm),
        }
      : null,
  }
}

async function readPasses(from: string, to: string, linkedIds: string[]): Promise<LedgerPassInput[]> {
  const start = indiaDayBounds(from).start
  const end = indiaDayBounds(to).end
  if (!start || !end) throw new Error(`[fuel-management] unusable window ${from}..${to}`)
  const inWindow = await db
    .select(PASS_COLUMNS)
    .from(demoGatePasses)
    .leftJoin(demoGatePassTrips, eq(demoGatePassTrips.gatePassId, demoGatePasses.id))
    .where(and(gte(demoGatePasses.gateOutAt, start), lte(demoGatePasses.gateOutAt, end)))
    .orderBy(asc(demoGatePasses.gateOutAt))
  const have = new Set(inWindow.map((row) => row.id))
  const missing = linkedIds.filter((id) => !have.has(id))
  const extra = missing.length
    ? await db
        .select(PASS_COLUMNS)
        .from(demoGatePasses)
        .leftJoin(demoGatePassTrips, eq(demoGatePassTrips.gatePassId, demoGatePasses.id))
        .where(inArray(demoGatePasses.id, missing))
    : []
  return [...inWindow, ...extra].map((row) => toPass(row as PassSelectRow))
}

/** The demo fleet changes when a car is added or sold — minutes-old is fine, and the lookup costs ~1.5 s. */
const FLEET_TTL_SECONDS = 600

async function readFleet(): Promise<LedgerFleetCar[]> {
  try {
    const fleet = await getCachedData('fuel-management:fleet:v1', () => listDemoVehiclesForGatePass(), FLEET_TTL_SECONDS)
    return fleet.map((car) => ({
      vin: car.vin,
      registrationNumber: car.registrationNumber,
      model: car.model,
      variant: car.variant,
      branchLabel: car.branchLabel,
      sharedPlate: car.sharedPlate,
    }))
  } catch (error) {
    console.warn('[fuel-management] demo fleet unavailable:', error instanceof Error ? error.message : error)
    return []
  }
}

const ENERGIES = new Set<EnergyType>(['petrol', 'diesel', 'cng', 'ev', 'hybrid'])
const UNITS = new Set<EnergyUnit>(['L', 'kg', 'kWh'])

export async function readFuelBenchmarks(): Promise<(FuelBenchmark & { id: string; notes: string | null; setByName: string | null; updatedAt: string })[]> {
  const rows = await db
    .select({
      id: fuelBenchmarks.id,
      scope: fuelBenchmarks.scope,
      vin: fuelBenchmarks.vin,
      model: fuelBenchmarks.model,
      variant: fuelBenchmarks.variant,
      energyType: fuelBenchmarks.energyType,
      unit: fuelBenchmarks.unit,
      expectedEfficiency: fuelBenchmarks.expectedEfficiency,
      tankCapacity: fuelBenchmarks.tankCapacity,
      notes: fuelBenchmarks.notes,
      setByName: fuelBenchmarks.setByName,
      updatedAt: fuelBenchmarks.updatedAt,
    })
    .from(fuelBenchmarks)
    .orderBy(asc(fuelBenchmarks.model), asc(fuelBenchmarks.variant))
  return rows
    .filter((row) => ENERGIES.has(row.energyType as EnergyType) && UNITS.has(row.unit as EnergyUnit))
    .map((row) => ({
      id: row.id,
      scope: row.scope as FuelBenchmark['scope'],
      vin: row.vin,
      model: row.model,
      variant: row.variant,
      energyType: row.energyType as EnergyType,
      unit: row.unit as EnergyUnit,
      expectedEfficiency: toNum(row.expectedEfficiency),
      tankCapacity: toNum(row.tankCapacity),
      notes: row.notes,
      setByName: row.setByName,
      updatedAt: serializeAppDate(row.updatedAt) ?? '',
    }))
}

export async function readFuelSettingOverrides(): Promise<Record<string, number>> {
  const rows = await db.select({ key: fuelIntelligenceSettings.key, value: fuelIntelligenceSettings.value }).from(fuelIntelligenceSettings)
  const out: Record<string, number> = {}
  for (const row of rows) {
    const n = toNum(row.value)
    if (n !== null) out[row.key] = n
  }
  return out
}

async function readReviews(): Promise<LedgerReviewInput[]> {
  const rows = await db
    .selectDistinctOn([fuelExceptionReviews.exceptionKey], {
      key: fuelExceptionReviews.exceptionKey,
      outcome: fuelExceptionReviews.outcome,
      note: fuelExceptionReviews.note,
      reviewerName: fuelExceptionReviews.actorName,
      createdAt: fuelExceptionReviews.createdAt,
    })
    .from(fuelExceptionReviews)
    .orderBy(fuelExceptionReviews.exceptionKey, desc(fuelExceptionReviews.createdAt))
  return rows.map((row) => ({
    key: row.key,
    outcome: row.outcome as FuelExceptionReview['outcome'],
    note: row.note,
    reviewerName: row.reviewerName,
    at: serializeAppDate(row.createdAt) ?? '',
  }))
}

async function readSync(): Promise<Ledger['sync']> {
  try {
    const [row] = await db
      .select({ lastRunAt: loconavSyncState.lastRunAt, status: loconavSyncState.lastRunStatus })
      .from(loconavSyncState)
      .limit(1)
    return { loconavLastRunAt: serializeAppDate(row?.lastRunAt ?? null) ?? null, loconavStatus: row?.status ?? null }
  } catch {
    return { loconavLastRunAt: null, loconavStatus: null }
  }
}

/** Build the ledger for a period, uncached. */
export async function loadLedgerUncached(from: string, to: string, today = getIndiaYmd()): Promise<Ledger> {
  const window = ledgerWindow(from, to, today)
  const rows = await readRows(window.readFrom, window.to)
  const linked = [...new Set(rows.map((row) => row.gatePassId).filter(Boolean) as string[])]
  const [passes, fleet, benchmarks, overrides, reviews, sync] = await Promise.all([
    readPasses(window.readFrom, window.to, linked),
    readFleet(),
    readFuelBenchmarks(),
    readFuelSettingOverrides(),
    readReviews(),
    readSync(),
  ])
  return buildLedger({
    window,
    rows,
    passes,
    fleet,
    benchmarks,
    settings: resolveFuelSettings(overrides),
    settingsConfigured: Object.keys(overrides).length > 0,
    reviews,
    sync,
    generatedAt: new Date().toISOString(),
  })
}

/** The ledger for a period, cached for a minute. Every fuel write clears it (invalidateFuelManagementCache). */
export async function loadLedger(from: string, to: string): Promise<Ledger> {
  const today = getIndiaYmd()
  return getCachedData(
    `fuel-management:ledger:${LEDGER_CACHE_VERSION}:${from}:${to}:${today}`,
    () => loadLedgerUncached(from, to, today),
    LEDGER_TTL_SECONDS,
  )
}

// ── Request parsing ─────────────────────────────────────────────────────────────────────────────────

const FILTER_ENERGIES = new Set<FuelEnergy>(['petrol', 'diesel', 'cng', 'ev', 'hybrid', 'other'])
const KEY_PATTERN = /^[A-Za-z0-9 .,&:/()'_-]{1,80}$/

function keyParam(value: string | null, transform: (v: string) => string): string | null {
  const text = String(value ?? '').trim()
  if (!text || text.toLowerCase() === 'all') return null
  return KEY_PATTERN.test(text) ? transform(text) : null
}

export type FilterResult = { ok: true; filters: FuelFilters } | { ok: false; error: string }

/**
 * Filters from a query string. Dates follow resolveFuelManagementPeriod (default: this India month to date; at most
 * MAX_PERIOD_DAYS). Every other filter is a key the ledger's own options list produced; anything malformed is
 * ignored rather than trusted.
 */
export function parseFuelFilters(params: URLSearchParams, today = getIndiaYmd()): FilterResult {
  const period = resolveFuelManagementPeriod({ from: params.get('from'), to: params.get('to') }, today)
  if (!period.ok) return { ok: false, error: period.error }
  const energy = String(params.get('energy') ?? '').trim().toLowerCase()
  const fleet = String(params.get('fleet') ?? '').trim().toLowerCase()
  return {
    ok: true,
    filters: {
      from: period.period.from,
      to: period.period.to,
      branch: keyParam(params.get('branch'), (v) => v.toUpperCase()),
      brand: keyParam(params.get('brand'), (v) => v.toLowerCase()),
      purpose: keyParam(params.get('purpose'), (v) => v.toUpperCase()),
      department: keyParam(params.get('department'), (v) => v),
      energy: FILTER_ENERGIES.has(energy as FuelEnergy) ? (energy as FuelEnergy) : null,
      fleet: fleet === 'demo' || fleet === 'other' ? fleet : null,
      vehicle: keyParam(params.get('vehicle'), (v) => v.toUpperCase()),
    },
  }
}

export { MAX_PERIOD_DAYS }
