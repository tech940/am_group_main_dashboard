import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { glAccounts, kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const { action, stage, remarks, invoiceNumber, invoiceDocUrl, glAccountId } = body // action: 'APPROVE' | 'REJECT' | 'HOLD', stage: 'sales_manager' | 'accounts' | 'ea' | 'md'

    if (!action || !['APPROVE', 'REJECT', 'HOLD'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be APPROVE, REJECT, or HOLD.' }, { status: 400 })
    }

    if (!stage || !['sales_manager', 'accounts', 'ea', 'md'].includes(stage)) {
      return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 })
    }

    // Role-based Authorization Checks
    const isSuperUser = ['ceo', 'md'].includes(appUser.role)
    const isTester = ['developer', 'admin'].includes(appUser.role)
    let isAuthorized = false

    if (stage === 'sales_manager') {
      isAuthorized = isTester || appUser.role === 'ed'
    } else if (stage === 'accounts') {
      isAuthorized = isTester || ['accounts', 'finance_head'].includes(appUser.role)
    } else if (stage === 'ea') {
      isAuthorized = isTester || ['ea'].includes(appUser.role)
    } else if (stage === 'md') {
      isAuthorized = isTester || isSuperUser // MD is ceos, mds
    }

    if (!isAuthorized) {
      return NextResponse.json({ error: `Your role (${appUser.role}) is not authorized to approve at the ${stage} stage.` }, { status: 403 })
    }

    // Retrieve existing request
    const [requestRow] = await db
      .select()
      .from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, id))
      .limit(1)

    if (!requestRow) {
      return NextResponse.json({ error: 'Approval request not found.' }, { status: 404 })
    }

    // Check if MD is bypassing or if steps are in order
    // Order: Sales Manager -> EA -> MD -> Accounts
    if (stage === 'ea' && !isSuperUser && !isTester) {
      if (requestRow.vpApproval !== 'APPROVED') {
        return NextResponse.json({ error: 'ED approval is pending.' }, { status: 400 })
      }
    } else if (stage === 'md' && !isSuperUser && !isTester) {
      if (requestRow.vpApproval !== 'APPROVED' || requestRow.eaApproval !== 'APPROVED') {
        return NextResponse.json({ error: 'Previous approval stages (ED & EA) must be completed.' }, { status: 400 })
      }
    } else if (stage === 'accounts' && !isSuperUser && !isTester) {
      if (
        requestRow.vpApproval !== 'APPROVED' ||
        requestRow.eaApproval !== 'APPROVED' ||
        requestRow.managementApproval !== 'APPROVED'
      ) {
        return NextResponse.json({ error: 'All previous approval stages (ED, EA & MD) must be completed first.' }, { status: 400 })
      }
    }

    // Build the updates
    const updates: Partial<typeof kiaApprovalRequests.$inferInsert> = {}
    const statusVal = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'NOT APPROVED' : 'HELD'

    if (stage === 'sales_manager') {
      updates.vpApproval = statusVal
    } else if (stage === 'ea') {
      updates.eaApproval = statusVal
    } else if (stage === 'md') {
      updates.managementApproval = statusVal
      updates.managementRemarks = remarks || ''
      if (action === 'REJECT') {
        updates.emailSendStatus = 'Rejected'
      } else if (action === 'HOLD') {
        updates.emailSendStatus = 'Held'
      }
    } else if (stage === 'accounts') {
      updates.accountApproval = statusVal
      if (action === 'APPROVE') {
        if (!invoiceNumber || !invoiceNumber.trim()) {
          return NextResponse.json({ error: 'Invoice number is required for accounts approval.' }, { status: 400 })
        }
        if (!invoiceDocUrl || !invoiceDocUrl.trim()) {
          return NextResponse.json({ error: 'Invoice file upload is required for accounts approval.' }, { status: 400 })
        }
        updates.invoiceNumber = invoiceNumber.trim()
        updates.invoiceDocUrl = invoiceDocUrl.trim()
        updates.emailSendStatus = 'Completed'
      } else if (action === 'REJECT') {
        updates.emailSendStatus = 'Rejected'
      } else {
        updates.emailSendStatus = 'Held'
      }
    }

    // Build history entry
    const historyList = Array.isArray(requestRow.history) ? [...requestRow.history] : []
    const roleLabel = 
      stage === 'sales_manager' ? 'ED' : 
      stage === 'accounts' ? 'Accounts' : 
      stage === 'ea' ? 'EA' : 
      'MD'

    // Update GL account if changed and log history
    if (glAccountId && glAccountId !== requestRow.glAccountId) {
      updates.glAccountId = glAccountId
      const [newGl] = await db
        .select()
        .from(glAccounts)
        .where(eq(glAccounts.id, glAccountId))
        .limit(1)
      if (newGl) {
        historyList.push({
          id: Math.random().toString(36).substring(7),
          role: roleLabel,
          roleKey: stage,
          user: appUser.fullName,
          action: 'GL_UPDATE',
          remarks: `GL Account changed to ${newGl.glName} (${newGl.glCode})`,
          timestamp: new Date().toISOString()
        })
      }
    }

    const historyEntry = {
      id: Math.random().toString(36).substring(7),
      role: roleLabel,
      roleKey: stage, // keep track of the original stage key
      user: appUser.fullName,
      action: statusVal,
      remarks: remarks || '',
      timestamp: new Date().toISOString()
    }
    historyList.push(historyEntry)
    updates.history = historyList
    updates.updatedAt = new Date()

    const [updatedRow] = await db
      .update(kiaApprovalRequests)
      .set(updates)
      .where(eq(kiaApprovalRequests.id, id))
      .returning()

    return NextResponse.json({
      success: true,
      row: updatedRow,
      message: `${roleLabel} action recorded successfully.`
    })
  } catch (error) {
    console.error('Error recording approval action:', error)
    return NextResponse.json(
      {
        error: 'Failed to record approval action',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
