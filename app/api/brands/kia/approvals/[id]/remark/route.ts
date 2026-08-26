import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isApprovalVisibleTo } from '@/lib/kia/approval-scope'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/permissions/service'
import { sendMdRemarkEmail } from '@/lib/approvals/decision-emails'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permission = await requirePermission(appUser, 'kia.approvals.view')
    if (!permission.allowed) {
      return NextResponse.json({ error: permission.reason }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const remarks = String(body.remarks || '').trim()

    if (!remarks) {
      return NextResponse.json({ error: 'Remark content cannot be empty.' }, { status: 400 })
    }

    const [requestRow] = await db
      .select()
      .from(kiaApprovalRequests)
      .where(eq(kiaApprovalRequests.id, id))
      .limit(1)

    if (!requestRow) {
      return NextResponse.json({ error: 'Approval request not found.' }, { status: 404 })
    }

    // Branch scope. The list is filtered, so a request the caller cannot see must not be actionable
    // by id either — see lib/kia/approval-scope.ts.
    if (!isApprovalVisibleTo(appUser, requestRow)) {
      return NextResponse.json(
        { error: 'This request belongs to another branch.' },
        { status: 403 }
      )
    }


    const historyList = Array.isArray(requestRow.history) ? [...requestRow.history] : []
    const roleLabel = String(appUser.role || '').toUpperCase()

    const historyEntry = {
      id: Math.random().toString(36).substring(7),
      role: roleLabel === 'ED' ? 'ED' : roleLabel === 'EA' ? 'EA' : roleLabel === 'ACCOUNTS' ? 'Accounts' : roleLabel,
      roleKey: appUser.role,
      user: appUser.fullName,
      action: 'REMARK_ADD',
      remarks,
      timestamp: new Date().toISOString()
    }

    historyList.push(historyEntry)

    const [updatedRow] = await db
      .update(kiaApprovalRequests)
      .set({
        history: historyList,
        updatedAt: new Date()
      })
      .where(eq(kiaApprovalRequests.id, id))
      .returning()

    // Notify the submitter when the MD comments — and ONLY the MD. Remarks from other stages are
    // internal working notes; an email for every one of those would drown the submitter.
    //
    // The template now lives in lib/approvals/decision-emails.ts alongside the send-back / reject /
    // hold messages, so the one-off resend and this route cannot say different things.
    if (['md', 'ceo'].includes(appUser.role)) {
      sendMdRemarkEmail({
        id: requestRow.id,
        name: requestRow.name,
        email: requestRow.email,
        amount: requestRow.amount,
        vendorName: requestRow.vendorName,
        requestNo: requestRow.requestNo,
        brand: requestRow.brand,
      }, {
        senderName: appUser.fullName || 'The MD',
        remarks,
      })
    }

    return NextResponse.json({
      success: true,
      row: updatedRow,
      message: 'Remark added successfully.'
    })
  } catch (error) {
    console.error('Error adding remark:', error)
    return NextResponse.json(
      {
        error: 'Failed to add remark',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
