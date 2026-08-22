import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { approvalRequestNumbersReady } from '@/lib/approvals/request-number'
import { filterVisibleApprovals } from '@/lib/kia/approval-scope'
import { canAccessBrand } from '@/lib/auth/brand-access'
import { canAccessDealer } from '@/lib/auth/dealer-scope'
import { isSuperAdminRole, hasGlobalAccessRole } from '@/lib/auth/roles'
import { hasAllBranchAccess, type BranchValue } from '@/lib/branches'
import { db } from '@/lib/db'
import { glAccounts, kiaApprovalRequests } from '@/lib/db/schema'
import { desc, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const requestNumbersReady = await approvalRequestNumbersReady()

    const rawRows = await db
      .select({
        id: kiaApprovalRequests.id,
        email: kiaApprovalRequests.email,
        name: kiaApprovalRequests.name,
        employeeId: kiaApprovalRequests.employeeId,
        // Only selected once migration 0039 has run. Before that the column does not exist and
        // naming it fails the ENTIRE query with Postgres 42703, taking the approvals list down —
        // which is what happened. See lib/approvals/request-number.ts.
        ...(requestNumbersReady ? { requestNo: kiaApprovalRequests.requestNo } : {}),
        location: kiaApprovalRequests.location,
        dealerCode: kiaApprovalRequests.dealerCode,
        dealerName: kiaApprovalRequests.dealerName,
        department: kiaApprovalRequests.department,
        specifyOtherDepartment: kiaApprovalRequests.specifyOtherDepartment,
        approvalType: kiaApprovalRequests.approvalType,
        vendorName: kiaApprovalRequests.vendorName,
        specifyOtherApprovalType: kiaApprovalRequests.specifyOtherApprovalType,
        previousAdvance: kiaApprovalRequests.previousAdvance,
        amount: kiaApprovalRequests.amount,
        typeOfPayment: kiaApprovalRequests.typeOfPayment,
        remarks: kiaApprovalRequests.remarks,
        vpApproval: kiaApprovalRequests.vpApproval,
        accountApproval: kiaApprovalRequests.accountApproval,
        hrApproval: kiaApprovalRequests.hrApproval,
        eaApproval: kiaApprovalRequests.eaApproval,
        managementApproval: kiaApprovalRequests.managementApproval,
        managementRemarks: kiaApprovalRequests.managementRemarks,
        // Full bill list (migration 0034). The two legacy columns stay selected because older
        // rows predate the array and the print/email paths still read them.
        billUrls: kiaApprovalRequests.billUrls,
        uploadBillUrl1: kiaApprovalRequests.uploadBillUrl1,
        uploadBillUrl2: kiaApprovalRequests.uploadBillUrl2,
        uploadDocUrl: kiaApprovalRequests.uploadDocUrl,
        emailSendStatus: kiaApprovalRequests.emailSendStatus,
        invoiceNumber: kiaApprovalRequests.invoiceNumber,
        invoiceDocUrl: kiaApprovalRequests.invoiceDocUrl,
        paymentStatus: kiaApprovalRequests.paymentStatus,
        utrNumber: kiaApprovalRequests.utrNumber,
        paymentProofUrl: kiaApprovalRequests.paymentProofUrl,
        paymentRemarks: kiaApprovalRequests.paymentRemarks,
        paymentCompletedAt: kiaApprovalRequests.paymentCompletedAt,
        paymentCompletedBy: kiaApprovalRequests.paymentCompletedBy,
        sendBackReason: kiaApprovalRequests.sendBackReason,
        history: kiaApprovalRequests.history,
        brand: kiaApprovalRequests.brand,
        glAccountId: kiaApprovalRequests.glAccountId,
        gst: kiaApprovalRequests.gst,
        createdAt: kiaApprovalRequests.createdAt,
        updatedAt: kiaApprovalRequests.updatedAt,
        glCode: glAccounts.glCode,
        glName: glAccounts.glName,
        tallyGroup: glAccounts.tallyGroup,
        accountNature: glAccounts.accountNature,
        accountType: glAccounts.accountType,
        monthlyBudget: glAccounts.monthlyBudget,
        quarterlyBudget: glAccounts.quarterlyBudget,
        annualBudget: glAccounts.annualBudget,
      })
      .from(kiaApprovalRequests)
      .leftJoin(glAccounts, eq(kiaApprovalRequests.glAccountId, glAccounts.id))
      .orderBy(desc(kiaApprovalRequests.createdAt))

    // Branch + dealer scope. The rule lives in lib/kia/approval-scope.ts so the action, remark,
    // bulk-action and export routes enforce exactly the same thing this list shows.
    const rows = filterVisibleApprovals(appUser, rawRows)

    console.log('Payment Approvals list fetched rows:', rows.length, 'out of', rawRows.length)

    return NextResponse.json({ rows })
  } catch (error) {
    console.error('Error fetching approvals list:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch approvals list',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
