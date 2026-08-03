import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import { canAccessBrand } from '@/lib/auth/brand-access'
import {
  getWarrantyRequirement,
  istDateKey,
  normalizedText,
  resolveWarrantyBusinessDate,
  type HyundaiWarrantySource,
  warrantyRecordKey,
  WARRANTY_STATUS_ORDER,
  hyundaiWarrantyBaseCacheKey,
  claimListYtpExistsSql,
  claimListActionJoinSql,
  ytpActionJoinSql,
  warrantyRecentActionSql,
} from '@/lib/hyundai/warranty-claims'
import {
  HYUNDAI_WARRANTY_ALLOWED_DEALERS,
  HYUNDAI_WARRANTY_DEALER_GROUPS,
  getHyundaiWarrantyGroupForDealer,
} from '@/lib/hyundai/warranty-dealers'
import { getCachedData } from '@/lib/redis/cache-utils'
import { CACHE_TTL } from '@/lib/redis/client'

const WARRANTY_CACHE_TTL_SECONDS = CACHE_TTL.SHORT

export const dynamic = 'force-dynamic'

type RawRow = Record<string, unknown>
type EnrichedRow = RawRow & {
  id: string
  uploaded_at: string | null
  recordKey: string
  dealerCode: string
  dealerName: string
  status: string
  businessDate: string | null
  requirement: ReturnType<typeof getWarrantyRequirement>
  compliance: 'complete' | 'action_required' | 'not_required'
  remarkCount: number
  latestRemark: RawRow | null
  statusBucket: string
}

function rows(result: unknown) {
  return Array.isArray(result) ? result as RawRow[] : []
}

function sourceFrom(value: string | null): HyundaiWarrantySource {
  return value === 'ytp' ? 'ytp' : 'claim_list'
}

function permissionKey(source: HyundaiWarrantySource, action: 'view' | 'edit' | 'audit') {
  return `hyundai.${source === 'ytp' ? 'warranty_list' : 'warranty_claim_list'}.${action}`
}

function text(value: unknown) {
  return String(value || '').trim()
}

function num(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseCsvParam(value: string | null, legacySingle?: string | null) {
  const raw = text(value) || text(legacySingle)
  if (!raw) return [] as string[]
  return [...new Set(raw.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean))]
}

function dealerCodesForLocationKeys(locationKeys: string[]) {
  const codes = new Set<string>()
  for (const key of locationKeys) {
    const normalized = key.trim().toUpperCase()
    const group = HYUNDAI_WARRANTY_DEALER_GROUPS.find(
      (item) => item.key.toUpperCase() === normalized || item.label.toUpperCase() === normalized,
    )
    if (group) group.dealerCodes.forEach((code) => codes.add(code))
  }
  return codes
}

function allowedDealerSqlFilter() {
  return sql`UPPER(TRIM(source_dealer_code)) IN (${sql.join(
    HYUNDAI_WARRANTY_ALLOWED_DEALERS.map((code) => sql`${code}`),
    sql`, `,
  )})`
}

async function fetchSourceRows(source: HyundaiWarrantySource) {
  const dealerFilter = allowedDealerSqlFilter()
  if (source === 'ytp') {
    return rows(await db.execute(sql`
      SELECT id, row_hash, source_login_id, no, r_o_no, r_o_date, claim_type,
        r_o_status, vin, campaign_no, category, uploaded_at, source_dealer_code
      FROM hyundai_warranty_claim_ytp
      WHERE ${dealerFilter}
    `))
  }
  return rows(await db.execute(sql`
    SELECT id, row_hash, source_login_id, s_no, vin, claim_no, acl_no, claim_date,
      claim_type, r_o_no, r_o_date, status, mileage, cause, nature, causal_part,
      main_op, part_desc, total_amt, labour, part, sublet, igst, cgst, sgst,
      approve_amount_by_hmi, invoice_no, part_type, pdctn_date, uploaded_at,
      source_dealer_code
    FROM hyundai_warranty_claim_list l
    WHERE ${dealerFilter}
      AND ${claimListYtpExistsSql}
  `))
}

async function fetchMappings() {
  const result = await db.execute(sql`
    SELECT dealer_code, dealer_name
    FROM hyundai_warranty_dealer_mappings
    WHERE is_active = true
  `)
  return new Map(rows(result).map((row) => [text(row.dealer_code).toUpperCase(), text(row.dealer_name)]))
}

type ActionSummaries = {
  remarkCountsByRowId: Map<string, number>
  latestByRowId: Map<string, RawRow>
  satisfactionKeysByRowId: Set<string>
}

type CachedActionSummaries = {
  remarkCountsByRowId: Array<[string, number]>
  latestByRowId: Array<[string, RawRow]>
  satisfactionKeysByRowId: string[]
}

function rowSatisfactionKey(rowId: string, requirementCode: unknown, statusSnapshot: unknown) {
  return `${rowId}|${normalizedText(requirementCode)}|${normalizedText(statusSnapshot)}`
}

async function fetchActionSummaries(source: HyundaiWarrantySource): Promise<ActionSummaries> {
  const cached = await getCachedData(
    `${warrantyCacheKey(source)}:actions`,
    async (): Promise<CachedActionSummaries> => {
  if (source === 'claim_list') {
    const [countRows, latestRows, satisfactionRows] = await Promise.all([
      db.execute(sql`
        SELECT l.id::text AS source_row_id, COUNT(a.id)::int AS remark_count
        FROM hyundai_warranty_claim_actions a
        INNER JOIN hyundai_warranty_claim_list l ON ${claimListActionJoinSql}
        WHERE ${warrantyRecentActionSql}
        GROUP BY l.id
      `),
      db.execute(sql`
        SELECT DISTINCT ON (l.id)
          l.id::text AS source_row_id, a.remark, a.docket_number,
          a.created_by_name, a.created_by_role, a.created_at
        FROM hyundai_warranty_claim_actions a
        INNER JOIN hyundai_warranty_claim_list l ON ${claimListActionJoinSql}
        WHERE ${warrantyRecentActionSql}
        ORDER BY l.id, a.created_at DESC
      `),
      db.execute(sql`
        SELECT l.id::text AS source_row_id, a.requirement_code, a.status_snapshot
        FROM hyundai_warranty_claim_actions a
        INNER JOIN hyundai_warranty_claim_list l ON ${claimListActionJoinSql}
        WHERE ${warrantyRecentActionSql}
        GROUP BY l.id, a.requirement_code, a.status_snapshot
      `),
    ])

    const remarkCountsByRowId = new Map<string, number>()
    rows(countRows).forEach((row) => {
      remarkCountsByRowId.set(text(row.source_row_id), num(row.remark_count))
    })

    const latestByRowId = new Map<string, RawRow>()
    rows(latestRows).forEach((row) => {
      latestByRowId.set(text(row.source_row_id), row)
    })

    const satisfactionKeysByRowId = new Set<string>()
    rows(satisfactionRows).forEach((row) => {
      satisfactionKeysByRowId.add(rowSatisfactionKey(
        text(row.source_row_id),
        row.requirement_code,
        row.status_snapshot,
      ))
    })

    return {
      remarkCountsByRowId: Array.from(remarkCountsByRowId.entries()),
      latestByRowId: Array.from(latestByRowId.entries()),
      satisfactionKeysByRowId: Array.from(satisfactionKeysByRowId),
    }
  }

  const [countRows, latestRows, satisfactionRows] = await Promise.all([
    db.execute(sql`
      SELECT y.id::text AS source_row_id, COUNT(a.id)::int AS remark_count
      FROM hyundai_warranty_claim_actions a
      INNER JOIN hyundai_warranty_claim_ytp y ON ${ytpActionJoinSql}
      WHERE ${warrantyRecentActionSql}
      GROUP BY y.id
    `),
    db.execute(sql`
      SELECT DISTINCT ON (y.id)
        y.id::text AS source_row_id, a.remark, a.docket_number,
        a.created_by_name, a.created_by_role, a.created_at
      FROM hyundai_warranty_claim_actions a
      INNER JOIN hyundai_warranty_claim_ytp y ON ${ytpActionJoinSql}
      WHERE ${warrantyRecentActionSql}
      ORDER BY y.id, a.created_at DESC
    `),
    db.execute(sql`
      SELECT y.id::text AS source_row_id, a.requirement_code, a.status_snapshot
      FROM hyundai_warranty_claim_actions a
      INNER JOIN hyundai_warranty_claim_ytp y ON ${ytpActionJoinSql}
      WHERE ${warrantyRecentActionSql}
      GROUP BY y.id, a.requirement_code, a.status_snapshot
    `),
  ])

  const remarkCountsByRowId = new Map<string, number>()
  rows(countRows).forEach((row) => {
    remarkCountsByRowId.set(text(row.source_row_id), num(row.remark_count))
  })

  const latestByRowId = new Map<string, RawRow>()
  rows(latestRows).forEach((row) => {
    latestByRowId.set(text(row.source_row_id), row)
  })

  const satisfactionKeysByRowId = new Set<string>()
  rows(satisfactionRows).forEach((row) => {
    satisfactionKeysByRowId.add(rowSatisfactionKey(
      text(row.source_row_id),
      row.requirement_code,
      row.status_snapshot,
    ))
  })

  return {
    remarkCountsByRowId: Array.from(remarkCountsByRowId.entries()),
    latestByRowId: Array.from(latestByRowId.entries()),
    satisfactionKeysByRowId: Array.from(satisfactionKeysByRowId),
  }
    },
    WARRANTY_CACHE_TTL_SECONDS,
  )

  return {
    remarkCountsByRowId: new Map(cached.remarkCountsByRowId),
    latestByRowId: new Map(cached.latestByRowId),
    satisfactionKeysByRowId: new Set(cached.satisfactionKeysByRowId),
  }
}

type WarrantyBaseCache = {
  rawRows: RawRow[]
  dealers: string[]
  statuses: string[]
  claimTypes: string[]
  dealerNames: Record<string, string>
}

function enrichRows(
  rawRows: RawRow[],
  mappings: Map<string, string>,
  actionSummaries: ActionSummaries,
  source: HyundaiWarrantySource,
): EnrichedRow[] {
  return rawRows.map((row) => {
    const rowId = String(row.id)
    const recordKey = warrantyRecordKey(source, row)
    const status = text(source === 'ytp' ? row.r_o_status : row.status)
    const businessDate = resolveWarrantyBusinessDate(source, row)
    const requirement = getWarrantyRequirement(source, status, businessDate)
    const latestAction = actionSummaries.latestByRowId.get(rowId)
    const matchingAction = requirement.required && requirement.code
      ? actionSummaries.satisfactionKeysByRowId.has(rowSatisfactionKey(rowId, requirement.code, status))
      : true
    const dealerCode = text(row.source_dealer_code).toUpperCase() || 'UNMAPPED'
    return {
      ...row,
      id: rowId,
      uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
      recordKey,
      dealerCode,
      dealerName: mappings.get(dealerCode) || dealerCode,
      status,
      statusBucket: statusBucket(status),
      businessDate,
      requirement,
      compliance: requirement.required
        ? (matchingAction ? 'complete' as const : 'action_required' as const)
        : 'not_required' as const,
      remarkCount: actionSummaries.remarkCountsByRowId.get(rowId) || 0,
      latestRemark: latestAction ? {
        remark: text(latestAction.remark),
        docketNumber: text(latestAction.docket_number) || null,
        createdByName: text(latestAction.created_by_name),
        createdByRole: text(latestAction.created_by_role),
        createdAt: String(latestAction.created_at),
      } : null,
    }
  })
}

function warrantyCacheKey(source: HyundaiWarrantySource) {
  return hyundaiWarrantyBaseCacheKey(source)
}

async function loadWarrantyBase(source: HyundaiWarrantySource): Promise<WarrantyBaseCache & { scoped: EnrichedRow[] }> {
  const cached = await getCachedData(
    warrantyCacheKey(source),
    async () => {
      const [rawRows, mappings] = await Promise.all([
        fetchSourceRows(source),
        fetchMappings(),
      ])

      const dealers = [...new Set(rawRows.map((row) => text(row.source_dealer_code).toUpperCase()).filter(Boolean))].sort()
      const statuses = [...new Set(rawRows.map((row) => text(source === 'ytp' ? row.r_o_status : row.status)).filter(Boolean))].sort()
      const claimTypes = [...new Set(rawRows.map((row) => text(row.claim_type)).filter(Boolean))].sort()
      const dealerNames = Object.fromEntries([...mappings.entries()])

      return { rawRows, dealers, statuses, claimTypes, dealerNames }
    },
    WARRANTY_CACHE_TTL_SECONDS,
  )

  const mappings = new Map(Object.entries(cached.dealerNames))
  const actionSummaries = await fetchActionSummaries(source)
  const scoped = enrichRows(cached.rawRows, mappings, actionSummaries, source)

  return { ...cached, scoped }
}

function statusBucket(status: string) {
  const normalized = status.trim().toUpperCase()
  if (normalized === 'ACCEPT') return 'Accept'
  if (normalized === 'DENIED') return 'Denied'
  if (normalized === 'PENDING') return 'Pending'
  if (normalized === 'RETURN') return 'Return'
  if (normalized === 'SUBMIT') return 'Submit'
  if (normalized === 'OPEN') return 'Open'
  if (normalized === 'SUSPENSE(L)') return 'Suspense(L)'
  if (normalized === 'SUSPENSE(P)') return 'Suspense(P)'
  if (['CANCEL', 'CANCELLED', 'CANCELED'].includes(normalized)) return 'Cancelled'
  return status || 'Unspecified'
}

function monthLabel(monthNumber: number) {
  return new Date(2026, monthNumber - 1, 1).toLocaleString('en-IN', { month: 'long' })
}

function indexRowsByDealer(rows: EnrichedRow[]) {
  const byDealer = new Map<string, EnrichedRow[]>()
  for (const row of rows) {
    const list = byDealer.get(row.dealerCode)
    if (list) list.push(row)
    else byDealer.set(row.dealerCode, [row])
  }
  return byDealer
}

function sumStatusAmounts(rows: EnrichedRow[], relevantStatuses: string[]) {
  const totals = Object.fromEntries(relevantStatuses.map((bucket) => [bucket, 0]))
  let total = 0
  for (const row of rows) {
    const amount = num(row.total_amt)
    total += amount
    if (totals[row.statusBucket] != null) totals[row.statusBucket] += amount
  }
  return { amounts: totals, total }
}

function sumStatusCounts(rows: EnrichedRow[], relevantStatuses: string[]) {
  const totals = Object.fromEntries(relevantStatuses.map((bucket) => [bucket, 0]))
  let total = 0
  for (const row of rows) {
    total += 1
    if (totals[row.statusBucket] != null) totals[row.statusBucket] += 1
  }
  return { counts: totals, countTotal: total }
}

function sumCountMaps(rows: Array<Record<string, number>>, statuses: string[]) {
  return Object.fromEntries(statuses.map((bucket) => [
    bucket,
    rows.reduce((sum, row) => sum + num(row[bucket]), 0),
  ]))
}

function buildMatrixDealerRow(
  code: string,
  dealerRows: EnrichedRow[] | undefined,
  relevantStatuses: string[],
  mappings: Map<string, string>,
) {
  if (!dealerRows?.length) return null

  const { amounts, total } = sumStatusAmounts(dealerRows, relevantStatuses)
  const { counts, countTotal } = sumStatusCounts(dealerRows, relevantStatuses)
  const rowsByMonth = Array.from({ length: 12 }, () => [] as EnrichedRow[])
  for (const row of dealerRows) {
    const monthNumber = Number(row.businessDate?.slice(5, 7))
    if (monthNumber >= 1 && monthNumber <= 12) rowsByMonth[monthNumber - 1].push(row)
  }

  return {
    dealerCode: code,
    dealerName: mappings.get(code) || code,
    amounts,
    counts,
    total,
    countTotal,
    monthly: rowsByMonth.map((monthRows, index) => {
      const monthNumber = index + 1
      const monthTotals = sumStatusAmounts(monthRows, relevantStatuses)
      const monthCounts = sumStatusCounts(monthRows, relevantStatuses)
      return {
        month: monthLabel(monthNumber),
        monthNumber,
        amounts: monthTotals.amounts,
        counts: monthCounts.counts,
        total: monthTotals.total,
        countTotal: monthCounts.countTotal,
      }
    }),
  }
}

function sumAmountMaps(rows: Array<Record<string, number>>, statuses: string[]) {
  return Object.fromEntries(statuses.map((bucket) => [
    bucket,
    rows.reduce((sum, row) => sum + num(row[bucket]), 0),
  ]))
}

function buildClaimListCharts(
  baseFiltered: EnrichedRow[],
  dealers: string[],
  statuses: string[],
  claimTypes: string[],
  dealerNames: Record<string, string>,
  currentYear: string,
  currentIstDate: string,
) {
  const statusAgg = new Map<string, { count: number; amount: number }>()
  const dealerAmounts = new Map<string, number>()
  const claimTypeCounts = new Map<string, number>()
  const aging = { '0-2D': 0, '3-7D': 0, '8-15D': 0, '>15D': 0 }
  const monthlyAgg = new Map<string, { count: number; amount: number }>()

  for (const row of baseFiltered) {
    const amount = num(row.total_amt)
    const statusEntry = statusAgg.get(row.status) || { count: 0, amount: 0 }
    statusEntry.count += 1
    statusEntry.amount += amount
    statusAgg.set(row.status, statusEntry)

    dealerAmounts.set(row.dealerCode, (dealerAmounts.get(row.dealerCode) || 0) + amount)

    const claimTypeName = text(row.claim_type)
    if (claimTypeName) {
      claimTypeCounts.set(claimTypeName, (claimTypeCounts.get(claimTypeName) || 0) + 1)
    }

    const ageDays = row.requirement.ageDays
    if (ageDays <= 2) aging['0-2D'] += 1
    else if (ageDays <= 7) aging['3-7D'] += 1
    else if (ageDays <= 15) aging['8-15D'] += 1
    else aging['>15D'] += 1

    const monthKey = row.businessDate?.slice(0, 7)
    if (monthKey) {
      const monthEntry = monthlyAgg.get(monthKey) || { count: 0, amount: 0 }
      monthEntry.count += 1
      monthEntry.amount += amount
      monthlyAgg.set(monthKey, monthEntry)
    }
  }

  return {
    status: statuses.map((name) => ({
      name,
      count: statusAgg.get(name)?.count || 0,
      amount: statusAgg.get(name)?.amount || 0,
    })),
    dealers: dealers.map((code) => ({
      code,
      name: dealerNames[code] || code,
      amount: dealerAmounts.get(code) || 0,
    })),
    claimTypes: claimTypes.map((name) => ({
      name,
      count: claimTypeCounts.get(name) || 0,
    })),
    aging: [
      { name: '0-2D', count: aging['0-2D'] },
      { name: '3-7D', count: aging['3-7D'] },
      { name: '8-15D', count: aging['8-15D'] },
      { name: '>15D', count: aging['>15D'] },
    ],
    monthly: Array.from({ length: Number(currentIstDate.slice(5, 7)) }, (_, index) => {
      const month = String(index + 1).padStart(2, '0')
      const monthKey = `${currentYear}-${month}`
      const monthEntry = monthlyAgg.get(monthKey)
      return {
        month: new Date(Number(currentYear), index, 1).toLocaleString('en-IN', { month: 'short' }),
        monthNumber: index + 1,
        count: monthEntry?.count || 0,
        amount: monthEntry?.amount || 0,
      }
    }),
  }
}

function buildYtpMonthlySummary(baseFiltered: EnrichedRow[], ytpSummaryDealers: string[]) {
  const dealerMonthCounts = new Map<string, Map<number, number>>()
  const dealerTotals = new Map<string, number>()
  const monthTotals = new Map<number, number>()

  for (const row of baseFiltered) {
    const monthNumber = Number(row.businessDate?.slice(5, 7))
    if (!monthNumber) continue

    dealerTotals.set(row.dealerCode, (dealerTotals.get(row.dealerCode) || 0) + 1)
    monthTotals.set(monthNumber, (monthTotals.get(monthNumber) || 0) + 1)

    const dealerMonths = dealerMonthCounts.get(row.dealerCode) || new Map<number, number>()
    dealerMonths.set(monthNumber, (dealerMonths.get(monthNumber) || 0) + 1)
    dealerMonthCounts.set(row.dealerCode, dealerMonths)
  }

  return {
    dealers: ytpSummaryDealers,
    rows: Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1
      return {
        month: monthLabel(monthNumber),
        monthNumber,
        counts: Object.fromEntries(ytpSummaryDealers.map((code) => [
          code,
          dealerMonthCounts.get(code)?.get(monthNumber) || 0,
        ])),
        total: monthTotals.get(monthNumber) || 0,
      }
    }),
    dealerTotals: Object.fromEntries(ytpSummaryDealers.map((code) => [
      code,
      dealerTotals.get(code) || 0,
    ])),
    grandTotal: baseFiltered.length,
  }
}

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const source = sourceFrom(searchParams.get('source'))
  const isBrandUser = canAccessBrand(appUser, 'hyundai')
  if (!isBrandUser) {
    const viewPermission = await requirePermission(appUser, permissionKey(source, 'view'))
    if (!viewPermission.allowed) return NextResponse.json({ error: viewPermission.reason }, { status: 403 })
  }

  const [baseData, editPermission, auditPermission] = await Promise.all([
    loadWarrantyBase(source),
    isBrandUser ? Promise.resolve({ allowed: true }) : requirePermission(appUser, permissionKey(source, 'edit')),
    isBrandUser ? Promise.resolve({ allowed: true }) : requirePermission(appUser, permissionKey(source, 'audit')),
  ])

  const { scoped, dealers, statuses, claimTypes, dealerNames } = baseData
  const mappings = new Map(Object.entries(dealerNames))

  const search = text(searchParams.get('search')).toLowerCase()
  const locationSet = parseCsvParam(searchParams.get('locations'), null)
  const locationDealerCodes = locationSet.length ? dealerCodesForLocationKeys(locationSet) : null
  const dealerSet = parseCsvParam(searchParams.get('dealers'), searchParams.get('dealer'))
  const statusSet = parseCsvParam(searchParams.get('statuses'), searchParams.get('status'))
  const requestedStatusBucket = text(searchParams.get('statusBucket'))
  const claimType = text(searchParams.get('claimType')).toUpperCase()
  const sla = text(searchParams.get('sla'))
  const startDate = text(searchParams.get('startDate'))
  const endDate = text(searchParams.get('endDate'))
  const matchesFilters = (row: EnrichedRow, includeDateRange: boolean) => {
    const haystack = [
      row.recordKey, row.dealerCode, row.dealerName, row.status, row.claim_type,
      row.r_o_no, row.vin, row.claim_no, row.campaign_no, row.part_desc,
    ].map(text).join(' ').toLowerCase()
    if (search && !haystack.includes(search)) return false
    if (locationDealerCodes?.size && !locationDealerCodes.has(row.dealerCode)) return false
    if (dealerSet.length && !dealerSet.includes(row.dealerCode)) return false
    if (statusSet.length && !statusSet.includes(row.status.toUpperCase())) return false
    if (claimType && text(row.claim_type).toUpperCase() !== claimType) return false
    if (sla === 'complete') return false
    if (sla === 'action_required' && row.compliance !== 'action_required') return false
    if (sla === 'within_sla' && row.requirement.required) return false
    if (includeDateRange && startDate && (!row.businessDate || row.businessDate < startDate)) return false
    if (includeDateRange && endDate && (!row.businessDate || row.businessDate > endDate)) return false
    return true
  }
  const baseFiltered = scoped.filter((row) => matchesFilters(row, true))
  const filtered = requestedStatusBucket
    ? baseFiltered.filter((row) => row.statusBucket.toUpperCase() === requestedStatusBucket.toUpperCase())
    : baseFiltered

  const sort = text(searchParams.get('sort')) || 'date_desc'
  filtered.sort((a, b) => {
    // Primary: SLA‑expired rows first
    const slaA = a.compliance === 'action_required' ? 0 : 1
    const slaB = b.compliance === 'action_required' ? 0 : 1
    if (slaA !== slaB) return slaA - slaB

    // If sorting by date_asc, respect it
    if (sort === 'date_asc') return text(a.businessDate).localeCompare(text(b.businessDate))
    // If sorting by amount_desc, respect it
    if (sort === 'amount_desc') return num(b.total_amt) - num(a.total_amt)

    // Otherwise, default to severity sorting: ageDays descending (most overdue first)
    const ageDiff = b.requirement.ageDays - a.requirement.ageDays
    if (ageDiff !== 0) return ageDiff

    // Fallback to businessDate descending
    return text(b.businessDate).localeCompare(text(a.businessDate))
  })


  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25))
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  const summary = {
    total: filtered.length,
    totalClaimAmount: filtered.reduce((sum, row) => sum + num(row.total_amt), 0),
    approvedAmount: filtered.reduce((sum, row) => sum + num(row.approve_amount_by_hmi), 0),
    overdueActions: filtered.filter((row) => row.compliance === 'action_required').length,
    suspenseProofPending: filtered.filter((row) => row.requirement.code === 'suspense_docket' && row.compliance === 'action_required').length,
    unresolved: filtered.filter((row) => !['ACCEPT', 'DENIED', 'CANCEL', 'CANCELLED', 'CANCELED'].includes(row.status.toUpperCase())).length,
  }

  const currentIstDate = istDateKey()
  const currentYear = currentIstDate.slice(0, 4)
  const charts = source === 'claim_list'
    ? buildClaimListCharts(baseFiltered, dealers, statuses, claimTypes, dealerNames, currentYear, currentIstDate)
    : null

  const relevantStatuses = WARRANTY_STATUS_ORDER.filter((bucket) => baseFiltered.some((row) => row.statusBucket === bucket))
  const rowsByDealer = source === 'claim_list' ? indexRowsByDealer(baseFiltered) : null
  const matrix = source === 'claim_list' ? {
    statuses: relevantStatuses,
    groups: HYUNDAI_WARRANTY_DEALER_GROUPS.map((group) => {
      const dealersInGroup = group.dealerCodes
        .map((code) => buildMatrixDealerRow(code, rowsByDealer!.get(code), relevantStatuses, mappings))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))

      if (dealersInGroup.length === 0) return null

      const groupAmountRows = dealersInGroup.map((dealer) => dealer.amounts)
      const groupCountRows = dealersInGroup.map((dealer) => dealer.counts)
      return {
        key: group.key,
        label: group.label,
        dealerCodes: dealersInGroup.map((dealer) => dealer.dealerCode),
        amounts: sumAmountMaps(groupAmountRows, relevantStatuses),
        counts: sumCountMaps(groupCountRows, relevantStatuses),
        total: dealersInGroup.reduce((sum, dealer) => sum + dealer.total, 0),
        countTotal: dealersInGroup.reduce((sum, dealer) => sum + dealer.countTotal, 0),
        dealers: dealersInGroup,
      }
    }).filter((group): group is NonNullable<typeof group> => Boolean(group)),
  } : null

  const ytpSummaryDealers = [...new Set(baseFiltered.map((row) => row.dealerCode))].sort()
  const ytpMonthlySummary = source === 'ytp'
    ? buildYtpMonthlySummary(baseFiltered, ytpSummaryDealers)
    : null

  return NextResponse.json({
    source,
    generatedAt: new Date().toISOString(),
    permissions: { canEdit: editPermission.allowed, canAudit: auditPermission.allowed },
    summary,
    options: {
      dealers,
      dealerOptions: dealers.map((code) => {
        const mappedName = dealerNames[code]
        const location = getHyundaiWarrantyGroupForDealer(code)?.label || null
        return {
          code,
          name: mappedName && mappedName !== code ? mappedName : (location || code),
          location,
        }
      }),
      locationGroups: HYUNDAI_WARRANTY_DEALER_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        dealerCodes: [...group.dealerCodes],
      })),
      statuses,
      claimTypes,
    },
    charts,
    matrix,
    ytpMonthlySummary,
    rows: pageRows,
    pagination: {
      page,
      pageSize,
      totalRows: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    },
  })
}
