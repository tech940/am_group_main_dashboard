import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/permissions/service'

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
