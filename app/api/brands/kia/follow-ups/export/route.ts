import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { exportFollowups } from '@/lib/kia/lead-followups'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Exports Booking Follow-ups as a real .xlsx (via the existing `exceljs` dep — already the
 * server-side export tool for the service dashboards; see app/api/finance/payouts/export/route.ts).
 *
 * Exports the CURRENT FILTER: the button sits next to the filters, so "export" means "export what
 * I'm looking at" (mine / reason / dealer / search / date range).
 *
 * PII — the customer's mobile number is NOT in this file, by request and by design. exportFollowups
 * never selects the phone column, so there is no code path that could leak it into the sheet for any
 * role. Do not add a Mobile column here.
 */
const COLUMNS: { header: string; key: string; width: number }[] = [
  { header: 'Booking Number', key: 'bookingNumber', width: 22 },
  { header: 'Customer', key: 'customerName', width: 26 },
  { header: 'Model', key: 'model', width: 18 },
  { header: 'Variant', key: 'variant', width: 20 },
  { header: 'Dealer', key: 'dealer', width: 10 },
  { header: 'Consultant', key: 'consultantName', width: 20 },
  { header: 'Assigned To', key: 'assignedName', width: 20 },
  { header: 'Reason', key: 'reason', width: 16 },
  { header: 'Priority', key: 'priority', width: 10 },
  { header: 'Follow-up Status', key: 'status', width: 16 },
  { header: 'Booking Status', key: 'bookingStatus', width: 16 },
  { header: 'Due Date', key: 'dueAt', width: 18 },
  { header: 'Outcome', key: 'outcome', width: 16 },
  { header: 'Not Interested Reason', key: 'notInterestedReason', width: 20 },
  { header: 'Remarks', key: 'notes', width: 40 },
  { header: 'Source', key: 'source', width: 12 },
  { header: 'Completed At', key: 'completedAt', width: 18 },
  { header: 'Created At', key: 'createdAt', width: 18 },
]

const fmtDateTime = (d: Date | null) => {
  if (!d) return ''
  // IST-local, human-readable (matches how the page shows dates).
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
}

export async function GET(request: Request) {
  const accessResponse = await requireBrandApiAccess('kia')
  if (accessResponse) return accessResponse
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const permission = await requirePermission(appUser, 'kia.lead_followups.view')
  if (!permission.allowed) return NextResponse.json({ error: permission.reason }, { status: 403 })

  try {
    const url = new URL(request.url)
    const rows = await exportFollowups(appUser, {
      mine: url.searchParams.get('mine') === '1',
      search: url.searchParams.get('search'),
      reason: url.searchParams.get('reason'),
      dealer: url.searchParams.get('dealer'),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
      dateField: (url.searchParams.get('dateField') as 'due_date' | 'booking_date' | 'completed_date' | null) || null,
      model: url.searchParams.get('model'),
      bookingStatus: url.searchParams.get('bookingStatus'),
      priority: url.searchParams.get('priority'),
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AM Group Operations Cloud'
    wb.created = new Date()
    const ws = wb.addWorksheet('Booking Follow-ups')
    ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }))
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1120' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    for (const r of rows) {
      ws.addRow({
        ...r,
        dueAt: fmtDateTime(r.dueAt),
        completedAt: fmtDateTime(r.completedAt),
        createdAt: fmtDateTime(r.createdAt),
      })
    }

    const buffer = await wb.xlsx.writeBuffer()
    const fileName = `booking-follow-ups-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    console.error('Failed to export KIA follow-ups:', error)
    return NextResponse.json({ error: 'Failed to export follow-ups' }, { status: 500 })
  }
}
