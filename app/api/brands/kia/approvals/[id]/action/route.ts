import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { glAccounts, kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmail } from '@/lib/email/email-service'
import { emailLayout } from '@/lib/email/templates/layout'
import { sendMdApprovalNotificationEmail } from '@/lib/email/md-approval-email'
import { isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'

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
    const { 
      action, 
      stage, 
      remarks, 
      invoiceNumber, 
      invoiceDocUrl, 
      glAccountId,
      utrNumber,
      paymentProofUrl
    } = body // action: 'APPROVE' | 'REJECT' | 'HOLD' | 'SEND_BACK', stage: 'sales_manager' | 'accounts' | 'ea' | 'md' | 'payment_done'

    if (!action || !['APPROVE', 'REJECT', 'HOLD', 'SEND_BACK'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be APPROVE, REJECT, HOLD, or SEND_BACK.' }, { status: 400 })
    }

    if (!stage || !['sales_manager', 'hr', 'accounts', 'ea', 'md', 'payment_done'].includes(stage)) {
      return NextResponse.json({ error: 'Invalid stage.' }, { status: 400 })
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

    // Role-based Authorization Checks
    const isSuperUser = ['ceo', 'md'].includes(appUser.role)
    const isTester = ['developer', 'admin'].includes(appUser.role)
    const userRoleLower = (appUser.role || '').toLowerCase()
    const isAccountsUser = 
      ['accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team', 'assistant_manager', 'manager'].includes(appUser.role) ||
      userRoleLower.includes('account') ||
      userRoleLower.includes('finance')
    const isHrUser =
      ['hr', 'hr_head', 'hr_team', 'hr_manager'].includes(appUser.role) ||
      userRoleLower.includes('hr')

    const deptNorm = (requestRow.department || '').trim().toUpperCase()
    const approvalTypeNorm = (requestRow.approvalType || '').trim().toUpperCase()

    const isServiceCategory = 
      deptNorm === 'SERVICE' || 
      deptNorm.includes('SERVICE') || 
      deptNorm.includes('PARTS') || 
      deptNorm.includes('BODY') || 
      deptNorm.includes('LABOUR') ||
      approvalTypeNorm.includes('PARTS') ||
      approvalTypeNorm.includes('WORKSHOP') ||
      approvalTypeNorm.includes('LABOUR') ||
      approvalTypeNorm.includes('MAINTENANCE') ||
      approvalTypeNorm.includes('SERVICE')

    const isGeneralSalesManager = 
      ['gsm', 'general_sales_manager', 'sales_manager', 'sales_head', 'general_manager'].includes(userRoleLower) ||
      userRoleLower.includes('sales_manager') ||
      userRoleLower.includes('general_sales')

    const isVp = 
      ['vp', 'vice_president', 'vice_pres', 'vp_service', 'service_vp'].includes(userRoleLower) ||
      userRoleLower.includes('vp') ||
      userRoleLower.includes('vice_president')

    let isAuthorized = false

    if (stage === 'sales_manager') {
      if (isServiceCategory) {
        // SERVICE ORDER: ONLY VP, SuperUser, or Admin/Developer can approve
        // ED IS STRICTLY EXCLUDED!
        isAuthorized = appUser.role === 'ed' ? false : isTester || isVp || isSuperUser
      } else {
        // SALES ORDER: Either ED, General Sales Manager, or SuperUser can approve
        isAuthorized = isTester || appUser.role === 'ed' || isGeneralSalesManager || isSuperUser
      }
    } else if (stage === 'hr') {
      isAuthorized = isTester || isHrUser || isSuperUser
    } else if (stage === 'accounts') {
      // SEPARATION OF DUTIES — `isSuperUser` (ceo/md) is DELIBERATELY EXCLUDED here.
      // Only Accounts may release money. developer/admin (`isTester`) stay for support only.
      isAuthorized = isTester || isAccountsUser
    } else if (stage === 'ea') {
      // EA/EBA/MD/CEO are authorized at the EA stage. If EBA or EA is absent/present, either can approve.
      isAuthorized = isTester || ['ea', 'eba'].includes(appUser.role) || isSuperUser
    } else if (stage === 'md') {
      // The stage where MD/CEO are the intended approver.
      isAuthorized = isTester || isSuperUser
    } else if (stage === 'payment_done') {
      // SEPARATION OF DUTIES — see the `accounts` stage above. `isSuperUser` (ceo/md) is
      // DELIBERATELY EXCLUDED: this stage writes paymentStatus = 'PAID', the UTR and the
      // payment proof. Recording a payment is an Accounts action, never an MD one.
      isAuthorized = isTester || isAccountsUser
    }

    if (!isAuthorized) {
      return NextResponse.json({ 
        error: `Your role (${appUser.role}) is not authorized to act on ${isServiceCategory ? 'Service (requires VP)' : 'Sales (requires ED or General Sales Manager)'} requests at the ${stage} stage.` 
      }, { status: 403 })
    }

    if (requestRow.emailSendStatus === 'SentBack' && action !== 'SEND_BACK') {
      return NextResponse.json({ error: 'This request is currently sent back for clarification and cannot be approved, rejected, or put on hold until the submitter re-submits it.' }, { status: 400 })
    }


    // Check steps order
    // Flow: 1: ED -> 2: HR (if required for Salary/PF/Incentive/Training/Uniform/ESI) -> 3: EA (optional) -> 4: MD -> 5: Accounts
    if (action !== 'SEND_BACK') {
      const requiresHr = isHrApprovalRequired(requestRow.approvalType)

      if (stage === 'hr' && !isTester && !isSuperUser) {
        if (requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'ED approval is pending.' }, { status: 400 })
        }
      } else if (stage === 'ea' && !isTester && !isSuperUser) {
        if (requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'ED approval is pending.' }, { status: 400 })
        }
        if (requiresHr && requestRow.hrApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'HR approval is pending.' }, { status: 400 })
        }
      } else if (stage === 'md' && !isTester) {
        if (requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'ED approval must be completed first.' }, { status: 400 })
        }
        if (requiresHr && requestRow.hrApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'HR approval must be completed first for Salary/PF/Incentive/Training/Uniform/ESI requests.' }, { status: 400 })
        }
        // EA is optional — no eaApproval check needed. The server auto-sets it below.
      } else if ((stage === 'accounts' || stage === 'payment_done') && !isTester) {
        if (
          requestRow.vpApproval !== 'APPROVED' ||
          requestRow.managementApproval !== 'APPROVED'
        ) {
          return NextResponse.json({ error: 'MD approval must be completed before Accounts stage.' }, { status: 400 })
        }
      }
    }

    // Build the updates
    const updates: Partial<typeof kiaApprovalRequests.$inferInsert> = {}
    let statusVal = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'NOT APPROVED' : action === 'HOLD' ? 'HELD' : 'SENT BACK'

    if (action === 'SEND_BACK') {
      updates.vpApproval = null
      updates.hrApproval = null
      updates.accountApproval = null
      updates.eaApproval = null
      updates.managementApproval = null
      updates.paymentStatus = 'PENDING'
      updates.sendBackReason = remarks || ''
      updates.emailSendStatus = 'SentBack'

      // Send email to submitter in background
      try {
        const bodyHtml = `
          <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${requestRow.name},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#334155">
            Your vendor payment approval request for <strong>${requestRow.vendorName}</strong> of <strong>INR ${requestRow.amount}</strong> has been sent back for clarification / additional information.
          </p>
          <div style="margin:20px 0;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
            <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#d97706;">Comments from Approver:</h4>
            <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${remarks || 'No remarks provided.'}</p>
          </div>
          <p style="margin:0 0 16px;font-size:15px;color:#334155">
            Please log in, review the feedback, upload any missing invoice/bills, and re-submit the request.
          </p>
        `
        void sendEmail({
          to: requestRow.email,
          subject: `Clarification Needed: Vendor Payment Request for ${requestRow.vendorName}`,
          html: emailLayout({
            heading: 'Payment Request Sent Back',
            eyebrow: 'AM Group · Approvals',
            preheader: 'Clarification Needed',
            bodyHtml
          })
        }).catch((err) => {
          console.error('[approvals-action] Failed to send send-back email:', err)
        })
      } catch (err) {
        console.error('[approvals-action] Failed to dispatch send-back email:', err)
      }
    } else {
      if (stage === 'sales_manager') {
        updates.vpApproval = statusVal
      } else if (stage === 'hr') {
        updates.hrApproval = statusVal
      } else if (stage === 'ea') {
        updates.eaApproval = statusVal
        if (action === 'APPROVE' && (isSuperUser || isTester)) {
          // When MD/CEO approves at EA stage, automatically approve Management stage as well!
          updates.managementApproval = 'APPROVED'
          updates.emailSendStatus = 'MDApproved'
          void sendMdApprovalNotificationEmail({
            toEmail: requestRow.email,
            requesterName: requestRow.name,
            vendorName: requestRow.vendorName || 'Vendor',
            amount: requestRow.amount,
            purpose: requestRow.remarks,
            department: requestRow.department,
            approvalType: requestRow.approvalType,
            approvalTime: new Date(),
          })
        }
      } else if (stage === 'md') {
        updates.managementApproval = statusVal
        if (action === 'APPROVE') {
          updates.vpApproval = 'APPROVED'
          // EA is an optional stage. When MD approves directly (either because EA already
          // approved or because MD is bypassing the optional EA stage), mark eaApproval as
          // APPROVED so that getPendingStageLabel() skips it and the request moves straight
          // to "Pending Accounts" — no more "EA stage approved by MD" appearing in history.
          if (!requestRow.eaApproval || requestRow.eaApproval === '') {
            updates.eaApproval = 'APPROVED'
          }
          updates.emailSendStatus = 'MDApproved'

          // Trigger email notification to requester that MD approved the payment order
          void sendMdApprovalNotificationEmail({
            toEmail: requestRow.email,
            requesterName: requestRow.name,
            vendorName: requestRow.vendorName || 'Vendor',
            amount: requestRow.amount,
            purpose: requestRow.remarks,
            department: requestRow.department,
            approvalType: requestRow.approvalType,
            approvalTime: new Date(),
          })
        }
        updates.managementRemarks = remarks || ''
        if (action === 'REJECT') {
          updates.emailSendStatus = 'Rejected'
        } else if (action === 'HOLD') {
          updates.emailSendStatus = 'Held'
        }
      } else if (stage === 'accounts' || stage === 'payment_done') {
        updates.accountApproval = statusVal
        if (action === 'APPROVE') {
          if (invoiceNumber && invoiceNumber.trim()) {
            updates.invoiceNumber = invoiceNumber.trim()
          }
          if (invoiceDocUrl && invoiceDocUrl.trim()) {
            updates.invoiceDocUrl = invoiceDocUrl.trim()
          }
          if (utrNumber && utrNumber.trim()) {
            updates.utrNumber = utrNumber.trim()
          }
          if (paymentProofUrl && paymentProofUrl.trim()) {
            updates.paymentProofUrl = paymentProofUrl.trim()
          }
          updates.paymentStatus = 'PAID'
          updates.paymentCompletedAt = new Date()
          updates.paymentCompletedBy = appUser.fullName
          updates.emailSendStatus = 'Completed'
          statusVal = 'PAID'
        } else if (action === 'REJECT') {
          updates.emailSendStatus = 'Rejected'
        } else {
          updates.emailSendStatus = 'Held'
        }
      }
    }

    // Build history entry
    const historyList = Array.isArray(requestRow.history) ? [...requestRow.history] : []
    const roleLabel = 
      stage === 'sales_manager' ? 'ED' : 
      stage === 'hr' ? 'HR' :
      stage === 'accounts' ? 'Accounts (Invoice)' : 
      stage === 'ea' ? 'EA' : 
      stage === 'payment_done' ? 'Accounts (Payment)' :
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
      roleKey: stage,
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
