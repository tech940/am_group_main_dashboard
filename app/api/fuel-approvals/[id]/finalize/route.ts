import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { canViewFuelApprovals } from '@/lib/fuel-approvals/view-access'
import type { FuelApprovalHistoryItem } from '@/lib/fuel-approvals/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    const { totalCost, fuelSlipUrl, remarks } = body as {
      totalCost?: string | number | null
      fuelSlipUrl?: string | null
      remarks?: string | null
    }

    // Load existing record
    const [existing] = await db
      .select()
      .from(fuelApprovals)
      .where(eq(fuelApprovals.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json({ error: 'Fuel approval record not found' }, { status: 404 })
    }

    // Only approved records can be finalized
    if (existing.status !== 'approved') {
      return NextResponse.json(
        { error: 'Only CEO-approved fuel orders can be finalized' },
        { status: 400 }
      )
    }

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

    const finalFuelSlipUrl = fuelSlipUrl !== undefined && fuelSlipUrl !== null && String(fuelSlipUrl).trim() !== ''
      ? String(fuelSlipUrl).trim()
      : existing.fuelSlipUrl

    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()

    const existingHistory = (existing.history as FuelApprovalHistoryItem[]) || []
    const historyItem: FuelApprovalHistoryItem = {
      id: crypto.randomUUID(),
      action: 'FINALIZE',
      stage: 'completed',
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      userRole: user.role,
      remarks: remarks || (parsedCost ? `Finalized with fuel cost: ₹${Number(parsedCost).toLocaleString('en-IN')}` : 'Finalized order with updated attachments'),
      timestamp: nowIso,
    }

    const [updated] = await db
      .update(fuelApprovals)
      .set({
        totalCost: parsedCost,
        fuelSlipUrl: finalFuelSlipUrl,
        history: [...existingHistory, historyItem],
        updatedAt: nowTimestamp,
      })
      .where(eq(fuelApprovals.id, id))
      .returning()

    return NextResponse.json({
      item: updated,
      message: `Fuel order ${existing.requestNumber} finalized successfully`,
    })
  } catch (error) {
    console.error('Error finalizing fuel approval:', error)
    return NextResponse.json(
      { error: 'Failed to finalize fuel approval', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
