import 'server-only'

import ExcelJS from 'exceljs'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getIndiaYmd } from '@/lib/date-time'
import { maskKiaPii } from '@/lib/kia/pii'
import type { WalkInViewer } from './access'
import {
  WALK_IN_BRANCHES,
  WALK_IN_MODELS,
  WALK_IN_SOURCES,
  normalizeMobile,
  remarksMeanBooked,
  tidyText,
  walkInBranchLabel,
} from './constants'
import { walkInDeleteSchema, walkInUpdateSchema, type WalkInSubmitInput } from './schemas'
import type { WalkInFilters, WalkInLead, WalkInListResponse, WalkInSummary } from './types'

/**
 * Every Walk-in Leads read and write.
 *
 * ⚠️ The database is ~250 ms away, so each request is ONE statement: the page, its total and every summary
 * figure come back together (CTE + json_agg), and the public insert checks for a double-submit and a flood in
 * the same statement that inserts.
 *
 * ⚠️ Column names are written out in SQL here rather than taken from Drizzle column objects: inside raw `sql`
 * a Drizzle column renders unqualified, which silently binds to the wrong table in a correlated subquery.
 */

export class WalkInError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WalkInError'
  }
}

const REPEAT_WINDOW_MINUTES = 10
const FLOOD_LIMIT = 60
const PAGE_SIZES = [25, 50, 100] as const
const EXPORT_LIMIT = 20_000

type Row = Record<string, unknown>

function rows<T = Row>(result: unknown): T[] {
  return result as unknown as T[]
}

// ── Public form ──────────────────────────────────────────────────────────────────────────────────

/**
 * The no-login form's write. Returns the existing lead instead of a second row when the same mobile was
 * submitted for the same branch and day in the last few minutes (a double tap, or a resend on a bad signal).
 */
export async function createWalkInLead(dealerCode: string, input: WalkInSubmitInput): Promise<{ id: string; duplicate: boolean }> {
  const booked = remarksMeanBooked(input.remarks) || input.expectedBookingTimeline === 'Booked today'
  const result = rows<{ inserted: string | null; existing: string | null; recent: number }>(await db.execute(sql`
    WITH repeat_submit AS (
      SELECT id FROM kia_walk_in_leads
      WHERE dealer_code = ${dealerCode} AND mobile = ${input.mobile} AND enquiry_date = ${input.enquiryDate}
        AND source = 'form' AND deleted_at IS NULL
        AND created_at > now() - make_interval(mins => ${REPEAT_WINDOW_MINUTES}::int)
      LIMIT 1
    ),
    flood AS (
      SELECT count(*)::int AS n FROM kia_walk_in_leads
      WHERE dealer_code = ${dealerCode} AND source = 'form'
        AND created_at > now() - make_interval(mins => ${REPEAT_WINDOW_MINUTES}::int)
    ),
    inserted AS (
      INSERT INTO kia_walk_in_leads (
        enquiry_date, dealer_code, customer_name, country_code, mobile, email, address, model, consultant_name,
        test_drive, enquiry_source, customer_type, exchange, exchange_details, additional_info,
        expected_booking_timeline, expected_booking_date, holding_reason, follow_up_date, remarks, booked, source
      )
      SELECT
        ${input.enquiryDate}::date, ${dealerCode}::text, ${input.customerName}::text, '+91', ${input.mobile}::text,
        ${input.email}::text, ${input.address}::text, ${input.model}::text, ${input.consultantName}::text,
        ${input.testDrive}::boolean, ${input.enquirySource}::text, ${input.customerType}::text,
        ${input.exchange}::boolean, ${input.exchange ? input.exchangeDetails : null}::text, ${input.additionalInfo}::text,
        ${input.expectedBookingTimeline}::text, ${input.expectedBookingDate}::date, ${input.holdingReason}::text,
        ${input.followUpDate}::date, ${input.remarks}::text, ${booked}::boolean, 'form'
      WHERE NOT EXISTS (SELECT 1 FROM repeat_submit) AND (SELECT n FROM flood) < ${FLOOD_LIMIT}::int
      RETURNING id
    )
    SELECT (SELECT id FROM inserted) AS inserted,
           (SELECT id FROM repeat_submit) AS existing,
           (SELECT n FROM flood) AS recent
  `))[0]
  if (result?.inserted) return { id: result.inserted, duplicate: false }
  if (result?.existing) return { id: result.existing, duplicate: true }
  throw new WalkInError('Too many entries were sent from this link in the last few minutes. Wait a little and try again.', 429)
}

/** Consultant names to offer on the form: this branch's regulars first, then all active Kia consultants. */
export async function walkInConsultantSuggestions(dealerCode: string): Promise<string[]> {
  const result = rows<{ name: string }>(await db.execute(sql`
    WITH all_consultants AS (
      SELECT consultant_name AS name, dealer_code, count(*)::int AS n
      FROM kia_walk_in_leads
      WHERE deleted_at IS NULL AND consultant_name IS NOT NULL AND trim(consultant_name) <> ''
      GROUP BY consultant_name, dealer_code

      UNION ALL

      SELECT consultant_name AS name, dealer_code, 1 AS n
      FROM kia_sales_targets
      WHERE consultant_name IS NOT NULL AND trim(consultant_name) <> ''
      GROUP BY consultant_name, dealer_code

      UNION ALL

      SELECT consultant_name AS name, dealer_code, 1 AS n
      FROM kia_bookings
      WHERE consultant_name IS NOT NULL AND trim(consultant_name) <> ''
      GROUP BY consultant_name, dealer_code
    )
    SELECT trim(name) AS name
    FROM all_consultants
    GROUP BY trim(name)
    ORDER BY bool_or(dealer_code = ${dealerCode}) DESC, sum(n) DESC, trim(name) ASC
  `))
  return result.map((row) => row.name)
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────────

const YMD = /^\d{4}-\d{2}-\d{2}$/

export function parseWalkInFilters(params: URLSearchParams): WalkInFilters {
  const today = getIndiaYmd()
  const monthStart = `${today.slice(0, 8)}01`
  const from = YMD.test(params.get('from') ?? '') ? params.get('from')! : monthStart
  const to = YMD.test(params.get('to') ?? '') ? params.get('to')! : today
  const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
    value && (allowed as readonly string[]).includes(value) ? (value as T) : null
  const size = Number(params.get('pageSize'))
  return {
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    dealer: pick(params.get('dealer'), WALK_IN_BRANCHES.map((b) => b.code)),
    model: pick(params.get('model'), WALK_IN_MODELS),
    consultant: tidyText(params.get('consultant')) || null,
    source: pick(params.get('source'), WALK_IN_SOURCES),
    booked: pick(params.get('booked'), ['yes', 'no'] as const),
    testDrive: pick(params.get('testDrive'), ['yes', 'no'] as const),
    q: tidyText(params.get('q')).slice(0, 80),
    page: Math.max(1, Math.floor(Number(params.get('page')) || 1)),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : 50,
  }
}

function whereFor(filters: WalkInFilters, viewer: WalkInViewer): SQL {
  if (filters.dealer && viewer.scope && !viewer.scope.includes(filters.dealer)) {
    throw new WalkInError('You are restricted to your assigned branch and cannot view this data.', 403)
  }
  const parts: SQL[] = [
    sql`l.deleted_at IS NULL`,
    sql`l.enquiry_date BETWEEN ${filters.from} AND ${filters.to}`,
  ]
  if (filters.dealer) parts.push(sql`l.dealer_code = ${filters.dealer}`)
  else if (viewer.scope) parts.push(sql`l.dealer_code IN (${sql.join(viewer.scope.map((code) => sql`${code}`), sql`, `)})`)
  if (filters.model) parts.push(sql`l.model = ${filters.model}`)
  if (filters.consultant) parts.push(sql`lower(l.consultant_name) = lower(${filters.consultant})`)
  if (filters.source) parts.push(sql`l.enquiry_source = ${filters.source}`)
  if (filters.booked) parts.push(filters.booked === 'yes' ? sql`l.booked` : sql`NOT l.booked`)
  if (filters.testDrive) parts.push(filters.testDrive === 'yes' ? sql`l.test_drive` : sql`NOT l.test_drive`)
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const text = sql`(l.customer_name ILIKE ${like} OR l.consultant_name ILIKE ${like} OR l.model ILIKE ${like} OR coalesce(l.remarks, '') ILIKE ${like} OR coalesce(l.exchange_details, '') ILIKE ${like})`
    // Searching by phone would confirm a number to someone who may not see it, so only PII roles can.
    const digits = normalizeMobile(filters.q)
    parts.push(viewer.canViewPii && digits.length >= 4 ? sql`(${text} OR l.mobile LIKE ${`%${digits}%`})` : text)
  }
  return sql.join(parts, sql` AND `)
}

// ── List ─────────────────────────────────────────────────────────────────────────────────────────

const ROW_JSON = sql`json_build_object(
  'id', l.id, 'enquiryDate', l.enquiry_date::text, 'dealerCode', l.dealer_code, 'customerName', l.customer_name,
  'mobile', l.mobile, 'countryCode', l.country_code, 'email', l.email, 'address', l.address, 'model', l.model,
  'consultantName', l.consultant_name, 'testDrive', l.test_drive, 'enquirySource', l.enquiry_source,
  'customerType', l.customer_type, 'exchange', l.exchange, 'exchangeDetails', l.exchange_details,
  'additionalInfo', l.additional_info, 'expectedBookingDate', l.expected_booking_date::text,
  'expectedBookingTimeline', l.expected_booking_timeline, 'holdingReason', l.holding_reason,
  'followUpDate', l.follow_up_date::text, 'remarks', l.remarks,
  'booked', l.booked, 'source', l.source, 'submittedAt', l.submitted_at, 'updatedAt', l.updated_at,
  'updatedByName', l.updated_by_name,
  'repeatVisit', EXISTS (
    SELECT 1 FROM kia_walk_in_leads p
    WHERE p.mobile = l.mobile AND p.deleted_at IS NULL AND p.id <> l.id
      AND (p.enquiry_date, p.submitted_at) < (l.enquiry_date, l.submitted_at)
  )
)`

type RawLead = Omit<WalkInLead, 'branch'>

function present(raw: RawLead, viewer: WalkInViewer): WalkInLead {
  const allowed = viewer.canViewPii
  return {
    ...raw,
    branch: walkInBranchLabel(raw.dealerCode),
    submittedAt: new Date(raw.submittedAt).toISOString(),
    updatedAt: new Date(raw.updatedAt).toISOString(),
    mobile: maskKiaPii(raw.mobile, allowed),
    email: raw.email ? maskKiaPii(raw.email, allowed) : null,
    address: raw.address ? (allowed ? raw.address : maskKiaPii(raw.address, false)) : null,
  }
}

function breakdown(column: string) {
  return sql`(SELECT coalesce(json_agg(b ORDER BY b.count DESC, b.key), '[]'::json) FROM (
    SELECT ${sql.raw(column)} AS key, count(*)::int AS count,
           count(*) FILTER (WHERE test_drive)::int AS "testDrives", count(*) FILTER (WHERE booked)::int AS booked
    FROM f GROUP BY ${sql.raw(column)}
  ) b)`
}

export async function listWalkInLeads(viewer: WalkInViewer, filters: WalkInFilters): Promise<WalkInListResponse> {
  const where = whereFor(filters, viewer)
  const offset = (filters.page - 1) * filters.pageSize
  const scopeSql = viewer.scope
    ? sql`AND dealer_code IN (${sql.join(viewer.scope.map((code) => sql`${code}`), sql`, `)})`
    : sql``
  const [result] = rows<{ total: number; summary: Omit<WalkInSummary, 'byModel' | 'bySource' | 'byConsultant' | 'byDay'>; by_model: WalkInSummary['byModel']; by_source: WalkInSummary['bySource']; by_consultant: WalkInSummary['byConsultant']; by_day: WalkInSummary['byDay']; page: RawLead[] | null; consultants: string[] | null }>(await db.execute(sql`
    WITH f AS (
      SELECT l.*, EXISTS (
        SELECT 1 FROM kia_walk_in_leads p
        WHERE p.mobile = l.mobile AND p.deleted_at IS NULL AND p.id <> l.id
          AND (p.enquiry_date, p.submitted_at) < (l.enquiry_date, l.submitted_at)
      ) AS repeat_visit
      FROM kia_walk_in_leads l
      WHERE ${where}
    )
    SELECT
      (SELECT count(*)::int FROM f) AS total,
      (SELECT json_build_object(
        'total', count(*)::int,
        'testDrives', count(*) FILTER (WHERE test_drive)::int,
        'booked', count(*) FILTER (WHERE booked)::int,
        'exchange', count(*) FILTER (WHERE exchange)::int,
        'newCustomers', count(*) FILTER (WHERE customer_type = 'NEW')::int,
        'existingCustomers', count(*) FILTER (WHERE customer_type = 'EXISTING')::int,
        'repeatVisits', count(*) FILTER (WHERE repeat_visit)::int
      ) FROM f) AS summary,
      ${breakdown('model')} AS by_model,
      ${breakdown('enquiry_source')} AS by_source,
      ${breakdown('consultant_name')} AS by_consultant,
      (SELECT coalesce(json_agg(d ORDER BY d.date), '[]'::json) FROM (
        SELECT enquiry_date::text AS date, count(*)::int AS count FROM f GROUP BY enquiry_date
      ) d) AS by_day,
      (SELECT json_agg(x.row ORDER BY x.enquiry_date DESC, x.submitted_at DESC) FROM (
        SELECT ${ROW_JSON} AS row, l.enquiry_date, l.submitted_at
        FROM f l
        ORDER BY l.enquiry_date DESC, l.submitted_at DESC
        LIMIT ${filters.pageSize} OFFSET ${offset}
      ) x) AS page,
      (SELECT json_agg(c.name ORDER BY c.n DESC, c.name) FROM (
        SELECT trim(name) AS name, sum(n)::int AS n FROM (
          SELECT consultant_name AS name, count(*)::int AS n FROM kia_walk_in_leads
          WHERE deleted_at IS NULL AND consultant_name IS NOT NULL AND trim(consultant_name) <> '' ${scopeSql}
          GROUP BY consultant_name
          UNION ALL
          SELECT consultant_name AS name, 1 AS n FROM kia_sales_targets
          WHERE consultant_name IS NOT NULL AND trim(consultant_name) <> '' ${scopeSql}
          GROUP BY consultant_name
          UNION ALL
          SELECT consultant_name AS name, 1 AS n FROM kia_bookings
          WHERE consultant_name IS NOT NULL AND trim(consultant_name) <> '' ${scopeSql}
          GROUP BY consultant_name
        ) u
        GROUP BY trim(name)
      ) c) AS consultants
  `))

  return {
    rows: (result?.page ?? []).map((raw) => present(raw, viewer)),
    total: result?.total ?? 0,
    filters,
    summary: {
      ...(result?.summary ?? { total: 0, testDrives: 0, booked: 0, exchange: 0, newCustomers: 0, existingCustomers: 0, repeatVisits: 0 }),
      byModel: result?.by_model ?? [],
      bySource: result?.by_source ?? [],
      byConsultant: result?.by_consultant ?? [],
      byDay: result?.by_day ?? [],
    },
    consultants: result?.consultants ?? [],
    branches: WALK_IN_BRANCHES.filter((branch) => !viewer.scope || viewer.scope.includes(branch.code)).map((b) => ({ code: b.code, label: b.label })),
    canViewPii: viewer.canViewPii,
    can: viewer.can,
    today: getIndiaYmd(),
  }
}

// ── Follow-up edits and removal ──────────────────────────────────────────────────────────────────

async function readLead(id: string, viewer: WalkInViewer): Promise<{ id: string; dealerCode: string; remarks: string | null; updatedAt: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new WalkInError('That lead was not found.', 404)
  const [lead] = rows<{ id: string; dealer_code: string; remarks: string | null; updated_at: string }>(await db.execute(sql`
    SELECT id, dealer_code, remarks, updated_at FROM kia_walk_in_leads WHERE id = ${id} AND deleted_at IS NULL
  `))
  if (!lead || (viewer.scope && !viewer.scope.includes(lead.dealer_code))) throw new WalkInError('That lead was not found.', 404)
  return { id: lead.id, dealerCode: lead.dealer_code, remarks: lead.remarks, updatedAt: new Date(lead.updated_at).toISOString() }
}

export async function updateWalkInLead(viewer: WalkInViewer, id: string, raw: unknown): Promise<WalkInLead> {
  const input = walkInUpdateSchema.parse(raw)
  const current = await readLead(id, viewer)
  const remarks = input.remarks === undefined ? current.remarks : input.remarks
  // Typing "BOOKED" in the remark books it, as the sheet's formula did; the switch can still say otherwise.
  const booked = input.booked ?? (input.remarks !== undefined ? remarksMeanBooked(remarks) : undefined)
  // clock_timestamp(), not now(): the version below must move even when two edits share a transaction.
  const sets: SQL[] = [sql`updated_at = clock_timestamp()`, sql`updated_by = ${viewer.appUser.id}`, sql`updated_by_name = ${viewer.appUser.fullName || viewer.appUser.email}`]
  if (input.remarks !== undefined) sets.push(sql`remarks = ${input.remarks}`)
  if (input.expectedBookingDate !== undefined) sets.push(sql`expected_booking_date = ${input.expectedBookingDate}`)
  if (input.expectedBookingTimeline !== undefined) sets.push(sql`expected_booking_timeline = ${input.expectedBookingTimeline}`)
  if (input.holdingReason !== undefined) sets.push(sql`holding_reason = ${input.holdingReason}`)
  if (input.followUpDate !== undefined) sets.push(sql`follow_up_date = ${input.followUpDate}`)
  if (input.consultantName !== undefined) sets.push(sql`consultant_name = ${input.consultantName}`)
  if (booked !== undefined) sets.push(sql`booked = ${booked}`)
  const updated = rows<{ row: RawLead }>(await db.execute(sql`
    UPDATE kia_walk_in_leads l SET ${sql.join(sets, sql`, `)}
    WHERE l.id = ${id} AND l.deleted_at IS NULL AND date_trunc('milliseconds', l.updated_at) = date_trunc('milliseconds', ${input.expectedUpdatedAt}::timestamptz)
    RETURNING ${ROW_JSON} AS row
  `))
  if (updated.length === 0) throw new WalkInError('Someone else changed this lead a moment ago. Reload it and try again.', 409)
  return present(updated[0].row, viewer)
}

export async function deleteWalkInLead(viewer: WalkInViewer, id: string, raw: unknown): Promise<void> {
  const input = walkInDeleteSchema.parse(raw)
  await readLead(id, viewer)
  await db.execute(sql`
    UPDATE kia_walk_in_leads
    SET deleted_at = clock_timestamp(), deleted_by = ${viewer.appUser.id}, deleted_by_name = ${viewer.appUser.fullName || viewer.appUser.email},
        delete_reason = ${input.reason}, updated_at = clock_timestamp()
    WHERE id = ${id} AND deleted_at IS NULL
  `)
}

// ── Export ───────────────────────────────────────────────────────────────────────────────────────

export async function exportWalkInLeads(viewer: WalkInViewer, filters: WalkInFilters): Promise<Buffer> {
  const where = whereFor(filters, viewer)
  const raw = rows<{ row: RawLead }>(await db.execute(sql`
    SELECT ${ROW_JSON} AS row FROM kia_walk_in_leads l
    WHERE ${where}
    ORDER BY l.enquiry_date DESC, l.submitted_at DESC
    LIMIT ${EXPORT_LIMIT}
  `)).map((r) => present(r.row, viewer))

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'AM Group dashboard'
  const sheet = workbook.addWorksheet('Walk-in Leads', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: 'Visit date', key: 'enquiryDate', width: 12 },
    { header: 'Branch', key: 'branch', width: 11 },
    { header: 'Customer', key: 'customerName', width: 24 },
    { header: 'Mobile', key: 'mobileText', width: 16 },
    { header: 'E-mail', key: 'email', width: 24 },
    { header: 'Address / Area', key: 'address', width: 28 },
    { header: 'Model', key: 'model', width: 16 },
    { header: 'Consultant', key: 'consultantName', width: 20 },
    { header: 'Test drive', key: 'testDriveText', width: 10 },
    { header: 'Source', key: 'enquirySource', width: 18 },
    { header: 'New / existing', key: 'customerType', width: 13 },
    { header: 'Exchange', key: 'exchangeText', width: 22 },
    { header: 'Forecast Timeline', key: 'expectedBookingTimeline', width: 18 },
    { header: 'Expected booking', key: 'expectedBookingDate', width: 15 },
    { header: 'Holding reason', key: 'holdingReason', width: 26 },
    { header: 'Next Follow-up', key: 'followUpDate', width: 15 },
    { header: 'Remarks', key: 'remarks', width: 28 },
    { header: 'Booked', key: 'bookedText', width: 8 },
    { header: 'Repeat visit', key: 'repeatText', width: 11 },
    { header: 'Additional information', key: 'additionalInfo', width: 32 },
    { header: 'Entered', key: 'submittedText', width: 18 },
    { header: 'From', key: 'sourceText', width: 10 },
  ]
  for (const lead of raw) {
    sheet.addRow({
      ...lead,
      mobileText: lead.mobile === '••••••' ? lead.mobile : `${lead.countryCode} ${lead.mobile}`,
      testDriveText: lead.testDrive ? 'Yes' : 'No',
      exchangeText: lead.exchange === null ? '' : lead.exchange ? `Yes${lead.exchangeDetails ? ` — ${lead.exchangeDetails}` : ''}` : 'No',
      bookedText: lead.booked ? 'Yes' : 'No',
      repeatText: lead.repeatVisit ? 'Yes' : '',
      submittedText: new Date(lead.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      sourceText: lead.source === 'import' ? 'Old sheet' : 'Form',
    })
  }
  sheet.getRow(1).font = { bold: true }
  sheet.autoFilter = { from: 'A1', to: 'V1' }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
