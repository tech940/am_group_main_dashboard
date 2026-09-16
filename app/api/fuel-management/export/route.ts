import ExcelJS from 'exceljs'
import { type NextRequest } from 'next/server'
import { guardFuelManagement, refuse } from '@/lib/fuel-management/api'
import { eventMatches, summariseLedger } from '@/lib/fuel-management/ledger'
import { loadLedger, parseFuelFilters } from '@/lib/fuel-management/ledger-reads'
import { FUEL_REPORTS, isFuelReportId, type FuelReportId } from '@/lib/fuel-management/reports'
import type { FuelBreakdownRow, FuelEventRow } from '@/lib/fuel-management/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Column = { header: string; key: string; width: number; numFmt?: string }
type Sheet = { columns: Column[]; rows: Record<string, unknown>[] }

const QTY = '#,##0.00'
const INR = '"₹"#,##,##0'
const KM = '#,##0.0'

function breakdownSheet(label: string, rows: FuelBreakdownRow[]): Sheet {
  return {
    columns: [
      { header: label, key: 'label', width: 28 },
      { header: 'Records', key: 'events', width: 10 },
      { header: 'Approved (L)', key: 'approvedQty', width: 14, numFmt: QTY },
      { header: 'Actual (L)', key: 'actualQty', width: 14, numFmt: QTY },
      { header: 'Spend', key: 'spend', width: 14, numFmt: INR },
      { header: 'Share of approved %', key: 'sharePct', width: 18 },
    ],
    rows: rows.map((r) => ({ ...r })),
  }
}

function periodSheet(events: FuelEventRow[], bucketOf: (e: FuelEventRow) => string, label: string): Sheet {
  const map = new Map<string, { records: number; requested: number; approved: number; actual: number; spend: number }>()
  for (const e of events) {
    if (e.lifecycle === 'rejected') continue
    const key = bucketOf(e)
    const row = map.get(key) ?? { records: 0, requested: 0, approved: 0, actual: 0, spend: 0 }
    row.records += 1
    if (e.unit === 'L') {
      row.requested += e.requested ?? 0
      row.approved += e.approved ?? 0
      row.actual += e.actual ?? 0
    }
    row.spend += e.cost ?? 0
    map.set(key, row)
  }
  return {
    columns: [
      { header: label, key: 'bucket', width: 14 },
      { header: 'Records', key: 'records', width: 10 },
      { header: 'Requested (L)', key: 'requested', width: 15, numFmt: QTY },
      { header: 'Approved (L)', key: 'approved', width: 15, numFmt: QTY },
      { header: 'Actual (L)', key: 'actual', width: 15, numFmt: QTY },
      { header: 'Spend', key: 'spend', width: 14, numFmt: INR },
    ],
    rows: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, row]) => ({ bucket, ...row })),
  }
}

function buildSheet(report: FuelReportId, events: FuelEventRow[], overview: ReturnType<typeof summariseLedger>): Sheet {
  switch (report) {
    case 'daily':
      return periodSheet(events, (e) => e.date, 'Date')
    case 'monthly':
      return periodSheet(events, (e) => e.date.slice(0, 7), 'Month')
    case 'branches':
      return breakdownSheet('Branch', overview.breakdowns.branch)
    case 'departments':
      return breakdownSheet('Department', overview.breakdowns.department)
    case 'purposes':
      return breakdownSheet('Purpose', overview.breakdowns.purpose)
    case 'exceptions':
      return {
        columns: [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Severity', key: 'severity', width: 10 },
          { header: 'Status', key: 'label', width: 20 },
          { header: 'Finding', key: 'title', width: 32 },
          { header: 'Vehicle', key: 'vehicleLabel', width: 30 },
          { header: 'Request', key: 'requestNumber', width: 24 },
          { header: 'Gate pass', key: 'passNo', width: 20 },
          { header: 'Branch', key: 'branchLabel', width: 12 },
          { header: 'Measured', key: 'measured', width: 11 },
          { header: 'Expected', key: 'expected', width: 11 },
          { header: 'Unit', key: 'unit', width: 8 },
          { header: 'Details', key: 'message', width: 60 },
          { header: 'Review', key: 'review', width: 14 },
          { header: 'Review note', key: 'reviewNote', width: 40 },
          { header: 'Reviewed by', key: 'reviewer', width: 20 },
        ],
        rows: overview.exceptions.map((x) => ({
          ...x,
          review: x.review ? x.review.outcome.replace('_', ' ') : 'Open',
          reviewNote: x.review?.note ?? '',
          reviewer: x.review?.reviewerName ?? '',
        })),
      }
    case 'approved-vs-actual':
      return {
        columns: [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Request', key: 'requestNumber', width: 24 },
          { header: 'Vehicle', key: 'vehicleLabel', width: 32 },
          { header: 'Branch', key: 'branchLabel', width: 12 },
          { header: 'Requested', key: 'requested', width: 11, numFmt: QTY },
          { header: 'Approved', key: 'approved', width: 11, numFmt: QTY },
          { header: 'Actual', key: 'actual', width: 11, numFmt: QTY },
          { header: 'Difference', key: 'variance', width: 11, numFmt: QTY },
          { header: 'Unit', key: 'unit', width: 6 },
          { header: 'Pump meter (L)', key: 'pumpLitres', width: 14, numFmt: QTY },
          { header: 'Approved by', key: 'approverName', width: 20 },
          { header: 'Bill recorded by', key: 'closedByName', width: 20 },
        ],
        rows: events.filter((e) => e.approved !== null && e.actual !== null),
      }
    case 'vehicles':
    case 'mileage':
    case 'cost-per-km':
    case 'high-consumption': {
      let vehicles = overview.vehicles
      if (report === 'mileage') vehicles = vehicles.filter((v) => v.kind === 'vin')
      if (report === 'cost-per-km') vehicles = vehicles.filter((v) => v.costPerKm !== null)
      if (report === 'high-consumption') vehicles = [...vehicles].sort((a, b) => b.approvedQty - a.approvedQty)
      return {
        columns: [
          { header: 'Vehicle', key: 'label', width: 32 },
          { header: 'VIN', key: 'vin', width: 20 },
          { header: 'Model', key: 'model', width: 16 },
          { header: 'Branch', key: 'branchLabel', width: 12 },
          { header: 'Fuel', key: 'energyLabel', width: 14 },
          { header: 'Records', key: 'events', width: 9 },
          { header: 'Approved', key: 'approvedQty', width: 11, numFmt: QTY },
          { header: 'Actual', key: 'actualQty', width: 11, numFmt: QTY },
          { header: 'Previous period', key: 'previousQty', width: 15, numFmt: QTY },
          { header: 'Spend', key: 'spend', width: 12, numFmt: INR },
          { header: 'Drive km (gate)', key: 'gateKm', width: 15, numFmt: KM },
          { header: 'GPS km', key: 'gpsKm', width: 10, numFmt: KM },
          { header: 'Mileage (average)', key: 'mileageAverage', width: 17, numFmt: KM },
          { header: 'Measured as', key: 'mileageBasis', width: 14 },
          { header: 'Expected', key: 'expected', width: 10, numFmt: KM },
          { header: 'Against expected', key: 'efficiencyStatus', width: 16 },
          { header: 'Cost per km', key: 'costPerKm', width: 12, numFmt: '"₹"0.00' },
          { header: 'Why no mileage', key: 'mileageReason', width: 40 },
          { header: 'Needs attention', key: 'attentionText', width: 60 },
        ],
        rows: vehicles.map((v) => ({
          ...v,
          mileageAverage: v.mileage.average,
          mileageBasis: v.mileage.basis === 'full_tank' ? 'Full tank' : v.mileage.basis === 'provisional' ? 'Provisional' : '—',
          mileageReason: v.mileage.unavailableReason ?? '',
          attentionText: v.attention.join(' · '),
        })),
      }
    }
    case 'transactions':
    default:
      return {
        columns: [
          { header: 'Date', key: 'date', width: 12 },
          { header: 'Request', key: 'requestNumber', width: 24 },
          { header: 'State', key: 'lifecycleLabel', width: 13 },
          { header: 'Vehicle', key: 'vehicleLabel', width: 32 },
          { header: 'VIN', key: 'vin', width: 20 },
          { header: 'Brand', key: 'brandLabel', width: 11 },
          { header: 'Branch', key: 'branchLabel', width: 12 },
          { header: 'Purpose', key: 'purposeLabel', width: 16 },
          { header: 'Department', key: 'department', width: 14 },
          { header: 'Fuel', key: 'energy', width: 9 },
          { header: 'Unit', key: 'unit', width: 6 },
          { header: 'Requested', key: 'requested', width: 11, numFmt: QTY },
          { header: 'Approved', key: 'approved', width: 11, numFmt: QTY },
          { header: 'Actual', key: 'actual', width: 11, numFmt: QTY },
          { header: 'Bill', key: 'cost', width: 11, numFmt: INR },
          { header: 'Per unit', key: 'unitPrice', width: 10, numFmt: '"₹"0.00' },
          { header: 'Odometer', key: 'odometerKm', width: 11 },
          { header: 'Full tank', key: 'fullTankText', width: 10 },
          { header: 'Gate pass', key: 'passNo', width: 20 },
          { header: 'Pump meter (L)', key: 'pumpLitres', width: 14, numFmt: QTY },
          { header: 'Raised by', key: 'requesterName', width: 20 },
          { header: 'Approved by', key: 'approverName', width: 20 },
          { header: 'Bill recorded by', key: 'closedByName', width: 20 },
          { header: 'Open exceptions', key: 'openExceptions', width: 15 },
          { header: 'Data gaps', key: 'qualityText', width: 40 },
        ],
        rows: events.map((e) => ({
          ...e,
          fullTankText: e.fullTank === null ? '' : e.fullTank ? 'Yes' : 'No',
          qualityText: e.quality.join(', ').replace(/_/g, ' '),
        })),
      }
  }
}

/**
 * GET /api/fuel-management/export?report=<id>&<the overview's filters> — one report as .xlsx, built from the same
 * ledger and filters as the screen, so the file and the page never disagree.
 */
export async function GET(request: NextRequest) {
  const guard = await guardFuelManagement()
  if (!guard.ok) return guard.response

  const params = request.nextUrl.searchParams
  const report = params.get('report')
  if (!isFuelReportId(report)) return refuse(400, 'Choose a report to export.')
  const parsed = parseFuelFilters(params)
  if (!parsed.ok) return refuse(400, parsed.error)

  try {
    const ledger = await loadLedger(parsed.filters.from, parsed.filters.to)
    const overview = summariseLedger(ledger, parsed.filters)
    const events = ledger.events.filter((e) => eventMatches(e, parsed.filters))
    const sheet = buildSheet(report, events, overview)
    const meta = FUEL_REPORTS.find((r) => r.id === report)!

    const wb = new ExcelJS.Workbook()
    wb.creator = 'AM Group Dashboard'
    wb.created = new Date()
    const ws = wb.addWorksheet(meta.title.slice(0, 31))
    ws.addRow([meta.title])
    ws.addRow([`${parsed.filters.from} to ${parsed.filters.to} · exported by ${guard.appUser.fullName}`])
    ws.addRow([])
    ws.getRow(1).font = { bold: true, size: 13 }
    ws.getRow(2).font = { color: { argb: 'FF64748B' } }
    const header = ws.addRow(sheet.columns.map((c) => c.header))
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } }
    })
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1)
      col.width = c.width
      if (c.numFmt) col.numFmt = c.numFmt
    })
    for (const row of sheet.rows) ws.addRow(sheet.columns.map((c) => row[c.key] ?? null))
    if (sheet.rows.length === 0) ws.addRow(['No records for this period and these filters.'])
    ws.views = [{ state: 'frozen', ySplit: 4 }]

    const buffer = await wb.xlsx.writeBuffer()
    const fileName = `fuel-${report}-${parsed.filters.from}-to-${parsed.filters.to}.xlsx`
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[fuel-management] export failed for', report, parsed.filters, error)
    return refuse(500, 'The report could not be built just now. Please try again.')
  }
}
