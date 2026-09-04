import { NextRequest, NextResponse } from 'next/server'
import { requireGatePassAccess } from '@/lib/gate-pass/access'
import { gatePassErrorResponse } from '@/lib/gate-pass/api'
import { listGatePasses } from '@/lib/gate-pass/server'
import { formatIndiaDateTime } from '@/lib/date-time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** RFC 4180: wrap in quotes and double any quote inside, so a comma in a remark cannot shift columns. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const COLUMNS: Array<[header: string, get: (row: Record<string, unknown>) => unknown]> = [
  ['Pass No', (r) => r.passNo],
  ['Status', (r) => r.status],
  ['Branch', (r) => r.dealerCode],
  ['Registration', (r) => r.registrationNumber],
  ['VIN', (r) => r.vin],
  ['Model', (r) => r.model],
  ['Variant', (r) => r.variant],
  ['Colour', (r) => r.color],
  ['Driver', (r) => r.driverName],
  ['Driver type', (r) => r.driverKind],
  ['Purpose', (r) => r.purpose],
  ['Purpose note', (r) => r.purposeNote],
  ['Requested by', (r) => r.requestedByName],
  ['Raised at', (r) => formatIndiaDateTime(r.createdAt as string)],
  ['Due back', (r) => formatIndiaDateTime(r.expectedReturnAt as string)],
  ['Approved by', (r) => r.approvedByName],
  ['Approved at', (r) => formatIndiaDateTime(r.approvedAt as string)],
  ['Approval remarks', (r) => r.approvalRemarks],
  ['Out at', (r) => formatIndiaDateTime(r.gateOutAt as string)],
  ['Odometer out', (r) => r.gateOutOdo],
  ['Guard out', (r) => r.gateOutGuardName],
  ['In at', (r) => formatIndiaDateTime(r.gateInAt as string)],
  ['Odometer in', (r) => r.gateInOdo],
  ['Guard in', (r) => r.gateInGuardName],
  ['Distance (km)', (r) => {
    const out = Number(r.gateOutOdo)
    const back = Number(r.gateInOdo)
    return Number.isFinite(out) && Number.isFinite(back) ? back - out : ''
  }],
  ['Parked at', (r) => r.parkedLocation],
  ['Keys handed to', (r) => r.keyHandoverTo],
  ['Cancel reason', (r) => r.cancelReason],
]

/**
 * The gate register, as a spreadsheet.
 *
 * ⚠️ Gated on `gate_pass.audit`, not `view`. A CSV is the easiest thing in this app to forward to
 * someone who was never meant to have it, so the export is a narrower right than reading the screen.
 *
 * ⚠️ NO LICENCE NUMBER COLUMN, deliberately. serializeGatePass already strips it server-side, and
 * the column list above is an allowlist — adding one would put a government ID into a file that
 * gets mailed around. Times are rendered in IST, because a UTC timestamp in a register that people
 * reconcile against a paper logbook is just a wrong number.
 */
export async function GET(request: NextRequest) {
  const access = await requireGatePassAccess('gate_pass.audit')
  if (access.denied) return access.denied

  try {
    const params = Object.fromEntries(request.nextUrl.searchParams.entries())
    // One big page: a gate register is small (tens to hundreds of rows), and a paginated export is
    // the classic way people end up reconciling against a third of their data without noticing.
    const result = await listGatePasses(access.appUser, { ...params, page: 1, pageSize: 200 })

    const lines = [COLUMNS.map(([header]) => csvCell(header)).join(',')]
    for (const row of result.rows as unknown as Array<Record<string, unknown>>) {
      lines.push(COLUMNS.map(([, get]) => csvCell(get(row))).join(','))
    }

    // A BOM so Excel opens it as UTF-8 rather than mangling names with accents.
    const csv = `﻿${lines.join('\r\n')}\r\n`
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="demo-car-gate-register.csv"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return gatePassErrorResponse(error)
  }
}
