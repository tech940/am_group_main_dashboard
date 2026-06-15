export type HyundaiWarrantySource = 'ytp' | 'claim_list'

export type WarrantyRequirementCode =
  | 'ytp_over_2'
  | 'open_over_1'
  | 'pending_over_2'
  | 'pending_over_15'
  | 'suspense_docket'
  | 'cancel_justification'

export type WarrantyRequirement = {
  code: WarrantyRequirementCode | null
  label: string
  required: boolean
  requiresDocket: boolean
  ageDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizedText(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export function istDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function normalizeBusinessDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }

  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }

  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10)
  return null
}

export function resolveWarrantyBusinessDate(
  source: HyundaiWarrantySource,
  row: Record<string, unknown>,
): string | null {
  if (source === 'ytp') {
    return normalizeBusinessDate(row.r_o_date) ?? normalizeBusinessDate(row.uploaded_at)
  }
  return normalizeBusinessDate(row.claim_date)
    ?? normalizeBusinessDate(row.r_o_date)
    ?? normalizeBusinessDate(row.uploaded_at)
}

export function calendarAgeDays(value: unknown, today = istDateKey()) {
  const date = normalizeBusinessDate(value) || String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0
  const start = Date.parse(`${date}T00:00:00Z`)
  const end = Date.parse(`${today}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / DAY_MS))
}

export function ytpRecordKey(row: Record<string, unknown>) {
  return [
    'YTP',
    normalizedText(row.source_dealer_code),
    normalizedText(row.r_o_no),
    normalizedText(row.vin),
    normalizedText(row.claim_type),
    normalizedText(row.campaign_no),
  ].join('|')
}

export function claimRecordKey(row: Record<string, unknown>) {
  return `CLAIM|${normalizedText(row.claim_no)}`
}

export function warrantyRecordKey(source: HyundaiWarrantySource, row: Record<string, unknown>) {
  return source === 'ytp' ? ytpRecordKey(row) : claimRecordKey(row)
}

export function getWarrantyRequirement(
  source: HyundaiWarrantySource,
  statusValue: unknown,
  businessDate: unknown,
  today = istDateKey()
): WarrantyRequirement {
  const ageDays = calendarAgeDays(businessDate, today)
  if (source === 'ytp') {
    return ageDays > 2
      ? { code: 'ytp_over_2', label: 'RO is more than 2 days old', required: true, requiresDocket: false, ageDays }
      : { code: null, label: 'Within SLA', required: false, requiresDocket: false, ageDays }
  }

  const status = normalizedText(statusValue)
  if (['CANCEL', 'CANCELLED', 'CANCELED', 'DENIED'].includes(status)) {
    return { code: 'cancel_justification', label: 'Remarks / justification required', required: true, requiresDocket: false, ageDays }
  }
  if (['SUSPENSE(P)', 'SUSPENSE(L)'].includes(status) && ageDays > 7) {
    return { code: 'suspense_docket', label: 'Official docket proof required', required: true, requiresDocket: true, ageDays }
  }
  if (status === 'PENDING' && ageDays > 15) {
    return { code: 'pending_over_15', label: 'Pending over 15 days', required: true, requiresDocket: false, ageDays }
  }
  if (status === 'PENDING' && ageDays > 2) {
    return { code: 'pending_over_2', label: 'Pending over 2 days', required: true, requiresDocket: false, ageDays }
  }
  if (status === 'OPEN' && ageDays > 1) {
    return { code: 'open_over_1', label: 'Open over 1 day', required: true, requiresDocket: false, ageDays }
  }
  return { code: null, label: 'Within SLA', required: false, requiresDocket: false, ageDays }
}

export function actionSatisfiesRequirement(
  requirement: WarrantyRequirement,
  currentStatus: unknown,
  action?: { requirementCode?: unknown; statusSnapshot?: unknown } | null
) {
  if (!requirement.required || !requirement.code) return true
  if (!action) return false
  return normalizedText(action.requirementCode) === normalizedText(requirement.code)
    && normalizedText(action.statusSnapshot) === normalizedText(currentStatus)
}

export const WARRANTY_STATUS_ORDER = [
  'Accept',
  'Denied',
  'Pending',
  'Return',
  'Submit',
  'Open',
  'Suspense(L)',
  'Suspense(P)',
  'Cancelled',
] as const

