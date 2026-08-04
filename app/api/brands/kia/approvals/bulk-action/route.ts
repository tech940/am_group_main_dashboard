import { NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { kiaApprovalRequests } from '@/lib/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { isHrApprovalRequired } from '@/lib/kia/approval-hr-routing'

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
      let activeStageKey: 'sales_manager' | 'hr' | 'accounts' | 'md' | null = null
      
      const vpApp = row.vpApproval
      const hrApp = row.hrApproval
      const accApp = row.accountApproval
      const mdApp = row.managementApproval


      const requiresHr = isHrApprovalRequired(row.approvalType)

      // Determine what stage this request is currently in
      if (!vpApp || vpApp === 'HELD' || vpApp === 'NOT APPROVED') {
        activeStageKey = 'sales_manager'
      } else if (requiresHr && (!hrApp || hrApp === 'HELD' || hrApp === 'NOT APPROVED')) {
        activeStageKey = 'hr'
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

      const deptNorm = (row.department || '').trim().toUpperCase()
      const approvalTypeNorm = (row.approvalType || '').trim().toUpperCase()

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
        if (isServiceCategory) {
          isAuthorized = appUser.role === 'ed' ? false : isTester || isVp
        } else {
          isAuthorized = isTester || appUser.role === 'ed' || isGeneralSalesManager
        }
      } else if (activeStageKey === 'hr') {
        isAuthorized = isTester || isHrUser
      } else if (activeStageKey === 'accounts') {
        // SEPARATION OF DUTIES — `isSuperUser` (ceo/md) is DELIBERATELY EXCLUDED here.
        // This branch sets paymentStatus = 'PAID'. Granting it to the MD/CEO meant an MD could
        // approve at the `md` stage and then mark the very same request PAID — which is exactly
        // how vendor payments Accounts never approved ended up recorded as PAID in production.
        // Bulk-approve made it worse: one click could pay a whole selection.
        // Only Accounts may release money. developer/admin (`isTester`) stay for support only.
        isAuthorized = isTester || isAccountsUser
      } else if (activeStageKey === 'md') {
        // The ONLY stage where MD/CEO are the intended approver.
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
      } else if (activeStageKey === 'hr') {
        updates.hrApproval = statusVal
      } else if (activeStageKey === 'md') {
        updates.managementApproval = statusVal
        if (action === 'APPROVE') {
          updates.vpApproval = 'APPROVED'
        }
        updates.managementRemarks = remarks || ''
        if (action === 'REJECT') {
          updates.emailSendStatus = 'Rejected'
        } else if (action === 'HOLD') {
          updates.emailSendStatus = 'Held'
        }
      } else if (activeStageKey === 'accounts') {
        updates.accountApproval = statusVal
        if (action === 'APPROVE') {
          updates.paymentStatus = 'PAID'
          updates.paymentCompletedAt = new Date()
          updates.paymentCompletedBy = appUser.fullName
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
        activeStageKey === 'sales_manager' ? 'ED' : 
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
      failedRows,
      message: `Successfully processed ${processedRows.length} approvals. Failed: ${failedRows.length}.`
    })
  } catch (error: any) {
    console.error('Bulk approval handler error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
