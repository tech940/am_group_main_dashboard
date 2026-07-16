import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { listFinancePayouts } from '@/lib/finance/payouts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Exports the payout ledger as a real .xlsx (via the existing `exceljs` dep — there is no `xlsx`
 * package here, and exceljs is already the server-side export tool for the service dashboards).
 *
 * Exports the CURRENT FILTER, not the whole table: the button sits next to the filters, so "export"
 * plainly means "export what I'm looking at".
 *
 * PII: the rows come from listFinancePayouts, which masks the mobile number by role BEFORE
 * serialising — so a finance_head downloads a file with `••••••` in the Mobile column, exactly as
 * they see on screen. The export cannot become a PII side-door.
 */
const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'Delivery Date', key: 'deliveryDate', width: 14 },
  { header: 'Customer', key: 'customerName', width: 26 },
  { header: 'Mobile', key: 'customerPhone', width: 14 },
  { header: 'Model', key: 'model', width: 20 },
  { header: 'Sales Executive', key: 'salesExecutive', width: 20 },
  { header: 'Dealer', key: 'dealerCode', width: 10 },
  { header: 'TL', key: 'tlName', width: 18 },
  { header: 'Hypothecation', key: 'hyp', width: 20 },
  { header: 'Bank Branch', key: 'bankBranch', width: 22 },
  { header: 'Loan Amount', key: 'loanAmount', width: 14 },
  { header: 'PAN', key: 'panNumber', width: 12 },
  { header: 'Registration No', key: 'vehicleRegistrationNo', width: 16 },
  { header: 'Payout Status', key: 'payoutStatus', width: 14 },
  { header: 'Reason (Out House)', key: 'reasonIfOuthouse', width: 22 },
  { header: 'Dealer Payout %', key: 'dealerPayoutPercent', width: 14 },
  { header: 'Dealer Payout Amount', key: 'dealerPayoutAmount', width: 18 },
  { header: 'Receipt Status', key: 'payoutReceiptStatus', width: 14 },
  { header: 'DSE Payout Amount', key: 'dsePayoutAmount', width: 16 },
  { header: 'DSE Payout Status', key: 'dsePayoutStatus', width: 16 },
  { header: 'Dealer Payout Status', key: 'dealerPayoutStatus', width: 18 },
  { header: 'Payment Received Date', key: 'paymentReceivedDate', width: 18 },
  { header: 'Amount Received', key: 'amountReceived', width: 15 },
  { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
  { header: 'Bank Visit Scheduled', key: 'bankVisitScheduled', width: 16 },
  { header: 'Date of Bank Visit', key: 'dateOfBankVisit', width: 16 },
  { header: 'Visited By', key: 'visitedBy', width: 18 },
  { header: 'Banker Remarks', key: 'bankerRemarks', width: 32 },
  { header: 'HYP as per RC', key: 'hypAsPerRc', width: 20 },
  { header: 'Login User', key: 'loginUser', width: 18 },
  { header: 'Bank Interest Rate', key: 'bankInterestRate', width: 14 },
  { header: 'Bank Login', key: 'bankLogin', width: 10 },
  { header: 'Bank in Proforma', key: 'bankInProforma', width: 16 },
]

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const permission = await requirePermission(appUser, 'finance.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const url = new URL(request.url)
    const q = (key: string) => url.searchParams.get(key)
    const data = await listFinancePayouts(appUser, {
      search: q('search'),
      payoutStatus: q('payoutStatus'),
      receiptStatus: q('receiptStatus'),
      dealer: q('dealer'),
      bankVisit: q('bankVisit'),
      from: q('from'),
      to: q('to'),
      page: 1,
      pageSize: 100, // MAX_PAGE_SIZE — see the note below
    })

    // The ledger is small (hundreds of rows) but the list is paged at 100. Walk the pages so the
    // export is the whole filtered set rather than only the first page — a silently truncated
    // export is worse than a slow one.
    const rows = [...data.rows]
    for (let page = 2; page <= data.totalPages; page += 1) {
      const next = await listFinancePayouts(appUser, {
        search: q('search'), payoutStatus: q('payoutStatus'), receiptStatus: q('receiptStatus'),
        dealer: q('dealer'), bankVisit: q('bankVisit'), from: q('from'), to: q('to'),
        page, pageSize: 100,
      })
      rows.push(...next.rows)
    }

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AM Group Operations Cloud'
    wb.created = new Date()
    const ws = wb.addWorksheet('Finance Payouts')
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1120' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    for (const r of rows) {
      ws.addRow({
        ...r,
        deliveryDate: dateOnly(r.deliveryDate),
        paymentReceivedDate: dateOnly(r.paymentReceivedDate),
        dateOfBankVisit: dateOnly(r.dateOfBankVisit),
        bankVisitScheduled: r.bankVisitScheduled ? 'Yes' : 'No',
        bankLogin: r.bankLogin === null ? '' : r.bankLogin ? 'Yes' : 'No',
      })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const fileName = `finance-payouts-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    console.error('Failed to export finance payouts:', error)
    return NextResponse.json({ error: 'Failed to export the payout ledger' }, { status: 500 })
  }
}
