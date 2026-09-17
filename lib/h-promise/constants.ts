/**
 * AM Tata · H Promise — the fixed vocabulary of the pre-owned car desk.
 *
 * Client-safe: no server imports. The server validates against these lists and the forms render them, so
 * the two can never offer different choices.
 *
 * ⚠️ The editable name lists (staff, WhatsApp approvers, locations) are NOT here — they live in the
 * tata_h_promise_options table and are managed in the section's Settings tab.
 */

export const HP_BRAND = 'tata' as const

/** `HP-00042`. The number itself is a database identity (never a row count). */
export function formatStockNo(stockNo: number | null | undefined): string {
  if (typeof stockNo !== 'number' || !Number.isFinite(stockNo)) return 'HP-—'
  return `HP-${String(Math.trunc(stockNo)).padStart(5, '0')}`
}

/** The WhatsApp-approver value meaning "nobody was asked on WhatsApp". Always offered last; not editable. */
export const NOT_TAKEN = 'NOT_TAKEN' as const
export const NOT_TAKEN_LABEL = 'Approval not taken on WhatsApp'

export const SOLD_TO_VALUES = ['CUSTOMER', 'BROKER', 'SCRAP'] as const
export type SoldTo = (typeof SOLD_TO_VALUES)[number]
export const SOLD_TO_LABELS: Record<SoldTo, string> = {
  CUSTOMER: 'Customer',
  BROKER: 'Broker',
  SCRAP: 'Scrap',
}

/**
 * Hypothecation removal and the RTO update share one vocabulary: the sheet's "HYP Status" and "RTO Status"
 * columns both held NOT REQUIRED / REQUIRED / UNDER PROCESS / DOCUMENT UPLOADED (read from the owner's
 * workbook, 2026-09-17). `REQUIRED` means "needed, not started".
 */
export const PAPERWORK_STATUS_VALUES = ['NOT_REQUIRED', 'REQUIRED', 'UNDER_PROCESS', 'DOCUMENT_UPLOADED'] as const
export type PaperworkStatus = (typeof PAPERWORK_STATUS_VALUES)[number]
export const PAPERWORK_STATUS_LABELS: Record<PaperworkStatus, string> = {
  NOT_REQUIRED: 'Not required',
  REQUIRED: 'Required — not started',
  UNDER_PROCESS: 'Under process',
  DOCUMENT_UPLOADED: 'Done — document uploaded',
}
/** Needed and not finished: what the "paperwork pending" flag counts. */
export function paperworkOutstanding(status: string | null | undefined): boolean {
  return status === 'REQUIRED' || status === 'UNDER_PROCESS'
}
export function isPaperworkStatus(value: unknown): value is PaperworkStatus {
  return typeof value === 'string' && (PAPERWORK_STATUS_VALUES as readonly string[]).includes(value)
}

export function isSoldTo(value: unknown): value is SoldTo {
  return typeof value === 'string' && (SOLD_TO_VALUES as readonly string[]).includes(value)
}

export const BOOKING_STATUS_VALUES = ['active', 'refunded'] as const
export type BookingStatus = (typeof BOOKING_STATUS_VALUES)[number]

export const OPTION_KINDS = ['staff', 'approver', 'location'] as const
export type OptionKind = (typeof OPTION_KINDS)[number]
export const OPTION_KIND_LABELS: Record<OptionKind, { singular: string; plural: string; hint: string }> = {
  staff: {
    singular: 'Staff member',
    plural: 'Staff',
    hint: 'Offered as "Purchased by" and "Sold by".',
  },
  approver: {
    singular: 'WhatsApp approver',
    plural: 'WhatsApp approvers',
    hint: 'Who gave the go-ahead on WhatsApp. A record of the call, not an in-app approval.',
  },
  location: {
    singular: 'Location',
    plural: 'Locations',
    hint: 'Where the vehicle was bought and is held.',
  },
}

// ── Files ────────────────────────────────────────────────────────────────────────────────────────

export const FILE_KINDS = [
  'purchase_approval_screenshot',
  'booking_receipt',
  'refund_cheque',
  'sale_approval_screenshot',
  'gate_pass_photo',
  'buyer_pan',
  'buyer_aadhaar',
  'form_c',
  'rc',
  'seller_aadhaar',
  'seller_pan',
  'credit_note',
  'insurance_copy',
  'form_35',
  'rto_mail',
  'rc_transfer',
  'payment_ledger',
] as const
export type FileKind = (typeof FILE_KINDS)[number]

export type FileGroup = 'purchase' | 'booking' | 'sale' | 'documents' | 'broker_rc' | 'ledger'

/**
 * `pii`     — identity documents and cheques: opened only by people who work the deal (canSeePii).
 * `finance` — the payment ledger: opened by those people and by payment-verification viewers.
 * `normal`  — anyone who can open the vehicle.
 */
export type FileSensitivity = 'pii' | 'finance' | 'normal'

export type FileKindPolicy = {
  label: string
  group: FileGroup
  sensitivity: FileSensitivity
  /** PDFs are accepted only where a scan or statement is plausible. Photos are always accepted. */
  acceptsPdf: boolean
  /** `document` keeps small print legible (lib/images/optimize.ts). */
  preset: 'default' | 'document'
  /** Files hang off the vehicle, except the two booking slots, which belong to one booking. */
  attachTo: 'vehicle' | 'booking'
}

export const FILE_KIND_POLICY: Record<FileKind, FileKindPolicy> = {
  purchase_approval_screenshot: { label: 'WhatsApp approval', group: 'purchase', sensitivity: 'normal', acceptsPdf: false, preset: 'default', attachTo: 'vehicle' },
  booking_receipt: { label: 'Booking receipt', group: 'booking', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'booking' },
  refund_cheque: { label: 'Refund cheque', group: 'booking', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'booking' },
  sale_approval_screenshot: { label: 'WhatsApp approval', group: 'sale', sensitivity: 'normal', acceptsPdf: false, preset: 'default', attachTo: 'vehicle' },
  gate_pass_photo: { label: 'Gate pass', group: 'sale', sensitivity: 'normal', acceptsPdf: true, preset: 'default', attachTo: 'vehicle' },
  buyer_pan: { label: 'Buyer PAN', group: 'sale', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  buyer_aadhaar: { label: 'Buyer Aadhaar', group: 'sale', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  form_c: { label: 'Form C', group: 'sale', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  rc: { label: 'RC', group: 'documents', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  seller_aadhaar: { label: 'Seller Aadhaar', group: 'documents', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  seller_pan: { label: 'Seller PAN', group: 'documents', sensitivity: 'pii', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  credit_note: { label: 'Credit note', group: 'documents', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  insurance_copy: { label: 'Insurance', group: 'documents', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  form_35: { label: 'Form 35', group: 'documents', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  rto_mail: { label: 'RTO mail', group: 'documents', sensitivity: 'normal', acceptsPdf: true, preset: 'default', attachTo: 'vehicle' },
  rc_transfer: { label: 'RC transfer', group: 'broker_rc', sensitivity: 'normal', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
  payment_ledger: { label: 'Payment ledger', group: 'ledger', sensitivity: 'finance', acceptsPdf: true, preset: 'document', attachTo: 'vehicle' },
}

export function isFileKind(value: unknown): value is FileKind {
  return typeof value === 'string' && (FILE_KINDS as readonly string[]).includes(value)
}

/** The documents the sheet counted as "mandatory" on a sold vehicle: RC, Aadhaar, PAN and insurance. */
export const SOLD_VEHICLE_REQUIRED_DOCS: readonly FileKind[] = ['rc', 'seller_aadhaar', 'seller_pan', 'insurance_copy']

/** Required when a sale is recorded (as the sheet enforced). Form C stays optional. */
export const SALE_REQUIRED_FILES: readonly FileKind[] = ['buyer_pan', 'buyer_aadhaar', 'sale_approval_screenshot', 'gate_pass_photo']

// ── Uploads ──────────────────────────────────────────────────────────────────────────────────────

/** Server-side ceiling per file. Vercel rejects request bodies over 4.5 MB, so the browser compresses first. */
export const HP_MAX_FILE_BYTES = 10 * 1024 * 1024
/** What the browser will send in one request after compression. */
export const HP_MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const HP_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const HP_PDF_TYPE = 'application/pdf' as const
