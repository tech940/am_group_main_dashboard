import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { fuelApprovals } from '@/lib/db/schema'
import { inArray, eq } from 'drizzle-orm'
import { canUserApproveStage } from '@/lib/fuel-approvals/access'
import type { FuelApprovalStatus, FuelApprovalStage } from '@/lib/fuel-approvals/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedAppUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { ids, action, remarks } = body as {
      ids: string[]
      action: 'APPROVE' | 'HOLD' | 'SEND_BACK' | 'REJECT' | 'RESET'
      remarks?: string
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No request IDs provided' }, { status: 400 })
    }

    if (!action || !['APPROVE', 'HOLD', 'SEND_BACK', 'REJECT', 'RESET'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    if ((action === 'SEND_BACK' || action === 'REJECT') && !String(remarks || '').trim()) {
      return NextResponse.json({ error: `Remarks required for ${action === 'SEND_BACK' ? 'Send Back' : 'Reject'}` }, { status: 400 })
    }

    const records = await db
      .select()
      .from(fuelApprovals)
      .where(inArray(fuelApprovals.id, ids))

    if (!records.length) {
      return NextResponse.json({ error: 'No matching records found' }, { status: 404 })
    }

    const isDeveloperOrAdmin = user.role === 'developer' || user.role === 'admin'
    const nowIso = new Date().toISOString()
    const nowTimestamp = new Date()
    let processedCount = 0

    for (const record of records) {
      const currentStatus = record.status as FuelApprovalStatus
      const currentStage = record.currentStage as FuelApprovalStage

      // Authorization check
      const canApprove = isDeveloperOrAdmin || canUserApproveStage(
        { id: user.id, role: user.role },
        currentStatus,
        currentStage
      )

      // ⚠️ RESET used to escape this guard entirely — `!canApprove && action !== 'RESET'` let ANY
      // signed-in user into the loop body for a RESET. The status change below was still limited to
      // developer/admin, but everyone else reached the history append and the UPDATE, so any employee
      // could write audit entries onto records they had no business touching and bump updated_at.
      // RESET is now checked like every other action, and more strictly: it erases an approval chain,
      // so approving a stage is not enough — only developer/admin may do it.
      if (action === 'RESET' ? !isDeveloperOrAdmin : !canApprove) {
        continue
      }

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
        updatePayload.sendBackReason = remarks || 'Bulk sent back for review'
      } else if (action === 'REJECT') {
        newStatus = 'rejected'
        newStage = 'rejected'
        updatePayload.rejectedBy = user.id
        updatePayload.rejectedByName = user.fullName
        updatePayload.rejectedAt = nowTimestamp
        updatePayload.rejectStage = currentStage
        updatePayload.rejectRemarks = remarks || 'Bulk rejected'
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
      } else if (action === 'RESET' && isDeveloperOrAdmin) {
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

      const existingHistory = (record.history as any[]) || []
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

      await db
        .update(fuelApprovals)
        .set(updatePayload)
        .where(eq(fuelApprovals.id, record.id))

      processedCount++
    }

    return NextResponse.json({
      success: true,
      processedCount,
      message: `Successfully performed ${action} on ${processedCount} orders.`,
    })
  } catch (error) {
    console.error('Error executing bulk fuel approval action:', error)
    return NextResponse.json(
      // ⚠️ No `details`: a raw driver message names columns and constraints to any caller.
      { error: 'Failed to process bulk action' },
      { status: 500 }
    )
  }
}
