'use client'

import { useState, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  Loader2,
  ShoppingCart,
  Banknote,
  Wallet,
  FileText,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
  CheckCircle2,
  XCircle,
  FileCheck,
  Building2,
  Calendar,
  Download,
  Eye,
  Receipt,
  RotateCcw,
  X,
  FileSpreadsheet,
  Layers,
  ArrowUpRight,
  Clock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BRANCH_OPTIONS, ALL_BRANCH_OPTION } from '@/lib/branches'
import { cn } from '@/lib/utils'
import { formatIndiaDate } from '@/lib/date-time'
import type {
  CaApprovalRequestRow,
  CaPettyCashExpenseRow,
  CaPettyCashFundingRow,
  CaPurchaseOrderRow,
  CaSummaryResponse,
  CaPagination,
} from '@/lib/ca/ca-data'

const BRANCH_ITEMS = [ALL_BRANCH_OPTION, ...BRANCH_OPTIONS]

function formatCurrency(v: number) {
  const n = Number.isFinite(v) ? v : 0
  const r = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  if (r >= 10000000) return `${sign}₹${(r / 10000000).toFixed(2)}Cr`
  if (r >= 100000) return `${sign}₹${(r / 100000).toFixed(2)}L`
  return `${sign}₹${r.toLocaleString('en-IN')}`
}

function formatInt(v: number) {
  return Math.round(Number.isFinite(v) ? v : 0).toLocaleString('en-IN')
}

const formatDate = (iso: string | null) => (iso ? formatIndiaDate(iso) : '—')

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to load data')
  }
  return res.json()
}

function qs(params: Record<string, string | number | null | undefined>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  }
  return p.toString()
}

export function CaDashboard() {
  const [branch, setBranch] = useState('all')
  const [decision, setDecision] = useState<'all' | 'approved' | 'rejected'>('all')
  const [tab, setTab] = useState<'approvals' | 'petty_expenses' | 'petty_funding' | 'po' | 'summary'>('approvals')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')
  const [page, setPage] = useState(1)

  // Drawer / Inspection state
  const [inspectItem, setInspectItem] = useState<{
    type: 'approval' | 'expense' | 'funding' | 'po'
    data: any
  } | null>(null)

  // Document preview modal
  const [previewDoc, setPreviewDoc] = useState<{ title: string; url: string } | null>(null)

  // 1. Summary Query
  const summaryQ = useQuery<CaSummaryResponse>({
    queryKey: ['ca', 'summary', appliedFrom, appliedTo],
    queryFn: () => fetchJson(`/api/ca/summary?${qs({ from: appliedFrom, to: appliedTo })}`),
  })

  // 2. Approvals Query
  const approvalsQ = useQuery<{ rows: CaApprovalRequestRow[]; pagination: CaPagination }>({
    queryKey: ['ca', 'approvals', branch, decision, appliedFrom, appliedTo, debouncedSearch, page],
    queryFn: () =>
      fetchJson(
        `/api/ca/approvals?${qs({
          branch,
          decision,
          from: appliedFrom,
          to: appliedTo,
          search: debouncedSearch,
          page,
        })}`
      ),
    placeholderData: keepPreviousData,
    enabled: tab === 'approvals',
  })

  // 3. Petty Cash Expenses Query
  const expensesQ = useQuery<{ dataset: string; rows: CaPettyCashExpenseRow[]; pagination: CaPagination }>({
    queryKey: ['ca', 'petty_expenses', branch, decision, appliedFrom, appliedTo, debouncedSearch, page],
    queryFn: () =>
      fetchJson(
        `/api/ca/petty-cash?${qs({
          dataset: 'expenses',
          branch,
          decision,
          from: appliedFrom,
          to: appliedTo,
          search: debouncedSearch,
          page,
        })}`
      ),
    placeholderData: keepPreviousData,
    enabled: tab === 'petty_expenses',
  })

  // 4. Petty Cash Funding Query
  const fundingQ = useQuery<{ dataset: string; rows: CaPettyCashFundingRow[]; pagination: CaPagination }>({
    queryKey: ['ca', 'petty_funding', branch, decision, appliedFrom, appliedTo, debouncedSearch, page],
    queryFn: () =>
      fetchJson(
        `/api/ca/petty-cash?${qs({
          dataset: 'funding',
          branch,
          decision,
          from: appliedFrom,
          to: appliedTo,
          search: debouncedSearch,
          page,
        })}`
      ),
    placeholderData: keepPreviousData,
    enabled: tab === 'petty_funding',
  })

  // 5. Purchase Orders Query
  const poQ = useQuery<{ rows: CaPurchaseOrderRow[]; pagination: CaPagination }>({
    queryKey: ['ca', 'po', branch, decision, appliedFrom, appliedTo, debouncedSearch, page],
    queryFn: () =>
      fetchJson(
        `/api/ca/purchase-orders?${qs({
          branch,
          decision,
          from: appliedFrom,
          to: appliedTo,
          search: debouncedSearch,
          page,
        })}`
      ),
    placeholderData: keepPreviousData,
    enabled: tab === 'po',
  })

  const summary = summaryQ.data

  function onBranch(v: string) {
    setBranch(v)
    setPage(1)
  }

  function onDecision(d: 'all' | 'approved' | 'rejected') {
    setDecision(d)
    setPage(1)
  }

  function handleApplyDates() {
    setAppliedFrom(fromInput)
    setAppliedTo(toInput)
    setPage(1)
  }

  function handleClearDates() {
    setFromInput('')
    setToInput('')
    setAppliedFrom('')
    setAppliedTo('')
    setPage(1)
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setDebouncedSearch(searchQuery)
    setPage(1)
  }

  function setDatePreset(preset: 'today' | 'this_month' | 'last_month' | 'all_time') {
    const now = new Date()
    if (preset === 'today') {
      const d = now.toISOString().slice(0, 10)
      setFromInput(d)
      setToInput(d)
      setAppliedFrom(d)
      setAppliedTo(d)
    } else if (preset === 'this_month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const to = now.toISOString().slice(0, 10)
      setFromInput(from)
      setToInput(to)
      setAppliedFrom(from)
      setAppliedTo(to)
    } else if (preset === 'last_month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
      const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
      setFromInput(from)
      setToInput(to)
      setAppliedFrom(from)
      setAppliedTo(to)
    } else {
      handleClearDates()
    }
    setPage(1)
  }

  // Export current table view to CSV
  function handleExportCsv() {
    let rows: any[] = []
    let headers: string[] = []
    let filename = `ca-audit-${tab}-${decision}-${new Date().toISOString().slice(0, 10)}.csv`

    if (tab === 'approvals' && approvalsQ.data?.rows) {
      headers = [
        'Request No',
        'Branch',
        'Location',
        'Vendor Name',
        'Department',
        'Approval Type',
        'Amount',
        'Type of Payment',
        'MD Decision',
        'MD Approver',
        'Rejected By',
        'MD Remarks',
        'Payment Status',
        'UTR Number',
        'GST',
        'Vehicle No',
        'Created Date',
        'Bills Count',
      ]
      rows = approvalsQ.data.rows.map((r) => [
        r.requestNo || r.id,
        r.branchLabel,
        r.location || '',
        r.vendorName || '',
        r.department || '',
        r.approvalType || '',
        r.amount,
        r.typeOfPayment || '',
        r.managementApproval || '',
        r.mdApproverName || '',
        r.rejectedByName || '',
        r.managementRemarks || '',
        r.paymentStatus || '',
        r.utrNumber || '',
        r.gst || '',
        r.vehicleNumber || '',
        r.createdAt,
        r.documents.bills.length,
      ])
    } else if (tab === 'petty_expenses' && expensesQ.data?.rows) {
      headers = [
        'Expense No',
        'Branch',
        'Location',
        'Vendor Name',
        'Department',
        'Particulars',
        'Amount',
        'Status',
        'Expense Date',
        'Approved Date',
        'MD Approver',
        'Rejected By',
        'General Approver',
        'MD Remarks',
        'Bills Count',
      ]
      rows = expensesQ.data.rows.map((r) => [
        r.expenseNumber,
        r.branchLabel,
        r.location || '',
        r.vendorName || '',
        r.department || '',
        r.particulars,
        r.amount,
        r.status,
        r.expenseDate,
        r.approvedAt || '',
        r.mdApproverName || '',
        r.rejectedByName || '',
        r.approverName || '',
        r.mdRemarks || '',
        r.billFiles.length,
      ])
    } else if (tab === 'petty_funding' && fundingQ.data?.rows) {
      headers = [
        'Request No',
        'Branch',
        'Location',
        'Department',
        'Purpose',
        'Requested Amount',
        'Allocated Amount',
        'Status',
        'Approved Date',
        'MD Approver',
        'Rejected By',
        'General Approver',
        'MD Remarks',
      ]
      rows = fundingQ.data.rows.map((r) => [
        r.requestNumber,
        r.branchLabel,
        r.location || '',
        r.department || '',
        r.purpose,
        r.requestedAmount,
        r.allocatedAmount || '',
        r.status,
        r.approvedAt || '',
        r.mdApproverName || '',
        r.rejectedByName || '',
        r.approverName || '',
        r.mdRemarks || '',
      ])
    } else if (tab === 'po' && poQ.data?.rows) {
      headers = [
        'Order No',
        'Branch',
        'Vendor Name',
        'Department',
        'Sub Dept',
        'Amount',
        'Status',
        'MD Status',
        'MD Approver',
        'MD Remarks',
        'Approved Date',
        'Approver Name',
      ]
      rows = poQ.data.rows.map((r) => [
        r.orderNumber,
        r.branchLabel,
        r.vendorName || '',
        r.department || '',
        r.subDepartment || '',
        r.amount,
        r.status,
        r.mdApprovalStatus || '',
        r.mdApproverName || '',
        r.mdApprovalRemarks || '',
        r.approvedAt || '',
        r.approverName || '',
      ])
    }

    if (rows.length === 0) return

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Calculate totals across modules from summary
  const totalApprovedAmount =
    (summary?.totals.approvals.approvedAmount || 0) +
    (summary?.totals.pettyCashSpend.approvedAmount || 0) +
    (summary?.totals.po.approvedAmount || 0)
  const totalApprovedCount =
    (summary?.totals.approvals.approvedCount || 0) +
    (summary?.totals.pettyCashSpend.approvedCount || 0) +
    (summary?.totals.po.approvedCount || 0)

  const totalRejectedAmount =
    (summary?.totals.approvals.rejectedAmount || 0) +
    (summary?.totals.pettyCashSpend.rejectedAmount || 0) +
    (summary?.totals.po.rejectedAmount || 0)
  const totalRejectedCount =
    (summary?.totals.approvals.rejectedCount || 0) +
    (summary?.totals.pettyCashSpend.rejectedCount || 0) +
    (summary?.totals.po.rejectedCount || 0)

  return (
    <div className="space-y-6 max-w-full pb-16">
      {/* Top Header & Overview */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-800">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900">
                Chartered Accountant Audit Portal
              </h1>
              <p className="text-xs text-slate-500">
                Reconciliation & bill verification for MD Approved and Rejected requisitions across all branches
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <Button
            onClick={handleExportCsv}
            variant="outline"
            size="sm"
            className="h-9 px-3.5 rounded-xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-teal-700" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider block">
              MD Approved Total
            </span>
            <CheckCircle2 className="w-4 h-4 text-[#055B65]" />
          </div>
          <p className="text-2xl font-black text-slate-900 tabular-nums mt-1.5">
            {formatCurrency(totalApprovedAmount)}
          </p>
          <span className="text-[11px] font-bold text-teal-700 mt-1 block">
            {formatInt(totalApprovedCount)} approved records
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-rose-800 uppercase tracking-wider block">
              Total Rejected
            </span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <p className="text-2xl font-black text-rose-950 tabular-nums mt-1.5">
            {formatCurrency(totalRejectedAmount)}
          </p>
          <span className="text-[11px] font-bold text-rose-700 mt-1 block">
            {formatInt(totalRejectedCount)} rejected records
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Payment Approvals
            </span>
            <FileCheck className="w-4 h-4 text-teal-700" />
          </div>
          <p className="text-2xl font-black text-slate-800 tabular-nums mt-1.5">
            {formatCurrency(summary?.totals.approvals.approvedAmount || 0)}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block font-medium">
            {formatInt(summary?.totals.approvals.approvedCount || 0)} approved ·{' '}
            {formatInt(summary?.totals.approvals.rejectedCount || 0)} rejected
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Petty Cash Spend
            </span>
            <Wallet className="w-4 h-4 text-teal-700" />
          </div>
          <p className="text-2xl font-black text-slate-800 tabular-nums mt-1.5">
            {formatCurrency(summary?.totals.pettyCashSpend.approvedAmount || 0)}
          </p>
          <span className="text-[11px] text-slate-500 mt-1 block font-medium">
            {formatInt(summary?.totals.pettyCashSpend.approvedCount || 0)} approved ·{' '}
            {formatInt(summary?.totals.pettyCashSpend.rejectedCount || 0)} rejected
          </span>
        </div>
      </div>

      {/* Control Toolbar */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Decision Selector */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => onDecision('all')}
              style={decision === 'all' ? { backgroundColor: '#055B65', color: '#ffffff' } : {}}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                decision === 'all' ? 'text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900 bg-transparent'
              }`}
            >
              All Decisions
            </button>
            <button
              type="button"
              onClick={() => onDecision('approved')}
              style={decision === 'approved' ? { backgroundColor: '#055B65', color: '#ffffff' } : {}}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                decision === 'approved' ? 'text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900 bg-transparent'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approved by MD
            </button>
            <button
              type="button"
              onClick={() => onDecision('rejected')}
              style={decision === 'rejected' ? { backgroundColor: '#e11d48', color: '#ffffff' } : {}}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                decision === 'rejected' ? 'text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900 bg-transparent'
              }`}
            >
              <XCircle className="w-3.5 h-3.5" />
              Rejected
            </button>
          </div>

          {/* Quick Date Presets */}
          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
            <span>Presets:</span>
            <button
              onClick={() => setDatePreset('today')}
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
            >
              Today
            </button>
            <button
              onClick={() => setDatePreset('this_month')}
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
            >
              This Month
            </button>
            <button
              onClick={() => setDatePreset('last_month')}
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
            >
              Last Month
            </button>
            <button
              onClick={() => setDatePreset('all_time')}
              className="px-2 py-1 rounded-md hover:bg-slate-100 text-slate-700 cursor-pointer"
            >
              All Time
            </button>
          </div>
        </div>

        {/* Filter Row: Branch, Date inputs, Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-center">
          {/* Branch Select */}
          <div className="lg:col-span-3">
            <Select value={branch} onValueChange={onBranch}>
              <SelectTrigger className="h-9 rounded-xl text-xs font-bold border-slate-200 bg-slate-50/50">
                <SelectValue placeholder="Select Branch" />
              </SelectTrigger>
              <SelectContent>
                {BRANCH_ITEMS.map((b) => (
                  <SelectItem key={b.value} value={b.value} className="text-xs font-medium">
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date range */}
          <div className="lg:col-span-4 flex items-center gap-1.5">
            <Input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="h-9 text-xs rounded-xl border-slate-200"
              title="From Date"
            />
            <span className="text-xs font-bold text-slate-400">to</span>
            <Input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="h-9 text-xs rounded-xl border-slate-200"
              title="To Date"
            />
            <Button
              onClick={handleApplyDates}
              size="sm"
              style={{ backgroundColor: '#055B65', color: '#ffffff' }}
              className="h-9 px-3 rounded-xl text-xs font-bold text-white shadow-2xs shrink-0 cursor-pointer"
            >
              Apply
            </Button>
            {(appliedFrom || appliedTo) && (
              <Button
                onClick={handleClearDates}
                variant="ghost"
                size="sm"
                className="h-9 px-2 text-xs font-bold text-slate-500 hover:text-slate-800"
                title="Clear Dates"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          {/* Live Search */}
          <div className="lg:col-span-5">
            <form onSubmit={handleSearchSubmit} className="relative w-full">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
              <Input
                type="text"
                placeholder="Search vendor, request #, bill #, UTR, GST..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (!e.target.value) {
                    setDebouncedSearch('')
                    setPage(1)
                  }
                }}
                className="pl-9 pr-8 text-xs rounded-xl h-9 border-slate-200"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setDebouncedSearch('')
                    setPage(1)
                  }}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>

      {/* Module Navigation Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex items-center gap-6 text-xs sm:text-sm font-semibold overflow-x-auto whitespace-nowrap scrollbar-none pb-2">
          <button
            onClick={() => {
              setTab('approvals')
              setPage(1)
            }}
            className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
              tab === 'approvals' ? 'text-teal-900 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileCheck className="w-4 h-4" />
            <span>Payment Approvals</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {summary?.totals.approvals.approvedCount || 0}
            </span>
            {tab === 'approvals' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#055B65] rounded-full" />
            )}
          </button>

          <button
            onClick={() => {
              setTab('petty_expenses')
              setPage(1)
            }}
            className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
              tab === 'petty_expenses' ? 'text-teal-900 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>Petty Cash Expenses</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {summary?.totals.pettyCashSpend.approvedCount || 0}
            </span>
            {tab === 'petty_expenses' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#055B65] rounded-full" />
            )}
          </button>

          <button
            onClick={() => {
              setTab('petty_funding')
              setPage(1)
            }}
            className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
              tab === 'petty_funding' ? 'text-teal-900 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Banknote className="w-4 h-4" />
            <span>Petty Cash Funding</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {summary?.totals.pettyCashFunding.approvedCount || 0}
            </span>
            {tab === 'petty_funding' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#055B65] rounded-full" />
            )}
          </button>

          <button
            onClick={() => {
              setTab('po')
              setPage(1)
            }}
            className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
              tab === 'po' ? 'text-teal-900 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Purchase Orders</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
              {summary?.totals.po.approvedCount || 0}
            </span>
            {tab === 'po' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#055B65] rounded-full" />
            )}
          </button>

          <button
            onClick={() => {
              setTab('summary')
              setPage(1)
            }}
            className={`pb-2.5 relative transition-colors cursor-pointer flex items-center gap-2 ${
              tab === 'summary' ? 'text-teal-900 font-bold' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Branch Summary Matrix</span>
            {tab === 'summary' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#055B65] rounded-full" />
            )}
          </button>
        </div>
      </div>

      {/* Tab 1: Payment Approvals */}
      {tab === 'approvals' && (
        <TableCard
          loading={approvalsQ.isLoading}
          error={approvalsQ.error as Error | null}
          head={['Request #', 'Branch / Location', 'Vendor / Payee', 'Dept & Type', 'Amount', 'MD Decision & Approver', 'Payment / UTR', 'Date', 'Attached Bills', 'Audit']}
          empty="No payment approvals found for this filter combination."
          rows={(approvalsQ.data?.rows || []).map((r) => [
            <div key="req" className="space-y-0.5">
              <span className="font-mono font-bold text-slate-900 text-xs block">
                {r.requestNo || r.id.slice(0, 8)}
              </span>
              {r.gst && <span className="text-[10px] text-slate-400 block font-mono">GST: {r.gst}</span>}
            </div>,
            <div key="branch" className="space-y-0.5">
              <span className="font-bold text-slate-800 text-xs block">{r.branchLabel}</span>
              {r.location && <span className="text-[11px] text-slate-500 block">{r.location}</span>}
            </div>,
            <div key="vendor" className="space-y-0.5 max-w-[180px]">
              <span className="font-semibold text-slate-900 text-xs block truncate" title={r.vendorName || ''}>
                {r.vendorName || '—'}
              </span>
              {r.vehicleNumber && (
                <span className="text-[10px] text-teal-800 font-bold block">Veh: {r.vehicleNumber}</span>
              )}
            </div>,
            <div key="dept" className="space-y-0.5">
              <span className="text-xs text-slate-700 block font-medium">{r.department || '—'}</span>
              <span className="text-[10px] text-slate-400 block uppercase font-bold">{r.approvalType || ''}</span>
            </div>,
            <span key="amt" className="font-black text-slate-900 text-xs">
              {formatCurrency(r.amount)}
            </span>,
            <div key="decision" className="space-y-1">
              <DecisionBadge
                status={r.managementApproval}
                remarks={r.managementRemarks}
                approverName={r.mdApproverName}
                rejectedByName={r.rejectedByName}
              />
            </div>,
            <div key="pay" className="space-y-0.5">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-md inline-block ${
                  r.paymentStatus === 'COMPLETED'
                    ? 'bg-teal-50 text-teal-800 border border-teal-200'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {r.paymentStatus || 'PENDING'}
              </span>
              {r.utrNumber && (
                <span className="text-[10px] text-slate-500 block font-mono">UTR: {r.utrNumber}</span>
              )}
            </div>,
            <span key="dt" className="text-xs text-slate-600 whitespace-nowrap">
              {formatDate(r.createdAt)}
            </span>,
            <DocLinks
              key="docs"
              onPreview={setPreviewDoc}
              groups={[
                ['Bill', r.documents.bills],
                ['Invoice', r.documents.invoices],
                ['Doc', r.documents.docs],
                ['Payment Proof', r.documents.paymentProof ? [r.documents.paymentProof] : []],
              ]}
            />,
            <Button
              key="inspect"
              onClick={() => setInspectItem({ type: 'approval', data: r })}
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-xs font-bold text-teal-800 border-teal-200 hover:bg-teal-50 cursor-pointer"
            >
              <Eye className="w-3 h-3 mr-1" /> Inspect
            </Button>,
          ])}
          align={['left', 'left', 'left', 'left', 'right', 'left', 'left', 'left', 'left', 'center']}
          pagination={approvalsQ.data?.pagination}
          onPage={setPage}
        />
      )}

      {/* Tab 2: Petty Cash Expenses */}
      {tab === 'petty_expenses' && (
        <TableCard
          loading={expensesQ.isLoading}
          error={expensesQ.error as Error | null}
          head={['Expense #', 'Branch / Location', 'Vendor / Payee', 'Particulars & Purpose', 'Amount', 'Status & MD Approver', 'Date', 'Attached Bills', 'Audit']}
          empty="No petty cash expenses found for this filter combination."
          rows={(expensesQ.data?.rows || []).map((r) => [
            <span key="en" className="font-mono font-bold text-slate-900 text-xs">
              {r.expenseNumber}
            </span>,
            <div key="br" className="space-y-0.5">
              <span className="font-bold text-slate-800 text-xs block">{r.branchLabel}</span>
              {r.location && <span className="text-[11px] text-slate-500 block">{r.location}</span>}
            </div>,
            <span key="v" className="text-xs text-slate-800 font-medium">
              {r.vendorName || '—'}
            </span>,
            <div key="part" className="space-y-0.5 max-w-[220px]">
              <span className="text-xs text-slate-900 font-semibold block truncate" title={r.particulars}>
                {r.particulars}
              </span>
              <span className="text-[11px] text-slate-500 block truncate" title={r.purpose}>
                {r.purpose}
              </span>
            </div>,
            <span key="amt" className="font-black text-slate-900 text-xs">
              {formatCurrency(r.amount)}
            </span>,
            <div key="status">
              <StatusBadge
                status={r.status}
                remarks={r.mdRemarks}
                approverName={r.mdApproverName || r.approverName}
                rejectedByName={r.rejectedByName}
              />
            </div>,
            <span key="dt" className="text-xs text-slate-600 whitespace-nowrap">
              {formatDate(r.expenseDate)}
            </span>,
            <DocLinks key="docs" onPreview={setPreviewDoc} groups={[['Bill', r.billFiles]]} />,
            <Button
              key="inspect"
              onClick={() => setInspectItem({ type: 'expense', data: r })}
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-xs font-bold text-teal-800 border-teal-200 hover:bg-teal-50 cursor-pointer"
            >
              <Eye className="w-3 h-3 mr-1" /> Inspect
            </Button>,
          ])}
          align={['left', 'left', 'left', 'left', 'right', 'left', 'left', 'left', 'center']}
          pagination={expensesQ.data?.pagination}
          onPage={setPage}
        />
      )}

      {/* Tab 3: Petty Cash Funding */}
      {tab === 'petty_funding' && (
        <TableCard
          loading={fundingQ.isLoading}
          error={fundingQ.error as Error | null}
          head={['Request #', 'Branch / Location', 'Department & Purpose', 'Requested Amount', 'Allocated', 'Status & MD Approver', 'Approved Date', 'Supporting Files', 'Audit']}
          empty="No petty cash funding records found for this filter combination."
          rows={(fundingQ.data?.rows || []).map((r) => [
            <span key="rn" className="font-mono font-bold text-slate-900 text-xs">
              {r.requestNumber}
            </span>,
            <div key="br" className="space-y-0.5">
              <span className="font-bold text-slate-800 text-xs block">{r.branchLabel}</span>
              {r.location && <span className="text-[11px] text-slate-500 block">{r.location}</span>}
            </div>,
            <div key="purp" className="space-y-0.5 max-w-[220px]">
              <span className="text-xs text-slate-700 block font-medium">{r.department || '—'}</span>
              <span className="text-[11px] text-slate-500 block truncate" title={r.purpose}>
                {r.purpose}
              </span>
            </div>,
            <span key="reqAmt" className="font-bold text-slate-900 text-xs">
              {formatCurrency(r.requestedAmount)}
            </span>,
            <span key="allocAmt" className="font-black text-teal-900 text-xs">
              {r.allocatedAmount != null ? formatCurrency(r.allocatedAmount) : '—'}
            </span>,
            <div key="st">
              <StatusBadge
                status={r.status}
                remarks={r.mdRemarks}
                approverName={r.mdApproverName || r.approverName}
                rejectedByName={r.rejectedByName}
              />
            </div>,
            <span key="dt" className="text-xs text-slate-600 whitespace-nowrap">
              {formatDate(r.approvedAt || r.createdAt)}
            </span>,
            <DocLinks key="docs" onPreview={setPreviewDoc} groups={[['Doc', r.supportingFiles]]} />,
            <Button
              key="inspect"
              onClick={() => setInspectItem({ type: 'funding', data: r })}
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-xs font-bold text-teal-800 border-teal-200 hover:bg-teal-50 cursor-pointer"
            >
              <Eye className="w-3 h-3 mr-1" /> Inspect
            </Button>,
          ])}
          align={['left', 'left', 'left', 'right', 'right', 'left', 'left', 'left', 'center']}
          pagination={fundingQ.data?.pagination}
          onPage={setPage}
        />
      )}

      {/* Tab 4: Purchase Orders */}
      {tab === 'po' && (
        <TableCard
          loading={poQ.isLoading}
          error={poQ.error as Error | null}
          head={['Order #', 'Branch', 'Vendor', 'Dept & Sub-Dept', 'Amount', 'MD Status & Approver', 'Approved Date', 'Documents', 'Audit']}
          empty="No purchase orders found for this filter combination."
          rows={(poQ.data?.rows || []).map((r) => [
            <span key="on" className="font-mono font-bold text-slate-900 text-xs">
              {r.orderNumber}
            </span>,
            <span key="br" className="font-bold text-slate-800 text-xs">
              {r.branchLabel}
            </span>,
            <span key="v" className="text-xs text-slate-800 font-medium">
              {r.vendorName || '—'}
            </span>,
            <div key="dept" className="space-y-0.5">
              <span className="text-xs text-slate-700 block">{r.department || '—'}</span>
              {r.subDepartment && <span className="text-[10px] text-slate-400 block">{r.subDepartment}</span>}
            </div>,
            <span key="amt" className="font-black text-slate-900 text-xs">
              {formatCurrency(r.amount)}
            </span>,
            <div key="st">
              <StatusBadge
                status={r.mdApprovalStatus || r.status}
                remarks={r.mdApprovalRemarks}
                approverName={r.mdApproverName || r.approverName}
              />
            </div>,
            <span key="dt" className="text-xs text-slate-600 whitespace-nowrap">
              {formatDate(r.approvedAt || r.createdAt)}
            </span>,
            <DocLinks
              key="docs"
              onPreview={setPreviewDoc}
              groups={[
                ['Invoice', r.documents.invoices],
                ['Quote', r.documents.quotations],
                ['Bill', r.documents.bills],
              ]}
            />,
            <Button
              key="inspect"
              onClick={() => setInspectItem({ type: 'po', data: r })}
              size="sm"
              variant="outline"
              className="h-7 px-2.5 rounded-lg text-xs font-bold text-teal-800 border-teal-200 hover:bg-teal-50 cursor-pointer"
            >
              <Eye className="w-3 h-3 mr-1" /> Inspect
            </Button>,
          ])}
          align={['left', 'left', 'left', 'left', 'right', 'left', 'left', 'left', 'center']}
          pagination={poQ.data?.pagination}
          onPage={setPage}
        />
      )}

      {/* Tab 5: Branch Summary Matrix */}
      {tab === 'summary' && (
        <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <div className="border-b border-slate-100 px-5 py-3.5 bg-slate-50/50 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Cross-Branch Reconciliation Matrix
              </h3>
              <p className="text-[11px] text-slate-500">
                Audited totals by branch entity for the selected period
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/80">
                  <th className="px-4 py-3 text-left">Branch Entity</th>
                  <th className="px-4 py-3 text-right">Payment Approvals (Appr / Rej)</th>
                  <th className="px-4 py-3 text-right">Approvals Value</th>
                  <th className="px-4 py-3 text-right">Petty Cash Spend (Appr / Rej)</th>
                  <th className="px-4 py-3 text-right">PC Spend Value</th>
                  <th className="px-4 py-3 text-right">Purchase Orders (Appr / Rej)</th>
                  <th className="px-4 py-3 text-right">PO Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...(summary?.branches || []), ...(summary?.unassigned ? [summary.unassigned] : [])].map(
                  (b) => (
                    <tr key={b.branch} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-left font-bold text-slate-900">{b.branchLabel}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        <span className="text-teal-800 font-bold">{b.approvals.approvedCount}</span>
                        {' / '}
                        <span className="text-rose-600 font-bold">{b.approvals.rejectedCount}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">
                        {formatCurrency(b.approvals.approvedAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        <span className="text-teal-800 font-bold">{b.pettyCashSpend.approvedCount}</span>
                        {' / '}
                        <span className="text-rose-600 font-bold">{b.pettyCashSpend.rejectedCount}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">
                        {formatCurrency(b.pettyCashSpend.approvedAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-700">
                        <span className="text-teal-800 font-bold">{b.po.approvedCount}</span>
                        {' / '}
                        <span className="text-rose-600 font-bold">{b.po.rejectedCount}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">
                        {formatCurrency(b.po.approvedAmount)}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Audit Inspection Drawer / Sheet */}
      {inspectItem && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-800">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Audit Detail Sheet</h3>
                  <span className="text-[11px] text-slate-500 uppercase font-mono">
                    {inspectItem.type === 'approval'
                      ? inspectItem.data.requestNo || inspectItem.data.id
                      : inspectItem.type === 'expense'
                      ? inspectItem.data.expenseNumber
                      : inspectItem.type === 'funding'
                      ? inspectItem.data.requestNumber
                      : inspectItem.data.orderNumber}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setInspectItem(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Core Financial Block */}
              <div className="p-4 rounded-2xl bg-teal-50/60 border border-teal-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
                    Requisition Amount
                  </span>
                  <span className="text-xl font-black text-slate-900">
                    {formatCurrency(
                      inspectItem.data.amount || inspectItem.data.requestedAmount || 0
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] border-t border-teal-200/60 pt-2.5">
                  <div>
                    <span className="text-slate-400 block font-semibold">Branch Entity</span>
                    <span className="font-bold text-slate-800">{inspectItem.data.branchLabel}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Location</span>
                    <span className="font-bold text-slate-800">{inspectItem.data.location || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Department</span>
                    <span className="font-bold text-slate-800">{inspectItem.data.department || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Date</span>
                    <span className="font-bold text-slate-800">
                      {formatDate(inspectItem.data.createdAt || inspectItem.data.expenseDate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Vendor & Particulars */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Vendor & Payment Particulars
                </h4>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payee / Vendor:</span>
                    <span className="font-bold text-slate-900">
                      {inspectItem.data.vendorName || '—'}
                    </span>
                  </div>
                  {inspectItem.data.gst && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">GST Number:</span>
                      <span className="font-mono font-bold text-slate-800">{inspectItem.data.gst}</span>
                    </div>
                  )}
                  {inspectItem.data.vehicleNumber && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Vehicle / Unit:</span>
                      <span className="font-bold text-teal-800">
                        {inspectItem.data.vehicleNumber}
                      </span>
                    </div>
                  )}
                  {inspectItem.data.particulars && (
                    <div className="pt-1">
                      <span className="text-slate-500 block">Particulars:</span>
                      <p className="font-medium text-slate-800 mt-0.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        {inspectItem.data.particulars}
                      </p>
                    </div>
                  )}
                  {inspectItem.data.remarks && (
                    <div className="pt-1">
                      <span className="text-slate-500 block">Requisition Remarks:</span>
                      <p className="font-medium text-slate-800 mt-0.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                        {inspectItem.data.remarks}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Approval Stages & Trail */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2.5">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Approval Trail & Remarks
                </h4>
                <div className="space-y-2">
                  {inspectItem.type === 'approval' && (
                    <>
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-800 block">VP / ED Stage:</span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            {inspectItem.data.vpApproval || 'Not Acted'}
                          </span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-800 block">HR / EA Stage:</span>
                          <span className="text-[11px] text-slate-500 font-medium">
                            {inspectItem.data.hrApproval || inspectItem.data.eaApproval || 'Not Acted'}
                          </span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-teal-50/50 border border-teal-200 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-teal-950 block">Managing Director (MD):</span>
                          <span className="text-[11px] font-bold text-teal-800">
                            {inspectItem.data.managementApproval || 'Not Acted'}
                          </span>
                        </div>
                        {inspectItem.data.mdApproverName && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-700 font-semibold pt-0.5">
                            <span className="text-slate-500 text-[11px]">Approved By (MD):</span>
                            <span className="text-teal-950 font-bold">{inspectItem.data.mdApproverName}</span>
                          </div>
                        )}
                        {inspectItem.data.managementRemarks && (
                          <p className="text-[11px] text-slate-600 mt-1 bg-white/70 p-2 rounded-lg border border-teal-100">
                            <span className="font-semibold text-slate-700">Remarks:</span> {inspectItem.data.managementRemarks}
                          </p>
                        )}
                      </div>

                      {/* Full chronological history if present */}
                      {Array.isArray(inspectItem.data.history) && inspectItem.data.history.length > 0 && (
                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                            Full Action Trail
                          </span>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {inspectItem.data.history.map((h: any, idx: number) => (
                              <div
                                key={idx}
                                className="p-2 rounded-lg bg-slate-50 border border-slate-100 text-[11px] flex items-center justify-between"
                              >
                                <div>
                                  <span className="font-bold text-slate-800">{h.role || h.roleKey || 'Approver'}</span>
                                  {h.user && <span className="text-teal-800 font-semibold ml-1.5">({h.user})</span>}
                                  {h.remarks && <p className="text-slate-500 text-[10px] mt-0.5">“{h.remarks}”</p>}
                                </div>
                                <div className="text-right shrink-0 ml-2">
                                  <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-200">
                                    {h.action}
                                  </span>
                                  {h.timestamp && (
                                    <span className="text-[9px] text-slate-400 block mt-0.5">
                                      {formatDate(h.timestamp)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {(inspectItem.type === 'expense' || inspectItem.type === 'funding' || inspectItem.type === 'po') && (
                    <div className="p-2.5 rounded-xl bg-teal-50/50 border border-teal-200 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-teal-950 block">Status Decision:</span>
                        <span className="text-xs font-bold uppercase text-teal-800">
                          {inspectItem.data.mdApprovalStatus || inspectItem.data.status}
                        </span>
                      </div>
                      {(inspectItem.data.mdApproverName ||
                        inspectItem.data.rejectedByName ||
                        inspectItem.data.approverName) && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-700 font-semibold pt-0.5">
                          <span className="text-slate-500 text-[11px]">
                            {inspectItem.data.status === 'rejected' ||
                            inspectItem.data.mdApprovalStatus === 'denied'
                              ? 'Rejected By:'
                              : 'MD Approver:'}
                          </span>
                          <span className="text-teal-950 font-bold">
                            {inspectItem.data.mdApproverName ||
                              inspectItem.data.rejectedByName ||
                              inspectItem.data.approverName}
                          </span>
                        </div>
                      )}
                      {(inspectItem.data.mdRemarks || inspectItem.data.mdApprovalRemarks) && (
                        <p className="text-[11px] text-slate-600 mt-1 bg-white/70 p-2 rounded-lg border border-teal-100">
                          <span className="font-semibold text-slate-700">Remarks:</span>{' '}
                          {inspectItem.data.mdRemarks || inspectItem.data.mdApprovalRemarks}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Attached Bills & Documents */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Attached Bills & Documents
                  </h4>
                  <Receipt className="w-3.5 h-3.5 text-slate-400" />
                </div>

                <div className="space-y-2">
                  {inspectItem.type === 'approval' && (
                    <div className="flex flex-wrap gap-2">
                      {inspectItem.data.documents.bills.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Bill ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Bill ${i + 1}`, url })}
                        />
                      ))}
                      {inspectItem.data.documents.invoices.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Invoice ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Invoice ${i + 1}`, url })}
                        />
                      ))}
                      {inspectItem.data.documents.paymentProof && (
                        <DocumentCard
                          label="Payment Proof"
                          url={inspectItem.data.documents.paymentProof}
                          onPreview={(url) => setPreviewDoc({ title: 'Payment Proof', url })}
                        />
                      )}
                    </div>
                  )}

                  {inspectItem.type === 'expense' && (
                    <div className="flex flex-wrap gap-2">
                      {inspectItem.data.billFiles.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Expense Bill ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Expense Bill ${i + 1}`, url })}
                        />
                      ))}
                    </div>
                  )}

                  {inspectItem.type === 'funding' && (
                    <div className="flex flex-wrap gap-2">
                      {inspectItem.data.supportingFiles.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Supporting Doc ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Supporting Doc ${i + 1}`, url })}
                        />
                      ))}
                    </div>
                  )}

                  {inspectItem.type === 'po' && (
                    <div className="flex flex-wrap gap-2">
                      {inspectItem.data.documents.invoices.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Invoice ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Invoice ${i + 1}`, url })}
                        />
                      ))}
                      {inspectItem.data.documents.quotations.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Quotation ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Quotation ${i + 1}`, url })}
                        />
                      ))}
                      {inspectItem.data.documents.bills.map((url: string, i: number) => (
                        <DocumentCard
                          key={url}
                          label={`Bill ${i + 1}`}
                          url={url}
                          onPreview={(url) => setPreviewDoc({ title: `Bill ${i + 1}`, url })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end">
              <Button
                onClick={() => setInspectItem(null)}
                variant="outline"
                size="sm"
                className="h-8 px-4 text-xs font-bold text-slate-700"
              >
                Close Audit Sheet
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Direct Document Preview Lightbox / Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-60 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-teal-700" />
                <span className="text-xs font-bold text-slate-900">{previewDoc.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewDoc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-lg text-xs font-bold bg-teal-50 border border-teal-200 text-teal-800 hover:bg-teal-100 flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" /> Open in New Tab
                </a>
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-200 flex items-center justify-center text-slate-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950/5 min-h-[300px]">
              {previewDoc.url.match(/\.(jpeg|jpg|png|webp|gif|svg)($|\?)/i) ? (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.title}
                  className="max-h-[70vh] w-auto object-contain rounded-lg shadow-md border border-slate-200 bg-white"
                />
              ) : (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.title}
                  className="w-full h-[70vh] rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DecisionBadge({
  status,
  remarks,
  approverName,
  rejectedByName,
}: {
  status: string | null
  remarks?: string | null
  approverName?: string | null
  rejectedByName?: string | null
}) {
  const s = String(status || '').toUpperCase()
  if (s.startsWith('APPROV')) {
    return (
      <div className="space-y-0.5">
        <span
          style={{ backgroundColor: '#055B65', color: '#ffffff' }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-white shadow-2xs"
        >
          <CheckCircle2 className="w-3 h-3" /> Approved
        </span>
        {approverName && (
          <span className="text-[10px] font-semibold text-teal-900 block truncate" title={`Approved by ${approverName}`}>
            By: {approverName}
          </span>
        )}
      </div>
    )
  }
  if (s.startsWith('NOT APPROV') || s.startsWith('REJECT') || s.includes('DENIED')) {
    return (
      <div className="space-y-0.5">
        <span
          style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-white shadow-2xs"
        >
          <XCircle className="w-3 h-3" /> Rejected
        </span>
        {(rejectedByName || approverName) && (
          <span className="text-[10px] font-semibold text-rose-700 block truncate" title={`Rejected by ${rejectedByName || approverName}`}>
            By: {rejectedByName || approverName}
          </span>
        )}
      </div>
    )
  }
  if (s.includes('HELD')) {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-700 text-white">
          <Clock className="w-3 h-3" /> Held
        </span>
        {approverName && (
          <span className="text-[10px] font-semibold text-slate-600 block truncate">By: {approverName}</span>
        )}
      </div>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">
      {status || 'Pending'}
    </span>
  )
}

function StatusBadge({
  status,
  remarks,
  approverName,
  rejectedByName,
}: {
  status: string | null
  remarks?: string | null
  approverName?: string | null
  rejectedByName?: string | null
}) {
  const s = String(status || '').toLowerCase()
  if (s === 'approved') {
    return (
      <div className="space-y-0.5">
        <span
          style={{ backgroundColor: '#055B65', color: '#ffffff' }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-white shadow-2xs"
        >
          <CheckCircle2 className="w-3 h-3" /> Approved
        </span>
        {approverName && (
          <span className="text-[10px] font-semibold text-teal-900 block truncate" title={`Approved by ${approverName}`}>
            By: {approverName}
          </span>
        )}
      </div>
    )
  }
  if (s === 'rejected' || s === 'denied' || s === 'cancelled') {
    return (
      <div className="space-y-0.5">
        <span
          style={{ backgroundColor: '#e11d48', color: '#ffffff' }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider text-white shadow-2xs"
        >
          <XCircle className="w-3 h-3" /> Rejected
        </span>
        {(rejectedByName || approverName) && (
          <span className="text-[10px] font-semibold text-rose-700 block truncate" title={`Rejected by ${rejectedByName || approverName}`}>
            By: {rejectedByName || approverName}
          </span>
        )}
      </div>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600">
      {status || 'Pending'}
    </span>
  )
}

function DocLinks({
  groups,
  onPreview,
}: {
  groups: [string, string[]][]
  onPreview?: (doc: { title: string; url: string }) => void
}) {
  const items = groups.flatMap(([label, urls]) =>
    urls.filter(Boolean).map((url, i) => ({
      label: urls.length > 1 ? `${label} ${i + 1}` : label,
      url,
    }))
  )
  if (items.length === 0) return <span className="text-slate-300">—</span>

  return (
    <div className="flex flex-wrap gap-1.5 max-w-[200px]">
      {items.map((it) => (
        <button
          type="button"
          key={it.url}
          onClick={() => (onPreview ? onPreview({ title: it.label, url: it.url }) : window.open(it.url, '_blank'))}
          className="inline-flex items-center gap-1 rounded-md bg-teal-50 border border-teal-200 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 hover:bg-teal-100 cursor-pointer transition-colors"
        >
          <Receipt className="h-3 w-3 text-teal-700" />
          {it.label}
          <ArrowUpRight className="h-2.5 w-2.5 opacity-60" />
        </button>
      ))}
    </div>
  )
}

function DocumentCard({
  label,
  url,
  onPreview,
}: {
  label: string
  url: string
  onPreview: (url: string) => void
}) {
  return (
    <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs w-full sm:w-[calc(50%-4px)]">
      <div className="flex items-center gap-2 truncate">
        <FileText className="w-4 h-4 text-teal-700 shrink-0" />
        <span className="font-bold text-slate-800 truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => onPreview(url)}
          className="p-1 rounded-md hover:bg-teal-100 text-teal-800 cursor-pointer"
          title="Preview Document"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="p-1 rounded-md hover:bg-teal-100 text-teal-800"
          title="Open in new tab"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  )
}

function TableCard({
  loading,
  error,
  head,
  rows,
  align,
  empty,
  pagination,
  onPage,
}: {
  loading: boolean
  error: Error | null
  head: string[]
  rows: React.ReactNode[][]
  align: ('left' | 'right' | 'center')[]
  empty: string
  pagination?: CaPagination
  onPage: (p: number) => void
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-teal-700" />
        </div>
      ) : error ? (
        <div className="p-6 text-xs font-bold text-rose-700">{error.message || 'Failed to load.'}</div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center text-xs font-semibold text-slate-400">{empty}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/80">
                  {head.map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'px-4 py-3',
                        align[i] === 'right'
                          ? 'text-right'
                          : align[i] === 'center'
                          ? 'text-center'
                          : 'text-left'
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, ri) => (
                  <tr key={ri} className="hover:bg-slate-50/60 transition-colors align-middle">
                    {r.map((c, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          'px-4 py-3 text-slate-700',
                          align[ci] === 'right'
                            ? 'text-right'
                            : align[ci] === 'center'
                            ? 'text-center'
                            : 'text-left'
                        )}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 bg-slate-50/40">
              <span className="text-[11px] font-semibold text-slate-500">
                {formatInt(pagination.total)} records · page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 rounded-lg p-0 border-slate-200"
                  disabled={pagination.page <= 1}
                  onClick={() => onPage(pagination.page - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs font-bold px-2 text-slate-700">{pagination.page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 rounded-lg p-0 border-slate-200"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => onPage(pagination.page + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

