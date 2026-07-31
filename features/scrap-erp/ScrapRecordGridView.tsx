'use client'

import { useState, useMemo } from 'react'
import { ScrapTransaction } from '@/lib/scrap-erp/types'
import {
  Download,
  Trash2,
  Eye,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Pencil,
  Calendar,
  Search,
  X,
  Filter,
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrapRecordDetailModal } from './ScrapRecordDetailModal'
import { cn } from '@/lib/utils'

function formatINR(val: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0)
}

export function ScrapRecordGridView({
  transactions,
  onOpenImageGallery,
  onDeleteSelected,
  onSelectTransaction,
  onEditRecord,
}: {
  transactions: ScrapTransaction[]
  onOpenImageGallery: (txn: ScrapTransaction) => void
  onDeleteSelected?: (ids: string[]) => void
  onSelectTransaction?: (txn: ScrapTransaction) => void
  onEditRecord?: (txn: ScrapTransaction) => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sortField, setSortField] = useState<keyof ScrapTransaction>('timestamp')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 15

  // Date Range & Search State
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [gridSearch, setGridSearch] = useState<string>('')
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'month' | '30days' | 'custom'>('all')

  // Local detail modal state
  const [localDetailTxn, setLocalDetailTxn] = useState<ScrapTransaction | null>(null)

  const handleApplyPreset = (preset: 'all' | 'today' | 'month' | '30days') => {
    setDatePreset(preset)
    // Local calendar, NOT toISOString(): the latter converts to UTC, which in IST (+05:30) rolls
    // every boundary back a day — "This Month" resolved to 30 Jun .. 30 Jul instead of 1 .. 31 Jul,
    // and "Today" pointed at yesterday for anyone loading the page before 05:30 IST.
    const pad = (n: number) => String(n).padStart(2, '0')
    const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const today = localIso(new Date())
    if (preset === 'all') {
      setStartDate('')
      setEndDate('')
    } else if (preset === 'today') {
      setStartDate(today)
      setEndDate(today)
    } else if (preset === 'month') {
      const d = new Date()
      setStartDate(localIso(new Date(d.getFullYear(), d.getMonth(), 1)))
      setEndDate(today)
    } else if (preset === '30days') {
      const d = new Date()
      d.setDate(d.getDate() - 30)
      setStartDate(localIso(d))
      setEndDate(today)
    }
    setPage(1)
  }

  const handleClearFilters = () => {
    setStartDate('')
    setEndDate('')
    setGridSearch('')
    setDatePreset('all')
    setPage(1)
  }

  // Filtered & Sorted Rows
  const filteredAndSortedRows = useMemo(() => {
    let result = [...transactions]

    // Date Range Filter
    if (startDate || endDate) {
      result = result.filter((tx) => {
        const txDate = tx.soldDate || tx.timestamp?.slice(0, 10) || ''
        if (startDate && txDate < startDate) return false
        if (endDate && txDate > endDate) return false
        return true
      })
    }

    // Grid Search Filter
    if (gridSearch) {
      const q = gridSearch.toLowerCase().trim()
      result = result.filter(
        (tx) =>
          tx.transactionNumber.toLowerCase().includes(q) ||
          tx.locationName.toLowerCase().includes(q) ||
          tx.departmentName.toLowerCase().includes(q) ||
          tx.scrapTypeName.toLowerCase().includes(q) ||
          tx.soldTo.toLowerCase().includes(q) ||
          tx.soldByName.toLowerCase().includes(q) ||
          tx.paymentHandoverToName.toLowerCase().includes(q)
      )
    }

    // Sort
    result.sort((a, b) => {
      const valA = a[sortField] || ''
      const valB = b[sortField] || ''
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [transactions, startDate, endDate, gridSearch, sortField, sortDirection])

  const totalPages = Math.ceil(filteredAndSortedRows.length / pageSize) || 1
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredAndSortedRows.slice(start, start + pageSize)
  }, [filteredAndSortedRows, page, pageSize])

  const handleSort = (field: keyof ScrapTransaction) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const handleSelectAll = () => {
    if (selectedIds.length === paginatedRows.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(paginatedRows.map((r) => r.id))
    }
  }

  const handleToggleRow = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const handleExportCsv = () => {
    const targets = selectedIds.length > 0 ? filteredAndSortedRows.filter((r) => selectedIds.includes(r.id)) : filteredAndSortedRows
    const csvHeader = [
      'Transaction Number',
      'Date',
      'Group',
      'Location',
      'Department',
      'Scrap Type',
      'Unit',
      'Weight/Qty',
      'Rate/Unit',
      'Calculated Total',
      'Amount Received',
      'Outstanding Amount',
      'Sold To',
      'Sold By',
      'Payment Mode',
      'Payment Handover To',
    ].join(',')

    const csvBody = targets
      .map((t) =>
        [
          `"${t.transactionNumber}"`,
          `"${t.soldDate || t.timestamp.slice(0, 10)}"`,
          `"${t.groupName || 'JAM'}"`,
          `"${t.locationName}"`,
          `"${t.departmentName}"`,
          `"${t.scrapTypeName}"`,
          `"${t.unit}"`,
          t.weightQty,
          t.ratePerUnit,
          t.calculatedTotal,
          t.amountReceived,
          t.outstandingAmount,
          `"${t.soldTo}"`,
          `"${t.soldByName}"`,
          `"${t.paymentModeName}"`,
          `"${t.paymentHandoverToName}"`,
        ].join(',')
      )
      .join('\n')

    const blob = new Blob([`${csvHeader}\n${csvBody}`], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `Scrap_Records_Export_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
  }

  return (
    <>
      <Card className="space-y-0 overflow-hidden border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
        {/* Table Action Controls Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-border bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-foreground">Scrap Disposal Records</span>
            <Badge variant="outline" className="text-xs font-bold">
              {filteredAndSortedRows.length} {filteredAndSortedRows.length === transactions.length ? 'Total Entries' : `Filtered of ${transactions.length}`}
            </Badge>
            <span className="text-xs text-muted-foreground hidden sm:inline ml-2">
              (Click any row to view full transaction breakdown)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && onDeleteSelected && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDeleteSelected(selectedIds)
                  setSelectedIds([])
                }}
                className="rounded-xl text-xs font-bold"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete Selected ({selectedIds.length})
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              className="rounded-xl text-xs font-bold"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV ({selectedIds.length || filteredAndSortedRows.length})
            </Button>
          </div>
        </div>

        {/* Date Range & Filter Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-900/60 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs font-black text-slate-800 dark:text-slate-200">
              <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Date Range Filter:</span>
            </div>

            {/* Date Range Picker Inputs */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-bold text-slate-500">From</span>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    setDatePreset('custom')
                    setPage(1)
                  }}
                  className="h-8 w-36 rounded-xl border-slate-300 dark:border-slate-700 text-xs font-bold bg-white dark:bg-slate-900"
                />
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[11px] font-bold text-slate-500">To</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setDatePreset('custom')
                    setPage(1)
                  }}
                  className="h-8 w-36 rounded-xl border-slate-300 dark:border-slate-700 text-xs font-bold bg-white dark:bg-slate-900"
                />
              </div>
            </div>

            {/* Quick Range Presets */}
            <div className="flex items-center gap-1 flex-wrap">
              {[
                { key: 'all', label: 'All Time' },
                { key: 'today', label: 'Today' },
                { key: 'month', label: 'This Month' },
                { key: '30days', label: 'Last 30 Days' },
              ].map((p) => {
                const isActive = datePreset === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => handleApplyPreset(p.key as any)}
                    style={isActive ? { backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' } : undefined}
                    className={cn(
                      'px-2.5 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer border',
                      isActive
                        ? 'shadow-xs border-transparent'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                    )}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Quick Search & Clear */}
          <div className="flex items-center gap-2">
            <div className="relative w-48 sm:w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <Input
                type="text"
                placeholder="Search location, buyer, txn..."
                value={gridSearch}
                onChange={(e) => {
                  setGridSearch(e.target.value)
                  setPage(1)
                }}
                className="h-8 pl-8 rounded-xl text-xs font-medium border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>

            {(startDate || endDate || gridSearch || datePreset !== 'all') && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-8 text-xs font-bold text-slate-500 hover:text-rose-600 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700"
              >
                <X className="h-3.5 w-3.5 mr-1" /> Clear Filter
              </Button>
            )}
          </div>
        </div>

        {/* Table Container */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={paginatedRows.length > 0 && selectedIds.length === paginatedRows.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('transactionNumber')}>
                  <div className="flex items-center gap-1">
                    Txn # <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-1">
                    Date <ArrowUpDown className="h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('groupName')}>
                  Group
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('locationName')}>
                  Dealership Location
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('departmentName')}>
                  Department
                </TableHead>
                <TableHead className="cursor-pointer text-xs font-extrabold" onClick={() => handleSort('scrapTypeName')}>
                  Scrap Type & Unit
                </TableHead>
                <TableHead className="text-right text-xs font-extrabold">Weight / Qty</TableHead>
                <TableHead className="text-right text-xs font-extrabold">Rate / Unit</TableHead>
                <TableHead className="text-right text-xs font-extrabold">Total Amount</TableHead>
                <TableHead className="text-right text-xs font-extrabold">Received</TableHead>
                <TableHead className="text-xs font-extrabold">Buyer / Vendor</TableHead>
                <TableHead className="text-xs font-extrabold">Payment Handover To</TableHead>
                <TableHead className="text-center text-xs font-extrabold">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="h-32 text-center text-xs font-medium text-muted-foreground">
                    No scrap transaction records match your selected date range or search filter.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.map((row) => {
                  const isSelected = selectedIds.includes(row.id)
                  return (
                    <TableRow
                      key={row.id}
                      data-state={isSelected ? 'selected' : undefined}
                      onClick={() => (onSelectTransaction ? onSelectTransaction(row) : setLocalDetailTxn(row))}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => handleToggleRow(row.id)} />
                      </TableCell>
                      <TableCell className="text-xs font-black text-foreground whitespace-nowrap">
                        {row.transactionNumber}
                      </TableCell>
                      <TableCell className="text-xs font-bold text-muted-foreground whitespace-nowrap">
                        {row.soldDate || row.timestamp.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-xs font-bold">
                        <Badge variant="outline" className="text-[10px] font-extrabold">
                          {row.groupName || 'JAM'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-extrabold text-foreground max-w-[180px] truncate">
                        {row.locationName}
                      </TableCell>
                      <TableCell className="text-xs font-bold text-muted-foreground">
                        <Badge variant="secondary" className="text-[10px]">
                          {row.departmentName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-foreground whitespace-nowrap">
                        {row.scrapTypeName}{' '}
                        <span className="text-[10px] text-muted-foreground font-normal">({row.unit})</span>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-right text-foreground">
                        {row.weightQty.toLocaleString('en-IN')}
                      </TableCell>
                      <TableCell className="text-xs font-bold text-right text-muted-foreground">
                        ₹{row.ratePerUnit.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs font-black text-right text-foreground whitespace-nowrap">
                        {formatINR(row.calculatedTotal)}
                      </TableCell>
                      <TableCell className="text-xs font-black text-right text-foreground whitespace-nowrap">
                        {formatINR(row.amountReceived)}
                      </TableCell>
                      <TableCell className="text-xs text-foreground font-semibold max-w-[140px] truncate">
                        {row.soldTo}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-semibold max-w-[180px] truncate">
                        {row.paymentHandoverToName}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => (onSelectTransaction ? onSelectTransaction(row) : setLocalDetailTxn(row))}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted"
                            title="View Full Details"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </Button>
                          {onEditRecord && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => onEditRecord(row)}
                              className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                              title="Edit Record"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onOpenImageGallery(row)}
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="View Attachments"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Footer */}
        <div className="flex items-center justify-between p-4 border-t border-border">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-extrabold text-foreground">{Math.min(filteredAndSortedRows.length, (page - 1) * pageSize + 1)}</span> to{' '}
            <span className="font-extrabold text-foreground">{Math.min(filteredAndSortedRows.length, page * pageSize)}</span> of{' '}
            <span className="font-extrabold text-foreground">{filteredAndSortedRows.length}</span> entries
          </span>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              className="rounded-xl text-xs font-bold"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Previous
            </Button>
            <span className="text-xs font-extrabold px-2 text-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
              className="rounded-xl text-xs font-bold"
            >
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Local Detail Modal Fallback */}
      {localDetailTxn && (
        <ScrapRecordDetailModal
          isOpen={Boolean(localDetailTxn)}
          onClose={() => setLocalDetailTxn(null)}
          onOpenGallery={onOpenImageGallery}
          onEditRecord={onEditRecord}
          transaction={localDetailTxn}
        />
      )}
    </>
  )
}
