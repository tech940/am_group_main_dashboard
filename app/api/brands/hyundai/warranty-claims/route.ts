import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { requirePermission } from '@/lib/permissions/service'
import {
  actionSatisfiesRequirement,
  getWarrantyRequirement,
  istDateKey,
  resolveWarrantyBusinessDate,
  type HyundaiWarrantySource,
  warrantyRecordKey,
  WARRANTY_STATUS_ORDER,
} from '@/lib/hyundai/warranty-claims'
import {
  HYUNDAI_WARRANTY_DEALER_GROUPS,
  isAllowedHyundaiWarrantyDealer,
} from '@/lib/hyundai/warranty-dealers'

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

function resolveBreakdownYear(
  dealerRows: EnrichedRow[],
  startDate: string,
  endDate: string,
  fallbackYear: string,
) {
  if (startDate && endDate) {
    const startYear = startDate.slice(0, 4)
    const endYear = endDate.slice(0, 4)
    if (startYear === endYear) return startYear
  }

  const yearCounts = new Map<string, number>()
  for (const row of dealerRows) {
    const year = row.businessDate?.slice(0, 4)
    if (!year) continue
    yearCounts.set(year, (yearCounts.get(year) || 0) + 1)
  }
  if (yearCounts.size === 0) return fallbackYear
  return [...yearCounts.entries()].sort((left, right) => right[1] - left[1])[0][0]
}

async function fetchSourceRows(source: HyundaiWarrantySource) {
  if (source === 'ytp') {
    return rows(await db.execute(sql`
      SELECT id, row_hash, source_login_id, no, r_o_no, r_o_date, claim_type,
        r_o_status, vin, campaign_no, category, uploaded_at, source_dealer_code
      FROM hyundai_warranty_claim_ytp
    `))
  }
  return rows(await db.execute(sql`
    SELECT id, row_hash, source_login_id, s_no, vin, claim_no, acl_no, claim_date,
      claim_type, r_o_no, r_o_date, status, mileage, cause, nature, causal_part,
      main_op, part_desc, total_amt, labour, part, sublet, igst, cgst, sgst,
      approve_amount_by_hmi, invoice_no, part_type, pdctn_date, uploaded_at,
      source_dealer_code
    FROM hyundai_warranty_claim_list
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

async function fetchActions(source: HyundaiWarrantySource, recordKeys: string[]) {
  if (recordKeys.length === 0) return []
  return rows(await db.execute(sql`
    SELECT id, record_key, requirement_code, status_snapshot, remark, docket_number,
      created_by_name, created_by_role, created_at
    FROM hyundai_warranty_claim_actions
    WHERE source_type = ${source}
      AND record_key IN (${sql.join(recordKeys.map((key) => sql`${key}`), sql`, `)})
    ORDER BY created_at DESC
  `))
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

function buildMatrixDealerRow(
  code: string,
  baseFiltered: EnrichedRow[],
  relevantStatuses: string[],
  mappings: Map<string, string>,
  startDate: string,
  endDate: string,
  currentYear: string,
) {
  const dealerRows = baseFiltered.filter((row) => row.dealerCode === code)
  if (dealerRows.length === 0) return null

  const breakdownYear = resolveBreakdownYear(dealerRows, startDate, endDate, currentYear)
  const breakdownRows = dealerRows.filter((row) => row.businessDate?.slice(0, 4) === breakdownYear)
  return {
    dealerCode: code,
    dealerName: mappings.get(code) || code,
    breakdownYear,
    amounts: Object.fromEntries(relevantStatuses.map((bucket) => [
      bucket,
      dealerRows.filter((row) => row.statusBucket === bucket).reduce((sum, row) => sum + num(row.total_amt), 0),
    ])),
    total: dealerRows.reduce((sum, row) => sum + num(row.total_amt), 0),
    currentYearAmounts: Object.fromEntries(relevantStatuses.map((bucket) => [
      bucket,
      breakdownRows.filter((row) => row.statusBucket === bucket).reduce((sum, row) => sum + num(row.total_amt), 0),
    ])),
    currentYearTotal: breakdownRows.reduce((sum, row) => sum + num(row.total_amt), 0),
    monthly: Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1
      const monthKey = `${breakdownYear}-${String(monthNumber).padStart(2, '0')}`
      const monthRows = breakdownRows.filter((row) => row.businessDate?.slice(0, 7) === monthKey)
      return {
        month: monthLabel(monthNumber),
        monthNumber,
        amounts: Object.fromEntries(relevantStatuses.map((bucket) => [
          bucket,
          monthRows.filter((row) => row.statusBucket === bucket).reduce((sum, row) => sum + num(row.total_amt), 0),
        ])),
        total: monthRows.reduce((sum, row) => sum + num(row.total_amt), 0),
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

export async function GET(request: Request) {
  const appUser = await getAuthenticatedAppUser()
  if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const source = sourceFrom(searchParams.get('source'))
  const viewPermission = await requirePermission(appUser, permissionKey(source, 'view'))
  if (!viewPermission.allowed) return NextResponse.json({ error: viewPermission.reason }, { status: 403 })

  const [rawRows, mappings, editPermission, auditPermission] = await Promise.all([
    fetchSourceRows(source),
    fetchMappings(),
    requirePermission(appUser, permissionKey(source, 'edit')),
    requirePermission(appUser, permissionKey(source, 'audit')),
  ])
  const recordKeys = rawRows.map((row) => warrantyRecordKey(source, row))
  const allActions = await fetchActions(source, recordKeys)
  const actionsByKey = new Map<string, RawRow[]>()
  allActions.forEach((action) => {
    const key = text(action.record_key)
    actionsByKey.set(key, [...(actionsByKey.get(key) || []), action])
  })

  const enriched: EnrichedRow[] = rawRows.map((row) => {
    const recordKey = warrantyRecordKey(source, row)
    const status = text(source === 'ytp' ? row.r_o_status : row.status)
    const businessDate = resolveWarrantyBusinessDate(source, row)
    const requirement = getWarrantyRequirement(source, status, businessDate)
    const recordActions = actionsByKey.get(recordKey) || []
    const matchingAction = recordActions.find((action) => actionSatisfiesRequirement(requirement, status, {
      requirementCode: action.requirement_code,
      statusSnapshot: action.status_snapshot,
    }))
    const latestAction = recordActions[0]
    const dealerCode = text(row.source_dealer_code).toUpperCase() || 'UNMAPPED'
    return {
      ...row,
      id: String(row.id),
      uploaded_at: row.uploaded_at ? String(row.uploaded_at) : null,
      recordKey,
      dealerCode,
      dealerName: mappings.get(dealerCode) || dealerCode,
      status,
      statusBucket: statusBucket(status),
      businessDate,
      requirement,
      compliance: requirement.required ? (matchingAction ? 'complete' as const : 'action_required' as const) : 'not_required' as const,
      remarkCount: recordActions.length,
      latestRemark: latestAction ? {
        remark: text(latestAction.remark),
        docketNumber: text(latestAction.docket_number) || null,
        createdByName: text(latestAction.created_by_name),
        createdByRole: text(latestAction.created_by_role),
        createdAt: String(latestAction.created_at),
      } : null,
    }
  })

  const scoped = enriched.filter((row) => isAllowedHyundaiWarrantyDealer(row.dealerCode))

  const search = text(searchParams.get('search')).toLowerCase()
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
    if (dealerSet.length && !dealerSet.includes(row.dealerCode)) return false
    if (statusSet.length && !statusSet.includes(row.status.toUpperCase())) return false
    if (claimType && text(row.claim_type).toUpperCase() !== claimType) return false
    if (sla === 'action_required' && row.compliance !== 'action_required') return false
    if (sla === 'complete' && row.compliance !== 'complete') return false
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
    if (sort === 'date_asc') return text(a.businessDate).localeCompare(text(b.businessDate))
    if (sort === 'amount_desc') return num(b.total_amt) - num(a.total_amt)
    if (sort === 'age_desc') return b.requirement.ageDays - a.requirement.ageDays
    return text(b.businessDate).localeCompare(text(a.businessDate))
  })

  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 25))
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)
  const dealers = [...new Set(scoped.map((row) => row.dealerCode))].sort()
  const statuses = [...new Set(scoped.map((row) => row.status).filter(Boolean))].sort()
  const claimTypes = [...new Set(scoped.map((row) => text(row.claim_type)).filter(Boolean))].sort()

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
  const charts = source === 'claim_list' ? {
    status: statuses.map((name) => ({
      name,
      count: baseFiltered.filter((row) => row.status === name).length,
      amount: baseFiltered.filter((row) => row.status === name).reduce((sum, row) => sum + num(row.total_amt), 0),
    })),
    dealers: dealers.map((code) => ({
      code,
      name: mappings.get(code) || code,
      amount: baseFiltered.filter((row) => row.dealerCode === code).reduce((sum, row) => sum + num(row.total_amt), 0),
    })),
    claimTypes: claimTypes.map((name) => ({
      name,
      count: baseFiltered.filter((row) => text(row.claim_type) === name).length,
    })),
    aging: [
      { name: '0-2D', count: baseFiltered.filter((row) => row.requirement.ageDays <= 2).length },
      { name: '3-7D', count: baseFiltered.filter((row) => row.requirement.ageDays >= 3 && row.requirement.ageDays <= 7).length },
      { name: '8-15D', count: baseFiltered.filter((row) => row.requirement.ageDays >= 8 && row.requirement.ageDays <= 15).length },
      { name: '>15D', count: baseFiltered.filter((row) => row.requirement.ageDays > 15).length },
    ],
    monthly: Array.from({ length: Number(currentIstDate.slice(5, 7)) }, (_, index) => {
      const month = String(index + 1).padStart(2, '0')
      const monthRows = baseFiltered.filter((row) => row.businessDate?.slice(0, 7) === `${currentYear}-${month}`)
      return {
        month: new Date(Number(currentYear), index, 1).toLocaleString('en-IN', { month: 'short' }),
        monthNumber: index + 1,
        count: monthRows.length,
        amount: monthRows.reduce((sum, row) => sum + num(row.total_amt), 0),
      }
    }),
  } : null

  const relevantStatuses = WARRANTY_STATUS_ORDER.filter((bucket) => baseFiltered.some((row) => row.statusBucket === bucket))
  const matrix = source === 'claim_list' ? {
    breakdownYear: currentYear,
    statuses: relevantStatuses,
    groups: HYUNDAI_WARRANTY_DEALER_GROUPS.map((group) => {
      const dealersInGroup = group.dealerCodes
        .map((code) => buildMatrixDealerRow(code, baseFiltered, relevantStatuses, mappings, startDate, endDate, currentYear))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))

      if (dealersInGroup.length === 0) return null

      const groupAmountRows = dealersInGroup.map((dealer) => dealer.amounts)
      return {
        key: group.key,
        label: group.label,
        dealerCodes: dealersInGroup.map((dealer) => dealer.dealerCode),
        amounts: sumAmountMaps(groupAmountRows, relevantStatuses),
        total: dealersInGroup.reduce((sum, dealer) => sum + dealer.total, 0),
        dealers: dealersInGroup,
      }
    }).filter((group): group is NonNullable<typeof group> => Boolean(group)),
  } : null

  const ytpSummaryDealers = [...new Set(baseFiltered.map((row) => row.dealerCode))].sort()
  const ytpMonthlySummary = source === 'ytp' ? {
    dealers: ytpSummaryDealers,
    rows: Array.from({ length: 12 }, (_, index) => {
      const monthNumber = index + 1
      const monthRows = baseFiltered.filter((row) => Number(row.businessDate?.slice(5, 7)) === monthNumber)
      return {
        month: monthLabel(monthNumber),
        monthNumber,
        counts: Object.fromEntries(ytpSummaryDealers.map((code) => [
          code,
          monthRows.filter((row) => row.dealerCode === code).length,
        ])),
        total: monthRows.length,
      }
    }),
    dealerTotals: Object.fromEntries(ytpSummaryDealers.map((code) => [
      code,
      baseFiltered.filter((row) => row.dealerCode === code).length,
    ])),
    grandTotal: baseFiltered.length,
  } : null

  return NextResponse.json({
    source,
    generatedAt: new Date().toISOString(),
    permissions: { canEdit: editPermission.allowed, canAudit: auditPermission.allowed },
    summary,
    options: { dealers, statuses, claimTypes },
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
