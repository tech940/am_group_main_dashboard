import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()
    const {
      location,
      fuelRequiredFor,
      vehRegNo,
      vinNo,
      lastFuelFilledDate,
      fuelType,
      currentKmReading,
      fuelFilledDate,
      fuelFilledLtrs,
      fuelSlipUrl,
      remarks,
    } = body

    const [existing] = await db
      .select()
      .from(fuelApprovals)
      .where(eq(fuelApprovals.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: 'Fuel approval record not found' }, { status: 404 })
    }

    if (existing.status !== 'sent_back') {
      return NextResponse.json({ error: 'Only sent-back requests can be re-submitted' }, { status: 400 })
    }

    // Ensure the submitter or an admin is resubmitting
    const role = user.role.trim().toLowerCase()
    const isSuper = role === 'developer' || role === 'admin' || role === 'md'
    if (existing.submittedById !== user.id && !isSuper) {
      return NextResponse.json({ error: 'Only the original submitter can re-submit this request' }, { status: 403 })
    }

    const parsedLtrs = parseFloat(fuelFilledLtrs)
    if (isNaN(parsedLtrs) || parsedLtrs <= 0) {
      return NextResponse.json({ error: 'Please enter a valid fuel quantity in liters' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()

    const existingHistory = (existing.history as any[]) || []
    const historyItem = {
      id: crypto.randomUUID(),
      action: 'RESUBMIT',
      stage: 'submitter',
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      userRole: user.role,
      remarks: remarks || 'Re-submitted with updated details',
      timestamp: nowIso,
    }

    const [updated] = await db
      .update(fuelApprovals)
      .set({
        location: location || existing.location,
        fuelRequiredFor: fuelRequiredFor || existing.fuelRequiredFor,
        vehRegNo: vehRegNo || existing.vehRegNo,
        vinNo: vinNo || existing.vinNo,
        lastFuelFilledDate: lastFuelFilledDate || existing.lastFuelFilledDate,
        fuelType: fuelType || existing.fuelType,
        currentKmReading: currentKmReading !== undefined ? String(currentKmReading) : existing.currentKmReading,
        fuelFilledDate: fuelFilledDate || existing.fuelFilledDate,
        fuelFilledLtrs: parsedLtrs.toFixed(2),
        fuelSlipUrl: fuelSlipUrl || existing.fuelSlipUrl,
        remarks: remarks || existing.remarks,
        status: 'ed_pending',
        currentStage: 'ed',
        sendBackReason: null,
        history: [...existingHistory, historyItem],
        updatedAt: nowTimestamp,
      })
      .where(eq(fuelApprovals.id, id))
      .returning()

    return NextResponse.json({
      item: updated,
      message: 'Fuel request re-submitted successfully to ED for review',
    })
  } catch (error) {
    console.error('Error re-submitting fuel approval:', error)
    return NextResponse.json(
      { error: 'Failed to re-submit fuel approval', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
