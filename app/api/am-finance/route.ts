import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { and, asc, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm'
import { getAuthenticatedAppUser } from '@/lib/auth/app-user'
import { canAccessAmFinance, canCreateAmFinance, canEditAmFinance, getAmFinancePermissions } from '@/lib/am-finance/access'
import { createApiTimer, withServerTiming } from '@/lib/api/timing'
import { serializeAppDate } from '@/lib/date-time'
import { db } from '@/lib/db'
import { amFinanceAuditLogs, financeSheet } from '@/lib/db/schema'
import { getCachedData, invalidateCachePattern } from '@/lib/redis/cache-utils'

export const dynamic = 'force-dynamic'

const AM_FINANCE_CACHE_PATTERN = 'am-finance:*'
const AM_FINANCE_FILTER_CACHE_KEY = 'am-finance:filters:v2'
const AM_FINANCE_FILTER_CACHE_TTL_SECONDS = 300

type FinanceSheetRow = typeof financeSheet.$inferSelect
type FinanceSheetInsert = typeof financeSheet.$inferInsert
type FinanceSheetUpdate = Partial<FinanceSheetInsert>
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
type SortDirection = 'asc' | 'desc'
type BreakdownGroupConfig = {
  key: string
  labelExpr: SQL<unknown>
  limit?: number
}

const REQUIRED_FORM_FIELDS = [
  'deliveryDate',
  'customerName',
  'mobileNo',
  'model',
  'salesExecutive',
  'mainDealer',
  'location',
  'hyp',
  'branch',
  'loanAmount',
  'payoutStatus',
  'status',
] as const

const FORM_FIELD_LABELS: Record<string, string> = {
  deliveryDate: 'Delivery Date',
  customerName: 'Customer Name',
  mobileNo: 'Mobile No',
  model: 'Model',
  salesExecutive: 'Sales Executive',
  mainDealer: 'Main Dealer',
  location: 'Location',
  tl: 'TL',
  hyp: 'HYP',
  branch: 'Branch',
  loanAmount: 'Loan Amount',
  panNumber: 'PAN Number',
  payoutStatus: 'Payout Status',
  reasonIfOuthouse: 'Reason If Outhouse',
  dealerPayoutPercent: 'Dealer Payout Percent',
  payoutAmount: 'Payout Amount',
  status: 'Status',
  dsePayoutStatus: 'DSE Payout Status',
  dealerPayoutStatus: 'Dealer Payout Status',
  paymentReceivedDate: 'Payment Received Date',
  amountReceived: 'Amount Received',
  invoiceNumber: 'Invoice Number',
  bankVisitScheduled: 'Bank Visit Scheduled',
  dateOfBankVisit: 'Date Of Bank Visit',
  visitedBy: 'Visited By',
  bankerRemarks: 'Banker Remarks',
  vehicleRegistrationNumberToSale: 'Vehicle Registration Number To Sale',
  hypAsPerRc: 'HYP As Per RC',
  startTime: 'Start Time',
  endTime: 'End Time',
  loginUser: 'Login User',
  bankIntRate: 'Bank Interest Rate',
  bankLogin: 'Bank Login',
  bankInProforma: 'Bank In Proforma',
}

function getFilterValue(searchParams: URLSearchParams, key: FilterKey) {
  const value = (searchParams.get(key) || '').trim()
  return value && value !== 'all' ? value : null
}

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
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

function toNumber(value: unknown) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function normalizeText(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text || null
}

function readBodyText(body: Record<string, unknown>, key: string) {
  const value = body[key]
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function readBodyDate(body: Record<string, unknown>, key: string, errors: Record<string, string>) {
  const value = readBodyText(body, key)
  if (!value) return null
  if (!isIsoDate(value)) {
    errors[key] = `${FORM_FIELD_LABELS[key] || key} must be a valid date.`
    return null
  }
  return value
}

function readBodyNumber(body: Record<string, unknown>, key: string, errors: Record<string, string>) {
  const value = body[key]
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) {
    errors[key] = `${FORM_FIELD_LABELS[key] || key} must be a non-negative number.`
    return null
  }
  return amount
}

function parsePayoutMultiplier(value: string | null | undefined) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = raw.endsWith('%') ? raw.slice(0, -1) : raw
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0) return null
  return raw.endsWith('%') ? amount / 100 : amount
}

function calculatePayoutAmount(loanAmount: number | null, dealerPayoutPercent: string | null | undefined) {
  const multiplier = parsePayoutMultiplier(dealerPayoutPercent)
  if (loanAmount === null || multiplier === null) return null
  return Math.round(loanAmount * multiplier * 100) / 100
}

function toDecimalString(value: number | null) {
  if (value === null) return null
  return String(Math.round(value * 100) / 100)
}

function isReceivedStatus(value: string | null | undefined) {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'RECEIVED' || normalized === 'RECEVIED'
}

function normalizeAuditValue(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value).trim()
}

function createFinanceRowHash(values: FinanceSheetUpdate, userId: string) {
  return createHash('sha256')
    .update(JSON.stringify({ values, userId, generatedAt: new Date().toISOString() }))
    .digest('hex')
}

function isMissingAmFinanceSetupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('am_finance_audit_logs')
    || message.includes('finance_sheet_id_seq')
    || message.includes('relation "am_finance_audit_logs"')
    || message.includes('relation "finance_sheet_id_seq"')
}

function serializeFinanceSheetRow(row: FinanceSheetRow) {
  return {
    id: row.id,
    rowHash: row.rowHash,
    deliveryDate: row.deliveryDate,
    customerName: normalizeText(row.customerName),
    mobileNo: normalizeText(row.mobileNo),
    model: normalizeText(row.model),
    salesExecutive: normalizeText(row.salesExecutive),
    mainDealer: normalizeText(row.mainDealer),
    location: normalizeText(row.location),
    tl: normalizeText(row.tl),
    hyp: normalizeText(row.hyp),
    branch: normalizeText(row.branch),
    loanAmount: toNumber(row.loanAmount),
    panNumber: normalizeText(row.panNumber),
    payoutStatus: normalizeText(row.payoutStatus),
    reasonIfOuthouse: normalizeText(row.reasonIfOuthouse),
    dealerPayoutPercent: normalizeText(row.dealerPayoutPercent),
    payoutAmount: toNumber(row.payoutAmount),
    status: normalizeText(row.status),
    dsePayoutStatus: normalizeText(row.dsePayoutStatus),
    dealerPayoutStatus: normalizeText(row.dealerPayoutStatus),
    paymentReceivedDate: row.paymentReceivedDate,
    amountReceived: toNumber(row.amountReceived),
    invoiceNumber: normalizeText(row.invoiceNumber),
    bankVisitScheduled: normalizeText(row.bankVisitScheduled),
    dateOfBankVisit: row.dateOfBankVisit,
    visitedBy: normalizeText(row.visitedBy),
    bankerRemarks: normalizeText(row.bankerRemarks),
    vehicleRegistrationNumberToSale: normalizeText(row.vehicleRegistrationNumberToSale),
    hypAsPerRc: normalizeText(row.hypAsPerRc),
    startTime: normalizeText(row.startTime),
    endTime: normalizeText(row.endTime),
    loginUser: normalizeText(row.loginUser),
    bankIntRate: toNullableNumber(row.bankIntRate),
    bankLogin: normalizeText(row.bankLogin),
    bankInProforma: normalizeText(row.bankInProforma),
    uploadedAt: serializeAppDate(row.uploadedAt),
  }
}

function validateFinanceMutation(body: Record<string, unknown>, mode: 'create' | 'update', existingRow?: FinanceSheetRow, role?: string) {
  const errors: Record<string, string> = {}

  const values: FinanceSheetUpdate = {
    deliveryDate: readBodyDate(body, 'deliveryDate', errors),
    customerName: readBodyText(body, 'customerName')?.toUpperCase() || null,
    mobileNo: readBodyText(body, 'mobileNo'),
    model: readBodyText(body, 'model'),
    salesExecutive: readBodyText(body, 'salesExecutive'),
    mainDealer: readBodyText(body, 'mainDealer'),
    location: readBodyText(body, 'location'),
    tl: readBodyText(body, 'tl'),
    hyp: readBodyText(body, 'hyp'),
    branch: readBodyText(body, 'branch'),
    loanAmount: toDecimalString(readBodyNumber(body, 'loanAmount', errors)),
    panNumber: readBodyText(body, 'panNumber'),
    payoutStatus: readBodyText(body, 'payoutStatus'),
    reasonIfOuthouse: readBodyText(body, 'reasonIfOuthouse'),
    dealerPayoutPercent: readBodyText(body, 'dealerPayoutPercent'),
    status: readBodyText(body, 'status'),
    dsePayoutStatus: readBodyText(body, 'dsePayoutStatus'),
    dealerPayoutStatus: readBodyText(body, 'dealerPayoutStatus'),
    paymentReceivedDate: readBodyDate(body, 'paymentReceivedDate', errors),
    amountReceived: toDecimalString(readBodyNumber(body, 'amountReceived', errors)),
    invoiceNumber: readBodyText(body, 'invoiceNumber'),
    bankVisitScheduled: readBodyText(body, 'bankVisitScheduled'),
    dateOfBankVisit: readBodyDate(body, 'dateOfBankVisit', errors),
    visitedBy: readBodyText(body, 'visitedBy'),
    bankerRemarks: readBodyText(body, 'bankerRemarks'),
    vehicleRegistrationNumberToSale: readBodyText(body, 'vehicleRegistrationNumberToSale'),
    hypAsPerRc: readBodyText(body, 'hypAsPerRc'),
    startTime: readBodyText(body, 'startTime') || existingRow?.startTime || null,
    endTime: new Date().toString(),
    bankIntRate: toDecimalString(readBodyNumber(body, 'bankIntRate', errors)),
    bankLogin: readBodyText(body, 'bankLogin'),
    bankInProforma: readBodyText(body, 'bankInProforma'),
  }

  for (const field of REQUIRED_FORM_FIELDS) {
    const value = values[field as keyof FinanceSheetUpdate]
    if (value === null || value === undefined || value === '') {
      errors[field] = `${FORM_FIELD_LABELS[field] || field} is required.`
    }
  }

  if (String(values.payoutStatus || '').trim().toUpperCase() === 'OUT HOUSE' && !values.reasonIfOuthouse) {
    errors.reasonIfOuthouse = 'Reason is required for OUT HOUSE payout cases.'
  }

  if (isReceivedStatus(values.status)) {
    if (!values.paymentReceivedDate) {
      errors.paymentReceivedDate = 'Payment received date is required for received cases.'
    }
    if (values.amountReceived === null || values.amountReceived === undefined) {
      errors.amountReceived = 'Amount received is required for received cases.'
    }
  }

  const loanAmount = values.loanAmount === null || values.loanAmount === undefined ? null : Number(values.loanAmount)
  const existingPayoutPercent = existingRow?.dealerPayoutPercent || null
  const isGlobalAdmin = role === 'admin' || role === 'developer'
  const effectivePayoutPercent = mode === 'update' && !isGlobalAdmin
    ? existingPayoutPercent
    : values.dealerPayoutPercent
  const calculatedPayout = calculatePayoutAmount(loanAmount, effectivePayoutPercent)
  const manualPayout = readBodyNumber(body, 'payoutAmount', errors)

  if (isGlobalAdmin && manualPayout !== null) {
    values.payoutAmount = toDecimalString(manualPayout)
  } else {
    values.payoutAmount = toDecimalString(calculatedPayout)
  }

  if (mode === 'update' && !isGlobalAdmin && existingRow) {
    values.dealerPayoutPercent = existingRow.dealerPayoutPercent
    values.bankIntRate = existingRow.bankIntRate
    values.bankLogin = existingRow.bankLogin
  }

  return { values, errors }
}

function buildFilters(searchParams: URLSearchParams) {
  const filters: SQL[] = []
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (isIsoDate(startDate)) {
    filters.push(gte(financeSheet.deliveryDate, startDate!))
  }

  if (isIsoDate(endDate)) {
    filters.push(lte(financeSheet.deliveryDate, endDate!))
  }

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

function getSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc'
}

function getOrderExpression(sortBy: string | null, direction: SortDirection) {
  const order = direction === 'asc' ? asc : desc

  switch (sortBy) {
    case 'customerName':
      return order(financeSheet.customerName)
    case 'mainDealer':
      return order(financeSheet.mainDealer)
    case 'location':
      return order(financeSheet.location)
    case 'hyp':
      return order(financeSheet.hyp)
    case 'loanAmount':
      return order(financeSheet.loanAmount)
    case 'payoutAmount':
      return order(financeSheet.payoutAmount)
    case 'amountReceived':
      return order(financeSheet.amountReceived)
    case 'status':
      return order(financeSheet.status)
    case 'payoutStatus':
      return order(financeSheet.payoutStatus)
    case 'paymentReceivedDate':
      return order(financeSheet.paymentReceivedDate)
    case 'uploadedAt':
      return order(financeSheet.uploadedAt)
    case 'deliveryDate':
    default:
      return order(financeSheet.deliveryDate)
  }
}

function cleanOptionArray(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
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
    rowCount: count(),
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

function serializeBreakdownRow(row: {
  label: string | null
  cases: number
  loanAmount?: string | null
  payoutAmount?: string | null
  amountReceived?: string | null
}) {
  return {
    label: normalizeText(row.label) || 'Unassigned',
    cases: Number(row.cases || 0),
    loanAmount: toNumber(row.loanAmount),
    payoutAmount: toNumber(row.payoutAmount),
    amountReceived: toNumber(row.amountReceived),
  }
}

async function loadBreakdownGroups(whereExpression: SQL | undefined) {
  const groups: BreakdownGroupConfig[] = [
    { key: 'payoutStatusRows', labelExpr: sql`${financeSheet.payoutStatus}` },
    { key: 'paymentStatusRows', labelExpr: sql`${financeSheet.status}` },
    { key: 'dealerRows', labelExpr: sql`${financeSheet.mainDealer}` },
    { key: 'locationRows', labelExpr: sql`${financeSheet.location}`, limit: 12 },
    { key: 'bankRows', labelExpr: sql`${financeSheet.hyp}`, limit: 12 },
  ]
  const groupKey = sql<string>`case ${sql.join(groups.map((group) => (
    sql`when grouping(${group.labelExpr}) = 0 then ${group.key}`
  )), sql` `)} else 'unknown' end`
  const label = sql<string>`case ${sql.join(groups.map((group) => (
    sql`when grouping(${group.labelExpr}) = 0 then ${group.labelExpr}`
  )), sql` `)} else null end`
  const groupingSets = sql.join(groups.map((group) => sql`(${group.labelExpr})`), sql`, `)

  const rows = await db.select({
    groupKey,
    label,
    cases: count(),
    loanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)`,
    payoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)`,
    amountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)`,
  })
    .from(financeSheet)
    .where(whereExpression)
    .groupBy(sql`grouping sets (${groupingSets})`)

  const limits = new Map(groups.map((group) => [group.key, group.limit]))
  const grouped = rows.reduce<Record<string, ReturnType<typeof serializeBreakdownRow>[]>>((acc, row) => {
    const key = row.groupKey || 'unknown'
    const groupRows = acc[key] || []
    groupRows.push(serializeBreakdownRow(row))
    acc[key] = groupRows
    return acc
  }, {})

  Object.keys(grouped).forEach((key) => {
    grouped[key].sort((a, b) => b.cases - a.cases || a.label.localeCompare(b.label))
    const limit = limits.get(key)
    if (limit) grouped[key] = grouped[key].slice(0, limit)
  })

  return grouped
}

async function loadCachedFilterOptions() {
  return getCachedData(AM_FINANCE_FILTER_CACHE_KEY, loadFilterOptions, AM_FINANCE_FILTER_CACHE_TTL_SECONDS)
}

function buildAuditChanges(existingRow: FinanceSheetRow, values: FinanceSheetUpdate) {
  return Object.entries(values)
    .filter(([fieldName]) => fieldName in FORM_FIELD_LABELS)
    .map(([fieldName, newValue]) => ({
      fieldName,
      oldValue: normalizeAuditValue(existingRow[fieldName as keyof FinanceSheetRow]),
      newValue: normalizeAuditValue(newValue),
    }))
    .filter((change) => change.oldValue !== change.newValue)
}

async function loadFinanceSheetRow(id: number) {
  const [row] = await db
    .select()
    .from(financeSheet)
    .where(eq(financeSheet.id, id))
    .limit(1)

  return row || null
}

export async function GET(request: NextRequest) {
  const timer = createApiTimer('am-finance')

  try {
    const appUser = await timer.time('auth', () => getAuthenticatedAppUser())
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canAccessAmFinance(appUser.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const searchParams = request.nextUrl.searchParams
    const whereExpression = buildFilters(searchParams)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const exportMode = searchParams.get('export') === 'true'
    const pageSize = exportMode
      ? 5000
      : Math.min(100, Math.max(10, Number.parseInt(searchParams.get('pageSize') || '25', 10) || 25))
    const sortDirection = getSortDirection(searchParams.get('sortDir'))
    const orderExpression = getOrderExpression(searchParams.get('sortBy'), sortDirection)
    const offset = exportMode ? 0 : (page - 1) * pageSize

    const [
      [summary],
      rows,
      breakdowns,
      filterOptions,
    ] = await timer.time('data', () => Promise.all([
      db.select({
        totalCases: count(),
        totalLoanAmount: sql<string>`coalesce(sum(${financeSheet.loanAmount}), 0)`,
        totalPayoutAmount: sql<string>`coalesce(sum(${financeSheet.payoutAmount}), 0)`,
        totalAmountReceived: sql<string>`coalesce(sum(${financeSheet.amountReceived}), 0)`,
        pendingAmount: sql<string>`coalesce(sum(greatest(coalesce(${financeSheet.payoutAmount}, 0) - coalesce(${financeSheet.amountReceived}, 0), 0)), 0)`,
        receivedCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) in ('RECEIVED', 'RECEVIED'))`,
        pendingCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) = 'PENDING')`,
        noPayoutCases: sql<number>`count(*) filter (where upper(coalesce(${financeSheet.status}, '')) = 'NO PAYOUT')`,
      }).from(financeSheet).where(whereExpression),
      db.select().from(financeSheet).where(whereExpression).orderBy(orderExpression).limit(pageSize).offset(offset),
      loadBreakdownGroups(whereExpression),
      // Filter options are independent of the where-filtered summary/rows/breakdowns (they aggregate
      // distinct values over the whole table), so fetch them concurrently rather than after the wave.
      loadCachedFilterOptions(),
    ]))

    const totalRows = Number(summary?.totalCases || 0)
    const { serverTiming } = timer.finish()

    return withServerTiming(NextResponse.json({
      rows: rows.map(serializeFinanceSheetRow),
      pagination: {
        page: exportMode ? 1 : page,
        pageSize,
        total: totalRows,
        totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      },
      summary: {
        totalCases: Number(summary?.totalCases || 0),
        totalLoanAmount: toNumber(summary?.totalLoanAmount),
        totalPayoutAmount: toNumber(summary?.totalPayoutAmount),
        totalAmountReceived: toNumber(summary?.totalAmountReceived),
        pendingAmount: toNumber(summary?.pendingAmount),
        receivedCases: Number(summary?.receivedCases || 0),
        pendingCases: Number(summary?.pendingCases || 0),
        noPayoutCases: Number(summary?.noPayoutCases || 0),
      },
      breakdowns: {
        payoutStatus: breakdowns.payoutStatusRows || [],
        paymentStatus: breakdowns.paymentStatusRows || [],
        dealerPerformance: breakdowns.dealerRows || [],
        locationPerformance: breakdowns.locationRows || [],
        bankPerformance: breakdowns.bankRows || [],
      },
      filterOptions: filterOptions.filters,
      coverage: filterOptions.coverage,
      permissions: getAmFinancePermissions(appUser.role),
      source: {
        table: 'finance_sheet',
        mode: canCreateAmFinance(appUser.role) || canEditAmFinance(appUser.role) ? 'read_write' : 'read_only',
      },
    }), serverTiming)
  } catch (error) {
    timer.finish()
    console.error('Error in GET /api/am-finance:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canCreateAmFinance(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json() as Record<string, unknown>
    const validation = validateFinanceMutation(body, 'create', undefined, appUser.role)
    if (Object.keys(validation.errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', fields: validation.errors }, { status: 400 })
    }

    const now = new Date()
    const insertValues: FinanceSheetInsert = {
      ...validation.values,
      rowHash: createFinanceRowHash(validation.values, appUser.id),
      loginUser: appUser.fullName || appUser.email,
      uploadedAt: now,
    }

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx.insert(financeSheet).values(insertValues).returning()
      await tx.insert(amFinanceAuditLogs).values({
        financeSheetId: row.id,
        action: 'create',
        fieldName: null,
        oldValue: null,
        newValue: 'Record created',
        performedBy: appUser.id,
        performedByName: appUser.fullName || appUser.email,
        userRole: appUser.role,
        module: 'am_finance',
        metadata: {
          source: 'am_finance_form',
          fields: Object.keys(validation.values).filter((key) => key in FORM_FIELD_LABELS),
        },
      })
      return row
    })
    await invalidateCachePattern(AM_FINANCE_CACHE_PATTERN)

    return NextResponse.json({
      success: true,
      row: serializeFinanceSheetRow(inserted),
    }, { status: 201 })
  } catch (error) {
    if (isMissingAmFinanceSetupError(error)) {
      return NextResponse.json({
        error: 'AM Finance form database setup is required. Run npm run db:setup-am-finance-v2.',
        setupRequired: true,
      }, { status: 503 })
    }

    console.error('Error in POST /api/am-finance:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const appUser = await getAuthenticatedAppUser()
    if (!appUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!canEditAmFinance(appUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json() as Record<string, unknown>
    const id = Number(body.id)
    if (!Number.isSafeInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Finance sheet row ID is required' }, { status: 400 })
    }

    const existingRow = await loadFinanceSheetRow(id)
    if (!existingRow) {
      return NextResponse.json({ error: 'Finance sheet row not found' }, { status: 404 })
    }

    const validation = validateFinanceMutation(body, 'update', existingRow, appUser.role)
    if (Object.keys(validation.errors).length > 0) {
      return NextResponse.json({ error: 'Validation failed', fields: validation.errors }, { status: 400 })
    }

    const changes = buildAuditChanges(existingRow, validation.values)
    if (changes.length === 0) {
      return NextResponse.json({
        success: true,
        row: serializeFinanceSheetRow(existingRow),
        changes: [],
      })
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(financeSheet)
        .set(validation.values)
        .where(eq(financeSheet.id, id))
        .returning()

      await tx.insert(amFinanceAuditLogs).values(changes.map((change) => ({
        financeSheetId: id,
        action: 'update',
        fieldName: change.fieldName,
        oldValue: change.oldValue,
        newValue: change.newValue,
        performedBy: appUser.id,
        performedByName: appUser.fullName || appUser.email,
        userRole: appUser.role,
        module: 'am_finance',
        metadata: {
          source: 'am_finance_form',
        },
      })))

      return row
    })
    await invalidateCachePattern(AM_FINANCE_CACHE_PATTERN)

    return NextResponse.json({
      success: true,
      row: serializeFinanceSheetRow(updated),
      changes,
    })
  } catch (error) {
    if (isMissingAmFinanceSetupError(error)) {
      return NextResponse.json({
        error: 'AM Finance form database setup is required. Run npm run db:setup-am-finance-v2.',
        setupRequired: true,
      }, { status: 503 })
    }

    console.error('Error in PUT /api/am-finance:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
