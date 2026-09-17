import 'server-only'

import ExcelJS from 'exceljs'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tataHPromiseVehicles } from '@/lib/db/schema'
import { formatIndiaDateTime, getIndiaYmd } from '@/lib/date-time'
import type { HPromiseCapabilities } from './access-shared'
import { NOT_TAKEN, NOT_TAKEN_LABEL, PAPERWORK_STATUS_LABELS, SOLD_TO_LABELS, formatStockNo, isPaperworkStatus, isSoldTo } from './constants'
import { ECONOMICS_FORMULA_VERSION } from './economics'
import { computeInsights, DEFAULT_INSIGHT_FILTERS, type InsightFilters } from './insights-core'
import { listExchangeBonuses, listVehicles } from './queries'
import { maskPhone } from './registration'
import { STAGE_LABELS } from './stage'
import { finalDeciderLabel, getApprovalInfo } from './status'
import type { HpVehicleRow } from './types'

/**
 * H Promise spreadsheets. Built from the same rows and the same MIS functions as the screens.
 *
 * ⚠️ Column lists are ALLOWLISTS. Phone numbers appear in full only for people who work the deal and are masked
 * for everyone else; addresses and identity documents never appear in a spreadsheet at all — a file is the
 * easiest thing in this app to forward to someone who was never meant to have it.
 */

export const EXPORT_KINDS = ['register', 'stock', 'sold', 'monthly', 'bonuses'] as const
export type ExportKind = (typeof EXPORT_KINDS)[number]

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === 'string' && (EXPORT_KINDS as readonly string[]).includes(value)
}

type Column = { header: string; key: string; width: number; numFmt?: string }
type Sheet = { name: string; columns: Column[]; rows: Array<Record<string, unknown>> }

const INR = '"₹"#,##,##0'

export function parseInsightFilters(params: URLSearchParams, todayYmd: string): InsightFilters {
  const defaults = DEFAULT_INSIGHT_FILTERS(todayYmd)
  const yearRaw = params.get('year')
  const monthRaw = params.get('month')
  const year = yearRaw === 'all' ? 'all' : Number(yearRaw)
  const month = monthRaw === 'all' || monthRaw === null ? 'all' : Number(monthRaw)
  const booking = params.get('booking')
  return {
    year: year === 'all' ? 'all' : Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : defaults.year,
    month: month === 'all' ? 'all' : Number.isInteger(month) && month >= 1 && month <= 12 ? month : 'all',
    location: (params.get('location') ?? '').slice(0, 80),
    soldBy: (params.get('soldBy') ?? '').slice(0, 80),
    soldTo: (params.get('soldTo') ?? '').slice(0, 20),
    booking: booking === 'booked' || booking === 'direct' ? booking : 'all',
  }
}

function approverLabel(value: string | null): string {
  if (!value) return ''
  return value === NOT_TAKEN ? NOT_TAKEN_LABEL : value
}

function paperwork(value: string | null): string {
  return value && isPaperworkStatus(value) ? PAPERWORK_STATUS_LABELS[value] : value ?? ''
}

function soldToLabel(value: string | null): string {
  return value && isSoldTo(value) ? SOLD_TO_LABELS[value] : value ?? ''
}

function vehicleColumns(withPhones: boolean): Column[] {
  return [
    { header: 'Stock no', key: 'stockNoText', width: 11 },
    { header: 'Registration', key: 'regNo', width: 15 },
    { header: 'Model', key: 'model', width: 20 },
    { header: 'Colour', key: 'colour', width: 12 },
    { header: 'Year', key: 'manufacturingYear', width: 7 },
    { header: 'Location', key: 'location', width: 15 },
    { header: 'Stage', key: 'stageText', width: 10 },
    { header: 'Purchase date', key: 'purchaseDate', width: 13 },
    { header: 'Purchase price', key: 'purchasePrice', width: 14, numFmt: INR },
    { header: 'GST %', key: 'purchaseGstPct', width: 7 },
    { header: 'Price with GST', key: 'priceWithGst', width: 14, numFmt: INR },
    { header: 'Purchased by', key: 'purchasedBy', width: 18 },
    ...(withPhones ? [{ header: 'Seller phone', key: 'sellerPhone', width: 13 }] : []),
    { header: 'Purchase WhatsApp approval', key: 'purchaseApprover', width: 24 },
    { header: 'Purchase approval', key: 'purchaseStatusText', width: 18 },
    { header: 'Purchase GSM / SM', key: 'purchaseManagerText', width: 22 },
    { header: 'Purchase decided by', key: 'purchaseDeciderText', width: 24 },
    { header: 'Purchase decision note', key: 'purchaseDecisionReason', width: 28 },
    { header: 'Booked on', key: 'bookingDate', width: 12 },
    { header: 'Booking amount', key: 'bookingAmount', width: 13, numFmt: INR },
    { header: 'Sale date', key: 'saleDate', width: 12 },
    { header: 'Selling price', key: 'sellingPrice', width: 14, numFmt: INR },
    { header: 'Other cost', key: 'otherCost', width: 12, numFmt: INR },
    { header: 'Sold to', key: 'soldToText', width: 10 },
    { header: 'Sold by', key: 'soldBy', width: 18 },
    { header: 'Buyer', key: 'buyerName', width: 20 },
    ...(withPhones ? [{ header: 'Buyer phone', key: 'buyerPhone', width: 13 }] : []),
    { header: 'Demo', key: 'demoText', width: 7 },
    { header: 'Financed', key: 'financedText', width: 9 },
    { header: 'Sale WhatsApp approval', key: 'saleApprover', width: 22 },
    { header: 'Sale approval', key: 'saleStatusText', width: 18 },
    { header: 'Sale GSM / SM', key: 'saleManagerText', width: 22 },
    { header: 'Sale decided by', key: 'saleDeciderText', width: 24 },
    { header: 'Sale decision note', key: 'saleDecisionReason', width: 28 },
    { header: 'Gross profit', key: 'grossProfit', width: 13, numFmt: INR },
    { header: 'Gross profit with GST', key: 'grossProfitWithGst', width: 15, numFmt: INR },
    { header: 'Interest days', key: 'interestDays', width: 10 },
    { header: 'Interest', key: 'interest', width: 12, numFmt: INR },
    { header: 'Net profit', key: 'netProfit', width: 13, numFmt: INR },
    { header: 'Days in stock', key: 'daysInStock', width: 10 },
    { header: 'Insurance ends', key: 'insuranceEndDate', width: 13 },
    { header: 'Hypothecation', key: 'hypothecationText', width: 18 },
    { header: 'RTO', key: 'rtoText', width: 18 },
    { header: 'Missing documents', key: 'missingDocsText', width: 26 },
    { header: 'Ledger', key: 'ledgerText', width: 14 },
    { header: 'Payment verified by', key: 'paymentVerifiedByName', width: 18 },
    { header: 'Entered by', key: 'createdByName', width: 18 },
    { header: 'Entered at', key: 'createdAtText', width: 18 },
  ]
}

/** The GSM / SM stage as one cell. */
function managerText(status: string | null, by: string | null, decidedRole: string | null): string {
  if (status === 'approved') return `Approved · ${by ?? ''}`
  if (status === 'rejected') return `Rejected · ${by ?? ''}`
  if (status === 'skipped') return decidedRole ? 'Not needed (MD decided)' : 'Not recorded (sheet)'
  return status === 'pending' ? 'Waiting' : ''
}

function vehicleRecord(row: HpVehicleRow, phones: Map<string, { seller: string | null; buyer: string | null }> | null, canSeePii: boolean) {
  const phone = phones?.get(row.id)
  return {
    ...row,
    stockNoText: formatStockNo(row.stockNo),
    stageText: STAGE_LABELS[row.stage],
    priceWithGst: row.economics.priceWithGst,
    sellerPhone: phone ? (canSeePii ? phone.seller : maskPhone(phone.seller)) : '',
    buyerPhone: phone ? (canSeePii ? phone.buyer : maskPhone(phone.buyer)) : '',
    purchaseApprover: approverLabel(row.purchaseWhatsappApprover),
    purchaseStatusText: getApprovalInfo('purchase', row.purchaseStatus, row.purchaseManagerStatus).label,
    purchaseManagerText: managerText(row.purchaseManagerStatus, row.purchaseManagerByName, row.purchaseDecidedRole),
    purchaseDeciderText: row.purchaseStatus === 'pending' ? '' : finalDeciderLabel(row.purchaseDecidedRole, row.purchaseDecidedByName),
    bookingDate: row.booking?.bookingDate ?? '',
    bookingAmount: row.booking?.amount ?? null,
    soldToText: soldToLabel(row.soldTo),
    demoText: row.isDemo === null ? '' : row.isDemo ? 'Yes' : 'No',
    financedText: row.saleFinanced === null ? '' : row.saleFinanced ? 'Yes' : 'No',
    saleApprover: approverLabel(row.saleWhatsappApprover),
    saleStatusText: row.saleStatus ? getApprovalInfo('sale', row.saleStatus, row.saleManagerStatus).label : 'Not sold',
    saleManagerText: row.saleStatus ? managerText(row.saleManagerStatus, row.saleManagerByName, row.saleDecidedRole) : '',
    saleDeciderText: row.saleStatus && row.saleStatus !== 'pending' ? finalDeciderLabel(row.saleDecidedRole, row.saleDecidedByName) : '',
    grossProfit: row.economics.grossProfit,
    grossProfitWithGst: row.economics.grossProfitWithGst,
    interestDays: row.economics.interestDays,
    interest: row.economics.interest,
    netProfit: row.economics.netProfit,
    daysInStock: row.flags.daysInStock,
    hypothecationText: paperwork(row.hypothecation),
    rtoText: paperwork(row.rtoStatus),
    missingDocsText: row.flags.missingDocs.join(', ').replace(/_/g, ' '),
    ledgerText: row.saleStatus === 'pending' || row.saleStatus === 'approved' ? (row.flags.ledgerPending ? 'Not uploaded' : 'Uploaded') : '',
    createdAtText: formatIndiaDateTime(row.createdAt) ?? '',
  }
}

async function loadPhones(ids: string[]): Promise<Map<string, { seller: string | null; buyer: string | null }>> {
  const map = new Map<string, { seller: string | null; buyer: string | null }>()
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const rows = await db
      .select({ id: tataHPromiseVehicles.id, seller: tataHPromiseVehicles.sellerPhone, buyer: tataHPromiseVehicles.buyerPhone })
      .from(tataHPromiseVehicles)
      .where(inArray(tataHPromiseVehicles.id, chunk))
    for (const row of rows) map.set(row.id, { seller: row.seller, buyer: row.buyer })
  }
  return map
}

export async function buildExport(kind: ExportKind, caps: HPromiseCapabilities, params: URLSearchParams): Promise<{ buffer: Buffer; filename: string }> {
  const today = getIndiaYmd()
  const sheets: Sheet[] = []
  let scope = ''

  if (kind === 'bonuses') {
    const rows = await listExchangeBonuses(caps)
    sheets.push({
      name: 'Exchange bonus',
      columns: [
        { header: 'Date', key: 'entryDate', width: 12 },
        { header: 'Vehicle no', key: 'vehicleNo', width: 15 },
        { header: 'Vehicle', key: 'vehicleName', width: 18 },
        { header: 'Sales consultant', key: 'salesConsultant', width: 20 },
        { header: 'New car model', key: 'newCarModel', width: 18 },
        { header: 'Exchange bonus', key: 'bonusAmount', width: 14, numFmt: INR },
        { header: 'Customer phone', key: 'customerPhone', width: 15 },
        { header: 'Remarks', key: 'remarks', width: 30 },
        { header: 'Entered by', key: 'createdByName', width: 18 },
      ],
      rows,
    })
  } else {
    const list = await listVehicles('live')
    const filters = parseInsightFilters(params, today)
    const result = computeInsights(list.rows, list.bookings, filters, today)
    const period = filters.year === 'all'
      ? 'all-time'
      : filters.month === 'all' ? String(filters.year) : `${filters.year}-${String(filters.month).padStart(2, '0')}`
    const rowsFor = kind === 'register' ? list.rows : kind === 'stock' ? result.stockRows : result.soldRows
    const phones = kind === 'monthly' ? null : await loadPhones(rowsFor.map((row) => row.id))

    if (kind === 'register') {
      scope = 'register'
      sheets.push({ name: 'Register', columns: vehicleColumns(true), rows: list.rows.map((row) => vehicleRecord(row, phones, caps.canSeePii)) })
    } else if (kind === 'stock') {
      scope = `stock${filters.location ? `-${filters.location}` : ''}`
      sheets.push({ name: 'Active stock', columns: vehicleColumns(true), rows: result.stockRows.map((row) => vehicleRecord(row, phones, caps.canSeePii)) })
    } else if (kind === 'sold') {
      scope = `sold-${period}`
      sheets.push({ name: 'Sold', columns: vehicleColumns(true), rows: result.soldRows.map((row) => vehicleRecord(row, phones, caps.canSeePii)) })
    } else {
      scope = `monthly-${period}`
      sheets.push({
        name: 'Monthly MIS',
        columns: [
          { header: 'Month', key: 'label', width: 11 },
          { header: 'Purchased', key: 'purchasedCount', width: 11 },
          { header: 'Purchase value', key: 'purchasedValue', width: 15, numFmt: INR },
          { header: 'Booked', key: 'bookedCount', width: 9 },
          { header: 'Booking value', key: 'bookingValue', width: 14, numFmt: INR },
          { header: 'Refunded', key: 'refundedCount', width: 9 },
          { header: 'Sold', key: 'soldCount', width: 8 },
          { header: 'Awaiting sale approval', key: 'soldPendingApproval', width: 12 },
          { header: 'Sale value', key: 'saleValue', width: 14, numFmt: INR },
          { header: 'Other cost', key: 'otherCost', width: 12, numFmt: INR },
          { header: 'Gross profit', key: 'grossProfit', width: 13, numFmt: INR },
          { header: 'Gross profit with GST', key: 'grossProfitWithGst', width: 15, numFmt: INR },
          { header: 'Interest', key: 'interest', width: 12, numFmt: INR },
          { header: 'Net profit', key: 'netProfit', width: 13, numFmt: INR },
          { header: 'Net margin %', key: 'netMarginText', width: 11 },
          { header: 'Loss-making sales', key: 'lossCount', width: 11 },
          { header: 'Avg days to sell', key: 'avgDaysText', width: 11 },
        ],
        rows: [...result.months, { ...result.period, key: 'total', label: 'Total' }].map((month) => ({
          ...month,
          netMarginText: month.netMarginPct === null ? '' : `${month.netMarginPct.toFixed(1)}`,
          avgDaysText: month.avgDaysToSell === null ? '' : Math.round(month.avgDaysToSell),
        })),
      })
      sheets.push({
        name: 'Sold by',
        columns: [
          { header: 'Sold by', key: 'key', width: 22 },
          { header: 'Vehicles', key: 'count', width: 10 },
          { header: 'Sale value', key: 'value', width: 14, numFmt: INR },
          { header: 'Net profit', key: 'netProfit', width: 14, numFmt: INR },
        ],
        rows: result.mix.soldBy,
      })
      sheets.push({
        name: 'By location',
        columns: [
          { header: 'Location', key: 'key', width: 22 },
          { header: 'Vehicles sold', key: 'count', width: 12 },
          { header: 'Sale value', key: 'value', width: 14, numFmt: INR },
          { header: 'Net profit', key: 'netProfit', width: 14, numFmt: INR },
        ],
        rows: result.mix.soldByLocation,
      })
    }
  }

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AM Group dashboard — H Promise'
  workbook.created = new Date()
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] })
    worksheet.columns = sheet.columns.map((column) => ({ header: column.header, key: column.key, width: column.width, style: column.numFmt ? { numFmt: column.numFmt } : undefined }))
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true }
    for (const row of sheet.rows) {
      const clean: Record<string, unknown> = {}
      for (const column of sheet.columns) {
        const value = row[column.key]
        clean[column.key] = value === null || value === undefined ? '' : value
      }
      worksheet.addRow(clean)
    }
    worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } }
  }
  const note = workbook.addWorksheet('About')
  note.getColumn(1).width = 110
  for (const line of [
    `H Promise — ${kind} export, ${formatIndiaDateTime(new Date()) ?? today}.`,
    'Profit: gross = selling − (purchase + other cost); with GST uses the purchase price with GST; net = gross with GST − interest.',
    'Interest: 12 % a year (or the rate in force) on the purchase price without GST, from the purchase date to the sale date (to today while in stock).',
    caps.canSeePii ? 'Phone numbers are shown in full: keep this file inside the business.' : 'Phone numbers are masked for your access level.',
    `Formula version: ${ECONOMICS_FORMULA_VERSION}.`,
  ]) note.addRow([line])

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const safeScope = (scope || kind).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  return { buffer, filename: `h-promise-${safeScope}-${today}.xlsx` }
}
