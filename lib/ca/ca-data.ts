import 'server-only'

import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
import {
  kiaApprovalRequests,
  pettyCashAllocations,
  pettyCashExpenses,
  pettyCashRequests,
  purchaseOrders,
  users,
} from '@/lib/db/schema'
import { BRANCH_OPTIONS, getBranchLabel } from '@/lib/branches'

// Read-only Chartered-Accountant data layer. Reads MD Approved AND Rejected records across:
//   1. Vendor Payment Approvals (kia_approval_requests)
//   2. Petty Cash Expenses & Funding (petty_cash_expenses, petty_cash_requests)
//   3. Purchase Orders (purchase_orders)
//
// Gated solely by `canViewCa()` (CA / MD / Developer + explicit ca.view grants in Access Map).

const UNASSIGNED = 'unassigned'

export type CaMetric = {
  approvedCount: number
  approvedAmount: number
}

export type CaBranchSummaryRow = {
  branch: string
  branchLabel: string
  approvals: CaMetric
  po: CaMetric
  pettyCashFunding: CaMetric
  /**
   * Approved petty-cash EXPENSES (money actually spent out of the funding). Reported beside the others, NOT
   * added to `total`: it is drawn from `pettyCashFunding`, so adding it would count the same rupees twice.
   */
  pettyCashSpend: CaMetric
  total: CaMetric
}

export type CaSummaryResponse = {
  branches: CaBranchSummaryRow[]
  unassigned: CaBranchSummaryRow | null
  totals: {
    approvals: CaMetric
    po: CaMetric
    pettyCashFunding: CaMetric
    pettyCashSpend: CaMetric
    total: CaMetric
  }
  filters: { from: string | null; to: string | null }
}

export type CaFilters = {
  branch?: string | null
  decision?: 'all' | 'approved' | 'rejected' | null
  from?: string | null
  to?: string | null
  search?: string | null
  page?: number
  pageSize?: number
}

export type CaPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type CaApprovalRequestRow = {
  id: string
  requestNo: string | null
  brand: string
  branchLabel: string
  location: string | null
  dealerName: string | null
  department: string | null
  approvalType: string | null
  vendorName: string | null
  amount: number
  typeOfPayment: string | null
  remarks: string | null
  managementApproval: string | null
  managementRemarks: string | null
  mdApproverName: string | null
  mdActionTime: string | null
  rejectedByName: string | null
  paymentStatus: string
  utrNumber: string | null
  invoiceNumber: string | null
  gst: string | null
  vehicleNumber: string | null
  createdAt: string
  updatedAt: string
  vpApproval: string | null
  hrApproval: string | null
  eaApproval: string | null
  accountApproval: string | null
  sendBackReason: string | null
  history: Array<{
    id?: string
    role?: string
    roleKey?: string
    user?: string
    action?: string
    remarks?: string
    timestamp?: string
  }>
  documents: {
    bills: string[]
    invoices: string[]
    docs: string[]
    paymentProof: string | null
  }
}

export type CaPurchaseOrderRow = {
  id: string
  orderNumber: string
  branch: string
  branchLabel: string
  vendorName: string | null
  department: string | null
  subDepartment: string | null
  reqType: string | null
  amount: number
  status: string
  mdApprovalStatus: string | null
  mdApprovalRemarks: string | null
  approvedAt: string | null
  approverName: string | null
  mdApproverName: string | null
  eaApproverName: string | null
  createdAt: string
  documents: { invoices: string[]; quotations: string[]; bills: string[] }
}

export type CaPettyCashExpenseItem = {
  id: string
  expenseNumber: string
  particulars: string
  amount: number
  billFiles: string[]
  createdAt?: string
}

export type CaPettyCashFundingRow = {
  id: string
  requestNumber: string
  branch: string
  branchLabel: string
  location: string | null
  department: string | null
  purpose: string
  status: string
  requestedAmount: number
  allocatedAmount: number | null
  approvedAt: string | null
  approverName: string | null
  mdApproverName: string | null
  rejectedByName: string | null
  edApproverName: string | null
  eaApproverName: string | null
  createdAt: string
  mdRemarks: string | null
  rejectedAt: string | null
  supportingFiles: string[]
  expenses: CaPettyCashExpenseItem[]
  documents: {
    supportingFiles: string[]
    bills: string[]
  }
}

// --- helpers ---
function parseMoney(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function parsePoAmount(amount: string | null, estimate: string | null): number {
  const raw = amount || estimate || '0'
  const n = Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function branchKey(brand: string | null | undefined): string {
  const v = String(brand || '').trim().toLowerCase()
  return v || UNASSIGNED
}

function branchLabelFor(key: string): string {
  return key === UNASSIGNED ? 'Unassigned' : getBranchLabel(key)
}

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`)
const istEnd = (d: string) => new Date(`${d}T23:59:59+05:30`)
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
function rows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : []
}

function emptyMetric(): CaMetric {
  return { approvedCount: 0, approvedAmount: 0 }
}

function emptyRow(branch: string): CaBranchSummaryRow {
  return {
    branch,
    branchLabel: branchLabelFor(branch),
    approvals: emptyMetric(),
    po: emptyMetric(),
    pettyCashFunding: emptyMetric(),
    pettyCashSpend: emptyMetric(),
    total: emptyMetric(),
  }
}

function clampPage(input: CaFilters) {
  const page = Math.max(1, Math.floor(Number(input.page) || 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(input.pageSize) || 25)))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

function pagination(page: number, pageSize: number, total: number): CaPagination {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

function poBranchFilter(branch?: string | null) {
  if (!branch || branch === 'all') return undefined
  if (branch === UNASSIGNED) return isNull(purchaseOrders.brand)
  return eq(purchaseOrders.brand, branch)
}

function extractApproverDetails(history: any[] | null | undefined, managementApproval: string | null) {
  const list = Array.isArray(history) ? history : []
  let mdApproverName: string | null = null
  let mdActionTime: string | null = null
  let rejectedByName: string | null = null

  // Search history in reverse to find the latest action by MD stage
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]
    if (!h) continue
    const roleKey = String(h.roleKey || '').toLowerCase()
    const role = String(h.role || '').toUpperCase()
    const action = String(h.action || '').toUpperCase()

    const isMdRole =
      roleKey === 'md' ||
      roleKey === 'ceo' ||
      roleKey === 'management' ||
      role === 'MD' ||
      role === 'CEO' ||
      role.includes('MANAGEMENT') ||
      role.includes('MANAGING DIRECTOR') ||
      role.includes('DIRECTOR')

    if (
      !mdApproverName &&
      isMdRole &&
      (action.startsWith('APPROV') || action === 'PAID' || action === 'ACCEPTED')
    ) {
      if (h.user && String(h.user).trim()) {
        mdApproverName = String(h.user).trim()
        mdActionTime = h.timestamp || null
      }
    }

    if (
      !rejectedByName &&
      (action.includes('NOT APPROVED') ||
        action.includes('REJECT') ||
        action.includes('DENIED') ||
        action.includes('SENT BACK'))
    ) {
      if (h.user && String(h.user).trim()) {
        rejectedByName = String(h.user).trim()
      }
    }
  }

  // If management_approval is APPROVED but no user in history (e.g. legacy/direct approval), label as MD Approval
  if (!mdApproverName && managementApproval && managementApproval.toUpperCase().startsWith('APPROV')) {
    mdApproverName = 'MD Approval'
  }

  return { mdApproverName, mdActionTime, rejectedByName }
}

// ── 1. Vendor Payment Approvals (MD Approved & Accounts Completed) ─────────────────────────
export async function listCaApprovalRequests(
  input: CaFilters
): Promise<{ rows: CaApprovalRequestRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)

  const filters: any[] = [
    // Strict requirement: Only completed by accounts AND approved by MD
    sql`(${kiaApprovalRequests.managementApproval} ILIKE 'APPROVED%' AND (${kiaApprovalRequests.paymentStatus} = 'PAID' OR ${kiaApprovalRequests.paymentStatus} = 'COMPLETED' OR ${kiaApprovalRequests.accountApproval} = 'APPROVED'))`,
  ]

  // Branch / Brand filter
  if (input.branch && input.branch !== 'all') {
    if (input.branch === UNASSIGNED) {
      filters.push(isNull(kiaApprovalRequests.brand))
    } else {
      filters.push(eq(kiaApprovalRequests.brand, input.branch))
    }
  }

  // Date filters
  if (input.from) {
    filters.push(gte(kiaApprovalRequests.createdAt, istStart(input.from)))
  }
  if (input.to) {
    filters.push(lte(kiaApprovalRequests.createdAt, istEnd(input.to)))
  }

  // Search filter
  if (input.search && input.search.trim()) {
    const s = `%${input.search.trim()}%`
    filters.push(
      sql`(${kiaApprovalRequests.requestNo} ILIKE ${s} OR ${kiaApprovalRequests.vendorName} ILIKE ${s} OR ${kiaApprovalRequests.location} ILIKE ${s} OR ${kiaApprovalRequests.department} ILIKE ${s} OR ${kiaApprovalRequests.invoiceNumber} ILIKE ${s} OR ${kiaApprovalRequests.vehicleNumber} ILIKE ${s} OR ${kiaApprovalRequests.gst} ILIKE ${s} OR ${kiaApprovalRequests.utrNumber} ILIKE ${s})`
    )
  }

  const where = and(...filters)

  const [{ total }] = await db.select({ total: count() }).from(kiaApprovalRequests).where(where)
  const list = await db
    .select()
    .from(kiaApprovalRequests)
    .where(where)
    .orderBy(desc(kiaApprovalRequests.createdAt))
    .limit(pageSize)
    .offset(offset)

  const out: CaApprovalRequestRow[] = list.map((r) => {
    const key = branchKey(r.brand)
    const billUrls = Array.isArray(r.billUrls) ? r.billUrls.filter(Boolean) : []
    const legacyBills = [r.uploadBillUrl1, r.uploadBillUrl2].filter((u): u is string => Boolean(u))
    const bills = Array.from(new Set([...billUrls, ...legacyBills]))
    const invoices = [r.invoiceDocUrl].filter((u): u is string => Boolean(u))
    const docs = [r.uploadDocUrl].filter((u): u is string => Boolean(u))

    const { mdApproverName, mdActionTime, rejectedByName } = extractApproverDetails(
      r.history,
      r.managementApproval
    )

    return {
      id: r.id,
      requestNo: r.requestNo,
      brand: key,
      branchLabel: branchLabelFor(key),
      location: r.location,
      dealerName: r.dealerName,
      department: r.department,
      approvalType: r.approvalType,
      vendorName: r.vendorName,
      amount: parseMoney(r.amount),
      typeOfPayment: r.typeOfPayment,
      remarks: r.remarks,
      managementApproval: r.managementApproval,
      managementRemarks: r.managementRemarks,
      mdApproverName,
      mdActionTime,
      rejectedByName,
      paymentStatus: r.paymentStatus,
      utrNumber: r.utrNumber,
      invoiceNumber: r.invoiceNumber,
      gst: r.gst,
      vehicleNumber: r.vehicleNumber,
      createdAt: iso(r.createdAt) || '',
      updatedAt: iso(r.updatedAt) || '',
      vpApproval: r.vpApproval,
      hrApproval: r.hrApproval,
      eaApproval: r.eaApproval,
      accountApproval: r.accountApproval,
      sendBackReason: r.sendBackReason,
      history: Array.isArray(r.history) ? r.history : [],
      documents: {
        bills,
        invoices,
        docs,
        paymentProof: r.paymentProofUrl || null,
      },
    }
  })

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 2. Petty Cash Funding (MD Approved & Accounts Funded/Completed) ─────────────────────────
export async function listCaPettyCashFunding(
  input: CaFilters
): Promise<{ rows: CaPettyCashFundingRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const filters: any[] = [
    isNull(pettyCashRequests.deletedAt),
    // Strict requirement: Only completed by accounts and approved by MD
    eq(pettyCashRequests.status, 'approved'),
  ]

  if (input.branch && input.branch !== 'all') {
    filters.push(eq(pettyCashRequests.branchId, input.branch))
  }
  if (input.from) {
    filters.push(gte(pettyCashRequests.accountsApprovedAt, istStart(input.from)))
  }
  if (input.to) {
    filters.push(lte(pettyCashRequests.accountsApprovedAt, istEnd(input.to)))
  }
  if (input.search && input.search.trim()) {
    const s = `%${input.search.trim()}%`
    filters.push(
      sql`(${pettyCashRequests.requestNumber} ILIKE ${s} OR ${pettyCashRequests.purpose} ILIKE ${s})`
    )
  }

  const where = and(...filters)

  const mdUser = alias(users, 'fund_md_user')
  const rejUser = alias(users, 'fund_rej_user')
  const accUser = alias(users, 'fund_acc_user')
  const eaUser = alias(users, 'fund_ea_user')
  const edUser = alias(users, 'fund_ed_user')

  const [{ total }] = await db.select({ total: count() }).from(pettyCashRequests).where(where)
  const list = await db
    .select({
      req: pettyCashRequests,
      location: sql<string | null>`${pettyCashRequests.requestForm} ->> 'location'`,
      mdApproverName: mdUser.fullName,
      rejectedByName: rejUser.fullName,
      accountsApproverName: accUser.fullName,
      eaApproverName: eaUser.fullName,
      edApproverName: edUser.fullName,
    })
    .from(pettyCashRequests)
    .leftJoin(mdUser, eq(mdUser.id, pettyCashRequests.mdApprovedBy))
    .leftJoin(rejUser, eq(rejUser.id, pettyCashRequests.rejectedBy))
    .leftJoin(accUser, eq(accUser.id, pettyCashRequests.accountsApprovedBy))
    .leftJoin(eaUser, eq(eaUser.id, pettyCashRequests.eaApprovedBy))
    .leftJoin(edUser, eq(edUser.id, pettyCashRequests.edApprovedBy))
    .where(where)
    .orderBy(desc(pettyCashRequests.accountsApprovedAt), desc(pettyCashRequests.createdAt))
    .limit(pageSize)
    .offset(offset)

  const reqIds = list.map((r) => r.req.id).filter(Boolean)
  const expensesByReqId = new Map<string, CaPettyCashExpenseItem[]>()

  if (reqIds.length > 0) {
    const expRows = await db
      .select({
        id: pettyCashExpenses.id,
        allocationRequestId: pettyCashAllocations.requestId,
        expenseNumber: pettyCashExpenses.expenseNumber,
        particulars: pettyCashExpenses.particulars,
        amount: pettyCashExpenses.amount,
        billFiles: pettyCashExpenses.billFiles,
        createdAt: pettyCashExpenses.createdAt,
      })
      .from(pettyCashExpenses)
      .leftJoin(pettyCashAllocations, eq(pettyCashExpenses.allocationId, pettyCashAllocations.id))
      .where(
        and(
          isNull(pettyCashExpenses.deletedAt),
          sql`${pettyCashAllocations.requestId} IN ${reqIds}`
        )
      )

    for (const exp of expRows) {
      const parentId = exp.allocationRequestId
      if (!parentId) continue
      const rawBills = Array.isArray(exp.billFiles)
        ? (exp.billFiles as (string | null | undefined)[]).filter((u): u is string => Boolean(u))
        : []
      const item: CaPettyCashExpenseItem = {
        id: exp.id,
        expenseNumber: exp.expenseNumber,
        particulars: exp.particulars || '',
        amount: parseMoney(exp.amount),
        billFiles: rawBills,
        createdAt: iso(exp.createdAt) || undefined,
      }
      const existing = expensesByReqId.get(parentId) || []
      existing.push(item)
      expensesByReqId.set(parentId, existing)
    }
  }

  const out: CaPettyCashFundingRow[] = list.map(
    ({
      req,
      location,
      mdApproverName,
      rejectedByName,
      eaApproverName,
      edApproverName,
    }) => {
      const resolvedMdApprover =
        mdApproverName ||
        (req.status === 'approved' ? 'MD Approval' : null)

      const supportingFiles = Array.isArray(req.supportingFiles)
        ? (req.supportingFiles as (string | null | undefined)[]).filter((u): u is string => Boolean(u))
        : []

      const expenses = expensesByReqId.get(req.id) || []
      const allBills = Array.from(new Set(expenses.flatMap((e) => e.billFiles)))

      return {
        id: req.id,
        requestNumber: req.requestNumber,
        branch: req.branchId,
        branchLabel: branchLabelFor(req.branchId),
        location: location || null,
        department: req.department,
        purpose: req.purpose,
        status: req.status,
        requestedAmount: parseMoney(req.requestedAmount),
        allocatedAmount: req.allocatedAmount != null ? parseMoney(req.allocatedAmount) : null,
        approvedAt: iso(req.accountsApprovedAt || req.mdApprovedAt),
        approverName: resolvedMdApprover,
        mdApproverName: resolvedMdApprover,
        rejectedByName: rejectedByName || null,
        edApproverName: edApproverName || null,
        eaApproverName: eaApproverName || null,
        createdAt: iso(req.createdAt) || '',
        mdRemarks: req.mdRemarks || null,
        rejectedAt: iso(req.rejectedAt),
        supportingFiles,
        expenses,
        documents: {
          supportingFiles,
          bills: allBills,
        },
      }
    }
  )

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 3. Purchase Orders (MD Approved & Accounts Completed) ──────────────────────────────────
export async function listCaPurchaseOrders(
  input: CaFilters
): Promise<{ rows: CaPurchaseOrderRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const filters: any[] = [
    isNull(purchaseOrders.deletedAt),
    // Strict requirement: Only completed by accounts AND approved by MD
    eq(purchaseOrders.mdApprovalStatus, 'approved'),
    eq(purchaseOrders.status, 'completed'),
  ]

  const branchFilter = poBranchFilter(input.branch)
  if (branchFilter) filters.push(branchFilter)
  if (input.from) filters.push(gte(purchaseOrders.mdApprovedAt, istStart(input.from)))
  if (input.to) filters.push(lte(purchaseOrders.mdApprovedAt, istEnd(input.to)))
  if (input.search && input.search.trim()) {
    const s = `%${input.search.trim()}%`
    filters.push(
      sql`(${purchaseOrders.orderNumber} ILIKE ${s} OR ${purchaseOrders.vendorName} ILIKE ${s} OR ${purchaseOrders.department} ILIKE ${s} OR ${purchaseOrders.subDepartment} ILIKE ${s})`
    )
  }

  const where = and(...filters)

  const mdUser = alias(users, 'po_md_user')
  const eaUser = alias(users, 'po_ea_user')

  const [{ total }] = await db.select({ total: count() }).from(purchaseOrders).where(where)
  const list = await db
    .select({
      po: purchaseOrders,
      mdApproverName: mdUser.fullName,
      eaApproverName: eaUser.fullName,
    })
    .from(purchaseOrders)
    .leftJoin(mdUser, eq(mdUser.id, purchaseOrders.mdApprovedBy))
    .leftJoin(eaUser, eq(eaUser.id, purchaseOrders.eaApprovedBy))
    .where(where)
    .orderBy(desc(purchaseOrders.mdApprovedAt), desc(purchaseOrders.createdAt))
    .limit(pageSize)
    .offset(offset)

  const out: CaPurchaseOrderRow[] = list.map(({ po, mdApproverName, eaApproverName }) => {
    const key = branchKey(po.brand)
    const invoices = [po.invoice1Url, po.invoice2Url, po.invoice3Url, po.invoice4Url].filter(
      (u): u is string => Boolean(u)
    )
    const quotations = [po.quotation1Url, po.quotation2Url, po.quotation3Url].filter(
      (u): u is string => Boolean(u)
    )
    const bills = Array.isArray(po.billImages) ? po.billImages.filter(Boolean) : []
    const resolvedMdApprover = mdApproverName || (po.mdApprovalStatus === 'approved' ? 'MD Approval' : null)

    return {
      id: po.id,
      orderNumber: po.orderNumber,
      branch: key,
      branchLabel: branchLabelFor(key),
      vendorName: po.vendorName,
      department: po.department,
      subDepartment: po.subDepartment,
      reqType: po.reqType,
      amount: parsePoAmount(po.amount, po.estimateIfAny),
      status: po.status,
      mdApprovalStatus: po.mdApprovalStatus,
      mdApprovalRemarks: po.mdApprovalRemarks,
      approvedAt: iso(po.mdApprovedAt),
      approverName: resolvedMdApprover,
      mdApproverName: resolvedMdApprover,
      eaApproverName: eaApproverName || null,
      createdAt: iso(po.createdAt) || '',
      documents: { invoices, quotations, bills },
    }
  })

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 4. Branch Summary & KPIs (MD Approved & Accounts Completed) ────────────────────────────
export async function getCaBranchSummary(
  filters: Pick<CaFilters, 'from' | 'to'>
): Promise<CaSummaryResponse> {
  const from = filters.from || null
  const to = filters.to || null
  const map = new Map<string, CaBranchSummaryRow>()
  const ensure = (key: string) => {
    const existing = map.get(key)
    if (existing) return existing
    const r = emptyRow(key)
    map.set(key, r)
    return r
  }

  // 1. Approvals (Completed & MD Approved)

  // 2. POs (Completed & MD Approved)
  const poFilters = [
    isNull(purchaseOrders.deletedAt),
    eq(purchaseOrders.mdApprovalStatus, 'approved'),
    eq(purchaseOrders.status, 'completed'),
  ]
  if (from) poFilters.push(gte(purchaseOrders.createdAt, istStart(from)))
  if (to) poFilters.push(lte(purchaseOrders.createdAt, istEnd(to)))

  const [approvalResult, poRows, fundingResult, spendResult] = await Promise.all([
    db.execute(sql`
      SELECT 
        COALESCE(LOWER(TRIM(brand)), 'unassigned') AS branch,
        COUNT(*)::int AS approved_cnt,
        COALESCE(SUM(amount), 0)::float AS approved_total
      FROM kia_approval_requests
      WHERE management_approval ILIKE 'APPROVED%' 
        AND (payment_status = 'PAID' OR payment_status = 'COMPLETED' OR account_approval = 'APPROVED')
        ${from ? sql`AND created_at >= ${istStart(from).toISOString()}::timestamptz` : sql``}
        ${to ? sql`AND created_at <= ${istEnd(to).toISOString()}::timestamptz` : sql``}
      GROUP BY COALESCE(LOWER(TRIM(brand)), 'unassigned')`),
    db
      .select({
        brand: purchaseOrders.brand,
        amount: purchaseOrders.amount,
        estimate: purchaseOrders.estimateIfAny,
      })
      .from(purchaseOrders)
      .where(and(...poFilters)),
    db.execute(sql`
      SELECT 
        COALESCE(LOWER(TRIM(branch_id)), 'unassigned') AS branch,
        COUNT(*)::int AS approved_cnt,
        COALESCE(SUM(COALESCE(allocated_amount, requested_amount)), 0)::float AS approved_total
      FROM petty_cash_requests
      WHERE deleted_at IS NULL AND status = 'approved'
        ${from ? sql`AND created_at >= ${istStart(from).toISOString()}::timestamptz` : sql``}
        ${to ? sql`AND created_at <= ${istEnd(to).toISOString()}::timestamptz` : sql``}
      GROUP BY COALESCE(LOWER(TRIM(branch_id)), 'unassigned')`),
    // Approved spend — the Petty Cash section's own rule (status 'approved', not deleted), dated by
    // expense_date as that section dates spend, and keyed like funding so the two columns line up.
    db.execute(sql`
      SELECT
        COALESCE(LOWER(TRIM(branch_id)), 'unassigned') AS branch,
        COUNT(*)::int AS approved_cnt,
        COALESCE(SUM(amount), 0)::float AS approved_total
      FROM petty_cash_expenses
      WHERE deleted_at IS NULL AND status = 'approved'
        ${from ? sql`AND expense_date >= ${from}::date` : sql``}
        ${to ? sql`AND expense_date <= ${to}::date` : sql``}
      GROUP BY COALESCE(LOWER(TRIM(branch_id)), 'unassigned')`),
  ])

  // Populate Approvals
  for (const r of rows(approvalResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.approvals.approvedCount = Number(r.approved_cnt) || 0
    row.approvals.approvedAmount = parseMoney(r.approved_total)
  }

  // Populate POs
  for (const r of poRows) {
    const row = ensure(branchKey(r.brand))
    const amt = parsePoAmount(r.amount, r.estimate)
    row.po.approvedCount += 1
    row.po.approvedAmount += amt
  }

  // Populate Petty Cash Funding
  for (const r of rows(fundingResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashFunding.approvedCount = Number(r.approved_cnt) || 0
    row.pettyCashFunding.approvedAmount = parseMoney(r.approved_total)
  }

  // Populate Petty Cash Spend (reported alongside; never added to `total`)
  for (const r of rows(spendResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashSpend.approvedCount = Number(r.approved_cnt) || 0
    row.pettyCashSpend.approvedAmount = parseMoney(r.approved_total)
  }

  // Calculate totals per branch
  for (const row of map.values()) {
    row.total.approvedCount =
      row.approvals.approvedCount + row.po.approvedCount + row.pettyCashFunding.approvedCount
    row.total.approvedAmount =
      row.approvals.approvedAmount + row.po.approvedAmount + row.pettyCashFunding.approvedAmount
  }

  const hasActivity = (r: CaBranchSummaryRow) => r.total.approvedCount > 0

  const branches = BRANCH_OPTIONS.map((b) => map.get(b.value.toLowerCase())).filter(
    (r): r is CaBranchSummaryRow => Boolean(r) && hasActivity(r!)
  )
  const unassigned =
    map.get(UNASSIGNED) && hasActivity(map.get(UNASSIGNED)!) ? map.get(UNASSIGNED)! : null

  const totals = {
    approvals: emptyMetric(),
    po: emptyMetric(),
    pettyCashFunding: emptyMetric(),
    pettyCashSpend: emptyMetric(),
    total: emptyMetric(),
  }

  for (const b of [...branches, ...(unassigned ? [unassigned] : [])]) {
    for (const k of ['approvals', 'po', 'pettyCashFunding', 'pettyCashSpend', 'total'] as const) {
      totals[k].approvedCount += b[k].approvedCount
      totals[k].approvedAmount += b[k].approvedAmount
    }
  }

  return { branches, unassigned, totals, filters: { from, to } }
}
