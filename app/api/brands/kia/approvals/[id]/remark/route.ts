import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { isApprovalVisibleTo } from '@/lib/kia/approval-scope'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/permissions/service'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'

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
    if (['md', 'ceo'].includes(appUser.role) && requestRow.email) {
      const vendorLabel = (requestRow.vendorName || '').trim()
      const bodyHtml = `
        <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${requestRow.name},</p>
        <p style="margin:0 0 16px;font-size:15px;color:#334155">
          The MD has added a remark on your payment approval request${vendorLabel ? ` for <strong>${vendorLabel}</strong>` : ''} of <strong>INR ${requestRow.amount}</strong>.
        </p>
        <div style="margin:20px 0;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
          <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#0f766e;">Remark:</h4>
          <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${remarks}</p>
        </div>
        <p style="margin:0;font-size:12px;color:#94a3b8;">
          No action is needed unless the remark asks for something — this is for your information.
        </p>
      `
      void sendEmail({
        to: requestRow.email,
        subject: `MD Remark on your Payment Request${vendorLabel ? ` for ${vendorLabel}` : ''}`,
        html: emailLayout({
          heading: 'MD Remark Added',
          eyebrow: 'AM Group · Approvals',
          preheader: 'MD remark on your payment request',
          bodyHtml
        })
      }).catch((err) => {
        console.error('[approvals-remark] Failed to send MD remark email:', err)
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
