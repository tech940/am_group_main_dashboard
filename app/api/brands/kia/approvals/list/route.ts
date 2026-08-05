import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
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

    const rawRows = await db
      .select({
        id: kiaApprovalRequests.id,
        email: kiaApprovalRequests.email,
        name: kiaApprovalRequests.name,
        employeeId: kiaApprovalRequests.employeeId,
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

    // Enforce branchwise and dealer scoping
    const isUnrestricted =
      isSuperAdminRole(appUser.role) ||
      hasGlobalAccessRole(appUser.role) ||
      hasAllBranchAccess(appUser.brand)

    const rows = isUnrestricted
      ? rawRows
      : rawRows.filter((row) => {
          const rowBrand = (row.brand || 'kia').toLowerCase() as BranchValue
          // Check if user has access to the row's brand
          if (!canAccessBrand(appUser, rowBrand)) return false

          // Check if user is restricted to specific dealer/branch code or location
          if (row.dealerCode && !canAccessDealer(appUser, rowBrand, row.dealerCode)) return false

          return true
        })

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
