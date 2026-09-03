import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { canAccessAmFinance, getAmFinancePermissions } from '@/lib/am-finance/access'
import { canViewAmFinance } from '@/lib/am-finance/access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { db } from '@/lib/db'
import { financeSheet } from '@/lib/db/schema'
import { getCachedData } from '@/lib/redis/cache-utils'

export const dynamic = 'force-dynamic'

type FilterKey =
  | 'mainDealer'
  | 'location'
  | 'tl'
  | 'salesExecutive'
  | 'hyp'
  | 'branch'
  | 'payoutStatus'
  | 'status'
  | 'bankLogin'
  | 'bankInProforma'
  | 'bankerRemarks'
  | 'reasonIfOuthouse'

type SectionKey =
  | 'overview'
  | 'payout-status'
  | 'hyp-bank-analysis'
  | 'team-performance'
  | 'monthly-matrix'
  | 'operations-compliance'
  | 'proforma-details'
  | 'all'

type FinanceMetricRow = {
  label: string
  totalCase: number
  contribution: number
  loanAmount: number
  avgTicketSize: number
  avgPayout: number
  inhouseCount: number
  inHousePercent: number
  dsePayoutStatus: number
  dealerPayoutStatus: number
  payoutAmount: number
  amountReceived: number
  bankIntRate: number | null
}

type MonthHypMetricRow = FinanceMetricRow & {
  month: string
  hyp: string
  status: string
}

type OperationsDealerRow = {
  label: string
  totalCase: number
  contribution: number
  bankScheduleVisit: number
  visited: number
  vehicleRegistrationCount: number
  hypAsPerRcCount: number
  hypMismatchCount: number
}

type RankingRow = {
  label: string
  totalCase: number
  contribution: number
}

type ProformaPivot = {
  title: string
  dealer: string
  months: Array<{ key: string; label: string }>
  rows: Array<{
    bank: string
    values: Record<string, number>
    grandTotal: number
  }>
  grandTotalRow: {
    bank: string
    values: Record<string, number>
    grandTotal: number
  }
  locationRows: FinanceMetricRow[]
}

type AnalyticsSummary = {
  totalCases: number
  totalLoanAmount: number
  totalPayoutAmount: number
  totalAmountReceived: number
  pendingAmount: number
  receivedCases: number
  pendingCases: number
  noPayoutCases: number
  avgTicketSize: number
  inhouseCount: number
  inHousePercent: number
}

type SbiPendingSummary = {
  totalCase: number
  loanAmount: number
  payoutAmount: number
  amountReceived: number
  pendingAmount: number
  targetPercent: number
  filteredTotalCases: number
  targetCases: number
  actualSbiCases: number
  pendingCases: number
  targetMet: boolean
}

type AnalyticsPayload = {
  section: SectionKey
  summary: AnalyticsSummary
  data: Record<string, unknown>
  filterOptions: Record<FilterOptionKey, string[]>
  coverage: {
    minDeliveryDate: string | null
    maxDeliveryDate: string | null
    latestUploadedAt: string | null
    rowCount: number
  }
  sbiPendingTarget: number
  sbiPendingSummary: SbiPendingSummary
  permissions: ReturnType<typeof getAmFinancePermissions>
  source: {
    table: string
    analyticsSource: string
    mode: string
  }
}

type FilterOptionKey =
  | 'mainDealers'
  | 'locations'
  | 'tls'
  | 'salesExecutives'
  | 'hyps'
  | 'branches'
  | 'payoutStatuses'
  | 'statuses'
  | 'bankLogins'
  | 'bankInProformas'

type LabelSql = SQL<unknown> | AnyColumn
type AmFinanceRole = Parameters<typeof getAmFinancePermissions>[0]
type MetricGroupConfig = {
  key: string
  labelExpr: SQL<string>
  limit?: number
}

const ANALYTICS_CACHE_PREFIX = 'am-finance:analytics:v3'
const FILTER_CACHE_KEY = 'am-finance:filters:v2'
const ANALYTICS_CACHE_TTL_SECONDS = 60
const FILTER_CACHE_TTL_SECONDS = 300
const SBI_TARGET_PERCENT = 25
const KNOWN_PAYOUT_GROUPS = ['IN HOUSE', 'OUT HOUSE', 'CASH', 'STAFF']
const KNOWN_PAYMENT_GROUPS = ['PENDING', 'NO PAYOUT', 'Received']
const CACHE_PARAM_KEYS = [
  'startDate',
  'endDate',
  'mainDealer',
  'location',
  'tl',
  'salesExecutive',
  'hyp',
  'branch',
  'payoutStatus',
  'status',
  'bankLogin',
  'bankInProforma',
  'bankerRemarks',
  'reasonIfOuthouse',
  'search',
] as const

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function getFilterValue(searchParams: URLSearchParams, key: FilterKey) {
  const value = (searchParams.get(key) || '').trim()
  return value && value !== 'all' ? value : null
}

function buildFinanceSearchCondition(search: string) {
  const pattern = `%${search.toLowerCase()}%`
  return sql`lower(
    coalesce(${financeSheet.customerName}, '') || ' ' ||
    coalesce(${financeSheet.mobileNo}, '') || ' ' ||
    coalesce(${financeSheet.model}, '') || ' ' ||
    coalesce(${financeSheet.invoiceNumber}, '') || ' ' ||
    coalesce(${financeSheet.vehicleRegistrationNumberToSale}, '') || ' ' ||
    coalesce(${financeSheet.hyp}, '') || ' ' ||
    coalesce(${financeSheet.branch}, '') || ' ' ||
    coalesce(${financeSheet.salesExecutive}, '') || ' ' ||
    coalesce(${financeSheet.tl}, '') || ' ' ||
    coalesce(${financeSheet.mainDealer}, '') || ' ' ||
    coalesce(${financeSheet.location}, '') || ' ' ||
    coalesce(${financeSheet.bankLogin}, '') || ' ' ||
    coalesce(${financeSheet.bankInProforma}, '')
  ) like ${pattern}`
}

function buildFilters(searchParams: URLSearchParams) {
  const filters: SQL[] = []
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (isIsoDate(startDate)) filters.push(gte(financeSheet.deliveryDate, startDate!))
  if (isIsoDate(endDate)) filters.push(lte(financeSheet.deliveryDate, endDate!))

  const mainDealer = getFilterValue(searchParams, 'mainDealer')
  const location = getFilterValue(searchParams, 'location')
  const tl = getFilterValue(searchParams, 'tl')
  const salesExecutive = getFilterValue(searchParams, 'salesExecutive')
  const hyp = getFilterValue(searchParams, 'hyp')
  const branch = getFilterValue(searchParams, 'branch')
  const payoutStatus = getFilterValue(searchParams, 'payoutStatus')
  const status = getFilterValue(searchParams, 'status')
  const bankLogin = getFilterValue(searchParams, 'bankLogin')
  const bankInProforma = getFilterValue(searchParams, 'bankInProforma')
  const bankerRemarks = getFilterValue(searchParams, 'bankerRemarks')
  const reasonIfOuthouse = getFilterValue(searchParams, 'reasonIfOuthouse')

  if (mainDealer) filters.push(eq(financeSheet.mainDealer, mainDealer))
  if (location) filters.push(eq(financeSheet.location, location))
  if (tl) filters.push(eq(financeSheet.tl, tl))
  if (salesExecutive) filters.push(eq(financeSheet.salesExecutive, salesExecutive))
  if (hyp) filters.push(eq(financeSheet.hyp, hyp))
  if (branch) filters.push(eq(financeSheet.branch, branch))
  if (payoutStatus) filters.push(eq(financeSheet.payoutStatus, payoutStatus))
  if (status) {
    const normalizedStatus = status.trim().toUpperCase()
    if (normalizedStatus === 'RECEIVED') {
      filters.push(sql`upper(btrim(coalesce(${financeSheet.status}, ''))) in ('RECEIVED', 'RECEVIED')`)
    } else if (normalizedStatus === 'PENDING' || normalizedStatus === 'NO PAYOUT') {
      filters.push(sql`upper(btrim(coalesce(${financeSheet.status}, ''))) = ${normalizedStatus}`)
    } else {
      filters.push(eq(financeSheet.status, status))
    }
  }
  if (bankLogin) filters.push(eq(financeSheet.bankLogin, bankLogin))
  if (bankInProforma) filters.push(eq(financeSheet.bankInProforma, bankInProforma))
  if (bankerRemarks) filters.push(eq(financeSheet.bankerRemarks, bankerRemarks))
  if (reasonIfOuthouse) filters.push(eq(financeSheet.reasonIfOuthouse, reasonIfOuthouse))

  const search = (searchParams.get('search') || '').trim()
  if (search) {
    filters.push(buildFinanceSearchCondition(search))
  }

  return filters.length > 0 ? and(...filters) : undefined
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return 0
  const amount = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(amount) ? amount : 0
}

function cleanOptionArray(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function contribution(cases: number, total: number) {
  return total > 0 ? (cases / total) * 100 : 0
}

function cleanLabelExpr(value: LabelSql) {
  return sql<string>`coalesce(nullif(btrim(${value}), ''), 'Unspecified')`
}

function payoutStatusExpr() {
  return sql<string>`case
    when upper(btrim(coalesce(${financeSheet.payoutStatus}, ''))) in ('IN HOUSE', 'OUT HOUSE', 'CASH', 'STAFF')
      then upper(btrim(coalesce(${financeSheet.payoutStatus}, '')))
    when btrim(coalesce(${financeSheet.payoutStatus}, '')) = ''
      then 'Unspecified'
    else btrim(${financeSheet.payoutStatus})
  end`
}

function paymentStatusExpr() {
  return sql<string>`case
    when upper(btrim(coalesce(${financeSheet.status}, ''))) in ('RECEIVED', 'RECEVIED')
      then 'Received'
    when upper(btrim(coalesce(${financeSheet.status}, ''))) = 'NO PAYOUT'
      then 'NO PAYOUT'
    when upper(btrim(coalesce(${financeSheet.status}, ''))) = 'PENDING'
      then 'PENDING'
    when btrim(coalesce(${financeSheet.status}, '')) = ''
      then 'Unspecified'
    else btrim(${financeSheet.status})
  end`
}

function payoutMultiplierExpr() {
  const raw = sql`btrim(coalesce(${financeSheet.dealerPayoutPercent}, ''))`
  const stripped = sql`regexp_replace(${raw}, '[,%]', '', 'g')`
  return sql<number | null>`case
    when ${stripped} ~ '^[0-9]+(\\.[0-9]+)?$'
      then case when position('%' in ${raw}) > 0 then (${stripped})::numeric / 100 else (${stripped})::numeric end
    else null
  end`
}

function numericAmountExpr(value: LabelSql) {
  const raw = sql`regexp_replace(btrim(coalesce(${value}::text, '')), '[^0-9.-]', '', 'g')`
  return sql<number>`case
    when ${raw} ~ '^-?[0-9]+(\\.[0-9]+)?$' then (${raw})::numeric
    else 0
  end`
}

function monthLabelExpr() {
  return sql<string>`coalesce(to_char(${financeSheet.deliveryDate}, 'Mon YYYY'), 'Unspecified')`
}

function monthKeyExpr() {
  return sql<string>`coalesce(to_char(date_trunc('month', ${financeSheet.deliveryDate}), 'YYYY-MM'), 'unknown')`
}

function emptyMetricRow(label: string): FinanceMetricRow {
  return {
    label,
    totalCase: 0,
    contribution: 0,
    loanAmount: 0,
    avgTicketSize: 0,
    avgPayout: 0,
    inhouseCount: 0,
    inHousePercent: 0,
    dsePayoutStatus: 0,
    dealerPayoutStatus: 0,
    payoutAmount: 0,
    amountReceived: 0,
    bankIntRate: null,
  }
}

function serializeMetricRow(row: {
  label: string | null
  totalCase: number
  loanAmount: unknown
  avgPayout: unknown
  inhouseCount: number
  dsePayoutStatus: unknown
  dealerPayoutStatus: unknown
  payoutAmount: unknown
  amountReceived: unknown
  bankIntRate: unknown
}, totalCases: number): FinanceMetricRow {
  const totalCase = Number(row.totalCase || 0)
  const loanAmount = toNumber(row.loanAmount)
  const inhouseCount = Number(row.inhouseCount || 0)

  return {
    label: String(row.label || 'Unspecified'),
    totalCase,
    contribution: contribution(totalCase, totalCases),
    loanAmount,
    avgTicketSize: totalCase > 0 ? loanAmount / totalCase : 0,
    avgPayout: toNumber(row.avgPayout),
    inhouseCount,
    inHousePercent: totalCase > 0 ? (inhouseCount / totalCase) * 100 : 0,
    dsePayoutStatus: toNumber(row.dsePayoutStatus),
    dealerPayoutStatus: toNumber(row.dealerPayoutStatus),
    payoutAmount: toNumber(row.payoutAmount),
    amountReceived: toNumber(row.amountReceived),
    bankIntRate: row.bankIntRate === null || row.bankIntRate === undefined ? null : toNumber(row.bankIntRate),
  }
}

function ensureKnownRows(rows: FinanceMetricRow[], knownLabels: string[]) {
  const existing = new Set(rows.map((row) => row.label))
  return [
    ...rows,
    ...knownLabels
      .filter((label) => !existing.has(label))
      .map((label) => emptyMetricRow(label)),
  ]
}

async function loadFilterOptions() {
  const [coverage] = await db.select({
    mainDealers: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.mainDealer} order by ${financeSheet.mainDealer}) filter (where ${financeSheet.mainDealer} is not null and btrim(${financeSheet.mainDealer}) <> ''), array[]::text[])`,
    locations: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.location} order by ${financeSheet.location}) filter (where ${financeSheet.location} is not null and btrim(${financeSheet.location}) <> ''), array[]::text[])`,
    tls: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.tl} order by ${financeSheet.tl}) filter (where ${financeSheet.tl} is not null and btrim(${financeSheet.tl}) <> ''), array[]::text[])`,
    salesExecutives: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.salesExecutive} order by ${financeSheet.salesExecutive}) filter (where ${financeSheet.salesExecutive} is not null and btrim(${financeSheet.salesExecutive}) <> ''), array[]::text[])`,
    hyps: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.hyp} order by ${financeSheet.hyp}) filter (where ${financeSheet.hyp} is not null and btrim(${financeSheet.hyp}) <> ''), array[]::text[])`,
    branches: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.branch} order by ${financeSheet.branch}) filter (where ${financeSheet.branch} is not null and btrim(${financeSheet.branch}) <> ''), array[]::text[])`,
    payoutStatuses: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.payoutStatus} order by ${financeSheet.payoutStatus}) filter (where ${financeSheet.payoutStatus} is not null and btrim(${financeSheet.payoutStatus}) <> ''), array[]::text[])`,
    statuses: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.status} order by ${financeSheet.status}) filter (where ${financeSheet.status} is not null and btrim(${financeSheet.status}) <> ''), array[]::text[])`,
    bankLogins: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.bankLogin} order by ${financeSheet.bankLogin}) filter (where ${financeSheet.bankLogin} is not null and btrim(${financeSheet.bankLogin}) <> ''), array[]::text[])`,
    bankInProformas: sql<string[]>`coalesce(array_agg(distinct ${financeSheet.bankInProforma} order by ${financeSheet.bankInProforma}) filter (where ${financeSheet.bankInProforma} is not null and btrim(${financeSheet.bankInProforma}) <> ''), array[]::text[])`,
    minDeliveryDate: sql<string | null>`min(${financeSheet.deliveryDate})::text`,
    maxDeliveryDate: sql<string | null>`max(${financeSheet.deliveryDate})::text`,
    latestUploadedAt: sql<string | null>`max(${financeSheet.uploadedAt})::text`,
    rowCount: sql<number>`count(*)::int`,
  }).from(financeSheet)

  return {
    filters: {
      mainDealers: cleanOptionArray(coverage?.mainDealers),
      locations: cleanOptionArray(coverage?.locations),
      tls: cleanOptionArray(coverage?.tls),
      salesExecutives: cleanOptionArray(coverage?.salesExecutives),
      hyps: cleanOptionArray(coverage?.hyps),
      branches: cleanOptionArray(coverage?.branches),
      payoutStatuses: cleanOptionArray(coverage?.payoutStatuses),
      statuses: cleanOptionArray(coverage?.statuses),
      bankLogins: cleanOptionArray(coverage?.bankLogins),
      bankInProformas: cleanOptionArray(coverage?.bankInProformas),
    },
    coverage: {
      minDeliveryDate: coverage?.minDeliveryDate || null,
      maxDeliveryDate: coverage?.maxDeliveryDate || null,
      latestUploadedAt: coverage?.latestUploadedAt || null,
      rowCount: Number(coverage?.rowCount || 0),
    },
  }
}

async function loadCachedFilterOptions() {
  return getCachedData(FILTER_CACHE_KEY, loadFilterOptions, FILTER_CACHE_TTL_SECONDS)
}

async function loadSummary(whereExpression: SQL | undefined): Promise<AnalyticsSummary> {
  const payoutStatus = payoutStatusExpr()
  const [summary] = await db.select({
    totalCases: sql<number>`count(*)::int`,
    totalLoanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    totalPayoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    totalAmountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    pendingAmount: sql<string>`coalesce(sum(greatest(coalesce(${financeSheet.payoutAmount}, 0) - coalesce(${financeSheet.amountReceived}, 0), 0)), 0)::text`,
    receivedCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) in ('RECEIVED', 'RECEVIED'))::int`,
    pendingCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) = 'PENDING')::int`,
    noPayoutCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) = 'NO PAYOUT')::int`,
    inhouseCount: sql<number>`count(*) filter (where ${payoutStatus} = 'IN HOUSE')::int`,
  }).from(financeSheet).where(whereExpression)

  const totalCases = Number(summary?.totalCases || 0)
  const totalLoanAmount = toNumber(summary?.totalLoanAmount)
  const inhouseCount = Number(summary?.inhouseCount || 0)

  return {
    totalCases,
    totalLoanAmount,
    totalPayoutAmount: toNumber(summary?.totalPayoutAmount),
    totalAmountReceived: toNumber(summary?.totalAmountReceived),
    pendingAmount: toNumber(summary?.pendingAmount),
    receivedCases: Number(summary?.receivedCases || 0),
    pendingCases: Number(summary?.pendingCases || 0),
    noPayoutCases: Number(summary?.noPayoutCases || 0),
    avgTicketSize: totalCases > 0 ? totalLoanAmount / totalCases : 0,
    inhouseCount,
    inHousePercent: totalCases > 0 ? (inhouseCount / totalCases) * 100 : 0,
  }
}

async function loadSbiPendingSummary(whereExpression: SQL | undefined, filteredTotalCases: number): Promise<SbiPendingSummary> {
  const sbiWhere = and(
    ...(whereExpression ? [whereExpression] : []),
    sql`upper(btrim(coalesce(${financeSheet.hyp}, ''))) = 'SBI'`
  )

  const [summary] = await db.select({
    totalCase: sql<number>`count(*)::int`,
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    pendingAmount: sql<string>`coalesce(sum(greatest(coalesce(${financeSheet.payoutAmount}, 0) - coalesce(${financeSheet.amountReceived}, 0), 0)), 0)::text`,
  }).from(financeSheet).where(sbiWhere)

  const actualSbiCases = Number(summary?.totalCase || 0)
  const targetCases = filteredTotalCases * (SBI_TARGET_PERCENT / 100)
  const pendingCases = Math.max(targetCases - actualSbiCases, 0)

  return {
    totalCase: pendingCases,
    loanAmount: toNumber(summary?.loanAmount),
    payoutAmount: toNumber(summary?.payoutAmount),
    amountReceived: toNumber(summary?.amountReceived),
    pendingAmount: toNumber(summary?.pendingAmount),
    targetPercent: SBI_TARGET_PERCENT,
    filteredTotalCases,
    targetCases,
    actualSbiCases,
    pendingCases,
    targetMet: pendingCases === 0,
  }
}

async function loadMetricRows(labelExpr: SQL<string>, whereExpression: SQL | undefined, totalCases: number, limit?: number) {
  const payoutStatus = payoutStatusExpr()
  const payoutMultiplier = payoutMultiplierExpr()
  const dsePayoutStatus = numericAmountExpr(financeSheet.dsePayoutStatus)
  const dealerPayoutStatus = numericAmountExpr(financeSheet.dealerPayoutStatus)
  const query = db.select({
    label: labelExpr,
    totalCase: sql<number>`count(*)::int`,
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    avgPayout: sql<string>`coalesce(avg(${payoutMultiplier}) * 100, 0)::text`,
    inhouseCount: sql<number>`count(*) filter (where ${payoutStatus} = 'IN HOUSE')::int`,
    dsePayoutStatus: sql<string>`coalesce(sum(${dsePayoutStatus}), 0)::text`,
    dealerPayoutStatus: sql<string>`coalesce(sum(${dealerPayoutStatus}), 0)::text`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    bankIntRate: sql<string | null>`avg(${financeSheet.bankIntRate}) filter (where ${financeSheet.bankIntRate} > 0)::text`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(labelExpr)
    .orderBy(desc(sql`count(*)`))

  const rows = limit ? await query.limit(limit) : await query
  return rows.map((row) => serializeMetricRow(row, totalCases))
}

async function loadMetricGroupedRows(groups: MetricGroupConfig[], whereExpression: SQL | undefined, totalCases: number) {
  if (groups.length === 0) return {} as Record<string, FinanceMetricRow[]>

  const groupKey = sql<string>`case ${sql.join(groups.map((group) => (
    sql`when grouping(${group.labelExpr}) = 0 then ${group.key}`
  )), sql` `)} else 'unknown' end`
  const label = sql<string>`case ${sql.join(groups.map((group) => (
    sql`when grouping(${group.labelExpr}) = 0 then ${group.labelExpr}`
  )), sql` `)} else 'Unspecified' end`
  const groupingSets = sql.join(groups.map((group) => sql`(${group.labelExpr})`), sql`, `)
  const payoutStatus = payoutStatusExpr()
  const payoutMultiplier = payoutMultiplierExpr()
  const dsePayoutStatus = numericAmountExpr(financeSheet.dsePayoutStatus)
  const dealerPayoutStatus = numericAmountExpr(financeSheet.dealerPayoutStatus)

  const rows = await db.select({
    groupKey,
    label,
    totalCase: sql<number>`count(*)::int`,
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    avgPayout: sql<string>`coalesce(avg(${payoutMultiplier}) * 100, 0)::text`,
    inhouseCount: sql<number>`count(*) filter (where ${payoutStatus} = 'IN HOUSE')::int`,
    dsePayoutStatus: sql<string>`coalesce(sum(${dsePayoutStatus}), 0)::text`,
    dealerPayoutStatus: sql<string>`coalesce(sum(${dealerPayoutStatus}), 0)::text`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    bankIntRate: sql<string | null>`avg(${financeSheet.bankIntRate}) filter (where ${financeSheet.bankIntRate} > 0)::text`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(sql`grouping sets (${groupingSets})`)

  const limits = new Map(groups.map((group) => [group.key, group.limit]))
  const grouped = rows.reduce<Record<string, FinanceMetricRow[]>>((acc, row) => {
    const key = row.groupKey || 'unknown'
    const groupRows = acc[key] || []
    groupRows.push(serializeMetricRow(row, totalCases))
    acc[key] = groupRows
    return acc
  }, {})

  Object.keys(grouped).forEach((key) => {
    grouped[key].sort((a, b) => b.totalCase - a.totalCase || a.label.localeCompare(b.label))
    const limit = limits.get(key)
    if (limit) grouped[key] = grouped[key].slice(0, limit)
  })

  return grouped
}

async function loadMonthHypRows(whereExpression: SQL | undefined, totalCases: number) {
  const payoutStatus = payoutStatusExpr()
  const payoutMultiplier = payoutMultiplierExpr()
  const dsePayoutStatus = numericAmountExpr(financeSheet.dsePayoutStatus)
  const dealerPayoutStatus = numericAmountExpr(financeSheet.dealerPayoutStatus)
  const monthLabel = monthLabelExpr()
  const hypLabel = cleanLabelExpr(financeSheet.hyp)
  const label = sql<string>`${monthLabel} || ' - ' || ${hypLabel}`

  const rows = await db.select({
    label,
    month: monthLabel,
    hyp: hypLabel,
    status: sql<string>`coalesce(min(nullif(btrim(${financeSheet.status}), '')), 'Mixed')`,
    totalCase: sql<number>`count(*)::int`,
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    avgPayout: sql<string>`coalesce(avg(${payoutMultiplier}) * 100, 0)::text`,
    inhouseCount: sql<number>`count(*) filter (where ${payoutStatus} = 'IN HOUSE')::int`,
    dsePayoutStatus: sql<string>`coalesce(sum(${dsePayoutStatus}), 0)::text`,
    dealerPayoutStatus: sql<string>`coalesce(sum(${dealerPayoutStatus}), 0)::text`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    bankIntRate: sql<string | null>`avg(${financeSheet.bankIntRate}) filter (where ${financeSheet.bankIntRate} > 0)::text`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(monthLabel, hypLabel)
    .orderBy(desc(sql`count(*)`))

  return rows.map((row) => ({
    ...serializeMetricRow(row, totalCases),
    month: row.month || 'Unspecified',
    hyp: row.hyp || 'Unspecified',
    status: row.status || 'Mixed',
  })) satisfies MonthHypMetricRow[]
}

async function loadOperationsRows(whereExpression: SQL | undefined, totalCases: number) {
  const dealerLabel = cleanLabelExpr(financeSheet.mainDealer)
  const rows = await db.select({
    label: dealerLabel,
    totalCase: sql<number>`count(*)::int`,
    bankScheduleVisit: sql<number>`count(*) filter (where btrim(coalesce(${financeSheet.bankVisitScheduled}, '')) <> '')::int`,
    visited: sql<number>`count(*) filter (where btrim(coalesce(${financeSheet.visitedBy}, '')) <> '' or ${financeSheet.dateOfBankVisit} is not null)::int`,
    vehicleRegistrationCount: sql<number>`count(*) filter (where btrim(coalesce(${financeSheet.vehicleRegistrationNumberToSale}, '')) <> '')::int`,
    hypAsPerRcCount: sql<number>`count(*) filter (where btrim(coalesce(${financeSheet.hypAsPerRc}, '')) <> '')::int`,
    hypMismatchCount: sql<number>`count(*) filter (
      where btrim(coalesce(${financeSheet.hyp}, '')) <> ''
        and btrim(coalesce(${financeSheet.hypAsPerRc}, '')) <> ''
        and upper(btrim(${financeSheet.hyp})) <> upper(btrim(${financeSheet.hypAsPerRc}))
    )::int`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(dealerLabel)
    .orderBy(desc(sql`count(*)`))

  return rows.map((row) => {
    const totalCase = Number(row.totalCase || 0)
    return {
      label: row.label || 'Unspecified',
      totalCase,
      contribution: contribution(totalCase, totalCases),
      bankScheduleVisit: Number(row.bankScheduleVisit || 0),
      visited: Number(row.visited || 0),
      vehicleRegistrationCount: Number(row.vehicleRegistrationCount || 0),
      hypAsPerRcCount: Number(row.hypAsPerRcCount || 0),
      hypMismatchCount: Number(row.hypMismatchCount || 0),
    }
  }) satisfies OperationsDealerRow[]
}

async function loadRankingRows(labelExpr: SQL<string>, whereExpression: SQL | undefined, totalCases: number) {
  const rows = await db.select({
    label: labelExpr,
    totalCase: sql<number>`count(*)::int`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(labelExpr)
    .orderBy(desc(sql`count(*)`))

  return rows.map((row) => {
    const totalCase = Number(row.totalCase || 0)
    return {
      label: row.label || 'Unspecified',
      totalCase,
      contribution: contribution(totalCase, totalCases),
    }
  }) satisfies RankingRow[]
}

function monthSortValue(key: string) {
  if (key === 'unknown') return 0
  return Number(key.replace('-', ''))
}

async function loadDealerLocationRows(whereExpression: SQL | undefined) {
  const dealerLabel = cleanLabelExpr(financeSheet.mainDealer)
  const locationLabel = cleanLabelExpr(financeSheet.location)
  const dsePayoutStatus = numericAmountExpr(financeSheet.dsePayoutStatus)
  const dealerPayoutStatus = numericAmountExpr(financeSheet.dealerPayoutStatus)
  const rows = await db.select({
    dealer: dealerLabel,
    label: locationLabel,
    totalCase: sql<number>`count(*)::int`,
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)::text`,
    avgPayout: sql<string>`coalesce(avg(${payoutMultiplierExpr()}) * 100, 0)::text`,
    inhouseCount: sql<number>`count(*) filter (where ${payoutStatusExpr()} = 'IN HOUSE')::int`,
    dsePayoutStatus: sql<string>`coalesce(sum(${dsePayoutStatus}), 0)::text`,
    dealerPayoutStatus: sql<string>`coalesce(sum(${dealerPayoutStatus}), 0)::text`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)::text`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)::text`,
    bankIntRate: sql<string | null>`avg(${financeSheet.bankIntRate}) filter (where ${financeSheet.bankIntRate} > 0)::text`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(dealerLabel, locationLabel)
    .orderBy(dealerLabel, desc(sql`count(*)`))

  const totalsByDealer = new Map<string, number>()
  rows.forEach((row) => {
    totalsByDealer.set(row.dealer, (totalsByDealer.get(row.dealer) || 0) + Number(row.totalCase || 0))
  })

  const byDealer = new Map<string, FinanceMetricRow[]>()
  rows.forEach((row) => {
    const dealerTotal = totalsByDealer.get(row.dealer) || 0
    const group = byDealer.get(row.dealer) || []
    group.push(serializeMetricRow(row, dealerTotal))
    byDealer.set(row.dealer, group)
  })

  return byDealer
}

async function loadProformaPivots(whereExpression: SQL | undefined) {
  const dealerLabel = cleanLabelExpr(financeSheet.mainDealer)
  const bankLabel = cleanLabelExpr(financeSheet.hyp)
  const monthKey = monthKeyExpr()
  const monthLabel = monthLabelExpr()
  const groupedRows = await db.select({
    dealer: dealerLabel,
    bank: bankLabel,
    monthKey,
    monthLabel,
    totalCase: sql<number>`count(*)::int`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(dealerLabel, bankLabel, monthKey, monthLabel)
    .orderBy(dealerLabel, desc(sql`count(*)`))

  const locationRowsByDealer = await loadDealerLocationRows(whereExpression)
  const dealers = new Map<string, typeof groupedRows>()
  groupedRows.forEach((row) => {
    const group = dealers.get(row.dealer) || []
    group.push(row)
    dealers.set(row.dealer, group)
  })

  return Array.from(dealers.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dealer, dealerRows]) => {
      const months = Array.from(new Map(dealerRows.map((row) => [
        row.monthKey,
        { key: row.monthKey, label: row.monthLabel || 'Unspecified' },
      ])).values()).sort((a, b) => monthSortValue(b.key) - monthSortValue(a.key))

      const rowsByBank = new Map<string, { values: Record<string, number>; grandTotal: number }>()
      dealerRows.forEach((row) => {
        const entry = rowsByBank.get(row.bank) || { values: {}, grandTotal: 0 }
        const cases = Number(row.totalCase || 0)
        entry.values[row.monthKey] = (entry.values[row.monthKey] || 0) + cases
        entry.grandTotal += cases
        rowsByBank.set(row.bank, entry)
      })

      const rows = Array.from(rowsByBank.entries())
        .map(([bank, entry]) => ({ bank, ...entry }))
        .sort((a, b) => b.grandTotal - a.grandTotal || a.bank.localeCompare(b.bank))

      const grandTotalRow = {
        bank: 'Grand total',
        values: Object.fromEntries(months.map((month) => [
          month.key,
          dealerRows
            .filter((row) => row.monthKey === month.key)
            .reduce((sum, row) => sum + Number(row.totalCase || 0), 0),
        ])),
        grandTotal: dealerRows.reduce((sum, row) => sum + Number(row.totalCase || 0), 0),
      }

      return {
        title: `${dealer} Proforma Details`,
        dealer,
        months,
        rows,
        grandTotalRow,
        locationRows: locationRowsByDealer.get(dealer) || [],
      }
    }) satisfies ProformaPivot[]
}

async function buildAnalyticsData(section: SectionKey, whereExpression: SQL | undefined, totalCases: number, sbiPendingSummary: SbiPendingSummary) {
  const data: Record<string, unknown> = {}
  const payoutLabel = payoutStatusExpr()
  const paymentLabel = paymentStatusExpr()
  const dealerLabel = cleanLabelExpr(financeSheet.mainDealer)
  const locationLabel = cleanLabelExpr(financeSheet.location)
  const hypLabel = cleanLabelExpr(financeSheet.hyp)
  const salesLabel = cleanLabelExpr(financeSheet.salesExecutive)

  if (section === 'overview' || section === 'all') {
    const groupedRows = await loadMetricGroupedRows([
      { key: 'payoutStatusRows', labelExpr: payoutLabel },
      { key: 'paymentStatusRows', labelExpr: paymentLabel },
      { key: 'dealerRows', labelExpr: dealerLabel },
      { key: 'locationRows', labelExpr: locationLabel, limit: 12 },
      { key: 'hypRows', labelExpr: hypLabel, limit: 12 },
      { key: 'monthRows', labelExpr: monthLabelExpr() },
    ], whereExpression, totalCases)
    data.overview = {
      payoutStatusRows: ensureKnownRows(groupedRows.payoutStatusRows || [], KNOWN_PAYOUT_GROUPS),
      paymentStatusRows: ensureKnownRows(groupedRows.paymentStatusRows || [], KNOWN_PAYMENT_GROUPS),
      dealerRows: groupedRows.dealerRows || [],
      locationRows: groupedRows.locationRows || [],
      hypRows: groupedRows.hypRows || [],
      monthRows: groupedRows.monthRows || [],
    }
  }

  if (section === 'payout-status' || section === 'all') {
    const groupedRows = await loadMetricGroupedRows([
      { key: 'payoutStatusRows', labelExpr: payoutLabel },
      { key: 'paymentStatusRows', labelExpr: paymentLabel },
      { key: 'dealerRows', labelExpr: dealerLabel },
    ], whereExpression, totalCases)
    data.payoutStatus = {
      payoutStatusRows: ensureKnownRows(groupedRows.payoutStatusRows || [], KNOWN_PAYOUT_GROUPS),
      paymentStatusRows: ensureKnownRows(groupedRows.paymentStatusRows || [], KNOWN_PAYMENT_GROUPS),
      dealerRows: groupedRows.dealerRows || [],
    }
  }

  if (section === 'hyp-bank-analysis' || section === 'all') {
    const [hypRows, locationRows] = await Promise.all([
      loadMetricRows(hypLabel, whereExpression, totalCases),
      loadMetricRows(locationLabel, whereExpression, totalCases, 20),
    ])
    data.hypBankAnalysis = {
      hypRows,
      locationRows,
      sbiPendingTarget: sbiPendingSummary.pendingCases,
      sbiPendingSummary,
    }
  }

  if (section === 'team-performance' || section === 'all') {
    const [salesExecutiveRows, hypRows] = await Promise.all([
      loadMetricRows(salesLabel, whereExpression, totalCases),
      loadMetricRows(hypLabel, whereExpression, totalCases),
    ])
    data.teamPerformance = {
      salesExecutiveRows,
      hypRows,
    }
  }

  if (section === 'monthly-matrix' || section === 'all') {
    const [monthRows, monthHypRows] = await Promise.all([
      loadMetricRows(monthLabelExpr(), whereExpression, totalCases),
      loadMonthHypRows(whereExpression, totalCases),
    ])
    data.monthlyMatrix = {
      monthRows,
      monthHypRows,
    }
  }

  if (section === 'operations-compliance' || section === 'all') {
    const [dealerOpsRows, bankerRemarksRows, reasonIfOuthouseRows] = await Promise.all([
      loadOperationsRows(whereExpression, totalCases),
      loadRankingRows(cleanLabelExpr(financeSheet.bankerRemarks), whereExpression, totalCases),
      loadRankingRows(cleanLabelExpr(financeSheet.reasonIfOuthouse), whereExpression, totalCases),
    ])
    data.operationsCompliance = {
      dealerOpsRows,
      bankerRemarksRows,
      reasonIfOuthouseRows,
    }
  }

  if (section === 'proforma-details' || section === 'all') {
    data.proformaDetails = {
      pivots: await loadProformaPivots(whereExpression),
    }
  }

  return data
}

function getSection(value: string | null): SectionKey {
  const allowed: SectionKey[] = [
    'overview',
    'payout-status',
    'hyp-bank-analysis',
    'team-performance',
    'monthly-matrix',
    'operations-compliance',
    'proforma-details',
    'all',
  ]
  return allowed.includes(value as SectionKey) ? value as SectionKey : 'overview'
}

function analyticsCacheKey(role: string, section: SectionKey, searchParams: URLSearchParams) {
  const normalizedParams = new URLSearchParams({ section })
  CACHE_PARAM_KEYS.forEach((key) => {
    const value = (searchParams.get(key) || '').trim()
    if (value && value !== 'all') normalizedParams.set(key, value)
  })
  const hash = createHash('sha1').update(normalizedParams.toString()).digest('hex')
  return `${ANALYTICS_CACHE_PREFIX}:${role}:${hash}`
}

async function buildAnalyticsPayload(section: SectionKey, searchParams: URLSearchParams, role: AmFinanceRole): Promise<AnalyticsPayload> {
  const whereExpression = buildFilters(searchParams)
  const [summary, filterOptions] = await Promise.all([
    loadSummary(whereExpression),
    loadCachedFilterOptions(),
  ])
  const sbiPendingSummary = await loadSbiPendingSummary(whereExpression, summary.totalCases)
  const data = await buildAnalyticsData(section, whereExpression, summary.totalCases, sbiPendingSummary)

  return {
    section,
    summary,
    data,
    filterOptions: filterOptions.filters,
    coverage: filterOptions.coverage,
    sbiPendingTarget: sbiPendingSummary.pendingCases,
    sbiPendingSummary,
    permissions: getAmFinancePermissions(role),
    source: {
      table: 'finance_sheet',
      analyticsSource: 'finance_sheet.hyp',
      mode: 'analytics',
    },
  }
}

export async function GET(request: NextRequest) {
  const timer = createApiTimer('am-finance-analytics')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    // Same rule as app/am-finance/page.tsx — honours an Access-Map allow AND a deny. Checking
    // the role alone served data to users the page had already refused. See lib/am-finance/access.ts.
    if (!(await canViewAmFinance(appUser))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const searchParams = request.nextUrl.searchParams
    const section = getSection(searchParams.get('section'))
    const cacheKey = analyticsCacheKey(appUser.role, section, searchParams)

    const payload = await timer.time('response-cache', () => getCachedData(
      cacheKey,
      () => timer.time('data', () => buildAnalyticsPayload(section, searchParams, appUser.role)),
      ANALYTICS_CACHE_TTL_SECONDS
    ))

    const { serverTiming } = timer.finish()
    return withServerTiming(NextResponse.json(payload), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error in GET /api/am-finance/analytics:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
