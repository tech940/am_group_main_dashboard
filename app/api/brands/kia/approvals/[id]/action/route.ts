import { brandHasEd, brandHasFirstStage, firstStageApproverRolesForTrack, firstStageShortLabel, isServiceApproval, usesVpService } from '@/lib/approvals/first-stage-approver'
import { NextResponse } from 'next/server'
import { VENDOR_PAYMENT_ACTIONABLE_STAGES, approvalStageHistoryLabel } from '@/lib/md-approvals/vendor-payments-stage'
import { isApprovalVisibleTo } from '@/lib/kia/approval-scope'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { glAccounts, kiaApprovalRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { emailLayout } from '@/lib/email/templates/layout'
import { sendMdApprovalNotificationEmail } from '@/lib/email/md-approval-email'
import { sendApprovalDecisionEmail, getAppBaseUrl } from '@/lib/approvals/decision-emails'
import { brandHasHrStage, isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'
import { createResubmitToken } from '@/lib/kia/approval-resubmit'

/**
 * Human labels for the workflow stage that sent a request back, so the email can say WHICH stage
 * returned it rather than leaking the internal key.
 *
 * ⚠️ Keyed by STAGE, and the first stage's key is 'sales_manager', not 'ed'. The 'ed' entry below
 * therefore never matched, and a send-back from that stage fell through to `stage.toUpperCase()` —
 * emailing the submitter that their request was returned by "SALES_MANAGER". The first stage is
 * resolved through firstStageShortLabel instead, because its name is brand-dependent; the entry is
 * kept only so the map still reads as the full list of stages.
 */
const SEND_BACK_STAGE_LABELS: Record<string, string> = {
  ed: 'CEO',
  ceo: 'CEO',
  hr: 'HR',
  ea: 'EA',
  md: 'MD',
  accounts: 'Accounts',
  payment_done: 'Accounts',
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    } = body

    if (!action || !['APPROVE', 'REJECT', 'HOLD', 'SEND_BACK'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be APPROVE, REJECT, HOLD, or SEND_BACK.' }, { status: 400 })
    }

    /*
     * ⚠️ Derived from the shared list, never re-typed here.
     *
     * This was a hardcoded array with 'ceo' MISSING, while the code below carries a full
     * authorisation branch, a prerequisite check and a write branch for that very stage. The client
     * computes 'ceo' (getActiveStageKey) and posts it, so every CEO decision on a KIA request was
     * rejected here with "Invalid stage." before any of that ran — the stage was unactionable from
     * both the row buttons and the detail dialog.
     */
    if (!stage || !(VENDOR_PAYMENT_ACTIONABLE_STAGES as readonly string[]).includes(stage)) {
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

    // Branch scope. The list is filtered, so a request the caller cannot see must not be actionable
    // by id either — see lib/kia/approval-scope.ts.
    if (!isApprovalVisibleTo(appUser, requestRow)) {
      return NextResponse.json(
        { error: 'This request belongs to another branch.' },
        { status: 403 }
      )
    }

    // Role-based Authorization Checks
    const isSuperUser = ['ceo', 'md'].includes(appUser.role)
    /*
     * The MD alone.
     *
     * ⚠️ DO NOT narrow `isSuperUser` itself to fix the md stage — it is still read by the
     * sales_manager, ceo, hr and ea branches below, where a CEO legitimately belongs. Narrowing it
     * would silently strip the CEO from four stages nobody asked to change.
     */
    const isMd = appUser.role === 'md'
    const isTester = ['developer', 'admin'].includes(appUser.role)
    const userRoleLower = (appUser.role || '').toLowerCase()
    const isAccountsUser = 
      ['accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team', 'assistant_manager', 'manager'].includes(appUser.role) ||
      userRoleLower.includes('account') ||
      userRoleLower.includes('finance')
    const isHrUser =
      ['hr', 'hr_head', 'hr_team', 'hr_manager'].includes(appUser.role) ||
      userRoleLower.includes('hr')

    // One definition, shared with the bulk route, the screen and the visibility rule — see
    // isServiceApproval in lib/approvals/first-stage-approver.ts.
    const isServiceCategory = isServiceApproval(requestRow.department, requestRow.approvalType)

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
      const rowBrand = String(requestRow.brand || 'kia').toLowerCase()
      if (rowBrand === 'diamond' || rowBrand === 'honda') {
        // Diamond / Honda: Both Sales and Service first stage goes to VP
        isAuthorized = isTester || isVp || isSuperUser
      } else if (isServiceCategory) {
        // SERVICE ORDER: VP (or SuperUser / Admin/Developer)
        isAuthorized = isTester || isVp || isSuperUser
      } else {
        // SALES ORDER: General Sales Manager (or SuperUser / Admin/Developer)
        isAuthorized = isTester || isGeneralSalesManager || isSuperUser
      }
    } else if (stage === 'ceo') {
      // CEO STAGE (KIA): CEO / SuperUser / Admin/Developer
      isAuthorized = isTester || appUser.role === 'ceo' || isSuperUser
    } else if (stage === 'hr') {
      /*
       * Outside KIA there is no HR stage, so nobody may act on one — not even HR.
       */
      isAuthorized = brandHasHrStage(requestRow.brand) && (isTester || isHrUser || isSuperUser)
    } else if (stage === 'accounts') {
      // SEPARATION OF DUTIES — `isSuperUser` (ceo/md) is DELIBERATELY EXCLUDED here.
      // Only Accounts may release money. developer/admin (`isTester`) stay for support only.
      isAuthorized = isTester || isAccountsUser
    } else if (stage === 'ea') {
      // EA/EBA/MD/CEO are authorized at the EA stage. If EBA or EA is absent/present, either can approve.
      isAuthorized = isTester || ['ea', 'eba'].includes(appUser.role) || isSuperUser
    } else if (stage === 'md') {
      /*
       * SEPARATION OF DUTIES — `isSuperUser` (ceo/md) is DELIBERATELY NOT USED here, the same rule
       * already applied to `accounts` and `payment_done`.
       *
       * ⚠️ The MD stage is the MD's OWN desk. A CEO reaching it signs a SECOND time, having already
       * signed the ceo stage above — and because the APPROVE branch below back-stamps
       * `ceoApproval = 'APPROVED'`, that second signature also clears his own first one. It really
       * happened: on KIA_0203 and KIA_0201 the CEO approved the MD stage ~20 seconds after the EA
       * cleared it, so the MD never saw either request. Both were returned to the MD queue by
       * `scripts/revert-ceo-md-approvals.ts`.
       *
       * This one boolean gates APPROVE, REJECT, HOLD **and** SEND_BACK: the action switch further
       * down is a WRITE switch, not a second authorisation check.
       *
       * developer/admin (`isTester`) stay, for support only.
       */
      isAuthorized = isTester || isMd
    } else if (stage === 'payment_done') {
      // SEPARATION OF DUTIES — see the `accounts` stage above.
      isAuthorized = isTester || isAccountsUser
    }

    if (!isAuthorized) {
      return NextResponse.json({ 
        /*
         * Name the approver this BRAND actually has.
         */
        error: `Your role (${appUser.role}) is not authorized to act on ${
          stage === 'ceo'
            ? 'requests at the CEO stage (requires CEO)'
            : isServiceCategory
              ? 'Service (requires VP)'
              : 'Sales (requires the General Sales Manager)'
        } requests at the ${stage} stage.`
      }, { status: 403 })
    }

    if (requestRow.emailSendStatus === 'SentBack' && action !== 'SEND_BACK') {
      return NextResponse.json({ error: 'This request is currently sent back for clarification and cannot be approved, rejected, or put on hold until the submitter re-submits it.' }, { status: 400 })
    }


    // Check steps order
    // Flow: 1: GSM / VP (if brand has first stage) -> 2: CEO (KIA) -> 3: HR (if required) -> 4: EA -> 5: MD -> 6: Accounts
    if (action !== 'SEND_BACK') {
      const isKia = String(requestRow.brand || 'kia').toLowerCase() === 'kia'
      const hasFirstStage = brandHasFirstStage(requestRow.brand, requestRow.department, requestRow.approvalType)
      const requiresHr = isHrApprovalRequired(requestRow.approvalType, requestRow.brand)
      const firstStageName = firstStageShortLabel(
        requestRow.brand, requestRow.department, requestRow.approvalType,
      )

      if (stage === 'sales_manager' && !hasFirstStage) {
        return NextResponse.json({ error: 'This brand does not have a first stage approval.' }, { status: 400 })
      }

      if (stage === 'ceo' && !isTester && !isSuperUser) {
        if (hasFirstStage && requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: `${firstStageName} approval is pending.` }, { status: 400 })
        }
      } else if (stage === 'hr' && !isTester && !isSuperUser) {
        if (hasFirstStage && requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: `${firstStageName} approval is pending.` }, { status: 400 })
        }
        if (isKia && requestRow.ceoApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'CEO approval is pending.' }, { status: 400 })
        }
      } else if (stage === 'ea' && !isTester && !isSuperUser) {
        if (hasFirstStage && requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: `${firstStageName} approval is pending.` }, { status: 400 })
        }
        if (isKia && requestRow.ceoApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'CEO approval is pending.' }, { status: 400 })
        }
        if (requiresHr && requestRow.hrApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'HR approval is pending.' }, { status: 400 })
        }
      } else if (stage === 'md' && !isTester) {
        if (hasFirstStage && requestRow.vpApproval !== 'APPROVED') {
          return NextResponse.json({ error: `${firstStageName} approval must be completed first.` }, { status: 400 })
        }
        if (isKia && requestRow.ceoApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'CEO approval must be completed first.' }, { status: 400 })
        }
        if (requiresHr && requestRow.hrApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'HR approval must be completed first for Salary/PF/Incentive/Training/Uniform/ESI requests.' }, { status: 400 })
        }
        if (requestRow.eaApproval !== 'APPROVED') {
          return NextResponse.json({ error: 'EA approval must be completed first.' }, { status: 400 })
        }
      } else if ((stage === 'accounts' || stage === 'payment_done') && !isTester) {
        if (
          (hasFirstStage && requestRow.vpApproval !== 'APPROVED') ||
          requestRow.eaApproval !== 'APPROVED' ||
          requestRow.managementApproval !== 'APPROVED'
        ) {
          return NextResponse.json({ error: 'MD and EA approvals must be completed before Accounts stage.' }, { status: 400 })
        }
      }
    }

    // Build the updates
    const updates: Partial<typeof kiaApprovalRequests.$inferInsert> = {}
    let statusVal = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'NOT APPROVED' : action === 'HOLD' ? 'HELD' : 'SENT BACK'

    if (action === 'SEND_BACK') {
      updates.vpApproval = null
      updates.ceoApproval = null
      updates.hrApproval = null
      updates.accountApproval = null
      updates.eaApproval = null
      updates.managementApproval = null
      updates.paymentStatus = 'PENDING'
      updates.sendBackReason = remarks || ''
      updates.emailSendStatus = 'SentBack'

      // Send email to submitter in background
      try {
        const senderName = appUser.fullName || 'An approver'
        const senderStage = stage === 'sales_manager'
          ? firstStageShortLabel(requestRow.brand, requestRow.department, requestRow.approvalType)
          : (SEND_BACK_STAGE_LABELS[stage] || stage.toUpperCase())
        const vendorLabel = (requestRow.vendorName || '').trim()
        const brand = String(requestRow.brand || 'kia').trim().toLowerCase()
        const submitPath = brand === 'kia'
          ? '/brands/kia/payment-approvals/submit'
          : `/brands/${brand}/approvals/submit`
        const resubmitUrl = `${getAppBaseUrl(request)}${submitPath}?resubmit=${createResubmitToken(requestRow.id)}`

        const bodyHtml = `
          <p style="margin:0 0 16px;font-size:15px;color:#334155">Hi ${requestRow.name},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#334155">
            Your payment approval request${vendorLabel ? ` for <strong>${vendorLabel}</strong>` : ''} of <strong>INR ${requestRow.amount}</strong> has been sent back for clarification / additional information.
          </p>
          <div style="margin:20px 0;padding:16px;border:1px solid #e6e8f0;border-radius:12px;background:#fbfbfd;">
            <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#d97706;">Sent back by:</h4>
            <p style="margin:0 0 12px;font-size:14px;color:#111827;"><strong>${senderName}</strong> &middot; ${senderStage} stage</p>
            <h4 style="margin:0 0 6px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#d97706;">Comments:</h4>
            <p style="margin:0;font-size:14px;color:#4b5563;white-space:pre-wrap;line-height:1.5;">${remarks || 'No remarks provided.'}</p>
          </div>
          <p style="margin:0 0 20px;font-size:15px;color:#334155">
            Use the button below to reopen your request with everything you submitted already filled in,
            make the changes asked for, and send it back through.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr>
              <td style="border-radius:10px;background:#0f766e;">
                <a href="${resubmitUrl}"
                   style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                  Re-submit request
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            This link is unique to your request and expires in 30 days. No sign-in is needed.
          </p>
        `
        await sendTrackedEmail({
          to: requestRow.email,
          subject: `Clarification Needed: Payment Request${vendorLabel ? ` for ${vendorLabel}` : ''}`,
          emailType: 'approval_sent_back',
          html: emailLayout({
            heading: 'Payment Request Sent Back',
            eyebrow: 'AM Group · Approvals',
            preheader: 'Clarification Needed',
            bodyHtml
          })
        })
      } catch (err) {
        console.error('[approvals-action] Failed to dispatch send-back email:', err)
      }
    } else {
      if (stage === 'sales_manager') {
        updates.vpApproval = statusVal
      } else if (stage === 'ceo') {
        updates.ceoApproval = statusVal
      } else if (stage === 'hr') {
        updates.hrApproval = statusVal
      } else if (stage === 'ea') {
        updates.eaApproval = statusVal
      } else if (stage === 'md') {
        updates.managementApproval = statusVal
        if (action === 'APPROVE') {
          updates.vpApproval = 'APPROVED'
          updates.ceoApproval = 'APPROVED'
          updates.emailSendStatus = 'MDApproved'

          // Trigger email notification to requester that MD approved the payment order
          await sendMdApprovalNotificationEmail({
            toEmail: requestRow.email,
            requesterName: requestRow.name,
            vendorName: requestRow.vendorName || 'Vendor',
            amount: requestRow.amount,
            // `purpose` is the REQUEST's own text; `remarks` is what the MD just typed. Both are
            // shown, separately — conflating them is how the MD's note went missing for 69 orders.
            purpose: requestRow.remarks,
            department: requestRow.department,
            approvalType: requestRow.approvalType,
            approvalTime: new Date(),
            remarks: remarks || '',
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
    /*
     * ⚠️ This was a hand-written chain of ternaries with NO 'ceo' branch, so every CEO action fell
     * through to the trailing `: 'MD'` and was filed as `{ role: 'MD', roleKey: 'ceo' }` — 17 live
     * entries. The workflow strip then matched that entry to the MD step and showed the CEO's name
     * and time there. Now resolved from the one shared map.
     */
    const roleLabel = approvalStageHistoryLabel(stage, requestRow)

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

    /*
     * ── Tell the submitter a decision landed ──────────────────────────────────────────────────
     *
     * ⚠️ This route previously sent NOTHING on REJECT or HOLD. It set
     * `emailSendStatus = 'Rejected' | 'Held'` — a column whose name promises a message that never
     * left — and stopped there. Only `bulk-action` ever got the fix, so rejecting one request from
     * its row button was silent while rejecting fifty from the toolbar notified everyone.
     *
     * Sent for EVERY stage, not just MD: a request killed at the GSM, HR, EA or Accounts desk is
     * just as dead to the person waiting on it. SEND_BACK is handled in its own branch above
     * (it needs the signed re-submit link), so it is excluded here.
     *
     * AFTER the update, deliberately: an email must not claim a decision the database rejected.
     * The send itself is fire-and-forget and swallows its own errors — a decision already written
     * is not rolled back because a mail server blinked.
     */
    if (action === 'REJECT' || action === 'HOLD') {
      try {
        await sendApprovalDecisionEmail(action, {
          id: requestRow.id,
          name: requestRow.name,
          email: requestRow.email,
          amount: requestRow.amount,
          vendorName: requestRow.vendorName,
          requestNo: requestRow.requestNo,
          brand: requestRow.brand,
          // Needed to name the first-stage desk correctly — see DecisionRecipient.
          department: requestRow.department,
          approvalType: requestRow.approvalType,
        }, {
          stage,
          senderName: appUser.fullName || 'An approver',
          remarks: remarks || '',
          request,
        })
      } catch (err) {
        console.error('[approvals-action] Failed to dispatch %s email:', action, err)
      }
    }

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
