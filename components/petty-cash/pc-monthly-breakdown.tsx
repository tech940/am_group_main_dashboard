'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Building2,
  Calendar,
  ChevronDown,
  Download,
  Filter,
  Layers,
  LayoutGrid,
  Percent,
  RefreshCw,
  Search,
  Store,
  Table as TableIcon,
  TrendingUp,
  Wallet,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { formatCurrency } from './pc-shared'
import type {
  PettyCashExpenseSummaryResponse,
  MonthlyExpenseBrandGroup,
  MonthlyExpenseMatrixRow,
  MonthlyExpenseLocationGroup,
} from '@/lib/petty-cash/server'

export type MonthlyBreakdownProps = {
  initialBranchId?: string
  isAllBranchViewer: boolean
}

export function PettyCashMonthlyBreakdown({ initialBranchId, isAllBranchViewer }: MonthlyBreakdownProps) {
  const [data, setData] = useState<PettyCashExpenseSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [selectedBranch, setSelectedBranch] = useState<string>(() => {
    return initialBranchId && initialBranchId !== '__mine__' ? initialBranchId : 'all'
  })
  const [departmentFilter, setDepartmentFilter] = useState<'all' | 'Sales' | 'Service'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'matrix' | 'cards'>('table')
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (initialBranchId && initialBranchId !== '__mine__') {
      setSelectedBranch(initialBranchId)
    } else {
      setSelectedBranch('all')
    }
  }, [initialBranchId])

  const loadSummary = useCallback(async (monthParam?: string, branchParam?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const b = branchParam ?? selectedBranch
      if (b && b !== 'all' && b !== '__mine__') params.set('branchId', b)

      const m = monthParam ?? selectedMonth
      if (m) params.set('month', m)

      const res = await fetch(`/api/petty-cash/summary?${params.toString()}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Failed to load expense breakdown')

      setData(json)
      if (json?.brands) {
        const brandExpandState: Record<string, boolean> = {}
        for (const brand of json.brands) {
          brandExpandState[brand.branchId] = true
        }
        setExpandedBrands((prev) => ({ ...brandExpandState, ...prev }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading monthly expense summary')
    } finally {
      setLoading(false)
    }
  }, [selectedBranch, selectedMonth])

  useEffect(() => {
    void loadSummary(selectedMonth, selectedBranch)
  }, [selectedMonth, selectedBranch, loadSummary])

  const toggleBrandExpand = (branchId: string) => {
    setExpandedBrands((prev) => ({ ...prev, [branchId]: !prev[branchId] }))
  }

  // Filtered Matrix Rows
  const filteredMatrix = useMemo(() => {
    if (!data?.matrix) return []
    const q = searchQuery.trim().toLowerCase()
    return data.matrix.filter((row) => {
      const matchesDept = departmentFilter === 'all' || row.department.toLowerCase() === departmentFilter.toLowerCase()
      const matchesSearch = !q ||
        row.location.toLowerCase().includes(q) ||
        row.branchLabel.toLowerCase().includes(q) ||
        row.department.toLowerCase().includes(q)
      return matchesDept && matchesSearch
    })
  }, [data?.matrix, departmentFilter, searchQuery])

  // Filtered Brands & Locations
  const filteredBrands = useMemo(() => {
    if (!data?.brands) return []
    const q = searchQuery.trim().toLowerCase()

    return data.brands.map((brand) => {
      const filteredLocations = brand.locations.filter((loc) => {
        const matchesSearch = !q || loc.location.toLowerCase().includes(q) || brand.branchLabel.toLowerCase().includes(q)
        return matchesSearch
      })

      const salesSum = filteredLocations.reduce((sum, l) => sum + l.salesAmount, 0)
      const serviceSum = filteredLocations.reduce((sum, l) => sum + l.serviceAmount, 0)
      const totalSum = departmentFilter === 'Sales' ? salesSum : departmentFilter === 'Service' ? serviceSum : (salesSum + serviceSum)

      return {
        ...brand,
        locations: filteredLocations,
        filteredSales: salesSum,
        filteredService: serviceSum,
        filteredTotal: totalSum,
      }
    }).filter((brand) => brand.locations.length > 0)
  }, [data?.brands, searchQuery, departmentFilter])

  // CSV Export Handler
  const exportToCsv = () => {
    if (!data || !filteredMatrix.length) return

    const months = data.availableMonths.map((m) => m.key)
    const monthHeaders = data.availableMonths.map((m) => `"${m.label}"`)
    const headers = ['"Brand"', '"Location"', '"Department"', ...monthHeaders, '"Total Amount (₹)"']

    const csvRows = filteredMatrix.map((row) => {
      const monthValues = months.map((mKey) => row.months[mKey] || 0)
      return [
        `"${row.branchLabel}"`,
        `"${row.location}"`,
        `"${row.department}"`,
        ...monthValues,
        row.totalAmount,
      ].join(',')
    })

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvRows].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `petty_cash_expense_summary_${selectedMonth || 'all'}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const metrics = data?.metrics
  const activeMonthLabel = selectedMonth === 'all'
    ? 'All Time'
    : (data?.availableMonths.find((m) => m.key === selectedMonth)?.label || selectedMonth)

  return (
    <div className="space-y-5 font-sans">
      {/* ─── Control Header & Filter Bar ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4.5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 border border-blue-100 dark:border-blue-900">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  Monthly & Branch Expense Breakdown
                </h2>
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
                  {activeMonthLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Departmental expense totals across all dealership outlets.
              </p>
            </div>
          </div>

          {/* View Switcher & Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/90 p-0.5 dark:border-slate-800 dark:bg-slate-950">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                  viewMode === 'table'
                    ? 'bg-white text-slate-800 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                )}
              >
                <Layers className="h-3.5 w-3.5 text-blue-600" /> Breakdown Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                  viewMode === 'matrix'
                    ? 'bg-white text-slate-800 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                )}
              >
                <TableIcon className="h-3.5 w-3.5 text-indigo-600" /> Month Matrix
              </button>
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer',
                  viewMode === 'cards'
                    ? 'bg-white text-slate-800 shadow-xs dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5 text-emerald-600" /> Outlet Cards
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={exportToCsv}
              disabled={loading || !data?.matrix?.length}
              className="h-8 gap-1.5 rounded-xl border-slate-200 text-xs font-semibold text-slate-700 dark:border-slate-800 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500" /> Export CSV
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadSummary()}
              disabled={loading}
              className="h-8 w-8 p-0 rounded-xl border-slate-200 dark:border-slate-800 cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={cn('h-3.5 w-3.5 text-slate-600 dark:text-slate-300', loading && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* ── Filter Strip ──────────────────────────────────────────────── */}
        <div className="mt-3.5 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Quick Month Chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 mr-1">
              Period:
            </span>
            <button
              type="button"
              onClick={() => setSelectedMonth('all')}
              className={cn(
                'rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer',
                selectedMonth === 'all'
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              )}
            >
              All Time
            </button>
            {data?.availableMonths.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setSelectedMonth(m.key)}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer',
                  selectedMonth === m.key
                    ? 'bg-blue-600 text-white shadow-xs font-bold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Secondary Controls: Branch, Dept, Search */}
          <div className="flex flex-wrap items-center gap-2">
            {isAllBranchViewer && (
              <Select value={selectedBranch} onValueChange={(val) => setSelectedBranch(val)}>
                <SelectTrigger className="h-8 w-36 rounded-xl border-slate-200 bg-slate-50 text-xs font-medium dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent className="rounded-xl shadow-lg">
                  <SelectItem value="all" className="text-xs font-bold">All Brands</SelectItem>
                  <SelectItem value="kia" className="text-xs">AM Kia</SelectItem>
                  <SelectItem value="hyundai" className="text-xs">AM Hyundai</SelectItem>
                  <SelectItem value="platinum" className="text-xs">AM Platinum</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Select value={departmentFilter} onValueChange={(val: 'all' | 'Sales' | 'Service') => setDepartmentFilter(val)}>
              <SelectTrigger className="h-8 w-36 rounded-xl border-slate-200 bg-slate-50 text-xs font-medium dark:border-slate-800 dark:bg-slate-950">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent className="rounded-xl shadow-lg">
                <SelectItem value="all" className="text-xs font-bold">Sales & Service</SelectItem>
                <SelectItem value="Sales" className="text-xs">Sales Only</SelectItem>
                <SelectItem value="Service" className="text-xs">Service Only</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter location…"
                className="h-8 w-40 rounded-xl border-slate-200 bg-slate-50 pl-8 text-xs font-medium dark:border-slate-800 dark:bg-slate-950"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Executive Summary Ribbon ───────────────────────────────────── */}
      {metrics && (
        <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-xs sm:grid-cols-3 sm:divide-y-0 sm:divide-x dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {/* Total Spend */}
          <div className="p-4.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Total Spend · {activeMonthLabel}
            </span>
            <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-slate-800 dark:text-slate-100">
              {formatCurrency(metrics.totalSpend)}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {metrics.totalEntriesCount} approved expense line items
            </p>
          </div>

          {/* Sales vs Service Ratio */}
          <div className="p-4.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Department Distribution</span>
              <span className="text-slate-700 dark:text-slate-300 font-bold tabular-nums">
                <span className="text-blue-600">{metrics.salesPercent}% Sales</span> / <span className="text-emerald-600">{metrics.servicePercent}% Service</span>
              </span>
            </div>

            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <div>
                <span className="text-xs text-slate-400">Sales:</span>{' '}
                <span className="font-bold text-sm tabular-nums text-blue-700 dark:text-blue-400">
                  {formatCurrency(metrics.salesSpend)}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-400">Service:</span>{' '}
                <span className="font-bold text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(metrics.serviceSpend)}
                </span>
              </div>
            </div>

            {/* Subtle Inline Ratio Bar with Clean Blue & Emerald colors */}
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="bg-blue-600 transition-all duration-300" style={{ width: `${metrics.salesPercent}%` }} />
              <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${metrics.servicePercent}%` }} />
            </div>
          </div>

          {/* Outlets Highlight */}
          <div className="p-4.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Highest Spend Location
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100">
                {metrics.topLocation?.location || '—'}
              </span>
              {metrics.topLocation && (
                <span className="text-xs text-slate-500">
                  ({metrics.topLocation.branchLabel})
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
              {metrics.topLocation ? formatCurrency(metrics.topLocation.amount) : 'No spend in period'}
            </p>
          </div>
        </div>
      )}

      {/* ─── Main Content Views ─────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`loading-sk-${i}`} className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800/60" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-center text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <p className="text-xs font-bold">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void loadSummary()} className="mt-2 text-xs font-semibold">
            Retry
          </Button>
        </div>
      ) : filteredBrands.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center dark:border-slate-800 dark:bg-slate-950/30">
          <Store className="h-8 w-8 text-slate-400" />
          <h3 className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-200">No Data Found</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            No approved petty cash expenses match the selected filters.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* ═════════════════════════════════════════════════════════════════
           PRIMARY VIEW: EXECUTIVE BREAKDOWN TABLES PER BRAND
           ═════════════════════════════════════════════════════════════════ */
        <div className="space-y-5">
          {filteredBrands.map((brand) => {
            const isExpanded = expandedBrands[brand.branchId] ?? true

            return (
              <div
                key={brand.branchId}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                {/* Brand Header Bar */}
                <div
                  onClick={() => toggleBrandExpand(brand.branchId)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/90 px-5 py-3 border-b border-slate-200 dark:border-slate-800 dark:bg-slate-950/80 cursor-pointer hover:bg-slate-100/80 dark:hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                      {brand.branchLabel}
                    </h3>
                    <span className="text-xs text-slate-500 font-medium">
                      · {brand.locations.length} {brand.locations.length === 1 ? 'Location' : 'Locations'}
                    </span>
                  </div>

                  {/* Brand Aggregated Numbers */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-3.5">
                      <div>
                        <span className="text-slate-500 font-medium">Sales:</span>{' '}
                        <span className="font-bold tabular-nums text-blue-700 dark:text-blue-400">
                          {formatCurrency(brand.filteredSales)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium">Service:</span>{' '}
                        <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(brand.filteredService)}
                        </span>
                      </div>
                      <div className="pl-3 border-l border-slate-200 dark:border-slate-700">
                        <span className="text-slate-500 font-medium">Total:</span>{' '}
                        <span className="font-bold text-sm tabular-nums text-slate-800 dark:text-slate-100">
                          {formatCurrency(brand.filteredTotal)}
                        </span>
                      </div>
                    </div>

                    <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform duration-200', isExpanded && 'rotate-180')} />
                  </div>
                </div>

                {/* Structured Financial Table */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="overflow-x-auto">
                        <table className="petty-cash-clean-table w-full text-left text-xs border-collapse font-sans">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                              <th className="py-2.5 px-5">Location / Dealership</th>
                              <th className="py-2.5 px-4 text-right">Sales Expense</th>
                              <th className="py-2.5 px-4 text-right">Service Expense</th>
                              <th className="py-2.5 px-6 text-center">Department Split</th>
                              <th className="py-2.5 px-5 text-right font-bold text-slate-800 dark:text-slate-200">
                                Location Total
                              </th>
                              <th className="py-2.5 px-4 text-right">Brand Share</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                            {brand.locations.map((loc) => {
                              const locTotal = loc.salesAmount + loc.serviceAmount
                              const salesRatio = locTotal > 0 ? Math.round((loc.salesAmount / locTotal) * 100) : 0
                              const shareOfBrand = brand.filteredTotal > 0 ? Math.round((locTotal / brand.filteredTotal) * 100) : 0

                              return (
                                <tr
                                  key={loc.location}
                                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                                >
                                  {/* Location */}
                                  <td className="py-3 px-5">
                                    <div className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                                      {loc.location}
                                    </div>
                                    <span className="text-[11px] text-slate-400">
                                      {brand.branchLabel}
                                    </span>
                                  </td>

                                  {/* Sales */}
                                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                                    {loc.salesAmount > 0 ? formatCurrency(loc.salesAmount) : '—'}
                                  </td>

                                  {/* Service */}
                                  <td className="py-3 px-4 text-right font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                                    {loc.serviceAmount > 0 ? formatCurrency(loc.serviceAmount) : '—'}
                                  </td>

                                  {/* Split Ratio Bar */}
                                  <td className="py-3 px-6">
                                    <div className="flex flex-col gap-1 max-w-[130px] mx-auto">
                                      <div className="flex items-center justify-between text-[11px] font-medium">
                                        <span className="text-blue-600">{salesRatio}%</span>
                                        <span className="text-emerald-600">{100 - salesRatio}%</span>
                                      </div>
                                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                        <div
                                          className="bg-blue-600 transition-all duration-300"
                                          style={{ width: `${salesRatio}%` }}
                                        />
                                        <div
                                          className="bg-emerald-500 transition-all duration-300"
                                          style={{ width: `${100 - salesRatio}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>

                                  {/* Total Spent */}
                                  <td className="py-3 px-5 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                                    {formatCurrency(locTotal)}
                                  </td>

                                  {/* Share % */}
                                  <td className="py-3 px-4 text-right text-slate-500 text-xs font-semibold tabular-nums">
                                    {shareOfBrand}%
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          {/* Brand Subtotal Footer */}
                          <tfoot>
                            <tr className="border-t border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-800 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-100">
                              <td className="py-3 px-5">
                                Subtotal · {brand.branchLabel}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-blue-700 dark:text-blue-400">
                                {formatCurrency(brand.filteredSales)}
                              </td>
                              <td className="py-3 px-4 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                                {formatCurrency(brand.filteredService)}
                              </td>
                              <td className="py-3 px-6 text-center text-slate-500 text-xs font-medium">
                                {Math.round((brand.filteredSales / (brand.filteredTotal || 1)) * 100)}% / {Math.round((brand.filteredService / (brand.filteredTotal || 1)) * 100)}%
                              </td>
                              <td className="py-3 px-5 text-right font-bold tabular-nums text-slate-800 dark:text-slate-100">
                                {formatCurrency(brand.filteredTotal)}
                              </td>
                              <td className="py-3 px-4 text-right text-slate-500 text-xs font-semibold">
                                100%
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      ) : viewMode === 'matrix' ? (
        /* ═════════════════════════════════════════════════════════════════
           MONTH MATRIX / PIVOT TABLE VIEW
           ═════════════════════════════════════════════════════════════════ */
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="petty-cash-clean-table w-full text-left text-xs border-collapse font-sans">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <th className="py-3 px-4 sticky left-0 bg-slate-50 dark:bg-slate-800 z-10">Brand & Dealership</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Department</th>
                  {data?.availableMonths.map((m) => (
                    <th key={m.key} className="py-3 px-4 text-right whitespace-nowrap">
                      {m.label}
                    </th>
                  ))}
                  <th className="py-3 px-4 text-right font-bold text-slate-800 bg-slate-100/70 dark:bg-slate-750 dark:text-white">
                    Total Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {filteredMatrix.map((row) => (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group"
                  >
                    <td className="py-2.5 px-4 font-semibold text-slate-800 sticky left-0 bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800 z-10 dark:text-slate-100">
                      {row.branchLabel}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300 font-medium">
                      {row.location}
                    </td>
                    <td className="py-2.5 px-4">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border',
                          row.department.toLowerCase() === 'sales'
                            ? 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                        )}
                      >
                        {row.department}
                      </span>
                    </td>
                    {data?.availableMonths.map((m) => {
                      const val = row.months[m.key] || 0
                      return (
                        <td
                          key={m.key}
                          className={cn(
                            'py-2.5 px-4 text-right tabular-nums',
                            val > 0 ? 'text-slate-800 dark:text-slate-200 font-semibold' : 'text-slate-300 dark:text-slate-700'
                          )}
                        >
                          {val > 0 ? formatCurrency(val) : '—'}
                        </td>
                      )
                    })}
                    <td className="py-2.5 px-4 text-right font-bold tabular-nums text-slate-800 bg-slate-50/60 dark:bg-slate-800/40 dark:text-white">
                      {formatCurrency(row.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Grand Totals Footer */}
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                  <td colSpan={3} className="py-3 px-4 sticky left-0 bg-slate-50 dark:bg-slate-800 z-10">
                    Grand Total
                  </td>
                  {data?.availableMonths.map((m) => {
                    const colTotal = filteredMatrix.reduce((sum, r) => sum + (r.months[m.key] || 0), 0)
                    return (
                      <td key={m.key} className="py-3 px-4 text-right font-bold tabular-nums">
                        {formatCurrency(colTotal)}
                      </td>
                    )
                  })}
                  <td className="py-3 px-4 text-right font-bold tabular-nums text-sm bg-slate-100 dark:bg-slate-700 text-blue-700 dark:text-blue-400">
                    {formatCurrency(filteredMatrix.reduce((sum, r) => sum + r.totalAmount, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        /* ═════════════════════════════════════════════════════════════════
           OUTLET CARDS VIEW
           ═════════════════════════════════════════════════════════════════ */
        <div className="space-y-5">
          {filteredBrands.map((brand) => (
            <div key={brand.branchId} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                  {brand.branchLabel}
                </h3>
                <span className="text-xs font-bold tabular-nums text-slate-800 dark:text-white">
                  Total: {formatCurrency(brand.filteredTotal)}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {brand.locations.map((loc) => {
                  const locTotal = loc.salesAmount + loc.serviceAmount
                  const salesPct = locTotal > 0 ? Math.round((loc.salesAmount / locTotal) * 100) : 0

                  return (
                    <div
                      key={`${brand.branchId}-${loc.location}`}
                      className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition-all hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h4 className="font-bold text-sm text-slate-800 dark:text-white">
                              {loc.location}
                            </h4>
                            <span className="text-xs text-slate-400 font-medium">
                              {brand.branchLabel}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold tabular-nums text-slate-800 dark:text-white">
                              {formatCurrency(locTotal)}
                            </div>
                            <span className="text-[11px] text-slate-400 font-medium">
                              Total Spent
                            </span>
                          </div>
                        </div>

                        {/* Department Key-Values */}
                        <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
                          <div>
                            <span className="text-slate-400 font-medium">Sales ({salesPct}%):</span>
                            <div className="font-bold tabular-nums text-blue-700 dark:text-blue-400">
                              {formatCurrency(loc.salesAmount)}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-slate-400 font-medium">Service ({100 - salesPct}%):</span>
                            <div className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatCurrency(loc.serviceAmount)}
                            </div>
                          </div>
                        </div>

                        {/* Soft Blue & Emerald split line */}
                        <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div className="bg-blue-600 transition-all duration-300" style={{ width: `${salesPct}%` }} />
                          <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${100 - salesPct}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
