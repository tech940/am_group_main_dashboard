import 'server-only'

import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pettyCashAllocations, pettyCashExpenses, pettyCashRequests, purchaseOrders, users } from '@/lib/db/schema'
import { BRANCH_OPTIONS, getBranchLabel } from '@/lib/branches'

// Read-only Chartered-Accountant data layer. Reads APPROVED-only Purchase Orders + Petty Cash across
// ALL branches (it is gated solely by the `ca.view` section permission on the page + every API route,
// so it deliberately does NOT apply the per-role branch visibility filters used elsewhere).
//
// "Approved" definitions (locked with the user):
//   PO      → md_approval_status = 'approved' (fully EA+MD approved; includes later GRN/accounts/completed stages)
//   Funding → petty_cash_requests.status = 'approved'  (fresh approved request amounts)
//   Spend   → petty_cash_expenses.status = 'approved'  (actual spend, with bill images)

const UNASSIGNED = 'unassigned'

export type CaMetric = { approvedCount: number; approvedAmount: number }
export type CaBranchSummaryRow = { branch: string; branchLabel: string; po: CaMetric; pettyCashFunding: CaMetric; pettyCashSpend: CaMetric }
export type CaSummaryResponse = {
  branches: CaBranchSummaryRow[]
  unassigned: CaBranchSummaryRow | null
  totals: { po: CaMetric; pettyCashFunding: CaMetric; pettyCashSpend: CaMetric }
  filters: { from: string | null; to: string | null }
}

export type CaFilters = { branch?: string | null; from?: string | null; to?: string | null; page?: number; pageSize?: number }
export type CaPagination = { page: number; pageSize: number; total: number; totalPages: number }

export type CaPurchaseOrderRow = {
  id: string; orderNumber: string; branch: string; branchLabel: string
  vendorName: string | null; department: string | null; subDepartment: string | null; reqType: string | null
  amount: number; status: string
  approvedAt: string | null; approverName: string | null; createdAt: string
  documents: { invoices: string[]; quotations: string[]; bills: string[] }
}
export type CaPettyCashFundingRow = {
  id: string; requestNumber: string; branch: string; branchLabel: string
  location: string | null; department: string | null; purpose: string
  requestedAmount: number; allocatedAmount: number | null
  approvedAt: string | null; approverName: string | null; createdAt: string
}
export type CaPettyCashExpenseRow = {
  id: string; expenseNumber: string; branch: string; branchLabel: string
  location: string | null; department: string | null; vendorName: string | null
  amount: number; particulars: string
  expenseDate: string; approvedAt: string | null; approverName: string | null
  billFiles: string[]
}

// --- helpers ---
function parseMoney(value: unknown): number { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0 }
// Exact replica of app/purchase-orders/page.tsx normalizeOrderAmount so CA totals match that view.
function parsePoAmount(amount: string | null, estimate: string | null): number {
  const raw = amount || estimate || '0'
  const n = Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function branchKey(brand: string | null | undefined): string { const v = String(brand || '').trim(); return v || UNASSIGNED }
function branchLabelFor(key: string): string { return key === UNASSIGNED ? 'Unassigned' : getBranchLabel(key) }
const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`)
const istEnd = (d: string) => new Date(`${d}T23:59:59+05:30`)
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
function rows(result: unknown): Record<string, unknown>[] { return Array.isArray(result) ? result as Record<string, unknown>[] : [] }
function emptyMetric(): CaMetric { return { approvedCount: 0, approvedAmount: 0 } }
function emptyRow(branch: string): CaBranchSummaryRow {
  return { branch, branchLabel: branchLabelFor(branch), po: emptyMetric(), pettyCashFunding: emptyMetric(), pettyCashSpend: emptyMetric() }
}

// Branch filter for a Drizzle .where(): null/'all' → no filter; 'unassigned' → IS NULL; else = brand.
function poBranchFilter(branch?: string | null) {
  if (!branch || branch === 'all') return undefined
  if (branch === UNASSIGNED) return isNull(purchaseOrders.brand)
  return eq(purchaseOrders.brand, branch)
}

export async function getCaBranchSummary(filters: Pick<CaFilters, 'from' | 'to'>): Promise<CaSummaryResponse> {
  const from = filters.from || null
  const to = filters.to || null
  const map = new Map<string, CaBranchSummaryRow>()
  const ensure = (key: string) => { const existing = map.get(key); if (existing) return existing; const r = emptyRow(key); map.set(key, r); return r }

  // 1. Approved POs — JS-reduce to faithfully mirror normalizeOrderAmount (SQL SUM can't parse the
  //    free-text estimate fallback / NULL amount identically).
  const poFilters = [eq(purchaseOrders.mdApprovalStatus, 'approved'), isNull(purchaseOrders.deletedAt)]
  if (from) poFilters.push(gte(purchaseOrders.mdApprovedAt, istStart(from)))
  if (to) poFilters.push(lte(purchaseOrders.mdApprovedAt, istEnd(to)))
  const poRows = await db.select({ brand: purchaseOrders.brand, amount: purchaseOrders.amount, estimate: purchaseOrders.estimateIfAny })
    .from(purchaseOrders).where(and(...poFilters))
  for (const r of poRows) {
    const row = ensure(branchKey(r.brand))
    row.po.approvedCount += 1
    row.po.approvedAmount += parsePoAmount(r.amount, r.estimate)
  }

  // 2. Approved petty-cash funding (fresh request amounts) + 3. approved expenses — pure SQL GROUP BY.
  const fundingResult = await db.execute(sql`
    SELECT branch_id AS branch, COUNT(*)::int AS cnt, COALESCE(SUM(requested_amount), 0)::float AS total
    FROM petty_cash_requests
    WHERE status = 'approved' AND deleted_at IS NULL
      ${from ? sql`AND accounts_approved_at >= ${istStart(from)}` : sql``}
      ${to ? sql`AND accounts_approved_at <= ${istEnd(to)}` : sql``}
    GROUP BY branch_id`)
  for (const r of rows(fundingResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashFunding.approvedCount = Number(r.cnt) || 0
    row.pettyCashFunding.approvedAmount = parseMoney(r.total)
  }

  const spendResult = await db.execute(sql`
    SELECT branch_id AS branch, COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0)::float AS total
    FROM petty_cash_expenses
    WHERE status = 'approved' AND deleted_at IS NULL
      ${from ? sql`AND expense_date >= ${from}::date` : sql``}
      ${to ? sql`AND expense_date <= ${to}::date` : sql``}
    GROUP BY branch_id`)
  for (const r of rows(spendResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashSpend.approvedCount = Number(r.cnt) || 0
    row.pettyCashSpend.approvedAmount = parseMoney(r.total)
  }

  const hasActivity = (r: CaBranchSummaryRow) => r.po.approvedCount > 0 || r.pettyCashFunding.approvedCount > 0 || r.pettyCashSpend.approvedCount > 0
  const branches = BRANCH_OPTIONS
    .map((b) => map.get(b.value))
    .filter((r): r is CaBranchSummaryRow => Boolean(r) && hasActivity(r!))
  const unassigned = map.get(UNASSIGNED) && hasActivity(map.get(UNASSIGNED)!) ? map.get(UNASSIGNED)! : null

  const totals = { po: emptyMetric(), pettyCashFunding: emptyMetric(), pettyCashSpend: emptyMetric() }
  for (const b of branches) {
    for (const k of ['po', 'pettyCashFunding', 'pettyCashSpend'] as const) {
      totals[k].approvedCount += b[k].approvedCount
      totals[k].approvedAmount += b[k].approvedAmount
    }
  }

  return { branches, unassigned, totals, filters: { from, to } }
}

function clampPage(input: CaFilters) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 25)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}
function pagination(page: number, pageSize: number, total: number): CaPagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function listCaPurchaseOrders(input: CaFilters): Promise<{ rows: CaPurchaseOrderRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const filters = [eq(purchaseOrders.mdApprovalStatus, 'approved'), isNull(purchaseOrders.deletedAt)]
  const branchFilter = poBranchFilter(input.branch)
  if (branchFilter) filters.push(branchFilter)
  if (input.from) filters.push(gte(purchaseOrders.mdApprovedAt, istStart(input.from)))
  if (input.to) filters.push(lte(purchaseOrders.mdApprovedAt, istEnd(input.to)))
  const where = and(...filters)

  const [{ total }] = await db.select({ total: count() }).from(purchaseOrders).where(where)
  const list = await db.select({ po: purchaseOrders, approverName: users.fullName })
    .from(purchaseOrders)
    .leftJoin(users, eq(users.id, purchaseOrders.mdApprovedBy))
    .where(where)
    .orderBy(desc(purchaseOrders.mdApprovedAt))
    .limit(pageSize).offset(offset)

  const out: CaPurchaseOrderRow[] = list.map(({ po, approverName }) => {
    const key = branchKey(po.brand)
    const invoices = [po.invoice1Url, po.invoice2Url, po.invoice3Url, po.invoice4Url].filter((u): u is string => Boolean(u))
    const quotations = [po.quotation1Url, po.quotation2Url, po.quotation3Url].filter((u): u is string => Boolean(u))
    const bills = Array.isArray(po.billImages) ? po.billImages.filter(Boolean) : []
    return {
      id: po.id, orderNumber: po.orderNumber, branch: key, branchLabel: branchLabelFor(key),
      vendorName: po.vendorName, department: po.department, subDepartment: po.subDepartment, reqType: po.reqType,
      amount: parsePoAmount(po.amount, po.estimateIfAny), status: po.status,
      approvedAt: iso(po.mdApprovedAt), approverName: approverName || null, createdAt: iso(po.createdAt) || '',
      documents: { invoices, quotations, bills },
    }
  })
  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

export async function listCaPettyCashFunding(input: CaFilters): Promise<{ rows: CaPettyCashFundingRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const filters = [eq(pettyCashRequests.status, 'approved'), isNull(pettyCashRequests.deletedAt)]
  if (input.branch && input.branch !== 'all') filters.push(eq(pettyCashRequests.branchId, input.branch))
  if (input.from) filters.push(gte(pettyCashRequests.accountsApprovedAt, istStart(input.from)))
  if (input.to) filters.push(lte(pettyCashRequests.accountsApprovedAt, istEnd(input.to)))
  const where = and(...filters)

  const [{ total }] = await db.select({ total: count() }).from(pettyCashRequests).where(where)
  const list = await db.select({
    req: pettyCashRequests,
    location: sql<string | null>`${pettyCashRequests.requestForm} ->> 'location'`,
    approverName: users.fullName,
  })
    .from(pettyCashRequests)
    .leftJoin(users, eq(users.id, pettyCashRequests.accountsApprovedBy))
    .where(where)
    .orderBy(desc(pettyCashRequests.accountsApprovedAt))
    .limit(pageSize).offset(offset)

  const out: CaPettyCashFundingRow[] = list.map(({ req, location, approverName }) => ({
    id: req.id, requestNumber: req.requestNumber, branch: req.branchId, branchLabel: branchLabelFor(req.branchId),
    location: location || null, department: req.department, purpose: req.purpose,
    requestedAmount: parseMoney(req.requestedAmount), allocatedAmount: req.allocatedAmount != null ? parseMoney(req.allocatedAmount) : null,
    approvedAt: iso(req.accountsApprovedAt), approverName: approverName || null, createdAt: iso(req.createdAt) || '',
  }))
  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

export async function listCaPettyCashExpenses(input: CaFilters): Promise<{ rows: CaPettyCashExpenseRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const filters = [eq(pettyCashExpenses.status, 'approved'), isNull(pettyCashExpenses.deletedAt)]
  if (input.branch && input.branch !== 'all') filters.push(eq(pettyCashExpenses.branchId, input.branch))
  if (input.from) filters.push(gte(pettyCashExpenses.expenseDate, input.from))
  if (input.to) filters.push(lte(pettyCashExpenses.expenseDate, input.to))
  const where = and(...filters)

  const [{ total }] = await db.select({ total: count() }).from(pettyCashExpenses).where(where)
  const list = await db.select({
    exp: pettyCashExpenses,
    // Location = per-expense location, falling back to the originating request's location (same as listPettyCashExpenses).
    location: sql<string | null>`COALESCE(${pettyCashExpenses.expenseForm} ->> 'location', ${pettyCashRequests.requestForm} ->> 'location')`,
    department: pettyCashRequests.department,
    approverName: users.fullName,
  })
    .from(pettyCashExpenses)
    .leftJoin(pettyCashAllocations, eq(pettyCashAllocations.id, pettyCashExpenses.allocationId))
    .leftJoin(pettyCashRequests, eq(pettyCashRequests.id, pettyCashAllocations.requestId))
    .leftJoin(users, eq(users.id, pettyCashExpenses.accountsApprovedBy))
    .where(where)
    .orderBy(desc(pettyCashExpenses.expenseDate), desc(pettyCashExpenses.createdAt))
    .limit(pageSize).offset(offset)

  const out: CaPettyCashExpenseRow[] = list.map(({ exp, location, department, approverName }) => ({
    id: exp.id, expenseNumber: exp.expenseNumber, branch: exp.branchId, branchLabel: branchLabelFor(exp.branchId),
    location: location || null, department: department || null, vendorName: exp.vendorName,
    amount: parseMoney(exp.amount), particulars: exp.particulars,
    expenseDate: String(exp.expenseDate), approvedAt: iso(exp.accountsApprovedAt), approverName: approverName || null,
    billFiles: Array.isArray(exp.billFiles) ? exp.billFiles.filter(Boolean) : [],
  }))
  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}
