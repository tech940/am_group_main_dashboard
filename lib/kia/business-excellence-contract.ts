import { eq, sql } from 'drizzle-orm'
import { analyticsDb } from '@/lib/analytics/db'
import { db } from '@/lib/db'
import { dashboardSettings } from '@/lib/db/schema'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'
import {
  getKiaDealerFilterValues,
  normalizeKiaDealerCode,
  type KiaDealerCode,
} from '@/lib/kia/dealer-branch'

export const KIA_BUSINESS_EXCELLENCE_CACHE_VERSION = 'v41'
export const KIA_BUSINESS_EXCELLENCE_HOLIDAYS_KEY = 'kiaBusinessExcellenceHolidays'

const DEFAULT_KIA_HOLIDAYS = ['2026-06-05']

export type KiaBusinessExcellenceDealerFilter = KiaDealerCode | null
export type KiaBusinessExcellenceSourceMetadata = {
  dealerCode: KiaDealerCode | null
  isAllDealers: boolean
  dateBasis: string
  startDate: string | null
  endDate: string | null
  rowCount: number
  latestAvailableDate: string | null
  deduplicationMode: string
  workingDayCount: number | null
  holidayDates: string[]
  available: boolean
  emptyReason: string | null
}

type NumericRow = Record<string, unknown>

export function parseKiaBusinessDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null
  const [year, month, day] = trimmed.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function toKiaBusinessDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function kiaNumberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function kiaResultRows(result: unknown): NumericRow[] {
  return Array.isArray(result) ? result as NumericRow[] : []
}

export function kiaNumericText(column: ReturnType<typeof sql.raw>) {
  return sql`COALESCE(NULLIF(regexp_replace(${column}::text, '[^0-9.-]', '', 'g'), '')::numeric, 0)`
}

export function kiaActiveBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) NOT IN ('cancel', 'cancelled', 'canceled')`
}

export function kiaCancelledBillStatusSql(alias = '') {
  return sql`LOWER(TRIM(COALESCE(${sql.raw(`${alias}bill_status`)}::text, ''))) IN ('cancel', 'cancelled', 'canceled')`
}

export function kiaServiceCategoryExpression(workTypeColumn: string) {
  return sql`CASE
    WHEN LOWER(TRIM(COALESCE(${sql.raw(workTypeColumn)}::text, ''))) LIKE '%accident%'
      OR LOWER(TRIM(COALESCE(${sql.raw(workTypeColumn)}::text, ''))) LIKE '%bodyshop%'
      THEN 'Accidental Repair'
    WHEN LOWER(TRIM(COALESCE(${sql.raw(workTypeColumn)}::text, ''))) LIKE '%running%'
      THEN 'Running Repair'
    WHEN LOWER(TRIM(COALESCE(${sql.raw(workTypeColumn)}::text, ''))) LIKE '%free%'
      THEN 'Free Service'
    WHEN LOWER(TRIM(COALESCE(${sql.raw(workTypeColumn)}::text, ''))) LIKE '%paid%'
      THEN 'Paid Service'
    ELSE 'Others'
  END`
}

export function kiaActiveServiceCategoryFilter(workTypeColumn = 'work_type') {
  return sql`${kiaServiceCategoryExpression(workTypeColumn)}
    IN ('Free Service', 'Paid Service', 'Running Repair', 'Accidental Repair')`
}

function dealerInListFilter(codes: string[], columns: string[]) {
  if (codes.length === 0) return sql.raw('AND FALSE')
  const coalesced = `UPPER(TRIM(COALESCE(${columns.map((column) => `NULLIF(${column}, '')`).join(', ')}, '')))`
  return sql.raw(`AND ${coalesced} IN (${codes.map((code) => `'${code}'`).join(', ')})`)
}

export function kiaRoBillingDealerFilter(dealerCode: KiaBusinessExcellenceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return dealerInListFilter(codes, [`${alias}dealer_code`, `${alias}main_dealer_code`])
}

export function kiaOpenRoDealerFilter(dealerCode: KiaBusinessExcellenceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return dealerInListFilter(codes, [`${alias}dealer_code`])
}

export function kiaComplaintDealerFilter(dealerCode: KiaBusinessExcellenceDealerFilter, alias = '') {
  const codes = getKiaDealerFilterValues(dealerCode)
  if (!codes?.length) return sql``
  return dealerInListFilter(codes, [`${alias}dealer_code`])
}

export function kiaOpenRoActiveStateSql(alias = '') {
  return sql`
    LOWER(TRIM(COALESCE(${sql.raw(`${alias}status`)}::text, ''))) IN ('open', 'close', 'closed')
  `
}

export function kiaBusinessExcellenceCacheKey(
  section: string,
  signature: string,
) {
  return `kia:business-excellence:${section}:${KIA_BUSINESS_EXCELLENCE_CACHE_VERSION}:${signature}`
}

function normalizeHolidayDates(value: unknown) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && 'dates' in value
      ? (value as { dates?: unknown }).dates
      : []

  if (!Array.isArray(values)) return []
  return Array.from(new Set(
    values
      .map((item) => parseKiaBusinessDate(String(item || '')))
      .filter((item): item is string => Boolean(item)),
  )).sort()
}

export async function getKiaBusinessExcellenceHolidays() {
  return getCachedData(
    kiaBusinessExcellenceCacheKey('holidays', 'default'),
    async () => {
      try {
        const rows = await db
          .select({ value: dashboardSettings.value })
          .from(dashboardSettings)
          .where(eq(dashboardSettings.key, KIA_BUSINESS_EXCELLENCE_HOLIDAYS_KEY))
          .limit(1)
        const configured = normalizeHolidayDates(rows[0]?.value)
        return configured.length > 0 ? configured : DEFAULT_KIA_HOLIDAYS
      } catch {
        return DEFAULT_KIA_HOLIDAYS
      }
    },
    CACHE_TTL.DASHBOARD
  )
}

export function countKiaCompletedWorkingDays(
  startDate: string,
  endDate: string,
  holidayDates: string[],
) {
  const start = new Date(`${startDate}T00:00:00`)
  const end = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return 1

  const holidays = new Set(holidayDates)
  let count = 0
  const cursor = new Date(start)
  while (cursor < end) {
    const inputDate = toKiaBusinessDate(cursor)
    if (cursor.getDay() !== 0 && !holidays.has(inputDate)) count += 1
    cursor.setDate(cursor.getDate() + 1)
  }
  return Math.max(count, 1)
}

export async function getKiaWorkingDayContext(startDate: string, endDate: string) {
  const holidayDates = await getKiaBusinessExcellenceHolidays()
  return {
    holidayDates,
    workingDayCount: countKiaCompletedWorkingDays(startDate, endDate, holidayDates),
  }
}

export function buildKiaSourceMetadata(input: {
  dealerCode?: string | null
  dateBasis: string
  startDate?: string | null
  endDate?: string | null
  rowCount?: number
  latestAvailableDate?: string | null
  deduplicationMode: string
  workingDayCount?: number | null
  holidayDates?: string[]
  available?: boolean
  emptyReason?: string | null
}): KiaBusinessExcellenceSourceMetadata {
  const dealerCode = normalizeKiaDealerCode(input.dealerCode) || null
  const rowCount = input.rowCount || 0
  const available = input.available ?? rowCount > 0
  return {
    dealerCode,
    isAllDealers: dealerCode === null,
    dateBasis: input.dateBasis,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    rowCount,
    latestAvailableDate: input.latestAvailableDate || null,
    deduplicationMode: input.deduplicationMode,
    workingDayCount: input.workingDayCount ?? null,
    holidayDates: input.holidayDates || [],
    available,
    emptyReason: input.emptyReason ?? (available ? null : 'No selected-range data'),
  }
}

export async function fetchKiaBillingSourceMetadata(
  startDate: string,
  endDate: string,
  dealerCode: KiaBusinessExcellenceDealerFilter,
) {
  return getCachedData(
    kiaBusinessExcellenceCacheKey('source-metadata', `${startDate}:${endDate}:${dealerCode || 'all'}`),
    async () => {
      const rows = await analyticsDb.execute(sql`
        SELECT
          COUNT(DISTINCT COALESCE(NULLIF(bill_no, ''), NULLIF(ro_no, ''), id::text))::int AS row_count,
          MAX(bill_date)::text AS latest_available_date
        FROM ro_billing_report
        WHERE bill_date >= ${startDate}::date
          AND bill_date < (${endDate}::date + INTERVAL '1 day')
          AND ${kiaActiveBillStatusSql()}
          AND ${kiaActiveServiceCategoryFilter()}
          ${kiaRoBillingDealerFilter(dealerCode)}
      `)
      const row = kiaResultRows(rows)[0] || {}
      const workingDays = await getKiaWorkingDayContext(startDate, endDate)
      return buildKiaSourceMetadata({
        dealerCode,
        dateBasis: 'bill_date',
        startDate,
        endDate,
        rowCount: kiaNumberValue(row.row_count),
        latestAvailableDate: row.latest_available_date ? String(row.latest_available_date) : null,
        deduplicationMode: 'bill_no -> ro_no -> id; largest absolute billed value',
        ...workingDays,
      })
    },
    CACHE_TTL.DASHBOARD
  )
}
