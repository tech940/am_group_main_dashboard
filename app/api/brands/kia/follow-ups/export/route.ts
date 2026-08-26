import { NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requireBrandApiAccess } from '@/lib/auth/brand-access'
import { requirePermission } from '@/lib/permissions/service'
import { exportFollowups } from '@/lib/kia/lead-followups'
import { INDIA_TIME_ZONE, getIndiaYmd } from '@/lib/date-time'

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
  { header: 'Due Date (IST)', key: 'dueAt', width: 20 },
  { header: 'Outcome', key: 'outcome', width: 16 },
  { header: 'Not Interested Reason', key: 'notInterestedReason', width: 20 },
  { header: 'Remarks', key: 'notes', width: 40 },
  { header: 'Source', key: 'source', width: 12 },
  // "(IST)" in the header, because the workbook leaves the app: once it is on someone's desktop
  // there is nothing left to tell them which zone the times are in.
  { header: 'Completed At (IST)', key: 'completedAt', width: 20 },
  { header: 'Created At (IST)', key: 'createdAt', width: 20 },
]

const fmtDateTime = (d: Date | null) => {
  if (!d) return ''
  // IST, human-readable, matching how the page shows dates. The timeZone option is what makes this
  // correct: 'en-IN' alone is only a language and would render in the server's zone, which is UTC.
  return d.toLocaleString('en-IN', { timeZone: INDIA_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })
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
    // The Indian working day, not the UTC one: an export taken at 01:00 IST used to be stamped with
    // yesterday's date.
    const fileName = `booking-follow-ups-${getIndiaYmd()}.xlsx`
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
