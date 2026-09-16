import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { canUserApproveStage } from '@/lib/fuel-approvals/access'
import type { FuelApprovalStatus, FuelApprovalStage } from '@/lib/fuel-approvals/types'
import { invalidateFuelManagementCache, parseQuantity } from '@/lib/fuel-approvals/accountability'

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
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { action, remarks, approvedQuantity } = body as {
      action: 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESET'
      remarks?: string
      /** Litres approved. Absent → the requested litres (owner decision 2026-09-16). */
      approvedQuantity?: unknown
    }

    const approvedParsed = parseQuantity(approvedQuantity, 'Approved litres')
    if (!approvedParsed.ok) {
      return NextResponse.json({ error: approvedParsed.error }, { status: 400 })
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

    // ⚠️ RESET erases an entire approval chain, so passing the stage check is not enough — the CEO can
    // approve, but must not be able to un-approve. Previously a RESET by anyone other than
    // developer/admin matched no branch below: the status stayed put, yet the record was still UPDATEd
    // and a RESET entry appended to its history, leaving an audit trail of an action that never happened.
    const isDeveloperOrAdmin = user.role === 'developer' || user.role === 'admin'
    if (action === 'RESET' && !isDeveloperOrAdmin) {
      return NextResponse.json(
        { error: 'Only a developer or administrator can reset an approval chain' },
        { status: 403 }
      )
    }

    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()
    let approvalNote = ''

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
      /*
       * ⚠️ APPROVED IS ITS OWN FACT (migration 0071). The approver may approve fewer — or more — litres than
       * were asked for; with no figure given, what was asked for is what was approved. Either way the number is
       * written here, at the moment of approval, so "requested vs approved" never compares a figure with itself.
       */
      const requested = Number(existing.fuelFilledLtrs)
      const approved = approvedParsed.value ?? requested
      updatePayload.approvedQuantity = approved.toFixed(2)
      if (approvedParsed.value !== null && Math.abs(approved - requested) >= 0.005) {
        approvalNote = `Approved ${approved} L of the ${requested} L requested.`
      }
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
      // An approval that is undone takes its approved figure with it.
      updatePayload.approvedQuantity = null
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
      remarks: [approvalNote, remarks || ''].filter(Boolean).join(' '),
      timestamp: nowIso,
    }

    updatePayload.history = [...existingHistory, historyItem]

    const [updated] = await db
      .update(fuelApprovals)
      .set(updatePayload)
      .where(eq(fuelApprovals.id, id))
      .returning()

    await invalidateFuelManagementCache()

    return NextResponse.json({
      item: updated,
      message: `Action ${action} recorded successfully`,
    })
  } catch (error) {
    console.error('Error executing fuel approval action:', error)
    return NextResponse.json(
      // ⚠️ No `details`: a raw driver message names columns and constraints to any caller.
      { error: 'Failed to execute action' },
      { status: 500 }
    )
  }
}
