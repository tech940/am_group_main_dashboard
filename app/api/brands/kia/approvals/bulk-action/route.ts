import { brandHasEd, firstStageApproverRolesForTrack, firstStageShortLabel, isServiceApproval } from '@/lib/approvals/first-stage-approver'
import { NextResponse } from 'next/server'
import { isApprovalVisibleTo } from '@/lib/kia/approval-scope'
import { sendApprovalDecisionEmail } from '@/lib/approvals/decision-emails'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { brandHasHrStage, isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'
import { sendMdApprovalNotificationEmail } from '@/lib/email/md-approval-email'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACTION_PAST_TENSE = {
  APPROVE: 'approved',
  REJECT: 'rejected',
  HOLD: 'placed on hold',
  SEND_BACK: 'sent back',
} as const

export async function POST(request: Request) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const { ids, action, remarks } = body // 'APPROVE' | 'REJECT' | 'HOLD' | 'SEND_BACK'

    /*
     * A send-back with no reason is useless to the submitter — the whole point of the email is the
     * "what do I change?" line. The single-row flow already required it; bulk must not be the
     * loophole that lets fifty people receive a blank one.
     */
    if (action === 'SEND_BACK' && !String(remarks || '').trim()) {
      return NextResponse.json(
        { error: 'A reason is required when sending requests back — it is what the submitter sees.' },
        { status: 400 }
      )
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'Invalid or empty ids list.' }, { status: 400 })
    }

    if (!action || !['APPROVE', 'REJECT', 'HOLD', 'SEND_BACK'].includes(action)) {
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

    /*
     * Branch scope, applied to the WHOLE batch before anything is written.
     *
     * Refusing the entire request rather than silently dropping the out-of-scope ids is deliberate:
     * a partial bulk-approve that reports success is how someone believes they actioned twenty
     * payments when they actioned twelve. See lib/kia/approval-scope.ts.
     */
    const outOfScope = rows.filter((row) => !isApprovalVisibleTo(appUser, row))
    if (outOfScope.length > 0) {
      return NextResponse.json(
        {
          error: `${outOfScope.length} of ${rows.length} selected requests belong to another branch. Nothing was changed.`,
        },
        { status: 403 }
      )
    }

    const processedRows = []
    const failedRows = []
    // Reported back so the toast can say "12 sent back, 12 notified" rather than leaving the
    // approver to assume mail went out.
    let emailedCount = 0

    for (const row of rows) {
      let activeStageKey: 'sales_manager' | 'hr' | 'ea' | 'accounts' | 'md' | null = null
      
      const vpApp = row.vpApproval
      const hrApp = row.hrApproval
      const eaApp = row.eaApproval
      const accApp = row.accountApproval
      const mdApp = row.managementApproval

      const requiresHr = isHrApprovalRequired(row.approvalType, row.brand)

      // Determine what stage this request is currently in
      if (!vpApp || vpApp === 'HELD' || vpApp === 'NOT APPROVED') {
        activeStageKey = 'sales_manager'
      } else if (requiresHr && (!hrApp || hrApp === 'HELD' || hrApp === 'NOT APPROVED')) {
        activeStageKey = 'hr'
      } else if (!eaApp || eaApp === 'HELD' || eaApp === 'NOT APPROVED') {
        activeStageKey = 'ea'
      } else if (!mdApp || mdApp === 'HELD' || mdApp === 'NOT APPROVED') {
        activeStageKey = 'md'
      } else if (mdApp === 'APPROVED' && (!accApp || accApp === 'HELD' || accApp === 'NOT APPROVED')) {
        activeStageKey = 'accounts'
      }

      if (!activeStageKey) {
        failedRows.push({ id: row.id, error: 'Request is already fully completed or rejected.' })
        continue;
      }

      // Check if user is authorized to act on this active stage
      const userRoleLower = (appUser.role || '').toLowerCase()
      const isAccountsUser = 
        ['accounts', 'accounts_head', 'accounts_team', 'finance_head', 'finance_team', 'assistant_manager', 'manager'].includes(appUser.role) ||
        userRoleLower.includes('account') ||
        userRoleLower.includes('finance')
      const isHrUser =
        ['hr', 'hr_head', 'hr_team', 'hr_manager'].includes(appUser.role) ||
        userRoleLower.includes('hr')

      // Must stay identical to the single-row route and the screen — one definition, in
      // lib/approvals/first-stage-approver.ts.
      const isServiceCategory = isServiceApproval(row.department, row.approvalType)

      const isGeneralSalesManager = 
        ['gsm', 'general_sales_manager', 'sales_manager', 'sales_head', 'general_manager'].includes(userRoleLower) ||
        userRoleLower.includes('sales_manager') ||
        userRoleLower.includes('general_sales')

      const isVp = 
        ['vp', 'vice_president', 'vice_pres', 'vp_service', 'service_vp'].includes(userRoleLower) ||
        userRoleLower.includes('vp') ||
        userRoleLower.includes('vice_president')

      // ── SEPARATION OF DUTIES ──────────────────────────────────────────────────
      // A stage may be actioned ONLY by that stage's intended approver. No seniority
      // bypass: MD/CEO (`isSuperUser`) do NOT inherit ED, HR or Accounts rights, so
      // `isSuperUser` appears on the `md` stage ONLY. This mirrors the single-action
      // route (app/api/brands/kia/approvals/[id]/action/route.ts).
      //
      // WHY: while MD/CEO were authorised on every stage, an MD could approve at `md`
      // and then mark the same request Accounts-approved and PAID — recording vendor
      // payments as PAID that Accounts never approved (13 requests in production).
      // Bulk-approve made it worse: one click could pay an entire selection.
      //
      // `isTester` (developer/admin) is retained on all stages as the support escape hatch.
      let isAuthorized = false
      if (activeStageKey === 'sales_manager') {
        if (!brandHasEd(row.brand)) {
        /*
         * NON-KIA: there is no Executive Director at this brand, so the first stage belongs to the
         * General Manager for the relevant side — Sales or Service. ED is not merely unauthorised
         * here, it does not exist.
         *
         * The KIA branches below are deliberately left exactly as they were: this change is about
         * the brands that have no ED, and narrowing KIA's existing approvers would break a working
         * flow for the one brand that was never in question.
         */
        const allowedRoles = firstStageApproverRolesForTrack(
          row.brand,
          isServiceCategory ? 'service' : 'sales',
        )
        isAuthorized = isTester || isSuperUser || allowedRoles.includes(userRoleLower)
      } else if (isServiceCategory) {
          isAuthorized = appUser.role === 'ed' ? false : isTester || isVp || isSuperUser
        } else {
          isAuthorized = isTester || appUser.role === 'ed' || isGeneralSalesManager || isSuperUser
        }
      } else if (activeStageKey === 'hr') {
        isAuthorized = isTester || isHrUser || isSuperUser
      } else if (activeStageKey === 'accounts') {
        // SEPARATION OF DUTIES — `isSuperUser` (ceo/md) is DELIBERATELY EXCLUDED here.
        // This branch sets paymentStatus = 'PAID'.
        // Only Accounts may release money. developer/admin (`isTester`) stay for support only.
        isAuthorized = isTester || isAccountsUser
      } else if (activeStageKey === 'ea') {
        isAuthorized = isTester || ['ea', 'eba'].includes(appUser.role) || isSuperUser
      } else if (activeStageKey === 'md') {
        // Stage where MD/CEO are the intended approver.
        isAuthorized = isTester || isSuperUser
      }

      if (!isAuthorized) {
        failedRows.push({ id: row.id, error: `Unauthorized to approve at ${activeStageKey} stage.` })
        continue
      }

      // Build updates
      const updates: Partial<typeof kiaApprovalRequests.$inferInsert> = {}
      const statusVal = action === 'APPROVE' ? 'APPROVED'
        : action === 'REJECT' ? 'NOT APPROVED'
        : action === 'SEND_BACK' ? 'SENT BACK'
        : 'HELD'

      /*
       * SEND_BACK is not a stage decision — it returns the request to the submitter, so every stage
       * that had signed off is cleared and the whole chain restarts on re-submission. This mirrors
       * the single-row route exactly; the two used to disagree because bulk simply refused the action.
       */
      if (action === 'SEND_BACK') {
        updates.vpApproval = null
        updates.hrApproval = null
        updates.accountApproval = null
        updates.eaApproval = null
        updates.managementApproval = null
        updates.paymentStatus = 'PENDING'
        updates.sendBackReason = remarks || ''
        updates.emailSendStatus = 'SentBack'

        sendApprovalDecisionEmail('SEND_BACK', row, {
          stage: activeStageKey,
          senderName: appUser.fullName || 'An approver',
          remarks: remarks || '',
        })
        emailedCount++

        await db.update(kiaApprovalRequests).set(updates).where(eq(kiaApprovalRequests.id, row.id))
        processedRows.push(row.id)
        continue
      }

      if (activeStageKey === 'sales_manager') {
        updates.vpApproval = statusVal
      } else if (activeStageKey === 'hr') {
        updates.hrApproval = statusVal
      } else if (activeStageKey === 'ea') {
        updates.eaApproval = statusVal
      } else if (activeStageKey === 'md') {
        if (row.eaApproval !== 'APPROVED') {
          failedRows.push({ id: row.id, error: 'EA approval is required before MD approval.' })
          continue
        }
        updates.managementApproval = statusVal
        if (action === 'APPROVE') {
          updates.vpApproval = 'APPROVED'
          updates.emailSendStatus = 'MDApproved'

          // Trigger email notification to requester that MD approved the payment order
          void sendMdApprovalNotificationEmail({
            toEmail: row.email,
            requesterName: row.name,
            vendorName: row.vendorName || 'Vendor',
            amount: row.amount,
            // `purpose` is the REQUEST's own text; `remarks` is what the MD just typed.
            purpose: row.remarks,
            department: row.department,
            approvalType: row.approvalType,
            approvalTime: new Date(),
            remarks: remarks || '',
          })
        }
        updates.managementRemarks = remarks || ''
        if (action === 'REJECT' || action === 'HOLD') {
          updates.emailSendStatus = action === 'REJECT' ? 'Rejected' : 'Held'
          // Previously this line was the ONLY thing that happened: the column said 'Rejected' and no
          // message ever left. The submitter saw nothing.
          sendApprovalDecisionEmail(action, row, {
            stage: activeStageKey,
            senderName: appUser.fullName || 'An approver',
            remarks: remarks || '',
          })
          emailedCount++
        }
      } else if (activeStageKey === 'accounts') {
        updates.accountApproval = statusVal
        if (action === 'APPROVE') {
          updates.paymentStatus = 'PAID'
          updates.paymentCompletedAt = new Date()
          updates.paymentCompletedBy = appUser.fullName
          updates.emailSendStatus = 'Completed'
        } else if (action === 'REJECT' || action === 'HOLD') {
          updates.emailSendStatus = action === 'REJECT' ? 'Rejected' : 'Held'
          sendApprovalDecisionEmail(action, row, {
            stage: activeStageKey,
            senderName: appUser.fullName || 'An approver',
            remarks: remarks || '',
          })
          emailedCount++
        }
      }

      // Build history entry
      const historyList = Array.isArray(row.history) ? [...row.history] : []
      const roleLabel = 
        activeStageKey === 'sales_manager' ? firstStageShortLabel(row.brand, row.department, row.approvalType) : 
        activeStageKey === 'hr' ? 'HR' :
        activeStageKey === 'accounts' ? 'Accounts' : 
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
      emailedCount,
      failedRows,
      // Names the action rather than always saying "approvals", and states how many submitters were
      // actually notified — an approver who sends fifty back needs to know fifty emails went out.
      message: [
        `${processedRows.length} ${ACTION_PAST_TENSE[action as keyof typeof ACTION_PAST_TENSE] || 'processed'}`,
        emailedCount > 0 ? `${emailedCount} submitter${emailedCount === 1 ? '' : 's'} notified` : null,
        failedRows.length > 0 ? `${failedRows.length} failed` : null,
      ].filter(Boolean).join(' · ')
    })
  } catch (error: any) {
    console.error('Bulk approval handler error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
