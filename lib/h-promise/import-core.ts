/**
 * Reading the retired Google Sheet ("SMAM TATA Used Car Records" → VEHICLE MASTER) into H Promise records.
 * Pure: no database, no network — scripts/h-promise-import.ts does those, and scripts/verify-h-promise.ts
 * tests this file.
 *
 * ── What the sheet looked like (read 2026-09-17) ────────────────────────────────────────────────
 *   - One row per vehicle, 69 columns. Columns are matched by HEADER NAME here, never by position.
 *   - Dates in date columns are real dates; a few cells hold DD/MM/YYYY text instead.
 *   - Timestamps are Asia/Kolkata wall-clock values. exceljs reads them as if they were UTC, so 10:30 in the
 *     sheet arrives as 10:30Z; the true instant is 05:00Z.
 *   - "000" / "00" text sits in some number columns and means zero.
 *   - Approval columns hold APPROVE / APPROVED, "NOT APPROVED - <reason>", or nothing (never decided).
 *   - Photo columns hold Google Drive links: drive.google.com/open?id=<id> or lh3.googleusercontent.com/d/<id>.
 */

import { isPaperworkStatus, NOT_TAKEN, type FileKind, type PaperworkStatus, type SoldTo } from './constants'
import { displayRegNo, normalizePhone, normalizeRegNo } from './registration'

// ── Headers ──────────────────────────────────────────────────────────────────────────────────────

export const SHEET_NAME = 'VEHICLE MASTER'

/** field → accepted header spellings (compared after trimming and upper-casing). */
export const HEADER_ALIASES = {
  legacyId: ['UNIQUE ID'],
  regNo: ['REG NO', 'REG NO.', 'REGISTRATION NO'],
  model: ['VEHICLE', 'VEHICLE NAME', 'MODEL'],
  colour: ['COLOUR', 'COLOR'],
  purchaseDate: ['DATE PURCHASE', 'PURCHASE DATE'],
  manufacturingYear: ['MANUFACTURING YEAR'],
  purchasePrice: ['PURCHASE PRICE'],
  purchaseGstPct: ['GST % PURCHASE', 'GST %'],
  sheetPriceWithGst: ['PURCHASE PRICE WITH GST'],
  odometerKm: ['ODOMETER READING'],
  expectedProfit: ['EXPECTED PROFIT'],
  purchaseRemarks: ['REMARKS PURCHASE'],
  purchaseFinanced: ['FINANCE PURCHASE'],
  purchasedBy: ['PURCHASE BY'],
  sellerPhone: ['FIRST PARTY CONTACT'],
  engineNo: ['ENGINE NUMBER'],
  chassisNo: ['CHASIS NUMBER', 'CHASSIS NUMBER'],
  location: ['PURCHASE LOCATION'],
  salesConsultant: ['SALE CONSULTANT', 'SALES CONSULTANT'],
  purchaseWhatsappApprover: ['APPROVAL GIVEN BY'],
  purchaseScreenshot: ['PURCHASE WHATSAPP IMAGE'],
  purchaseTimestamp: ['PURCHASE TIMESTAMP'],
  sellingPrice: ['SELLING PRICE'],
  saleDate: ['DATE OF SALE'],
  otherCost: ['REFURBISHED COST'],
  demo: ['DEMO / NON DEMO', 'DEMO/NON DEMO'],
  buyerPhone: ['2ND PARTY CONTACT'],
  buyerName: ['CUSTOMER / BROKER NAME', 'CUSTOMER/BROKER NAME'],
  buyerAddress: ['ADDRESS'],
  soldTo: ['SOLD TO'],
  buyerPan: ['PAN IMAGE'],
  buyerAadhaar: ['AADHAR IMAGE', 'AADHAAR IMAGE'],
  formC: ['FORM C IMAGE'],
  saleFinanced: ['FINANCE SALES'],
  soldBy: ['SOLD BY'],
  saleWhatsappApprover: ['MANAGEMENT APPROVAL'],
  saleScreenshot: ['SALE WHATSAPP IMAGE'],
  gatePass: ['GATE PASS IMAGE'],
  saleTimestamp: ['SALE TIMESTAMP'],
  rc: ['RC PICS'],
  sellerAadhaar: ['AADHAR CARD', 'AADHAAR CARD'],
  sellerPan: ['PAN CARD PICS'],
  creditNote: ['CREDIT NOTE'],
  insuranceEndDate: ['INSURANCE END DATE'],
  insuranceCopy: ['INSURANCE PICS'],
  hypothecation: ['HYP STATUS'],
  form35: ['HYP PICS'],
  rtoStatus: ['RTO STATUS'],
  rtoMail: ['RTO UPDATED STATUS PICS'],
  documentsRemarks: ['REMARKS FOR DOCUMENTS'],
  purchaseApproval: ['APPROVAL PURCHASE'],
  purchaseApprovalAt: ['APPROVAL DATE AND TIME PURCHASE'],
  saleApproval: ['APPROVAL SALE'],
  saleApprovalAt: ['APPROVAL DATE AND TIME SALE'],
  ledger: ['ACCOUNT LEDGER'],
  sheetGrossProfit: ['GROSS PROFIT'],
  sheetGrossProfitWithGst: ['GROSS PROFIT WITH GST'],
  sheetNetProfit: ['NET PROFIT'],
  brokerRcRemarks: ['BROKER RC REMARKS', 'RC TRANSFER REMARKS'],
  brokerRcTransfer: ['BROKER RC PICTURE', 'BROKER RC TRANSFER', 'RC TRANSFER'],
} as const

export type SheetField = keyof typeof HEADER_ALIASES

/** Without these the sheet cannot be read at all. */
export const REQUIRED_FIELDS: readonly SheetField[] = [
  'regNo', 'model', 'purchaseDate', 'purchasePrice', 'purchaseGstPct', 'purchasedBy', 'location',
  'purchaseWhatsappApprover', 'sellingPrice', 'saleDate', 'soldTo', 'purchaseApproval', 'saleApproval',
]

/** Booking columns existed in the sheet but were never filled; anything found there is reported, not guessed. */
export const BOOKING_HEADER_HINT = /BOOKING|REFUND/i

export function normalizeHeader(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase()
}

export function mapHeaders(headers: ReadonlyArray<unknown>): { columns: Partial<Record<SheetField, number>>; missing: SheetField[]; bookingColumns: number[] } {
  const normalized = headers.map(normalizeHeader)
  const columns: Partial<Record<SheetField, number>> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[SheetField, readonly string[]]>) {
    const index = normalized.findIndex((header) => aliases.includes(header))
    if (index >= 0) columns[field] = index
  }
  const bookingColumns = normalized
    .map((header, index) => (BOOKING_HEADER_HINT.test(header) ? index : -1))
    .filter((index) => index >= 0)
  return { columns, missing: REQUIRED_FIELDS.filter((field) => columns[field] === undefined), bookingColumns }
}

// ── Cells ────────────────────────────────────────────────────────────────────────────────────────

/** The plain value of an exceljs cell: a formula's result, a hyperlink's target, rich text joined. */
export function cellValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date) return raw
  if (typeof raw !== 'object') return raw
  const value = raw as Record<string, unknown>
  if ('result' in value) return cellValue(value.result)
  if ('hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink
  if ('richText' in value && Array.isArray(value.richText)) {
    return (value.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('')
  }
  if ('text' in value) return cellValue(value.text)
  if ('error' in value) return null
  return null
}

export function text(raw: unknown): string | null {
  const value = cellValue(raw)
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  const out = String(value).replace(/\s+/g, ' ').trim()
  return out === '' ? null : out
}

export type Issue = { level: 'error' | 'warning'; field: string; message: string }

export function number(raw: unknown): number | null {
  const value = cellValue(raw)
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return null
  const cleaned = String(value).replace(/[₹,\s]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function validYmd(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  if (y < 2000 || y > 2100) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * A calendar date: an exceljs Date (a date cell arrives at UTC midnight), an Excel serial, DD/MM/YYYY,
 * DD-Mon-YYYY or YYYY-MM-DD. Anything else is null — never a guess.
 */
export function calendarDate(raw: unknown): string | null {
  const value = cellValue(raw)
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    // A date-with-time cell is IST wall clock read as UTC: the calendar day is its UTC date.
    return validYmd(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null
    const ms = Math.round((value - 25569) * 86_400_000)
    const date = new Date(ms)
    return validYmd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }
  const s = String(value).trim()
  let match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(s)
  if (match) return validYmd(Number(match[3]), Number(match[2]), Number(match[1]))
  match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(s)
  if (match) return validYmd(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{4})$/.exec(s)
  if (match) {
    const month = MONTH_NAMES.indexOf(match[2].toUpperCase()) + 1
    return month > 0 ? validYmd(Number(match[3]), month, Number(match[1])) : null
  }
  return null
}

const IST_OFFSET_MS = 330 * 60 * 1000

/** A sheet timestamp (Asia/Kolkata wall clock) as a real instant. */
export function sheetTimestamp(raw: unknown): Date | null {
  const value = cellValue(raw)
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return new Date(value.getTime() - IST_OFFSET_MS)
  }
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return null
    return new Date(Math.round((value - 25569) * 86_400_000) - IST_OFFSET_MS)
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(value).trim())
  if (!match) return null
  const ymd = validYmd(Number(match[3]), Number(match[2]), Number(match[1]))
  if (!ymd) return null
  const [h, mi, se] = [Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)]
  if (h > 23 || mi > 59 || se > 59) return null
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), h, mi, se) - IST_OFFSET_MS)
}

export function yesNo(raw: unknown): boolean | null {
  const value = text(raw)?.toUpperCase()
  if (!value) return null
  if (['YES', 'Y', 'TRUE'].includes(value)) return true
  if (['NO', 'N', 'FALSE'].includes(value)) return false
  return null
}

export function demoFlag(raw: unknown): boolean | null {
  const value = text(raw)?.toUpperCase().replace(/[\s_-]+/g, ' ')
  if (!value) return null
  if (value === 'DEMO') return true
  if (value === 'NON DEMO' || value === 'NONDEMO') return false
  return null
}

export function soldToValue(raw: unknown): SoldTo | null {
  const value = text(raw)?.toUpperCase()
  if (value === 'CUSTOMER' || value === 'BROKER' || value === 'SCRAP') return value
  return null
}

export function paperworkValue(raw: unknown): PaperworkStatus | null {
  const value = text(raw)?.toUpperCase().replace(/[\s-]+/g, '_')
  if (!value) return null
  return isPaperworkStatus(value) ? value : null
}

export type LegacyDecision = { status: 'pending' | 'approved' | 'rejected'; reason: string | null; recognised: boolean }

export function legacyDecision(raw: unknown): LegacyDecision {
  const value = text(raw)
  if (!value) return { status: 'pending', reason: null, recognised: true }
  const upper = value.toUpperCase()
  if (upper === 'APPROVE' || upper === 'APPROVED') return { status: 'approved', reason: null, recognised: true }
  const rejected = /^(NOT\s+APPROVED|REJECTED?|DISAPPROVED)\s*[-:–]?\s*(.*)$/i.exec(value)
  if (rejected) return { status: 'rejected', reason: rejected[2]?.trim() || 'Rejected in the Google Sheet', recognised: true }
  return { status: 'pending', reason: null, recognised: false }
}

/** Upper case, single spaces — how option values are stored. */
export function optionValue(raw: unknown): string | null {
  const value = text(raw)
  return value ? value.toUpperCase() : null
}

/** Two spellings of the same name ("MUZIM BHAT" / "MUZIM BHATT") share this key. */
export function nameKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/g, '').replace(/(.)\1+/g, '$1')
}

// ── Drive links ──────────────────────────────────────────────────────────────────────────────────

export const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'lh3.googleusercontent.com', 'drive.usercontent.google.com'])

/** Every Drive file id in a cell (a cell may hold more than one link). Non-Drive hosts are ignored. */
export function driveFileIds(raw: unknown): { ids: string[]; foreign: string[] } {
  const value = text(raw)
  if (!value) return { ids: [], foreign: [] }
  const ids: string[] = []
  const foreign: string[] = []
  for (const token of value.split(/[\s,;]+/)) {
    if (!/^https?:\/\//i.test(token)) continue
    let url: URL
    try {
      url = new URL(token)
    } catch {
      continue
    }
    if (!DRIVE_HOSTS.has(url.hostname)) {
      foreign.push(url.hostname)
      continue
    }
    const id = url.searchParams.get('id') ?? /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1] ?? null
    if (id && /^[A-Za-z0-9_-]{10,200}$/.test(id) && !ids.includes(id)) ids.push(id)
  }
  return { ids, foreign }
}

export function driveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
}

/** The sheet columns that hold photos, and the H Promise slot each fills. */
export const FILE_COLUMNS: ReadonlyArray<[SheetField, FileKind]> = [
  ['purchaseScreenshot', 'purchase_approval_screenshot'],
  ['buyerPan', 'buyer_pan'],
  ['buyerAadhaar', 'buyer_aadhaar'],
  ['formC', 'form_c'],
  ['saleScreenshot', 'sale_approval_screenshot'],
  ['gatePass', 'gate_pass_photo'],
  ['rc', 'rc'],
  ['sellerAadhaar', 'seller_aadhaar'],
  ['sellerPan', 'seller_pan'],
  ['creditNote', 'credit_note'],
  ['insuranceCopy', 'insurance_copy'],
  ['form35', 'form_35'],
  ['rtoMail', 'rto_mail'],
  ['ledger', 'payment_ledger'],
  ['brokerRcTransfer', 'rc_transfer'],
]

// ── One row ──────────────────────────────────────────────────────────────────────────────────────

export type ParsedVehicle = {
  sheetRow: number
  regNo: string
  regKey: string
  model: string
  colour: string | null
  manufacturingYear: number | null
  odometerKm: number | null
  engineNo: string | null
  chassisNo: string | null
  locationRaw: string
  purchaseDate: string
  purchasePrice: number
  purchaseGstPct: number
  sheetPriceWithGst: number | null
  expectedProfit: number | null
  purchaseRemarks: string | null
  purchaseFinanced: boolean
  purchasedByRaw: string
  salesConsultant: string | null
  sellerPhone: string | null
  purchaseWhatsappApproverRaw: string | null
  purchaseTimestamp: Date | null
  purchase: LegacyDecision
  purchaseDecidedAt: Date | null

  sale: null | {
    saleDate: string
    sellingPrice: number
    otherCost: number
    isDemo: boolean | null
    soldTo: SoldTo
    saleFinanced: boolean | null
    soldByRaw: string | null
    buyerName: string | null
    buyerPhone: string | null
    buyerAddress: string | null
    saleWhatsappApproverRaw: string | null
    submittedAt: Date | null
    decision: LegacyDecision
    decidedAt: Date | null
  }
  /** Refurbishment cost recorded without a sale (kept on the vehicle). */
  otherCost: number

  insuranceEndDate: string | null
  hypothecation: PaperworkStatus | null
  rtoStatus: PaperworkStatus | null
  documentsRemarks: string | null
  brokerRcRemarks: string | null
  files: Array<{ kind: FileKind; driveId: string }>
  sheetFigures: { grossProfit: number | null; grossProfitWithGst: number | null; netProfit: number | null }
  issues: Issue[]
}

function get(row: ReadonlyArray<unknown>, columns: Partial<Record<SheetField, number>>, field: SheetField): unknown {
  const index = columns[field]
  return index === undefined ? null : row[index]
}

/** Parses one sheet row. Returns null for an empty row. Errors in `issues` block that row's import. */
export function parseSheetRow(row: ReadonlyArray<unknown>, columns: Partial<Record<SheetField, number>>, sheetRow: number): ParsedVehicle | null {
  const cell = (field: SheetField) => get(row, columns, field)
  const issues: Issue[] = []
  const error = (field: string, message: string) => issues.push({ level: 'error', field, message })
  const warning = (field: string, message: string) => issues.push({ level: 'warning', field, message })

  const regRaw = text(cell('regNo'))
  const priceRaw = number(cell('purchasePrice'))
  if (!regRaw && priceRaw === null && !text(cell('model'))) return null

  const regNo = displayRegNo(regRaw ?? '')
  const regKey = normalizeRegNo(regNo)
  if (regKey.length < 4) error('REG NO', 'missing or too short')

  const model = text(cell('model')) ?? ''
  if (!model) error('VEHICLE', 'missing')

  const purchaseDate = calendarDate(cell('purchaseDate'))
  if (!purchaseDate) error('DATE PURCHASE', `not a date: ${JSON.stringify(text(cell('purchaseDate')))}`)

  if (priceRaw === null || priceRaw <= 0) error('PURCHASE PRICE', `not a positive amount: ${JSON.stringify(text(cell('purchasePrice')))}`)
  const gst = number(cell('purchaseGstPct'))
  if (gst === null) warning('GST % PURCHASE', 'blank — imported as 0 %')
  else if (gst < 0 || gst > 28) error('GST % PURCHASE', `out of range: ${gst}`)

  const sheetPriceWithGst = number(cell('sheetPriceWithGst'))
  if (priceRaw !== null && sheetPriceWithGst !== null) {
    const expected = Math.round(priceRaw * (1 + (gst ?? 0) / 100))
    if (expected !== sheetPriceWithGst) {
      warning('PURCHASE PRICE WITH GST', `the sheet says ${sheetPriceWithGst} but ${priceRaw} at ${gst ?? 0} % is ${expected} — check which is right`)
    }
  }

  const year = number(cell('manufacturingYear'))
  if (year !== null && (!Number.isInteger(year) || year < 1980 || year > 2100)) warning('MANUFACTURING YEAR', `ignored: ${year}`)
  const odometer = number(cell('odometerKm'))
  if (odometer !== null && (odometer < 0 || !Number.isFinite(odometer))) warning('ODOMETER READING', `ignored: ${odometer}`)

  const location = optionValue(cell('location'))
  if (!location) error('PURCHASE LOCATION', 'missing')
  const purchasedBy = optionValue(cell('purchasedBy'))
  if (!purchasedBy) error('PURCHASE BY', 'missing')

  const sellerPhoneRaw = text(cell('sellerPhone'))
  let sellerPhone: string | null = null
  if (sellerPhoneRaw) {
    const digits = normalizePhone(sellerPhoneRaw)
    if (/^0*$/.test(digits)) warning('FIRST PARTY CONTACT', 'a placeholder zero — left blank')
    else {
      sellerPhone = digits
      if (digits.length !== 10) warning('FIRST PARTY CONTACT', `${digits.length} digits — kept as found`)
    }
  }

  const approverRaw = optionValue(cell('purchaseWhatsappApprover'))
  if (!approverRaw) warning('APPROVAL GIVEN BY', `blank — recorded as "${NOT_TAKEN}"`)

  const purchase = legacyDecision(cell('purchaseApproval'))
  if (!purchase.recognised) warning('Approval Purchase', `unrecognised value ${JSON.stringify(text(cell('purchaseApproval')))} — imported as awaiting approval`)
  const purchaseDecidedAt = sheetTimestamp(cell('purchaseApprovalAt'))
  if (text(cell('purchaseApprovalAt')) && !purchaseDecidedAt) warning('Approval Date and Time Purchase', 'not a date — left blank')

  // Sale
  const sellingPrice = number(cell('sellingPrice'))
  const saleDate = calendarDate(cell('saleDate'))
  const soldTo = soldToValue(cell('soldTo'))
  const otherCost = number(cell('otherCost')) ?? 0
  let sale: ParsedVehicle['sale'] = null
  const saleStarted = sellingPrice !== null || Boolean(text(cell('saleDate'))) || Boolean(text(cell('soldTo')))
  if (saleStarted) {
    if (sellingPrice === null || sellingPrice < 0) error('SELLING PRICE', 'a sale is recorded but the selling price is missing')
    if (!saleDate) error('DATE OF SALE', `a sale is recorded but the date is not readable: ${JSON.stringify(text(cell('saleDate')))}`)
    if (!soldTo) error('SOLD TO', `a sale is recorded but "sold to" is ${JSON.stringify(text(cell('soldTo')))}`)
    if (saleDate && purchaseDate && saleDate < purchaseDate) warning('DATE OF SALE', `before the purchase date (${purchaseDate})`)
    const buyerPhoneRaw = text(cell('buyerPhone'))
    let buyerPhone: string | null = null
    if (buyerPhoneRaw) {
      const digits = normalizePhone(buyerPhoneRaw)
      if (/^0*$/.test(digits)) warning('2ND PARTY CONTACT', 'a placeholder zero — left blank')
      else {
        buyerPhone = digits
        if (digits.length !== 10) warning('2ND PARTY CONTACT', `${digits.length} digits — kept as found`)
      }
    }
    const decision = legacyDecision(cell('saleApproval'))
    if (!decision.recognised) warning('Approval Sale', `unrecognised value ${JSON.stringify(text(cell('saleApproval')))} — imported as awaiting approval`)
    const decidedAt = sheetTimestamp(cell('saleApprovalAt'))
    if (text(cell('saleApprovalAt')) && !decidedAt) warning('Approval Date and Time sale', 'not a date — left blank')
    const soldBy = optionValue(cell('soldBy'))
    if (!soldBy) warning('SOLD BY', 'blank')
    const saleApprover = optionValue(cell('saleWhatsappApprover'))
    if (!saleApprover) warning('MANAGEMENT APPROVAL', 'blank')
    if (sellingPrice !== null && saleDate && soldTo) {
      sale = {
        saleDate,
        sellingPrice,
        otherCost,
        isDemo: demoFlag(cell('demo')),
        soldTo,
        saleFinanced: yesNo(cell('saleFinanced')),
        soldByRaw: soldBy,
        buyerName: text(cell('buyerName')),
        buyerPhone,
        buyerAddress: text(cell('buyerAddress')),
        saleWhatsappApproverRaw: saleApprover,
        submittedAt: sheetTimestamp(cell('saleTimestamp')),
        decision,
        decidedAt,
      }
    }
  } else if (text(cell('saleApproval'))) {
    warning('Approval Sale', 'a sale decision without a sale — ignored')
  }

  const insuranceText = text(cell('insuranceEndDate'))
  const insuranceEndDate = calendarDate(cell('insuranceEndDate'))
  if (insuranceText && !insuranceEndDate) warning('Insurance End Date', `not a date: ${JSON.stringify(insuranceText)} — left blank`)
  const hypText = text(cell('hypothecation'))
  const hypothecation = paperworkValue(cell('hypothecation'))
  if (hypText && !hypothecation) warning('HYP Status', `unrecognised: ${JSON.stringify(hypText)} — left blank`)
  const rtoText = text(cell('rtoStatus'))
  const rtoStatus = paperworkValue(cell('rtoStatus'))
  if (rtoText && !rtoStatus) warning('RTO Status', `unrecognised: ${JSON.stringify(rtoText)} — left blank`)

  const files: ParsedVehicle['files'] = []
  for (const [field, kind] of FILE_COLUMNS) {
    const { ids, foreign } = driveFileIds(cell(field))
    if (foreign.length) warning(field, `links outside Google Drive were not copied: ${foreign.join(', ')}`)
    const cellText = text(cell(field))
    if (cellText && ids.length === 0 && foreign.length === 0) warning(field, 'not a link — nothing to copy')
    if (!sale && ['buyer_pan', 'buyer_aadhaar', 'form_c', 'sale_approval_screenshot', 'gate_pass_photo', 'payment_ledger', 'rc_transfer'].includes(kind) && ids.length) {
      warning(field, 'a sale document on a vehicle with no readable sale — not copied')
      continue
    }
    for (const driveId of ids) files.push({ kind, driveId })
  }

  if (purchaseDate === null || priceRaw === null || !location || !purchasedBy || regKey.length < 4 || !model) {
    return {
      sheetRow, regNo, regKey, model, colour: null, manufacturingYear: null, odometerKm: null, engineNo: null, chassisNo: null,
      locationRaw: location ?? '', purchaseDate: purchaseDate ?? '', purchasePrice: priceRaw ?? 0, purchaseGstPct: gst ?? 0,
      sheetPriceWithGst, expectedProfit: null, purchaseRemarks: null, purchaseFinanced: false, purchasedByRaw: purchasedBy ?? '',
      salesConsultant: null, sellerPhone: null, purchaseWhatsappApproverRaw: approverRaw, purchaseTimestamp: null, purchase,
      purchaseDecidedAt, sale, otherCost, insuranceEndDate, hypothecation, rtoStatus, documentsRemarks: null, brokerRcRemarks: null,
      files, sheetFigures: { grossProfit: null, grossProfitWithGst: null, netProfit: null }, issues,
    }
  }

  const engine = text(cell('engineNo'))
  const chassis = text(cell('chassisNo'))
  return {
    sheetRow,
    regNo,
    regKey,
    model,
    colour: text(cell('colour')),
    manufacturingYear: year !== null && Number.isInteger(year) && year >= 1980 && year <= 2100 ? year : null,
    odometerKm: odometer !== null && odometer >= 0 ? Math.round(odometer) : null,
    engineNo: engine ? engine.toUpperCase() : null,
    chassisNo: chassis ? chassis.toUpperCase() : null,
    locationRaw: location,
    purchaseDate,
    purchasePrice: priceRaw,
    purchaseGstPct: gst ?? 0,
    sheetPriceWithGst,
    expectedProfit: number(cell('expectedProfit')),
    purchaseRemarks: text(cell('purchaseRemarks')),
    purchaseFinanced: yesNo(cell('purchaseFinanced')) ?? false,
    purchasedByRaw: purchasedBy,
    salesConsultant: optionValue(cell('salesConsultant')),
    sellerPhone,
    purchaseWhatsappApproverRaw: approverRaw,
    purchaseTimestamp: sheetTimestamp(cell('purchaseTimestamp')),
    purchase,
    purchaseDecidedAt,
    sale,
    otherCost,
    insuranceEndDate,
    hypothecation,
    rtoStatus,
    documentsRemarks: text(cell('documentsRemarks')),
    brokerRcRemarks: text(cell('brokerRcRemarks')),
    files,
    sheetFigures: {
      grossProfit: number(cell('sheetGrossProfit')),
      grossProfitWithGst: number(cell('sheetGrossProfitWithGst')),
      netProfit: number(cell('sheetNetProfit')),
    },
    issues,
  }
}

/**
 * One stored spelling per person: spellings that share a nameKey collapse to the most used one (ties → the
 * longer). Returns raw → canonical, and the merges made, for the report.
 */
export function canonicalNames(values: ReadonlyArray<string>): { map: Map<string, string>; merges: Array<{ kept: string; merged: string[] }> } {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const groups = new Map<string, string[]>()
  for (const value of counts.keys()) {
    const key = nameKey(value)
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  const map = new Map<string, string>()
  const merges: Array<{ kept: string; merged: string[] }> = []
  for (const spellings of groups.values()) {
    const kept = [...spellings].sort((a, b) => (counts.get(b)! - counts.get(a)!) || b.length - a.length || a.localeCompare(b))[0]
    for (const spelling of spellings) map.set(spelling, kept)
    if (spellings.length > 1) merges.push({ kept, merged: spellings.filter((s) => s !== kept) })
  }
  return { map, merges }
}

/** A sheet location ("LAMBERI") matched to an option value ("TATA LAMBERI"). */
export function matchLocation(raw: string, optionValues: ReadonlyArray<string>): string | null {
  if (optionValues.includes(raw)) return raw
  const prefixed = `TATA ${raw}`
  if (optionValues.includes(prefixed)) return prefixed
  const stripped = raw.replace(/^TATA\s+/, '')
  const found = optionValues.find((value) => value.replace(/^TATA\s+/, '') === stripped)
  return found ?? null
}

/** Title Case for a label shown on screen ("SHUBHAM SALATHIA" → "Shubham Salathia"). */
export function labelFromValue(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
}
