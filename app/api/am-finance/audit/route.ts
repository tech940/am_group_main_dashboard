import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAuditAmFinance } from '@/lib/am-finance/access'
import { serializeAppDate } from '@/lib/date-time'
import { db } from '@/lib/db'
import { amFinanceAuditLogs } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

const FIELD_LABELS: Record<string, string> = {
  deliveryDate: 'Delivery Date',
  customerName: 'Customer Name',
  mobileNo: 'Mobile No',
  model: 'Model',
  salesExecutive: 'Sales Executive',
  mainDealer: 'Main Dealer',
  location: 'Location',
  tl: 'TL',
  hyp: 'HYP',
  branch: 'Branch',
  loanAmount: 'Loan Amount',
  panNumber: 'PAN Number',
  payoutStatus: 'Payout Status',
  reasonIfOuthouse: 'Reason If Outhouse',
  dealerPayoutPercent: 'Dealer Payout Percent',
  payoutAmount: 'Payout Amount',
  status: 'Status',
  dsePayoutStatus: 'DSE Payout Status',
  dealerPayoutStatus: 'Dealer Payout Status',
  paymentReceivedDate: 'Payment Received Date',
  amountReceived: 'Amount Received',
  invoiceNumber: 'Invoice Number',
  bankVisitScheduled: 'Bank Visit Scheduled',
  dateOfBankVisit: 'Date Of Bank Visit',
  visitedBy: 'Visited By',
  bankerRemarks: 'Banker Remarks',
  vehicleRegistrationNumberToSale: 'Vehicle Registration Number To Sale',
  hypAsPerRc: 'HYP As Per RC',
  startTime: 'Start Time',
  endTime: 'End Time',
  loginUser: 'Login User',
  bankIntRate: 'Bank Interest Rate',
  bankLogin: 'Bank Login',
  bankInProforma: 'Bank In Proforma',
}

function serializeAuditRow(row: typeof amFinanceAuditLogs.$inferSelect) {
  return {
    id: row.id,
    financeSheetId: row.financeSheetId,
    action: row.action,
    fieldName: row.fieldName,
    fieldLabel: row.fieldName ? FIELD_LABELS[row.fieldName] || row.fieldName : null,
    oldValue: row.oldValue,
    newValue: row.newValue,
    performedBy: row.performedBy,
    performedByName: row.performedByName,
    userRole: row.userRole,
    module: row.module,
    metadata: row.metadata,
    createdAt: serializeAppDate(row.createdAt),
  }
}

export async function GET(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAuditAmFinance(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const id = Number(request.nextUrl.searchParams.get('id'))
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Finance sheet row ID is required' }, { status: 400 })
    }

    const rows = await db
      .select()
      .from(amFinanceAuditLogs)
      .where(eq(amFinanceAuditLogs.financeSheetId, id))
      .orderBy(desc(amFinanceAuditLogs.createdAt))
      .limit(200)

    return NextResponse.json({ rows: rows.map(serializeAuditRow) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('am_finance_audit_logs')) {
      return NextResponse.json({
        error: 'AM Finance audit table is not ready. Run npm run db:setup-am-finance-v2.',
        setupRequired: true,
      }, { status: 503 })
    }

    console.error('Error in GET /api/am-finance/audit:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
