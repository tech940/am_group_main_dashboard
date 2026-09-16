import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'
import { getFuelFinalization, isNonVehiclePurpose } from '@/lib/fuel-approvals/constants'
import { invalidateFuelManagementCache, parseQuantity, resolveFuelGatePass } from '@/lib/fuel-approvals/accountability'
import type { FuelApprovalHistoryItem } from '@/lib/fuel-approvals/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Closes an approved fuel order with what actually happened: the bill total, the slips, and — since
 * migration 0071 — the ACTUAL litres, the odometer at the fill, whether the tank was filled full, and the station.
 *
 * ⚠️ The actual litres are required the first time an order is closed (owner decision 2026-09-16): without them
 * "approved vs actual" has nothing to compare. A correction (re-closing) may leave any field out to keep it.
 * Odometer and full-tank are required for road vehicles only — a genset has neither.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await canViewFuelApprovals(user))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { totalCost, fuelSlipUrl, remarks, actualQuantity, odometerKm, isFullTank, stationName, gatePassId } = body as {
      totalCost?: string | number | null
      fuelSlipUrl?: string | null
      remarks?: string | null
      actualQuantity?: unknown
      odometerKm?: unknown
      isFullTank?: unknown
      stationName?: unknown
      /** A request raised before gate passes could be linked may be tied to its pass when the bill is recorded. */
      gatePassId?: unknown
    }

    const [existing] = await db
      .select()
      .from(fuelApprovals)
      .where(eq(fuelApprovals.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: 'Fuel approval record not found' }, { status: 404 })
    }

    if (existing.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only CEO-approved fuel orders can be finalized' },
        { status: 400 }
      )
    }

    const isCorrection = getFuelFinalization(existing).finalized
    const isVehicle = !isNonVehiclePurpose(existing.fuelRequiredFor)

    let parsedCost: string | null = existing.totalCost
    if (totalCost !== undefined) {
      if (totalCost != null && String(totalCost).trim() !== '') {
        const c = parseFloat(String(totalCost))
        if (isNaN(c) || c <= 0) {
          return NextResponse.json({ error: 'Please enter a valid fuel cost amount' }, { status: 400 })
        }
        parsedCost = c.toFixed(2)
      } else {
        parsedCost = null
      }
    }

    const actual = parseQuantity(actualQuantity, 'Actual litres')
    if (!actual.ok) return NextResponse.json({ error: actual.error }, { status: 400 })
    const actualToStore = actual.value !== null ? actual.value.toFixed(2) : existing.actualQuantity
    if (actualToStore === null) {
      return NextResponse.json({ error: 'Enter the actual litres from the bill or the pump meter.' }, { status: 400 })
    }

    let odometerToStore = existing.odometerKm
    if (odometerKm !== undefined && odometerKm !== null && String(odometerKm).trim() !== '') {
      const km = Number(String(odometerKm).replace(/[,\s]/g, ''))
      if (!Number.isFinite(km) || km < 0 || km > 9_999_999) {
        return NextResponse.json({ error: 'Enter the odometer reading in kilometres.' }, { status: 400 })
      }
      odometerToStore = km.toFixed(1)
    }

    // Only a real boolean counts; anything else keeps what is stored ("not recorded" stays not recorded).
    const fullTankToStore = typeof isFullTank === 'boolean' ? isFullTank : existing.isFullTank

    if (isVehicle && !isCorrection) {
      if (odometerToStore === null) {
        return NextResponse.json({ error: 'Enter the odometer reading at the fill.' }, { status: 400 })
      }
      if (fullTankToStore === null) {
        return NextResponse.json({ error: 'Say whether the tank was filled full.' }, { status: 400 })
      }
    }

    let passToStore = existing.gatePassId
    let vinToStore = existing.vehicleVin
    if (gatePassId !== undefined) {
      const linked = await resolveFuelGatePass(gatePassId, existing.id)
      if (!linked.ok) return NextResponse.json({ error: linked.error }, { status: linked.status })
      passToStore = linked.pass?.id ?? null
      if (linked.pass?.vin && !existing.assetCode && !existing.vehicleVin) vinToStore = linked.pass.vin
    }

    const stationToStore = stationName === undefined
      ? existing.stationName
      : String(stationName ?? '').trim().slice(0, 120) || null

    const finalFuelSlipUrl = fuelSlipUrl !== undefined && fuelSlipUrl !== null && String(fuelSlipUrl).trim() !== ''
      ? String(fuelSlipUrl).trim()
      : existing.fuelSlipUrl

    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()

    const summary = [
      `Actual ${Number(actualToStore)} L`,
      parsedCost ? `bill ₹${Number(parsedCost).toLocaleString('en-IN')}` : null,
    ].filter(Boolean).join(', ')

    const existingHistory = (existing.history as FuelApprovalHistoryItem[]) || []
    const historyItem: FuelApprovalHistoryItem = {
      id: crypto.randomUUID(),
      action: 'FINALIZE',
      stage: 'completed',
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      userRole: user.role,
      remarks: remarks ? `${summary}. ${remarks}` : `Finalized — ${summary}`,
      timestamp: nowIso,
    }

    const [updated] = await db
      .update(fuelApprovals)
      .set({
        totalCost: parsedCost,
        actualQuantity: actualToStore,
        odometerKm: odometerToStore,
        isFullTank: fullTankToStore,
        stationName: stationToStore,
        gatePassId: passToStore,
        vehicleVin: vinToStore,
        fuelSlipUrl: finalFuelSlipUrl,
        history: [...existingHistory, historyItem],
        updatedAt: nowTimestamp,
      })
      .where(eq(fuelApprovals.id, id))
      .returning()

    await invalidateFuelManagementCache()

    return NextResponse.json({
      item: updated,
      message: `Fuel order ${existing.requestNumber} finalized successfully`,
    })
  } catch (error) {
    console.error('Error finalizing fuel approval:', error)
    // ⚠️ No `details`: a raw driver message names columns and constraints to any caller.
    return NextResponse.json({ error: 'Failed to finalize fuel approval' }, { status: 500 })
  }
}
