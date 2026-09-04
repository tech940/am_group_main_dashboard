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
  rejectedCount: number
  rejectedAmount: number
}

export type CaBranchSummaryRow = {
  branch: string
  branchLabel: string
  approvals: CaMetric
  po: CaMetric
  pettyCashFunding: CaMetric
  pettyCashSpend: CaMetric
}

export type CaSummaryResponse = {
  branches: CaBranchSummaryRow[]
  unassigned: CaBranchSummaryRow | null
  totals: {
    approvals: CaMetric
    po: CaMetric
    pettyCashFunding: CaMetric
    pettyCashSpend: CaMetric
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
}

export type CaPettyCashExpenseRow = {
  id: string
  expenseNumber: string
  branch: string
  branchLabel: string
  location: string | null
  department: string | null
  vendorName: string | null
  amount: number
  particulars: string
  purpose: string
  status: string
  expenseDate: string
  approvedAt: string | null
  approverName: string | null
  mdApproverName: string | null
  rejectedByName: string | null
  edApproverName: string | null
  eaApproverName: string | null
  mdRemarks: string | null
  rejectedAt: string | null
  billFiles: string[]
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
  return { approvedCount: 0, approvedAmount: 0, rejectedCount: 0, rejectedAmount: 0 }
}

function emptyRow(branch: string): CaBranchSummaryRow {
  return {
    branch,
    branchLabel: branchLabelFor(branch),
    approvals: emptyMetric(),
    po: emptyMetric(),
    pettyCashFunding: emptyMetric(),
    pettyCashSpend: emptyMetric(),
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

  // Search history in reverse to find the latest action by stage
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]
    if (!h) continue
    const roleKey = String(h.roleKey || '').toLowerCase()
    const role = String(h.role || '').toUpperCase()
    const action = String(h.action || '').toUpperCase()

    if (!mdApproverName && (roleKey === 'md' || role === 'MD' || role.includes('MANAGEMENT') || role.includes('DIRECTOR'))) {
      if (h.user && String(h.user).trim()) {
        mdApproverName = String(h.user).trim()
        mdActionTime = h.timestamp || null
      }
    }

    if (!rejectedByName && (action.includes('NOT APPROVED') || action.includes('REJECT') || action.includes('DENIED') || action.includes('SENT BACK'))) {
      if (h.user && String(h.user).trim()) {
        rejectedByName = String(h.user).trim()
      }
    }
  }

  // If management_approval is APPROVED but no user in history (e.g. legacy/direct approval), label as MD / Management
  if (!mdApproverName && managementApproval && managementApproval.toUpperCase().startsWith('APPROV')) {
    mdApproverName = 'MD / Management'
  }

  return { mdApproverName, mdActionTime, rejectedByName }
}

// ── 1. Vendor Payment Approvals ─────────────────────────────────────────────────────────────
export async function listCaApprovalRequests(
  input: CaFilters
): Promise<{ rows: CaApprovalRequestRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const decision = input.decision || 'all'

  const filters: any[] = []

  // Decision filter (MD Approved vs Rejected vs All)
  if (decision === 'approved') {
    filters.push(sql`(${kiaApprovalRequests.managementApproval} ILIKE 'APPROVED%')`)
  } else if (decision === 'rejected') {
    filters.push(
      sql`(${kiaApprovalRequests.managementApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.managementApproval} ILIKE 'REJECTED%' OR ${kiaApprovalRequests.vpApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.hrApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.eaApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.accountApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.paymentStatus} = 'REJECTED')`
    )
  } else {
    filters.push(
      sql`(${kiaApprovalRequests.managementApproval} ILIKE 'APPROVED%' OR ${kiaApprovalRequests.managementApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.managementApproval} ILIKE 'REJECTED%' OR ${kiaApprovalRequests.vpApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.hrApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.eaApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.accountApproval} ILIKE 'NOT APPROVED%' OR ${kiaApprovalRequests.paymentStatus} = 'REJECTED')`
    )
  }

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

// ── 2. Petty Cash Expenses (Spend) ─────────────────────────────────────────────────────────
export async function listCaPettyCashExpenses(
  input: CaFilters
): Promise<{ rows: CaPettyCashExpenseRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const decision = input.decision || 'all'
  const filters: any[] = [isNull(pettyCashExpenses.deletedAt)]

  if (decision === 'approved') {
    filters.push(eq(pettyCashExpenses.status, 'approved'))
  } else if (decision === 'rejected') {
    filters.push(eq(pettyCashExpenses.status, 'rejected'))
  } else {
    filters.push(sql`${pettyCashExpenses.status} IN ('approved', 'rejected')`)
  }

  if (input.branch && input.branch !== 'all') {
    filters.push(eq(pettyCashExpenses.branchId, input.branch))
  }
  if (input.from) {
    filters.push(gte(pettyCashExpenses.expenseDate, input.from))
  }
  if (input.to) {
    filters.push(lte(pettyCashExpenses.expenseDate, input.to))
  }
  if (input.search && input.search.trim()) {
    const s = `%${input.search.trim()}%`
    filters.push(
      sql`(${pettyCashExpenses.expenseNumber} ILIKE ${s} OR ${pettyCashExpenses.particulars} ILIKE ${s} OR ${pettyCashExpenses.vendorName} ILIKE ${s} OR ${pettyCashExpenses.purpose} ILIKE ${s})`
    )
  }

  const where = and(...filters)

  const mdUser = alias(users, 'exp_md_user')
  const rejUser = alias(users, 'exp_rej_user')
  const accUser = alias(users, 'exp_acc_user')
  const eaUser = alias(users, 'exp_ea_user')
  const edUser = alias(users, 'exp_ed_user')

  const [{ total }] = await db.select({ total: count() }).from(pettyCashExpenses).where(where)
  const list = await db
    .select({
      exp: pettyCashExpenses,
      location: sql<string | null>`COALESCE(${pettyCashExpenses.expenseForm} ->> 'location', ${pettyCashRequests.requestForm} ->> 'location')`,
      department: pettyCashRequests.department,
      mdApproverName: mdUser.fullName,
      rejectedByName: rejUser.fullName,
      accountsApproverName: accUser.fullName,
      eaApproverName: eaUser.fullName,
      edApproverName: edUser.fullName,
    })
    .from(pettyCashExpenses)
    .leftJoin(pettyCashAllocations, eq(pettyCashAllocations.id, pettyCashExpenses.allocationId))
    .leftJoin(pettyCashRequests, eq(pettyCashRequests.id, pettyCashAllocations.requestId))
    .leftJoin(mdUser, eq(mdUser.id, pettyCashExpenses.mdApprovedBy))
    .leftJoin(rejUser, eq(rejUser.id, pettyCashExpenses.rejectedBy))
    .leftJoin(accUser, eq(accUser.id, pettyCashExpenses.accountsApprovedBy))
    .leftJoin(eaUser, eq(eaUser.id, pettyCashExpenses.eaApprovedBy))
    .leftJoin(edUser, eq(edUser.id, pettyCashExpenses.edApprovedBy))
    .where(where)
    .orderBy(desc(pettyCashExpenses.expenseDate), desc(pettyCashExpenses.createdAt))
    .limit(pageSize)
    .offset(offset)

  const out: CaPettyCashExpenseRow[] = list.map(
    ({
      exp,
      location,
      department,
      mdApproverName,
      rejectedByName,
      accountsApproverName,
      eaApproverName,
      edApproverName,
    }) => {
      const resolvedMdApprover =
        mdApproverName ||
        (exp.status === 'approved' && !mdApproverName && !accountsApproverName ? 'MD / Management' : null)

      return {
        id: exp.id,
        expenseNumber: exp.expenseNumber,
        branch: exp.branchId,
        branchLabel: branchLabelFor(exp.branchId),
        location: location || null,
        department: department || null,
        vendorName: exp.vendorName,
        amount: parseMoney(exp.amount),
        particulars: exp.particulars,
        purpose: exp.purpose,
        status: exp.status,
        expenseDate: String(exp.expenseDate),
        approvedAt: iso(exp.accountsApprovedAt || exp.mdApprovedAt),
        approverName: resolvedMdApprover || accountsApproverName || eaApproverName || edApproverName || null,
        mdApproverName: resolvedMdApprover,
        rejectedByName: rejectedByName || null,
        edApproverName: edApproverName || null,
        eaApproverName: eaApproverName || null,
        mdRemarks: exp.mdRemarks || null,
        rejectedAt: iso(exp.rejectedAt),
        billFiles: Array.isArray(exp.billFiles) ? exp.billFiles.filter(Boolean) : [],
      }
    }
  )

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 3. Petty Cash Funding (Allocations/Requests) ───────────────────────────────────────────
export async function listCaPettyCashFunding(
  input: CaFilters
): Promise<{ rows: CaPettyCashFundingRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const decision = input.decision || 'all'
  const filters: any[] = [isNull(pettyCashRequests.deletedAt)]

  if (decision === 'approved') {
    filters.push(eq(pettyCashRequests.status, 'approved'))
  } else if (decision === 'rejected') {
    filters.push(eq(pettyCashRequests.status, 'rejected'))
  } else {
    filters.push(sql`${pettyCashRequests.status} IN ('approved', 'rejected')`)
  }

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
    .orderBy(desc(pettyCashRequests.accountsApprovedAt))
    .limit(pageSize)
    .offset(offset)

  const out: CaPettyCashFundingRow[] = list.map(
    ({
      req,
      location,
      mdApproverName,
      rejectedByName,
      accountsApproverName,
      eaApproverName,
      edApproverName,
    }) => {
      const resolvedMdApprover =
        mdApproverName ||
        (req.status === 'approved' && !mdApproverName && !accountsApproverName ? 'MD / Management' : null)

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
        approverName: resolvedMdApprover || accountsApproverName || eaApproverName || edApproverName || null,
        mdApproverName: resolvedMdApprover,
        rejectedByName: rejectedByName || null,
        edApproverName: edApproverName || null,
        eaApproverName: eaApproverName || null,
        createdAt: iso(req.createdAt) || '',
        mdRemarks: req.mdRemarks || null,
        rejectedAt: iso(req.rejectedAt),
        supportingFiles: Array.isArray(req.supportingFiles) ? req.supportingFiles.filter(Boolean) : [],
      }
    }
  )

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 4. Purchase Orders ────────────────────────────────────────────────────────────────────
export async function listCaPurchaseOrders(
  input: CaFilters
): Promise<{ rows: CaPurchaseOrderRow[]; pagination: CaPagination }> {
  const { page, pageSize, offset } = clampPage(input)
  const decision = input.decision || 'all'
  const filters: any[] = [isNull(purchaseOrders.deletedAt)]

  if (decision === 'approved') {
    filters.push(eq(purchaseOrders.mdApprovalStatus, 'approved'))
  } else if (decision === 'rejected') {
    filters.push(
      sql`(${purchaseOrders.mdApprovalStatus} = 'denied' OR ${purchaseOrders.status} = 'cancelled')`
    )
  } else {
    filters.push(
      sql`(${purchaseOrders.mdApprovalStatus} IN ('approved', 'denied') OR ${purchaseOrders.status} = 'cancelled')`
    )
  }

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
    .orderBy(desc(purchaseOrders.mdApprovedAt))
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
    const resolvedMdApprover = mdApproverName || (po.mdApprovalStatus === 'approved' ? 'MD / Management' : null)

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
      approverName: resolvedMdApprover || eaApproverName || null,
      mdApproverName: resolvedMdApprover,
      eaApproverName: eaApproverName || null,
      createdAt: iso(po.createdAt) || '',
      documents: { invoices, quotations, bills },
    }
  })

  return { rows: out, pagination: pagination(page, pageSize, Number(total) || 0) }
}

// ── 5. Branch Summary & KPIs ───────────────────────────────────────────────────────────────
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

  // 1. Approvals (Approved & Rejected)
  const approvalDateFilter = []
  if (from) approvalDateFilter.push(sql`AND created_at >= ${istStart(from).toISOString()}::timestamptz`)
  if (to) approvalDateFilter.push(sql`AND created_at <= ${istEnd(to).toISOString()}::timestamptz`)

  // 2. POs (Approved & Rejected)
  const poFilters = [isNull(purchaseOrders.deletedAt)]
  if (from) poFilters.push(gte(purchaseOrders.createdAt, istStart(from)))
  if (to) poFilters.push(lte(purchaseOrders.createdAt, istEnd(to)))

  const [approvalResult, poRows, fundingResult, spendResult] = await Promise.all([
    db.execute(sql`
      SELECT 
        COALESCE(LOWER(TRIM(brand)), 'unassigned') AS branch,
        COUNT(CASE WHEN management_approval ILIKE 'APPROVED%' THEN 1 END)::int AS approved_cnt,
        COALESCE(SUM(CASE WHEN management_approval ILIKE 'APPROVED%' THEN amount ELSE 0 END), 0)::float AS approved_total,
        COUNT(CASE WHEN management_approval ILIKE 'NOT APPROVED%' OR management_approval ILIKE 'REJECTED%' OR vp_approval ILIKE 'NOT APPROVED%' OR hr_approval ILIKE 'NOT APPROVED%' OR ea_approval ILIKE 'NOT APPROVED%' OR account_approval ILIKE 'NOT APPROVED%' OR payment_status = 'REJECTED' THEN 1 END)::int AS rejected_cnt,
        COALESCE(SUM(CASE WHEN management_approval ILIKE 'NOT APPROVED%' OR management_approval ILIKE 'REJECTED%' OR vp_approval ILIKE 'NOT APPROVED%' OR hr_approval ILIKE 'NOT APPROVED%' OR ea_approval ILIKE 'NOT APPROVED%' OR account_approval ILIKE 'NOT APPROVED%' OR payment_status = 'REJECTED' THEN amount ELSE 0 END), 0)::float AS rejected_total
      FROM kia_approval_requests
      WHERE (management_approval ILIKE 'APPROVED%' OR management_approval ILIKE 'NOT APPROVED%' OR management_approval ILIKE 'REJECTED%' OR vp_approval ILIKE 'NOT APPROVED%' OR hr_approval ILIKE 'NOT APPROVED%' OR ea_approval ILIKE 'NOT APPROVED%' OR account_approval ILIKE 'NOT APPROVED%' OR payment_status = 'REJECTED')
        ${sql.raw(approvalDateFilter.map((f) => f.queryChunks.join('')).join(' '))}
      GROUP BY COALESCE(LOWER(TRIM(brand)), 'unassigned')`),
    db
      .select({
        brand: purchaseOrders.brand,
        amount: purchaseOrders.amount,
        estimate: purchaseOrders.estimateIfAny,
        mdApprovalStatus: purchaseOrders.mdApprovalStatus,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .where(and(...poFilters)),
    db.execute(sql`
      SELECT 
        COALESCE(LOWER(TRIM(branch_id)), 'unassigned') AS branch,
        COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS approved_cnt,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN requested_amount ELSE 0 END), 0)::float AS approved_total,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected_cnt,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN requested_amount ELSE 0 END), 0)::float AS rejected_total
      FROM petty_cash_requests
      WHERE deleted_at IS NULL AND status IN ('approved', 'rejected')
        ${from ? sql`AND created_at >= ${istStart(from).toISOString()}::timestamptz` : sql``}
        ${to ? sql`AND created_at <= ${istEnd(to).toISOString()}::timestamptz` : sql``}
      GROUP BY COALESCE(LOWER(TRIM(branch_id)), 'unassigned')`),
    db.execute(sql`
      SELECT 
        COALESCE(LOWER(TRIM(branch_id)), 'unassigned') AS branch,
        COUNT(CASE WHEN status = 'approved' THEN 1 END)::int AS approved_cnt,
        COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0)::float AS approved_total,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected_cnt,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN amount ELSE 0 END), 0)::float AS rejected_total
      FROM petty_cash_expenses
      WHERE deleted_at IS NULL AND status IN ('approved', 'rejected')
        ${from ? sql`AND expense_date >= ${from}::date` : sql``}
        ${to ? sql`AND expense_date <= ${to}::date` : sql``}
      GROUP BY COALESCE(LOWER(TRIM(branch_id)), 'unassigned')`),
  ])

  // Populate Approvals
  for (const r of rows(approvalResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.approvals.approvedCount = Number(r.approved_cnt) || 0
    row.approvals.approvedAmount = parseMoney(r.approved_total)
    row.approvals.rejectedCount = Number(r.rejected_cnt) || 0
    row.approvals.rejectedAmount = parseMoney(r.rejected_total)
  }

  // Populate POs
  for (const r of poRows) {
    const row = ensure(branchKey(r.brand))
    const amt = parsePoAmount(r.amount, r.estimate)
    if (r.mdApprovalStatus === 'approved') {
      row.po.approvedCount += 1
      row.po.approvedAmount += amt
    } else if (r.mdApprovalStatus === 'denied' || r.status === 'cancelled') {
      row.po.rejectedCount += 1
      row.po.rejectedAmount += amt
    }
  }

  // Populate Petty Cash Funding
  for (const r of rows(fundingResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashFunding.approvedCount = Number(r.approved_cnt) || 0
    row.pettyCashFunding.approvedAmount = parseMoney(r.approved_total)
    row.pettyCashFunding.rejectedCount = Number(r.rejected_cnt) || 0
    row.pettyCashFunding.rejectedAmount = parseMoney(r.rejected_total)
  }

  // Populate Petty Cash Spend
  for (const r of rows(spendResult)) {
    const row = ensure(branchKey(String(r.branch || '')))
    row.pettyCashSpend.approvedCount = Number(r.approved_cnt) || 0
    row.pettyCashSpend.approvedAmount = parseMoney(r.approved_total)
    row.pettyCashSpend.rejectedCount = Number(r.rejected_cnt) || 0
    row.pettyCashSpend.rejectedAmount = parseMoney(r.rejected_total)
  }

  const hasActivity = (r: CaBranchSummaryRow) =>
    r.approvals.approvedCount > 0 ||
    r.approvals.rejectedCount > 0 ||
    r.po.approvedCount > 0 ||
    r.po.rejectedCount > 0 ||
    r.pettyCashFunding.approvedCount > 0 ||
    r.pettyCashFunding.rejectedCount > 0 ||
    r.pettyCashSpend.approvedCount > 0 ||
    r.pettyCashSpend.rejectedCount > 0

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
  }
  for (const b of [...branches, ...(unassigned ? [unassigned] : [])]) {
    for (const k of ['approvals', 'po', 'pettyCashFunding', 'pettyCashSpend'] as const) {
      totals[k].approvedCount += b[k].approvedCount
      totals[k].approvedAmount += b[k].approvedAmount
      totals[k].rejectedCount += b[k].rejectedCount
      totals[k].rejectedAmount += b[k].rejectedAmount
    }
  }

  return { branches, unassigned, totals, filters: { from, to } }
}
