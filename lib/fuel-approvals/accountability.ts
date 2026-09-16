import 'server-only'

import { and, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { demoGatePasses, fuelApprovals } from '@/lib/db/schema'
import { isFuelFillingPurpose } from '@/lib/gate-pass/status'
import { invalidateCachePattern } from '@/lib/redis/cache-utils'
import { FUEL_DEPARTMENTS } from './constants'

/**
 * Requested vs approved vs actual, and the gate-pass link — the server half of migration 0071.
 *
 * Owner decisions (2026-09-16):
 *  - The approver may change the litres while approving; the default is the requested figure.
 *  - Closing an order records the ACTUAL litres from the bill, plus odometer and full-tank.
 *  - A demo car's "Fuel filling" gate pass is linked by the requester PICKING it. Never auto-matched.
 */

/** A litre figure is refused above this. It is a typing guard, not a tank rule — tanks live in fuel_benchmarks. */
export const MAX_FUEL_QUANTITY = 5000

export type QuantityResult = { ok: true; value: number | null } | { ok: false; error: string }

/**
 * A quantity from a request body. Absent or blank → null ("not given"). Anything present must be a positive
 * number no larger than MAX_FUEL_QUANTITY, or the request is refused — never silently dropped.
 */
export function parseQuantity(value: unknown, label: string): QuantityResult {
  if (value === undefined || value === null || String(value).trim() === '') return { ok: true, value: null }
  const n = Number(String(value).trim())
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${label} must be a number above zero.` }
  if (n > MAX_FUEL_QUANTITY) return { ok: false, error: `${label} of ${n} is too large — check the figure.` }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

export type DepartmentResult = { ok: true; value: string | null } | { ok: false; error: string }

/** The department the fuel is for. Only the listed departments are accepted; blank is "not recorded". */
export function parseDepartment(value: unknown): DepartmentResult {
  if (value === undefined || value === null || String(value).trim() === '') return { ok: true, value: null }
  const text = String(value).trim()
  const match = (FUEL_DEPARTMENTS as readonly string[]).find((d) => d.toLowerCase() === text.toLowerCase())
  return match ? { ok: true, value: match } : { ok: false, error: `Unknown department "${text}".` }
}

export type LinkedPass = { id: string; passNo: string; vin: string; fuelLitres: number | null }
export type PassResult = { ok: true; pass: LinkedPass | null } | { ok: false; error: string; status: number }

const toNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The gate pass a request names, checked. `forRequestId` is the request being saved (null on create), so a
 * re-submit may keep its own link.
 *
 * Refused: a pass that does not exist, one that was not raised for fuel filling, one that never left the gate,
 * and one another request already claims — the same pump litres must never back two requests.
 */
export async function resolveFuelGatePass(value: unknown, forRequestId: string | null): Promise<PassResult> {
  if (value === undefined || value === null || String(value).trim() === '') return { ok: true, pass: null }
  const id = String(value).trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'That gate pass reference is not valid.', status: 400 }

  const [pass] = await db
    .select({
      id: demoGatePasses.id,
      passNo: demoGatePasses.passNo,
      vin: demoGatePasses.vin,
      purpose: demoGatePasses.purpose,
      status: demoGatePasses.status,
      fuelLitres: demoGatePasses.fuelLitres,
    })
    .from(demoGatePasses)
    .where(eq(demoGatePasses.id, id))
    .limit(1)

  if (!pass) return { ok: false, error: 'That gate pass no longer exists.', status: 404 }
  if (!isFuelFillingPurpose(pass.purpose)) {
    return { ok: false, error: `${pass.passNo} was not raised for fuel filling, so it cannot back a fuel request.`, status: 400 }
  }
  if (pass.status !== 'out' && pass.status !== 'returned') {
    return { ok: false, error: `${pass.passNo} never left the gate, so it has no fuel to show.`, status: 400 }
  }

  const [claimed] = await db
    .select({ requestNumber: fuelApprovals.requestNumber })
    .from(fuelApprovals)
    .where(and(eq(fuelApprovals.gatePassId, pass.id), forRequestId ? ne(fuelApprovals.id, forRequestId) : undefined))
    .limit(1)
  if (claimed) {
    return { ok: false, error: `${pass.passNo} is already linked to ${claimed.requestNumber}.`, status: 409 }
  }

  return {
    ok: true,
    pass: { id: pass.id, passNo: pass.passNo, vin: String(pass.vin ?? '').trim().toUpperCase(), fuelLitres: toNum(pass.fuelLitres) },
  }
}

export type FuelPassOption = {
  id: string
  passNo: string
  vin: string
  registrationNumber: string | null
  model: string | null
  dealerCode: string
  status: string
  gateOutAt: string | null
  gateInAt: string | null
  fuelLitres: number | null
  fuelAmount: number | null
}

/**
 * Fuel-filling gate passes a request could link: out or returned in the last `days`, not claimed by another
 * request (a request being re-submitted still sees its own). Newest first.
 */
export async function listLinkableFuelPasses(options: { days?: number; forRequestId?: string | null } = {}): Promise<FuelPassOption[]> {
  const days = Math.min(Math.max(options.days ?? 21, 1), 90)
  const since = new Date(Date.now() - days * 86_400_000)

  const rows = await db
    .select({
      id: demoGatePasses.id,
      passNo: demoGatePasses.passNo,
      vin: demoGatePasses.vin,
      registrationNumber: demoGatePasses.registrationNumber,
      model: demoGatePasses.model,
      dealerCode: demoGatePasses.dealerCode,
      purpose: demoGatePasses.purpose,
      status: demoGatePasses.status,
      gateOutAt: demoGatePasses.gateOutAt,
      gateInAt: demoGatePasses.gateInAt,
      fuelLitres: demoGatePasses.fuelLitres,
      fuelAmount: demoGatePasses.fuelAmount,
      claimedBy: fuelApprovals.id,
    })
    .from(demoGatePasses)
    .leftJoin(fuelApprovals, eq(fuelApprovals.gatePassId, demoGatePasses.id))
    .where(
      and(
        inArray(demoGatePasses.status, ['out', 'returned']),
        gte(demoGatePasses.gateOutAt, since),
        options.forRequestId
          ? or(isNull(fuelApprovals.id), eq(fuelApprovals.id, options.forRequestId))
          : isNull(fuelApprovals.id),
      ),
    )
    .orderBy(desc(demoGatePasses.gateOutAt))
    .limit(60)

  return rows
    .filter((row) => isFuelFillingPurpose(row.purpose))
    .map((row) => ({
      id: row.id,
      passNo: row.passNo,
      vin: String(row.vin ?? '').trim().toUpperCase(),
      registrationNumber: row.registrationNumber?.trim() || null,
      model: row.model?.trim() || null,
      dealerCode: row.dealerCode,
      status: row.status,
      gateOutAt: row.gateOutAt ? row.gateOutAt.toISOString() : null,
      gateInAt: row.gateInAt ? row.gateInAt.toISOString() : null,
      fuelLitres: toNum(row.fuelLitres),
      fuelAmount: toNum(row.fuelAmount),
    }))
}

/**
 * Fuel Management caches its ledger for a minute. Any write to a fuel record calls this, so the control centre
 * never shows a request in a state it has already left.
 */
export async function invalidateFuelManagementCache(): Promise<void> {
  try {
    await invalidateCachePattern('fuel-management:*')
  } catch (error) {
    // A cache that cannot be cleared must not fail the write that already succeeded; the TTL still expires it.
    console.warn('[fuel-approvals] could not clear the fuel-management cache:', error instanceof Error ? error.message : error)
  }
}
