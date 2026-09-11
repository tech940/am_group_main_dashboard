import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { canUserApproveStage } from '@/lib/fuel-approvals/access'
import type { FuelApprovalStatus, FuelApprovalStage } from '@/lib/fuel-approvals/types'

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

    const { id } = await context.params
    const body = await request.json()
    const { action, remarks } = body as {
      action: 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESET'
      remarks?: string
    }

    if (!action || !['APPROVE', 'HOLD', 'SEND_BACK', 'REJECT', 'RESET'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
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

    const currentStatus = existing.status as FuelApprovalStatus
    const currentStage = existing.currentStage as FuelApprovalStage

    // Permission check
    const canApprove = canUserApproveStage(
      { id: user.id, role: user.role },
      currentStatus,
      currentStage
    )

    if (!canApprove) {
      return NextResponse.json(
        { error: `You do not have permission to act on this stage (${currentStage.toUpperCase()})` },
        { status: 403 }
      )
    }

    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()

    let newStatus: FuelApprovalStatus = currentStatus
    let newStage: FuelApprovalStage = currentStage
    const updatePayload: Record<string, any> = {
      updatedAt: nowTimestamp,
    }

    if (action === 'HOLD') {
      if (currentStage === 'ceo' || currentStage === 'ed') newStatus = 'ceo_on_hold'
      else if (currentStage === 'accounts') newStatus = 'accounts_on_hold'
      else if (currentStage === 'ea' || currentStage === 'hr') newStatus = 'accounts_on_hold'
      else if (currentStage === 'md') newStatus = 'accounts_on_hold'
    } else if (action === 'SEND_BACK') {
      newStatus = 'sent_back'
      updatePayload.sendBackReason = remarks || 'Sent back for correction'
    } else if (action === 'REJECT') {
      newStatus = 'rejected'
      newStage = 'rejected'
      updatePayload.rejectedBy = user.id
      updatePayload.rejectedByName = user.fullName
      updatePayload.rejectedAt = nowTimestamp
      updatePayload.rejectStage = currentStage
      updatePayload.rejectRemarks = remarks || 'Rejected'
    } else if (action === 'APPROVE') {
      newStatus = 'approved'
      newStage = 'completed'
      if (currentStage === 'ceo' || currentStage === 'ed') {
        updatePayload.ceoApprovedBy = user.id
        updatePayload.ceoApprovedByName = user.fullName
        updatePayload.ceoApprovedAt = nowTimestamp
        updatePayload.ceoRemarks = remarks || 'Approved by CEO'
      } else if (currentStage === 'accounts') {
        updatePayload.accountsApprovedBy = user.id
        updatePayload.accountsApprovedByName = user.fullName
        updatePayload.accountsApprovedAt = nowTimestamp
        updatePayload.accountsRemarks = remarks || 'Approved'
      }
    } else if (action === 'RESET' && (user.role === 'developer' || user.role === 'admin')) {
      newStatus = 'ceo_pending'
      newStage = 'ceo'
      updatePayload.ceoApprovedBy = null
      updatePayload.ceoApprovedByName = null
      updatePayload.ceoApprovedAt = null
      updatePayload.ceoRemarks = null
      updatePayload.accountsApprovedBy = null
      updatePayload.accountsApprovedByName = null
      updatePayload.accountsApprovedAt = null
      updatePayload.accountsRemarks = null
      updatePayload.eaApprovedBy = null
      updatePayload.eaApprovedByName = null
      updatePayload.eaApprovedAt = null
      updatePayload.eaRemarks = null
      updatePayload.edApprovedBy = null
      updatePayload.edApprovedByName = null
      updatePayload.edApprovedAt = null
      updatePayload.edRemarks = null
      updatePayload.hrApprovedBy = null
      updatePayload.hrApprovedByName = null
      updatePayload.hrApprovedAt = null
      updatePayload.hrRemarks = null
      updatePayload.mdApprovedBy = null
      updatePayload.mdApprovedByName = null
      updatePayload.mdApprovedAt = null
      updatePayload.mdRemarks = null
      updatePayload.rejectedBy = null
      updatePayload.rejectedByName = null
      updatePayload.rejectedAt = null
      updatePayload.rejectStage = null
      updatePayload.rejectRemarks = null
      updatePayload.sendBackReason = null
    }

    updatePayload.status = newStatus
    updatePayload.currentStage = newStage

    // Append to audit history
    const existingHistory = (existing.history as any[]) || []
    const historyItem = {
      id: crypto.randomUUID(),
      action,
      stage: currentStage,
      userId: user.id,
      userName: user.fullName,
      userEmail: user.email,
      userRole: user.role,
      remarks: remarks || '',
      timestamp: nowIso,
    }

    updatePayload.history = [...existingHistory, historyItem]

    const [updated] = await db
      .update(fuelApprovals)
      .set(updatePayload)
      .where(eq(fuelApprovals.id, id))
      .returning()

    return NextResponse.json({
      item: updated,
      message: `Action ${action} recorded successfully`,
    })
  } catch (error) {
    console.error('Error executing fuel approval action:', error)
    return NextResponse.json(
      { error: 'Failed to execute action', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
