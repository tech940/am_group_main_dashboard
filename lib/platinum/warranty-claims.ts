import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

export type PlatinumWarrantySource = 'ytp' | 'claim_list'

export type WarrantySourceRecord = Record<string, unknown> & {
  recordKey: string
}

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
  source: PlatinumWarrantySource,
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

export function warrantyRecordKey(source: PlatinumWarrantySource, row: Record<string, unknown>) {
  return source === 'ytp' ? ytpRecordKey(row) : claimRecordKey(row)
}

export function platinumWarrantyBaseCacheKey(source: PlatinumWarrantySource) {
  return `platinum:warranty:${source}:base:v2`
}

export const warrantyRecentActionSql = sql`a.created_at >= now() - interval '1 month'`

export const claimListYtpExistsSql = sql`
  EXISTS (
    SELECT 1
    FROM hyundai_warranty_claim_ytp y
    WHERE CASE
      WHEN COALESCE(UPPER(TRIM(y.source_dealer_code)), '') = 'N6824' THEN 'N6250'
      ELSE COALESCE(UPPER(TRIM(y.source_dealer_code)), '')
    END = CASE
      WHEN COALESCE(UPPER(TRIM(l.source_dealer_code)), '') = 'N6824' THEN 'N6250'
      ELSE COALESCE(UPPER(TRIM(l.source_dealer_code)), '')
    END
      AND (
        (
          COALESCE(UPPER(TRIM(y.r_o_no)), '') <> ''
          AND COALESCE(UPPER(TRIM(l.r_o_no)), '') <> ''
          AND COALESCE(UPPER(TRIM(y.r_o_no)), '') = COALESCE(UPPER(TRIM(l.r_o_no)), '')
          AND (
            (
              COALESCE(UPPER(TRIM(y.vin)), '') <> ''
              AND COALESCE(UPPER(TRIM(l.vin)), '') <> ''
              AND COALESCE(UPPER(TRIM(y.vin)), '') = COALESCE(UPPER(TRIM(l.vin)), '')
            )
            OR (
              COALESCE(UPPER(TRIM(y.claim_type)), '') <> ''
              AND COALESCE(UPPER(TRIM(l.claim_type)), '') <> ''
              AND COALESCE(UPPER(TRIM(y.claim_type)), '') = COALESCE(UPPER(TRIM(l.claim_type)), '')
            )
            OR COALESCE(UPPER(TRIM(y.vin)), '') = ''
            OR COALESCE(UPPER(TRIM(l.vin)), '') = ''
            OR COALESCE(UPPER(TRIM(y.claim_type)), '') = ''
            OR COALESCE(UPPER(TRIM(l.claim_type)), '') = ''
          )
        )
        OR (
          COALESCE(UPPER(TRIM(y.vin)), '') <> ''
          AND COALESCE(UPPER(TRIM(l.vin)), '') <> ''
          AND COALESCE(UPPER(TRIM(y.vin)), '') = COALESCE(UPPER(TRIM(l.vin)), '')
        )
      )
  )
`

export const claimListActionJoinSql = sql`
  a.source_type = 'claim_list'
  AND COALESCE(UPPER(TRIM(l.claim_no)), '') = CASE
    WHEN UPPER(TRIM(a.record_key)) LIKE 'CLAIM|%'
    THEN SUBSTRING(UPPER(TRIM(a.record_key)) FROM 7)
    ELSE COALESCE(UPPER(TRIM(a.record_key)), '')
  END
`

export const ytpActionJoinSql = sql`
  a.source_type = 'ytp'
  AND split_part(a.record_key, '|', 1) = 'YTP'
  AND COALESCE(UPPER(TRIM(y.source_dealer_code)), '') = split_part(a.record_key, '|', 2)
  AND COALESCE(UPPER(TRIM(y.r_o_no)), '') = split_part(a.record_key, '|', 3)
  AND COALESCE(UPPER(TRIM(y.vin)), '') = split_part(a.record_key, '|', 4)
  AND COALESCE(UPPER(TRIM(y.claim_type)), '') = split_part(a.record_key, '|', 5)
  AND COALESCE(UPPER(TRIM(y.campaign_no)), '') = COALESCE(NULLIF(split_part(a.record_key, '|', 6), ''), '')
`

export function getWarrantyRequirement(
  source: PlatinumWarrantySource,
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

type RawRow = Record<string, unknown>

function resultRows(result: unknown): RawRow[] {
  return Array.isArray(result) ? result as RawRow[] : []
}

async function findClaimListRecordById(sourceRowId: string) {
  const result = await db.execute(sql`
    SELECT id, claim_no, claim_date, status, source_dealer_code,
      r_o_no, r_o_date, vin, claim_type
    FROM hyundai_warranty_claim_list l
    WHERE l.id::text = ${sourceRowId}
      AND ${claimListYtpExistsSql}
    LIMIT 1
  `)
  return resultRows(result)[0] || null
}

async function findClaimListRecordByKey(recordKey: string) {
  const claimNo = recordKey.replace(/^CLAIM\|/i, '').trim()
  if (!claimNo) return null
  const result = await db.execute(sql`
    SELECT id, claim_no, claim_date, status, source_dealer_code,
      r_o_no, r_o_date, vin, claim_type
    FROM hyundai_warranty_claim_list l
    WHERE COALESCE(UPPER(TRIM(l.claim_no)), '') = ${normalizedText(claimNo)}
      AND ${claimListYtpExistsSql}
    LIMIT 1
  `)
  return resultRows(result)[0] || null
}

async function findYtpRecordById(sourceRowId: string) {
  const result = await db.execute(sql`
    SELECT id, source_dealer_code, r_o_no, r_o_date, claim_type, r_o_status, vin, campaign_no
    FROM hyundai_warranty_claim_ytp
    WHERE id::text = ${sourceRowId}
    LIMIT 1
  `)
  return resultRows(result)[0] || null
}

async function findYtpRecordByKey(recordKey: string) {
  const parts = recordKey.split('|')
  if (parts.length < 6 || parts[0] !== 'YTP') return null
  const [, dealerCode, roNo, vin, claimType, campaignNo] = parts
  const result = await db.execute(sql`
    SELECT id, source_dealer_code, r_o_no, r_o_date, claim_type, r_o_status, vin, campaign_no
    FROM hyundai_warranty_claim_ytp
    WHERE COALESCE(UPPER(TRIM(source_dealer_code)), '') = ${dealerCode}
      AND COALESCE(UPPER(TRIM(r_o_no)), '') = ${roNo}
      AND COALESCE(UPPER(TRIM(vin)), '') = ${vin}
      AND COALESCE(UPPER(TRIM(claim_type)), '') = ${claimType}
      AND COALESCE(UPPER(TRIM(campaign_no)), '') = ${campaignNo}
    LIMIT 1
  `)
  return resultRows(result)[0] || null
}

export async function findWarrantySourceRecord(
  source: PlatinumWarrantySource,
  options: { sourceRowId?: string | null; recordKey?: string | null },
): Promise<WarrantySourceRecord | null> {
  const sourceRowId = String(options.sourceRowId || '').trim()
  const recordKey = String(options.recordKey || '').trim()

  let row: RawRow | null = null
  if (sourceRowId) {
    row = source === 'ytp'
      ? await findYtpRecordById(sourceRowId)
      : await findClaimListRecordById(sourceRowId)
  }
  if (!row && recordKey) {
    row = source === 'ytp'
      ? await findYtpRecordByKey(recordKey)
      : await findClaimListRecordByKey(recordKey)
  }
  if (!row) return null

  return {
    ...row,
    recordKey: warrantyRecordKey(source, row),
  }
}
