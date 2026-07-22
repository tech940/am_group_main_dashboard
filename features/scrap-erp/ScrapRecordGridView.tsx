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
} from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { ScrapRecordDetailModal } from './ScrapRecordDetailModal'

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
}: {
  transactions: ScrapTransaction[]
  onOpenImageGallery: (txn: ScrapTransaction) => void
  onDeleteSelected?: (ids: string[]) => void
  onSelectTransaction?: (txn: ScrapTransaction) => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sortField, setSortField] = useState<keyof ScrapTransaction>('timestamp')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 15

  // Local detail modal state if parent didn't pass custom callback
  const [localDetailTxn, setLocalDetailTxn] = useState<ScrapTransaction | null>(null)

  const sortedRows = useMemo(() => {
    const result = [...transactions]
    result.sort((a, b) => {
      const valA = a[sortField] || ''
      const valB = b[sortField] || ''
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return result
  }, [transactions, sortField, sortDirection])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, page, pageSize])

  const handleSelectAll = () => {
    if (selectedIds.length === paginatedRows.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(paginatedRows.map((r) => r.id))
    }
  }

  const toggleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  const handleSort = (field: keyof ScrapTransaction) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const handleRowClick = (txn: ScrapTransaction, e: React.MouseEvent) => {
    // Prevent triggering row click if clicking checkbox or action button
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('[role="checkbox"]')) {
      return
    }

    if (onSelectTransaction) {
      onSelectTransaction(txn)
    } else {
      setLocalDetailTxn(txn)
    }
  }

  const handleExportCsv = () => {
    const csvHeader = [
      'Transaction #',
      'Date',
      'Group',
      'Location',
      'Department',
      'Scrap Type',
      'Description',
      'Weight Qty',
      'Rate/Unit',
      'Calculated Total',
      'Amount Received',
      'Outstanding',
      'Buyer / Sold To',
      'Sold By',
      'Payment Mode',
      'Handover To',
    ].join(',')

    const rowsToExport = selectedIds.length > 0
      ? transactions.filter((t) => selectedIds.includes(t.id))
      : sortedRows

    const csvBody = rowsToExport
      .map((t) =>
        [
          `"${t.transactionNumber}"`,
          `"${t.soldDate || t.timestamp.slice(0, 10)}"`,
          `"${t.groupName || 'JAM'}"`,
          `"${t.locationName}"`,
          `"${t.departmentName}"`,
          `"${t.scrapTypeName}"`,
          `"${t.description || ''}"`,
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
      <Card className="space-y-4">
        {/* Table Action Controls Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold text-foreground">Scrap Disposal Records</span>
            <Badge variant="outline" className="text-xs font-bold">
              {transactions.length} Total Entries
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
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV ({selectedIds.length || transactions.length})
            </Button>
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
                <TableHead className="text-xs font-extrabold">Group</TableHead>
                <TableHead className="text-xs font-extrabold">Dealership Location</TableHead>
                <TableHead className="text-xs font-extrabold">Department</TableHead>
                <TableHead className="text-xs font-extrabold">Scrap Type & Unit</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Weight / Qty</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Rate / Unit</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Total Amount</TableHead>
                <TableHead className="text-xs font-extrabold text-right">Received</TableHead>
                <TableHead className="text-xs font-extrabold">Buyer / Vendor</TableHead>
                <TableHead className="text-xs font-extrabold">Payment Handover To</TableHead>
                <TableHead className="text-xs font-extrabold text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="h-32 text-center text-xs text-muted-foreground font-medium">
                    No scrap records match the active filters.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedRows.map((row) => {
                  const isSelected = selectedIds.includes(row.id)
                  return (
                    <TableRow
                      key={row.id}
                      onClick={(e) => handleRowClick(row, e)}
                      className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                        isSelected ? 'bg-muted/80' : ''
                      }`}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelectRow(row.id)} />
                      </TableCell>
                      <TableCell className="font-extrabold text-xs text-foreground whitespace-nowrap">
                        {row.transactionNumber}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {row.soldDate || row.timestamp.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className="font-bold text-[10px]">
                          {row.groupName || 'JAM'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-foreground max-w-[180px] truncate">
                        {row.locationName}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="secondary" className="font-extrabold text-[10px]">
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
            Showing <span className="font-extrabold text-foreground">{Math.min(sortedRows.length, (page - 1) * pageSize + 1)}</span> to{' '}
            <span className="font-extrabold text-foreground">{Math.min(sortedRows.length, page * pageSize)}</span> of{' '}
            <span className="font-extrabold text-foreground">{sortedRows.length}</span> records
          </span>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="rounded-xl h-8 px-2 text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <span className="text-xs font-bold px-2 text-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="rounded-xl h-8 px-2 text-xs"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Local Detail Modal fallback if parent didn't bind onSelectTransaction */}
      {localDetailTxn && (
        <ScrapRecordDetailModal
          isOpen={Boolean(localDetailTxn)}
          onClose={() => setLocalDetailTxn(null)}
          transaction={localDetailTxn}
          onOpenGallery={(txn) => onOpenImageGallery(txn)}
        />
      )}
    </>
  )
}
