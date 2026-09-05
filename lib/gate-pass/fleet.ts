import 'server-only'

import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses } from '@/lib/db/schema'
import { getKiaBranchLabel } from '@/lib/kia/dealer-branch'
import { listDemoVehiclesForGatePass, type GatePassVehicle } from './vehicles'
import { OPEN_GATE_PASS_STATUSES } from './status'

/**
 * The demo fleet by availability: what is here, what is spoken for, what has gone.
 *
 * ── Why this is a JS join and not a SQL one ───────────────────────────────────────────────────
 * The fleet lives in demo_car_list, read through the pluggable analytics provider (Postgres today,
 * BigQuery-capable). The passes live on the main db. There is no query that can span both, so the
 * two sides are fetched and joined here on VIN. That constraint is why a pass snapshots its vehicle
 * in the first place.
 *
 * ── Why VIN and never the registration number ─────────────────────────────────────────────────
 * Measured on the live feed: 29 demo VINs, 25 distinct plates. `JK02C0059TC` is a trade-certificate
 * plate worn by FIVE cars. Keying availability on the plate would report one car out and four
 * phantom cars available, or vice versa.
 */

export type FleetState = 'available' | 'reserved' | 'out'

export type FleetVehicle = GatePassVehicle & {
  state: FleetState
  /** Set when the car is reserved or out. */
  passId: string | null
  passNo: string | null
  driverName: string | null
  expectedReturnAt: Date | null
  /** Out, and past its return time. */
  overdue: boolean
}

export type FleetBranchCount = {
  dealerCode: string
  branchLabel: string
  total: number
  available: number
  reserved: number
  out: number
  overdue: number
}

export type FleetStatus = {
  total: number
  available: number
  reserved: number
  out: number
  overdue: number
  byBranch: FleetBranchCount[]
  vehicles: FleetVehicle[]
}

/**
 * Which cars are currently spoken for.
 *
 * 'approved' counts as RESERVED, not available. The pass exists, somebody expects to walk out to
 * that car, and showing it as free is how two people are sent to the same vehicle. It is a weaker
 * claim than 'out' — the car is physically here — so it is reported as its own state rather than
 * being folded into either.
 */
export async function getFleetStatus(dealerCodes: string[], now: Date = new Date()): Promise<FleetStatus> {
  const vehicles = await listDemoVehiclesForGatePass()
  const scoped = vehicles.filter((v) => !v.dealerCode || dealerCodes.includes(v.dealerCode))

  const openPasses = await db
    .select({
      id: demoGatePasses.id,
      passNo: demoGatePasses.passNo,
      vin: demoGatePasses.vin,
      status: demoGatePasses.status,
      driverName: demoGatePasses.driverName,
      expectedReturnAt: demoGatePasses.expectedReturnAt,
      dealerCode: demoGatePasses.dealerCode,
    })
    .from(demoGatePasses)
    .where(inArray(demoGatePasses.status, [...OPEN_GATE_PASS_STATUSES]))

  /*
   * A pass awaiting approval does NOT hold the car — it may well be rejected, and blocking the
   * vehicle on an unapproved request would let anyone reserve the fleet by raising requests.
   */
  const holding = new Map<string, typeof openPasses[number]>()
  for (const p of openPasses) {
    if (p.status !== 'out' && p.status !== 'approved') continue
    const key = p.vin.trim().toUpperCase()
    const existing = holding.get(key)
    // 'out' always wins over 'approved': the car is physically gone, whatever else is booked on it.
    if (!existing || (existing.status !== 'out' && p.status === 'out')) holding.set(key, p)
  }

  const enriched: FleetVehicle[] = scoped.map((v) => {
    const held = holding.get(v.vin)
    if (!held) {
      return { ...v, state: 'available', passId: null, passNo: null, driverName: null, expectedReturnAt: null, overdue: false }
    }
    const out = held.status === 'out'
    return {
      ...v,
      state: out ? 'out' : 'reserved',
      passId: held.id,
      passNo: held.passNo,
      driverName: held.driverName,
      expectedReturnAt: held.expectedReturnAt,
      overdue: out && held.expectedReturnAt ? held.expectedReturnAt.getTime() < now.getTime() : false,
    }
  })

  const branches = new Map<string, FleetBranchCount>()
  for (const v of enriched) {
    const code = v.dealerCode ?? 'UNKNOWN'
    if (!branches.has(code)) {
      branches.set(code, {
        dealerCode: code,
        branchLabel: v.dealerCode ? getKiaBranchLabel(v.dealerCode) : 'Branch not recorded',
        total: 0, available: 0, reserved: 0, out: 0, overdue: 0,
      })
    }
    const b = branches.get(code)!
    b.total += 1
    b[v.state] += 1
    if (v.overdue) b.overdue += 1
  }

  return {
    total: enriched.length,
    available: enriched.filter((v) => v.state === 'available').length,
    reserved: enriched.filter((v) => v.state === 'reserved').length,
    out: enriched.filter((v) => v.state === 'out').length,
    overdue: enriched.filter((v) => v.overdue).length,
    byBranch: [...branches.values()].sort((a, b) => a.branchLabel.localeCompare(b.branchLabel)),
    vehicles: enriched.sort((a, b) => {
      // Out first, then reserved, then available — the ones needing attention at the top.
      const rank = { out: 0, reserved: 1, available: 2 } as const
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state]
      return (a.model ?? '').localeCompare(b.model ?? '')
    }),
  }
}

/**
 * Is this vehicle already spoken for?
 *
 * ⚠️ Called before a pass is created. Without it two people can raise passes for the same car,
 * both get approved, and both walk out to a vehicle only one of them will find — and the fleet
 * count then reports a car that is simultaneously out twice.
 */
export async function findHoldingPass(vin: string) {
  const key = vin.trim().toUpperCase()
  const rows = await db
    .select({
      id: demoGatePasses.id,
      passNo: demoGatePasses.passNo,
      status: demoGatePasses.status,
      driverName: demoGatePasses.driverName,
      requestedByName: demoGatePasses.requestedByName,
      expectedReturnAt: demoGatePasses.expectedReturnAt,
      vin: demoGatePasses.vin,
    })
    .from(demoGatePasses)
    .where(inArray(demoGatePasses.status, ['approved', 'out']))

  return rows.find((r) => r.vin.trim().toUpperCase() === key) ?? null
}
