import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { ids, action, remarks } = body // action: 'APPROVE' | 'REJECT' | 'HOLD', remarks: string

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty ids list.' }, { status: 400 })
    }

    if (!action || !['APPROVE', 'REJECT', 'HOLD'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be APPROVE, REJECT, or HOLD.' }, { status: 400 })
    }

    // Role mapping: get user's effective role and target stage
    const isSuperUser = ['ceo', 'md'].includes(appUser.role)
    const isTester = ['developer', 'admin'].includes(appUser.role)

    // Retrieve all targeted requests
    const rows = await db
      .select()
      .from(kiaApprovalRequests)
      .where(inArray(kiaApprovalRequests.id, ids))

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No matching approval requests found.' }, { status: 404 })
    }

    const processedRows = []
    const failedRows = []

    for (const row of rows) {
      // Determine what stage this request is currently in
      let activeStageKey: 'sales_manager' | 'accounts' | 'ea' | 'md' | null = null
      
      const vpApp = row.vpApproval
      const accApp = row.accountApproval
      const eaApp = row.eaApproval
      const mdApp = row.managementApproval

      // MD can act on anything not fully approved/rejected
      if (isSuperUser || isTester) {
        activeStageKey = 'md'
      } else {
        if (!vpApp || vpApp === 'HELD') {
          activeStageKey = 'sales_manager'
        } else if (vpApp === 'APPROVED' && (!accApp || accApp === 'HELD')) {
          activeStageKey = 'accounts'
        } else if (vpApp === 'APPROVED' && accApp === 'APPROVED' && (!eaApp || eaApp === 'HELD')) {
          activeStageKey = 'ea'
        } else if (vpApp === 'APPROVED' && accApp === 'APPROVED' && eaApp === 'APPROVED' && (!mdApp || mdApp === 'HELD')) {
          activeStageKey = 'md'
        }
      }

      if (!activeStageKey) {
        failedRows.push({ id: row.id, error: 'Request is already fully completed or rejected.' })
        continue;
      }

      // Check if user is authorized to act on this active stage
      let isAuthorized = false
      if (activeStageKey === 'sales_manager') {
        isAuthorized = isTester || ['sales_manager', 'manager'].includes(appUser.role)
      } else if (activeStageKey === 'accounts') {
        isAuthorized = isTester || ['accounts', 'finance_head'].includes(appUser.role)
      } else if (activeStageKey === 'ea') {
        isAuthorized = isTester || ['ea'].includes(appUser.role)
      } else if (activeStageKey === 'md') {
        isAuthorized = isTester || isSuperUser
      }

      if (!isAuthorized) {
        failedRows.push({ id: row.id, error: `Unauthorized to approve at ${activeStageKey} stage.` })
        continue
      }

      // Build updates
      const updates: Partial<typeof kiaApprovalRequests.$inferInsert> = {}
      const statusVal = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'NOT APPROVED' : 'HELD'

      if (activeStageKey === 'sales_manager') {
        updates.vpApproval = statusVal
      } else if (activeStageKey === 'accounts') {
        updates.accountApproval = statusVal
      } else if (activeStageKey === 'ea') {
        updates.eaApproval = statusVal
      } else if (activeStageKey === 'md') {
        updates.managementApproval = statusVal
        updates.managementRemarks = remarks || ''
        if (action === 'APPROVE') {
          updates.emailSendStatus = 'Completed'
        } else if (action === 'REJECT') {
          updates.emailSendStatus = 'Rejected'
        } else {
          updates.emailSendStatus = 'Held'
        }
      }

      // Build history entry
      const historyList = Array.isArray(row.history) ? [...row.history] : []
      const roleLabel = 
        activeStageKey === 'sales_manager' ? 'Sales Manager' : 
        activeStageKey === 'accounts' ? 'Accounts' : 
        activeStageKey === 'ea' ? 'EA' : 
        'MD'

      const historyEntry = {
        id: Math.random().toString(36).substring(7),
        role: roleLabel,
        roleKey: activeStageKey,
        user: appUser.fullName,
        action: statusVal,
        remarks: remarks || 'Bulk approved',
        timestamp: new Date().toISOString()
      }
      historyList.push(historyEntry)
      updates.history = historyList
      updates.updatedAt = new Date()

      // Execute update
      const [updatedRow] = await db
        .update(kiaApprovalRequests)
        .set(updates)
        .where(eq(kiaApprovalRequests.id, row.id))
        .returning()

      processedRows.push(updatedRow)
    }

    return NextResponse.json({
      success: true,
      processedCount: processedRows.length,
      failedCount: failedRows.length,
      failedRows,
      message: `Successfully processed ${processedRows.length} approvals. Failed: ${failedRows.length}.`
    })
  } catch (error: any) {
    console.error('Bulk approval handler error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
