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

      if (!canApprove && action !== 'RESET') {
        continue
      }

      let newStatus: FuelApprovalStatus = currentStatus
      let newStage: FuelApprovalStage = currentStage
      const updatePayload: Record<string, any> = {
        updatedAt: nowTimestamp,
      }

      if (action === 'HOLD') {
        if (currentStage === 'ed') newStatus = 'ed_on_hold'
        else if (currentStage === 'hr') newStatus = 'hr_on_hold'
        else if (currentStage === 'md') newStatus = 'md_on_hold'
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
        if (currentStage === 'ed') {
          newStatus = 'hr_pending'
          newStage = 'hr'
          updatePayload.edApprovedBy = user.id
          updatePayload.edApprovedByName = user.fullName
          updatePayload.edApprovedAt = nowTimestamp
          updatePayload.edRemarks = remarks || 'Approved by ED'
        } else if (currentStage === 'hr') {
          newStatus = 'md_pending'
          newStage = 'md'
          updatePayload.hrApprovedBy = user.id
          updatePayload.hrApprovedByName = user.fullName
          updatePayload.hrApprovedAt = nowTimestamp
          updatePayload.hrRemarks = remarks || 'Approved by HR'
        } else if (currentStage === 'md') {
          newStatus = 'approved'
          newStage = 'completed'
          updatePayload.mdApprovedBy = user.id
          updatePayload.mdApprovedByName = user.fullName
          updatePayload.mdApprovedAt = nowTimestamp
          updatePayload.mdRemarks = remarks || 'Approved by MD'
        }
      } else if (action === 'RESET' && isDeveloperOrAdmin) {
        newStatus = 'ed_pending'
        newStage = 'ed'
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
      { error: 'Failed to process bulk action', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
