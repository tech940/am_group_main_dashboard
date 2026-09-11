import 'server-only'

import { and, asc, desc, eq, gte, ilike, isNotNull, lt, lte, ne, not, notIlike, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses, demoGatePassTrips, fuelApprovals } from '@/lib/db/schema'
import { getIndiaYmd, indiaDayBounds, serializeAppDate } from '@/lib/date-time'
import { STATUS_LABELS } from '@/lib/fuel-approvals/constants'
import { listDemoVehiclesForGatePass } from '@/lib/gate-pass/vehicles'
import { getKiaBranchLabel, normalizeKiaDealerCode } from '@/lib/kia/dealer-branch'
import { buildFuelManagementResponse, fuelBranchOfLocation, titleCase } from './metrics'
import type {
  DemoFleetCarInput,
  DrivePassInput,
  FuelManagementPeriod,
  FuelManagementResponse,
  FuelRowInput,
  GateReadingInput,
  PriorDemoFillInput,
} from './types'

/**
 * Fuel Management — the reads. Every figure is worked out by the pure ./metrics.ts; this file only fetches.
 *
 *  - Only the columns the screen needs are read. The old version selected every column of both tables, filtered in
 *    JavaScript, and sent whole fuel rows — personal and approval-trail columns included — to the browser.
 *  - Dates are filtered in SQL. A fill date is a DATE and is compared as one. A gate timestamp is compared against
 *    the India-time bounds of the period (indiaDayBounds): the old toISOString().slice(0, 10) put every pass after
 *    18:30 IST on the following day.
 *  - ⚠️ No JS Date is ever interpolated into a raw sql`` template — the driver's timestamp serializer is
 *    pass-through and crashes on one. Timestamps only go through column-bound helpers (gte / lte / lt).
 *  - The branch filter decides what is COUNTED and LISTED. What keeps a car's own record true — its fills at the
 *    other branch, its last fill before the period, its gate readings at any gate — is read regardless of branch.
 *    See buildFuelManagementResponse for why.
 */

/**
 * Mirrors fuelBranchOfLocation in ./metrics.ts: a location naming UDHAMPUR is JK501; otherwise one naming JAMMU
 * is JK402.
 */
function fuelAtBranch(branch: 'JK402' | 'JK501'): SQL {
  if (branch === 'JK501') return ilike(fuelApprovals.location, '%UDHAMPUR%')
  return and(notIlike(fuelApprovals.location, '%UDHAMPUR%'), ilike(fuelApprovals.location, '%JAMMU%')) as SQL
}

/**
 * Mirrors parseOdometerKm in ./metrics.ts: drop commas, whitespace and a trailing "km"; what is left must be digits
 * with at most one decimal point.
 */
const hasUsableOdometer = sql`regexp_replace(regexp_replace(${fuelApprovals.currentKmReading}, '[,[:space:]]', '', 'g'), 'km$', '', 'i') ~ '^[0-9]+([.][0-9]+)?$'`

const FUEL_COLUMNS = {
  requestNumber: fuelApprovals.requestNumber,
  location: fuelApprovals.location,
  purpose: fuelApprovals.fuelRequiredFor,
  vehRegNo: fuelApprovals.vehRegNo,
  vinNo: fuelApprovals.vinNo,
  kmReadingText: fuelApprovals.currentKmReading,
  date: fuelApprovals.fuelFilledDate,
  litres: fuelApprovals.fuelFilledLtrs,
  status: fuelApprovals.status,
  currentStage: fuelApprovals.currentStage,
  createdAt: fuelApprovals.createdAt,
}

type FuelSelectRow = {
  requestNumber: string
  location: string
  purpose: string
  vehRegNo: string
  vinNo: string
  kmReadingText: string | null
  date: string
  litres: string
  status: string
  currentStage: string
  createdAt: Date
}

type GateReadingSelectRow = { vin: string; passNo: string; gateInAt: Date | null; gateInOdo: string | null }

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function ymdOf(value: unknown): string {
  return String(value ?? '').slice(0, 10)
}

function statusLabelOf(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? titleCase(status.replace(/_/g, ' '))
}

function branchLabelOfLocation(location: string): string {
  const branch = fuelBranchOfLocation(location)
  if (branch) return getKiaBranchLabel(branch)
  // getKiaBranchLabel falls back to 'Jammu' for an unknown code, which would mislabel 'KIA BANIHAL'.
  return titleCase(location.replace(/^\s*KIA\s+/i, '')) || 'Branch not recorded'
}

function toFuelRow(row: FuelSelectRow): FuelRowInput {
  const status = row.status.trim().toLowerCase()
  return {
    requestNumber: row.requestNumber,
    location: row.location,
    purpose: row.purpose,
    vehRegNo: row.vehRegNo,
    vinNo: row.vinNo,
    kmReadingText: row.kmReadingText,
    date: ymdOf(row.date),
    litres: toNumber(row.litres) ?? 0,
    status,
    statusLabel: statusLabelOf(status),
    currentStage: row.currentStage,
    branchLabel: branchLabelOfLocation(row.location),
    createdAt: serializeAppDate(row.createdAt) ?? '',
  }
}

function toGateReading(row: GateReadingSelectRow): GateReadingInput | null {
  const gateInAt = serializeAppDate(row.gateInAt)
  const gateInOdo = toNumber(row.gateInOdo)
  if (!gateInAt || gateInOdo === null) return null
  return {
    passNo: row.passNo,
    vin: String(row.vin ?? '').trim().toUpperCase(),
    gateInAt,
    gateInYmd: getIndiaYmd(gateInAt),
    gateInOdo,
  }
}

const isPresent = <T,>(value: T | null): value is T => value !== null

/**
 * Everything GET /api/fuel-management answers with, for a period already validated by resolveFuelManagementPeriod.
 *
 * Seven reads in one round: six small queries on the main database plus the demo fleet from the analytics
 * provider (listDemoVehiclesForGatePass — read once, outside any transaction, and never branch-filtered: a plate's
 * "shared" flag is counted across the whole fleet, and a Jammu fill of an Udhampur car must still match).
 */
export async function getFuelManagementOverview(period: FuelManagementPeriod): Promise<FuelManagementResponse> {
  const start = indiaDayBounds(period.from).start
  const end = indiaDayBounds(period.to).end
  if (!start || !end) throw new Error(`[fuel-management] unusable period ${period.from}..${period.to}`)

  const branch = period.branch === 'ALL' ? null : period.branch
  const fillDatedInPeriod = and(
    sql`${fuelApprovals.fuelFilledDate} >= ${period.from}::date`,
    sql`${fuelApprovals.fuelFilledDate} <= ${period.to}::date`,
  )
  const passVin = sql<string>`upper(btrim(${demoGatePasses.vin}))`

  const [fuelRows, otherBranchRows, priorRows, fleet, driveRows, beforeRows, inPeriodRows] = await Promise.all([
    // Fills dated in the period at the chosen branch — every status, so awaiting stages can be counted.
    db
      .select(FUEL_COLUMNS)
      .from(fuelApprovals)
      .where(and(fillDatedInPeriod, branch ? fuelAtBranch(branch) : undefined)),

    // The same period at the other branches, not rejected — comparison partners for a car's record and the checks.
    branch
      ? db
          .select(FUEL_COLUMNS)
          .from(fuelApprovals)
          .where(and(fillDatedInPeriod, not(fuelAtBranch(branch)), ne(fuelApprovals.status, 'rejected')))
      : Promise.resolve([] as FuelSelectRow[]),

    // The latest approved DEMO fill with a usable reading before the period, per vehicle label. Labels are matched
    // to cars in metrics.ts, so one row per label is enough: a car's previous reading is the newest of its labels'.
    db
      .selectDistinctOn([fuelApprovals.vehRegNo, fuelApprovals.vinNo], {
        requestNumber: fuelApprovals.requestNumber,
        vehRegNo: fuelApprovals.vehRegNo,
        vinNo: fuelApprovals.vinNo,
        kmReadingText: fuelApprovals.currentKmReading,
        date: fuelApprovals.fuelFilledDate,
        createdAt: fuelApprovals.createdAt,
      })
      .from(fuelApprovals)
      .where(
        and(
          sql`upper(btrim(${fuelApprovals.fuelRequiredFor})) = 'DEMO'`,
          eq(fuelApprovals.status, 'approved'),
          sql`${fuelApprovals.fuelFilledDate} < ${period.from}::date`,
          isNotNull(fuelApprovals.currentKmReading),
          hasUsableOdometer,
        ),
      )
      .orderBy(fuelApprovals.vehRegNo, fuelApprovals.vinNo, desc(fuelApprovals.fuelFilledDate), desc(fuelApprovals.createdAt)),

    listDemoVehiclesForGatePass(),

    // Gate passes that went out in the period at the chosen gate, with LocoNav's distance when reconciled.
    db
      .select({
        passNo: demoGatePasses.passNo,
        vin: demoGatePasses.vin,
        registrationNumber: demoGatePasses.registrationNumber,
        model: demoGatePasses.model,
        dealerCode: demoGatePasses.dealerCode,
        status: demoGatePasses.status,
        gateOutAt: demoGatePasses.gateOutAt,
        gateOutOdo: demoGatePasses.gateOutOdo,
        gateInOdo: demoGatePasses.gateInOdo,
        tripStatus: demoGatePassTrips.status,
        providerDistanceKm: demoGatePassTrips.providerDistanceKm,
      })
      .from(demoGatePasses)
      .leftJoin(demoGatePassTrips, eq(demoGatePassTrips.gatePassId, demoGatePasses.id))
      .where(
        and(
          gte(demoGatePasses.gateOutAt, start),
          lte(demoGatePasses.gateOutAt, end),
          branch ? sql`upper(btrim(${demoGatePasses.dealerCode})) = ${branch}` : undefined,
        ),
      )
      .orderBy(asc(demoGatePasses.gateOutAt)),

    // Per VIN, the highest gate-in reading before the period (any gate) — one row per car ever passed.
    db
      .selectDistinctOn([passVin], {
        vin: passVin,
        passNo: demoGatePasses.passNo,
        gateInAt: demoGatePasses.gateInAt,
        gateInOdo: demoGatePasses.gateInOdo,
      })
      .from(demoGatePasses)
      .where(and(eq(demoGatePasses.status, 'returned'), isNotNull(demoGatePasses.gateInOdo), lt(demoGatePasses.gateInAt, start)))
      .orderBy(passVin, desc(demoGatePasses.gateInOdo), desc(demoGatePasses.gateInAt)),

    // Every returned pass whose gate-in falls in the period (any gate).
    db
      .select({
        vin: demoGatePasses.vin,
        passNo: demoGatePasses.passNo,
        gateInAt: demoGatePasses.gateInAt,
        gateInOdo: demoGatePasses.gateInOdo,
      })
      .from(demoGatePasses)
      .where(
        and(
          eq(demoGatePasses.status, 'returned'),
          isNotNull(demoGatePasses.gateInOdo),
          gte(demoGatePasses.gateInAt, start),
          lte(demoGatePasses.gateInAt, end),
        ),
      ),
  ])

  const priorDemoFills: PriorDemoFillInput[] = priorRows.map((row) => ({
    requestNumber: row.requestNumber,
    vehRegNo: row.vehRegNo,
    vinNo: row.vinNo,
    kmReadingText: row.kmReadingText,
    date: ymdOf(row.date),
    createdAt: serializeAppDate(row.createdAt) ?? '',
  }))

  const demoFleet: DemoFleetCarInput[] = fleet.map((car) => ({
    vin: car.vin,
    registrationNumber: car.registrationNumber,
    model: car.model,
    branchLabel: car.branchLabel,
    sharedPlate: car.sharedPlate,
  }))

  const drives: DrivePassInput[] = driveRows
    .map((row): DrivePassInput | null => {
      const gateOutAt = serializeAppDate(row.gateOutAt)
      if (!gateOutAt) return null
      const dealerCode = normalizeKiaDealerCode(row.dealerCode)
      return {
        passNo: row.passNo,
        vin: String(row.vin ?? '').trim().toUpperCase(),
        registrationNumber: row.registrationNumber?.trim() || null,
        model: row.model?.trim() || null,
        branchLabel: dealerCode ? getKiaBranchLabel(dealerCode) : row.dealerCode?.trim() || 'Branch not recorded',
        status: row.status.trim().toLowerCase(),
        gateOutAt,
        gateOutOdo: toNumber(row.gateOutOdo),
        gateInOdo: toNumber(row.gateInOdo),
        gpsKm: row.tripStatus?.trim().toLowerCase() === 'reconciled' ? toNumber(row.providerDistanceKm) : null,
      }
    })
    .filter(isPresent)

  return buildFuelManagementResponse({
    period,
    fuelRows: fuelRows.map(toFuelRow),
    otherBranchFuelRows: otherBranchRows.map(toFuelRow),
    priorDemoFills,
    demoFleet,
    drives,
    returnedInPeriod: inPeriodRows.map(toGateReading).filter(isPresent),
    highestReturnedBeforePeriod: beforeRows.map(toGateReading).filter(isPresent),
    generatedAt: new Date().toISOString(),
  })
}
